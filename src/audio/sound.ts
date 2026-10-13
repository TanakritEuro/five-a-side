// Ported from ../penalty-shootout/src/audio/sound.ts. Added here: a dribble touch, a
// tackle, a long full-time whistle, and a crowd that swells as the home team attacks.

/**
 * All game audio, synthesised with the Web Audio API: no sound files. A filtered-noise
 * crowd bed that swells, crowd reactions, and short effects for the kick, woodwork, net,
 * keeper and referee's whistle.
 *
 * Browsers only allow audio after a user gesture, so nothing plays until `unlock()` is
 * called from one (the menu's Kick off button).
 */
export type CrowdReaction = 'cheer' | 'roar' | 'groan' | 'ooh';

/** One sound, as data: what `echo` reports and `play` plays, to sound it on another device too. */
export type SoundEvent =
  | { name: 'whistle'; long?: boolean }
  | { name: 'kick' | 'woodwork' | 'net' | 'parry' | 'touch' | 'tackle'; speed: number }
  | { name: 'react'; kind: CrowdReaction };

const MUTE_KEY = 'five-a-side:muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crowd: GainNode | null = null;
  /** Until this audio time a reaction owns the crowd bed's level. */
  private reacting = 0;
  private muted: boolean;
  /** Called on every crowd reaction, so the crowd you see can react with the crowd you hear. */
  onReact?: (kind: CrowdReaction) => void;
  /** Called with every sound effect and crowd reaction, muted or not (online play forwards them). */
  echo?: (event: SoundEvent) => void;

  constructor() {
    this.muted = readMuted();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create the audio context (must be called from a user gesture) and start the crowd. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.noise = makeNoise(ctx, 3);
    this.startCrowd();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    writeMuted(muted);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Play a sound described as data (from `echo` on another device). */
  play(event: SoundEvent): void {
    switch (event.name) {
      case 'whistle':
        return this.whistle(event.long);
      case 'react':
        return this.react(event.kind);
      default:
        return this[event.name](event.speed);
    }
  }

  /** Referee's whistle: a short double-tone peep, or (`long`) three, the last held: full time. */
  whistle(long = false): void {
    this.echo?.({ name: 'whistle', long });
    const t = this.now();
    if (t === null) return;
    const peeps = long ? [[0, 0.25], [0.4, 0.25], [0.8, 0.9]] : [[0, 0.32]];
    for (const [at, length] of peeps) {
      for (const f of [2950, 3150]) {
        const o = this.osc('sine', f, t + at);
        const lfo = this.osc('sine', 32, t + at);
        const depth = this.ctx!.createGain();
        depth.gain.value = 60;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t + at);
        this.envelope(o, t + at, 0.01, length, 0.12);
        lfo.stop(t + at + length + 0.1);
      }
    }
  }

  /** A dribble touch or a first touch: a soft tap, louder for a harder ball. */
  touch(speed: number): void {
    this.echo?.({ name: 'touch', speed });
    const t = this.now();
    if (t === null) return;
    const level = Math.min(0.5, 0.12 + speed / 40);
    const o = this.osc('sine', 180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    this.envelope(o, t, 0.002, 0.06, level);
  }

  /** A tackle: bodies and boots meeting, a dull thud with a scuff. */
  tackle(speed: number): void {
    this.echo?.({ name: 'tackle', speed });
    const t = this.now();
    if (t === null) return;
    const level = Math.min(0.8, 0.35 + speed / 20);
    const o = this.osc('sine', 85, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this.envelope(o, t, 0.004, 0.16, level);
    this.noiseBurst(t, 0.12, 900, 'bandpass', 0.35 * level);
  }

  /**
   * How exciting the play is (0 calm, 1 the home team bearing down on goal): the crowd
   * bed follows it, slowly.
   */
  setExcitement(level: number): void {
    if (!this.ctx || !this.crowd || this.reacting > this.ctx.currentTime) return;
    this.crowd.gain.setTargetAtTime(0.06 + 0.08 * Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.8);
  }

  /** Boot on ball: a low thump with a pitch drop, louder for harder shots. */
  kick(speed: number): void {
    this.echo?.({ name: 'kick', speed });
    const t = this.now();
    if (t === null) return;
    const level = Math.min(1, 0.35 + speed / 40);
    const o = this.osc('sine', 140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    this.envelope(o, t, 0.002, 0.12, 0.9 * level);
    this.noiseBurst(t, 0.04, 1800, 'bandpass', 0.5 * level);
  }

  /** Ball on the post or bar: an inharmonic metallic ring. */
  woodwork(speed: number): void {
    this.echo?.({ name: 'woodwork', speed });
    const t = this.now();
    if (t === null) return;
    const level = Math.min(1, 0.3 + speed / 30);
    for (const [f, a, d] of [[520, 0.35, 0.9], [1340, 0.22, 0.6], [2210, 0.15, 0.4], [3480, 0.08, 0.25]] as const) {
      this.envelope(this.osc('sine', f, t), t, 0.002, d, a * level);
    }
    this.noiseBurst(t, 0.03, 4000, 'highpass', 0.3 * level);
  }

  /**
   * Ball into the net: a swish, a soft thump as the mesh takes the ball, and a rustle of
   * the net rippling out and settling.
   */
  net(speed: number): void {
    this.echo?.({ name: 'net', speed });
    const t = this.now();
    if (t === null || speed < 2) return;
    const level = Math.min(1, speed / 28);
    this.noiseBurst(t, 0.35, 2500, 'highpass', 0.5 * level);
    const thump = this.osc('sine', 95, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    this.envelope(thump, t, 0.01, 0.18, 0.45 * level);
    for (let i = 0; i < 5; i++) {
      const at = t + 0.06 + i * (0.05 + 0.03 * Math.random());
      this.noiseBurst(at, 0.07, 1400 + 600 * Math.random(), 'bandpass', 0.22 * level * (1 - i / 6));
    }
  }

  /** Ball off the keeper's gloves or body: a dull slap. */
  parry(speed: number): void {
    this.echo?.({ name: 'parry', speed });
    const t = this.now();
    if (t === null) return;
    this.noiseBurst(t, 0.09, 700, 'bandpass', Math.min(0.8, 0.3 + speed / 40));
  }

  /** The crowd reacts: a cheer, a bigger roar, a groan or an "ooh". */
  react(kind: CrowdReaction): void {
    this.onReact?.(kind);
    this.echo?.({ name: 'react', kind });
    const t = this.now();
    if (t === null || !this.ctx || !this.master || !this.noise) return;
    const shape: Record<CrowdReaction, { from: number; to: number; q: number; attack: number; length: number; level: number }> = {
      cheer: { from: 700, to: 1100, q: 0.7, attack: 0.15, length: 2.2, level: 0.55 },
      roar: { from: 650, to: 1200, q: 0.6, attack: 0.2, length: 3.5, level: 0.8 },
      groan: { from: 520, to: 260, q: 1.2, attack: 0.25, length: 1.6, level: 0.4 },
      ooh: { from: 420, to: 640, q: 1.6, attack: 0.3, length: 1.3, level: 0.4 },
    };
    const s = shape[kind];
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = s.q;
    filter.frequency.setValueAtTime(s.from, t);
    filter.frequency.linearRampToValueAtTime(s.to, t + s.length * 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(s.level, t + s.attack);
    g.gain.setTargetAtTime(0, t + s.attack + s.length * 0.3, s.length * 0.3);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + s.length * 2);
    // Swell the crowd bed along with it (and keep the excitement level off it meanwhile).
    if (this.crowd && (kind === 'cheer' || kind === 'roar')) {
      this.crowd.gain.setTargetAtTime(0.16, t, 0.2);
      this.crowd.gain.setTargetAtTime(0.08, t + 2, 1.5);
      this.reacting = t + 3;
    }
  }

  private startCrowd(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Two bands: a low rumble of voices and a thinner chatter on top.
    const low = ctx.createBiquadFilter();
    low.type = 'bandpass';
    low.frequency.value = 350;
    low.Q.value = 0.8;
    const high = ctx.createBiquadFilter();
    high.type = 'bandpass';
    high.frequency.value = 1300;
    high.Q.value = 1.2;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.35;
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0.08;
    // A slow wobble so it breathes instead of hissing steadily.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.025;
    lfo.connect(lfoDepth).connect(this.crowd.gain);
    src.connect(low).connect(this.crowd);
    src.connect(high).connect(highGain).connect(this.crowd);
    this.crowd.connect(this.master!);
    src.start();
    lfo.start();
  }

  private now(): number | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime : null;
  }

  private osc(type: OscillatorType, frequency: number, t: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    return o;
  }

  /** Play `source` through a quick attack and exponential decay. */
  private envelope(source: OscillatorNode | AudioBufferSourceNode, t: number, attack: number, decay: number, level: number): void {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    source.connect(g).connect(this.master!);
    source.start(t);
    source.stop(t + attack + decay + 0.05);
  }

  private noiseBurst(t: number, length: number, frequency: number, type: BiquadFilterType, level: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 2);
    src.stop(t + length + 0.05);
  }
}

/** `seconds` of white noise, for the crowd and every hiss and swish. */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// The mute choice is remembered per browser; storage can be unavailable, so never rely on it.
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore: the setting just won't persist.
  }
}
