import type { Command } from '../sim/command';
import { IDLE } from '../sim/command';
import type { SimEvent } from '../sim/events';
import type { Link } from './link';
import { forWire, parseGuestMessage, PROTOCOL, type HostMessage } from './protocol';
import { packFrame, type WireFrame } from './snapshots';

/** How long (ms) the host waits for the guest's hello before giving up. */
const HELLO_TIMEOUT = 10000;

export interface HostEvents {
  /** The guest said hello with their team's short name: accept it (true), or refuse. */
  onHello: (team: string) => boolean;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  /** The guest left, or the link failed. */
  onClose: (reason: string) => void;
}

/**
 * The host's end of an online match: it runs the simulation (in the game) and this passes
 * the guest's controls in and what happened out. Frames go every other step (30 a
 * second) on the unordered channel; events, replays and pauses on the reliable one.
 */
export class HostSession {
  /** The guest's controls as last heard. */
  command: Command = IDLE;
  /** The guest has said hello and been welcomed. */
  ready = false;
  private steps = 0;
  private readonly helloTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly link: Link,
    private readonly events: HostEvents,
  ) {
    link.onMessage = (raw) => this.receive(raw);
    link.onClose = (reason) => this.events.onClose(reason);
    this.helloTimer = setTimeout(() => {
      if (!this.ready) this.leave("Your opponent's game didn't answer.");
    }, HELLO_TIMEOUT);
  }

  /** Welcome the guest: the teams and the half length. */
  welcome(home: string, away: string, halfLength: number): void {
    this.send({ type: 'welcome', home, away, halfLength });
  }

  /** After each simulation step: its events, and (every other step) the frame. */
  step(events: readonly SimEvent[], frame: () => WireFrame): void {
    if (!this.ready) return;
    if (events.length > 0) this.send({ type: 'events', events: events.map(forWire) });
    if (this.steps++ % 2 === 0) {
      const data = packFrame(frame());
      this.link.send({ type: 'frame', data: data.buffer as ArrayBuffer }, 'frames');
    }
  }

  replay(tick: number, team: 0 | 1, end: 1 | -1, caption: string): void {
    this.send({ type: 'replay', tick, team, end, caption });
  }

  replayStop(): void {
    this.send({ type: 'replayStop' });
  }

  paused(paused: boolean): void {
    this.send({ type: 'paused', paused });
  }

  /** Say goodbye and hang up. */
  leave(reason: string): void {
    clearTimeout(this.helloTimer);
    this.send({ type: 'bye', reason });
    this.hangUp();
  }

  /** Close the link once the last message has had time to get there (closing at once can drop it). */
  private hangUp(): void {
    setTimeout(() => this.link.close(), 500);
  }

  private send(m: HostMessage): void {
    this.link.send(m);
  }

  private receive(raw: unknown): void {
    const m = parseGuestMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'hello':
        if (this.ready) return;
        clearTimeout(this.helloTimer);
        if (m.version !== PROTOCOL) {
          this.send({ type: 'reject', reason: 'Your opponent is running a different version of the game. Reload both pages.' });
          this.hangUp();
          this.events.onClose('Your opponent is running a different version of the game.');
          return;
        }
        if (!this.events.onHello(m.team)) {
          this.send({ type: 'reject', reason: "That team can't play this match." });
          this.hangUp();
          return;
        }
        this.ready = true;
        return;
      case 'input':
        this.command = m.command;
        return;
      case 'skip':
        return this.events.onSkip();
      case 'pause':
        return this.events.onPause();
      case 'resume':
        return this.events.onResume();
    }
  }
}
