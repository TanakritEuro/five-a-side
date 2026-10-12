import { TUNING } from '../config';
import type { Vec2 } from '../math';
import type { Command } from '../sim/command';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import type { TeamPlan } from './brain';
import { ballPos, goalSide, ownGoal, steer } from './geometry';
import { arrive, insidePitch, pursue, seek, separate } from './steering';

/** What an AI player is doing. One state machine per player; see `Ai`. */
export type AiState =
  /** Off the ball, nothing else to do: go to (and stay at) their slot in the shifted formation. */
  | { kind: 'hold' }
  /** The team's player who can get to the loose ball first: go to where they'll meet it. */
  | { kind: 'chase'; point: Vec2 }
  /** Close down the opponent on the ball, getting goal-side of them. */
  | { kind: 'press'; carrier: number }
  /** Sit behind the presser, goal-side, in case they're beaten. */
  | { kind: 'cover' }
  /** Stay goal-side of `opponent`, a little towards the ball. */
  | { kind: 'mark'; opponent: number }
  /** A keeper off the ball: stand between the ball and the middle of the goal. */
  | { kind: 'keeper' }
  /** On the ball (see onball.ts). */
  | { kind: 'dribble'; plan: DribblePlan }
  /** Taking a kick-off, kick-in or goal clearance. */
  | { kind: 'takeRestart' };

export type DribblePlan =
  /** Run at goal, aiming for one corner (+1 or -1 across the goal). */
  | { kind: 'run'; corner: 1 | -1 }
  /** Charging a shot: hold K for `hold` steps, then let go. */
  | { kind: 'shoot'; corner: 1 | -1; hold: number }
  /** Turning to pass to teammate `to`; give up after `stepsLeft`. */
  | { kind: 'pass'; to: number; stepsLeft: number };

/** The command for a player off the ball in `state`. */
export function offBall(sim: Sim, p: Player, state: AiState, plan: TeamPlan): Command {
  const A = TUNING.ai;
  const hurry = plan.transition;
  switch (state.kind) {
    case 'hold': {
      const slot = plan.slots.get(p.id) ?? p.pos;
      const s = arrive(p, slot);
      return steer({ move: separate(p, s.move, sim.players), sprint: s.sprint || (hurry && far(p, slot, 4)) });
    }
    case 'chase': {
      // Close to the ball: go straight at it to take it.
      const b = ballPos(sim);
      const d = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
      return steer(seek(p, d < 2 ? b : state.point, d > 3));
    }
    case 'press': {
      const spot = goalSide(sim, ballPos(sim), p.team, A.pressDistance);
      const carrier = sim.players[state.carrier];
      const s = far(p, spot, 3) ? pursue(p, spot, carrier.vel, true) : arrive(p, spot, 0.1);
      return steer(s);
    }
    case 'cover': {
      const s = arrive(p, insidePitch(goalSide(sim, ballPos(sim), p.team, A.coverDistance)), 0.3);
      return steer({ move: s.move, sprint: s.sprint || (hurry && far(p, ownGoal(sim, p.team), 8)) });
    }
    case 'mark': {
      const spot = markSpot(sim, p, sim.players[state.opponent]);
      const s = arrive(p, spot, 0.3);
      return steer({ move: s.move, sprint: s.sprint || far(p, spot, 4) });
    }
    case 'keeper':
      return steer(arrive(p, keeperSpot(sim, p), 0.2));
    case 'dribble':
    case 'takeRestart':
      throw new Error(`offBall called for an on-ball state (${state.kind})`);
  }
}

/** Goal-side of `opponent` by `markDistance`, nudged towards the ball to cut off a pass to them. */
export function markSpot(sim: Sim, p: Player, opponent: Player): Vec2 {
  const A = TUNING.ai;
  const side = goalSide(sim, opponent.pos, p.team, A.markDistance);
  const b = ballPos(sim);
  const dx = b.x - opponent.pos.x;
  const dz = b.z - opponent.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = Math.min(A.markBallSide, d / 3);
  return insidePitch({ x: side.x + (dx / d) * k, z: side.z + (dz / d) * k });
}

/** Where a keeper stands: out from the middle of the goal towards the ball, a little off the line. */
export function keeperSpot(sim: Sim, p: Player): Vec2 {
  const g = ownGoal(sim, p.team);
  const b = ballPos(sim);
  const dx = b.x - g.x;
  const dz = b.z - g.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = Math.min(1.5, d * 0.2);
  return { x: g.x + (dx / d) * Math.max(out, 0.5), z: g.z + (dz / d) * out };
}

function far(p: Player, point: Vec2, distance: number): boolean {
  return Math.hypot(point.x - p.pos.x, point.z - p.pos.z) > distance;
}
