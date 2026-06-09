import type { ToolStatus } from './types.js';

export type CharacterActivity = 'idle' | 'walking' | 'typing' | 'reading' | 'waiting' | 'running' | 'searching';

const TILE = 16;
const OFFICE_COLS = 20;
const OFFICE_ROWS = 12;

const PALETTE: Record<number, { skin: string; hair: string; shirt: string; pants: string }> = {
  0: { skin: '#FFCBA4', hair: '#4A3728', shirt: '#6B8CFF', pants: '#444' },
  1: { skin: '#F5CBA7', hair: '#1A1A2E', shirt: '#FF6B6B', pants: '#333' },
  2: { skin: '#D4A574', hair: '#8B4513', shirt: '#6BCB77', pants: '#555' },
  3: { skin: '#C68642', hair: '#2C1810', shirt: '#FFD93D', pants: '#445' },
  4: { skin: '#8D5524', hair: '#000000', shirt: '#C77DFF', pants: '#333' },
  5: { skin: '#FFECB3', hair: '#FFCC02', shirt: '#00B4D8', pants: '#222' },
};

export interface Character {
  id: string;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  activity: CharacterActivity;
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  palette: number;
  frame: number;
  frameTimer: number;
  direction: 'left' | 'right';
  inputTokens: number;
  outputTokens: number;
  speechBubble?: { text: string; expiresAt: number };
}

export interface Office {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  characters: Map<string, Character>;
  animFrameId: number;
  lastTimestamp: number;
}

let nextPaletteIndex = 0;

export function createOffice(canvas: HTMLCanvasElement): Office {
  const ctx = canvas.getContext('2d')!;
  canvas.width = OFFICE_COLS * TILE;
  canvas.height = OFFICE_ROWS * TILE;
  return {
    canvas,
    ctx,
    characters: new Map(),
    animFrameId: 0,
    lastTimestamp: 0,
  };
}

export function addCharacter(office: Office, id: string, name: string): void {
  const col = 2 + (office.characters.size % (OFFICE_COLS - 4));
  const row = 2 + Math.floor(office.characters.size / (OFFICE_COLS - 4)) % (OFFICE_ROWS - 4);
  const char: Character = {
    id,
    name,
    x: col * TILE,
    y: row * TILE,
    targetX: col * TILE,
    targetY: row * TILE,
    activity: 'idle',
    activeTools: new Map(),
    palette: nextPaletteIndex++ % Object.keys(PALETTE).length,
    frame: 0,
    frameTimer: 0,
    direction: 'right',
    inputTokens: 0,
    outputTokens: 0,
  };
  office.characters.set(id, char);
}

export function removeCharacter(office: Office, id: string): void {
  office.characters.delete(id);
}

export function setCharacterActivity(office: Office, id: string, activity: CharacterActivity): void {
  const c = office.characters.get(id);
  if (!c) return;
  c.activity = activity;

  if (activity === 'walking') {
    const col = 1 + Math.floor(Math.random() * (OFFICE_COLS - 2));
    const row = 1 + Math.floor(Math.random() * (OFFICE_ROWS - 2));
    c.targetX = col * TILE;
    c.targetY = row * TILE;
    c.direction = c.targetX > c.x ? 'right' : 'left';
  }
}

export function onToolStart(
  office: Office,
  agentId: string,
  toolId: string,
  toolName: string,
  status: ToolStatus,
): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activeTools.set(toolId, { name: toolName, status });
  c.activity = toolStatusToActivity(status);
  c.speechBubble = { text: toolLabel(toolName), expiresAt: Date.now() + 3000 };
}

export function onToolDone(office: Office, agentId: string, toolId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activeTools.delete(toolId);
  if (c.activeTools.size === 0) {
    c.activity = 'idle';
  } else {
    const next = [...c.activeTools.values()][0];
    c.activity = toolStatusToActivity(next.status);
  }
}

export function setWaiting(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activity = 'waiting';
  c.speechBubble = { text: '?', expiresAt: Date.now() + 10000 };
}

export function setIdle(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activity = 'idle';
}

export function startLoop(office: Office): void {
  function tick(timestamp: number) {
    const dt = Math.min(timestamp - office.lastTimestamp, 100);
    office.lastTimestamp = timestamp;
    update(office, dt);
    render(office);
    office.animFrameId = requestAnimationFrame(tick);
  }
  office.animFrameId = requestAnimationFrame(tick);
}

export function stopLoop(office: Office): void {
  cancelAnimationFrame(office.animFrameId);
}

function update(office: Office, dt: number): void {
  for (const c of office.characters.values()) {
    // Frame animation
    c.frameTimer += dt;
    const fps = c.activity === 'idle' ? 4 : 8;
    if (c.frameTimer >= 1000 / fps) {
      c.frameTimer = 0;
      c.frame = (c.frame + 1) % 4;
    }

    // Walking movement
    if (c.activity === 'walking') {
      const speed = 60 * (dt / 1000);
      const dx = c.targetX - c.x;
      const dy = c.targetY - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < speed) {
        c.x = c.targetX;
        c.y = c.targetY;
        c.activity = 'idle';
      } else {
        c.x += (dx / dist) * speed;
        c.y += (dy / dist) * speed;
        c.direction = dx > 0 ? 'right' : 'left';
      }
    }

    // Random idle walk
    if (c.activity === 'idle' && Math.random() < 0.001) {
      setCharacterActivity(office, c.id, 'walking');
    }

    // Expire speech bubble
    if (c.speechBubble && Date.now() > c.speechBubble.expiresAt) {
      c.speechBubble = undefined;
    }
  }
}

function render(office: Office): void {
  const { ctx, canvas, characters } = office;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Floor
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = '#2a2a3e';
  ctx.lineWidth = 0.5;
  for (let col = 0; col <= OFFICE_COLS; col++) {
    ctx.beginPath();
    ctx.moveTo(col * TILE, 0);
    ctx.lineTo(col * TILE, canvas.height);
    ctx.stroke();
  }
  for (let row = 0; row <= OFFICE_ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(0, row * TILE);
    ctx.lineTo(canvas.width, row * TILE);
    ctx.stroke();
  }

  // Desks (one per character)
  let deskIndex = 0;
  for (const c of characters.values()) {
    const deskX = (2 + (deskIndex % (OFFICE_COLS - 4))) * TILE;
    const deskY = (2 + Math.floor(deskIndex / (OFFICE_COLS - 4)) % (OFFICE_ROWS - 4)) * TILE;
    drawDesk(ctx, deskX, deskY);
    deskIndex++;
  }

  // Characters
  for (const c of characters.values()) {
    drawCharacter(ctx, c);
  }

  // Empty state
  if (characters.size === 0) {
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No active agents', canvas.width / 2, canvas.height / 2 - 8);
    ctx.fillStyle = '#444';
    ctx.font = '9px monospace';
    ctx.fillText('Run: Copilot Pixel Agents: Install Hooks', canvas.width / 2, canvas.height / 2 + 8);
    ctx.textAlign = 'left';
  }
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#3a2a1a';
  ctx.fillRect(x - 2, y + 4, TILE + 4, TILE - 4);
  ctx.fillStyle = '#2a6b2a';
  ctx.fillRect(x, y + 5, TILE, 6);
  // Monitor
  ctx.fillStyle = '#111';
  ctx.fillRect(x + 3, y, 10, 7);
  ctx.fillStyle = '#3a8fff44';
  ctx.fillRect(x + 4, y + 1, 8, 5);
}

function drawCharacter(ctx: CanvasRenderingContext2D, c: Character): void {
  const pal = PALETTE[c.palette];
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const bobY = c.activity !== 'idle' ? Math.sin(c.frame * Math.PI / 2) * 1 : 0;
  const flip = c.direction === 'left';

  ctx.save();
  if (flip) {
    ctx.translate(x + TILE / 2, y);
    ctx.scale(-1, 1);
    ctx.translate(-TILE / 2, 0);
  } else {
    ctx.translate(x, y);
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(8, 15, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = pal.pants;
  if (c.activity === 'walking') {
    ctx.fillRect(5, 10 + bobY, 2, 5 + (c.frame % 2 === 0 ? 1 : -1));
    ctx.fillRect(8, 10 + bobY, 2, 5 + (c.frame % 2 === 0 ? -1 : 1));
  } else {
    ctx.fillRect(5, 10, 2, 5);
    ctx.fillRect(8, 10, 2, 5);
  }

  // Body
  ctx.fillStyle = activityColor(c.activity, pal.shirt);
  ctx.fillRect(4, 5 + bobY, 8, 7);

  // Arms
  ctx.fillStyle = pal.shirt;
  if (c.activity === 'typing' || c.activity === 'writing') {
    ctx.fillRect(2, 7 + bobY, 2, 4);
    ctx.fillRect(12, 7 + bobY, 2, 4);
  } else {
    ctx.fillRect(2, 6 + bobY, 2, 5);
    ctx.fillRect(12, 6 + bobY, 2, 5);
  }

  // Head
  ctx.fillStyle = pal.skin;
  ctx.fillRect(4, 1 + bobY, 8, 6);

  // Hair
  ctx.fillStyle = pal.hair;
  ctx.fillRect(4, 1 + bobY, 8, 2);

  // Eyes
  ctx.fillStyle = '#000';
  ctx.fillRect(6, 4 + bobY, 1, 1);
  ctx.fillRect(9, 4 + bobY, 1, 1);

  // Activity badge
  const badge = activityBadge(c.activity);
  if (badge) {
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(2, -6 + bobY, 12, 7);
    ctx.fillStyle = '#fff';
    ctx.fillText(badge, 8, -1 + bobY);
    ctx.textAlign = 'left';
  }

  ctx.restore();

  // Name label
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const nameLabel = c.name.length > 8 ? c.name.slice(0, 7) + '…' : c.name;
  const labelW = nameLabel.length * 5 + 4;
  ctx.fillRect(x + TILE / 2 - labelW / 2, y + TILE + 1, labelW, 8);
  ctx.fillStyle = '#eee';
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(nameLabel, x + TILE / 2, y + TILE + 8);
  ctx.textAlign = 'left';

  // Speech bubble
  if (c.speechBubble) {
    const text = c.speechBubble.text.length > 10 ? c.speechBubble.text.slice(0, 9) + '…' : c.speechBubble.text;
    const bw = text.length * 5 + 8;
    const bx = x + TILE / 2 - bw / 2;
    const by = y - 18;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(bx, by, bw, 10);
    ctx.fillStyle = '#111';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + TILE / 2, by + 8);
    ctx.textAlign = 'left';
  }

  // Token bar
  const maxTokens = 200000;
  const usage = (c.inputTokens + c.outputTokens) / maxTokens;
  if (usage > 0) {
    const barW = TILE;
    ctx.fillStyle = '#222';
    ctx.fillRect(x, y - 3, barW, 2);
    const color = usage > 0.8 ? '#ff4444' : usage > 0.5 ? '#ffaa00' : '#44ff88';
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 3, Math.min(barW * usage, barW), 2);
  }
}

function toolStatusToActivity(status: ToolStatus): CharacterActivity {
  switch (status) {
    case 'reading': return 'reading';
    case 'writing': return 'typing';
    case 'running': return 'running';
    case 'searching': return 'searching';
    default: return 'typing';
  }
}

function activityColor(activity: CharacterActivity, base: string): string {
  switch (activity) {
    case 'typing': return '#5599ff';
    case 'writing': return '#5599ff';
    case 'reading': return '#55cc99';
    case 'running': return '#ff9955';
    case 'searching': return '#cc55ff';
    case 'waiting': return '#ffdd55';
    default: return base;
  }
}

function activityBadge(activity: CharacterActivity): string {
  switch (activity) {
    case 'typing': return '⌨';
    case 'writing': return '✏';
    case 'reading': return '📖';
    case 'running': return '⚙';
    case 'searching': return '🔍';
    case 'waiting': return '⏳';
    case 'walking': return '→';
    default: return '';
  }
}

function toolLabel(toolName: string): string {
  const n = toolName.replace(/([A-Z])/g, ' $1').trim();
  return n.length > 12 ? n.slice(0, 11) + '…' : n;
}
