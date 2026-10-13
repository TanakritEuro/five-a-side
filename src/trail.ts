// Ported unchanged from ../penalty-shootout/src/trail.ts.
import * as THREE from 'three';
import { TUNING } from './config';

/** Most points the trail can hold (at 144 fps, 0.12 s is about 17). */
const MAX_POINTS = 40;
/** Further than this (m) between two updates, the ball was moved rather than flew: start afresh. */
const TELEPORT_DISTANCE = 5;
/**
 * Speed is measured over this much game time (s). Physics moves the ball in fixed steps,
 * so in slow motion (or on a fast screen) several frames in a row see it standing still.
 */
const SPEED_WINDOW = 0.06;

interface Point {
  x: number;
  y: number;
  z: number;
  /** Game seconds since the ball was here. */
  age: number;
  /** 0–1: how fast the ball was going here, between the trail's min and full speed. */
  strength: number;
}

/**
 * A faint streak behind the ball on hard shots: a ribbon, turned to face the camera,
 * through where the ball has been over the last `TUNING.trail.life` game seconds. It
 * thins and fades with age and doesn't show at all below `minSpeed`.
 *
 * It follows the ball's mesh, not the physics body, so replays get a trail too.
 */
export class BallTrail {
  readonly object: THREE.Mesh;
  private readonly points: Point[] = [];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly colours = new Float32Array(MAX_POINTS * 2 * 4);

  constructor() {
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    // RGBA vertex colours: the alpha fades the tail out.
    g.setAttribute('color', new THREE.BufferAttribute(this.colours, 4).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(index);
    g.setDrawRange(0, 0);
    this.object = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.object.frustumCulled = false;
  }

  /**
   * Follow the ball to `ball` after `dt` game seconds (0 while paused: nothing changes),
   * with the ribbon turned towards a camera at `eye`.
   */
  update(ball: THREE.Vector3, dt: number, eye: THREE.Vector3): void {
    if (dt <= 0) return;
    const T = TUNING.trail;
    const pts = this.points;
    for (const p of pts) p.age += dt;
    while (pts.length > 0 && pts[0].age > T.life) pts.shift();

    const newest = pts[pts.length - 1];
    const moved = newest ? Math.hypot(ball.x - newest.x, ball.y - newest.y, ball.z - newest.z) : Infinity;
    if (moved > TELEPORT_DISTANCE) pts.length = 0;
    // Only lay a point where the ball has moved: the ribbon needs a direction at each one.
    if (moved > 1e-3) {
      const from = pts.find((p) => p.age <= SPEED_WINDOW);
      const speed = from && from.age > 0 ? Math.hypot(ball.x - from.x, ball.y - from.y, ball.z - from.z) / from.age : 0;
      const strength = THREE.MathUtils.smoothstep(speed, T.minSpeed, T.fullSpeed);
      pts.push({ x: ball.x, y: ball.y, z: ball.z, age: 0, strength });
      if (pts.length > MAX_POINTS) pts.shift();
    }
    this.build(eye);
  }

  /** Lay the ribbon through the points: across the direction of travel, facing `eye`. */
  private build(eye: THREE.Vector3): void {
    const T = TUNING.trail;
    const pts = this.points;
    const n = pts.length;
    const visible = n >= 2 && pts.some((p) => p.strength > 0);
    this.geometry.setDrawRange(0, visible ? (n - 1) * 6 : 0);
    if (!visible) return;

    const along = new THREE.Vector3();
    const toEye = new THREE.Vector3();
    const across = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      along.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
      toEye.set(eye.x - p.x, eye.y - p.y, eye.z - p.z);
      across.crossVectors(along, toEye);
      const fresh = 1 - Math.min(1, p.age / T.life);
      const half = (T.width / 2) * fresh;
      if (across.lengthSq() > 1e-12) across.normalize().multiplyScalar(half);
      else across.set(0, 0, 0);

      const v = i * 2;
      this.positions.set([p.x + across.x, p.y + across.y, p.z + across.z, p.x - across.x, p.y - across.y, p.z - across.z], v * 3);
      const alpha = T.opacity * p.strength * fresh * fresh;
      this.colours.set([1, 1, 1, alpha, 1, 1, 1, alpha], v * 4);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
