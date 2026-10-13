import type { ActionKind, Mood, Snapshot } from '../sim/sim';

/** One step as the guest needs it: what's on the pitch, plus the bits of the match its HUD shows. */
export interface WireFrame {
  snapshot: Snapshot;
  /** The team on the ball (for the guest's replays), or null if it's loose. */
  owner: 0 | 1 | null;
  /** The player the guest drives, and their stamina (0–1). */
  controlled: number | null;
  stamina: number;
  score: [number, number];
  half: 1 | 2;
  /** Game seconds left in the half. */
  clock: number;
  /** The shootout's tally, if there is one. */
  shootout: [number, number] | null;
}

const ACTIONS: readonly ActionKind[] = ['pass', 'shot', 'touch', 'receive', 'deflect', 'tackle', 'challenge', 'catch', 'parry', 'throw', 'roll'];
const MOODS: readonly Mood[] = [null, 'scorer', 'celebrate', 'dejected'];

/** Floats in the header, and per player. */
const HEADER = 17;
const PER_PLAYER = 13;

/**
 * Pack a frame into one Float32Array: the header (tick, ball, owner, the guest's player and
 * stamina, score, half, clock, shootout), then 13 numbers per player. Ticks are exact in a
 * float up to 2²⁴ steps (77 hours).
 */
export function packFrame(f: WireFrame): Float32Array {
  const s = f.snapshot;
  const n = s.players.length;
  const out = new Float32Array(HEADER + n * PER_PLAYER);
  const b = s.ball;
  out.set([
    s.tick,
    b.pos.x, b.pos.y, b.pos.z,
    b.rot.x, b.rot.y, b.rot.z, b.rot.w,
    f.owner ?? -1,
    f.controlled ?? -1,
    f.stamina,
    f.score[0], f.score[1],
    f.half,
    f.clock,
    f.shootout?.[0] ?? -1, f.shootout?.[1] ?? -1,
  ]);
  s.players.forEach((p, i) => {
    out.set(
      [
        p.x, p.z, p.facing, p.y, p.lean, p.arms, p.speed, p.charge, p.tackle,
        (p.sprinting ? 1 : 0) | (p.holding ? 2 : 0),
        p.action ? ACTIONS.indexOf(p.action.kind) : -1,
        p.action?.tick ?? 0,
        MOODS.indexOf(p.mood),
      ],
      HEADER + i * PER_PLAYER,
    );
  });
  return out;
}

/** Unpack a frame, or null if it isn't one (wrong length, a number out of range). */
export function unpackFrame(data: Float32Array): WireFrame | null {
  const n = (data.length - HEADER) / PER_PLAYER;
  if (!Number.isInteger(n) || n < 1 || n > 20 || !data.every(Number.isFinite)) return null;
  const int = (v: number, lo: number, hi: number) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const owner = int(data[8], -1, 1);
  const controlled = int(data[9], -1, n - 1);
  const half = int(data[13], 1, 2);
  if (owner === null || controlled === null || half === null) return null;
  const players: Snapshot['players'] = [];
  for (let i = 0; i < n; i++) {
    const k = HEADER + i * PER_PLAYER;
    const action = int(data[k + 10], -1, ACTIONS.length - 1);
    const mood = int(data[k + 12], 0, MOODS.length - 1);
    if (action === null || mood === null) return null;
    const flags = data[k + 9];
    players.push({
      x: data[k],
      z: data[k + 1],
      facing: data[k + 2],
      y: data[k + 3],
      lean: data[k + 4],
      arms: data[k + 5],
      speed: data[k + 6],
      charge: data[k + 7],
      tackle: data[k + 8],
      sprinting: (flags & 1) !== 0,
      holding: (flags & 2) !== 0,
      action: action < 0 ? null : { kind: ACTIONS[action], tick: data[k + 11] },
      mood: MOODS[mood],
    });
  }
  return {
    snapshot: {
      tick: data[0],
      ball: { pos: { x: data[1], y: data[2], z: data[3] }, rot: { x: data[4], y: data[5], z: data[6], w: data[7] } },
      players,
    },
    owner: owner < 0 ? null : (owner as 0 | 1),
    controlled: controlled < 0 ? null : controlled,
    stamina: data[10],
    score: [data[11], data[12]],
    half: half as 1 | 2,
    clock: data[14],
    shootout: data[15] < 0 ? null : [data[15], data[16]],
  };
}
