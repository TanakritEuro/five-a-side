import * as THREE from 'three';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_RADIUS,
} from '../constants';
import { armLocal, bodyRotation, leanQuat } from '../keeper/body';

/**
 * Placeholder keeper: a torso, head and two arms the same size as the keeper's colliders,
 * posed from the simulation (height off the ground, lean, arm angle) so a dive looks like
 * what the physics does. Replaced by the rigged character in Milestone 5.
 */
export class KeeperMesh extends THREE.Group {
  private readonly body = new THREE.Group();
  private readonly arms: THREE.Mesh[] = [];

  constructor(shirt: number, shorts: number) {
    super();
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.7 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(KEEPER_RADIUS, KEEPER_HEIGHT - 2 * KEEPER_RADIUS - 0.25, 6, 12), shirtMat);
    torso.position.y = (KEEPER_HEIGHT - 0.25) / 2;
    const legs = new THREE.Mesh(
      new THREE.CylinderGeometry(KEEPER_RADIUS * 0.9, KEEPER_RADIUS * 0.75, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.7 }),
    );
    legs.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.8 }));
    head.position.y = KEEPER_HEIGHT - 0.12;
    this.body.add(torso, legs, head);
    const armGeo = new THREE.CapsuleGeometry(KEEPER_HAND_RADIUS, KEEPER_ARM_LENGTH - 2 * KEEPER_HAND_RADIUS, 4, 8);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(armGeo, shirtMat);
      this.arms.push(arm);
      this.body.add(arm);
    }
    this.body.traverse((o) => (o.castShadow = true));
    this.add(this.body);
  }

  /** Pose the body: `y` off the ground (m), `lean` (rad) and arm angle `arms` (rad), as in keeper/pose.ts. */
  setPose(y: number, lean: number, arms: number): void {
    this.body.position.y = y;
    const q = bodyRotation(lean);
    this.body.quaternion.set(q.x, q.y, q.z, q.w);
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const a = armLocal(side, arms);
      arm.position.set(a.x, a.y, 0);
      const r = leanQuat(side * arms);
      arm.quaternion.set(r.x, r.y, r.z, r.w);
    });
  }
}
