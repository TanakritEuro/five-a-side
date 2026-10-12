import { TUNING } from '../config';
import { HALF_LENGTH, HALF_WIDTH, PLAYER_RADIUS } from '../constants';
import { clamp } from '../math';
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
