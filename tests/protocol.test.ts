import { describe, expect, it } from 'vitest';
import { forWire, parseCommand, parseEvent, parseGuestMessage, parseHostMessage, PROTOCOL } from '../src/online/protocol';
import { IDLE } from '../src/sim/command';

describe('online messages', () => {
  it('accept well-formed guest messages and clamp their commands', () => {
    expect(parseGuestMessage({ type: 'hello', version: PROTOCOL, team: 'NGC' })).toEqual({ type: 'hello', version: PROTOCOL, team: 'NGC' });
    const input = parseGuestMessage({ type: 'input', command: { ...IDLE, move: { x: 3, z: 4 }, shoot: true, dive: { across: 1, height: 1 } } });
    expect(input?.type).toBe('input');
    if (input?.type !== 'input') return;
    expect(Math.hypot(input.command.move.x, input.command.move.z)).toBeCloseTo(1, 6);
    expect(input.command.shoot).toBe(true);
    expect(input.command.dive).toBeNull(); // a guest never dives a keeper
  });

  it('drop malformed messages', () => {
    for (const raw of [null, 3, 'hello', { type: 'hello' }, { type: 'hello', version: '1', team: 'X' }, { type: 'input', command: { move: { x: 'a', z: 0 } } }, { type: 'input', command: { ...IDLE, pass: 1 } }, { type: 'nope' }]) {
      expect(parseGuestMessage(raw)).toBeNull();
    }
    expect(parseCommand({ ...IDLE, move: { x: Infinity, z: 0 } })).toBeNull();
    expect(parseHostMessage({ type: 'welcome', home: 'RIV', away: 'NGC', halfLength: -5 })).toBeNull();
    expect(parseHostMessage({ type: 'frame', data: [1, 2, 3] })).toBeNull();
    expect(parseHostMessage({ type: 'events', events: [{ type: 'goal', team: 3 }] })).toBeNull();
    expect(parseHostMessage({ type: 'replay', tick: 5, team: 0, end: 2, caption: 'x' })).toBeNull();
  });

  it('pass events through, kick paths cut to their first point', () => {
    const kick = {
      type: 'kick' as const, player: 3, kind: 'shoot' as const, power: 0.7, target: { x: 20, y: 1, z: 0 }, atGoal: true, receiver: null,
      path: { dt: 1 / 60, points: [{ x: 1, y: 0.11, z: 0 }, { x: 2, y: 0.2, z: 0 }, { x: 3, y: 0.3, z: 0 }] },
    };
    const wire = forWire(kick);
    expect(wire.type === 'kick' && wire.path.points).toHaveLength(1);
    expect(parseEvent(wire)).toEqual(wire);
    const msg = parseHostMessage({ type: 'events', events: [wire, { type: 'goal', team: 1, end: -1, score: [0, 1], scorer: 8 }] });
    expect(msg?.type === 'events' && msg.events).toHaveLength(2);
  });
});
