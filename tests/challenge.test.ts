import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../src/constants';
import { AVERAGE, type PlayerSpec } from '../src/sim/player';
import { weight } from '../src/sim/separation';
import { DIAMOND } from '../src/team/formation';
import { cmd, createSim, STEPS_PER_SECOND } from './helpers';

const pivot = DIAMOND.find((s) => s.role === 'pivot')!;
const CONTACT = 2 * PLAYER_RADIUS;

/**
 * Player 0 (team 0) carries the ball along +X at z = 0; player 1 (team 1) runs beside
 * them at z = `side` (shoulder to shoulder), leaning in. Their strengths are given.
 */
function pair(carrier: number, challenger: number, side = -CONTACT): PlayerSpec[] {
  return [
    { team: 0, role: 'pivot', slot: pivot, kickoff: { x: -10, z: 0 }, kickoffFacing: 0, attrs: { ...AVERAGE, strength: carrier } },
    { team: 1, role: 'pivot', slot: pivot, kickoff: { x: -10, z: side }, kickoffFacing: 0, attrs: { ...AVERAGE, strength: challenger } },
  ];
}

/**
 * Run them shoulder to shoulder for `seconds`; returns the sim, the challenge events, and
 * how far off their line (z = 0) the carrier was pushed at most.
 */
async function race(seed: number, carrier: number, challenger: number, seconds: number, lean = 0.35) {
  const sim = await createSim(seed, pair(carrier, challenger));
  sim.placeBall({ x: -9.4, z: 0 });
  sim.possession.control(0);
  const challenges = [];
  let drift = 0;
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    const [c, o] = sim.players;
    // The carrier holds their line; the challenger goes for the ball, leaning into them.
    const b = sim.ball.translation();
    const into = Math.sign(c.pos.z - o.pos.z) || 1;
    const tx = b.x + 0.5 - o.pos.x;
    const tz = b.z - o.pos.z + into * lean;
    const n = Math.hypot(tx, tz) || 1;
    const events = sim.step([cmd({ move: { x: 1, z: 0 } }), cmd({ move: { x: tx / n, z: tz / n } })]);
    challenges.push(...events.filter((e) => e.type === 'challenge'));
    drift = Math.max(drift, Math.abs(c.pos.z));
  }
  return { sim, challenges, drift };
}

describe('shoulder challenges', () => {
  it('weighs strength and momentum', async () => {
    const sim = await createSim(1, pair(0.9, 0.1));
    const [strong, weak] = sim.players;
    expect(weight(strong)).toBeGreaterThan(weight(weak) * 1.5);
    const before = weight(weak);
    weak.speed = 7;
    expect(weight(weak)).toBeGreaterThan(before * 1.3);
  });

  it('reports a challenge when an opponent comes into contact with the carrier', async () => {
    const { challenges } = await race(1, 0.5, 0.5, 1);
    expect(challenges.length).toBeGreaterThanOrEqual(1);
    expect(challenges[0]).toMatchObject({ carrier: 0, challenger: 1 });
  });

  it('lets the stronger player hold their line while the weaker one is moved off it', async () => {
    // A strong carrier: the challenger bounces off.
    const strong = await race(1, 0.9, 0.1, 1.5);
    // A weak carrier: they're pushed off their line.
    const weak = await race(1, 0.1, 0.9, 1.5);
    expect(weak.drift).toBeGreaterThan(strong.drift + 0.3);
    expect(strong.drift).toBeLessThan(0.2);
  });

  it('a strong carrier keeps the ball more often than a weak one', async () => {
    let strongKept = 0;
    let weakKept = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const lean = 0.25 + (seed % 4) * 0.1;
      if ((await race(seed, 0.9, 0.3, 2.5, lean)).sim.possession.owner === 0) strongKept++;
      if ((await race(seed, 0.1, 0.7, 2.5, lean)).sim.possession.owner === 0) weakKept++;
    }
    expect(strongKept).toBeGreaterThanOrEqual(9);
    expect(strongKept).toBeGreaterThan(weakKept + 4);
  });
});
