import { PHYSICS_STEP } from '../constants';
import type { SimEvent } from '../sim/events';

/** One team's numbers for a match. */
export interface TeamStats {
  goals: number;
  shots: number;
  onTarget: number;
  passes: number;
  tacklesWon: number;
  fouls: number;
  saves: number;
  /** Seconds in possession. */
  possession: number;
}

/** A goal, for the full-time screen: who, which team, and the minute. */
export interface GoalNote {
  team: 0 | 1;
  scorer: number | null;
  minute: number;
}

/**
 * A match's numbers, counted from the simulation's events and who had the ball each step.
 * Presentation only: the simulation never reads them.
 */
export class MatchStats {
  readonly teams: [TeamStats, TeamStats] = [fresh(), fresh()];
  readonly goals: GoalNote[] = [];

  /**
   * Count one step: its events, and the team on the ball after it (null if loose). `teamOf`
   * says which team a player is on; `minute` is the match minute now.
   */
  step(events: readonly SimEvent[], owner: 0 | 1 | null, teamOf: (id: number) => 0 | 1, minute: number): void {
    if (owner !== null) this.teams[owner].possession += PHYSICS_STEP;
    for (const e of events) {
      switch (e.type) {
        case 'kick':
          if (e.kind === 'shoot') this.teams[teamOf(e.player)].shots++;
          else this.teams[teamOf(e.player)].passes++;
          break;
        case 'shot':
          if (e.outcome.kind === 'goal' || e.outcome.kind === 'saved') this.teams[teamOf(e.player)].onTarget++;
          break;
        case 'save':
          this.teams[teamOf(e.player)].saves++;
          break;
        case 'tackle':
          if (e.outcome === 'won') this.teams[teamOf(e.player)].tacklesWon++;
          break;
        case 'foul':
          this.teams[teamOf(e.player)].fouls++;
          break;
        case 'goal':
          this.teams[e.team].goals++;
          this.goals.push({ team: e.team, scorer: e.scorer, minute });
          break;
      }
    }
  }

  /** Each team's share of possession (percent, summing to 100). */
  get possessionShare(): [number, number] {
    const [a, b] = [this.teams[0].possession, this.teams[1].possession];
    if (a + b === 0) return [50, 50];
    const home = Math.round((100 * a) / (a + b));
    return [home, 100 - home];
  }
}

function fresh(): TeamStats {
  return { goals: 0, shots: 0, onTarget: 0, passes: 0, tacklesWon: 0, fouls: 0, saves: 0, possession: 0 };
}
