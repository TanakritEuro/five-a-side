import type { BallPath } from '../ball/trajectory';
import { TUNING } from '../config';
import { HALF_LENGTH, PHYSICS_STEP } from '../constants';
import type { Vec2 } from '../math';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { shiftedSlot } from '../team/formation';
import { ballPos, goalSide, inOwnArea, ownGoal } from './geometry';
import { earliestIntercept, timeToReach } from './intercept';

/**
 * The phase of play from a team's point of view: they have the ball, the other team has
 * it, or it's loose (nobody in control: a pass, a shot, a deflection).
 */
export type Phase = 'attack' | 'defend' | 'loose';

/** What the team brain wants each of its players doing, until the next update. */
export interface TeamPlan {
  phase: Phase;
  /** Just turned over (either way): everyone hurries to their new job. */
  transition: boolean;
  /** Loose ball: who goes for it, and where they'll meet it. */
  chaser: { id: number; point: Vec2 } | null;
  /** Defending: who closes down the player on the ball... */
  presser: number | null;
  /** ...who sits behind the presser, goal-side... */
  cover: number | null;
  /** ...and who picks up whom (our player → their player). */
  marks: Map<number, number>;
  /** Everyone's slot in the shifted formation (the default job). */
  slots: Map<number, Vec2>;
}

export function emptyPlan(): TeamPlan {
  return { phase: 'loose', transition: false, chaser: null, presser: null, cover: null, marks: new Map(), slots: new Map() };
}

/**
 * One team's brain, re-planning a few times a second (`Ai` calls `update`). It reads the
 * phase of play and hands out jobs:
 * - loose ball: the player who can get to it first chases it;
 * - defending: the player who can get goal-side of the ball carrier first presses, the
 *   next best covers behind them, and the rest mark the most dangerous opponents (the
 *   nearest to our goal), leaving anyone well up the other end to the formation;
 * - attacking: everyone off the ball holds their slot (support spots come next).
 * Keepers keep goal unless they're the one to chase a loose ball inside their area.
 */
export class TeamBrain {
  plan: TeamPlan = emptyPlan();
  private phaseSince = 0;

  constructor(readonly team: 0 | 1) {}

  update(sim: Sim, path: BallPath | null, pathElapsed: number): void {
    const A = TUNING.ai;
    const owner = sim.possession.owner;
    const ownerTeam = owner === null ? null : sim.players[owner].team;
    const phase: Phase = ownerTeam === null ? 'loose' : ownerTeam === this.team ? 'attack' : 'defend';
    if (phase !== this.plan.phase && phase !== 'loose') this.phaseSince = sim.tick;
    const transition = (sim.tick - this.phaseSince) * PHYSICS_STEP < A.transitionTime;

    const b = ballPos(sim);
    const dir = sim.attackDir(this.team);
    const slots = new Map<number, Vec2>();
    const players = sim.players.filter((p) => p.team === this.team);
    for (const p of players) slots.set(p.id, shiftedSlot(p.spec.slot, b, dir, phase === 'attack'));

    const plan: TeamPlan = { phase, transition, chaser: null, presser: null, cover: null, marks: new Map(), slots };
    // Players with their own job this step: the one on the ball and a restart's taker.
    const free = players.filter((p) => p.id !== owner && p.id !== sim.match.taker);
    const outfield = free.filter((p) => p.spec.role !== 'keeper');

    if (!sim.match.inPlay) {
      this.plan = plan;
      return;
    }
    if (phase === 'loose' && path) {
      plan.chaser = this.chaser(sim, free, path, pathElapsed);
      // Whoever touched it last is (probably) still attacking; the others defend.
      const last = sim.possession.lastTouch;
      if (last === null || sim.players[last].team !== this.team) this.assignMarks(sim, plan, outfield, null);
    } else if (phase === 'defend' && owner !== null) {
      this.assignDefence(sim, plan, outfield, sim.players[owner]);
    }
    this.plan = plan;
  }

  /** The player who gets to the loose ball first. Keepers only come for it inside their area. */
  private chaser(sim: Sim, players: readonly Player[], path: BallPath, elapsed: number): { id: number; point: Vec2 } | null {
    let best: { id: number; point: Vec2 } | null = null;
    let bestT = Infinity;
    for (const p of players) {
      const hit = earliestIntercept(p, path, elapsed);
      if (p.spec.role === 'keeper' && !inOwnArea(sim, this.team, hit.point)) continue;
      if (hit.t < bestT) {
        bestT = hit.t;
        best = { id: p.id, point: hit.point };
      }
    }
    return best;
  }

  private assignDefence(sim: Sim, plan: TeamPlan, outfield: Player[], carrier: Player): void {
    const A = TUNING.ai;
    const b = ballPos(sim);
    // A human who has called for a press (L) wants a teammate to go, not themselves.
    const called = sim.pressCalled(this.team);
    const pressSpot = goalSide(sim, b, this.team, A.pressDistance);
    const presser = fastest(
      outfield.filter((p) => !called || !sim.humanDriven.has(p.id)),
      pressSpot,
    );
    plan.presser = presser?.id ?? null;
    const rest = outfield.filter((p) => p.id !== plan.presser);
    const cover = fastest(rest, goalSide(sim, b, this.team, A.coverDistance));
    plan.cover = cover?.id ?? null;
    this.assignMarks(
      sim,
      plan,
      rest.filter((p) => p.id !== plan.cover),
      carrier,
    );
  }

  /**
   * Pair markers with the most dangerous opponents (nearest our goal) first, each taking
   * the free marker nearest them. Opponents well up in their own half are left to the
   * formation, and so are markers without anyone to pick up.
   */
  private assignMarks(sim: Sim, plan: TeamPlan, markers: Player[], carrier: Player | null): void {
    const g = ownGoal(sim, this.team);
    const dir = sim.attackDir(this.team);
    const threats = sim.players
      .filter((o) => o.team !== this.team && o.spec.role !== 'keeper' && o.id !== carrier?.id)
      // In our half, or not far into theirs (x · dir is how far up the pitch, our way).
      .filter((o) => o.pos.x * dir < TUNING.ai.markZone * HALF_LENGTH)
      .sort((a, b) => Math.hypot(a.pos.x - g.x, a.pos.z - g.z) - Math.hypot(b.pos.x - g.x, b.pos.z - g.z));
    const available = [...markers];
    for (const o of threats) {
      if (available.length === 0) break;
      let best = 0;
      let bestD = Infinity;
      available.forEach((m, i) => {
        const d = Math.hypot(m.pos.x - o.pos.x, m.pos.z - o.pos.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      plan.marks.set(available[best].id, o.id);
      available.splice(best, 1);
    }
  }
}

/** The player in `players` who can get to `point` soonest. */
function fastest(players: readonly Player[], point: Vec2): Player | null {
  let best: Player | null = null;
  let bestT = Infinity;
  for (const p of players) {
    const t = timeToReach(p, point);
    if (t < bestT) {
      bestT = t;
      best = p;
    }
  }
  return best;
}
