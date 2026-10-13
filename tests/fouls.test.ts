import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { HALF_LENGTH } from '../src/constants';
import { IDLE, type Command } from '../src/sim/command';
import { HumanControl } from '../src/sim/control';
import type { SimEvent } from '../src/sim/events';
import { AVERAGE, type PlayerSpec } from '../src/sim/player';
import { inGoalArea, restartForFoul, type Restart } from '../src/sim/rules';
import { Sim } from '../src/sim/sim';
import { DIAMOND } from '../src/team/formation';
import { fullLineup } from '../src/team/lineup';
import { cmd, createSim, STEPS_PER_SECOND } from './helpers';

const M = TUNING.match;
const pivot = DIAMOND.find((s) => s.role === 'pivot')!;
/** In the first half the home team (0) attacks +X. */
const attackDir = (team: 0 | 1): 1 | -1 => (team === 0 ? 1 : -1);

/** Step until the restart is set up (the foul's stoppage is over). */
function untilRestart(sim: Sim, seconds = M.foulDelay + 0.5): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * STEPS_PER_SECOND && sim.match.phase.kind !== 'restart'; i++) events.push(...sim.step([]));
  return events;
}

/** A full match line-up (standing still unless `ai`), with a foul on team `fouled` at `at`, set up and waiting to be taken. */
async function afterFoul(at: { x: number; z: number }, fouled: 0 | 1, ai = false, seed = 1): Promise<{ sim: Sim; restart: Restart }> {
  const sim = await Sim.create({ seed, players: fullLineup(), ai });
  const restart = restartForFoul(at, fouled, (t) => sim.attackDir(t));
  sim.match.foul(restart);
  untilRestart(sim);
  return { sim, restart };
}

describe('foul rules', () => {
  it('draws the goal area as quarter circles round the posts joined across the front', () => {
    const goalX = -HALF_LENGTH;
    expect(inGoalArea({ x: -15, z: 0 }, goalX)).toBe(true); // 5 m out, central
    expect(inGoalArea({ x: -14.2, z: 1.4 }, goalX)).toBe(true); // in front of a post
    expect(inGoalArea({ x: -14.2, z: 4 }, goalX)).toBe(false); // outside the arc
    expect(inGoalArea({ x: -19, z: 6 }, goalX)).toBe(true); // along the line, within 6 m of the post
    expect(inGoalArea({ x: -15, z: 0 }, HALF_LENGTH)).toBe(false); // the other end
  });

  it('gives a free kick on the spot, or a penalty for a foul in the defending area', () => {
    // Team 1 fouled in midfield: a free kick for them where it happened.
    expect(restartForFoul({ x: 3, z: -2 }, 1, attackDir)).toEqual({ kind: 'freeKick', at: { x: 3, z: -2 }, team: 1 });
    // Team 0, attacking +X, fouled 4 m from the goal it attacks: a penalty on the spot.
    expect(restartForFoul({ x: 16, z: 1 }, 0, attackDir)).toEqual({ kind: 'penalty', at: { x: 14, z: 0 }, team: 0 });
    // Team 0 fouled in their own area: just a free kick.
    expect(restartForFoul({ x: -16, z: 1 }, 0, attackDir).kind).toBe('freeKick');
  });
});

describe('fouls in the sim', () => {
  /** Two players: 0 (team 0) tackles 1 (team 1) from behind, out of reach of the ball, until one is a foul. */
  async function foulFromBehind(at: number): Promise<{ sim: Sim; events: SimEvent[] }> {
    const specs: PlayerSpec[] = [
      { team: 0, role: 'pivot', slot: pivot, kickoff: { x: at - 1.1, z: 0 }, kickoffFacing: 0, attrs: { ...AVERAGE } },
      { team: 1, role: 'pivot', slot: pivot, kickoff: { x: at, z: 0 }, kickoffFacing: 0, attrs: { ...AVERAGE } },
    ];
    for (let seed = 1; seed <= 40; seed++) {
      const sim = await createSim(seed * 104729, specs);
      sim.placeBall({ x: at + 0.9, z: 0 });
      sim.possession.control(1);
      const events: SimEvent[] = [];
      for (let i = 0; i < 0.4 * STEPS_PER_SECOND; i++) events.push(...sim.step([cmd({ tackle: i === 0 }), IDLE]));
      if (events.some((e) => e.type === 'foul')) return { sim, events };
    }
    throw new Error('no foul in 40 tries');
  }

  it('a foul stops play, then gives the fouled team a free kick at the spot', async () => {
    const { sim, events } = await foulFromBehind(0);
    const foul = events.find((e): e is Extract<SimEvent, { type: 'foul' }> => e.type === 'foul')!;
    expect(foul).toMatchObject({ player: 0, against: 1, restart: { kind: 'freeKick', team: 1 } });
    expect(sim.match.phase.kind).toBe('foul');
    const restart = untilRestart(sim).find((e): e is Extract<SimEvent, { type: 'restart' }> => e.type === 'restart');
    expect(restart).toMatchObject({ restart: { kind: 'freeKick', team: 1 }, taker: 1 });
    const b = sim.ball.translation();
    expect(Math.hypot(b.x - foul.restart.at.x, b.z - foul.restart.at.z)).toBeLessThan(1e-6);
  });

  it('keeps the other team 4 m from a free kick', async () => {
    // A foul on the away team right in the middle of the home team.
    const { sim, restart } = await afterFoul({ x: -6, z: 0 }, 1);
    for (let i = 0; i < STEPS_PER_SECOND; i++) sim.step([]);
    for (const p of sim.players) {
      if (p.team === 1) continue;
      expect(Math.hypot(p.pos.x - restart.at.x, p.pos.z - restart.at.z)).toBeGreaterThanOrEqual(M.freeKickDistance - 1e-6);
    }
  });

  it('gives a penalty for a foul in the defending area', async () => {
    // The away team attacks -X: a foul on them 3 m from that goal.
    const { sim } = await afterFoul({ x: -17, z: 1 }, 1);
    const phase = sim.match.phase;
    expect(phase.kind === 'restart' && phase.restart).toMatchObject({ kind: 'penalty', at: { x: -14, z: 0 }, team: 1 });
    // Taken by the away team's best shooter.
    const taker = sim.players[sim.match.taker!];
    const shooters = sim.players.filter((p) => p.team === 1 && p.spec.role !== 'keeper').map((p) => p.attrs.shooting);
    expect(taker.attrs.shooting).toBe(Math.max(...shooters));
    for (let i = 0; i < STEPS_PER_SECOND; i++) sim.step([]);
    for (const p of sim.players) {
      if (p.id === taker.id) continue;
      if (p.team === 0 && p.spec.role === 'keeper') {
        // On the line.
        expect(p.pos.x).toBeCloseTo(-(HALF_LENGTH - M.keeperOnLine), 5);
      } else {
        // Behind the spot (further from the goal), so outside the area.
        expect(p.pos.x).toBeGreaterThanOrEqual(-14 + M.penaltyBehind - 1e-6);
        expect(inGoalArea(p.pos, -HALF_LENGTH)).toBe(false);
      }
    }
  });

  it('penalties are scored and saved', async () => {
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 16; seed++) {
      const { sim } = await afterFoul({ x: 17, z: 0 }, 0, true, seed);
      for (let i = 0; i < 6 * STEPS_PER_SECOND; i++) {
        const shot = sim.step([]).find((e): e is Extract<SimEvent, { type: 'shot' }> => e.type === 'shot');
        if (shot) {
          outcomes.push(shot.outcome.kind);
          break;
        }
      }
    }
    expect(outcomes.length).toBeGreaterThanOrEqual(14);
    const goals = outcomes.filter((o) => o === 'goal').length;
    expect(goals).toBeGreaterThanOrEqual(4);
    expect(goals).toBeLessThan(outcomes.length);
  });

  it('the AI shoots some free kicks near goal directly, with a wall in front of it', async () => {
    let shots = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // A free kick to the home team 9 m out, central.
      const { sim } = await afterFoul({ x: 11, z: 0 }, 0, true, seed);
      const taker = sim.match.taker;
      for (let i = 0; i < 4 * STEPS_PER_SECOND && sim.match.phase.kind === 'restart'; i++) {
        const events = sim.step([]);
        if (events.some((e) => e.type === 'kick' && e.player === taker && e.kind === 'shoot')) shots++;
        if (i === STEPS_PER_SECOND / 2) {
          // The away team has two players in a wall between the ball and their goal.
          const wall = sim.ai!.states.filter((s) => s.kind === 'wall');
          expect(wall).toHaveLength(2);
        }
      }
    }
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  it('a human penalty taker aims with A and D, within limits', async () => {
    const { sim } = await afterFoul({ x: 17, z: 0 }, 0);
    const control = new HumanControl(0, sim.match.taker!);
    const taker = sim.players[control.controlled];
    const start = taker.facing;
    const turn = (x: number, seconds: number) => {
      for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
        const commands: Command[] = [];
        commands[control.controlled] = control.command(sim, cmd({ move: { x, z: 0 } }));
        sim.step(commands);
      }
    };
    // D: turn right, which facing +X is towards +Z.
    turn(1, 0.2);
    expect(taker.facing - start).toBeGreaterThan(0.1);
    expect(taker.facing - start).toBeLessThan(M.penaltyTurnRate * 0.25);
    // Hold it: no further than the limit.
    turn(1, 2);
    expect(taker.facing - start).toBeCloseTo(M.penaltyMaxAim, 1);
    turn(-1, 1);
    expect(taker.facing - start).toBeLessThan(0);
    expect(sim.match.phase.kind).toBe('restart');
  });
});
