import type RAPIER from '@dimforge/rapier3d-compat';
import { rollingSpin } from '../ball/forces';
import { predictPath, solveGroundPass, solveLaunch, type Ghost } from '../ball/trajectory';
import { TUNING, type KeeperLevel } from '../config';
import { BALL_RADIUS, GOAL_AREA_RADIUS, HALF_LENGTH } from '../constants';
import { clamp, headingVec, type Vec2, type Vec3 } from '../math';
import type { SimEvent } from './events';
import { arrivalSpeed, pickReceiver } from './kick';
import type { Player } from './player';
import type { Possession } from './possession';

/** Height (m) and distance in front (m) at which a keeper holds a caught ball. */
const HANDS_HEIGHT = 1.1;
const HANDS_FORWARD = 0.35;
/** A keeper holding the ball stays this far (m) in front of their own goal line. */
const LINE_CLEARANCE = 0.6;

/**
 * A keeper's handling: catching the ball, holding it, and throwing or rolling it out.
 * While held, the ball is pinned to the keeper's hands every step: the one exception to
 * the ball being a free physics body.
 */
export class Handling {
  /** The keeper holding the ball, or null. */
  holder: number | null = null;
  /** Seconds the ball has been held. */
  heldFor = 0;

  /**
   * Can `keeper` catch the ball, which has just touched them at `ball` moving at `v`?
   * Only inside their own area (the goal they defend is at `ownGoalX`), only a ball that
   * isn't coming too fast for their level, and not a ball a teammate has just passed or
   * played back to them (futsal's back-pass rule).
   */
  canCatch(keeper: Player, ball: Vec3, v: Vec3, ownGoalX: number, level: KeeperLevel, lastTouchTeam: 0 | 1 | null): boolean {
    if (this.holder !== null || !keeper.keeper) return false;
    if (Math.hypot(ball.x - ownGoalX, ball.z) > GOAL_AREA_RADIUS) return false;
    if (lastTouchTeam === keeper.team) return false;
    return Math.hypot(v.x, v.y, v.z) <= level.catchSpeed;
  }

  catch(keeper: Player, ball: RAPIER.RigidBody, possession: Possession): void {
    this.holder = keeper.id;
    this.heldFor = 0;
    possession.control(keeper.id);
    this.pin(keeper, ball);
  }

  /** Keep a held ball in the keeper's hands; call every step before the physics step. */
  hold(keeper: Player, ball: RAPIER.RigidBody, dt: number): void {
    this.heldFor += dt;
    this.pin(keeper, ball);
  }

  /**
   * The keeper may not carry the ball out of their area, nor (holding it in front of them)
   * back over their own line: keep them inside the area and off the line.
   */
  confine(keeper: Player, ownGoalX: number): void {
    const dx = keeper.pos.x - ownGoalX;
    const dz = keeper.pos.z;
    const d = Math.hypot(dx, dz);
    const max = GOAL_AREA_RADIUS - 1;
    if (d > max) {
      keeper.pos.x = ownGoalX + (dx / d) * max;
      keeper.pos.z = (dz / d) * max;
    }
    const out = Math.sign(-ownGoalX); // the way out of the goal, towards the pitch
    if ((keeper.pos.x - ownGoalX) * out < LINE_CLEARANCE) keeper.pos.x = ownGoalX + out * LINE_CLEARANCE;
  }

  /** Let go without a kick (restarts). */
  drop(): void {
    this.holder = null;
    this.heldFor = 0;
  }

  /**
   * Distribute the ball to the teammate the keeper is facing (`pickReceiver`), or along
   * their facing if nobody's there: thrown if they're further than `throwDistance`,
   * otherwise rolled out along the ground. Returns the kick event.
   */
  distribute(keeper: Player, players: readonly Player[], ball: RAPIER.RigidBody, possession: Possession, ghost: Ghost): SimEvent {
    const K = TUNING.keeper;
    const f = headingVec(keeper.facing);
    const hands = handsPos(keeper);
    const receiver = pickReceiver(keeper, players, hands);
    const aim: Vec2 = receiver
      ? { x: receiver.pos.x + receiver.vel.x * 0.5, z: receiver.pos.z + receiver.vel.z * 0.5 }
      : { x: keeper.pos.x + f.x * K.throwDistance, z: keeper.pos.z + f.z * K.throwDistance };
    aim.x = clamp(aim.x, -HALF_LENGTH + 1, HALF_LENGTH - 1);
    const d = Math.hypot(aim.x - hands.x, aim.z - hands.z);

    let from: Vec3;
    let v: Vec3;
    let w: Vec3;
    if (d > K.throwDistance) {
      // Overarm throw from the hands, landing at the receiver's feet.
      from = hands;
      const launch = solveLaunch(ghost, from, { x: aim.x, y: BALL_RADIUS * 2, z: aim.z }, K.throwSpeed);
      v = launch.velocity;
      w = { x: 0, y: 0, z: 0 };
    } else {
      // Bowled out along the ground from the keeper's feet.
      from = { x: hands.x, y: BALL_RADIUS, z: hands.z };
      const dir = { x: (aim.x - from.x) / d, z: (aim.z - from.z) / d };
      const pass = solveGroundPass(ghost, from, dir, d, arrivalSpeed(d));
      v = pass.velocity;
      w = rollingSpin(v.x, v.z);
    }
    ball.setTranslation(from, true);
    ball.setLinvel(v, true);
    ball.setAngvel(w, true);
    possession.kick(keeper.id);
    keeper.touchCooldown = TUNING.kick.cooldown;
    this.drop();
    return {
      type: 'kick',
      player: keeper.id,
      kind: 'pass',
      power: 0,
      target: { x: aim.x, y: BALL_RADIUS, z: aim.z },
      atGoal: false,
      receiver: receiver?.id ?? null,
      path: predictPath(ghost, from, v, w),
    };
  }

  private pin(keeper: Player, ball: RAPIER.RigidBody): void {
    ball.setTranslation(handsPos(keeper), true);
    ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

/** Where a keeper holds the ball: chest height, just in front of them. */
export function handsPos(keeper: Player): Vec3 {
  const f = headingVec(keeper.facing);
  return { x: keeper.pos.x + f.x * HANDS_FORWARD, y: HANDS_HEIGHT, z: keeper.pos.z + f.z * HANDS_FORWARD };
}
