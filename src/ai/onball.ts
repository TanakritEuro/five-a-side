import { TUNING } from '../config';
import { GOAL_WIDTH, HALF_LENGTH, PHYSICS_STEP } from '../constants';
import { clamp, type Rng } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import { canPlayBall } from '../sim/possession';
import type { Sim } from '../sim/sim';
import { DEG, distanceToSegment, nearestTeammate, opponentAhead, sidestep, steer } from './geometry';
import { facing } from './intercept';
import type { AiState, DribblePlan } from './states';
import { seek, STAND } from './steering';

/** A fresh plan for a player who has just got the ball: run at one corner or the other. */
export function runPlan(rng: Rng): DribblePlan {
  return { kind: 'run', corner: rng() < 0.5 ? 1 : -1 };
}

/**
 * The command for the AI player on the ball, carrying out (and revising) `state.plan`.
 * `onBall` is how long (s) they've had it. Keepers pass it on or clear it; outfield
 * players run at a shooting spot and shoot, or pass when blocked or impatient.
 */
export function dribble(sim: Sim, p: Player, state: Extract<AiState, { kind: 'dribble' }>, onBall: number, rng: Rng): Command {
  const A = TUNING.ai;
  const plan = state.plan;
  const dir = sim.attackDir(p.team);
  const goal = { x: dir * HALF_LENGTH, z: 0 };

  // Keepers pass it on rather than dribble, or failing that clear it upfield.
  if (p.spec.role === 'keeper' && plan.kind === 'run') {
    if (onBall < A.keeperHold) return steer(STAND);
    const to = bestPassTarget(sim, p, onBall > 2 * A.keeperHold);
    if (to) state.plan = { kind: 'pass', to: to.id, stepsLeft: 60 };
    else if (onBall > A.keeperClear) {
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
      const impatient = onBall > A.patience;

      const shotRange = impatient ? A.shootRange * 1.6 : A.shootRange;
      if (toGoal < shotRange && facing(p, corner, 20 * DEG) && !opponentAhead(sim, p, corner, 1.5)) {
        const power = clamp(A.shotPower[0] + ((A.shotPower[1] - A.shotPower[0]) * toGoal) / A.shootRange, 0, 1);
        state.plan = { kind: 'shoot', corner: plan.corner, hold: Math.round((power * TUNING.shot.chargeTime) / PHYSICS_STEP) };
        return dribble(sim, p, state, onBall, rng);
      }
      const blocker = opponentAhead(sim, p, target, A.blockedDistance);
      if (blocker || impatient) {
        // Blocked, or been on the ball too long: find a pass (backwards will do when impatient).
        const to = bestPassTarget(sim, p, impatient);
        if (to) {
          state.plan = { kind: 'pass', to: to.id, stepsLeft: 45 };
          return dribble(sim, p, state, onBall, rng);
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
        state.plan = runPlan(rng);
        return steer(STAND);
      }
      // Turn to them (gently, keeping the ball), then tap J.
      const aimed = facing(p, to.pos, A.passAim * DEG);
      const s = seek(p, to.pos, false);
      return { ...IDLE, move: { x: s.move.x * 0.4, z: s.move.z * 0.4 }, pass: aimed && sim.tick % 2 === 0 };
    }
  }
}

/** The command for an AI taker at a kick-off, kick-in or goal clearance: turn to a teammate, then pass. */
export function takeRestart(sim: Sim, p: Player): Command {
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

/**
 * The teammate to pass to: an outfield player with an open lane, scored by how far
 * forward they are and how much space they have. `backwards` allows passes back
 * (kick-offs). Null if nobody's open.
 */
export function bestPassTarget(sim: Sim, p: Player, backwards = false): Player | null {
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
