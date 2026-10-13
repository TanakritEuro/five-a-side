import type { MatchStats, TeamStats } from '../match/matchstats';
import type { Team } from '../team/teams';
import { button, div } from './menu';

/** What the full-time screen shows. */
export interface FullTimeReport {
  title: string;
  teams: readonly [Team, Team];
  score: readonly [number, number];
  shootout?: readonly [number, number];
  stats: MatchStats;
  /** Each goal's scorer, as text ("pivot"), by player id. */
  scorerName: (id: number) => string;
  /** A line about what it means ("Through to the final!"). */
  message: string;
  /** The main button ("Next round", "Play again", "Menu"), and whether there's a separate Menu button. */
  next: string;
  menu: boolean;
}

const ROWS: readonly { label: string; value: (s: TeamStats, share: number) => string }[] = [
  { label: 'Shots', value: (s) => String(s.shots) },
  { label: 'On target', value: (s) => String(s.onTarget) },
  { label: 'Possession', value: (_s, share) => `${share}%` },
  { label: 'Passes', value: (s) => String(s.passes) },
  { label: 'Tackles won', value: (s) => String(s.tacklesWon) },
  { label: 'Fouls', value: (s) => String(s.fouls) },
  { label: 'Saves', value: (s) => String(s.saves) },
];

/** The full-time screen: the score, the goals, the match's numbers, and what's next. */
export class FullTimeScreen {
  private readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onNext: () => void,
    private readonly onMenu: () => void,
  ) {
    this.root = div(parent, 'menu-root hidden');
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(r: FullTimeReport): void {
    this.root.replaceChildren();
    const panel = div(this.root, 'menu fulltime');
    div(panel, 'menu-subtitle', `${r.title} · Full time`);
    div(panel, 'menu-title', `${r.teams[0].short} ${r.score[0]} – ${r.score[1]} ${r.teams[1].short}`);
    if (r.shootout) {
      const winner = r.shootout[0] > r.shootout[1] ? 0 : 1;
      div(panel, 'menu-help', `${r.teams[winner].name} win ${Math.max(...r.shootout)}–${Math.min(...r.shootout)} on penalties`);
    }
    const goals = div(panel, 'fulltime-goals');
    for (const side of [0, 1] as const) {
      const col = div(goals, 'fulltime-col');
      for (const g of r.stats.goals.filter((g) => g.team === side)) {
        div(col, '', `${g.minute}′ ${g.scorer === null ? 'own goal' : r.scorerName(g.scorer)}`);
      }
    }
    const table = div(panel, 'fulltime-table');
    const share = r.stats.possessionShare;
    for (const row of ROWS) {
      div(table, 'num', row.value(r.stats.teams[0], share[0]));
      div(table, 'label', row.label);
      div(table, 'num', row.value(r.stats.teams[1], share[1]));
    }
    div(panel, 'fulltime-message', r.message);
    const buttons = div(panel, 'menu-row');
    button(buttons, r.next, 'menu-go').addEventListener('click', () => this.onNext());
    if (r.menu) button(buttons, 'Menu').addEventListener('click', () => this.onMenu());
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
