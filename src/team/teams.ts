// Invented teams only: no real club names, crests or kits.
import type { Attributes } from '../sim/player';
import type { Role } from './formation';

/** An outfield kit's colours. */
export interface KitColours {
  shirt: number;
  shorts: number;
  socks: number;
}

export interface Team {
  name: string;
  short: string;
  /** Home and away kits. */
  kits: readonly [KitColours, KitColours];
  /** The keeper's kit (long-sleeved) and gloves. */
  keeper: KitColours & { gloves: number };
  /** Ratings that differ from average (0.5), by position. */
  squad: Record<Role, Partial<Attributes>>;
}

const kit = (shirt: number, shorts: number, socks: number): KitColours => ({ shirt, shorts, socks });

/**
 * Eight invented teams. The first two (Riverside and Northgate) are the defaults the
 * tests and `?aivsai` use, and the AI was tuned with them.
 */
export const TEAMS: readonly Team[] = [
  {
    name: 'Riverside Rovers',
    short: 'RIV',
    kits: [kit(0x1f6fd1, 0xffffff, 0x1f6fd1), kit(0xf2f2f2, 0x1f6fd1, 0xf2f2f2)],
    keeper: { ...kit(0x2fbf4a, 0x1a1a1a, 0x2fbf4a), gloves: 0xf2f2f2 },
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
    kits: [kit(0xd23b2c, 0x1a1a1a, 0xd23b2c), kit(0x222222, 0xd23b2c, 0x222222)],
    keeper: { ...kit(0xf2c230, 0x1a1a1a, 0xf2c230), gloves: 0x2a2a2a },
    squad: {
      keeper: { keeping: 0.55 },
      defender: { tackling: 0.6, passing: 0.6, strength: 0.6 },
      left: { pace: 0.6, strength: 0.4 },
      right: { pace: 0.55, passing: 0.6 },
      pivot: { shooting: 0.6, pace: 0.6 },
    },
  },
  {
    name: 'Harbour Town',
    short: 'HBT',
    kits: [kit(0x1b2a4a, 0x1b2a4a, 0xffffff), kit(0x8ec9f0, 0x1b2a4a, 0x8ec9f0)],
    keeper: { ...kit(0xf28c28, 0x1a1a1a, 0xf28c28), gloves: 0xf2f2f2 },
    squad: {
      keeper: { keeping: 0.65 },
      defender: { tackling: 0.7, strength: 0.7, pace: 0.4 },
      left: { tackling: 0.55, passing: 0.5 },
      right: { tackling: 0.55, strength: 0.6 },
      pivot: { strength: 0.65, shooting: 0.5 },
    },
  },
  {
    name: 'Millbrook Athletic',
    short: 'MIL',
    kits: [kit(0x2e8b3d, 0xffffff, 0x2e8b3d), kit(0xf2d23a, 0x2e8b3d, 0xf2d23a)],
    keeper: { ...kit(0x7a3fb0, 0x1a1a1a, 0x7a3fb0), gloves: 0xf2f2f2 },
    squad: {
      keeper: { keeping: 0.5 },
      defender: { passing: 0.65, tackling: 0.55 },
      left: { passing: 0.65, pace: 0.55 },
      right: { passing: 0.65, shooting: 0.5 },
      pivot: { passing: 0.7, shooting: 0.55 },
    },
  },
  {
    name: 'Lakeside Falcons',
    short: 'LAK',
    kits: [kit(0x6cb4e8, 0x1b2a4a, 0x6cb4e8), kit(0x7a1f2e, 0xffffff, 0x7a1f2e)],
    keeper: { ...kit(0xa5d63a, 0x1a1a1a, 0xa5d63a), gloves: 0x2a2a2a },
    squad: {
      keeper: { keeping: 0.5 },
      defender: { pace: 0.6, tackling: 0.55 },
      left: { pace: 0.7, strength: 0.4 },
      right: { pace: 0.7, shooting: 0.5 },
      pivot: { pace: 0.65, shooting: 0.6, strength: 0.45 },
    },
  },
  {
    name: 'Southbank Strikers',
    short: 'SBS',
    kits: [kit(0xf07a1f, 0x1a1a1a, 0xf07a1f), kit(0xf2f2f2, 0xf07a1f, 0xf2f2f2)],
    keeper: { ...kit(0x2ac7c7, 0x1a1a1a, 0x2ac7c7), gloves: 0xf2f2f2 },
    squad: {
      keeper: { keeping: 0.45 },
      defender: { tackling: 0.5, shooting: 0.55 },
      left: { shooting: 0.65, pace: 0.55 },
      right: { shooting: 0.65, passing: 0.5 },
      pivot: { shooting: 0.75, strength: 0.55 },
    },
  },
  {
    name: 'Westcliff Harriers',
    short: 'WCH',
    kits: [kit(0xf2c12e, 0x1f4fa0, 0xf2c12e), kit(0x5b3a96, 0xf2c12e, 0x5b3a96)],
    keeper: { ...kit(0xe85a9a, 0x1a1a1a, 0xe85a9a), gloves: 0xf2f2f2 },
    squad: {
      keeper: { keeping: 0.55 },
      defender: { strength: 0.75, tackling: 0.6 },
      left: { strength: 0.6, pace: 0.5 },
      right: { strength: 0.6, tackling: 0.55 },
      pivot: { strength: 0.7, shooting: 0.55 },
    },
  },
  {
    name: 'Pinewood Pumas',
    short: 'PPU',
    kits: [kit(0x6b3fa0, 0xffffff, 0x6b3fa0), kit(0x1a9a8a, 0x1a1a1a, 0x1a9a8a)],
    keeper: { ...kit(0x8a8a8a, 0x1a1a1a, 0x8a8a8a), gloves: 0xf2f2f2 },
    squad: {
      keeper: { keeping: 0.55 },
      defender: { tackling: 0.55, passing: 0.55 },
      left: { pace: 0.55, passing: 0.55 },
      right: { pace: 0.55, shooting: 0.55 },
      pivot: { shooting: 0.6, passing: 0.55 },
    },
  },
];

/**
 * How different two colours look (0 the same, about 765 black against white), weighted
 * for the eye ("redmean").
 */
export function colourDistance(a: number, b: number): number {
  const [r1, g1, b1] = [(a >> 16) & 255, (a >> 8) & 255, a & 255];
  const [r2, g2, b2] = [(b >> 16) & 255, (b >> 8) & 255, b & 255];
  const r = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

/** Shirts closer than this clash. */
export const CLASH = 160;

/**
 * The kits two teams wear against each other: the home team its home kit, the away team
 * its home kit unless the shirts clash, then whichever of its kits is further from the
 * home shirt.
 */
export function matchKits(home: Team, away: Team): [KitColours, KitColours] {
  const homeKit = home.kits[0];
  const awayKit = colourDistance(homeKit.shirt, away.kits[0].shirt) >= CLASH ? away.kits[0] : farther(homeKit.shirt, away.kits);
  return [homeKit, awayKit];
}

function farther(shirt: number, kits: readonly [KitColours, KitColours]): KitColours {
  return colourDistance(shirt, kits[0].shirt) >= colourDistance(shirt, kits[1].shirt) ? kits[0] : kits[1];
}
