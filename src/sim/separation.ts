import { TUNING } from '../config';
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, PLAYER_RADIUS } from '../constants';
import { clamp, type Vec3 } from '../math';
import type { Player } from './player';

/**
 * Push overlapping players apart, each moving half the overlap along the line between
 * them, and keep them inside the boards. Players are kinematic, so the physics engine
 * won't do this; game code decides how bodies meet (shoulder challenges come in M4).
 * Pairs are visited in a fixed order so the result is deterministic. A few passes
 * settle clusters of three or more.
 */
export function separatePlayers(players: readonly Player[]): void {
  const min = 2 * PLAYER_RADIUS + TUNING.separation.gap;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i].pos;
        const b = players[j].pos;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 1e-6) {
          // Exactly on top of each other: split them along X, lower id to -X.
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = (min - Math.min(d, min)) / 2;
        const ux = dx / d;
        const uz = dz / d;
        a.x = clamp(a.x - ux * push, -maxX, maxX);
        a.z = clamp(a.z - uz * push, -maxZ, maxZ);
        b.x = clamp(b.x + ux * push, -maxX, maxX);
        b.z = clamp(b.z + uz * push, -maxZ, maxZ);
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/**
 * Keep players' bodies just off a slow ball. Two players running at a resting ball
 * otherwise squeeze it between their capsules (and the boards), lifting it out of reach
 * of their feet so nobody can play it. A moving ball still bounces off bodies as usual:
 * that's how blocks and deflections happen. A keeper holding the ball (`holder`) is exempt.
 */
export function keepOffBall(players: readonly Player[], ball: Vec3, ballVel: Vec3, holder: number | null = null): void {
  const S = TUNING.separation;
  if (ball.y > S.ballClearHeight || Math.hypot(ballVel.x, ballVel.z) > S.ballClearSpeed) return;
  const min = PLAYER_RADIUS + BALL_RADIUS + TUNING.separation.gap;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  for (const p of players) {
    if (p.id === holder) continue; // the keeper holding it
    const dx = p.pos.x - ball.x;
    const dz = p.pos.z - ball.z;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    // Dead on top of it: step back along their facing.
    const ux = d > 1e-6 ? dx / d : -Math.cos(p.facing);
    const uz = d > 1e-6 ? dz / d : -Math.sin(p.facing);
    p.pos.x = clamp(ball.x + ux * min, -maxX, maxX);
    p.pos.z = clamp(ball.z + uz * min, -maxZ, maxZ);
  }
}
