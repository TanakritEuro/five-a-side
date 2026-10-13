import { describe, expect, it } from 'vitest';
import { HALF_WIDTH } from '../src/constants';
import type { Command } from '../src/sim/command';
import { HumanControl } from '../src/sim/control';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { cmd, STEPS_PER_SECOND } from './helpers';

/** The keyboard's J and K set both of their meanings. */
const keys = (partial: Partial<Command> & { j?: boolean; k?: boolean } = {}) =>
  cmd({ ...partial, pass: !!partial.j, switch: !!partial.j, shoot: !!partial.k, tackle: !!partial.k });

/** Step with the human on team 0 driving through `control`; returns every event. */
function play(sim: Sim, control: HumanControl, seconds: number, raw: (i: number) => Command = () => keys()): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    const commands: Command[] = [];
    commands[control.controlled] = control.command(sim, raw(i));
    const events = sim.step(commands);
    control.afterStep(sim, events);
    all.push(...events);
  }
  return all;
}

const byRole = (sim: Sim, team: 0 | 1, role: string) => sim.players.find((p) => p.team === team && p.spec.role === role)!.id;

async function setup(): Promise<{ sim: Sim; control: HumanControl }> {
  const sim = await Sim.create({ seed: 1, players: fullLineup(), ai: true });
  return { sim, control: new HumanControl(0, byRole(sim, 0, 'pivot')) };
}

describe('switching', () => {
  it('J away from the ball switches to the teammate best placed to get it (never the keeper)', async () => {
    const { sim, control } = await setup();
    // A loose ball near the home defender, far from the pivot.
    sim.placeBall({ x: -10, z: 2 });
    play(sim, control, 0.1, (i) => keys({ j: i === 0 }));
    expect(control.controlled).toBe(byRole(sim, 0, 'defender'));
    // J again: someone else, but never the keeper.
    play(sim, control, 0.1, (i) => keys({ j: i === 0 }));
    expect(control.controlled).not.toBe(byRole(sim, 0, 'defender'));
    expect(sim.players[control.controlled].spec.role).not.toBe('keeper');
  });

  it('J with the ball at your feet passes instead, and switches to the receiver', async () => {
    const { sim, control } = await setup();
    const me = sim.players[control.controlled];
    // Face the left winger.
    const left = sim.players[byRole(sim, 0, 'left')];
    me.facing = Math.atan2(left.pos.z - me.pos.z, left.pos.x - me.pos.x);
    sim.placeBall({ x: me.pos.x + Math.cos(me.facing) * 0.6, z: me.pos.z + Math.sin(me.facing) * 0.6 });
    const events = play(sim, control, 0.1, (i) => keys({ j: i === 0 }));
    const kick = events.find((e): e is Extract<SimEvent, { type: 'kick' }> => e.type === 'kick');
    expect(kick).toMatchObject({ player: me.id, kind: 'pass', receiver: left.id });
    expect(control.controlled).toBe(left.id);
  });

  it('switches to the best-placed defender when the other team wins the ball', async () => {
    const { sim, control } = await setup();
    // The away pivot has the ball, deep in the home half.
    const thief = sim.players[byRole(sim, 1, 'pivot')];
    thief.pos.x = -8;
    thief.pos.z = -4;
    sim.placeBall({ x: -8.6, z: -4 });
    sim.possession.control(thief.id);
    play(sim, control, 0.1);
    expect(sim.possession.owner).toBe(thief.id);
    expect(sim.players[control.controlled].team).toBe(0);
    expect(control.controlled).not.toBe(byRole(sim, 0, 'pivot'));
// J right next to their ball still switches (it's not ours to pass).    const before = control.controlled;    play(sim, control, 0.05, (i) => keys({ j: i === 0 }));    expect(control.controlled).not.toBe(before);
  });

  it("puts you on your team's set-piece taker", async () => {
    const { sim, control } = await setup();
    sim.possession.reset(); // nobody touched it: the kick-in goes to the home team
    sim.ball.setTranslation({ x: -5, y: 7, z: HALF_WIDTH + 1 }, true);
    const events = play(sim, control, 2);
    const restart = events.find((e): e is Extract<SimEvent, { type: 'restart' }> => e.type === 'restart');
    expect(restart?.restart.team).toBe(0);
    expect(control.controlled).toBe(restart?.taker);
    // And it waits for you: the AI doesn't take it.
    expect(sim.match.phase.kind).toBe('restart');
  });
});

describe('K', () => {
  it('tackles when the other team has the ball, and shoots otherwise', async () => {
    const { sim, control } = await setup();
    const me = sim.players[control.controlled];
    sim.placeBall({ x: me.pos.x + 0.6, z: me.pos.z });
    sim.possession.control(me.id);
    expect(control.command(sim, keys({ k: true }))).toMatchObject({ shoot: true, tackle: false });
    const thief = sim.players[byRole(sim, 1, 'pivot')];
    sim.possession.control(thief.id);
    expect(control.command(sim, keys({ k: true }))).toMatchObject({ shoot: false, tackle: true });
  });
});
