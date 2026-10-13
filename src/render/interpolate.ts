import * as THREE from 'three';
import { PHYSICS_STEP } from '../constants';
import { lerp, lerpAngle } from '../math';
import type { PlayerSnapshot, Snapshot } from '../sim/sim';

const target = new THREE.Quaternion();

/**
 * A player as drawn this frame: positions and angles between the last two steps, and the
 * rest (buttons, actions) as of the latest. `now` is the render time in game seconds
 * (step ticks × `PHYSICS_STEP`), so an action stamped with a tick can be timed from it.
 */
export interface PlayerView extends PlayerSnapshot {
  now: number;
}

export function emptyView(): PlayerView {
  return { x: 0, z: 0, facing: 0, y: 0, lean: 0, arms: 0, speed: 0, sprinting: false, charge: 0, tackle: -1, holding: false, action: null, now: 0 };
}

/** Seconds since `view`'s last action, or Infinity if there wasn't one. */
export function actionAge(view: PlayerView): number {
  return view.action ? view.now - view.action.tick * PHYSICS_STEP : Infinity;
}

/**
 * Place the ball and fill in each player's view between the last two simulation steps.
 * `alpha` is how far the render time is past the previous step, as a fraction of a step (0–1).
 */
export function interpolate(prev: Snapshot, curr: Snapshot, alpha: number, ball: THREE.Object3D, views: PlayerView[]): void {
  const a = prev.ball.pos;
  const b = curr.ball.pos;
  ball.position.set(lerp(a.x, b.x, alpha), lerp(a.y, b.y, alpha), lerp(a.z, b.z, alpha));
  const qa = prev.ball.rot;
  const qb = curr.ball.rot;
  ball.quaternion.set(qa.x, qa.y, qa.z, qa.w).slerp(target.set(qb.x, qb.y, qb.z, qb.w), alpha);

  const now = (prev.tick + alpha * (curr.tick - prev.tick)) * PHYSICS_STEP;
  curr.players.forEach((c, i) => {
    const p = prev.players[i];
    const v = (views[i] ??= emptyView());
    Object.assign(v, c);
    v.x = lerp(p.x, c.x, alpha);
    v.z = lerp(p.z, c.z, alpha);
    v.facing = lerpAngle(p.facing, c.facing, alpha);
    v.y = lerp(p.y, c.y, alpha);
    v.lean = lerp(p.lean, c.lean, alpha);
    v.arms = lerp(p.arms, c.arms, alpha);
    v.speed = lerp(p.speed, c.speed, alpha);
    v.charge = lerp(p.charge, c.charge, alpha);
    v.tackle = c.tackle >= 0 && p.tackle >= 0 ? lerp(p.tackle, c.tackle, alpha) : c.tackle;
    v.now = now;
  });
}
