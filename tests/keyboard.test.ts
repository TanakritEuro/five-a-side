import { describe, expect, it } from 'vitest';
import { Keyboard } from '../src/input/keyboard';

/** A key event as the browser sends it: only `code` and `preventDefault` are used. */
function key(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code });
}

describe('keyboard', () => {
  it('still sees a tap that is pressed and released between two frames', () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key('keydown', 'KeyJ'));
    target.dispatchEvent(key('keyup', 'KeyJ'));
    expect(keyboard.command().pass).toBe(true);
    // Once a simulation step has seen it, it's gone.
    keyboard.clearTaps();
    expect(keyboard.command().pass).toBe(false);
  });

  it('keeps a held key down across frames', () => {
    const target = new EventTarget();
    const keyboard = new Keyboard(target);
    target.dispatchEvent(key('keydown', 'KeyD'));
    keyboard.clearTaps();
    expect(keyboard.command().move).toEqual({ x: 1, z: 0 });
    target.dispatchEvent(key('keyup', 'KeyD'));
    expect(keyboard.command().move).toEqual({ x: 0, z: 0 });
  });
});
