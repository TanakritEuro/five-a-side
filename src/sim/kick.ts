import type RAPIER from '@dimforge/rapier3d-compat';
import { applyShotError, powerFromCharge, speedForPower } from '../ball/power';
import { contactScatter, contactSpeedFactor, spinFromContact, type Contact } from '../ball/spin';
import { loftAngle, predictPath, solveGroundPass, solveLaunch, type Ghost, type Launch } from '../ball/trajectory';
import { TUNING } from '../config';
import { BALL_RADIUS, GOAL_WIDTH, HALF_LENGTH, PHYSICS_STEP } from '../constants';
import { attrScale, clamp, gaussian, headingVec, lerp, type Rng, type Vec2, type Vec3 } from '../math';
import type { Command } from './command';
import type { SimEvent } from './events';
import type { Player } from './player';
import { canPlayBall, type Possession } from './possession';

const DEG = Math.PI / 180;

/**
 * Turn a player's kick buttons into kicks. The pass is a tap: pressing it queues a pass.
 * The shot is held for power: holding charges it and releasing queues it at that power.
 * A queued kick is taken as soon as the ball is in reach (`tryKick`), or dropped after
 * `bufferTime`, so a kick pressed a moment early still happens.
 */
export function updateKickButtons(p: Player, cmd: Command): void {
  const bufferSteps = Math.round(TUNING.kick.bufferTime / PHYSICS_STEP);
  if (cmd.pass && !p.held.pass) p.pendingKick = { kind: 'pass', power: 0, stepsLeft: bufferSteps };

  if (cmd.shoot) {
    if (p.charge?.kind !== 'shoot') p.charge = { kind: 'shoot', steps: 0 };
    p.charge.steps++;
  } else if (p.charge?.kind === 'shoot') {
    p.pendingKick = { kind: 'shoot', power: chargePower(p), stepsLeft: bufferSteps };
    p.charge = null;
  }

  p.held.pass = cmd.pass;
  p.held.shoot = cmd.shoot;
  p.held.lob = cmd.lob;
}

/** Power (0–1) of the shot being charged, or 0 if none is. */
export function chargePower(p: Player): number {
  return p.charge ? powerFromCharge(p.charge.steps * PHYSICS_STEP) : 0;
}

export interface KickWorld {
  ball: RAPIER.RigidBody;
  possession: Possession;
  ghost: Ghost;
  rng: Rng;
  /** Which way a team is attacking: +1 towards +X. */
  attackDir: (team: 0 | 1) => 1 | -1;
}

/** Take the player's queued kick if the ball is in reach; count down its buffer if not. */
export function tryKick(p: Player, w: KickWorld): SimEvent | null {
  const kick = p.pendingKick;
  if (!kick) return null;
  const from = w.ball.translation();
  if (!canPlayBall(p, from)) {
    if (--kick.stepsLeft <= 0) p.pendingKick = null;
    return null;
  }
  p.pendingKick = null;

  const start = { x: from.x, y: Math.max(from.y, BALL_RADIUS), z: from.z };
  const { launch, target } =
    kick.kind === 'shoot'
      ? planShot(p, start, kick.power, w.attackDir(p.team), w.ghost, w.rng)
      : planPass(p, start, w.ghost, w.rng);
  w.ball.setLinvel(launch.velocity, true);
  w.ball.setAngvel(launch.spin, true);
  w.possession.kick(p.id);
  p.touchCooldown = TUNING.kick.cooldown;
  const path = predictPath(w.ghost, start, launch.velocity, launch.spin);
  return { type: 'kick', player: p.id, kind: kick.kind, power: kick.power, target, path };
}

interface Plan {
  launch: Launch;
  /** Where the kick was aimed, after error. */
  target: Vec3;
}

/** A ground pass along the way the player faces, with a little error for the passer's skill. */
function planPass(p: Player, from: Vec3, ghost: Ghost, rng: Rng): Plan {
  const P = TUNING.pass;
  const error = P.scatter * attrScale(1 - p.attrs.passing, P.passingSpread);
  const dir = headingVec(p.facing + gaussian(rng) * error);
  const launch = solveGroundPass(ghost, from, dir, P.length, P.arrivalSpeed);
  return { launch, target: { x: from.x + dir.x * P.length, y: BALL_RADIUS, z: from.z + dir.z * P.length } };
}

/** Where a shot along `facing` from `from` is aimed, before error. Exported for tests. */
export function shotAim(from: Vec2, facing: number, power: number, attackDir: 1 | -1) {
  const S = TUNING.shot;
  const f = headingVec(facing);
  const goalX = attackDir * HALF_LENGTH;
  const height = lerp(S.minHeight, S.maxHeight, power);
  // Facing roughly at the goal: aim where the facing line crosses the goal line, kept inside the posts.
  if (f.x * attackDir > 0.2) {
    const t = (goalX - from.x) / f.x;
    const z = from.z + t * f.z;
    if (Math.abs(z) < GOAL_WIDTH / 2 + S.aimMargin) {
      const inside = GOAL_WIDTH / 2 - S.postInset;
      return { atGoal: true, point: { x: goalX, y: height, z: clamp(z, -inside, inside) } };
    }
  }
  return { atGoal: false, point: { x: from.x + f.x * S.range, y: height + 0.5, z: from.z + f.z * S.range } };
}

/**
 * A shot along the way the player faces (aimed inside the posts if they're facing the
 * goal), with power from the charge. Overpower drifts it high and wide, plus scatter
 * that grows with distance and shrinks with the shooting attribute. Shots aimed near a
 * post get some sidespin to curl them back in.
 */
function planShot(p: Player, from: Vec3, power: number, attackDir: 1 | -1, ghost: Ghost, rng: Rng): Plan {
  const S = TUNING.shot;
  const aim = shotAim(from, p.facing, power, attackDir);
  const dx = aim.point.x - from.x;
  const dz = aim.point.z - from.z;
  const distance = Math.hypot(dx, dz);
  const dir = { x: dx / distance, z: dz / distance };
  // Sideways from the shooter's point of view: their right, looking at the target.
  const right = { x: -dir.z, z: dir.x };
  // Measure aim across the goal from its centre, or across the line of fire for other shots.
  const centre = aim.atGoal ? { x: aim.point.x, z: 0 } : aim.point;
  const lateral = (aim.point.x - centre.x) * right.x + (aim.point.z - centre.z) * right.z;

  const curl = aim.atGoal ? TUNING.spin.autoCurl * clamp(lateral / (GOAL_WIDTH / 2), -1, 1) : 0;
  const contact: Contact = { x: curl, y: 0 };
  const skill = attrScale(p.attrs.shooting, S.shootingSpread);
  const scatterScale = attrScale(1 - p.attrs.shooting, 2 * S.shootingSpread);
  const err = applyShotError({ lateral, y: aim.point.y }, power, distance, rng, scatterScale, contactScatter(contact));
  const target = {
    x: centre.x + right.x * err.lateral,
    y: err.y,
    z: centre.z + right.z * err.lateral,
  };

  const speed = speedForPower(power) * skill * contactSpeedFactor(contact);
  const spin = spinFromContact(contact, power, dir);
  const launch = solveLaunch(ghost, from, target, speed, spin);
  if (loftAngle(launch.velocity) <= S.maxLoft * DEG) return { launch, target };

  // Too soft to reach the target in the air without lobbing it: drill it low instead.
  const tx = target.x - from.x;
  const tz = target.z - from.z;
  const d = Math.hypot(tx, tz);
  const loft = Math.tan(S.lowDriveLoft * DEG);
  return {
    launch: {
      velocity: { x: (tx / d) * speed, y: speed * loft, z: (tz / d) * speed },
      spin: { x: 0, y: 0, z: 0 },
      flightTime: d / speed,
    },
    target,
  };
}
