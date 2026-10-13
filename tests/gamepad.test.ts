import { describe, expect, it } from 'vitest';
import { mergeCommands, padCommand, type PadState } from '../src/input/gamepad';
import { IDLE } from '../src/sim/command';

function pad(axes: [number, number], pressed: number[] = [], rt = 0): PadState {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: i === 7 ? rt : pressed.includes(i) ? 1 : 0 }));
  return { axes, buttons };
}

describe('gamepad', () => {
  it('ignores a resting stick and rescales beyond the dead zone', () => {
    expect(padCommand(pad([0.1, -0.12])).move).toEqual({ x: 0, z: 0 });
    const full = padCommand(pad([0, -1])).move;
    expect(full.x).toBeCloseTo(0, 6);
    expect(full.z).toBeCloseTo(-1, 6); // up the screen is −Z, as on the keyboard
    const half = padCommand(pad([0.6, 0])).move;
    expect(half.x).toBeCloseTo(0.5, 6); // part-way: a walk
  });

  it('maps the buttons to the same meanings as J, K and L', () => {
    expect(padCommand(pad([0, 0], [0]))).toMatchObject({ pass: true, switch: true, shoot: false });
    expect(padCommand(pad([0, 0], [1]))).toMatchObject({ shoot: true, tackle: true, pass: false });
    expect(padCommand(pad([0, 0], [2]))).toMatchObject({ lob: true, press: true });
    expect(padCommand(pad([0, 0], [], 0.8)).sprint).toBe(true);
    expect(padCommand(pad([0, 0], [5])).sprint).toBe(true);
    expect(padCommand(pad([0, 0], [], 0.3)).sprint).toBe(false);
  });

  it('merges with the keyboard: either one holding a button, the stronger move', () => {
    const keys = { ...IDLE, move: { x: 1, z: 0 }, shoot: true };
    const stick = { ...padCommand(pad([0, 0.5])), pass: true };
    const both = mergeCommands(keys, stick);
    expect(both.move).toEqual({ x: 1, z: 0 });
    expect(both).toMatchObject({ shoot: true, pass: true, sprint: false });
    expect(mergeCommands(IDLE, stick).move).toEqual(stick.move);
  });
});
