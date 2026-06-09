import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** Generates the hook script content for a given platform and port */
export function buildHookScript(port: number, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `@echo off
:: Copilot Pixel Agents hook - sends events to the local visualization server
set PAYLOAD={"event":"%COPILOT_HOOK_EVENT%","session_id":"%COPILOT_SESSION_ID%","tool_name":"%COPILOT_TOOL_NAME%","tool_id":"%COPILOT_TOOL_ID%"}
curl -s -X POST http://127.0.0.1:${port} -H "Content-Type: application/json" -d "%PAYLOAD%" >nul 2>&1
exit /b 0
`;
  }
  return `#!/bin/sh
# Copilot Pixel Agents hook - sends events to the local visualization server
PAYLOAD=$(cat <<EOF
{
  "event": "\${COPILOT_HOOK_EVENT:-\${HOOK_EVENT:-unknown}}",
  "session_id": "\${COPILOT_SESSION_ID:-\${SESSION_ID:-\$\$}}",
  "tool_name": "\${COPILOT_TOOL_NAME:-\${TOOL_NAME:-}}",
  "tool_id": "\${COPILOT_TOOL_ID:-\${TOOL_ID:-\$RANDOM}}"
}
EOF
)
curl -s -X POST http://127.0.0.1:${port} \\
  -H "Content-Type: application/json" \\
  -d "\$PAYLOAD" >/dev/null 2>&1 || true
exit 0
`;
}

/** Generates the VS Code / Copilot agent-hooks.json config */
export function buildHooksConfig(scriptPath: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          command: scriptPath,
          env: { COPILOT_HOOK_EVENT: 'pre_tool_use' },
        },
      ],
      PostToolUse: [
        {
          command: scriptPath,
          env: { COPILOT_HOOK_EVENT: 'post_tool_use' },
        },
      ],
      Stop: [
        {
          command: scriptPath,
          env: { COPILOT_HOOK_EVENT: 'stop' },
        },
      ],
    },
  };
}

/** Installs hook script and config to ~/.copilot-pixel-agents/ and shows instructions */
export async function installHooks(port: number): Promise<void> {
  const installDir = path.join(os.homedir(), '.copilot-pixel-agents');
  fs.mkdirSync(installDir, { recursive: true });

  const isWin = process.platform === 'win32';
  const scriptName = isWin ? 'hook.cmd' : 'hook.sh';
  const scriptPath = path.join(installDir, scriptName);
  const configPath = path.join(installDir, 'agent-hooks.json');

  const script = buildHookScript(port, process.platform);
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o755 });

  const config = buildHooksConfig(scriptPath);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  const vsCodeHooksPath = path.join(os.homedir(), '.vscode', 'agent-hooks.json');
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  const message = [
    `Hook script installed at: ${scriptPath}`,
    ``,
    `To activate with GitHub Copilot Agent Mode:`,
    `  Copy ${configPath} to ${vsCodeHooksPath}`,
    `  (or merge the "hooks" key into your existing agent-hooks.json)`,
    ``,
    `To activate with Claude Code:`,
    `  Add the hooks from ${configPath} into ${claudeSettingsPath}`,
  ].join('\n');

  const action = await vscode.window.showInformationMessage(
    `Copilot Pixel Agents hooks installed.`,
    'Open Install Folder',
    'Copy to VS Code Hooks',
    'Dismiss',
  );

  if (action === 'Open Install Folder') {
    vscode.env.openExternal(vscode.Uri.file(installDir));
  } else if (action === 'Copy to VS Code Hooks') {
    await mergeVsCodeHooks(configPath, vsCodeHooksPath);
  }

  const doc = await vscode.workspace.openTextDocument({
    content: message,
    language: 'plaintext',
  });
  vscode.window.showTextDocument(doc);
}

async function mergeVsCodeHooks(sourcePath: string, targetPath: string): Promise<void> {
  try {
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    let target: Record<string, unknown> = { hooks: {} };

    if (fs.existsSync(targetPath)) {
      target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    }

    const targetHooks = (target.hooks ?? {}) as Record<string, unknown[]>;
    const sourceHooks = source.hooks as Record<string, unknown[]>;

    for (const [event, commands] of Object.entries(sourceHooks)) {
      targetHooks[event] = [...(targetHooks[event] ?? []), ...commands];
    }
    target.hooks = targetHooks;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(target, null, 2), 'utf8');
    vscode.window.showInformationMessage(`Hooks merged into ${targetPath}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to merge hooks: ${err}`);
  }
}
