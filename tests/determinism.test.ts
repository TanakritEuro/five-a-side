import { describe, expect, it } from 'vitest';
import type { Sim } from '../src/sim/sim';
import { createSim, randomDriver, run } from './helpers';

function state(sim: Sim) {
  return {
    ball: sim.ball.translation(),
    ballVel: sim.ball.linvel(),
    players: sim.players.map((p) => ({ ...p.pos, facing: p.facing, stamina: p.stamina })),
    tick: sim.tick,
  };
}

describe('determinism', () => {
  it('replays bit-for-bit from the same seed and commands', async () => {
    const a = await createSim(7);
    const b = await createSim(7);
    run(a, 20, randomDriver(99));
    run(b, 20, randomDriver(99));
    expect(state(b)).toEqual(state(a));
  });
});
