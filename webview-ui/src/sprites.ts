// Sprite sheet layout for char_N.png:
//   112 × 96 px  →  7 frames × 3 directions (down, up, right)
//   Each frame: 16 × 32 px
//   Left direction is drawn by horizontally flipping the right row.

import { seatingGeometry, type SeatKind } from './seating.js';

const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES = 7;

export type Direction = 'down' | 'up' | 'right' | 'left';

const DIR_ROW: Record<Direction, number> = { down: 0, up: 1, right: 2, left: 2 };

const characterImages: HTMLImageElement[] = [];
const furnitureImages: Map<string, HTMLImageElement> = new Map();
let floorImages: HTMLImageElement[] = [];

declare const window: Window & { ASSETS_BASE_URI?: string };

function assetUrl(relativePath: string): string {
  const base = window.ASSETS_BASE_URI ?? 'assets';
  return `${base.replace(/\/$/, '')}/${relativePath}`;
}

let loaded = false;
let loadPromise: Promise<void> | null = null;

export function getSpritesLoaded(): boolean {
  return loaded;
}

export function loadSprites(): Promise<void> {
  if (loadPromise) return loadPromise;

  const promises: Promise<void>[] = [];

  for (let i = 0; i < 6; i++) {
    const img = new Image();
    promises.push(
      new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res(); // fallback: skip
      }),
    );
    img.src = assetUrl(`characters/char_${i}.png`);
    characterImages.push(img);
  }

  for (let i = 0; i < 3; i++) {
    const img = new Image();
    promises.push(
      new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
      }),
    );
    img.src = assetUrl(`floors/floor_${i}.png`);
    floorImages.push(img);
  }

  const furnitureFiles = [
    ['desk_front', 'furniture/DESK/DESK_FRONT.png'],
    ['desk_side', 'furniture/DESK/DESK_SIDE.png'],
    ['chair_front', 'furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_FRONT.png'],
    ['chair_back', 'furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK.png'],
    ['pc_off', 'furniture/PC/PC_FRONT_OFF.png'],
    ['pc_on_1', 'furniture/PC/PC_FRONT_ON_1.png'],
    ['pc_on_2', 'furniture/PC/PC_FRONT_ON_2.png'],
    ['pc_on_3', 'furniture/PC/PC_FRONT_ON_3.png'],
  ];

  for (const [key, src] of furnitureFiles) {
    const img = new Image();
    promises.push(
      new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
      }),
    );
    img.src = assetUrl(src);
    furnitureImages.set(key, img);
  }

  loadPromise = Promise.all(promises).then(() => {
    loaded = true;
  });
  return loadPromise;
}

export function drawCharacterSprite(
  ctx: CanvasRenderingContext2D,
  paletteIndex: number,
  direction: Direction,
  frame: number,
  destX: number,
  destY: number,
  scale = 1,
): boolean {
  const img = characterImages[paletteIndex % characterImages.length];
  if (!img?.complete || img.naturalWidth === 0) return false;

  const row = DIR_ROW[direction];
  const col = frame % CHAR_FRAMES;
  const srcX = col * CHAR_FRAME_W;
  const srcY = row * CHAR_FRAME_H;

  if (direction === 'left') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(
      img,
      srcX, srcY, CHAR_FRAME_W, CHAR_FRAME_H,
      -(destX + CHAR_FRAME_W * scale), destY, CHAR_FRAME_W * scale, CHAR_FRAME_H * scale,
    );
    ctx.restore();
  } else {
    ctx.drawImage(
      img,
      srcX, srcY, CHAR_FRAME_W, CHAR_FRAME_H,
      destX, destY, CHAR_FRAME_W * scale, CHAR_FRAME_H * scale,
    );
  }
  return true;
}

// Recompose, don't squash: keep the original 16×22 head/torso at 1:1,
// fade out just the standing legs, and articulate new knees/elbows beneath it.
// destY already includes the shared pose's four-pixel eased descent.
export function drawSeatedCharacterSprite(
  ctx: CanvasRenderingContext2D,
  paletteIndex: number,
  frame: number,
  destX: number,
  destY: number,
  progress: number,
  kind: SeatKind | null,
  animateHands: boolean,
): void {
  const { amount, drop } = seatingGeometry(progress);
  const img = characterImages[paletteIndex % characterImages.length];
  const hasImage = img?.complete && img.naturalWidth > 0;
  const skin = ['#d5a77e', '#bd896c', '#e2b795', '#edcbb0', '#c89478', '#dcb394'][paletteIndex % 6];
  const shirt = ['#4c657e', '#668777', '#9b687d', '#a59da9', '#77719b', '#957353'][paletteIndex % 6];
  ctx.save();
  ctx.translate(destX, destY);
  if (hasImage) {
    // Right-facing row, neutral frame: no walking bob in the seated torso.
    ctx.drawImage(img, 0, 64, 16, 22, 0, 0, 16, 22);
    ctx.save();
    ctx.globalAlpha = 1 - amount;
    ctx.drawImage(img, 0, 86, 16, 10, 0, 22 - drop, 16, 10);
    ctx.restore();
  } else {
    ctx.fillStyle = shirt;
    ctx.fillRect(3, 12, 10, 10);
    ctx.fillStyle = skin;
    ctx.fillRect(4, 4, 8, 9);
    ctx.fillStyle = '#594840';
    ctx.fillRect(3, 3, 10, 4);
    ctx.fillStyle = '#273a50';
    ctx.fillRect(11, 8, 1, 2);
  }

  ctx.save();
  ctx.globalAlpha = hasImage ? amount : 1;
  // Far leg then near leg. Thighs extend toward the screen; vertical shins
  // and forward shoes remain distinct, with feet at the floor throughout.
  for (const [hip, color] of [[6, '#344458'], [9, '#465a72']] as const) {
    const knee = hip + 6 * amount;
    const kneeY = 25 - 3 * amount;
    ctx.fillStyle = color;
    ctx.fillRect(hip, 22, 3 + 6 * amount, 3);
    ctx.fillRect(knee, kneeY, 3, 31 - drop - kneeY);
    ctx.fillStyle = '#243447';
    ctx.fillRect(knee, 30 - drop, 4, 2);
    ctx.fillStyle = '#a5b9c2';
    ctx.fillRect(knee, 31 - drop, 4, 1);
  }
  ctx.restore();

  // Bent elbows and forearms replace the hanging hands as the body settles.
  ctx.save();
  ctx.globalAlpha = amount;
  const tap = animateHands && progress >= 1 ? frame % 2 : 0;
  const working = kind === 'desk' && animateHands;
  const handY = working ? 19 : 22;
  ctx.fillStyle = shirt;
  ctx.fillRect(9, 17, 3, 6);
  ctx.fillStyle = skin;
  ctx.fillRect(10, handY + tap, 7, 2);
  ctx.fillRect(13, handY - 2 + (animateHands ? 1 - tap : 0), 5, 2);
  if (kind === 'gaming') {
    ctx.fillStyle = '#263447';
    ctx.fillRect(13, 21, 7, 3);
    ctx.fillStyle = '#93d8c4';
    ctx.fillRect(18, 21 + tap, 1, 1);
    ctx.fillStyle = skin;
    ctx.fillRect(12, 21, 2, 2);
    ctx.fillRect(19, 21 + tap, 1, 2);
  }
  ctx.restore();
  ctx.restore();
}

export function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  tileIndex: number,
  destX: number,
  destY: number,
  size = 16,
): boolean {
  const img = floorImages[tileIndex % floorImages.length];
  if (!img?.complete || img.naturalWidth === 0) return false;
  ctx.drawImage(img, destX, destY, size, size);
  return true;
}

export function drawFurniture(
  ctx: CanvasRenderingContext2D,
  key: string,
  destX: number,
  destY: number,
  scale = 1,
): boolean {
  const img = furnitureImages.get(key);
  if (!img?.complete || img.naturalWidth === 0) return false;
  ctx.drawImage(img, destX, destY, img.naturalWidth * scale, img.naturalHeight * scale);
  return true;
}

export function getPcFrame(frame: number, isActive: boolean): string {
  if (!isActive) return 'pc_off';
  return `pc_on_${(frame % 3) + 1}`;
}
