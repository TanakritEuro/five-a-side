import type RAPIER from '@dimforge/rapier3d-compat';
import { HALF_LENGTH, HALF_WIDTH, PLAYER_HEIGHT, PLAYER_RADIUS } from '../constants';
import { clamp, headingVec, type Vec2 } from '../math';
import { KeeperBody } from '../keeper/body';
import { createKeeperRigidBody, createPlayerBody, type Physics } from '../physics';
import type { Role, Slot } from '../team/formation';
import type { MoveState } from './locomotion';
import type { TackleState } from './tackle';

/** Ratings from 0 to 1; 0.5 is average. They scale the matching `TUNING` values. */
export interface Attributes {
  pace: number;
  passing: number;
  shooting: number;
  tackling: number;
  keeping: number;
  /** Holding off a challenge: shoulder to shoulder, and keeping the ball in a tackle. */
  strength: number;
}

export const AVERAGE: Readonly<Attributes> = Object.freeze({
  pace: 0.5,
  passing: 0.5,
  shooting: 0.5,
  tackling: 0.5,
  keeping: 0.5,
  strength: 0.5,
});

/** Who a player is and where they line up. */
export interface PlayerSpec {
  team: 0 | 1;
  role: Role;
  /** Formation slot, in the team's own frame. */
  slot: Slot;
  /** First-half kick-off position and facing (radians, 0 = +X); mirrored in the second half. */
  kickoff: Vec2;
  kickoffFacing: number;
  attrs?: Attributes;
}

export type KickKind = 'pass' | 'shoot' | 'lob';

/** A kick button being held down: power builds with `steps`. */
export interface Charge {
  kind: KickKind;
  steps: number;
}

/** A kick that was released but not yet taken (the ball wasn't in reach); expires. */
export interface PendingKick {
  kind: KickKind;
  power: number;
  stepsLeft: number;
}

export interface Player extends MoveState {
  readonly id: number;
  readonly spec: PlayerSpec;
  readonly team: 0 | 1;
  readonly attrs: Attributes;
  readonly body: RAPIER.RigidBody;
  /** Feet position on the ground. */
  pos: Vec2;
  /** Ground velocity (m/s), derived from speed and facing each step. */
  vel: Vec2;
  charge: Charge | null;
  pendingKick: PendingKick | null;
  /** Seconds before this player may touch the ball again (after a touch or a kick). */
  touchCooldown: number;
  /** A keeper's arms and dive; null for outfield players. */
  readonly keeper: KeeperBody | null;
  /** Kick buttons held last step, for press/release detection. */
  held: Record<KickKind, boolean>;
  /** A tackle in progress (lunging or recovering), or null. */
  tackle: TackleState | null;
  /** The tackle button was held last step. */
  tackleHeld: boolean;
}

export function createPlayer(physics: Physics, id: number, spec: PlayerSpec): Player {
  const { x, z } = spec.kickoff;
  const isKeeper = spec.role === 'keeper';
  const body = isKeeper ? createKeeperRigidBody(physics, x, z) : createPlayerBody(physics, id, x, z);
  const keeper = isKeeper ? new KeeperBody(physics, body, id) : null;
  keeper?.reset(z);
  keeper?.apply(x, true);
  return {
    id,
    spec,
    team: spec.team,
    attrs: spec.attrs ?? { ...AVERAGE },
    body,
    keeper,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    speed: 0,
    facing: spec.kickoffFacing,
    stamina: 1,
    sprinting: false,
    charge: null,
    pendingKick: null,
    touchCooldown: 0,
    held: { pass: false, shoot: false, lob: false },
    tackle: null,
    tackleHeld: false,
  };
}

/** Move the player along their velocity for `dt`, kept inside the boards. Call `syncBody` after. */
export function integratePlayer(p: Player, dt: number): void {
  const d = headingVec(p.facing);
  p.vel.x = d.x * p.speed;
  p.vel.z = d.z * p.speed;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  const x = clamp(p.pos.x + p.vel.x * dt, -maxX, maxX);
  const z = clamp(p.pos.z + p.vel.z * dt, -maxZ, maxZ);
  // Running into the boards stops you in that direction (you slide along them).
  if (x !== p.pos.x + p.vel.x * dt) p.vel.x = 0;
  if (z !== p.pos.z + p.vel.z * dt) p.vel.z = 0;
  p.pos.x = x;
  p.pos.z = z;
}

/** Move the player's body to where the player is now (after movement and separation). */
export function syncBody(p: Player): void {
  if (p.keeper) p.keeper.apply(p.pos.x, false);
  else p.body.setNextKinematicTranslation({ x: p.pos.x, y: PLAYER_HEIGHT / 2, z: p.pos.z });
}

/** Teleport a player (kick-off, restarts), standing still. */
export function placePlayer(p: Player, pos: Vec2, facing: number): void {
  p.pos.x = pos.x;
  p.pos.z = pos.z;
  p.vel.x = 0;
  p.vel.z = 0;
  p.speed = 0;
  p.facing = facing;
  p.charge = null;
  p.pendingKick = null;
  p.tackle = null;
  if (p.keeper) {
    p.keeper.reset(pos.z);
    p.keeper.apply(pos.x, true);
  } else {
    p.body.setTranslation({ x: pos.x, y: PLAYER_HEIGHT / 2, z: pos.z }, true);
  }
}

/** Move the player's body straight to where they are (after restart positioning), no sweep. */
export function teleportBody(p: Player): void {
  if (p.keeper) {
    p.keeper.reset(p.pos.z);
    p.keeper.apply(p.pos.x, true);
  } else {
    p.body.setTranslation({ x: p.pos.x, y: PLAYER_HEIGHT / 2, z: p.pos.z }, true);
  }
}
