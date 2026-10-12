import { describe, expect, it } from 'vitest';
import { decide, scoreOptions } from '../src/ai/decide';
import { TUNING, type AiLevel } from '../src/config';
import { createRng } from '../src/math';
import type { PlayerSpec } from '../src/sim/player';
import type { Sim } from '../src/sim/sim';
import { DIAMOND, type Role } from '../src/team/formation';
import { createSim } from './helpers';

/** A level without decision noise: the scores alone decide. */
const EXACT: AiLevel = { ...TUNING.levels.normal, noise: 0 };

const at = (team: 0 | 1, x: number, z: number, facing = 0, role: Role = 'pivot'): PlayerSpec => ({
  team,
  role,
  slot: DIAMOND.find((s) => s.role === role)!,
  kickoff: { x, z },
  kickoffFacing: facing,
});

/** Player 0 (home, attacking +X) on the ball at their feet; the rest as given. */
async function scene(...others: PlayerSpec[]): Promise<Sim> {
  const sim = await createSim(1, [at(0, 0, 0), ...others]);
  const p = sim.players[0];
  sim.placeBall({ x: p.pos.x + 0.6, z: p.pos.z });
  sim.possession.control(0);
  return sim;
}

describe('on-ball decisions', () => {
  it('shoots with a clear sight of goal from 8 m', async () => {
    const sim = await createSim(1, [at(0, 12, 0), at(1, 19.5, 0, Math.PI, 'keeper'), at(1, 4, 6, Math.PI)]);
    sim.placeBall({ x: 12.6, z: 0 });
    sim.possession.control(0);
    expect(decide(sim, sim.players[0], EXACT, createRng(1)).kind).toBe('shoot');
  });

  it("doesn't shoot when facing away from goal", async () => {
    const sim = await createSim(1, [at(0, 12, 0, Math.PI), at(1, 19.5, 0, Math.PI, 'keeper')]);
    sim.placeBall({ x: 11.4, z: 0 });
    sim.possession.control(0);
    const shots = scoreOptions(sim, sim.players[0], EXACT, createRng(1)).filter((o) => o.kind === 'shoot');
    for (const s of shots) expect(s.score).toBe(0);
  });

  it('passes to an open teammate ahead when an opponent is right in front', async () => {
    // The presser is straight ahead; the teammate is off at 45°, clear of them.
    const sim = await scene(at(1, 1.5, -0.3, Math.PI), at(0, 6, 6));
    const choice = decide(sim, sim.players[0], EXACT, createRng(1));
    expect(choice.kind).toBe('pass');
    expect(choice.receiver).toBe(2);
  });

  it('prefers the teammate with an open lane to one whose lane is blocked', async () => {
    // Teammate 1 is further forward, but an opponent stands in the lane to them.
    const sim = await scene(at(0, 12, 0), at(1, 6, 0, Math.PI), at(0, 6, 7));
    const passes = scoreOptions(sim, sim.players[0], EXACT, createRng(1)).filter((o) => o.kind === 'pass');
    const blocked = passes.find((o) => o.receiver === 1)!;
    const open = passes.find((o) => o.receiver === 3)!;
    expect(open.score).toBeGreaterThan(blocked.score);
  });

  it('dribbles into open space far from goal with nobody ahead to pass to', async () => {
    const sim = await createSim(1, [at(0, -12, 0), at(0, -16, 4), at(1, 15, 8, Math.PI)]);
    sim.placeBall({ x: -11.4, z: 0 });
    sim.possession.control(0);
    expect(decide(sim, sim.players[0], EXACT, createRng(1)).kind).toBe('dribble');
  });

  it('chooses the best option less often at easy than at hard', async () => {
    // Two passes with close scores: whether the better one is picked depends on the noise.
    const sim = await scene(at(0, 6, 6), at(0, 7, -5));
    const best = decide(sim, sim.players[0], EXACT, createRng(1));
    const agree = (level: AiLevel) => {
      const rng = createRng(7);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const c = decide(sim, sim.players[0], level, rng);
        if (c.kind === best.kind && c.receiver === best.receiver && c.corner === best.corner) n++;
      }
      return n / 300;
    };
    expect(agree(TUNING.levels.hard)).toBeGreaterThan(agree(TUNING.levels.easy) + 0.1);
  });
});
