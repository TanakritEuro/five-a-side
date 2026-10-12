import type * as THREE from 'three';
import { TUNING } from './config';
import { HALF_LENGTH } from './constants';
import { damp, type Vec3 } from './math';

/**
 * Broadcast camera: high on the +Z touchline side, panning along the pitch to follow the
 * ball (smoothed so it doesn't jitter on every touch). Placeholder for a proper director.
 */
export class BroadcastCamera {
  private x = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.fov = TUNING.camera.fov;
    camera.updateProjectionMatrix();
    this.place();
  }

  update(ball: Vec3, dt: number): void {
    const C = TUNING.camera;
    const limit = HALF_LENGTH * 0.6;
    const target = Math.max(-limit, Math.min(limit, ball.x * C.follow));
    this.x += (target - this.x) * damp(C.lag, dt);
    this.place();
  }

  private place(): void {
    const C = TUNING.camera;
    this.camera.position.set(this.x, C.height, C.distance);
    this.camera.lookAt(this.x, 0, 0);
  }
}
