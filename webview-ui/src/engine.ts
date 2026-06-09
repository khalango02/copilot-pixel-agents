import { drawCharacterSprite, drawFurniture, getPcFrame, loadSprites } from './sprites.js';
import type { ToolHistoryEntry, ToolStatus } from './types.js';

export type CharacterActivity = 'idle' | 'walking' | 'typing' | 'reading' | 'waiting' | 'running' | 'searching';

// Logical tile grid
const TILE = 16;
// All rendering is done at 2× via ctx.scale — keeps logical coords clean
const RENDER_SCALE = 2;
const CHAR_W = 16;   // source sprite width (logical)
const CHAR_H = 32;   // source sprite height (logical)
const MAX_HISTORY = 50;

// Layout constants (in logical TILE units)
const WALL_ROWS = 2;       // rows used by top wall
const DESK_SPACING_X = 3;  // tiles between desk centres
const DESK_SPACING_Y = 5;  // tiles between desk rows
const DESK_START_COL = 1;
const DESK_START_ROW = WALL_ROWS;

// Dark wood floor palette
const PLANK_PALETTES = [
  ['#2e1c0a', '#3a2410', '#2a180a', '#33200e'],
  ['#231409', '#2c1a0d', '#27170b', '#2a1a0c'],
];

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
  cols: number;  // logical columns (canvas_width / TILE / RENDER_SCALE)
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
    cols: 9,
    rows: 18,
  };

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    // Divide by RENDER_SCALE to get logical coordinates
    const cx = (e.clientX - rect.left) * scaleX / RENDER_SCALE;
    const cy = (e.clientY - rect.top) * scaleY / RENDER_SCALE;

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

export function resizeOffice(office: Office, cssWidth: number, cssHeight: number): void {
  const w = Math.max(Math.round(cssWidth), 64);
  const h = Math.max(Math.round(cssHeight), 64);
  if (office.canvas.width === w && office.canvas.height === h) return;

  office.canvas.width = w;
  office.canvas.height = h;
  office.canvas.getContext('2d')!.imageSmoothingEnabled = false;

  // Logical grid: divide canvas pixels by RENDER_SCALE to get logical tile count
  office.cols = Math.max(2, Math.floor(w / TILE / RENDER_SCALE));
  office.rows = Math.max(2, Math.floor(h / TILE / RENDER_SCALE));

  repositionDesks(office);
}

function repositionDesks(office: Office): void {
  let idx = 0;
  for (const c of office.characters.values()) {
    const { deskX, deskY } = deskPosition(office, idx);
    c.deskX = deskX;
    c.deskY = deskY;
    c.targetX = deskX;
    c.targetY = deskY + TILE;
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
  repositionDesks(office);
}

export function onToolStart(
  office: Office, agentId: string, toolId: string, toolName: string, status: ToolStatus,
): void {
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

  // Max walkable area (logical)
  const maxX = Math.max(0, (office.cols - 2) * TILE);
  const maxY = Math.max(0, (office.rows - 3) * TILE);
  const floorStartY = WALL_ROWS * TILE;

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

    if (c.activity === 'idle' && Math.random() < 0.0005) {
      c.targetX = TILE + Math.floor(Math.random() * maxX);
      c.targetY = floorStartY + Math.floor(Math.random() * (maxY - floorStartY));
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

  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  // All drawing is done in logical coords; ctx.scale(2,2) maps to canvas pixels
  ctx.save();
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  drawFloor(ctx, office);
  drawWalls(ctx, office);
  drawBaseboardShadow(ctx, office);

  const sorted = [...characters.values()].sort((a, b) => a.deskY - b.deskY);
  for (const c of sorted) drawWorkstation(ctx, c, office.pcFrame);

  const sortedByY = [...characters.values()].sort((a, b) => a.y - b.y);
  for (const c of sortedByY) drawCharacter(ctx, c);

  ctx.restore();

  // Empty state overlay (in canvas pixels, not scaled)
  if (characters.size === 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#89b4fa';
    ctx.font = `bold ${Math.max(10, Math.floor(W / 22))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('No active agents', W / 2, H / 2 - 12);
    ctx.fillStyle = '#6c7086';
    ctx.font = `${Math.max(8, Math.floor(W / 30))}px monospace`;
    ctx.fillText('Install Hooks → start your agent', W / 2, H / 2 + 8);
    ctx.textAlign = 'left';
  }
}

// ─── Floor (dark wood planks) ─────────────────────────────────────────────────

function drawFloor(ctx: CanvasRenderingContext2D, office: Office): void {
  const LW = office.cols * TILE;

  for (let row = WALL_ROWS; row < office.rows; row++) {
    const y = row * TILE;
    const palette = PLANK_PALETTES[Math.floor(row / 2) % 2];

    ctx.fillStyle = palette[row % palette.length];
    ctx.fillRect(0, y, LW, TILE - 1);

    // Plank edge (dark line between planks)
    ctx.fillStyle = '#1a0d04';
    ctx.fillRect(0, y + TILE - 1, LW, 1);

    // Vertical joints (staggered between rows)
    const offset = (row % 2) * TILE * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let jx = offset; jx < LW + TILE * 4; jx += TILE * 4) {
      ctx.fillRect(jx, y, 1, TILE - 1);
    }

    // Subtle highlight (grain shimmer)
    ctx.fillStyle = 'rgba(255,190,100,0.04)';
    ctx.fillRect(0, y + 1, LW, 2);
  }
}

// ─── Walls (top office wall with windows) ────────────────────────────────────

function drawWalls(ctx: CanvasRenderingContext2D, office: Office): void {
  const LW = office.cols * TILE;
  const wallH = WALL_ROWS * TILE;

  // Wall background
  ctx.fillStyle = '#1e2d3e';
  ctx.fillRect(0, 0, LW, wallH);

  // Subtle texture lines
  for (let y = 0; y < wallH; y += 5) {
    ctx.fillStyle = y % 10 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, y, LW, 1);
  }

  // Crown moulding
  ctx.fillStyle = '#152230';
  ctx.fillRect(0, 0, LW, 2);

  // Windows
  const winW = 24;
  const winH = wallH - 10;
  for (let wx = 10; wx + winW + 10 <= LW; wx += 44) {
    // Shadow behind frame
    ctx.fillStyle = '#131e28';
    ctx.fillRect(wx - 1, 3, winW + 2, winH + 4);
    // Frame
    ctx.fillStyle = '#3a5678';
    ctx.fillRect(wx, 4, winW, winH);
    // Lower sky pane
    ctx.fillStyle = '#4a7298';
    ctx.fillRect(wx + 2, 6, winW - 4, winH - 2);
    // Lighter upper sky
    ctx.fillStyle = '#5a8aad';
    ctx.fillRect(wx + 2, 6, winW - 4, Math.floor((winH - 2) / 2));
    // Glass sheen
    ctx.fillStyle = 'rgba(200,235,255,0.15)';
    ctx.fillRect(wx + 3, 7, 4, winH - 4);
    // Cross bar (horizontal)
    ctx.fillStyle = '#3a5678';
    ctx.fillRect(wx, 4 + Math.floor(winH / 2), winW, 2);
    // Cross bar (vertical)
    ctx.fillRect(wx + Math.floor(winW / 2) - 1, 4, 2, winH);
  }
}

// ─── Baseboard ────────────────────────────────────────────────────────────────

function drawBaseboardShadow(ctx: CanvasRenderingContext2D, office: Office): void {
  const LW = office.cols * TILE;
  const baseY = WALL_ROWS * TILE;

  ctx.fillStyle = '#5c3d1a';
  ctx.fillRect(0, baseY, LW, 4);
  ctx.fillStyle = '#7a5228';
  ctx.fillRect(0, baseY, LW, 2);
  // Shadow below baseboard
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, baseY + 4, LW, 4);
}

// ─── Workstation ─────────────────────────────────────────────────────────────

function drawWorkstation(ctx: CanvasRenderingContext2D, c: Character, pcFrame: number): void {
  const dx = c.deskX;  // logical x
  const dy = c.deskY;  // logical y
  const isActive = c.activity !== 'idle' && c.activity !== 'waiting';

  // Chair (behind the character, at dy+2*TILE)
  const chairDrawn = drawFurniture(ctx, 'chair_back', dx, dy + TILE * 2);
  if (!chairDrawn) {
    ctx.fillStyle = '#5a3520';
    ctx.fillRect(dx + 2, dy + TILE * 2, 12, 10);
    ctx.fillStyle = '#4a2810';
    ctx.fillRect(dx + 4, dy + TILE + 10, 8, TILE);
  }

  // Desk (DESK_FRONT.png = 48×32 — centred at dx, placed at dy+TILE)
  const deskDrawn = drawFurniture(ctx, 'desk_front', dx - 16, dy + TILE - 2);
  if (!deskDrawn) {
    ctx.fillStyle = '#a07830';
    ctx.fillRect(dx - 16, dy + TILE, 48, 4);
    ctx.fillStyle = '#8a6420';
    ctx.fillRect(dx - 16, dy + TILE + 4, 48, 14);
    ctx.fillStyle = '#6a4a10';
    ctx.fillRect(dx - 14, dy + TILE + 18, 4, 8);
    ctx.fillRect(dx + 26, dy + TILE + 18, 4, 8);
  }

  // PC monitor (PC_FRONT_*.png = 16×32 — placed at dy+2)
  const pcKey = getPcFrame(pcFrame, isActive);
  const pcDrawn = drawFurniture(ctx, pcKey, dx + 2, dy + 2);
  if (!pcDrawn) {
    ctx.fillStyle = isActive ? '#2a3a56' : '#1e1e2e';
    ctx.fillRect(dx + 2, dy + 2, 12, 18);
    ctx.fillStyle = isActive ? '#3a6adf' : '#101018';
    ctx.fillRect(dx + 4, dy + 4, 8, 10);
    if (isActive) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(dx + 5, dy + 5, 3, 8);
    }
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(dx + 6, dy + 20, 4, 4);
    ctx.fillRect(dx + 4, dy + 24, 8, 2);
  }

  // Glow when active
  if (isActive && c.activeTools.size > 0) {
    ctx.globalAlpha = 0.18 + Math.sin(Date.now() / 350) * 0.08;
    ctx.fillStyle = activityGlow(c.activity);
    ctx.fillRect(dx - 16, dy, 48, TILE * 3);
    ctx.globalAlpha = 1;
  }
}

// ─── Character ────────────────────────────────────────────────────────────────

function drawCharacter(ctx: CanvasRenderingContext2D, c: Character): void {
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const w = CHAR_W;
  const h = CHAR_H;

  // Selection ring
  if (c.selected) {
    ctx.strokeStyle = '#f5c2e7';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 1]);
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.setLineDash([]);
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h, w / 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sprite (scale=1 because ctx is already scaled 2× globally)
  const spriteDrawn = drawCharacterSprite(ctx, c.palette, c.direction, c.frame, x, y, 1);
  if (!spriteDrawn) {
    ctx.fillStyle = activityGlow(c.activity);
    ctx.fillRect(x + 2, y, w - 4, h);
    ctx.fillStyle = '#FFCBA4';
    ctx.fillRect(x + 3, y, w - 6, 10);
  }

  // Activity badge
  const badge = activityBadge(c.activity);
  if (badge) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x + 3, y - 8, 10, 7);
    ctx.font = '6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(badge, x + w / 2, y - 3);
    ctx.textAlign = 'left';
  }

  // Name label
  const label = c.name.length > 9 ? c.name.slice(0, 8) + '…' : c.name;
  const lw = label.length * 4 + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(x + w / 2 - lw / 2, y + h + 1, lw, 7);
  ctx.fillStyle = c.selected ? '#f5c2e7' : '#ddd';
  ctx.font = '5px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h + 6);
  ctx.textAlign = 'left';

  // Speech bubble
  if (c.speechBubble) {
    const txt = c.speechBubble.text;
    const bw = Math.min(txt.length * 4 + 8, 60);
    const bx = Math.max(1, x + w / 2 - bw / 2);
    const by = y - 18;
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, bw, 11);
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(bx, by, bw, 11);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w / 2 - 2, by + 10, 4, 3);
    ctx.fillStyle = '#333';
    ctx.font = '5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(txt, bx + bw / 2, by + 7);
    ctx.textAlign = 'left';
  }

  // Token usage bar
  const usage = Math.min((c.inputTokens + c.outputTokens) / 200_000, 1);
  if (usage > 0) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(x, y + h + 9, w, 2);
    ctx.fillStyle = usage > 0.8 ? '#f38ba8' : usage > 0.5 ? '#fab387' : '#a6e3a1';
    ctx.fillRect(x, y + h + 9, Math.round(w * usage), 2);
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
