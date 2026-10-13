import type RAPIER from '@dimforge/rapier3d-compat';
import { rollingSpin } from '../ball/forces';
import { TUNING } from '../config';
import { attrScale, clamp, gaussian, headingVec, lerp, wrapAngle, type Rng, type Vec2, type Vec3 } from '../math';
import type { Command } from './command';
import type { SimEvent } from './events';
import type { Player } from './player';
import { ballRelative, type Possession } from './possession';

const DEG = Math.PI / 180;

/** A tackle in progress: the lunge along heading `dir` (resolved once, at `contactTime`), then recovery. */
export type TackleState = { kind: 'lunge'; dir: number; elapsed: number; resolved: boolean } | { kind: 'recover'; elapsed: number };

/** The event a resolved tackle reports. */
export type TackleEvent = Extract<SimEvent, { type: 'tackle' }>;

/** What came of a tackle. */
export type TackleOutcome = 'won' | 'missed' | 'foul';

/**
 * Start a tackle on a fresh press of the tackle button, if they're free to. The lunge
 * goes at the ball if it's close and roughly in front, otherwise straight ahead.
 */
export function startTackle(p: Player, cmd: Command, canTackle: boolean, ball: Vec3): void {
  const pressed = cmd.tackle && !p.tackleHeld;
  p.tackleHeld = cmd.tackle;
  if (!pressed || !canTackle || p.tackle) return;
  const T = TUNING.tackle;
  const rel = ballRelative(p, ball);
  const toBall = Math.atan2(ball.z - p.pos.z, ball.x - p.pos.x);
  const dir = rel.distance < T.aimRange && rel.cos >= Math.cos(T.aimCone * DEG) ? toBall : p.facing;
  p.tackle = { kind: 'lunge', dir: p.facing + wrapAngle(dir - p.facing), elapsed: 0, resolved: false };
}

/**
 * The move a tackler makes: committed to the lunge along the way they face, or slowed
 * while they recover. Others move as told.
 */
export function tackleMove(p: Player, cmd: Command): Command {
  const s = p.tackle;
  if (!s) return cmd;
  if (s.kind === 'lunge') {
    return { ...cmd, move: headingVec(s.dir), sprint: false };
  }
  const k = TUNING.tackle.recoverMove;
  return { ...cmd, move: { x: cmd.move.x * k, z: cmd.move.z * k }, sprint: false };
}

/**
 * Advance a tackle by `dt`. At the contact moment it's resolved:
 * - the ball within reach and in front: won with a chance that is best head-on and
 *   worst from behind, better with the ball away from the carrier's feet (between
 *   touches), and set by the tackler's `tackling` against the carrier's `strength` and
 *   control (`passing`). A won ball is poked loose to one side, and the carrier can't
 *   touch it for a moment;
 * - otherwise, with the carrier within reach: a foul with a chance rising from behind and
 *   at speed; or just a miss.
 * Returns the tackle event, at the moment it's resolved. Out of play (`live` false) a
 * tackle runs its course but meets nothing.
 */
export function stepTackle(
  p: Player,
  players: readonly Player[],
  ball: RAPIER.RigidBody,
  possession: Possession,
  rng: Rng,
  dt: number,
  live: boolean,
): TackleEvent | null {
  const T = TUNING.tackle;
  const s = p.tackle;
  if (!s) return null;
  s.elapsed += dt;
  if (s.kind === 'recover') {
    if (s.elapsed >= T.recovery) p.tackle = null;
    return null;
  }
  if (s.elapsed >= T.duration) {
    p.tackle = { kind: 'recover', elapsed: 0 };
    return null;
  }
  if (s.resolved || s.elapsed < T.contactTime) return null;
  s.resolved = true;
  if (!live) return null;

  const owner = possession.owner === null ? null : players[possession.owner];
  const carrier = owner && owner.team !== p.team ? owner : null;
  const b = ball.translation();
  const rel = ballRelative(p, b);
  const inReach = rel.distance <= T.reach && rel.cos >= Math.cos(T.cone * DEG) && b.y <= T.maxHeight;

  if (inReach) {
    const chance = carrier ? winChance(p, carrier, b) : T.looseBall;
    if (rng() < chance) {
      poke(p, ball, rng);
      possession.deflect(p.id);
      p.touchCooldown = T.afterWin;
      if (carrier) carrier.touchCooldown = T.beaten;
      return { type: 'tackle', player: p.id, carrier: carrier?.id ?? null, outcome: 'won' };
    }
  }
  if (carrier && Math.hypot(carrier.pos.x - p.pos.x, carrier.pos.z - p.pos.z) <= T.reach + T.bodyReach) {
    if (rng() < foulChance(p, carrier)) return { type: 'tackle', player: p.id, carrier: carrier.id, outcome: 'foul' };
  }
  return { type: 'tackle', player: p.id, carrier: carrier?.id ?? null, outcome: 'missed' };
}

/** How far round from the front of the carrier the tackler is: 1 head-on, 0 side-on, -1 from behind. */
export function approach(tackler: Player, carrier: Player): number {
  const f = headingVec(carrier.facing);
  const dx = tackler.pos.x - carrier.pos.x;
  const dz = tackler.pos.z - carrier.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return (dx * f.x + dz * f.z) / d;
}

/** The chance (0–1) that `tackler` wins the ball off `carrier`, the ball at `ball`. */
export function winChance(tackler: Player, carrier: Player, ball: Vec2): number {
  const T = TUNING.tackle;
  const angle = lerp(T.fromBehind, 1, (approach(tackler, carrier) + 1) / 2);
  // Between touches the ball is out in front of the carrier, and easier to get to.
  const gap = Math.hypot(ball.x - carrier.pos.x, ball.z - carrier.pos.z);
  const timing = clamp((gap - T.atFeet) / (T.offFeet - T.atFeet), T.tightTiming, 1);
  const ratings =
    attrScale(tackler.attrs.tackling, T.ratingSpread) /
    attrScale((carrier.attrs.strength + carrier.attrs.passing) / 2, T.ratingSpread);
  return clamp(T.base * angle * timing * ratings, T.minChance, T.maxChance);
}

/** The chance (0–1) that a tackle on `carrier` that missed the ball is a foul. */
export function foulChance(tackler: Player, carrier: Player): number {
  const T = TUNING.tackle;
  const behind = clamp(-approach(tackler, carrier), 0, 1);
  const speed = clamp(tackler.speed / TUNING.locomotion.sprintSpeed, 0, 1);
  return clamp(T.foulBase + T.foulBehind * behind + T.foulSpeed * speed, 0, 1);
}

/** Knock the ball loose: off to one side of the way the tackler faces. */
function poke(p: Player, ball: RAPIER.RigidBody, rng: Rng): void {
  const T = TUNING.tackle;
  const side = rng() < 0.5 ? -1 : 1;
  const d = headingVec(p.facing + side * (T.pokeAngle + gaussian(rng) * T.pokeSpread) * DEG);
  const speed = T.pokeSpeed * (0.7 + 0.6 * rng());
  ball.setLinvel({ x: d.x * speed, y: 0, z: d.z * speed }, true);
  ball.setAngvel(rollingSpin(d.x * speed, d.z * speed), true);
}
