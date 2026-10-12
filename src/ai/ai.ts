import { TUNING } from '../config';
import type { Vec2 } from '../math';
import { IDLE, type Command } from '../sim/command';
import type { Player } from '../sim/player';
import type { Sim } from '../sim/sim';
import { shiftedSlot } from '../team/formation';
import { arrive } from './steering';

/**
 * The AI for every player that isn't being driven by a human. A team brain re-plans every
 * `brainInterval` steps (where each player's slot is); each player then turns that plan
 * into a `Command` every step.
 */
export class Ai {
  /** Each player's open-play position, from the last brain update. */
  private readonly slots: Vec2[] = [];
  private stepsToBrain = 0;

  /** Call once per step, before asking for commands. */
  update(sim: Sim): void {
    if (--this.stepsToBrain > 0) return;
    this.stepsToBrain = TUNING.ai.brainInterval;
    const b = sim.ball.translation();
    const owner = sim.possession.owner;
    const ownerTeam = owner === null ? null : sim.players[owner].team;
    for (const p of sim.players) {
      this.slots[p.id] = shiftedSlot(p.spec.slot, b, sim.attackDir(p.team), ownerTeam === p.team);
    }
  }

  command(sim: Sim, p: Player): Command {
    const phase = sim.match.phase;
    if (phase.kind === 'restart' && phase.taker === p.id) return this.takeRestart(sim, phase.elapsed);
    const slot = this.slots[p.id];
    if (!slot) return IDLE;
    const steer = arrive(p, slot);
    return { ...IDLE, move: steer.move, sprint: steer.sprint };
  }

  /** Take a restart after a moment's pause: for now, a pass the way the taker faces. */
  private takeRestart(sim: Sim, waited: number): Command {
    if (waited < TUNING.match.aiTakerDelay) return IDLE;
    // Tap J (a pass needs a fresh press, so keep tapping until it's taken).
    return { ...IDLE, pass: sim.tick % 10 < 5 };
  }
}
