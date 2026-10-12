import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { BALL_RADIUS, CENTRE_CIRCLE_RADIUS, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH } from '../src/constants';
import type { Vec3 } from '../src/math';
import type { SimEvent } from '../src/sim/events';
import { KICK_IN_INSET, outOfCage } from '../src/sim/rules';
import type { Sim } from '../src/sim/sim';
import { cmd, createSim, run, solo, STEPS_PER_SECOND } from './helpers';

const R = TUNING.match;

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
    const away = solo({ x: 1.6, z: 0 }, Math.PI).map((s) => ({ ...s, team: 1 as const }));
    const sim = await createSim(1, [...solo({ x: 9.4, z: 0 }, 0), ...away]);
    sim.placeBall({ x: 10, z: 0 });
    const hold = Math.round(0.6 * TUNING.shot.chargeTime * STEPS_PER_SECOND);
    const events = run(sim, 2, (i) => cmd({ shoot: i < hold }));
    const goal = ofType(events, 'goal');
    expect(goal).toHaveLength(1);
    expect(goal[0]).toMatchObject({ team: 0, end: 1, score: [1, 0] });
    expect(sim.match.score).toEqual([1, 0]);
    expect(ofType(events, 'shot')[0]?.outcome.kind).toBe('goal');
    expect(sim.match.inPlay).toBe(false);

    // Keep running until the restart: the team that conceded kicks off.
    let restart: Extract<SimEvent, { type: 'restart' }> | undefined;
    for (let i = 0; i < (R.goalDelay + 1) * STEPS_PER_SECOND && !restart; i++) {
      restart = ofType(sim.step([cmd({ move: { x: 1, z: 0 } })]), 'restart')[0];
    }
    expect(restart).toMatchObject({ restart: { kind: 'kickoff', team: 1 }, taker: 1 });
    const b = sim.ball.translation();
    expect(Math.hypot(b.x, b.z)).toBeLessThan(0.01);

    // Until the kick-off is taken the clock stops, and the other team can't come into
    // the centre circle or the opposing half however hard they try.
    const clock = sim.match.clock.elapsed;
    run(sim, 2, () => cmd({ move: { x: 1, z: 0 }, sprint: true }));
    const p = sim.players[0].pos;
    expect(p.x).toBeLessThan(0);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(CENTRE_CIRCLE_RADIUS);
    expect(sim.match.clock.elapsed).toBe(clock);
    expect(sim.match.inPlay).toBe(false);

    // The taker passes: play is on.
    const taken = run(sim, 0.2, (i) => [cmd(), cmd({ pass: i === 0 })]);
    expect(ofType(taken, 'kick')[0]?.player).toBe(1);
    expect(sim.match.inPlay).toBe(true);
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
    expect(out[0].restart.at.z).toBeCloseTo(HALF_WIDTH - KICK_IN_INSET);
    expect(out[0].restart.at.x).toBeCloseTo(6, 0);

    const later = run(sim, R.outDelay);
    expect(ofType(later, 'restart')).toHaveLength(1);
    const b = sim.ball.translation();
    expect(outOfCage(b)).toBe(false);
    expect(b.z).toBeCloseTo(HALF_WIDTH - KICK_IN_INSET);
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

  it('puts the taker behind the ball facing infield, and keeps opponents back until the kick', async () => {
    const away = solo({ x: 6.5, z: HALF_WIDTH - 1.5 }, 0).map((s) => ({ ...s, team: 1 as const }));
    const sim = await createSim(1, [...solo({ x: -5, z: 0 }, 0), ...away]);
    // Nobody touched it, so the kick-in goes to team 0 (player 0).
    launch(sim, { x: 6, y: BALL_RADIUS, z: 5 }, { x: 0, y: 12, z: 6 }, 1.5 + R.outDelay);
    expect(sim.match.taker).toBe(0);
    const b = sim.ball.translation();
    const dist = (id: number) => Math.hypot(sim.players[id].pos.x - b.x, sim.players[id].pos.z - b.z);
    expect(dist(0)).toBeCloseTo(R.takerOffset);
    expect(Math.sin(sim.players[0].facing)).toBeLessThan(-0.5); // facing infield (-Z)

    // The opponent can't close in; the taker can turn but not run off.
    run(sim, 1, () => [cmd({ move: { x: 1, z: 0 } }), cmd({ move: { x: -1, z: 0 } })]);
    expect(dist(1)).toBeGreaterThanOrEqual(R.setPieceDistance - 1e-9);
    expect(dist(0)).toBeCloseTo(R.takerOffset);
    expect(Math.cos(sim.players[0].facing)).toBeGreaterThan(0.9);
    expect(sim.match.inPlay).toBe(false);
  });
});
