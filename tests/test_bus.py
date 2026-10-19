"""Tests for the homeops event bus."""

import pytest
from fastapi.testclient import TestClient

from homeops.bus import app, _events, _mode
from homeops import bus


@pytest.fixture(autouse=True)
def reset_state():
    """Reset in-memory state before every test."""
    bus._events.clear()
    bus._mode = "normal"
    yield


client = TestClient(app)


# ---------------------------------------------------------------------------
# POST /events
# ---------------------------------------------------------------------------

def test_post_event_returns_stamped_event():
    resp = client.post("/events", json={
        "type": "cli.command",
        "source": "terminal",
        "payload": {"cmd": "lights on"},
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "cli.command"
    assert body["source"] == "terminal"
    assert body["id"].startswith("evt_")
    assert body["ts"]  # non-empty timestamp


# ---------------------------------------------------------------------------
# GET /state reflects posted events
# ---------------------------------------------------------------------------

def test_state_reflects_posted_event():
    client.post("/events", json={
        "type": "sensor.motion",
        "source": "hallway",
        "payload": {},
    })
    resp = client.get("/state")
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "normal"
    assert len(body["events"]) == 1
    assert body["events"][0]["type"] == "sensor.motion"


def test_state_keeps_only_last_50_events():
    for i in range(60):
        client.post("/events", json={
            "type": "sensor.motion",
            "source": f"sensor-{i}",
            "payload": {},
        })
    resp = client.get("/state")
    assert len(resp.json()["events"]) == 50


# ---------------------------------------------------------------------------
# Mode changes on home.mode event
# ---------------------------------------------------------------------------

def test_mode_changes_to_security():
    client.post("/events", json={
        "type": "home.mode",
        "source": "app",
        "payload": {"mode": "security"},
    })
    resp = client.get("/state")
    assert resp.json()["mode"] == "security"


def test_mode_changes_back_to_normal():
    bus._mode = "security"
    client.post("/events", json={
        "type": "home.mode",
        "source": "app",
        "payload": {"mode": "normal"},
    })
    resp = client.get("/state")
    assert resp.json()["mode"] == "normal"


def test_invalid_mode_payload_leaves_mode_unchanged():
    client.post("/events", json={
        "type": "home.mode",
        "source": "app",
        "payload": {"mode": "vacation"},  # not a valid mode value
    })
    resp = client.get("/state")
    assert resp.json()["mode"] == "normal"


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
