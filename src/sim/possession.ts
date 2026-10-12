import { TUNING } from '../config';
import { headingVec, type Vec2, type Vec3 } from '../math';
import type { Player } from './player';

/**
 * Who has the ball. Possession is derived, not an attachment: the ball is always a free
 * physics body, and its owner is the last player to *control* it while they stay within
 * `possessionRange` of it. Kicks, deflections and drifting out of range make it loose.
 */
export class Possession {
  /** Id of the last player to touch the ball in any way, or null before anyone has. */
  lastTouch: number | null = null;
  /** The player in control of the ball this step, or null if it is loose. */
  owner: number | null = null;
  /** Seconds the ball has been somewhere the owner can't play it (beside or behind them). */
  private sinceControl = 0;
  /** True once the last toucher has kicked it away, deflected it or lost it. */
  private released = true;

  /** A controlling touch: a dribble, a trap or a first touch. */
  control(id: number): void {
    this.lastTouch = id;
    this.released = false;
    this.owner = id;
    this.sinceControl = 0;
  }

  /** The ball was kicked: it's loose until someone controls it. */
  kick(id: number): void {
    this.lastTouch = id;
    this.released = true;
    this.owner = null;
  }

  /** The ball bounced off a player without being controlled. The owner's own body doesn't count. */
  deflect(id: number): void {
    if (id === this.owner) return;
    this.lastTouch = id;
    this.released = true;
    this.owner = null;
  }

  /** Nobody has it (restarts). */
  reset(): void {
    this.lastTouch = null;
    this.released = true;
    this.owner = null;
  }

  /**
   * Recompute the owner from where the players and the ball are now. They lose it if it
   * gets more than `possessionRange` away, or if it has been beside or behind them for
   * `possessionLapse` seconds (stuck against the boards, say).
   */
  update(players: readonly Player[], ball: Vec3, dt: number): void {
    if (this.released || this.lastTouch === null) {
      this.owner = null;
      return;
    }
    const p = players[this.lastTouch];
    // A ball out ahead of a dribbler is fine; one stuck beside or behind them isn't.
    const ahead = ballRelative(p, ball).cos >= Math.cos((TUNING.dribble.frontCone * Math.PI) / 180);
    this.sinceControl = ahead ? 0 : this.sinceControl + dt;
    const D = TUNING.dribble;
    if (Math.hypot(ball.x - p.pos.x, ball.z - p.pos.z) > D.possessionRange || this.sinceControl > D.possessionLapse) {
      this.released = true;
      this.owner = null;
    } else {
      this.owner = p.id;
    }
  }
}

/** Where the ball is relative to a player: distance, and how far ahead and across their facing. */
export interface BallRelative {
  distance: number;
  ahead: number;
  across: number;
  /** Cosine of the angle between the player's facing and the direction to the ball. */
  cos: number;
}

export function ballRelative(p: Player, ball: Vec3): BallRelative {
  const f: Vec2 = headingVec(p.facing);
  const dx = ball.x - p.pos.x;
  const dz = ball.z - p.pos.z;
  const distance = Math.hypot(dx, dz);
  const ahead = dx * f.x + dz * f.z;
  return { distance, ahead, across: dz * f.x - dx * f.z, cos: distance > 1e-6 ? ahead / distance : 1 };
}

/** The ball is low, close and in front: the player can play it with their feet. */
export function canPlayBall(p: Player, ball: Vec3, rel = ballRelative(p, ball)): boolean {
  const D = TUNING.dribble;
  return ball.y <= D.maxHeight && rel.distance <= D.reach && rel.cos >= Math.cos((D.frontCone * Math.PI) / 180);
}
