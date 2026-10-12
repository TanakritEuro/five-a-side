// Scaffold entry point: renders the cage, both goals and two teams of placeholder players
// standing in formation, and fires random test shots so you can confirm rendering, the
// boards and the physics work. Replace with the real game loop (CLAUDE.md, Milestone 1).

import { applyAero } from './ball/aero';
import { BroadcastCamera } from './camera';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH, HALF_LENGTH, HALF_WIDTH, PHYSICS_STEP } from './constants';
import { createRng, gaussian } from './math';
import { createPhysics, createPlayerBody } from './physics';
import { createPlayerMesh, createScene } from './scene';
import { DIAMOND, slotPosition } from './team/formation';
import { TEAMS } from './team/teams';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const scoreboard = document.querySelector<HTMLDivElement>('#scoreboard')!;

const { renderer, scene, camera, ball: ballMesh } = createScene(canvas);
const physics = await createPhysics();
const { world, ball, events } = physics;
const broadcast = new BroadcastCamera(camera);
const rng = createRng(Date.now());

// Two teams in the diamond: home (TEAMS[0]) attacks +X, away attacks -X.
TEAMS.forEach((team, i) => {
  const attackDir = i === 0 ? 1 : -1;
  for (const slot of DIAMOND) {
    const p = slotPosition(slot, attackDir);
    createPlayerBody(physics, p.x, p.z);
    const shirt = slot.role === 'keeper' ? team.keeperShirt : team.shirt;
    const mesh = createPlayerMesh(shirt, team.shorts);
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = attackDir === 1 ? 0 : Math.PI;
    scene.add(mesh);
  }
});

const score = [0, 0];
let goalScored = false;

function renderScore(): void {
  scoreboard.textContent = `${TEAMS[0].short} ${score[0]} – ${score[1]} ${TEAMS[1].short}`;
}

function resetBall(): void {
  ball.setTranslation({ x: 0, y: BALL_RADIUS, z: 0 }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  goalScored = false;
  status.textContent = 'Space: test shot · R: reset';
}

/** Hit the ball from where it lies towards a random goal (or the boards), with some curl. */
function testShot(): void {
  const p = ball.translation();
  if (p.y > 0.5) return;
  const end = rng() < 0.5 ? 1 : -1;
  const target = rng() < 0.7
    ? { x: end * HALF_LENGTH, z: (rng() - 0.5) * (GOAL_WIDTH + 1) }
    : { x: (rng() - 0.5) * HALF_LENGTH, z: Math.sign(rng() - 0.5) * HALF_WIDTH };
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  const speed = 16 + rng() * 10;
  ball.setLinvel({ x: (dx / d) * speed, y: 1.5 + rng() * 3, z: (dz / d) * speed }, true);
  ball.setAngvel({ x: 0, y: gaussian(rng) * 20, z: 0 }, true); // sidespin curls it
  goalScored = false;
  status.textContent = 'Shot!';
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') testShot();
  else if (e.code === 'KeyR') resetBall();
});

function checkGoal(): void {
  if (goalScored) return;
  const p = ball.translation();
  // Whole ball over the line, between the posts, under the bar.
  if (Math.abs(p.x) > HALF_LENGTH + BALL_RADIUS && Math.abs(p.z) < GOAL_WIDTH / 2 && p.y < GOAL_HEIGHT) {
    goalScored = true;
    // The home team attacks +X, so a ball in the +X goal is theirs.
    score[p.x > 0 ? 0 : 1]++;
    renderScore();
    status.textContent = 'GOAL! · Space: shoot again';
  }
}

// Fixed-timestep physics, variable-rate rendering.
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  accumulator += dt;
  last = now;

  while (accumulator >= PHYSICS_STEP) {
    applyAero(ball);
    world.step(events);
    events.drainCollisionEvents(() => {});
    checkGoal();
    accumulator -= PHYSICS_STEP;
  }

  const p = ball.translation();
  const r = ball.rotation();
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
  broadcast.update(p, dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

renderScore();
resetBall();
requestAnimationFrame(frame);
