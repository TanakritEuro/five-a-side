import type { Vec2 } from '../math';

/**
 * What a player is told to do this step. The keyboard (or a gamepad) and the AI both
 * produce these, so a player doesn't know who is driving it. Buttons are "held" flags:
 * the simulation does the press/release detection and times holds in fixed steps, so a
 * recorded command stream replays exactly.
 */
export interface Command {
  /** World ground-plane direction, length 0–1 (less than 1 = walking / analogue stick). */
  move: Vec2;
  sprint: boolean;
  /** Ground pass (J). */
  pass: boolean;
  /** Shot, held for power (K). */
  shoot: boolean;
  /** Lofted pass / chip, held for power (L). Not used until a later milestone. */
  lob: boolean;
  /** Standing tackle (K out of possession). Not used until Milestone 4. */
  tackle: boolean;
  /** Switch player (J out of possession). Not used until Milestone 2. */
  switch: boolean;
}

export const IDLE: Readonly<Command> = Object.freeze({
  move: Object.freeze({ x: 0, z: 0 }),
  sprint: false,
  pass: false,
  shoot: false,
  lob: false,
  tackle: false,
  switch: false,
});
