import { describe, expect, it } from 'vitest';
import { launchSpeedFor, passSafety } from '../src/ai/passing';
import { assignSpots, goalAngle, scoreSupportSpots } from '../src/ai/support';
import { TUNING } from '../src/config';
import { arrivalSpeed } from '../src/sim/kick';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';

const S = TUNING.support;
const byRole = (sim: Sim, team: 0 | 1, role: string) => sim.players.find((p) => p.team === team && p.spec.role === role)!;

/** Open play with the home pivot on the ball at (x, z). */
async function homeAttack(x: number, z: number): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, players: fullLineup(), ai: true });
  const carrier = byRole(sim, 0, 'pivot');
  carrier.pos.x = x;
  carrier.pos.z = z;
  sim.placeBall({ x: x + 0.6, z });
  sim.possession.control(carrier.id);
  return sim;
}

describe('support spots', () => {
  it('scores the goalmouth angle higher close in and central', () => {
    const goal = { x: 20, z: 0 };
    expect(goalAngle({ x: 14, z: 0 }, goal)).toBeGreaterThan(goalAngle({ x: 5, z: 0 }, goal));
    expect(goalAngle({ x: 14, z: 0 }, goal)).toBeGreaterThan(goalAngle({ x: 14, z: 8 }, goal));
  });

  it('picks spots in passing range, spread out, mostly safe, and not on top of opponents', async () => {
    const sim = await homeAttack(-2, 0);
    const ball = { x: -1.4, z: 0 };
    const opponents = sim.players.filter((p) => p.team === 1);
    const spots = scoreSupportSpots(ball, 1, opponents);
    const supporters = sim.players.filter((p) => p.team === 0 && p.spec.role !== 'keeper' && p.spec.role !== 'pivot');
    const chosen = [...assignSpots(spots, supporters).values()];
    expect(chosen).toHaveLength(3);
    for (const a of chosen) {
      const d = Math.hypot(a.x - ball.x, a.z - ball.z);
      expect(d).toBeGreaterThanOrEqual(S.minDistance);
      expect(d).toBeLessThanOrEqual(S.maxDistance);
      for (const o of opponents) expect(Math.hypot(o.pos.x - a.x, o.pos.z - a.z)).toBeGreaterThan(1.5);
      for (const b of chosen) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(S.spacing);
    }
    const safe = chosen.filter((a) => {
      const d = Math.hypot(a.x - ball.x, a.z - ball.z);
      return passSafety(ball, a, launchSpeedFor(d, arrivalSpeed(d)), null, opponents) > 0;
    });
    expect(safe.length).toBeGreaterThanOrEqual(2);
  });
});

describe('supporting play', () => {
  it('offers the carrier a safe pass within a couple of seconds, even when pressed', async () => {
    const sim = await homeAttack(-4, 3);
    const carrier = byRole(sim, 0, 'pivot');
    // The carrier holds the ball (stands still) while the others move.
    let offered = false;
    for (let i = 0; i < 150 && !offered; i++) {
      const commands = [];
      commands[carrier.id] = { ...sim.ai!.command(sim, carrier), move: { x: 0, z: 0 }, pass: false, shoot: false };
      sim.step(commands);
      if (i < 60) continue;
      offered = sim.players.some((q) => {
        if (q.team !== 0 || q.id === carrier.id || q.spec.role === 'keeper') return false;
        const d = Math.hypot(q.pos.x - carrier.pos.x, q.pos.z - carrier.pos.z);
        if (d < 3 || d > 18) return false;
        const opponents = sim.players.filter((o) => o.team === 1);
        return passSafety(carrier.pos, q.pos, launchSpeedFor(d, arrivalSpeed(d)), q, opponents) > 0.1;
      });
    }
    expect(offered).toBe(true);
    // And they're doing it from support spots.
    const plan = sim.ai!.planOf(0);
    expect(plan.supports.size).toBe(3);
  });
});
