import { TUNING } from '../config';
import { HALF_LENGTH, HALF_WIDTH } from '../constants';
import { clamp, type Vec2 } from '../math';

export type Role = 'keeper' | 'defender' | 'left' | 'right' | 'pivot';

/**
 * A formation slot in the team's own frame: `forward` runs from the team's own goal line
 * (-1) to the opponents' (+1); `across` runs from one touchline (-1) to the other (+1).
 */
export interface Slot {
  role: Role;
  forward: number;
  across: number;
}

/** Futsal "diamond" (1-2-1 in front of the keeper), set up for kick-off in the team's own half. */
export const DIAMOND: readonly Slot[] = [
  { role: 'keeper', forward: -0.93, across: 0 },
  { role: 'defender', forward: -0.6, across: 0 },
  { role: 'left', forward: -0.35, across: -0.55 },
  { role: 'right', forward: -0.35, across: 0.55 },
  { role: 'pivot', forward: -0.08, across: 0 },
];

/**
 * World position of a slot for a team attacking towards `attackDir` (+1 = towards +X).
 * Facing the goal they attack, a team's left is the world's -Z side when attacking +X.
 */
export function slotPosition(slot: Slot, attackDir: 1 | -1): Vec2 {
  return {
    x: attackDir * slot.forward * HALF_LENGTH,
    z: attackDir * slot.across * HALF_WIDTH,
  };
}

/**
 * Where a slot is in open play, in world coordinates: the team's shape slides up and down
 * the pitch and across it with the ball, pushes up when it has the ball and drops back
 * when it hasn't. The keeper's slot doesn't move (keepers position themselves).
 */
export function shiftedSlot(slot: Slot, ball: Vec2, attackDir: 1 | -1, inPossession: boolean): Vec2 {
  if (slot.role === 'keeper') return slotPosition(slot, attackDir);
  const F = TUNING.formation;
  // The ball in the team's own frame, -1..1.
  const ballForward = clamp((ball.x * attackDir) / HALF_LENGTH, -1, 1);
  const ballAcross = clamp((ball.z * attackDir) / HALF_WIDTH, -1, 1);
  const forward = clamp(
    slot.forward + F.followBall * ballForward + (inPossession ? F.pushUp : -F.dropBack),
    -F.maxForward,
    F.maxForward,
  );
  const across = clamp(slot.across * F.width + F.followBallAcross * ballAcross, -F.maxAcross, F.maxAcross);
  return slotPosition({ ...slot, forward, across }, attackDir);
}
