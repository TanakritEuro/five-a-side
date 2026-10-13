import type * as THREE from 'three';
import { describeOutcome } from './ball/outcome';
import { Director } from './camera/director';
import { TUNING, type LevelName } from './config';
import { PHYSICS_STEP } from './constants';
import { DebugOverlay, StatsOverlay } from './debug';
import { Keyboard } from './input/keyboard';
import { Gamepads, mergeCommands, type PadUi } from './input/gamepad';
import { isTouchDevice, TouchControls } from './ui/touch';
import { Footballer, KeeperFigure, kitFor, type Figure } from './characters/footballer';
import { loadFigure, type FigureTemplate } from './characters/skinned';
import { interpolate, type PlayerView } from './render/interpolate';
import { createMarker, createScene, type GameScene } from './scene';
import { IDLE, type Command } from './sim/command';
import type { SimEvent } from './sim/events';
import type { TackleOutcome } from './sim/tackle';
import type { RestartKind } from './sim/rules';
import { HumanControl } from './sim/control';
import { Sim } from './sim/sim';
import type { Role } from './team/formation';
import { fullLineup } from './team/lineup';
import { matchKits, TEAMS, type Team } from './team/teams';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { FullTimeScreen } from './ui/fulltime';
import { Nets } from './net';
import { BallTrail } from './trail';
import { Recorder, type Clip } from './replay/recorder';
import { Replay } from './replay/replay';
import { cues, excitement } from './audio/cues';
import { Sound } from './audio/sound';
import { MatchStats } from './match/matchstats';
import { Session, type MatchResult, type MatchSetup } from './match/session';
import { Stats } from './match/stats';

/** Straight into a match, skipping the menu (the dev flags: `?aivsai`, `?difficulty`, `?seed`). */
export interface QuickStart {
  aiVsAi: boolean;
  difficulty: LevelName;
  seed: number;
}

export interface GameOptions {
  /** Game-time multiplier (debug: `?timescale=0.25`). */
  timescale: number;
  /** `?debug`: AI states, support spots, pass lanes, chase points; rings and a readout for your player. */
  debug: boolean;
  /** `?stats`: fps, draw calls and triangles. */
  stats: boolean;
  /** Skip the menu; null to start at it. */
  quick: QuickStart | null;
}

const HINT = 'WASD: move · Shift: sprint · J: pass / switch · K: shoot (hold) / tackle · L: call a press · Esc: pause';
const RESTART_NAMES: Record<RestartKind, string> = {
  kickoff: 'Kick-off',
  kickIn: 'Kick-in',
  goalClearance: 'Goal clearance',
  freeKick: 'Free kick',
  penalty: 'Penalty',
  shootout: 'Penalty shootout',
};
const TACKLE_NAMES: Record<TackleOutcome, string> = { won: 'Won it!', missed: 'Missed', foul: 'Foul' };
const ROLE_NAMES: Record<Role, string> = { keeper: 'keeper', defender: 'defender', left: 'left wing', right: 'right wing', pivot: 'pivot' };

/** One match being shown: its simulation and everything drawn or counted for it. */
interface MatchRun {
  setup: MatchSetup;
  sim: Sim;
  /** Who the keyboard drives, or null (AI v AI). */
  control: HumanControl | null;
  /** The AI match behind the start menu: no sound, replays or HUD. */
  background: boolean;
  figures: Figure[];
  recorder: Recorder;
  stats: MatchStats;
  /** A goal whose replay is waiting for the live cuts to finish: game seconds left, and the clip's details. */
  pendingReplay: { wait: number; tick: number; team: 0 | 1; end: 1 | -1; caption: string } | null;
  /** Every goal's clip, for the highlights. */
  highlights: Clip[];
  /** Real seconds since full time (null before it), and whether the highlights have been offered yet. */
  sinceFullTime: number | null;
  highlightsShown: boolean;
}

type State = 'menu' | 'playing' | 'paused' | 'fullTime';

/**
 * Wires everything together: the menus, the session (friendly or cup), and for each match
 * keyboard → commands → fixed simulation steps, then an interpolated render of the latest
 * two steps, with the camera director, replays, sound and HUD. Reads the simulation, never
 * writes it except through commands.
 */
export class Game {
  private readonly view: GameScene;
  private readonly director: Director;
  private readonly keyboard = new Keyboard();
  private readonly gamepads = new Gamepads();
  /** This frame's gamepad command (read once a frame). */
  private padCommand: Command = IDLE;
  private readonly touch: TouchControls | null;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly fullTime: FullTimeScreen;
  /** Each player as drawn this frame. */
  private readonly views: PlayerView[] = [];
  private readonly marker: THREE.Object3D;
  private readonly debug: DebugOverlay | null;
  private readonly fps: StatsOverlay | null;
  private readonly nets = new Nets();
  private readonly trail = new BallTrail();
  private readonly replay = new Replay();
  private readonly sound = new Sound();
  private readonly record = new Stats();
  private accumulator = 0;
  private last = 0;
  private state: State = 'menu';
  private run: MatchRun | null = null;
  private session: Session | null = null;
  /** Starting a match is asynchronous (physics); ignore input meanwhile. */
  private starting = false;

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, options: GameOptions): Promise<Game> {
    // Quaternius' Mannequin (CC0, see ASSETS.md); the rig's own capsule figures stand in if it fails to load.
    const template = await loadFigure(`${import.meta.env.BASE_URL}models/mannequin.glb`);
    const game = new Game(canvas, hudRoot, options, template);
    const q = options.quick;
    if (q) {
      await game.startMatch(
        { teams: [TEAMS[0], TEAMS[1]], level: q.difficulty, halfLength: TUNING.match.halfLength, shootout: false, seed: q.seed, title: 'Friendly' },
        { human: !q.aiVsAi, background: false },
      );
    } else {
      await game.toMenu();
    }
    return game;
  }

  private constructor(
    canvas: HTMLCanvasElement,
    private readonly hudRoot: HTMLElement,
    private readonly options: GameOptions,
    private readonly template: FigureTemplate | null,
  ) {
    this.view = createScene(canvas);
    this.director = new Director(this.view.camera);
    // On a touch screen the on-screen buttons say what they do; the keyboard hint would only get in the way.
    const touch = isTouchDevice();
    if (touch) document.body.classList.add('touch-device');
    this.hud = new Hud(hudRoot, touch ? '' : HINT, [TEAMS[0].short, TEAMS[1].short]);
    this.menu = new Menu(document.body, {
      onPlay: (choice) => {
        this.session = new Session({ ...choice, seed: Math.floor(Math.random() * 1e9) });
        void this.startMatch(this.session.next(), { human: true, background: false });
      },
      onResume: () => this.resume(),
      onRestart: () => {
        if (this.run) void this.startMatch({ ...this.run.setup, seed: this.run.setup.seed + 1 }, { human: this.run.control !== null, background: false });
      },
      onQuit: () => void this.toMenu(),
      onSound: (muted) => this.sound.setMuted(muted),
      onResetStats: () => {
        this.record.reset();
        this.menu.showStart(this.record.summary);
      },
    }, this.sound.isMuted);
    this.fullTime = new FullTimeScreen(document.body, () => this.afterFullTime(), () => void this.toMenu());
    this.touch = touch ? new TouchControls(document.body, () => this.pauseGame()) : null;
    this.view.scene.add(this.nets.object, this.trail.object);
    this.marker = createMarker();
    this.view.scene.add(this.marker);
    this.debug = options.debug ? new DebugOverlay(this.view.scene, hudRoot, this.view.camera) : null;
    this.fps = options.stats ? new StatsOverlay(hudRoot) : null;

    // Keys for the game rather than the players: Esc pauses, C switches camera, R replays,
    // M mutes, and any key skips a replay.
    window.addEventListener('keydown', (e) => {
      // Browsers only allow audio after a key or a click.
      this.sound.unlock();
      if (e.repeat || this.starting) return;
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pauseGame();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'playing') return;
      if (this.replay.active) this.endReplay();
      else if (e.code === 'KeyC') this.director.toggleMode();
      else if (e.code === 'KeyR') this.replayNow();
      else if (e.code === 'KeyM') {
        this.sound.setMuted(!this.sound.isMuted);
        this.hud.flash(this.sound.isMuted ? 'Sound off' : 'Sound on', 1.2);
      }
    });
    for (const type of ['pointerdown', 'click', 'touchstart']) window.addEventListener(type, () => this.sound.unlock());
  }

  /** The simulation being shown (for `?debug` in the console). */
  get sim(): Sim | null {
    return this.run?.sim ?? null;
  }

  start(): void {
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Replace whatever is playing with a new match. */
  private async startMatch(setup: MatchSetup, how: { human: boolean; background: boolean }): Promise<void> {
    this.starting = true;
    const sim = await Sim.create({
      seed: setup.seed,
      players: fullLineup(setup.teams),
      ai: true,
      kickoff: true,
      levels: ['normal', setup.level],
      halfLength: setup.halfLength,
      shootout: setup.shootout,
    });
    this.endMatch();
    const kits = matchKits(setup.teams[0], setup.teams[1]);
    const figures = sim.players.map((p) => {
      const kit = kitFor(setup.teams[p.team], kits[p.team], p.id, p.keeper !== null);
      const figure: Figure = p.keeper ? new KeeperFigure(this.template, kit) : new Footballer(this.template, kit);
      this.view.scene.add(figure.object);
      return figure;
    });
    // You start on the home pivot, who takes the first kick-off.
    const pivot = sim.players.findIndex((p) => p.team === 0 && p.spec.role === 'pivot');
    this.run = {
      setup,
      sim,
      control: how.human ? new HumanControl(0, sim.match.taker ?? pivot) : null,
      background: how.background,
      figures,
      recorder: new Recorder(),
      stats: new MatchStats(),
      pendingReplay: null,
      highlights: [],
      sinceFullTime: null,
      highlightsShown: false,
    };
    this.hud.setTeams([setup.teams[0].short, setup.teams[1].short]);
    this.hud.setScore(0, 0);
    this.hud.flash(setup.title, 2.5);
    this.director.back();
    this.nets.clear();
    this.accumulator = 0;
    this.keyboard.clearTaps();
    this.starting = false;
    if (!how.background) {
      this.state = 'playing';
      this.menu.hide();
      this.fullTime.hide();
      this.hudRoot.classList.remove('hidden');
    }
  }

  /** Drop the match being shown. */
  private endMatch(): void {
    if (!this.run) return;
    for (const f of this.run.figures) f.dispose();
    this.replay.stop();
    this.hud.setReplay(null);
    this.run = null;
  }

  /** The start menu, with an AI match playing behind it. */
  private async toMenu(): Promise<void> {
    this.session = null;
    this.state = 'menu';
    this.fullTime.hide();
    this.hudRoot.classList.add('hidden');
    this.menu.showStart(this.record.summary);
    const [a, b] = pickTwo();
    await this.startMatch({ teams: [a, b], level: 'normal', halfLength: TUNING.match.halfLength, shootout: false, seed: Math.floor(Math.random() * 1e9), title: '' }, { human: false, background: true });
  }

  private pauseGame(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menu.showPause();
  }

  private resume(): void {
    this.state = 'playing';
    this.menu.hide();
    this.keyboard.clearTaps();
    this.last = performance.now();
  }

  private frame(now: number): void {
    // Clamped both ways: a long stall (tab hidden) shouldn't fast-forward, and a timestamp
    // from before the last frame shouldn't run time backwards.
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.25);
    this.last = now;
    const pad = this.gamepads.poll();
    this.padCommand = pad.command;
    this.padUi(pad.ui);
    this.touch?.setVisible(this.state === 'playing' && this.run?.control != null);
    const run = this.run;
    if (run) {
      if (this.replay.active) this.replayFrame(run, this.state === 'paused' ? 0 : dt);
      // Paused, or on the full-time screen: hold the picture.
      else this.liveFrame(run, this.state === 'paused' || this.state === 'fullTime' ? 0 : dt);
      this.checkFullTime(run, dt);
    }
    const { view } = this;
    view.renderer.render(view.scene, view.camera);
    this.fps?.update(view.renderer, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * The gamepad's game buttons: Start pauses and resumes, Y replays (or skips one), and A
   * presses the main button of whatever menu is open.
   */
  private padUi(ui: PadUi): void {
    if (ui.pause) {
      if (this.state === 'playing') this.pauseGame();
      else if (this.state === 'paused') this.resume();
    }
    if (ui.replay && this.state === 'playing') {
      if (this.replay.active) this.endReplay();
      else this.replayNow();
    }
    if (ui.confirm && this.state !== 'playing') {
      document.querySelector<HTMLButtonElement>('.menu-root:not(.hidden) .menu:not(.hidden) .menu-go')?.click();
    }
  }

  /** A frame of the match itself: step the simulation, draw between its last two steps. */
  private liveFrame(run: MatchRun, dt: number): void {
    const { sim, control } = run;
    this.accumulator += dt * this.options.timescale;
    const raw = mergeCommands(mergeCommands(this.keyboard.command(), this.touch?.command() ?? IDLE), this.padCommand);
    let shotPower: number | null = null;
    let stepped = false;
    while (this.accumulator >= PHYSICS_STEP) {
      const commands: Command[] = [];
      if (control) commands[control.controlled] = control.command(sim, raw);
      const events = sim.step(commands);
      control?.afterStep(sim, events);
      this.recordStep(run, events);
      for (const e of events) {
        if (e.type === 'kick' && e.kind === 'shoot' && e.player === control?.controlled) shotPower = e.power;
        this.onEvent(run, e);
      }
      this.accumulator -= PHYSICS_STEP;
      stepped = true;
    }
    // Taps that a step has now seen can be forgotten; on a frame with no step, keep them.
    if (stepped) {
      this.keyboard.clearTaps();
      this.touch?.clearTaps();
    }

    const { view } = this;
    const controlled = control?.controlled ?? null;
    const gameDt = dt * this.options.timescale;
    interpolate(sim.prev, sim.curr, this.accumulator / PHYSICS_STEP, view.ball, this.views);
    run.figures.forEach((f, i) => f.update(this.views[i], gameDt));
    this.nets.update(view.ball.position, gameDt);
    this.trail.update(view.ball.position, gameDt, view.camera.position);
    const me = controlled === null ? null : run.figures[controlled].object;
    this.marker.visible = me !== null;
    if (me) this.marker.position.set(me.position.x, 0.02, me.position.z);
    // With nobody to follow, the camera follows the ball.
    const team = control?.team ?? 0;
    this.director.update({ player: me?.position ?? null, ball: view.ball.position, attackDir: sim.attackDir(team) }, dt, gameDt);
    this.hud.update(controlled === null ? null : sim.players[controlled], dt, shotPower);
    if (sim.match.shootout) this.hud.setShootout(sim.match.shootout.goals);
    else this.hud.setClock(sim.match.clock.half, sim.match.halfLength - sim.match.clock.elapsed);
    this.debug?.update(sim, run.figures.map((f) => f.object), controlled);
    if (!run.background) this.sound.setExcitement(excitement(view.ball.position.x, sim.attackDir(team)));
    this.startReplays(run, gameDt);
  }

  /** A frame of a replay: the match stands still while recorded snapshots are drawn. */
  private replayFrame(run: MatchRun, dt: number): void {
    const R = TUNING.replay;
    const frame = this.replay.update(dt);
    if (!frame) {
      this.endReplay();
      this.liveFrame(run, 0);
      return;
    }
    const { view } = this;
    const gameDt = dt * (run.sim.match.over ? R.highlightSpeed : R.speed);
    if (frame.fresh) this.cutTo(run, frame.clip);
    interpolate(frame.prev, frame.curr, frame.alpha, view.ball, this.views);
    run.figures.forEach((f, i) => f.update(this.views[i], frame.fresh ? 0 : gameDt));
    this.nets.update(view.ball.position, gameDt);
    this.trail.update(view.ball.position, gameDt, view.camera.position);
    this.marker.visible = false;
    this.director.update({ player: null, ball: view.ball.position, attackDir: 1 }, dt, gameDt);
    this.hud.setReplay(this.replay.caption);
  }

  /** Start a clip's footage: fresh animation and nets, and the replay camera on its goal. */
  private cutTo(run: MatchRun, clip: Clip): void {
    for (const f of run.figures) f.reset();
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
    for (const f of this.run?.figures ?? []) f.reset();
    this.nets.clear();
    this.hud.setReplay(null);
    // Keys pressed to skip it mustn't reach the players.
    this.keyboard.clearTaps();
    this.accumulator = 0;
    if (this.run?.sim.match.over) this.director.fullTime();
    else this.director.back();
  }

  /** R: the last few seconds again (or, at full time, the highlights). */
  private replayNow(): void {
    const run = this.run;
    if (!run || run.background) return;
    if (run.sim.match.over && run.highlights.length > 0) {
      this.replay.play(run.highlights, TUNING.replay.highlightSpeed);
      return;
    }
    const clip = run.recorder.last(TUNING.replay.instant, 'Last play');
    if (clip) this.replay.play([clip], TUNING.replay.speed);
  }

  /** Remember this step for replays and the match stats. */
  private recordStep(run: MatchRun, events: readonly SimEvent[]): void {
    const { sim } = run;
    const holder = sim.handling.holder ?? sim.possession.owner;
    const owner = holder === null ? null : sim.players[holder].team;
    run.recorder.capture(sim.curr, owner);
    run.stats.step(events, sim.match.inPlay ? owner : null, (id) => sim.players[id].team, this.minute(sim));
  }

  /** The match minute now (1 in the first minute). */
  private minute(sim: Sim): number {
    const clock = sim.match.clock;
    return Math.floor(((clock.half - 1) * sim.match.halfLength + clock.elapsed) / 60) + 1;
  }

  /** Once a goal's live cuts are over, its replay. */
  private startReplays(run: MatchRun, gameDt: number): void {
    const p = run.pendingReplay;
    if (p && (p.wait -= gameDt) <= 0) {
      run.pendingReplay = null;
      const clip = run.recorder.goal(p.tick, p.team, p.end, p.caption);
      if (clip) {
        run.highlights.push(clip);
        this.replay.play([clip], TUNING.replay.speed);
      }
    }
  }

  /** After full time: the highlights, then the full-time screen. */
  private checkFullTime(run: MatchRun, dt: number): void {
    if (run.sinceFullTime === null || this.state !== 'playing') return;
    run.sinceFullTime += dt;
    if (run.sinceFullTime < 2.5 || this.replay.active) return;
    if (!run.highlightsShown) {
      run.highlightsShown = true;
      if (run.highlights.length > 0) {
        this.replay.play(run.highlights, TUNING.replay.highlightSpeed);
        return;
      }
    }
    this.showFullTime(run);
  }

  private showFullTime(run: MatchRun): void {
    this.state = 'fullTime';
    const m = run.sim.match;
    const result: MatchResult = { score: [m.score[0], m.score[1]], shootout: m.shootout ? [m.shootout.goals[0], m.shootout.goals[1]] : undefined };
    let message = '';
    let next = 'Menu';
    let menu = false;
    const session = this.session;
    if (session && run.control) {
      const o = session.finish(result);
      this.record.record(result, o);
      if (session.choice.mode === 'friendly') {
        message = o === 'won' ? 'You won!' : o === 'lost' ? 'You lost.' : 'A draw.';
        next = 'Play again';
        menu = true;
      } else if (session.wonCup) {
        this.record.recordCup();
        message = 'Cup winners!';
      } else if (session.finished) {
        message = 'Knocked out of the cup.';
      } else {
        message = `Through to the ${session.next().title.replace('Cup · ', '').toLowerCase()}!`;
        next = 'Next round';
        menu = true;
      }
    }
    this.fullTime.show({
      title: run.setup.title,
      teams: run.setup.teams,
      score: result.score,
      shootout: result.shootout,
      stats: run.stats,
      scorerName: (id) => ROLE_NAMES[run.sim.players[id].spec.role],
      message,
      next,
      menu,
    });
  }

  /** The full-time screen's main button. */
  private afterFullTime(): void {
    const s = this.session;
    if (s && !s.finished) void this.startMatch(s.next(), { human: true, background: false });
    else void this.toMenu();
  }

  /** "RIV 2 – 1 NGC". */
  private scoreLine(run: MatchRun, score: readonly [number, number]): string {
    const [a, b] = run.setup.teams;
    return `${a.short} ${score[0]} – ${score[1]} ${b.short}`;
  }

  /** React to what happened in the simulation: sound, camera, replays and the HUD. */
  private onEvent(run: MatchRun, e: SimEvent): void {
    const { sim } = run;
    if (e.type === 'kick') this.debug?.showPath(e.path);
    if (run.background) {
      // Behind the menu: just keep the cameras sensible.
      if (e.type === 'restart') this.director.back();
      if (e.type === 'fullTime') void this.toMenu();
      return;
    }
    const v = sim.ball.linvel();
    const context = { teamOf: (id: number) => sim.players[id].team, home: run.control?.team ?? 0, ballSpeed: Math.hypot(v.x, v.y, v.z) };
    for (const s of cues(e, context)) this.sound.play(s);
    const teams = run.setup.teams;
    switch (e.type) {
      case 'goal': {
        this.hud.setScore(e.score[0], e.score[1]);
        const scorer = e.scorer;
        this.director.goal(e.end, scorer === null ? null : () => run.figures[scorer].object.position);
        const who = scorer === null ? 'own goal' : `${teams[sim.players[scorer].team].short} ${ROLE_NAMES[sim.players[scorer].spec.role]}`;
        run.pendingReplay = { wait: TUNING.replay.delay, tick: sim.curr.tick, team: e.team, end: e.end, caption: `${this.scoreLine(run, e.score)} · ${who}, ${this.minute(sim)}′` };
        this.hud.flash('GOAL!', TUNING.match.goalDelay);
        break;
      }
      case 'woodwork':
        this.director.shake(Math.hypot(v.x, v.y, v.z));
        break;
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
        if (e.player === run.control?.controlled && e.outcome !== 'foul') this.hud.flash(TACKLE_NAMES[e.outcome], 0.8);
        break;
      case 'halfTime':
        this.hud.flash(`Half time · ${this.scoreLine(run, e.score)}`, TUNING.match.halfTimePause);
        break;
      case 'fullTime': {
        this.director.fullTime();
        run.sinceFullTime = 0;
        const pens = e.shootout ? ` · ${teams[e.shootout[0] > e.shootout[1] ? 0 : 1].short} win ${Math.max(...e.shootout)}–${Math.min(...e.shootout)} on penalties` : '';
        this.hud.flash(`Full time · ${this.scoreLine(run, e.score)}${pens}`, Infinity);
        break;
      }
      case 'shootoutStart':
        this.hud.flash(`Full time · ${this.scoreLine(run, e.score)} · Penalties!`, TUNING.match.shootoutDelay);
        break;
      case 'shootoutKick':
        this.hud.flash(`${teams[e.team].short} ${e.scored ? 'scores' : 'misses'} · ${e.tally[0]}–${e.tally[1]}`, TUNING.match.shootoutDelay);
        break;
    }
  }
}

/** Two different teams at random, for the match behind the menu. */
function pickTwo(): [Team, Team] {
  const a = Math.floor(Math.random() * TEAMS.length);
  const b = (a + 1 + Math.floor(Math.random() * (TEAMS.length - 1))) % TEAMS.length;
  return [TEAMS[a], TEAMS[b]];
}

