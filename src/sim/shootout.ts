/**
 * A penalty shootout's score and turns (futsal-style): the teams take turns, `rounds`
 * kicks each, then one each until a round ends with one side ahead. It stops as soon as one
 * side can't be caught.
 */
export class Shootout {
  readonly goals: [number, number] = [0, 0];
  readonly taken: [number, number] = [0, 0];

  constructor(
    /** The team that kicks first. */
    readonly first: 0 | 1 = 0,
    readonly rounds = 3,
  ) {}

  /** The team to kick next: whoever has taken fewer, the first team on a tie. */
  get next(): 0 | 1 {
    const other: 0 | 1 = this.first === 0 ? 1 : 0;
    return this.taken[other] < this.taken[this.first] ? other : this.first;
  }

  record(team: 0 | 1, scored: boolean): void {
    this.taken[team]++;
    if (scored) this.goals[team]++;
  }

  /** Into sudden death: both sides have had their `rounds` kicks. */
  get suddenDeath(): boolean {
    return this.taken[0] >= this.rounds && this.taken[1] >= this.rounds;
  }

  get decided(): boolean {
    return this.winner !== null;
  }

  /** The winner, once one side can't be caught; null while it's still open. */
  get winner(): 0 | 1 | null {
    const [a, b] = this.goals;
    if (this.suddenDeath) {
      if (this.taken[0] !== this.taken[1] || a === b) return null;
      return a > b ? 0 : 1;
    }
    const left = (t: 0 | 1) => Math.max(0, this.rounds - this.taken[t]);
    if (a > b + left(1)) return 0;
    if (b > a + left(0)) return 1;
    return null;
  }
}
