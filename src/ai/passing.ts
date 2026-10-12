import { TUNING } from '../config';
import { AIR_DENSITY, BALL_CROSS_SECTION, BALL_DRAG_COEFFICIENT, BALL_MASS } from '../constants';
import type { Vec2 } from '../math';
import type { Player } from '../sim/player';
import { timeToReach } from './intercept';

/**
 * A ground pass in closed form. On the turf the ball decelerates by rolling resistance
 * `R` plus air drag `c·v²` (see ball/forces.ts), so dv/dt = −(R + c·v²), which has an
 * exact solution. It matches the ghost ball to a few centimetres for a fraction of
 * the cost, so the AI can price every pass it considers every brain update. The
 * chosen pass is still struck with the exact solver.
 */
const C = (0.5 * AIR_DENSITY * BALL_CROSS_SECTION * BALL_DRAG_COEFFICIENT) / BALL_MASS;

function r(): number {
  return TUNING.ball.rollingResistance;
}

/** Phase angle θ₀ = atan(v₀·√(c/R)) of a roll started at `v0`. */
function theta0(v0: number): number {
  return Math.atan(v0 * Math.sqrt(C / r()));
}

/** Seconds until a ball rolled at `v0` stops. */
export function rollStopTime(v0: number): number {
  return theta0(v0) / Math.sqrt(r() * C);
}

/** How far (m) a ball rolled at `v0` gets before it stops. */
export function rollStopDistance(v0: number): number {
  return Math.log(1 + (C * v0 * v0) / r()) / (2 * C);
}

/** Speed (m/s) `t` seconds after rolling at `v0`. */
export function rollSpeed(v0: number, t: number): number {
  if (t >= rollStopTime(v0)) return 0;
  return Math.sqrt(r() / C) * Math.tan(theta0(v0) - Math.sqrt(r() * C) * t);
}

/** Distance (m) covered `t` seconds after rolling at `v0`. */
export function rollDistance(v0: number, t: number): number {
  const th = theta0(v0);
  const phase = Math.max(0, th - Math.sqrt(r() * C) * Math.min(t, rollStopTime(v0)));
  return Math.log(Math.cos(phase) / Math.cos(th)) / C;
}

/** Seconds for a ball rolled at `v0` to cover `d` metres, or Infinity if it stops short. */
export function rollTime(v0: number, d: number): number {
  const th = theta0(v0);
  const k = Math.cos(th) * Math.exp(C * d);
  if (k >= 1) return Infinity;
  return (th - Math.acos(k)) / Math.sqrt(r() * C);
}

/** Launch speed (m/s) for a ground pass that is still rolling at `arrival` after `d` metres. */
export function launchSpeedFor(d: number, arrival: number): number {
  return Math.sqrt(((r() + C * arrival * arrival) * Math.exp(2 * C * d) - r()) / C);
}

/** Points along a pass lane where interceptions are checked, as fractions of its length. */
const SAMPLES = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

/**
 * How safe a ground pass from `from` to `to`, struck at `v0`, is: the smallest margin
 * (s) by which the ball beats every opponent to each point along the lane, and the
 * receiver gets to `to` in time. Positive is safe by that many seconds; negative means
 * someone gets there first (or the receiver doesn't make it). `receiver` may be null
 * when just testing a lane.
 */
export function passSafety(
  from: Vec2,
  to: Vec2,
  v0: number,
  receiver: Player | null,
  opponents: readonly Player[],
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  let margin = Infinity;
  for (const f of SAMPLES) {
    const point = { x: from.x + dx * f, z: from.z + dz * f };
    const tBall = rollTime(v0, d * f);
    if (!Number.isFinite(tBall)) return -Infinity; // it never gets there
    for (const o of opponents) margin = Math.min(margin, timeToReach(o, point) - tBall);
  }
  if (receiver) margin = Math.min(margin, rollTime(v0, d) - timeToReach(receiver, to) + TUNING.ai.receiveSlack);
  return margin;
}
