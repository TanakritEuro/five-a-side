import { TUNING } from '../config';
import { PHYSICS_STEP } from '../constants';
import type { Snapshot } from '../sim/sim';

/** A stretch of play to show again: snapshots in order of their ticks (every step, or every other one online). */
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
 * Records the last few seconds of play as snapshots: every simulation step on the host,
 * every one that arrives on an online guest. Times come from the snapshots' ticks, not
 * from how many there are. Replays play them back through the same interpolation and
 * animation as live play, so a replay looks exactly like the play did without re-running
 * anything.
 */
export class Recorder {
  private frames: Frame[] = [];
  /** Most snapshots kept: one every step for `keep` seconds (fewer arrive online). */
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
    const kept = this.kept();
    return kept.length < 2 ? 0 : (kept[kept.length - 1].snapshot.tick - kept[0].snapshot.tick) * PHYSICS_STEP;
  }

  /** The last `seconds` of play. */
  last(seconds: number, caption = ''): Clip | null {
    const kept = this.kept();
    if (kept.length < 2) return null;
    const from = kept[kept.length - 1].snapshot.tick - seconds / PHYSICS_STEP;
    const frames = kept.filter((f) => f.snapshot.tick > from).map((f) => f.snapshot);
    return frames.length >= 2 ? { frames, caption, end: 0 } : null;
  }

  /** What's held: no more than `keep` seconds back from the newest. */
  private kept(): Frame[] {
    const last = this.frames[this.frames.length - 1];
    if (!last) return [];
    const oldest = last.snapshot.tick - TUNING.replay.keep / PHYSICS_STEP;
    return this.frames.filter((f) => f.snapshot.tick >= oldest);
  }

  /**
   * The move that led to a goal scored by `team` in the goal at `end`, which went in on
   * the step whose snapshot has tick `goalTick`: from just before the scoring team last won
   * the ball (between `minLength` and `maxLength` seconds before the goal) to `after`
   * seconds after it, or as much of that as has been recorded.
   */
  goal(goalTick: number, team: 0 | 1, end: 1 | -1, caption: string): Clip | null {
    const R = TUNING.replay;
    const frames = this.kept();
    const g = frames.findIndex((f) => f.snapshot.tick >= goalTick);
    if (g < 0) return null;
    const ticks = (s: number) => s / PHYSICS_STEP;
    // The last moment the other team had it.
    let lostTick = -Infinity;
    for (let i = g; i >= 0; i--) {
      if (frames[i].owner !== null && frames[i].owner !== team) {
        lostTick = frames[i].snapshot.tick;
        break;
      }
    }
    const earliest = goalTick - ticks(R.maxLength);
    const latest = goalTick - ticks(R.minLength);
    const startTick = Math.min(latest, Math.max(earliest, lostTick - ticks(R.lead)));
    const stopTick = goalTick + ticks(R.after);
    const clip = frames.filter((f) => f.snapshot.tick >= startTick && f.snapshot.tick <= stopTick).map((f) => f.snapshot);
    return clip.length >= 2 ? { frames: clip, caption, end } : null;
  }
}
