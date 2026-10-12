import * as THREE from 'three';
import { lerp, lerpAngle } from '../math';
import type { Snapshot } from '../sim/sim';

const target = new THREE.Quaternion();

/**
 * Place the meshes between the last two simulation steps. `alpha` is how far the
 * render time is past the previous step, as a fraction of a step (0–1).
 */
export function interpolate(
  prev: Snapshot,
  curr: Snapshot,
  alpha: number,
  ball: THREE.Object3D,
  players: readonly THREE.Object3D[],
): void {
  const a = prev.ball.pos;
  const b = curr.ball.pos;
  ball.position.set(lerp(a.x, b.x, alpha), lerp(a.y, b.y, alpha), lerp(a.z, b.z, alpha));
  const qa = prev.ball.rot;
  const qb = curr.ball.rot;
  ball.quaternion.set(qa.x, qa.y, qa.z, qa.w).slerp(target.set(qb.x, qb.y, qb.z, qb.w), alpha);

  players.forEach((mesh, i) => {
    const p = prev.players[i];
    const c = curr.players[i];
    mesh.position.set(lerp(p.x, c.x, alpha), 0, lerp(p.z, c.z, alpha));
    // Meshes face +X; heading θ points along (cos θ, sin θ) in (x, z), a rotation of −θ about +Y.
    mesh.rotation.y = -lerpAngle(p.facing, c.facing, alpha);
  });
}
