import { TUNING } from '../config';
import { chargePower } from '../sim/kick';
import type { Player } from '../sim/player';

/** Heads-up display: score, a status line, the shot power meter and a stamina bar. */
export class Hud {
  private readonly scoreboard: HTMLElement;
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly status: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly stamina: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly replay: HTMLElement;
  private statusUntil = 0;
  private readonly hint: string;
  /** Seconds the meter stays up after a shot, showing the power it was struck at. */
  private meterHold = 0;

  constructor(
    root: HTMLElement,
    hint: string,
    /** The teams' short names, home first. */
    private names: readonly [string, string],
  ) {
    this.hint = hint;
    this.scoreboard = el(root, 'div', 'scoreboard');
    this.score = el(this.scoreboard, 'span', 'score');
    this.clock = el(this.scoreboard, 'span', 'clock');
    this.status = el(root, 'div', 'status');
    this.replay = el(root, 'div', 'replay');
    this.replay.classList.add('hidden');
    const panel = el(root, 'div', 'panel');
    this.panel = panel;
    this.meter = el(panel, 'div', 'meter');
    const S = TUNING.shot;
    const band = el(this.meter, 'div', 'meter-sweet');
    band.style.left = `${S.sweetSpot * 100}%`;
    band.style.width = `${(S.overpowerThreshold - S.sweetSpot) * 100}%`;
    const over = el(this.meter, 'div', 'meter-over');
    over.style.left = `${S.overpowerThreshold * 100}%`;
    this.meterFill = el(this.meter, 'div', 'meter-fill');
    const staminaBar = el(panel, 'div', 'stamina');
    this.stamina = el(staminaBar, 'div', 'stamina-fill');
    this.setScore(0, 0);
    this.status.textContent = hint;
  }

  setScore(home: number, away: number): void {
    this.score.textContent = `${this.names[0]} ${home} – ${away} ${this.names[1]}`;
  }

  /** Game time left in the half, counting down, e.g. "1H 2:41". */
  setClock(half: 1 | 2, remaining: number): void {
    const s = Math.max(0, Math.ceil(remaining));
    this.clock.textContent = `${half}H ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  setTeams(names: readonly [string, string]): void {
    this.names = names;
  }

  /** The replay banner: its caption, or null to hide it. */
  setReplay(caption: string | null): void {
    this.replay.classList.toggle('hidden', caption === null);
    this.replay.textContent = caption === null ? '' : caption ? `REPLAY · ${caption}` : 'REPLAY';
    this.panel.classList.toggle('hidden', caption !== null);
    this.status.classList.toggle('hidden', caption !== null);
  }

  /** In a shootout the clock gives way to its tally. */
  setShootout(goals: readonly [number, number]): void {
    this.clock.textContent = `PENS ${goals[0]}–${goals[1]}`;
  }

  /** Show `text` for `seconds`, then go back to the controls hint. */
  flash(text: string, seconds = 2.5): void {
    this.status.textContent = text;
    this.statusUntil = performance.now() + seconds * 1000;
  }

  /**
   * Call once per frame with the controlled player (null when nobody is controlled).
   * `shotPower` is set on the frame a shot is struck.
   */
  update(p: Player | null, dt: number, shotPower: number | null): void {
    if (this.statusUntil && performance.now() > this.statusUntil) {
      this.statusUntil = 0;
      this.status.textContent = this.hint;
    }

    this.panel.classList.toggle('hidden', p === null);
    if (!p) return;
    const charging = p.charge?.kind === 'shoot';
    if (shotPower !== null) {
      this.meterHold = 0.8;
      this.setMeter(shotPower);
    } else if (charging) {
      this.meterHold = 0;
      this.setMeter(chargePower(p));
    } else {
      this.meterHold = Math.max(0, this.meterHold - dt);
    }
    this.meter.classList.toggle('visible', charging || this.meterHold > 0);
    this.stamina.style.width = `${p.stamina * 100}%`;
    this.stamina.classList.toggle('low', p.stamina < TUNING.stamina.tiredThreshold);
  }

  private setMeter(power: number): void {
    this.meterFill.style.width = `${power * 100}%`;
    this.meterFill.classList.toggle('over', power > TUNING.shot.overpowerThreshold);
  }
}

function el(parent: HTMLElement, tag: string, id: string): HTMLElement {
  const e = document.createElement(tag);
  e.id = id;
  parent.appendChild(e);
  return e;
}
