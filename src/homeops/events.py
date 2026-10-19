"""Event model and EventType enum for homeops."""

from __future__ import annotations

import itertools
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventType(str, Enum):
    cli_command = "cli.command"
    voice_utterance = "voice.utterance"
    sensor_doorbell = "sensor.doorbell"
    sensor_motion = "sensor.motion"
    cv_detection = "cv.detection"
    agent_thought = "agent.thought"
    agent_action = "agent.action"
    home_mode = "home.mode"
    voice_say = "voice.say"


# Auto-incrementing counter for event IDs
_counter = itertools.count(1)


def _next_id() -> str:
    return f"evt_{next(_counter):04d}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Event(BaseModel):
    id: str = Field(default_factory=_next_id)
    ts: str = Field(default_factory=_utc_now)
    type: EventType
    source: str
    payload: dict[str, Any] = Field(default_factory=dict)
