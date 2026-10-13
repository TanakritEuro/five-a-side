import { TUNING, type AiLevel } from '../config';
import { GOAL_WIDTH, HALF_LENGTH, PHYSICS_STEP } from '../constants';
import { clamp, headingVec, wrapAngle, type Rng } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import { chargePower, shotAim } from '../sim/kick';
import { canPlayBall } from '../sim/possession';
import type { Sim } from '../sim/sim';
import { DEG, distanceToSegment, nearestTeammate, opponentAhead, sidestep, steer } from './geometry';
import { decide } from './decide';
import { facing } from './intercept';
import { wallSpots, type AiState, type DribblePlan, type RestartPlan } from './states';
import { insidePitch, seek, STAND } from './steering';

/** What on-ball decisions need besides the sim: the AI's dice and the team's level. */
export interface OnBallContext {
  rng: Rng;
  level: AiLevel;
}

/** A fresh plan for a player who has just got the ball: run at one corner or the other. */
export function runPlan(rng: Rng): DribblePlan {
  return { kind: 'run', corner: rng() < 0.5 ? 1 : -1, nextDecision: 0 };
}

/**
 * The command for the AI player on the ball, carrying out (and revising) `state.plan`.
 * `onBall` is how long (s) they've had it. Keepers pass it on or clear it; outfield
 * players run at a shooting spot and shoot, or pass when blocked or impatient.
 */
export function dribble(sim: Sim, p: Player, state: Extract<AiState, { kind: 'dribble' }>, onBall: number, ctx: OnBallContext): Command {
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
      state.plan = { kind: 'shoot', corner: plan.corner, hold: Math.round((0.7 * TUNING.shot.chargeTime) / PHYSICS_STEP), giveUp: sim.tick + Math.round(A.shotTimeout / PHYSICS_STEP) };
    }
    return steer(STAND);
  }

  switch (plan.kind) {
    case 'run': {
      // Carry it towards a spot in front of goal, then turn to the far side of the goal
      // (rather than running it down the goal line).
      const corner = { x: goal.x, z: plan.corner * (GOAL_WIDTH / 2 - 0.5) };
      const spot = { x: goal.x - dir * A.shootingSpot, z: -plan.corner * 0.8 };
      const atSpot = (p.pos.x - spot.x) * dir > -1 || Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z) < 2;
      // Too deep, along the goal line: cut back out to the spot.
      const deep = p.pos.x * dir > HALF_LENGTH - 2.5;
      const target = atSpot && !deep ? corner : spot;

      // Every so often (after a moment to react), weigh shooting, passing and carrying on.
      if (onBall >= ctx.level.reaction && sim.tick >= plan.nextDecision) {
        plan.nextDecision = sim.tick + Math.round(ctx.level.decisionInterval / PHYSICS_STEP);
        const choice = decide(sim, p, ctx.level, ctx.rng);
        if (choice.kind === 'shoot') {
          const toGoal = Math.hypot(choice.target.x - p.pos.x, choice.target.z - p.pos.z);
          const power = clamp(A.shotPower[0] + ((A.shotPower[1] - A.shotPower[0]) * toGoal) / A.shootRange, 0, 1);
          state.plan = { kind: 'shoot', corner: choice.corner ?? plan.corner, hold: Math.round((power * TUNING.shot.chargeTime) / PHYSICS_STEP), giveUp: sim.tick + Math.round(A.shotTimeout / PHYSICS_STEP) };
          return dribble(sim, p, state, onBall, ctx);
        }
        if (choice.kind === 'pass' && choice.receiver !== undefined) {
          state.plan = { kind: 'pass', to: choice.receiver, stepsLeft: 45 };
          return dribble(sim, p, state, onBall, ctx);
        }
      }
      const blocker = opponentAhead(sim, p, target, A.blockedDistance);
      // In the way: go round them, on the side away from them unless that's off the pitch.
      if (blocker) return steer(seek(p, sidestep(p, blocker, target), false));
      const space = !opponentAhead(sim, p, target, 6);
      // Sprint only while well short of the spot: a sprint knocks the ball a long way on.
      const toSpot = Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z);
      return steer(seek(p, target, space && !atSpot && toSpot > 8));
    }
    case 'shoot': {
      const ball = sim.ball.translation();
      const corner = { x: goal.x, z: plan.corner * (GOAL_WIDTH / 2 - TUNING.shot.postInset) };
      const near = Math.hypot(ball.x - p.pos.x, ball.z - p.pos.z);
      // The ball has got away from them, or they can't line it up in time (it's pinned
      // against the boards, say): forget the shot and carry on.
      if (near > TUNING.dribble.possessionRange || sim.tick > plan.giveUp) {
        state.plan = runPlan(ctx.rng);
        // Cancel the charge (J while holding K) rather than let fly facing the wrong way.
        return p.charge ? { ...steer(STAND), shoot: true, pass: true } : steer(STAND);
      }
      // Line up behind the ball on its line to the corner, then run through it towards the
      // corner: they shoot the way they face, so they must be facing the goal as they strike.
      const v = sim.ball.linvel();
      const ahead = { x: ball.x + v.x * 0.2, z: ball.z + v.z * 0.2 };
      const ax = corner.x - ahead.x;
      const az = corner.z - ahead.z;
      const al = Math.hypot(ax, az) || 1;
      const behind = insidePitch({ x: ahead.x - (ax / al) * 0.5, z: ahead.z - (az / al) * 0.5 }, 0.35);
      const lined = Math.hypot(behind.x - p.pos.x, behind.z - p.pos.z) < 0.5;
      // Hold K until the charge is up to power, the ball is at their feet and the way they
      // face puts the shot on goal, then let go (once: the kick is queued). Holding on
      // longer only costs accuracy (overpower); letting fly facing elsewhere wastes it.
      const ready = canPlayBall(p, ball) && shotAim(ball, p.facing, chargePower(p), dir).atGoal;
      const charged = p.charge !== null && p.charge.steps >= plan.hold;
      const hold = p.charge ? !(charged && ready) : p.pendingKick === null && near < 1.6;
      return { ...steer(seek(p, lined ? corner : behind, false)), shoot: hold };
    }
    case 'pass': {
      const to = sim.players[plan.to];
      if (--plan.stepsLeft <= 0) {
        state.plan = runPlan(ctx.rng);
        return steer(STAND);
      }
      // Turn to them (gently, keeping the ball), then tap J.
      const aimed = facing(p, to.pos, A.passAim * DEG);
      const s = seek(p, to.pos, false);
      return { ...IDLE, move: { x: s.move.x * 0.4, z: s.move.z * 0.4 }, pass: aimed && sim.tick % 2 === 0 };
    }
  }
}

/**
 * The command for an AI taker at a restart. A penalty is shot at a corner picked at
 * random. A free kick is weighed up like any ball at their feet (`decide`): a shot, or a
 * pass. Anything else is a pass: turn to a teammate, then tap J.
 */
export function takeRestart(sim: Sim, p: Player, state: Extract<AiState, { kind: 'takeRestart' }>, ctx: OnBallContext): Command {
  const phase = sim.match.phase;
  if (phase.kind !== 'restart') return IDLE;
  const M = TUNING.match;
  if (!state.plan && phase.restart.kind === 'penalty') {
    state.plan = { kind: 'shoot', corner: ctx.rng() < 0.5 ? 1 : -1, hold: Math.round((M.penaltyPower * TUNING.shot.chargeTime) / PHYSICS_STEP) };
  } else if (!state.plan && phase.restart.kind === 'freeKick' && phase.elapsed >= M.aiTakerDelay && (wallSet(sim, p) || phase.elapsed >= M.aiWallWait)) {
    const choice = decide(sim, p, ctx.level, ctx.rng);
    if (choice.kind === 'shoot') {
      const toGoal = Math.hypot(choice.target.x - p.pos.x, choice.target.z - p.pos.z);
      const A = TUNING.ai;
      const power = clamp(A.shotPower[0] + ((A.shotPower[1] - A.shotPower[0]) * toGoal) / A.shootRange, 0, 1);
      state.plan = { kind: 'shoot', corner: choice.corner ?? 1, hold: Math.round((power * TUNING.shot.chargeTime) / PHYSICS_STEP) };
    } else {
      state.plan = { kind: 'pass' };
    }
  }
  if (state.plan?.kind === 'shoot') return restartShot(sim, p, state.plan, phase.elapsed);
  if (phase.restart.kind === 'freeKick' && !state.plan) return IDLE;
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

/**
 * A set-piece shot: turn on the spot until facing inside the chosen post, then hold K up
 * to the planned power and let go (the kick is taken as the button comes up).
 */
function restartShot(sim: Sim, p: Player, plan: Extract<RestartPlan, { kind: 'shoot' }>, elapsed: number): Command {
  const dir = sim.attackDir(p.team);
  const ball = sim.ball.translation();
  const target = { x: dir * HALF_LENGTH, z: plan.corner * (GOAL_WIDTH / 2 - TUNING.shot.postInset - 0.1) };
  const want = Math.atan2(target.z - ball.z, target.x - ball.x);
  const off = wrapAngle(want - p.facing);
  const aimed = Math.abs(off) < 1.5 * DEG && shotAim(ball, p.facing, chargePower(p), dir).atGoal;
  const turn = Math.abs(off) < 1e-3 ? { x: 0, z: 0 } : headingVec(want);
  if (p.charge) return { ...IDLE, move: turn, shoot: p.charge.steps < plan.hold };
  return { ...IDLE, move: turn, shoot: aimed && elapsed >= TUNING.match.aiTakerDelay && p.pendingKick === null };
}

/** Is the other team's wall (if they need one against `p`'s free kick) in place? */
function wallSet(sim: Sim, p: Player): boolean {
  const other = p.team === 0 ? 1 : 0;
  return wallSpots(sim, other).every((spot) =>
    sim.players.some((q) => q.team === other && Math.hypot(q.pos.x - spot.x, q.pos.z - spot.z) < 0.5),
  );
}
