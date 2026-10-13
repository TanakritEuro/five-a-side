import { wrapAngle } from '../math';
import { actionAge, type PlayerView } from '../render/interpolate';
import { blendPoses, type Pose } from './rig';
import type { ClipBlend } from './skinned';
import {
  BRACE,
  clamp01,
  cyclePose,
  FOLLOW,
  gaitStyle,
  JOG_CLIP,
  jogClipTime,
  LUNGE,
  moving,
  nudge,
  ROLL,
  SIDEFOOT,
  smoothstep,
  standPose,
  STRIKE,
  strideLength,
  THROW,
  TRAP,
  WINDUP,
} from './poses';

const TAU = 2 * Math.PI;

/** What to show this frame: the rig's pose, a clip over it, and a bank (rad) to roll the whole body by into a turn. */
export interface Frame {
  pose: Pose;
  clip?: ClipBlend;
  bank: number;
}

/** Further than this (m) between frames is a teleport (a restart), not running. */
const TELEPORT = 1.5;

/**
 * One player's animation, purely from what they look like each frame (`PlayerView`):
 * presentation only, it never touches the simulation.
 *
 * - The stride phase advances with the distance covered, not with time, so the cadence
 *   follows the running speed and a player who stops stops mid-stride.
 * - The gait blends from standing through walk and jog to sprint by speed; jogging, the
 *   recorded jog clip plays in step with the stride.
 * - The body banks into turns and leans forward when accelerating.
 * - Actions play over the gait, timed from the tick the snapshot stamped them with (so
 *   a kick's contact pose lands on the step the ball left the foot): a shot's backswing
 *   while it's charged, then the strike and follow-through; a side-foot pass; a trap; a
 *   dribble touch; a tackle's lunge; bracing in a shoulder challenge; a keeper's throw
 *   or roll.
 */
export class Animator {
  /** Stride phase (rad), advancing 2π per stride. */
  phase = 0;
  private x: number | null = null;
  private z = 0;
  private facing = 0;
  private speed = 0;
  /** Smoothed turn rate (rad/s) and acceleration (m/s²). */
  private turn = 0;
  private accel = 0;

  step(view: PlayerView, dt: number): Frame {
    this.advance(view, dt);
    const go = moving(view.speed);
    const style = gaitStyle(view.speed);
    let pose = blendPoses(standPose(view.now), cyclePose(this.phase, style), go);

    // Leaning: forward into acceleration, back a touch when braking.
    nudge(pose, 'spine', { x: Math.max(-0.12, Math.min(0.15, this.accel * 0.02)) });
    pose = this.actions(view, pose);

    // Jogging, the recorded jog plays in step; standing, the recorded idle.
    const jogness = go * clamp01(1 - Math.abs(style - 1) * 1.6);
    const clip: ClipBlend | undefined =
      jogness > 0.05
        ? { name: JOG_CLIP.name, time: jogClipTime(this.phase), weight: 0.85 * jogness }
        : go < 0.5
          ? { name: 'Idle_Loop', time: view.now, weight: 1 - go * 2 }
          : undefined;

    // Bank into the turn: turning right (heading increasing) rolls them to their right.
    const bank = Math.max(-0.35, Math.min(0.35, -this.turn * view.speed * 0.03));
    return { pose, clip, bank };
  }

  /** Move the stride on by the distance covered since the last frame, and track turning and acceleration. */
  private advance(view: PlayerView, dt: number): void {
    if (this.x === null || dt <= 0) {
      this.reset(view);
      return;
    }
    const d = Math.hypot(view.x - this.x, view.z - this.z);
    if (d > TELEPORT) {
      this.reset(view);
      return;
    }
    this.phase = (this.phase + (TAU * d) / strideLength(Math.max(view.speed, 1))) % TAU;
    const k = Math.min(1, dt * 8);
    this.turn += (wrapAngle(view.facing - this.facing) / dt - this.turn) * k;
    this.accel += ((view.speed - this.speed) / dt - this.accel) * k;
    this.x = view.x;
    this.z = view.z;
    this.facing = view.facing;
    this.speed = view.speed;
  }

  private reset(view: PlayerView): void {
    this.x = view.x;
    this.z = view.z;
    this.facing = view.facing;
    this.speed = view.speed;
    this.turn = 0;
    this.accel = 0;
  }

  /** Lay the player's current action over `pose` (the gait, or a keeper's stance). */
  actions(view: PlayerView, pose: Pose): Pose {
    const age = actionAge(view);
    const kind = age >= -0.02 ? view.action?.kind : undefined;
    // A shot being charged: the leg comes back.
    if (view.charge > 0) pose = blendPoses(pose, WINDUP, 0.75 * smoothstep(0, 0.35, view.charge));
    // Lunging in a tackle, and getting back up once it's resolved and over.
    const lunge = view.tackle >= 0 ? smoothstep(0, 0.08, view.tackle) : kind === 'tackle' ? 1 - smoothstep(0.23, 0.6, age) : 0;
    if (lunge > 0) pose = blendPoses(pose, LUNGE, lunge);
    switch (kind) {
      case 'shot':
        return blendPoses(pose, blendPoses(STRIKE, FOLLOW, smoothstep(0, 0.25, age)), 1 - smoothstep(0.35, 0.65, age));
      case 'pass':
        return blendPoses(pose, SIDEFOOT, 1 - smoothstep(0.12, 0.4, age));
      case 'receive':
        return blendPoses(pose, TRAP, 1 - smoothstep(0.1, 0.35, age));
      case 'challenge':
        return blendPoses(pose, BRACE, smoothstep(0, 0.08, age) * (1 - smoothstep(0.3, 0.6, age)));
      case 'throw':
        return blendPoses(pose, THROW, 1 - smoothstep(0.25, 0.6, age));
      case 'roll':
        return blendPoses(pose, ROLL, 1 - smoothstep(0.25, 0.6, age));
      case 'touch': {
        // The right foot flicks out at the ball and back.
        const T = 0.28;
        if (age > T) return pose;
        const w = Math.sin((Math.PI * Math.max(0, age)) / T);
        nudge(pose, 'hipR', { x: 0.45 * w });
        nudge(pose, 'kneeR', { x: -0.25 * w });
        nudge(pose, 'ankleR', { x: -0.3 * w });
        return pose;
      }
      default:
        return pose;
    }
  }
}
