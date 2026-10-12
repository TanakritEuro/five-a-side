import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { TUNING } from '../src/config';
import { BALL_RADIUS } from '../src/constants';
import { headingVec } from '../src/math';
import type { Sim } from '../src/sim/sim';
import { cmd, createSim, solo, STEPS_PER_SECOND } from './helpers';

const EAST = { x: 1, z: 0 };
const SOUTH = { x: 0, z: 1 };

/** A player at (-12, 0) facing +X with the ball at their feet. */
async function withBall(seed = 1): Promise<Sim> {
  const sim = await createSim(seed, solo({ x: -12, z: 0 }, 0));
  sim.placeBall({ x: -11.4, z: 0 });
  return sim;
}

interface Trace {
  owned: number;
  steps: number;
  maxGap: number;
  gapSum: number;
  touches: number;
}

/** Drive player 0 with `move` (and sprint) for `seconds`, recording possession and the gap to the ball. */
function drive(sim: Sim, seconds: number, move: { x: number; z: number }, sprint = false, settle = 0.3): Trace {
  const t: Trace = { owned: 0, steps: 0, maxGap: 0, gapSum: 0, touches: 0 };
  const steps = Math.round(seconds * STEPS_PER_SECOND);
  for (let i = 0; i < steps; i++) {
    const events = sim.step([cmd({ move, sprint })]);
    t.touches += events.filter((e) => e.type === 'touch' && e.kind !== 'deflect').length;
    if (i < settle * STEPS_PER_SECOND) continue;
    const p = sim.players[0];
    const b = sim.ball.translation();
    const gap = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
    t.steps++;
    if (sim.possession.owner === 0) t.owned++;
    t.maxGap = Math.max(t.maxGap, gap);
    t.gapSum += gap;
  }
  return t;
}

describe('dribbling', () => {
  it('keeps the ball over a 15 m run', async () => {
    const sim = await withBall();
    const t = drive(sim, 3, EAST);
    expect(t.owned / t.steps).toBeGreaterThan(0.95);
    expect(t.maxGap).toBeLessThan(TUNING.dribble.possessionRange);
    expect(t.touches).toBeGreaterThan(2);
    expect(sim.players[0].pos.x).toBeGreaterThan(-12 + 12);
    // The ball is in front of the player, not trailing.
    const b = sim.ball.translation();
    expect(b.x).toBeGreaterThan(sim.players[0].pos.x);
  });

  it('pushes the ball further ahead when sprinting', async () => {
    const jog = drive(await withBall(), 3, EAST, false, 1);
    const sprint = drive(await withBall(), 3, EAST, true, 1);
    expect(sprint.gapSum / sprint.steps).toBeGreaterThan(jog.gapSum / jog.steps + 0.2);
    expect(sprint.owned / sprint.steps).toBeGreaterThan(0.9);
  });

  it('takes the ball round a 90° turn', async () => {
    const sim = await withBall();
    drive(sim, 1.5, EAST);
    const t = drive(sim, 1.5, SOUTH, false, 0);
    expect(t.owned / t.steps).toBeGreaterThan(0.9);
    expect(sim.possession.owner).toBe(0);
    const v = sim.ball.linvel();
    expect(v.z).toBeGreaterThan(Math.abs(v.x)); // now rolling the new way
  });

  it('stops the ball when the player stops', async () => {
    const sim = await withBall();
    drive(sim, 1.5, EAST);
    drive(sim, 1.5, { x: 0, z: 0 }, false, 0);
    const v = sim.ball.linvel();
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.2);
    expect(sim.possession.owner).toBe(0);
  });

  it('keeps possession with random touch noise on any seed', async () => {
    for (const seed of [2, 3, 4, 5]) {
      const t = drive(await withBall(seed), 3, EAST, true);
      expect(t.owned / t.steps).toBeGreaterThan(0.9);
    }
  });
});

describe('receiving', () => {
  /** Roll the ball at a player standing at (0, 0) facing -X, from 8 m away, at `speed`. */
  async function rollAt(speed: number): Promise<{ sim: Sim; first: string | undefined }> {
    const sim = await createSim(1, solo({ x: 0, z: 0 }, Math.PI));
    sim.ball.setTranslation({ x: -8, y: BALL_RADIUS, z: 0 }, true);
    sim.ball.setLinvel({ x: speed, y: 0, z: 0 }, true);
    sim.ball.setAngvel(rollingSpin(speed, 0), true);
    const kinds: string[] = [];
    for (let i = 0; i < 2 * STEPS_PER_SECOND; i++) {
      for (const e of sim.step([])) if (e.type === 'touch') kinds.push(e.kind);
    }
    return { sim, first: kinds[0] };
  }

  it('controls a pass coming at a sensible pace', async () => {
    const { sim, first } = await rollAt(8);
    expect(first).toBe('receive');
    expect(sim.possession.owner).toBe(0);
    const v = sim.ball.linvel();
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.5);
  });

  it('cannot control a ball that is coming too hard: it comes off them', async () => {
    const { first } = await rollAt(TUNING.dribble.receiveSpeed + 4);
    expect(first).toBe('deflect');
  });

  it('only plays the ball in front of them', async () => {
    const sim = await createSim(1, solo({ x: 0, z: 0 }, 0));
    sim.placeBall({ x: -0.6, z: 0 }); // just behind
    for (let i = 0; i < 10; i++) sim.step([]);
    const f = headingVec(sim.players[0].facing);
    expect(f.x).toBeCloseTo(1);
  });
});
