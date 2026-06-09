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
for /f "tokens=*" %%i in ('echo %INPUT% ^| findstr /r "hook_event_name"') do set LINE=%%i
set PAYLOAD={"event":"%COPILOT_HOOK_EVENT%","session_id":"%COPILOT_SESSION_ID%","tool_name":"%COPILOT_TOOL_NAME%","tool_id":"%COPILOT_TOOL_ID%"}
curl -s -X POST http://127.0.0.1:${port} -H "Content-Type: application/json" -d "%PAYLOAD%" >nul 2>&1
exit /b 0
`;
  }

  return `#!/bin/sh
# Copilot Pixel Agents — universal hook (GitHub Copilot + Claude Code)
PORT_FILE="$HOME/.copilot-pixel-agents/port"
PORT=${port}
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null || echo ${port})

if [ ! -t 0 ]; then
  INPUT=$(cat)
  EVENT=$(printf '%s' "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | cut -d'"' -f4)
  SESSION=$(printf '%s' "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)
  TOOL_ID=$(printf '%s' "$INPUT" | grep -o '"tool_use_id":"[^"]*"' | cut -d'"' -f4)
  [ -z "$EVENT" ]   && EVENT="\${HOOK_EVENT:-\${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  [ -z "$SESSION" ] && SESSION="\${SESSION_ID:-\${COPILOT_SESSION_ID:-$$}}"
  [ -z "$TOOL" ]    && TOOL="\${TOOL_NAME:-\${COPILOT_TOOL_NAME:-}}"
  [ -z "$TOOL_ID" ] && TOOL_ID="\${TOOL_ID:-\${COPILOT_TOOL_ID:-$RANDOM}}"
else
  EVENT="\${HOOK_EVENT:-\${COPILOT_HOOK_EVENT:-pre_tool_use}}"
  SESSION="\${SESSION_ID:-\${COPILOT_SESSION_ID:-$$}}"
  TOOL="\${TOOL_NAME:-\${COPILOT_TOOL_NAME:-}}"
  TOOL_ID="\${TOOL_ID:-\${COPILOT_TOOL_ID:-$RANDOM}}"
fi

case "$EVENT" in
  PreToolUse)         EVENT="pre_tool_use" ;;
  PostToolUse)        EVENT="post_tool_use" ;;
  PostToolUseFailure) EVENT="post_tool_use" ;;
  Stop)               EVENT="stop" ;;
  SessionStart)       EVENT="session_start" ;;
  SessionEnd)         EVENT="session_end" ;;
  UserPromptSubmit)   EVENT="waiting" ;;
esac

PAYLOAD="{\\"event\\":\\"$EVENT\\",\\"session_id\\":\\"$SESSION\\",\\"tool_name\\":\\"$TOOL\\",\\"tool_id\\":\\"$TOOL_ID\\"}"
curl -s -X POST "http://127.0.0.1:$PORT" -H "Content-Type: application/json" -d "$PAYLOAD" >/dev/null 2>&1 || true
exit 0
`;
}

// ─── Config builders ──────────────────────────────────────────────────────────

/** GitHub Copilot / VS Code agent-hooks.json format */
function buildCopilotHooksConfig(scriptPath: string): Record<string, unknown> {
  const entry = (event: string) => ({ command: scriptPath, env: { COPILOT_HOOK_EVENT: event } });
  return {
    hooks: {
      PreToolUse:  [entry('pre_tool_use')],
      PostToolUse: [entry('post_tool_use')],
      Stop:        [entry('stop')],
    },
  };
}

/** Claude Code ~/.claude/settings.json hooks format */
function buildClaudeHooks(scriptPath: string): Record<string, unknown[]> {
  const entry = (event: string) => ({
    matcher: '',
    hooks: [{ type: 'command', command: `${scriptPath} ${event}` }],
  });
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

  // 2. Auto-configure GitHub Copilot (VS Code agent-hooks.json)
  try {
    const vsCodeHooksPath = path.join(os.homedir(), '.vscode', 'agent-hooks.json');
    mergeJsonFile(vsCodeHooksPath, buildCopilotHooksConfig(scriptPath), 'hooks', scriptPath);
    results.push('GitHub Copilot (agent-hooks.json)');
  } catch (err) {
    errors.push(`Copilot: ${err}`);
  }

  // 3. Auto-configure Claude Code (~/.claude/settings.json)
  try {
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    mergeClaudeSettings(claudeSettingsPath, buildClaudeHooks(scriptPath), scriptPath);
    results.push('Claude Code (settings.json)');
  } catch (err) {
    errors.push(`Claude Code: ${err}`);
  }

  // 4. Report
  if (results.length > 0) {
    const configured = results.join(' + ');
    const action = await vscode.window.showInformationMessage(
      `✅ Pixel Agents hooks installed for: ${configured}`,
      'Open Hook Folder',
      'Dismiss',
    );
    if (action === 'Open Hook Folder') {
      vscode.env.openExternal(vscode.Uri.file(installDir));
    }
  }

  if (errors.length > 0) {
    vscode.window.showWarningMessage(
      `Pixel Agents: some hooks could not be auto-configured — ${errors.join('; ')}`,
    );
  }
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Merges the "hooks" key from newConfig into targetPath JSON file.
 * Skips entries that already reference scriptPath (idempotent).
 */
function mergeJsonFile(
  targetPath: string,
  newConfig: Record<string, unknown>,
  key: string,
  scriptPath: string,
): void {
  let target: Record<string, unknown> = {};
  if (fs.existsSync(targetPath)) {
    try { target = JSON.parse(fs.readFileSync(targetPath, 'utf8')); } catch { /* corrupt — overwrite */ }
  }

  const existing = (target[key] ?? {}) as Record<string, unknown[]>;
  const incoming = (newConfig[key] ?? {}) as Record<string, unknown[]>;

  for (const [event, entries] of Object.entries(incoming)) {
    const current = existing[event] ?? [];
    const alreadyInstalled = current.some(
      (e) => typeof e === 'object' && e !== null && 'command' in e &&
        (e as Record<string, unknown>)['command'] === scriptPath,
    );
    if (!alreadyInstalled) {
      existing[event] = [...current, ...entries];
    }
  }
  target[key] = existing;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + '\n', 'utf8');
}

/**
 * Merges Claude Code hooks into ~/.claude/settings.json.
 * Skips events that already have an entry referencing scriptPath.
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
