"""homeops brain — event subscriber and reactor.

Listens to the event bus SSE stream and reacts to selected event types
by running the Strands agent. Only processes events whose source is NOT
one of: agent, agent-cli, mcp, brain.

Entry point: ``homeops-brain`` command.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any

import httpx

from homeops.agent import run
from homeops.busclient import _post_to_bus  # reuse bus helper if needed
from homeops.events import EventType

BUS_URL = os.getenv("BUS_URL", "http://localhost:8000")

# Sources that should be ignored (self / agent / MCP)
IGNORED_SOURCES = {"agent", "agent-cli", "mcp", "brain"}

logger = logging.getLogger(__name__)


def _is_ignored(source: str | None) -> bool:
    """Return True if the event source should be ignored."""
    return source in IGNORED_SOURCES


def _handle_cli_command(event: dict[str, Any]) -> None:
    """React to cli.command events."""
    payload = event.get("payload", {})
    command = payload.get("command", "")
    text = "I'm leaving" if command == "leaving" else "I'm home"
    try:
        run(text)
        logger.info("handled cli.command -> run(%s)", text)
    except Exception as exc:
        logger.error("cli.command run failed: %s", exc)


def _handle_voice_utterance(event: dict[str, Any]) -> None:
    """React to voice.utterance events."""
    payload = event.get("payload", {})
    text = payload.get("text", "")
    if not text:
        return
    try:
        run(text)
        logger.info("handled voice.utterance -> run(%r)", text)
    except Exception as exc:
        logger.error("voice.utterance run failed: %s", exc)


def _perceive(payload: dict[str, Any], zone: str) -> str:
    """Run local YOLO on the event's camera frame, post cv.detection, return a summary."""
    image = payload.get("image")
    if not image or not os.path.exists(image):
        return "no camera frame available"
    try:
        from homeops.perception import detect

        out = "console/public/frames/latest.jpg"
        res = detect(image, out)
        if res["people"] > 0:
            label = "person"
            summary = f"{res['people']} person(s) detected at the door"
        elif payload.get("who") == "delivery":
            label = "package"
            summary = "no people detected, a parcel is on the doorstep"
        else:
            label = "nothing"
            summary = "no person or parcel detected"
        try:
            _post_to_bus(
                EventType.cv_detection,
                {
                    "zone": zone,
                    "label": label,
                    "confidence": max((i["confidence"] for i in res["items"]), default=0.0),
                    "people": res["people"],
                    "objects": res["objects"],
                    "frame": "/frames/latest.jpg",
                },
                source="brain",
            )
        except Exception as exc:
            logger.warning("could not post cv.detection: %s", exc)
        return summary
    except Exception as exc:
        logger.error("perception failed: %s", exc)
        return "camera analysis failed"


def _handle_sensor_event(event: dict[str, Any]) -> None:
    """React to sensor.doorbell / sensor.motion events."""
    import httpx as _httpx

    payload = event.get("payload", {})
    zone = payload.get("zone", "front_door")

    # Fetch current mode from /state
    try:
        with _httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{BUS_URL}/state")
            resp.raise_for_status()
            state = resp.json()
    except Exception as exc:
        logger.error("failed to fetch /state: %s", exc)
        return

    mode = state.get("mode", "normal")
    event_type = event.get("type", "")
    who = payload.get("who") or "unknown"
    when = payload.get("when") or "unspecified"
    seen = _perceive(payload, zone)
    text = (
        f"Event: {event_type} at {zone}. Who: {who}. Time of day: {when}. "
        f"Camera: {seen}. "
        f"Current mode is {mode}. Decide what to do and use your tools."
    )
    try:
        run(text)
        logger.info("handled sensor.%s -> run(text)", event_type)
    except Exception as exc:
        logger.error("sensor event run failed: %s", exc)


def _handle_event(event: dict[str, Any]) -> None:
    """Dispatch a single event to the appropriate handler."""
    source = event.get("source")
    if _is_ignored(source):
        return

    event_type = event.get("type", "")

    if event_type == "cli.command":
        _handle_cli_command(event)
    elif event_type == "voice.utterance":
        _handle_voice_utterance(event)
    elif event_type in ("sensor.doorbell", "sensor.motion"):
        _handle_sensor_event(event)
    else:
        logger.info("unhandled event type: %s", event_type)


def _stream_loop() -> None:
    """Main SSE streaming loop with auto-reconnect."""
    while True:
        try:
            with httpx.Client(timeout=None) as client:
                with client.stream("GET", f"{BUS_URL}/stream") as response:
                    for line in response.iter_lines():
                        if line.startswith("data: "):
                            try:
                                data = json.loads(line[6:])
                                _handle_event(data)
                                print(f"handled: {data['type']} from {data['source']}")
                            except (json.JSONDecodeError, KeyError):
                                # ignore ": ping" and malformed lines
                                pass
                        elif line == ": ping":
                            # keep-alive ping, ignore
                            pass
        except Exception as exc:
            logger.error("stream error: %s, reconnecting in 2s", exc)
            time.sleep(2)


def main() -> None:
    """Entry point for homeops-brain."""
    _stream_loop()


if __name__ == "__main__":
    main()