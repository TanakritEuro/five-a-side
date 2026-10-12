import type { Command } from '../sim/command';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK', 'KeyL', 'Space']);

/**
 * Keyboard → `Command`. Keys are read by physical position (`KeyboardEvent.code`), so
 * WASD works on any layout. Movement is screen-relative to the broadcast camera, which
 * sits on the +Z touchline looking towards −Z: up the screen is −Z, right is +X.
 */
export class Keyboard {
  private readonly down = new Set<string>();
  /**
   * Keys pressed since the last `clearTaps`, even if already let go: a tap shorter than a
   * frame (or one that lands on a frame with no simulation step) still registers.
   */
  private readonly tapped = new Set<string>();

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.tapped.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete((e as KeyboardEvent).code));
    // Don't leave keys stuck down when the window loses focus.
    target.addEventListener('blur', () => {
      this.down.clear();
      this.tapped.clear();
    });
  }

  command(): Command {
    const x = this.axis(RIGHT) - this.axis(LEFT);
    const z = this.axis(DOWN) - this.axis(UP);
    const len = Math.hypot(x, z);
    return {
      move: len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 },
      sprint: this.any(['ShiftLeft', 'ShiftRight']),
      pass: this.any(['KeyJ']),
      shoot: this.any(['KeyK']),
      lob: this.any(['KeyL']),
      // J, K and L are context buttons (pass or switch, shoot or tackle, lob or call a
      // press): HumanControl picks.
      tackle: this.any(['KeyK']),
      switch: this.any(['KeyJ']),
      press: this.any(['KeyL']),
      // You never drive a keeper, so you never dive.
      dive: null,
    };
  }

  /** Forget taps that have been seen by a simulation step. Call after stepping. */
  clearTaps(): void {
    this.tapped.clear();
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.down.has(c) || this.tapped.has(c));
  }

  private axis(codes: readonly string[]): number {
    return this.any(codes) ? 1 : 0;
  }
}
