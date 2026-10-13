import type * as THREE from 'three';
import { describeOutcome } from './ball/outcome';
import { Director } from './camera/director';
import { TUNING, type LevelName } from './config';
import { PHYSICS_STEP } from './constants';
import { DebugOverlay, StatsOverlay } from './debug';
import { Keyboard } from './input/keyboard';
import { Footballer, KeeperFigure, kitFor, type Figure } from './characters/footballer';
import { loadFigure, type FigureTemplate } from './characters/skinned';
import { interpolate, type PlayerView } from './render/interpolate';
import { createMarker, createScene, type GameScene } from './scene';
import type { Command } from './sim/command';
import type { SimEvent } from './sim/events';
import type { TackleOutcome } from './sim/tackle';
import type { RestartKind } from './sim/rules';
import { HumanControl } from './sim/control';
import { Sim } from './sim/sim';
import type { Role } from './team/formation';
import { fullLineup } from './team/lineup';
import { TEAMS } from './team/teams';
import { Hud } from './ui/hud';
import { Nets } from './net';
import { BallTrail } from './trail';
import { Recorder, type Clip } from './replay/recorder';
import { Replay } from './replay/replay';

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

const HINT = 'WASD: move · Shift: sprint · J: pass / switch · K: shoot (hold) / tackle · L: call a press · C: camera · R: replay';
const RESTART_NAMES: Record<RestartKind, string> = {
  kickoff: 'Kick-off',
  kickIn: 'Kick-in',
  goalClearance: 'Goal clearance',
  freeKick: 'Free kick',
  penalty: 'Penalty',
};
const TACKLE_NAMES: Record<TackleOutcome, string> = { won: 'Won it!', missed: 'Missed', foul: 'Foul' };
const ROLE_NAMES: Record<Role, string> = { keeper: 'keeper', defender: 'defender', left: 'left wing', right: 'right wing', pivot: 'pivot' };

/**
 * Wires the simulation to the screen: keyboard → commands → fixed simulation steps, then
 * an interpolated render of the latest two steps. Reads the simulation, never writes it
 * except through commands.
 */
export class Game {
  private readonly view: GameScene;
  private readonly director: Director;
  private readonly keyboard = new Keyboard();
  private readonly hud: Hud;
  private readonly figures: Figure[];
  /** Each player as drawn this frame. */
  private readonly views: PlayerView[] = [];
  private readonly marker: THREE.Object3D;
  private readonly debug: DebugOverlay | null;
  private readonly stats: StatsOverlay | null;
  /** Who the keyboard drives (and switching), or null when nobody is (AI vs AI). */
  private readonly control: HumanControl | null;
  private accumulator = 0;
  private last = 0;
  private readonly nets = new Nets();
  private readonly trail = new BallTrail();
  private readonly recorder = new Recorder();
  private readonly replay = new Replay();
  /** A goal whose replay is waiting for the live cuts to finish: game seconds left, and the clip's details. */
  private pendingReplay: { wait: number; tick: number; team: 0 | 1; end: 1 | -1; caption: string } | null = null;
  /** Every goal's clip this match, for the highlights. */
  private readonly highlights: Clip[] = [];
  /** Game seconds until the full-time highlights start (null: not waiting). */
  private highlightsIn: number | null = null;

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, options: GameOptions): Promise<Game> {
    const sim = await Sim.create({
      seed: options.seed,
      players: fullLineup(),
      ai: true,
      kickoff: true,
      levels: ['normal', options.difficulty],
    });
    // Quaternius' Mannequin (CC0, see ASSETS.md); the rig's own capsule figures stand in if it fails to load.
    const template = await loadFigure(`${import.meta.env.BASE_URL}models/mannequin.glb`);
    return new Game(canvas, hudRoot, sim, options, template);
  }

  private constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    readonly sim: Sim,
    private readonly options: GameOptions,
    template: FigureTemplate | null,
  ) {
    this.view = createScene(canvas);
    // You start on the home pivot, who takes the first kick-off.
    const pivot = sim.players.findIndex((p) => p.team === 0 && p.spec.role === 'pivot');
    this.control = options.aiVsAi ? null : new HumanControl(0, sim.match.taker ?? pivot);
    this.director = new Director(this.view.camera);
    // Keys for the presentation rather than the players: C switches camera, R replays, and
    // any key skips a replay.
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.replay.active) this.endReplay();
      else if (e.code === 'KeyC') this.director.toggleMode();
      else if (e.code === 'KeyR') this.replayNow();
    });
    this.view.scene.add(this.nets.object, this.trail.object);
    this.hud = new Hud(hudRoot, HINT);
    this.figures = sim.players.map((p) => {
      const kit = kitFor(TEAMS[p.team], p.id, p.keeper !== null);
      const figure = p.keeper ? new KeeperFigure(template, kit) : new Footballer(template, kit);
      this.view.scene.add(figure.object);
      return figure;
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
    if (this.replay.active) this.replayFrame(dt);
    else this.liveFrame(dt);
    const { view } = this;
    view.renderer.render(view.scene, view.camera);
    this.stats?.update(view.renderer, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** A frame of the match itself: step the simulation, draw between its last two steps. */
  private liveFrame(dt: number): void {
    this.accumulator += dt * this.options.timescale;

    const raw = this.keyboard.command();
    let shotPower: number | null = null;
    let stepped = false;
    while (this.accumulator >= PHYSICS_STEP) {
      const commands: Command[] = [];
      if (this.control) commands[this.control.controlled] = this.control.command(this.sim, raw);
      const events = this.sim.step(commands);
      this.control?.afterStep(this.sim, events);
      this.recordStep();
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
    const gameDt = dt * this.options.timescale;
    interpolate(sim.prev, sim.curr, this.accumulator / PHYSICS_STEP, view.ball, this.views);
    this.figures.forEach((f, i) => f.update(this.views[i], gameDt));
    this.nets.update(view.ball.position, gameDt);
    this.trail.update(view.ball.position, gameDt, view.camera.position);
    const me = controlled === null ? null : this.figures[controlled].object;
    this.marker.visible = me !== null;
    if (me) this.marker.position.set(me.position.x, 0.02, me.position.z);
    // With nobody to follow, the camera follows the ball.
    const team = this.control?.team ?? 0;
    this.director.update({ player: me?.position ?? null, ball: view.ball.position, attackDir: sim.attackDir(team) }, dt, dt * this.options.timescale);
    this.hud.update(controlled === null ? null : sim.players[controlled], dt, shotPower);
    this.hud.setClock(sim.match.clock.half, TUNING.match.halfLength - sim.match.clock.elapsed);
    this.debug?.update(sim, this.figures.map((f) => f.object), controlled);
    this.startReplays(gameDt);
  }

  /** A frame of a replay: the match stands still while recorded snapshots are drawn. */
  private replayFrame(dt: number): void {
    const R = TUNING.replay;
    const frame = this.replay.update(dt);
    if (!frame) {
      this.endReplay();
      this.liveFrame(0);
      return;
    }
    const { view } = this;
    const gameDt = dt * (this.sim.match.over ? R.highlightSpeed : R.speed);
    if (frame.fresh) this.cutTo(frame.clip);
    interpolate(frame.prev, frame.curr, frame.alpha, view.ball, this.views);
    this.figures.forEach((f, i) => f.update(this.views[i], frame.fresh ? 0 : gameDt));
    this.nets.update(view.ball.position, gameDt);
    this.trail.update(view.ball.position, gameDt, view.camera.position);
    this.marker.visible = false;
    this.director.update({ player: null, ball: view.ball.position, attackDir: 1 }, dt, gameDt);
    this.hud.setReplay(this.replay.caption);
  }

  /** Start a clip's footage: fresh animation and nets, and the replay camera on its goal. */
  private cutTo(clip: Clip): void {
    for (const f of this.figures) f.reset();
    this.nets.clear();
    if (clip.end === 0) {
      this.director.back();
    } else {
      // Behind the goal for a goal through the middle, the reverse angle for one in a corner.
      const last = clip.frames[clip.frames.length - 1].ball.pos;
      this.director.replay(clip.end, Math.abs(last.z) < 0.8 ? 'behind' : 'reverse');
    }
  }

  private endReplay(): void {
    this.replay.stop();
    for (const f of this.figures) f.reset();
    this.nets.clear();
    this.hud.setReplay(null);
    // Keys pressed to skip it mustn't reach the players.
    this.keyboard.clearTaps();
    this.accumulator = 0;
    if (this.sim.match.over) this.director.fullTime();
    else this.director.back();
  }

  /** R: the last few seconds again (or, at full time, the highlights). */
  private replayNow(): void {
    if (this.sim.match.over && this.highlights.length > 0) {
      this.replay.play(this.highlights, TUNING.replay.highlightSpeed);
      return;
    }
    const clip = this.recorder.last(TUNING.replay.instant, 'Last play');
    if (clip) this.replay.play([clip], TUNING.replay.speed);
  }

  /** Remember this step for replays. */
  private recordStep(): void {
    const { sim } = this;
    const owner = sim.handling.holder ?? sim.possession.owner;
    this.recorder.capture(sim.curr, owner === null ? null : sim.players[owner].team);
  }

  /** Once a goal's live cuts are over, its replay; at full time, the highlights. */
  private startReplays(gameDt: number): void {
    const p = this.pendingReplay;
    if (p && (p.wait -= gameDt) <= 0) {
      this.pendingReplay = null;
      const clip = this.recorder.goal(p.tick, p.team, p.end, p.caption);
      if (clip) {
        this.highlights.push(clip);
        this.replay.play([clip], TUNING.replay.speed);
      }
    }
    if (this.highlightsIn !== null && (this.highlightsIn -= gameDt) <= 0) {
      this.highlightsIn = null;
      if (this.highlights.length > 0) this.replay.play(this.highlights, TUNING.replay.highlightSpeed);
    }
  }

  /** React to what happened in the simulation (status text now; sound and animation later). */
  private onEvent(e: SimEvent): void {
    if (e.type === 'kick') this.debug?.showPath(e.path);
    switch (e.type) {
      case 'goal': {
        this.hud.setScore(e.score[0], e.score[1]);
        const scorer = e.scorer;
        this.director.goal(e.end, scorer === null ? null : () => this.figures[scorer].object.position);
        const clock = this.sim.match.clock;
        const minute = Math.floor(((clock.half - 1) * TUNING.match.halfLength + clock.elapsed) / 60) + 1;
        const who = scorer === null ? 'own goal' : `${TEAMS[this.sim.players[scorer].team].short} ${ROLE_NAMES[this.sim.players[scorer].spec.role]}`;
        this.pendingReplay = { wait: TUNING.replay.delay, tick: this.sim.curr.tick, team: e.team, end: e.end, caption: `${scoreLine(e.score)} · ${who}, ${minute}′` };
        this.hud.flash('GOAL!', TUNING.match.goalDelay);
        break;
      }
      case 'woodwork': {
        const v = this.sim.ball.linvel();
        this.director.shake(Math.hypot(v.x, v.y, v.z));
        break;
      }
      case 'shot':
        // Arrives after the goal event for the same shot, so "GOAL! In off the post" wins.
        this.hud.flash(describeOutcome(e.outcome), e.outcome.kind === 'goal' ? TUNING.match.goalDelay : 2);
        break;
      case 'out':
        this.hud.flash(e.restart.kind === 'kickIn' ? 'Over the netting · Kick-in' : 'Over the netting · Goal clearance', TUNING.match.outDelay);
        break;
      case 'restart':
        this.director.back();
        this.hud.flash(RESTART_NAMES[e.restart.kind], 1.5);
        break;
      case 'foul':
        this.hud.flash(e.restart.kind === 'penalty' ? 'Foul! · Penalty' : 'Foul! · Free kick', TUNING.match.foulDelay);
        break;
      case 'tackle':
        // Only your own tackles: the AI's are plain to see.
        if (e.player === this.controlled && e.outcome !== 'foul') this.hud.flash(TACKLE_NAMES[e.outcome], 0.8);
        break;
      case 'halfTime':
        this.hud.flash(`Half time · ${scoreLine(e.score)}`, TUNING.match.halfTimePause);
        break;
      case 'fullTime':
        this.director.fullTime();
        this.highlightsIn = 2.5;
        this.hud.flash(`Full time · ${scoreLine(e.score)}`, Infinity);
        break;
    }
  }
}

function scoreLine(score: [number, number]): string {
  return `${TEAMS[0].short} ${score[0]} – ${score[1]} ${TEAMS[1].short}`;
}
