#!/bin/sh
# Copilot Pixel Agents — universal hook (GitHub Copilot + Claude Code)
# GitHub Copilot: called via chat.hookFilesLocations hook files; data on stdin (camelCase JSON)
# Claude Code:    called via ~/.claude/settings.json hooks; data on stdin (snake_case JSON)

PORT_FILE="$HOME/.copilot-pixel-agents/port"
PORT=7823
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 7823)

if [ ! -t 0 ]; then
  INPUT=$(cat)
  # Claude Code fields (snake_case)
  EVENT=$(printf '%s' "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | cut -d'"' -f4)
  SESSION=$(printf '%s' "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
  # GitHub Copilot fields (camelCase) — try if snake_case fields empty
  [ -z "$SESSION" ] && SESSION=$(printf '%s' "$INPUT" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
  [ -z "$TOOL" ] && TOOL=$(printf '%s' "$INPUT" | grep -o '"toolName":"[^"]*"' | cut -d'"' -f4)
  TOOL_ID=$(printf '%s' "$INPUT" | grep -o '"tool_use_id":"[^"]*"' | cut -d'"' -f4)
  # Fallback to env vars set by hook config
  [ -z "$EVENT" ]   && EVENT="${HOOK_EVENT:-${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  [ -z "$SESSION" ] && SESSION="${COPILOT_SESSION_ID:-${SESSION_ID:-$$}}"
  [ -z "$TOOL" ]    && TOOL="${COPILOT_TOOL_NAME:-${TOOL_NAME:-}}"
  [ -z "$TOOL_ID" ] && TOOL_ID="${COPILOT_TOOL_ID:-${TOOL_ID:-$RANDOM}}"
else
  EVENT="${HOOK_EVENT:-${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  SESSION="${COPILOT_SESSION_ID:-${SESSION_ID:-$$}}"
  TOOL="${COPILOT_TOOL_NAME:-${TOOL_NAME:-}}"
  TOOL_ID="${COPILOT_TOOL_ID:-${TOOL_ID:-$RANDOM}}"
fi

# Normalize Claude Code PascalCase event names to snake_case
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

# GitHub Copilot hooks are fail-closed — must output allow decision
printf '{"permissionDecision":"allow"}\n'
exit 0
