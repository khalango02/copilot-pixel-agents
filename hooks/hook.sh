#!/bin/sh
# Copilot Pixel Agents — universal hook script
# Works with GitHub Copilot Agent Mode (env vars) AND Claude Code (stdin JSON).

PORT_FILE="$HOME/.copilot-pixel-agents/port"
PORT=7823
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 7823)

# Claude Code sends a JSON object on stdin; Copilot uses env vars.
# Detect: if stdin is NOT a terminal, we have stdin data.
if [ ! -t 0 ]; then
  INPUT=$(cat)
  # Parse fields with grep/cut — no python/jq dependency
  EVENT=$(printf '%s' "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | cut -d'"' -f4)
  SESSION=$(printf '%s' "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
  TOOL_ID=$(printf '%s' "$INPUT" | grep -o '"tool_use_id":"[^"]*"' | cut -d'"' -f4)
  [ -z "$EVENT" ]   && EVENT="${HOOK_EVENT:-${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  [ -z "$SESSION" ] && SESSION="${SESSION_ID:-${COPILOT_SESSION_ID:-$$}}"
  [ -z "$TOOL" ]    && TOOL="${TOOL_NAME:-${COPILOT_TOOL_NAME:-}}"
  [ -z "$TOOL_ID" ] && TOOL_ID="${TOOL_ID:-${COPILOT_TOOL_ID:-$RANDOM}}"
else
  EVENT="${HOOK_EVENT:-${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  SESSION="${SESSION_ID:-${COPILOT_SESSION_ID:-$$}}"
  TOOL="${TOOL_NAME:-${COPILOT_TOOL_NAME:-}}"
  TOOL_ID="${TOOL_ID:-${COPILOT_TOOL_ID:-$RANDOM}}"
fi

# Normalise Claude Code PascalCase event names
case "$EVENT" in
  PreToolUse)          EVENT="pre_tool_use" ;;
  PostToolUse)         EVENT="post_tool_use" ;;
  PostToolUseFailure)  EVENT="post_tool_use" ;;
  Stop)                EVENT="stop" ;;
  SessionStart)        EVENT="session_start" ;;
  SessionEnd)          EVENT="session_end" ;;
  UserPromptSubmit)    EVENT="waiting" ;;
esac

PAYLOAD="{\"event\":\"$EVENT\",\"session_id\":\"$SESSION\",\"tool_name\":\"$TOOL\",\"tool_id\":\"$TOOL_ID\"}"

curl -s -X POST "http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" >/dev/null 2>&1 || true

exit 0
