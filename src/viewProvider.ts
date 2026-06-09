import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentStore } from './agentStore.js';
import type { ClientMessage, ServerMessage, ToolStatus } from './types.js';

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
        this.sendExistingAgents();
        this.post({ type: 'serverPort', port: this.serverPort });
        break;
      case 'focusAgent':
        // TODO: focus the corresponding terminal if available
        break;
      case 'closeAgent':
        // Agents close via session_end hook; this is a manual dismiss
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
    this.store.on('agentToolStart', (id: string, toolId: string, toolName: string, status: ToolStatus) => {
      this.post({ type: 'agentToolStart', id, toolId, toolName, status });
    });
    this.store.on('agentToolDone', (id: string, toolId: string) => {
      this.post({ type: 'agentToolDone', id, toolId });
    });
    this.store.on('agentStatus', (id: string, status: 'idle' | 'waiting' | 'active') => {
      this.post({ type: 'agentStatus', id, status });
    });
    this.store.on('agentTokenUsage', (id: string, inputTokens: number, outputTokens: number) => {
      this.post({ type: 'agentTokenUsage', id, inputTokens, outputTokens });
    });
  }

  private sendExistingAgents(): void {
    const agents = this.store.getAll().map((a) => ({ id: a.id, name: a.name }));
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
