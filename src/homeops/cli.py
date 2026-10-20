"""homeops CLI — command-line interface for the event bus.

Provides ad-hoc event posting and monitoring without running the full agent.
Uses only argparse, stdlib, and httpx. Does NOT import strands, fastmcp, mcp,
or homeops.agent.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import httpx

BUS_URL = os.getenv("BUS_URL", "http://localhost:8000")


def _post_event(event_type: str, source: str, payload: dict[str, Any]) -> None:
    """Post a single event to the bus and print a confirmation."""
    event = {"type": event_type, "source": source, "payload": payload}
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(f"{BUS_URL}/events", json=event)
            resp.raise_for_status()
        print(f"ok: {event_type} posted")
    except Exception as exc:
        print(f"error: failed to post event: {exc}", file=sys.stderr)
        sys.exit(1)


def _get_state() -> dict[str, Any]:
    """Fetch the current bus state."""
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(f"{BUS_URL}/state")
        resp.raise_for_status()
        return resp.json()


def _stream_events() -> None:
    """Stream events from /sse endpoint until Ctrl+C."""
    with httpx.Client(timeout=None) as client:
        try:
            with client.stream("GET", f"{BUS_URL}/stream") as response:
                for line in response.iter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            # Print one line: time type source payload_summary
                            payload = data.get("payload", {})
                            summary = str(payload)[:40]
                            print(f"{data['ts']} {data['type']} {data['source']} {summary}")
                        except (json.JSONDecodeError, KeyError):
                            pass
        except KeyboardInterrupt:
            pass
        except Exception as exc:
            print(f"error: stream failed: {exc}", file=sys.stderr)
            sys.exit(1)


def cmd_leaving() -> None:
    """Post a cli.command event: leaving."""
    _post_event("cli.command", "cli", {"command": "leaving"})


def cmd_home() -> None:
    """Post a cli.command event: home."""
    _post_event("cli.command", "cli", {"command": "home"})


def cmd_status() -> None:
    """Print current mode and last 5 events."""
    state = _get_state()
    mode = state.get("mode", "normal")
    print(f"mode: {mode}")
    events = state.get("events", [])[-5:]
    for ev in events:
        payload = ev.get("payload", {})
        summary = str(payload)[:40]
        print(f"  {ev['ts']} {ev['type']} {ev['source']} {summary}")


def cmd_sim_doorbell(who=None, when=None) -> None:
    """POST sensor.doorbell event (optionally with who is at the door and time of day)."""
    payload = {"zone": "front_door"}
    if who:
        payload["who"] = who
        payload["image"] = f"samples/{who}.png"
    if when:
        payload["when"] = when
    _post_event("sensor.doorbell", "event-sim", payload)


def cmd_sim_motion(who=None, when=None) -> None:
    """POST sensor.motion event (optionally with who and time of day)."""
    payload = {"zone": "front_door"}
    if who:
        payload["who"] = who
    if when:
        payload["when"] = when
    _post_event("sensor.motion", "event-sim", payload)


def cmd_watch() -> None:
    """Stream events from /sse until Ctrl+C."""
    print("watching (Ctrl+C to stop)...")
    _stream_events()


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(prog="homeops", description="HomeOps event bus CLI")
    sub = parser.add_subparsers(dest="command")

    p_leaving = sub.add_parser("leaving", help="Post leaving command")
    p_leaving.set_defaults(func=cmd_leaving)

    p_home = sub.add_parser("home", help="Post home command")
    p_home.set_defaults(func=cmd_home)

    p_status = sub.add_parser("status", help="Show current mode and recent events")
    p_status.set_defaults(func=cmd_status)

    p_doorbell = sub.add_parser("sim", help="Simulate events")
    p_doorbell.add_argument("event_type", choices=["doorbell", "motion"],
                            help="Type of event to simulate")
    p_doorbell.add_argument("--who", choices=["friend", "delivery", "unknown"],
                            help="Who is at the door")
    p_doorbell.add_argument("--when", choices=["day", "night"],
                            help="Time of day")
    p_doorbell.set_defaults(func=None)

    p_watch = sub.add_parser("watch", help="Stream events via SSE")
    p_watch.set_defaults(func=cmd_watch)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(1)
    if args.command == "sim":
        (cmd_sim_doorbell if args.event_type == "doorbell" else cmd_sim_motion)(args.who, args.when)
    else:
        args.func()


if __name__ == "__main__":
    main()