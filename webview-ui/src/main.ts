import './style.css';
import {
  addCharacter,
  createOffice,
  onToolDone,
  onToolStart,
  removeCharacter,
  resetOfficeView,
  resizeOffice,
  setIdle,
  setOfficeZoom,
  setWaiting,
  startLoop,
  syncHistory,
} from './engine.js';
import type { Character } from './engine.js';
import type { ClientMessage, ServerMessage } from './types.js';
import { outcomeLabel, renderTaskInspector } from './taskInspector.js';

declare const acquireVsCodeApi: () => { postMessage: (msg: ClientMessage) => void };
const vscode = acquireVsCodeApi();
function post(msg: ClientMessage): void { vscode.postMessage(msg); }
let captureEnabled = false;

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
  canvas.setAttribute('aria-label', 'Isometric pixel office. Drag to pan; use the view controls to zoom.');
  canvasWrap.appendChild(canvas);

  const sceneHeading = document.createElement('div');
  sceneHeading.id = 'scene-heading';
  sceneHeading.innerHTML = '<span class="scene-eyebrow">COPILOT PIXEL AGENTS</span><span class="scene-title">The little office<span class="scene-badge">2.5D</span></span>';
  canvasWrap.appendChild(sceneHeading);

  // Empty-state overlay (shown when no agents; hidden otherwise)
  const emptyOverlay = document.createElement('div');
  emptyOverlay.id = 'empty-overlay';
  emptyOverlay.innerHTML = `
    <div class="empty-title">Your team's next workspace.</div>
    <div class="empty-subtitle">Start a Copilot agent to bring the office to life.</div>
    <button id="install-hooks-btn">⚙ Install / Reinstall Hooks</button>
  `;
  canvasWrap.appendChild(emptyOverlay);

  document.getElementById('install-hooks-btn')?.addEventListener('click', () => {
    post({ type: 'installHooks' });
  });

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

  // Agent modal — large overlay panel on canvas (right side)
  const agentModal = document.createElement('div');
  agentModal.id = 'agent-modal';
  agentModal.style.display = 'none';
  canvasWrap.appendChild(agentModal);

  // Create office (sets up click handler)
  const office = createOffice(canvas);

  const viewControls = document.createElement('div');
  viewControls.id = 'view-controls';
  viewControls.setAttribute('role', 'group');
  viewControls.setAttribute('aria-label', 'Office view controls');
  viewControls.innerHTML = `
    <span class="view-hint">Drag to explore</span>
    <button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
    <output id="zoom-level" aria-live="polite">100%</output>
    <button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
    <button type="button" id="reset-view" aria-label="Fit office to view" title="Fit office to view">↺</button>
  `;
  canvasWrap.appendChild(viewControls);
  const updateZoomControls = () => {
    viewControls.querySelector('output')!.textContent = `${Math.round(office.zoom * 100)}%`;
    (viewControls.querySelector('#zoom-out') as HTMLButtonElement).disabled = office.zoom <= 0.5;
    (viewControls.querySelector('#zoom-in') as HTMLButtonElement).disabled = office.zoom >= 3;
  };
  viewControls.querySelector('#zoom-out')!.addEventListener('click', () => {
    setOfficeZoom(office, office.zoom / 1.25);
    updateZoomControls();
  });
  viewControls.querySelector('#zoom-in')!.addEventListener('click', () => {
    setOfficeZoom(office, office.zoom * 1.25);
    updateZoomControls();
  });
  viewControls.querySelector('#reset-view')!.addEventListener('click', () => {
    resetOfficeView(office);
    updateZoomControls();
  });

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

  function syncEmptyOverlay() {
    emptyOverlay.style.display = office.characters.size === 0 ? 'flex' : 'none';
  }
  syncEmptyOverlay();

  const closeModal = () => {
    agentModal.style.display = 'none';
    delete agentModal.dataset.taskId;
    inspector.style.display = 'none';
    for (const c of office.characters.values()) c.selected = false;
    renderAgentsStrip(agentsStrip, office);
  };

  // ── Inspector / modal logic ──────────────────────────────────────────────
  office.onCharacterClick = (id: string) => {
    if (!id) { closeModal(); return; }
    const char = office.characters.get(id);
    if (!char) return;
    agentModal.style.display = 'flex';
    renderAgentModal(agentModal, char, closeModal);
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
        for (const a of msg.agents) {
          addCharacter(office, a.id, a.name);
          const c = office.characters.get(a.id)!;
          c.sessionStartedAt = a.sessionStartedAt ?? c.sessionStartedAt;
          c.inputTokens = a.inputTokens ?? 0;
          c.outputTokens = a.outputTokens ?? 0;
          // Restore simulation independently of history, never replay old animations.
          for (const [toolId, tool] of a.activeTools ?? []) onToolStart(office, a.id, toolId, tool.name, tool.status);
          if (a.isWaiting) setWaiting(office, a.id);
          syncHistory(office, a.id, a.toolHistory ?? []);
        }
        syncEmptyOverlay();
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentCreated':
        addCharacter(office, msg.id, msg.name);
        syncEmptyOverlay();
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentRemoved':
        removeCharacter(office, msg.id);
        syncEmptyOverlay();
        closeModal();
        renderAgentsStrip(agentsStrip, office);
        break;

      case 'agentToolStart': {
        onToolStart(office, msg.id, msg.toolId, msg.toolName, msg.status, msg.entry);
        const sel = selectedChar(office);
        if (sel?.id === msg.id && agentModal.style.display !== 'none') {
          renderAgentModal(agentModal, sel, closeModal);
        }
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentToolDone': {
        onToolDone(office, msg.id, msg.toolId, msg.entry);
        const sel = selectedChar(office);
        if (sel?.id === msg.id && agentModal.style.display !== 'none') {
          renderAgentModal(agentModal, sel, closeModal);
        }
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentStatus': {
        if (msg.status === 'waiting') setWaiting(office, msg.id);
        else if (msg.status === 'idle') setIdle(office, msg.id);
        const sel = selectedChar(office);
        if (sel?.id === msg.id && agentModal.style.display !== 'none') {
          renderAgentModal(agentModal, sel, closeModal);
        }
        renderAgentsStrip(agentsStrip, office, sel?.id);
        break;
      }

      case 'agentHistory': {
        syncHistory(office, msg.id, msg.history);
        const sel = selectedChar(office);
        if (sel?.id === msg.id && agentModal.style.display !== 'none') renderAgentModal(agentModal, sel, closeModal);
        break;
      }

      case 'captureSettings': {
        captureEnabled = msg.enabled;
        if (!captureEnabled) {
          for (const c of office.characters.values()) for (const entry of c.toolHistory) delete entry.details;
        }
        const sel = selectedChar(office);
        if (sel && agentModal.style.display !== 'none') renderAgentModal(agentModal, sel, closeModal);
        break;
      }

      case 'agentTokenUsage': {
        const c = office.characters.get(msg.id);
        if (c) { c.inputTokens = msg.inputTokens; c.outputTokens = msg.outputTokens; }
        const sel = selectedChar(office);
        if (sel?.id === msg.id && agentModal.style.display !== 'none') {
          renderAgentModal(agentModal, sel, closeModal);
        }
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
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'agent-chip' + (c.id === selectedId ? ' selected' : '');
    chip.innerHTML = `
      <div class="agent-chip-dot ${c.activity}"></div>
      <span class="agent-chip-name" title="${esc(c.id)}">${esc(c.name)}</span>
    `;
    chip.addEventListener('click', () => {
      for (const ch of office.characters.values()) ch.selected = false;
      c.selected = true;
      const modal = document.getElementById('agent-modal') as HTMLElement;
      const closeModalFn = () => {
        modal.style.display = 'none';
        delete modal.dataset.taskId;
        for (const ch of office.characters.values()) ch.selected = false;
        renderAgentsStrip(container, office);
      };
      if (modal) {
        modal.style.display = 'flex';
        renderAgentModal(modal, c, closeModalFn);
      }
      renderAgentsStrip(container, office, c.id);
    });
    container.appendChild(chip);
  }
}

function renderAgentModal(container: HTMLElement, char: Character, onClose: () => void): void {
  if (container.dataset.agentId !== char.id) {
    delete container.dataset.taskId;
    delete container.dataset.taskTab;
    container.dataset.agentId = char.id;
  }
  if (container.dataset.taskId) {
    const entry = char.toolHistory.find((item) => item.entryId === container.dataset.taskId);
    renderTaskInspector(container, entry, char.name, captureEnabled, () => {
      const entryId = container.dataset.taskId;
      delete container.dataset.taskId;
      renderAgentModal(container, char, onClose);
      Array.from(container.querySelectorAll<HTMLButtonElement>('[data-entry-id]')).find((button) => button.dataset.entryId === entryId)?.focus();
    }, onClose, () => post({ type: 'openCaptureSettings' }));
    return;
  }
  container.classList.remove('showing-task');
  const historyScroll = container.querySelector('.modal-history')?.scrollTop ?? 0;
  const focusId = (document.activeElement as HTMLElement | null)?.dataset.entryId;
  const dur = Math.round((Date.now() - char.sessionStartedAt) / 1000);
  const durStr = dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`;

  const activeHtml = [...char.activeTools.values()]
    .map((t) => `<div class="modal-tool ${t.status}">${statusIcon(t.status)} ${esc(t.name)}</div>`)
    .join('') || '<span class="modal-empty">—</span>';

  const histHtml = char.toolHistory
    .map((e) => {
      const ms = e.finishedAt
        ? `${e.finishedAt - e.startedAt}ms`
        : '<span class="modal-running">…</span>';
      return `<button type="button" class="modal-hist-entry" data-entry-id="${esc(e.entryId)}" aria-label="Inspect ${esc(e.toolName)} · ${outcomeLabel(e)}">
        <span class="modal-hist-icon">${statusIcon(e.status)}</span>
        <span class="modal-hist-name" title="${esc(e.toolName)}">${esc(e.toolName)}</span>
        <span class="modal-hist-dur">${ms}</span>
        <span class="modal-hist-ago task-outcome ${e.outcome}" title="${fmtAgo(e.startedAt)}">${outcomeLabel(e)} ›</span>
      </button>`;
    }).join('') || '<div class="modal-empty">No tools yet</div>';

  container.innerHTML = `
    <div class="modal-header">
      <div class="modal-title-row">
        <div class="modal-dot ${char.activity}"></div>
        <span class="modal-name">${esc(char.name)}</span>
        <button class="modal-close" id="modal-close-btn" aria-label="Close agent inspector">✕</button>
      </div>
      <div class="modal-status">${actLabel(char.activity)}</div>
    </div>
    <div class="modal-stats">
      <div class="modal-stat-card">
        <span class="modal-stat-label">Uptime</span>
        <span class="modal-stat-val">${durStr}</span>
      </div>
      <div class="modal-stat-card">
        <span class="modal-stat-label">Input</span>
        <span class="modal-stat-val">${fmt(char.inputTokens)}</span>
      </div>
      <div class="modal-stat-card">
        <span class="modal-stat-label">Output</span>
        <span class="modal-stat-val">${fmt(char.outputTokens)}</span>
      </div>
      <div class="modal-stat-card">
        <span class="modal-stat-label">Tools</span>
        <span class="modal-stat-val">${char.toolHistory.length}</span>
      </div>
    </div>
    <div class="modal-section-title">Active</div>
    <div class="modal-active-tools">${activeHtml}</div>
    <div class="modal-section-title">History</div>
    <div class="history-hint">Select a task to inspect its input, output and events.</div>
    <button type="button" class="capture-settings-link">${captureEnabled ? 'Payload capture on · Settings' : 'Payload capture off · Enable in Settings'}</button>
    <div class="modal-history">${histHtml}</div>
  `;

  document.getElementById('modal-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose();
  });
  container.querySelector('.capture-settings-link')?.addEventListener('click', () => post({ type: 'openCaptureSettings' }));
  for (const button of Array.from(container.querySelectorAll<HTMLButtonElement>('[data-entry-id]'))) {
    button.addEventListener('click', () => {
      container.dataset.taskId = button.dataset.entryId;
      container.dataset.taskTab = 'input';
      renderAgentModal(container, char, onClose);
      container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
  }
  const history = container.querySelector('.modal-history');
  if (history) history.scrollTop = historyScroll;
  if (focusId) Array.from(container.querySelectorAll<HTMLButtonElement>('[data-entry-id]')).find((button) => button.dataset.entryId === focusId)?.focus({ preventScroll: true });
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function actLabel(a: string): string {
  const map: Record<string, string> = {
    typing: '⌨ Writing', reading: '📖 Reading', running: '⚙ Running',
    searching: '🔍 Searching', waiting: '⏳ Waiting', walking: '🚶 Walking', idle: '💤 Idle',
    gaming: '🎮 Gaming', watching_tv: '📺 Watching TV', coffee_break: '☕ Coffee Break',
  };
  return map[a] ?? a;
}

function statusIcon(s: string): string {
  const map: Record<string, string> = {
    reading: '📖', writing: '✏️', running: '⚙️', searching: '🔍', other: '🔧',
  };
  return map[s] ?? '🔧';
}
