// Invented teams only: no real club names, crests or kits.
import type { Attributes } from '../sim/player';
import type { Role } from './formation';

export interface Team {
  name: string;
  short: string;
  shirt: number;
  shorts: number;
  keeperShirt: number;
  /** Ratings that differ from average (0.5), by position. */
  squad: Record<Role, Partial<Attributes>>;
}

export const TEAMS: readonly Team[] = [
  {
    name: 'Riverside Rovers',
    short: 'RIV',
    shirt: 0x1f6fd1,
    shorts: 0xffffff,
    keeperShirt: 0x2fbf4a,
    squad: {
      keeper: { keeping: 0.6 },
      defender: { tackling: 0.65, pace: 0.45, strength: 0.65 },
      left: { pace: 0.65, passing: 0.55 },
      right: { pace: 0.6, shooting: 0.55 },
      pivot: { shooting: 0.65, passing: 0.55, strength: 0.6 },
    },
  },
  {
    name: 'Northgate Comets',
    short: 'NGC',
    shirt: 0xd23b2c,
    shorts: 0x1a1a1a,
    keeperShirt: 0xf2c230,
    squad: {
      keeper: { keeping: 0.55 },
      defender: { tackling: 0.6, passing: 0.6, strength: 0.6 },
      left: { pace: 0.6, strength: 0.4 },
      right: { pace: 0.55, passing: 0.6 },
      pivot: { shooting: 0.6, pace: 0.6 },
    },
  },
];
