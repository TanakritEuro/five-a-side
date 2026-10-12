import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { headingVec, type Vec2 } from '../src/math';
import { stepLocomotion, type MoveInput, type MoveState } from '../src/sim/locomotion';

const L = TUNING.locomotion;
const dt = PHYSICS_STEP;

function fresh(facing = 0): MoveState {
  return { speed: 0, facing, stamina: 1, sprinting: false };
}

function input(move: Vec2, extra: Partial<MoveInput> = {}): MoveInput {
  return { move, sprint: false, onBall: false, pace: 0.5, ...extra };
}

/** Run for `seconds`; returns the state and the highest speed seen. */
function run(s: MoveState, inp: MoveInput, seconds: number) {
  let top = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    stepLocomotion(s, inp, dt);
    top = Math.max(top, s.speed);
  }
  return { s, top };
}

const EAST = { x: 1, z: 0 };
const WEST = { x: -1, z: 0 };
const NORTH = { x: 0, z: -1 };

describe('locomotion', () => {
  it('reaches jog speed without overshooting, in the time accel allows', () => {
    const s = fresh();
    let t = 0;
    while (s.speed < L.jogSpeed - 1e-9 && t < 5) {
      stepLocomotion(s, input(EAST), dt);
      t += dt;
    }
    expect(t).toBeCloseTo(L.jogSpeed / L.accel, 1);
    const { top } = run(s, input(EAST), 3);
    expect(top).toBeLessThanOrEqual(L.jogSpeed + 1e-9);
  });

  it('sprints faster than it jogs, but no faster than sprint speed', () => {
    const { top } = run(fresh(), input(EAST, { sprint: true }), 3);
    expect(top).toBeGreaterThan(L.jogSpeed + 1);
    expect(top).toBeLessThanOrEqual(L.sprintSpeed + 1e-9);
  });

  it('is slower on the ball', () => {
    const { top } = run(fresh(), input(EAST, { onBall: true }), 3);
    expect(top).toBeCloseTo(L.jogSpeed * L.onBallSpeed, 6);
  });

  it('turns at a limited rate when running', () => {
    const { s } = run(fresh(), input(EAST), 2);
    const before = s.facing;
    stepLocomotion(s, input(NORTH), dt);
    const maxTurn = (L.turnRate / (1 + L.turnSpeedFactor * L.jogSpeed)) * dt;
    expect(Math.abs(s.facing - before)).toBeLessThanOrEqual(maxTurn + 1e-9);
    expect(Math.abs(s.facing - before)).toBeGreaterThan(0);
  });

  it('brakes before turning round on a hard reversal', () => {
    const { s } = run(fresh(), input(EAST, { sprint: true }), 3);
    // A quarter of a second into the reversal the player is still heading roughly east,
    // only slower, and never swings round at full speed.
    for (let i = 0; i < 15; i++) {
      stepLocomotion(s, input(WEST), dt);
      expect(headingVec(s.facing).x * s.speed).toBeGreaterThan(-2);
    }
    expect(s.speed).toBeLessThan(L.sprintSpeed - 2);
    const { s: after } = run(s, input(WEST), 2);
    expect(headingVec(after.facing).x).toBeCloseTo(-1, 3);
    expect(after.speed).toBeCloseTo(L.jogSpeed, 3);
  });

  it('drains stamina while sprinting, fades to jog when empty, and recovers', () => {
    const s = fresh();
    run(s, input(EAST, { sprint: true }), 1 / TUNING.stamina.drain + 2);
    expect(s.stamina).toBeLessThan(0.01);
    expect(s.speed).toBeCloseTo(L.jogSpeed, 3);
    run(s, input(EAST), 5);
    expect(s.stamina).toBeGreaterThan(5 * TUNING.stamina.recovery - 0.01);
  });

  it('does not use stamina when only jogging', () => {
    const { s } = run(fresh(), input(EAST), 3);
    expect(s.stamina).toBe(1);
  });

  it('gives faster players more pace', () => {
    const slow = run(fresh(), input(EAST, { pace: 0 }), 3).top;
    const quick = run(fresh(), input(EAST, { pace: 1 }), 3).top;
    expect(quick / slow).toBeCloseTo((1 + L.paceSpread) / (1 - L.paceSpread), 5);
  });

  it('stops when there is no input', () => {
    const { s } = run(fresh(), input(EAST), 2);
    run(s, input({ x: 0, z: 0 }), 1);
    expect(s.speed).toBe(0);
  });
});
