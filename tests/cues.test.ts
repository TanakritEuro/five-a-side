import { describe, expect, it } from 'vitest';
import { cues, excitement, type CueContext } from '../src/audio/cues';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';

const ctx: CueContext = { teamOf: (id) => (id < 5 ? 0 : 1), home: 0, ballSpeed: 20 };

describe('sound cues', () => {
  it("roar for the home team's goals, groan for the other team's", () => {
    const goal = (team: 0 | 1): SimEvent => ({ type: 'goal', team, end: 1, score: [1, 0], scorer: null });
    expect(cues(goal(0), ctx)).toContainEqual({ name: 'react', kind: 'roar' });
    expect(cues(goal(1), ctx)).toContainEqual({ name: 'react', kind: 'groan' });
    expect(cues(goal(0), ctx)).toContainEqual({ name: 'net', speed: 20 });
  });

  it('cheer a home save, "ooh" when the other keeper saves', () => {
    expect(cues({ type: 'save', player: 0, caught: true }, ctx)).toContainEqual({ name: 'react', kind: 'cheer' });
    expect(cues({ type: 'save', player: 5, caught: false }, ctx)).toContainEqual({ name: 'react', kind: 'ooh' });
  });

  it('blow the whistle for fouls, kick-offs and the end of each half', () => {
    expect(cues({ type: 'foul', player: 1, against: 6, restart: { kind: 'freeKick', at: { x: 0, z: 0 }, team: 1 } }, ctx)).toContainEqual({ name: 'whistle' });
    expect(cues({ type: 'restart', restart: { kind: 'kickoff', at: { x: 0, z: 0 }, team: 0 }, taker: 4 }, ctx)).toEqual([{ name: 'whistle' }]);
    expect(cues({ type: 'fullTime', score: [2, 1] }, ctx)).toEqual([{ name: 'whistle', long: true }, { name: 'react', kind: 'cheer' }]);
  });

  it('gives every event of a real match well-formed sounds', async () => {
    const sim = await Sim.create({ seed: 3, players: fullLineup(), ai: true, kickoff: true });
    let sounds = 0;
    for (let i = 0; i < 60 * 60; i++) {
      for (const e of sim.step([])) {
        for (const s of cues(e, ctx)) {
          sounds++;
          if ('speed' in s) expect(Number.isFinite(s.speed) && s.speed >= 0).toBe(true);
        }
      }
    }
    expect(sounds).toBeGreaterThan(50);
  });

  it('gets more excited as the home team nears the goal it attacks', () => {
    expect(excitement(-10, 1)).toBe(0);
    expect(excitement(8, 1)).toBeCloseTo(0.5, 5);
    expect(excitement(19, 1)).toBe(1);
    expect(excitement(-19, -1)).toBe(1);
  });
});
