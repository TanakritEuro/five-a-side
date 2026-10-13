import { IDLE, type Command } from '../sim/command';

/** The parts of a `Gamepad` this reads (so tests can pass a plain object). */
export interface PadState {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Standard-mapping button indices. */
const A = 0;
const B = 1;
const X = 2;
const Y = 3;
const RB = 5;
const RT = 7;
const START = 9;
/** Stick deflection below this is ignored; above it, the stick's travel is rescaled to 0–1. */
const DEAD_ZONE = 0.2;

/**
 * A gamepad (standard mapping) → `Command`, like the keyboard's: the left stick moves
 * (screen-relative: up the screen is −Z, right is +X; part-way is a walk), RT or RB
 * sprints, A passes or switches, B shoots (hold) or tackles, X lobs or calls a press.
 */
export function padCommand(pad: PadState): Command {
  const held = (i: number) => pad.buttons[i]?.pressed ?? false;
  const x = pad.axes[0] ?? 0;
  const z = pad.axes[1] ?? 0;
  const len = Math.hypot(x, z);
  const amount = len < DEAD_ZONE ? 0 : Math.min(1, (len - DEAD_ZONE) / (1 - DEAD_ZONE));
  return {
    ...IDLE,
    move: amount > 0 ? { x: (x / len) * amount, z: (z / len) * amount } : { x: 0, z: 0 },
    sprint: held(RB) || (pad.buttons[RT]?.value ?? 0) > 0.5,
    pass: held(A),
    switch: held(A),
    shoot: held(B),
    tackle: held(B),
    lob: held(X),
    press: held(X),
  };
}

/** Both commands at once: a button held on either, and whichever stick or keys push further. */
export function mergeCommands(a: Command, b: Command): Command {
  const longer = Math.hypot(b.move.x, b.move.z) > Math.hypot(a.move.x, a.move.z) ? b.move : a.move;
  return {
    move: longer,
    sprint: a.sprint || b.sprint,
    pass: a.pass || b.pass,
    shoot: a.shoot || b.shoot,
    lob: a.lob || b.lob,
    tackle: a.tackle || b.tackle,
    switch: a.switch || b.switch,
    press: a.press || b.press,
    dive: a.dive ?? b.dive,
  };
}

/** Presses (not holds) of the buttons that drive the game rather than the players. */
export interface PadUi {
  /** A, for the menus' main button. */
  confirm: boolean;
  /** Y: replay. */
  replay: boolean;
  /** Start: pause. */
  pause: boolean;
}

/** The first connected gamepad, read once a frame. */
export class Gamepads {
  private last: boolean[] = [];

  /** This frame's command (idle with no pad), and the UI buttons pressed since last frame. */
  poll(): { command: Command; ui: PadUi } {
    const pad = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p?.connected) : null;
    if (!pad) {
      this.last = [];
      return { command: IDLE, ui: { confirm: false, replay: false, pause: false } };
    }
    const pressed = (i: number) => (pad.buttons[i]?.pressed ?? false) && !this.last[i];
    const ui = { confirm: pressed(A), replay: pressed(Y), pause: pressed(START) };
    this.last = pad.buttons.map((b) => b.pressed);
    return { command: padCommand(pad), ui };
  }
}
