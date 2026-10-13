import type RAPIER from '@dimforge/rapier3d-compat';
import { Ai } from '../ai/ai';
import { applyBallForces } from '../ball/forces';
import { ShotTracker } from '../ball/outcome';
import { Ghost } from '../ball/trajectory';
import { TUNING, type KeeperLevel, type LevelName } from '../config';
import { BALL_RADIUS, HALF_LENGTH, PHYSICS_STEP } from '../constants';
import { clamp, createRng, type Quat, type Rng, type Vec2, type Vec3 } from '../math';
import { createPhysics, type Physics } from '../physics';
import { IDLE, type Command } from './command';
import { dribbleMove, playBall } from './dribble';
import type { SimEvent } from './events';
import { Handling } from './handling';
import { tryKick, updateKickButtons } from './kick';
import { stepLocomotion } from './locomotion';
import { Match, type MatchAction } from './match';
import { AVERAGE, createPlayer, integratePlayer, syncBody, teleportBody, type Player, type PlayerSpec } from './player';
import { canPlayBall, Possession } from './possession';
import { chooseTaker, faceNearestTeammate, holdRestartShape, placeForRestart } from './restarts';
import type { Restart, RulesContext } from './rules';
import { keepOffBall, separatePlayers, type Challenge } from './separation';
import { startTackle, stepTackle, tackleMove } from './tackle';

/** A keeper gathers a loose ball no higher than this (m) with their hands. */
const GATHER_HEIGHT = 2.2;

export interface SimOptions {
  seed: number;
  players: readonly PlayerSpec[];
  /** Drive every player without a command with the AI (otherwise they stand still). */
  ai?: boolean;
  /** Each team's AI level (default normal for both). */
  levels?: readonly [LevelName, LevelName];
  /** Start with a kick-off (a real match) rather than straight into open play (most tests). */
  kickoff?: boolean;
}

export interface PlayerSnapshot {
  x: number;
  z: number;
  facing: number;
  /** Keepers: the dive pose (height off the ground, lean, arm angle). Zero for outfield players. */
  y: number;
  lean: number;
  arms: number;
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
  /** Ids of the players a human drove last step (the AI leaves them alone). */
  readonly humanDriven = new Set<number>();
  /** Per team: the tick until which a human's call for a teammate to press (L) stands. */
  private readonly pressCallUntil = [0, 0];
  private readonly pressHeld = [false, false];
  /** The last pass played to a teammate (for the AI's receiver), until someone controls the ball. */
  lastPass: { player: number; receiver: number; tick: number } | null = null;
  /** Keepers catching, holding and distributing the ball. */
  readonly handling = new Handling();
  /** Each team's keeper level (from its AI level). */
  readonly keeperLevels: readonly [KeeperLevel, KeeperLevel];
  /** The ball's velocity at the start of the current step's physics. */
  private incoming: Vec3 = { x: 0, y: 0, z: 0 };
  /** Shoulder challenges in progress last step (carrier and challenger ids, as "carrier:challenger"). */
  private challenges = new Set<string>();

  static async create(options: SimOptions): Promise<Sim> {
    return new Sim(await createPhysics(), options);
  }

  private constructor(physics: Physics, options: SimOptions) {
    this.physics = physics;
    this.rng = createRng(options.seed);
    const [home, away] = options.levels ?? ['normal', 'normal'];
    this.keeperLevels = [TUNING.keeper.levels[TUNING.levels[home].keeper], TUNING.keeper.levels[TUNING.levels[away].keeper]];
    this.ai = options.ai ? new Ai(options.seed, [TUNING.levels[home], TUNING.levels[away]]) : null;
    // An AI team's level shifts its players' ratings.
    const boost = (spec: PlayerSpec) => (options.ai ? TUNING.levels[spec.team === 0 ? home : away].attributes : 0);
    this.players = options.players.map((spec, id) => createPlayer(physics, id, withBoost(spec, boost(spec))));
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

  /** Has a human on `team` called for a teammate to press (L) within the last few seconds? */
  pressCalled(team: 0 | 1): boolean {
    return this.tick < this.pressCallUntil[team];
  }

  /** Remember who the humans drove this step, and any new call to press. */
  private noteHumans(commands: readonly Command[]): void {
    this.humanDriven.clear();
    const pressing = [false, false];
    for (const p of this.players) {
      const cmd = commands[p.id];
      if (!cmd) continue;
      this.humanDriven.add(p.id);
      if (cmd.press) pressing[p.team] = true;
    }
    for (const team of [0, 1] as const) {
      if (pressing[team] && !this.pressHeld[team]) {
        this.pressCallUntil[team] = this.tick + Math.round(TUNING.ai.pressCallTime / PHYSICS_STEP);
      }
      this.pressHeld[team] = pressing[team];
    }
  }

  /** Report shoulder challenges as they begin. */
  private noteChallenges(challenges: readonly Challenge[], events: SimEvent[]): void {
    const now = new Set<string>();
    for (const c of challenges) {
      const key = `${c.carrier}:${c.challenger}`;
      now.add(key);
      if (!this.challenges.has(key)) events.push({ type: 'challenge', carrier: c.carrier, challenger: c.challenger });
    }
    this.challenges = now;
  }

  /**
   * A challenger who has shouldered the carrier off the ball (it's at their feet, and
   * nearer them than the carrier) has a loose ball to take with their first touch.
   */
  private shoulderOff(challenges: readonly Challenge[]): void {
    const b = this.ball.translation();
    for (const c of challenges) {
      const carrier = this.players[c.carrier];
      const challenger = this.players[c.challenger];
      if (challenger.touchCooldown > 0 || !canPlayBall(challenger, b)) continue;
      const near = (p: Player) => Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
      if (near(challenger) >= near(carrier)) continue;
      this.possession.lose();
      return;
    }
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

    this.possession.update(this.players, this.ball.translation(), dt);
    // Someone has it: the pass (if there was one) is over.
    if (this.possession.owner !== null) this.lastPass = null;
    this.ai?.update(this);
    // Nobody moves during the half-time break or after full time.
    const stopped = match.phase.kind === 'halfTime' || match.over;
    const resolved = this.players.map((p) => (stopped ? IDLE : (commands[p.id] ?? this.ai?.command(this, p) ?? IDLE)));
    this.noteHumans(commands);

    for (const p of this.players) {
      p.touchCooldown = Math.max(0, p.touchCooldown - dt);
      // Anyone not on the ball (nor holding it, nor lining up a kick) can tackle in open play.
      const free = match.inPlay && this.possession.owner !== p.id && this.handling.holder !== p.id && !p.charge && !p.keeper?.busy;
      startTackle(p, resolved[p.id], free, this.ball.translation());
      const cmd = tackleMove(p, resolved[p.id]);
      if (p.keeper) {
        if (cmd.dive && match.inPlay && this.handling.holder !== p.id) p.keeper.dive(cmd.dive.across, cmd.dive.height, this.keeperLevels[p.team]);
        if (p.keeper.busy) {
          // Diving, down or getting up: the dive moves them, not their legs.
          p.speed = 0;
          p.vel.x = 0;
          p.vel.z = 0;
          p.pos.z = p.keeper.step(dt, p.pos.z);
          continue;
        }
      }
      const onBall = this.possession.owner === p.id;
      const move = stopped || this.handling.holder === p.id ? cmd.move : dribbleMove(p, cmd.move, this.ball, this.possession);
      stepLocomotion(p, { move, sprint: cmd.sprint, onBall, pace: p.attrs.pace }, dt);
      integratePlayer(p, dt);
      p.keeper?.step(dt, p.pos.z);
    }
    const challenges = separatePlayers(this.players, this.possession.owner);
    this.noteChallenges(challenges, events);
    if (match.inPlay) this.shoulderOff(challenges);
    keepOffBall(this.players, this.ball.translation(), this.ball.linvel(), this.handling.holder);
    if (match.phase.kind === 'restart') {
      const b = this.ball.translation();
      holdRestartShape(this.players, match.phase.restart, match.taker, { x: b.x, z: b.z }, (t) => this.attackDir(t));
    }
    const holder = this.handling.holder === null ? null : this.players[this.handling.holder];
    if (holder) this.handling.confine(holder, ownGoalX(this, holder.team));
    for (const p of this.players) syncBody(p);
    for (const p of this.players) {
      const tackled = stepTackle(p, this.players, this.ball, this.possession, this.rng, dt, match.inPlay);
      if (tackled) this.onPlayed(tackled, events);
    }

    for (const p of this.players) {
      updateKickButtons(p, resolved[p.id]);
      if (holder) {
        // A keeper holding the ball: J (or K) throws or rolls it out; nobody else can play it.
        if (p === holder && p.pendingKick) {
          p.pendingKick = null;
          p.charge = null;
          this.onPlayed(this.handling.distribute(p, this.players, this.ball, this.possession, this.ghost), events);
        } else if (p !== holder) {
          p.pendingKick = null;
        }
      } else if (match.inPlay) {
        if (p.keeper && this.gather(p, events)) continue;
        // A keeper diving or on the ground can't play it with their feet.
        if (p.keeper?.busy) continue;
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

    const stillHeld = this.handling.holder === null ? null : this.players[this.handling.holder];
    if (stillHeld) this.handling.hold(stillHeld, this.ball, dt);
    // The ball's velocity coming into this step: a keeper's catch depends on it, not on
    // how it bounced off them.
    this.incoming = this.ball.linvel();
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

  /**
   * A keeper gathers a loose ball within reach in their own area with their hands (rather
   * than trapping it with a foot), if it's catchable. True if they did.
   */
  private gather(p: Player, events: SimEvent[]): boolean {
    // Diving or down, they can still get their hands on it.
    if (this.handling.holder !== null || this.possession.owner !== null || p.touchCooldown > 0) return false;
    const b = this.ball.translation();
    if (b.y > GATHER_HEIGHT || Math.hypot(b.x - p.pos.x, b.z - p.pos.z) > TUNING.dribble.reach) return false;
    const last = this.possession.lastTouch;
    const lastTeam = last === null ? null : this.players[last].team;
    if (!this.handling.canCatch(p, b, this.ball.linvel(), ownGoalX(this, p.team), this.keeperLevels[p.team], lastTeam)) return false;
    this.shot?.tracker.onKeeperTouch();
    events.push({ type: 'save', player: p.id, caught: true });
    this.handling.catch(p, this.ball, this.possession);
    this.onPlayed({ type: 'touch', player: p.id, kind: 'receive' }, events);
    return true;
  }

  /** A player kicked or touched the ball. */
  private onPlayed(event: SimEvent, events: SimEvent[]): void {
    events.push(event);
    if (event.type === 'kick') {
      this.lastPass = event.kind === 'pass' && event.receiver !== null ? { player: event.player, receiver: event.receiver, tick: this.tick } : null;
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
    const p = this.players[id];
    if (p.keeper && this.handling.holder === null) {
      // A keeper got a hand (or body) to it: catch it if they can, otherwise it's a parry.
      this.shot?.tracker.onKeeperTouch();
      const last = this.possession.lastTouch;
      const caught = this.handling.canCatch(
        p,
        this.ball.translation(),
        this.incoming,
        ownGoalX(this, p.team),
        this.keeperLevels[p.team],
        last === null ? null : this.players[last].team,
      );
      events.push({ type: 'save', player: id, caught });
      if (caught) {
        this.handling.catch(p, this.ball, this.possession);
        this.onPlayed({ type: 'touch', player: id, kind: 'receive' }, events);
        return;
      }
    }
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
    this.handling.drop();
    this.lastPass = null;
    this.shot = null;
    const taker = chooseTaker(this.players, restart);
    for (const p of this.players) {
      p.charge = null;
      p.pendingKick = null;
      placeForRestart(p, restart, taker, this.match.clock.half, this.attackDir(p.team));
    }
    if (restart.kind === 'kickoff') faceNearestTeammate(this.players, taker);
    holdRestartShape(this.players, restart, taker, restart.at, (t) => this.attackDir(t));
    for (const p of this.players) teleportBody(p);
    this.match.setTaker(taker);
    events.push({ type: 'restart', restart, taker });
    this.teleported = true;
  }

  private emptySnapshot(): Snapshot {
    return {
      ball: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } },
      players: this.players.map(() => ({ x: 0, z: 0, facing: 0, y: 0, lean: 0, arms: 0 })),
    };
  }

  private writeSnapshot(s: Snapshot): void {
    const p = this.ball.translation();
    const r = this.ball.rotation();
    Object.assign(s.ball.pos, { x: p.x, y: p.y, z: p.z });
    Object.assign(s.ball.rot, { x: r.x, y: r.y, z: r.z, w: r.w });
    this.players.forEach((pl, i) => {
      const pose = pl.keeper?.pose;
      Object.assign(s.players[i], { x: pl.pos.x, z: pl.pos.z, facing: pl.facing, y: pose?.y ?? 0, lean: pose?.lean ?? 0, arms: pose?.arms ?? 0 });
    });
  }
}

function copySnapshot(from: Snapshot, to: Snapshot): void {
  Object.assign(to.ball.pos, from.ball.pos);
  Object.assign(to.ball.rot, from.ball.rot);
  from.players.forEach((p, i) => Object.assign(to.players[i], p));
}

/** `spec` with every rating moved by `boost` (kept within 0–1). */
function withBoost(spec: PlayerSpec, boost: number): PlayerSpec {
  if (boost === 0) return spec;
  const attrs = { ...AVERAGE, ...spec.attrs };
  for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[k] = clamp(attrs[k] + boost, 0, 1);
  return { ...spec, attrs };
}

/** The x of the goal line `team` defends. */
function ownGoalX(sim: Sim, team: 0 | 1): number {
  return -sim.attackDir(team) * HALF_LENGTH;
}
