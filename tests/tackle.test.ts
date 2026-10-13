import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { BALL_RADIUS } from '../src/constants';
import { IDLE } from '../src/sim/command';
import type { SimEvent } from '../src/sim/events';
import { AVERAGE, type Attributes, type PlayerSpec } from '../src/sim/player';
import type { Sim } from '../src/sim/sim';
import { approach, foulChance, winChance } from '../src/sim/tackle';
import { DIAMOND } from '../src/team/formation';
import { cmd, createSim, STEPS_PER_SECOND } from './helpers';

const pivot = DIAMOND.find((s) => s.role === 'pivot')!;

/** Player 0 (team 0) tackles player 1 (team 1), who is on the ball at the origin facing +X. */
function pair(tackler: Partial<Attributes> = {}, carrier: Partial<Attributes> = {}): PlayerSpec[] {
  return [
    { team: 0, role: 'pivot', slot: pivot, kickoff: { x: 1.5, z: 0 }, kickoffFacing: Math.PI, attrs: { ...AVERAGE, ...tackler } },
    { team: 1, role: 'pivot', slot: pivot, kickoff: { x: 0, z: 0 }, kickoffFacing: 0, attrs: { ...AVERAGE, ...carrier } },
  ];
}

/** Put the tackler at `angle` round the carrier (0 = in front of them), `distance` away, facing the carrier; the ball `gap` in front of the carrier, theirs. */
function setUp(sim: Sim, angle: number, distance: number, gap: number): void {
  const [t, c] = sim.players;
  t.pos.x = Math.cos(angle) * distance;
  t.pos.z = Math.sin(angle) * distance;
  t.facing = angle + Math.PI;
  c.pos.x = 0;
  c.pos.z = 0;
  c.facing = 0;
  for (const p of sim.players) p.body.setTranslation({ x: p.pos.x, y: 0.9, z: p.pos.z }, true);
  sim.placeBall({ x: gap, z: 0 });
  sim.possession.control(c.id);
}

/**
 * One tackle from the set-up, the carrier standing (`run` false) or dribbling on at a
 * jog: the tackle event, and the sim half a second later.
 */
async function tackle(seed: number, angle: number, distance: number, gap: number, specs = pair(), run = false) {
  // Spread the seeds out: the tackle may be the sim's first roll of the dice, and
  // mulberry32's first number from small neighbouring seeds isn't very random.
  const sim = await createSim(seed * 104729, specs);
  setUp(sim, angle, distance, gap);
  const carrier = sim.players[1];
  if (run) {
    carrier.speed = TUNING.locomotion.jogSpeed * TUNING.locomotion.onBallSpeed;
    const v = carrier.speed + TUNING.dribble.touchAhead;
    sim.ball.setLinvel({ x: v, y: 0, z: 0 }, true);
  }
  const carry = run ? cmd({ move: { x: 1, z: 0 } }) : IDLE;
  let event: Extract<SimEvent, { type: 'tackle' }> | null = null;
  for (let i = 0; i < 0.5 * STEPS_PER_SECOND; i++) {
    for (const e of sim.step([cmd({ tackle: i === 0 }), carry])) if (e.type === 'tackle') event = e;
  }
  return { sim, event };
}

/**
 * How often a tackle wins the ball: from `angle` round a carrier standing on it, or
 * head-on to one dribbling at a jog (`run`), the tackler meeting the ball about 0.8 m out.
 */
async function winRate(angle: number, specs = pair(), run = false, n = 40): Promise<number> {
  let won = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { event } = await tackle(seed, angle, run ? 2.1 : 1, run ? 0.7 : 0.4, specs, run);
    if (event?.outcome === 'won') won++;
  }
  return won / n;
}

describe('tackle chances', () => {
  it('reads the approach: head-on, side-on and from behind', async () => {
    const sim = await createSim(1, pair());
    for (const [angle, expected] of [
      [0, 1],
      [Math.PI / 2, 0],
      [Math.PI, -1],
    ]) {
      setUp(sim, angle, 1, 0.6);
      expect(approach(sim.players[0], sim.players[1])).toBeCloseTo(expected, 5);
    }
  });

  it('is best head-on and worst from behind', async () => {
    const sim = await createSim(1, pair());
    const chance = (angle: number) => {
      setUp(sim, angle, 1, 0.6);
      return winChance(sim.players[0], sim.players[1], { x: 0.6, z: 0 });
    };
    expect(chance(0)).toBeGreaterThan(chance(Math.PI / 2));
    expect(chance(Math.PI / 2)).toBeGreaterThan(chance(Math.PI));
    expect(chance(Math.PI)).toBeLessThan(chance(0) * 0.5);
  });

  it('is better with the ball off the carrier\'s feet', async () => {
    const sim = await createSim(1, pair());
    setUp(sim, 0, 1.5, 0.4);
    const [t, c] = sim.players;
    expect(winChance(t, c, { x: 0.9, z: 0 })).toBeGreaterThan(winChance(t, c, { x: 0.4, z: 0 }) * 1.8);
  });

  it('rises with tackling, and falls against a strong, tidy carrier', async () => {
    const chance = async (specs: PlayerSpec[]) => {
      const sim = await createSim(1, specs);
      setUp(sim, 0, 1.4, 0.6);
      return winChance(sim.players[0], sim.players[1], { x: 0.6, z: 0 });
    };
    const average = await chance(pair());
    expect(await chance(pair({ tackling: 0.9 }))).toBeGreaterThan(average * 1.2);
    expect(await chance(pair({}, { strength: 0.9, passing: 0.9 }))).toBeLessThan(average * 0.8);
  });

  it('fouls more from behind and at speed', async () => {
    const sim = await createSim(1, pair());
    const [t, c] = sim.players;
    setUp(sim, 0, 1, 0.6);
    const front = foulChance(t, c);
    setUp(sim, Math.PI, 1, 0.6);
    const behind = foulChance(t, c);
    t.speed = TUNING.locomotion.sprintSpeed;
    const behindAtSpeed = foulChance(t, c);
    expect(behind).toBeGreaterThan(front * 3);
    expect(behindAtSpeed).toBeGreaterThan(behind);
  });
});

describe('tackling in the sim', () => {
  it('wins the ball head-on more often than from the side', async () => {
    const head = await winRate(0, pair(), false, 100);
    const side = await winRate(Math.PI / 2, pair(), false, 100);
    expect(head).toBeGreaterThan(side + 0.05);
  });

  it('wins it off a dribbler about half the time', async () => {
    const rate = await winRate(0, pair(), true);
    expect(rate).toBeGreaterThan(0.35);
    expect(rate).toBeLessThan(0.8);
  });

  it('wins more often with a better tackler', async () => {
    const poor = await winRate(0, pair({ tackling: 0.1 }), true);
    const good = await winRate(0, pair({ tackling: 0.9 }), true);
    expect(good).toBeGreaterThan(poor + 0.15);
  });

  it('knocks a won ball loose, roughly along the tackle', async () => {
    let checked = 0;
    for (let seed = 1; seed <= 30 && checked < 5; seed++) {
      const sim = await createSim(seed, pair());
      setUp(sim, 0, 1.5, 0.7);
      let won = false;
      for (let i = 0; i < 0.3 * STEPS_PER_SECOND && !won; i++) {
        won = sim.step([cmd({ tackle: i === 0 }), IDLE]).some((e) => e.type === 'tackle' && e.outcome === 'won');
      }
      if (!won) continue;
      checked++;
      // The tackler faced -X: the ball goes that way, off to one side, and the carrier has lost it.
      const v = sim.ball.linvel();
      const speed = Math.hypot(v.x, v.z);
      expect(speed).toBeGreaterThan(1.5);
      expect(-v.x / speed).toBeGreaterThan(Math.cos((60 * Math.PI) / 180));
      expect(sim.possession.owner).not.toBe(1);
    }
    expect(checked).toBe(5);
  });

  it('meets nothing out of reach', async () => {
    const { sim, event } = await tackle(1, 0, 4, 0.6);
    expect(event?.outcome).toBe('missed');
    expect(sim.possession.owner).toBe(1);
  });

  it('fouls far more often from behind than from the front', async () => {
    let behind = 0;
    let front = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Out of reach of the ball but not of the man: a miss that can be a foul.
      if ((await tackle(seed, Math.PI, 1.2, 0.9)).event?.outcome === 'foul') behind++;
      if ((await tackle(seed, Math.PI / 2, 1.4, 0.9)).event?.outcome === 'foul') front++;
    }
    expect(behind).toBeGreaterThan(front * 2);
    expect(behind).toBeGreaterThan(5);
  });

  it('cannot tackle again while recovering', async () => {
    const sim = await createSim(1, pair());
    setUp(sim, 0, 4, 0.6);
    const tackles: number[] = [];
    for (let i = 0; i < 1.2 * STEPS_PER_SECOND; i++) {
      // Hammering the button every other step.
      const events = sim.step([cmd({ tackle: i % 2 === 0 }), IDLE]);
      if (events.some((e) => e.type === 'tackle')) tackles.push(i);
    }
    const T = TUNING.tackle;
    const gap = Math.round((T.duration + T.recovery) * STEPS_PER_SECOND);
    expect(tackles.length).toBeGreaterThanOrEqual(1);
    for (let k = 1; k < tackles.length; k++) expect(tackles[k] - tackles[k - 1]).toBeGreaterThanOrEqual(gap);
  });

  it('does nothing when the ball is dead', async () => {
    const sim = await createSim(1, pair());
    setUp(sim, 0, 1.5, 0.7);
    sim.ball.setTranslation({ x: 0.7, y: BALL_RADIUS, z: 0 }, true);
    // Out of play: a pending restart.
    Object.assign(sim.match, { phase: { kind: 'restart', restart: { kind: 'kickIn', at: { x: 0.7, z: 0 }, team: 1 } } });
    const events = [];
    for (let i = 0; i < 0.5 * STEPS_PER_SECOND; i++) events.push(...sim.step([cmd({ tackle: i === 0 }), IDLE]));
    expect(events.some((e) => e.type === 'tackle')).toBe(false);
  });
});
