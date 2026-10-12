import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUNING, type LevelName } from '../src/config';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { STEPS_PER_SECOND } from './helpers';

const halfLength = TUNING.match.halfLength;
beforeAll(() => {
  TUNING.match.halfLength = 120; // shorter matches: the result is over several of them
});
afterAll(() => {
  TUNING.match.halfLength = halfLength;
});

/** Goals for each level over a seeded match between them (home, away). */
async function play(seed: number, home: LevelName, away: LevelName): Promise<[number, number]> {
  const sim = await Sim.create({ seed, players: fullLineup(), ai: true, kickoff: true, levels: [home, away] });
  for (let i = 0; i < 15 * 60 * STEPS_PER_SECOND && !sim.match.over; i++) sim.step([]);
  return [sim.match.score[0], sim.match.score[1]];
}

/** Aggregate goals for `a` and `b` over seeded matches between them, each side at home in turn. */
async function series(a: LevelName, b: LevelName, seeds: number[]): Promise<[number, number]> {
  let forA = 0;
  let forB = 0;
  for (const seed of seeds) {
    const [a1, b1] = await play(seed, a, b);
    const [b2, a2] = await play(seed + 100, b, a);
    forA += a1 + a2;
    forB += b1 + b2;
  }
  return [forA, forB];
}

describe('difficulty', () => {
  it('hard beats easy over a series of matches, home and away', async () => {
    const [hard, easy] = await series('hard', 'easy', [1, 2, 3, 4]);
    expect(hard).toBeGreaterThan(easy * 1.5);
  });

  it('normal beats easy over a series', async () => {
    const [normal, easy] = await series('normal', 'easy', [1, 2, 3]);
    expect(normal).toBeGreaterThan(easy * 1.5);
  });
});
