import { inGoal } from '../ball/outcome';
import { TUNING } from '../config';
import type { Vec3 } from '../math';
import type { SimEvent } from './events';
import { outOfCage, restartAfterOut, type Restart, type RulesContext } from './rules';

/** The match's state machine. */
export type Phase =
  /** Ball on the spot for a kick-off, kick-in or goal clearance; waits for `taker` to kick it. */
  | { kind: 'restart'; restart: Restart; taker: number | null; elapsed: number }
  | { kind: 'playing' }
  /** The ball is in the net; kick-off after `goalDelay`. */
  | { kind: 'goal'; team: 0 | 1; timer: number }
  /** The ball went over the netting; set piece after `outDelay`. */
  | { kind: 'out'; restart: Restart; timer: number }
  | { kind: 'halfTime'; timer: number }
  | { kind: 'fullTime' };

export interface Clock {
  half: 1 | 2;
  /** Game seconds played in this half. The clock only runs while the ball is in play. */
  elapsed: number;
}

/** What the simulation has to do after a match update. */
export type MatchAction =
  /** Place the ball for this restart, pick its taker and line players up. */
  | { kind: 'setRestart'; restart: Restart }
  /** Half time is over: swap ends (already reflected in `attackDir`), then kick off. */
  | { kind: 'secondHalf'; restart: Restart };

/**
 * The match: the score, the clock and halves, and every stoppage and restart. `update`
 * runs after each physics step and tells the simulation when to set up a restart.
 */
export class Match {
  phase: Phase;
  readonly clock: Clock = { half: 1, elapsed: 0 };
  readonly score: [number, number] = [0, 0];
  /** Who kicked off the first half; the other team kicks off the second. */
  private readonly firstKickoff: 0 | 1 = 0;

  /** `kickoff`: start with a kick-off, rather than straight into open play (the unit tests). */
  constructor(kickoff: boolean) {
    this.phase = kickoff
      ? { kind: 'restart', restart: { kind: 'kickoff', at: { x: 0, z: 0 }, team: this.firstKickoff }, taker: null, elapsed: 0 }
      : { kind: 'playing' };
  }

  /** Which way a team is attacking: +1 towards +X. The home team (0) attacks +X in the first half. */
  attackDir(team: 0 | 1): 1 | -1 {
    const firstHalf = team === 0 ? 1 : -1;
    return this.clock.half === 1 ? firstHalf : firstHalf === 1 ? -1 : 1;
  }

  /** The ball is live: anyone may play it. */
  get inPlay(): boolean {
    return this.phase.kind === 'playing';
  }

  /** The player who must take the restart being waited on, if any. */
  get taker(): number | null {
    return this.phase.kind === 'restart' ? this.phase.taker : null;
  }

  get over(): boolean {
    return this.phase.kind === 'fullTime';
  }

  /** The restart's taker has kicked the ball: it's live. */
  onTaken(): void {
    if (this.phase.kind === 'restart') this.phase = { kind: 'playing' };
  }

  update(ball: Vec3, dt: number, ctx: RulesContext, events: SimEvent[]): MatchAction | null {
    const T = TUNING;
    const phase = this.phase;
    switch (phase.kind) {
      case 'playing': {
        this.clock.elapsed += dt;
        for (const end of [1, -1] as const) {
          if (!inGoal(ball, end)) continue;
          const team: 0 | 1 = this.attackDir(0) === end ? 0 : 1;
          this.score[team]++;
          this.phase = { kind: 'goal', team, timer: T.match.goalDelay };
          events.push({ type: 'goal', team, end, score: [this.score[0], this.score[1]] });
          return null;
        }
        if (outOfCage(ball)) {
          const restart = restartAfterOut(ball, ctx);
          this.phase = { kind: 'out', restart, timer: T.match.outDelay };
          events.push({ type: 'out', restart });
          return null;
        }
        if (this.clock.elapsed >= T.match.halfLength) return this.endHalf(events);
        return null;
      }
      case 'goal': {
        phase.timer -= dt;
        if (phase.timer > 0) return null;
        // The team that conceded kicks off.
        return this.restart({ kind: 'kickoff', at: { x: 0, z: 0 }, team: phase.team === 0 ? 1 : 0 });
      }
      case 'out': {
        phase.timer -= dt;
        return phase.timer > 0 ? null : this.restart(phase.restart);
      }
      case 'restart': {
        phase.elapsed += dt;
        return null;
      }
      case 'halfTime': {
        phase.timer -= dt;
        if (phase.timer > 0) return null;
        this.clock.half = 2;
        this.clock.elapsed = 0;
        const team: 0 | 1 = this.firstKickoff === 0 ? 1 : 0;
        const restart: Restart = { kind: 'kickoff', at: { x: 0, z: 0 }, team };
        this.phase = { kind: 'restart', restart, taker: null, elapsed: 0 };
        return { kind: 'secondHalf', restart };
      }
      case 'fullTime':
        return null;
    }
  }

  /** Called by the simulation once it has placed the ball and picked the taker. */
  setTaker(taker: number | null): void {
    if (this.phase.kind !== 'restart') return;
    this.phase.taker = taker;
    // Nobody on that team to take it (a test with one side only): play on.
    if (taker === null) this.phase = { kind: 'playing' };
  }

  private restart(restart: Restart): MatchAction {
    this.phase = { kind: 'restart', restart, taker: null, elapsed: 0 };
    return { kind: 'setRestart', restart };
  }

  private endHalf(events: SimEvent[]): MatchAction | null {
    const score: [number, number] = [this.score[0], this.score[1]];
    if (this.clock.half === 1) {
      this.phase = { kind: 'halfTime', timer: TUNING.match.halfTimePause };
      events.push({ type: 'halfTime', score });
    } else {
      this.phase = { kind: 'fullTime' };
      events.push({ type: 'fullTime', score });
    }
    return null;
  }
}
