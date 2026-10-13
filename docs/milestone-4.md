# Milestone 4 plan: contests

## Status: done

Decided with you before starting: a new `strength` rating; every foul stops play (no
advantage, cards or accumulated fouls); penalties aimed by turning with A/D, then K; the
AI forms a small wall at free kicks within 12 m of goal.

Results (`npm run stats`, normal v normal, 16 seeds): 4.4 goals, 31 tackles (58% won)
and 2.6 fouls a match, about 160 turnovers. Levels still order: hard 28–11 easy, hard
34–20 normal, normal 31–17 easy (8 seeds each). AI penalties go in about 60% of the time.

Where the build differs from the plan below:

- **The lunge aims itself.** A tackle goes at the ball if it's within 2.2 m and 60° of
  the way the tackler faces, so a human doesn't have to line up exactly.
- **Shoulder challenges can win the ball.** Splitting the push by weight alone changed
  nothing: the shoved carrier just steered back to the ball, since nobody may touch an
  owned ball. Now the heavier player also shoves the other off their line, and a
  challenger with the ball at their feet, nearer it than the carrier, takes it. This
  brought tackles down from about 40 to 30 a match, and goals from 7.3 back to 5.3 (8
  seeds), since the ball now changes hands before anyone has to lunge.
- **AI pressers** go in when their estimated win chance clears the level's threshold
  (easy 0.2, normal 0.35, hard 0.4), at a rate per second set by the level, and not from
  behind unless the carrier is within 10 m of goal.
- **AI free-kick takers** wait (up to 3 s) for the other team's wall to set before
  deciding; at first they struck it before the wall arrived.
- **Fouls only come from tackles.** A shoulder challenge is never a foul.
- **Fixed on the way:** a keeper's dive planned just before the half-time whistle was
  never made and left them in the dive state all through the break; unmade dives are now
  called off when the ball goes dead.
- **Not done:** the `?debug` tackle cone (labels show `TACKLE` / `recover` instead), the
  recovery shown on the stamina bar, and the AI's dribble utility reacting to a presser
  in tackling range. Carriers already release the ball sooner because tackles win it.

Goal: the ball can be won as well as intercepted. Standing tackles succeed or fail on
angle, timing and ratings; a tackle that misses the ball can be a foul. Players lean on
each other in shoulder challenges. Tackles knock the ball loose. A first touch can be
heavy. Fouls give free kicks, and fouls in the goal area give penalties. The AI does
all of this too, and the soak tests keep the numbers sensible.

## Scope decisions (to confirm)

- **Strength.** Shoulder challenges need a strength rating. I'd add `strength` as a
  sixth attribute (squads get values; levels shift it like the others), rather than
  overloading `tackling` or `pace`.
- **No advantage rule, cards or accumulated fouls yet.** Every foul stops play for a
  free kick (or a penalty). Advantage and accumulated-foul penalties (futsal's sixth foul)
  can come in M6 with the match presentation.
- **Free kicks:** direct (you can shoot). Opponents keep 4 m away; the AI puts one or two
  players in line between the ball and goal (a wall) when it's within 12 m of goal.
- **Penalties:** from the 6 m spot. Everyone else stands behind the ball and outside the
  area; the keeper stays on the line until the kick. You aim by turning (A/D), then hold
  K for power, as for any shot. The ported keeper AI dives. Rebounds stay in play.
- **The tackle button is K out of possession** (CLAUDE.md's control), with a short lunge.
  There's no slide tackle.

## How it works

### Standing tackle

A tackle is a short lunge state on the tackler (`TUNING.tackle.duration` ≈ 0.35 s). At
the contact moment (≈ 0.12 s in), the outcome is resolved against the ball and the
carrier:

- **The ball is within tackle reach and in front:** the tackler wins it with probability
  `p = base × angle × timing × ratings`:
  - `angle` is best head-on and worst from behind;
  - `timing` is better when the ball is away from the carrier's feet, between touches;
  - `ratings` compares the tackler's `tackling` with the carrier's `strength` and `passing`
    (the closest thing to ball control).

  A win pokes the ball loose: an impulse along the tackle with seeded scatter, giving a
  loose ball for anyone, the tackler usually nearest. A clean win of a slow ball gives
  the tackler control.
- **The ball isn't won, but the carrier is within reach:** it's a foul with probability
  rising for tackles from behind, at speed, and late (after the carrier has touched it
  on). Otherwise the tackle simply fails.
- **Afterwards** the tackler recovers (slowed, can't tackle again) for
  `TUNING.tackle.recovery` ≈ 0.6 s, so a failed tackle costs something.

### Shoulder challenges

When the carrier and an opponent overlap side by side (moving the same way), separation
splits the push by `strength` and speed instead of half each. The weaker player is moved
off their line, and a carrier pushed off the ball loses it naturally. It's a `challenge`
event with no foul.

### First touch

A received ball keeps more of its incoming speed, and comes off at a random angle, the
faster it arrives and the lower the receiver's `passing` (control) rating. Easy balls
stay at the feet; a hard pass to a poor receiver bounces a metre or two away. Today
every first touch keeps a flat 15%.

### Fouls and set pieces

- `Match` gets a `foul` event and two new restart kinds: `freeKick` (at the spot of the
  foul) and `penalty` (on the 6 m spot, if the defending team fouled inside its goal
  area).
- The taker is the fouled team's nearest outfield player for a free kick, and its best
  shooter for a penalty.
- A free kick is direct: the taker may pass or shoot. The AI taker chooses with
  `decide()`.
- Penalty positioning: everyone else stands behind the ball and outside the area, and
  the defending keeper stands on the line. Play resumes on the kick.

### AI

- **The presser tackles** when the ball is within tackle reach and the timing is good
  (ball off the carrier's feet, or the carrier turned away). The chance per brain tick
  is set by the level. They avoid tackling from behind unless the carrier is through on
  goal.
- **Markers and the cover don't tackle** unless the ball comes to them.
- **On the ball, pressure now means more:** the dribble option's value falls faster with
  a presser in tackling range, so carriers release the ball sooner.
- **AI free-kick and penalty takers** use `decide()` (free kicks) or pick a corner
  (penalties).

## Files

| File | Contents |
| --- | --- |
| `src/sim/tackle.ts` | Tackle state on `Player` (`lunge`, `recovering`), resolving the outcome, the poke impulse, foul chance |
| `src/sim/separation.ts` | Shoulder challenges: a push weighted by strength and speed for carrier and opponent; the `challenge` event |
| `src/sim/dribble.ts` | First-touch quality (keep fraction and scatter from incoming speed and `passing`) |
| `src/sim/match.ts`, `rules.ts`, `restarts.ts` | `foul` event, `freeKick` and `penalty` restarts, taker choice, positioning (wall gap, penalty lines), keeper held on the line |
| `src/sim/player.ts`, `team/teams.ts` | `strength` attribute and squad values |
| `src/sim/control.ts` | K out of possession tackles; penalty aiming is turning on the spot |
| `src/ai/states.ts`, `ai/brain.ts`, `ai/onball.ts` | The presser's tackle decision, wall players at free kicks, AI free-kick and penalty takers |
| `src/ui/hud.ts`, `src/game.ts` | "Foul!", "Free kick", "Penalty!" messages; the controlled player's recovery shown on the stamina bar |
| `src/debug.ts` | `?debug`: a tackle's reach cone while lunging, and the outcome label (won / missed / foul) |

## Tests

| File | Asserts |
| --- | --- |
| `tackle.test.ts` | Head-on beats from behind; tackling a ball away from the feet beats one at them; better `tackling` wins more, and a stronger and better-controlling carrier keeps it more (statistical over seeded trials). A won ball goes loose roughly along the tackle. A tackle from behind that misses fouls far more often than one from the front. Out of reach, nothing happens. Recovery stops an immediate second tackle |
| `challenge.test.ts` | Running shoulder to shoulder, the stronger player holds their line and the weaker one is moved; a strong carrier keeps the ball more often than a weak one |
| `firsttouch.test.ts` | A soft pass stays close; a hard one to a low-`passing` receiver comes off further, on average and in spread |
| `fouls.test.ts` | A foul gives a free kick at the spot to the fouled team, with opponents kept 4 m away. A foul in the defending area gives a penalty: ball on the spot, everyone else placed, keeper on the line until the kick. A penalty can be scored and saved. Free kicks can be shot directly |
| `soak.test.ts` (extended) | Per normal match: tackles happen and win the ball some of the time, fouls stay in a sensible range (say 1–8), restarts never stall, and the existing goal-rate and stuck-state checks still hold |

## Commits, in order

1. Plan (this file).
2. `strength`, first-touch quality. Tests.
3. Standing tackles (human and AI), loose balls, recovery. Tests.
4. Shoulder challenges. Tests.
5. Fouls, free kicks and penalties (rules, positioning, AI takers and walls, HUD). Tests.
6. Soak, tuning (tackle success, foul rate, goals), CLAUDE.md, plan notes.

I'll check the game in Chrome after 3–5, and ask you to playtest at the end.
