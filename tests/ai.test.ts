import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { BALL_RADIUS, HALF_WIDTH } from '../src/constants';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { solo, STEPS_PER_SECOND } from './helpers';

function openPlay(seed = 1): Promise<Sim> {
  return Sim.create({ seed, players: fullLineup(), ai: true });
}

function roll(sim: Sim, x: number, z: number, vx: number, vz: number): void {
  sim.ball.setTranslation({ x, y: BALL_RADIUS, z }, true);
  sim.ball.setLinvel({ x: vx, y: 0, z: vz }, true);
  sim.ball.setAngvel(rollingSpin(vx, vz), true);
}

const chasers = (sim: Sim, team: 0 | 1) => sim.players.filter((p) => p.team === team && sim.ai!.states[p.id]?.kind === 'chase');

describe('team AI', () => {
  it('sends exactly one player per team after a loose ball', async () => {
    const sim = await openPlay();
    roll(sim, 0, 6, 3, -2);
    sim.step([]);
    expect(chasers(sim, 0)).toHaveLength(1);
    expect(chasers(sim, 1)).toHaveLength(1);
  });

  it('has a chaser get to the loose ball first', async () => {
    for (const [x, z, vx, vz] of [
      [0, 6, 3, -2],
      [-8, -4, 6, 4],
      [10, 2, -8, 1],
    ]) {
      const sim = await openPlay();
      roll(sim, x, z, vx, vz);
      sim.step([]);
      const picked = new Set([...chasers(sim, 0), ...chasers(sim, 1)].map((p) => p.id));
      let first: number | undefined;
      for (let i = 0; i < 5 * STEPS_PER_SECOND && first === undefined; i++) {
        first = sim.step([]).find((e): e is Extract<SimEvent, { type: 'touch' }> => e.type === 'touch')?.player;
      }
      expect(first).toBeDefined();
      expect(picked.has(first!)).toBe(true);
    }
  });

  it('gets players off the ball to their slot or support spot', async () => {
    const sim = await openPlay(2);
    let checked = 0;
    let total = 0;
    for (let i = 0; i < 30 * STEPS_PER_SECOND; i++) {
      sim.step([]);
      if (i % 30) continue;
      for (const p of sim.players) {
        const s = sim.ai!.states[p.id];
        if (sim.tick - sim.ai!.since[p.id] < 2 * STEPS_PER_SECOND) continue;
        const target = s.kind === 'hold' ? sim.ai!.slotOf(p.id, p.team) : s.kind === 'support' ? s.spot : undefined;
        if (!target) continue;
        total += Math.hypot(target.x - p.pos.x, target.z - p.pos.z);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    // Slots and spots move with the ball (and spots get handed round), so players trail
    // them; on average they're close.
    expect(total / checked).toBeLessThan(3.5);
  });

  it('dribbles at goal and scores on an empty pitch', async () => {
    const sim = await Sim.create({ seed: 1, players: solo({ x: -10, z: 4 }, 0), ai: true });
    sim.placeBall({ x: -9.4, z: 4 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 12 * STEPS_PER_SECOND && sim.match.score[0] === 0; i++) events.push(...sim.step([]));
    expect(sim.match.score[0]).toBe(1);
    expect(events.some((e) => e.type === 'kick' && e.kind === 'shoot')).toBe(true);
  });

  it('takes a kick-in by passing to a teammate', async () => {
    const sim = await openPlay();
    sim.ball.setTranslation({ x: 3, y: 7, z: HALF_WIDTH + 1 }, true); // over the netting
    const events: SimEvent[] = [];
    for (let i = 0; i < 5 * STEPS_PER_SECOND && !events.some((e) => e.type === 'kick'); i++) events.push(...sim.step([]));
    const restart = events.find((e) => e.type === 'restart');
    const kick = events.find((e): e is Extract<SimEvent, { type: 'kick' }> => e.type === 'kick');
    expect(restart).toBeDefined();
    expect(kick?.player).toBe(restart?.type === 'restart' ? restart.taker : -1);
    expect(kick?.receiver).not.toBeNull();
    expect(sim.players[kick!.receiver!].team).toBe(sim.players[kick!.player].team);
  });
});
