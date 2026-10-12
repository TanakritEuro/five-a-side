// The keeper's body and dive, ported from ../penalty-shootout/src/keeper/keeper.ts. There
// the keeper stood on a goal line along X; here goal lines run along Z, so the body is
// turned a quarter turn: the pose's "across" axis is world Z and the lean is about X.
// The AI decides when and where to dive (ai/keeper.ts); this only carries it out.
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING, type KeeperLevel } from '../config';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_RADIUS,
  KEEPER_SHOULDER_HALF_WIDTH,
  KEEPER_SHOULDER_HEIGHT,
} from '../constants';
import type { Quat } from '../math';
import type { Physics } from '../physics';
import { diveTargetPose, landedPose, lerpPose, standingPose, type KeeperPose } from './pose';

const RISE_TIME = 0.3;

type DiveState =
  | { kind: 'ready' }
  | { kind: 'diving'; from: KeeperPose; to: KeeperPose; duration: number; elapsed: number }
  | { kind: 'landing'; from: KeeperPose; to: KeeperPose; elapsed: number }
  | { kind: 'down'; elapsed: number }
  | { kind: 'rising'; from: KeeperPose; elapsed: number };

export type KeeperPhase = DiveState['kind'];

/**
 * A keeper's colliders (a torso and two arms on the player's kinematic body) and their
 * pose. Standing, the keeper is an ordinary player who happens to have arms; diving, the
 * pose takes over from the locomotion model until they're back on their feet.
 */
export class KeeperBody {
  pose: KeeperPose = standingPose();
  private state: DiveState = { kind: 'ready' };
  private readonly arms: RAPIER.Collider[] = [];

  constructor(physics: Physics, readonly body: RAPIER.RigidBody, id: number) {
    // Gloves and body absorb some of the ball's pace: saves are parries, not trampolines.
    const surface = (desc: RAPIER.ColliderDesc) => desc.setRestitution(0.3).setFriction(0.6);
    const register = (c: RAPIER.Collider) => {
      physics.tags.set(c.handle, 'player');
      physics.playerColliders.set(c.handle, id);
      physics.keeperColliders.add(c.handle);
    };
    register(
      physics.world.createCollider(
        surface(RAPIER.ColliderDesc.capsule(KEEPER_HEIGHT / 2 - KEEPER_RADIUS, KEEPER_RADIUS)).setTranslation(0, KEEPER_HEIGHT / 2, 0),
        body,
      ),
    );
    for (let i = 0; i < 2; i++) {
      const arm = physics.world.createCollider(
        surface(RAPIER.ColliderDesc.capsule(KEEPER_ARM_LENGTH / 2 - KEEPER_HAND_RADIUS, KEEPER_HAND_RADIUS)),
        body,
      );
      register(arm);
      this.arms.push(arm);
    }
  }

  get phase(): KeeperPhase {
    return this.state.kind;
  }

  /** Diving, on the ground or getting up: the locomotion model is switched off. */
  get busy(): boolean {
    return this.state.kind !== 'ready';
  }

  /** Dive (or step, or jump, if it's close) towards the point `across` (world Z) and `height` up, on their line. */
  dive(across: number, height: number, level: KeeperLevel): void {
    if (this.state.kind !== 'ready') return;
    const to = diveTargetPose(this.pose, across, height, level.maxDive);
    this.state = { kind: 'diving', from: this.pose, to, duration: level.diveTime, elapsed: 0 };
  }

  /** Back on their feet at once (restarts). */
  reset(across: number): void {
    this.state = { kind: 'ready' };
    this.pose = standingPose(across);
  }

  /**
   * Advance the pose. Standing, it follows where the locomotion model put the player
   * (`across` = their z). Returns where the dive has carried their feet across the goal,
   * for the player to follow while busy.
   */
  step(dt: number, across: number): number {
    const K = TUNING.keeper;
    const s = this.state;
    switch (s.kind) {
      case 'ready':
        this.pose = standingPose(across);
        break;
      case 'diving': {
        s.elapsed += dt;
        const t = Math.min(1, s.elapsed / s.duration);
        const eased = 1 - (1 - t) * (1 - t); // explosive launch, slowing at full stretch
        const fast = 1 - (1 - t) ** 4; // the body tips and the arms go up before it travels
        this.pose = lerpPose(s.from, s.to, eased);
        this.pose.lean = s.from.lean + (s.to.lean - s.from.lean) * fast;
        this.pose.arms = s.from.arms + (s.to.arms - s.from.arms) * Math.min(1, fast * 1.5);
        if (t >= 1) this.state = { kind: 'landing', from: this.pose, to: landedPose(this.pose), elapsed: 0 };
        break;
      }
      case 'landing': {
        s.elapsed += dt;
        const t = Math.min(1, s.elapsed / K.landTime);
        this.pose = lerpPose(s.from, s.to, t * t); // falling: accelerate into the ground
        if (t >= 1) this.state = { kind: 'down', elapsed: 0 };
        break;
      }
      case 'down':
        s.elapsed += dt;
        if (s.elapsed >= K.downTime) this.state = { kind: 'rising', from: this.pose, elapsed: 0 };
        break;
      case 'rising': {
        s.elapsed += dt;
        const t = Math.min(1, s.elapsed / RISE_TIME);
        this.pose = lerpPose(s.from, standingPose(s.from.x), t);
        if (t >= 1) this.state = { kind: 'ready' };
        break;
      }
    }
    return this.pose.x;
  }

  /** Put the colliders where the pose says, the keeper standing `depth` along X (their x). */
  apply(depth: number, teleport: boolean): void {
    const p = this.pose;
    const position = { x: depth, y: p.y, z: p.x };
    const rotation = bodyRotation(p.lean);
    if (teleport) {
      this.body.setTranslation(position, true);
      this.body.setRotation(rotation, true);
    } else {
      // Kinematic moves give the body a velocity, so a diving keeper pushes the ball.
      this.body.setNextKinematicTranslation(position);
      this.body.setNextKinematicRotation(rotation);
    }
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const a = armLocal(side, p.arms);
      arm.setTranslationWrtParent({ x: a.x, y: a.y, z: 0 });
      arm.setRotationWrtParent(leanQuat(side * p.arms));
    });
  }
}

/** Centre of an arm in the body's local frame, for arm angle `angle` on `side` (−1 left, +1 right). */
export function armLocal(side: number, angle: number): { x: number; y: number } {
  return {
    x: side * (KEEPER_SHOULDER_HALF_WIDTH + Math.sin(angle) * (KEEPER_ARM_LENGTH / 2)),
    y: KEEPER_SHOULDER_HEIGHT + Math.cos(angle) * (KEEPER_ARM_LENGTH / 2),
  };
}

/** Rotation about the body's local Z by -angle (lean +θ tips the head towards local +X). */
export function leanQuat(angle: number): Quat {
  return { x: 0, y: 0, z: Math.sin(-angle / 2), w: Math.cos(-angle / 2) };
}

/**
 * The keeper body's rotation: a quarter turn about Y (so local X, across the goal in the
 * pose, lies along world Z), then the lean.
 */
export function bodyRotation(lean: number): Quat {
  const s = Math.SQRT1_2;
  const yaw = { x: 0, y: -s, z: 0, w: s };
  return multiply(yaw, leanQuat(lean));
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
