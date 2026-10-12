import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { HALF_LENGTH } from '../src/constants';
import type { Command } from '../src/sim/command';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { cmd } from './helpers';

const byRole = (sim: Sim, team: 0 | 1, role: string) => sim.players.find((p) => p.team === team && p.spec.role === role)!;

/** Open play with the away pivot on the ball in the home half, at (x, z). */
async function awayAttack(x = -8, z = 2): Promise<Sim> {
  const sim = await Sim.create({ seed: 1, players: fullLineup(), ai: true });
  const carrier = byRole(sim, 1, 'pivot');
  carrier.pos.x = x;
  carrier.pos.z = z;
  sim.placeBall({ x: x - 0.6, z });
  sim.possession.control(carrier.id);
  return sim;
}

function steps(sim: Sim, n: number, commands: (i: number) => Command[] = () => []): void {
  for (let i = 0; i < n; i++) sim.step(commands(i));
}

describe('team brain', () => {
  it('reads the phase of play from who has the ball', async () => {
    const sim = await awayAttack();
    steps(sim, TUNING.ai.brainInterval);
    expect(sim.ai!.planOf(0).phase).toBe('defend');
    expect(sim.ai!.planOf(1).phase).toBe('attack');
    expect(sim.ai!.planOf(0).transition).toBe(true); // they've only just lost it
  });

  it('defends with one presser, one cover goal-side of them, and markers on different men', async () => {
    const sim = await awayAttack();
    steps(sim, TUNING.ai.brainInterval);
    const plan = sim.ai!.planOf(0);
    expect(plan.presser).not.toBeNull();
    expect(plan.cover).not.toBeNull();
    expect(plan.cover).not.toBe(plan.presser);
    const markedMen = [...plan.marks.values()];
    expect(new Set(markedMen).size).toBe(markedMen.length);
    expect(markedMen).not.toContain(byRole(sim, 1, 'pivot').id); // the carrier is the presser's
    // Nobody but outfield players has a defensive job.
    const keeper = byRole(sim, 0, 'keeper').id;
    expect([plan.presser, plan.cover, ...plan.marks.keys()]).not.toContain(keeper);

    // After a couple of seconds the cover is between the ball and the home goal, behind the presser.
    steps(sim, 120);
    const after = sim.ai!.planOf(0);
    const goalX = -HALF_LENGTH;
    const distToGoal = (id: number) => Math.abs(sim.players[id].pos.x - goalX);
    expect(distToGoal(after.cover!)).toBeLessThan(distToGoal(after.presser!));
  });

  it('marks goal-side of the man', async () => {
    const sim = await awayAttack(-6, 0);
    steps(sim, 150);
    const plan = sim.ai!.planOf(0);
    expect(plan.marks.size).toBeGreaterThan(0);
    for (const [marker, man] of plan.marks) {
      // Home defends -X, so goal-side means a smaller x.
      expect(sim.players[marker].pos.x).toBeLessThan(sim.players[man].pos.x + 0.5);
    }
  });

  it('sends a teammate to press when a human calls for it (L)', async () => {
    const sim = await awayAttack();
    steps(sim, TUNING.ai.brainInterval);
    const natural = sim.ai!.planOf(0).presser!;
    // The human is on the natural presser and calls for help.
    const commands = (i: number) => {
      const c: Command[] = [];
      c[natural] = cmd({ press: i === 0 });
      return c;
    };
    steps(sim, 2 * TUNING.ai.brainInterval, commands);
    const plan = sim.ai!.planOf(0);
    expect(sim.pressCalled(0)).toBe(true);
    expect(plan.presser).not.toBe(natural);
    expect(sim.players[plan.presser!].team).toBe(0);
  });
});
