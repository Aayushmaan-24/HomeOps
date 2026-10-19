"""Tests for the homeops MCP server."""

from __future__ import annotations

import pytest

from homeops.mcp_server import make_mcp_server, _post_to_bus, _post_agent_action, set_mode, arm_security, disarm_security, speak


@pytest.fixture
def mcp_server():
    """Create a FastMCP server instance for testing."""
    return make_mcp_server()


def test_set_mode_posts_home_mode_event(monkeypatch, mcp_server):
    """set_mode should post a home.mode event."""
    posted_event: dict[str, Any] = {}
    posted_agent_action: dict[str, Any] = {}

    def mock_post_to_bus(event_type, payload):
        posted_event["event_type"] = event_type
        posted_event["payload"] = payload
        return {"status": "ok"}

    def mock_post_agent_action(tool, args, result):
        posted_agent_action["tool"] = tool
        posted_agent_action["args"] = args
        posted_agent_action["result"] = result

    monkeypatch.setattr("homeops.mcp_server._post_to_bus", mock_post_to_bus)
    monkeypatch.setattr("homeops.mcp_server._post_agent_action", mock_post_agent_action)

    result = set_mode("security")

    assert result == "mode set to security"
    assert posted_event["event_type"] == "home.mode"
    assert posted_event["payload"] == {"mode": "security", "reason": "set via MCP"}
    assert posted_agent_action["tool"] == "set_mode"
    assert posted_agent_action["args"] == {"mode": "security", "reason": "set via MCP"}
    assert posted_agent_action["result"] == "mode set to security"


def test_arm_security_posts_home_mode_and_zones(monkeypatch, mcp_server):
    """arm_security should post a home.mode (security) event and return armed zones."""
    posted_event: dict[str, Any] = {}
    posted_agent_action: dict[str, Any] = {}

    def mock_post_to_bus(event_type, payload):
        posted_event["event_type"] = event_type
        posted_event["payload"] = payload
        return {"status": "ok"}

    def mock_post_agent_action(tool, args, result):
        posted_agent_action["tool"] = tool
        posted_agent_action["args"] = args
        posted_agent_action["result"] = result

    monkeypatch.setattr("homeops.mcp_server._post_to_bus", mock_post_to_bus)
    monkeypatch.setattr("homeops.mcp_server._post_agent_action", mock_post_agent_action)

    result = arm_security(["zone1", "zone2"])

    assert result == "zones armed: zone1, zone2"
    assert posted_event["event_type"] == "home.mode"
    assert posted_event["payload"] == {"mode": "security", "reason": "set via MCP"}
    assert posted_agent_action["tool"] == "arm_security"
    assert posted_agent_action["args"] == {"zones": ["zone1", "zone2"], "reason": "set via MCP"}
    assert posted_agent_action["result"] == "zones armed: zone1, zone2"


def test_disarm_security_posts_normal_mode(monkeypatch, mcp_server):
    """disarm_security should post a home.mode (normal) event."""
    posted_event: dict[str, Any] = {}
    posted_agent_action: dict[str, Any] = {}

    def mock_post_to_bus(event_type, payload):
        posted_event["event_type"] = event_type
        posted_event["payload"] = payload
        return {"status": "ok"}

    def mock_post_agent_action(tool, args, result):
        posted_agent_action["tool"] = tool
        posted_agent_action["args"] = args
        posted_agent_action["result"] = result

    monkeypatch.setattr("homeops.mcp_server._post_to_bus", mock_post_to_bus)
    monkeypatch.setattr("homeops.mcp_server._post_agent_action", mock_post_agent_action)

    result = disarm_security()

    assert result == "security disarmed"
    assert posted_event["event_type"] == "home.mode"
    assert posted_event["payload"] == {"mode": "normal", "reason": "set via MCP"}
    assert posted_agent_action["tool"] == "disarm_security"
    assert posted_agent_action["args"] == {}
    assert posted_agent_action["result"] == "security disarmed"


def test_speaks_posts_voice_say_event(monkeypatch, mcp_server):
    """speak should post a voice.say event."""
    posted_event: dict[str, Any] = {}
    posted_agent_action: dict[str, Any] = {}

    def mock_post_to_bus(event_type, payload):
        posted_event["event_type"] = event_type
        posted_event["payload"] = payload
        return {"status": "ok"}

    def mock_post_agent_action(tool, args, result):
        posted_agent_action["tool"] = tool
        posted_agent_action["args"] = args
        posted_agent_action["result"] = result

    monkeypatch.setattr("homeops.mcp_server._post_to_bus", mock_post_to_bus)
    monkeypatch.setattr("homeops.mcp_server._post_agent_action", mock_post_agent_action)

    result = speak("hello world")

    assert result == "said: hello world"
    assert posted_event["event_type"] == "voice.say"
    assert posted_event["payload"] == {"text": "hello world", "reason": "set via MCP"}
    assert posted_agent_action["tool"] == "speak"
    assert posted_agent_action["args"] == {"text": "hello world", "reason": "set via MCP"}
    assert posted_agent_action["result"] == "said: hello world"