import './style.css';
import {
  addCharacter,
  createOffice,
  onToolDone,
  onToolStart,
  removeCharacter,
  setIdle,
  setWaiting,
  startLoop,
} from './engine.js';
import type { ClientMessage, ServerMessage } from './types.js';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: ClientMessage) => void;
};

const vscode = acquireVsCodeApi();

function post(msg: ClientMessage): void {
  vscode.postMessage(msg);
}

// --- Bootstrap ---

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')!;

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.id = 'status-bar';
  statusBar.textContent = 'Waiting for hooks server…';
  app.appendChild(statusBar);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'office-canvas';
  app.appendChild(canvas);

  const office = createOffice(canvas);
  startLoop(office);

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.id = 'sidebar';
  app.appendChild(sidebar);

  function updateSidebar(): void {
    sidebar.innerHTML = '';
    if (office.characters.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = 'No agents running';
      sidebar.appendChild(empty);
      return;
    }
    for (const c of office.characters.values()) {
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML = `
        <div class="agent-name">${escapeHtml(c.name)}</div>
        <div class="agent-activity">${c.activity}</div>
        <div class="agent-tools">${[...c.activeTools.values()].map(t => escapeHtml(t.name)).join(', ') || '—'}</div>
        <div class="agent-tokens">↑${fmt(c.inputTokens)} ↓${fmt(c.outputTokens)}</div>
      `;
      sidebar.appendChild(card);
    }
  }

  // Message handler
  window.addEventListener('message', (event: MessageEvent<ServerMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'serverPort':
        statusBar.textContent = `Hooks server: localhost:${msg.port}`;
        break;
      case 'existingAgents':
        for (const a of msg.agents) {
          addCharacter(office, a.id, a.name);
        }
        updateSidebar();
        break;
      case 'agentCreated':
        addCharacter(office, msg.id, msg.name);
        updateSidebar();
        break;
      case 'agentRemoved':
        removeCharacter(office, msg.id);
        updateSidebar();
        break;
      case 'agentToolStart':
        onToolStart(office, msg.id, msg.toolId, msg.toolName, msg.status);
        updateSidebar();
        break;
      case 'agentToolDone':
        onToolDone(office, msg.id, msg.toolId);
        updateSidebar();
        break;
      case 'agentStatus':
        if (msg.status === 'waiting') setWaiting(office, msg.id);
        else if (msg.status === 'idle') setIdle(office, msg.id);
        updateSidebar();
        break;
      case 'agentTokenUsage': {
        const c = office.characters.get(msg.id);
        if (c) {
          c.inputTokens = msg.inputTokens;
          c.outputTokens = msg.outputTokens;
        }
        updateSidebar();
        break;
      }
    }
  });

  // Notify extension we're ready
  post({ type: 'webviewReady' });
});

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
