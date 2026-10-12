import { describe, expect, it } from 'vitest';
import type { PlayerSpec } from '../src/sim/player';
import type { SimEvent } from '../src/sim/events';
import { pickReceiver } from '../src/sim/kick';
import { Sim } from '../src/sim/sim';
import { DIAMOND } from '../src/team/formation';
import { cmd, createSim, STEPS_PER_SECOND } from './helpers';

const at = (team: 0 | 1, x: number, z: number, facing = 0): PlayerSpec => ({
  team,
  role: 'pivot',
  slot: DIAMOND[4],
  kickoff: { x, z },
  kickoffFacing: facing,
});

type Kick = Extract<SimEvent, { type: 'kick' }>;

describe('picking a receiver', () => {
  it('picks the teammate in front over one behind, and ignores opponents', async () => {
    const sim = await createSim(1, [at(0, 0, 0), at(0, -8, 0), at(0, 9, 2), at(1, 5, 0)]);
    expect(pickReceiver(sim.players[0], sim.players, sim.players[0].pos)?.id).toBe(2);
  });

  it('prefers the teammate most in line with the facing', async () => {
    const sim = await createSim(1, [at(0, 0, 0), at(0, 10, 5), at(0, 12, 0.5)]);
    expect(pickReceiver(sim.players[0], sim.players, sim.players[0].pos)?.id).toBe(2);
  });

  it('returns nobody when no teammate is in the cone', async () => {
    const sim = await createSim(1, [at(0, 0, 0), at(0, 0, 8)]);
    expect(pickReceiver(sim.players[0], sim.players, sim.players[0].pos)).toBeNull();
  });
});

describe('passing with J', () => {
  it('reaches a teammate standing in front, who controls it', async () => {
    const sim = await createSim(1, [at(0, -6, 0), at(0, 6, 1, Math.PI)]);
    sim.placeBall({ x: -5.4, z: 0 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 3 * STEPS_PER_SECOND && sim.possession.owner !== 1; i++) {
      events.push(...sim.step([cmd({ pass: i === 0 })]));
    }
    expect(events.find((e): e is Kick => e.type === 'kick')?.receiver).toBe(1);
    expect(sim.possession.owner).toBe(1);
  });

  it('leads a running teammate, who gets on the end of it', async () => {
    // The receiver runs across the pitch; once the pass is played the AI takes them to it.
    const sim = await Sim.create({ seed: 1, players: [at(0, -8, 0), at(0, 4, -6, Math.PI / 2)], ai: true });
    sim.placeBall({ x: -7.4, z: 0 });
    let kick: Kick | undefined;
    for (let i = 0; i < 4 * STEPS_PER_SECOND && sim.possession.owner !== 1; i++) {
      const commands = [cmd({ pass: i === 30 })];
      if (!kick) commands.push(cmd({ move: { x: 0, z: 1 } }));
      const events = sim.step(commands);
      kick ??= events.find((e): e is Kick => e.type === 'kick');
    }
    expect(kick?.receiver).toBe(1);
    // Aimed ahead of where the receiver was (they were running towards +Z).
    expect(kick!.target.z).toBeGreaterThan(-6 + 1);
    expect(sim.possession.owner).toBe(1);
  });
});
