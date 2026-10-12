import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { CENTRE_CIRCLE_RADIUS, PHYSICS_STEP } from '../src/constants';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { STEPS_PER_SECOND } from './helpers';

const M = TUNING.match;
const halfLength = M.halfLength;

beforeEach(() => {
  M.halfLength = 6; // short halves for the tests
});
afterEach(() => {
  M.halfLength = halfLength;
});

function match(seed = 1): Promise<Sim> {
  return Sim.create({ seed, players: fullLineup(), ai: true, kickoff: true });
}

/** Step until `until` returns true (or `seconds` pass); returns every event. */
function stepUntil(sim: Sim, seconds: number, until: () => boolean = () => false): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * STEPS_PER_SECOND && !until(); i++) events.push(...sim.step([]));
  return events;
}

describe('kick-off', () => {
  it('lines both teams up in their own halves, opponents outside the circle', async () => {
    const sim = await match();
    expect(sim.match.phase.kind).toBe('restart');
    const taker = sim.match.taker!;
    expect(sim.players[taker]).toMatchObject({ team: 0 });
    for (const p of sim.players) {
      expect(p.pos.x * sim.attackDir(p.team)).toBeLessThan(0);
      if (p.team === 1) expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(CENTRE_CIRCLE_RADIUS);
    }
  });

  it('is taken by the AI after a moment, and the clock only starts then', async () => {
    const sim = await match();
    const events = stepUntil(sim, 3, () => sim.match.inPlay);
    expect(sim.match.inPlay).toBe(true);
    expect(events.find((e) => e.type === 'kick')).toMatchObject({ player: sim.players.find((p) => p.team === 0 && p.spec.role === 'pivot')!.id });
    expect(sim.match.clock.elapsed).toBeLessThan(2 * PHYSICS_STEP);
  });
});

describe('halves', () => {
  it('stops the clock while the ball is dead', async () => {
    const sim = await match();
    stepUntil(sim, 3, () => sim.match.inPlay);
    stepUntil(sim, 1);
    // Knock the ball over the netting: the clock stops until the set piece is taken.
    sim.ball.setLinvel({ x: 0, y: 14, z: 8 }, true);
    stepUntil(sim, 3, () => sim.match.phase.kind === 'out');
    const stopped = sim.match.clock.elapsed;
    stepUntil(sim, M.outDelay + 0.2);
    expect(sim.match.phase.kind).toBe('restart');
    expect(sim.match.clock.elapsed).toBe(stopped);
  });

  it('swaps ends at half time and the other team kicks off', async () => {
    const sim = await match();
    expect(sim.attackDir(0)).toBe(1);
    const events = stepUntil(sim, 60, () => sim.match.clock.half === 2);
    expect(events.some((e) => e.type === 'halfTime')).toBe(true);
    expect(sim.attackDir(0)).toBe(-1);
    expect(sim.attackDir(1)).toBe(1);
    expect(sim.match.phase).toMatchObject({ kind: 'restart', restart: { kind: 'kickoff', team: 1 } });
    for (const p of sim.players) {
      expect(p.pos.x * sim.attackDir(p.team)).toBeLessThan(0);
    }
    // Team 0's keeper is now in the +X goal.
    const keeper = sim.players.find((p) => p.team === 0 && p.spec.role === 'keeper')!;
    expect(keeper.pos.x).toBeGreaterThan(15);
  });

  it('ends at full time, with everyone standing still', async () => {
    const sim = await match();
    const events = stepUntil(sim, 120, () => sim.match.over);
    expect(sim.match.over).toBe(true);
    expect(events.filter((e) => e.type === 'halfTime')).toHaveLength(1);
    expect(events.find((e) => e.type === 'fullTime')).toMatchObject({ score: sim.match.score });
    const before = sim.players.map((p) => ({ ...p.pos }));
    stepUntil(sim, 2);
    sim.players.forEach((p, i) => {
      expect(Math.hypot(p.pos.x - before[i].x, p.pos.z - before[i].z)).toBeLessThan(0.3); // just coming to a stop
    });
    expect(sim.match.clock.elapsed).toBeGreaterThanOrEqual(M.halfLength);
  });
});
