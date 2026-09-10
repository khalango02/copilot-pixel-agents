import type { Character, Office } from './engine.js';
import type { Direction } from './sprites.js';

export type SeatKind = 'desk' | 'gaming' | 'tv';
export const SIT_TRANSITION_MS = 300;

// The hips end six pixels above the floor, on the cushion. The original
// head/torso retain their pixel dimensions; only joints and their offsets move.
export function seatingGeometry(progress = 0): { amount: number; drop: number } {
  const p = Math.max(0, Math.min(1, progress));
  const amount = p * p * (3 - 2 * p);
  return { amount, drop: 4 * amount };
}

export function seatTarget(office: Office, c: Character): SeatKind | null {
  if (c.activity === 'walking' || c.activity === 'coffee_break') return null;
  const at = (x: number, y: number) => Math.hypot(c.x - x, c.y - y) < 0.5
    && Math.hypot(c.targetX - x, c.targetY - y) < 0.5;
  if ((c.idleGoal === null || c.idleGoal === 'desk') && at(c.deskX, c.deskY + 16)) return 'desk';
  const spot = office.leisureSpots.find((s) => s.occupant === c.id && s.type === c.idleGoal);
  if (!spot || !at(spot.standX, spot.standY)) return null;
  if (spot.type === 'gaming' && (c.activity === 'gaming' || c.activity === 'waiting')) return 'gaming';
  if (spot.type === 'tv' && (c.activity === 'watching_tv' || c.activity === 'waiting')) return 'tv';
  return null;
}

export function updateSeating(office: Office, c: Character, dt: number): void {
  const target = seatTarget(office, c);
  const step = Math.max(0, dt) / SIT_TRANSITION_MS;
  const progress = Math.max(0, Math.min(1, (c.sitProgress ?? 0) + (target ? step : -step)));
  c.sitProgress = progress < 1e-6 ? 0 : progress > 1 - 1e-6 ? 1 : progress;
  if (target) c.seatKind = target;
  // All screens are on the negative world-Y side: right/up on the canvas.
  // Keep this orientation during standing up, even after the goal changes.
  if (c.sitProgress > 0) c.direction = seatDirection;
  else c.seatKind = null;
}

export const seatDirection: Direction = 'right';