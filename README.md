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
| K | Shoot: hold for power, release to strike. Keep the meter in the green |

URL flags: `?aivsai` (watch two AI teams), `?debug` (reach and possession rings, kick
paths, state readout), `?stats` (fps, draw calls), `?seed=123`, `?timescale=0.25`.

See `CLAUDE.md` for the game design, architecture and roadmap.
