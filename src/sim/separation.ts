import { TUNING } from '../config';
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP, PLAYER_RADIUS } from '../constants';
import { attrScale, clamp, type Vec3 } from '../math';
import type { Player } from './player';

/** A shoulder challenge this step: the ball `carrier` and an opponent in contact with them. */
export interface Challenge {
  carrier: number;
  challenger: number;
}

/**
 * How much a player weighs in a coming-together: strength, plus momentum at speed.
 */
export function weight(p: Player): number {
  const S = TUNING.separation;
  return attrScale(p.attrs.strength, S.strengthSpread) * (1 + (S.momentum * p.speed) / TUNING.locomotion.sprintSpeed);
}

/**
 * Push overlapping players apart along the line between them, and keep them inside the
 * boards. Players are kinematic, so the physics engine won't do this; game code decides
 * how bodies meet. Teammates split the overlap evenly. Opponents split it by weight, the
 * lighter one moving more, and when one of them has the ball (`owner`) it's a shoulder
 * challenge: the heavier one shoves the other off their line as well (and `Sim` lets a
 * challenger who gets to the ball first take it). Pairs are visited
 * in a fixed order so the result is deterministic. A few passes settle clusters of
 * three or more. Returns this step's shoulder challenges.
 */
export function separatePlayers(players: readonly Player[], owner: number | null = null): Challenge[] {
  const S = TUNING.separation;
  const min = 2 * PLAYER_RADIUS + S.gap;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  const challenges: Challenge[] = [];
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
        const p = players[i];
        const q = players[j];
        const overlap = min - Math.min(d, min);
        // The share of the push each takes: half each between teammates, by weight between opponents.
        let shareA = 0.5;
        let shove = 0;
        if (p.team !== q.team) {
          const wa = weight(p);
          const wb = weight(q);
          shareA = wb / (wa + wb);
          if (pass === 0 && (p.id === owner || q.id === owner)) {
            challenges.push(p.id === owner ? { carrier: p.id, challenger: q.id } : { carrier: q.id, challenger: p.id });
            // The heavier one leans the other off their line (shareA > 0.5: a is lighter).
            shove = S.shove * Math.abs(wa - wb) / (wa + wb) * PHYSICS_STEP;
          }
        }
        const pushA = overlap * shareA + (shareA > 0.5 ? shove : 0);
        const pushB = overlap * (1 - shareA) + (shareA < 0.5 ? shove : 0);
        const ux = dx / d;
        const uz = dz / d;
        a.x = clamp(a.x - ux * pushA, -maxX, maxX);
        a.z = clamp(a.z - uz * pushA, -maxZ, maxZ);
        b.x = clamp(b.x + ux * pushB, -maxX, maxX);
        b.z = clamp(b.z + uz * pushB, -maxZ, maxZ);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return challenges;
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
