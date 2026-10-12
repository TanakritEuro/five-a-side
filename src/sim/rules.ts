import { BOARD_THICKNESS, GOAL_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH, POST_RADIUS } from '../constants';
import { clamp, type Vec2, type Vec3 } from '../math';
import type { GoalEnd } from '../physics';

export type RestartKind = 'kickoff' | 'kickIn' | 'goalClearance';

/** How play starts again: what kind of restart, where the ball goes, and whose it is. */
export interface Restart {
  kind: RestartKind;
  at: Vec2;
  team: 0 | 1;
}

export interface RulesContext {
  /** Team of the last player to touch the ball, or null. */
  lastTouchTeam: 0 | 1 | null;
  attackDir: (team: 0 | 1) => 1 | -1;
}

/** Where a kick-in is taken from: this far in from the boards (m), room for the taker behind it... */
export const KICK_IN_INSET = 1;
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

