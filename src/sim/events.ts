import type { BallPath } from '../ball/trajectory';
import type { Vec3 } from '../math';
import type { KickKind } from './player';

/**
 * Things that happened during a simulation step, for the presentation (status text,
 * sound, animation) and for tests. The simulation never reads these back.
 */
export type SimEvent =
  /** A player played the ball: a dribble touch, a first touch, or it bounced off them. */
  | { type: 'touch'; player: number; kind: 'dribble' | 'receive' | 'deflect' }
  /** A pass or shot: where it was aimed (after error) and its predicted path. */
  | { type: 'kick'; player: number; kind: KickKind; power: number; target: Vec3; path: BallPath };
