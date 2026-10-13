// Gameplay tuning values. Everything you might want to tweak while playtesting lives
// here, so feel can be adjusted without hunting through the code.

/** How sharp an AI team is. See `TUNING.levels`. */
export interface AiLevel {
  /** Seconds after getting the ball before the first decision on it. */
  reaction: number;
  /** Seconds between decisions on the ball. */
  decisionInterval: number;
  /** Gaussian noise (standard deviation) on option utilities: bigger picks worse options more often. */
  noise: number;
  /** How safe (s of margin over the defence) a pass must look before it's considered on. */
  passMargin: number;
  /** The keeper's level (dive reading, reach, reaction). */
  keeper: KeeperLevelName;
  /** Added to every player's ratings (0–1 attributes), clamped: a sharper team is also quicker and more accurate. */
  attributes: number;
  /** Steps between the team brain's re-plans: how fast the team as a whole reacts. */
  brainInterval: number;
  /** A presser goes in for the tackle only when they rate their chance (0–1) of winning it at least this... */
  tackleChance: number;
  /** ...and then at this rate (per second): how quickly they spot the moment. */
  tackleRate: number;
}

export type KeeperLevelName = 'easy' | 'normal' | 'hard';

export interface KeeperLevel {
  /** Seconds after the shot before the keeper moves. */
  reactionTime: number;
  /** Chance (0–1) the keeper reads the shot instead of guessing (plus `openPlayRead`). */
  readChance: number;
  /** How far off (m, standard deviation) a read keeper's target is. */
  readError: number;
  /** Seconds for a full dive, launch to full stretch. */
  diveTime: number;
  /** How far the keeper's centre of mass can travel in a dive (m): their reach. */
  maxDive: number;
  /** Fastest ball (m/s) the keeper catches; faster ones are parried. */
  catchSpeed: number;
}
export type LevelName = 'easy' | 'normal' | 'hard';

const LEVELS: Record<LevelName, AiLevel> = {
  easy: { reaction: 0.35, decisionInterval: 0.3, noise: 0.4, passMargin: -0.15, keeper: 'easy', attributes: -0.2, brainInterval: 12, tackleChance: 0.2, tackleRate: 1.5 },
  normal: { reaction: 0.3, decisionInterval: 0.25, noise: 0.18, passMargin: 0.1, keeper: 'normal', attributes: 0, brainInterval: 6, tackleChance: 0.35, tackleRate: 2.5 },
  hard: { reaction: 0.25, decisionInterval: 0.25, noise: 0.08, passMargin: 0.1, keeper: 'hard', attributes: 0.12, brainInterval: 4, tackleChance: 0.4, tackleRate: 4 },
};

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
    /**
     * First touch: the fraction of the incoming (relative) pace the ball keeps, knocked on
     * ahead of the receiver, rises from `touchKeep[0]` for a gentle ball to `touchKeep[1]`
     * for one at `receiveSpeed`, for an average receiver; worse control keeps more.
     */
    touchKeep: [0.05, 0.4],
    /** ...and comes off at up to this angle (radians, standard deviation) from their facing. */
    touchSpread: 0.6,
    /** How much the passing (control) rating moves the touch: ±this at 0 and 1. */
    controlSpread: 0.6,
  },
  tackle: {
    /** Seconds of lunge, and when in it (s) the tackle meets the ball. */
    duration: 0.35,
    contactTime: 0.12,
    /** Afterwards, seconds of recovery (slowed, can't tackle again), moving at this fraction of the asked-for move. */
    recovery: 0.6,
    recoverMove: 0.4,
    /** How far (m) from the tackler's centre, and in what half-angle (degrees) in front, the ball can be won. */
    reach: 1.3,
    cone: 70,
    /** The lunge goes at the ball if it's within this distance (m) and half-angle (degrees) in front. */
    aimRange: 2.2,
    aimCone: 60,
    /** Highest the ball's centre can be (m) to be tackled. */
    maxHeight: 0.6,
    /** A carrier this much further away than `reach` (m) can still be caught by a tackle that misses the ball. */
    bodyReach: 0.4,
    /** Chance of winning the ball off an average carrier, head-on, with it away from their feet. */
    base: 0.65,
    /** The angle factor from directly behind the carrier (1 head-on). */
    fromBehind: 0.35,
    /** Ball this close to the carrier (m) is at their feet (timing factor `tightTiming`); this far, off them (1). */
    atFeet: 0.45,
    offFeet: 0.85,
    tightTiming: 0.45,
    /** How much ratings move the chance: the tackler's `tackling` against the carrier's `strength` and `passing`. */
    ratingSpread: 0.35,
    minChance: 0.05,
    maxChance: 0.9,
    /** Chance of getting a foot to a loose ball in reach. */
    looseBall: 0.85,
    /** Foul chance for a missed tackle with the carrier in reach: base, plus from behind, plus at full sprint. */
    foulBase: 0.1,
    foulBehind: 0.5,
    foulSpeed: 0.2,
    /** A won ball is poked this fast (m/s, ±30%) at this angle (degrees, ± spread) off the tackle's line. */
    pokeSpeed: 3.5,
    pokeAngle: 25,
    pokeSpread: 12,
    /** After winning it, seconds before the tackler, and the beaten carrier, can touch the ball. */
    afterWin: 0.12,
    beaten: 0.4,
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
    baseScatter: 0.22,
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
    /** AI on the ball: carry it to a spot this far (m) out from goal, then turn to the far corner. */
    shootingSpot: 7,
    /** AI shot power rises from `shotPower[0]` up close to `shotPower[1]` from this far out (m). */
    shootRange: 12,
    /** An AI shooter who hasn't got the shot away after this long (s) gives up on it. */
    shotTimeout: 1.6,
    /** Power (0–1) range for AI shots. */
    shotPower: [0.62, 0.78],
    /** An opponent this close (m) and ahead of the AI dribbler is in the way: go round them. */
    blockedDistance: 2.5,
    /** A passing lane is open if no opponent is within this distance (m) of it. */
    laneWidth: 1.2,
    /** Turn to within this angle (degrees) of the receiver before passing. */
    passAim: 12,
    /** Keepers on the ball pass it on after this long (s). */
    keeperHold: 0.6,
    /** ...or clear it upfield if nobody is open after this long (s). */
    keeperClear: 2.5,
    /** A presser goes in from behind the carrier (see `approach`, below this) only when they're within this far (m) of goal. */
    behindTackle: -0.3,
    throughOnGoal: 10,
    /** At a free kick this close (m) to their goal, defenders put two players in a wall, this far (m) apart. */
    wallRange: 12,
    wallSpacing: 0.7,
    /** Defending: the presser closes to this far (m) goal-side of the ball, the cover sits this far back... */
    pressDistance: 0.8,
    coverDistance: 4,
    /** ...markers stay this far (m) goal-side of their man, up to this much (m) towards the ball... */
    markDistance: 1.2,
    markBallSide: 0.6,
    /** Markers aim this many seconds ahead of their man. */
    markLead: 0.4,
    /** ...and leave anyone further up the other end than this (fraction of the half-length) to the formation. */
    markZone: 0.3,
    /** Seconds after a turnover that everyone hurries (sprints) to their new job. */
    transitionTime: 1,
  },
  /** AI difficulty levels (`?difficulty=`). */
  levels: LEVELS,
  /** Utility weights for the AI's on-ball decisions (ai/decide.ts). */
  decide: {
    /** Opponents within this distance (m) put the player under pressure. */
    pressureRange: 3,
    /** Angle on goal (radians) that counts as a full view of it. */
    fullAngle: 0.5,
    /** Shots: from no further than this (m), best from this close or closer. */
    maxShotRange: 15,
    shotIdeal: 6,
    /** A shooting lane is clear with nobody within this distance (m) of it, the keeper this far off it. */
    laneClear: 1.2,
    keeperClear: 1.2,
    /** Option weights. */
    shoot: 3.5,
    pass: 1,
    dribble: 1,
    /** Pass terms: progress up the pitch, the receiver's space and angle on goal, and a base value. */
    progress: 1.2,
    open: 0.5,
    threat: 0.6,
    passBase: 0.3,
    /** Seconds of pass safety over the margin that count as fully safe. */
    safetyScale: 0.5,
    /** The receiver's space counts up to this (m). */
    openCap: 5,
    /** Subtracted from passes back to the keeper, and from passes that don't look safe. */
    keeperPass: 0.4,
    unsafe: 1.5,
    /** Dribbling: space ahead counts up to this (m), within this half-angle (degrees) of the way to goal. */
    spaceAhead: 6,
    aheadCone: 40,
  },
  support: {
    /** Candidate spots: a grid this many metres apart, from this far behind the ball, kept this far off the boards. */
    grid: 3,
    behind: 6,
    margin: 1.5,
    /** Spots between these distances (m) from the ball, ideally this far. */
    minDistance: 4,
    maxDistance: 18,
    ideal: 10,
    /** Space counts up to this distance (m) from the nearest opponent. */
    spaceCap: 5,
    /** Supporters take spots at least this far (m) apart. */
    spacing: 4.5,
    /** A supporter keeps their spot while it scores within this much of the best spot. */
    stickiness: 0.6,
    /** Score weights: pass safety, angle on goal, passing distance, space, progress. */
    wSafety: 2,
    wAngle: 2,
    wDistance: 1,
    wSpace: 1,
    wProgress: 1,
    /** A supporter whose spot is this far (m) ahead of the ball sprints there (a run). */
    runDistance: 6,
    /** The intended receiver of a pass goes for it unless someone else gets there this much (s) sooner. */
    receiverPreference: 0.5,
  },
  separation: {
    /** Minimum gap (m) kept between two players' capsules. */
    gap: 0.05,
    /** Players keep their bodies off a ball moving slower than this (m/s) and lower than this (m). */
    ballClearSpeed: 1,
    ballClearHeight: 2,
    /**
     * Opponents who meet share the push by weight: `strength` moves it ±this, and
     * running at full sprint adds this much more (momentum).
     */
    strengthSpread: 0.5,
    momentum: 0.5,
    /**
     * In a shoulder challenge (the ball carrier and an opponent in contact), the heavier
     * one also shoves the other off their line at up to this speed (m/s), scaled by how
     * much heavier they are.
     */
    shove: 4,
  },
  keeper: {
    /** Per level (ported from the penalty game, then given open-play extras). */
    levels: {
      easy: { reactionTime: 0.2, readChance: 0.3, readError: 0.6, diveTime: 0.62, maxDive: 1.8, catchSpeed: 9 },
      normal: { reactionTime: 0.1, readChance: 0.45, readError: 0.4, diveTime: 0.5, maxDive: 2.05, catchSpeed: 11 },
      hard: { reactionTime: 0.06, readChance: 0.6, readError: 0.25, diveTime: 0.45, maxDive: 2.2, catchSpeed: 13 },
    } as Record<KeeperLevelName, KeeperLevel>,
    /**
     * In open play a keeper sees the shot coming more often than at a penalty: added to
     * every level's read chance.
     */
    openPlayRead: 0.35,
    /** When guessing, chance the keeper stays in the middle instead of picking a side. */
    guessCentreChance: 0.2,
    /** Targets within this distance of the keeper (m) are covered standing or jumping. */
    centreBand: 0.55,
    /** Highest the keeper can jump off the ground (m). */
    maxJump: 0.45,
    /** The shortest dive takes this fraction of the full dive time. */
    shortDive: 0.45,
    /** Seconds to drop to the ground after a dive, then to stay down before getting up. */
    landTime: 0.35,
    downTime: 0.5,
    /** React to a ball whose path crosses the goal mouth (plus this margin, m) within this long (s). */
    shotHorizon: 1.5,
    frameMargin: 0.5,
    /** Hold a caught ball at least this long (s), and at most this long (futsal allows 4 s)... */
    holdTime: 1,
    maxHold: 3,
    /** ...waiting for a teammate this safe (s of margin over the opposition) to throw it to. */
    safeDistribution: 0.4,
    /** Opponents this close (m) don't count against a throw: it goes over them. */
    throwOver: 2.5,
    /** Distribute by throwing beyond this distance (m), rolling it out nearer. Throws travel at this horizontal speed (m/s). */
    throwDistance: 12,
    throwSpeed: 14,
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
    /** Seconds between the whistle for a foul and the free kick or penalty. */
    foulDelay: 1.5,
    /** Opponents keep this far (m) from the ball at a kick-in or goal clearance... */
    setPieceDistance: 3,
    /** ...and at a free kick. */
    freeKickDistance: 4,
    /** At a penalty everyone else stands at least this far (m) behind the spot. */
    penaltyBehind: 1,
    /** ...and the defending keeper stands on the line, this far (m) in front of it. */
    keeperOnLine: 0.3,
    /** A restart's taker stands this far (m) behind the ball. */
    takerOffset: 0.6,
    /** An AI taker kicks after this many seconds... */
    aiTakerDelay: 0.8,
    /** ...but at a free kick waits for the other team's wall to set, up to this many seconds. */
    aiWallWait: 3,
    /** A penalty taker aims by turning (A/D) at this rate (rad/s), up to this far (rad) either side of the middle of the goal. */
    penaltyTurnRate: 0.8,
    penaltyMaxAim: 0.3,
    /** AI penalty power (0–1). */
    penaltyPower: 0.72,
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
    height: 13,
    distance: 24,
    fov: 34,
    /** Weight of the ball (vs the controlled player) in the point the camera follows. */
    ballWeight: 0.5,
    /** The camera pans until this far (m) beyond each end wall reaches the edge of the picture. */
    endMargin: 2,
    /** Smoothing: fraction of the remaining gap closed per second (higher = snappier). */
    lag: 4,
  },
  director: {
    /**
     * Action camera (C): this far behind the play, up, out towards the near touchline (m),
     * looking this far ahead of it; never closer than `inside` to the boards.
     */
    action: { fov: 50, back: 8, height: 5.5, side: 7, ahead: 4, ballWeight: 0.5, lag: 3, inside: 1.5 },
    /**
     * After a goal: a low camera beside the net for `netTime` game seconds (this far back
     * from the line, up, and out to the side), then one circling the scorer.
     */
    goal: { fov: 38, netTime: 1.1, netBack: 3, netHeight: 2.8, netSide: 7.5, orbitRadius: 4.2, orbitHeight: 1.7, orbitStart: 0.6, orbitSpeed: 0.35 },
    /** Full time: the whole pitch from high up. */
    wide: { fov: 45, height: 26, distance: 34 },
    /** Replays: high behind the goal, or low beside its line on the near side. */
    replay: { fov: 42, behind: 6, behindHeight: 5, sideBack: 3, sideHeight: 1.4, side: 12 },
    /** Shake on the woodwork: peak angle (rad) at `referenceSpeed` (m/s), decay (s) and frequency (Hz). */
    shake: { angle: 0.012, referenceSpeed: 25, decay: 0.22, frequency: 24 },
  },
};
