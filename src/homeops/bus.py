"""FastAPI event bus for homeops."""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from homeops.events import Event, EventType

app = FastAPI(title="homeops event bus")

# Allow all localhost origins (any port)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

_events: list[Event] = []          # rolling store (last 50 kept for /state)
_mode: str = "normal"              # updated by home.mode events
_subscribers: list[asyncio.Queue[Event]] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _broadcast(event: Event) -> None:
    """Push event to every active SSE subscriber."""
    for q in _subscribers:
        q.put_nowait(event)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/events", response_model=Event, status_code=201)
def post_event(event: Event) -> Event:
    """Validate, stamp, store, and broadcast an event."""
    global _mode

    # id and ts are already filled by field defaults; just store and broadcast
    _events.append(event)

    if event.type is EventType.home_mode:
        new_mode = event.payload.get("mode", _mode)
        if new_mode in ("normal", "security"):
            _mode = new_mode

    _broadcast(event)
    return event


@app.get("/stream")
async def stream() -> EventSourceResponse:
    """SSE endpoint — streams every new event as JSON."""

    async def _generator() -> AsyncIterator[dict]:
        q: asyncio.Queue[Event] = asyncio.Queue()
        _subscribers.append(q)
        try:
            while True:
                event = await q.get()
                yield {"data": json.dumps(event.model_dump())}
        finally:
            _subscribers.remove(q)

    return EventSourceResponse(_generator())


@app.get("/state")
def state() -> dict:
    """Return current mode and the last 50 events."""
    return {
        "mode": _mode,
        "events": [e.model_dump() for e in _events[-50:]],
    }
