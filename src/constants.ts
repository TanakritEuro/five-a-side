// Fixed dimensions, in metres / kilograms / seconds. Gameplay knobs live in config.ts.
//
// World axes: +Y up. The pitch's long axis is X, its centre spot is the origin, and the
// goal lines are at x = ±HALF_LENGTH. The main camera sits on the +Z touchline side.
// In the first half the home team attacks +X (left to right on screen).

/** Playing area, board to board. A walled ("cage") pitch: no throw-ins or corners. */
export const PITCH_LENGTH = 40;
export const PITCH_WIDTH = 20;
export const HALF_LENGTH = PITCH_LENGTH / 2;
export const HALF_WIDTH = PITCH_WIDTH / 2;

/** Solid kickboards around the pitch: the ball rebounds off these and stays in play. */
export const BOARD_HEIGHT = 1.2;
export const BOARD_THICKNESS = 0.1;
/** Netting above the boards. A ball that clears it is out (a goal kick or kick-in). */
export const CAGE_HEIGHT = 5;

export const GOAL_WIDTH = 3; // inside post to inside post (futsal size)
export const GOAL_HEIGHT = 2; // ground to underside of crossbar
export const GOAL_DEPTH = 1.0; // how far the net extends behind the goal line
export const POST_RADIUS = 0.04; // 8 cm posts

/** Goal area: quarter circles of this radius around each post, joined by a straight line. */
export const GOAL_AREA_RADIUS = 6;
export const PENALTY_SPOT_DISTANCE = 6;
export const CENTRE_CIRCLE_RADIUS = 3;

export const BALL_RADIUS = 0.11;
export const BALL_MASS = 0.43;

export const GRAVITY = -9.81;
export const PHYSICS_STEP = 1 / 60;

// Ball aerodynamics (see ball/aero.ts).
export const AIR_DENSITY = 1.2; // kg/m³ at sea level, ~20 °C
/** Drag coefficient of a football at shooting speeds (past the drag crisis). */
export const BALL_DRAG_COEFFICIENT = 0.25;
export const BALL_CROSS_SECTION = Math.PI * BALL_RADIUS * BALL_RADIUS;
/** Rapier angular damping on the ball: spin bleeds off slowly in flight. */
export const BALL_ANGULAR_DAMPING = 0.2;

// Player body: a capsule for movement and collisions. Origin at the feet.
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.3;

export const PLAYERS_PER_SIDE = 5;
