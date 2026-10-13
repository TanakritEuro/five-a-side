// Ported from ../penalty-shootout/src/online/link.ts (only the room prefix changed).
import Peer, { type DataConnection, type PeerError } from 'peerjs';

/**
 * A connection to the other device. `events` is reliable and ordered (inputs, HUD,
 * sounds); `frames` doesn't wait for order, since only the newest frame matters.
 */
export type Channel = 'events' | 'frames';

export interface Link {
  send(message: object, channel?: Channel): void;
  /** Everything the other device sends (heartbeats aside). */
  onMessage: (message: unknown) => void;
  /** The other device left or went quiet; `reason` says which, for the player. */
  onClose: (reason: string) => void;
  /** Hang up (without calling `onClose`). */
  close(): void;
}

/** Room ids on the PeerJS server: the prefix keeps them apart from other apps (and versions). */
const PREFIX = 'five-a-side-1-';
/** Room codes: no 0/O or 1/I, so they're easy to read out. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CONNECT_TIMEOUT = 15000;
/** Each side says something at least this often (ms)... */
const HEARTBEAT = 1000;
/** ...and gives up on the other after hearing nothing for this long. */
const SILENCE_LIMIT = 6000;

export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

/** Tidy up what a player typed: upper case, no spaces; null if it can't be a room code. */
export function cleanRoomCode(typed: string): string | null {
  const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** An open room, waiting for someone to join with its code. */
export interface Room {
  code: string;
  /** Resolves when a guest has connected. */
  guest: Promise<Link>;
  /** Stop waiting and close the room. */
  cancel(): void;
}

/** Open a room on the PeerJS server under a fresh code. */
export async function openRoom(): Promise<Room> {
  for (let attempt = 0; ; attempt++) {
    const code = newRoomCode();
    const peer = new Peer(PREFIX + code, { debug: 0 });
    try {
      await opened(peer);
    } catch (e) {
      peer.destroy();
      // Someone else has that code: try another.
      if ((e as PeerError<string>).type === 'unavailable-id' && attempt < 4) continue;
      throw new Error(explain(e));
    }
    let cancel = () => {};
    const guest = new Promise<Link>((resolve, reject) => {
      const pending = new Map<string, DataConnection>();
      let settled = false;
      peer.on('connection', (conn) => {
        // One opponent per room: anyone else is turned away.
        if (settled) {
          conn.on('open', () => conn.close());
          return;
        }
        conn.on('open', () => {
          pending.set(`${conn.peer}/${conn.label}`, conn);
          const events = pending.get(`${conn.peer}/events`);
          const frames = pending.get(`${conn.peer}/frames`);
          if (!events || !frames || settled) return;
          settled = true;
          resolve(new PeerLink(peer, events, frames));
        });
      });
      peer.on('error', (e) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error(explain(e)));
      });
      cancel = () => {
        if (!settled) {
          settled = true;
          reject(new Error('cancelled'));
        }
        peer.destroy();
      };
    });
    return { code, guest, cancel: () => cancel() };
  }
}

/** Join the room with this code. */
export async function joinRoom(code: string): Promise<Link> {
  const peer = new Peer({ debug: 0 });
  try {
    await opened(peer);
    const id = PREFIX + code;
    const events = peer.connect(id, { label: 'events', reliable: true });
    const frames = peer.connect(id, { label: 'frames', reliable: false });
    await Promise.race([
      Promise.all([connOpened(events), connOpened(frames)]),
      new Promise((_, reject) => peer.on('error', reject)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT)),
    ]);
    return new PeerLink(peer, events, frames);
  } catch (e) {
    peer.destroy();
    throw new Error(explain(e));
  }
}

function opened(peer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    peer.once('open', () => resolve());
    peer.once('error', reject);
    setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT);
  });
}

function connOpened(conn: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.once('open', () => resolve());
    conn.once('error', reject);
  });
}

/** A message for the player from whatever went wrong. */
function explain(e: unknown): string {
  const type = (e as PeerError<string> | undefined)?.type;
  if (type === 'peer-unavailable') return 'No room with that code. Check it and try again.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed')
    return "Couldn't reach the matchmaking server. Check your connection and try again.";
  if (type === 'browser-incompatible') return "This browser can't play online.";
  if ((e as Error | undefined)?.message === 'timeout') return "Couldn't connect in time. Try again, or try another network.";
  return "Couldn't connect. Try again.";
}

/** Two PeerJS data connections to one other device, with a heartbeat to notice it going quiet. */
class PeerLink implements Link {
  onMessage: (message: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private lastHeard = performance.now();
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    private readonly peer: Peer,
    private readonly events: DataConnection,
    private readonly frames: DataConnection,
  ) {
    for (const conn of [events, frames]) {
      conn.on('data', (data) => {
        this.lastHeard = performance.now();
        if (!(typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'heartbeat')) this.onMessage(data);
      });
      conn.on('close', () => this.end('Your opponent left the game.'));
      conn.on('error', () => this.end('The connection to your opponent failed.'));
    }
    this.timer = setInterval(() => {
      if (performance.now() - this.lastHeard > SILENCE_LIMIT) this.end('Lost touch with your opponent.');
      else this.send({ type: 'heartbeat' });
    }, HEARTBEAT);
  }

  send(message: object, channel: Channel = 'events'): void {
    if (this.closed) return;
    const conn = channel === 'frames' ? this.frames : this.events;
    if (conn.open) void conn.send(message);
  }

  close(): void {
    this.shutdown();
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.shutdown();
    this.onClose(reason);
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.events.close();
    this.frames.close();
    this.peer.destroy();
  }
}

