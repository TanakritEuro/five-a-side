// Ported from ../penalty-shootout/src/shooting/spin.ts. Changes: spin for a strike in any
// horizontal direction (the penalty game only shot towards −Z); the contact-point nudge
// controls stay behind until there's an input for them.
import { TUNING } from '../config';
import type { Vec2, Vec3 } from '../math';

/**
 * Where the boot meets the ball, seen from behind it: x across (+ = right side of the
 * ball), y up (+ = top), as a fraction of the ball's radius. (0, 0) is a clean strike
 * through the middle.
 */
export interface Contact {
  x: number;
  y: number;
}

export const CENTRE: Contact = { x: 0, y: 0 };

/**
 * Spin (rad/s) from striking the ball at `contact`, for a kick heading along the unit
 * ground direction `dir`. Striking the right side spins it about +Y and the Magnus force
 * bends it left; striking underneath gives backspin (it holds up), over the top gives
 * topspin (it dips).
 */
export function spinFromContact(contact: Contact, power: number, dir: Vec2): Vec3 {
  const s = TUNING.spin.maxSpin * (0.5 + 0.5 * power);
  // The kicker's right, looking along `dir`. Backspin turns about it.
  const right = { x: -dir.z, z: dir.x };
  const back = -contact.y * s;
  return { x: right.x * back, y: contact.x * s, z: right.z * back };
}

/** Off-centre strikes lose some pace: the fraction of speed kept. */
export function contactSpeedFactor(contact: Contact): number {
  const off = Math.hypot(contact.x, contact.y) / TUNING.spin.maxOffset;
  return 1 - TUNING.spin.powerLoss * Math.min(1, off) ** 2;
}

/** Extra scatter (m, standard deviation) from an off-centre strike. */
export function contactScatter(contact: Contact): number {
  return TUNING.spin.extraScatter * Math.min(1, Math.hypot(contact.x, contact.y) / TUNING.spin.maxOffset);
}

/** The contact point at (x, y), pulled back inside the allowed circle if need be. */
export function clampContact(x: number, y: number): Contact {
  const r = Math.hypot(x, y);
  const max = TUNING.spin.maxOffset;
  return r > max ? { x: (x / r) * max, y: (y / r) * max } : { x, y };
}
