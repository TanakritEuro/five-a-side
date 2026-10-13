import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Director } from '../src/camera/director';
import { TUNING } from '../src/config';
import { HALF_LENGTH, HALF_WIDTH } from '../src/constants';

function camera(aspect: number): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(TUNING.camera.fov, aspect, 0.1, 500);
}

/** Where `p` appears across the picture: −1 left edge, +1 right edge. */
function screenX(cam: THREE.PerspectiveCamera, p: THREE.Vector3): number {
  cam.updateMatrixWorld(true);
  return p.clone().project(cam).x;
}

/** Run the director for a few seconds with the play at `x`. */
function settle(director: Director, x: number, attackDir: 1 | -1 = 1): void {
  const ball = new THREE.Vector3(x, 0.11, 0);
  for (let i = 0; i < 300; i++) director.update({ player: ball, ball, attackDir }, 1 / 60, 1 / 60);
}

describe('director', () => {
  it('keeps the end wall in the picture when play is at either end, whatever the window shape', () => {
    for (const aspect of [0.6, 1.3, 2.0]) {
      const cam = camera(aspect);
      const d = new Director(cam);
      for (const end of [1, -1]) {
        settle(d, end * (HALF_LENGTH - 1));
        const wall = screenX(cam, new THREE.Vector3(end * HALF_LENGTH, 0, 0));
        expect(Math.abs(wall)).toBeLessThanOrEqual(1);
        // The ball, a metre from the wall, is in shot too.
        expect(Math.abs(screenX(cam, new THREE.Vector3(end * (HALF_LENGTH - 1), 0, 0)))).toBeLessThan(1);
      }
    }
  });

  it('pans further on a narrow window than on a wide one', () => {
    const narrow = camera(0.8);
    const wide = camera(2);
    settle(new Director(narrow), HALF_LENGTH - 1);
    settle(new Director(wide), HALF_LENGTH - 1);
    expect(narrow.position.x).toBeGreaterThan(wide.position.x + 3);
  });

  it('keeps the action camera inside the cage', () => {
    const cam = camera(1.6);
    const d = new Director(cam);
    d.toggleMode();
    settle(d, -HALF_LENGTH + 1, 1);
    expect(Math.abs(cam.position.x)).toBeLessThan(HALF_LENGTH);
    expect(cam.position.z).toBeLessThan(HALF_WIDTH);
  });

  it('cuts to the net after a goal, then circles the scorer, then goes back', () => {
    const cam = camera(1.6);
    const d = new Director(cam);
    settle(d, 15);
    const scorer = new THREE.Vector3(16, 0, 3);
    d.goal(1, () => scorer);
    const ball = new THREE.Vector3(HALF_LENGTH + 0.5, 0.5, 0);
    d.update({ player: null, ball, attackDir: 1 }, 1 / 60, 1 / 60);
    // Low and close to the goal, looking at it.
    expect(cam.position.y).toBeLessThan(5);
    expect(Math.abs(screenX(cam, new THREE.Vector3(HALF_LENGTH, 1, 0)))).toBeLessThan(0.6);
    for (let i = 0; i < 120; i++) d.update({ player: null, ball, attackDir: 1 }, 1 / 60, 1 / 60);
    const r = Math.hypot(cam.position.x - scorer.x, cam.position.z - scorer.z);
    expect(r).toBeCloseTo(TUNING.director.goal.orbitRadius, 3);
    d.back();
    settle(d, 0);
    expect(cam.position.y).toBeCloseTo(TUNING.camera.height, 3);
  });
});
