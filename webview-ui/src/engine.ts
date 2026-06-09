import { drawCharacterSprite, drawFloorTile, drawFurniture, getPcFrame, loadSprites } from './sprites.js';
import type { ToolHistoryEntry, ToolStatus } from './types.js';

export type CharacterActivity = 'idle' | 'walking' | 'typing' | 'reading' | 'waiting' | 'running' | 'searching';

const TILE = 16;
const CHAR_W = 16;
const CHAR_H = 32;
const MAX_HISTORY = 50;
// Desks are spaced every N tiles horizontally
const DESK_SPACING_X = 5;
const DESK_SPACING_Y = 5;
const DESK_START_COL = 2;
const DESK_START_ROW = 3;

export interface Character {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  deskX: number;
  deskY: number;
  activity: CharacterActivity;
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  toolHistory: ToolHistoryEntry[];
  palette: number;
  frame: number;
  frameTimer: number;
  direction: 'left' | 'right' | 'up' | 'down';
  inputTokens: number;
  outputTokens: number;
  sessionStartedAt: number;
  speechBubble?: { text: string; expiresAt: number };
  selected: boolean;
}

export interface Office {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  characters: Map<string, Character>;
  animFrameId: number;
  lastTimestamp: number;
  pcFrame: number;
  pcFrameTimer: number;
  cols: number;
  rows: number;
  onCharacterClick?: (id: string) => void;
}

let nextPaletteIndex = 0;

export function createOffice(canvas: HTMLCanvasElement): Office {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const office: Office = {
    canvas,
    ctx,
    characters: new Map(),
    animFrameId: 0,
    lastTimestamp: 0,
    pcFrame: 0,
    pcFrameTimer: 0,
    cols: 20,
    rows: 14,
  };

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    let hit = false;
    for (const char of office.characters.values()) {
      if (cx >= char.x && cx <= char.x + CHAR_W && cy >= char.y && cy <= char.y + CHAR_H) {
        for (const c of office.characters.values()) c.selected = false;
        char.selected = true;
        office.onCharacterClick?.(char.id);
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const c of office.characters.values()) c.selected = false;
      office.onCharacterClick?.('');
    }
  });

  loadSprites();
  return office;
}

/** Call whenever the canvas CSS display size changes. Updates internal resolution. */
export function resizeOffice(office: Office, cssWidth: number, cssHeight: number): void {
  const dpr = window.devicePixelRatio || 1;
  // Use CSS pixels directly (no DPR scaling) — pixelated rendering looks better 1:1
  const w = Math.max(Math.round(cssWidth), 64);
  const h = Math.max(Math.round(cssHeight), 64);
  if (office.canvas.width === w && office.canvas.height === h) return;

  office.canvas.width = w;
  office.canvas.height = h;
  office.canvas.getContext('2d')!.imageSmoothingEnabled = false;

  office.cols = Math.floor(w / TILE);
  office.rows = Math.floor(h / TILE);

  // Reposition characters within new bounds, back to their desks
  repositionDesks(office);
}

function repositionDesks(office: Office): void {
  let idx = 0;
  for (const c of office.characters.values()) {
    const { deskX, deskY } = deskPosition(office, idx);
    c.deskX = deskX;
    c.deskY = deskY;
    c.x = Math.min(c.x, (office.cols - 2) * TILE);
    c.y = Math.min(c.y, (office.rows - 3) * TILE);
    c.targetX = c.x;
    c.targetY = c.y;
    idx++;
  }
}

function deskPosition(office: Office, idx: number): { deskX: number; deskY: number } {
  const desksPerRow = Math.max(1, Math.floor((office.cols - DESK_START_COL * 2) / DESK_SPACING_X));
  const col = DESK_START_COL + (idx % desksPerRow) * DESK_SPACING_X;
  const row = DESK_START_ROW + Math.floor(idx / desksPerRow) * DESK_SPACING_Y;
  return { deskX: col * TILE, deskY: row * TILE };
}

export function addCharacter(office: Office, id: string, name: string): void {
  if (office.characters.has(id)) return;
  const idx = office.characters.size;
  const { deskX, deskY } = deskPosition(office, idx);

  const char: Character = {
    id,
    name,
    x: deskX,
    y: deskY + TILE,
    targetX: deskX,
    targetY: deskY + TILE,
    deskX,
    deskY,
    activity: 'idle',
    activeTools: new Map(),
    toolHistory: [],
    palette: nextPaletteIndex++ % 6,
    frame: 0,
    frameTimer: 0,
    direction: 'down',
    inputTokens: 0,
    outputTokens: 0,
    sessionStartedAt: Date.now(),
    selected: false,
  };
  office.characters.set(id, char);
}

export function removeCharacter(office: Office, id: string): void {
  office.characters.delete(id);
  // Re-index desk positions
  repositionDesks(office);
}

export function onToolStart(office: Office, agentId: string, toolId: string, toolName: string, status: ToolStatus): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activeTools.set(toolId, { name: toolName, status });
  c.activity = toolStatusToActivity(status);
  c.direction = 'up';
  c.speechBubble = { text: shortToolName(toolName), expiresAt: Date.now() + 3500 };
  c.toolHistory.unshift({ toolId, toolName, status, startedAt: Date.now() });
  if (c.toolHistory.length > MAX_HISTORY) c.toolHistory.length = MAX_HISTORY;
}

export function onToolDone(office: Office, agentId: string, toolId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  const entry = c.toolHistory.find((e) => e.toolId === toolId && !e.finishedAt);
  if (entry) entry.finishedAt = Date.now();
  c.activeTools.delete(toolId);
  if (c.activeTools.size === 0) { c.activity = 'idle'; c.direction = 'down'; }
  else { c.activity = toolStatusToActivity([...c.activeTools.values()][0].status); }
}

export function setWaiting(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activity = 'waiting';
  c.direction = 'down';
  c.speechBubble = { text: '?', expiresAt: Date.now() + 15000 };
}

export function setIdle(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activity = 'idle';
  c.direction = 'down';
}

export function startLoop(office: Office): void {
  function tick(ts: number) {
    const dt = Math.min(ts - office.lastTimestamp, 100);
    office.lastTimestamp = ts;
    update(office, dt);
    render(office);
    office.animFrameId = requestAnimationFrame(tick);
  }
  office.animFrameId = requestAnimationFrame(tick);
}

export function stopLoop(office: Office): void {
  cancelAnimationFrame(office.animFrameId);
}

// ─── Update ───────────────────────────────────────────────────────────────────

function update(office: Office, dt: number): void {
  office.pcFrameTimer += dt;
  if (office.pcFrameTimer >= 400) { office.pcFrameTimer = 0; office.pcFrame = (office.pcFrame + 1) % 3; }

  const maxX = Math.max(0, (office.cols - 2) * TILE);
  const maxY = Math.max(0, (office.rows - 3) * TILE);

  for (const c of office.characters.values()) {
    c.frameTimer += dt;
    const fps = c.activity === 'idle' ? 3 : 8;
    if (c.frameTimer >= 1000 / fps) { c.frameTimer = 0; c.frame = (c.frame + 1) % 4; }

    if (c.activity === 'walking') {
      const speed = 55 * (dt / 1000);
      const dx = c.targetX - c.x;
      const dy = c.targetY - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < speed) {
        c.x = c.targetX; c.y = c.targetY;
        c.activity = 'idle'; c.direction = 'down';
      } else {
        c.x += (dx / dist) * speed;
        c.y += (dy / dist) * speed;
        c.direction = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
      }
    }

    if (c.activity === 'idle' && Math.random() < 0.0006) {
      c.targetX = TILE + Math.floor(Math.random() * maxX);
      c.targetY = TILE + Math.floor(Math.random() * maxY);
      c.activity = 'walking';
    }

    if (c.speechBubble && Date.now() > c.speechBubble.expiresAt) c.speechBubble = undefined;
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(office: Office): void {
  const { ctx, canvas, characters } = office;
  const W = canvas.width;
  const H = canvas.height;

  // Floor tiles
  for (let row = 0; row < office.rows; row++) {
    for (let col = 0; col < office.cols; col++) {
      const drawn = drawFloorTile(ctx, (row + col) % 2, col * TILE, row * TILE);
      if (!drawn) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#2a2a3a' : '#252535';
        ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
      }
    }
  }

  // Top wall
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, TILE);
  ctx.fillStyle = '#2d2b55';
  ctx.fillRect(0, TILE - 2, W, 2);

  // Workstations sorted by Y
  const sorted = [...characters.values()].sort((a, b) => a.deskY - b.deskY);
  for (const c of sorted) drawWorkstation(ctx, c, office.pcFrame);

  // Characters sorted by Y (painter's algorithm)
  const sortedByY = [...characters.values()].sort((a, b) => a.y - b.y);
  for (const c of sortedByY) drawCharacter(ctx, c);

  // Empty state
  if (characters.size === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#888';
    ctx.font = `${Math.max(9, Math.floor(W / 30))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('No active agents', W / 2, H / 2 - 10);
    ctx.fillStyle = '#555';
    ctx.font = `${Math.max(8, Math.floor(W / 36))}px monospace`;
    ctx.fillText('Run: Install Hooks  →  use your agent', W / 2, H / 2 + 8);
    ctx.textAlign = 'left';
  }
}

function drawWorkstation(ctx: CanvasRenderingContext2D, c: Character, pcFrame: number): void {
  const { deskX: dx, deskY: dy } = c;
  const isActive = c.activity !== 'idle' && c.activity !== 'waiting';

  // Chair (behind character)
  const chairDrawn = drawFurniture(ctx, 'chair_back', dx, dy + TILE * 2 - 2);
  if (!chairDrawn) {
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(dx + 2, dy + TILE * 2, 12, 10);
  }

  // Desk
  const deskDrawn = drawFurniture(ctx, 'desk_front', dx - 6, dy + TILE - 2);
  if (!deskDrawn) {
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(dx - 6, dy + TILE, 28, 12);
  }

  // PC monitor
  const pcKey = getPcFrame(pcFrame, isActive);
  const pcDrawn = drawFurniture(ctx, pcKey, dx, dy + 2);
  if (!pcDrawn) {
    ctx.fillStyle = isActive ? '#3a8fff' : '#222';
    ctx.fillRect(dx + 2, dy + 2, 12, 9);
  }

  // Glow when working
  if (isActive && c.activeTools.size > 0) {
    ctx.globalAlpha = 0.2 + Math.sin(Date.now() / 300) * 0.1;
    ctx.fillStyle = activityGlow(c.activity);
    ctx.fillRect(dx - 6, dy, 28, TILE * 2);
    ctx.globalAlpha = 1;
  }
}

function drawCharacter(ctx: CanvasRenderingContext2D, c: Character): void {
  const x = Math.round(c.x);
  const y = Math.round(c.y);

  if (c.selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(x - 1, y - 1, CHAR_W + 2, CHAR_H + 2);
    ctx.setLineDash([]);
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + CHAR_W / 2, y + CHAR_H, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sprite
  const spriteDrawn = drawCharacterSprite(ctx, c.palette, c.direction, c.frame, x, y);
  if (!spriteDrawn) {
    ctx.fillStyle = activityGlow(c.activity);
    ctx.fillRect(x + 2, y, CHAR_W - 4, CHAR_H);
    ctx.fillStyle = '#FFCBA4';
    ctx.fillRect(x + 3, y, CHAR_W - 6, 10);
  }

  // Activity badge
  const badge = activityBadge(c.activity);
  if (badge) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x + 3, y - 10, 10, 9);
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(badge, x + 8, y - 3);
    ctx.textAlign = 'left';
  }

  // Name label
  const label = c.name.length > 8 ? c.name.slice(0, 7) + '…' : c.name;
  const lw = label.length * 5 + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x + CHAR_W / 2 - lw / 2, y + CHAR_H + 1, lw, 8);
  ctx.fillStyle = c.selected ? '#fff' : '#ddd';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + CHAR_W / 2, y + CHAR_H + 8);
  ctx.textAlign = 'left';

  // Speech bubble
  if (c.speechBubble) {
    const txt = c.speechBubble.text;
    const bw = txt.length * 5 + 10;
    const bx = x + CHAR_W / 2 - bw / 2;
    const by = y - 22;
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, bw, 11);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, 11);
    // Tail
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + CHAR_W / 2 - 2, by + 10, 4, 3);
    ctx.fillStyle = '#333';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(txt, x + CHAR_W / 2, by + 8);
    ctx.textAlign = 'left';
  }

  // Token bar
  const usage = Math.min((c.inputTokens + c.outputTokens) / 200_000, 1);
  if (usage > 0) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, y + CHAR_H + 10, CHAR_W, 2);
    ctx.fillStyle = usage > 0.8 ? '#ff4444' : usage > 0.5 ? '#ffaa00' : '#44ff88';
    ctx.fillRect(x, y + CHAR_H + 10, Math.round(CHAR_W * usage), 2);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toolStatusToActivity(status: ToolStatus): CharacterActivity {
  switch (status) {
    case 'reading': return 'reading';
    case 'writing': return 'typing';
    case 'running': return 'running';
    case 'searching': return 'searching';
    default: return 'typing';
  }
}

function activityBadge(activity: CharacterActivity): string {
  switch (activity) {
    case 'typing': return '⌨';
    case 'reading': return '📖';
    case 'running': return '⚙';
    case 'searching': return '🔍';
    case 'waiting': return '⏳';
    default: return '';
  }
}

function activityGlow(activity: CharacterActivity): string {
  switch (activity) {
    case 'typing': return '#5599ff';
    case 'reading': return '#55cc99';
    case 'running': return '#ff9955';
    case 'searching': return '#cc55ff';
    case 'waiting': return '#ffdd55';
    default: return '#6B8CFF';
  }
}

function shortToolName(name: string): string {
  const n = name.replace(/([A-Z])/g, ' $1').trim();
  return n.length > 11 ? n.slice(0, 10) + '…' : n;
}
