// Ported unchanged from ../penalty-shootout/src/keeper/pose.ts. Here the pose's x (across
// the goal) is world Z; the keeper's distance from the goal line is the player's own x.
import { TUNING } from '../config';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_COM_HEIGHT,
  KEEPER_HAND_RADIUS,
  KEEPER_RADIUS,
  KEEPER_SHOULDER_HEIGHT,
} from '../constants';

/**
 * The keeper's pose in the plane of the goal line. The body is a straight line from the
 * feet up to the head, leaning sideways; the arms swing about the shoulders.
 */
export interface KeeperPose {
  /** Feet position: x across the goal, y up. */
  x: number;
  y: number;
  /** Sideways lean (rad): 0 is upright, +π/2 lies flat with the head towards +x. */
  lean: number;
  /** Arm angle from the body's up axis (rad): ~0 is overhead, ~2 is down by the sides. */
  arms: number;
}

/** Ready stance: arms out and low, covering the area around the body. */
export const ARMS_SET = 2.3;
/**
 * Arms stretched overhead for a dive or a jump, angled slightly inwards so the gloves
 * meet: with the arms parallel the gap between them is wider than the ball.
 */
export const ARMS_UP = -0.13;

/** How far up the body (m, from the feet) the gloves reach with the arms overhead. */
const GLOVE_REACH = KEEPER_SHOULDER_HEIGHT + KEEPER_ARM_LENGTH - KEEPER_HAND_RADIUS;

export function standingPose(x = 0): KeeperPose {
  return { x, y: 0, lean: 0, arms: ARMS_SET };
}

/** Up axis of the body in world (x, y) for a given lean. */
export function bodyAxis(lean: number): { x: number; y: number } {
  return { x: Math.sin(lean), y: Math.cos(lean) };
}

/**
 * Pose at full stretch when trying to get to a ball at (tx, ty) on the goal line,
 * starting from `start`. The keeper can't move their centre of mass more than `maxDive`,
 * so far-away targets end up out of reach.
 */
export function diveTargetPose(start: KeeperPose, tx: number, ty: number, maxDive: number): KeeperPose {
  const K = TUNING.keeper;

  // Near the middle: stay on your feet, shuffle across, jump for high balls.
  if (Math.abs(tx - start.x) < K.centreBand) {
    const high = ty > KEEPER_SHOULDER_HEIGHT - 0.2;
    return {
      x: tx - Math.sign(tx - start.x) * Math.min(Math.abs(tx - start.x), KEEPER_RADIUS),
      y: high ? Math.min(Math.max(0, ty - GLOVE_REACH), K.maxJump) : 0,
      lean: 0,
      arms: high ? ARMS_UP : ARMS_SET,
    };
  }

  // Dive: lie flatter for low balls, stay more upright for high ones.
  const side = Math.sign(tx - start.x);
  const leanAbs = deg(88) - deg(60) * clamp01(ty / 2.3);
  const lean = side * leanAbs;
  const axis = bodyAxis(lean);

  // Which point along the body meets the ball: ideally the gloves, but the feet shouldn't
  // end up on the far side of where the keeper started (that's the hip or chest instead).
  const along = clamp((Math.abs(tx - start.x) + 0.3) / Math.sin(leanAbs), 0.9, GLOVE_REACH);
  let x = tx - along * axis.x;
  let y = Math.max(ty - along * axis.y, KEEPER_RADIUS * (1 - axis.y));

  // Limit how far the centre of mass travels; past that the keeper falls short.
  const comStartX = start.x + KEEPER_COM_HEIGHT * Math.sin(start.lean);
  const comStartY = start.y + KEEPER_COM_HEIGHT * Math.cos(start.lean);
  let comX = x + KEEPER_COM_HEIGHT * axis.x;
  let comY = y + KEEPER_COM_HEIGHT * axis.y;
  const travel = Math.hypot(comX - comStartX, comY - comStartY);
  if (travel > maxDive) {
    const k = maxDive / travel;
    comX = comStartX + (comX - comStartX) * k;
    comY = comStartY + (comY - comStartY) * k;
    x = comX - KEEPER_COM_HEIGHT * axis.x;
    y = Math.max(comY - KEEPER_COM_HEIGHT * axis.y, KEEPER_RADIUS * (1 - axis.y));
  }

  return { x, y, lean, arms: ARMS_UP };
}

/** Where a pose comes to rest on the ground once the keeper lands. */
export function landedPose(p: KeeperPose): KeeperPose {
  if (Math.abs(p.lean) < deg(15)) return { ...p, y: 0 };
  // Topple the rest of the way onto the side, body just off the grass.
  return { ...p, y: KEEPER_RADIUS, lean: Math.sign(p.lean) * deg(90) };
}

export function lerpPose(a: KeeperPose, b: KeeperPose, t: number): KeeperPose {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    lean: a.lean + (b.lean - a.lean) * t,
    arms: a.arms + (b.arms - a.arms) * t,
  };
}

function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/**
 * Rough distance (m) in the plane of the goal line from (px, py) to the keeper: to the
 * line from their feet up through their outstretched gloves.
 */
export function distanceToKeeper(p: KeeperPose, px: number, py: number): number {
  const axis = bodyAxis(p.lean);
  const along = clamp((px - p.x) * axis.x + (py - p.y) * axis.y, 0, GLOVE_REACH);
  return Math.hypot(px - (p.x + axis.x * along), py - (p.y + axis.y * along));
}
