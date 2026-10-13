import { describe, expect, it } from 'vitest';
import { packFrame, unpackFrame, type WireFrame } from '../src/online/snapshots';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';

describe('snapshots on the wire', () => {
  it('unpack to what was packed, every field, through a real match', async () => {
    const sim = await Sim.create({ seed: 4, players: fullLineup(), ai: true, kickoff: true });
    let actions = 0;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step([]);
      if (i % 7) continue;
      const frame: WireFrame = {
        snapshot: sim.curr,
        owner: sim.possession.owner === null ? null : sim.players[sim.possession.owner].team,
        controlled: 7,
        stamina: sim.players[7].stamina,
        score: [sim.match.score[0], sim.match.score[1]],
        half: sim.match.clock.half,
        clock: sim.match.halfLength - sim.match.clock.elapsed,
        shootout: null,
      };
      const back = unpackFrame(packFrame(frame))!;
      expect(back).not.toBeNull();
      expect(back.snapshot.tick).toBe(frame.snapshot.tick);
      expect(back.owner).toBe(frame.owner);
      expect(back.controlled).toBe(7);
      expect(back.score).toEqual(frame.score);
      expect(back.snapshot.ball.pos.x).toBeCloseTo(frame.snapshot.ball.pos.x, 4);
      back.snapshot.players.forEach((p, k) => {
        const q = frame.snapshot.players[k];
        for (const f of ['x', 'z', 'facing', 'y', 'lean', 'arms', 'speed', 'charge', 'tackle'] as const) expect(p[f]).toBeCloseTo(q[f], 4);
        expect(p.sprinting).toBe(q.sprinting);
        expect(p.holding).toBe(q.holding);
        expect(p.action).toEqual(q.action);
        expect(p.mood).toBe(q.mood);
        if (q.action) actions++;
      });
    }
    expect(actions).toBeGreaterThan(100);
  });

  it("refuse what isn't a frame", () => {
    expect(unpackFrame(new Float32Array(5))).toBeNull();
    const frame = packFrame({
      snapshot: { tick: 1, ball: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } }, players: [] },
      owner: null, controlled: null, stamina: 1, score: [0, 0], half: 1, clock: 100, shootout: null,
    });
    expect(unpackFrame(frame)).toBeNull(); // no players
    const bad = packFrame({
      snapshot: { tick: 1, ball: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } }, players: [{ x: 0, z: 0, facing: 0, y: 0, lean: 0, arms: 0, speed: 0, sprinting: false, charge: 0, tackle: -1, holding: false, action: null, mood: null }] },
      owner: null, controlled: null, stamina: 1, score: [0, 0], half: 1, clock: 100, shootout: null,
    });
    expect(unpackFrame(bad)).not.toBeNull();
    bad[13] = 3; // half 3
    expect(unpackFrame(bad)).toBeNull();
    bad[13] = 1;
    bad[20] = NaN;
    expect(unpackFrame(bad)).toBeNull();
  });
});
