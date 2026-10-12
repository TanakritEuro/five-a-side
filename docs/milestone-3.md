# Milestone 3 plan: team AI

Goal: AI that plays like a team. The team brain reads the phase of play and gives out
roles: press, cover, mark, support, run. Supporting players go to open spots. The player
on the ball chooses between shooting, passing and dribbling by utility scores built on
real pass-safety estimates. Keepers are ported from the penalty game, then extended to
come off their line, catch and distribute. Difficulty levels make the AI beatable.
`?debug` shows the AI's thinking. The M2 stop-gap AI (`src/ai/ai.ts`) is replaced
piece by piece.

## Scope decisions (to confirm)

- **Keepers catch.** A keeper inside their own area can catch a ball that reaches them
  slowly enough. While caught, the ball is held at their hands: the one deliberate
  exception to "the ball is always a free body". Faster balls are parried (they bounce
  off the gloves). The keeper then throws or rolls it out within about 2 s. A keeper
  never handles outside their area.
- **Difficulty:** three levels (easy / normal / hard) for the opposing team, chosen with
  `?difficulty=` until the menus arrive in M6. Default `normal`. Your AI teammates
  always play at `normal`. A level sets the AI's reaction delay, decision noise, pass
  and shot accuracy margins, and the keeper's level (the penalty game's easy / normal
  / hard).
- **L when defending** calls the nearest teammate to press for 3 s (the CLAUDE.md
  control). L in possession (lob / chip) still waits until a later milestone.
- **Your team's keeper is always AI.**
- **Target scoring rate:** 3–7 goals in an AI-vs-AI match at `normal` (M2 gives up to
  20). The soak tests check the range over several seeds.

## Files

Simulation (headless, seeded):

| File | Contents |
| --- | --- |
| `src/ai/passing.ts` | A closed-form rolling-ball model (position and time along a ground pass), checked against the ghost ball. `passSafety(from, to, speed, opponents)`: how much sooner the receiver gets there than the best interceptor, sampled along the lane. Cheap enough to score every option every brain tick |
| `src/ai/brain.ts` | `TeamBrain` per team, every 6 steps: phase (`attack`, `defend`, `transition` for about 1 s after a turnover), formation shifted and compressed towards the ball. Roles: `presser` (first to the ball), `cover` (goal-side behind the presser), `markers` (nearest unmarked opponents in your half), `supporters` and one `runner` in attack |
| `src/ai/support.ts` | A grid of candidate spots in the attacking area, each scored by pass safety from the ball, shooting angle to goal, distance from the ball (best 6–14 m) and space from opponents. The best spots are spread out (at least 4 m apart) and assigned to supporters greedily |
| `src/ai/decide.ts` | Utility scores on the ball. **Shoot:** open angle past the keeper, distance, pressure. **Pass** to each teammate: safety × (progress + receiver's openness). **Dribble:** space ahead. Then reaction delay and Gaussian noise on the scores, from the difficulty level |
| `src/ai/states.ts` | Per-player state machine: `Hold`, `Support`, `Run`, `ChaseBall`, `Receive`, `Dribble` (carrying out the decision), `Press`, `Cover`, `Mark`, `TakeRestart`; keeper states `Guard`, `Intercept`, `Dive`, `Hold` (ball in hands), `Distribute` |
| `src/ai/steering.ts` | Adds pursue (lead a moving target), separation from nearby players (so supporters don't stack) and staying inside the boards |
| `src/ai/ai.ts` | Orchestration: brains, ball-path cache, states → `Command`s. Exposes what `?debug` draws |
| `src/keeper/body.ts` | Ported from `../penalty-shootout/src/keeper/` (`keeper.ts`, `pose.ts`): torso and arm colliders on the keeper's kinematic body, the dive pose and reach limit. Turned to face along X (the goal line is now on X) and attached to a `Player` |
| `src/keeper/dive.ts` | Ported `planDive`, with the seeded RNG. It reads or guesses from the predicted crossing of the ball's path with the goal line, and times the dive to it |
| `src/sim/handling.ts` | Catch rules (own area, ball speed, the keeper's arms), holding the ball at the hands, releasing it with a throw (launch solver from hand height) or a roll (ground pass) |
| `src/config.ts` | `TUNING.ai.levels`, `TUNING.keeper` (ported), support and decision weights |

Presentation:

| File | Contents |
| --- | --- |
| `src/render/keeper.ts` | A keeper mesh driven by the pose in the snapshot (port of the penalty game's `keeper/mesh.ts`, placeholder until M5's characters) |
| `src/debug.ts` | `?debug` adds a state label over every player, support-spot scores as coloured dots, the carrier's pass lanes coloured by safety, the chaser's interception point, and the keeper's dive target |
| `src/main.ts` | `?difficulty=easy\|normal\|hard` |

## Key data structures

```ts
type Phase = 'attack' | 'defend' | 'transition';

interface TeamPlan {                  // TeamBrain output, refreshed every 6 steps
  phase: Phase;
  presser: number | null;
  cover: number | null;
  marks: Map<number, number>;         // our player → their player
  supports: Map<number, Vec2>;        // our player → support spot
  runner: number | null;
  spots: ScoredSpot[];                // for ?debug
}

interface Option {                    // one choice for the player on the ball
  kind: 'shoot' | 'pass' | 'dribble';
  target: Vec2;                       // goal point, receiver's lead point, or space ahead
  receiver?: number;
  utility: number;                    // after difficulty noise
}

interface Level { reaction: number; noise: number; passMargin: number; shotMargin: number; keeper: 'easy' | 'normal' | 'hard' }
```

The keeper's pose and catch state go into `Snapshot`, so the renderer can draw dives.

## Tests

| File | Asserts |
| --- | --- |
| `passing.test.ts` | The closed-form roll matches the ghost to within 0.3 m and 0.1 s. A lane with an opponent in it is unsafe, a clear lane safe, an opponent behind the passer harmless |
| `brain.test.ts` | One presser and one cover per defending team, the cover goal-side of the presser; markers on different opponents; phase flips on a turnover, through `transition` |
| `support.test.ts` | Chosen spots are open (safe from the ball), in range, and at least 4 m apart; none in a clump of opponents |
| `decide.test.ts` | A clear shot from 8 m centrally → shoot; under pressure with an open teammate ahead → pass to them; never to a teammate whose lane is blocked; open space ahead and far from goal → dribble. Easy picks worse options more often than hard over many seeded trials |
| `keeper.test.ts` | Ported pose checks (reach limit, low/high dives). Over a battery of shots on target from 10 m, `normal` saves between 20 and 60% and easy < normal < hard. Catches a slow shot and holds it; distributes to a teammate within the time limit; never catches outside the area; comes out to intercept a through ball into the area |
| `ai.test.ts` (rewritten) | Supporters spread and offer a pass when the carrier is pressed (a pass option with safety > 0 exists); markers stay goal-side of their man; pressing wins the ball back within a time limit on most seeds |
| `difficulty.test.ts` | Over 6 seeded short matches each way, `hard` beats `easy` on aggregate goals |
| `soak.test.ts` (extended) | Whole matches at every level: no NaNs, no ball out without a restart, nobody stuck (limits per state), possession changes hands, and goals per match within 3–7 on average at `normal`. Keepers make saves, and both teams score |

## Commits, in order

1. Plan (this file).
2. Rolling model and pass safety; steering additions. Tests.
3. Team brain: phases and roles; `Press`, `Cover` and `Mark` states; L calls a presser. Tests.
4. Support spots, the `Support` / `Run` / `Receive` states, and the `?debug` overlay. Tests.
5. On-ball decisions with utility scores; difficulty levels and `?difficulty`. Tests.
6. Keepers: ported body, pose and dive; guard, intercept, catch and hold, distribute;
   the keeper mesh. Tests.
7. Soak at all levels, tuning towards the target scoring rate, CLAUDE.md, plan notes.

Each commit passes build and tests; I'll look at `?aivsai&debug` in the browser after
3–6, and ask you to playtest at the end.

## Risks

- **Tuning.** Utility weights interact; the soak stats (goals, turnovers, saves, pass
  completion) are the dial. I'll print them per level while tuning, and lock the
  ranges into the soak test.
- **The ball in a keeper's hands** is a special case in possession, restarts, the shot
  tracker and the interpolation. It gets its own module and tests.
- **Cost.** Support scoring is 40 spots × 5 opponents × 6 samples per team per brain
  tick, about 2,400 cheap evaluations every 0.1 s. Decisions only run for the player on
  the ball.
