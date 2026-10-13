// Ported from ../penalty-shootout/src/net.ts. There the one goal sat on z = 0 and the
// ripples came from the net's contact events; here there's a net at each end, and they
// ripple from where the ball is drawn, so replays ripple too.
import * as THREE from 'three';
import { TUNING } from './config';
import { BALL_RADIUS, GOAL_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, POST_RADIUS } from './constants';
import type { Vec3 } from './math';

interface Panel {
  geometry: THREE.PlaneGeometry;
  /** Rest positions in the panel's local space, and the same points in world space. */
  rest: Float32Array;
  world: Float32Array;
  /** +1 if the panel's local +z points out of the goal, −1 if it points in. */
  outward: number;
}

interface Ripple {
  x: number;
  y: number;
  z: number;
  strength: number;
  age: number;
}

/**
 * One goal's net, drawn as wireframe panels (back, roof, two sides) that bulge out where
 * the ball hits and ripple outwards from there. Visual only: the physics net is rigid.
 */
class Net {
  readonly object = new THREE.Group();
  private readonly panels: Panel[] = [];
  private ripples: Ripple[] = [];

  /** The net behind the goal line at `end` × HALF_LENGTH. */
  constructor(readonly end: 1 | -1) {
    // Built in the goal's own frame (mouth on z = 0, net towards −z), then turned so −z
    // points out of the pitch.
    this.object.position.set(end * HALF_LENGTH, 0, 0);
    this.object.rotation.y = -end * (Math.PI / 2);
    this.object.updateMatrixWorld(true);

    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
    const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
    const topY = GOAL_HEIGHT + POST_RADIUS;
    const add = (w: number, h: number, sx: number, sy: number, pos: THREE.Vector3, rot: THREE.Euler, out: THREE.Vector3) => {
      const geometry = new THREE.PlaneGeometry(w, h, sx, sy);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pos);
      mesh.rotation.copy(rot);
      this.object.add(mesh);
      mesh.updateMatrixWorld(true);

      const rest = Float32Array.from(geometry.attributes.position.array);
      const world = new Float32Array(rest.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < rest.length; i += 3) {
        v.set(rest[i], rest[i + 1], rest[i + 2]).applyMatrix4(mesh.matrixWorld);
        world.set([v.x, v.y, v.z], i);
      }
      const localNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      this.panels.push({ geometry, rest, world, outward: Math.sign(localNormal.dot(out)) || 1 });
    };
    add(halfW * 2, topY, 24, 10, new THREE.Vector3(0, topY / 2, -GOAL_DEPTH), new THREE.Euler(), new THREE.Vector3(0, 0, -1));
    add(halfW * 2, GOAL_DEPTH, 24, 8, new THREE.Vector3(0, topY, -GOAL_DEPTH / 2), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, 1, 0));
    for (const side of [-1, 1]) {
      add(GOAL_DEPTH, topY, 8, 10, new THREE.Vector3(side * halfW, topY / 2, -GOAL_DEPTH / 2), new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(side, 0, 0));
    }
  }

  /** The ball hit the net at `point` (world) at `speed` m/s. */
  hit(point: Vec3, speed: number): void {
    const R = TUNING.net;
    const strength = Math.min(R.maxStrength, speed / R.referenceSpeed);
    if (strength < 0.05) return;
    this.ripples.push({ x: point.x, y: point.y, z: point.z, strength, age: 0 });
  }

  /** Advance the ripples by `dt` game seconds and reshape the net. */
  step(dt: number): void {
    if (this.ripples.length === 0) return;
    const R = TUNING.net;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < R.decay * 5);
    this.apply();
  }

  /** Settle the net at once (a replay starting, or ending). */
  clear(): void {
    this.ripples = [];
    this.apply();
  }

  private apply(): void {
    const R = TUNING.net;
    for (const p of this.panels) {
      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        let d = 0;
        for (const r of this.ripples) {
          const dist = Math.hypot(p.world[i] - r.x, p.world[i + 1] - r.y, p.world[i + 2] - r.z);
          const envelope = r.strength * Math.exp(-r.age / R.decay) * Math.exp(-((dist / R.spread) ** 2));
          // A bulge where the ball went in, plus a wave running outwards from it.
          d += envelope * R.amplitude * (R.bulge + Math.cos(R.frequency * r.age - R.wavenumber * dist));
        }
        arr[i + 2] = p.rest[i + 2] + p.outward * d;
      }
      pos.needsUpdate = true;
    }
  }
}

/**
 * Both nets, watching the ball as drawn: when it reaches the back, a side or the roof of
 * a goal moving outwards, that net ripples there.
 */
export class Nets {
  readonly object = new THREE.Group();
  private readonly nets = [new Net(1), new Net(-1)];
  private last: THREE.Vector3 | null = null;
  /** Game seconds since each net last rippled: one hit per contact, not one per frame. */
  private readonly since = [Infinity, Infinity];

  constructor() {
    for (const n of this.nets) this.object.add(n.object);
  }

  /** Follow the ball to `ball` after `dt` game seconds. */
  update(ball: THREE.Vector3, dt: number): void {
    if (dt <= 0) return;
    // Measured before the last position is overwritten with this one.
    const speed = this.last ? ball.distanceTo(this.last) / dt : 0;
    this.last = (this.last ?? new THREE.Vector3()).copy(ball);
    this.nets.forEach((net, i) => {
      this.since[i] += dt;
      net.step(dt);
      const out = ball.x * net.end - HALF_LENGTH; // how far behind this goal line
      if (out <= 0 || speed > 60 || this.since[i] < 0.3) return;
      const r = BALL_RADIUS + 0.06;
      const back = out >= GOAL_DEPTH - r;
      const side = Math.abs(ball.z) >= GOAL_WIDTH / 2 - r;
      const roof = ball.y >= GOAL_HEIGHT - r;
      if (back || side || roof) {
        net.hit(ball, speed);
        this.since[i] = 0;
      }
    });
  }

  /** Settle both nets (a replay starting or ending). */
  clear(): void {
    for (const n of this.nets) n.clear();
    this.last = null;
    this.since.fill(Infinity);
  }
}
