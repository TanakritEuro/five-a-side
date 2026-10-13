# Milestone 5 plan: characters

Goal: the capsules become footballers. Ten Quaternius Mannequins (from the penalty game)
run, sprint, turn, dribble, pass, shoot, receive, tackle, barge and celebrate, and the
keepers dive, catch and throw, all timed to what the simulation does. Each team wears
its kit. The simulation doesn't change: animation is presentation, read from snapshots.

## Scope decisions (to confirm)

- **Animation source.** The penalty game's trimmed `mannequin.glb` has three clips: idle,
  jog and dance. I'd use the jog clip for jogging, the idle clip for standing and the dance
  clip for goal celebrations. Everything else would be procedural poses on the ported
  rig: walk, run and sprint cycles, kicks, traps, tackles and keeper actions. There's
  nothing to download.

  The alternative is the full free Universal Animation Library. That needs you to
  download it from itch.io; `scripts/prepare-models.mjs` (ported) then keeps the extra
  clips we want, such as walk and sprint. I'd only do that if the procedural sprint
  looks poor.
- **Kits.** The Mannequin is one body colour with contrasting joint plates. I'd colour it
  by region in the shader, using each vertex's height in the bind pose: shirt above the
  hips, shorts to mid-thigh, socks below the knee, dark boots, and skin for the head and
  hands. Keepers get long sleeves and gloves. The alternative is the penalty game's
  two-tone look (body in the shirt colour, joints in the shorts colour).
- **No shirt numbers or names** this milestone; they could come with the menus in M6.
- **Celebrations.** After a goal the scorer dances (the clip) during the goal delay.
  Teammates run to them and the other team stands with hands on heads. Then everyone
  walks back for the kick-off.

## How it works

### What the presentation reads

Animation must be driven from snapshots, not from `Player`, so the M6 replays animate
too. `PlayerSnapshot` gains read-only copies of what's already in the sim:

```ts
interface PlayerSnapshot {
  // ...x, z, facing, keeper pose (y, lean, arms) as now
  speed: number;              // m/s
  sprinting: boolean;
  charge: number;             // 0–1 while a shot is held, else 0
  tackle: number;             // seconds into a lunge, or -1
  /** The last thing they did with the ball or a body, and the tick it happened. */
  action: { kind: 'kick' | 'pass' | 'touch' | 'receive' | 'tackle' | 'challenge' | 'catch' | 'throw'; tick: number } | null;
}
```

The sim fills them in `writeSnapshot`, plus the step's tick. Nothing in the sim reads them.

### Animator (one per player, presentation only)

- **Locomotion** blends idle, walk, jog, run and sprint by interpolated speed. The stride
  phase advances with distance covered, not time, so feet don't slide. The body leans
  into turns (from the change in facing) and forward under acceleration. With the ball,
  the stride is shorter and the dribbling foot flicks out on each `touch`.
- **Actions** are one-shot overlays timed from `action.tick`:
  - pass: a side-foot swing;
  - shot: a backswing while `charge` rises, then contact on the kick's tick and a follow-through;
  - receive: a trap;
  - tackle: a lunge with the leg out, through `tackle`;
  - challenge: a shoulder lean into the opponent;
  - keepers: catch, hold, throw or roll.

  Each blends in and out over a few frames. A tap pass has no warning in the sim, so its
  pose starts at contact and only suggests the backswing.
- **Keepers** port the penalty game's `keeper/mesh.ts`. Arm angle, body height and lean
  come straight from the dive pose, so the gloves stay where the glove colliders are. Legs
  use a set stance, a stretched dive or a tucked jump.

### Footballer meshes

`characters/footballer.ts` builds a rig and a `SkinnedFigure` in the team's kit, and falls
back to the rig's own capsule limbs if the model fails to load. It replaces
`createPlayerMesh` and the placeholder keeper. The controlled-player marker stays.

### Performance

The ported `SkinnedFigure.update` allocates quaternions for every bone every frame. That
was fine for two figures; with ten it would be garbage-collector churn. It gets rewritten
to reuse scratch objects and precomputed rest rotations. Budget: 60 fps with ten
figures, checked with `?stats`.

## Files

| File | Contents |
| --- | --- |
| `public/models/mannequin.glb`, `ASSETS.md` | Copied from the penalty game, with its credit row |
| `scripts/prepare-models.mjs` | Ported, in case we add clips later (its dev dependency only then) |
| `src/characters/rig.ts` | Ported: joints, `Pose`, `blendPoses`, the capsule fallback; kit colours |
| `src/characters/skinned.ts` | Ported `SkinnedFigure`, allocation-free update; the region-coloured kit shader |
| `src/characters/poses.ts` | Pose library: stand, walk / jog / run / sprint cycles, pass, shot windup / contact / follow-through, trap, tackle, shoulder lean, celebrate, dejected, keeper set / dive / jump / hold / throw |
| `src/characters/animator.ts` | Per-player state: gait phase, turn lean, active action and its blend, clip choice |
| `src/characters/footballer.ts` | Rig + figure + kit for one player; keeper variant |
| `src/sim/sim.ts` | Snapshot fields above (read-only copies) |
| `src/render/interpolate.ts`, `src/game.ts` | Feed interpolated snapshots and the tick to the animators |
| `src/scene.ts`, `src/render/keeper.ts` | Placeholder meshes removed |

## Tests

| File | Asserts |
| --- | --- |
| `snapshot.test.ts` | Snapshots carry speed, charge and the tackle state; a kick, touch, tackle or challenge sets `action` with that step's tick; the sim gives the same match with or without anyone reading them (determinism) |
| `animator.test.ts` | Headless (no WebGL): the stride phase advances by distance, so at a constant speed the foot's ground contact doesn't move; gaits blend continuously across speed; a kick action puts the contact pose on the kick's tick; actions blend out; every pose's angles are finite and within joint limits |
| `purity.test.ts` (existing) | Still: nothing under `src/sim/` imports `characters/`, `three` or the DOM |

Look and feel can't be unit-tested. I'll check in Chrome after each commit: a match with
`?aivsai`, slow motion (`?timescale=0.25`) for kicks and tackles, and `?stats` for fps.
Then I'll ask you to playtest.

## Commits, in order

1. Plan (this file).
2. Port the rig, skinned figure and model; footballers standing in kit; keeper mesh
   ported; snapshot fields. Tests.
3. Locomotion: gait blend by speed, stride by distance, turn and acceleration lean,
   dribble touches. Tests.
4. Actions: passes and shots timed to kicks, traps, tackles, shoulder challenges, keeper
   catch / hold / throw. Tests.
5. Celebrations and reactions; performance pass; CLAUDE.md and plan notes.
