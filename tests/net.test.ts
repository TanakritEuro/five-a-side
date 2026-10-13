import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HALF_LENGTH } from '../src/constants';
import { Nets } from '../src/net';

/** How far the +X goal's back panel has moved from where a fresh net's is (the largest vertex shift, m). */
function bulge(nets: Nets): number {
  const fresh = new Nets();
  const back = (n: Nets) => ((n.object.children[0] as THREE.Group).children[0] as THREE.Mesh).geometry.attributes.position.array;
  const a = back(nets);
  const b = back(fresh);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

describe('nets', () => {
  it('bulge where a hard shot hits the back, and settle again', () => {
    const nets = new Nets();
    const ball = new THREE.Vector3(HALF_LENGTH - 3, 0.8, 0.5);
    for (let i = 0; i < 20; i++) {
      ball.x = Math.min(HALF_LENGTH + 0.9, ball.x + 20 / 60);
      nets.update(ball, 1 / 60);
    }
    expect(bulge(nets)).toBeGreaterThan(0.1);
    for (let i = 0; i < 180; i++) nets.update(ball, 1 / 60);
    expect(bulge(nets)).toBeLessThan(0.01);
  });

  it("don't move for a ball that stays on the pitch", () => {
    const nets = new Nets();
    const ball = new THREE.Vector3(0, 0.11, 0);
    for (let i = 0; i < 40; i++) {
      ball.x += 25 / 60;
      nets.update(ball, 1 / 60);
    }
    expect(ball.x).toBeLessThan(HALF_LENGTH);
    expect(bulge(nets)).toBe(0);
  });
});
