import { inGoal } from '../ball/outcome';
import { TUNING } from '../config';
import { HALF_LENGTH, PENALTY_SPOT_DISTANCE } from '../constants';
import type { Vec3 } from '../math';
import type { SimEvent } from './events';
import { outOfCage, restartAfterOut, type Restart, type RulesContext } from './rules';
import { Shootout } from './shootout';

/** Every kick of a shootout is taken at the goal at +X. */
export const SHOOTOUT_END: 1 | -1 = 1;

/** The match's state machine. */
export type Phase =
  /** Ball on the spot for a kick-off or set piece; waits for `taker` to kick it. */
  | { kind: 'restart'; restart: Restart; taker: number | null; elapsed: number }
  | { kind: 'playing' }
  /** The ball is in the net; kick-off after `goalDelay`. `scorer` is null for an own goal. */
  | { kind: 'goal'; team: 0 | 1; scorer: number | null; timer: number }
  /** The ball went over the netting; set piece after `outDelay`. */
  | { kind: 'out'; restart: Restart; timer: number }
  /** The referee has blown for a foul; free kick or penalty after `foulDelay`. */
  | { kind: 'foul'; restart: Restart; timer: number }
  | { kind: 'halfTime'; timer: number }
  /** Between shootout kicks (and before the first): the next kick is set up after `timer`. */
  | { kind: 'shootoutPause'; timer: number }
  | { kind: 'fullTime' };

export interface MatchOptions {
  /** Start with a kick-off, rather than straight into open play (most unit tests). */
  kickoff?: boolean;
  /** Game seconds per half (default `TUNING.match.halfLength`). */
  halfLength?: number;
  /** A draw at full time goes to a penalty shootout (a cup tie). */
  shootout?: boolean;
}

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
  readonly halfLength: number;
  private readonly shootoutAllowed: boolean;
  /** The shootout, once a drawn cup tie gets to one. */
  shootout: Shootout | null = null;
  /** The shootout kick being taken: the kicking team, and game seconds since it was struck (null before). */
  private kick: { team: 0 | 1; t: number | null } | null = null;

  constructor(options: MatchOptions = {}) {
    this.halfLength = options.halfLength ?? TUNING.match.halfLength;
    this.shootoutAllowed = options.shootout ?? false;
    this.phase = options.kickoff
      ? { kind: 'restart', restart: { kind: 'kickoff', at: { x: 0, z: 0 }, team: this.firstKickoff }, taker: null, elapsed: 0 }
      : { kind: 'playing' };
  }

  /**
   * Which way a team is attacking: +1 towards +X. The home team (0) attacks +X in the first
   * half. In a shootout the kicking team attacks the goal at `SHOOTOUT_END`.
   */
  attackDir(team: 0 | 1): 1 | -1 {
    if (this.kick) return team === this.kick.team ? SHOOTOUT_END : SHOOTOUT_END === 1 ? -1 : 1;
    const firstHalf = team === 0 ? 1 : -1;
    return this.clock.half === 1 ? firstHalf : firstHalf === 1 ? -1 : 1;
  }

  /** The team taking the shootout kick being set up or taken, if any. */
  get kicking(): 0 | 1 | null {
    return this.kick?.team ?? null;
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
    if (this.kick) this.kick.t = 0;
  }

  update(ball: Vec3, dt: number, ctx: RulesContext, events: SimEvent[]): MatchAction | null {
    const T = TUNING;
    const phase = this.phase;
    switch (phase.kind) {
      case 'playing': {
        if (this.kick) return this.followKick(ball, ctx, dt, events);
        this.clock.elapsed += dt;
        for (const end of [1, -1] as const) {
          if (!inGoal(ball, end)) continue;
          const team: 0 | 1 = this.attackDir(0) === end ? 0 : 1;
          this.score[team]++;
          const scorer = ctx.lastTouchTeam === team ? ctx.lastTouch : null;
          this.phase = { kind: 'goal', team, scorer, timer: T.match.goalDelay };
          events.push({ type: 'goal', team, end, score: [this.score[0], this.score[1]], scorer });
          return null;
        }
        if (outOfCage(ball)) {
          const restart = restartAfterOut(ball, ctx);
          this.phase = { kind: 'out', restart, timer: T.match.outDelay };
          events.push({ type: 'out', restart });
          return null;
        }
        if (this.clock.elapsed >= this.halfLength) return this.endHalf(events);
        return null;
      }
      case 'goal': {
        phase.timer -= dt;
        if (phase.timer > 0) return null;
        // The team that conceded kicks off.
        return this.restart({ kind: 'kickoff', at: { x: 0, z: 0 }, team: phase.team === 0 ? 1 : 0 });
      }
      case 'out':
      case 'foul': {
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
      case 'shootoutPause': {
        phase.timer -= dt;
        if (phase.timer > 0) return null;
        const s = this.shootout!;
        if (s.decided) {
          this.kick = null;
          this.phase = { kind: 'fullTime' };
          events.push({ type: 'fullTime', score: [this.score[0], this.score[1]], shootout: [s.goals[0], s.goals[1]] });
          return null;
        }
        // The next kick: the ball on the spot in front of the shootout goal.
        const team = s.next;
        this.kick = { team, t: null };
        return this.restart({ kind: 'shootout', at: { x: SHOOTOUT_END * (HALF_LENGTH - PENALTY_SPOT_DISTANCE), z: 0 }, team });
      }
      case 'fullTime':
        return null;
    }
  }

  /**
   * A shootout kick in flight: it's over when the ball is in the net (scored), or when it
   * stops heading for goal (saved, off the woodwork, caught), leaves the cage, or has had
   * `shootoutKickTime` seconds (missed). No rebounds.
   */
  private followKick(ball: Vec3, ctx: RulesContext, dt: number, events: SimEvent[]): MatchAction | null {
    const kick = this.kick!;
    if (kick.t === null) return null;
    kick.t += dt;
    const scored = inGoal(ball, SHOOTOUT_END);
    const towards = ctx.ballVel.x * SHOOTOUT_END;
    const missed = outOfCage(ball) || kick.t > TUNING.match.shootoutKickTime || (kick.t > 0.3 && towards < 0.5);
    if (!scored && !missed) return null;
    const s = this.shootout!;
    s.record(kick.team, scored);
    events.push({ type: 'shootoutKick', team: kick.team, scored, tally: [s.goals[0], s.goals[1]] });
    this.phase = { kind: 'shootoutPause', timer: TUNING.match.shootoutDelay };
    return null;
  }

  /** A foul in open play: stop the clock, and set up `restart` (free kick or penalty) after a moment. */
  foul(restart: Restart): void {
    if (this.phase.kind !== 'playing') return;
    this.phase = { kind: 'foul', restart, timer: TUNING.match.foulDelay };
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
    } else if (this.shootoutAllowed && score[0] === score[1]) {
      // A drawn cup tie: penalties.
      this.shootout = new Shootout(0, TUNING.match.shootoutRounds);
      this.phase = { kind: 'shootoutPause', timer: TUNING.match.shootoutDelay };
      events.push({ type: 'shootoutStart', score });
    } else {
      this.phase = { kind: 'fullTime' };
      events.push({ type: 'fullTime', score });
    }
    return null;
  }
}
