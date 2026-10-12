import { TUNING } from '../config';
import { CENTRE_CIRCLE_RADIUS, HALF_LENGTH, HALF_WIDTH, PLAYER_RADIUS } from '../constants';
import { clamp, headingVec, type Vec2 } from '../math';
import { placePlayer, type Player } from './player';
import type { Restart } from './rules';

/** Where a player lines up for a kick-off in this half: their first-half spot, mirrored after half time. */
export function kickoffSpot(p: Player, half: 1 | 2): { pos: Vec2; facing: number } {
  const { kickoff, kickoffFacing } = p.spec;
  return half === 1
    ? { pos: { ...kickoff }, facing: kickoffFacing }
    : { pos: { x: -kickoff.x, z: -kickoff.z }, facing: kickoffFacing + Math.PI };
}

/**
 * Who takes a restart: for a goal clearance the keeper, otherwise the restart team's
 * outfield player nearest the ball (anyone, if they have no outfield players).
 */
export function chooseTaker(players: readonly Player[], restart: Restart): number | null {
  const team = players.filter((p) => p.team === restart.team);
  if (restart.kind === 'goalClearance') {
    const keeper = team.find((p) => p.spec.role === 'keeper');
    if (keeper) return keeper.id;
  }
  const outfield = team.filter((p) => p.spec.role !== 'keeper');
  const pool = outfield.length > 0 ? outfield : team;
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of pool) {
    const d = Math.hypot(p.pos.x - restart.at.x, p.pos.z - restart.at.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best?.id ?? null;
}

/** The way a taker starts out facing: forward at a kick-off or goal clearance, forward and infield at a kick-in. */
export function takerFacing(restart: Restart, attackDir: 1 | -1): number {
  if (restart.kind !== 'kickIn') return attackDir === 1 ? 0 : Math.PI;
  return Math.atan2(-Math.sign(restart.at.z), attackDir);
}

/**
 * Keep everyone where the laws say while a restart waits to be taken. The taker stands
 * just behind the ball (they can turn, which walks them round it, but not run off with
 * it). At a kick-off everyone stays in their own half and the other team stays out of
 * the centre circle; at a set piece the other team keeps `setPieceDistance` away.
 */
export function holdRestartShape(
  players: readonly Player[],
  restart: Restart,
  taker: number | null,
  ball: Vec2,
  attackDir: (team: 0 | 1) => 1 | -1,
): void {
  const M = TUNING.match;
  const maxX = HALF_LENGTH - PLAYER_RADIUS;
  const maxZ = HALF_WIDTH - PLAYER_RADIUS;
  for (const p of players) {
    if (p.id === taker) {
      const f = headingVec(p.facing);
      p.pos.x = clamp(ball.x - f.x * M.takerOffset, -maxX, maxX);
      p.pos.z = clamp(ball.z - f.z * M.takerOffset, -maxZ, maxZ);
      p.speed = 0;
      p.vel.x = 0;
      p.vel.z = 0;
      continue;
    }
    const opponent = p.team !== restart.team;
    if (restart.kind === 'kickoff') {
      // Own half (x · attackDir ≤ 0), not touching the halfway line.
      const dir = attackDir(p.team);
      if (p.pos.x * dir > -PLAYER_RADIUS) p.pos.x = -dir * PLAYER_RADIUS;
      if (opponent) keepAway(p, ball, CENTRE_CIRCLE_RADIUS + PLAYER_RADIUS);
    } else if (opponent) {
      keepAway(p, ball, M.setPieceDistance);
    }
    p.pos.x = clamp(p.pos.x, -maxX, maxX);
    p.pos.z = clamp(p.pos.z, -maxZ, maxZ);
  }
}

/** Push `p` out to at least `distance` from `from`, straight away from it. */
function keepAway(p: Player, from: Vec2, distance: number): void {
  const dx = p.pos.x - from.x;
  const dz = p.pos.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d >= distance) return;
  // Dead on the spot: step back towards their own goal side (−X), deterministically.
  const ux = d > 1e-6 ? dx / d : -1;
  const uz = d > 1e-6 ? dz / d : 0;
  p.pos.x = from.x + ux * distance;
  p.pos.z = from.z + uz * distance;
}

/** Line a player up for the kick-off, or put the taker behind the ball. */
export function placeForRestart(p: Player, restart: Restart, taker: number | null, half: 1 | 2, attackDir: 1 | -1): void {
  if (p.id === taker) {
    const facing = takerFacing(restart, attackDir);
    const f = headingVec(facing);
    const offset = TUNING.match.takerOffset;
    placePlayer(p, { x: restart.at.x - f.x * offset, z: restart.at.z - f.z * offset }, facing);
  } else if (restart.kind === 'kickoff') {
    const spot = kickoffSpot(p, half);
    placePlayer(p, spot.pos, spot.facing);
  } else {
    p.charge = null;
    p.pendingKick = null;
  }
}

/**
 * Turn a kick-off taker to face their nearest outfield teammate. Everyone else is
 * behind the ball at a kick-off, so facing forward, a plain J tap would roll it straight
 * to the opposition. Call once everyone is on their kick-off spot; `holdRestartShape`
 * then puts the taker behind the ball on the new line.
 */
export function faceNearestTeammate(players: readonly Player[], taker: number | null): void {
  if (taker === null) return;
  const p = players[taker];
  let nearest: Player | null = null;
  let best = Infinity;
  for (const q of players) {
    if (q.team !== p.team || q.id === p.id || q.spec.role === 'keeper') continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    if (d < best) {
      best = d;
      nearest = q;
    }
  }
  if (nearest) p.facing = Math.atan2(nearest.pos.z - p.pos.z, nearest.pos.x - p.pos.x);
}
