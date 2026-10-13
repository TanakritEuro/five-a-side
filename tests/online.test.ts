import { describe, expect, it } from 'vitest';
import { rollingSpin } from '../src/ball/forces';
import { BALL_RADIUS, HALF_LENGTH } from '../src/constants';
import { GuestSession, type GuestEvents } from '../src/online/guest';
import { HostSession, type HostEvents } from '../src/online/host';
import { loopback } from '../src/online/loopback';
import { PROTOCOL } from '../src/online/protocol';
import type { WireFrame } from '../src/online/snapshots';
import { cmd } from './helpers';
import { HumanControl } from '../src/sim/control';
import { placePlayer } from '../src/sim/player';
import type { SimEvent } from '../src/sim/events';
import { Sim } from '../src/sim/sim';
import { fullLineup } from '../src/team/lineup';

const noHost: HostEvents = { onHello: () => true, onSkip: () => {}, onPause: () => {}, onResume: () => {}, onClose: () => {} };
const noGuest: GuestEvents = { onWelcome: () => {}, onEvents: () => {}, onReplay: () => {}, onReplayStop: () => {}, onPaused: () => {}, onClose: () => {} };

/** A host running a sim with the guest driving team 1, joined by an in-memory link. */
async function match(guestEvents: Partial<GuestEvents> = {}, hostEvents: Partial<HostEvents> = {}) {
  const { a, b, flush } = loopback();
  const host = new HostSession(a, { ...noHost, ...hostEvents });
  const guest = new GuestSession(b, 'NGC', { ...noGuest, ...guestEvents });
  flush();
  host.welcome('RIV', 'NGC', 180);
  flush();
  const sim = await Sim.create({ seed: 3, players: fullLineup(), ai: true });
  const remote = new HumanControl(1, sim.players.findIndex((p) => p.team === 1 && p.spec.role === 'pivot'));
  const frame = (): WireFrame => ({
    snapshot: sim.curr,
    owner: null,
    controlled: remote.controlled,
    stamina: sim.players[remote.controlled].stamina,
    score: [sim.match.score[0], sim.match.score[1]],
    half: sim.match.clock.half,
    clock: sim.match.halfLength - sim.match.clock.elapsed,
    shootout: null,
  });
  /** One host step with the guest's command, the messages delivered both ways. */
  const step = (guestCommand = cmd(), now = 0): SimEvent[] => {
    guest.input(guestCommand, now);
    flush();
    const commands = [];
    commands[remote.controlled] = remote.command(sim, host.command);
    const events = sim.step(commands);
    remote.afterStep(sim, events);
    host.step(events, frame);
    flush();
    return events;
  };
  return { host, guest, sim, remote, step, flush, a, b };
}

describe('online', () => {
  it("joins: the guest's hello is welcomed with the teams", async () => {
    let welcomed: string[] = [];
    const { host } = await match({ onWelcome: (h, a) => (welcomed = [h, a]) });
    expect(host.ready).toBe(true);
    expect(welcomed).toEqual(['RIV', 'NGC']);
  });

  it("moves the guest's player in the host's simulation, and the guest sees it", async () => {
    const { sim, remote, step, guest } = await match();
    const me = sim.players[remote.controlled];
    const start = me.pos.x;
    for (let i = 0; i < 90; i++) step(cmd({ move: { x: -1, z: 0 } }), i * 17);
    expect(me.pos.x).toBeLessThan(start - 4);
    // The guest, drawing a few steps behind, sees the player about where the host has them.
    let view = guest.view(1 / 60);
    for (let i = 0; i < 10; i++) view = guest.view(1 / 60);
    expect(view).not.toBeNull();
    const seen = view!.curr.snapshot.players[remote.controlled].x;
    expect(Math.abs(seen - me.pos.x)).toBeLessThan(1);
    expect(view!.curr.controlled).toBe(remote.controlled);
    expect(guest.latest!.snapshot.tick).toBeGreaterThan(80);
  });

  it('sends the events, a goal included, to the guest', async () => {
    const got: SimEvent[] = [];
    const { sim, step } = await match({ onEvents: (e) => got.push(...e) });
    // An empty net: the away keeper is off to one side.
    const keeper = sim.players.find((p) => p.team === 1 && p.keeper)!;
    placePlayer(keeper, { x: HALF_LENGTH - 2, z: 7 }, Math.PI);
    sim.possession.kick(0);
    sim.ball.setTranslation({ x: HALF_LENGTH - 3, y: BALL_RADIUS, z: 0 }, true);
    sim.ball.setLinvel({ x: 12, y: 0, z: 0 }, true);
    sim.ball.setAngvel(rollingSpin(12, 0), true);
    for (let i = 0; i < 60; i++) step();
    expect(got.some((e) => e.type === 'goal' && e.team === 0)).toBe(true);
  });

  it('refuses a guest on another version', async () => {
    const { a, b, flush } = loopback();
    let closed = '';
    new HostSession(a, { ...noHost, onClose: (r) => (closed = r) });
    let refused = '';
    b.onMessage = (m) => {
      if ((m as { type: string }).type === 'reject') refused = (m as { reason: string }).reason;
    };
    b.send({ type: 'hello', version: PROTOCOL + 1, team: 'NGC' });
    flush();
    expect(refused).toContain('different version');
    expect(closed).toContain('different version');
  });

  it('tells the host when the guest leaves', async () => {
    let reason = '';
    const { guest, flush } = await match({}, { onClose: (r) => (reason = r) });
    guest.leave();
    flush();
    expect(reason).toContain('left');
  });
});
