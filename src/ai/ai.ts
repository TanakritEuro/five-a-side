import { predictPath, type BallPath } from '../ball/trajectory';
import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import { createRng, type Rng, type Vec2 } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { TeamBrain, type TeamPlan } from './brain';
import { dribble, runPlan, takeRestart } from './onball';
import { offBall, type AiState } from './states';

export type { AiState, DribblePlan } from './states';

/**
 * The AI for every player that isn't driven by a human. Each team's brain re-plans every
 * `brainInterval` steps (brain.ts: phase of play, who chases, presses, covers and
 * marks). Every step each player's state follows from that plan, plus anything that
 * can't wait for the next plan (they've just got the ball, or a restart is theirs), and
 * becomes a `Command` (states.ts off the ball, onball.ts on it).
 *
 * It has its own RNG (seeded from the match), so its choices don't disturb the dice the
 * simulation rolls for touches and kicks.
 */
export class Ai {
  readonly states: AiState[] = [];
  /** Tick each player entered their current state. */
  readonly since: number[] = [];
  readonly brains = [new TeamBrain(0), new TeamBrain(1)] as const;
  private readonly rng: Rng;
  private track: { path: BallPath; tick: number } | null = null;
  private stepsToBrain = 0;

  constructor(seed: number) {
    this.rng = createRng(seed ^ 0x5bd1e995);
  }

  /** Call once per step, before asking for commands. */
  update(sim: Sim): void {
    if (--this.stepsToBrain <= 0) {
      this.stepsToBrain = TUNING.ai.brainInterval;
      const loose = sim.possession.owner === null;
      const path = loose ? this.ballPath(sim) : null;
      const elapsed = this.track ? (sim.tick - this.track.tick) * PHYSICS_STEP : 0;
      for (const brain of this.brains) brain.update(sim, path, elapsed);
    }
    for (const p of sim.players) this.set(sim, p, this.assign(sim, p));
  }

  command(sim: Sim, p: Player): Command {
    const state = this.states[p.id];
    if (!state) return IDLE;
    if (state.kind === 'dribble') return dribble(sim, p, state, (sim.tick - this.since[p.id]) * PHYSICS_STEP, this.rng);
    if (state.kind === 'takeRestart') return takeRestart(sim, p);
    return offBall(sim, p, state, this.planOf(p.team));
  }

  planOf(team: 0 | 1): TeamPlan {
    return this.brains[team].plan;
  }

  /** Where player `id`'s slot in the shifted formation is (as of the last brain update). */
  slotOf(id: number, team: 0 | 1): Vec2 | undefined {
    return this.planOf(team).slots.get(id);
  }

  /** The state `p` should be in now. */
  private assign(sim: Sim, p: Player): AiState {
    const owner = sim.possession.owner;
    const plan = this.planOf(p.team);
    if (p.id === sim.match.taker) return { kind: 'takeRestart' };
    if (p.id === owner) {
      const current = this.states[p.id];
      return current?.kind === 'dribble' ? current : { kind: 'dribble', plan: runPlan(this.rng) };
    }
    if (plan.chaser?.id === p.id && owner === null) {
      return plan.chaser.receiving ? { kind: 'receive', point: plan.chaser.point } : { kind: 'chase', point: plan.chaser.point };
    }
    if (p.spec.role === 'keeper') return { kind: 'keeper' };
    if (owner !== null && plan.presser === p.id) return { kind: 'press', carrier: owner };
    if (owner !== null && plan.cover === p.id) return { kind: 'cover' };
    const spot = owner !== null ? plan.supports.get(p.id) : undefined;
    if (spot) return plan.runner === p.id ? { kind: 'run', spot } : { kind: 'support', spot };
    const marked = plan.marks.get(p.id);
    if (marked !== undefined) return { kind: 'mark', opponent: marked };
    return { kind: 'hold' };
  }

  /**
   * The loose ball's predicted path, re-predicted when the ball strays from the last
   * prediction (a bounce off a wall or a player, a new kick) or the prediction runs out.
   */
  private ballPath(sim: Sim): BallPath {
    const b = sim.ball.translation();
    const t = this.track;
    if (t) {
      const k = Math.round(((sim.tick - t.tick) * PHYSICS_STEP) / t.path.dt);
      const expected = t.path.points[k];
      if (expected && Math.hypot(expected.x - b.x, expected.y - b.y, expected.z - b.z) < TUNING.ai.pathTolerance) return t.path;
    }
    const path = predictPath(sim.ghost, b, sim.ball.linvel(), sim.ball.angvel());
    this.track = { path, tick: sim.tick };
    return path;
  }

  private set(sim: Sim, p: Player, state: AiState): void {
    // A new kind of state restarts its clock; the same kind just takes the new details.
    if (this.states[p.id]?.kind !== state.kind) this.since[p.id] = sim.tick;
    this.states[p.id] = state;
  }
}
