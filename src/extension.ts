import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentStore } from './agentStore.js';
import { HooksServer } from './hooksServer.js';
import { installHooks } from './hooksInstaller.js';
import { PixelOfficeViewProvider } from './viewProvider.js';

const VIEW_ID = 'copilotPixelAgents.officeView';
const HOOKS_INSTALLED_KEY = 'hooksInstalled';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotPixelAgents');
  const configuredPort = config.get<number>('port', 7823);

  const channel = vscode.window.createOutputChannel('Copilot Pixel Agents');
  context.subscriptions.push(channel);

  const store = new AgentStore({ captureTaskDetails: config.get<boolean>('captureTaskDetails', false) });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('copilotPixelAgents.captureTaskDetails')) {
      store.setCaptureTaskDetails(vscode.workspace.getConfiguration('copilotPixelAgents').get<boolean>('captureTaskDetails', false));
    }
  }));
  const server = new HooksServer(store, channel, configuredPort);

  let port: number;
  try {
    port = await server.start();
    channel.appendLine(`Hooks server started on port ${port}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Copilot Pixel Agents: failed to start hooks server — ${err}`);
    return;
  }

  const provider = new PixelOfficeViewProvider(context, store, port);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotPixelAgents.showPanel', () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotPixelAgents.installHooks', () => {
      installHooks(port).then(() => {
        context.globalState.update(HOOKS_INSTALLED_KEY, true);
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotPixelAgents.showHooksConfig', async () => {
      const hookScript = path.join(os.homedir(), '.copilot-pixel-agents', 'hook.sh');
      const doc = await vscode.workspace.openTextDocument({
        content: [
          '// Copilot Pixel Agents — hook locations',
          `// Hook script:  ${hookScript}`,
          `// VS Code:      ${path.join(os.homedir(), '.vscode', 'agent-hooks.json')}`,
          `// Claude Code:  ${path.join(os.homedir(), '.claude', 'settings.json')}`,
        ].join('\n'),
        language: 'jsonc',
      });
      vscode.window.showTextDocument(doc);
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      server.stop();
      store.dispose();
    },
  });

  // Prompt to install hooks on first activation
  const alreadyInstalled = context.globalState.get<boolean>(HOOKS_INSTALLED_KEY, false);
  if (!alreadyInstalled && !hooksAlreadyPresent()) {
    const action = await vscode.window.showInformationMessage(
      '🎮 Copilot Pixel Agents is ready! Install hooks to start visualizing your agents.',
      'Install Hooks (automatic)',
      'Later',
    );
    if (action === 'Install Hooks (automatic)') {
      await installHooks(port);
      context.globalState.update(HOOKS_INSTALLED_KEY, true);
    }
  }

  if (config.get<boolean>('autoShowPanel', false)) {
    vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  console.log(`[Copilot Pixel Agents] Activated. Hooks server on port ${port}.`);
}

export function deactivate(): void {}

/** Quick check: are our hooks already written on disk? */
function hooksAlreadyPresent(): boolean {
  const hookScript = path.join(os.homedir(), '.copilot-pixel-agents', 'hook.sh');
  if (!fs.existsSync(hookScript)) return false;

  // Also check at least one target config references it
  const vsCodeHooks = path.join(os.homedir(), '.vscode', 'agent-hooks.json');
  const claudeSettings = path.join(os.homedir(), '.claude', 'settings.json');
  for (const f of [vsCodeHooks, claudeSettings]) {
    try {
      if (fs.readFileSync(f, 'utf8').includes(hookScript)) return true;
    } catch { /* file doesn't exist */ }
  }
  return false;
}
