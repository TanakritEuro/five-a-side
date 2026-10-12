// Entry point. URL flags: ?seed=123 (fix the random seed), ?timescale=0.25 (slow motion),
// ?debug (expose `game` on window).

import { Game } from './game';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const timescale = Number(params.get('timescale') ?? 1);

const game = await Game.create(
  document.querySelector<HTMLCanvasElement>('#game')!,
  {
    scoreboard: document.querySelector<HTMLElement>('#scoreboard')!,
    status: document.querySelector<HTMLElement>('#status')!,
  },
  {
    seed: seedParam !== null ? Number(seedParam) : Date.now(),
    timescale: Number.isFinite(timescale) && timescale > 0 ? timescale : 1,
  },
);
game.start();

// Inspect from the console with ?debug: `game.sim.players[0]`, `game.sim.ball.translation()`.
if (params.has('debug')) Object.assign(window, { game });
