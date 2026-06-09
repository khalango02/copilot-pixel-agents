#!/bin/sh
# Copilot Pixel Agents — hook script
# Sends agent events to the local visualization server.
#
# Compatible with:
#   - GitHub Copilot Agent Mode (VS Code Agent Hooks)
#   - Claude Code (hooks.json)
#
# Environment variables (set by the agent runtime):
#   HOOK_EVENT / COPILOT_HOOK_EVENT  — event name (pre_tool_use, post_tool_use, stop, …)
#   SESSION_ID / COPILOT_SESSION_ID  — unique session identifier
#   TOOL_NAME  / COPILOT_TOOL_NAME   — tool being invoked
#   TOOL_ID    / COPILOT_TOOL_ID     — unique tool invocation id
#
# The server port is written to ~/.copilot-pixel-agents/port when the extension starts.

PORT_FILE="$HOME/.copilot-pixel-agents/port"
PORT=7823
if [ -f "$PORT_FILE" ]; then
  PORT=$(cat "$PORT_FILE")
fi

EVENT="${HOOK_EVENT:-${COPILOT_HOOK_EVENT:-unknown}}"
SESSION="${SESSION_ID:-${COPILOT_SESSION_ID:-$$}}"
TOOL_NAME="${TOOL_NAME:-${COPILOT_TOOL_NAME:-}}"
TOOL_ID="${TOOL_ID:-${COPILOT_TOOL_ID:-$RANDOM}}"

# Map Claude Code hook names → our event names
case "$EVENT" in
  PreToolUse)   EVENT="pre_tool_use" ;;
  PostToolUse)  EVENT="post_tool_use" ;;
  PostToolUseFailure) EVENT="post_tool_use" ;;
  Stop)         EVENT="stop" ;;
  SessionStart) EVENT="session_start" ;;
  SessionEnd)   EVENT="session_end" ;;
  UserPromptSubmit) EVENT="waiting" ;;
esac

PAYLOAD="{\"event\":\"$EVENT\",\"session_id\":\"$SESSION\",\"tool_name\":\"$TOOL_NAME\",\"tool_id\":\"$TOOL_ID\"}"

curl -s -X POST "http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null 2>&1 || true

exit 0
