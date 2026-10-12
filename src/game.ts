import type * as THREE from 'three';
import { BroadcastCamera } from './camera';
import { PHYSICS_STEP } from './constants';
import { Keyboard } from './input/keyboard';
import { interpolate } from './render/interpolate';
import { createMarker, createPlayerMesh, createScene, type GameScene } from './scene';
import type { Command } from './sim/command';
import { Sim } from './sim/sim';
import { soloLineup } from './team/lineup';
import { TEAMS } from './team/teams';

export interface GameOptions {
  seed: number;
  /** Game-time multiplier (debug: `?timescale=0.25`). */
  timescale: number;
}

export interface Hud {
  scoreboard: HTMLElement;
  status: HTMLElement;
}

/**
 * Wires the simulation to the screen: keyboard → commands → fixed simulation steps, then
 * an interpolated render of the latest two steps. Reads the simulation, never writes it
 * except through commands.
 */
export class Game {
  private readonly view: GameScene;
  private readonly broadcast: BroadcastCamera;
  private readonly keyboard = new Keyboard();
  private readonly playerMeshes: THREE.Object3D[];
  private readonly marker: THREE.Object3D;
  /** The player the keyboard drives. */
  private controlled = 0;
  private accumulator = 0;
  private last = 0;

  static async create(canvas: HTMLCanvasElement, hud: Hud, options: GameOptions): Promise<Game> {
    const sim = await Sim.create({ seed: options.seed, players: soloLineup() });
    return new Game(canvas, hud, sim, options);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    hud: Hud,
    readonly sim: Sim,
    private readonly options: GameOptions,
  ) {
    this.view = createScene(canvas);
    this.broadcast = new BroadcastCamera(this.view.camera);
    this.playerMeshes = sim.players.map((p) => {
      const team = TEAMS[p.team];
      const mesh = createPlayerMesh(p.spec.role === 'keeper' ? team.keeperShirt : team.shirt, team.shorts);
      this.view.scene.add(mesh);
      return mesh;
    });
    this.marker = createMarker();
    this.view.scene.add(this.marker);
    hud.scoreboard.textContent = `${TEAMS[0].short} 0 – 0 ${TEAMS[1].short}`;
    hud.status.textContent = 'WASD / arrows: move · Shift: sprint';
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
    while (this.accumulator >= PHYSICS_STEP) {
      this.sim.step(commands);
      this.accumulator -= PHYSICS_STEP;
    }

    const { sim, view } = this;
    interpolate(sim.prev, sim.curr, this.accumulator / PHYSICS_STEP, view.ball, this.playerMeshes);
    const me = this.playerMeshes[this.controlled];
    this.marker.position.set(me.position.x, 0.02, me.position.z);
    this.broadcast.update(me.position, view.ball.position, dt);

    view.renderer.render(view.scene, view.camera);
    requestAnimationFrame((t) => this.frame(t));
  }
}
