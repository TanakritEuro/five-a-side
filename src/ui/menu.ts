import type { LevelName } from '../config';
import type { Mode, SessionChoice } from '../match/session';
import { TEAMS, type Team } from '../team/teams';

export interface MenuEvents {
  /** Start a friendly or a cup run with these choices. */
  onPlay: (choice: Omit<SessionChoice, 'seed'>) => void;
  /** Close the pause menu and carry on. */
  onResume: () => void;
  /** Start the match in progress again from the kick-off. */
  onRestart: () => void;
  /** Leave the match for the start menu. */
  onQuit: () => void;
  onSound: (muted: boolean) => void;
  onResetStats: () => void;
  /** Online: open a room for an opponent to join, as `team`, with halves of `halfLength`. */
  onHost: (team: Team, halfLength: number) => void;
  /** Online: join the room with this code, as `team`. */
  onJoin: (code: string, team: Team) => void;
  /** Online: stop waiting or connecting. */
  onCancelOnline: () => void;
}

/** Where the online row is up to. */
export type OnlineState = { kind: 'idle'; message?: string } | { kind: 'hosting'; code: string } | { kind: 'joining' };

const MODES: readonly { mode: Mode; label: string; help: string }[] = [
  { mode: 'friendly', label: 'Friendly', help: 'One match against the team and level you choose.' },
  { mode: 'cup', label: 'Cup', help: 'Quarter-final, semi-final and final against drawn opponents, each sharper than the last. Draws go to penalties; lose once and you are out.' },
];
const LEVELS: readonly LevelName[] = ['easy', 'normal', 'hard'];
const HALVES: readonly { seconds: number; label: string }[] = [
  { seconds: 120, label: '2 min' },
  { seconds: 180, label: '3 min' },
  { seconds: 300, label: '5 min' },
];
const CONTROLS =
  'WASD move · Shift sprint · J pass / switch · K shoot (hold) / tackle · L call a press · C camera · R replay · M mute · Esc pause';

/**
 * The start menu (mode, your team, the opposition, difficulty, half length, sound, your
 * record) and the pause menu (resume, restart, quit). Plain DOM over the canvas.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly start: HTMLElement;
  private readonly pause: HTMLElement;
  private mode: Mode = 'friendly';
  private team: Team = TEAMS[0];
  private opponent: Team = TEAMS[1];
  private level: LevelName = 'normal';
  private halfLength = 180;
  private muted: boolean;
  private readonly refresh: (() => void)[] = [];
  private readonly statsLine: HTMLElement;
  private readonly message: HTMLElement;
  private online: OnlineState = { kind: 'idle' };
  private readonly restart: HTMLButtonElement;

  constructor(parent: HTMLElement, private readonly events: MenuEvents, muted: boolean) {
    this.muted = muted;
    this.root = div(parent, 'menu-root hidden');
    this.start = div(this.root, 'menu');
    this.pause = div(this.root, 'menu hidden');

    div(this.start, 'menu-title', 'FIVE-A-SIDE');
    const modeRow = this.row(this.start, '');
    const help = div(this.start, 'menu-help');
    for (const m of MODES) {
      this.choice(modeRow, m.label, () => this.mode === m.mode, () => (this.mode = m.mode));
    }
    this.refresh.push(() => (help.textContent = MODES.find((m) => m.mode === this.mode)!.help));

    const teamRow = this.row(this.start, 'Your team');
    for (const t of TEAMS) this.teamChoice(teamRow, t, () => this.team === t, () => {
      this.team = t;
      if (this.opponent === t) this.opponent = TEAMS.find((o) => o !== t)!;
    });
    const oppRow = this.row(this.start, 'Opponent');
    for (const t of TEAMS) {
      const b = this.teamChoice(oppRow, t, () => this.opponent === t, () => (this.opponent = t));
      this.refresh.push(() => (b.disabled = t === this.team));
    }
    const levelRow = this.row(this.start, 'Difficulty');
    for (const l of LEVELS) this.choice(levelRow, cap(l), () => this.level === l, () => (this.level = l));
    // The cup sets its own opponents and levels.
    this.refresh.push(() => {
      oppRow.parentElement!.classList.toggle('hidden', this.mode === 'cup');
      levelRow.parentElement!.classList.toggle('hidden', this.mode === 'cup');
    });
    const halfRow = this.row(this.start, 'Halves');
    for (const h of HALVES) this.choice(halfRow, h.label, () => this.halfLength === h.seconds, () => (this.halfLength = h.seconds));

    const go = button(this.start, 'Kick off', 'menu-go');
    go.addEventListener('click', () =>
      this.events.onPlay({ mode: this.mode, team: this.team, opponent: this.opponent, level: this.level, halfLength: this.halfLength }),
    );
    // Online: host a room (its code to share) or join one, as the team picked above.
    const onlineRow = this.row(this.start, 'Online');
    const host = button(onlineRow, 'Host');
    host.addEventListener('click', () => this.events.onHost(this.team, this.halfLength));
    const code = document.createElement('input');
    code.className = 'menu-code';
    code.placeholder = 'CODE';
    code.maxLength = 4;
    code.autocomplete = 'off';
    onlineRow.appendChild(code);
    const join = button(onlineRow, 'Join');
    join.addEventListener('click', () => this.events.onJoin(code.value, this.team));
    code.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a code isn't playing
      if (e.key === 'Enter') this.events.onJoin(code.value, this.team);
    });
    const cancel = button(onlineRow, 'Cancel');
    cancel.addEventListener('click', () => this.events.onCancelOnline());
    const onlineStatus = div(this.start, 'menu-help');
    this.refresh.push(() => {
      const o = this.online;
      const busy = o.kind !== 'idle';
      host.disabled = busy;
      join.disabled = busy;
      code.disabled = busy;
      go.disabled = busy;
      cancel.classList.toggle('hidden', !busy);
      onlineStatus.textContent =
        o.kind === 'hosting'
          ? `Room ${o.code}: give your opponent this code. Waiting for them to join…`
          : o.kind === 'joining'
            ? 'Joining…'
            : (o.message ?? 'Host a room and share its code, or join a friend\'s with theirs. You play the team picked above.');
    });
    const extras = div(this.start, 'menu-row');
    const sound = button(extras, '');
    this.refresh.push(() => (sound.textContent = this.muted ? 'Sound: off' : 'Sound: on'));
    sound.addEventListener('click', () => {
      this.muted = !this.muted;
      this.events.onSound(this.muted);
      this.update();
    });
    const reset = button(extras, 'Reset stats');
    reset.addEventListener('click', () => this.events.onResetStats());
    this.statsLine = div(this.start, 'menu-stats');
    this.message = div(this.start, 'fulltime-message hidden');
    div(this.start, 'menu-help', CONTROLS);

    div(this.pause, 'menu-title', 'Paused');
    const pauseRow = div(this.pause, 'menu-row');
    button(pauseRow, 'Resume', 'menu-go').addEventListener('click', () => this.events.onResume());
    this.restart = button(pauseRow, 'Restart match');
    this.restart.addEventListener('click', () => this.events.onRestart());
    button(pauseRow, 'Quit to menu').addEventListener('click', () => this.events.onQuit());
    div(this.pause, 'menu-help', CONTROLS);
    this.update();
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** The start menu, with your record, and a message if something needs saying (a dropped online match). */
  showStart(stats: string, message = ''): void {
    this.statsLine.textContent = stats;
    this.message.textContent = message;
    this.message.classList.toggle('hidden', message === '');
    this.show(this.start);
  }

  /** The pause menu; an online match can't be restarted. */
  showPause(online = false): void {
    this.restart.classList.toggle('hidden', online);
    this.show(this.pause);
  }

  setOnline(state: OnlineState): void {
    this.online = state;
    this.update();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private show(panel: HTMLElement): void {
    this.root.classList.remove('hidden');
    this.start.classList.toggle('hidden', panel !== this.start);
    this.pause.classList.toggle('hidden', panel !== this.pause);
    this.update();
  }

  private update(): void {
    for (const f of this.refresh) f();
  }

  /** A labelled row of choices. Returns the element the buttons go in. */
  private row(parent: HTMLElement, label: string): HTMLElement {
    const row = div(parent, 'menu-row');
    if (label) div(row, 'menu-label', label);
    return div(row, 'menu-choices');
  }

  private choice(parent: HTMLElement, label: string, selected: () => boolean, pick: () => void): HTMLButtonElement {
    const b = button(parent, label);
    b.addEventListener('click', () => {
      pick();
      this.update();
    });
    this.refresh.push(() => b.classList.toggle('selected', selected()));
    return b;
  }

  private teamChoice(parent: HTMLElement, team: Team, selected: () => boolean, pick: () => void): HTMLButtonElement {
    const b = this.choice(parent, team.short, selected, pick);
    b.title = team.name;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hex(team.kits[0].shirt);
    swatch.style.borderColor = hex(team.kits[0].shorts);
    b.prepend(swatch);
    return b;
  }
}

export function div(parent: HTMLElement, className: string, text = ''): HTMLElement {
  const e = document.createElement('div');
  e.className = className;
  e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function button(parent: HTMLElement, text: string, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = text;
  parent.appendChild(b);
  return b;
}

export function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
