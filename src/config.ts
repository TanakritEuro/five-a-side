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
  dribble: {
    /** The last player to control the ball keeps possession while within this distance of it (m). */
    possessionRange: 2,
    /** Furthest the ball can be from a player's centre for them to play it with their feet (m). */
    reach: 0.95,
    /** Half-angle (degrees) of the cone in front of a player inside which they can play the ball. */
    frontCone: 75,
    /** Highest the ball's centre can be for a foot touch (m). Chest and thigh control come later. */
    maxHeight: 0.5,
    /** A dribbler takes a touch once the ball is this close in front of them (m). */
    touchDistance: 0.65,
    /** How much faster than the player (m/s) a touch sends the ball, jogging and sprinting. */
    touchAhead: 0.9,
    sprintTouchAhead: 3.2,
    /** Furthest a touch can send the ball (degrees) off the way the player faces, when turning. */
    touchTurn: 60,
    /** Retake a touch if the ball is rolling more than this far (degrees) off the way the player wants to go. */
    redirectAngle: 25,
    /**
     * A dribbler turning more than this (degrees) away from a ball that's out of reach goes
     * to the ball first, aiming this many seconds ahead of it.
     */
    chaseAngle: 45,
    chaseLead: 0.15,
    /** Seconds between touches. */
    touchCooldown: 0.2,
    /** Random error (radians, standard deviation) on the direction of a touch. */
    touchNoise: 0.04,
    /** Standing on the ball: fraction of its movement killed per second. */
    trapRate: 10,
    /** Fastest a ball can be coming at a player (relative, m/s) for them to control it. */
    receiveSpeed: 12,
    /** Fraction of the incoming relative speed left after a controlling first touch. */
    receiveKeep: 0.15,
  },
  kick: {
    /** Seconds a released kick waits for the ball to come into reach before it's dropped. */
    bufferTime: 0.35,
    /** After kicking, the kicker can't touch the ball again for this long (s). */
    cooldown: 0.35,
  },
  pass: {
    /** Ground pass (no receivers yet): how far it goes (m) and how fast it's still rolling there (m/s). */
    length: 12,
    arrivalSpeed: 5,
    /** Direction error (radians, standard deviation) for an average passer. */
    scatter: 0.035,
    /** How much the passing attribute moves that error: ±this at 0 and 1. */
    passingSpread: 0.5,
  },
  shot: {
    /** Seconds of holding the button to go from zero to full power. */
    chargeTime: 1.0,
    /** Ball speed (m/s) at zero and full power. */
    minSpeed: 14,
    maxSpeed: 30,
    /**
     * Power (0–1) above which the shot starts to lose accuracy. Between this and full
     * power the error ramps up from nothing to the full drift values below.
     */
    overpowerThreshold: 0.8,
    /** Exponent applied to the overpower fraction: >1 keeps a little overpower forgiving. */
    overpowerCurve: 1.6,
    /** Extra height (m) added to the target at full overpower. */
    overpowerHighDrift: 1.4,
    /** Extra sideways drift (m, away from the centre of the goal) at full overpower. */
    overpowerWideDrift: 1.2,
    /** Random scatter (m, standard deviation) on every shot from 10 m; it grows with distance. */
    baseScatter: 0.15,
    /** Random scatter (m, standard deviation) added at full overpower, from 10 m. */
    overpowerScatter: 0.4,
    /** Bottom of the meter's sweet spot: from here to overpowerThreshold is real pace, no drift. */
    sweetSpot: 0.6,
    /** Target height (m) at the goal line at zero and full power. */
    minHeight: 0.3,
    maxHeight: 1.4,
    /** Facing within this far (m) outside a post counts as shooting at goal: aim inside the post. */
    aimMargin: 2.5,
    /** Aim no closer than this (m) to the inside of a post. */
    postInset: 0.35,
    /** A shot not at goal is aimed this far (m) along the facing direction. */
    range: 25,
    /**
     * Steepest launch (degrees) for an aimed shot. A soft shot from distance would have to
     * be lobbed to reach the target, so it's hit as a low drive along the ground instead.
     */
    maxLoft: 15,
    lowDriveLoft: 3,
    /** How much the shooting attribute moves pace (±this) and scatter (±2× this). */
    shootingSpread: 0.08,
  },
  spin: {
    /** Spin (rad/s) from striking the edge of the contact circle at full power. Rapier caps spin at 47. */
    maxSpin: 45,
    /** Furthest the contact point can go from the centre (fraction of the radius). */
    maxOffset: 0.8,
    /** Fraction of the ball speed lost at maximum offset (it scales with offset squared). */
    powerLoss: 0.1,
    /** Extra random scatter (m, standard deviation) at maximum offset. */
    extraScatter: 0.25,
    /** Sidespin contact (fraction of the radius) on a shot aimed near a post, curling it back in. */
    autoCurl: 0.35,
  },
  formation: {
    /** How far slots slide up and down the pitch with the ball (in half-lengths, per half-length the ball moves). */
    followBall: 0.45,
    /** How far slots slide across with the ball (in half-widths, per half-width). */
    followBallAcross: 0.3,
    /** Width of the shape (multiplies each slot's `across`). */
    width: 1,
    /** In possession the shape pushes up this far (half-lengths); out of possession it drops back. */
    pushUp: 0.12,
    dropBack: 0.08,
    /** Outfield slots stay inside these fractions of the half-length and half-width. */
    maxForward: 0.85,
    maxAcross: 0.8,
  },
  ai: {
    /** Steering: start slowing this far (m) from the target. */
    arriveRadius: 2.5,
    /** Sprint to a target further than this (m). */
    sprintDistance: 9,
    /** Close enough to a slot (m) to stand still. */
    slotTolerance: 0.4,
    /** The team brain re-plans every this many steps. */
    brainInterval: 6,
  },
  separation: {
    /** Minimum gap (m) kept between two players' capsules. */
    gap: 0.05,
  },
  outcome: {
    /** Give up waiting and call a shot a miss after this many seconds of flight. */
    maxFlightTime: 4.0,
    /** After hitting the woodwork, settle once the ball drops below this speed (m/s)... */
    settleSpeed: 1.0,
    /** ...or once it has come back out this far from the goal line (m). */
    reboundDistance: 8.0,
  },
  rules: {
    /** Seconds between a goal and the kick-off. */
    goalDelay: 2.5,
    /** Seconds between the ball going over the netting and the restart. */
    outDelay: 1.5,
    /** Seconds everyone stands still at a restart before play resumes. */
    restartFreeze: 0.6,
  },
  ball: {
    /** Scales the Magnus force: 1 is physical, higher bends shots more. */
    curveStrength: 1.0,
    /** Deceleration (m/s²) of a ball rolling on the turf. Rapier has none of its own. */
    rollingResistance: 1.0,
    /**
     * Horizontal speed lost on landing per m/s of vertical impact speed: friction μ times
     * (1 + restitution). A low drive keeps most of its pace; a dropping ball checks up.
     */
    bounceGrip: 0.6,
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
