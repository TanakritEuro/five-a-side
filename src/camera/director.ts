import * as THREE from 'three';
import { TUNING } from '../config';
import { HALF_LENGTH, HALF_WIDTH } from '../constants';
import { damp, lerp, type Vec3 } from '../math';

export type CameraMode = 'broadcast' | 'action';

/** What the live cameras frame: the player you control (if any), the ball, and which way your team attacks. */
export interface Framing {
  player: Vec3 | null;
  ball: Vec3;
  attackDir: 1 | -1;
}

type Cut =
  /** After a goal: the net for a moment, then round the scorer (if there is one: not an own goal). */
  | { kind: 'goal'; end: 1 | -1; scorer: (() => Vec3) | null; t: number }
  /** Full time: the whole pitch. */
  | { kind: 'wide' }
  /** A replay, from behind the goal at `end` or low beside its line. */
  | { kind: 'replay'; end: 1 | -1; view: 'behind' | 'side' };

/**
 * Directs the cameras (ported in spirit from the penalty game's director):
 * - **broadcast** (the default): high on the +Z touchline, panning along the pitch with the
 *   play, right up to the end walls;
 * - **action** (C): lower and closer, behind the play in your team's direction of attack;
 * - **cuts:** after a goal, the net, then a camera circling the scorer; a wide shot at full
 *   time; the replay cameras. `back()` returns to the live camera;
 * - **shake** when the ball hits the woodwork.
 */
export class Director {
  mode: CameraMode = 'broadcast';
  private cut: Cut | null = null;
  /** The live cameras' smoothed position and look-at point. */
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private placed = false;
  private shaking = { angle: 0, t: 0 };

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  toggleMode(): void {
    this.mode = this.mode === 'broadcast' ? 'action' : 'broadcast';
    this.placed = false;
  }

  /** A goal in the net at `end`: cut to it, then to the scorer (`scorer` says where they are now). */
  goal(end: 1 | -1, scorer: (() => Vec3) | null): void {
    this.cut = { kind: 'goal', end, scorer, t: 0 };
  }

  fullTime(): void {
    this.cut = { kind: 'wide' };
  }

  replay(end: 1 | -1, view: 'behind' | 'side'): void {
    this.cut = { kind: 'replay', end, view };
  }

  /** Back to the live camera (a restart, or the end of a replay). */
  back(): void {
    this.cut = null;
    this.placed = false;
  }

  /** The ball hit the post or bar at `speed` (m/s): shake the camera. */
  shake(speed: number): void {
    const S = TUNING.director.shake;
    this.shaking.angle = Math.max(this.shaking.angle, S.angle * Math.min(1.5, speed / S.referenceSpeed));
    this.shaking.t = 0;
  }

  /**
   * Place the camera for this frame. `realDt` is wall-clock seconds (smoothing and
   * shake), `gameDt` game seconds (a cut's timing, which slows with the game).
   */
  update(framing: Framing, realDt: number, gameDt: number): void {
    const cut = this.cut;
    if (cut?.kind === 'goal') this.goalShot(cut, framing.ball, gameDt);
    else if (cut?.kind === 'wide') this.set(TUNING.director.wide.fov, 0, TUNING.director.wide.height, TUNING.director.wide.distance, 0, 0, 0);
    else if (cut?.kind === 'replay') this.replayShot(cut, framing.ball);
    else if (this.mode === 'action') this.action(framing, realDt);
    else this.broadcast(framing, realDt);
    this.applyShake(realDt);
  }

  private broadcast(f: Framing, dt: number): void {
    const C = TUNING.camera;
    const focus = f.player ? lerp(f.player.x, f.ball.x, C.ballWeight) : f.ball.x;
    // Pan with the play until the end wall reaches the edge of the picture: how far that
    // is depends on how much of the pitch the window shows across.
    const depth = Math.hypot(C.height, C.distance);
    const halfView = Math.tan(THREE.MathUtils.degToRad(C.fov / 2)) * depth * this.camera.aspect;
    const limit = Math.max(0, HALF_LENGTH + C.endMargin - halfView);
    const x = Math.max(-limit, Math.min(limit, focus));
    this.follow(C.fov, x, C.height, C.distance, x, 0, 0, dt, C.lag);
  }

  private action(f: Framing, dt: number): void {
    const A = TUNING.director.action;
    const p = f.player ?? f.ball;
    const fx = lerp(p.x, f.ball.x, A.ballWeight);
    const fz = lerp(p.z, f.ball.z, A.ballWeight);
    const d = f.attackDir;
    // Never outside the cage (it would look through the goal net and the netting).
    const limit = HALF_LENGTH - A.inside;
    const cx = Math.max(-limit, Math.min(limit, fx - d * A.back));
    const cz = Math.min(HALF_WIDTH - A.inside, fz + A.side);
    this.follow(A.fov, cx, A.height, cz, fx + d * A.ahead, 0.5, fz * 0.5, dt, A.lag);
  }

  /** The net bulging (low, beside the goal), then circling the scorer. */
  private goalShot(cut: Extract<Cut, { kind: 'goal' }>, ball: Vec3, dt: number): void {
    const G = TUNING.director.goal;
    cut.t += dt;
    const lineX = cut.end * HALF_LENGTH;
    if (cut.t < G.netTime || !cut.scorer) {
      this.set(G.fov, lineX - cut.end * G.netBack, G.netHeight, G.netSide, lineX + cut.end * 0.4, 0.8, ball.z * 0.5);
      return;
    }
    const s = cut.scorer();
    const angle = G.orbitStart + (cut.t - G.netTime) * G.orbitSpeed;
    this.set(G.fov, s.x + Math.sin(angle) * G.orbitRadius, G.orbitHeight, s.z + Math.cos(angle) * G.orbitRadius, s.x, 1.1, s.z);
  }

  private replayShot(cut: Extract<Cut, { kind: 'replay' }>, ball: Vec3): void {
    const R = TUNING.director.replay;
    const lineX = cut.end * HALF_LENGTH;
    if (cut.view === 'behind') {
      // High behind the goal, looking back up the pitch at the ball.
      this.set(R.fov, lineX + cut.end * R.behind, R.behindHeight, 0, ball.x, 0.5, ball.z);
    } else {
      // Low on the near side, level with the goal line, panning with the ball.
      this.set(R.fov, lineX - cut.end * R.sideBack, R.sideHeight, R.side, ball.x, 0.6, ball.z);
    }
  }

  /** Ease the live camera towards a position and look-at point. */
  private follow(fov: number, px: number, py: number, pz: number, lx: number, ly: number, lz: number, dt: number, lag: number): void {
    if (!this.placed) {
      this.pos.set(px, py, pz);
      this.look.set(lx, ly, lz);
      this.placed = true;
    } else {
      const k = damp(lag, dt);
      this.pos.lerp(new THREE.Vector3(px, py, pz), k);
      this.look.lerp(new THREE.Vector3(lx, ly, lz), k);
    }
    this.setFov(fov);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** Put the camera straight there (a cut). */
  private set(fov: number, px: number, py: number, pz: number, lx: number, ly: number, lz: number): void {
    this.setFov(fov);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(lx, ly, lz);
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Rotate the camera by this frame's shake (it's placed afresh every frame, so nothing to undo). */
  private applyShake(dt: number): void {
    const s = this.shaking;
    if (s.angle <= 0) return;
    const S = TUNING.director.shake;
    s.t += dt;
    const a = s.angle * Math.exp(-s.t / S.decay);
    if (a < 1e-4) {
      s.angle = 0;
      return;
    }
    const w = 2 * Math.PI * S.frequency * s.t;
    this.camera.rotateX(a * Math.sin(w));
    this.camera.rotateY(0.7 * a * Math.sin(1.37 * w + 1));
  }
}
