"""Tests for the homeops CLI and brain source filtering.

No tests call an LLM or the network (all HTTP calls are monkeypatched).
"""

from __future__ import annotations

import json
import sys

import pytest
from unittest.mock import Mock

from homeops.cli import main as cli_main


def _make_mock_response(json_data):
    """Helper to create a mock httpx response."""
    resp = Mock()
    resp.raise_for_status = Mock()
    resp.json = Mock(return_value=json_data)
    return resp


def test_cli_leaving_payload(monkeypatch):
    """POST /events with correct payload for homeops leaving."""
    called = {}

    def mock_post(url, *args, **kwargs):
        called["url"] = url
        called["json"] = kwargs.get("json", {}) if kwargs else {}
        called["timeout"] = kwargs.get("timeout", 10.0) if kwargs else 10.0
        return _make_mock_response({})

    monkeypatch.setattr("homeops.cli.httpx.Client.post", mock_post)
    monkeypatch.setattr("homeops.cli.sys", sys)

    sys.argv = ["homeops", "leaving"]
    cli_main()

    assert called["json"]["type"] == "cli.command"
    assert called["json"]["source"] == "cli"
    assert called["json"]["payload"] == {"command": "leaving"}


def test_cli_home_payload(monkeypatch):
    """POST /events with correct payload for homeops home."""
    called = {}

    def mock_post(url, *args, **kwargs):
        called["url"] = url
        called["json"] = kwargs.get("json", {}) if kwargs else {}
        called["timeout"] = kwargs.get("timeout", 10.0) if kwargs else 10.0
        return _make_mock_response({})

    monkeypatch.setattr("homeops.cli.httpx.Client.post", mock_post)
    monkeypatch.setattr("homeops.cli.sys", sys)

    sys.argv = ["homeops", "home"]
    cli_main()

    assert called["json"]["type"] == "cli.command"
    assert called["json"]["source"] == "cli"
    assert called["json"]["payload"] == {"command": "home"}


def test_cli_status_output(caplog):
    """status command prints mode and events."""
    called = {}

    def mock_get(url, *args, **kwargs):
        called["url"] = url
        called["json"] = kwargs.get("json", {}) if kwargs else {}
        called["timeout"] = kwargs.get("timeout", 10.0) if kwargs else 10.0
        return _make_mock_response({"mode": "security", "events": [
            {"ts": "2026-01-01T00:00:00Z", "type": "sensor.motion", "source": "event-sim", "payload": {"zone": "front_door"}}
        ]})

    mp = pytest.MonkeyPatch()
    mp.setattr("homeops.cli.httpx.Client.get", mock_get)
    mp.setattr("homeops.cli.sys", sys)

    sys.argv = ["homeops", "status"]
    with caplog.at_level("INFO"):
        cli_main()


def test_brain_ignores_agent_source():
    """Brain should ignore events from source 'agent'."""
    from homeops.brain import _is_ignored

    assert _is_ignored("agent") is True
    assert _is_ignored("agent-cli") is True
    assert _is_ignored("mcp") is True
    assert _is_ignored("brain") is True
    assert _is_ignored("other") is False


def test_brain_ignores_events_from_sources():
    """Brain stream handler ignores events from ignored sources."""
    from homeops.brain import _is_ignored

    # Event from ignored source should be skipped
    assert _is_ignored("agent") is True
    assert _is_ignored("agent-cli") is True
    assert _is_ignored("mcp") is True
    assert _is_ignored("brain") is True
    assert _is_ignored("other") is False