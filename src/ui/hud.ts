import { TUNING } from '../config';
import { chargePower } from '../sim/kick';
import type { Player } from '../sim/player';
import { TEAMS } from '../team/teams';

/** Heads-up display: score, a status line, the shot power meter and a stamina bar. */
export class Hud {
  private readonly scoreboard: HTMLElement;
  private readonly status: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly stamina: HTMLElement;
  private statusUntil = 0;
  private readonly hint: string;
  /** Seconds the meter stays up after a shot, showing the power it was struck at. */
  private meterHold = 0;

  constructor(root: HTMLElement, hint: string) {
    this.hint = hint;
    this.scoreboard = el(root, 'div', 'scoreboard');
    this.status = el(root, 'div', 'status');
    const panel = el(root, 'div', 'panel');
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
    this.scoreboard.textContent = `${TEAMS[0].short} ${home} – ${away} ${TEAMS[1].short}`;
  }

  /** Show `text` for `seconds`, then go back to the controls hint. */
  flash(text: string, seconds = 2.5): void {
    this.status.textContent = text;
    this.statusUntil = performance.now() + seconds * 1000;
  }

  /** Call once per frame with the controlled player. `shotPower` is set on the frame a shot is struck. */
  update(p: Player, dt: number, shotPower: number | null): void {
    if (this.statusUntil && performance.now() > this.statusUntil) {
      this.statusUntil = 0;
      this.status.textContent = this.hint;
    }

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
