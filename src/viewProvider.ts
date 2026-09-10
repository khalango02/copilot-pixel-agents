import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentStore } from './agentStore.js';
import type { ClientMessage, ServerMessage, ToolStatus, ToolHistoryEntry } from './types.js';

export class PixelOfficeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: AgentStore,
    private readonly serverPort: number,
  ) {
    this.bindStoreEvents();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets'),
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: ClientMessage) => {
      this.handleClientMessage(msg);
    });
  }

  private handleClientMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'webviewReady':
        this.post({ type: 'captureSettings', enabled: this.store.captureTaskDetails });
        this.sendExistingAgents();
        this.post({ type: 'serverPort', port: this.serverPort });
        break;
      case 'installHooks':
        vscode.commands.executeCommand('copilotPixelAgents.installHooks');
        break;
      case 'openCaptureSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'copilotPixelAgents.captureTaskDetails');
        break;
      case 'focusAgent':
        break;
      case 'closeAgent':
        break;
    }
  }

  private bindStoreEvents(): void {
    this.store.on('agentCreated', (agent: { id: string; name: string }) => {
      this.post({ type: 'agentCreated', id: agent.id, name: agent.name });
    });
    this.store.on('agentRemoved', (id: string) => {
      this.post({ type: 'agentRemoved', id });
    });
    this.store.on('agentToolStart', (id: string, toolId: string, toolName: string, status: ToolStatus, entry: ToolHistoryEntry) => {
      this.post({ type: 'agentToolStart', id, toolId, toolName, status, entry });
    });
    this.store.on('agentToolDone', (id: string, toolId: string, entry: ToolHistoryEntry) => {
      this.post({ type: 'agentToolDone', id, toolId, entry });
    });
    this.store.on('agentHistory', (id: string, history: ToolHistoryEntry[]) => {
      this.post({ type: 'agentHistory', id, history });
    });
    this.store.on('captureSettings', (enabled: boolean) => {
      this.post({ type: 'captureSettings', enabled });
    });
    this.store.on('agentStatus', (id: string, status: 'idle' | 'waiting' | 'active') => {
      this.post({ type: 'agentStatus', id, status });
    });
    this.store.on('agentTokenUsage', (id: string, inputTokens: number, outputTokens: number) => {
      this.post({ type: 'agentTokenUsage', id, inputTokens, outputTokens });
    });
  }

  private sendExistingAgents(): void {
    const agents = this.store.getSnapshots();
    this.post({ type: 'existingAgents', agents });
  }

  private post(msg: ServerMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.css'),
    );
    const nonce = getNonce();
    // Base URI for loading sprite assets from the extension's dist/webview/assets/ folder.
    // Webview JS cannot use relative paths — it needs these resolved vscode-resource:// URIs.
    const assetsBaseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets'),
    ).toString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
  " />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Copilot Pixel Agents</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.ASSETS_BASE_URI = "${assetsBaseUri}";</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
