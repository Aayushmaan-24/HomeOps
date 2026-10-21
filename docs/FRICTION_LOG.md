# Friction log

Format: task, steps, expected vs actual, severity, workaround, suggestion.

## 1. FastMCP and Strands Agents cannot share an environment
- **Task:** run our FastMCP server and our Strands agent from one Python environment.
- **Steps:** `pip install fastmcp strands-agents`, then start the server and the agent.
- **Expected:** compatible dependency ranges.
- **Actual:** strands-agents 1.61.1 requires `mcp<2.2`; fastmcp 4.1.1 needs `mcp` 2.x (it imports `mcp.server.request_state`, missing in 1.30). With `mcp` 2.1.1 the import failed with `cannot import name 'SSEError' from 'httpx'` while `pip check` reported no broken requirements. `mcp` 2.3.0 fixed the import but violates Strands' range.
- **Severity:** high (cost hours).
- **Workaround:** two virtual environments, talking over HTTP (MCP server in one, agent in the other).
- **Suggestion:** align or widen the `mcp` ranges, and make the dependency conflict visible to `pip check`.

## 2. Strands MCP tools fail after the client context exits
- **Task:** build the agent from the MCP tool list and call it later.
- **Actual:** the model chose a tool and the call failed with "the client session is not running".
- **Severity:** medium. The error message and docs link were helpful once found.
- **Workaround:** create and call the Agent inside the `with MCPClient(...)` block.
- **Suggestion:** show this pattern prominently in the quickstart, since returning an agent from a helper is a natural thing to do.

## 3. Hard to see which MCP spec version an installed FastMCP speaks
- **Task:** confirm our server meets spec 2025-11-25 for the hackathon.
- **Actual:** no obvious command or doc; we verified by sending `initialize` with `protocolVersion` 2025-11-25 and reading the negotiated version back.
- **Severity:** low.
- **Suggestion:** expose supported spec versions in `fastmcp --version` output or the docs.

## 4. Gemini free tier quota is too small for agent development
- **Task:** iterate on an agent with tool calls.
- **Actual:** 20 requests per day per model on the free tier (gemini-2.5-flash and gemini-2.5-flash-lite); one agent run uses 3 to 5 requests, so the quota ran out within a handful of tests.
- **Severity:** high for hackathon timelines.
- **Workaround:** Groq via the OpenAI-compatible interface (`openai/gpt-oss-120b`).
- **Suggestion:** a larger free allowance for hackathon participants.

## 5. Groq model availability changed without notice
- **Task:** use `llama-3.3-70b-versatile` through Groq.
- **Actual:** HTTP 404 `model_not_found`; we had to list models through the `/models` endpoint to find a tool-capable one.
- **Severity:** low to medium.
- **Suggestion:** a clear list of tool-calling-capable free models and deprecation notes.

## 6. Strands + OpenAI-compatible reasoning models: warning on every tool turn
- **Actual:** `reasoningContent is not supported in multi-turn conversations with the Chat Completions API` logged on each turn. Behavior was correct.
- **Severity:** low.
