// Invented teams only: no real club names, crests or kits.

export interface Team {
  name: string;
  short: string;
  shirt: number;
  shorts: number;
  keeperShirt: number;
}

export const TEAMS: readonly Team[] = [
  { name: 'Riverside Rovers', short: 'RIV', shirt: 0x1f6fd1, shorts: 0xffffff, keeperShirt: 0x2fbf4a },
  { name: 'Northgate Comets', short: 'NGC', shirt: 0xd23b2c, shorts: 0x1a1a1a, keeperShirt: 0xf2c230 },
];
