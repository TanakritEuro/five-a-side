// Ported unchanged from ../penalty-shootout/src/shooting/aero.ts.
import type RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { AIR_DENSITY, BALL_CROSS_SECTION, BALL_DRAG_COEFFICIENT, BALL_MASS, BALL_RADIUS } from '../constants';
import type { Vec3 } from '../math';

/** ½ρA/m: turns a force coefficient into acceleration per (m/s)². */
const K = (0.5 * AIR_DENSITY * BALL_CROSS_SECTION) / BALL_MASS;

/**
 * Aerodynamic acceleration (m/s²) on the ball moving at `v` (m/s) spinning at `w` (rad/s):
 * quadratic drag against the motion plus Magnus lift along ω × v. Gravity is not included.
 *
 * The lift coefficient grows with the spin parameter S = r·|ω| / |v| (roughly C_L ≈ S
 * for a football) up to a cap, so a fast-spinning slow ball curves the most.
 */
export function aeroAcceleration(v: Vec3, w: Vec3): Vec3 {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 0.01) return { x: 0, y: 0, z: 0 };

  const drag = -K * BALL_DRAG_COEFFICIENT * speed;
  const a = { x: drag * v.x, y: drag * v.y, z: drag * v.z };

  const spin = Math.hypot(w.x, w.y, w.z);
  if (spin > 1e-3) {
    const B = TUNING.ball;
    const lift = Math.min(B.maxLiftCoefficient, (BALL_RADIUS * spin) / speed) * B.curveStrength;
    // |ω × v| = |ω||v| sin θ, so dividing by |ω||v| keeps the sin θ: spin along the
    // direction of travel (a rifle spin) gives no lift.
    const m = (K * lift * speed * speed) / (spin * speed);
    a.x += m * (w.y * v.z - w.z * v.y);
    a.y += m * (w.z * v.x - w.x * v.z);
    a.z += m * (w.x * v.y - w.y * v.x);
  }
  return a;
}

/** Set this step's drag and Magnus force on the ball's rigid body. Call before `world.step()`. */
export function applyAero(ball: RAPIER.RigidBody): void {
  const a = aeroAcceleration(ball.linvel(), ball.angvel());
  const m = ball.mass();
  ball.resetForces(false);
  ball.addForce({ x: a.x * m, y: a.y * m, z: a.z * m }, true);
}
