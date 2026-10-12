import * as THREE from 'three';
import type { BallPath } from './ball/trajectory';
import { TUNING } from './config';
import { headingVec } from './math';
import type { Sim } from './sim/sim';

/**
 * `?debug`: rings for the controlled player's reach and possession range, their facing
 * ray, the last kick's predicted path, and a readout of their state.
 */
export class DebugOverlay {
  private readonly group = new THREE.Group();
  private readonly reach: THREE.Line;
  private readonly possession: THREE.Line;
  private readonly facing: THREE.Line;
  private readonly path: THREE.Line;
  private readonly text: HTMLElement;

  constructor(scene: THREE.Scene, hudRoot: HTMLElement) {
    const D = TUNING.dribble;
    this.reach = ring(D.reach, 0x7dff6b);
    this.possession = ring(D.possessionRange, 0x4da3ff);
    this.facing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0xffe14d }),
    );
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5ad1 }));
    this.path.frustumCulled = false;
    this.group.add(this.reach, this.possession, this.facing, this.path);
    this.group.traverse((o) => (o.renderOrder = 5));
    scene.add(this.group);

    this.text = document.createElement('pre');
    this.text.id = 'debug';
    hudRoot.appendChild(this.text);
  }

  /** Show where a kick is predicted to go. */
  showPath(path: BallPath): void {
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
  }

  update(sim: Sim, controlled: number, at: THREE.Vector3): void {
    const p = sim.players[controlled];
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
