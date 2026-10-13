import { TUNING, type AiLevel } from '../config';
import { HALF_WIDTH, PHYSICS_STEP } from '../constants';
import type { Rng, Vec2 } from '../math';
import type { Command } from '../sim/command';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { approach, winChance } from '../sim/tackle';
import type { TeamPlan } from './brain';
import { ballPos, goalSide, ownGoal, steer } from './geometry';
import { arrive, insidePitch, pursue, seek, separate, STAND } from './steering';

/** What an AI player is doing. One state machine per player; see `Ai`. */
export type AiState =
  /** Off the ball, nothing else to do: go to (and stay at) their slot in the shifted formation. */
  | { kind: 'hold' }
  /** The team's player who can get to the loose ball first: go to where they'll meet it. */
  | { kind: 'chase'; point: Vec2 }
  /** Close down the opponent on the ball, getting goal-side of them. */
  | { kind: 'press'; carrier: number }
  /** Our pass is on its way to them: go to where they'll meet it. */
  | { kind: 'receive'; point: Vec2 }
  /** Attacking: get to a support spot to offer a pass... */
  | { kind: 'support'; spot: Vec2 }
  /** ...or sprint to one well ahead of the ball (a run in behind). */
  | { kind: 'run'; spot: Vec2 }
  /** Sit behind the presser, goal-side, in case they're beaten. */
  | { kind: 'cover' }
  /** Stay goal-side of `opponent`, a little towards the ball. */
  | { kind: 'mark'; opponent: number }
  /** A keeper off the ball: stand between the ball and the middle of the goal. */
  | { kind: 'keeper' }
  /** A keeper facing a shot: wait until tick `at`, then dive towards (across, height); `done` once they have. */
  | { kind: 'dive'; across: number; height: number; at: number; done: boolean }
  /** A keeper with the ball in their hands: hold it a moment, then throw or roll it to teammate `to` (once chosen). */
  | { kind: 'holding'; to: number | null }
  /** On the ball (see onball.ts). */
  | { kind: 'dribble'; plan: DribblePlan }
  /** Taking a kick-off or set piece, once decided how (see onball.ts). */
  | { kind: 'takeRestart'; plan: RestartPlan | null }
  /** Standing in the wall at a free kick near our goal. */
  | { kind: 'wall'; spot: Vec2 }
  /** We've scored: the scorer (`to` null) runs off towards the touchline, teammates run to them (`to`). */
  | { kind: 'celebrate'; to: number | null }
  /** They've scored: stand there. */
  | { kind: 'dejected' };

/** How an AI taker means to take a set piece: shoot at a corner (holding K for `hold` steps), or pass. */
export type RestartPlan = { kind: 'shoot'; corner: 1 | -1; hold: number } | { kind: 'pass' };

export type DribblePlan =
  /** Carry it at goal, aiming for one corner (+1 or -1 across the goal); decide again at tick `nextDecision`. */
  | { kind: 'run'; corner: 1 | -1; nextDecision: number }
  /** Lining up and charging a shot: hold K for at least `hold` steps; abandon it at tick `giveUp`. */
  | { kind: 'shoot'; corner: 1 | -1; hold: number; giveUp: number }
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
    case 'support': {
      const s = arrive(p, state.spot, 0.4);
      return steer({ move: separate(p, s.move, sim.players), sprint: s.sprint || far(p, state.spot, 6) });
    }
    case 'run': {
      const s = far(p, state.spot, 2) ? seek(p, state.spot, true) : arrive(p, state.spot, 0.4);
      return steer({ move: separate(p, s.move, sim.players), sprint: s.sprint });
    }
    case 'receive':
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
    case 'celebrate': {
      if (state.to === null) {
        // Off towards the nearer touchline.
        const side = p.pos.z >= 0 ? 1 : -1;
        return steer(seek(p, insidePitch({ x: p.pos.x, z: side * HALF_WIDTH }, 2), true));
      }
      const scorer = sim.players[state.to];
      return steer(arrive(p, scorer.pos, 1));
    }
    case 'dejected':
      return steer(STAND);
    case 'wall': {
      const s = arrive(p, state.spot, 0.1);
      return steer({ move: s.move, sprint: s.sprint || far(p, state.spot, 3) });
    }
    case 'dive':
    case 'holding':
    case 'dribble':
    case 'takeRestart':
      throw new Error(`offBall called for a state with its own command (${state.kind})`);
  }
}

/**
 * Should the presser go in for the tackle now? Only with the ball in reach in front of
 * them, a fair chance of winning it (the level sets how fair), and not from behind unless
 * the carrier is through on goal. Even then they wait for the moment, at the level's rate.
 */
export function pressTackle(sim: Sim, p: Player, carrier: Player, level: AiLevel, rng: Rng): boolean {
  const T = TUNING.tackle;
  if (p.tackle || !sim.match.inPlay) return false;
  const b = ballPos(sim);
  const dx = b.x - p.pos.x;
  const dz = b.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > T.reach * 0.9) return false;
  const f = { x: Math.cos(p.facing), z: Math.sin(p.facing) };
  if ((dx * f.x + dz * f.z) / (d || 1) < Math.cos(T.aimCone * Math.PI / 180)) return false;
  const g = ownGoal(sim, p.team);
  const through = Math.hypot(carrier.pos.x - g.x, carrier.pos.z - g.z) < TUNING.ai.throughOnGoal;
  if (approach(p, carrier) < TUNING.ai.behindTackle && !through) return false;
  if (winChance(p, carrier, b) < level.tackleChance) return false;
  return rng() < level.tackleRate * PHYSICS_STEP;
}

/**
 * Where `team`'s wall stands at the other team's free kick, if it's close enough to
 * their goal to need one: two spots side by side on the line from the ball to the
 * middle of the goal, just outside the distance the kick gives them, the second towards
 * the near post. Empty otherwise.
 */
export function wallSpots(sim: Sim, team: 0 | 1): Vec2[] {
  const phase = sim.match.phase;
  if (phase.kind !== 'restart' || phase.restart.kind !== 'freeKick' || phase.restart.team === team) return [];
  const b = phase.restart.at;
  const g = ownGoal(sim, team);
  const dx = g.x - b.x;
  const dz = g.z - b.z;
  const d = Math.hypot(dx, dz);
  const out = TUNING.match.freeKickDistance + 0.2;
  if (d > TUNING.ai.wallRange || d < out + 1) return [];
  const ux = dx / d;
  const uz = dz / d;
  const first = { x: b.x + ux * out, z: b.z + uz * out };
  // Across the line, towards the side of the pitch the ball is on (the near post).
  const side = b.z >= 0 ? 1 : -1;
  const flip = ux * side >= 0 ? 1 : -1;
  const nx = -uz * flip;
  const nz = ux * flip;
  const k = TUNING.ai.wallSpacing;
  return [insidePitch(first), insidePitch({ x: first.x + nx * k, z: first.z + nz * k })];
}

/** Goal-side of where `opponent` is heading, by `markDistance`, nudged towards the ball to cut off a pass to them. */
export function markSpot(sim: Sim, p: Player, opponent: Player): Vec2 {
  const A = TUNING.ai;
  // Mark where he's going, not where he is, so a run doesn't leave the marker behind.
  const ahead = { x: opponent.pos.x + opponent.vel.x * A.markLead, z: opponent.pos.z + opponent.vel.z * A.markLead };
  const side = goalSide(sim, ahead, p.team, A.markDistance);
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
