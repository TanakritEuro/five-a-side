import { TUNING } from '../config';
import type { Vec2 } from '../math';
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
