import { describe, expect, it } from 'vitest';
import { HALF_LENGTH, HALF_WIDTH } from '../src/constants';
import { DIAMOND, shiftedSlot } from '../src/team/formation';
import { fullLineup } from '../src/team/lineup';

const outfield = DIAMOND.filter((s) => s.role !== 'keeper');
const balls = [
  { x: 0, z: 0 },
  { x: 18, z: 8 },
  { x: -18, z: -8 },
  { x: 10, z: -9 },
];

describe('shifted formation', () => {
  it('keeps every slot inside the pitch wherever the ball is', () => {
    for (const ball of balls) {
      for (const dir of [1, -1] as const) {
        for (const has of [true, false]) {
          for (const slot of DIAMOND) {
            const p = shiftedSlot(slot, ball, dir, has);
            expect(Math.abs(p.x)).toBeLessThan(HALF_LENGTH);
            expect(Math.abs(p.z)).toBeLessThan(HALF_WIDTH);
          }
        }
      }
    }
  });

  it('follows the ball up and down the pitch', () => {
    for (const slot of outfield) {
      const back = shiftedSlot(slot, { x: -15, z: 0 }, 1, false);
      const up = shiftedSlot(slot, { x: 15, z: 0 }, 1, false);
      expect(up.x).toBeGreaterThan(back.x + 5);
    }
  });

  it('pushes up with the ball and drops back without it', () => {
    for (const slot of outfield) {
      expect(shiftedSlot(slot, { x: 0, z: 0 }, 1, true).x).toBeGreaterThan(shiftedSlot(slot, { x: 0, z: 0 }, 1, false).x);
    }
  });

  it('is the mirror image for a team attacking the other way', () => {
    for (const ball of balls) {
      for (const slot of DIAMOND) {
        const a = shiftedSlot(slot, ball, 1, true);
        const b = shiftedSlot(slot, { x: -ball.x, z: -ball.z }, -1, true);
        expect(b.x).toBeCloseTo(-a.x);
        expect(b.z).toBeCloseTo(-a.z);
      }
    }
  });

  it('keeps the keeper in goal', () => {
    const keeper = DIAMOND.find((s) => s.role === 'keeper')!;
    expect(shiftedSlot(keeper, { x: 18, z: 5 }, 1, true).x).toBeLessThan(-HALF_LENGTH + 3);
  });
});

describe('full lineup', () => {
  it('has five a side, each team in its own half facing the other way', () => {
    const lineup = fullLineup();
    expect(lineup).toHaveLength(10);
    for (const team of [0, 1] as const) {
      const players = lineup.filter((p) => p.team === team);
      expect(players).toHaveLength(5);
      expect(players.filter((p) => p.role === 'keeper')).toHaveLength(1);
      const dir = team === 0 ? 1 : -1;
      for (const p of players) {
        expect(p.kickoff.x * dir).toBeLessThan(0);
        expect(Math.cos(p.kickoffFacing) * dir).toBeCloseTo(1);
      }
    }
  });
});
