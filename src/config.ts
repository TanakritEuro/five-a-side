// Gameplay tuning values. Everything you might want to tweak while playtesting lives
// here, so feel can be adjusted without hunting through the code.

export const TUNING = {
  locomotion: {
    /** Top speeds (m/s) for an average player. Real five-a-side: jog ~5, flat-out ~7.5. */
    jogSpeed: 5.5,
    sprintSpeed: 7.5,
    /** Acceleration (m/s²) up to jog speed, and from jog to sprint speed. */
    accel: 9,
    sprintAccel: 3.5,
    /** Braking (m/s²). */
    decel: 14,
    /** Turn rate (rad/s) when standing; it falls with speed: turnRate / (1 + turnSpeedFactor · speed). */
    turnRate: 14,
    turnSpeedFactor: 0.45,
    /** Below this speed (m/s) the player turns on the spot at the full rate. */
    pivotSpeed: 1,
    /** Top speed and turn rate multipliers while on the ball. */
    onBallSpeed: 0.92,
    onBallTurn: 0.8,
    /** How much the pace attribute moves speed and acceleration: ±this at 0 and 1. */
    paceSpread: 0.1,
  },
  stamina: {
    /** Stamina (0–1) used per second of sprinting: 1 / drain seconds from full to empty. */
    drain: 0.11,
    /** Stamina recovered per second when not sprinting. */
    recovery: 0.06,
    /** Below this, sprint speed fades towards jog speed. */
    tiredThreshold: 0.3,
  },
  ball: {
    /** Scales the Magnus force: 1 is physical, higher bends shots more. */
    curveStrength: 1.0,
    /** Cap on the lift coefficient, however fast the ball spins. */
    maxLiftCoefficient: 0.35,
    /** Bounce off the kickboards (combined with the ball's own via Min). */
    boardRestitution: 0.55,
    /** Bounce off the netting above the boards: it soaks up most of the pace. */
    cageRestitution: 0.1,
  },
  camera: {
    /** Broadcast camera: height and distance back from the near touchline (m). */
    height: 15,
    distance: 30,
    fov: 40,
    /** Weight of the ball (vs the controlled player) in the point the camera follows. */
    ballWeight: 0.5,
    /** How far the camera pans along the pitch towards that point (0 = fixed, 1 = locked on). */
    follow: 0.75,
    /** Smoothing: fraction of the remaining gap closed per second (higher = snappier). */
    lag: 4,
  },
};
