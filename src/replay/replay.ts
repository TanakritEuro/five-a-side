import { PHYSICS_STEP } from '../constants';
import type { Snapshot } from '../sim/sim';
import type { Clip } from './recorder';

/** What to draw this frame of a replay: between two recorded snapshots. */
export interface ReplayFrame {
  prev: Snapshot;
  curr: Snapshot;
  alpha: number;
  clip: Clip;
  /** The clip just started (cut the camera, reset the animation). */
  fresh: boolean;
}

/**
 * Plays clips back, one after another (a goal's replay, or the highlights). It only says
 * which recorded snapshots to draw; the game draws them exactly as it draws live play.
 */
export class Replay {
  private clips: Clip[] = [];
  private index = 0;
  /** Seconds into the current clip. */
  private time = 0;
  private speed = 1;
  private fresh = false;

  get active(): boolean {
    return this.index < this.clips.length;
  }

  /** The clip playing, and where it is in a reel ("2 / 3"). */
  get caption(): string {
    const clip = this.clips[this.index];
    if (!clip) return '';
    return this.clips.length > 1 ? `${this.index + 1} / ${this.clips.length} · ${clip.caption}` : clip.caption;
  }

  /** Play `clips` in order at `speed` (fraction of real time). */
  play(clips: Clip[], speed: number): void {
    this.clips = clips.filter((c) => c.frames.length >= 2);
    this.index = 0;
    this.time = 0;
    this.speed = speed;
    this.fresh = true;
  }

  /** Skip the rest. */
  stop(): void {
    this.clips = [];
    this.index = 0;
  }

  /**
   * Advance by `realDt` seconds and say what to draw, or null once everything has played.
   * Each clip holds its last frame for a moment before the next.
   */
  update(realDt: number): ReplayFrame | null {
    if (!this.active) return null;
    this.time += realDt * this.speed;
    let clip = this.clips[this.index];
    const length = (clip.frames.length - 1) * PHYSICS_STEP;
    if (this.time > length + 0.5) {
      this.index++;
      this.time = 0;
      this.fresh = true;
      if (!this.active) return null;
      clip = this.clips[this.index];
    }
    const t = Math.min(this.time, (clip.frames.length - 1) * PHYSICS_STEP) / PHYSICS_STEP;
    const i = Math.min(Math.floor(t), clip.frames.length - 2);
    const fresh = this.fresh;
    this.fresh = false;
    return { prev: clip.frames[i], curr: clip.frames[i + 1], alpha: Math.min(1, t - i), clip, fresh };
  }
}
