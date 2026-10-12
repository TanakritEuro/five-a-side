import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from './config';
import {
  BALL_ANGULAR_DAMPING,
  BALL_MASS,
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_THICKNESS,
  CAGE_HEIGHT,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  GRAVITY,
  HALF_LENGTH,
  HALF_WIDTH,
  PHYSICS_STEP,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  POST_RADIUS,
} from './constants';

/** What a collider is, so contacts with the ball can be classified. */
export type ColliderTag = 'ground' | 'board' | 'cage' | 'post' | 'bar' | 'net' | 'player';

/** +1 for the goal at x = +HALF_LENGTH, -1 for the one at x = -HALF_LENGTH. */
export type GoalEnd = 1 | -1;

export interface Physics {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
  /** Pass to `world.step()`; drained each step for the ball's contacts. */
  events: RAPIER.EventQueue;
  /** Collider handle → tag, for every collider the ball can hit. */
  tags: Map<number, ColliderTag>;
  /** Collider handle → player id, for the player capsules. */
  playerColliders: Map<number, number>;
}

let rapierReady: Promise<void> | null = null;

/** Load Rapier's WASM once. Every world (game, tests, ghost balls) is created after this. */
export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export async function createPhysics(): Promise<Physics> {
  await initRapier();

  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;

  const tags = new Map<number, ColliderTag>();
  const add = (tag: ColliderTag, desc: RAPIER.ColliderDesc) => tags.set(world.createCollider(desc).handle, tag);

  add('ground', groundDesc());
  addWalls(add);
  for (const end of [1, -1] as const) addGoal(add, end);

  const ball = createBall(world);
  return { world, ball, events: new RAPIER.EventQueue(true), tags, playerColliders: new Map() };
}

/** The ground (artificial turf: a touch less bounce than grass). Shared with the ghost-ball worlds. */
export function groundDesc(): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.cuboid(HALF_LENGTH + 10, 0.1, HALF_WIDTH + 10)
    .setTranslation(0, -0.1, 0)
    .setFriction(0.6)
    .setRestitution(0.45);
}

type Add = (tag: ColliderTag, desc: RAPIER.ColliderDesc) => void;

/** A wall slab: solid board or cage netting, centred at (x, y, z) with half extents (hx, hy, hz). */
function slab(tag: 'board' | 'cage', hx: number, hy: number, hz: number, x: number, y: number, z: number) {
  const restitution = tag === 'board' ? TUNING.ball.boardRestitution : TUNING.ball.cageRestitution;
  return RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setTranslation(x, y, z)
    .setRestitution(restitution)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
    .setFriction(0.3);
}

function addWalls(add: Add): void {
  const t = BOARD_THICKNESS / 2;
  const boardY = BOARD_HEIGHT / 2;
  const cageHalf = (CAGE_HEIGHT - BOARD_HEIGHT) / 2;
  const cageY = BOARD_HEIGHT + cageHalf;

  // Touchline walls (full length, past the corners).
  for (const s of [1, -1]) {
    const z = s * (HALF_WIDTH + t);
    add('board', slab('board', HALF_LENGTH + 2 * t, boardY, t, 0, boardY, z));
    add('cage', slab('cage', HALF_LENGTH + 2 * t, cageHalf, t, 0, cageY, z));
  }

  // End walls: boards and netting either side of the goal mouth, netting above it.
  const goalHalf = GOAL_WIDTH / 2 + 2 * POST_RADIUS;
  const sideHalf = (HALF_WIDTH - goalHalf) / 2;
  const sideZ = goalHalf + sideHalf;
  const aboveBottom = GOAL_HEIGHT + 2 * POST_RADIUS;
  const aboveHalf = (CAGE_HEIGHT - aboveBottom) / 2;
  for (const end of [1, -1]) {
    const x = end * (HALF_LENGTH + t);
    for (const s of [1, -1]) {
      add('board', slab('board', t, boardY, sideHalf, x, boardY, s * sideZ));
      add('cage', slab('cage', t, cageHalf, sideHalf, x, cageY, s * sideZ));
    }
    add('cage', slab('cage', t, aboveHalf, goalHalf, x, aboveBottom + aboveHalf, 0));
  }
}

function addGoal(add: Add, end: GoalEnd): void {
  const lineX = end * HALF_LENGTH;
  const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
  const topY = GOAL_HEIGHT + POST_RADIUS;

  // Posts stand just behind the line so their front edge is on it.
  const postX = lineX + end * POST_RADIUS;
  for (const z of [-halfW, halfW]) {
    add('post', RAPIER.ColliderDesc.cylinder(topY / 2, POST_RADIUS).setTranslation(postX, topY / 2, z).setRestitution(0.7));
  }
  const s = Math.SQRT1_2; // quaternion for 90° about X (cylinder axis Y -> Z)
  add(
    'bar',
    RAPIER.ColliderDesc.cylinder(halfW + POST_RADIUS, POST_RADIUS)
      .setTranslation(postX, topY, 0)
      .setRotation({ x: s, y: 0, z: 0, w: s })
      .setRestitution(0.7),
  );

  // Net: thin walls that soak up the ball's energy.
  const t = 0.02;
  const backX = lineX + end * GOAL_DEPTH;
  const midX = lineX + end * (GOAL_DEPTH / 2);
  const net = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
    add(
      'net',
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRestitution(0.05)
        // Use the net's own (low) bounce instead of averaging it with the ball's.
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFriction(0.9),
    );
  net(t, topY / 2, halfW, backX, topY / 2, 0); // back
  net(GOAL_DEPTH / 2, t, halfW, midX, topY, 0); // roof
  for (const z of [-halfW, halfW]) net(GOAL_DEPTH / 2, topY / 2, t, midX, topY / 2, z); // sides
}

/** The ball's rigid body and collider. Also used by flight predictors with a world of their own. */
export function createBall(world: RAPIER.World): RAPIER.RigidBody {
  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      // No linear damping: drag, Magnus lift and rolling resistance are forces applied each step.
      .setAngularDamping(BALL_ANGULAR_DAMPING)
      // Never sleeps: a resting ball must still react to players and touches.
      .setCanSleep(false)
      .setCcdEnabled(true), // fast shots must not tunnel through posts, boards or net
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setMass(BALL_MASS)
      .setRestitution(0.6)
      .setFriction(0.5)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    ball,
  );
  return ball;
}

/**
 * A player's body: a kinematic capsule moved by game code (movement and AI), which the
 * ball bounces off. Players never get pushed around by the physics engine.
 */
export function createPlayerBody(physics: Physics, id: number, x: number, z: number): RAPIER.RigidBody {
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, PLAYER_HEIGHT / 2, z),
  );
  const halfHeight = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
  const collider = physics.world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, PLAYER_RADIUS).setRestitution(0.3).setFriction(0.5),
    body,
  );
  physics.tags.set(collider.handle, 'player');
  physics.playerColliders.set(collider.handle, id);
  return body;
}
