import type RAPIER from '@dimforge/rapier3d-compat';
import { applyBallForces } from '../ball/forces';
import { Ghost } from '../ball/trajectory';
import { BALL_RADIUS, PHYSICS_STEP } from '../constants';
import { createRng, type Quat, type Rng, type Vec2, type Vec3 } from '../math';
import { createPhysics, type Physics } from '../physics';
import { IDLE, type Command } from './command';
import type { SimEvent } from './events';
import { dribbleMove, playBall } from './dribble';
import { stepLocomotion } from './locomotion';
import { createPlayer, integratePlayer, type Player, type PlayerSpec } from './player';
import { Possession } from './possession';

export interface SimOptions {
  seed: number;
  players: readonly PlayerSpec[];
}

export interface PlayerSnapshot {
  x: number;
  z: number;
  facing: number;
}

/** What the renderer needs from one step, so it can interpolate between two of them. */
export interface Snapshot {
  ball: { pos: Vec3; rot: Quat };
  players: PlayerSnapshot[];
}

/**
 * The whole game world, headless: physics, ball, players and (as they arrive) possession
 * and the rules. Advances only in fixed steps of `PHYSICS_STEP`, driven by one `Command`
 * per player, and takes all randomness from its seeded RNG, so the same seed and the same
 * commands always give the same match.
 */
export class Sim {
  readonly physics: Physics;
  readonly rng: Rng;
  /** Ghost-ball worlds for predicting kicks. */
  readonly ghost = new Ghost();
  readonly players: Player[];
  readonly possession = new Possession();
  /** Steps taken so far. */
  tick = 0;
  /** State after the previous step and after the latest one: render between the two. */
  readonly prev: Snapshot;
  readonly curr: Snapshot;

  static async create(options: SimOptions): Promise<Sim> {
    return new Sim(await createPhysics(), options);
  }

  private constructor(physics: Physics, options: SimOptions) {
    this.physics = physics;
    this.rng = createRng(options.seed);
    this.players = options.players.map((spec, id) => createPlayer(physics, id, spec));
    this.placeBall({ x: 0, z: 0 });
    this.curr = this.emptySnapshot();
    this.prev = this.emptySnapshot();
    this.writeSnapshot(this.curr);
    this.writeSnapshot(this.prev);
  }

  get ball(): RAPIER.RigidBody {
    return this.physics.ball;
  }

  /** Put the ball down at rest on the ground at `at`. */
  placeBall(at: Vec2): void {
    this.ball.setTranslation({ x: at.x, y: BALL_RADIUS, z: at.z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Advance one fixed step. `commands[i]` drives player `i`; missing ones stand still. */
  step(commands: readonly Command[]): SimEvent[] {
    copySnapshot(this.curr, this.prev);
    const events: SimEvent[] = [];
    const dt = PHYSICS_STEP;
    const { world, events: queue } = this.physics;

    this.possession.update(this.players, this.ball.translation());
    for (const p of this.players) {
      const cmd = commands[p.id] ?? IDLE;
      const onBall = this.possession.owner === p.id;
      const move = dribbleMove(p, cmd.move, this.ball, this.possession);
      stepLocomotion(p, { move, sprint: cmd.sprint, onBall, pace: p.attrs.pace }, dt);
      integratePlayer(p, dt);
      p.touchCooldown = Math.max(0, p.touchCooldown - dt);
    }
    for (const p of this.players) {
      const touch = playBall(p, this.ball, this.possession, (commands[p.id] ?? IDLE).move, this.rng, dt);
      if (touch) events.push(touch);
    }

    applyBallForces(this.ball);
    world.step(queue);
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const id = this.physics.playerColliders.get(h1) ?? this.physics.playerColliders.get(h2);
      if (id === undefined || id === this.possession.owner) return;
      this.possession.deflect(id);
      events.push({ type: 'touch', player: id, kind: 'deflect' });
    });

    this.tick++;
    this.writeSnapshot(this.curr);
    return events;
  }

  private emptySnapshot(): Snapshot {
    return {
      ball: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } },
      players: this.players.map(() => ({ x: 0, z: 0, facing: 0 })),
    };
  }

  private writeSnapshot(s: Snapshot): void {
    const p = this.ball.translation();
    const r = this.ball.rotation();
    Object.assign(s.ball.pos, { x: p.x, y: p.y, z: p.z });
    Object.assign(s.ball.rot, { x: r.x, y: r.y, z: r.z, w: r.w });
    this.players.forEach((pl, i) => Object.assign(s.players[i], { x: pl.pos.x, z: pl.pos.z, facing: pl.facing }));
  }
}

function copySnapshot(from: Snapshot, to: Snapshot): void {
  Object.assign(to.ball.pos, from.ball.pos);
  Object.assign(to.ball.rot, from.ball.rot);
  from.players.forEach((p, i) => Object.assign(to.players[i], p));
}
