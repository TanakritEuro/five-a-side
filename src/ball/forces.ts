import type RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { BALL_RADIUS, PHYSICS_STEP } from '../constants';
import type { Vec3 } from '../math';
import { aeroAcceleration } from './aero';

/** The ball is in contact with the turf when its centre is this low. */
const GROUND_CONTACT = BALL_RADIUS + 0.02;
/** Vertical speed (m/s) above which a ball at the turf is bouncing rather than rolling. */
const BOUNCE_SPEED = 0.5;
const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };

export function isOnGround(p: Vec3): boolean {
  return p.y < GROUND_CONTACT;
}

export function isRolling(p: Vec3, v: Vec3): boolean {
  return isOnGround(p) && Math.abs(v.y) < BOUNCE_SPEED;
}

/** Spin (rad/s) of a ball rolling without slipping at ground velocity (vx, vz). */
export function rollingSpin(vx: number, vz: number): Vec3 {
  return { x: vz / BALL_RADIUS, y: 0, z: -vx / BALL_RADIUS };
}

/**
 * Set this step's forces on the ball. Call before every `world.step()`, in the game and in
 * the ghost-ball worlds alike, so predictions match.
 *
 * In the air: drag and Magnus lift (aero.ts).
 *
 * On the turf the ball is modelled here rather than by Rapier's friction, because Rapier
 * clamps angular velocity to a quarter turn per step (47 rad/s at 60 Hz). A ball rolling
 * faster than about 5 m/s can't spin fast enough, so Rapier's friction would skid it
 * down to that speed. Instead the ball has no friction with the ground, and here:
 * - rolling resistance slows it at a constant rate (no Magnus while it rolls);
 * - landing from a bounce costs horizontal speed in proportion to the impact, as the
 *   turf grips it (Coulomb friction, at most enough to make it roll);
 * - its spin is set to match its rolling, for the renderer (Rapier's clamp still applies).
 */
export function applyBallForces(ball: RAPIER.RigidBody): void {
  const v = ball.linvel();
  const B = TUNING.ball;
  // At the turf and not leaving it (a kick or a bounce going up is in the air already).
  const onGround = isOnGround(ball.translation()) && v.y < BOUNCE_SPEED;
  const a = aeroAcceleration(v, onGround ? NO_SPIN : ball.angvel());
  ball.resetForces(false);

  if (onGround) {
    const h = Math.hypot(v.x, v.z);
    if (h > 1e-4) {
      let dv = B.rollingResistance * PHYSICS_STEP;
      // Landing: the turf's grip takes some horizontal speed (a skid of at most 2/7 of it,
      // where a solid ball starts to roll).
      if (v.y < -BOUNCE_SPEED) dv += Math.min(B.bounceGrip * -v.y, (2 / 7) * h);
      // Never more than it takes to stop the ball, so it can't roll backwards.
      dv = Math.min(dv, h);
      a.x -= (dv / PHYSICS_STEP) * (v.x / h);
      a.z -= (dv / PHYSICS_STEP) * (v.z / h);
      const after = (h - dv) / h;
      ball.setAngvel(rollingSpin(v.x * after, v.z * after), true);
    } else {
      ball.setAngvel(NO_SPIN, true);
    }
  }
  const m = ball.mass();
  ball.addForce({ x: a.x * m, y: a.y * m, z: a.z * m }, true);
}
