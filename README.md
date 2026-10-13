# Five-a-Side

A 3D five-a-side football game for the browser, built with Three.js, Rapier and TypeScript.

**Play it:** https://tanakriteuro.github.io/five-a-side/

Play a friendly or a cup run against a team AI (draws in the cup go to penalties), or a
friend online with a room code. Eight invented teams, three difficulty levels, goal
replays, a synthesised crowd, and keyboard, gamepad or touch controls.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

| Key | In possession | Defending |
| --- | --- | --- |
| WASD / arrows | Move and dribble (let go to stop the ball) | Move |
| Shift | Sprint (uses stamina) | Sprint |
| J | Pass to the teammate you're facing | Switch player |
| K | Shoot: hold for power, release to strike (J cancels) | Standing tackle |
| L | | Call a teammate to press |

Esc pauses, C switches camera, R replays the last few seconds, M mutes. At a penalty,
A and D aim. Gamepad: left stick, RT sprints, A / B / X as J / K / L, Start pauses,
Y replays. On touch screens: a stick under your left thumb and buttons on the right.

Online: one player hosts and shares the four-letter room code, the other joins with it.
The host runs the match; the connection is peer to peer (the public PeerJS server only
introduces the two browsers).

URL flags (they skip the menu): `?difficulty=easy|normal|hard`, `?aivsai` (watch two AI
teams), `?seed=123`. Also `?debug` (AI states, support spots, pass lanes; `game` on
`window`), `?stats` (fps, draw calls) and `?timescale=0.25`.

`npm test` runs the tests, including whole AI matches played headless. `npm run stats`
plays seeded AI-vs-AI matches and prints statistics for tuning.

See `CLAUDE.md` for the game design, architecture and milestones, and `docs/` for each
milestone's plan and notes. Credits for third-party assets are in `ASSETS.md`.
