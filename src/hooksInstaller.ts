import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// ─── Hook script content ──────────────────────────────────────────────────────

export function buildHookScript(port: number, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `@echo off
:: Copilot Pixel Agents hook
set /p INPUT=
set PAYLOAD={"event":"%HOOK_EVENT%","session_id":"%COPILOT_SESSION_ID%","tool_name":"%COPILOT_TOOL_NAME%","tool_id":"%COPILOT_TOOL_ID%"}
curl -s -X POST http://127.0.0.1:${port} -H "Content-Type: application/json" -d "%PAYLOAD%" >nul 2>&1
echo {"permissionDecision":"allow"}
exit /b 0
`;
  }

  return `#!/bin/sh
# Copilot Pixel Agents — universal hook v0.4.9 (GitHub Copilot + Claude Code)
PORT_FILE="$HOME/.copilot-pixel-agents/port"
PORT=${port}
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null || echo ${port})
LOG="$HOME/.copilot-pixel-agents/hook-debug.log"

# ── Diagnostic logging (always on — helps diagnose payload format issues) ─────
{
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') PID=$$ ARGS=$* ==="
  echo "STDIN_TTY=$([ -t 0 ] && echo YES || echo NO)"
  echo "PY3=$(command -v python3 2>/dev/null || echo MISSING)"
  env | grep -i -E '^(hook|copilot|session|tool|workspace|github)' | sort
} >> "$LOG" 2>&1

# ── Read input: stdin first, then $1 (some versions pass JSON as first arg) ───
INPUT=""
if [ ! -t 0 ]; then
  INPUT=$(cat)
fi
# Fallback: check if first argument looks like JSON
if [ -z "$INPUT" ] && [ -n "$1" ]; then
  case "$1" in
    '{'*) INPUT="$1" ;;
  esac
fi

echo "STDIN_LEN=\${#INPUT} STDIN=$INPUT" >> "$LOG" 2>&1

# ── Parse JSON ─────────────────────────────────────────────────────────────────
EVENT="" SESSION="" TOOL="" TOOL_ID=""

parse_json() {
  printf '%s' "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ev = d.get('hookEventName') or d.get('hook_event_name') or ''
    se = d.get('sessionId') or d.get('session_id') or ''
    to = d.get('toolName') or d.get('tool_name') or ''
    ti = d.get('toolCallId') or d.get('tool_use_id') or d.get('toolId') or ''
    print(ev + '|' + se + '|' + to + '|' + ti)
    print('K:' + ','.join(d.keys()), file=sys.stderr)
except Exception as e:
    print('|||')
    print('E:' + str(e), file=sys.stderr)
" 2>>"$LOG"
}

if [ -n "$INPUT" ] && command -v python3 >/dev/null 2>&1; then
  PARSED=$(parse_json "$INPUT" || echo "|||")
  EVENT=$(printf '%s' "$PARSED" | cut -d'|' -f1)
  SESSION=$(printf '%s' "$PARSED" | cut -d'|' -f2)
  TOOL=$(printf '%s' "$PARSED" | cut -d'|' -f3)
  TOOL_ID=$(printf '%s' "$PARSED" | cut -d'|' -f4)
fi

# ── Fallback to env vars ───────────────────────────────────────────────────────
[ -z "$EVENT" ]    && EVENT="\${HOOK_EVENT:-\${COPILOT_HOOK_EVENT:-\${hook_event_name:-pre_tool_use}}}"
[ -z "$SESSION" ]  && SESSION="\${sessionId:-\${COPILOT_SESSION_ID:-\${session_id:-$$}}}"
[ -z "$TOOL" ]     && TOOL="\${toolName:-\${COPILOT_TOOL_NAME:-\${tool_name:-}}}"
[ -z "$TOOL_ID" ]  && TOOL_ID="\${toolCallId:-\${COPILOT_TOOL_ID:-\${tool_use_id:-$RANDOM}}}"

echo "PARSED: event=$EVENT session=$SESSION tool=$TOOL tool_id=$TOOL_ID" >> "$LOG" 2>&1

# ── Normalize event names ─────────────────────────────────────────────────────
case "$EVENT" in
  PreToolUse|preToolUse)                EVENT="pre_tool_use" ;;
  PostToolUse|postToolUse)              EVENT="post_tool_use" ;;
  PostToolUseFailure)                   EVENT="post_tool_use" ;;
  Stop|agentStop)                       EVENT="stop" ;;
  SessionStart|sessionStart)            EVENT="session_start" ;;
  SessionEnd|sessionEnd)                EVENT="session_end" ;;
  UserPromptSubmit|userPromptSubmitted) EVENT="waiting" ;;
  SubagentStart|subagentStart)          EVENT="session_start" ;;
  SubagentStop|subagentStop)            EVENT="stop" ;;
esac

PAYLOAD="{\\"event\\":\\"$EVENT\\",\\"session_id\\":\\"$SESSION\\",\\"tool_name\\":\\"$TOOL\\",\\"tool_id\\":\\"$TOOL_ID\\"}"
curl -s -X POST "http://127.0.0.1:$PORT" -H "Content-Type: application/json" -d "$PAYLOAD" >/dev/null 2>&1 || true

# GitHub Copilot hooks are fail-closed — must output allow decision to stdout
printf '{"permissionDecision":"allow"}\\n'
exit 0
`;
}

// ─── Config builders ──────────────────────────────────────────────────────────

/**
 * Builds the content for hooks.json — the format VS Code actually parses.
 * Each directory in chat.hookFilesLocations is scanned for *.json files.
 * Each file must have {"hooks": {"EventName": [{command: "..."}]}} structure.
 * See: https://code.visualstudio.com/docs/agent-customization/hooks
 */
function buildCopilotHooksJson(scriptPath: string): object {
  return {
    hooks: {
      PreToolUse:   [{ command: scriptPath }],
      PostToolUse:  [{ command: scriptPath }],
      Stop:         [{ command: scriptPath }],
      SessionStart: [{ command: scriptPath }],
    },
  };
}

/** Claude Code ~/.claude/settings.json hooks format */
function buildClaudeHooks(scriptPath: string): Record<string, unknown[]> {
  return {
    PreToolUse:  [{ matcher: '', hooks: [{ type: 'command', command: scriptPath }] }],
    PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: scriptPath }] }],
    Stop:        [{ matcher: '', hooks: [{ type: 'command', command: scriptPath }] }],
  };
}

// ─── Main installer ───────────────────────────────────────────────────────────

export async function installHooks(port: number): Promise<void> {
  const installDir = path.join(os.homedir(), '.copilot-pixel-agents');
  fs.mkdirSync(installDir, { recursive: true });

  const isWin = process.platform === 'win32';
  const scriptName = isWin ? 'hook.cmd' : 'hook.sh';
  const scriptPath = path.join(installDir, scriptName);

  // 1. Write hook script
  fs.writeFileSync(scriptPath, buildHookScript(port, process.platform), {
    encoding: 'utf8',
    mode: 0o755,
  });

  const results: string[] = [];
  const errors: string[] = [];

  // 2. GitHub Copilot — write hook definition files + register via VS Code setting
  try {
    await installCopilotHooks(scriptPath);
    results.push('GitHub Copilot');
  } catch (err) {
    errors.push(`Copilot: ${err}`);
  }

  // 3. Claude Code — merge into ~/.claude/settings.json
  try {
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    mergeClaudeSettings(claudeSettingsPath, buildClaudeHooks(scriptPath), scriptPath);
    results.push('Claude Code');
  } catch (err) {
    errors.push(`Claude Code: ${err}`);
  }

  // 4. Report
  if (results.length > 0) {
    const action = await vscode.window.showInformationMessage(
      `✅ Pixel Agents hooks installed for: ${results.join(' + ')}`,
      'Open Hook Folder',
      'Dismiss',
    );
    if (action === 'Open Hook Folder') {
      vscode.env.openExternal(vscode.Uri.file(installDir));
    }
  }

  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      `Pixel Agents: some hooks could not be configured — ${errors.join('; ')}`,
    );
  }
}

// ─── Copilot hooks installer ──────────────────────────────────────────────────

/**
 * Writes a single hooks.json to two directories:
 *   1. ~/.copilot/hooks/  — VS Code's built-in user-level hooks scan directory
 *   2. ~/.copilot-pixel-agents/copilot-hooks/  — custom dir registered via chat.hookFilesLocations
 *
 * VS Code scans *.json files in each directory. Each file must have format:
 *   {"hooks": {"PreToolUse": [{command: "..."}], ...}}
 * VS Code sends hookEventName (camelCase) in stdin JSON when invoking the script.
 * Hooks are fail-closed: script must output {"permissionDecision":"allow"} to stdout.
 */
async function installCopilotHooks(scriptPath: string): Promise<void> {
  // Write to ~/.copilot/hooks/ — VS Code scans this by default (no setting needed)
  const stdDir = path.join(os.homedir(), '.copilot', 'hooks');
  writeCopilotHooksJson(stdDir, scriptPath);

  // Write to our custom dir and register it via VS Code setting (belt-and-suspenders)
  const customDir = path.join(os.homedir(), '.copilot-pixel-agents', 'copilot-hooks');
  writeCopilotHooksJson(customDir, scriptPath);

  // Update chat.hookFilesLocations — must be object {path: boolean}, NOT an array
  try {
    const vsConfig = vscode.workspace.getConfiguration();
    const raw = vsConfig.get('chat.hookFilesLocations');
    const existing: Record<string, boolean> =
      (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? (raw as Record<string, boolean>)
        : {};
    if (!(customDir in existing)) {
      await vsConfig.update(
        'chat.hookFilesLocations',
        { ...existing, [customDir]: true },
        vscode.ConfigurationTarget.Global,
      );
    }
  } catch {
    // Setting does not exist in this VS Code version — ~/.copilot/hooks/ is the fallback
  }
}

function writeCopilotHooksJson(dir: string, scriptPath: string): void {
  fs.mkdirSync(dir, { recursive: true });

  // Remove stale per-event files from old format (pre-tool-use.json etc.)
  for (const stale of ['pre-tool-use.json', 'post-tool-use.json', 'stop.json']) {
    const staleFile = path.join(dir, stale);
    if (fs.existsSync(staleFile)) {
      try { fs.unlinkSync(staleFile); } catch { /* ignore */ }
    }
  }

  const filePath = path.join(dir, 'hooks.json');
  if (fs.existsSync(filePath)) {
    try { if (fs.readFileSync(filePath, 'utf8').includes(scriptPath)) return; } catch { /* overwrite */ }
  }
  fs.writeFileSync(filePath, JSON.stringify(buildCopilotHooksJson(scriptPath), null, 2) + '\n', 'utf8');
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Merges Claude Code hooks into ~/.claude/settings.json.
 * Skips events already referencing scriptPath (idempotent).
 */
function mergeClaudeSettings(
  settingsPath: string,
  hooksByEvent: Record<string, unknown[]>,
  scriptPath: string,
): void {
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* overwrite */ }
  }

  const hooksSection = (settings['hooks'] ?? {}) as Record<string, unknown[]>;

  for (const [event, newEntries] of Object.entries(hooksByEvent)) {
    const current = hooksSection[event] ?? [];
    const alreadyInstalled = current.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const hooks = ((entry as Record<string, unknown>)['hooks'] ?? []) as unknown[];
      return hooks.some(
        (h) =>
          typeof h === 'object' && h !== null && 'command' in h &&
          (h as Record<string, unknown>)['command'] === scriptPath,
      );
    });
    if (!alreadyInstalled) {
      hooksSection[event] = [...current, ...newEntries];
    }
  }

  settings['hooks'] = hooksSection;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
