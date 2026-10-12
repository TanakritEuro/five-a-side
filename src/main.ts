// Entry point. URL flags: ?seed=123 (fix the random seed), ?timescale=0.25 (slow motion),
// ?debug (overlays, and `game` on window), ?stats (fps, draw calls).

import { Game } from './game';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const timescale = Number(params.get('timescale') ?? 1);

const game = await Game.create(
  document.querySelector<HTMLCanvasElement>('#game')!,
  document.querySelector<HTMLElement>('#hud')!,
  {
    seed: seedParam !== null ? Number(seedParam) : Date.now(),
    timescale: Number.isFinite(timescale) && timescale > 0 ? timescale : 1,
    debug: params.has('debug'),
    stats: params.has('stats'),
  },
);
game.start();

// Inspect from the console with ?debug: `game.sim.players[0]`, `game.sim.ball.translation()`.
if (params.has('debug')) Object.assign(window, { game });
