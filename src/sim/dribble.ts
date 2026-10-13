import type RAPIER from '@dimforge/rapier3d-compat';
import { isOnGround, rollingSpin } from '../ball/forces';
import { TUNING } from '../config';
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, PLAYER_RADIUS } from '../constants';
import { attrScale, clamp, damp, gaussian, headingVec, wrapAngle, type Rng, type Vec2, type Vec3 } from '../math';
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
 *   of the pace off it (less for a hard ball and a poor touch), and possession.
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
  if (possession.owner === p.id) {
    const pull = pullBack(p, pos, rel.distance, move);
    if (pull) {
      setBall(ball, pull.x, 0, pull.z);
      p.touchCooldown = TUNING.dribble.touchCooldown;
      possession.control(p.id);
      return { type: 'touch', player: p.id, kind: 'dribble' };
    }
  }
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
    // Lining up a kick: no touches, so they catch the ball up and strike it.
    if (p.charge || p.pendingKick) return null;

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
  const incoming = Math.hypot(rx, rz);
  if (incoming > D.receiveSpeed) return null; // too hot to handle: it bounces off
  // The first touch: the harder the ball and the poorer their control, the more pace it
  // keeps, knocked on ahead of them at a less certain angle.
  const hard = (incoming / D.receiveSpeed) ** 2;
  const clumsy = attrScale(1 - p.attrs.passing, D.controlSpread);
  const keep = (D.touchKeep[0] + (D.touchKeep[1] - D.touchKeep[0]) * hard) * clumsy;
  const d = headingVec(p.facing + gaussian(rng) * D.touchSpread * hard * clumsy);
  setBall(ball, p.vel.x + d.x * incoming * keep, vy, p.vel.z + d.z * incoming * keep);
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
 * - turning away from a ball that's out of reach: they go to the ball first;
 * - with the ball in reach but on the wrong side of them for where they want to go (a
 *   sharp turn, or the ball pinned against the boards): they go round it to get behind
 *   it, swinging out so as not to run through it, and the touches then take it on.
 * Anyone else, or a dribbler already behind the ball, just goes where they're told.
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
  const ux = move.x / amount;
  const uz = move.z / amount;

  if (rel.distance > D.reach * 0.9) {
    // Out of reach: head for where the ball will be in a moment, unless it's going their way anyway.
    const tx = b.x + v.x * D.chaseLead - p.pos.x;
    const tz = b.z + v.z * D.chaseLead - p.pos.z;
    const d = Math.hypot(tx, tz);
    if ((tx * ux + tz * uz) / d >= Math.cos(D.chaseAngle * DEG)) return move;
    return { x: (tx / d) * amount, z: (tz / d) * amount };
  }

  // Pinned against the boards: `playBall` drags it out, wherever it is round them.
  if (boardNormal(b)) return move;
  // In reach and between them and where they're going: carry on, the touches steer it.
  const bx = (b.x - p.pos.x) / rel.distance;
  const bz = (b.z - p.pos.z) / rel.distance;
  if (bx * ux + bz * uz >= Math.cos(D.behindAngle * DEG)) return move;

  // On the wrong side of it: go round to the spot behind it, on the side they're already on.
  const nx = -uz;
  const nz = ux;
  const side = (p.pos.x - b.x) * nx + (p.pos.z - b.z) * nz >= 0 ? 1 : -1;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  const tx = clamp(b.x - ux * D.touchDistance + nx * side * D.roundOffset, -maxX, maxX) - p.pos.x;
  const tz = clamp(b.z - uz * D.touchDistance + nz * side * D.roundOffset, -maxZ, maxZ) - p.pos.z;
  const d = Math.hypot(tx, tz);
  if (d < 0.05) return move;
  return { x: (tx / d) * amount, z: (tz / d) * amount };
}

/**
 * The way into the pitch from the boards the ball is up against (unit vector; diagonal in
 * a corner), or null if it's clear of them.
 */
export function boardNormal(b: Vec3): Vec2 | null {
  const m = BALL_RADIUS + TUNING.dribble.pinnedGap;
  const nx = b.x > HALF_LENGTH - m ? -1 : b.x < -HALF_LENGTH + m ? 1 : 0;
  const nz = b.z > HALF_WIDTH - m ? -1 : b.z < -HALF_WIDTH + m ? 1 : 0;
  if (nx === 0 && nz === 0) return null;
  const n = Math.hypot(nx, nz);
  return { x: nx / n, z: nz / n };
}

/**
 * A dribbler with the ball pinned against the boards (or in a corner) can't get behind
 * it, so they drag it back out the way they want to go, wherever it is round them, as
 * long as it's in reach and that way leads off the boards. Returns the ball's new ground
 * velocity, or null if this isn't such a moment.
 */
function pullBack(p: Player, b: Vec3, distance: number, move: Vec2): Vec2 | null {
  const D = TUNING.dribble;
  const amount = Math.hypot(move.x, move.z);
  if (amount < DEAD_ZONE || distance > D.reach || b.y > D.maxHeight) return null;
  const n = boardNormal(b);
  if (!n) return null;
  const ux = move.x / amount;
  const uz = move.z / amount;
  if (ux * n.x + uz * n.z < 0.3) return null;
  const speed = Math.min(p.speed + D.touchAhead, D.pullSpeed);
  return { x: ux * speed, z: uz * speed };
}
