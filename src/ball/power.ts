// Ported from ../penalty-shootout/src/shooting/power.ts. Changes: randomness from the
// passed-in seeded RNG, and scatter that grows with the distance to the target.
import { TUNING } from '../config';
import { BALL_RADIUS } from '../constants';
import { gaussian, type Rng } from '../math';

const T = TUNING.shot;
/** Scatter values in TUNING.shot are for a shot from this far (m). */
const REFERENCE_DISTANCE = 10;

/** Power (0–1) after holding the button for `elapsed` seconds. Caps at full power. */
export function powerFromCharge(elapsed: number): number {
  return Math.min(1, elapsed / T.chargeTime);
}

/** Average ball speed (m/s) for a given power. */
export function speedForPower(power: number): number {
  return T.minSpeed + (T.maxSpeed - T.minSpeed) * power;
}

/** 0 while the shot is under control, rising to 1 at full power. */
export function overpower(power: number): number {
  const over = (power - T.overpowerThreshold) / (1 - T.overpowerThreshold);
  return Math.pow(Math.min(1, Math.max(0, over)), T.overpowerCurve);
}

/** Standard deviation (m) of the random scatter on the shot at this power, from 10 m. */
export function scatterForPower(power: number): number {
  return T.baseScatter + T.overpowerScatter * overpower(power);
}

/**
 * Where the ball actually goes when the player aims `lateral` metres across from the
 * centre of the target at height `y`, from `distance` metres away. Overpowered shots
 * drift high and away from the centre, plus random scatter that grows with distance.
 * `scatterScale` multiplies the scatter (the shooting attribute) and `extraScatter` (m)
 * adds more, e.g. for an off-centre strike.
 */
export function applyShotError(
  aim: { lateral: number; y: number },
  power: number,
  distance: number,
  rng: Rng,
  scatterScale = 1,
  extraScatter = 0,
): { lateral: number; y: number } {
  const over = overpower(power);
  const range = Math.max(0.5, distance / REFERENCE_DISTANCE);
  const scatter = (scatterForPower(power) + extraScatter) * scatterScale * range;
  // Drift away from the side being aimed at; a dead-centre aim can slice either way.
  const side = Math.abs(aim.lateral) > 0.05 ? Math.sign(aim.lateral) : rng() < 0.5 ? -1 : 1;
  return {
    lateral: aim.lateral + side * over * T.overpowerWideDrift * (0.5 + 0.5 * rng()) + gaussian(rng) * scatter,
    y: Math.max(BALL_RADIUS, aim.y + over * T.overpowerHighDrift * (0.6 + 0.4 * rng()) + gaussian(rng) * scatter),
  };
}
