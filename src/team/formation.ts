import { HALF_LENGTH, HALF_WIDTH } from '../constants';
import type { Vec2 } from '../math';

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
