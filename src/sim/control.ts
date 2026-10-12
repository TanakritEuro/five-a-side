import { timeToReach } from '../ai/intercept';
import { TUNING } from '../config';
import type { Command } from './command';
import type { SimEvent } from './events';
import type { Player } from './player';
import type { Sim } from './sim';

/**
 * Which player a human drives, and what their buttons mean. One per human team.
 *
 * The keyboard sets both meanings of each context button (J = pass and switch, K = shoot
 * and tackle); `command` picks the one that applies. J passes when the controlled player
 * has the ball or it's right by them (so a first-time pass works), and otherwise switches
 * to the teammate best placed to get to the ball.
 *
 * After each step `afterStep` switches automatically: to the receiver of your pass, to a
 * teammate who wins the ball, to the best-placed player when the other team wins it, and
 * to the taker of your team's restart.
 */
export class HumanControl {
  /** The player the human is driving. */
  controlled: number;
  /** J (or K) was used for something else: ignore it until it's let go. */
  private swallowPass = false;
  private heldSwitch = false;
  private lastOwner: number | null = null;

  constructor(
    readonly team: 0 | 1,
    start: number,
  ) {
    this.controlled = start;
  }

  /** Turn the raw keyboard command into the controlled player's command for this step. */
  command(sim: Sim, raw: Command): Command {
    const p = sim.players[this.controlled];
    const owner = sim.possession.owner;
    // Their ball, or a loose one right by them (a first-time pass): J and K kick it.
    const onBall = owner === p.id || (owner === null && nearBall(sim, p));
    const pressed = raw.switch && !this.heldSwitch;
    this.heldSwitch = raw.switch;
    if (pressed && !onBall) {
      this.switchTo(bestPlaced(sim, this.team, this.controlled));
      this.swallowPass = true;
    }
    if (!raw.pass) this.swallowPass = false;
    return {
      ...raw,
      pass: raw.pass && !this.swallowPass && onBall,
      switch: false,
      // Tackles arrive in Milestone 4; until then K only ever shoots.
      tackle: false,
    };
  }

  /** Switch automatically after what happened this step. */
  afterStep(sim: Sim, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'kick' && e.kind === 'pass' && e.receiver !== null && sim.players[e.player].team === this.team) {
        this.switchTo(e.receiver);
      } else if (e.type === 'restart' && e.taker !== null && sim.players[e.taker].team === this.team) {
        this.switchTo(e.taker);
      }
    }
    const owner = sim.possession.owner;
    if (owner !== this.lastOwner && owner !== null) {
      const ownerTeam = sim.players[owner].team;
      // A teammate has it: take them over. The other team has it: the best-placed defender.
      if (ownerTeam === this.team) this.switchTo(owner);
      else this.switchTo(bestPlaced(sim, this.team, null));
    }
    this.lastOwner = owner;
  }

  private switchTo(id: number | null): void {
    if (id !== null) this.controlled = id;
  }
}

/** The ball is close enough to `p` that J and K mean "kick it", even if they don't own it yet. */
function nearBall(sim: Sim, p: Player): boolean {
  const b = sim.ball.translation();
  return Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < TUNING.dribble.reach * 2.5;
}

/**
 * The outfield player of `team` who can get to the ball soonest, other than `exclude`.
 * Keepers are never picked: you only control a keeper at their own restarts.
 */
export function bestPlaced(sim: Sim, team: 0 | 1, exclude: number | null): number | null {
  const b = sim.ball.translation();
  const ball = { x: b.x, z: b.z };
  let best: number | null = null;
  let bestT = Infinity;
  for (const p of sim.players) {
    if (p.team !== team || p.id === exclude || p.spec.role === 'keeper') continue;
    const t = timeToReach(p, ball);
    if (t < bestT) {
      bestT = t;
      best = p.id;
    }
  }
  return best;
}
