import type { SimEvent } from '../sim/events';
import type { SoundEvent } from './sound';

/** What the cues need to know besides the event. */
export interface CueContext {
  teamOf: (player: number) => 0 | 1;
  /** The crowd's side (the human's team; the home team in AI v AI). */
  home: 0 | 1;
  /** How fast the ball is moving now (m/s). */
  ballSpeed: number;
}

/**
 * The sounds a simulation event makes: the ball and bodies, the referee's whistle, and the
 * crowd, which is on the home team's side (a roar for their goals, a groan when they
 * concede, "ooh" for their near things and relief when their keeper saves).
 */
export function cues(e: SimEvent, c: CueContext): SoundEvent[] {
  const ours = (player: number) => c.teamOf(player) === c.home;
  switch (e.type) {
    case 'kick':
      // A keeper throwing it out is quiet; a bowled ball or a kick thumps.
      if (e.path.points[0].y > 0.5) return [];
      return [{ name: 'kick', speed: e.kind === 'shoot' ? 14 + 16 * e.power : 8 }];
    case 'touch':
      if (e.kind === 'deflect') return [{ name: 'parry', speed: c.ballSpeed }];
      return [{ name: 'touch', speed: e.kind === 'dribble' ? 3 : c.ballSpeed }];
    case 'save':
      return [{ name: 'parry', speed: e.caught ? c.ballSpeed * 0.5 : c.ballSpeed }, { name: 'react', kind: ours(e.player) ? 'cheer' : 'ooh' }];
    case 'woodwork':
      return [{ name: 'woodwork', speed: c.ballSpeed }, { name: 'react', kind: 'ooh' }];
    case 'goal':
      return [{ name: 'net', speed: Math.max(c.ballSpeed, 8) }, { name: 'react', kind: e.team === c.home ? 'roar' : 'groan' }];
    case 'shot':
      return e.outcome.kind === 'miss' && ours(e.player) ? [{ name: 'react', kind: 'ooh' }] : [];
    case 'tackle':
      return e.outcome === 'won' ? [{ name: 'tackle', speed: 6 }] : [];
    case 'foul':
      return [{ name: 'tackle', speed: 8 }, { name: 'whistle' }];
    case 'restart':
      return e.restart.kind === 'kickoff' ? [{ name: 'whistle' }] : [];
    case 'halfTime':
      return [{ name: 'whistle', long: true }];
    case 'fullTime': {
      const [a, b] = e.score;
      const mine = c.home === 0 ? a - b : b - a;
      return [{ name: 'whistle', long: true }, ...(mine === 0 ? [] : [{ name: 'react' as const, kind: mine > 0 ? ('cheer' as const) : ('groan' as const) }])];
    }
    default:
      return [];
  }
}

/**
 * How excited the crowd is: from nothing with the ball in the home team's half to full as
 * it reaches the goal they attack. `ballX` is the ball's x, `attackDir` the way the home
 * team attacks.
 */
export function excitement(ballX: number, attackDir: 1 | -1): number {
  return Math.max(0, Math.min(1, (ballX * attackDir) / 16));
}
