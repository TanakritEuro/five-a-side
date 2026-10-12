export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A point or direction on the ground plane (world x, z). */
export interface Vec2 {
  x: number;
  z: number;
}

/** A random number generator returning floats in [0, 1), like `Math.random`. */
export type Rng = () => number;

/**
 * Seeded PRNG (mulberry32). Simulation code takes an `Rng` instead of calling
 * `Math.random`, so tests, replays and online play can reproduce a match exactly.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
export function gaussian(rng: Rng): number {
  const u = 1 - rng(); // (0, 1], keeps log() finite
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Frame-rate independent exponential smoothing factor for `rate` per second over `dt`. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Angle wrapped into (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Interpolate between two angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Unit direction on the ground for a heading (radians, 0 = +X, π/2 = +Z). */
export function headingVec(heading: number): Vec2 {
  return { x: Math.cos(heading), z: Math.sin(heading) };
}

/**
 * Scale a base value by a 0–1 attribute (0.5 = average): ±`spread` at the extremes,
 * e.g. spread 0.1 gives ×0.9 at 0 and ×1.1 at 1.
 */
export function attrScale(attr: number, spread: number): number {
  return 1 + spread * (attr - 0.5) * 2;
}
