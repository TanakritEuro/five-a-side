import type RAPIER from '@dimforge/rapier3d-compat';
import { isOnGround, rollingSpin } from '../ball/forces';
import { TUNING } from '../config';
import { clamp, damp, gaussian, headingVec, wrapAngle, type Rng, type Vec2 } from '../math';
import type { SimEvent } from './events';
import type { Player } from './player';
import { ballRelative, canPlayBall, type Possession } from './possession';

const DEG = Math.PI / 180;
const DEAD_ZONE = 0.05;

/**
 * Let a player play the ball with their feet this step, if they can reach it:
 * - **Dribbling** (they have it and are told to move): once they've caught the ball up,
 *   nudge it on a little faster than they're running (much faster when sprinting). The
 *   touch goes the way they're being steered, up to `touchTurn` off the way they face, so
 *   turns are taken in a few touches. They also retake it if it's rolling off that line.
 * - **Stopping** with the ball (no move input): trap it, bringing it to a halt.
 * - **Receiving** a loose ball that isn't coming too fast: a first touch that takes most
 *   of the pace off it, and possession.
 * `move` is the player's command direction. Call after the player has moved and before
 * the physics step.
 */
export function playBall(
  p: Player,
  ball: RAPIER.RigidBody,
  possession: Possession,
  move: Vec2,
  rng: Rng,
  dt: number,
): SimEvent | null {
  if (p.touchCooldown > 0) return null;
  const pos = ball.translation();
  const rel = ballRelative(p, pos);
  if (!canPlayBall(p, pos, rel)) return null;

  const D = TUNING.dribble;
  const v = ball.linvel();
  const vy = isOnGround(pos) ? 0 : v.y;

  if (possession.owner === p.id) {
    if (Math.hypot(move.x, move.z) < DEAD_ZONE) {
      // Stopping it: a foot on the ball brings it to a halt.
      const k = 1 - damp(D.trapRate, dt);
      setBall(ball, v.x * k, vy, v.z * k);
      return null;
    }
    // Touch towards where they're being steered, as far as their body allows.
    const wanted = Math.atan2(move.z, move.x);
    const heading = p.facing + clamp(wrapAngle(wanted - p.facing), -D.touchTurn * DEG, D.touchTurn * DEG);
    const h = headingVec(heading);
    const along = v.x * h.x + v.z * h.z;
    const ballSpeed = Math.hypot(v.x, v.z);
    const offLine = ballSpeed > 0.5 && along / ballSpeed < Math.cos(D.redirectAngle * DEG);
    const caughtUp = rel.ahead < D.touchDistance && along < p.speed + D.touchAhead * 0.5;
    if (!caughtUp && !offLine) return null;

    const speed = p.speed + (p.sprinting ? D.sprintTouchAhead : D.touchAhead);
    const d = headingVec(heading + gaussian(rng) * D.touchNoise);
    setBall(ball, d.x * speed, vy, d.z * speed);
    p.touchCooldown = D.touchCooldown;
    possession.control(p.id);
    return { type: 'touch', player: p.id, kind: 'dribble' };
  }

  // A loose ball: first touch. (Taking it off someone else is a tackle: Milestone 4.)
  if (possession.owner !== null) return null;
  const rx = v.x - p.vel.x;
  const rz = v.z - p.vel.z;
  if (Math.hypot(rx, rz) > D.receiveSpeed) return null; // too hot to handle: it bounces off
  setBall(ball, p.vel.x + rx * D.receiveKeep, vy, p.vel.z + rz * D.receiveKeep);
  p.touchCooldown = D.touchCooldown;
  possession.control(p.id);
  return { type: 'touch', player: p.id, kind: 'receive' };
}

function setBall(ball: RAPIER.RigidBody, vx: number, vy: number, vz: number): void {
  ball.setLinvel({ x: vx, y: vy, z: vz }, true);
  ball.setAngvel(rollingSpin(vx, vz), true);
}

/**
 * Where a dribbler actually runs, given the way they're told to go. A player on the ball
 * keeps it with them rather than leaving it behind:
 * - letting go of the controls means "stop it": they go to the ball (flat out until it's
 *   in reach, then easing in while `playBall` traps it) instead of stopping dead as it
 *   rolls away;
 * - turning away from a ball that's out of reach: they go to the ball first, and the
 *   touches then bring it round.
 * Anyone else, or a dribbler with the ball at their feet, just goes where they're told.
 */
export function dribbleMove(p: Player, move: Vec2, ball: RAPIER.RigidBody, possession: Possession): Vec2 {
  if (possession.owner !== p.id) return move;
  const D = TUNING.dribble;
  const b = ball.translation();
  const v = ball.linvel();
  const rel = ballRelative(p, b);
  const amount = Math.hypot(move.x, move.z);
  if (amount < DEAD_ZONE) {
    // Stopping: chase the ball flat out until it's in reach, then ease in to it as the trap halts it.
    const toBall = { x: b.x - p.pos.x, z: b.z - p.pos.z };
    const ease = rel.distance > D.reach ? 1 : clamp((rel.distance - D.touchDistance * 0.8) * 2, 0, 1);
    return { x: (toBall.x / rel.distance) * ease, z: (toBall.z / rel.distance) * ease };
  }
  // Turning: get well in reach of the ball first.
  if (rel.distance <= D.reach * 0.9) return move;

  // Head for where the ball will be in a moment.
  const tx = b.x + v.x * D.chaseLead - p.pos.x;
  const tz = b.z + v.z * D.chaseLead - p.pos.z;
  const d = Math.hypot(tx, tz);
  const cos = (tx * move.x + tz * move.z) / (d * amount);
  if (cos >= Math.cos(D.chaseAngle * DEG)) return move;
  return { x: (tx / d) * amount, z: (tz / d) * amount };
}
