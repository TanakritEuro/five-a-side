import { PHYSICS_STEP } from '../src/constants';
import { createRng, type Vec2 } from '../src/math';
import { IDLE, type Command } from '../src/sim/command';
import type { SimEvent } from '../src/sim/events';
import type { PlayerSpec } from '../src/sim/player';
import { Sim } from '../src/sim/sim';
import { DIAMOND } from '../src/team/formation';

export const STEPS_PER_SECOND = Math.round(1 / PHYSICS_STEP);

/** One player for team 0 at `at`, facing `facing`. */
export function solo(at: Vec2 = { x: -2, z: 0 }, facing = 0): PlayerSpec[] {
  const slot = DIAMOND.find((s) => s.role === 'pivot')!;
  return [{ team: 0, role: 'pivot', slot, kickoff: at, kickoffFacing: facing }];
}

export function createSim(seed = 1, players: PlayerSpec[] = solo()): Promise<Sim> {
  return Sim.create({ seed, players });
}

export function cmd(partial: Partial<Command> = {}): Command {
  return { ...IDLE, move: { ...IDLE.move }, ...partial };
}

/** Step `sim` for `seconds` with commands from `drive(step)`: one for player 0, or one per player. Returns every event. */
export function run(sim: Sim, seconds: number, drive: (step: number) => Command | Command[] = () => IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds * STEPS_PER_SECOND);
  for (let i = 0; i < steps; i++) {
    const c = drive(i);
    events.push(...sim.step(Array.isArray(c) ? c : [c]));
  }
  return events;
}

/**
 * A random but reproducible stream of commands, like a frantic player: a new direction
 * every so often, bursts of sprinting, and kick buttons held for random lengths of time.
 * Given a sim, it spends most of its time running at the ball, so it gets kicks in.
 */
export function randomDriver(seed: number, sim?: Sim): (step: number) => Command {
  const rng = createRng(seed);
  let current = cmd();
  let chase = false;
  let until = 0;
  return (step) => {
    if (step >= until) {
      const angle = rng() * Math.PI * 2;
      const still = rng() < 0.1;
      const button = rng();
      chase = sim !== undefined && rng() < 0.7;
      current = cmd({
        move: still ? { x: 0, z: 0 } : { x: Math.cos(angle), z: Math.sin(angle) },
        sprint: rng() < 0.3,
        pass: button < 0.15,
        shoot: button > 0.8,
      });
      until = step + Math.round((0.2 + rng() * 1.3) * STEPS_PER_SECOND);
    }
    if (chase && sim) {
      const p = sim.players[0].pos;
      const b = sim.ball.translation();
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 0.3) return { ...current, move: { x: (b.x - p.x) / d, z: (b.z - p.z) / d } };
    }
    return current;
  };
}
