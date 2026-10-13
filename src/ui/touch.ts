import { IDLE, type Command } from '../sim/command';
import { button, div } from './menu';

/** How far (px) the thumb moves the stick to full deflection. */
const STICK_RADIUS = 60;

/** Is this a touch device (so the on-screen controls should show)? */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || window.matchMedia?.('(pointer: coarse)').matches);
}

/**
 * On-screen controls for touch devices: a floating stick wherever the left thumb lands,
 * and buttons on the right for pass, shoot and sprint (plus pause). They make the same
 * `Command`s as the keyboard; a tap shorter than a frame still counts.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private stick: { id: number; x: number; y: number } | null = null;
  private move = { x: 0, z: 0 };
  /** Buttons held now, and pressed since the last `clearTaps`. */
  private readonly down = new Set<string>();
  private readonly tapped = new Set<string>();

  constructor(parent: HTMLElement, onPause: () => void) {
    this.root = div(parent, 'touch hidden');
    const pad = div(this.root, 'touch-stick-area');
    this.base = div(pad, 'touch-stick hidden');
    this.knob = div(this.base, 'touch-knob');
    pad.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      pad.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.remove('hidden');
      this.drag(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', (e) => {
      if (this.stick?.id === e.pointerId) this.drag(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (this.stick?.id !== e.pointerId) return;
      this.stick = null;
      this.move = { x: 0, z: 0 };
      this.base.classList.add('hidden');
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);

    const buttons = div(this.root, 'touch-buttons');
    for (const [name, label] of [
      ['sprint', 'Sprint'],
      ['pass', 'Pass'],
      ['shoot', 'Shoot'],
    ] as const) {
      const b = button(buttons, label, `touch-button touch-${name}`);
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        this.down.add(name);
        this.tapped.add(name);
      });
      const up = () => this.down.delete(name);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
    button(this.root, 'II', 'touch-pause').addEventListener('click', onPause);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  command(): Command {
    const on = (name: string) => this.down.has(name) || this.tapped.has(name);
    return {
      ...IDLE,
      move: this.move,
      sprint: on('sprint'),
      pass: on('pass'),
      switch: on('pass'),
      shoot: on('shoot'),
      tackle: on('shoot'),
    };
  }

  /** Forget taps that a simulation step has now seen. */
  clearTaps(): void {
    this.tapped.clear();
  }

  /** The thumb is at (x, y) on screen: deflect the stick (screen up is −Z, right is +X). */
  private drag(x: number, y: number): void {
    const s = this.stick!;
    let dx = x - s.x;
    let dy = y - s.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone, then the direction of the (clamped) offset and how far it reaches.
    const amount = Math.min(1, len / STICK_RADIUS);
    const cl = Math.hypot(dx, dy);
    this.move = cl < 6 ? { x: 0, z: 0 } : { x: (dx / cl) * amount, z: (dy / cl) * amount };
  }
}
