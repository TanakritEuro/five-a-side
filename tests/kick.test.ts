import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH } from '../src/constants';
import type { Vec3 } from '../src/math';
import type { SimEvent } from '../src/sim/events';
import { arrivalSpeed, shotAim } from '../src/sim/kick';
import type { Sim } from '../src/sim/sim';
import { cmd, createSim, run, solo, STEPS_PER_SECOND } from './helpers';

type KickEvent = Extract<SimEvent, { type: 'kick' }>;

/** A player at (x, z) facing `facing` with the ball just in front of their feet. */
async function setup(x: number, z: number, facing: number, seed = 1): Promise<Sim> {
  const sim = await createSim(seed, solo({ x, z }, facing));
  sim.placeBall({ x: x + Math.cos(facing) * 0.6, z: z + Math.sin(facing) * 0.6 });
  return sim;
}

/** Hold K for `hold` seconds, then let go and watch for `watch` seconds. */
function shoot(sim: Sim, hold: number, watch = 2.5): { kick: KickEvent | undefined; events: SimEvent[] } {
  const holdSteps = Math.round(hold * STEPS_PER_SECOND);
  const events = run(sim, hold + watch, (i) => cmd({ shoot: i < holdSteps }));
  return { kick: events.find((e): e is KickEvent => e.type === 'kick'), events };
}

/** Where the ball crossed the +X goal line (x = HALF_LENGTH + radius), stepping the sim. */
function crossing(sim: Sim, seconds = 3): Vec3 | null {
  for (let i = 0; i < seconds * STEPS_PER_SECOND; i++) {
    sim.step([]);
    const p = sim.ball.translation();
    if (p.x > HALF_LENGTH + BALL_RADIUS) return { x: p.x, y: p.y, z: p.z };
  }
  return null;
}

describe('shooting', () => {
  it('sets power from how long the button is held, capped at full', async () => {
    const half = shoot(await setup(0, 0, 0), 0.5 * TUNING.shot.chargeTime);
    expect(half.kick?.power).toBeCloseTo(0.5, 1);
    const long = shoot(await setup(0, 0, 0), 2 * TUNING.shot.chargeTime);
    expect(long.kick?.power).toBe(1);
  });

  it('scores from 10 m facing the goal with a well-judged shot, on any seed', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = await setup(9.4, 0, 0, seed);
      const { kick } = shoot(sim, 0.65 * TUNING.shot.chargeTime, 0.05);
      expect(kick?.kind).toBe('shoot');
      const c = crossing(sim);
      expect(c).not.toBeNull();
      expect(Math.abs(c!.z)).toBeLessThan(GOAL_WIDTH / 2);
      expect(c!.y).toBeLessThan(GOAL_HEIGHT);
    }
  });

  it('sends overpowered shots higher', async () => {
    let controlled = 0;
    let blasted = 0;
    for (let seed = 1; seed <= 12; seed++) {
      controlled += shoot(await setup(9.4, 0, 0, seed), 0.65 * TUNING.shot.chargeTime, 0.05).kick!.target.y;
      blasted += shoot(await setup(9.4, 0, 0, seed), 1.5 * TUNING.shot.chargeTime, 0.05).kick!.target.y;
    }
    expect(blasted / 12).toBeGreaterThan(controlled / 12 + 0.7);
  });

  it('aims inside the near post when facing just wide of it, and straight on otherwise', () => {
    const inside = GOAL_WIDTH / 2 - TUNING.shot.postInset;
    const wide = shotAim({ x: 10, z: 0 }, Math.atan2(GOAL_WIDTH / 2 + 1, 10), 0.5, 1);
    expect(wide.atGoal).toBe(true);
    expect(wide.point.z).toBeCloseTo(inside);
    const centre = shotAim({ x: 10, z: 0 }, 0, 0.5, 1);
    expect(centre.point.z).toBeCloseTo(0);
    const away = shotAim({ x: 10, z: 0 }, Math.PI / 2, 0.5, 1);
    expect(away.atGoal).toBe(false);
    expect(away.point.z).toBeGreaterThan(10);
    // The away team attacks -X.
    expect(shotAim({ x: -10, z: 0 }, Math.PI, 0.5, -1).point.x).toBe(-HALF_LENGTH);
  });

  it('drills a soft shot from distance low instead of lobbing it', async () => {
    const sim = await setup(-12, 0, 0);
    const { kick } = shoot(sim, 0.05, 0.05);
    const first = kick!.path.points[1];
    const start = kick!.path.points[0];
    const rise = (first.y - start.y) / Math.hypot(first.x - start.x, first.z - start.z);
    expect(rise).toBeLessThan(Math.tan((TUNING.shot.lowDriveLoft + 1) * (Math.PI / 180)));
  });
});

describe('passing', () => {
  it('rolls a ground pass along the facing direction, arriving at the set pace', async () => {
    const sim = await setup(-10, 0, 0);
    sim.step([cmd({ pass: true })]);
    let arrival: { z: number; speed: number } | null = null;
    const startX = sim.ball.translation().x;
    for (let i = 0; i < 4 * STEPS_PER_SECOND && !arrival; i++) {
      sim.step([]);
      const p = sim.ball.translation();
      if (p.x - startX >= TUNING.pass.length) {
        const v = sim.ball.linvel();
        arrival = { z: p.z, speed: Math.hypot(v.x, v.z) };
      }
    }
    expect(arrival).not.toBeNull();
    expect(Math.abs(arrival!.z)).toBeLessThan(1.5);
    expect(arrival!.speed).toBeGreaterThan(arrivalSpeed(TUNING.pass.length) - 0.3);
    expect(arrival!.speed).toBeLessThan(arrivalSpeed(TUNING.pass.length) + 0.3);
    expect(sim.ball.translation().y).toBeLessThan(BALL_RADIUS + 0.05); // stayed on the ground
  });

  it('takes a pass pressed just before the ball comes into reach', async () => {
    const sim = await createSim(1, solo({ x: -10, z: 0 }, 0));
    sim.placeBall({ x: -8.5, z: 0 }); // 1.5 m ahead: out of reach
    const events = run(sim, 0.5, (i) => cmd({ move: { x: 1, z: 0 }, pass: i === 0 }));
    expect(events.some((e) => e.type === 'kick' && e.kind === 'pass')).toBe(true);
  });

  it('drops a pass when the ball never comes into reach', async () => {
    const sim = await createSim(1, solo({ x: -10, z: 0 }, 0));
    sim.placeBall({ x: -4, z: 0 });
    const events = run(sim, 1, (i) => cmd({ pass: i === 0 }));
    expect(events.some((e) => e.type === 'kick')).toBe(false);
    expect(sim.players[0].pendingKick).toBeNull();
  });

  it('releases possession when kicked', async () => {
    const sim = await setup(-10, 0, 0);
    run(sim, 0.2, () => cmd({ move: { x: 1, z: 0 } }));
    expect(sim.possession.owner).toBe(0);
    run(sim, 0.3, (i) => cmd({ pass: i === 0 }));
    expect(sim.possession.owner).toBeNull();
    expect(sim.possession.lastTouch).toBe(0);
  });
});
