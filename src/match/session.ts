import type { LevelName } from '../config';
import { createRng } from '../math';
import { TEAMS, type Team } from '../team/teams';

export type Mode = 'friendly' | 'cup';

/** What the player picked in the menu. */
export interface SessionChoice {
  mode: Mode;
  /** Your team (always the home side). */
  team: Team;
  /** A friendly's opponent and their AI level; the cup draws its own. */
  opponent: Team;
  level: LevelName;
  /** Game seconds per half. */
  halfLength: number;
  /** Seeds the cup draw and every match. */
  seed: number;
}

/** One match to play: the teams (yours at home), the opponent's level, and the rules. */
export interface MatchSetup {
  teams: readonly [Team, Team];
  level: LevelName;
  halfLength: number;
  /** A draw goes to penalties (cup ties). */
  shootout: boolean;
  seed: number;
  /** "Friendly" or "Cup · Semi-final". */
  title: string;
}

/** How a match ended, from your side. */
export interface MatchResult {
  score: readonly [number, number];
  /** The shootout's tally, if it went to one. */
  shootout?: readonly [number, number];
}

export type Outcome = 'won' | 'drawn' | 'lost';

/** The cup: three knockout rounds, the opposition sharper each round. */
export const CUP_ROUNDS: readonly { name: string; level: LevelName }[] = [
  { name: 'Quarter-final', level: 'easy' },
  { name: 'Semi-final', level: 'normal' },
  { name: 'Final', level: 'hard' },
];

/** Your result in a match: a shootout decides a draw. */
export function outcome(r: MatchResult): Outcome {
  const [a, b] = r.shootout ?? r.score;
  return a > b ? 'won' : a < b ? 'lost' : 'drawn';
}

/**
 * What you're playing across matches: a friendly (as many as you like against the team
 * and level you chose), or a cup run against three opponents drawn from the other teams.
 * Lose a cup tie and you're out; win the final and the cup is yours.
 */
export class Session {
  /** The cup's opponents, in round order (empty for a friendly). */
  readonly opponents: Team[];
  /** Which cup round is next or being played. */
  round = 0;
  /** The cup is over: won, or knocked out. */
  finished = false;
  wonCup = false;
  private matches = 0;

  constructor(readonly choice: SessionChoice) {
    this.opponents = choice.mode === 'cup' ? draw(choice.team, choice.seed, CUP_ROUNDS.length) : [];
  }

  /** The match to play next. */
  next(): MatchSetup {
    const c = this.choice;
    const seed = c.seed + 7919 * this.matches;
    if (c.mode === 'friendly') {
      return { teams: [c.team, c.opponent], level: c.level, halfLength: c.halfLength, shootout: false, seed, title: 'Friendly' };
    }
    const round = CUP_ROUNDS[this.round];
    return { teams: [c.team, this.opponents[this.round]], level: round.level, halfLength: c.halfLength, shootout: true, seed, title: `Cup · ${round.name}` };
  }

  /** Record how the match just played ended; says what that means. */
  finish(result: MatchResult): Outcome {
    this.matches++;
    const o = outcome(result);
    if (this.choice.mode === 'cup') {
      if (o === 'won') {
        this.round++;
        if (this.round >= CUP_ROUNDS.length) {
          this.finished = true;
          this.wonCup = true;
        }
      } else {
        // A cup tie can't end level (penalties), so anything else is out.
        this.finished = true;
      }
    }
    return o;
  }
}

/** `n` opponents for `team`, drawn without repeats from the other teams. */
function draw(team: Team, seed: number, n: number): Team[] {
  const rng = createRng(seed);
  const pool = TEAMS.filter((t) => t !== team);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
