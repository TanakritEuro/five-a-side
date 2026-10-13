import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { BALL_RADIUS } from '../src/constants';
import { AVERAGE, type PlayerSpec } from '../src/sim/player';
import { DIAMOND } from '../src/team/formation';
import { createSim, STEPS_PER_SECOND } from './helpers';

/** A receiver at the origin facing -X with the given control rating. */
function receiver(passing: number): PlayerSpec[] {
  return [{ team: 0, role: 'pivot', slot: DIAMOND[4], kickoff: { x: 0, z: 0 }, kickoffFacing: Math.PI, attrs: { ...AVERAGE, passing } }];
}

/**
 * Roll the ball at the receiver from 8 m at `speed` and measure how fast it's moving
 * just after their first touch (how far it'll get away from them). Null if they never
 * touched it.
 */
async function touch(seed: number, passing: number, speed: number): Promise<number | null> {
  const sim = await createSim(seed, receiver(passing));
  sim.ball.setTranslation({ x: -8, y: BALL_RADIUS, z: 0 }, true);
  sim.ball.setLinvel({ x: speed, y: 0, z: 0 }, true);
  sim.ball.setAngvel(rollingSpin(speed, 0), true);
  for (let i = 0; i < 3 * STEPS_PER_SECOND; i++) {
    const events = sim.step([]);
    if (events.some((e) => e.type === 'touch' && e.kind === 'receive')) {
      const v = sim.ball.linvel();
      return Math.hypot(v.x, v.z);
    }
  }
  return null;
}

async function spread(passing: number, speed: number) {
  const d: number[] = [];
  for (let seed = 1; seed <= 16; seed++) {
    const r = await touch(seed, passing, speed);
    if (r !== null) d.push(r);
  }
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return { n: d.length, mean, max: Math.max(...d) };
}

describe('first touch', () => {
  it('kills a gentle pass, whoever receives it', async () => {
    for (const passing of [0.1, 0.9]) {
      const r = await spread(passing, 6);
      expect(r.n).toBe(16);
      expect(r.max).toBeLessThan(0.6);
    }
  });

  it('lets a hard pass get away from a poor receiver more than from a good one', async () => {
    const poor = await spread(0.1, 11);
    const good = await spread(0.9, 11);
    expect(poor.n).toBe(16);
    expect(good.n).toBe(16);
    expect(poor.mean).toBeGreaterThan(good.mean * 2);
    expect(poor.mean).toBeGreaterThan(2.5);
  });
});
