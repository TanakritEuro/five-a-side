import { describe, expect, it } from 'vitest';
import { Animator } from '../src/characters/animator';
import { cyclePose, FOLLOW, gaitStyle, STRIKE, strideLength } from '../src/characters/poses';
import { JOINTS, type Pose } from '../src/characters/rig';
import { emptyView, type PlayerView } from '../src/render/interpolate';

const TAU = 2 * Math.PI;

/** Run an animator along +X at `speed` for `seconds` at `fps`; returns the total phase advanced (rad). */
function run(speed: number, seconds: number, fps: number, animator = new Animator()): number {
  const view: PlayerView = { ...emptyView(), speed };
  const dt = 1 / fps;
  let total = 0;
  let last = animator.phase;
  animator.step(view, dt);
  for (let i = 0; i < seconds * fps; i++) {
    view.x += speed * dt;
    view.now += dt;
    animator.step(view, dt);
    total += (animator.phase - last + TAU) % TAU;
    last = animator.phase;
  }
  return total;
}

function finite(pose: Pose): boolean {
  return JOINTS.every((j) => {
    const r = pose.joints[j];
    return !r || [r.x ?? 0, r.y ?? 0, r.z ?? 0].every((a) => Number.isFinite(a) && Math.abs(a) < Math.PI);
  });
}

describe('animator', () => {
  it('advances the stride with distance, not time', () => {
    // Standing still: no strides.
    expect(run(0, 1, 60)).toBe(0);
    // The same run at different frame rates covers the same number of strides...
    const at60 = run(5, 2, 60);
    expect(run(5, 2, 144)).toBeCloseTo(at60, 3);
    // ...one per stride length.
    expect(at60 / TAU).toBeCloseTo(10 / strideLength(5), 1);
    // Twice as far, twice the strides.
    expect(run(5, 4, 60)).toBeCloseTo(2 * at60, 2);
  });

  it('takes quicker strides when running faster', () => {
    const cadence = (speed: number) => run(speed, 2, 60) / TAU / 2;
    expect(cadence(7.5)).toBeGreaterThan(cadence(5));
    expect(cadence(5)).toBeGreaterThan(cadence(2));
    // A sprint is about two strides (four steps) a second.
    expect(cadence(7.5)).toBeGreaterThan(1.8);
    expect(cadence(7.5)).toBeLessThan(2.8);
  });

  it("doesn't run across a teleport (a restart)", () => {
    const a = new Animator();
    const view: PlayerView = { ...emptyView(), speed: 0 };
    a.step(view, 1 / 60);
    const before = a.phase;
    view.x = 12;
    a.step(view, 1 / 60);
    expect(a.phase).toBe(before);
  });

  it('blends the gait continuously from walk to sprint', () => {
    let prev = cyclePose(1, gaitStyle(0));
    for (let speed = 0.05; speed <= 8; speed += 0.05) {
      const pose = cyclePose(1, gaitStyle(speed));
      expect(finite(pose)).toBe(true);
      for (const j of JOINTS) {
        expect(Math.abs((pose.joints[j]?.x ?? 0) - (prev.joints[j]?.x ?? 0))).toBeLessThan(0.1);
      }
      prev = pose;
    }
    expect(gaitStyle(1)).toBe(0);
    expect(gaitStyle(5)).toBeCloseTo(1, 1);
    expect(gaitStyle(7.5)).toBe(2);
  });

  it('keeps every pose finite and the bank modest, whatever the player does', () => {
    const a = new Animator();
    const view: PlayerView = emptyView();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      view.speed = rnd() * 8;
      view.facing += (rnd() - 0.5) * 0.6;
      view.x += Math.cos(view.facing) * view.speed / 60;
      view.z += Math.sin(view.facing) * view.speed / 60;
      view.sprinting = rnd() < 0.3;
      view.now += 1 / 60;
      if (rnd() < 0.05) view.action = { kind: 'touch', tick: Math.round(view.now * 60) };
      const frame = a.step(view, 1 / 60);
      expect(finite(frame.pose)).toBe(true);
      expect(Math.abs(frame.bank)).toBeLessThanOrEqual(0.35);
      expect(Number.isFinite(frame.pose.rootY ?? 0)).toBe(true);
    }
  });

  it('flicks the right foot out on a dribble touch', () => {
    const view: PlayerView = { ...emptyView(), speed: 4, now: 10 };
    const plain = new Animator().step(view, 1 / 60);
    const touched = new Animator().step({ ...view, action: { kind: 'touch', tick: Math.round((10 - 0.14) * 60) } }, 1 / 60);
    expect(touched.pose.joints.hipR!.x!).toBeGreaterThan(plain.pose.joints.hipR!.x! + 0.3);
  });
});

describe('actions', () => {
  const at = (kind: NonNullable<PlayerView['action']>['kind'], age: number, extra: Partial<PlayerView> = {}): PlayerView => ({
    ...emptyView(),
    now: 100,
    action: { kind, tick: Math.round((100 - age) * 60) },
    ...extra,
  });
  const hipR = (view: PlayerView) => new Animator().step(view, 1 / 60).pose.joints.hipR?.x ?? 0;

  it("puts a shot's contact pose on the kick's tick, then follows through and lets go", () => {
    expect(hipR(at('shot', 0))).toBeCloseTo(STRIKE.joints.hipR!.x!, 5);
    expect(hipR(at('shot', 0.25))).toBeCloseTo(FOLLOW.joints.hipR!.x!, 5);
    // Back to standing by 0.65 s.
    expect(hipR(at('shot', 0.7))).toBeCloseTo(hipR(emptyView()), 5);
  });

  it('draws the leg back while a shot is charged', () => {
    expect(hipR({ ...emptyView(), charge: 0.6 })).toBeLessThan(-0.4);
  });

  it('lunges while tackling and gets back up after', () => {
    const lunging = hipR({ ...emptyView(), tackle: 0.15 });
    expect(lunging).toBeGreaterThan(0.9);
    expect(hipR(at('tackle', 0.1))).toBeGreaterThan(0.9);
    expect(hipR(at('tackle', 0.7))).toBeCloseTo(hipR(emptyView()), 5);
  });

  it("doesn't show an action before it happens", () => {
    expect(hipR(at('shot', -0.1))).toBeCloseTo(hipR(emptyView()), 5);
  });
});

describe('moods', () => {
  it('dances for the scorer once they stop, and puts hands on heads for the other team', () => {
    const scorer = new Animator();
    let frame = scorer.step({ ...emptyView(), mood: 'scorer' }, 1 / 60);
    for (let i = 0; i < 30; i++) frame = scorer.step({ ...emptyView(), mood: 'scorer', now: i / 60 }, 1 / 60);
    expect(frame.clip?.name).toBe('Dance_Loop');
    expect(frame.clip!.weight).toBeGreaterThan(0.9);

    const beaten = new Animator();
    for (let i = 0; i < 30; i++) frame = beaten.step({ ...emptyView(), mood: 'dejected' }, 1 / 60);
    expect(frame.pose.joints.elbowL?.x).toBeGreaterThan(1.8);
    // And it eases back out after the kick-off.
    for (let i = 0; i < 30; i++) frame = beaten.step(emptyView(), 1 / 60);
    expect(frame.pose.joints.elbowL?.x).toBeLessThan(0.5);
  });
});

describe('clips give way', () => {
  it("to an action or a mood, so the recorded idle and jog don't hide them", () => {
    // Standing, the idle clip has the whole body...
    const idle = new Animator().step({ ...emptyView(), now: 5 }, 1 / 60);
    expect(idle.clip?.name).toBe('Idle_Loop');
    expect(idle.clip!.weight).toBe(1);
    // ...until they strike the ball.
    const shot = new Animator().step({ ...emptyView(), now: 5, action: { kind: 'shot', tick: 300 } }, 1 / 60);
    expect(shot.clip?.weight ?? 0).toBeLessThan(0.01);
    // A dribble touch takes over only the right leg.
    const touch = new Animator().step({ ...emptyView(), now: 5, speed: 5, action: { kind: 'touch', tick: Math.round((5 - 0.14) * 60) } }, 1 / 60);
    expect(touch.clip?.name).toBe('Jog_Fwd_Loop');
    expect(touch.clip!.weight).toBeGreaterThan(0.5);
    expect(touch.clip!.rightLeg!).toBeLessThan(0.05);
    // Hands on heads.
    const beaten = new Animator();
    let frame = beaten.step({ ...emptyView(), mood: 'dejected' }, 1 / 60);
    for (let i = 0; i < 30; i++) frame = beaten.step({ ...emptyView(), mood: 'dejected' }, 1 / 60);
    expect(frame.clip?.weight ?? 0).toBeLessThan(0.01);
  });
});
