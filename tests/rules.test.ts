import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { BALL_RADIUS, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH } from '../src/constants';
import type { Vec3 } from '../src/math';
import type { SimEvent } from '../src/sim/events';
import { outOfCage } from '../src/sim/rules';
import type { Sim } from '../src/sim/sim';
import { cmd, createSim, run, solo, STEPS_PER_SECOND } from './helpers';

const R = TUNING.rules;

/** Throw the ball from `from` with velocity `v` and run for `seconds`. */
function launch(sim: Sim, from: Vec3, v: Vec3, seconds: number): SimEvent[] {
  sim.ball.setTranslation(from, true);
  sim.ball.setLinvel(v, true);
  sim.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return run(sim, seconds);
}

const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

describe('goals', () => {
  it('counts a goal, then lines up for the kick-off', async () => {
    const sim = await createSim(1, solo({ x: 9.4, z: 0 }, 0));
    sim.placeBall({ x: 10, z: 0 });
    const hold = Math.round(0.6 * TUNING.shot.chargeTime * STEPS_PER_SECOND);
    const events = run(sim, 2, (i) => cmd({ shoot: i < hold }));
    const goal = ofType(events, 'goal');
    expect(goal).toHaveLength(1);
    expect(goal[0]).toMatchObject({ team: 0, end: 1, score: [1, 0] });
    expect(sim.rules.score).toEqual([1, 0]);
    expect(ofType(events, 'shot')[0]?.outcome.kind).toBe('goal');
    expect(sim.rules.inPlay).toBe(false);

    // Keep running until the restart: the kick-off puts the player back on their spot.
    let restart: Extract<SimEvent, { type: 'restart' }> | undefined;
    for (let i = 0; i < (R.goalDelay + 1) * STEPS_PER_SECOND && !restart; i++) {
      restart = ofType(sim.step([cmd({ move: { x: 1, z: 0 } })]), 'restart')[0];
    }
    expect(restart?.restart).toMatchObject({ kind: 'kickoff', team: 1 });
    const b = sim.ball.translation();
    expect(Math.hypot(b.x, b.z)).toBeLessThan(0.01);
    expect(sim.players[0].pos).toEqual(sim.players[0].spec.kickoff);

    // Everyone holds still until the restart freeze is over, then play resumes.
    run(sim, R.restartFreeze - 0.2, () => cmd({ move: { x: 1, z: 0 } }));
    expect(sim.players[0].pos).toEqual(sim.players[0].spec.kickoff);
    run(sim, 0.4, () => cmd({ move: { x: 1, z: 0 } }));
    expect(sim.rules.inPlay).toBe(true);
    expect(sim.players[0].pos.x).toBeGreaterThan(sim.players[0].spec.kickoff.x);
  });

  it('scores for the other team at the other end', async () => {
    const sim = await createSim(1, []);
    const events = launch(sim, { x: -12, y: BALL_RADIUS, z: 0 }, { x: -20, y: 2, z: 0 }, 1.5);
    expect(ofType(events, 'goal')[0]).toMatchObject({ team: 1, end: -1 });
    expect(ofType(events, 'out')).toHaveLength(0); // the net is not out
  });

  it('reports hitting the woodwork', async () => {
    const sim = await createSim(1, []);
    const post = GOAL_WIDTH / 2 + 0.04;
    const events = launch(sim, { x: 10, y: BALL_RADIUS, z: post }, { x: 20, y: 1.5, z: 0 }, 1);
    expect(ofType(events, 'woodwork')[0]?.part).toBe('post');
  });
});

describe('ball over the netting', () => {
  it('gives a kick-in from the boards where it went out', async () => {
    const sim = await createSim(1, []);
    const events = launch(sim, { x: 6, y: BALL_RADIUS, z: 5 }, { x: 0, y: 12, z: 6 }, 1.5);
    const out = ofType(events, 'out');
    expect(out).toHaveLength(1);
    expect(out[0].restart.kind).toBe('kickIn');
    expect(out[0].restart.at.z).toBeCloseTo(HALF_WIDTH - 0.5);
    expect(out[0].restart.at.x).toBeCloseTo(6, 0);

    const later = run(sim, R.outDelay);
    expect(ofType(later, 'restart')).toHaveLength(1);
    const b = sim.ball.translation();
    expect(outOfCage(b)).toBe(false);
    expect(b.z).toBeCloseTo(HALF_WIDTH - 0.5);
    expect(Math.hypot(sim.ball.linvel().x, sim.ball.linvel().z)).toBe(0);
  });

  it('gives a goal clearance when it goes over an end wall', async () => {
    const sim = await createSim(1, []);
    const events = launch(sim, { x: 12, y: BALL_RADIUS, z: 6 }, { x: 8, y: 12, z: 0 }, 1.5);
    const out = ofType(events, 'out');
    expect(out).toHaveLength(1);
    expect(out[0].restart).toMatchObject({ kind: 'goalClearance', team: 1 });
    expect(out[0].restart.at.x).toBeGreaterThan(HALF_LENGTH - 4);
  });

  it('clears players off the restart spot', async () => {
    const sim = await createSim(1, solo({ x: 6, z: HALF_WIDTH - 0.6 }, 0));
    launch(sim, { x: 6, y: BALL_RADIUS, z: 5 }, { x: 0, y: 12, z: 6 }, 1.5 + R.outDelay);
    const p = sim.players[0].pos;
    const b = sim.ball.translation();
    expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeGreaterThanOrEqual(1 - 1e-9);
  });
});
