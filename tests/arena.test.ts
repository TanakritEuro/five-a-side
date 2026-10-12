import { beforeAll, describe, expect, it } from 'vitest';
import { applyAero } from '../src/ball/aero';
import { BALL_RADIUS, GOAL_DEPTH, HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP } from '../src/constants';
import { createPhysics, type Physics } from '../src/physics';
import { DIAMOND, slotPosition } from '../src/team/formation';

let physics: Physics;

beforeAll(async () => {
  physics = await createPhysics();
});

/** Put the ball at (x, z) on the ground with velocity v, then step for `seconds`. */
function play(x: number, z: number, v: { x: number; y: number; z: number }, seconds: number) {
  const { world, ball, events } = physics;
  ball.setTranslation({ x, y: BALL_RADIUS, z }, true);
  ball.setLinvel(v, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  let maxAbsZ = 0;
  for (let i = 0; i < seconds / PHYSICS_STEP; i++) {
    applyAero(ball);
    world.step(events);
    events.drainCollisionEvents(() => {});
    maxAbsZ = Math.max(maxAbsZ, Math.abs(ball.translation().z));
  }
  return { end: ball.translation(), velocity: ball.linvel(), maxAbsZ };
}

describe('arena', () => {
  it('keeps a hard low shot at the touchline boards in play', () => {
    const { end, maxAbsZ } = play(0, 0, { x: 0, y: 0.5, z: 25 }, 2);
    expect(maxAbsZ).toBeLessThan(HALF_WIDTH);
    expect(end.z).toBeLessThan(HALF_WIDTH - BALL_RADIUS);
  });

  it('rebounds a shot off the end boards beside the goal', () => {
    const { end } = play(HALF_LENGTH - 8, 6, { x: 20, y: 0.3, z: 0 }, 1.5);
    expect(end.x).toBeLessThan(HALF_LENGTH);
  });

  it('catches a shot into either goal in the net', () => {
    for (const end of [1, -1]) {
      const result = play(end * (HALF_LENGTH - 8), 0, { x: end * 22, y: 2, z: 0 }, 2);
      expect(Math.abs(result.end.x)).toBeGreaterThan(HALF_LENGTH + BALL_RADIUS);
      expect(Math.abs(result.end.x)).toBeLessThan(HALF_LENGTH + GOAL_DEPTH);
    }
  });
});

describe('formation', () => {
  it('starts every player inside the pitch and in their own half', () => {
    for (const dir of [1, -1] as const) {
      for (const slot of DIAMOND) {
        const p = slotPosition(slot, dir);
        expect(Math.abs(p.x)).toBeLessThan(HALF_LENGTH);
        expect(Math.abs(p.z)).toBeLessThan(HALF_WIDTH);
        expect(p.x * dir).toBeLessThan(0);
      }
    }
  });
});
