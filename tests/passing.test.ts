import { beforeAll, describe, expect, it } from 'vitest';
import { launchSpeedFor, passSafety, rollDistance, rollSpeed, rollStopDistance, rollTime } from '../src/ai/passing';
import { insidePitch, separate } from '../src/ai/steering';
import { rollingSpin } from '../src/ball/forces';
import { predictPath, solveGroundPass } from '../src/ball/trajectory';
import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH } from '../src/constants';
import type { PlayerSpec } from '../src/sim/player';
import type { Sim } from '../src/sim/sim';
import { DIAMOND } from '../src/team/formation';
import { createSim } from './helpers';

let sim: Sim;
beforeAll(async () => {
  sim = await createSim(1, []);
});

const at = (team: 0 | 1, x: number, z: number, facing = 0): PlayerSpec => ({
  team,
  role: 'pivot',
  slot: DIAMOND[4],
  kickoff: { x, z },
  kickoffFacing: facing,
});

describe('closed-form roll', () => {
  it.each([4, 8, 14])('matches the ghost ball rolled at %i m/s', (v0) => {
    const from = { x: -15, y: BALL_RADIUS, z: 0 };
    const path = predictPath(sim.ghost, from, { x: v0, y: 0, z: 0 }, rollingSpin(v0, 0), 3);
    for (let k = 1; k < path.points.length; k += 10) {
      const t = k * path.dt;
      expect(Math.abs(path.points[k].x - from.x - rollDistance(v0, t))).toBeLessThan(0.3);
    }
  });

  it('is self-consistent: time and distance invert, and speed falls to zero at the stopping point', () => {
    const v0 = 9;
    for (const d of [2, 6, 12]) expect(rollDistance(v0, rollTime(v0, d))).toBeCloseTo(d, 6);
    expect(rollTime(v0, rollStopDistance(v0) + 0.5)).toBe(Infinity);
    expect(rollSpeed(v0, 100)).toBe(0);
  });

  it('agrees with the ghost solver on the launch speed for a pass', () => {
    for (const [d, arrival] of [
      [8, 4],
      [15, 5.5],
    ]) {
      const ghost = solveGroundPass(sim.ghost, { x: -10, y: BALL_RADIUS, z: 0 }, { x: 1, z: 0 }, d, arrival);
      expect(Math.abs(launchSpeedFor(d, arrival) - Math.hypot(ghost.velocity.x, ghost.velocity.z))).toBeLessThan(0.15);
    }
  });
});

describe('pass safety', () => {
  async function scene(opponent: { x: number; z: number }) {
    const s = await createSim(1, [at(0, -10, 0), at(0, 2, 0, Math.PI), at(1, opponent.x, opponent.z, Math.PI)]);
    const [passer, receiver, opp] = s.players;
    const v0 = launchSpeedFor(12, 5);
    return passSafety(passer.pos, receiver.pos, v0, receiver, [opp]);
  }

  it('is safe with a clear lane', async () => {
    expect(await scene({ x: -4, z: 8 })).toBeGreaterThan(0);
  });

  it('is unsafe with an opponent standing in the lane', async () => {
    expect(await scene({ x: -4, z: 0.3 })).toBeLessThan(0);
  });

  it('ignores an opponent behind the passer', async () => {
    expect(await scene({ x: -14, z: 0 })).toBeGreaterThan(0);
  });

  it('is unsafe if the ball would stop short', async () => {
    const s = await createSim(1, [at(0, -10, 0), at(0, 10, 0)]);
    expect(passSafety(s.players[0].pos, s.players[1].pos, 3, s.players[1], [])).toBe(-Infinity);
  });
});

describe('steering helpers', () => {
  it('keeps targets inside the boards', () => {
    const t = insidePitch({ x: 30, z: -15 });
    expect(t.x).toBeLessThan(HALF_LENGTH);
    expect(t.z).toBeGreaterThan(-HALF_WIDTH);
  });

  it('pushes a player away from a teammate right next to them', async () => {
    const s = await createSim(1, [at(0, 0, 0), at(0, 0, 1)]);
    const move = separate(s.players[0], { x: 1, z: 0 }, s.players);
    expect(move.z).toBeLessThan(0); // away from the teammate at +Z
    expect(Math.hypot(move.x, move.z)).toBeCloseTo(1, 6);
  });
});
