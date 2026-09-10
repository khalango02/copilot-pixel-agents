import { hitTestCharacter, renderIsometric } from './isometric.js';
import { loadSprites } from './sprites.js';
import type { ToolHistoryEntry, ToolStatus } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE = 16;
const MAX_HISTORY = 50;

const FLOOR_START_Y = 2 * TILE;

// Idle leisure timings
const IDLE_WANDER_MS = 10_000;      // after this long idle, consider leisure
const LEISURE_MIN_MS = 15_000;      // minimum time at leisure spot
const LEISURE_MAX_MS = 35_000;      // maximum time at leisure spot
const LEISURE_CHANCE = 0.45;        // probability of picking leisure vs staying at desk
const CHAR_MIN_SEPARATION = 20;     // min px between characters — prevents sprite stacking while wandering


// ─── Types ────────────────────────────────────────────────────────────────────

export type CharacterActivity =
  | 'idle' | 'walking' | 'typing' | 'reading' | 'waiting'
  | 'running' | 'searching'
  | 'gaming' | 'watching_tv' | 'coffee_break';

export type LeisureType = 'gaming' | 'tv' | 'coffee';

export interface Character {
  id: string;
  name: string;
  // Logical world position; the renderer projects feet at (x + 8, y + 12).
  x: number; y: number;
  targetX: number; targetY: number;
  deskX: number; deskY: number;
  activity: CharacterActivity;
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  toolHistory: ToolHistoryEntry[];
  palette: number;
  frame: number; frameTimer: number;
  direction: 'left' | 'right' | 'up' | 'down';
  inputTokens: number; outputTokens: number;
  sessionStartedAt: number;
  speechBubble?: { text: string; expiresAt: number };
  selected: boolean;
  // Leisure system
  idleGoal: LeisureType | 'desk' | null;
  idleTimer: number;       // ms until next idle action
  leisureTimer: number;    // ms remaining in leisure activity
}

interface Pet {
  x: number; y: number;
  targetX: number; targetY: number;
  direction: 'left' | 'right';
  frame: number; frameTimer: number;
  isSitting: boolean;
  sitTimer: number;    // ms until next sit/unsit toggle
  color: 'orange' | 'gray';
}

interface LeisureSpot {
  type: LeisureType;
  itemX: number; itemY: number;
  standX: number; standY: number;
  occupant: string | null;
}

export interface Office {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  characters: Map<string, Character>;
  animFrameId: number;
  lastTimestamp: number;
  pcFrame: number; pcFrameTimer: number;
  cols: number; rows: number;
  zoom: number;
  // Canvas pixels, equivalent to CSS pixels at the current 1:1 resolution.
  panX: number; panY: number;
  onCharacterClick?: (id: string) => void;
  pet: Pet;
  leisureSpots: LeisureSpot[];
  elapsedTime: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let nextPaletteIndex = 0;

export function createOffice(canvas: HTMLCanvasElement): Office {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const pet: Pet = {
    x: 80, y: 80,
    targetX: 80, targetY: 80,
    direction: 'right',
    frame: 0, frameTimer: 0,
    isSitting: true,
    sitTimer: 4000,
    color: 'orange',
  };

  const office: Office = {
    canvas, ctx,
    characters: new Map(),
    animFrameId: 0,
    lastTimestamp: 0,
    pcFrame: 0, pcFrameTimer: 0,
    cols: 14, rows: 16,
    zoom: 1, panX: 0, panY: 0,
    pet,
    leisureSpots: [],
    elapsedTime: 0,
  };

  let pointerId: number | null = null;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;
  let dragging = false;
  let suppressClick = false;

  const movePointer = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) <= 4) return;
    dragging = true;
    suppressClick = true;
    canvas.classList.add('dragging');
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      office.panX += (e.clientX - lastX) * canvas.width / rect.width;
      office.panY += (e.clientY - lastY) * canvas.height / rect.height;
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const resetPointer = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const capturedId = e.pointerId;
    pointerId = null;
    dragging = false;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(capturedId)) canvas.releasePointerCapture(capturedId);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    dragging = false;
    suppressClick = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', (e) => {
    movePointer(e);
    resetPointer(e);
  });
  canvas.addEventListener('pointercancel', resetPointer);
  canvas.addEventListener('lostpointercapture', resetPointer);

  canvas.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = (e.clientX - rect.left) * canvas.width / rect.width;
    const cy = (e.clientY - rect.top) * canvas.height / rect.height;
    const hit = hitTestCharacter(office, cx, cy);
    for (const c of office.characters.values()) c.selected = c === hit;
    office.onCharacterClick?.(hit?.id ?? '');
  });

  computeLeisureSpots(office);
  loadSprites();
  return office;
}

// ─── Resize & Layout ──────────────────────────────────────────────────────────

export function resizeOffice(office: Office, cssWidth: number, cssHeight: number): void {
  const w = Math.max(Math.round(cssWidth), 64);
  const h = Math.max(Math.round(cssHeight), 64);
  if (office.canvas.width === w && office.canvas.height === h) return;

  office.canvas.width = w;
  office.canvas.height = h;
  office.ctx.imageSmoothingEnabled = false;
  // Viewport resizing never changes logical layout, occupancy or work.
}

export function setOfficeZoom(office: Office, zoom: number): void {
  if (Number.isNaN(zoom)) return;
  office.zoom = clamp(zoom, 0.5, 3);
}

export function resetOfficeView(office: Office): void {
  office.zoom = 1;
  office.panX = 0;
  office.panY = 0;
}

function refreshRoomLayout(office: Office): void {
  office.cols = 14;
  office.rows = Math.max(16, 10 + Math.ceil(office.characters.size / 2) * 4);
  computeLeisureSpots(office);
  repositionDesks(office);

  const maxX = (office.cols - 2) * TILE;
  const maxY = (office.rows - 2) * TILE;
  for (const c of office.characters.values()) {
    c.x = clamp(c.x, TILE, maxX);
    c.y = clamp(c.y, FLOOR_START_Y, maxY);
    c.targetX = clamp(c.targetX, TILE, maxX);
    c.targetY = clamp(c.targetY, FLOOR_START_Y, maxY);
  }
  const petMaxX = (office.cols - 3) * TILE;
  const petMinY = FLOOR_START_Y + TILE;
  office.pet.x = clamp(office.pet.x, TILE, petMaxX);
  office.pet.y = clamp(office.pet.y, petMinY, maxY);
  office.pet.targetX = clamp(office.pet.targetX, TILE, petMaxX);
  office.pet.targetY = clamp(office.pet.targetY, petMinY, maxY);
}

function computeLeisureSpots(office: Office): void {
  const coffeeX = (office.cols - 3) * TILE;
  const leisureY = (office.rows - 4) * TILE;
  const tvX = (office.cols - 6) * TILE;
  const spots: LeisureSpot[] = [
    { type: 'coffee', itemX: coffeeX, itemY: 28, standX: coffeeX - 8, standY: 46, occupant: null },
    { type: 'gaming', itemX: 20, itemY: leisureY, standX: 30, standY: leisureY + 14, occupant: null },
    { type: 'tv', itemX: tvX, itemY: leisureY, standX: tvX + 18, standY: leisureY + 18, occupant: null },
  ];

  for (const spot of spots) {
    const previous = office.leisureSpots.find((s) => s.type === spot.type);
    spot.occupant = previous?.occupant ?? null;
    if (spot.occupant === null) continue;
    const c = office.characters.get(spot.occupant);
    if (!c) {
      spot.occupant = null;
      continue;
    }
    if (c.idleGoal === spot.type) {
      c.targetX = spot.standX;
      c.targetY = spot.standY;
      if (c.activity !== 'walking') {
        c.x = spot.standX;
        c.y = spot.standY;
      }
    }
  }

  office.leisureSpots = spots;
}

function repositionDesks(office: Office): void {
  let idx = 0;
  for (const c of office.characters.values()) {
    const { deskX, deskY } = deskPosition(idx);
    c.deskX = deskX;
    c.deskY = deskY;
    if (c.activeTools.size > 0 || c.activity === 'waiting') {
      c.x = c.targetX = deskX;
      c.y = c.targetY = deskY + TILE;
    } else if (c.idleGoal === 'desk' || c.idleGoal === null) {
      c.targetX = deskX;
      c.targetY = deskY + TILE;
      if (c.activity !== 'walking') {
        c.x = deskX;
        c.y = deskY + TILE;
      }
    }
    idx++;
  }
}

function deskPosition(idx: number): { deskX: number; deskY: number } {
  return {
    deskX: (3 + (idx % 2) * 5) * TILE,
    deskY: (4 + Math.floor(idx / 2) * 4) * TILE,
  };
}

// ─── Character management ─────────────────────────────────────────────────────

export function addCharacter(office: Office, id: string, name: string): void {
  if (office.characters.has(id)) return;
  const idx = office.characters.size;
  const { deskX, deskY } = deskPosition(idx);
  office.characters.set(id, {
    id, name,
    x: deskX, y: deskY + TILE,
    targetX: deskX, targetY: deskY + TILE,
    deskX, deskY,
    activity: 'idle',
    activeTools: new Map(),
    toolHistory: [],
    palette: nextPaletteIndex++ % 6,
    frame: 0, frameTimer: 0,
    direction: 'down',
    inputTokens: 0, outputTokens: 0,
    sessionStartedAt: Date.now(),
    selected: false,
    idleGoal: null,
    idleTimer: IDLE_WANDER_MS * (0.5 + Math.random()),
    leisureTimer: 0,
  });
  refreshRoomLayout(office);
}

export function removeCharacter(office: Office, id: string): void {
  if (!office.characters.delete(id)) return;
  freeSpotsFor(office, id);
  refreshRoomLayout(office);
}

export function onToolStart(
  office: Office, agentId: string, toolId: string, toolName: string, status: ToolStatus,
): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  // Snap back to desk immediately — no wandering while working
  freeSpotsFor(office, agentId);
  c.idleGoal = null;
  c.x = c.deskX;
  c.y = c.deskY + TILE;
  c.targetX = c.deskX;
  c.targetY = c.deskY + TILE;
  c.activeTools.set(toolId, { name: toolName, status });
  c.activity = toolStatusToActivity(status);
  c.direction = 'up';
  c.speechBubble = { text: shortToolName(toolName), expiresAt: Date.now() + 3500 };
  c.toolHistory.unshift({ toolId, toolName, status, startedAt: Date.now() });
  if (c.toolHistory.length > MAX_HISTORY) c.toolHistory.length = MAX_HISTORY;
  // Reset idle timer so they don't immediately dash to leisure after work ends
  c.idleTimer = IDLE_WANDER_MS * (1 + Math.random());
}

export function onToolDone(office: Office, agentId: string, toolId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  const entry = c.toolHistory.find((e) => e.toolId === toolId && !e.finishedAt);
  if (entry) entry.finishedAt = Date.now();
  c.activeTools.delete(toolId);
  if (c.activeTools.size === 0) {
    c.activity = 'idle';
    c.direction = 'down';
    c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
  } else {
    c.activity = toolStatusToActivity([...c.activeTools.values()][0].status);
  }
}

export function setWaiting(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  freeSpotsFor(office, agentId);
  c.activity = 'waiting';
  c.direction = 'down';
  c.idleGoal = null;
  c.speechBubble = { text: '?', expiresAt: Date.now() + 15000 };
}

export function setIdle(office: Office, agentId: string): void {
  const c = office.characters.get(agentId);
  if (!c) return;
  c.activity = 'idle';
  c.direction = 'down';
  c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

export function startLoop(office: Office): void {
  function tick(ts: number) {
    const dt = Math.min(ts - office.lastTimestamp, 100);
    office.lastTimestamp = ts;
    update(office, dt);
    renderIsometric(office);
    office.animFrameId = requestAnimationFrame(tick);
  }
  office.animFrameId = requestAnimationFrame(tick);
}

export function stopLoop(office: Office): void {
  cancelAnimationFrame(office.animFrameId);
}

// ─── Update ───────────────────────────────────────────────────────────────────

function update(office: Office, dt: number): void {
  office.elapsedTime += dt;

  // PC animation
  office.pcFrameTimer += dt;
  if (office.pcFrameTimer >= 400) {
    office.pcFrameTimer = 0;
    office.pcFrame = (office.pcFrame + 1) % 3;
  }

  updatePet(office, dt);

  const maxX = Math.max(0, (office.cols - 2) * TILE);
  const maxY = Math.max(0, (office.rows - 2) * TILE);
  const floorStartY = FLOOR_START_Y;

  for (const c of office.characters.values()) {
    updateCharacterAnimation(c, dt);
    updateCharacterMovement(c, dt);

    // Only run idle behavior when character has no work
    if (c.activeTools.size === 0 && c.activity !== 'waiting') {
      updateIdleBehavior(office, c, dt, maxX, maxY, floorStartY);
    }

    if (c.speechBubble && Date.now() > c.speechBubble.expiresAt) c.speechBubble = undefined;
  }
}

function updateCharacterAnimation(c: Character, dt: number): void {
  c.frameTimer += dt;
  const fps = c.activity === 'idle' ? 3 : 8;
  if (c.frameTimer >= 1000 / fps) {
    c.frameTimer = 0;
    c.frame = (c.frame + 1) % 4;
  }
}

function updateCharacterMovement(c: Character, dt: number): void {
  if (c.activity !== 'walking') return;
  const speed = 55 * (dt / 1000);
  const dx = c.targetX - c.x;
  const dy = c.targetY - c.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= speed) {
    c.x = c.targetX;
    c.y = c.targetY;
    // Arrived — resolve pending goal
    if (c.idleGoal === 'desk' || c.idleGoal === null) {
      c.activity = 'idle';
      c.direction = 'down';
    } else if (c.idleGoal) {
      c.activity = goalToActivity(c.idleGoal);
      c.direction = 'down';
      c.speechBubble = { text: goalBubble(c.idleGoal), expiresAt: Date.now() + c.leisureTimer };
    }
  } else {
    c.x += (dx / dist) * speed;
    c.y += (dy / dist) * speed;
    const sx = dx - dy;
    const sy = (dx + dy) * 0.5;
    c.direction = Math.abs(sx) > Math.abs(sy)
      ? (sx > 0 ? 'right' : 'left')
      : (sy > 0 ? 'down' : 'up');
  }
}

function updateIdleBehavior(
  office: Office, c: Character, dt: number,
  maxX: number, maxY: number, floorStartY: number,
): void {
  // Countdown idle timer
  if (c.idleTimer > 0) {
    c.idleTimer -= dt;
  }

  // If doing leisure, count down leisure timer
  if (c.idleGoal && c.idleGoal !== 'desk' && c.activity !== 'walking') {
    c.leisureTimer -= dt;
    if (c.leisureTimer <= 0) {
      // Done — go back to desk
      freeSpotsFor(office, c.id);
      c.idleGoal = 'desk';
      c.activity = 'walking';
      c.targetX = c.deskX;
      c.targetY = c.deskY + TILE;
      c.speechBubble = undefined;
      c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
    }
    return;
  }

  // Don't trigger if already moving or in leisure
  if (c.activity === 'walking') return;
  if (c.idleGoal && c.idleGoal !== 'desk') return;

  // Random idle wander at desk
  if (c.activity === 'idle' && c.idleGoal === null && Math.random() < 0.0003) {
    let wx = 0, wy = 0, found = false;
    for (let i = 0; i < 8; i++) {
      wx = clamp(TILE + Math.floor(Math.random() * (maxX - TILE + 1)), TILE, maxX);
      const minY = floorStartY + TILE;
      wy = clamp(minY + Math.floor(Math.random() * (maxY - minY + 1)), minY, maxY);
      if (!tooCloseToOtherCharacters(office, wx, wy, c.id)) { found = true; break; }
    }
    if (found) {
      c.targetX = wx;
      c.targetY = wy;
      c.activity = 'walking';
    }
    return;
  }

  // When idle timer expires, consider leisure
  if (c.idleTimer <= 0 && c.activity === 'idle') {
    if (Math.random() < LEISURE_CHANCE && office.leisureSpots.length > 0) {
      // Pick an available leisure spot
      const available = office.leisureSpots.filter((s) => s.occupant === null);
      if (available.length > 0) {
        const spot = available[Math.floor(Math.random() * available.length)];
        spot.occupant = c.id;
        c.idleGoal = spot.type;
        c.leisureTimer = LEISURE_MIN_MS + Math.random() * (LEISURE_MAX_MS - LEISURE_MIN_MS);
        c.targetX = spot.standX;
        c.targetY = spot.standY;
        c.activity = 'walking';
        return;
      }
    }
    // Reset timer even if we didn't go anywhere
    c.idleTimer = IDLE_WANDER_MS * (0.5 + Math.random());
  }

}

function freeSpotsFor(office: Office, agentId: string): void {
  for (const spot of office.leisureSpots) {
    if (spot.occupant === agentId) spot.occupant = null;
  }
}

// Checks candidate point against every other character's current (or, if walking, target)
// position so idle wandering never sends two agents to the same spot on screen.
function tooCloseToOtherCharacters(office: Office, x: number, y: number, excludeId: string): boolean {
  for (const other of office.characters.values()) {
    if (other.id === excludeId) continue;
    const ox = other.activity === 'walking' ? other.targetX : other.x;
    const oy = other.activity === 'walking' ? other.targetY : other.y;
    const dx = x - ox;
    const dy = y - oy;
    if (dx * dx + dy * dy < CHAR_MIN_SEPARATION * CHAR_MIN_SEPARATION) return true;
  }
  return false;
}

function furnitureZones(office: Office): Array<{ x: number; y: number; w: number; h: number }> {
  return office.leisureSpots.filter((spot) => spot.type !== 'coffee').map((spot) => ({
    x: spot.itemX,
    y: spot.itemY - (spot.type === 'tv' ? 4 : 0),
    w: spot.type === 'tv' ? 65 : 54,
    h: spot.type === 'tv' ? 58 : 50,
  }));
}

function petInZone(px: number, py: number, zones: Array<{ x: number; y: number; w: number; h: number }>): boolean {
  const pw = 12, ph = 16;
  for (const z of zones) {
    if (px + pw > z.x && px < z.x + z.w && py + ph > z.y && py < z.y + z.h) return true;
  }
  return false;
}

function updatePet(office: Office, dt: number): void {
  const pet = office.pet;
  const floorY = FLOOR_START_Y + TILE;
  const maxX = Math.max(TILE, (office.cols - 3) * TILE);
  const maxY = Math.max(floorY + TILE, (office.rows - 2) * TILE);
  const zones = furnitureZones(office);

  // Frame animation
  pet.frameTimer += dt;
  const fps = pet.isSitting ? 1 : 5;
  if (pet.frameTimer >= 1000 / fps) {
    pet.frameTimer = 0;
    pet.frame = (pet.frame + 1) % 2;
  }

  // Sit/stand timer
  pet.sitTimer -= dt;
  if (pet.sitTimer <= 0) {
    pet.isSitting = !pet.isSitting;
    pet.sitTimer = pet.isSitting
      ? 3000 + Math.random() * 5000    // sit for 3-8s
      : 2000 + Math.random() * 4000;   // walk for 2-6s
    if (!pet.isSitting) {
      // Pick new target, retry up to 10 times to avoid furniture zones
      let tx = 0, ty = 0;
      for (let i = 0; i < 10; i++) {
        tx = Math.max(TILE, Math.min(maxX, TILE + Math.floor(Math.random() * maxX)));
        ty = Math.max(floorY, Math.min(maxY, floorY + Math.floor(Math.random() * (maxY - floorY))));
        if (!petInZone(tx, ty, zones)) break;
      }
      pet.targetX = tx;
      pet.targetY = ty;
    }
  }

  // Move if walking
  if (!pet.isSitting) {
    const speed = 35 * (dt / 1000);
    const dx = pet.targetX - pet.x;
    const dy = pet.targetY - pet.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= speed) {
      pet.x = pet.targetX;
      pet.y = pet.targetY;
      pet.isSitting = true;
      pet.sitTimer = 2000 + Math.random() * 4000;
    } else {
      const newX = pet.x + (dx / dist) * speed;
      const newY = pet.y + (dy / dist) * speed;
      if (petInZone(newX, newY, zones)) {
        // Hit furniture — sit and pick new target next cycle
        pet.isSitting = true;
        pet.sitTimer = 500 + Math.random() * 1000;
      } else {
        pet.x = newX;
        pet.y = newY;
        pet.direction = dx - dy >= 0 ? 'right' : 'left';
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function goalToActivity(goal: LeisureType): CharacterActivity {
  switch (goal) {
    case 'gaming': return 'gaming';
    case 'tv': return 'watching_tv';
    case 'coffee': return 'coffee_break';
  }
}

function goalBubble(goal: LeisureType): string {
  switch (goal) {
    case 'gaming': return 'GG EZ';
    case 'tv': return '📺';
    case 'coffee': return '☕ ahhh';
  }
}

function shortToolName(name: string): string {
  const n = name.replace(/([A-Z])/g, ' $1').trim();
  return n.length > 11 ? n.slice(0, 10) + '…' : n;
}
