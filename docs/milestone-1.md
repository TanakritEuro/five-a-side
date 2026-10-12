# Milestone 1 plan: one player and the ball

Goal: one controllable footballer who runs, sprints, dribbles by touches, plays a
ground pass and hits a charged shot in the cage. Goals are detected and balls over the
netting are reset. Rendering is interpolated and the camera follows the action. All of
this runs in a headless `Sim` that tests can drive.

## Scope decisions

- **One player only.** The nine static placeholders go until M2, because they'd just be
  obstacles with no behaviour. The `Sim` still holds an array of players, and every API
  takes a player id, so M2 only adds bodies.
- **J** plays a ground pass along the facing direction to a point `passLength` ahead,
  arriving at `passArrivalSpeed`. It's a tap, not held. Receiver selection is M2.
- **K** is a shot, held for power. If the facing ray crosses the attacked goal line
  near the mouth, the aim snaps to just inside the nearer post. Otherwise the shot goes
  along the facing direction. Power sets speed and height. Overpower drift and scatter
  come from the ported `power.ts`. M1 strikes are clean: `spin.ts` is ported but only
  wired to a tunable auto-curl, so shots bend in towards the far post.
- **L** (lob), tackle and switch stay in `Command` but do nothing in M1.
- Movement is screen-relative to the broadcast camera: W goes up the screen (−Z) and D
  goes right (+X).

## Files

Simulation (no `three`, DOM or audio; seeded RNG; fixed step):

| File | Contents |
| --- | --- |
| `src/sim/command.ts` | `Command` (what the AI and input both produce), `IDLE` |
| `src/sim/sim.ts` | `Sim`: owns physics, ball, players, possession, rules, RNG, tick. `step(commands): SimEvent[]`, and keeps prev/current snapshots for interpolation |
| `src/sim/player.ts` | `Player` state, `Attributes`, `createPlayer`; moves its kinematic body |
| `src/sim/locomotion.ts` | Pure locomotion step: velocity, facing, stamina |
| `src/sim/possession.ts` | Last touch and derived owner; control-range and in-front tests |
| `src/sim/dribble.ts` | Touch logic: push ahead, trap or receive a slow ball, touch cooldown |
| `src/sim/kick.ts` | Charge tracking (press/hold/release, buffered when out of range), pass and shot targets, applies the launch |
| `src/sim/rules.ts` | Match-phase state machine: `Playing`, `GoalScored`, `BallOut`, `Restart`. Goal and out-of-cage detection, score, kick-off reset |
| `src/sim/events.ts` | `SimEvent` union: `touch`, `kick`, `goal`, `woodwork`, `out`, `restart` |
| `src/ball/forces.ts` | `applyBallForces`: aero plus a new **rolling resistance** (constant deceleration while on the ground). Rapier has none, so passes would roll forever without it |
| `src/ball/trajectory.ts` | Ported ghost-ball solver, generalised to any horizontal direction. The ghost world now has a ground so rolling passes predict exactly too. `solveLaunch` handles shots and lobs; `solveGroundPass` does a 1-D speed search for an arrival speed. Each kick caches its predicted path as `BallPath`, ready for M3 interception |
| `src/ball/power.ts`, `spin.ts` | Ported, with `Math.random` replaced by the passed-in `Rng`, and contact spin turned to any shot direction |
| `src/ball/outcome.ts` | Ported `ShotTracker` for both ends: goal or woodwork from contact events, giving "Off the post!" and similar |

Presentation and input:

| File | Contents |
| --- | --- |
| `src/input/keyboard.ts` | WASD/arrows, Shift, J/K/L to `Command` (buttons as held state; the sim does the edge detection and timing so replays re-run from commands) |
| `src/game.ts` | `Game`: fixed-step accumulator, input → `Sim.step`, then interpolated render. Reads `?seed` and `?timescale` |
| `src/render/interpolate.ts` | Lerp positions, slerp ball rotation, shortest-arc facing |
| `src/ui/hud.ts` | Score, status text from events, shot power meter (sweet spot and overpower bands), stamina bar |
| `src/camera.ts` | Follows a weighted point between the controlled player and the ball |
| `src/debug.ts` | `?debug`: control-range ring, facing ray, last kick's predicted path. `?stats`: fps, draw calls |
| `src/main.ts` | Just `new Game(...)` |

`physics.ts` gains a `createGround` that both worlds share. `config.ts` gains
`TUNING.locomotion`, `.stamina`, `.dribble`, `.pass`, `.shot`, `.spin`, `.rules`.

## Key data structures

```ts
interface Command {
  move: Vec2;            // screen-mapped world direction, length 0..1
  sprint: boolean;
  pass: boolean;         // buttons are "held" flags
  shoot: boolean;
  lob: boolean;
  tackle: boolean;
  switch: boolean;
}

interface Attributes { pace: number; passing: number; shooting: number; tackling: number; keeping: number } // 0..1, 0.5 average

interface Player {
  id: number; team: 0 | 1; role: Role; attrs: Attributes;
  pos: Vec2; vel: Vec2; facing: number;   // radians, 0 = +X
  stamina: number;                          // 0..1
  charge: { kind: 'pass' | 'shoot' | 'lob'; steps: number } | null;
  bufferedKick: { kind; power; stepsLeft } | null;
  touchCooldown: number;
  body: RAPIER.RigidBody;
}

type Phase =
  | { kind: 'playing' }
  | { kind: 'goal'; scorer: 0 | 1; timer: number }
  | { kind: 'out'; restartAt: Vec2; timer: number }
  | { kind: 'restart'; timer: number };  // brief freeze before play resumes
```

### Locomotion

Speed and heading are integrated separately:

- Heading turns towards the desired direction at `turnRate / (1 + turnSpeedFactor·speed)`.
  Sprinting and being on the ball cut the turn rate further.
- Target speed is `|move| × (jog | sprint) × pace scale × (on-ball factor)`, scaled by
  `cos(heading error)` clamped at 0. A hard reversal therefore slows down first rather
  than spinning round at full speed.
- Speed approaches the target within `accel` / `decel` limits.
- Sprinting drains stamina; it recovers when not sprinting. Below `tiredThreshold`,
  sprint speed fades towards jog.
- Position is clamped inside the boards, less the player's radius, and applied with
  `setNextKinematicTranslation`.

### Dribbling

Each step, while the ball is low, within `controlRange` and inside the front cone, and
the touch cooldown has expired:

- **Moving:** if the ball is closer than `touchDistance` ahead (the player is catching
  it up), set its horizontal velocity to `playerVel × touchFactor` (more when
  sprinting, so the ball goes further ahead). The impulse is applied as
  `m·(v_target − v_ball)` and pointed along the desired direction, with a little
  seeded noise scaled by attributes.
- **Standing:** damp the ball's velocity relative to the player so it settles at their
  feet (trap).
- **Loose ball coming in:** if its relative speed is under `receiveSpeed`, kill most of
  it (a basic first touch; the quality model is M4). A faster ball just bounces off the
  capsule.

Possession is `lastTouch` while that player is within `controlRange`; otherwise the
ball is loose.

## Tests

| File | Asserts |
| --- | --- |
| `locomotion.test.ts` | Reaches but never exceeds jog and sprint speed; time to top speed matches `accel`; turn rate limit; hard reversal slows first; stamina drains, sprint fades when empty, stamina recovers; pace attribute scales speed |
| `trajectory.test.ts` | Solver hits targets within 1 cm in several directions, at both ends, with spin. Ground pass arrives at the target at the requested speed (±0.1 m/s). The real world matches the ghost prediction |
| `dribble.test.ts` | Scripted run of 20 m straight keeps possession on ≥95% of steps; a 90° turn and a stop keep the ball; sprinting pushes it further ahead than jogging |
| `kick.test.ts` | Power from hold time. A facing-goal shot from 10 m scores; a pass rolls along the facing direction and stops near `passLength`; a kick pressed out of range is buffered then taken; no kick if the ball never comes into range |
| `rules.test.ts` | Goal: score +1, ball and player reset to kick-off after the delay. Ball lofted over the netting (sides and ends): out, then restart inside the cage. Ball in the net isn't "out" |
| `determinism.test.ts` | Same seed and command script give a bit-identical state after 20 s |
| `soak.test.ts` | Several seeds × 90 s of random command scripts: no NaNs, the ball is never outside the cage without an `out` → `restart`, the player stays inside the boards |
| `purity.test.ts` | No file under `src/sim`, `src/ball`, `src/team` or `src/physics.ts` imports `three` or touches `window`, `document` or `Math.random` |

Existing `arena.test.ts` is kept; it switches to `applyBallForces`.

## Commits, in order

1. Plan (this file).
2. `Sim` skeleton, `Command`, fixed-step `Game` with interpolation, seeded RNG; scaffold
   behaviour unchanged; purity and determinism tests.
3. Rolling resistance and the ported, generalised launch solver; trajectory tests.
4. Player, locomotion and keyboard input; locomotion tests.
5. Possession and dribbling; dribble tests.
6. Pass and charged shot (ported power and spin), HUD power meter; kick tests.
7. Rules: goals with outcome text, out-of-cage restarts, kick-off reset; rules and soak tests.
8. Camera follow, `?debug` / `?stats` overlays; update CLAUDE.md "Current state" and README.

Each commit passes `npm run build` and `npm test`. After 4, 5, 6 and 7 I check the game
in the browser. At the end I'll ask you to playtest, with specific questions on feel.

## Risks

- **Ball against the dribbler's capsule.** A kinematic capsule hitting the ball during a
  turn can kick it away. If tuning touches doesn't fix it, the controlling player's
  capsule gets a collision group that ignores the ball while a touch is "live" (about
  0.15 s).
- **Ghost solver cost.** Up to 10 iterations × 180 steps on a one-body world per kick
  is fine for player kicks. M3 AI will need the cached path, not repeated solves.
