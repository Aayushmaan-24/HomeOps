"""homeops bus client — event bus posting helper.

Provides ``_post_to_bus`` used by both the MCP server and the agent.
Does NOT import fastmcp or mcp.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from homeops.events import EventType

BUS_URL = os.getenv("BUS_URL", "http://localhost:8000")


def _post_to_bus(event_type: EventType, payload: Dict[str, Any], source: str = "mcp") -> Dict[str, Any]:
    """Post an event to the homeops event bus over HTTP.

    Args:
        event_type: The event type from homeops.events.EventType.
        payload: The event payload dict.
        source: Top-level ``source`` string. Defaults to ``"mcp"``.

    Returns:
        The response JSON from the bus endpoint.
    """
    event = {
        "type": event_type,
        "source": source,
        "payload": payload,
    }
    import httpx

    with httpx.Client() as client:
        resp = client.post(f"{BUS_URL}/events", json=event)
        resp.raise_for_status()
    return resp.json()