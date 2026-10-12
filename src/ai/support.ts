import { TUNING } from '../config';
import { GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH } from '../constants';
import { clamp, type Vec2 } from '../math';
import { arrivalSpeed } from '../sim/kick';
import type { Player } from '../sim/player';
import { timeToReach } from './intercept';
import { launchSpeedFor, passSafety } from './passing';

/** A candidate support position and how good it is (for the brain and the debug overlay). */
export interface ScoredSpot {
  pos: Vec2;
  score: number;
  /** Seconds by which a pass there beats the defence (negative: it would be cut out). */
  safety: number;
}

/**
 * Score a grid of positions in front of the ball as places to support the player on it:
 * - safe to pass to (the ball beats every opponent there, `passSafety`),
 * - a good angle on goal (the angle the goalmouth makes from there),
 * - a sensible passing distance (best around `supportIdeal` m),
 * - space (distance from the nearest opponent),
 * - progress (how far forward of the ball).
 * `dir` is the attacking direction (+1 = towards +X). Sorted best first.
 */
export function scoreSupportSpots(ball: Vec2, dir: 1 | -1, opponents: readonly Player[]): ScoredSpot[] {
  const S = TUNING.support;
  const spots: ScoredSpot[] = [];
  const goal = { x: dir * HALF_LENGTH, z: 0 };
  for (let fx = -S.behind; fx <= HALF_LENGTH * 2; fx += S.grid) {
    const x = ball.x + dir * fx;
    if (Math.abs(x) > HALF_LENGTH - S.margin) continue;
    for (let z = -HALF_WIDTH + S.margin; z <= HALF_WIDTH - S.margin + 1e-6; z += S.grid) {
      const pos = { x, z };
      const d = Math.hypot(x - ball.x, z - ball.z);
      if (d < S.minDistance || d > S.maxDistance) continue;
      const v0 = launchSpeedFor(d, arrivalSpeed(d));
      const safety = passSafety(ball, pos, v0, null, opponents);
      let space = S.spaceCap;
      for (const o of opponents) space = Math.min(space, Math.hypot(o.pos.x - x, o.pos.z - z));
      const score =
        S.wSafety * clamp(safety, -1, 1) +
        S.wAngle * goalAngle(pos, goal) +
        S.wDistance * (1 - Math.min(1, Math.abs(d - S.ideal) / S.ideal)) +
        S.wSpace * (space / S.spaceCap) +
        S.wProgress * clamp((fx + S.behind) / (HALF_LENGTH + S.behind), 0, 1);
      spots.push({ pos, score, safety });
    }
  }
  return spots.sort((a, b) => b.score - a.score);
}

/** The angle (radians) the goal mouth at `goal` makes from `pos`: bigger is a better look at it. */
export function goalAngle(pos: Vec2, goal: Vec2): number {
  const a1 = Math.atan2(goal.z - GOAL_WIDTH / 2 - pos.z, goal.x - pos.x);
  const a2 = Math.atan2(goal.z + GOAL_WIDTH / 2 - pos.z, goal.x - pos.x);
  return Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
}

/**
 * Hand out the best spots to `supporters`. First, anyone who already had a spot keeps
 * it (or the best spot near it) while it's still nearly as good as the best on offer,
 * so supporters don't swap targets every update. Then walk down the list, skipping spots
 * within `spacing` of one already taken, and give each to the free supporter who can get
 * there soonest. Returns supporter id → spot.
 */
export function assignSpots(
  spots: readonly ScoredSpot[],
  supporters: readonly Player[],
  previous: ReadonlyMap<number, Vec2> = new Map(),
): Map<number, Vec2> {
  const S = TUNING.support;
  const out = new Map<number, Vec2>();
  const taken: Vec2[] = [];
  const clear = (pos: Vec2) => !taken.some((t) => Math.hypot(t.x - pos.x, t.z - pos.z) < S.spacing);
  const free = [...supporters];
  const best = spots[0]?.score ?? 0;
  for (let i = free.length - 1; i >= 0; i--) {
    const before = previous.get(free[i].id);
    if (!before) continue;
    const near = spots.find((s) => Math.hypot(s.pos.x - before.x, s.pos.z - before.z) < S.grid && clear(s.pos));
    if (!near || near.score < best - S.stickiness) continue;
    out.set(free[i].id, near.pos);
    taken.push(near.pos);
    free.splice(i, 1);
  }
  for (const spot of spots) {
    if (free.length === 0) break;
    if (!clear(spot.pos)) continue;
    let best = 0;
    let bestT = Infinity;
    free.forEach((p, i) => {
      const t = timeToReach(p, spot.pos);
      if (t < bestT) {
        bestT = t;
        best = i;
      }
    });
    out.set(free[best].id, spot.pos);
    taken.push(spot.pos);
    free.splice(best, 1);
  }
  return out;
}
