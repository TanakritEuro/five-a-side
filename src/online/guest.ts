import { PHYSICS_STEP } from '../constants';
import type { Command } from '../sim/command';
import type { SimEvent } from '../sim/events';
import type { Link } from './link';
import { parseHostMessage, PROTOCOL, type GuestMessage } from './protocol';
import { unpackFrame, type WireFrame } from './snapshots';

/** The guest draws this many steps behind the newest frame, to ride out jitter. */
const DELAY_STEPS = 6;
/** Send the controls at least this often (ms), even unchanged, in case a message was lost. */
const INPUT_REFRESH = 100;

export interface GuestEvents {
  onWelcome: (home: string, away: string, halfLength: number) => void;
  onEvents: (events: SimEvent[]) => void;
  onReplay: (tick: number, team: 0 | 1, end: 1 | -1, caption: string) => void;
  onReplayStop: () => void;
  onPaused: (paused: boolean) => void;
  /** The host left, refused us, or the link failed. */
  onClose: (reason: string) => void;
}

/** What to draw now: between two frames, `alpha` of the way. */
export interface GuestView {
  prev: WireFrame;
  curr: WireFrame;
  alpha: number;
}

/**
 * The guest's end of an online match. It has no simulation: it sends its controls and
 * keeps the frames the host sends, drawing a few steps behind the newest so a late frame
 * doesn't make it stutter. Its clock runs at real speed and eases towards that target, so
 * playback stays smooth when frames arrive unevenly.
 */
export class GuestSession {
  private frames: WireFrame[] = [];
  /** The tick being drawn (fractional). */
  private tick: number | null = null;
  private lastInput = '';
  private lastSent = 0;
  /** The newest frame (for the HUD), and every frame as it arrives (for the replays' recorder). */
  latest: WireFrame | null = null;
  onFrame: (f: WireFrame) => void = () => {};

  constructor(
    private readonly link: Link,
    team: string,
    private readonly events: GuestEvents,
  ) {
    link.onMessage = (raw) => this.receive(raw);
    link.onClose = (reason) => this.events.onClose(reason);
    this.send({ type: 'hello', version: PROTOCOL, team });
  }

  /** Send the controls if they've changed (or it's been a while). `now` is in ms. */
  input(command: Command, now: number): void {
    const key = JSON.stringify(command);
    if (key === this.lastInput && now - this.lastSent < INPUT_REFRESH) return;
    this.lastInput = key;
    this.lastSent = now;
    this.send({ type: 'input', command });
  }

  skip(): void {
    this.send({ type: 'skip' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  leave(): void {
    this.link.close();
  }

  /**
   * Move the clock on by `dt` real seconds (0 while paused) and say what to draw: null until
   * two frames have arrived.
   */
  view(dt: number): GuestView | null {
    const frames = this.frames;
    if (frames.length < 2) return null;
    const newest = frames[frames.length - 1].snapshot.tick;
    const target = newest - DELAY_STEPS;
    if (this.tick === null || Math.abs(this.tick - target) > 30) this.tick = target;
    // Real time, nudged a tenth of the way towards the target each frame.
    this.tick += dt / PHYSICS_STEP;
    this.tick += (target - this.tick) * Math.min(1, dt * 6);
    let i = frames.findIndex((f) => f.snapshot.tick > this.tick!);
    if (i <= 0) i = i === 0 ? 1 : frames.length - 1;
    const prev = frames[i - 1];
    const curr = frames[i];
    const span = curr.snapshot.tick - prev.snapshot.tick;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (this.tick - prev.snapshot.tick) / span)) : 1;
    // Frames well behind the clock are no longer needed.
    if (i > 4) this.frames = frames.slice(i - 2);
    return { prev, curr, alpha };
  }

  private send(m: GuestMessage): void {
    this.link.send(m);
  }

  private receive(raw: unknown): void {
    const m = parseHostMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'welcome':
        return this.events.onWelcome(m.home, m.away, m.halfLength);
      case 'reject':
      case 'bye':
        this.link.close();
        return this.events.onClose(m.reason);
      case 'frame': {
        const f = unpackFrame(new Float32Array(m.data));
        if (!f) return;
        // Frames can arrive out of order (that channel doesn't wait): keep them sorted, no repeats.
        const tick = f.snapshot.tick;
        if (this.latest && tick <= this.latest.snapshot.tick) {
          if (!this.frames.some((g) => g.snapshot.tick === tick)) {
            this.frames.push(f);
            this.frames.sort((a, b) => a.snapshot.tick - b.snapshot.tick);
          }
          return;
        }
        this.frames.push(f);
        this.latest = f;
        this.onFrame(f);
        return;
      }
      case 'events':
        return this.events.onEvents(m.events);
      case 'replay':
        return this.events.onReplay(m.tick, m.team, m.end, m.caption);
      case 'replayStop':
        return this.events.onReplayStop();
      case 'paused':
        return this.events.onPaused(m.paused);
    }
  }
}
