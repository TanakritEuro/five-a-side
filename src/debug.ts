import * as THREE from 'three';
import type { AiState } from './ai/ai';
import { launchSpeedFor, passSafety } from './ai/passing';
import type { BallPath } from './ball/trajectory';
import { TUNING } from './config';
import { headingVec } from './math';
import { arrivalSpeed } from './sim/kick';
import type { Sim } from './sim/sim';

/**
 * `?debug`: what the AI is thinking, and the controlled player's details.
 * - a label over every player with their AI state (and who they mark), and any tackle;
 * - the support spots the attacking team scored, green (good) to red (poor);
 * - pass lanes from the ball carrier to each teammate, green if safe, red if not;
 * - each team's chase point for a loose ball, and the last kick's predicted path;
 * - for the controlled player: reach and possession rings, facing ray, a state readout.
 */
export class DebugOverlay {
  private readonly group = new THREE.Group();
  private readonly reach: THREE.Line;
  private readonly possession: THREE.Line;
  private readonly facing: THREE.Line;
  private readonly path: THREE.Line;
  private readonly spots: THREE.Points;
  private readonly lanes: THREE.LineSegments;
  private readonly chasePoints: THREE.Line[];
  private readonly labels: HTMLElement[] = [];
  private readonly text: HTMLElement;
  private readonly labelRoot: HTMLElement;
  private readonly v = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    hudRoot: HTMLElement,
    private readonly camera: THREE.Camera,
  ) {
    const D = TUNING.dribble;
    this.reach = ring(D.reach, 0x7dff6b);
    this.possession = ring(D.possessionRange, 0x4da3ff);
    this.facing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0xffe14d }),
    );
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5ad1 }));
    this.path.frustumCulled = false;

    this.spots = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.spots.frustumCulled = false;
    this.lanes = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }),
    );
    this.lanes.frustumCulled = false;
    this.chasePoints = [ring(0.35, 0x4da3ff), ring(0.35, 0xff6b5a)];

    this.group.add(this.reach, this.possession, this.facing, this.path, this.spots, this.lanes, ...this.chasePoints);
    this.group.traverse((o) => (o.renderOrder = 5));
    scene.add(this.group);

    this.text = document.createElement('pre');
    this.text.id = 'debug';
    hudRoot.appendChild(this.text);
    this.labelRoot = document.createElement('div');
    this.labelRoot.id = 'debug-labels';
    hudRoot.appendChild(this.labelRoot);
  }

  /** Show where a kick is predicted to go. */
  showPath(path: BallPath): void {
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
  }

  /**
   * Call once per frame. `meshes` are the players' (interpolated) meshes, for placing
   * labels; `controlled` is the keyboard's player, or null.
   */
  update(sim: Sim, meshes: readonly THREE.Object3D[], controlled: number | null): void {
    this.updateAi(sim, meshes);
    const show = controlled !== null;
    for (const o of [this.reach, this.possession, this.facing]) o.visible = show;
    this.text.style.display = show ? '' : 'none';
    if (controlled === null) return;

    const p = sim.players[controlled];
    const at = meshes[controlled].position;
    for (const o of [this.reach, this.possession, this.facing]) o.position.set(at.x, 0.03, at.z);
    this.facing.rotation.y = -p.facing;
    const b = sim.ball.translation();
    const v = sim.ball.linvel();
    const f = headingVec(p.facing);
    this.text.textContent = [
      `tick ${sim.tick}  phase ${sim.match.phase.kind}`,
      `speed ${p.speed.toFixed(2)}  stamina ${p.stamina.toFixed(2)}${p.sprinting ? '  SPRINT' : ''}`,
      `facing (${f.x.toFixed(2)}, ${f.z.toFixed(2)})  charge ${p.charge?.steps ?? '-'}  pending ${p.pendingKick?.kind ?? '-'}`,
      `owner ${sim.possession.owner ?? '-'}  last ${sim.possession.lastTouch ?? '-'}`,
      `ball (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})  |v| ${Math.hypot(v.x, v.y, v.z).toFixed(2)}`,
    ].join('\n');
  }

  private updateAi(sim: Sim, meshes: readonly THREE.Object3D[]): void {
    const ai = sim.ai;
    if (!ai) return;

    // Labels over heads.
    sim.players.forEach((p, i) => {
      const label = (this.labels[i] ??= this.labelRoot.appendChild(document.createElement('div')));
      const s = ai.states[p.id];
      const you = sim.humanDriven.has(p.id) ? ' (you)' : '';
      // A tackle in progress: lunging, or recovering from one.
      const tackle = p.tackle ? ` · ${p.tackle.kind === 'lunge' ? 'TACKLE' : 'recover'}` : '';
      label.textContent = s ? `${describe(s)}${tackle}${you}` : '';
      label.className = p.team === 0 ? 'home' : 'away';
      this.v.copy(meshes[i].position).setY(2.15).project(this.camera);
      label.style.left = `${((this.v.x + 1) / 2) * 100}%`;
      label.style.top = `${((1 - this.v.y) / 2) * 100}%`;
      label.style.display = this.v.z < 1 ? '' : 'none';
    });

    // Support spots of whichever team has the ball.
    const owner = sim.possession.owner;
    const team = owner === null ? null : sim.players[owner].team;
    const spots = team === null ? [] : ai.planOf(team).spots;
    const positions: number[] = [];
    const colors: number[] = [];
    if (spots.length > 0) {
      const top = spots[0].score;
      const bottom = spots[spots.length - 1].score;
      const c = new THREE.Color();
      for (const s of spots) {
        positions.push(s.pos.x, 0.05, s.pos.z);
        c.setHSL(0.33 * ((s.score - bottom) / Math.max(1e-6, top - bottom)), 0.9, 0.5);
        colors.push(c.r, c.g, c.b);
      }
    }
    setAttributes(this.spots.geometry, positions, colors);

    // Pass lanes from the carrier.
    const lanePos: number[] = [];
    const laneCol: number[] = [];
    if (owner !== null) {
      const carrier = sim.players[owner];
      const opponents = sim.players.filter((o) => o.team !== carrier.team);
      for (const q of sim.players) {
        if (q.team !== carrier.team || q.id === owner) continue;
        const d = Math.hypot(q.pos.x - carrier.pos.x, q.pos.z - carrier.pos.z);
        const safety = passSafety(carrier.pos, q.pos, launchSpeedFor(d, arrivalSpeed(d)), q, opponents);
        const [r, g] = safety > 0 ? [0.2, 1] : [1, 0.25];
        lanePos.push(carrier.pos.x, 0.06, carrier.pos.z, q.pos.x, 0.06, q.pos.z);
        laneCol.push(r, g, 0.2, r, g, 0.2);
      }
    }
    setAttributes(this.lanes.geometry, lanePos, laneCol);

    // Where each team's chaser is heading for a loose ball.
    for (const t of [0, 1] as const) {
      const chaser = ai.planOf(t).chaser;
      const mark = this.chasePoints[t];
      mark.visible = owner === null && chaser !== null;
      if (chaser) mark.position.set(chaser.point.x, 0.05, chaser.point.z);
    }
  }
}

/** A short description of an AI state for a label. */
function describe(s: AiState): string {
  switch (s.kind) {
    case 'mark':
      return `mark ${s.opponent}`;
    case 'dribble':
      return s.plan.kind === 'run' ? 'dribble' : s.plan.kind === 'pass' ? `pass to ${s.plan.to}` : 'shoot';
    case 'takeRestart':
      return s.plan?.kind === 'shoot' ? 'restart: shoot' : 'restart';
    default:
      return s.kind;
  }
}

function setAttributes(geometry: THREE.BufferGeometry, positions: number[], colors: number[]): void {
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
}

function ring(radius: number, color: number): THREE.Line {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
}

/** `?stats`: frames per second and the renderer's draw calls and triangles. */
export class StatsOverlay {
  private readonly text: HTMLElement;
  private frames = 0;
  private elapsed = 0;

  constructor(hudRoot: HTMLElement) {
    this.text = document.createElement('pre');
    this.text.id = 'stats';
    hudRoot.appendChild(this.text);
  }

  update(renderer: THREE.WebGLRenderer, dt: number): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 0.5) return;
    const { calls, triangles } = renderer.info.render;
    this.text.textContent = `${Math.round(this.frames / this.elapsed)} fps  ${calls} calls  ${triangles} tris`;
    this.frames = 0;
    this.elapsed = 0;
  }
}
