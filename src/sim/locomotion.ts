import { TUNING } from '../config';
import { attrScale, clamp, wrapAngle, type Vec2 } from '../math';

/** The part of a player's state that the locomotion model owns. */
export interface MoveState {
  /** Ground speed (m/s), always along `facing`. */
  speed: number;
  /** Heading (radians, 0 = +X, π/2 = +Z). The player faces the way they run. */
  facing: number;
  /** 0–1. Drains while sprinting, recovers otherwise. */
  stamina: number;
  /** Whether the player sprinted this step (moving faster than jog on a sprint command). */
  sprinting: boolean;
}

export interface MoveInput {
  /** Desired direction on the ground, length 0–1. */
  move: Vec2;
  sprint: boolean;
  /** Dribbling: a little slower and less agile. */
  onBall: boolean;
  /** Pace attribute, 0–1 (0.5 = average). */
  pace: number;
}

const DEAD_ZONE = 0.05;

/**
 * Advance a player's movement by `dt`. Velocity steers towards the desired velocity with
 * limited acceleration, braking and turn rate rather than snapping to it. Speed and
 * heading are integrated separately: the heading turns at a rate that falls with speed,
 * and the target speed is cut by how far the heading still has to turn, so a hard
 * reversal brakes first and then pivots instead of spinning round at full pace.
 * Mutates and returns `s`.
 */
export function stepLocomotion(s: MoveState, input: MoveInput, dt: number): MoveState {
  const L = TUNING.locomotion;
  const S = TUNING.stamina;
  const pace = attrScale(input.pace, L.paceSpread);
  const amount = Math.min(1, Math.hypot(input.move.x, input.move.z));
  const moving = amount > DEAD_ZONE;

  const jog = L.jogSpeed * pace;
  // Sprint speed fades to jog as stamina runs out.
  const fresh = clamp(s.stamina / S.tiredThreshold, 0, 1);
  const sprintTop = jog + (L.sprintSpeed * pace - jog) * fresh;
  const wantsSprint = input.sprint && moving && amount > 0.5;
  let top = (wantsSprint ? sprintTop : jog) * amount;
  if (input.onBall) top *= L.onBallSpeed;

  let target = 0;
  if (moving) {
    const desired = Math.atan2(input.move.z, input.move.x);
    let rate = s.speed < L.pivotSpeed ? L.turnRate : L.turnRate / (1 + L.turnSpeedFactor * s.speed);
    if (input.onBall) rate *= L.onBallTurn;
    const error = wrapAngle(desired - s.facing);
    const turn = clamp(error, -rate * dt, rate * dt);
    s.facing = wrapAngle(s.facing + turn);
    target = top * Math.max(0, Math.cos(error - turn));
  }

  if (target > s.speed) {
    const accel = (s.speed < jog ? L.accel : L.sprintAccel) * pace;
    s.speed = Math.min(target, s.speed + accel * dt);
  } else {
    s.speed = Math.max(target, s.speed - L.decel * dt);
  }

  s.sprinting = wantsSprint && s.speed > jog * 0.95 && s.stamina > 0;
  const dStamina = s.sprinting ? -S.drain : S.recovery;
  s.stamina = clamp(s.stamina + dStamina * dt, 0, 1);
  return s;
}
