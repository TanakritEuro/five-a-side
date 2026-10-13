import { describe, expect, it } from 'vitest';
import { CUP_ROUNDS, outcome, Session, type SessionChoice } from '../src/match/session';
import { Stats, type StatsStore } from '../src/match/stats';
import { TEAMS } from '../src/team/teams';

const choice = (mode: 'friendly' | 'cup', seed = 1): SessionChoice => ({ mode, team: TEAMS[2], opponent: TEAMS[5], level: 'hard', halfLength: 120, seed });

describe('session', () => {
  it('plays friendlies against your chosen opponent, level and length, without shootouts', () => {
    const s = new Session(choice('friendly'));
    const m = s.next();
    expect(m.teams).toEqual([TEAMS[2], TEAMS[5]]);
    expect(m).toMatchObject({ level: 'hard', halfLength: 120, shootout: false });
    s.finish({ score: [1, 1] });
    expect(s.finished).toBe(false);
    expect(s.next().seed).not.toBe(m.seed);
  });

  it('runs a cup of three rounds against different drawn opponents, the levels rising', () => {
    const s = new Session(choice('cup'));
    const opponents = new Set<string>();
    CUP_ROUNDS.forEach((round, i) => {
      const m = s.next();
      expect(m.teams[0]).toBe(TEAMS[2]);
      expect(m.teams[1]).not.toBe(TEAMS[2]);
      expect(m).toMatchObject({ level: round.level, shootout: true });
      expect(m.title).toContain(round.name);
      opponents.add(m.teams[1].short);
      expect(s.finish({ score: [2, 1] })).toBe('won');
      expect(s.finished).toBe(i === CUP_ROUNDS.length - 1);
    });
    expect(opponents.size).toBe(3);
    expect(s.wonCup).toBe(true);
  });

  it('knocks you out of the cup for a defeat, including on penalties', () => {
    const s = new Session(choice('cup'));
    expect(s.finish({ score: [1, 1], shootout: [3, 2] })).toBe('won');
    expect(s.finished).toBe(false);
    expect(s.finish({ score: [0, 0], shootout: [2, 3] })).toBe('lost');
    expect(s.finished).toBe(true);
    expect(s.wonCup).toBe(false);
  });

  it('draws different opponents with different seeds', () => {
    const draws = new Set([1, 2, 3, 4, 5, 6].map((seed) => new Session(choice('cup', seed)).opponents.map((t) => t.short).join()));
    expect(draws.size).toBeGreaterThan(1);
  });

  it('reads a result as won, drawn or lost', () => {
    expect(outcome({ score: [2, 0] })).toBe('won');
    expect(outcome({ score: [1, 1] })).toBe('drawn');
    expect(outcome({ score: [1, 1], shootout: [2, 3] })).toBe('lost');
  });
});

describe('lifetime stats', () => {
  function memory(): StatsStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('counts results, goals, streaks and cups, and keeps them', () => {
    const store = memory();
    const stats = new Stats(store);
    stats.record({ score: [3, 1] }, 'won');
    stats.record({ score: [2, 0] }, 'won');
    stats.record({ score: [1, 1] }, 'drawn');
    stats.recordCup();
    expect(stats.data).toMatchObject({ played: 3, won: 2, drawn: 1, lost: 0, goalsFor: 6, goalsAgainst: 2, streak: 0, bestStreak: 2, cupsWon: 1 });
    // A new visit reads them back.
    expect(new Stats(store).data).toEqual(stats.data);
    stats.reset();
    expect(new Stats(store).data.played).toBe(0);
  });

  it('works without storage', () => {
    const stats = new Stats(null);
    stats.record({ score: [0, 1] }, 'lost');
    expect(stats.data.lost).toBe(1);
    expect(stats.summary).toContain('L 1');
  });
});
