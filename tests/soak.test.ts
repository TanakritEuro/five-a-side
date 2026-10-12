import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP, PLAYER_RADIUS } from '../src/constants';
import { outOfCage } from '../src/sim/rules';
import type { SimEvent } from '../src/sim/events';
import type { AiState } from '../src/ai/ai';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { createSim, randomDriver, STEPS_PER_SECOND } from './helpers';

const SECONDS = 90;
const R = TUNING.match;
/** Longest a goal or out pause can last before the restart is set. */
const MAX_PAUSE = Math.max(R.goalDelay, R.outDelay) + 0.1;
/** A restart waits for its taker; a random player gets round to kicking it eventually. */
const MAX_RESTART_WAIT = 30;
let goals = 0;

describe('soak: a frantic player for 90 s', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: stays finite, in the cage, and keeps restarting', async (seed) => {
    const sim = await createSim(seed);
    const drive = randomDriver(seed * 7919, sim);
    const counts: Partial<Record<SimEvent['type'], number>> = {};
    let paused = 0;
    let waiting = 0;

    for (let i = 0; i < SECONDS * STEPS_PER_SECOND; i++) {
      for (const e of sim.step([drive(i)])) counts[e.type] = (counts[e.type] ?? 0) + 1;

      const b = sim.ball.translation();
      const v = sim.ball.linvel();
      for (const n of [b.x, b.y, b.z, v.x, v.y, v.z]) expect(Number.isFinite(n)).toBe(true);
      for (const p of sim.players) {
        expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z) && Number.isFinite(p.facing)).toBe(true);
        expect(Math.abs(p.pos.x)).toBeLessThanOrEqual(HALF_LENGTH - PLAYER_RADIUS + 1e-9);
        expect(Math.abs(p.pos.z)).toBeLessThanOrEqual(HALF_WIDTH - PLAYER_RADIUS + 1e-9);
      }
      // Out of the cage only ever while the rules know about it.
      if (outOfCage(b)) expect(sim.match.phase.kind).toBe('out');

      const kind = sim.match.phase.kind;
      paused = kind === 'goal' || kind === 'out' ? paused + PHYSICS_STEP : 0;
      waiting = kind === 'restart' ? waiting + PHYSICS_STEP : 0;
      expect(paused).toBeLessThan(MAX_PAUSE);
      expect(waiting).toBeLessThan(MAX_RESTART_WAIT);
    }

    goals += counts.goal ?? 0;
    expect(counts.kick ?? 0).toBeGreaterThan(5);
    expect(counts.touch ?? 0).toBeGreaterThan(20);
  });

  it('scores goals across the runs (and restarts after them)', () => {
    expect(goals).toBeGreaterThan(3);
  });
});

/** Longest a player may stay in each AI state before it counts as stuck (s). */
const STUCK: Partial<Record<AiState['kind'], number>> = { chase: 15, dribble: 25, press: 30, takeRestart: 5 };
const goalsFor = [0, 0];

describe('soak: whole AI-vs-AI matches', () => {
  it.each([1, 2, 3, 4])('seed %i: plays to full time without getting stuck', async (seed) => {
    const sim = await Sim.create({ seed, players: fullLineup(), ai: true, kickoff: true });
    const ai = sim.ai!;
    let lastOwnerTeam: 0 | 1 | null = null;
    let turnovers = 0;
    // Two halves of play, plus generous time for stoppages.
    const limit = (2 * TUNING.match.halfLength + 240) * STEPS_PER_SECOND;
    for (let i = 0; i < limit && !sim.match.over; i++) {
      sim.step([]);
      const b = sim.ball.translation();
      for (const n of [b.x, b.y, b.z]) expect(Number.isFinite(n)).toBe(true);
      for (const p of sim.players) expect(Number.isFinite(p.pos.x + p.pos.z + p.facing)).toBe(true);
      if (outOfCage(b)) expect(sim.match.phase.kind).toBe('out');

      for (const p of sim.players) {
        const max = STUCK[ai.states[p.id].kind];
        if (max !== undefined) expect((sim.tick - ai.since[p.id]) * PHYSICS_STEP, `${ai.states[p.id].kind} for player ${p.id}`).toBeLessThan(max);
      }
      const owner = sim.possession.owner;
      if (owner !== null) {
        const team = sim.players[owner].team;
        if (lastOwnerTeam !== null && team !== lastOwnerTeam) turnovers++;
        lastOwnerTeam = team;
      }
    }
    expect(sim.match.over).toBe(true);
    expect(turnovers).toBeGreaterThan(10);
    goalsFor[0] += sim.match.score[0];
    goalsFor[1] += sim.match.score[1];
  });

  it('sees both teams score across the matches', () => {
    expect(goalsFor[0]).toBeGreaterThan(0);
    expect(goalsFor[1]).toBeGreaterThan(0);
  });
});
