/**
 * Things that happened during a simulation step, for the presentation (status text,
 * sound, animation) and for tests. The simulation never reads these back.
 */
export type SimEvent = { type: 'touch'; player: number };
