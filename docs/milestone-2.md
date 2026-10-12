# Milestone 2 plan: teams on the pitch

## Status: done

Decided with you before starting: 3-minute halves, a clock that stops when the ball is
dead, AI that dribbles, shoots and makes simple passes, and you take your team's set
pieces with no time limit.

Where the build differs from the plan below:

- **One blocker.** With no pressing at all, an AI dribbler walked to goal unopposed. So
  the nearest defender stands goal-side of the ball carrier (`block` state). That's
  jockeying, not tackling; pressing is M3.
- **J's receiver selection and leading pass moved into the AI commit.** The AI passer
  turns to its receiver and presses J, so it needed them first.
- **`Match` replaced `Rules`**, and `sim/restarts.ts` holds the taker and positioning
  rules. M1's restart "freeze" became a `restart` phase that waits for the taker's kick.
- **Dribbling changes the soak test forced:**
  - a dribbler gets behind the ball before turning with it, replacing M1's
    "go to the ball first";
  - a ball pinned against the boards is dragged back out;
  - no touches while lining up a kick, and a longer buffer for shots;
  - possession lapses if the ball is stuck beside or behind its owner for 1.5 s.

  Before these, dribblers sat wedged in corners for minutes.
- **The AI on the ball** runs at a shooting spot 7 m out before turning to shoot, so it
  doesn't take the ball down the goal line. After 6 s on the ball it gets impatient:
  it passes backwards or shoots from further out. A keeper with nobody to pass to clears
  it upfield.
- **The frame `dt` is clamped at zero.** A timestamp earlier than the last frame's
  sent the camera's smoothing to infinity.

Goal: a full five-a-side match. There are ten players, and you control one at a time,
switching manually and automatically. A match has a kick-off, a clock, two halves with
the ends swapped at half time, and full time. Everyone else is a basic AI: they hold a
formation shifted with the ball and chase loose balls they can reach first. The proper
team AI (support spots, pressing, marking, pass/shoot utility, keepers) is Milestone 3.
M2 only needs enough AI for the game to be playable.

## Scope decisions

- **AI on the ball (stop-gap until M3).** The player dribbles towards goal and shoots
  inside about 12 m with a clear angle. They pass to the most forward open teammate
  when an opponent blocks the way ahead. All of this is simple rules, replaced by
  utility scores in M3.
- **Keepers (stop-gap until M3).** They stand on the line between the ball and the
  centre of their goal, inside the goal area, and chase loose balls only inside it. They
  have no hands or dives: the ported keeper is M3.
- **No tackles until M4.** The only way to win the ball is to intercept a pass, collect a
  loose ball, or get your body in the way of the dribbler's ball, which deflects it.
  Defenders therefore only hold shape and chase loose balls. Pressing the carrier is M3.
- **Context buttons.** J means pass when your team has the ball and switch player when
  it doesn't; K means shoot or (in M4) tackle. The keyboard sets both meanings of a key,
  and the sim uses whichever applies. The AI only ever sets the one it means.
- **The human is the home team (blue). With `?aivsai`, both teams are AI.**
- **J passes to the best receiver.** That is a teammate inside a cone around your facing,
  scored by angle and distance. The pass leads the receiver, at a pace set by the
  distance. With nobody in the cone it goes along your facing, as in M1.

## Files

| File | Contents |
| --- | --- |
| `src/team/lineup.ts` | `fullLineup()`: both teams in the diamond, with per-team attributes |
| `src/team/formation.ts` | `shiftedSlot(slot, ball, attackDir, inPossession)`: the slot moved up and down with the ball, narrowed, pushed up in possession and dropped out of it |
| `src/sim/match.ts` | `Match`: the match-phase state machine, replacing `Rules` (see below). Clock, halves, `attackDir` per half, score |
| `src/sim/separation.ts` | Players pushed apart so their capsules never overlap, in a fixed order |
| `src/sim/control.ts` | `HumanControl`: which player a human team controls. Manual switch on J out of possession; auto-switch to a pass receiver, and to the best-placed player when possession is lost or the ball is loose |
| `src/sim/kick.ts` | Adds `planPassTo(target)`, pass receiver selection and lead, and the kick-in / goal clearance taker rules |
| `src/ai/brain.ts` | `TeamBrain`, run every 6 steps: shifted slots and who chases the loose ball (one player per team: the earliest to reach it) |
| `src/ai/player.ts` | Per-player state machine: `HoldPosition`, `ChaseBall`, `Dribble`, `TakeSetPiece`, `KeeperGuard`. Each produces a `Command` |
| `src/ai/intercept.ts` | Time for a player to reach a point; the earliest point on the ball's path a player can reach. The path is predicted once per kick or deflection and reused |
| `src/ai/steering.ts` | Arrive, pursue, stay inside the boards |
| `src/ui/hud.ts` | Clock and half, kits on the scoreboard, half-time and full-time banners |
| `src/game.ts` | `?aivsai`, a marker that follows switches, both kits |

### Simulation API change

`Sim.step(commands)` keeps taking one optional `Command` per player id. With
`SimOptions.ai: true`, players without a command are driven by the AI. Without it
(the unit tests), they stand still as they do now. `Game` gets the human player's id
from `HumanControl` and fills that slot from the keyboard. A replay records the commands
array, so it re-runs exactly.

### Match phases

```ts
type Phase =
  | { kind: 'kickoff'; team: 0 | 1 }                // waits for the kicking team's first touch
  | { kind: 'playing' }
  | { kind: 'goal'; team: 0 | 1; timer: number }
  | { kind: 'out'; restart: Restart; timer: number }
  | { kind: 'setPiece'; restart: Restart; taker: number } // kick-in or goal clearance: waits for the taker's kick
  | { kind: 'halfTime'; timer: number }
  | { kind: 'fullTime' };

interface Clock { half: 1 | 2; elapsed: number }  // game seconds into the half
```

- **Kick-off:** players line up in their own half and opponents stay outside the centre
  circle. The ball is live once the kicking team touches it. An AI taker plays it back
  or square after about half a second.
- **Set pieces:** the nearest player of the restart team becomes the taker and is placed
  behind the ball facing infield. Opponents are held 3 m away until the kick. Only a
  pass or shot restarts play; there is no dribbling off the spot. The human team's taker
  becomes the controlled player. An AI taker passes after about a second.
- **The clock** stops while the ball is dead, as in futsal (goal and out pauses, set
  pieces, kick-offs). The half length is `TUNING.match.halfLength`, in game seconds.
- **Half time:** a banner and pause, then the ends swap (`attackDir` flips) and the
  other team kicks off. **Full time** stops the match and shows the result banner.

## Tests

| File | Asserts |
| --- | --- |
| `formation.test.ts` | Shifted slots stay inside the pitch, follow the ball up and down, and are the mirror image for the other team or half |
| `separation.test.ts` | After many steps of players driven into each other, no two capsules overlap. Separation doesn't push anyone through the boards |
| `match.test.ts` | The clock runs in play and stops when the ball is dead. Half time swaps `attackDir` and the kick-off team; full time freezes everything. At kick-off everyone is in their own half and opponents are outside the circle. A set piece's taker is the nearest player and opponents keep 3 m |
| `control.test.ts` | J out of possession switches to the best-placed teammate (never the keeper). A pass to a teammate switches to the receiver; losing the ball switches to the player best placed to win it back |
| `pass.test.ts` | J picks the teammate in the cone over one behind; a leading pass reaches a running receiver; an AI set-piece pass gets to a teammate |
| `intercept.test.ts` | Time to reach a point respects the locomotion limits; on a rolling ball, the player picked as chaser does get there first |
| `ai.test.ts` | Exactly one player per team chases a loose ball. Off the ball, players head for their shifted slots. An AI dribbler with an empty pitch scores |
| `soak.test.ts` (extended) | Several seeded AI-vs-AI matches of two halves, run headless at full speed. Asserts: no NaNs; the ball never out without a restart; nobody stuck in one AI state too long; every match reaches full time; possession changes hands; across the seeds, both teams score |

The M1 tests keep passing: the solo lineup with `ai: false` behaves as before.

## Commits, in order

1. Plan (this file).
2. Full lineup, separation, shifted formation, kits; `?aivsai` with players holding their
   slots. Formation and separation tests.
3. `Match`: clock, halves, kick-off, set pieces, full time, plus the HUD clock and banners.
   Match tests.
4. Interception estimates, the team brain and the player state machines (hold, chase,
   dribble, set piece, keeper guard). AI tests.
5. `HumanControl` with manual and auto-switch, J to the best receiver, a leading pass.
   Control and pass tests.
6. AI-vs-AI soak over whole matches; tuning; CLAUDE.md "Current state".

Each commit passes build and tests, and I'll look at it in the browser after 2–5. At
the end I'll ask you to playtest.

## Risks

- **Ten players crowding the ball.** The brain picks only one chaser per team, but a pile
  of bodies around the ball could still deflect it endlessly. Separation plus the
  "deflect makes it loose" rule should resolve that; the soak test will show.
- **Cost.** Interception uses one predicted path per kick, shared by everyone, plus a
  cheap per-player time-to-point. The team brain runs every 6 steps, not every step.
