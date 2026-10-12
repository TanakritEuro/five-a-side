import type RAPIER from '@dimforge/rapier3d-compat';
import { Ai } from '../ai/ai';
import { applyBallForces } from '../ball/forces';
import { ShotTracker } from '../ball/outcome';
import { Ghost } from '../ball/trajectory';
import { BALL_RADIUS, PHYSICS_STEP } from '../constants';
import { createRng, type Quat, type Rng, type Vec2, type Vec3 } from '../math';
import { createPhysics, type Physics } from '../physics';
import { IDLE, type Command } from './command';
import { dribbleMove, playBall } from './dribble';
import type { SimEvent } from './events';
import { tryKick, updateKickButtons } from './kick';
import { stepLocomotion } from './locomotion';
import { Match, type MatchAction } from './match';
import { createPlayer, integratePlayer, syncBody, type Player, type PlayerSpec } from './player';
import { Possession } from './possession';
import { chooseTaker, holdRestartShape, placeForRestart } from './restarts';
import type { Restart, RulesContext } from './rules';
import { separatePlayers } from './separation';

export interface SimOptions {
  seed: number;
  players: readonly PlayerSpec[];
  /** Drive every player without a command with the AI (otherwise they stand still). */
  ai?: boolean;
  /** Start with a kick-off (a real match) rather than straight into open play (most tests). */
  kickoff?: boolean;
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
 * The whole game world, headless: physics, ball, players, possession and the match.
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
  readonly match: Match;
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
    this.match = new Match(options.kickoff ?? false);
    this.placeBall({ x: 0, z: 0 });
    if (this.match.phase.kind === 'restart') this.setRestart(this.match.phase.restart, []);
    this.curr = this.emptySnapshot();
    this.prev = this.emptySnapshot();
    this.writeSnapshot(this.curr);
    this.writeSnapshot(this.prev);
  }

  get ball(): RAPIER.RigidBody {
    return this.physics.ball;
  }

  /** Which way a team is attacking: +1 towards +X. Ends swap at half time. */
  attackDir(team: 0 | 1): 1 | -1 {
    return this.match.attackDir(team);
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
    const match = this.match;

    this.possession.update(this.players, this.ball.translation());
    this.ai?.update(this);
    // Nobody moves during the half-time break or after full time.
    const stopped = match.phase.kind === 'halfTime' || match.over;
    const resolved = this.players.map((p) => (stopped ? IDLE : (commands[p.id] ?? this.ai?.command(this, p) ?? IDLE)));

    for (const p of this.players) {
      const cmd = resolved[p.id];
      const onBall = this.possession.owner === p.id;
      const move = dribbleMove(p, cmd.move, this.ball, this.possession);
      stepLocomotion(p, { move, sprint: cmd.sprint, onBall, pace: p.attrs.pace }, dt);
      integratePlayer(p, dt);
      p.touchCooldown = Math.max(0, p.touchCooldown - dt);
    }
    separatePlayers(this.players);
    if (match.phase.kind === 'restart') {
      const b = this.ball.translation();
      holdRestartShape(this.players, match.phase.restart, match.taker, { x: b.x, z: b.z }, (t) => this.attackDir(t));
    }
    for (const p of this.players) syncBody(p);

    for (const p of this.players) {
      updateKickButtons(p, resolved[p.id]);
      if (match.inPlay) {
        const event = tryKick(p, this) ?? playBall(p, this.ball, this.possession, resolved[p.id].move, this.rng, dt);
        if (event) this.onPlayed(event, events);
      } else if (p.id === match.taker) {
        // Only the taker may play a dead ball, and only by kicking it.
        const event = tryKick(p, this);
        if (event) {
          match.onTaken();
          this.onPlayed(event, events);
        }
      } else {
        p.charge = null;
        p.pendingKick = null;
      }
    }

    applyBallForces(this.ball);
    world.step(queue);
    queue.drainCollisionEvents((h1, h2, started) => {
      if (started) this.onContact(h1, h2, events);
    });

    const ball = this.ball.translation();
    const action = match.update(ball, dt, this.rulesContext(), events);
    if (action) this.apply(action, events);
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
      copySnapshot(this.curr, this.prev); // don't draw everyone sliding to their spots
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
    if (id === undefined || id === this.possession.owner || !this.match.inPlay) return;
    // The kicker's own body brushing the ball as it leaves their foot isn't a deflection.
    if (id === this.possession.lastTouch && this.players[id].touchCooldown > 0) return;
    this.possession.deflect(id);
    events.push({ type: 'touch', player: id, kind: 'deflect' });
  }

  private rulesContext(): RulesContext {
    const last = this.possession.lastTouch;
    return { lastTouchTeam: last === null ? null : this.players[last].team, attackDir: (t) => this.attackDir(t) };
  }

  private apply(action: MatchAction, events: SimEvent[]): void {
    this.setRestart(action.restart, events);
  }

  /** Place the ball for a restart, pick the taker, and line everyone up. */
  private setRestart(restart: Restart, events: SimEvent[]): void {
    this.placeBall(restart.at);
    this.possession.reset();
    this.shot = null;
    const taker = chooseTaker(this.players, restart);
    for (const p of this.players) {
      p.charge = null;
      p.pendingKick = null;
      placeForRestart(p, restart, taker, this.match.clock.half, this.attackDir(p.team));
    }
    holdRestartShape(this.players, restart, taker, restart.at, (t) => this.attackDir(t));
    for (const p of this.players) p.body.setTranslation({ x: p.pos.x, y: p.body.translation().y, z: p.pos.z }, true);
    this.match.setTaker(taker);
    events.push({ type: 'restart', restart, taker });
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
