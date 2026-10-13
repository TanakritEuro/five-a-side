import * as THREE from 'three';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_SHOULDER_HALF_WIDTH,
  KEEPER_SHOULDER_HEIGHT,
} from '../constants';
import type { PlayerView } from '../render/interpolate';
import type { Team } from '../team/teams';
import { Animator } from './animator';
import { cyclePose, gaitStyle, moving } from './poses';
import { blendPoses, DEFAULT_DIMS, Rig, type Kit, type Pose, type RigDims } from './rig';
import { SkinnedFigure, type ClipBlend, type FigureTemplate } from './skinned';

/** A drawn player: placed and posed each frame from their view of the simulation. */
export interface Figure {
  readonly object: THREE.Group;
  update(view: PlayerView, dt: number): void;
}

/** Skin tones, given out by player id (invented players, a mix of faces). */
const SKIN = [0xf1c7a5, 0xc68a62, 0x8d5a3b, 0xe2b08a, 0x5e3a26, 0xd9a47c, 0xa8704c, 0xf0c09a, 0x6f452d, 0xb98060];

/** The kit for player `id` of `team`. */
export function kitFor(team: Team, id: number, keeper: boolean): Kit {
  const skin = SKIN[id % SKIN.length];
  return keeper
    ? { shirt: team.keeperShirt, shorts: team.keeperShorts, socks: team.keeperSocks, boots: 0x111111, skin, hands: team.gloves, longSleeves: true }
    : { shirt: team.shirt, shorts: team.shorts, socks: team.socks, boots: 0x111111, skin, hands: skin, longSleeves: false };
}

/**
 * The rig (and the Quaternius figure it drives, when it loaded) inside a group that the
 * game places and turns. Our rig faces −z; a player with heading 0 faces +X, so the rig
 * sits a quarter turn round inside `object`, and `lean` (between the two) rolls it
 * sideways about the feet for a keeper's dive.
 */
abstract class RiggedFigure implements Figure {
  readonly object = new THREE.Group();
  protected readonly rig: Rig;
  protected readonly figure: SkinnedFigure | null;
  protected readonly lean = new THREE.Group();

  constructor(template: FigureTemplate | null, kit: Kit, dims: RigDims) {
    this.rig = new Rig(dims, kit);
    const turn = new THREE.Group();
    turn.rotation.y = -Math.PI / 2;
    turn.add(this.lean);
    this.lean.add(this.rig.root);
    this.object.add(turn);
    if (template) {
      this.figure = new SkinnedFigure(template, this.rig, dims.height);
      this.figure.setKit(kit);
      this.rig.setPartsVisible(false);
    } else {
      this.figure = null;
    }
  }

  abstract update(view: PlayerView, dt: number): void;

  /** Show `pose`, with a recorded clip blended over it. */
  protected show(pose: Pose, clip?: ClipBlend): void {
    this.rig.setPose(pose);
    this.figure?.update(clip);
  }
}

/** An outfield player. */
export class Footballer extends RiggedFigure {
  private readonly animator = new Animator();

  constructor(template: FigureTemplate | null, kit: Kit) {
    super(template, kit, DEFAULT_DIMS);
  }

  update(view: PlayerView, dt: number): void {
    this.object.position.set(view.x, 0, view.z);
    // Heading θ points along (cos θ, sin θ) in (x, z): a rotation of −θ about +Y.
    this.object.rotation.y = -view.facing;
    const frame = this.animator.step(view, dt);
    this.lean.rotation.z = frame.bank;
    this.show(frame.pose, frame.clip);
  }
}

/**
 * A keeper (ported from the penalty game's keeper/mesh.ts). The rig has the keeper's
 * proportions, so with the arm angle and lean straight from the simulation's dive pose the
 * gloves are where the glove colliders are. Diving, they face out of their goal (the dive
 * is across it); otherwise they face where they're heading.
 */
export class KeeperFigure extends RiggedFigure {
  private clock = 0;
  private readonly animator = new Animator();

  constructor(template: FigureTemplate | null, kit: Kit) {
    super(template, kit, {
      height: KEEPER_HEIGHT,
      shoulderHeight: KEEPER_SHOULDER_HEIGHT,
      shoulderHalfWidth: KEEPER_SHOULDER_HALF_WIDTH,
      armLength: KEEPER_ARM_LENGTH,
      handRadius: KEEPER_HAND_RADIUS,
    });
    // Gloves over the knuckles, where the glove colliders are.
    for (const side of ['l', 'r']) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(KEEPER_HAND_RADIUS, 12, 10), new THREE.MeshStandardMaterial({ color: kit.hands, roughness: 0.6 }));
      glove.castShadow = true;
      this.figure?.attach(`middle_01_${side}`, glove);
    }
  }

  update(view: PlayerView, dt: number): void {
    this.clock += dt;
    const diving = Math.abs(view.lean) > 0.02 || view.y > 0.02;
    // Out of their goal: a keeper in the −X half defends the −X goal and faces +X.
    const out = view.x < 0 ? 0 : Math.PI;
    const heading = diving ? out : view.facing;
    this.object.position.set(view.x, view.y, view.z);
    this.object.rotation.y = -heading;
    // The pose leans towards world +Z: the keeper's right when facing +X, their left facing −X.
    this.lean.rotation.z = -view.lean * Math.sign(Math.cos(heading) || 1);

    // Legs and trunk: a set stance, blending into a stretched dive or a tucked jump as the
    // body leans or leaves the ground.
    const set: Pose = {
      joints: {
        spine: { x: 0.12 },
        hipL: { x: 0.35, z: -0.14 },
        hipR: { x: 0.35, z: 0.14 },
        kneeL: { x: -0.6 },
        kneeR: { x: -0.6 },
        ankleL: { x: 0.25, z: 0.14 },
        ankleR: { x: 0.25, z: -0.14 },
        elbowL: { x: 0.45 },
        elbowR: { x: 0.45 },
      },
      rootY: -0.07 + (diving ? 0 : 0.015 * Math.sin(this.clock * 9)),
    };
    const stretch = Math.min(1, Math.abs(view.lean) / 1.0);
    const jumping = stretch < 0.2 ? Math.min(1, view.y / 0.3) : 0;
    // On the move (not diving), the legs run; the arms stay where the colliders are.
    this.animator.step(view, dt);
    const run = diving ? 0 : moving(view.speed);
    let pose = blendPoses(set, cyclePose(this.animator.phase, gaitStyle(view.speed)), run);
    pose = blendPoses(pose, DIVE, stretch);
    pose = blendPoses(pose, JUMP, jumping);

    if (view.holding) {
      // The ball held in front of the chest.
      pose.joints.shoulderL = { x: 1.1, z: -0.25 };
      pose.joints.shoulderR = { x: 1.1, z: 0.25 };
      pose.joints.elbowL = { x: 0.9 };
      pose.joints.elbowR = { x: 0.9 };
    } else {
      // Arms straight from the physics arm angle (from the body's up axis; the rig's arms
      // hang down at rest).
      const raise = Math.PI - view.arms;
      pose.joints.shoulderR = { z: raise };
      pose.joints.shoulderL = { z: -raise };
      if (stretch > 0.2 || view.arms < 1) {
        pose.joints.elbowL = { x: 0 };
        pose.joints.elbowR = { x: 0 };
      }
    }
    // Kicks, throws and rolls on top, unless they're diving.
    if (!diving) pose = this.animator.actions(view, pose).pose;
    this.show(pose);
  }
}

const DIVE: Pose = {
  joints: {
    spine: { x: -0.05 },
    hipL: { x: 0.1, z: -0.06 },
    hipR: { x: -0.1, z: 0.06 },
    kneeL: { x: -0.35 },
    kneeR: { x: -0.15 },
  },
};

const JUMP: Pose = {
  joints: {
    hipL: { x: 0.7, z: -0.08 },
    hipR: { x: 0.7, z: 0.08 },
    kneeL: { x: -1.2 },
    kneeR: { x: -1.2 },
    ankleL: { x: 0.4 },
    ankleR: { x: 0.4 },
  },
};
