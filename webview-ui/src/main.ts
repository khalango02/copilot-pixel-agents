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
import type { Character } from './engine.js';
import type { ClientMessage, ServerMessage } from './types.js';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: ClientMessage) => void;
};

const vscode = acquireVsCodeApi();
function post(msg: ClientMessage): void {
  vscode.postMessage(msg);
}

// ─── State ────────────────────────────────────────────────────────────────────

// Mirror of character data for the sidebar/inspection panel
const agentMeta = new Map<string, { id: string; name: string }>();

// ─── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')!;

  // ── Status bar
  const statusBar = document.createElement('div');
  statusBar.id = 'status-bar';
  statusBar.textContent = 'Connecting to hooks server…';
  app.appendChild(statusBar);

  // ── Main area (canvas + right panel)
  const mainArea = document.createElement('div');
  mainArea.id = 'main-area';
  app.appendChild(mainArea);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'office-canvas';
  mainArea.appendChild(canvas);

  const office = createOffice(canvas);

  // ── Right panel (teams + inspector)
  const rightPanel = document.createElement('div');
  rightPanel.id = 'right-panel';
  mainArea.appendChild(rightPanel);

  // Teams section
  const teamsSection = document.createElement('div');
  teamsSection.id = 'teams-section';
  teamsSection.innerHTML = '<div class="panel-title">AGENTS</div>';
  rightPanel.appendChild(teamsSection);

  const teamsList = document.createElement('div');
  teamsList.id = 'teams-list';
  teamsSection.appendChild(teamsList);

  // Inspector section
  const inspectorSection = document.createElement('div');
  inspectorSection.id = 'inspector-section';
  inspectorSection.innerHTML = '<div class="panel-title">INSPECTOR</div>';
  inspectorSection.style.display = 'none';
  rightPanel.appendChild(inspectorSection);

  const inspectorContent = document.createElement('div');
  inspectorContent.id = 'inspector-content';
  inspectorSection.appendChild(inspectorContent);

  // ── Wire canvas click → inspector
  office.onCharacterClick = (id: string) => {
    const char = office.characters.get(id);
    if (char) {
      inspectorSection.style.display = 'flex';
      renderInspector(inspectorContent, char);
      updateTeamsList(teamsList, office, id);
    }
  };

  // Deselect also hides inspector
  canvas.addEventListener('click', () => {
    const anySelected = [...office.characters.values()].some((c) => c.selected);
    if (!anySelected) {
      inspectorSection.style.display = 'none';
    }
  });

  startLoop(office);

  // ── Helpers
  function updateTeamsList(
    container: HTMLElement,
    off: typeof office,
    selectedId?: string,
  ): void {
    container.innerHTML = '';
    if (off.characters.size === 0) {
      container.innerHTML = '<div class="agent-card-empty">No agents running</div>';
      return;
    }
    for (const c of off.characters.values()) {
      const card = document.createElement('div');
      card.className = 'agent-card' + (c.id === selectedId ? ' selected' : '');
      card.innerHTML = `
        <div class="agent-card-name">${esc(c.name)}</div>
        <div class="agent-card-status ${c.activity}">${activityLabel(c.activity)}</div>
        <div class="agent-card-tools">${[...c.activeTools.values()].map((t) => esc(t.name)).join(', ') || '—'}</div>
        <div class="agent-card-tokens">↑${fmt(c.inputTokens)} ↓${fmt(c.outputTokens)}</div>
      `;
      card.addEventListener('click', () => {
        for (const ch of off.characters.values()) ch.selected = false;
        c.selected = true;
        inspectorSection.style.display = 'flex';
        renderInspector(inspectorContent, c);
        updateTeamsList(container, off, c.id);
      });
      container.appendChild(card);
    }
  }

  function renderInspector(container: HTMLElement, char: Character): void {
    const dur = Math.round((Date.now() - char.sessionStartedAt) / 1000);
    const durStr = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`;

    const historyHtml = char.toolHistory.slice(0, 15).map((e) => {
      const elapsed = e.finishedAt
        ? `${e.finishedAt - e.startedAt}ms`
        : '<span class="running">running…</span>';
      return `<div class="history-entry">
        <span class="history-icon">${statusIcon(e.status)}</span>
        <span class="history-name" title="${esc(e.toolName)}">${esc(shortName(e.toolName))}</span>
        <span class="history-time">${elapsed}</span>
      </div>`;
    }).join('') || '<div class="history-empty">No tools used yet</div>';

    container.innerHTML = `
      <div class="inspector-header">
        <div class="inspector-name">${esc(char.name)}</div>
        <div class="inspector-id">${esc(char.id.slice(0, 12))}…</div>
      </div>
      <div class="inspector-stats">
        <div class="stat"><span class="stat-label">Status</span><span class="stat-value ${char.activity}">${activityLabel(char.activity)}</span></div>
        <div class="stat"><span class="stat-label">Duration</span><span class="stat-value">${durStr}</span></div>
        <div class="stat"><span class="stat-label">Input</span><span class="stat-value">${fmt(char.inputTokens)} tok</span></div>
        <div class="stat"><span class="stat-label">Output</span><span class="stat-value">${fmt(char.outputTokens)} tok</span></div>
      </div>
      <div class="inspector-section-title">Active tools</div>
      <div class="active-tools">
        ${[...char.activeTools.values()].map((t) =>
          `<div class="active-tool ${t.status}">${statusIcon(t.status)} ${esc(t.name)}</div>`
        ).join('') || '<div class="history-empty">—</div>'}
      </div>
      <div class="inspector-section-title">Tool history</div>
      <div class="history-list">${historyHtml}</div>
    `;
  }

  // ── Message handler
  window.addEventListener('message', (event: MessageEvent<ServerMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'serverPort':
        statusBar.textContent = `Hooks server on localhost:${msg.port}`;
        break;

      case 'existingAgents':
        for (const a of msg.agents) {
          agentMeta.set(a.id, a);
          addCharacter(office, a.id, a.name);
        }
        updateTeamsList(teamsList, office);
        break;

      case 'agentCreated':
        agentMeta.set(msg.id, { id: msg.id, name: msg.name });
        addCharacter(office, msg.id, msg.name);
        updateTeamsList(teamsList, office);
        break;

      case 'agentRemoved':
        agentMeta.delete(msg.id);
        removeCharacter(office, msg.id);
        inspectorSection.style.display = 'none';
        updateTeamsList(teamsList, office);
        break;

      case 'agentToolStart': {
        onToolStart(office, msg.id, msg.toolId, msg.toolName, msg.status);
        const sel = [...office.characters.values()].find((c) => c.selected);
        if (sel?.id === msg.id) renderInspector(inspectorContent, sel);
        updateTeamsList(teamsList, office, sel?.id);
        break;
      }

      case 'agentToolDone': {
        onToolDone(office, msg.id, msg.toolId);
        const sel = [...office.characters.values()].find((c) => c.selected);
        if (sel?.id === msg.id) renderInspector(inspectorContent, sel);
        updateTeamsList(teamsList, office, sel?.id);
        break;
      }

      case 'agentStatus': {
        if (msg.status === 'waiting') setWaiting(office, msg.id);
        else if (msg.status === 'idle') setIdle(office, msg.id);
        const sel = [...office.characters.values()].find((c) => c.selected);
        if (sel?.id === msg.id) renderInspector(inspectorContent, sel);
        updateTeamsList(teamsList, office, sel?.id);
        break;
      }

      case 'agentTokenUsage': {
        const c = office.characters.get(msg.id);
        if (c) {
          c.inputTokens = msg.inputTokens;
          c.outputTokens = msg.outputTokens;
        }
        const sel = [...office.characters.values()].find((c2) => c2.selected);
        if (sel?.id === msg.id) renderInspector(inspectorContent, sel);
        updateTeamsList(teamsList, office, sel?.id);
        break;
      }
    }
  });

  post({ type: 'webviewReady' });
});

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortName(name: string): string {
  const n = name.replace(/([A-Z])/g, ' $1').trim();
  return n.length > 16 ? n.slice(0, 15) + '…' : n;
}

function activityLabel(activity: string): string {
  switch (activity) {
    case 'typing': return '⌨ Writing';
    case 'reading': return '📖 Reading';
    case 'running': return '⚙ Running';
    case 'searching': return '🔍 Searching';
    case 'waiting': return '⏳ Waiting';
    case 'walking': return '🚶 Walking';
    default: return '💤 Idle';
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'reading': return '📖';
    case 'writing': return '✏️';
    case 'running': return '⚙️';
    case 'searching': return '🔍';
    default: return '🔧';
  }
}
