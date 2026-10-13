// Ported from ../penalty-shootout/src/characters/skinned.ts. Changed here: the per-frame
// update reuses its objects (ten figures, not two), and the figure wears a kit coloured
// by body region instead of a two-tone body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { JOINTS, type Joint, type Kit, type Rig } from './rig';

/** A loaded character model: its scene (mesh + skeleton) and animation clips by name. */
export interface FigureTemplate {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

/** Load a rigged .glb (Quaternius' Mannequin), or null if it can't be loaded. */
export async function loadFigure(url: string): Promise<FigureTemplate | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    return { scene: gltf.scene, clips: new Map(gltf.animations.map((a) => [a.name, a])) };
  } catch (error) {
    console.warn(`Character model ${url} failed to load; using the built-in figures.`, error);
    return null;
  }
}

/**
 * Which bone follows which driver joint, the bone that marks the far end of that limb, and
 * the limb's direction at rest in the driver joint's own frame (our rig hangs its limbs
 * down −y, the trunk points up +y and feet point forward −z).
 */
const BONES: readonly { joint: Joint; bone: string; end: string | null; restDir: [number, number, number] }[] = [
  { joint: 'hips', bone: 'pelvis', end: null, restDir: [0, 1, 0] },
  { joint: 'spine', bone: 'spine_01', end: 'neck_01', restDir: [0, 1, 0] },
  { joint: 'neck', bone: 'neck_01', end: 'Head', restDir: [0, 1, 0] },
  { joint: 'shoulderL', bone: 'upperarm_l', end: 'lowerarm_l', restDir: [0, -1, 0] },
  { joint: 'elbowL', bone: 'lowerarm_l', end: 'hand_l', restDir: [0, -1, 0] },
  { joint: 'shoulderR', bone: 'upperarm_r', end: 'lowerarm_r', restDir: [0, -1, 0] },
  { joint: 'elbowR', bone: 'lowerarm_r', end: 'hand_r', restDir: [0, -1, 0] },
  { joint: 'hipL', bone: 'thigh_l', end: 'calf_l', restDir: [0, -1, 0] },
  { joint: 'kneeL', bone: 'calf_l', end: 'foot_l', restDir: [0, -1, 0] },
  { joint: 'ankleL', bone: 'foot_l', end: 'ball_l', restDir: [0, -0.5, -0.87] },
  { joint: 'hipR', bone: 'thigh_r', end: 'calf_r', restDir: [0, -1, 0] },
  { joint: 'kneeR', bone: 'calf_r', end: 'foot_r', restDir: [0, -1, 0] },
  { joint: 'ankleR', bone: 'foot_r', end: 'ball_r', restDir: [0, -0.5, -0.87] },
];

/** Head bone to the top of the head (m, model scale), for sizing the model to the rig. */
const HEAD_TOP = 0.17;

interface BoneState {
  bone: THREE.Bone;
  /** Index of the parent bone in `bones`, or −1 if the parent is a fixed node (see `fixedParent`). */
  parent: number;
  /** A fixed parent's rotation in rig-root space. */
  fixedParent: THREE.Quaternion;
  /** Driver joint this bone follows, if any. */
  joint: Joint | null;
  /** The inverse of the joint's rest rotation, and the bone's calibrated rest rotation (rig-root space). */
  jointRestInverse: THREE.Quaternion;
  boneRest: THREE.Quaternion;
  /** Calibrated rest rotation relative to the parent bone, for bones without a driver joint. */
  restLocal: THREE.Quaternion;
  /** This frame: the bone's wanted rotation in rig-root space, and the clip's local rotation. */
  want: THREE.Quaternion;
  clip: THREE.Quaternion;
}

export interface ClipBlend {
  name: string;
  /** Time into the clip (s). */
  time: number;
  /** 0: pure procedural pose, 1: pure clip. */
  weight: number;
}

const scratch = new THREE.Quaternion();

/**
 * A skinned character model driven by one of our procedural rigs. The rig still computes
 * every pose (so animation stays in sync with the simulation); each frame the model's bones
 * take on the rotation each driver joint has made away from its rest pose, after a
 * one-off calibration that lines the model's limbs up with the rig's at rest (the model is
 * bound in a T-pose, the rig stands with its arms down). Recorded clips (idle, jog, dance)
 * can be blended over the top.
 */
export class SkinnedFigure {
  readonly model: THREE.Object3D;
  private readonly bones: BoneState[] = [];
  private readonly pelvis: THREE.Bone;
  private readonly pelvisRest = new THREE.Vector3();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly hipHeight: number;
  private readonly clipPelvisPosition = new THREE.Vector3();
  /** Each driver joint's rotation relative to the rig root, this frame, and its parent joint. */
  private readonly jointRel = new Map<Joint, THREE.Quaternion>();
  private readonly jointParent = new Map<Joint, Joint | null>();
  private readonly kit = kitUniforms();

  constructor(
    template: FigureTemplate,
    private readonly driver: Rig,
    height: number,
  ) {
    this.model = cloneSkinned(template.scene);
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow the pose
      // The kit: the body in the region colours, the joint plates a shade darker.
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) =>
        kitMaterial(m as THREE.MeshStandardMaterial, this.kit, m.name === 'M_Joints' ? 0.78 : 1),
      );
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    this.pelvis = this.model.getObjectByName('pelvis') as THREE.Bone;

    // The model faces +z, the rig −z; size it to the rig.
    const head = this.model.getObjectByName('Head')!;
    this.model.updateMatrixWorld(true);
    const modelHeight = head.getWorldPosition(new THREE.Vector3()).y + HEAD_TOP;
    this.model.rotation.y = Math.PI;
    this.model.scale.setScalar(height / modelHeight);
    driver.root.add(this.model);
    this.hipHeight = driver.joints.hips.position.y;

    for (const j of JOINTS) {
      this.jointRel.set(j, new THREE.Quaternion());
      const parent = driver.joints[j].parent;
      this.jointParent.set(j, JOINTS.find((k) => driver.joints[k] === parent) ?? null);
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of template.clips) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.enabled = false;
      this.actions.set(name, action);
    }

    this.calibrate();
  }

  /** Dress the figure: shirt, sleeves, shorts, socks, boots, skin and hands (gloves). */
  setKit(kit: Kit): void {
    const K = this.kit;
    K.uShirt.value.setHex(kit.shirt);
    K.uSleeve.value.setHex(kit.shirt);
    K.uSleeveEnd.value = kit.longSleeves ? 0.72 : 0.33;
    K.uShorts.value.setHex(kit.shorts);
    K.uSocks.value.setHex(kit.socks);
    K.uBoots.value.setHex(kit.boots);
    K.uSkin.value.setHex(kit.skin);
    K.uHands.value.setHex(kit.hands);
  }

  /** Attach a small mesh (e.g. a glove) to the named bone. */
  attach(boneName: string, object: THREE.Object3D): void {
    const bone = this.model.getObjectByName(boneName);
    if (!bone) return;
    // Undo the model's scale so the attachment keeps its real size.
    object.scale.divideScalar(this.model.scale.x);
    bone.add(object);
  }

  /** Copy the driver rig's current pose onto the model, optionally blending a clip in. */
  update(clip?: ClipBlend): void {
    const sampled = clip !== undefined && clip.weight > 0 && this.sampleClip(clip);

    // Each joint's rotation relative to the rig root, parents first (JOINTS is in that
    // order). The root's own placement cancels out.
    for (const j of JOINTS) {
      const parent = this.jointParent.get(j)!;
      const rel = this.jointRel.get(j)!;
      if (parent) rel.multiplyQuaternions(this.jointRel.get(parent)!, this.driver.joints[j].quaternion);
      else rel.copy(this.driver.joints[j].quaternion);
    }

    // Bones are listed parents first; work out each one's rotation in rig-root space.
    for (const s of this.bones) {
      const parentRel = s.parent >= 0 ? this.bones[s.parent].want : s.fixedParent;
      if (s.joint) {
        // The rotation the joint has made away from rest, applied to the bone's rest.
        s.want.multiplyQuaternions(this.jointRel.get(s.joint)!, s.jointRestInverse).multiply(s.boneRest);
      } else {
        s.want.multiplyQuaternions(parentRel, s.restLocal);
      }
      scratch.copy(parentRel).invert().multiply(s.want);
      if (sampled) scratch.slerp(s.clip, clip.weight);
      s.bone.quaternion.copy(scratch);
    }

    // Raise or lower the hips with the rig (crouches, jumps, the run's bob).
    const lift = this.driver.joints.hips.position.y - this.hipHeight;
    this.pelvis.position.copy(this.pelvisRest);
    this.pelvis.position.y += lift / this.model.scale.x;
    if (sampled) this.pelvis.position.lerp(this.clipPelvisPosition, clip.weight);
  }

  /** Pose the bones from `clip` at its time and keep their local rotations. False if there's no such clip. */
  private sampleClip(clip: ClipBlend): boolean {
    const action = this.actions.get(clip.name);
    if (!action) return false;
    for (const a of this.actions.values()) a.enabled = a === action;
    action.time = clip.time % action.getClip().duration;
    action.weight = 1;
    this.mixer.update(0);
    for (const s of this.bones) s.clip.copy(s.bone.quaternion);
    this.clipPelvisPosition.copy(this.pelvis.position);
    action.enabled = false;
    return true;
  }

  /** Line the model's limbs up with the rig at rest and remember both rest poses. */
  private calibrate(): void {
    this.driver.setPose({ joints: {} });
    const skinned = this.findSkinnedMesh();
    skinned.skeleton.pose();
    this.driver.root.updateWorldMatrix(true, true);
    this.pelvisRest.copy(this.pelvis.position);

    const rootInverse = this.driver.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rel = (o: THREE.Object3D) => rootInverse.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    const pos = (o: THREE.Object3D) => this.driver.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));

    const order: THREE.Bone[] = [];
    this.model.traverse((o) => {
      if (o instanceof THREE.Bone) order.push(o);
    });
    for (const bone of order) {
      const map = BONES.find((b) => b.bone === bone.name);
      const parent = bone.parent!;
      const parentIndex = this.bones.findIndex((s) => s.bone === parent);
      const fixedParent = parentIndex >= 0 ? new THREE.Quaternion() : rel(parent);
      const parentRest = parentIndex >= 0 ? this.bones[parentIndex].boneRest : fixedParent;
      let boneRest: THREE.Quaternion;
      let jointRest = new THREE.Quaternion();
      if (map) {
        jointRest = rel(this.driver.joints[map.joint]);
        boneRest = rel(bone);
        if (map.end) {
          // Swing the bone so its limb points the way the rig's limb does at rest.
          const end = this.model.getObjectByName(map.end)!;
          const from = pos(end).sub(pos(bone)).normalize();
          const to = new THREE.Vector3(...map.restDir).normalize().applyQuaternion(jointRest);
          boneRest = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(boneRest);
        }
      } else {
        // Unmapped bones (fingers, upper spine, clavicles) keep their pose relative to the parent.
        boneRest = parentRest.clone().multiply(bone.quaternion);
      }
      this.bones.push({
        bone,
        parent: parentIndex,
        fixedParent,
        joint: map?.joint ?? null,
        jointRestInverse: jointRest.invert(),
        boneRest,
        restLocal: parentRest.clone().invert().multiply(boneRest),
        want: new THREE.Quaternion(),
        clip: new THREE.Quaternion(),
      });
    }
  }

  private findSkinnedMesh(): THREE.SkinnedMesh {
    let found: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) found = o;
    });
    if (!found) throw new Error('Character model has no skinned mesh');
    return found;
  }
}

type KitUniforms = ReturnType<typeof kitUniforms>;

function kitUniforms() {
  const colour = () => ({ value: new THREE.Color() });
  return {
    uShirt: colour(),
    uSleeve: colour(),
    uShorts: colour(),
    uSocks: colour(),
    uBoots: colour(),
    uSkin: colour(),
    uHands: colour(),
    /** How far out along the arm (model units, T-pose) the sleeve reaches. */
    uSleeveEnd: { value: 0.33 },
  };
}

/**
 * A copy of the model's material that colours the body by region, from each vertex's
 * position in the bind pose (a T-pose, model units, 1.83 tall: hips at 0.93, knees at
 * 0.53, ankles at 0.10, elbows 0.47 and wrists 0.74 out along x). Every kit material
 * compiles to the same program; only the uniforms differ.
 */
function kitMaterial(base: THREE.MeshStandardMaterial, uniforms: KitUniforms, shade: number): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color.setRGB(1, 1, 1);
  m.roughness = 0.7;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uShade: { value: shade } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBind;
uniform vec3 uShirt, uSleeve, uShorts, uSocks, uBoots, uSkin, uHands;
uniform float uSleeveEnd, uShade;
vec3 kitColour(vec3 p) {
  float ax = abs(p.x);
  if (ax > 0.2 && p.y > 1.15) return ax > 0.72 ? uHands : (ax > uSleeveEnd ? uSkin : uSleeve);
  if (p.y > 1.47) return uSkin;
  if (p.y > 0.96) return uShirt;
  if (p.y > 0.62) return uShorts;
  if (p.y > 0.53) return uSkin;
  if (p.y > 0.13) return uSocks;
  return uBoots;
}`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = kitColour(vBind) * uShade;');
  };
  m.customProgramCacheKey = () => 'kit';
  return m;
}
