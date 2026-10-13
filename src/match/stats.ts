import type { MatchResult, Outcome } from './session';

/** Your record, kept in this browser between visits. */
export interface StatsData {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cupsWon: number;
  /** Wins in a row now, and the best run. */
  streak: number;
  bestStreak: number;
}

const KEY = 'five-a-side:stats';

export const EMPTY_STATS: Readonly<StatsData> = Object.freeze({
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  cupsWon: 0,
  streak: 0,
  bestStreak: 0,
});

/** Where stats are kept: \`localStorage\` normally; tests pass a plain object. */
export interface StatsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Lifetime stats for matches you play (AI v AI doesn't count). Stored when storage is
 * available; otherwise they last for the visit.
 */
export class Stats {
  data: StatsData;

  constructor(private readonly store: StatsStore | null = browserStore()) {
    this.data = { ...EMPTY_STATS, ...read(store) };
  }

  record(result: MatchResult, o: Outcome): void {
    const d = this.data;
    d.played++;
    d[o]++;
    d.goalsFor += result.score[0];
    d.goalsAgainst += result.score[1];
    d.streak = o === 'won' ? d.streak + 1 : 0;
    d.bestStreak = Math.max(d.bestStreak, d.streak);
    this.save();
  }

  recordCup(): void {
    this.data.cupsWon++;
    this.save();
  }

  reset(): void {
    this.data = { ...EMPTY_STATS };
    this.save();
  }

  /** "Played 12 · W 7 D 2 L 3 · Goals 31–19 · Cups 1 · Best run 4". */
  get summary(): string {
    const d = this.data;
    if (d.played === 0) return 'No matches played yet';
    return `Played ${d.played} · W ${d.won} D ${d.drawn} L ${d.lost} · Goals ${d.goalsFor}–${d.goalsAgainst} · Cups ${d.cupsWon} · Best run ${d.bestStreak}`;
  }

  private save(): void {
    try {
      this.store?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: the stats just won't persist.
    }
  }
}

function read(store: StatsStore | null): Partial<StatsData> {
  try {
    const raw = store?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<StatsData>) : {};
  } catch {
    return {};
  }
}

function browserStore(): StatsStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
