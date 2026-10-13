import type { SimEvent } from '../sim/events';
import { IDLE, type Command } from '../sim/command';

/**
 * Messages between the two devices in an online match. The host runs the match and is the
 * home team; the guest plays the away team, sends its inputs, and is sent what to show.
 *
 * Bump `PROTOCOL` whenever a message changes, so mismatched versions refuse to play
 * rather than misbehave.
 */
export const PROTOCOL = 1;

export type GuestMessage =
  | { type: 'hello'; version: number; team: string }
  /** The guest's controls now: the same command its keyboard, pad or touch makes. */
  | { type: 'input'; command: Command }
  | { type: 'skip' }
  | { type: 'pause' }
  | { type: 'resume' };

export type HostMessage =
  | { type: 'welcome'; home: string; away: string; halfLength: number }
  | { type: 'reject'; reason: string }
  /** A packed `WireFrame` (snapshots.ts). */
  | { type: 'frame'; data: ArrayBuffer }
  /** One step's events. Kick paths are cut to their first point. */
  | { type: 'events'; events: SimEvent[] }
  /** Show this goal's replay (its tick and team in the snapshots), or stop showing one. */
  | { type: 'replay'; tick: number; team: 0 | 1; end: 1 | -1; caption: string }
  | { type: 'replayStop' }
  | { type: 'paused'; paused: boolean }
  /** The match is over and the host has left it. */
  | { type: 'bye'; reason: string };

// What arrives over the network is only as good as the other device's code: check its
// shape before using it, and drop anything that doesn't fit.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTeam = (v: unknown): v is 0 | 1 => v === 0 || v === 1;
const isEnd = (v: unknown): v is 1 | -1 => v === 1 || v === -1;
const isPlayer = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 20;
const isString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** A command from the network, with every field checked and the move clamped to length 1 (or null). */
export function parseCommand(raw: unknown): Command | null {
  if (!isObject(raw) || !isObject(raw.move) || !isNumber(raw.move.x) || !isNumber(raw.move.z)) return null;
  const buttons = ['sprint', 'pass', 'shoot', 'lob', 'tackle', 'switch', 'press'] as const;
  if (!buttons.every((b) => isBool(raw[b]))) return null;
  const len = Math.hypot(raw.move.x, raw.move.z);
  const k = len > 1 ? 1 / len : 1;
  const command: Command = { ...IDLE, move: { x: raw.move.x * k, z: raw.move.z * k } };
  for (const b of buttons) command[b] = raw[b] as boolean;
  // A guest never drives a keeper's dive.
  command.dive = null;
  return command;
}

export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'hello':
      return isNumber(raw.version) && isString(raw.team, 8) ? { type: 'hello', version: raw.version, team: raw.team } : null;
    case 'input': {
      const command = parseCommand(raw.command);
      return command ? { type: 'input', command } : null;
    }
    case 'skip':
    case 'pause':
    case 'resume':
      return { type: raw.type };
    default:
      return null;
  }
}

/** Required fields for each event type the guest uses, and how to check them. */
const EVENT_FIELDS: Record<SimEvent['type'], Record<string, (v: unknown) => boolean>> = {
  touch: { player: isPlayer, kind: (v) => v === 'dribble' || v === 'receive' || v === 'deflect' },
  kick: { player: isPlayer, kind: (v) => v === 'pass' || v === 'shoot' || v === 'lob', power: isNumber, path: (v) => isObject(v) && Array.isArray(v.points) && v.points.length >= 1 && isObject(v.points[0]) && isNumber(v.points[0].y) },
  shot: { player: isPlayer, outcome: (v) => isObject(v) && isString(v.kind, 20) },
  woodwork: {},
  save: { player: isPlayer, caught: isBool },
  goal: { team: isTeam, end: isEnd, score: (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber), scorer: (v) => v === null || isPlayer(v) },
  out: { restart: isObject },
  restart: { restart: (v) => isObject(v) && isString(v.kind, 20), taker: (v) => v === null || isPlayer(v) },
  halfTime: { score: Array.isArray },
  fullTime: { score: Array.isArray },
  tackle: { player: isPlayer, outcome: (v) => v === 'won' || v === 'missed' || v === 'foul' },
  challenge: { carrier: isPlayer, challenger: isPlayer },
  foul: { player: isPlayer, against: isPlayer, restart: (v) => isObject(v) && isString(v.kind, 20) },
  shootoutStart: { score: Array.isArray },
  shootoutKick: { team: isTeam, scored: isBool, tally: (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber) },
};

export function parseEvent(raw: unknown): SimEvent | null {
  if (!isObject(raw) || typeof raw.type !== 'string' || !(raw.type in EVENT_FIELDS)) return null;
  const fields = EVENT_FIELDS[raw.type as SimEvent['type']];
  return Object.entries(fields).every(([k, ok]) => ok(raw[k])) ? (raw as unknown as SimEvent) : null;
}

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'welcome':
      return isString(raw.home, 8) && isString(raw.away, 8) && isNumber(raw.halfLength) && raw.halfLength > 0 && raw.halfLength <= 900
        ? { type: 'welcome', home: raw.home, away: raw.away, halfLength: raw.halfLength }
        : null;
    case 'reject':
    case 'bye':
      return isString(raw.reason) ? { type: raw.type, reason: raw.reason } : null;
    case 'frame':
      return raw.data instanceof ArrayBuffer ? { type: 'frame', data: raw.data } : null;
    case 'events': {
      if (!Array.isArray(raw.events) || raw.events.length > 100) return null;
      const events = raw.events.map(parseEvent);
      return events.every((e) => e !== null) ? { type: 'events', events: events as SimEvent[] } : null;
    }
    case 'replay':
      return isNumber(raw.tick) && isTeam(raw.team) && isEnd(raw.end) && isString(raw.caption)
        ? { type: 'replay', tick: raw.tick, team: raw.team, end: raw.end, caption: raw.caption }
        : null;
    case 'replayStop':
      return { type: 'replayStop' };
    case 'paused':
      return isBool(raw.paused) ? { type: 'paused', paused: raw.paused } : null;
    default:
      return null;
  }
}

/** An event made small enough to send: a kick keeps only the first point of its path. */
export function forWire(e: SimEvent): SimEvent {
  if (e.type !== 'kick') return e;
  return { ...e, path: { ...e.path, points: e.path.points.slice(0, 1) } };
}
