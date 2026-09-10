import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import * as vscode from 'vscode';
import { buildHookScript, buildHookPsScript } from './hookScripts.js';
import { buildCopilotHooksJson, buildClaudeHooks, mergeHookConfig } from './hooksConfig.js';

export { buildHookScript, buildHookPsScript } from './hookScripts.js';

/** Only this explicit install command writes hooks; upgrades require reinstalling. */
export async function installHooks(port: number): Promise<void> {
  const installDir = path.join(os.homedir(), '.copilot-pixel-agents');
  fs.mkdirSync(installDir, { recursive: true });
  const isWin = process.platform === 'win32';
  const scriptPath = path.join(installDir, isWin ? 'hook.cmd' : 'hook.sh');
  fs.writeFileSync(scriptPath, buildHookScript(port, process.platform), { encoding: 'utf8', mode: 0o755 });
  if (isWin) fs.writeFileSync(path.join(installDir, 'hook.ps1'), buildHookPsScript(), 'utf8');

  const results: string[] = [];
  const errors: string[] = [];
  try {
    await installCopilotHooks(scriptPath);
    results.push('GitHub Copilot');
  } catch (err) { errors.push(`Copilot: ${err}`); }
  try {
    writeMergedConfig(path.join(os.homedir(), '.claude', 'settings.json'), buildClaudeHooks(scriptPath), scriptPath, 'claude');
    results.push('Claude Code');
  } catch (err) { errors.push(`Claude Code: ${err}`); }

  if (results.length > 0) {
    const action = await vscode.window.showInformationMessage(
      `✅ Pixel Agents hooks installed for: ${results.join(' + ')}`,
      'Open Hook Folder', 'Dismiss',
    );
    if (action === 'Open Hook Folder') vscode.env.openExternal(vscode.Uri.file(installDir));
  }
  if (errors.length > 0) vscode.window.showWarningMessage(`Pixel Agents: some hooks could not be configured — ${errors.join('; ')}`);
}

async function installCopilotHooks(scriptPath: string): Promise<void> {
  const customDir = path.join(os.homedir(), '.copilot-pixel-agents', 'copilot-hooks');
  for (const dir of [path.join(os.homedir(), '.copilot', 'hooks'), customDir]) {
    writeMergedConfig(path.join(dir, 'hooks.json'), buildCopilotHooksJson(scriptPath).hooks, scriptPath, 'copilot');
    // Do not delete legacy per-event files: they may contain unrelated hooks.
  }
  try {
    const config = vscode.workspace.getConfiguration();
    const raw = config.get('chat.hookFilesLocations');
    const existing = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, boolean> : {};
    if (!(customDir in existing)) {
      await config.update('chat.hookFilesLocations', { ...existing, [customDir]: true }, vscode.ConfigurationTarget.Global);
    }
  } catch { /* Older VS Code versions use the default hook scan directory. */ }
}

function writeMergedConfig(filePath: string, hooks: Record<string, unknown[]>, scriptPath: string, format: 'copilot' | 'claude'): void {
  // Invalid existing JSON is an install error, not permission to overwrite user configuration.
  const current: unknown = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  const merged = mergeHookConfig(current, hooks, scriptPath, format);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
