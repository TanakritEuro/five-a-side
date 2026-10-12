// Ported from ../penalty-shootout/src/shooting/trajectory.ts. Changes: targets in any
// horizontal direction (not just the plane z = 0), a second ghost world with a ground for
// rolling passes, a speed search for ground passes, and cached flight paths.
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { GRAVITY, PHYSICS_STEP } from '../constants';
import type { Vec2, Vec3 } from '../math';
import { createBall, groundDesc } from '../physics';
import { applyBallForces, rollingSpin } from './forces';

export interface Launch {
  velocity: Vec3;
  spin: Vec3;
  /** Seconds until the ball reaches the target. */
  flightTime: number;
}

export interface Crossing {
  /** Where the ball crosses the target plane. */
  point: Vec3;
  /** Seconds after launch. */
  t: number;
}

/** A predicted flight: `points[i]` is where the ball will be `i * dt` seconds after the kick. */
export interface BallPath {
  dt: number;
  points: Vec3[];
}

const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };
const MAX_FLIGHT = 3; // s: give up on anything that takes longer to arrive
const MAX_ROLL = 8; // s: a ground pass that hasn't arrived by then never will
const MAX_PASS_SPEED = 30;
/** Store every Nth step of a predicted path. */
const PATH_STRIDE = 2;

interface GhostWorld {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
}

/**
 * Private physics worlds, each holding a single ghost ball identical to the real one.
 * Flying it with the same engine and the same forces makes predictions match the game
 * exactly (Rapier's internal substeps included). `air` is empty space, for aiming shots
 * and lofted balls; `ground` has the turf, for rolling passes and whole-path predictions.
 * Neither has walls, players or goals, so a prediction holds until the ball hits one.
 *
 * Each `Sim` owns its own `Ghost`: Rapier carries a little contact state from one step to
 * the next, so sharing ghosts between simulations would make them depend on each other.
 * Create after Rapier is initialised.
 */
export class Ghost {
  readonly air = ghostWorld(false);
  readonly ground = ghostWorld(true);
}

function ghostWorld(withGround: boolean): GhostWorld {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;
  if (withGround) world.createCollider(groundDesc());
  return { world, ball: createBall(world) };
}

function launchGhost(g: GhostWorld, from: Vec3, v: Vec3, w: Vec3): void {
  g.ball.setTranslation(from, true);
  g.ball.setLinvel(v, true);
  g.ball.setAngvel(w, true);
}

function stepGhost(g: GhostWorld): void {
  applyBallForces(g.ball);
  g.world.step();
}

/**
 * Fly the ball from `from` with velocity `v` and spin `w` through empty air (gravity,
 * drag, Magnus) until it crosses the vertical plane through `target` facing along the
 * horizontal direction `normal`. Returns null if the ball never gets there.
 */
export function predictCrossing(ghost: Ghost, from: Vec3, v: Vec3, w: Vec3, target: Vec3, normal: Vec2): Crossing | null {
  const g = ghost.air;
  launchGhost(g, from, v, w);
  const side = (p: Vec3) => (p.x - target.x) * normal.x + (p.z - target.z) * normal.z;
  let prev = from;
  for (let step = 0; step * PHYSICS_STEP < MAX_FLIGHT; step++) {
    stepGhost(g);
    const p = g.ball.translation();
    const s = side(p);
    if (s >= 0) {
      // Interpolate within the step for a sub-step crossing point.
      const f = -side(prev) / (s - side(prev));
      return {
        point: { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f, z: prev.z + (p.z - prev.z) * f },
        t: (step + f) * PHYSICS_STEP,
      };
    }
    prev = p;
  }
  return null;
}

/**
 * Launch velocity that sends the ball from `from` through `target`, struck with spin
 * `w`, at a horizontal speed of `speed` m/s.
 *
 * Starts from the drag-free ballistic answer, flies it with `predictCrossing`, and moves
 * the point it aims at by however far the ball missed, until it lands on target. Curved
 * shots therefore set off to one side and bend back in.
 */
export function solveLaunch(ghost: Ghost, from: Vec3, target: Vec3, speed: number, w: Vec3 = NO_SPIN): Launch {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  const normal = { x: dx / d, z: dz / d };
  const aimAt = { ...target };
  let velocity = ballistic(from, aimAt, speed);
  let flightTime = d / speed;

  for (let i = 0; i < 10; i++) {
    const c = predictCrossing(ghost, from, velocity, w, target, normal);
    if (!c) break;
    flightTime = c.t;
    const ex = target.x - c.point.x;
    const ey = target.y - c.point.y;
    const ez = target.z - c.point.z;
    if (Math.hypot(ex, ey, ez) < 0.002) break;
    aimAt.x += ex;
    aimAt.y += ey;
    aimAt.z += ez;
    velocity = ballistic(from, aimAt, speed);
  }
  return { velocity, spin: w, flightTime };
}

/** Upward launch angle (radians) of a launch velocity. */
export function loftAngle(v: Vec3): number {
  return Math.atan2(v.y, Math.hypot(v.x, v.z));
}

/** Drag-free launch velocity from `from` to `target` at horizontal speed `speed`. */
function ballistic(from: Vec3, target: Vec3, speed: number): Vec3 {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  const time = distance / speed;
  const vy = (target.y - from.y - 0.5 * GRAVITY * time * time) / time;
  return { x: (dx / distance) * speed, y: vy, z: (dz / distance) * speed };
}

/** How a rolling ball got on: where it was `distance` along its line, or how far it got. */
interface Roll {
  /** Speed (m/s) on reaching `distance`, or 0 if it stopped short. */
  speed: number;
  /** Distance travelled along `dir` (≥ `distance` if it got there). */
  reached: number;
  t: number;
}

/** Roll a ball from `from` along `dir` at `speed` and see how it arrives `distance` away. */
function roll(ghost: Ghost, from: Vec3, dir: Vec2, speed: number, distance: number): Roll {
  const g = ghost.ground;
  const vx = dir.x * speed;
  const vz = dir.z * speed;
  launchGhost(g, from, { x: vx, y: 0, z: vz }, rollingSpin(vx, vz));
  const along = (p: Vec3) => (p.x - from.x) * dir.x + (p.z - from.z) * dir.z;
  let prevAlong = 0;
  let prevSpeed = speed;
  for (let step = 0; step * PHYSICS_STEP < MAX_ROLL; step++) {
    stepGhost(g);
    const s = along(g.ball.translation());
    const v = g.ball.linvel();
    const h = Math.hypot(v.x, v.z);
    if (s >= distance) {
      const f = (distance - prevAlong) / (s - prevAlong);
      return { speed: prevSpeed + (h - prevSpeed) * f, reached: s, t: (step + f) * PHYSICS_STEP };
    }
    if (h < 0.01) return { speed: 0, reached: s, t: (step + 1) * PHYSICS_STEP };
    prevAlong = s;
    prevSpeed = h;
  }
  return { speed: 0, reached: prevAlong, t: MAX_ROLL };
}

/**
 * A ground pass from `from` along the unit direction `dir` that is still rolling at
 * `arrivalSpeed` m/s when it has gone `distance` metres. The ball is launched already
 * rolling (no skid). Uses v² ≈ v₀² − 2·a·d to correct the launch speed from each ghost
 * roll, which converges in a few tries.
 */
export function solveGroundPass(ghost: Ghost, from: Vec3, dir: Vec2, distance: number, arrivalSpeed: number): Launch {
  let v0 = Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * TUNING.ball.rollingResistance * distance);
  let result = roll(ghost, from, dir, v0, distance);
  for (let i = 0; i < 8; i++) {
    if (result.speed > 0 && Math.abs(result.speed - arrivalSpeed) < 0.02) break;
    const v2 =
      result.speed > 0
        ? v0 * v0 + arrivalSpeed * arrivalSpeed - result.speed * result.speed
        : (v0 * v0 * distance) / Math.max(0.1, result.reached) + arrivalSpeed * arrivalSpeed;
    v0 = Math.min(MAX_PASS_SPEED, Math.sqrt(Math.max(0.01, v2)));
    result = roll(ghost, from, dir, v0, distance);
  }
  const vx = dir.x * v0;
  const vz = dir.z * v0;
  return { velocity: { x: vx, y: 0, z: vz }, spin: rollingSpin(vx, vz), flightTime: result.t };
}

/**
 * Where a kicked ball will go over the next `seconds`, bounces and roll included (but
 * not walls, posts or players). Cached per kick for interception and the debug overlay.
 */
export function predictPath(ghost: Ghost, from: Vec3, v: Vec3, w: Vec3, seconds = MAX_FLIGHT): BallPath {
  const g = ghost.ground;
  launchGhost(g, from, v, w);
  const points: Vec3[] = [{ ...from }];
  const steps = Math.round(seconds / PHYSICS_STEP);
  for (let step = 1; step <= steps; step++) {
    stepGhost(g);
    if (step % PATH_STRIDE === 0) {
      const p = g.ball.translation();
      points.push({ x: p.x, y: p.y, z: p.z });
    }
  }
  return { dt: PATH_STRIDE * PHYSICS_STEP, points };
}
