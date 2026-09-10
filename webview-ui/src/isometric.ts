import type { Character, CharacterActivity, Office } from './engine.js';
import { drawCharacterSprite } from './sprites.js';

// World coordinates stay on the floor. Height is a separate axis so sprites
// remain upright instead of being flattened by a transform of the whole canvas.
type Point = { x: number; y: number };
type Surface = readonly [string, string, string];
const WALL_HEIGHT = 52;
const WOOD: Surface = ['#dbb98c', '#a67c58', '#be9469'];
const DARK: Surface = ['#48566c', '#222e42', '#324057'];
const TEAL: Surface = ['#78b5b0', '#3a737c', '#508f97'];
const COLORS = ['#a8c7fa', '#e6add5', '#f2cc8f', '#95d5b2', '#c2aff2', '#f2a6a0'];

export function project(x: number, y: number, z = 0): Point {
  return { x: x - y, y: (x + y) * 0.5 - z };
}

export function officeCamera(office: Office): { x: number; y: number; scale: number } {
  const w = office.cols * 16;
  const d = office.rows * 16;
  const span = w + d;
  const height = span * 0.5 + WALL_HEIGHT + 12;
  const scale = Math.max(0.05, Math.min(3, (office.canvas.width - 32) / span,
    (office.canvas.height - 100) / height)) * office.zoom;
  return {
    x: office.canvas.width / 2 - (w - d) * 0.5 * scale + office.panX,
    y: office.canvas.height / 2 - (span * 0.25 - WALL_HEIGHT * 0.5 + 6) * scale + office.panY,
    scale,
  };
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[], fill: string): void {
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function plane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, z: number, fill: string): void {
  polygon(ctx, [project(x, y, z), project(x + w, y, z), project(x + w, y + d, z), project(x, y + d, z)], fill);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, colors: Surface, z = 0): void {
  const a = project(x, y + d, z), b = project(x + w, y + d, z), c = project(x + w, y, z);
  const at = project(x, y + d, z + h), bt = project(x + w, y + d, z + h), ct = project(x + w, y, z + h);
  polygon(ctx, [a, b, bt, at], colors[1]);
  polygon(ctx, [b, c, ct, bt], colors[2]);
  plane(ctx, x, y, w, d, z + h, colors[0]);
}

// Front-facing vertical surface: used for windows, monitors and shelf contents.
function front(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, bottom: number, height: number, color: string): void {
  polygon(ctx, [project(x, y, bottom), project(x + w, y, bottom),
    project(x + w, y, bottom + height), project(x, y, bottom + height)], color);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number): void {
  plane(ctx, x + 3, y + 4, w, d, 0.1, 'rgba(22,35,52,0.13)');
}

function room(ctx: CanvasRenderingContext2D, office: Office): void {
  const w = office.cols * 16, d = office.rows * 16;
  // Floating foundation, with a soft stepped shadow underneath.
  for (let i = 5; i > 0; i--) {
    plane(ctx, -i * 2, -i * 2, w + i * 4, d + i * 4, -12 - i,
      `rgba(0,0,0,${0.025 + (5 - i) * 0.007})`);
  }
  box(ctx, 0, 0, w, d, 10, ['#b0bfc1', '#35455e', '#4a6079'], -10);
  for (let row = 0; row < office.rows; row++) {
    for (let col = 0; col < office.cols; col++) {
      const colors = ['#b4c8c6', '#bcd0cb', '#b8ccc8', '#bfd2cd'];
      plane(ctx, col * 16, row * 16, 15.6, 15.6, 0, colors[(col + row * 3) % colors.length]);
    }
  }
  // Two open walls with separate light levels and capped edges.
  box(ctx, -4, -4, 4, d + 4, WALL_HEIGHT, ['#d6e2e5', '#8eabb9', '#a3bdc7']);
  box(ctx, 0, -4, w, 4, WALL_HEIGHT, ['#eef0e7', '#d8dfd9', '#b6c8cd']);
  box(ctx, 0, 0, w, 2, 4, ['#eef0e7', '#899fa7', '#a3b7bd']);
  box(ctx, 0, 0, 2, d, 4, ['#cad7da', '#7996a3', '#91aab5']);
  plane(ctx, 2, 2, w - 2, 5, 0.2, 'rgba(42,62,78,0.12)');
  plane(ctx, 2, 2, 5, d - 2, 0.2, 'rgba(42,62,78,0.12)');

  for (const x of [22, 86]) {
    front(ctx, x, 0.2, 46, 15, 29, '#819eab');
    front(ctx, x + 2, 0.4, 42, 17, 25, '#87bdce');
    front(ctx, x + 3, 0.5, 40, 30, 11, '#b9e2e5');
    front(ctx, x + 5, 0.6, 4, 18, 22, '#d6edf0');
    front(ctx, x + 22, 0.7, 2, 17, 25, '#edf1e7');
    front(ctx, x + 2, 0.7, 42, 28, 2, '#edf1e7');
    box(ctx, x - 2, 0, 50, 5, 2, ['#f0eee3', '#b5c6c6', '#c8d4cf'], 13);
    plane(ctx, x + 10, 8, 40, 45, 0.3, 'rgba(245,241,199,0.14)');
  }
  // Framed wall art on the left plane.
  const art = (y: number, z: number, depth: number, h: number, color: string) =>
    polygon(ctx, [project(0.2, y, z), project(0.2, y + depth, z),
      project(0.2, y + depth, z + h), project(0.2, y, z + h)], color);
  art(38, 18, 29, 25, '#57778d');
  art(40, 20, 25, 21, '#e2dec9');
  art(43, 23, 8, 10, '#6a9e99');
  art(53, 23, 9, 15, '#dbac80');
  art(43, 35, 8, 3, '#e7ba86');
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  shadow(ctx, x - 5, y - 5, 13, 13);
  box(ctx, x - 5, y - 5, 10, 10, 10, ['#c89776', '#98694f', '#b78161']);
  plane(ctx, x - 4, y - 4, 8, 8, 10.1, '#5f5149');
  box(ctx, x - 1, y - 1, 2, 2, 18, ['#547e5d', '#3a6252', '#487757'], 10);
  const leaves: Array<[number, number, number, string]> = [
    [-8, -2, 20, '#4c987d'], [1, -5, 24, '#7abc93'], [-3, 3, 28, '#62ab84'],
    [-4, -3, 32, '#8ac698'], [3, 1, 18, '#43826b'],
  ];
  for (const [dx, dy, z, color] of leaves) {
    box(ctx, x + dx, y + dy, 8, 7, 3, [color, '#3f7c65', '#579477'], z);
  }
}

function screen(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, z: number, active: boolean, t: number): void {
  box(ctx, x + width * 0.4, y, width * 0.2, 5, 2, DARK, z);
  box(ctx, x + width * 0.48, y + 1, 2, 2, 6, DARK, z + 2);
  box(ctx, x, y, width, 3, 17, DARK, z + 7);
  front(ctx, x + 1, y + 3.1, width - 2, z + 9, 13, active ? '#223a55' : '#263849');
  if (active) {
    const colors = ['#a6d8c0', '#baadf2', '#8fcbe6', '#e5bc87'];
    for (let i = 0; i < 4; i++) {
      front(ctx, x + 3 + (i % 2) * 2, y + 3.2, 5 + ((i + Math.floor(t / 500)) % 3) * 3,
        z + 11 + i * 2.5, 0.9, colors[i]);
    }
  } else {
    front(ctx, x + 3, y + 3.2, width * 0.35, z + 18, 1, '#52667a');
  }
}

function workstation(ctx: CanvasRenderingContext2D, x: number, y: number, active: boolean, accent: string, t: number): void {
  shadow(ctx, x - 16, y - 5, 47, 29);
  // Open space under the desk makes the tabletop height immediately readable.
  for (const [dx, dy] of [[-14, -3], [25, -3], [-14, 15], [25, 15]]) {
    box(ctx, x + dx, y + dy, 3, 3, 18, DARK);
  }
  box(ctx, x - 17, y - 6, 48, 27, 3, WOOD, 18);
  plane(ctx, x - 15, y - 4, 44, 1, 21.1, '#ecd2a8');
  screen(ctx, x - 4, y - 3, 23, 21, active, t);
  box(ctx, x - 3, y + 11, 19, 6, 1, ['#94a5b2', '#586c80', '#72879a'], 21);
  for (let i = 0; i < 5; i++) plane(ctx, x - 1 + i * 3, y + 12, 2, 3, 22.1, '#cfdbde');
  box(ctx, x + 23, y + 8, 4, 4, 5, ['#fbebd0', '#c6b393', '#dfcfb0'], 21);
  plane(ctx, x + 24, y + 9, 2, 2, 26.1, '#916c54');
  plane(ctx, x - 14, y + 4, 8, 10, 21.1, '#eee9d7');
  plane(ctx, x - 13, y + 6, 6, 1, 21.2, '#a6b7bc');
  front(ctx, x - 14, y + 21.1, 8, 18.5, 1, accent);
}

function chair(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string): void {
  shadow(ctx, x, y, 13, 13);
  box(ctx, x + 5, y + 5, 3, 3, 9, DARK);
  box(ctx, x, y, 14, 13, 3, [accent, '#475d75', '#627b91'], 8);
  box(ctx, x, y + 10, 14, 3, 12, [accent, '#425c76', '#607b93'], 10);
}

type DrawItem = { depth: number; draw: () => void };

function decorations(ctx: CanvasRenderingContext2D, office: Office, items: DrawItem[]): void {
  const add = (x: number, y: number, draw: () => void) => items.push({ depth: x + y, draw });
  add(13, 18, () => plant(ctx, 13, 18));
  add(12, office.rows * 16 - 22, () => plant(ctx, 12, office.rows * 16 - 22));
  // Bookshelf with recessed, individually shaded book spines.
  add(153, 15, () => {
    box(ctx, 137, 4, 29, 11, 32, WOOD);
    for (const z of [3, 17]) {
      front(ctx, 139, 15.1, 25, z, 12, '#746858');
      for (let i = 0; i < 6; i++) {
        front(ctx, 140 + i * 4, 15.2, 3, z + 1, 7 + i % 3, COLORS[i]);
      }
    }
  });
  for (const spot of office.leisureSpots) {
    const x = spot.itemX, y = spot.itemY;
    const active = spot.occupant !== null;
    if (spot.type === 'coffee') {
      add(x + 10, y + 10, () => {
        shadow(ctx, x, y, 24, 14);
        box(ctx, x, y, 24, 14, 17, WOOD);
        box(ctx, x + 3, y + 2, 13, 9, 17, DARK, 17);
        front(ctx, x + 5, y + 11.1, 6, 28, 3, '#96dcba');
        front(ctx, x + 6, y + 11.1, 5, 21, 5, '#101e30');
        box(ctx, x + 7, y + 10, 3, 3, 3, ['#f1e4cb', '#b2c3c5', '#dde5db'], 19);
        const p = project(x + 8, y + 11, 25);
        for (let i = 0; i < 3; i++) {
          const phase = (office.elapsedTime / 1100 + i / 3) % 1;
          ctx.fillStyle = `rgba(242,237,218,${(1 - phase) * 0.7})`;
          ctx.fillRect(p.x + Math.sin(phase * 6) * 2, p.y - phase * 13, 1.5, 2);
        }
      });
      continue;
    }
    const gaming = spot.type === 'gaming';
    plane(ctx, x - 7, y - 6, gaming ? 59 : 69, 51, 0.4, gaming ? '#788eaa' : '#8aafa7');
    plane(ctx, x - 5, y - 4, gaming ? 55 : 65, 47, 0.5, gaming ? '#8da1ba' : '#a0c2b6');
    add(x + 22, y + 7, () => {
      box(ctx, x + 5, y, 40, 10, 9, DARK);
      screen(ctx, x + 9, y + 1, 30, 9, active, office.elapsedTime);
      if (gaming) box(ctx, x + 39, y + 2, 5, 7, 12, ['#dddff1', '#8a91b0', '#b9c2da'], 9);
    });
    add(x + 22, y + 35, () => {
      const fabric: Surface = gaming ? ['#b0a0d3', '#786899', '#9787bc'] : ['#84afb9', '#487b8b', '#6498a6'];
      box(ctx, x + 5, y + 23, gaming ? 22 : 43, 15, 9, fabric);
      box(ctx, x + 5, y + 35, gaming ? 22 : 43, 4, 16, fabric);
      if (!gaming) {
        box(ctx, x + 4, y + 22, 4, 17, 13, fabric);
        box(ctx, x + 45, y + 22, 4, 17, 13, fabric);
        box(ctx, x + 10, y + 25, 12, 8, 2, TEAL, 9);
        box(ctx, x + 29, y + 25, 12, 8, 2, TEAL, 9);
      }
    });
  }
}

function activityColor(activity: CharacterActivity): string {
  if (activity === 'waiting') return '#f1cf89';
  if (activity === 'running') return '#efb089';
  if (activity === 'searching' || activity === 'gaming') return '#c4aff2';
  return activity === 'idle' ? '#b4c3d1' : '#98d9c8';
}

export function characterAnchor(c: Character): Point {
  return project(c.x + 8, c.y + 12);
}

function character(ctx: CanvasRenderingContext2D, c: Character): void {
  const p = characterAnchor(c);
  ctx.fillStyle = 'rgba(25,42,56,0.22)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  if (c.selected) {
    ctx.strokeStyle = '#d9bafc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (!drawCharacterSprite(ctx, c.palette, c.direction, c.frame, Math.round(p.x - 8), Math.round(p.y - 32))) {
    ctx.fillStyle = COLORS[c.palette % COLORS.length];
    ctx.fillRect(p.x - 5, p.y - 20, 10, 17);
    ctx.fillStyle = '#f0ceaf';
    ctx.fillRect(p.x - 4, p.y - 28, 8, 9);
  }
}

function label(ctx: CanvasRenderingContext2D, c: Character, scale: number): void {
  const p = characterAnchor(c);
  // A minimum screen font size keeps labels useful in a narrow sidebar.
  const fontSize = Math.max(5, 8 / scale);
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  const name = c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name;
  const w = ctx.measureText(name).width + 12;
  ctx.fillStyle = c.selected ? '#453f64' : 'rgba(24,37,55,0.9)';
  ctx.fillRect(p.x - w / 2, p.y + 4, w, fontSize + 5);
  ctx.fillStyle = activityColor(c.activity);
  ctx.fillRect(p.x - w / 2, p.y + 4, 2, fontSize + 5);
  ctx.fillStyle = '#e5ecf2';
  ctx.fillText(name, p.x + 1, p.y + fontSize + 5);
  const usage = Math.min(1, (c.inputTokens + c.outputTokens) / 200_000);
  if (usage > 0) {
    ctx.fillStyle = usage > 0.8 ? '#ef9b9e' : '#97d7b7';
    ctx.fillRect(p.x - w / 2, p.y + fontSize + 10, w * usage, 1.5);
  }
  const icons: Partial<Record<CharacterActivity, string>> = {
    waiting: '?', gaming: 'GAME', watching_tv: 'TV', coffee_break: 'COFFEE',
    typing: '</>', reading: 'READ', searching: '...', running: '>_',
  };
  const text = c.speechBubble?.text ?? icons[c.activity];
  if (text) {
    const short = text.length > 18 ? text.slice(0, 17) + '…' : text;
    const width = ctx.measureText(short).width + 9;
    ctx.fillStyle = '#edf2e9';
    ctx.fillRect(p.x - width / 2, p.y - 36 - fontSize, width, fontSize + 5);
    polygon(ctx, [{ x: p.x - 2, y: p.y - 31 }, { x: p.x + 2, y: p.y - 31 }, { x: p.x, y: p.y - 28 }], '#edf2e9');
    ctx.fillStyle = '#32445a';
    ctx.fillText(short, p.x, p.y - 33);
  }
}

function cat(ctx: CanvasRenderingContext2D, office: Office): void {
  const p = project(office.pet.x + 6, office.pet.y + 8);
  ctx.fillStyle = 'rgba(25,42,56,0.2)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  if (office.pet.direction === 'left') ctx.scale(-1, 1);
  ctx.fillStyle = office.pet.color === 'orange' ? '#d69b60' : '#97a5b6';
  ctx.fillRect(-5, -8, 10, 7);
  ctx.fillRect(0, -13, 8, 7);
  ctx.fillRect(0, -16, 2, 4); ctx.fillRect(6, -16, 2, 4);
  ctx.fillRect(-8, -10, 4, 2); ctx.fillRect(-8, -13, 2, 4);
  const step = office.pet.isSitting ? 0 : office.pet.frame;
  ctx.fillRect(-4, -2, 2, 2 + step); ctx.fillRect(3, -2, 2, 3 - step);
  ctx.fillStyle = '#ffe1b0'; ctx.fillRect(1, -8, 5, 3);
  ctx.fillStyle = '#344e59'; ctx.fillRect(1, -11, 1, 2); ctx.fillRect(6, -11, 1, 2);
  ctx.restore();
}

export function renderIsometric(office: Office): void {
  const { ctx, canvas } = office;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const camera = officeCamera(office);
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.scale, camera.scale);
  room(ctx, office);
  const items: DrawItem[] = [];
  decorations(ctx, office, items);
  // Empty desks keep the office welcoming before the first real agent arrives.
  const desks = [...office.characters.values()];
  for (let i = 0; i < Math.max(2, desks.length); i++) {
    const c = desks[i];
    const x = c?.deskX ?? (3 + i % 2 * 5) * 16;
    const y = c?.deskY ?? (4 + Math.floor(i / 2) * 4) * 16;
    const accent = COLORS[c?.palette ?? i];
    items.push({ depth: x + y + 18, draw: () => workstation(ctx, x, y, !!c?.activeTools.size, accent, office.elapsedTime) });
    items.push({ depth: x + y + 43, draw: () => chair(ctx, x + 1, y + 24, accent) });
  }
  for (const c of desks) items.push({ depth: c.x + c.y + 20, draw: () => character(ctx, c) });
  items.push({ depth: office.pet.x + office.pet.y + 14, draw: () => cat(ctx, office) });
  items.sort((a, b) => a.depth - b.depth).forEach((item) => item.draw());
  // Labels are an overlay, never hidden by furniture or other sprites.
  for (const c of desks) label(ctx, c, camera.scale);
  ctx.restore();
}

export function hitTestCharacter(office: Office, canvasX: number, canvasY: number): Character | undefined {
  const camera = officeCamera(office);
  const x = (canvasX - camera.x) / camera.scale;
  const y = (canvasY - camera.y) / camera.scale;
  const characters = [...office.characters.values()].sort((a, b) => (b.x + b.y) - (a.x + a.y));
  return characters.find((c) => {
    const p = characterAnchor(c);
    return x >= p.x - 9 && x <= p.x + 9 && y >= p.y - 32 && y <= p.y + 3;
  });
}