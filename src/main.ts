// Entry point. With no flags, the start menu. Dev flags skip it and start a match at once:
// ?aivsai (watch the AI), ?difficulty=easy|normal|hard (the opposing team), ?seed=123 (fix
// the random seed). Others: ?timescale=0.25 (slow motion), ?debug (overlays, and `game` on
// window), ?stats (fps, draw calls).

import { Game } from './game';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const timescale = Number(params.get('timescale') ?? 1);
const difficulty = params.get('difficulty');
const quick = params.has('aivsai') || params.has('difficulty') || seedParam !== null;

const game = await Game.create(
  document.querySelector<HTMLCanvasElement>('#game')!,
  document.querySelector<HTMLElement>('#hud')!,
  {
    timescale: Number.isFinite(timescale) && timescale > 0 ? timescale : 1,
    debug: params.has('debug'),
    stats: params.has('stats'),
    quick: quick
      ? {
          aiVsAi: params.has('aivsai'),
          difficulty: difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal',
          seed: seedParam !== null ? Number(seedParam) : Date.now(),
        }
      : null,
  },
);
game.start();

// Inspect from the console with ?debug: `game.sim.players[0]`, `game.sim.ball.translation()`.
if (params.has('debug')) Object.assign(window, { game });
