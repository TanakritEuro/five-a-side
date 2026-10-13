import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import type { Snapshot } from '../sim/sim';

/** A stretch of play to show again: snapshots, one per step, in order. */
export interface Clip {
  frames: Snapshot[];
  /** Shown over the replay ("RIV 1–0 · Pivot, 2'"). */
  caption: string;
  /** The goal it ends in (x = end × HALF_LENGTH), for the replay camera; 0 if it isn't a goal. */
  end: 1 | -1 | 0;
}

interface Frame {
  snapshot: Snapshot;
  /** Which team had the ball after this step (null if loose). */
  owner: 0 | 1 | null;
}

/** A deep copy of a snapshot (the sim rewrites its own in place every step). */
export function copySnapshot(s: Snapshot): Snapshot {
  return {
    tick: s.tick,
    ball: { pos: { ...s.ball.pos }, rot: { ...s.ball.rot } },
    // Actions are replaced, never changed, so they can be shared.
    players: s.players.map((p) => ({ ...p })),
  };
}

/**
 * Records the last few seconds of play as snapshots, one per simulation step. Replays play
 * those back through the same interpolation and animation as live play, so a replay
 * looks exactly like the play did without re-running anything.
 */
export class Recorder {
  private frames: Frame[] = [];
  private readonly capacity = Math.round(TUNING.replay.keep / PHYSICS_STEP);

  /** Call after every simulation step with its snapshot and who has the ball. */
  capture(snapshot: Snapshot, owner: 0 | 1 | null): void {
    this.frames.push({ snapshot: copySnapshot(snapshot), owner });
    // Trim in batches rather than shifting one frame off every step.
    if (this.frames.length > this.capacity * 1.25) this.frames = this.frames.slice(-this.capacity);
  }

  /** Forget everything (a new match). */
  clear(): void {
    this.frames = [];
  }

  /** Seconds of play held (no more than `TUNING.replay.keep`). */
  get length(): number {
    return Math.min(this.frames.length, this.capacity) * PHYSICS_STEP;
  }

  /** The last `seconds` of play. */
  last(seconds: number, caption = ''): Clip | null {
    const n = Math.round(seconds / PHYSICS_STEP);
    const frames = this.frames.slice(-Math.min(n, this.capacity)).map((f) => f.snapshot);
    return frames.length >= 2 ? { frames, caption, end: 0 } : null;
  }

  /**
   * The move that led to a goal scored by `team` in the goal at `end`, which went in on
   * the step whose snapshot has tick `goalTick`: from just before the scoring team last won
   * the ball (between `minLength` and `maxLength` seconds before the goal) to `after`
   * seconds after it, or as much of that as has been recorded.
   */
  goal(goalTick: number, team: 0 | 1, end: 1 | -1, caption: string): Clip | null {
    const R = TUNING.replay;
    const frames = this.frames.slice(-this.capacity);
    const g = frames.findIndex((f) => f.snapshot.tick === goalTick);
    if (g < 0) return null;
    const step = (s: number) => Math.round(s / PHYSICS_STEP);
    // The last moment the other team had it.
    let lost = -1;
    for (let i = g; i >= 0; i--) {
      if (frames[i].owner !== null && frames[i].owner !== team) {
        lost = i;
        break;
      }
    }
    const earliest = Math.max(0, g - step(R.maxLength));
    const latest = Math.max(0, g - step(R.minLength));
    const start = Math.min(latest, Math.max(earliest, lost < 0 ? earliest : lost - step(R.lead)));
    const stop = Math.min(frames.length, g + 1 + step(R.after));
    return { frames: frames.slice(start, stop).map((f) => f.snapshot), caption, end };
  }
}
