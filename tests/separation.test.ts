import { describe, expect, it } from 'vitest';
import { HALF_LENGTH, HALF_WIDTH, PLAYER_RADIUS } from '../src/constants';
import type { PlayerSpec } from '../src/sim/player';
import type { Sim } from '../src/sim/sim';
import { DIAMOND } from '../src/team/formation';
import { cmd, createSim, STEPS_PER_SECOND } from './helpers';

const slot = DIAMOND[1];
const at = (team: 0 | 1, x: number, z: number): PlayerSpec => ({ team, role: 'defender', slot, kickoff: { x, z }, kickoffFacing: 0 });

function minGap(sim: Sim): number {
  let min = Infinity;
  for (const a of sim.players) {
    for (const b of sim.players) {
      if (a.id < b.id) min = Math.min(min, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
    }
  }
  return min;
}

describe('separation', () => {
  it('never lets players overlap when they all run at the same point', async () => {
    const players = [at(0, -6, 0), at(1, 6, 0), at(0, 0, -6), at(1, 0, 6), at(0, -4, -4), at(1, 4, 4)];
    const sim = await createSim(1, players);
    sim.placeBall({ x: 0, z: 9 }); // out of the way
    for (let i = 0; i < 3 * STEPS_PER_SECOND; i++) {
      sim.step(
        sim.players.map((p) => {
          const d = Math.hypot(p.pos.x, p.pos.z) || 1;
          return cmd({ move: { x: -p.pos.x / d, z: -p.pos.z / d }, sprint: true });
        }),
      );
      expect(minGap(sim)).toBeGreaterThan(2 * PLAYER_RADIUS - 0.02);
    }
  });

  it('keeps everyone inside the boards when pushed into a corner', async () => {
    const corner = { x: HALF_LENGTH, z: HALF_WIDTH };
    const players = [0, 1, 2, 3, 4].map((i) => at(0, HALF_LENGTH - 2 - i * 0.5, HALF_WIDTH - 2));
    const sim = await createSim(1, players);
    for (let i = 0; i < 3 * STEPS_PER_SECOND; i++) {
      sim.step(sim.players.map(() => cmd({ move: { x: 0.7, z: 0.7 } })));
      for (const p of sim.players) {
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(corner.x - PLAYER_RADIUS + 1e-9);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(corner.z - PLAYER_RADIUS + 1e-9);
      }
    }
    expect(minGap(sim)).toBeGreaterThan(2 * PLAYER_RADIUS - 0.25); // the boards can squeeze a pile a little
  });
});
