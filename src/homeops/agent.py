"""homeops agent: Strands Agents SDK agent wired to the homeops MCP server and event bus."""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Dict, List, Optional

import dotenv
from mcp.client.streamable_http import streamable_http_client
from strands.tools.mcp import MCPClient

from homeops.busclient import _post_to_bus
from homeops.events import EventType as HomeEventType

logger = logging.getLogger(__name__)

# Suppress the noisy Strands SDK warning about reasoningContent.
# Groq's gpt-oss models return reasoningContent, but the Chat Completions API
# doesn't support it in multi-turn messages. The SDK already filters it out;
# this warning is harmless and clutters the console.
logging.getLogger("strands.models.openai").setLevel(logging.ERROR)

dotenv.load_dotenv()

LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY")
MCP_URL: str = os.getenv("MCP_URL", "http://127.0.0.1:8001/mcp")

SYSTEM_PROMPT = """You are HOME OPS, the brain of a simulated smart home. Modes are normal and security.
You act only by calling tools. Never claim to have done something you did not call a tool for.

Explain your reasoning in one or two sentences before acting, and mention the facts you are
relying on (current mode, who is at the door, time of day).

Rules:
- User is leaving: call arm_security for front_door, back_door and garage, then speak one short confirmation.
- User is home: call disarm_security, then speak a short welcome.
- Doorbell or motion events arrive with context: who (friend, delivery, unknown, or missing),
  when (day or night), and the current mode. Decide like this:
  * friend: speak one short line announcing the friend at the door, and call notify with severity "info".
  * delivery: call notify with severity "info" (package at the front door) and speak one short line.
    Do not change the mode.
  * unknown (or who is missing) during the day while mode is normal: call notify with severity "warning"
    and speak one short line. Do not change the mode.
  * unknown (or who is missing) at night, or at any time while mode is security: call notify with
    severity "critical". If the mode is normal, also call arm_security for front_door, back_door and garage.
    Then speak one short warning.
- The event includes what the camera saw (computer vision). Mention it in your reasoning. If the camera shows a person but who is delivery, or shows no person for a friend or unknown visitor, say the camera and the report disagree and treat it as unknown.
- Do not call set_mode when arm_security or disarm_security already covers it.
- When the user talks to you directly, always answer by calling speak with one short sentence.
- Never ask the user questions. Mode, time of day and camera are given in the context; use them. If the user states the time of day, use theirs.
- If the user reports a stranger, intruder or unknown person at the door, treat it as an unknown visitor and apply the unknown rules.
- If the user asks who is at the door, answer from the camera context in one sentence, or say nothing has been seen recently.
- Call speak exactly once per request, as your last tool call. Use at most one notify.
"""


# ---------------------------------------------------------------------------
# Groq stub (to be filled in later)
# ---------------------------------------------------------------------------

def _get_groq_model() -> Any:
    """Groq via its OpenAI-compatible endpoint (free tier)."""
    from strands.models.openai import OpenAIModel

    return OpenAIModel(
        client_args={
            "api_key": os.getenv("GROQ_API_KEY"),
            "base_url": "https://api.groq.com/openai/v1",
        },
        model_id=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        params={"temperature": 0.1},
    )


# ---------------------------------------------------------------------------
# Bus helpers
# ---------------------------------------------------------------------------

def _post_voice_utterance(text: str) -> None:
    """Post a voice.utterance event (top-level source = agent-cli)."""
    try:
        _post_to_bus(HomeEventType.voice_utterance, {"text": text}, source="agent-cli")
    except Exception as exc:
        logger.debug("Bus post failed (ignored): %s", exc)


def _post_agent_thought(text: str) -> None:
    """Post an agent.thought event (top-level source = agent), reasoning text only."""
    lines = [
        ln for ln in text.splitlines()
        if not ln.strip().lower().startswith(("calling tool", "tool #", "tool call"))
    ]
    cleaned = "\n".join(lines).strip()
    if not cleaned:
        return
    try:
        _post_to_bus(HomeEventType.agent_thought, {"text": cleaned}, source="agent")
    except Exception as exc:
        logger.debug("Bus post failed (ignored): %s", exc)


class _ThoughtStreamer:
    """Strands callback handler: one agent.thought per reasoning step, not per token."""

    def __init__(self) -> None:
        self.buf: List[str] = []
        self.seen_tools: set = set()
        self.posted = 0

    def flush(self) -> None:
        text = "".join(self.buf).strip()
        self.buf = []
        if text:
            _post_agent_thought(text)
            self.posted += 1

    def __call__(self, **kwargs: Any) -> None:
        data = kwargs.get("data")
        if data:
            self.buf.append(data)
        tool = kwargs.get("current_tool_use")
        if tool and tool.get("name") and tool.get("toolUseId") not in self.seen_tools:
            self.seen_tools.add(tool.get("toolUseId"))
            self.flush()
            print(f"-> tool: {tool['name']}")


# ---------------------------------------------------------------------------
# Agent run
# ---------------------------------------------------------------------------

def run(user_text: str) -> str:
    """Run the agent on user_text. Tools come only from the MCP server.

    The agent is created AND called inside the open MCP client context,
    because tool calls need the connection to still be running.
    """
    client = MCPClient(lambda: streamable_http_client(MCP_URL))
    with client:
        tools = client.list_tools_sync()
        if not tools:
            raise RuntimeError(
                "No MCP tools available. Ensure the MCP server (homeops-mcp) "
                f"is running on {MCP_URL} and advertising tools."
            )
        print(f"MCP tools loaded: {[t.tool_name for t in tools]}")

        streamer = _ThoughtStreamer()
        agent_kwargs: Dict[str, Any] = {
            "system_prompt": SYSTEM_PROMPT,
            "tools": tools,
            "callback_handler": streamer,
        }

        if LLM_PROVIDER == "gemini":
            from strands.models.gemini import GeminiModel

            agent_kwargs["model"] = GeminiModel(model_id=GEMINI_MODEL)
        elif LLM_PROVIDER == "groq":
            agent_kwargs["model"] = _get_groq_model()

        from strands import Agent

        agent = Agent(**agent_kwargs)

        _post_voice_utterance(user_text)
        try:
            result = agent(user_text)
            result_str = str(result).strip()
        except Exception as exc:
            logger.error("Agent run failed: %s", exc)
            result_str = f"agent error: {exc}"

        streamer.flush()
        if streamer.posted == 0 and result_str:
            _post_agent_thought(result_str)

    return result_str


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def __main__() -> None:
    """CLI entry point: python -m homeops.agent "I'm leaving"."""
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print('Usage: python -m homeops.agent "<text>"')
        sys.exit(1)

    user_text = " ".join(sys.argv[1:])
    try:
        result = run(user_text)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    print(result)


if __name__ == "__main__":
    __main__()