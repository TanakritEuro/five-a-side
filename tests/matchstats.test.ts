import { describe, expect, it } from 'vitest';
import { MatchStats } from '../src/match/matchstats';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';

describe('match stats', () => {
  it("count a seeded match's events consistently", async () => {
    const sim = await Sim.create({ seed: 2, players: fullLineup(), ai: true, kickoff: true, halfLength: 60 });
    const stats = new MatchStats();
    const counted = { kicks: 0, goals: 0, fouls: 0 };
    for (let i = 0; i < 60 * 60 * 4 && !sim.match.over; i++) {
      const events: SimEvent[] = sim.step([]);
      for (const e of events) {
        if (e.type === 'kick') counted.kicks++;
        if (e.type === 'goal') counted.goals++;
        if (e.type === 'foul') counted.fouls++;
      }
      const holder = sim.handling.holder ?? sim.possession.owner;
      stats.step(events, holder === null || !sim.match.inPlay ? null : sim.players[holder].team, (id) => sim.players[id].team, 1);
    }
    const [a, b] = stats.teams;
    expect(a.shots + a.passes + b.shots + b.passes).toBe(counted.kicks);
    expect(a.goals + b.goals).toBe(counted.goals);
    expect(a.fouls + b.fouls).toBe(counted.fouls);
    expect(stats.goals).toHaveLength(counted.goals);
    for (const t of stats.teams) {
      expect(t.shots).toBeGreaterThanOrEqual(t.onTarget);
      expect(t.possession).toBeGreaterThan(0);
    }
    const [h, w] = stats.possessionShare;
    expect(h + w).toBe(100);
    expect(h).toBeGreaterThan(20);
    expect(h).toBeLessThan(80);
  });
});
