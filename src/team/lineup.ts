import type { PlayerSpec } from '../sim/player';
import { DIAMOND, slotPosition } from './formation';

/** Milestone 1: just the home pivot, lined up for kick-off just behind the ball. */
export function soloLineup(): PlayerSpec[] {
  const pivot = DIAMOND.find((s) => s.role === 'pivot')!;
  return [{ team: 0, role: 'pivot', kickoff: slotPosition(pivot, 1), kickoffFacing: 0 }];
}
