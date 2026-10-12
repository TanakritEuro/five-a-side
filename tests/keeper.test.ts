import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { TUNING, type LevelName } from '../src/config';
import { BALL_RADIUS, GOAL_AREA_RADIUS, GOAL_WIDTH, HALF_LENGTH } from '../src/constants';
import { diveTargetPose, distanceToKeeper, standingPose } from '../src/keeper/pose';
import { createRng } from '../src/math';
import type { Command } from '../src/sim/command';
import type { SimEvent } from '../src/sim/events';
import type { PlayerSpec } from '../src/sim/player';
import { Sim } from '../src/sim/sim';
import { DIAMOND, type Role } from '../src/team/formation';
import { cmd, STEPS_PER_SECOND } from './helpers';

const at = (team: 0 | 1, role: Role, x: number, z: number, facing = 0): PlayerSpec => ({
  team,
  role,
  slot: DIAMOND.find((s) => s.role === role)!,
  kickoff: { x, z },
  kickoffFacing: facing,
});

/** The away keeper in the +X goal, a home shooter, and an away defender to throw to. */
function lineup(shooterZ: number): PlayerSpec[] {
  return [at(0, 'pivot', 9.4, shooterZ), at(1, 'keeper', HALF_LENGTH - 1.3, 0, Math.PI), at(1, 'left', 2, -6, Math.PI)];
}

const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('keeper pose (ported)', () => {
  it('reaches a ball within a dive, but not one beyond it', () => {
    const maxDive = TUNING.keeper.levels.normal.maxDive;
    const start = standingPose(0);
    const near = diveTargetPose(start, 1.2, 0.5, maxDive);
    expect(distanceToKeeper(near, 1.2, 0.5)).toBeLessThan(0.15);
    const far = diveTargetPose(start, 4, 0.5, maxDive);
    expect(distanceToKeeper(far, 4, 0.5)).toBeGreaterThan(0.5);
  });

  it('stays on their feet for a ball close to them, jumping for a high one', () => {
    const high = diveTargetPose(standingPose(0), 0.2, 2.4, 2);
    expect(high.lean).toBe(0);
    expect(high.y).toBeGreaterThan(0);
  });
});

describe('saving shots', () => {
  /**
   * A battery of seeded shots from about 10 m at points across the goal: the share of
   * those on target that the keeper keeps out.
   */
  async function saveRate(level: LevelName): Promise<{ onTarget: number; saved: number }> {
    let onTarget = 0;
    let saved = 0;
    const rng = createRng(42);
    for (let i = 0; i < 24; i++) {
      const z = (rng() - 0.5) * 4;
      const sim = await Sim.create({ seed: 100 + i, players: lineup(z), ai: true, levels: ['normal', level] });
      const shooter = sim.players[0];
      const aimZ = (rng() - 0.5) * (GOAL_WIDTH - 0.6);
      shooter.facing = Math.atan2(aimZ - z, HALF_LENGTH - 9.4);
      sim.placeBall({ x: 9.4 + Math.cos(shooter.facing) * 0.6, z: z + Math.sin(shooter.facing) * 0.6 });
      const hold = Math.round(0.65 * TUNING.shot.chargeTime * STEPS_PER_SECOND);
      const events: SimEvent[] = [];
      for (let s = 0; s < 3 * STEPS_PER_SECOND; s++) {
        const commands: Command[] = [];
        commands[0] = cmd({ shoot: s < hold });
        events.push(...sim.step(commands));
      }
      const outcome = ofType(events, 'shot')[0]?.outcome.kind;
      if (outcome === 'goal' || outcome === 'saved') onTarget++;
      if (outcome === 'saved') saved++;
    }
    return { onTarget, saved };
  }

  it('saves a fair share of shots on target, more at higher levels', async () => {
    const easy = await saveRate('easy');
    const normal = await saveRate('normal');
    const hard = await saveRate('hard');
    expect(normal.onTarget).toBeGreaterThan(10);
    const rate = (r: { onTarget: number; saved: number }) => r.saved / r.onTarget;
    expect(rate(normal)).toBeGreaterThan(0.2);
    expect(rate(normal)).toBeLessThan(0.75);
    expect(rate(hard)).toBeGreaterThan(rate(easy));
  });
});

describe('handling', () => {
  /** Roll the ball at the away keeper from `from` at `speed` and watch for `seconds`. */
  async function rollAtKeeper(from: { x: number; z: number }, speed: number, seconds: number, keeperX = HALF_LENGTH - 1.3) {
    const players = lineup(-9);
    players[1] = at(1, 'keeper', keeperX, 0, Math.PI);
    const sim = await Sim.create({ seed: 1, players, ai: true });
    // The last touch was the home team's (a shot or a cross), so the keeper may handle it.
    sim.possession.kick(0);
    const dx = keeperX - from.x;
    const dz = -from.z;
    const d = Math.hypot(dx, dz);
    const v = { x: (dx / d) * speed, z: (dz / d) * speed };
    sim.ball.setTranslation({ x: from.x, y: BALL_RADIUS, z: from.z }, true);
    sim.ball.setLinvel({ x: v.x, y: 0, z: v.z }, true);
    sim.ball.setAngvel(rollingSpin(v.x, v.z), true);
    const events: SimEvent[] = [];
    for (let s = 0; s < seconds * STEPS_PER_SECOND; s++) events.push(...sim.step([cmd()]));
    return { sim, events };
  }

  it('catches a slow ball in the area, holds it, then throws or rolls it to a teammate', async () => {
    const { sim, events } = await rollAtKeeper({ x: 10, z: 1 }, 7, 5);
    const save = ofType(events, 'save')[0];
    expect(save).toMatchObject({ player: 1, caught: true });
    const out = ofType(events, 'kick').find((k) => k.player === 1);
    expect(out?.kind).toBe('pass');
    expect(out?.receiver).toBe(2);
    expect(sim.handling.holder).toBeNull();
  });

  it("holds the ball in their hands, and can't take it out of the area", async () => {
    const { sim } = await rollAtKeeper({ x: 10, z: 1 }, 7, 1.5);
    expect(sim.handling.holder).toBe(1);
    const b = sim.ball.translation();
    expect(b.y).toBeGreaterThan(0.8);
    const k = sim.players[1];
    expect(Math.hypot(k.pos.x - HALF_LENGTH, k.pos.z)).toBeLessThan(GOAL_AREA_RADIUS);
  });

  it('parries a ball that comes too hard to hold', async () => {
    const { events } = await rollAtKeeper({ x: 12, z: 0.5 }, TUNING.keeper.levels.normal.catchSpeed + 8, 1);
    const save = ofType(events, 'save')[0];
    expect(save?.caught).toBe(false);
  });

  it('never handles outside the area', async () => {
    const { sim, events } = await rollAtKeeper({ x: 4, z: 0 }, 5, 2.5, HALF_LENGTH - GOAL_AREA_RADIUS - 2);
    expect(ofType(events, 'save').every((s) => !s.caught)).toBe(true);
    expect(sim.handling.holder).toBeNull();
  });

  it('comes out for a through ball into the area and gets there first', async () => {
    // A ball played into the area with a home attacker chasing it from further back.
    const players = [at(0, 'pivot', 8, 3), at(1, 'keeper', HALF_LENGTH - 1.3, 0, Math.PI), at(1, 'left', -2, -6, Math.PI)];
    const sim = await Sim.create({ seed: 1, players, ai: true });
    sim.possession.kick(0);
    sim.ball.setTranslation({ x: 9, y: BALL_RADIUS, z: 1 }, true);
    sim.ball.setLinvel({ x: 7, y: 0, z: -0.3 }, true);
    sim.ball.setAngvel(rollingSpin(7, -0.3), true);
    let first: number | undefined;
    for (let s = 0; s < 3 * STEPS_PER_SECOND && first === undefined; s++) {
      for (const e of sim.step([])) {
        if ((e.type === 'touch' && e.kind !== 'deflect') || e.type === 'save') first ??= e.player;
      }
    }
    expect(first).toBe(1);
  });
});
