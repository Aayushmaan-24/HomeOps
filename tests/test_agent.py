"""Tests for the homeops agent bus-posting helper."""

import pytest

from homeops.agent import _post_voice_utterance, _post_agent_thought


def test_bus_posting_helper(monkeypatch):
    """Verify _post_to_bus posts the right event type/payload when monkeypatched.

    Confirms that the top-level ``source`` field is set correctly and the
    payload contains only the ``text`` key.
    """
    posted: dict[str, Any] = {}

    def mock_post(event_type, payload, source="mcp"):
        posted["event_type"] = event_type
        posted["payload"] = payload
        posted["source"] = source
        return {"status": "ok"}

    monkeypatch.setattr("homeops.agent._post_to_bus", mock_post)
    _post_voice_utterance("hello")
    assert posted["event_type"] == "voice.utterance"
    # payload should contain only "text": "hello" (no embedded source)
    assert posted["payload"] == {"text": "hello"}
    # source should be "agent-cli" for voice.utterance
    assert posted["source"] == "agent-cli"
    posted.clear()
    _post_agent_thought("a thought")
    assert posted["event_type"] == "agent.thought"
    # payload should contain only the text (no embedded source)
    assert posted["payload"] == {"text": "a thought"}
    # source should be "agent" for agent.thought
    assert posted["source"] == "agent"