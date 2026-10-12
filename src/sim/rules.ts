import { inGoal } from '../ball/outcome';
import { TUNING } from '../config';
import { BOARD_THICKNESS, GOAL_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH, POST_RADIUS } from '../constants';
import { clamp, type Vec2, type Vec3 } from '../math';
import type { GoalEnd } from '../physics';
import type { SimEvent } from './events';

export type RestartKind = 'kickoff' | 'kickIn' | 'goalClearance';

/** How play starts again: what kind of restart, where the ball goes, and whose it is. */
export interface Restart {
  kind: RestartKind;
  at: Vec2;
  team: 0 | 1;
}

/** The match's state machine. */
export type Phase =
  | { kind: 'playing' }
  /** The ball is in the net; kick-off after `goalDelay`. */
  | { kind: 'goal'; team: 0 | 1; timer: number }
  /** The ball went over the netting; `restart` after `outDelay`. */
  | { kind: 'out'; restart: Restart; timer: number }
  /** The ball has been placed for `restart`; everyone holds still until the timer runs out. */
  | { kind: 'restart'; restart: Restart; timer: number };

export interface RulesContext {
  /** Team of the last player to touch the ball, or null. */
  lastTouchTeam: 0 | 1 | null;
  attackDir: (team: 0 | 1) => 1 | -1;
}

/** Where a kick-in is taken from: this far in from the boards (m)... */
const KICK_IN_INSET = 0.5;
/** ...and not closer than this to an end wall (m). */
const KICK_IN_END_MARGIN = 1;
/** A goal clearance is placed this far out from the goal line (m) (the keeper's until M3). */
const CLEARANCE_DISTANCE = 2.5;

/**
 * The ball has left the cage: over the netting on any side, or out of the back of the
 * end walls anywhere but into a goal. (A ball that falls through the world counts too.)
 */
export function outOfCage(p: Vec3): boolean {
  if (p.y < -1) return true;
  if (Math.abs(p.z) > HALF_WIDTH + BOARD_THICKNESS) return true;
  if (Math.abs(p.x) <= HALF_LENGTH + BOARD_THICKNESS) return false;
  const inGoalFrame =
    Math.abs(p.x) < HALF_LENGTH + GOAL_DEPTH + POST_RADIUS &&
    Math.abs(p.z) < GOAL_WIDTH / 2 + POST_RADIUS &&
    p.y < GOAL_HEIGHT + POST_RADIUS;
  return !inGoalFrame;
}

/** The restart for a ball that went out at `p`, to the side that didn't touch it last. */
export function restartAfterOut(p: Vec3, ctx: RulesContext): Restart {
  const pastEnd = Math.abs(p.x) > HALF_LENGTH;
  if (pastEnd && Math.abs(p.z) < HALF_WIDTH) {
    // Over an end wall: a goal clearance to the team defending that goal.
    const end: GoalEnd = p.x > 0 ? 1 : -1;
    const defending: 0 | 1 = ctx.attackDir(0) === end ? 1 : 0;
    return { kind: 'goalClearance', at: { x: end * (HALF_LENGTH - CLEARANCE_DISTANCE), z: 0 }, team: defending };
  }
  const maxX = HALF_LENGTH - KICK_IN_END_MARGIN;
  return {
    kind: 'kickIn',
    at: { x: clamp(p.x, -maxX, maxX), z: Math.sign(p.z) * (HALF_WIDTH - KICK_IN_INSET) },
    team: ctx.lastTouchTeam === 0 ? 1 : 0,
  };
}

/**
 * Goals, the ball going out, and the pauses and restarts that follow. `update` runs after
 * each physics step; when it returns a restart, the simulation places the ball (and the
 * players, for a kick-off).
 */
export class Rules {
  phase: Phase = { kind: 'playing' };
  readonly score: [number, number] = [0, 0];

  /** The ball is live: players may play it. */
  get inPlay(): boolean {
    return this.phase.kind === 'playing';
  }

  /** Everyone holds still while a restart is set. */
  get frozen(): boolean {
    return this.phase.kind === 'restart';
  }

  update(ball: Vec3, dt: number, ctx: RulesContext, events: SimEvent[]): Restart | null {
    const R = TUNING.rules;
    const phase = this.phase;
    switch (phase.kind) {
      case 'playing': {
        for (const end of [1, -1] as const) {
          if (!inGoal(ball, end)) continue;
          const team: 0 | 1 = ctx.attackDir(0) === end ? 0 : 1;
          this.score[team]++;
          this.phase = { kind: 'goal', team, timer: R.goalDelay };
          events.push({ type: 'goal', team, end, score: [this.score[0], this.score[1]] });
          return null;
        }
        if (outOfCage(ball)) {
          const restart = restartAfterOut(ball, ctx);
          this.phase = { kind: 'out', restart, timer: R.outDelay };
          events.push({ type: 'out', restart });
        }
        return null;
      }
      case 'goal': {
        phase.timer -= dt;
        if (phase.timer > 0) return null;
        // The team that conceded kicks off.
        return this.restart({ kind: 'kickoff', at: { x: 0, z: 0 }, team: phase.team === 0 ? 1 : 0 }, events);
      }
      case 'out': {
        phase.timer -= dt;
        return phase.timer > 0 ? null : this.restart(phase.restart, events);
      }
      case 'restart': {
        phase.timer -= dt;
        if (phase.timer <= 0) this.phase = { kind: 'playing' };
        return null;
      }
    }
  }

  private restart(restart: Restart, events: SimEvent[]): Restart {
    this.phase = { kind: 'restart', restart, timer: TUNING.rules.restartFreeze };
    events.push({ type: 'restart', restart });
    return restart;
  }
}
