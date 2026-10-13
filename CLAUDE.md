# Five-a-Side

A 3D browser five-a-side football game: two teams of five (four outfield players and a
keeper) in a walled cage. The player controls one footballer at a time on their team and
switches between them; everyone else is AI. Matches are two short halves.

Built with Three.js (rendering), Rapier (physics, `@dimforge/rapier3d-compat`),
TypeScript, Vite and Vitest. No backend.

This is the follow-up to `../penalty-shootout` (same author, same stack, finished).
Much of the ball physics, character, audio, replay and online code there can be ported;
see **Porting from the penalty game** below. Read the relevant files there before
writing something that already exists.

## Commands

- `npm install` — first-time setup
- `npm run dev` — dev server at http://localhost:5173 (hot reload)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — types only
- `npm test` — Vitest
- `npm run stats` — AI match statistics for tuning (not part of `npm test`)

Requires Node 20.19+ or 22.12+ (Vite 8).

## Current state

Milestones 1–6 done (plans and notes in `docs/milestone-1.md` … `docs/milestone-6.md`).
A five-a-side game against a team AI. It opens on a start menu, with an AI match
playing behind it. You play a friendly (any two of eight invented teams, any level,
2/3/5-minute halves) or a cup run: three knockout rounds, easy then normal then hard, with
draws going to a shootout. You're always the home team. The URL flags skip the menu:
`?aivsai` (watch two AI teams), `?difficulty=easy|normal|hard`, `?seed=`.

A match has a kick-off, a clock that stops when the ball is dead, two halves with the ends
swapped, and full time. Then come the goals' highlights and a full-time screen with match
stats. Kick-ins and goal clearances have a taker. Esc pauses.

- **Passing and switching:** J passes to the best teammate in a cone (leading a runner)
  or, without the ball, switches player; switching is also automatic. L calls a teammate
  to press. J while charging a shot cancels it.
- **Team AI** (`src/ai/`): a team brain per team (phase of play; a presser, a cover and
  markers when defending; support spots and a runner when attacking); a state machine
  per player; on-ball decisions by utility (shoot, pass by safety and gain, dribble) with
  level-dependent noise and reaction. Levels also shift ratings and the brain's pace.
- **Keepers:** ported from the penalty game. They dive for shots (read or guess),
  catch or parry, hold the ball in their hands, and throw or roll it out.
- **Contests** (`sim/tackle.ts`, `separation.ts`): K tackles when the other team has the
  ball (a short lunge, then a recovery). The chance depends on angle, timing (the ball off
  the carrier's feet) and `tackling` against `strength` and `passing`. A missed tackle
  can be a foul, more likely from behind and at speed. Opponents in contact share the
  push by weight (`strength`, momentum), and a shoulder challenge on the carrier can win
  the ball. First touches get heavier with a harder ball and a poorer `passing` rating.
- **Fouls:** a direct free kick on the spot, opponents 4 m away, with an AI wall of two
  within 12 m of goal; or a penalty for a foul in the defending goal area, which you aim
  by turning with A/D before holding K.
- **Characters** (`src/characters/`): Quaternius Mannequins (ported with the penalty
  game's rig) in region-coloured kits. Running blends walk, jog and sprint by speed, with
  the jog clip in step. Kicks, passes, traps, tackles, challenges and keeper throws are
  timed to the simulation. After a goal the scorers celebrate and the other team puts
  their hands on their heads. Keepers follow the dive pose.
- **Presentation** (M6):
  - A camera director (`camera/director.ts`): the broadcast view pans to the end walls;
    C gives an action camera; goals cut to the net, then the scorer; the woodwork shakes.
  - Goal replays play automatically; R replays the last few seconds; the highlights
    play at full time (`replay/`).
  - Nets ripple and hard shots leave a trail.
  - Synthesised crowd and sound effects (`audio/`); M mutes.
  - Gamepad and touch controls.
  - Lifetime stats are kept in localStorage.

AI vs AI at normal averages about 6 goals, 35 tackles (55–60% won) and 3 fouls a match
(40 seeds; 16 seeds is too few to judge a change by); hard beats normal beats easy (the soak and difficulty tests hold these). `npm run
stats` prints match statistics for tuning. Milestone 7 (online, optional) is next.

Things that aren't obvious from the code:
- Rapier clamps angular velocity to a quarter turn per step (47 rad/s at 60 Hz). The ball
  therefore has no friction with the turf: rolling resistance and the turf's grip on a
  bounce are modelled in `ball/forces.ts`, applied identically in the game and in the
  ghost-ball worlds. Keep it that way, or fast passes skid down to ~5 m/s.
- Each `Sim` owns its `Ghost` worlds, because Rapier carries contact state between
  steps and sharing ghosts would couple simulations and break determinism. The AI has
  its own RNG for the same reason.
- Dribbling has assists (`dribbleMove`, `playBall`):
  - letting go of the controls with the ball means "stop it";
  - a dribbler gets behind the ball before turning with it;
  - a ball pinned against the boards is dragged back out;
  - no touches while lining up a kick.
  Possession lapses if the ball is stuck beside or behind its owner. Without these, the
  soak tests find dribblers wedged in corners for minutes.
- Players keep their bodies off a slow ball (`keepOffBall`): two chasers otherwise squeeze a
  resting ball against the boards, lifting it out of reach of their feet.
- `Sim.step(commands)`: players without a command are AI-driven when `SimOptions.ai`
  is set, and stand still otherwise (most unit tests). `kickoff: true` starts with a
  kick-off rather than open play; `levels` sets each team's AI level.
- The AI prices passes with a closed-form rolling model (`ai/passing.ts`), not the ghost
  ball: dv/dt = −(R + c·v²) solves exactly. Kicks themselves still use the exact solver.
- A keeper holding the ball is the one exception to "the ball is always a free body":
  `sim/handling.ts` pins it to their hands each step. Keepers act through `Command.dive`.
- Animation reads only snapshots, never `Player`, so M6's replays can drive it. Each
  `PlayerSnapshot` carries speed, shot charge, the tackle lunge, a keeper holding the
  ball, a post-goal mood, and the last action stamped with the tick of the first snapshot
  after it. An action's age is `view.now − tick × PHYSICS_STEP`, 0 on its contact frame.
- The recorded clips (idle, jog, dance) pose the whole body. Wherever an action or mood
  shows, the animator scales the clip down (a dribble touch only for the right leg).
  Otherwise the procedural pose is invisible under the clip, while the rig-level tests
  still pass.
- The stride phase advances with distance, not time, and is lined up with the jog clip:
  left foot down at phase 0. The clip jogs at about 5.3 m/s, 2.5 m a stride.
- Kit colours come from each vertex's bind-pose height in the shader (`skinned.ts`), in
  the Mannequin's own units. A different model needs new region thresholds.
- To look at one moment in Chrome, step the sim from the console (`?debug`) up to it,
  then set `game.options.timescale` low and screenshot.
- AI tuning is done with `npm run stats` (`LEVELS=hard,easy SEEDS=1,2,3 WATCH=chase:10`);
  the levels in `TUNING.levels` were tuned so harder levels win, which isn't obvious:
  slower decisions and more noise can *help* (carrying the ball further before deciding).
- In the built-in browser pane, screenshots fail while the pane is hidden (no animation
  frames). Claude in Chrome renders reliably for visual checks.
- The Vite dev server sometimes keeps a stale module after big refactors (errors about
  missing exports that exist). Restart it.
- Mulberry32's first number from small neighbouring seeds (1, 2, 3…) is far from uniform.
  A test whose outcome hangs on the sim's first roll (a tackle in a fresh sim, say) spreads
  its seeds out (`seed * 104729`), or the statistics come out skewed.
- With `?debug` the game is on `window.game`:
  - `game.sim` is the match being shown, and `game.run` holds its figures, recorder and
    stats;
  - `game.sim.match.foul({ kind: 'penalty', … })` sets up a set piece to look at.

  The page doesn't advance while a Chrome `javascript_tool` call is awaiting, so take
  screenshots between calls. Driving `game.sim.step` by hand skips the game's recording
  and event handling: call `game.recordStep(game.run, events)` and
  `game.onEvent(game.run, e)` too, or there's nothing to replay.
- Replays never re-run the simulation. They draw recorded snapshots through the same
  `interpolate` and figures as live play, with the figures' animators reset at each cut.
  So anything a replay must show has to be in `Snapshot`.
- In a shootout both teams kick at the +X goal: `Match.attackDir` answers for the kicking
  team while a kick is set up or taken. A kick ends when the ball goes in, stops heading
  for goal, leaves the cage or times out, so rebounds never happen.
- `src/style.css` is linked from `index.html`, and Vite doesn't reliably hot-reload it:
  reload the page after CSS changes before judging them.
- Chrome's automated clicks don't fire pointer events, so audio also unlocks on `click`
  (browsers need a gesture before audio plays).

## The game

- **Pitch:** a 40 × 20 m walled cage (`constants.ts`). 1.2 m kickboards all round with
  netting above to 5 m. The ball rebounds off the boards and stays in play, so there
  are no throw-ins or corners. A ball that clears the netting is out: a goal clearance if
  it went over an end wall, otherwise a kick-in from the boards where it went out.
- **Goals:** 3 × 2 m (futsal size). Goal area is a 6 m quarter circle round each post.
  Only the keeper may handle, and only inside their own goal area.
- **Teams:** keeper plus four outfield players in a diamond (defender, left, right,
  pivot). Invented teams only (`team/teams.ts`).
- **Rules:** no offside. Kick-off at the start of each half and after each goal. A foul
  gives a direct free kick, or a penalty in the defending goal area.
- **Match length:** two halves of a few minutes of game time each (2, 3 or 5 in the
  menu), ends swap at half time. A draw in a cup tie goes to a shootout: three kicks
  each, then sudden death.

### Controls (keyboard, gamepad, touch)

| Key | In possession | Defending |
| --- | --- | --- |
| WASD / arrows | move / dribble | move |
| Shift | sprint (uses stamina) | sprint |
| J | ground pass (in the direction you face, to the best receiver) | switch player |
| K | shoot (hold for power) | standing tackle |
| L | lofted pass / chip (hold for power) | call a teammate to press |

The controlled player has a marker under them. Auto-switch to the player best placed to
reach the ball when possession changes or a pass is played to a teammate. Also: Esc
pauses, C switches camera, R replays, M mutes.

Gamepad (standard mapping): left stick, RT/RB sprint, A = J, B = K, X = L, Start pauses,
Y replays. Touch: a floating stick under the left thumb, with Pass, Shoot and Sprint
buttons on the right.

## Architecture

The most important rule: **the simulation does not depend on the presentation.**

- **Simulation** (`src/sim/`, plus `physics.ts`, `ball/`, `team/`, `ai/`): Rapier world,
  player bodies and movement, ball possession, match rules and clock, and all AI. Pure
  TypeScript with no `three`, DOM, `window` or audio imports. It advances only in fixed
  steps (`PHYSICS_STEP`) and takes all randomness from a seeded PRNG passed in. This is
  what lets tests play whole AI-vs-AI matches headless and fast, lets replays re-run,
  and keeps online play possible later.
- **Presentation** (`scene.ts`, `camera.ts`, `characters/`, `ui/`, `audio/`): reads the
  simulation state after each step and draws it. Never writes to the simulation.
- **Input** turns keys or a gamepad into the same `Command`s the AI produces
  (move direction, sprint, pass, shoot with power, tackle, switch). A player doesn't know
  whether a human or the AI is driving it.

### Players

- Each player is a kinematic capsule (`createPlayerBody`) moved by a locomotion model,
  not by forces: current velocity steers towards the desired velocity with limited
  acceleration, deceleration and turn rate, all slower at sprint speed and when on the
  ball. Stamina drains while sprinting and recovers slowly. All these are in `TUNING`.
- Players collide with each other through game code (separation and shoulder contests),
  not by the physics engine pushing kinematic bodies.
- Attributes per player (pace, passing, shooting, tackling, keeping) scale the tuning
  values so teams can differ.

### Ball and possession

- The ball is always a Rapier dynamic body, including while dribbled. Dribbling is a
  series of small touches: when the ball is within control range and in front of the
  player, they nudge it ahead with an impulse sized to their speed. Possession is a
  derived state (who touched it last and is within control range), not a parent/child
  attachment. This keeps tackles, deflections and loose balls physical.
- Passes and shots set the ball's velocity and spin from a target, using a launch solver
  that flies a ghost ball with the same aero so the prediction is exact (port
  `shooting/trajectory.ts`). First-touch quality depends on ball speed and the
  receiver's attribute.
- Interception: for any ball in flight, predict its path (same ghost-ball solver, cached
  per kick) and compute for each player the earliest time they can reach a point on it.
  Pass safety, who chases a loose ball, and receiving all use this.

### AI (layered)

1. **Team brain** (a few times a second): phase of play (in possession, out of
   possession, transition), the formation shifted and compressed towards the ball,
   and role assignment: who presses the ball, who covers, who marks, who makes a run.
2. **Support spots:** when in possession, score a grid of candidate positions in the
   attacking area (safe to receive a pass, open shooting angle, distance from the ball
   and from opponents) and send supporting players to the best ones.
3. **Player state machine** per player: e.g. `HoldPosition`, `Support`, `ChaseBall`,
   `Dribble`, `Receive`, `Press`, `Mark`, `Cover`, plus keeper states (`Guard`,
   `Intercept`, `Dive`, `Distribute`; port the keeper from the penalty game).
4. **Decisions** on the ball use utility scores: shoot (angle, distance, keeper
   position, pressure), pass to each teammate (safety from the interception calculation,
   progress towards goal), or dribble (space ahead). Add a reaction delay and decision
   noise scaled by difficulty so the AI is beatable.
5. **Steering** turns a target into a desired velocity: arrive, pursue (lead the target),
   separation from nearby players, and staying inside the boards.

The classic reference for this structure is Mat Buckland's "Simple Soccer" in
*Programming Game AI by Example*. Follow its ideas, not its code.

## Layout

- `src/constants.ts` — fixed dimensions (pitch, cage, goals, ball, players). Never magic numbers.
- `src/config.ts` — `TUNING`: every gameplay knob.
- `src/math.ts` — `Vec2` / `Vec3`, seeded PRNG (`createRng`), Gaussian sampling, smoothing.
- `src/physics.ts` — Rapier world, ground, boards and netting, both goals, ball, player bodies, collider tags.
- `src/ball/aero.ts` — drag and Magnus force (ported from the penalty game).
- `src/ball/forces.ts` — all forces on the ball each step: aero, rolling resistance, bounce grip.
- `src/ball/trajectory.ts` — ghost-ball launch solver (shots, ground passes) and predicted paths.
- `src/ball/power.ts`, `spin.ts`, `outcome.ts` — shot power and error, spin from contact, shot outcomes (ported).
- `src/sim/sim.ts` — `Sim`: the headless world; `step(commands)` returns `SimEvent`s.
- `src/sim/command.ts`, `events.ts` — what drives players, and what the sim reports.
- `src/sim/player.ts`, `locomotion.ts` — player state and attributes; the movement model.
- `src/sim/possession.ts`, `dribble.ts`, `kick.ts` — who has the ball; touches, traps and first touches; passes and shots.
- `src/sim/tackle.ts` — standing tackles: the lunge, the win and foul chances, the poke loose.
- `src/sim/match.ts` — `Match`: the match-phase state machine, clock, halves and score.
- `src/sim/rules.ts`, `restarts.ts` — goals, ball out, fouls (free kick or penalty), the goal area; restart takers and where everyone stands.
- `src/sim/control.ts` — `HumanControl`: which player the keyboard drives, switching, context buttons.
- `src/sim/separation.ts` — players pushed apart so capsules never overlap; shoulder challenges.
- `src/ai/ai.ts` — `Ai`: runs the team brains and turns each player's state into a `Command`.
- `src/ai/brain.ts`, `support.ts` — phase of play and roles; support-spot scoring and assignment.
- `src/ai/states.ts`, `onball.ts`, `decide.ts`, `keeper.ts` — off-ball behaviours, the carrier's plans, utility decisions, keeper dives and distribution.
- `src/ai/passing.ts`, `intercept.ts`, `steering.ts`, `geometry.ts` — rolling model and pass safety, time to reach, steering, shared helpers.
- `src/keeper/pose.ts`, `body.ts` — the keeper's pose and dive (ported), colliders.
- `src/sim/handling.ts` — keepers catching, holding and distributing.
- `src/team/formation.ts` — formation slots in the team's own frame and their world positions.
- `src/team/teams.ts`, `lineup.ts` — invented teams and kits; who's on the pitch.
- `src/game.ts` — `Game`: menus and the session; each match's input → `Sim` → interpolated render, replays, sound, HUD.
- `src/match/session.ts`, `stats.ts`, `matchstats.ts` — friendly or cup run; lifetime record; one match's numbers.
- `src/replay/recorder.ts`, `replay.ts` — recent snapshots and goal clips; playback.
- `src/audio/sound.ts`, `cues.ts` — synthesised sound (ported); which events make which sounds.
- `src/net.ts`, `src/trail.ts` — rippling nets and the ball trail (ported).
- `src/input/gamepad.ts`, `src/ui/touch.ts` — gamepad and on-screen touch controls.
- `src/ui/menu.ts`, `fulltime.ts` — start and pause menus; the full-time screen.
- `src/sim/shootout.ts` — a shootout's turns and when it's decided.
- `src/input/keyboard.ts` — keys to `Command`s (screen-relative movement).
- `src/render/interpolate.ts` — each player's view between the last two steps (`PlayerView`), and the ball.
- `src/characters/rig.ts`, `skinned.ts` — the procedural rig (ported) and the Mannequin it drives; the kit shader.
- `src/characters/poses.ts`, `animator.ts` — gait cycles and action poses; per-player animation from views.
- `src/characters/footballer.ts` — a footballer or keeper figure in kit, placed and posed each frame.
- `src/ui/hud.ts`, `src/debug.ts` — score, status, power meter, stamina; `?debug` / `?stats` overlays.
- `src/scene.ts` — renderer, lights, pitch, markings, walls, goals, the controlled-player marker.
- `src/camera/director.ts` — broadcast and action cameras, goal cuts, replay cameras, shake.
- `src/main.ts` — entry point; reads the URL flags.
- `tests/` — Vitest. `helpers.ts` has a sim factory, command helpers and a random driver. `tests/stats/` is `npm run stats`.

Online play (M7) would add `src/online/`, as in the penalty game.

## Conventions

- Units are SI: metres, kilograms, seconds. +Y is up. The long axis is X, the centre
  spot is the origin, goal lines are at x = ±20. The broadcast camera is on the +Z side.
- A team's own frame: `forward` from its own goal (-1) to the opponents' (+1), `across`
  from its left touchline (-1) to its right (+1). Convert with `attackDir` (+1 = attacking
  +X). The home team attacks +X in the first half; ends swap at half time.
- Physics runs on a fixed timestep; rendering is variable-rate and interpolates.
  Everything that affects the outcome runs inside the fixed step.
- Physics is the source of truth for the ball. Player bodies are moved by the locomotion
  model; meshes copy transforms from the simulation, never the other way round.
- Simulation code takes randomness from a seeded PRNG passed in, never `Math.random`.
- Gameplay knobs go in `TUNING`. Match flow, possession and player behaviour use explicit
  state machines, not scattered flags.
- Strict TypeScript. No `any` unless there is a comment explaining why.
- No real club names, crests, kits, player names or league branding.

## Verifying changes

- Run `npm run build` and `npm test` after every change; both must pass.
- Tests run the simulation headless. Besides unit tests (interception maths, locomotion
  limits, rules), keep **soak tests** that play several seeded AI-vs-AI matches at full
  speed and assert: no NaNs, the ball never leaves the cage without a restart, no player
  stuck in one state for long, possession changes hands, and over many matches both
  teams score. These catch AI bugs that no single screenshot will.
- For visual or gameplay changes, run the dev server and look at it in a browser
  (screenshot if possible) before calling something done. Check the console for errors.
- Debug flags (add as you go): `?aivsai` (both teams AI, to watch), `?debug` (overlay of
  player states, support-spot scores, pass lanes and interception points),
  `?timescale=0.25`, `?seed=123`, `?stats` (fps, draw calls, triangles).
- Game feel and AI quality can't be judged by reading code. Ask me to playtest, with
  specific questions (e.g. "do teammates offer a pass when you're pressed?").
- Performance budget: 60 fps on a laptop with ten animated characters. AI that runs
  every step must be cheap; spread expensive team-level work over steps.

## Porting from the penalty game

`../penalty-shootout` is finished and tested. Reuse it rather than rewriting, but adapt
code to this game's axes (goal lines on X, not Z) and keep the sim/presentation split.

| When | What | From `../penalty-shootout/` |
| --- | --- | --- |
| Done | Drag and Magnus force | `src/shooting/aero.ts` |
| Done | Launch solver with ghost ball (passes, shots) | `src/shooting/trajectory.ts` |
| Done | Shot power curve, overpower drift, scatter | `src/shooting/power.ts`, `spin.ts` |
| Done | Goal / woodwork outcome from contact events | `src/shooting/outcome.ts` |
| Done | Keeper body, dive decision, reach limit | `src/keeper/` |
| Done | Humanoid rig, Quaternius Mannequin driver, model build script | `src/characters/rig.ts`, `skinned.ts`, `scripts/prepare-models.mjs`, `public/models/` |
| Done | Net ripple, ball trail | `src/net.ts`, `src/trail.ts` |
| Done | Synthesised crowd and sound effects | `src/audio/sound.ts` |
| Done (rebuilt on snapshots) | Recorder and replays, camera director | `src/replay/`, `src/camera/director.ts` |
| Done (rebuilt) | Menus, stats, sessions, penalties for drawn cup ties | `src/ui/`, `src/match/` |
| M7 | Online play (PeerJS, host-authoritative) | `src/online/` |

When porting an asset, copy its row in `ASSETS.md` too.

## Roadmap

Work one milestone at a time and keep the game playable at the end of each. Before
starting a milestone, write a short plan (files, data structures, tests) and check it
with me.

1. **One player and the ball.** Split out `src/sim/`. Locomotion model with sprint and
   stamina. Dribbling by touches, ground pass and shot (hold for power) towards the
   facing direction, using the ported launch solver. Boards in play, goals detected,
   ball over the netting resets. Interpolated rendering. Camera follows the controlled
   player and the ball.
2. **Teams on the pitch.** Ten players; the human controls one and switches (manual
   and auto). Kick-off, score, match clock, half time with ends swapped, full time.
   Teammates and opponents return to formation slots (shifted with the ball) and chase
   loose balls they can reach first. HUD: score, clock, controlled-player marker.
3. **Team AI.** Team brain, support spots, pressing and covering, marking, pass / shoot /
   dribble decisions, the interception model, AI keepers (ported and extended to
   intercept through balls and distribute). `?aivsai` and `?debug` overlays. Soak tests.
   Difficulty levels.
4. **Contests.** Standing tackles with success based on angle and timing, shoulder
   challenges, loose balls from tackles, first-touch quality, fouls and free kicks,
   penalties from fouls in the goal area.
5. **Characters.** Port the rig and the Mannequin. Locomotion blending by speed
   (idle / jog / run / sprint, turning), procedural kick, pass, tackle and receive
   poses timed to the simulation's touch events, keeper dives. Team kits.
6. **Presentation and polish.** Camera director (broadcast, closer action cam, goal
   cuts), goal replays, crowd and sound, menus and team select, stats, a short league or
   cup mode, gamepad and touch controls.
7. **Online (optional).** Port the penalty game's host-authoritative online play: two
   humans, one team each. The guest sends `Command`s, the host runs the simulation and
   streams snapshots.
