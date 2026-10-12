import { beforeAll, describe, expect, it } from 'vitest';
import { applyBallForces, rollingSpin } from '../src/ball/forces';
import { predictPath, solveGroundPass, solveLaunch } from '../src/ball/trajectory';
import { TUNING } from '../src/config';
import { BALL_RADIUS, PHYSICS_STEP } from '../src/constants';
import type { Vec2, Vec3 } from '../src/math';
import type { Sim } from '../src/sim/sim';
import { createSim } from './helpers';

let sim: Sim;
beforeAll(async () => {
  sim = await createSim(1, []); // no players in the way
});

/** Fly the real ball from `from` and call `watch` after every step until it returns true. */
function fly(from: Vec3, v: Vec3, w: Vec3, watch: (p: Vec3, v: Vec3, t: number) => boolean, seconds = 4): void {
  const { ball, world } = sim.physics;
  ball.setTranslation(from, true);
  ball.setLinvel(v, true);
  ball.setAngvel(w, true);
  for (let i = 1; i <= seconds / PHYSICS_STEP; i++) {
    applyBallForces(ball);
    world.step();
    if (watch(ball.translation(), ball.linvel(), i * PHYSICS_STEP)) return;
  }
}

/** Where the real ball crosses the vertical plane through `target` facing `normal`. */
function realCrossing(from: Vec3, v: Vec3, w: Vec3, target: Vec3, normal: Vec2): Vec3 | null {
  const side = (p: Vec3) => (p.x - target.x) * normal.x + (p.z - target.z) * normal.z;
  let prev = { ...from };
  let hit: Vec3 | null = null;
  fly(from, v, w, (p) => {
    const s = side(p);
    if (s >= 0) {
      const f = -side(prev) / (s - side(prev));
      hit = { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f, z: prev.z + (p.z - prev.z) * f };
      return true;
    }
    prev = { x: p.x, y: p.y, z: p.z };
    return false;
  });
  return hit;
}

const ground = (x: number, z: number): Vec3 => ({ x, y: BALL_RADIUS, z });

describe('launch solver', () => {
  it.each([
    ['towards +X goal', ground(5, 0), { x: 20, y: 1.2, z: 1 }, 24],
    ['towards -X goal', ground(-8, 3), { x: -20, y: 0.5, z: -1.2 }, 20],
    ['across the pitch', ground(0, 6), { x: 3, y: 2.5, z: -6 }, 14],
    ['diagonal', ground(-5, -5), { x: 6, y: 1.5, z: 4 }, 18],
  ])('hits the target to within a centimetre (%s), in the ghost and the real world', (_, from, target, speed) => {
    const launch = solveLaunch(sim.ghost, from, target, speed);
    const d = Math.hypot(target.x - from.x, target.z - from.z);
    const normal = { x: (target.x - from.x) / d, z: (target.z - from.z) / d };
    const hit = realCrossing(from, launch.velocity, launch.spin, target, normal);
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit!.x - target.x, hit!.y - target.y, hit!.z - target.z)).toBeLessThan(0.01);
  });

  it('lands on target with sidespin, setting off to one side and bending back', () => {
    const from = ground(8, -2);
    const target = { x: 20, y: 1, z: 1 };
    const spin = { x: 0, y: 40, z: 0 };
    const curled = solveLaunch(sim.ghost, from, target, 22, spin);
    const straight = solveLaunch(sim.ghost, from, target, 22);
    const normal = { x: 12 / Math.hypot(12, 3), z: 3 / Math.hypot(12, 3) };
    const hit = realCrossing(from, curled.velocity, spin, target, normal)!;
    expect(Math.hypot(hit.x - target.x, hit.y - target.y, hit.z - target.z)).toBeLessThan(0.01);
    // Spin about +Y bends a ball to its left, so it must set off to the right of the straight line.
    const right = { x: -normal.z, z: normal.x };
    const lateral = (v: Vec3) => (v.x * right.x + v.z * right.z) / Math.hypot(v.x, v.z);
    expect(lateral(curled.velocity) - lateral(straight.velocity)).toBeGreaterThan(0.02);
  });
});

describe('rolling', () => {
  it('slows a rolling ball at the rolling resistance and stops it', () => {
    let speedAt1 = 0;
    let stoppedAt = 0;
    fly(ground(-15, 0), { x: 6, y: 0, z: 0 }, rollingSpin(6, 0), (_, v, t) => {
      const h = Math.hypot(v.x, v.z);
      if (Math.abs(t - 1) < PHYSICS_STEP / 2) speedAt1 = h;
      if (h < 0.01) {
        stoppedAt = t;
        return true;
      }
      return false;
    }, 10);
    const R = TUNING.ball.rollingResistance;
    expect(speedAt1).toBeGreaterThan(6 - R - 0.5); // plus air drag, ~0.45 m/s² at this speed
    expect(speedAt1).toBeLessThan(6 - R - 0.3);
    expect(stoppedAt).toBeGreaterThan(0);
  });


  it('rolls fast without skidding (Rapier caps spin at a quarter turn per step)', () => {
    let speed = 0;
    fly(ground(-15, 0), { x: 14, y: 0, z: 0 }, rollingSpin(14, 0), (_, v, t) => {
      speed = Math.hypot(v.x, v.z);
      return t >= 0.5;
    });
    expect(speed).toBeGreaterThan(14 - 0.5 * (TUNING.ball.rollingResistance + 3)); // drag ~2.5 m/s² at 14 m/s
  });

  it('loses some pace to the turf when it lands from a height', () => {
    const afterLanding = (vy: number) => {
      let h = 0;
      let landed = false;
      fly({ x: -15, y: 1.5, z: 0 }, { x: 10, y: vy, z: 0 }, { x: 0, y: 0, z: 0 }, (p, v) => {
        if (p.y < BALL_RADIUS + 0.05) landed = true;
        if (landed && v.y > 0) {
          h = Math.hypot(v.x, v.z);
          return true;
        }
        return false;
      });
      return h;
    };
    const steep = afterLanding(4);
    expect(steep).toBeLessThan(9);
    expect(steep).toBeGreaterThan(6);
  });
  it.each([
    [10, 5],
    [6, 3],
    [18, 6],
  ])('a ground pass of %s m arrives at %s m/s, in the real world too', (distance, arrival) => {
    const from = ground(-12, -4);
    const dir = { x: 0.8, z: 0.6 };
    const pass = solveGroundPass(sim.ghost, from, dir, distance, arrival);
    let speed = -1;
    fly(from, pass.velocity, pass.spin, (p, v) => {
      if ((p.x - from.x) * dir.x + (p.z - from.z) * dir.z < distance) return false;
      speed = Math.hypot(v.x, v.z);
      return true;
    });
    expect(speed).toBeGreaterThan(arrival - 0.1);
    expect(speed).toBeLessThan(arrival + 0.1);
  });

  it('predicts the path the real ball takes, bounces included', () => {
    const from = ground(-10, 0);
    const v = { x: 12, y: 4, z: 3 };
    const w = { x: 0, y: 10, z: 0 };
    const path = predictPath(sim.ghost, from, v, w, 2);
    const real: Vec3[] = [{ ...from }];
    let i = 0;
    fly(from, v, w, (p) => {
      if (++i % Math.round(path.dt / PHYSICS_STEP) === 0) real.push({ x: p.x, y: p.y, z: p.z });
      return real.length >= path.points.length;
    });
    for (let k = 0; k < path.points.length; k++) {
      const a = path.points[k];
      const b = real[k];
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-3);
    }
  });
});
