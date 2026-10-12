import { describe, expect, it } from 'vitest';
import { earliestIntercept, timeToReach } from '../src/ai/intercept';
import { rollingSpin } from '../src/ball/forces';
import { predictPath } from '../src/ball/trajectory';
import { TUNING } from '../src/config';
import { BALL_RADIUS } from '../src/constants';
import { cmd, createSim, solo, STEPS_PER_SECOND } from './helpers';

describe('time to reach a point', () => {
  it.each([4, 10, 20])('is close to (and not much shorter than) a real sprint of %i m', async (distance) => {
    const sim = await createSim(1, solo({ x: -10, z: 0 }, 0));
    sim.placeBall({ x: 15, z: 9 }); // out of the way
    const target = { x: -10 + distance, z: 0 };
    const estimate = timeToReach(sim.players[0], target);
    let t = 0;
    while (Math.hypot(sim.players[0].pos.x - target.x, sim.players[0].pos.z) > TUNING.dribble.reach && t < 10) {
      sim.step([cmd({ move: { x: 1, z: 0 }, sprint: true })]);
      t += 1 / STEPS_PER_SECOND;
    }
    expect(estimate).toBeGreaterThan(t - 0.1);
    expect(estimate).toBeLessThan(t + TUNING.ai.reactionTime + 0.3);
  });

  it('takes longer to reach a point behind you', async () => {
    const sim = await createSim(1, solo({ x: 0, z: 0 }, 0));
    const p = sim.players[0];
    expect(timeToReach(p, { x: -6, z: 0 })).toBeGreaterThan(timeToReach(p, { x: 6, z: 0 }) + 0.15);
  });
});

describe('earliest intercept', () => {
  it('meets a rolling ball further along its path the further away the player starts', async () => {
    const sim = await createSim(1, [...solo({ x: -2, z: 3 }, -Math.PI / 2), ...solo({ x: 2, z: 6 }, -Math.PI / 2)]);
    const from = { x: -10, y: BALL_RADIUS, z: 0 };
    const path = predictPath(sim.ghost, from, { x: 10, y: 0, z: 0 }, rollingSpin(10, 0));
    const near = earliestIntercept(sim.players[0], path, 0);
    const far = earliestIntercept(sim.players[1], path, 0);
    expect(near.point.x).toBeLessThan(far.point.x);
    expect(near.t).toBeLessThan(far.t);
    // The player can really get there in that time.
    expect(timeToReach(sim.players[0], near.point)).toBeLessThanOrEqual(near.t);
  });
});
