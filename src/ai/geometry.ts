import { GOAL_AREA_RADIUS, HALF_LENGTH, HALF_WIDTH } from '../constants';
import { clamp, headingVec, type Vec2 } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import type { Steer } from './steering';

export const DEG = Math.PI / 180;

/** A steering result as a `Command` with no buttons pressed. */
export function steer(s: Steer): Command {
  return { ...IDLE, move: s.move, sprint: s.sprint };
}

/** The middle of the goal `team` defends. */
export function ownGoal(sim: Sim, team: 0 | 1): Vec2 {
  return { x: -sim.attackDir(team) * HALF_LENGTH, z: 0 };
}

/** The middle of the goal `team` attacks. */
export function attackGoal(sim: Sim, team: 0 | 1): Vec2 {
  return { x: sim.attackDir(team) * HALF_LENGTH, z: 0 };
}

/** Is `point` inside the goal area `team` defends? */
export function inOwnArea(sim: Sim, team: 0 | 1, point: Vec2): boolean {
  const g = ownGoal(sim, team);
  return Math.hypot(point.x - g.x, point.z - g.z) < GOAL_AREA_RADIUS;
}

/** The point `distance` metres from `from` towards the goal `team` defends (goal-side of it). */
export function goalSide(sim: Sim, from: Vec2, team: 0 | 1, distance: number): Vec2 {
  const g = ownGoal(sim, team);
  const dx = g.x - from.x;
  const dz = g.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = Math.min(distance, d * 0.8);
  return { x: from.x + (dx / d) * k, z: from.z + (dz / d) * k };
}

/** The ball's position on the ground. */
export function ballPos(sim: Sim): Vec2 {
  const b = sim.ball.translation();
  return { x: b.x, z: b.z };
}

/** The nearest opponent within `range` of `p` and within 50° of the way to `target`. */
export function opponentAhead(sim: Sim, p: Player, target: Vec2, range: number): Player | null {
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  let nearest: Player | null = null;
  let best = range;
  for (const q of sim.players) {
    if (q.team === p.team) continue;
    const ox = q.pos.x - p.pos.x;
    const oz = q.pos.z - p.pos.z;
    const od = Math.hypot(ox, oz);
    if (od > best || od < 1e-6) continue;
    if ((ox * dx + oz * dz) / (od * d) < Math.cos(50 * DEG)) continue;
    best = od;
    nearest = q;
  }
  return nearest;
}

/** Distance from `p` to the segment a–b. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

/** Distance from `point` to the nearest player of `team`, capped at `cap`. */
export function space(sim: Sim, point: Vec2, team: 0 | 1, cap = 8): number {
  let d = cap;
  for (const q of sim.players) if (q.team === team) d = Math.min(d, Math.hypot(q.pos.x - point.x, q.pos.z - point.z));
  return d;
}

/** The nearest outfield teammate of `p`, or null if there isn't one. */
export function nearestTeammate(sim: Sim, p: Player): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const q of sim.players) {
    if (q.team !== p.team || q.id === p.id || q.spec.role === 'keeper') continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * A point 3 m ahead and 3 m to one side of `p` (heading for `target`): the side away from
 * `blocker`, unless that's off the pitch, then the other; failing both, straight back.
 */
export function sidestep(p: Player, blocker: Player, target: Vec2): Vec2 {
  const f = headingVec(Math.atan2(target.z - p.pos.z, target.x - p.pos.x));
  const away = (blocker.pos.x - p.pos.x) * -f.z + (blocker.pos.z - p.pos.z) * f.x > 0 ? -1 : 1;
  const onPitch = (q: Vec2) => Math.abs(q.x) < HALF_LENGTH - 1 && Math.abs(q.z) < HALF_WIDTH - 1;
  for (const side of [away, -away]) {
    const q = { x: p.pos.x + f.x * 3 - f.z * side * 3, z: p.pos.z + f.z * 3 + f.x * side * 3 };
    if (onPitch(q)) return q;
  }
  return { x: p.pos.x - f.x * 3, z: p.pos.z - f.z * 3 };
}
