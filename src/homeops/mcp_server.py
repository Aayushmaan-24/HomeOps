"""homeops MCP server — FastMCP server integrated with the homeops event bus."""

from __future__ import annotations

import os
from typing import Any, List

import httpx
from fastmcp import FastMCP

from homeops.events import EventType

BUS_URL = os.getenv("BUS_URL", "http://localhost:8000")


def _post_to_bus(event_type: EventType, payload: dict[str, Any]) -> dict[str, Any]:
    """Post an event to the homeops event bus over HTTP."""
    event = {
        "type": event_type,
        "source": "mcp",
        "payload": payload,
    }
    with httpx.Client() as client:
        resp = client.post(f"{BUS_URL}/events", json=event)
        resp.raise_for_status()
    return resp.json()


def _post_agent_action(tool: str, args: dict[str, Any], result: Any) -> None:
    """Post an agent.action event to the bus after a tool call."""
    _post_to_bus(EventType.agent_action, {
        "tool": tool,
        "args": args,
        "result": result,
    })


# ---------------------------------------------------------------------------
# MCP tools
# ---------------------------------------------------------------------------

from typing import Literal


def set_mode(mode: Literal['normal', 'security'], reason: str = "set via MCP") -> str:
    """Set the home mode.

    Posts a home.mode event with the given reason and an agent.action event.
    """
    payload = {"mode": mode, "reason": reason}
    result = _post_to_bus(EventType.home_mode, payload)
    _post_agent_action("set_mode", {"mode": mode, "reason": reason}, f"mode set to {mode}")
    return f"mode set to {mode}"


def arm_security(zones: List[str], reason: str = "set via MCP") -> str:
    """Arm security zones.

    Posts a home.mode event (security) and an agent.action event.
    Returns a comma-separated list of armed zones.
    """
    payload = {"mode": "security", "reason": reason}
    result = _post_to_bus(EventType.home_mode, payload)
    _post_agent_action(
        "arm_security",
        {"zones": zones, "reason": reason},
        f"zones armed: {', '.join(zones)}",
    )
    return f"zones armed: {', '.join(zones)}"


def disarm_security(reason: str = "set via MCP") -> str:
    """Disarm security.

    Posts a home.mode event (normal) and an agent.action event.
    """
    payload = {"mode": "normal", "reason": reason}
    result = _post_to_bus(EventType.home_mode, payload)
    _post_agent_action("disarm_security", {}, "security disarmed")
    return "security disarmed"


def speak(text: str, reason: str = "set via MCP") -> str:
    """Post a voice.say event.

    Posts a voice.say event with the given text and an agent.action event.
    """
    payload = {"text": text, "reason": reason}
    result = _post_to_bus(EventType.voice_say, payload)
    _post_agent_action("speak", {"text": text, "reason": reason}, f"said: {text}")
    return f"said: {text}"


def notify(title: str, body: str, severity: Literal["info", "warning", "critical"] = "info") -> str:
    """Send a notification to the homeowner (shown on the TV console).

    Use severity "info" for routine updates (e.g. a delivery arrived),
    "warning" for things worth attention, and "critical" for a possible
    security threat that needs immediate attention.
    """
    _post_agent_action(
        "notify",
        {"title": title, "body": body, "severity": severity},
        f"notified ({severity}): {title}",
    )
    return f"notified ({severity}): {title}"


# ---------------------------------------------------------------------------
# FastMCP server setup
# ---------------------------------------------------------------------------

def make_mcp_server() -> FastMCP:
    """Create and configure the FastMCP server instance."""
    server = FastMCP(name="homeops")

    # Register the module-level tools with the FastMCP server
    server.tool(set_mode)
    server.tool(arm_security)
    server.tool(disarm_security)
    server.tool(speak)
    server.tool(notify)

    return server


def main() -> None:
    """Run the FastMCP server over Streamable HTTP on 127.0.0.1:8001, endpoint /mcp."""
    server = make_mcp_server()
    server.run(
        transport="streamable-http",
        host="127.0.0.1",
        port=8001,
        path="/mcp",
    )


if __name__ == "__main__":
    main()
