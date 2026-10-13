# Milestone 6 plan: presentation and polish

Goal: it feels like a game, not a test bench. The game gets:

- a camera director (a broadcast view that reaches both ends, a closer action camera,
  cuts at goals and shakes on the woodwork);
- goal replays and full-time highlights;
- the net ripple and ball trail;
- a synthesised crowd and sound effects;
- menus with team select;
- match and lifetime stats;
- a short cup in which drawn ties go to a penalty shootout;
- gamepad and touch controls.

Most of it is ported from `../penalty-shootout`. The simulation changes only for the
shootout and a configurable match length.

## Scope decisions (to confirm)

- **Replays.** Every goal is followed by an automatic replay (about 6 s, slowed down,
  skippable with any key or button), and R replays the last few seconds at any time. At
  full time, a highlights reel of the match's goals. Replays play back recorded
  *snapshots* through the normal animators (M5 made snapshots carry everything animation
  needs). The penalty game recorded scene transforms instead. The match is frozen while
  a replay plays.
- **Competition: a cup.** Eight invented teams. Three knockout rounds (quarter-final,
  semi-final, final), with the opposition's AI level rising each round. A draw at full
  time goes to a futsal-style shootout: three kicks each, then sudden death, using the
  M4 penalty set-up. Plus friendlies (any two teams, any level). I'm not planning a league.
- **Camera.** The broadcast camera stays the default and now follows play right to the
  end walls (the fix you deferred in M2). C switches to a closer, lower action camera.
  After a goal, it cuts to the scorer celebrating, then to the replay. The woodwork
  shakes the camera.
- **Crowd.** Sound only: a crowd bed that swells with attacks, cheers, groans and "ooh"s,
  plus the referee's whistle, kicks, woodwork, net and keeper sounds, all synthesised (no
  sound files). There are no stands to fill: it's a caged pitch.
- **Controls.** Gamepad via the Gamepad API, mapped onto the same `Command`s:
  - left stick to move, RT to sprint;
  - A to pass or switch, B to shoot or tackle, X to lob or call a press;
  - Start to pause, Y for a replay.

  Touch: a virtual stick on the left of the screen and three buttons on the right (pass,
  shoot, sprint), shown only on touch devices.

## How it works

### Camera director (`src/camera/director.ts`)

- **Broadcast:** high on the +Z touchline, panning to frame the play. The pan limit grows
  so the near goal is in shot when play is there. The framing point leads in the
  direction of attack.
- **Action:** lower and closer, behind the play in the attacking direction, following the
  controlled player and the ball.
- **Cuts:**
  - a goal: hold on the net bulging for a moment, then the scorer celebrating (a low
    camera that orbits them), then the replay;
  - restarts: back to the main camera;
  - full time: a wide shot.
- **Shake** on posts and bar (ported).
- **Replay cameras:** behind the goal that was scored in, and low beside the goal line.
  The director picks one by where the shot came from.

### Replays (`src/replay/`)

- **`Recorder`:** a ring buffer of the last 12 s of `Snapshot`s, copied each step (ten
  small player objects and the ball), with the events of each step. At a goal, the clip
  runs from the start of the move, back to the last change of possession, capped at 8 s.
- **`Replay`:** plays a clip at 0.5× through `interpolate` and the figures. It uses fresh
  `Animator`s, so stride phases start clean, and runs the net ripple and trail too. The
  HUD shows "REPLAY" and the caption. Any key or button skips it.
- **Highlights at full time:** every goal of the match, in order, each with its scorer
  and the minute.

### Net and trail

Ported `net.ts` (wireframe panels that bulge and ripple where the ball hits; visual only)
and `trail.ts` (a streak behind hard shots). Both are fed from the interpolated ball, so
they work in replays too.

### Sound (`src/audio/sound.ts`)

Ported. Effects come from `SimEvent`s:

- a kick, scaled by power; a dribble touch, quiet;
- the woodwork; the net on a goal; a keeper catch or parry;
- a tackle thud; the whistle for fouls, half time and full time.

The crowd swells as the ball nears a goal. It cheers a home goal, groans at a home
concession, and goes "ooh" at a near miss or a save. The home team is the crowd's side.
There's a mute setting, and the sound is unlocked by the first menu click.

### Menus, teams and stats (`src/ui/menu.ts`, `src/match/`)

- **Start menu:**
  - mode: friendly or cup;
  - your team and the opposition (friendly), from eight invented teams with kits and
    ratings; the cup draws your opponents;
  - difficulty (friendly);
  - half length (2, 3 or 5 minutes);
  - sound on/off and camera.
- **Pause menu (Esc / Start):** resume, restart, quit to the menu.
- **Kit clashes:** every team has a home and an away kit; the away side changes if
  the shirts are too alike.
- **Full-time screen:** score, scorers and minutes, and match stats from the events
  (shots, on target, possession %, passes, tackles won, fouls, saves). Then continue
  (next cup round) or back to the menu.
- **Lifetime stats in `localStorage`:** played / won / drawn / lost, goals, cups won, a
  win streak.
- **`?aivsai`, `?difficulty` and `?seed` still work**, and skip the menu.

### Simulation changes

- **Half length:** `SimOptions.halfLength` (default `TUNING.match.halfLength`).
- **Shootout:**
  - `Match` gains a `shootout` phase entered at full time when `SimOptions.shootout` is
    set and the score is level.
  - Kicks alternate (3 each, then sudden death). Each one is a penalty restart taken by
    the next player in turn, outfield players first.
  - A kick ends when the shot's outcome is known (goal, saved, missed) or the ball stops:
    no rebounds. Then the next kick is set up. Everyone else waits by the halfway line.
  - Events: `shootoutKick` (taker, scored) and `shootoutEnd`. The score for the cup is the
    shootout tally.
- **Human taker.** In a shootout the human takes their team's kicks: you aim with A/D and
  hold K, as for any penalty. When defending a kick, your keeper is AI (as now; you never
  drive a keeper).

## Files

| File | Contents |
| --- | --- |
| `src/camera/director.ts` | Broadcast and action cameras, cuts, shake, replay cameras (replaces `camera.ts`) |
| `src/replay/recorder.ts`, `replay.ts` | Snapshot ring buffer and clips; playback through the figures |
| `src/net.ts`, `src/trail.ts` | Ported |
| `src/audio/sound.ts` | Ported; event → sound mapping in `game.ts` |
| `src/ui/menu.ts`, `src/ui/fulltime.ts`, `src/ui/touch.ts` | Start / pause menus; full-time and stats screens; touch controls |
| `src/input/gamepad.ts` | Gamepad → `Command` |
| `src/match/session.ts`, `stats.ts`, `matchstats.ts` | Friendly or cup run; lifetime stats; per-match stats from events |
| `src/team/teams.ts` | Eight teams, home and away kits, ratings |
| `src/sim/match.ts`, `restarts.ts`, `sim.ts` | Half length option; the shootout |
| `src/game.ts`, `src/main.ts` | Menu first; game states (menu, playing, paused, replay, full time) |
| `ASSETS.md` | Nothing new (all synthesised) |

## Tests

| File | Asserts |
| --- | --- |
| `shootout.test.ts` | A level match with `shootout` goes to kicks: alternating takers, 3 each then sudden death; it stops as soon as one side can't catch up; a saved or missed kick ends without a rebound; a winner is always found (soak over seeds). A decided match never goes to kicks |
| `recorder.test.ts` | The ring buffer keeps the last 12 s; a goal's clip starts at the last change of possession (capped) and ends after the goal; replaying a clip through `interpolate` reproduces the recorded positions |
| `matchstats.test.ts` | Stats from a seeded match's events: shots ≥ on target ≥ goals, possession sums to 100%, totals match the event counts |
| `session.test.ts` | A cup: three rounds, levels rising, a loss knocks you out, winning the final records a cup; lifetime stats count results; draws in the cup go to the shootout, not in friendlies |
| `gamepad.test.ts` | A fake `Gamepad` maps to the same `Command`s as the keyboard (dead zone, triggers, buttons) |
| `teams.test.ts` | Eight teams with valid kits; clashing shirts switch the away team to its second kit |
| `soak.test.ts` | Unchanged, plus one shootout soak |

Visual checks in Chrome after each commit; sound and touch need you, so I'll ask about them
specifically at the end.

## Commits, in order

1. Plan (this file).
2. Camera director: broadcast to the ends, action cam, goal cuts, shake.
3. Replays: recorder, playback, goal replays, R, highlights. Net and trail.
4. Sound.
5. Teams and kits; half length; the shootout in the sim. Tests.
6. Menus, session (friendly, cup), full-time screen, match and lifetime stats. Tests.
7. Gamepad and touch controls.
8. Polish pass, CLAUDE.md, plan notes, playtest questions.
