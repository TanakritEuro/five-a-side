import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { BALL_RADIUS, HALF_LENGTH } from '../src/constants';
import { IDLE } from '../src/sim/command';
import type { SimEvent } from '../src/sim/events';
import { AVERAGE, type PlayerSpec } from '../src/sim/player';
import { Sim, type ActionKind } from '../src/sim/sim';
import { DIAMOND, type Role } from '../src/team/formation';
import { cmd, createSim, solo, STEPS_PER_SECOND } from './helpers';

const at = (team: 0 | 1, role: Role, x: number, z: number, facing = 0): PlayerSpec => ({
  team,
  role,
  slot: DIAMOND.find((s) => s.role === role)!,
  kickoff: { x, z },
  kickoffFacing: facing,
  attrs: { ...AVERAGE },
});

/** Step until an event of `type` happens (or `seconds` pass); returns it, with the sim stepped just past it. */
function until<T extends SimEvent['type']>(sim: Sim, type: T, drive: (i: number) => Parameters<Sim['step']>[0], seconds = 3) {
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    const e = sim.step(drive(i)).find((x): x is Extract<SimEvent, { type: T }> => x.type === type);
    if (e) return e;
  }
  return null;
}

describe('snapshots for animation', () => {
  it('carry speed, sprinting and the charge of a shot', async () => {
    const sim = await createSim(1, solo({ x: 0, z: 0 }, 0));
    sim.placeBall({ x: 0, z: 8 });
    for (let i = 0; i < STEPS_PER_SECOND; i++) sim.step([cmd({ move: { x: 1, z: 0 }, sprint: true })]);
    const p = sim.curr.players[0];
    expect(p.speed).toBeCloseTo(sim.players[0].speed, 6);
    expect(p.speed).toBeGreaterThan(4);
    expect(p.sprinting).toBe(true);
    for (let i = 0; i < 0.5 * STEPS_PER_SECOND; i++) sim.step([cmd({ shoot: true })]);
    expect(sim.curr.players[0].charge).toBeGreaterThan(0.3);
    expect(sim.curr.tick).toBe(sim.tick);
  });

  it('stamp a pass or shot with the tick of the first snapshot after it', async () => {
    const sim = await createSim(1, solo({ x: 0, z: 0 }, 0));
    sim.placeBall({ x: 0.6, z: 0 });
    const kick = until(sim, 'kick', (i) => [cmd({ pass: i === 0 })]);
    expect(kick).not.toBeNull();
    expect(sim.curr.players[0].action).toEqual({ kind: 'pass' satisfies ActionKind, tick: sim.curr.tick });
    expect(sim.prev.players[0].action).toBeNull();
  });

  it('show a tackle lunging, then the tackle, and both players in a shoulder challenge', async () => {
    const players = [at(0, 'pivot', 1.5, 0, Math.PI), at(1, 'pivot', 0, 0, 0)];
    const sim = await createSim(1, players);
    sim.placeBall({ x: 0.7, z: 0 });
    sim.possession.control(1);
    sim.step([cmd({ tackle: true }), IDLE]);
    expect(sim.curr.players[0].tackle).toBeGreaterThanOrEqual(0);
    expect(sim.curr.players[1].tackle).toBe(-1);
    until(sim, 'tackle', () => [IDLE, IDLE]);
    expect(sim.curr.players[0].action?.kind).toBe('tackle');

    // Shoulder to shoulder with the carrier: both are in a challenge.
    const side = await createSim(1, [at(0, 'pivot', -10, -0.55), at(1, 'pivot', -10, 0)]);
    side.placeBall({ x: -9.4, z: 0 });
    side.possession.control(1);
    const challenge = until(side, 'challenge', () => [cmd({ move: { x: 0.9, z: 0.4 } }), cmd({ move: { x: 1, z: 0 } })]);
    expect(challenge).not.toBeNull();
    expect(side.curr.players[0].action?.kind).toBe('challenge');
    expect(side.curr.players[1].action?.kind).toBe('challenge');
  });

  it('show a keeper catching, holding and throwing or rolling the ball out', async () => {
    const players = [at(0, 'pivot', 9.4, -9), at(1, 'keeper', HALF_LENGTH - 1.3, 0, Math.PI), at(1, 'left', 2, -6, Math.PI)];
    const sim = await Sim.create({ seed: 1, players, ai: true });
    sim.possession.kick(0);
    sim.ball.setTranslation({ x: 10, y: BALL_RADIUS, z: 1 }, true);
    const d = Math.hypot(HALF_LENGTH - 1.3 - 10, 1);
    const v = { x: ((HALF_LENGTH - 1.3 - 10) / d) * 7, z: (-1 / d) * 7 };
    sim.ball.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    sim.ball.setAngvel(rollingSpin(v.x, v.z), true);
    const idle = () => [cmd()];
    expect(until(sim, 'save', idle)).toMatchObject({ caught: true });
    expect(sim.curr.players[1].holding).toBe(true);
    expect(sim.curr.players[1].action?.kind).toBe('catch');
    const out = until(sim, 'kick', idle, 5);
    expect(out?.player).toBe(1);
    expect(sim.curr.players[1].holding).toBe(false);
    expect(['throw', 'roll']).toContain(sim.curr.players[1].action?.kind);
  });
});
