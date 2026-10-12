# Five-a-Side

A 3D five-a-side football game for the browser, built with Three.js, Rapier and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

| Key | Action |
| --- | --- |
| WASD / arrows | Move and dribble (let go to stop the ball) |
| Shift | Sprint (uses stamina) |
| J | With the ball: pass to the teammate you're facing. Without it: switch player |
| K | Shoot: hold for power, release to strike. Keep the meter in the green. J while holding cancels |
| L | Without the ball: call a teammate to press |

URL flags: `?difficulty=easy|normal|hard` (the opposing team), `?aivsai` (watch two AI
teams), `?debug` (AI states, support spots, pass lanes, chase points, kick paths),
`?stats` (fps, draw calls), `?seed=123`, `?timescale=0.25`.

`npm run stats` plays seeded AI-vs-AI matches headless and prints statistics.

See `CLAUDE.md` for the game design, architecture and roadmap.
