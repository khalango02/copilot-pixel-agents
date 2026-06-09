import './style.css';
import {
  addCharacter,
  createOffice,
  onToolDone,
  onToolStart,
  removeCharacter,
  resizeOffice,
  setIdle,
  setWaiting,
  startLoop,
} from './engine.js';
import type { Character } from './engine.js';
import type { ClientMessage, ServerMessage } from './types.js';

declare const acquireVsCodeApi: () => { postMessage: (msg: ClientMessage) => void };
const vscode = acquireVsCodeApi();
function post(msg: ClientMessage): void { vscode.postMessage(msg); }

// ─── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')!;

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.id = 'status-bar';
  statusBar.textContent = 'Connecting…';
  app.appendChild(statusBar);

  // Canvas wrapper — flex:1 goes here so canvas intrinsic size doesn't fight the layout
  const canvasWrap = document.createElement('div');
  canvasWrap.id = 'canvas-wrap';
  app.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.id = 'office-canvas';
  canvasWrap.appendChild(canvas);

  // Bottom panel
  const bottomPanel = document.createElement('div');
  bottomPanel.id = 'bottom-panel';
  app.appendChild(bottomPanel);

  const agentsStrip = document.createElement('div');
  agentsStrip.id = 'agents-strip';
  bottomPanel.appendChild(agentsStrip);

  const inspector = document.createElement('div');
  inspector.id = 'inspector';
  inspector.style.display = 'none';
  bottomPanel.appendChild(inspector);

  // Create office (sets up click handler)
  const office = createOffice(canvas);

  // ── Canvas responsive sizing via ResizeObserver ──────────────────────────
  // Initial size from wrapper (canvas itself has no intrinsic CSS size yet)
  const initialW = canvasWrap.offsetWidth || window.innerWidth;
  const initialH = canvasWrap.offsetHeight || Math.max(120, window.innerHeight - 80);
  resizeOffice(office, initialW, initialH);

  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) resizeOffice(office, width, height);
    }
  });
  ro.observe(canvasWrap);

  startLoop(office);

  // ── Inspector logic ──────────────────────────────────────────────────────
  office.onCharacterClick = (id: string) => {
    if (!id) { inspector.style.display = 'none'; return; }
    const char = office.characters.get(id);
    if (!char) return;
    inspector.style.display = 'block';
    renderInspector(inspector, char);
    renderAgentsStrip(agentsStrip, office, id);
  };

  // ── Message handler ──────────────────────────────────────────────────────
  window.addEventListener('message', (event: MessageEvent<ServerMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'serverPort':
        statusBar.textContent = `Hooks server → localhost:${msg.port}`;
        break;

      case 'existingAgents':
        for (const a of msg.agents) addCharacter(office, a.id, a.name);
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentCreated':
        addCharacter(office, msg.id, msg.name);
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentRemoved':
        removeCharacter(office, msg.id);
        inspector.style.display = 'none';
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentToolStart': {
        onToolStart(office, msg.id, msg.toolId, msg.toolName, msg.status);
        const sel = selectedChar(office);
        if (sel?.id === msg.id) renderInspector(inspector, sel);
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentToolDone': {
        onToolDone(office, msg.id, msg.toolId);
        const sel = selectedChar(office);
        if (sel?.id === msg.id) renderInspector(inspector, sel);
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentStatus': {
        if (msg.status === 'waiting') setWaiting(office, msg.id);
        else if (msg.status === 'idle') setIdle(office, msg.id);
        const sel = selectedChar(office);
        if (sel?.id === msg.id) renderInspector(inspector, sel);
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentTokenUsage': {
        const c = office.characters.get(msg.id);
        if (c) { c.inputTokens = msg.inputTokens; c.outputTokens = msg.outputTokens; }
        const sel = selectedChar(office);
        if (sel?.id === msg.id) renderInspector(inspector, sel);
        break;
      }
    }
  });

  post({ type: 'webviewReady' });
});

// ─── UI helpers ──────────────────────────────────────────────────────────────

function renderAgentsStrip(
  container: HTMLElement,
  office: ReturnType<typeof createOffice>,
  selectedId?: string,
): void {
  container.innerHTML = '';
  if (office.characters.size === 0) {
    container.innerHTML = '<span class="agents-empty">No agents running</span>';
    return;
  }
  for (const c of office.characters.values()) {
    const chip = document.createElement('div');
    chip.className = 'agent-chip' + (c.id === selectedId ? ' selected' : '');
    chip.innerHTML = `
      <div class="agent-chip-dot ${c.activity}"></div>
      <span class="agent-chip-name" title="${esc(c.id)}">${esc(c.name)}</span>
    `;
    chip.addEventListener('click', () => {
      for (const ch of office.characters.values()) ch.selected = false;
      c.selected = true;
      const inspector = document.getElementById('inspector')!;
      inspector.style.display = 'block';
      renderInspector(inspector, c);
      renderAgentsStrip(container, office, c.id);
    });
    container.appendChild(chip);
  }
}

function renderInspector(container: HTMLElement, char: Character): void {
  const dur = Math.round((Date.now() - char.sessionStartedAt) / 1000);
  const durStr = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`;

  const activeHtml = [...char.activeTools.values()]
    .map((t) => `<span class="active-tool ${t.status}">${statusIcon(t.status)} ${esc(t.name)}</span>`)
    .join('') || '—';

  const histHtml = char.toolHistory.slice(0, 12)
    .map((e) => {
      const ms = e.finishedAt ? `${e.finishedAt - e.startedAt}ms` : `<span class="history-running">…</span>`;
      return `<div class="history-entry">
        <span class="history-icon">${statusIcon(e.status)}</span>
        <span class="history-name" title="${esc(e.toolName)}">${esc(shortName(e.toolName))}</span>
        <span class="history-time">${ms}</span>
      </div>`;
    }).join('') || '<div class="history-empty">No tools yet</div>';

  container.innerHTML = `
    <div class="inspector-header">
      <span class="inspector-name">${esc(char.name)}</span>
      <button class="inspector-close" id="inspector-close-btn">✕</button>
    </div>
    <div class="inspector-stats">
      <div class="stat"><span class="stat-label">Status</span><span class="stat-value ${char.activity}">${actLabel(char.activity)}</span></div>
      <div class="stat"><span class="stat-label">Uptime</span><span class="stat-value">${durStr}</span></div>
      <div class="stat"><span class="stat-label">In</span><span class="stat-value">${fmt(char.inputTokens)}</span></div>
      <div class="stat"><span class="stat-label">Out</span><span class="stat-value">${fmt(char.outputTokens)}</span></div>
    </div>
    <div class="inspector-row-title">Active</div>
    <div class="active-tools">${activeHtml}</div>
    <div class="inspector-row-title">History</div>
    <div class="history-list">${histHtml}</div>
  `;

  document.getElementById('inspector-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    container.style.display = 'none';
    for (const ch of (window as any).__office?.characters?.values() ?? []) {
      (ch as Character).selected = false;
    }
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function selectedChar(office: ReturnType<typeof createOffice>): Character | undefined {
  return [...office.characters.values()].find((c) => c.selected);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n || 0);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortName(name: string): string {
  const n = name.replace(/([A-Z])/g, ' $1').trim();
  return n.length > 18 ? n.slice(0, 17) + '…' : n;
}

function actLabel(a: string): string {
  const map: Record<string, string> = {
    typing: '⌨ Writing', reading: '📖 Reading', running: '⚙ Running',
    searching: '🔍 Searching', waiting: '⏳ Waiting', walking: '🚶 Walking', idle: '💤 Idle',
  };
  return map[a] ?? a;
}

function statusIcon(s: string): string {
  const map: Record<string, string> = {
    reading: '📖', writing: '✏️', running: '⚙️', searching: '🔍', other: '🔧',
  };
  return map[s] ?? '🔧';
}
