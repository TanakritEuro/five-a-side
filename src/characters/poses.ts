import type { Joint, JointRotation, Pose } from './rig';

/*
 * Procedural poses for the rig (see rig.ts for the joint conventions: +x swings a limb
 * forwards, knees bend −x, z rolls sideways, the rig's right is +x).
 *
 * The running cycle's phase φ advances 2π per stride (a step with each foot). It is
 * lined up with the Quaternius jog clip: at φ = 0 the left foot touches down in front, at
 * φ = π the right one does.
 */

const TAU = 2 * Math.PI;

/** Length of the jog clip (s) and the stride it covers at its own pace (m): about 5.3 m/s. */
export const JOG_CLIP = { name: 'Jog_Fwd_Loop', duration: 0.933 } as const;

/** Metres covered in one stride (two steps) at `speed` (m/s): longer strides as players speed up. */
export function strideLength(speed: number): number {
  return 1.0 + 0.28 * speed;
}

/**
 * The style of the gait at `speed`: 0 a walk, 1 a jog, 2 a flat-out sprint, continuous
 * in between. Speed alone decides it (a jog tops out at 5.5 m/s, a sprint at 7.5), so
 * pressing sprint never makes the pose jump.
 */
export function gaitStyle(speed: number): number {
  return clamp01((speed - 1.2) / 3.3) + clamp01((speed - 5.6) / 1.6);
}

/** How much a player at `speed` is moving at all (0 standing, 1 on the move). */
export function moving(speed: number): number {
  return smoothstep(0.15, 0.9, speed);
}

interface CycleParams {
  /** Thigh swing amplitude (rad), knee bend at rest and extra in the swing, arm swing, elbow bend. */
  hip: number;
  knee: number;
  kneeSwing: number;
  arm: number;
  elbow: number;
  /** Forward lean of the trunk, the hips' bob up and down, and how low they ride (m). */
  lean: number;
  bob: number;
  sink: number;
}

const WALK: CycleParams = { hip: 0.35, knee: 0.08, kneeSwing: 0.55, arm: 0.28, elbow: 0.25, lean: 0.04, bob: 0.015, sink: 0.01 };
const JOG: CycleParams = { hip: 0.62, knee: 0.3, kneeSwing: 1.15, arm: 0.5, elbow: 1.25, lean: 0.12, bob: 0.035, sink: 0.04 };
const SPRINT: CycleParams = { hip: 0.95, knee: 0.35, kneeSwing: 1.7, arm: 0.9, elbow: 1.45, lean: 0.3, bob: 0.045, sink: 0.06 };

/** One moment of the walk / jog / sprint cycle at phase `phase`, in style `style` (see `gaitStyle`). */
export function cyclePose(phase: number, style: number): Pose {
  const c = style <= 1 ? lerpParams(WALK, JOG, clamp01(style)) : lerpParams(JOG, SPRINT, clamp01(style - 1));
  const fwd = Math.cos(phase); // +1: left leg forward (touching down at φ = 0)
  const swing = Math.sin(phase); // < 0 while the left leg swings through, > 0 the right
  // The hips are lowest just after each foot lands (a quarter of the way into each step's stance).
  const bob = -c.sink - c.bob * Math.cos(2 * (phase - 0.63));
  return {
    joints: {
      spine: { x: c.lean },
      hipL: { x: c.hip * fwd },
      hipR: { x: -c.hip * fwd },
      kneeL: { x: -(c.knee + c.kneeSwing * Math.max(0, -swing)) },
      kneeR: { x: -(c.knee + c.kneeSwing * Math.max(0, swing)) },
      ankleL: { x: 0.25 * Math.max(0, -swing) },
      ankleR: { x: 0.25 * Math.max(0, swing) },
      shoulderL: { x: -c.arm * fwd, z: -0.1 },
      shoulderR: { x: c.arm * fwd, z: 0.1 },
      elbowL: { x: c.elbow },
      elbowR: { x: c.elbow },
    },
    rootY: bob,
  };
}

/** Where the jog clip is (s) at stride phase `phase`. */
export function jogClipTime(phase: number): number {
  return (((phase % TAU) + TAU) % TAU / TAU) * JOG_CLIP.duration;
}

/** Standing: relaxed, a little weight shift with `time` (s). */
export function standPose(time: number): Pose {
  return {
    joints: {
      spine: { x: 0.06 },
      shoulderL: { z: -0.12 },
      shoulderR: { z: 0.12 },
      elbowL: { x: 0.25 },
      elbowR: { x: 0.25 },
      hipL: { z: -0.05 },
      hipR: { z: 0.05 },
    },
    rootY: 0.006 * Math.sin(time * 2.5),
  };
}

/** Add `delta` to `joint`'s rotation in `pose` (in place). */
export function nudge(pose: Pose, joint: Joint, delta: JointRotation): void {
  const r = (pose.joints[joint] ??= {});
  r.x = (r.x ?? 0) + (delta.x ?? 0);
  r.y = (r.y ?? 0) + (delta.y ?? 0);
  r.z = (r.z ?? 0) + (delta.z ?? 0);
}

function lerpParams(a: CycleParams, b: CycleParams, t: number): CycleParams {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof CycleParams)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
