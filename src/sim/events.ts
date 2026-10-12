/**
 * Things that happened during a simulation step, for the presentation (status text,
 * sound, animation) and for tests. The simulation never reads these back.
 */
export type SimEvent =
  /** A player played the ball: a dribble touch, a first touch, or it bounced off them. */
  { type: 'touch'; player: number; kind: 'dribble' | 'receive' | 'deflect' };
