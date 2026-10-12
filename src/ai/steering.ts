import { TUNING } from '../config';
import { HALF_LENGTH, HALF_WIDTH } from '../constants';
import { clamp, type Vec2 } from '../math';
import type { Player } from '../sim/player';

/** A move (direction with length 0–1) and whether to sprint, for a `Command`. */
export interface Steer {
  move: Vec2;
  sprint: boolean;
}

export const STAND: Readonly<Steer> = Object.freeze({ move: Object.freeze({ x: 0, z: 0 }), sprint: false });

/**
 * Go to `target` and stop there: full speed while far, easing off inside `arriveRadius`,
 * sprinting when it's a long way. Stops within `tolerance` of it.
 */
export function arrive(p: Player, target: Vec2, tolerance = TUNING.ai.slotTolerance): Steer {
  const A = TUNING.ai;
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < tolerance) return STAND;
  const amount = Math.min(1, d / A.arriveRadius);
  return { move: { x: (dx / d) * amount, z: (dz / d) * amount }, sprint: d > A.sprintDistance };
}

/** Run at full speed towards `target` (no slowing down), sprinting if `sprint`. */
export function seek(p: Player, target: Vec2, sprint: boolean): Steer {
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return STAND;
  return { move: { x: dx / d, z: dz / d }, sprint };
}

/**
 * Run to meet a moving target: aim where it will be by the time we could get there
 * (a simple lead, capped so a fast target doesn't send us miles ahead of it).
 */
export function pursue(p: Player, target: Vec2, velocity: Vec2, sprint: boolean): Steer {
  const d = Math.hypot(target.x - p.pos.x, target.z - p.pos.z);
  const lead = Math.min(1.5, d / Math.max(1, TUNING.locomotion.sprintSpeed));
  return seek(p, { x: target.x + velocity.x * lead, z: target.z + velocity.z * lead }, sprint);
}

/** `target` pulled inside the boards, `margin` metres in from them. */
export function insidePitch(target: Vec2, margin = 0.6): Vec2 {
  const maxX = HALF_LENGTH - margin;
  const maxZ = HALF_WIDTH - margin;
  return { x: clamp(target.x, -maxX, maxX), z: clamp(target.z, -maxZ, maxZ) };
}

/**
 * Bend a move away from teammates closer than `radius`, so players heading for nearby
 * spots don't end up in a clump. The push grows as they get closer; the length of the
 * move (how fast they want to go) is kept.
 */
export function separate(p: Player, move: Vec2, others: readonly Player[], radius = TUNING.ai.separationRadius): Vec2 {
  let px = 0;
  let pz = 0;
  for (const q of others) {
    if (q.id === p.id || q.team !== p.team) continue;
    const dx = p.pos.x - q.pos.x;
    const dz = p.pos.z - q.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= radius || d < 1e-6) continue;
    const w = (radius - d) / radius;
    px += (dx / d) * w;
    pz += (dz / d) * w;
  }
  if (px === 0 && pz === 0) return move;
  const amount = Math.hypot(move.x, move.z);
  const x = move.x + px;
  const z = move.z + pz;
  const len = Math.hypot(x, z);
  if (len < 1e-6) return move;
  const k = Math.max(amount, Math.min(1, Math.hypot(px, pz))) / len;
  return { x: x * k, z: z * k };
}
