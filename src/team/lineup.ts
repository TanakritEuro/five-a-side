import { AVERAGE, type PlayerSpec } from '../sim/player';
import { DIAMOND, slotPosition } from './formation';
import { TEAMS } from './teams';

/** Milestone 1: just the home pivot, lined up for kick-off just behind the ball. */
export function soloLineup(): PlayerSpec[] {
  const pivot = DIAMOND.find((s) => s.role === 'pivot')!;
  return [{ team: 0, role: 'pivot', slot: pivot, kickoff: slotPosition(pivot, 1), kickoffFacing: 0 }];
}

/**
 * Both teams in the diamond, home (team 0, ids 0–4) attacking +X in the first half and
 * away (team 1, ids 5–9) attacking -X, each player rated from their team's squad.
 */
export function fullLineup(): PlayerSpec[] {
  return ([0, 1] as const).flatMap((team) => {
    const attackDir = team === 0 ? 1 : -1;
    return DIAMOND.map((slot) => ({
      team,
      role: slot.role,
      slot,
      kickoff: slotPosition(slot, attackDir),
      kickoffFacing: attackDir === 1 ? 0 : Math.PI,
      attrs: { ...AVERAGE, ...TEAMS[team].squad[slot.role] },
    }));
  });
}
