import type * as THREE from 'three';
import { describeOutcome } from './ball/outcome';
import { BroadcastCamera } from './camera';
import { TUNING } from './config';
import { PHYSICS_STEP } from './constants';
import { DebugOverlay, StatsOverlay } from './debug';
import { Keyboard } from './input/keyboard';
import { interpolate } from './render/interpolate';
import { createMarker, createPlayerMesh, createScene, type GameScene } from './scene';
import type { Command } from './sim/command';
import type { SimEvent } from './sim/events';
import type { RestartKind } from './sim/rules';
import { Sim } from './sim/sim';
import { soloLineup } from './team/lineup';
import { TEAMS } from './team/teams';
import { Hud } from './ui/hud';

export interface GameOptions {
  seed: number;
  /** Game-time multiplier (debug: `?timescale=0.25`). */
  timescale: number;
  /** `?debug`: reach and possession rings, kick paths, a state readout. */
  debug: boolean;
  /** `?stats`: fps, draw calls and triangles. */
  stats: boolean;
}

const HINT = 'WASD: move · Shift: sprint · J: pass · K (hold): shoot';
const RESTART_NAMES: Record<RestartKind, string> = { kickoff: 'Kick-off', kickIn: 'Kick-in', goalClearance: 'Goal clearance' };

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
  /** The player the keyboard drives. */
  private controlled = 0;
  private accumulator = 0;
  private last = 0;

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, options: GameOptions): Promise<Game> {
    const sim = await Sim.create({ seed: options.seed, players: soloLineup() });
    return new Game(canvas, hudRoot, sim, options);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    readonly sim: Sim,
    private readonly options: GameOptions,
  ) {
    this.view = createScene(canvas);
    this.broadcast = new BroadcastCamera(this.view.camera);
    this.hud = new Hud(hudRoot, HINT);
    this.playerMeshes = sim.players.map((p) => {
      const team = TEAMS[p.team];
      const mesh = createPlayerMesh(p.spec.role === 'keeper' ? team.keeperShirt : team.shirt, team.shorts);
      this.view.scene.add(mesh);
      return mesh;
    });
    this.marker = createMarker();
    this.view.scene.add(this.marker);
    this.debug = options.debug ? new DebugOverlay(this.view.scene, hudRoot) : null;
    this.stats = options.stats ? new StatsOverlay(hudRoot) : null;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.accumulator += dt * this.options.timescale;

    const commands: Command[] = [];
    commands[this.controlled] = this.keyboard.command();
    let shotPower: number | null = null;
    while (this.accumulator >= PHYSICS_STEP) {
      for (const e of this.sim.step(commands)) {
        if (e.type === 'kick' && e.kind === 'shoot' && e.player === this.controlled) shotPower = e.power;
        this.onEvent(e);
      }
      this.accumulator -= PHYSICS_STEP;
    }

    const { sim, view } = this;
    interpolate(sim.prev, sim.curr, this.accumulator / PHYSICS_STEP, view.ball, this.playerMeshes);
    const me = this.playerMeshes[this.controlled];
    this.marker.position.set(me.position.x, 0.02, me.position.z);
    this.broadcast.update(me.position, view.ball.position, dt);
    this.hud.update(sim.players[this.controlled], dt, shotPower);
    this.debug?.update(sim, this.controlled, me.position);

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
        this.hud.flash('GOAL!', TUNING.rules.goalDelay);
        break;
      case 'shot':
        // Arrives after the goal event for the same shot, so "GOAL! In off the post" wins.
        this.hud.flash(describeOutcome(e.outcome), e.outcome.kind === 'goal' ? TUNING.rules.goalDelay : 2);
        break;
      case 'out':
        this.hud.flash(e.restart.kind === 'kickIn' ? 'Over the netting · Kick-in' : 'Over the netting · Goal clearance', TUNING.rules.outDelay);
        break;
      case 'restart':
        this.hud.flash(RESTART_NAMES[e.restart.kind], TUNING.rules.restartFreeze + 0.4);
        break;
    }
  }
}
