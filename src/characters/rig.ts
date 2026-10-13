// Ported unchanged from ../penalty-shootout/src/characters/rig.ts. With the Quaternius
// model loaded the rig only drives it (its own capsule limbs are hidden); without it, the
// capsules are the fallback figure.
import * as THREE from 'three';

/**
 * A simple procedural humanoid: a hierarchy of joints (Object3Ds) with low-poly limbs
 * hung off them. It is posed by setting joint rotations directly; see `Pose`.
 *
 * Frame: the root sits on the ground between the feet, +y up, facing −z (towards the
 * goal for a kicker). The character's right is +x.
 */

export const JOINTS = [
  'hips',
  'spine',
  'neck',
  'shoulderL',
  'elbowL',
  'shoulderR',
  'elbowR',
  'hipL',
  'kneeL',
  'ankleL',
  'hipR',
  'kneeR',
  'ankleR',
] as const;
export type Joint = (typeof JOINTS)[number];

/** Euler angles (rad) for a joint, applied in XYZ order. x pitches, y twists, z rolls sideways. */
export interface JointRotation {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * A full-body pose. Missing joints are at rest: standing straight, arms hanging down.
 * Conventions at every joint: +x bends the limb forwards (towards −z: raises a thigh,
 * folds a forearm up); for knees the natural bend is −x. `rootY` lifts the whole body
 * (jumps, crouches); `rootYaw` turns it.
 */
export interface Pose {
  joints: Partial<Record<Joint, JointRotation>>;
  rootY?: number;
  rootYaw?: number;
}

export interface RigDims {
  /** Feet to top of head (m). */
  height: number;
  shoulderHeight: number;
  /** Body centreline to each shoulder joint (m). */
  shoulderHalfWidth: number;
  /** Shoulder to fingertips (m). */
  armLength: number;
  handRadius: number;
}

export const DEFAULT_DIMS: RigDims = {
  height: 1.8,
  shoulderHeight: 1.47,
  shoulderHalfWidth: 0.19,
  armLength: 0.66,
  handRadius: 0.05,
};

export interface Kit {
  shirt: number;
  shorts: number;
  socks: number;
  boots: number;
  skin: number;
  /** Gloves for a keeper, skin for an outfield player. */
  hands: number;
  /** Whether the shirt has long sleeves (keepers) or short. */
  longSleeves: boolean;
}

export class Rig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<Joint, THREE.Group>;
  private readonly materials: Record<'shirt' | 'shorts' | 'socks' | 'boots' | 'skin' | 'hands' | 'sleeves', THREE.MeshStandardMaterial>;
  private readonly hipHeight: number;
  private readonly parts: THREE.Mesh[] = [];
  private readonly longSleeves: boolean;
  /** Bare hands follow the skin colour; gloves keep their own. */
  private readonly bareHands: boolean;

  constructor(
    readonly dims: RigDims,
    kit: Kit,
  ) {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    this.materials = {
      shirt: mat(kit.shirt),
      shorts: mat(kit.shorts),
      socks: mat(kit.socks),
      boots: mat(kit.boots),
      skin: mat(kit.skin),
      hands: mat(kit.hands),
      sleeves: mat(kit.longSleeves ? kit.shirt : kit.skin),
    };
    this.longSleeves = kit.longSleeves;
    this.bareHands = kit.hands === kit.skin;
    for (const j of JOINTS) {
      const g = new THREE.Group();
      g.name = j;
      this.joints[j] = g;
    }

    const d = dims;
    const J = this.joints;
    const M = this.materials;
    this.hipHeight = d.height * 0.52;
    const footHeight = 0.07;
    const legLength = this.hipHeight - 0.05 - footHeight;
    const spineBase = 0.1; // spine joint above the hips joint
    const torsoTop = d.shoulderHeight - this.hipHeight - spineBase + 0.06;
    const headRadius = Math.max(0.09, (d.height - d.shoulderHeight - 0.07) / 2);

    // Trunk
    this.root.add(J.hips);
    J.hips.position.y = this.hipHeight;
    // Shorts: a capsule lying across the hips.
    const shorts = new THREE.CapsuleGeometry(0.12, 0.12, 4, 10).rotateZ(Math.PI / 2);
    this.part(J.hips, shorts, M.shorts, 0, -0.01, 0);
    J.hips.add(J.spine);
    J.spine.position.y = spineBase;
    this.part(J.spine, new THREE.CapsuleGeometry(0.16, torsoTop - 0.3, 4, 10), M.shirt, 0, torsoTop / 2, 0);
    J.spine.add(J.neck);
    J.neck.position.y = torsoTop;
    this.part(J.neck, new THREE.SphereGeometry(headRadius, 16, 12), M.skin, 0, headRadius + 0.03, 0);

    // Arms: the hand centre sits at armLength − handRadius from the shoulder, where a
    // keeper's glove collider is.
    const reach = d.armLength - d.handRadius;
    const upper = reach / 2;
    const fore = reach / 2;
    for (const side of [-1, 1] as const) {
      const shoulder = side < 0 ? J.shoulderL : J.shoulderR;
      const elbow = side < 0 ? J.elbowL : J.elbowR;
      J.spine.add(shoulder);
      shoulder.position.set(side * d.shoulderHalfWidth, d.shoulderHeight - this.hipHeight - spineBase, 0);
      this.part(shoulder, new THREE.CapsuleGeometry(0.055, upper - 0.08, 4, 8), M.shirt, 0, -upper / 2, 0);
      shoulder.add(elbow);
      elbow.position.y = -upper;
      this.part(elbow, new THREE.CapsuleGeometry(0.045, fore - 0.06, 4, 8), M.sleeves, 0, -fore / 2, 0);
      this.part(elbow, new THREE.SphereGeometry(d.handRadius, 10, 8), M.hands, 0, -fore, 0);
    }

    // Legs
    const thigh = legLength / 2;
    const shin = legLength / 2;
    for (const side of [-1, 1] as const) {
      const hip = side < 0 ? J.hipL : J.hipR;
      const knee = side < 0 ? J.kneeL : J.kneeR;
      const ankle = side < 0 ? J.ankleL : J.ankleR;
      J.hips.add(hip);
      hip.position.set(side * 0.095, -0.05, 0);
      this.part(hip, new THREE.CapsuleGeometry(0.075, thigh - 0.1, 4, 8), M.shorts, 0, -thigh / 2, 0);
      hip.add(knee);
      knee.position.y = -thigh;
      this.part(knee, new THREE.CapsuleGeometry(0.06, shin - 0.08, 4, 8), M.socks, 0, -shin / 2, 0);
      knee.add(ankle);
      ankle.position.y = -shin;
      this.part(ankle, new THREE.BoxGeometry(0.1, footHeight, 0.26), M.boots, 0, -footHeight / 2, -0.06);
    }
  }

  /** Recolour parts of the kit (e.g. for a new team). */
  setColours(kit: Partial<Pick<Kit, 'shirt' | 'shorts' | 'socks' | 'skin'>>): void {
    const M = this.materials;
    if (kit.shorts !== undefined) M.shorts.color.setHex(kit.shorts);
    if (kit.socks !== undefined) M.socks.color.setHex(kit.socks);
    if (kit.skin !== undefined) {
      M.skin.color.setHex(kit.skin);
      if (this.bareHands) M.hands.color.setHex(kit.skin);
      if (!this.longSleeves) M.sleeves.color.setHex(kit.skin);
    }
    if (kit.shirt !== undefined) this.setShirt(kit.shirt);
  }

  /** Show or hide the rig's own limbs (hidden when a skinned model is driven by it instead). */
  setPartsVisible(visible: boolean): void {
    for (const part of this.parts) part.visible = visible;
  }

  setShirt(colour: number): void {
    this.materials.shirt.color.setHex(colour);
    if (this.longSleeves) this.materials.sleeves.color.setHex(colour);
  }

  /** Apply a pose: every joint not mentioned goes back to rest. */
  setPose(pose: Pose): void {
    for (const j of JOINTS) {
      const r = pose.joints[j];
      this.joints[j].rotation.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0);
    }
    this.joints.hips.position.y = this.hipHeight + (pose.rootY ?? 0);
    this.joints.hips.rotation.y += pose.rootYaw ?? 0;
  }

  private part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    this.parts.push(mesh);
  }
}

/** Blend two poses: t = 0 gives `a`, 1 gives `b`. Angles blend linearly (fine for limbs). */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  const joints: Pose['joints'] = {};
  for (const j of JOINTS) {
    const ra = a.joints[j];
    const rb = b.joints[j];
    if (!ra && !rb) continue;
    joints[j] = {
      x: lerp(ra?.x ?? 0, rb?.x ?? 0, t),
      y: lerp(ra?.y ?? 0, rb?.y ?? 0, t),
      z: lerp(ra?.z ?? 0, rb?.z ?? 0, t),
    };
  }
  return {
    joints,
    rootY: lerp(a.rootY ?? 0, b.rootY ?? 0, t),
    rootYaw: lerp(a.rootYaw ?? 0, b.rootYaw ?? 0, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
