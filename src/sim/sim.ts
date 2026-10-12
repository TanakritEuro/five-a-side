import type RAPIER from '@dimforge/rapier3d-compat';
import { applyBallForces } from '../ball/forces';
import { Ai } from '../ai/ai';
import { ShotTracker } from '../ball/outcome';
import { Ghost } from '../ball/trajectory';
import { BALL_RADIUS, PHYSICS_STEP } from '../constants';
import { createRng, type Quat, type Rng, type Vec2, type Vec3 } from '../math';
import { createPhysics, type Physics } from '../physics';
import { IDLE, type Command } from './command';
import type { SimEvent } from './events';
import { dribbleMove, playBall } from './dribble';
import { tryKick, updateKickButtons } from './kick';
import { stepLocomotion } from './locomotion';
import { createPlayer, integratePlayer, placePlayer, syncBody, type Player, type PlayerSpec } from './player';
import { Possession } from './possession';
import { Rules, type Restart, type RulesContext } from './rules';
import { separatePlayers } from './separation';

/** Players are moved at least this far (m) from the ball when it is placed for a restart. */
const RESTART_CLEARANCE = 1;

export interface SimOptions {
  seed: number;
  players: readonly PlayerSpec[];
  /** Drive every player without a command with the AI (otherwise they stand still). */
  ai?: boolean;
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
 * The whole game world, headless: physics, ball, players, possession and the rules.
 * Advances only in fixed steps of `PHYSICS_STEP`, driven by one `Command` per player, and
 * takes all randomness from its seeded RNG, so the same seed and the same commands always
 * give the same match.
 */
export class Sim {
  readonly physics: Physics;
  readonly rng: Rng;
  /** Ghost-ball worlds for predicting kicks. */
  readonly ghost = new Ghost();
  readonly players: Player[];
  readonly possession = new Possession();
  readonly rules = new Rules();
  /** Drives the players nobody else is driving; null when they should stand still. */
  readonly ai: Ai | null;
  /** Steps taken so far. */
  tick = 0;
  /** State after the previous step and after the latest one: render between the two. */
  readonly prev: Snapshot;
  readonly curr: Snapshot;
  /** The shot in flight, if any, being watched for its outcome. */
  private shot: { player: number; tracker: ShotTracker } | null = null;
  /** Something was teleported this step: don't interpolate across it. */
  private teleported = false;

  static async create(options: SimOptions): Promise<Sim> {
    return new Sim(await createPhysics(), options);
  }

  private constructor(physics: Physics, options: SimOptions) {
    this.physics = physics;
    this.rng = createRng(options.seed);
    this.ai = options.ai ? new Ai() : null;
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

  /** Which way a team is attacking: +1 towards +X. The home team (0) attacks +X first. */
  attackDir(team: 0 | 1): 1 | -1 {
    return team === 0 ? 1 : -1;
  }

  /** Put the ball down at rest on the ground at `at`. */
  placeBall(at: Vec2): void {
    this.ball.setTranslation({ x: at.x, y: BALL_RADIUS, z: at.z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Advance one fixed step. `commands[i]` drives player `i`; players without a command
   * are driven by the AI, or stand still if the sim has none.
   */
  step(commands: readonly Command[]): SimEvent[] {
    copySnapshot(this.curr, this.prev);
    const events: SimEvent[] = [];
    const dt = PHYSICS_STEP;
    const { world, events: queue } = this.physics;
    this.possession.update(this.players, this.ball.translation());
    this.ai?.update(this);
    const resolved = this.players.map((p) => commands[p.id] ?? this.ai?.command(this, p) ?? IDLE);
    // Everyone holds still while a restart is set up.
    const command = (p: Player) => (this.rules.frozen ? IDLE : resolved[p.id]);

    for (const p of this.players) {
      const cmd = command(p);
      const onBall = this.possession.owner === p.id;
      const move = dribbleMove(p, cmd.move, this.ball, this.possession);
      stepLocomotion(p, { move, sprint: cmd.sprint, onBall, pace: p.attrs.pace }, dt);
      integratePlayer(p, dt);
      p.touchCooldown = Math.max(0, p.touchCooldown - dt);
    }
    separatePlayers(this.players);
    for (const p of this.players) syncBody(p);
    for (const p of this.players) {
      const cmd = command(p);
      updateKickButtons(p, cmd);
      if (!this.rules.inPlay) {
        // The ball is dead: no kicks or touches until play restarts.
        p.charge = null;
        p.pendingKick = null;
        continue;
      }
      const event = tryKick(p, this) ?? playBall(p, this.ball, this.possession, cmd.move, this.rng, dt);
      if (event) this.onPlayed(event, events);
    }

    applyBallForces(this.ball);
    world.step(queue);
    queue.drainCollisionEvents((h1, h2, started) => {
      if (started) this.onContact(h1, h2, events);
    });

    const ball = this.ball.translation();
    const restart = this.rules.update(ball, dt, this.rulesContext(), events);
    if (restart) this.setRestart(restart);
    if (this.shot) {
      const outcome = this.shot.tracker.update(dt, ball, this.ball.linvel());
      if (outcome) {
        events.push({ type: 'shot', player: this.shot.player, outcome });
        this.shot = null;
      }
    }

    this.tick++;
    this.writeSnapshot(this.curr);
    if (this.teleported) {
      copySnapshot(this.curr, this.prev); // don't draw the ball sliding back to the spot
      this.teleported = false;
    }
    return events;
  }

  /** A player kicked or touched the ball. */
  private onPlayed(event: SimEvent, events: SimEvent[]): void {
    events.push(event);
    if (event.type === 'kick') {
      this.shot =
        event.kind === 'shoot' && event.atGoal
          ? { player: event.player, tracker: new ShotTracker(this.attackDir(this.players[event.player].team)) }
          : null;
    } else if (event.type === 'touch' && this.shot) {
      // Brought under control: the shot is over (reported if the woodwork kept it out).
      const outcome = this.shot.tracker.interrupted();
      if (outcome) events.push({ type: 'shot', player: this.shot.player, outcome });
      this.shot = null;
    }
  }

  /** The ball started touching collider `h1` or `h2`. */
  private onContact(h1: number, h2: number, events: SimEvent[]): void {
    const { tags, playerColliders } = this.physics;
    const tag = tags.get(h1) ?? tags.get(h2);
    if (tag === 'post' || tag === 'bar') {
      this.shot?.tracker.onWoodwork(tag);
      events.push({ type: 'woodwork', part: tag });
      return;
    }
    const id = playerColliders.get(h1) ?? playerColliders.get(h2);
    if (id === undefined || id === this.possession.owner || !this.rules.inPlay) return;
    // The kicker's own body brushing the ball as it leaves their foot isn't a deflection.
    if (id === this.possession.lastTouch && this.players[id].touchCooldown > 0) return;
    this.possession.deflect(id);
    events.push({ type: 'touch', player: id, kind: 'deflect' });
  }

  private rulesContext(): RulesContext {
    const last = this.possession.lastTouch;
    return { lastTouchTeam: last === null ? null : this.players[last].team, attackDir: (t) => this.attackDir(t) };
  }

  /** Place the ball for a restart; line everyone up for a kick-off, or clear them off the spot. */
  private setRestart(restart: Restart): void {
    this.placeBall(restart.at);
    this.possession.reset();
    this.shot = null;
    for (const p of this.players) {
      p.charge = null;
      p.pendingKick = null;
      if (restart.kind === 'kickoff') {
        placePlayer(p, p.spec.kickoff, p.spec.kickoffFacing);
        continue;
      }
      const dx = p.pos.x - restart.at.x;
      const dz = p.pos.z - restart.at.z;
      const d = Math.hypot(dx, dz);
      if (d < RESTART_CLEARANCE) {
        const ux = d > 1e-3 ? dx / d : -1;
        const uz = d > 1e-3 ? dz / d : 0;
        placePlayer(p, { x: restart.at.x + ux * RESTART_CLEARANCE, z: restart.at.z + uz * RESTART_CLEARANCE }, p.facing);
      }
    }
    this.teleported = true;
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
