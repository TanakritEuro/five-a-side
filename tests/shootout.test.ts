import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Shootout } from '../src/sim/shootout';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { STEPS_PER_SECOND } from './helpers';

describe('shootout rules', () => {
  it('alternates, starting with the first team', () => {
    const s = new Shootout(0, 3);
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(s.next);
      s.record(s.next, true);
    }
    expect(order).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("stops as soon as one side can't be caught", () => {
    const s = new Shootout(0, 3);
    s.record(0, true);
    s.record(1, false);
    s.record(0, true);
    expect(s.decided).toBe(false); // 2–0, but team 1 has two kicks left
    s.record(1, false);
    expect(s.winner).toBe(0); // 2–0 with one kick left each
  });

  it('goes to sudden death when level after three each, and ends on a pair', () => {
    const s = new Shootout(0, 3);
    for (let i = 0; i < 3; i++) {
      s.record(0, true);
      s.record(1, true);
    }
    expect(s.suddenDeath).toBe(true);
    expect(s.decided).toBe(false);
    s.record(0, false);
    expect(s.decided).toBe(false); // the other side still kicks
    s.record(1, true);
    expect(s.winner).toBe(1);
  });
});

/** A short, goalless (with luck) cup tie that goes to penalties; returns its events from full time on. */
async function shootout(seed: number) {
  const sim = await Sim.create({ seed, players: fullLineup(), ai: true, kickoff: true, halfLength: 2, shootout: true });
  const events: SimEvent[] = [];
  let started = false;
  for (let i = 0; i < 3 * 60 * STEPS_PER_SECOND && !sim.match.over; i++) {
    for (const e of sim.step([])) {
      if (e.type === 'shootoutStart') started = true;
      if (started) events.push(e);
    }
  }
  return { sim, events, started };
}

describe('shootouts in the sim', () => {
  it('a drawn cup tie goes to kicks, alternating, until there is a winner', async () => {
    let played = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { sim, events, started } = await shootout(seed);
      expect(sim.match.over).toBe(true);
      if (!started) continue; // somebody scored in four seconds
      played++;
      const kicks = events.filter((e): e is Extract<SimEvent, { type: 'shootoutKick' }> => e.type === 'shootoutKick');
      kicks.forEach((k, i) => expect(k.team).toBe(i % 2));
      expect(kicks.length).toBeGreaterThanOrEqual(4);
      const end = events.find((e): e is Extract<SimEvent, { type: 'fullTime' }> => e.type === 'fullTime')!;
      const last = kicks[kicks.length - 1].tally;
      expect(end.shootout).toEqual(last);
      expect(last[0]).not.toBe(last[1]);
      expect(sim.match.shootout!.decided).toBe(true);
      // Each kick was taken by a different player than the team's previous one.
      expect(new Set(events.filter((e) => e.type === 'restart').map((e) => (e as Extract<SimEvent, { type: 'restart' }>).taker)).size).toBeGreaterThan(2);
    }
    expect(played).toBeGreaterThanOrEqual(3);
  });

  it('ends each kick without a rebound, quickly', async () => {
    const { events } = await shootout(2);
    let taken: number | null = null;
    let step = 0;
    for (const e of events) {
      step++;
      if (e.type === 'kick' && taken === null) taken = step;
      if (e.type === 'shootoutKick') taken = null;
      // No second kick of the ball within one shootout kick.
      if (e.type === 'kick' && taken !== null && step !== taken) expect.unreachable('a rebound was played');
    }
    expect(events.some((e) => e.type === 'shootoutKick')).toBe(true);
  });

  it('a decided match goes straight to full time', async () => {
    const sim = await Sim.create({ seed: 1, players: fullLineup(), ai: true, kickoff: true, halfLength: 2, shootout: true });
    sim.match.score[0] = 1;
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 * STEPS_PER_SECOND && !sim.match.over; i++) events.push(...sim.step([]));
    expect(events.some((e) => e.type === 'shootoutStart')).toBe(false);
    expect(sim.match.over).toBe(true);
  });
});
