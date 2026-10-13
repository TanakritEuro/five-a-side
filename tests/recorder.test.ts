import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { emptyView, interpolate, type PlayerView } from '../src/render/interpolate';
import { Recorder } from '../src/replay/recorder';
import { Replay } from '../src/replay/replay';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';
import { STEPS_PER_SECOND } from './helpers';

/** Play an AI match, recording every step, until the first goal plus `after` seconds. */
async function toGoal(after: number) {
  const sim = await Sim.create({ seed: 5, players: fullLineup(), ai: true, kickoff: true });
  const rec = new Recorder();
  let goal: Extract<SimEvent, { type: 'goal' }> | null = null;
  let goalTick = 0;
  let left = after * STEPS_PER_SECOND;
  for (let i = 0; i < 10 * 60 * STEPS_PER_SECOND && left > 0; i++) {
    const events = sim.step([]);
    const owner = sim.handling.holder ?? sim.possession.owner;
    rec.capture(sim.curr, owner === null ? null : sim.players[owner].team);
    const g = events.find((e): e is Extract<SimEvent, { type: 'goal' }> => e.type === 'goal');
    if (g && !goal) {
      goal = g;
      goalTick = sim.curr.tick;
    }
    if (goal) left--;
  }
  return { sim, rec, goal: goal!, goalTick };
}

describe('recorder', () => {
  it('keeps only the last few seconds, as copies', async () => {
    const sim = await Sim.create({ seed: 1, players: fullLineup(), ai: true, kickoff: true });
    const rec = new Recorder();
    for (let i = 0; i < 20 * STEPS_PER_SECOND; i++) {
      sim.step([]);
      rec.capture(sim.curr, null);
    }
    expect(rec.length).toBeCloseTo(TUNING.replay.keep, 5);
    const clip = rec.last(2)!;
    expect(clip.frames).toHaveLength(2 * STEPS_PER_SECOND);
    // The sim rewrites its snapshots in place; the recording mustn't change with them.
    const kept = clip.frames[clip.frames.length - 1].players[3].x;
    for (let i = 0; i < STEPS_PER_SECOND; i++) sim.step([]);
    expect(clip.frames[clip.frames.length - 1].players[3].x).toBe(kept);
  });

  it("cuts a goal's clip from the move that made it to just after it", async () => {
    const R = TUNING.replay;
    const { rec, goal, goalTick } = await toGoal(R.after + 0.5);
    const clip = rec.goal(goalTick, goal.team, goal.end, 'goal')!;
    expect(clip.end).toBe(goal.end);
    const first = clip.frames[0].tick;
    const last = clip.frames[clip.frames.length - 1].tick;
    expect((goalTick - first) * PHYSICS_STEP).toBeGreaterThanOrEqual(R.minLength - 1e-9);
    expect((goalTick - first) * PHYSICS_STEP).toBeLessThanOrEqual(R.maxLength + 1e-9);
    expect((last - goalTick) * PHYSICS_STEP).toBeCloseTo(R.after, 1);
    // One snapshot per step, none missing.
    clip.frames.forEach((f, i) => expect(f.tick).toBe(first + i));
  });

  it('plays a clip back through the same interpolation as live play', () => {
    // A fake clip: one player running along x at 6 m/s.
    const frames = Array.from({ length: 60 }, (_, i) => {
      const s = { tick: i, ball: { pos: { x: 0, y: 0.11, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } }, players: [{ ...emptyView(), x: i * 6 * PHYSICS_STEP }] };
      return s;
    });
    const replay = new Replay();
    replay.play([{ frames, caption: 'test', end: 0 }], 0.5);
    const views: PlayerView[] = [];
    const ball = new THREE.Object3D();
    let frame = replay.update(0)!;
    expect(frame.fresh).toBe(true);
    // A real second at half speed is half a game second: 3 m along.
    for (let i = 0; i < 60; i++) frame = replay.update(1 / 60)!;
    interpolate(frame.prev, frame.curr, frame.alpha, ball, views);
    expect(views[0].x).toBeCloseTo(3, 1);
    // It ends after the last frame (and a short hold).
    for (let i = 0; i < 200 && replay.update(1 / 60); i++);
    expect(replay.active).toBe(false);
  });
});
