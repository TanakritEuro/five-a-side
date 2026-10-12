// Ported from ../penalty-shootout/src/shooting/outcome.ts. Changes: shots at either end
// of a pitch whose goal lines are at x = ±HALF_LENGTH (the penalty game had one goal at
// z = 0), and keeper touches reported by the caller rather than by collider tag.
import { TUNING } from '../config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH } from '../constants';
import type { Vec3 } from '../math';
import type { GoalEnd } from '../physics';

export type Woodwork = 'post' | 'bar';
export type MissKind = 'wide' | 'over' | 'highAndWide' | 'short';

export type ShotOutcome =
  | { kind: 'goal'; woodwork: Woodwork | null; keeperTouch: boolean }
  | { kind: 'saved' }
  | { kind: 'woodwork'; woodwork: Woodwork }
  | { kind: 'miss'; miss: MissKind };

const O = TUNING.outcome;

/** The whole ball is over the goal line at `end`, between the posts and under the bar. */
export function inGoal(p: Vec3, end: GoalEnd): boolean {
  return p.x * end > HALF_LENGTH + BALL_RADIUS && Math.abs(p.z) < GOAL_WIDTH / 2 && p.y < GOAL_HEIGHT;
}

/**
 * Watches one shot at the goal at `end` from the moment it is struck and decides how it
 * ended. Feed it the ball's contacts and state every physics step; `update` returns the
 * outcome once it is known and null until then.
 */
export class ShotTracker {
  private elapsed = 0;
  private woodwork: Woodwork | null = null;
  private keeperTouch = false;

  constructor(readonly end: GoalEnd) {}

  onWoodwork(part: Woodwork): void {
    // Remember the first piece of woodwork hit; "off the bar and the post" reads as "off the bar".
    if (this.woodwork === null) this.woodwork = part;
  }

  onKeeperTouch(): void {
    this.keeperTouch = true;
  }

  update(dt: number, p: Vec3, v: Vec3): ShotOutcome | null {
    this.elapsed += dt;
    // How far in front of the goal line the ball is (negative once it's over).
    const inFront = HALF_LENGTH - p.x * this.end;

    // The whole ball has crossed the goal line (or its extension).
    if (inFront < -BALL_RADIUS) {
      if (inGoal(p, this.end)) return { kind: 'goal', woodwork: this.woodwork, keeperTouch: this.keeperTouch };
      const insidePosts = Math.abs(p.z) < GOAL_WIDTH / 2;
      const underBar = p.y < GOAL_HEIGHT;
      return this.stayedOut() ?? { kind: 'miss', miss: insidePosts ? 'over' : underBar ? 'wide' : 'highAndWide' };
    }

    // Once deflected, wait for the ball to die or come back out before calling it.
    const speed = Math.hypot(v.x, v.y, v.z);
    const settled = speed < O.settleSpeed && this.elapsed > 0.5;
    const deflected = this.stayedOut();
    if (deflected && (settled || inFront > O.reboundDistance)) return deflected;
    if (settled || this.elapsed > O.maxFlightTime) return deflected ?? { kind: 'miss', miss: 'short' };
    return null;
  }

  /**
   * Someone has brought the ball under control (a rebound or a block): the shot is over.
   * Reports it if it was kept out by the keeper or the woodwork, otherwise null.
   */
  interrupted(): ShotOutcome | null {
    return this.stayedOut();
  }

  /** How the shot was kept out if it touched the keeper or the woodwork; null if it touched neither. */
  private stayedOut(): ShotOutcome | null {
    // Any keeper touch on a shot that stays out counts as a save, even if it then hits the frame.
    if (this.keeperTouch) return { kind: 'saved' };
    if (this.woodwork) return { kind: 'woodwork', woodwork: this.woodwork };
    return null;
  }
}

export function describeOutcome(outcome: ShotOutcome): string {
  switch (outcome.kind) {
    case 'goal':
      if (outcome.keeperTouch) return 'GOAL! Through the keeper';
      return outcome.woodwork === 'post' ? 'GOAL! In off the post' : outcome.woodwork === 'bar' ? 'GOAL! In off the bar' : 'GOAL!';
    case 'saved':
      return 'Saved!';
    case 'woodwork':
      return outcome.woodwork === 'post' ? 'Off the post!' : 'Off the bar!';
    case 'miss':
      switch (outcome.miss) {
        case 'wide':
          return 'Wide!';
        case 'over':
          return 'Over the bar!';
        case 'highAndWide':
          return 'High and wide!';
        case 'short':
          return 'Never reached the goal';
      }
  }
}
