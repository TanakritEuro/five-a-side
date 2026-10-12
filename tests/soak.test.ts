import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP, PLAYER_RADIUS } from '../src/constants';
import { outOfCage } from '../src/sim/rules';
import type { SimEvent } from '../src/sim/events';
import { createSim, randomDriver, STEPS_PER_SECOND } from './helpers';

const SECONDS = 90;
const R = TUNING.match;
/** Longest a goal or out pause can last before the restart is set. */
const MAX_PAUSE = Math.max(R.goalDelay, R.outDelay) + 0.1;
/** A restart waits for its taker; a random player gets round to kicking it eventually. */
const MAX_RESTART_WAIT = 30;
let goals = 0;

describe('soak: a frantic player for 90 s', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: stays finite, in the cage, and keeps restarting', async (seed) => {
    const sim = await createSim(seed);
    const drive = randomDriver(seed * 7919, sim);
    const counts: Partial<Record<SimEvent['type'], number>> = {};
    let paused = 0;
    let waiting = 0;

    for (let i = 0; i < SECONDS * STEPS_PER_SECOND; i++) {
      for (const e of sim.step([drive(i)])) counts[e.type] = (counts[e.type] ?? 0) + 1;

      const b = sim.ball.translation();
      const v = sim.ball.linvel();
      for (const n of [b.x, b.y, b.z, v.x, v.y, v.z]) expect(Number.isFinite(n)).toBe(true);
      for (const p of sim.players) {
        expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z) && Number.isFinite(p.facing)).toBe(true);
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(HALF_LENGTH - PLAYER_RADIUS + 1e-9);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(HALF_WIDTH - PLAYER_RADIUS + 1e-9);
      }
      // Out of the cage only ever while the rules know about it.
      if (outOfCage(b)) expect(sim.match.phase.kind).toBe('out');

      const kind = sim.match.phase.kind;
      paused = kind === 'goal' || kind === 'out' ? paused + PHYSICS_STEP : 0;
      waiting = kind === 'restart' ? waiting + PHYSICS_STEP : 0;
      expect(paused).toBeLessThan(MAX_PAUSE);
      expect(waiting).toBeLessThan(MAX_RESTART_WAIT);
    }

    goals += counts.goal ?? 0;
    expect(counts.kick ?? 0).toBeGreaterThan(5);
    expect(counts.touch ?? 0).toBeGreaterThan(20);
  });

  it('scores goals across the runs (and restarts after them)', () => {
    expect(goals).toBeGreaterThan(3);
  });
});
