import { describe, expect, it } from 'vitest';
import { CLASH, colourDistance, matchKits, TEAMS } from '../src/team/teams';

describe('teams', () => {
  it('has eight teams with distinct names and short names', () => {
    expect(TEAMS).toHaveLength(8);
    expect(new Set(TEAMS.map((t) => t.name)).size).toBe(8);
    expect(new Set(TEAMS.map((t) => t.short)).size).toBe(8);
    for (const t of TEAMS) expect(t.short).toMatch(/^[A-Z]{3}$/);
  });

  it("gives every team two kits that don't clash with each other", () => {
    for (const t of TEAMS) expect(colourDistance(t.kits[0].shirt, t.kits[1].shirt)).toBeGreaterThanOrEqual(CLASH);
  });

  it('never sends two teams out in clashing shirts', () => {
    for (const home of TEAMS) {
      for (const away of TEAMS) {
        if (home === away) continue;
        const [h, a] = matchKits(home, away);
        expect(h).toBe(home.kits[0]);
        expect(colourDistance(h.shirt, a.shirt)).toBeGreaterThanOrEqual(CLASH);
      }
    }
  });

  it('keeps the away team in its home kit when there is no clash', () => {
    const [, a] = matchKits(TEAMS[0], TEAMS[1]); // blue against red
    expect(a).toBe(TEAMS[1].kits[0]);
  });

  it('measures colour difference sensibly', () => {
    expect(colourDistance(0xffffff, 0xffffff)).toBe(0);
    expect(colourDistance(0x000000, 0xffffff)).toBeGreaterThan(700);
    expect(colourDistance(0xd23b2c, 0xc0392b)).toBeLessThan(CLASH);
  });
});
