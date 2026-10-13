import type { ShotOutcome, Woodwork } from '../ball/outcome';
import type { BallPath } from '../ball/trajectory';
import type { Vec3 } from '../math';
import type { GoalEnd } from '../physics';
import type { KickKind } from './player';
import type { Restart } from './rules';
import type { TackleOutcome } from './tackle';

/**
 * Things that happened during a simulation step, for the presentation (status text,
 * sound, animation) and for tests. The simulation never reads these back.
 */
export type SimEvent =
  /** A player played the ball: a dribble touch, a first touch, or it bounced off them. */
  | { type: 'touch'; player: number; kind: 'dribble' | 'receive' | 'deflect' }
  /** A pass or shot: where it was aimed (after error), who a pass was for, and its predicted path. */
  | { type: 'kick'; player: number; kind: KickKind; power: number; target: Vec3; atGoal: boolean; receiver: number | null; path: BallPath }
  /** A tackle met (or missed) the ball: `carrier` is who had it, if anyone. */
  | { type: 'tackle'; player: number; carrier: number | null; outcome: TackleOutcome }
  /** A shoulder challenge began: `challenger` came into contact with the ball `carrier`. */
  | { type: 'challenge'; carrier: number; challenger: number }
  /** How a shot at goal ended. */
  | { type: 'shot'; player: number; outcome: ShotOutcome }
  /** The ball hit a post or the bar. */
  | { type: 'woodwork'; part: Woodwork }
  /** A keeper got to the ball: caught it, or parried it. */
  | { type: 'save'; player: number; caught: boolean }
  /** `team` scored in the goal at `end`. */
  | { type: 'goal'; team: 0 | 1; end: GoalEnd; score: [number, number] }
  /** The ball went over the netting. */
  | { type: 'out'; restart: Restart }
  /** The ball has been placed for a kick-off, kick-in or goal clearance, to be taken by `taker`. */
  | { type: 'restart'; restart: Restart; taker: number | null }
  /** The first half is over. */
  | { type: 'halfTime'; score: [number, number] }
  /** The match is over. */
  | { type: 'fullTime'; score: [number, number] };
