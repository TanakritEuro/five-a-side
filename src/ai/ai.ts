import { predictPath, type BallPath } from '../ball/trajectory';
import { TUNING } from '../config';
import { GOAL_AREA_RADIUS, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP } from '../constants';
import { clamp, createRng, headingVec, type Rng, type Vec2 } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import { canPlayBall } from '../sim/possession';
import type { Sim } from '../sim/sim';
import { shiftedSlot } from '../team/formation';
import { earliestIntercept, facing, timeToReach } from './intercept';
import { arrive, seek, STAND, type Steer } from './steering';

const DEG = Math.PI / 180;

/** What an AI player is doing. One state machine per player; see `Ai`. */
export type AiState =
  /** Off the ball: go to (and stay at) their slot in the shifted formation. */
  | { kind: 'hold' }
  /** The team's player who can get to the loose ball first: go to where they'll meet it. */
  | { kind: 'chase'; point: Vec2 }
  /** Stand goal-side of the opponent with the ball, in their way (a stop-gap until M3's pressing). */
  | { kind: 'block'; carrier: number }
  /** A keeper off the ball: stand between the ball and the middle of the goal. */
  | { kind: 'keeper' }
  /** On the ball. */
  | { kind: 'dribble'; plan: DribblePlan }
  /** Taking a kick-off, kick-in or goal clearance. */
  | { kind: 'takeRestart' };

export type DribblePlan =
  /** Run at goal, aiming for one corner (+1 or -1 across the goal). */
  | { kind: 'run'; corner: 1 | -1 }
  /** Charging a shot: hold K for `hold` steps, then let go. */
  | { kind: 'shoot'; corner: 1 | -1; hold: number }
  /** Turning to pass to teammate `to`; give up after `stepsLeft`. */
  | { kind: 'pass'; to: number; stepsLeft: number };

/**
 * The AI for every player that isn't driven by a human. Every `brainInterval` steps the
 * team brain re-plans: where each player's slot is, who chases a loose ball (each team's
 * earliest to it), and who gets in the way of an opponent on the ball. In between, each
 * player's state machine turns its state into a `Command` every step.
 *
 * It has its own RNG (seeded from the match), so its choices don't disturb the dice the
 * simulation rolls for touches and kicks.
 */
export class Ai {
  readonly states: AiState[] = [];
  /** Tick each player entered their current state. */
  readonly since: number[] = [];
  private readonly slots: Vec2[] = [];
  private readonly rng: Rng;
  private track: { path: BallPath; tick: number } | null = null;
  private stepsToBrain = 0;

  constructor(seed: number) {
    this.rng = createRng(seed ^ 0x5bd1e995);
  }

  /** Call once per step, before asking for commands. */
  update(sim: Sim): void {
    const owner = sim.possession.owner;
    const taker = sim.match.taker;
    if (--this.stepsToBrain <= 0) {
      this.stepsToBrain = TUNING.ai.brainInterval;
      this.brain(sim);
    }
    // Possession and restarts can change any step: react at once.
    for (const p of sim.players) {
      if (p.id === taker) this.set(sim, p, { kind: 'takeRestart' });
      else if (p.id === owner) {
        if (this.states[p.id]?.kind !== 'dribble') this.set(sim, p, { kind: 'dribble', plan: this.runPlan() });
      } else if (this.states[p.id]?.kind === 'dribble' || this.states[p.id]?.kind === 'takeRestart') {
        this.set(sim, p, p.spec.role === 'keeper' ? { kind: 'keeper' } : { kind: 'hold' });
      }
    }
  }

  command(sim: Sim, p: Player): Command {
    const state = this.states[p.id];
    if (!state) return IDLE;
    switch (state.kind) {
      case 'hold':
        return steer(arrive(p, this.slots[p.id] ?? p.pos));
      case 'keeper':
        return steer(arrive(p, keeperSpot(sim, p), 0.2));
      case 'chase':
        return this.chase(sim, p, state.point);
      case 'block':
        return this.block(sim, p);
      case 'dribble':
        return this.dribble(sim, p, state);
      case 'takeRestart':
        return this.takeRestart(sim, p);
    }
  }

  /** Where player `id`'s slot in the shifted formation is (as of the last brain update). */
  slotOf(id: number): Vec2 {
    return this.slots[id];
  }

  // --- Team brain -------------------------------------------------------------------

  private brain(sim: Sim): void {
    const b = sim.ball.translation();
    const owner = sim.possession.owner;
    const ownerTeam = owner === null ? null : sim.players[owner].team;
    for (const p of sim.players) {
      this.slots[p.id] = shiftedSlot(p.spec.slot, b, sim.attackDir(p.team), ownerTeam === p.team);
    }
    const path = owner === null ? this.ballPath(sim) : null;

    for (const team of [0, 1] as const) {
      const players = sim.players.filter((p) => p.team === team && p.id !== owner && p.id !== sim.match.taker);
      let chaser: { id: number; point: Vec2 } | null = null;
      let blocker: number | null = null;
      if (sim.match.inPlay && path) {
        // Loose ball: whoever gets there first. Keepers only come for it inside their area.
        let best = Infinity;
        for (const p of players) {
          const hit = earliestIntercept(p, path, (sim.tick - this.track!.tick) * PHYSICS_STEP);
          if (p.spec.role === 'keeper' && !inOwnArea(sim, p, hit.point)) continue;
          if (hit.t < best) {
            best = hit.t;
            chaser = { id: p.id, point: hit.point };
          }
        }
      } else if (sim.match.inPlay && owner !== null && ownerTeam !== team) {
        // An opponent has it: the outfield player who can get goal-side of them first.
        const spot = blockSpot(sim, team);
        let best = Infinity;
        for (const p of players) {
          if (p.spec.role === 'keeper') continue;
          const t = timeToReach(p, spot);
          if (t < best) {
            best = t;
            blocker = p.id;
          }
        }
      }
      for (const p of players) {
        if (chaser?.id === p.id) this.set(sim, p, { kind: 'chase', point: chaser.point });
        else if (blocker === p.id) this.set(sim, p, { kind: 'block', carrier: owner! });
        else this.set(sim, p, p.spec.role === 'keeper' ? { kind: 'keeper' } : { kind: 'hold' });
      }
    }
  }

  /**
   * The loose ball's predicted path, re-predicted when the ball strays from the last
   * prediction (a bounce off a wall or a player, a new kick) or the prediction runs out.
   */
  private ballPath(sim: Sim): BallPath {
    const b = sim.ball.translation();
    const t = this.track;
    if (t) {
      const k = Math.round(((sim.tick - t.tick) * PHYSICS_STEP) / t.path.dt);
      const expected = t.path.points[k];
      if (expected && Math.hypot(expected.x - b.x, expected.y - b.y, expected.z - b.z) < TUNING.ai.pathTolerance) return t.path;
    }
    const path = predictPath(sim.ghost, b, sim.ball.linvel(), sim.ball.angvel());
    this.track = { path, tick: sim.tick };
    return path;
  }

  private set(sim: Sim, p: Player, state: AiState): void {
    const current = this.states[p.id];
    // Same kind of state: just update its details (a new chase point), don't restart its clock.
    if (current?.kind !== state.kind) this.since[p.id] = sim.tick;
    if (current?.kind === 'dribble' && state.kind === 'dribble') return;
    this.states[p.id] = state;
  }

  // --- Player behaviours ------------------------------------------------------------

  private chase(sim: Sim, p: Player, point: Vec2): Command {
    const b = sim.ball.translation();
    // Close to the ball: go straight at it to take it.
    const d = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
    const target = d < 2 ? { x: b.x, z: b.z } : point;
    return steer(seek(p, target, d > 3));
  }

  private block(sim: Sim, p: Player): Command {
    return steer(arrive(p, blockSpot(sim, p.team), 0.15));
  }

  private dribble(sim: Sim, p: Player, state: Extract<AiState, { kind: 'dribble' }>): Command {
    const A = TUNING.ai;
    const plan = state.plan;
    const dir = sim.attackDir(p.team);
    const goal = { x: dir * HALF_LENGTH, z: 0 };

    // Keepers pass it on rather than dribble, or failing that clear it upfield.
    if (p.spec.role === 'keeper' && plan.kind === 'run') {
      const held = (sim.tick - this.since[p.id]) * PHYSICS_STEP;
      if (held < A.keeperHold) return steer(STAND);
      const to = bestPassTarget(sim, p, held > 2 * A.keeperHold);
      if (to) state.plan = { kind: 'pass', to: to.id, stepsLeft: 60 };
      else if (held > A.keeperClear) {
        state.plan = { kind: 'shoot', corner: plan.corner, hold: Math.round((0.7 * TUNING.shot.chargeTime) / PHYSICS_STEP) };
      }
      return steer(STAND);
    }

    switch (plan.kind) {
      case 'run': {
        // Aim for the far side of the goal from a spot in front of it, not along the goal line.
        const corner = { x: goal.x, z: plan.corner * (GOAL_WIDTH / 2 - 0.5) };
        const spot = { x: goal.x - dir * A.shootingSpot, z: -plan.corner * 0.8 };
        const toGoal = Math.hypot(corner.x - p.pos.x, corner.z - p.pos.z);
        const atSpot = (p.pos.x - spot.x) * dir > -1 || Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z) < 2;
        // Too deep, along the goal line: cut back out to the spot.
        const deep = p.pos.x * dir > HALF_LENGTH - 2.5;
        const target = atSpot && !deep ? corner : spot;
        const onBall = (sim.tick - this.since[p.id]) * PHYSICS_STEP;
        const impatient = onBall > A.patience;

        const shotRange = impatient ? A.shootRange * 1.6 : A.shootRange;
        if (toGoal < shotRange && facing(p, corner, 20 * DEG) && !opponentAhead(sim, p, corner, 1.5)) {
          const power = clamp(A.shotPower[0] + ((A.shotPower[1] - A.shotPower[0]) * toGoal) / A.shootRange, 0, 1);
          state.plan = { kind: 'shoot', corner: plan.corner, hold: Math.round((power * TUNING.shot.chargeTime) / PHYSICS_STEP) };
          return this.dribble(sim, p, state);
        }
        const blocker = opponentAhead(sim, p, target, A.blockedDistance);
        if (blocker || impatient) {
          // Blocked, or been on the ball too long: find a pass (backwards will do when impatient).
          const to = bestPassTarget(sim, p, impatient);
          if (to) {
            state.plan = { kind: 'pass', to: to.id, stepsLeft: 45 };
            return this.dribble(sim, p, state);
          }
        }
        if (blocker) {
          // Nobody to pass to: go round them, on the side away from them unless that's off the pitch.
          return steer(seek(p, sidestep(p, blocker, target), false));
        }
        const space = !opponentAhead(sim, p, target, 6);
        // Sprint only while well short of the spot: a sprint knocks the ball a long way on.
        const toSpot = Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z);
        return steer(seek(p, target, space && !atSpot && toSpot > 8));
      }
      case 'shoot': {
        // Hold K until the charge is up to power and the ball is at their feet, then let go
        // (once: the kick is queued). Don't wait so long that the shot is overpowered.
        const ball = sim.ball.translation();
        const ready = canPlayBall(p, ball);
        const charged = p.charge !== null && p.charge.steps >= plan.hold;
        const near = Math.hypot(ball.x - p.pos.x, ball.z - p.pos.z) < 1.6;
        const hold = p.charge ? !(charged && (ready || p.charge.steps > plan.hold + 20)) : p.pendingKick === null && near;
        // Run at the ball to strike it; it is rolling goalwards, so facing it aims the shot.
        const v = sim.ball.linvel();
        const at = { x: ball.x + v.x * 0.2, z: ball.z + v.z * 0.2 };
        return { ...steer(seek(p, at, false)), shoot: hold };
      }
      case 'pass': {
        const to = sim.players[plan.to];
        if (--plan.stepsLeft <= 0) {
          state.plan = this.runPlan();
          return steer(STAND);
        }
        // Turn to them (gently, keeping the ball), then tap J.
        const aimed = facing(p, to.pos, A.passAim * DEG);
        const s = seek(p, to.pos, false);
        return { ...IDLE, move: { x: s.move.x * 0.4, z: s.move.z * 0.4 }, pass: aimed && sim.tick % 2 === 0 };
      }
    }
  }

  private takeRestart(sim: Sim, p: Player): Command {
    const phase = sim.match.phase;
    if (phase.kind !== 'restart') return IDLE;
    // Anyone open, backwards included; failing that, the nearest teammate.
    const to = bestPassTarget(sim, p, true) ?? nearestTeammate(sim, p);
    if (!to) return phase.elapsed > 3 * TUNING.match.aiTakerDelay ? { ...IDLE, pass: sim.tick % 10 < 5 } : IDLE;
    // The taker can only turn: point at the receiver, then tap J.
    const s = seek(p, to.pos, false);
    const ready = phase.elapsed >= TUNING.match.aiTakerDelay && facing(p, to.pos, TUNING.ai.passAim * DEG);
    return { ...IDLE, move: s.move, pass: ready && sim.tick % 10 < 5 };
  }

  private runPlan(): DribblePlan {
    return { kind: 'run', corner: this.rng() < 0.5 ? 1 : -1 };
  }
}

function steer(s: Steer): Command {
  return { ...IDLE, move: s.move, sprint: s.sprint };
}

/** The middle of the goal `p`'s team defends. */
function ownGoal(sim: Sim, team: 0 | 1): Vec2 {
  return { x: -sim.attackDir(team) * HALF_LENGTH, z: 0 };
}

function inOwnArea(sim: Sim, p: Player, point: Vec2): boolean {
  const g = ownGoal(sim, p.team);
  return Math.hypot(point.x - g.x, point.z - g.z) < GOAL_AREA_RADIUS;
}

/** Where a keeper stands: out from the middle of the goal towards the ball, a little off the line. */
function keeperSpot(sim: Sim, p: Player): Vec2 {
  const g = ownGoal(sim, p.team);
  const b = sim.ball.translation();
  const dx = b.x - g.x;
  const dz = b.z - g.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = Math.min(1.5, d * 0.2);
  return { x: g.x + (dx / d) * Math.max(out, 0.5), z: g.z + (dz / d) * out };
}

/** Goal-side of the ball: between it and the goal `team` defends. */
function blockSpot(sim: Sim, team: 0 | 1): Vec2 {
  const g = ownGoal(sim, team);
  const b = sim.ball.translation();
  const dx = g.x - b.x;
  const dz = g.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = Math.min(TUNING.ai.blockDistance, d / 2);
  return { x: b.x + (dx / d) * k, z: b.z + (dz / d) * k };
}

/** The nearest opponent within `range` of `p` and in front of them, towards `target`. */
function opponentAhead(sim: Sim, p: Player, target: Vec2, range: number): Player | null {
  const dx = target.x - p.pos.x;
  const dz = target.z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  let nearest: Player | null = null;
  let best = range;
  for (const q of sim.players) {
    if (q.team === p.team) continue;
    const ox = q.pos.x - p.pos.x;
    const oz = q.pos.z - p.pos.z;
    const od = Math.hypot(ox, oz);
    if (od > best || od < 1e-6) continue;
    if ((ox * dx + oz * dz) / (od * d) < Math.cos(50 * DEG)) continue;
    best = od;
    nearest = q;
  }
  return nearest;
}

/** Distance from `p` to the segment a–b. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

/**
 * The teammate to pass to: an outfield player with an open lane, scored by how far
 * forward they are and how much space they have. `backwards` allows passes back
 * (kick-offs). Null if nobody's open.
 */
function bestPassTarget(sim: Sim, p: Player, backwards = false): Player | null {
  const P = TUNING.pass;
  const dir = sim.attackDir(p.team);
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const q of sim.players) {
    if (q.team !== p.team || q.id === p.id || q.spec.role === 'keeper') continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d < P.minDistance + 0.5 || d > P.maxDistance - 2) continue;
    const progress = (q.pos.x - p.pos.x) * dir;
    if (!backwards && progress < -6) continue;
    // The lane starts a stride out: a defender right next to the passer doesn't block every pass.
    const laneStart = { x: p.pos.x + ((q.pos.x - p.pos.x) / d) * 1, z: p.pos.z + ((q.pos.z - p.pos.z) / d) * 1 };
    let space = 5;
    let lane = Infinity;
    for (const o of sim.players) {
      if (o.team === p.team) continue;
      space = Math.min(space, Math.hypot(o.pos.x - q.pos.x, o.pos.z - q.pos.z));
      lane = Math.min(lane, distanceToSegment(o.pos, laneStart, q.pos));
    }
    if (lane < TUNING.ai.laneWidth) continue;
    const score = (backwards ? -Math.abs(progress) : progress) * 0.3 + space;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/**
 * A point 3 m ahead and 3 m to one side of `p` (heading for `target`): the side away from
 * `blocker`, unless that's off the pitch, then the other; failing both, straight back.
 */
function sidestep(p: Player, blocker: Player, target: Vec2): Vec2 {
  const f = headingVec(Math.atan2(target.z - p.pos.z, target.x - p.pos.x));
  const away = (blocker.pos.x - p.pos.x) * -f.z + (blocker.pos.z - p.pos.z) * f.x > 0 ? -1 : 1;
  const onPitch = (q: Vec2) => Math.abs(q.x) < HALF_LENGTH - 1 && Math.abs(q.z) < HALF_WIDTH - 1;
  for (const side of [away, -away]) {
    const q = { x: p.pos.x + f.x * 3 - f.z * side * 3, z: p.pos.z + f.z * 3 + f.x * side * 3 };
    if (onPitch(q)) return q;
  }
  return { x: p.pos.x - f.x * 3, z: p.pos.z - f.z * 3 };
}

/** The nearest outfield teammate, or null if there isn't one. */
function nearestTeammate(sim: Sim, p: Player): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const q of sim.players) {
    if (q.team !== p.team || q.id === p.id || q.spec.role === 'keeper') continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}
