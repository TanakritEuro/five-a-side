import type { BallPath } from '../ball/trajectory';
import { TUNING, type KeeperLevel } from '../config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, PHYSICS_STEP } from '../constants';
import { clamp, gaussian, type Rng, type Vec3 } from '../math';
import { IDLE, type Command } from '../sim/command';
import { diveDuration } from '../keeper/body';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { arrivalSpeed } from '../sim/kick';
import { DEG } from './geometry';
import { facing } from './intercept';
import { launchSpeedFor, passSafety } from './passing';
import type { AiState } from './states';
import { seek } from './steering';

/** A shot on its way: where it crosses the keeper's line (across = world Z, height) and when. */
export interface IncomingShot {
  across: number;
  height: number;
  /** Seconds from now. */
  t: number;
}

/**
 * Is the ball (following `path`, `elapsed` seconds in) on its way into or near the goal
 * `keeper` defends, soon? If so, where it crosses the keeper's own line (they may be
 * standing off their goal line) and when. Null otherwise.
 */
export function incomingShot(sim: Sim, keeper: Player, path: BallPath, elapsed: number): IncomingShot | null {
  const K = TUNING.keeper;
  const side = -sim.attackDir(keeper.team); // the goal they defend is at x = side · HALF_LENGTH
  const first = Math.max(1, Math.ceil(elapsed / path.dt));
  let atKeeper: IncomingShot | null = null;
  for (let k = first; k < path.points.length; k++) {
    const t = k * path.dt - elapsed;
    if (t > K.shotHorizon) return null;
    const a = path.points[k - 1];
    const b = path.points[k];
    const keeperPlane = keeper.pos.x * side;
    if (!atKeeper && a.x * side < keeperPlane && b.x * side >= keeperPlane) {
      const c = cross(a, b, keeper.pos.x);
      atKeeper = { across: c.z, height: Math.max(c.y, BALL_RADIUS), t: t - path.dt * (1 - c.f) };
    }
    if (a.x * side < HALF_LENGTH && b.x * side >= HALF_LENGTH) {
      // It reaches the goal line: a shot if it's on target (or near enough to worry about).
      const c = cross(a, b, side * HALF_LENGTH);
      const onFrame = Math.abs(c.z) < GOAL_WIDTH / 2 + K.frameMargin && c.y < GOAL_HEIGHT + K.frameMargin;
      return onFrame ? (atKeeper ?? { across: c.z, height: Math.max(c.y, BALL_RADIUS), t }) : null;
    }
  }
  return null;
}

/** Where the segment a→b crosses the plane x = `x`, and how far along it (0–1). */
function cross(a: Vec3, b: Vec3, x: number): { y: number; z: number; f: number } {
  const f = (x - a.x) / (b.x - a.x);
  return { y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, f };
}

export interface DivePlan {
  across: number;
  height: number;
  /** Seconds to wait before diving. */
  delay: number;
  /** True if the keeper read the shot, false if they guessed. */
  read: boolean;
}

/**
 * Decide where to dive for an incoming shot (ported from the penalty game's `planDive`).
 * The keeper either reads it (and goes roughly the right way, timing the dive to meet
 * it) or commits to a guess. In open play they read it more often than at a penalty.
 */
export function planDive(shot: IncomingShot, level: KeeperLevel, rng: Rng, from: number): DivePlan {
  const K = TUNING.keeper;
  const read = rng() < level.readChance + K.openPlayRead;
  let across: number;
  let height: number;
  if (read) {
    across = shot.across + gaussian(rng) * level.readError;
    height = shot.height + gaussian(rng) * level.readError * 0.6;
  } else if (rng() < K.guessCentreChance) {
    across = 0;
    height = 0.3 + rng() * 1.9;
  } else {
    across = (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.9);
    height = 0.2 + rng() * 2.0;
  }
  return {
    // Never go for anything outside the frame.
    across: clamp(across, -GOAL_WIDTH / 2, GOAL_WIDTH / 2),
    height: clamp(height, 0.1, GOAL_HEIGHT),
    // A keeper who has read it times the dive to meet the ball; a guesser just goes.
    delay: read ? Math.max(level.reactionTime, shot.t - diveDuration(Math.abs(shot.across - from), level)) : level.reactionTime,
    read,
  };
}

/** The tick at which to dive, `plan.delay` after now. */
export function diveTick(sim: Sim, plan: DivePlan): number {
  return sim.tick + Math.round(plan.delay / PHYSICS_STEP);
}

/** A keeper waiting to dive, then diving: one command with `dive` set, at the planned tick. */
export function diveCommand(sim: Sim, state: Extract<AiState, { kind: 'dive' }>): Command {
  if (state.done || sim.tick < state.at) return IDLE;
  state.done = true;
  return { ...IDLE, dive: { across: state.across, height: state.height } };
}

/**
 * A keeper with the ball in their hands: hold it for `holdTime`, then turn to the
 * teammate it's safest to give it to (by `passSafety`) and press J to throw or roll it.
 * They wait for someone to be properly free; by the futsal limit they take the safest
 * option going.
 */
export function holdingCommand(sim: Sim, p: Player, state: Extract<AiState, { kind: 'holding' }>): Command {
  const K = TUNING.keeper;
  const held = sim.handling.heldFor;
  if (held < K.holdTime) return IDLE;
  if (state.to === null) {
    const best = safestTeammate(sim, p);
    if (!best || (best.safety < K.safeDistribution && held < K.maxHold)) return IDLE;
    // Commit to them: switching target as the safety numbers flicker, they'd never turn to anyone.
    state.to = best.player.id;
  }
  const to = sim.players[state.to];
  const s = seek(p, to.pos, false);
  const aimed = facing(p, to.pos, TUNING.ai.passAim * DEG);
  // Past the futsal limit, let it go however they're facing.
  const release = aimed || held > K.maxHold + 1;
  return { ...IDLE, move: { x: s.move.x * 0.3, z: s.move.z * 0.3 }, pass: release && sim.tick % 2 === 0 };
}

/**
 * The outfield teammate a ball from `p` reaches with the most margin over the opposition.
 * Anyone right up against the keeper is ignored: a throw goes over them.
 */
function safestTeammate(sim: Sim, p: Player): { player: Player; safety: number } | null {
  const opponents = sim.players.filter((o) => o.team !== p.team && Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > TUNING.keeper.throwOver);
  let best: { player: Player; safety: number } | null = null;
  for (const q of sim.players) {
    if (q.team !== p.team || q.id === p.id || q.spec.role === 'keeper') continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d < TUNING.pass.minDistance) continue;
    const safety = passSafety(p.pos, q.pos, launchSpeedFor(d, arrivalSpeed(d)), q, opponents);
    if (!best || safety > best.safety) best = { player: q, safety };
  }
  return best;
}
