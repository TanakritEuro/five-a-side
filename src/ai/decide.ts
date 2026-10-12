import { TUNING, type AiLevel } from '../config';
import { GOAL_WIDTH, HALF_LENGTH } from '../constants';
import { clamp, gaussian, headingVec, type Rng, type Vec2 } from '../math';
import { arrivalSpeed } from '../sim/kick';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { attackGoal, distanceToSegment, space } from './geometry';
import { launchSpeedFor, passSafety } from './passing';
import { goalAngle } from './support';

/** One thing the player on the ball could do, and how much they like it. */
export interface Option {
  kind: 'shoot' | 'pass' | 'dribble';
  /** Shot: the point inside the post aimed at. Pass: where the receiver will be. Dribble: where to carry it. */
  target: Vec2;
  receiver?: number;
  /** Shot: +1 or -1 across the goal. */
  corner?: 1 | -1;
  /** Utility before noise. */
  score: number;
  /** Utility after the level's decision noise: what the choice is made on. */
  utility: number;
}

/**
 * Every option for `p` on the ball, scored:
 * - **shoot** at either corner: the angle on goal, how open the line is (the keeper and
 *   anyone else in the way), distance, how much time they have, and whether they're facing
 *   it (they shoot the way they face);
 * - **pass** to each teammate: how safe the pass is (`passSafety`, against the level's
 *   margin), how much ground it gains, how much space and what angle on goal the receiver has;
 * - **dribble** towards goal: the space ahead, less the pressure on them.
 * Then Gaussian noise of the level's size on each, so weaker levels choose worse.
 */
export function scoreOptions(sim: Sim, p: Player, level: AiLevel, rng: Rng): Option[] {
  const W = TUNING.decide;
  const dir = sim.attackDir(p.team);
  const goal = attackGoal(sim, p.team);
  const opponents = sim.players.filter((o) => o.team !== p.team);
  const keeper = opponents.find((o) => o.spec.role === 'keeper');
  const pressure = 1 - clamp(space(sim, p.pos, opponentTeam(p), W.pressureRange) / W.pressureRange, 0, 1);
  const options: Option[] = [];

  // Shots.
  const angle = goalAngle(p.pos, goal) / W.fullAngle;
  for (const corner of [1, -1] as const) {
    const aim = { x: goal.x, z: corner * (GOAL_WIDTH / 2 - TUNING.shot.postInset) };
    const dist = Math.hypot(aim.x - p.pos.x, aim.z - p.pos.z);
    if (dist > W.maxShotRange) continue;
    let lane = W.laneClear;
    for (const o of opponents) {
      if (o.spec.role !== 'keeper') lane = Math.min(lane, distanceToSegment(o.pos, p.pos, aim));
    }
    const keeperGap = keeper ? distanceToSegment(keeper.pos, p.pos, aim) : W.keeperClear;
    const f = headingVec(p.facing);
    const facingAim = ((aim.x - p.pos.x) * f.x + (aim.z - p.pos.z) * f.z) / dist;
    const score =
      W.shoot *
      clamp(angle, 0, 1) *
      clamp(lane / W.laneClear, 0, 1) *
      (0.3 + 0.7 * clamp(keeperGap / W.keeperClear, 0, 1)) *
      clamp(1 - (dist - W.shotIdeal) / (W.maxShotRange - W.shotIdeal), 0, 1) *
      (1 - 0.4 * pressure) *
      clamp((facingAim - 0.5) / 0.5, 0, 1);
    options.push({ kind: 'shoot', target: aim, corner, score, utility: 0 });
  }

  // Passes.
  for (const q of sim.players) {
    if (q.team !== p.team || q.id === p.id) continue;
    const d0 = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d0 < TUNING.pass.minDistance || d0 > TUNING.pass.maxDistance) continue;
    const lead = d0 / (arrivalSpeed(d0) + 2);
    const target = { x: q.pos.x + q.vel.x * lead * TUNING.pass.lead, z: q.pos.z + q.vel.z * lead * TUNING.pass.lead };
    const d = Math.hypot(target.x - p.pos.x, target.z - p.pos.z);
    const safety = passSafety(p.pos, target, launchSpeedFor(d, arrivalSpeed(d)), q, opponents);
    const safe = clamp((safety - level.passMargin) / W.safetyScale, -1, 1);
    const progress = clamp(((target.x - p.pos.x) * dir) / HALF_LENGTH, -1, 1);
    const open = space(sim, target, opponentTeam(p), W.openCap) / W.openCap;
    const threat = goalAngle(target, goal) / W.fullAngle;
    const keeperPenalty = q.spec.role === 'keeper' ? W.keeperPass : 0;
    const score =
      W.pass * (0.5 + 0.5 * safe) * (W.progress * progress + W.open * open + W.threat * clamp(threat, 0, 1) + W.passBase) -
      keeperPenalty -
      (safety < level.passMargin ? W.unsafe : 0);
    options.push({ kind: 'pass', target, receiver: q.id, score, utility: 0 });
  }

  // Dribble on towards goal.
  let ahead = W.spaceAhead;
  const toGoal = { x: goal.x - p.pos.x, z: goal.z - p.pos.z };
  const len = Math.hypot(toGoal.x, toGoal.z) || 1;
  for (const o of opponents) {
    const ox = o.pos.x - p.pos.x;
    const oz = o.pos.z - p.pos.z;
    const od = Math.hypot(ox, oz);
    if ((ox * toGoal.x + oz * toGoal.z) / (od * len) > Math.cos(W.aheadCone * (Math.PI / 180))) ahead = Math.min(ahead, od);
  }
  options.push({
    kind: 'dribble',
    target: { x: p.pos.x + (toGoal.x / len) * 4, z: p.pos.z + (toGoal.z / len) * 4 },
    score: W.dribble * (ahead / W.spaceAhead) * (1 - 0.6 * pressure),
    utility: 0,
  });

  for (const o of options) o.utility = o.score + gaussian(rng) * level.noise;
  return options;
}

/** The option `p` goes for: the highest utility. */
export function decide(sim: Sim, p: Player, level: AiLevel, rng: Rng): Option {
  const options = scoreOptions(sim, p, level, rng);
  return options.reduce((best, o) => (o.utility > best.utility ? o : best));
}

function opponentTeam(p: Player): 0 | 1 {
  return p.team === 0 ? 1 : 0;
}
