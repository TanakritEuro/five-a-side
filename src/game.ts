import type * as THREE from 'three';
import { describeOutcome } from './ball/outcome';
import { BroadcastCamera } from './camera';
import { TUNING, type LevelName } from './config';
import { PHYSICS_STEP } from './constants';
import { DebugOverlay, StatsOverlay } from './debug';
import { Keyboard } from './input/keyboard';
import { interpolate } from './render/interpolate';
import { KeeperMesh } from './render/keeper';
import { createMarker, createPlayerMesh, createScene, type GameScene } from './scene';
import type { Command } from './sim/command';
import type { SimEvent } from './sim/events';
import type { TackleOutcome } from './sim/tackle';
import type { RestartKind } from './sim/rules';
import { HumanControl } from './sim/control';
import { Sim } from './sim/sim';
import { fullLineup } from './team/lineup';
import { TEAMS } from './team/teams';
import { Hud } from './ui/hud';

export interface GameOptions {
  seed: number;
  /** Game-time multiplier (debug: `?timescale=0.25`). */
  timescale: number;
  /** `?debug`: AI states, support spots, pass lanes, chase points; rings and a readout for your player. */
  debug: boolean;
  /** `?stats`: fps, draw calls and triangles. */
  stats: boolean;
  /** `?aivsai`: both teams played by the AI; the keyboard drives nobody. */
  aiVsAi: boolean;
  /** `?difficulty=easy|normal|hard`: the opposing team's level (your teammates play at normal). */
  difficulty: LevelName;
}

const HINT = 'WASD: move · Shift: sprint · J: pass / switch · K: shoot (hold) / tackle · L: call a press';
const RESTART_NAMES: Record<RestartKind, string> = { kickoff: 'Kick-off', kickIn: 'Kick-in', goalClearance: 'Goal clearance' };
const TACKLE_NAMES: Record<TackleOutcome, string> = { won: 'Won it!', missed: 'Missed', foul: 'Foul' };

/**
 * Wires the simulation to the screen: keyboard → commands → fixed simulation steps, then
 * an interpolated render of the latest two steps. Reads the simulation, never writes it
 * except through commands.
 */
export class Game {
  private readonly view: GameScene;
  private readonly broadcast: BroadcastCamera;
  private readonly keyboard = new Keyboard();
  private readonly hud: Hud;
  private readonly playerMeshes: THREE.Object3D[];
  private readonly marker: THREE.Object3D;
  private readonly debug: DebugOverlay | null;
  private readonly stats: StatsOverlay | null;
  /** Who the keyboard drives (and switching), or null when nobody is (AI vs AI). */
  private readonly control: HumanControl | null;
  private accumulator = 0;
  private last = 0;

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, options: GameOptions): Promise<Game> {
    const sim = await Sim.create({
      seed: options.seed,
      players: fullLineup(),
      ai: true,
      kickoff: true,
      levels: ['normal', options.difficulty],
    });
    return new Game(canvas, hudRoot, sim, options);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    readonly sim: Sim,
    private readonly options: GameOptions,
  ) {
    this.view = createScene(canvas);
    // You start on the home pivot, who takes the first kick-off.
    const pivot = sim.players.findIndex((p) => p.team === 0 && p.spec.role === 'pivot');
    this.control = options.aiVsAi ? null : new HumanControl(0, sim.match.taker ?? pivot);
    this.broadcast = new BroadcastCamera(this.view.camera);
    this.hud = new Hud(hudRoot, HINT);
    this.playerMeshes = sim.players.map((p) => {
      const team = TEAMS[p.team];
      const mesh = p.keeper ? new KeeperMesh(team.keeperShirt, team.shorts) : createPlayerMesh(team.shirt, team.shorts);
      this.view.scene.add(mesh);
      return mesh;
    });
    this.marker = createMarker();
    this.view.scene.add(this.marker);
    this.debug = options.debug ? new DebugOverlay(this.view.scene, hudRoot, this.view.camera) : null;
    this.stats = options.stats ? new StatsOverlay(hudRoot) : null;
  }

  /** The player the keyboard drives right now, or null (AI vs AI). */
  private get controlled(): number | null {
    return this.control?.controlled ?? null;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    // Clamped both ways: a long stall (tab hidden) shouldn't fast-forward, and a timestamp
    // from before the last frame shouldn't run time backwards.
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.25);
    this.last = now;
    this.accumulator += dt * this.options.timescale;

    const raw = this.keyboard.command();
    let shotPower: number | null = null;
    let stepped = false;
    while (this.accumulator >= PHYSICS_STEP) {
      const commands: Command[] = [];
      if (this.control) commands[this.control.controlled] = this.control.command(this.sim, raw);
      const events = this.sim.step(commands);
      this.control?.afterStep(this.sim, events);
      for (const e of events) {
        if (e.type === 'kick' && e.kind === 'shoot' && e.player === this.controlled) shotPower = e.power;
        this.onEvent(e);
      }
      this.accumulator -= PHYSICS_STEP;
      stepped = true;
    }
    // Taps that a step has now seen can be forgotten; on a frame with no step, keep them.
    if (stepped) this.keyboard.clearTaps();

    const { sim, view } = this;
    const controlled = this.controlled;
    interpolate(sim.prev, sim.curr, this.accumulator / PHYSICS_STEP, view.ball, this.playerMeshes);
    const me = controlled === null ? null : this.playerMeshes[controlled];
    this.marker.visible = me !== null;
    if (me) this.marker.position.set(me.position.x, 0.02, me.position.z);
    // With nobody to follow, the camera follows the ball.
    this.broadcast.update(me?.position ?? view.ball.position, view.ball.position, dt);
    this.hud.update(controlled === null ? null : sim.players[controlled], dt, shotPower);
    this.hud.setClock(sim.match.clock.half, TUNING.match.halfLength - sim.match.clock.elapsed);
    this.debug?.update(sim, this.playerMeshes, controlled);

    view.renderer.render(view.scene, view.camera);
    this.stats?.update(view.renderer, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** React to what happened in the simulation (status text now; sound and animation later). */
  private onEvent(e: SimEvent): void {
    if (e.type === 'kick') this.debug?.showPath(e.path);
    switch (e.type) {
      case 'goal':
        this.hud.setScore(e.score[0], e.score[1]);
        this.hud.flash('GOAL!', TUNING.match.goalDelay);
        break;
      case 'shot':
        // Arrives after the goal event for the same shot, so "GOAL! In off the post" wins.
        this.hud.flash(describeOutcome(e.outcome), e.outcome.kind === 'goal' ? TUNING.match.goalDelay : 2);
        break;
      case 'out':
        this.hud.flash(e.restart.kind === 'kickIn' ? 'Over the netting · Kick-in' : 'Over the netting · Goal clearance', TUNING.match.outDelay);
        break;
      case 'restart':
        this.hud.flash(RESTART_NAMES[e.restart.kind], 1.5);
        break;
      case 'tackle':
        // Only your own tackles: the AI's are plain to see.
        if (e.player === this.controlled) this.hud.flash(TACKLE_NAMES[e.outcome], 0.8);
        break;
      case 'halfTime':
        this.hud.flash(`Half time · ${scoreLine(e.score)}`, TUNING.match.halfTimePause);
        break;
      case 'fullTime':
        this.hud.flash(`Full time · ${scoreLine(e.score)}`, Infinity);
        break;
    }
  }
}

function scoreLine(score: [number, number]): string {
  return `${TEAMS[0].short} ${score[0]} – ${score[1]} ${TEAMS[1].short}`;
}
