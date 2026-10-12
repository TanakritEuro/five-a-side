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
    /** ...and until it has been beside or behind them for this many seconds. */
    possessionLapse: 1.5,
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
    /**
     * With the ball in reach but more than this (degrees) off the way they want to go, a
     * dribbler goes round to get behind it first, swinging this far (m) out to the side.
     */
    behindAngle: 70,
    roundOffset: 0.35,
    /** A ball within this gap (m) of the boards is pinned: a dribbler drags it out at up to `pullSpeed` (m/s). */
    pinnedGap: 0.2,
    pullSpeed: 3,
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
    /** The same for a shot (a dribbler stops touching the ball while lining one up, and needs to catch it up). */
    shotBufferTime: 0.6,
    /** After kicking, the kicker can't touch the ball again for this long (s). */
    cooldown: 0.35,
  },
  pass: {
    /** A pass with nobody to aim at goes this far (m) along the way the passer faces. */
    length: 12,
    /** How fast a pass is still rolling when it arrives (m/s): this, plus `arrivalPerMetre` per metre of pass. */
    arrivalSpeed: 4,
    arrivalPerMetre: 0.12,
    /** Teammates within this half-angle (degrees) of the passer's facing can be picked as the receiver. */
    receiverCone: 35,
    /** Receivers are picked between these distances (m). */
    minDistance: 2.5,
    maxDistance: 26,
    /** A leading pass aims this fraction of the way to where the receiver is running to. */
    lead: 0.8,
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
    /** Seconds a human's call for a teammate to press (L) lasts. */
    pressCallTime: 3,
    /** Teammates within this distance (m) push each other apart when moving to spots. */
    separationRadius: 2.5,
    /** Close enough to a slot (m) to stand still. */
    slotTolerance: 0.4,
    /** A receiver may get to a pass this long (s) after the ball and still take it (it rolls on into reach). */
    receiveSlack: 0.3,
    /** Seconds before a player reacts to where the ball is going (in interception estimates). */
    reactionTime: 0.15,
    /** Re-predict the ball's path when it strays this far (m) from the last prediction. */
    pathTolerance: 0.3,
    /** AI on the ball: run at a spot this far (m) out from goal, then turn and shoot at the far corner... */
    shootingSpot: 7,
    /** ...and after this long (s) on the ball, pass to anyone (backwards too) or shoot from further out. */
    patience: 6,
    /** Shoot from within this distance (m) of the goal... */
    shootRange: 12,
    /** ...charging the shot to a power (0–1) between these, more from further out. */
    shotPower: [0.62, 0.78],
    /** An opponent this close (m) and ahead of the AI dribbler blocks the way: look for a pass. */
    blockedDistance: 2.5,
    /** A passing lane is open if no opponent is within this distance (m) of it. */
    laneWidth: 1.2,
    /** Turn to within this angle (degrees) of the receiver before passing. */
    passAim: 12,
    /** Keepers on the ball pass it on after this long (s). */
    keeperHold: 0.6,
    /** ...or clear it upfield if nobody is open after this long (s). */
    keeperClear: 2.5,
    /** Defending: the presser closes to this far (m) goal-side of the ball, the cover sits this far back... */
    pressDistance: 0.8,
    coverDistance: 4,
    /** ...markers stay this far (m) goal-side of their man, up to this much (m) towards the ball... */
    markDistance: 1.2,
    markBallSide: 0.6,
    /** ...and leave anyone further up the other end than this (fraction of the half-length) to the formation. */
    markZone: 0.3,
    /** Seconds after a turnover that everyone hurries (sprints) to their new job. */
    transitionTime: 1,
    /** The team brain re-plans every this many steps. */
    brainInterval: 6,
  },
  separation: {
    /** Minimum gap (m) kept between two players' capsules. */
    gap: 0.05,
    /** Players keep their bodies off a ball moving slower than this (m/s) and lower than this (m). */
    ballClearSpeed: 1,
    ballClearHeight: 1,
  },
  outcome: {
    /** Give up waiting and call a shot a miss after this many seconds of flight. */
    maxFlightTime: 4.0,
    /** After hitting the woodwork, settle once the ball drops below this speed (m/s)... */
    settleSpeed: 1.0,
    /** ...or once it has come back out this far from the goal line (m). */
    reboundDistance: 8.0,
  },
  match: {
    /** Game seconds per half. The clock only runs while the ball is in play. */
    halfLength: 180,
    /** Seconds of the half-time break. */
    halfTimePause: 4,
    /** Seconds between a goal and the kick-off. */
    goalDelay: 2.5,
    /** Seconds between the ball going over the netting and the set piece. */
    outDelay: 1.5,
    /** Opponents keep this far (m) from the ball at a kick-in or goal clearance. */
    setPieceDistance: 3,
    /** A restart's taker stands this far (m) behind the ball. */
    takerOffset: 0.6,
    /** An AI taker kicks after this many seconds. */
    aiTakerDelay: 0.8,
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
