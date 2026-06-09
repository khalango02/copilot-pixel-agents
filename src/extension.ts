import * as vscode from 'vscode';
import { AgentStore } from './agentStore.js';
import { HooksServer } from './hooksServer.js';
import { installHooks } from './hooksInstaller.js';
import { PixelOfficeViewProvider } from './viewProvider.js';

const VIEW_ID = 'copilotPixelAgents.officeView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotPixelAgents');
  const configuredPort = config.get<number>('port', 7823);

  const store = new AgentStore();
  const server = new HooksServer(store, configuredPort);

  let port: number;
  try {
    port = await server.start();
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
      installHooks(port);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotPixelAgents.showHooksConfig', async () => {
      const { buildHooksConfig } = await import('./hooksInstaller.js');
      const config = buildHooksConfig(`~/.copilot-pixel-agents/hook.sh`);
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(config, null, 2),
        language: 'json',
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

  if (config.get<boolean>('autoShowPanel', false)) {
    vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  console.log(`[Copilot Pixel Agents] Activated. Hooks server on port ${port}.`);
}

export function deactivate(): void {}
