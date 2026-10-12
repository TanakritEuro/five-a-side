import type { BallPath } from '../ball/trajectory';
import { TUNING } from '../config';
import { HALF_LENGTH, HALF_WIDTH } from '../constants';
import { attrScale, headingVec, wrapAngle, type Vec2 } from '../math';
import type { Player } from '../sim/player';

/** Balls higher than this (m) can't be played with the feet, so they can't be intercepted (yet). */
const MAX_HEIGHT = 0.6;

/**
 * Roughly how long (s) `p` needs to get within reach of `target`, running flat out:
 * a reaction delay, turning to face it, then accelerating from the speed they already
 * have towards it up to sprint speed. Cheap enough to call for every player many times
 * per brain update. Errs slightly pessimistic, so players don't give up on balls they
 * would have reached.
 */
export function timeToReach(p: Player, target: Vec2): number {
  const L = TUNING.locomotion;
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const dist = Math.hypot(dx, dz);
  const d = dist - TUNING.dribble.reach;
  if (d <= 0) return 0;

  const pace = attrScale(p.attrs.pace, L.paceSpread);
  const top = L.sprintSpeed * pace;
  const accel = ((L.accel + L.sprintAccel) / 2) * pace;
  // Speed already going their way counts; speed going the other way has to be shed first.
  const along = (p.vel.x * dx + p.vel.z * dz) / dist;
  const v0 = Math.max(0, along);
  const brake = along < 0 ? -along / L.decel : 0;
  const tAccel = (top - v0) / accel;
  const dAccel = ((v0 + top) / 2) * tAccel;
  const run = d <= dAccel ? (-v0 + Math.sqrt(v0 * v0 + 2 * accel * d)) / accel : tAccel + (d - dAccel) / top;

  const turn = Math.abs(wrapAngle(Math.atan2(dz, dx) - p.facing)) / (L.turnRate / (1 + L.turnSpeedFactor * p.speed));
  return TUNING.ai.reactionTime + turn + brake + run;
}

export interface Intercept {
  /** Where to meet the ball. */
  point: Vec2;
  /** Seconds from now until the ball gets there. */
  t: number;
}

/**
 * The first point on the ball's predicted path that `p` can reach before the ball does,
 * `elapsed` seconds into the path. If they can't get to any of it in time, the end of
 * the path (where it stops, or as far as it's predicted), and when they'd get there.
 * Points outside the boards are ignored: the prediction knows nothing of walls.
 */
export function earliestIntercept(p: Player, path: BallPath, elapsed: number): Intercept {
  const first = Math.max(0, Math.ceil(elapsed / path.dt));
  let last: Vec2 | null = null;
  for (let k = first; k < path.points.length; k++) {
    const b = path.points[k];
    if (Math.abs(b.x) > HALF_LENGTH || Math.abs(b.z) > HALF_WIDTH) break;
    last = { x: b.x, z: b.z };
    if (b.y > MAX_HEIGHT) continue;
    const t = k * path.dt - elapsed;
    if (timeToReach(p, last) <= t) return { point: last, t };
  }
  const fallback = path.points[Math.min(first, path.points.length - 1)];
  const end = last ?? { x: fallback.x, z: fallback.z };
  return { point: end, t: Math.max(timeToReach(p, end), (path.points.length - 1) * path.dt - elapsed) };
}

/** Is `p` facing within `cone` radians of the direction to `target`? */
export function facing(p: Player, target: Vec2, cone: number): boolean {
  const f = headingVec(p.facing);
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  return d < 1e-6 || (f.x * dx + f.z * dz) / d >= Math.cos(cone);
}
