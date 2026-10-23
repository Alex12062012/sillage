import { Surface } from '../sim/track';
import { TUNING as T } from '../tuning';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Wind mapping (FEEL §2): silent at rest, full and whistling near 115 km/h. Pure, for tests. */
export function windParams(speed: number): { gain: number; freq: number; q: number } {
  const s = clamp01(speed / 32);
  return { gain: 0.55 * s * s, freq: 300 + 1300 * s, q: 0.7 + 3.3 * s };
}

/** Carve hiss level from speed and edge/skid load; 0 in the air. Pure, for tests. */
export function carveLevel(speed: number, edge: number, skid: number, airborne: boolean): number {
  if (airborne) return 0;
  return clamp01((speed / 20) * (0.12 + Math.abs(edge) * 0.55 + skid * 0.9)) * 0.5;
}

const C4 = 261.63;
/** Pentatonics as semitones above C: C D E G A, or C D F G A where E would clash with the chord. */
const PENT_E = [0, 2, 4, 7, 9];
const PENT_F = [0, 2, 5, 7, 9];
/**
 * The ambient progression (C major / A minor): voicing of each chord, the pentatonic the rhythm
 * notes climb over it (F major / D minor pentatonics are C D F G A, A minor / C major ones C D E G A)
 * and the major triad a perfect landing stings with.
 */
const CHORDS = [
  { tones: [174.6, 220, 261.6, 329.6], pent: PENT_F, sting: [349.23, 440, 523.25] }, // Fmaj7
  { tones: [220, 261.6, 329.6, 392], pent: PENT_E, sting: [261.63, 329.63, 392] }, // Am7 → C
  { tones: [146.8, 174.6, 220, 329.6], pent: PENT_F, sting: [349.23, 440, 523.25] }, // Dm9 → F
  { tones: [130.8, 164.8, 196, 293.7], pent: PENT_E, sting: [261.63, 329.63, 392] }, // Cadd9
];

/**
 * Rhythm note of the n-th clean edge change in a row over chord `chordIdx`: one pentatonic step per
 * beat up from C4, two octaves (streak 11), then it loops the top octave. Every chord's pentatonic
 * shares the same steps above C, so the climb never steps down when the chord changes. Pure, for tests.
 */
export function rhythmNote(chordIdx: number, streak: number): number {
  const c = CHORDS[((chordIdx % CHORDS.length) + CHORDS.length) % CHORDS.length];
  const n = Math.max(1, Math.floor(streak));
  const step = n <= 11 ? n - 1 : 6 + ((n - 12) % 5);
  return C4 * 2 ** ((Math.floor(step / 5) * 12 + c.pent[step % 5]) / 12);
}

const WIND_MULT = [1, 1.7, 2.6];
const WIND_LEVEL = [1, 0.6, 0.35];
const MALLET: Partials = [[1, 1, 1], [3.98, 0.22, 0.12], [2, 0.12, 0.4]];
const BELL: Partials = [[1, 1, 1], [2.76, 0.45, 0.5], [5.4, 0.25, 0.3], [8.93, 0.12, 0.15]];
const ZING: Partials = [[1, 1, 1], [2.76, 0.6, 0.6], [5.4, 0.35, 0.3]];
/** [frequency ratio, level, decay as a fraction of the note] */
type Partials = readonly (readonly [number, number, number])[];
/** Wobble of the sketchy-landing scrape (band-pass centre, Hz). */
const WOBBLE = new Float32Array([1500, 900, 1700, 800, 1400, 700, 1000]);

/**
 * Everything is synthesized. Bed: pink-noise wind through a bank of band-passes, an air whistle,
 * and the ground layers (edge bite, rumble, baked granular crunch, gritty skid, ice chatter, hand
 * drag). Music: a generative 4-chord ambient that grows with flow, rhythm notes played by carving,
 * stings and fanfares, all through an echo and a generated-impulse reverb. Created on the first
 * user gesture (autoplay policy); master → compressor → limiter → soft clip.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private bed!: GainNode;
  private noise!: AudioBuffer;
  private grit!: AudioBuffer;
  private windGain!: GainNode;
  private windFilters: BiquadFilterNode[] = [];
  private airGain!: GainNode;
  private airFilter!: BiquadFilterNode;
  private ground!: GainNode;
  private groundTone!: BiquadFilterNode;
  private biteGain!: GainNode;
  private biteFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private crunch!: AudioBufferSourceNode;
  private crunchGain!: GainNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  private iceGain!: GainNode;
  private dragGain!: GainNode;
  private gust = 0;
  private airT = 0;
  private skidPrev = 0;
  private scrapeT = 0;
  private drag = 0;
  private volume = 0.8;
  private music = true;
  private musicBus!: GainNode;
  private musicTone!: BiquadFilterNode;
  private notes!: GainNode;
  private pad: OscillatorNode[] = [];
  private padGain!: GainNode;
  private shimmer: OscillatorNode[] = [];
  private shimmerGain!: GainNode;
  private flow = 0;
  private pulseMix = 0;
  private arpMix = 0;
  private nextSub = 0;
  private sub = 0;
  private chord = CHORDS.length - 1;
  private tickT = 0;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.music = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.11 : 0, this.ctx.currentTime, 0.4);
    this.notes.gain.setTargetAtTime(on ? 1 : 0.7, this.ctx.currentTime, 0.4); // rhythm notes are feedback: kept, softer
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.build(new AC());
    // iOS can leave the context "interrupted" after the tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    // master → glue compressor → fast limiter → soft clip: loud events squash, never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    const clip = ctx.createWaveShaper();
    clip.curve = softClip();
    this.master = this.gain(this.volume);
    this.master.connect(comp).connect(lim).connect(clip).connect(ctx.destination);
    this.sfx = this.gain(1, this.master);
    this.bed = this.gain(1, this.master); // wind + ground, ducked under big events
    this.noise = this.pinkNoise(2);
    this.grit = this.gritNoise(1.5);

    this.windGain = this.gain(0, this.bed);
    WIND_MULT.forEach((mult, i) => {
      const bp = this.filter('bandpass', 300 * mult);
      this.loop(this.noise, i * 0.6).connect(bp).connect(this.gain(WIND_LEVEL[i], this.windGain));
      this.windFilters.push(bp);
    });
    // in the air the wind turns airy: a narrow, rising whistle
    this.airGain = this.gain(0, this.bed);
    this.airFilter = this.filter('bandpass', 900, 9);
    this.loop(this.noise, 0.3).connect(this.airFilter).connect(this.airGain);

    // ground layers, all through one gain (cut on takeoff) and one low-pass (muffled in powder)
    this.groundTone = this.filter('lowpass', 14000, 0.5);
    this.groundTone.connect(this.bed);
    this.ground = this.gain(1, this.groundTone);
    const hiss = this.loop(this.noise, 1.1);
    // edge bite: the crisp "rrrsssh", higher and tighter with edge angle
    this.biteGain = this.gain(0, this.ground);
    this.biteFilter = this.filter('bandpass', 3000, 0.8);
    hiss.connect(this.filter('highpass', 900)).connect(this.biteFilter).connect(this.biteGain);
    // rumble: skis on snow, felt more than heard
    this.rumbleGain = this.gain(0, this.ground);
    this.loop(this.noise, 0.7).connect(this.filter('lowpass', 170, 0.7)).connect(this.rumbleGain);
    // crunch: a baked granular texture (snow crystals breaking), denser and higher when faster
    this.crunchGain = this.gain(0, this.ground);
    this.crunch = this.loop(this.crunchNoise(2), 0);
    this.crunch.connect(this.crunchGain);
    // skid / brake: gritty scrape
    this.skidGain = this.gain(0, this.ground);
    this.skidFilter = this.filter('bandpass', 1800, 0.7);
    this.loop(this.grit, 0).connect(this.skidFilter).connect(this.skidGain);
    // ice: a high band chopped by a fast square LFO (scratchy chatter)
    this.iceGain = this.gain(0, this.ground);
    const chatter = this.gain(0.5, this.iceGain);
    hiss.connect(this.filter('highpass', 3800)).connect(chatter);
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 23;
    lfo.connect(this.gain(0.5, chatter.gain));
    lfo.start();
    // hand drag: a soft continuous hiss
    this.dragGain = this.gain(0, this.ground);
    hiss.connect(this.filter('bandpass', 2600, 1.2)).connect(this.dragGain);

    // space: dry + a tempo-synced echo + a short generated reverb, for every musical element
    const space = this.gain(1, this.master);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = T.sfxChordSeconds / 8;
    const fb = this.gain(0.32);
    space.connect(delay).connect(fb).connect(delay);
    fb.connect(this.master);
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(2.2);
    space.connect(verb).connect(this.gain(0.5, this.master));
    this.notes = this.gain(this.music ? 1 : 0.7, space);
    this.musicBus = this.gain(this.music ? 0.11 : 0);
    this.musicTone = this.filter('lowpass', 1500);
    this.musicBus.connect(this.musicTone).connect(space);

    // flow layers: a warm saw pad and a high tremolo shimmer that follow the chords
    this.padGain = this.gain(0, this.musicBus);
    const padTone = this.filter('lowpass', 750, 0.6);
    padTone.connect(this.padGain);
    this.shimmerGain = this.gain(0, this.musicBus);
    const trem = this.gain(0.5, this.shimmerGain);
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 5.5;
    tremLfo.connect(this.gain(0.5, trem.gain));
    tremLfo.start();
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = i % 2 ? 7 : -7;
      o.connect(this.gain(0.25, padTone));
      o.start();
      this.pad.push(o);
    }
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.connect(this.gain(0.5, trem));
      o.start();
      this.shimmer.push(o);
    }
    this.retune(ctx.currentTime, CHORDS[this.chord].tones);
    this.setFlow(this.flow);
  }

  private gain(v: number, to?: AudioNode | AudioParam): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    if (to instanceof AudioNode) g.connect(to); // two branches: connect() is overloaded per target type
    else if (to) g.connect(to);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private buffer(seconds: number, channels = 1): AudioBuffer {
    const ctx = this.ctx!;
    return ctx.createBuffer(channels, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  }

  private pinkNoise(seconds: number): AudioBuffer {
    const buf = this.buffer(seconds);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1; // Paul Kellet's pinking filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  /** White noise under a jumpy 1-6 ms envelope: the grain of a scrape. */
  private gritNoise(seconds: number): AudioBuffer {
    const buf = this.buffer(seconds);
    const d = buf.getChannelData(0);
    let env = 0;
    for (let i = 0, next = 0; i < d.length; i++) {
      if (i >= next) {
        env = 0.1 + 0.9 * Math.random() ** 2;
        next = i + Math.floor(this.ctx!.sampleRate * (0.001 + Math.random() * 0.005));
      }
      d[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    return buf;
  }

  /** ~80 grains/s of damped, noisy resonances between 900 and 3400 Hz (no nodes per grain at runtime). */
  private crunchNoise(seconds: number): AudioBuffer {
    const buf = this.buffer(seconds);
    const d = buf.getChannelData(0);
    const sr = this.ctx!.sampleRate;
    for (let g = 0; g < seconds * 80; g++) {
      const start = Math.floor(Math.random() * d.length);
      const w = (2 * Math.PI * (900 + Math.random() * 2500)) / sr;
      const decay = (0.004 + Math.random() * 0.014) * sr;
      const amp = 0.3 + Math.random() * 0.7;
      for (let i = 0; i < decay * 5; i++) d[(start + i) % d.length] += amp * Math.exp(-i / decay) * (Math.sin(w * i) * 0.6 + (Math.random() - 0.5) * 0.8);
    }
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < d.length; i++) d[i] *= 0.8 / peak;
    return buf;
  }

  /** Stereo decaying noise, darker as it fades: a small snowy valley. */
  private impulse(seconds: number): AudioBuffer {
    const buf = this.buffer(seconds, 2);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const k = i / d.length;
        lp += (Math.random() * 2 - 1 - lp) * (0.7 - 0.6 * k);
        d[i] = lp * (1 - k) ** 3;
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer, offset: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  /** Points the pad and shimmer oscillators at a chord (they glide). */
  private retune(t: number, tones: number[]): void {
    this.pad.forEach((o, i) => o.frequency.setTargetAtTime(tones[i], t, 0.25));
    this.shimmer.forEach((o, i) => o.frequency.setTargetAtTime(tones[i + 2] * 4, t, 0.25));
  }

  /**
   * Generative ambient on a look-ahead clock (audio time): 8 steps per chord, a slow 4-chord loop
   * gently arpeggiated, plus the flow pulse and arpeggio. The chord clock runs even with music off,
   * so rhythm notes always land in key.
   */
  private musicStep(speed: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.musicTone.frequency.setTargetAtTime(1300 + clamp01(speed / 30) * 2400, now, 0.8); // brighter when fast
    if (this.nextSub < now) this.nextSub = now + 0.05; // first call, or after a stall
    while (this.nextSub < now + 0.12) {
      const t = this.nextSub;
      const sub = this.sub++ % 8;
      this.nextSub += T.sfxChordSeconds / 8;
      if (sub === 0) {
        this.chord = (this.chord + 1) % CHORDS.length;
        this.retune(t, CHORDS[this.chord].tones);
      }
      if (!this.music) continue;
      const tones = CHORDS[this.chord].tones;
      if (sub === 0) {
        tones.forEach((f, i) => this.note(t + i * 0.14, f, 0.16, 3.2));
        if (Math.random() < 0.45) {
          const hi = [523.3, 659.3, 784, 880, 1174.7];
          this.note(t + 1.4 + Math.random(), hi[Math.floor(Math.random() * hi.length)], 0.07, 2.2);
        }
      }
      if (this.pulseMix > 0.02 && sub % 2 === 0) this.partials(t, tones[0] / 2, 0.5 * this.pulseMix, 0.7, MALLET, this.musicBus);
      if (this.arpMix > 0.02) this.partials(t, tones[(sub * 3) % 4] * 2, 0.12 * this.arpMix, 0.5, MALLET, this.musicBus);
    }
  }

  private note(t: number, f: number, peak: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.musicBus);
    for (const [type, mul, lvl] of [['sine', 1, 1], ['triangle', 2, 0.18]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      o.detune.value = (Math.random() - 0.5) * 6;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  /** A struck tone: sine partials, each with its own exponential decay (mallet, bell, zing). */
  private partials(t: number, f: number, peak: number, dur: number, p: Partials, to: AudioNode): void {
    const ctx = this.ctx!;
    for (const [ratio, lvl, decay] of p) {
      const o = ctx.createOscillator();
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * lvl, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * decay);
      o.connect(g).connect(to);
      o.start(t);
      o.stop(t + dur * decay + 0.05);
    }
  }

  /** Continuous layers; call once per frame (with zeros while paused to hush everything). */
  update(speed: number, edge: number, skid: number, surface: Surface, airborne: boolean, crashed: boolean, dt: number, braking = false, tuck = false): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.musicStep(speed);
    const k = clamp01(dt / 1.5); // flow pulse / arpeggio crossfade
    this.pulseMix += ((this.flow >= 2 ? T.sfxFlow : 0) - this.pulseMix) * k;
    this.arpMix += ((this.flow >= 3 ? T.sfxFlow : 0) - this.arpMix) * k;

    this.gust = Math.max(-1, Math.min(1, this.gust * 0.985 + (Math.random() - 0.5) * dt * 3));
    const w = windParams(speed);
    this.windGain.gain.setTargetAtTime(w.gain * (1 + 0.25 * this.gust) * (tuck ? 1.15 : 1), t, 0.12);
    for (let i = 0; i < 3; i++) {
      this.windFilters[i].frequency.setTargetAtTime(w.freq * WIND_MULT[i] * (1 + 0.08 * this.gust), t, 0.15);
      this.windFilters[i].Q.setTargetAtTime(w.q, t, 0.2);
    }
    const v = clamp01(speed / 30);
    const flying = airborne && !crashed;
    this.airT = flying ? this.airT + dt : 0;
    this.airGain.gain.setTargetAtTime(flying ? 0.05 + 0.2 * v : 0, t, flying ? 0.08 : 0.03);
    this.airFilter.frequency.setTargetAtTime(700 + 1400 * clamp01(this.airT / 0.7) + 700 * v, t, 0.15);

    const onSnow = !airborne && !crashed;
    this.ground.gain.setTargetAtTime(onSnow ? 1 : 0, t, onSnow ? 0.01 : 0.015);
    if (!onSnow) {
      this.skidPrev = 0;
      return; // the targets below would only fight the cut
    }
    const e = Math.abs(edge);
    const powder = surface === Surface.Powder;
    const ice = surface === Surface.Ice;
    const slow = clamp01(speed / 15);
    this.groundTone.frequency.setTargetAtTime(powder ? 1300 : 14000, t, 0.15);
    this.biteGain.gain.setTargetAtTime(carveLevel(speed, edge, 0, false) * T.sfxCarve * (powder ? 0.7 : ice ? 0.6 : 1), t, 0.04);
    this.biteFilter.frequency.setTargetAtTime(powder ? 1000 : ice ? 6000 : 2400 + e * 2600 + v * 900, t, 0.06);
    this.biteFilter.Q.setTargetAtTime(powder ? 0.5 : 0.8 + e * 2.2, t, 0.06);
    this.rumbleGain.gain.setTargetAtTime((powder ? 0.2 : 0.1) * v * T.sfxRumble, t, 0.1);
    this.crunchGain.gain.setTargetAtTime((0.06 + e * 0.4 + skid * 0.5) * slow * (powder ? 0.35 : ice ? 0.25 : 1) * 0.5, t, 0.05);
    this.crunch.playbackRate.setTargetAtTime(0.8 + e * 0.45 + v * 0.25, t, 0.1);
    const scrape = clamp01(skid * 1.1 + (braking ? 0.45 : 0)) * clamp01(speed / 12);
    this.skidGain.gain.setTargetAtTime(scrape ** 1.5 * 0.6 * T.sfxSkid * (powder ? 0.5 : 1), t, 0.03);
    this.skidFilter.frequency.setTargetAtTime(powder ? 700 : ice ? 3200 : 1300 + scrape * 1400, t, 0.05);
    this.iceGain.gain.setTargetAtTime(ice ? (0.12 + e * 0.5 + skid * 0.6) * slow * 0.3 : 0, t, 0.05);
    this.dragGain.gain.setTargetAtTime(this.drag * 0.12 * clamp01(speed / 10), t, 0.08);
    // the onset of a hockey stop gets its own big "kssshhh"
    this.scrapeT -= dt;
    if (scrape > 0.6 && this.skidPrev < 0.35 && speed > 9 && this.scrapeT <= 0) {
      this.scrapeT = 0.6;
      this.scrapeBurst(t, powder);
    }
    this.skidPrev = scrape;
  }

  private scrapeBurst(t: number, powder: boolean): void {
    const f = this.burst(t, 0.55, 0.42 * T.sfxSkid, 'bandpass', powder ? 900 : 2600, 0.8, 0, this.grit);
    f?.frequency.exponentialRampToValueAtTime(powder ? 500 : 1300, t + 0.5);
    this.burst(t, 0.3, 0.2, 'lowpass', 500);
  }

  /** Wind and carve dip under a big event, then swell back. */
  private duck(depth: number, hold: number): void {
    const t = this.ctx!.currentTime;
    const g = this.bed.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth * T.sfxDuck, t, 0.015);
    g.setTargetAtTime(1, t + hold, 0.25);
  }

  private burst(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q = 1, pan = 0, buf = this.noise, attack = 0.008): BiquadFilterNode | null {
    if (!this.ready) return null;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = this.filter(type, freq, q);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    src.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.1), dur + 0.05);
    return f;
  }

  private tone(t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine', to: AudioNode = this.sfx): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A comic grunt: a gliding sawtooth through two vowel formants ("uh" ≈ 600/1100, "oof" ≈ 350/850 Hz). */
  private voice(t: number, f0: number, f1: number, dur: number, peak: number, form1: number, form2: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * 3, t + 0.03); // ×3: the narrow formants eat most of the saw
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(this.filter('bandpass', form1, 5)).connect(g);
    o.connect(this.filter('bandpass', form2, 7)).connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Clean edge change: the next note of the climb, over the current chord. Unclean: a dull muted tick. */
  edgeChange(streak: number, clean: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    if (!clean) {
      this.burst(t, 0.04, 0.06, 'lowpass', 450);
      return;
    }
    const lvl = T.sfxRhythm * (0.85 + Math.random() * 0.15);
    this.partials(t, rhythmNote(this.chord, streak), 0.16 * lvl, 1.1, MALLET, this.notes);
    if (streak % 4 === 0 && streak <= 12) {
      // a tiny flourish: two more pentatonic steps above, strummed
      this.partials(t + 0.07, rhythmNote(this.chord, streak + 2), 0.11 * lvl, 0.9, MALLET, this.notes);
      this.partials(t + 0.14, rhythmNote(this.chord, streak + 4), 0.09 * lvl, 1.2, BELL, this.notes);
    }
  }

  /** 0..4: ≥1 a warm pad, ≥2 a pulse on the chord root, ≥3 an arpeggio, 4 a shimmer. 0 after a crash. */
  setFlow(level: number): void {
    this.flow = level;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(level >= 1 ? 0.3 * T.sfxFlow : 0, t, level >= 1 ? 1.2 : 0.4);
    this.shimmerGain.gain.setTargetAtTime(level >= 4 ? 0.1 * T.sfxFlow : 0, t, level >= 4 ? 1.5 : 0.4);
  }

  /** Leaving the snow: the ground cuts (update), the wind turns airy; a pop adds a "whoomp". */
  takeoff(jumped: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.airT = 0;
    const f = this.burst(t, 0.3, 0.12, 'bandpass', 1800, 0.8);
    f?.frequency.exponentialRampToValueAtTime(600, t + 0.3);
    if (jumped) {
      this.tone(t, 150, 60, 0.16, 0.45);
      this.burst(t, 0.14, 0.18, 'lowpass', 600);
    }
  }

  /** Each 180° of spin: a whoosh, a little higher every half-turn, swirling left / right. */
  spinTick(halfTurns: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const up = 2 ** ((Math.min(halfTurns, 8) * 2) / 12);
    const f = this.burst(t, 0.26, 1.4, 'bandpass', 500 * up, 1.4, halfTurns % 2 ? 0.45 : -0.45);
    f?.frequency.exponentialRampToValueAtTime(1600 * up, t + 0.1);
    f?.frequency.exponentialRampToValueAtTime(700 * up, t + 0.26);
  }

  /** Each full flip: a deep "vwoom". */
  flipTick(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 170, 85, 0.3, 0.16, 'triangle');
    const f = this.burst(t, 0.34, 0.2, 'lowpass', 400, 1.5);
    f?.frequency.exponentialRampToValueAtTime(1400, t + 0.15);
    f?.frequency.exponentialRampToValueAtTime(500, t + 0.34);
  }

  /** Grab starts: a cloth rustle and a short zip. */
  grab(on: boolean): void {
    if (!on || !this.ready) return;
    const t = this.ctx!.currentTime;
    [0, 0.035, 0.08].forEach((d, i) => this.burst(t + d, 0.05, 0.13 - i * 0.03, 'highpass', 4200 + i * 600, 0.7, 0, this.grit));
    const f = this.burst(t + 0.02, 0.1, 0.09, 'bandpass', 1200, 6, 0, this.grit);
    f?.frequency.exponentialRampToValueAtTime(4500, t + 0.11);
  }

  /** Touchdown: sub thump + snow crunch by impact, then the music of how it went. */
  land(vn: number, quality: string, points: number): void {
    if (!this.ready) return;
    const k = Math.max(0.15, Math.min(1, vn / 12));
    const t = this.ctx!.currentTime;
    this.duck(0.4 + 0.5 * k, 0.15);
    this.tone(t, 125, 40, 0.2, 0.55 * k);
    this.burst(t, 0.18, 0.45 * k, 'lowpass', 650);
    this.burst(t, 0.1 + 0.12 * k, 0.32 * k, 'bandpass', 2600, 1.1, 0, this.grit);
    if (vn > T.landHardVn) {
      this.tone(t, 85, 30, 0.38, 0.5);
      this.burst(t + 0.01, 0.32, 0.3, 'lowpass', 300);
    }
    const c = CHORDS[this.chord];
    if (quality === 'sketchy') {
      const f = this.burst(t + 0.02, 0.55, 0.5, 'bandpass', 1400, 4, 0, this.grit);
      f?.frequency.setValueCurveAtTime(WOBBLE, t + 0.02, 0.5);
      this.voice(t + 0.06, 150, 115, 0.3, 0.2, 600, 1100);
    } else if (quality === 'perfect' && this.airT > 0.5) { // not for every mogul hop
      // bright major sting in key: triad + octave as bells, with a sparkle on top
      [...c.sting, c.sting[0] * 2].forEach((f, i) => this.partials(t + 0.02 + i * 0.012, f * 2, 0.12, 1.6, BELL, this.notes));
      this.partials(t + 0.12, c.sting[2] * 4, 0.05, 1.2, BELL, this.notes);
    }
    if (points > 0 && quality !== 'sketchy') {
      // trick payoff: a rising pentatonic run, longer for bigger tricks
      const n = Math.max(2, Math.min(8, 2 + Math.floor(Math.log2(points / 100))));
      for (let i = 0; i < n; i++) this.partials(t + 0.1 + i * 0.07, rhythmNote(this.chord, 4 + i), 0.16, 0.9, MALLET, this.notes);
    }
  }

  /** Shaving an obstacle: a stereo whoosh on its side, brighter with the chain; a razor rings. */
  nearMiss(side: number, razor: boolean, chain = 1): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const up = 2 ** ((Math.min(chain, 8) - 1) / 6);
    const f = this.burst(t, 0.38, razor ? 3 : 2.4, 'bandpass', 500 * up, 1.1, side * 0.8);
    f?.frequency.exponentialRampToValueAtTime(2400 * up, t + 0.12);
    f?.frequency.exponentialRampToValueAtTime(700 * up, t + 0.38);
    if (razor) {
      const p = this.ctx!.createStereoPanner();
      p.pan.value = side * 0.6;
      p.connect(this.notes);
      this.partials(t + 0.03, rhythmNote(this.chord, 9 + Math.min(chain, 3)), 0.08, 0.7, ZING, p);
    }
  }

  crash(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.setFlow(0);
    this.duck(0.8, 0.5);
    this.burst(t, 0.45, 0.6, 'lowpass', 900);
    this.tone(t, 95, 35, 0.35, 0.6);
    // tumbling: crunches at a slowing, irregular pace
    [0.13, 0.29, 0.4, 0.58, 0.74].forEach((d, i) => {
      this.tone(t + d, 110, 50, 0.12, 0.3 - i * 0.05);
      this.burst(t + d, 0.12, 1.4 - i * 0.2, 'bandpass', 900 + Math.random() * 1400, 0.8, 0, this.grit);
    });
    this.voice(t + 0.08, 210, 120, 0.3, 0.22, 380, 850);
  }

  /** Crossing 80 / 100 / 120 km/h: a whoosh and a rising tone, higher for each milestone. */
  speedMilestone(kmh: number): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const f = this.burst(t, 0.5, 0.35, 'highpass', 700, 0.8);
    f?.frequency.exponentialRampToValueAtTime(3500, t + 0.45);
    const top = rhythmNote(this.chord, 6 + Math.max(0, Math.round((kmh - 80) / 20)) * 2);
    this.tone(t, top / 2, top, 0.4, 0.1, 'triangle', this.notes);
  }

  /** Locking into a tuck at speed: a low air-pressure whoosh and a tiny thunk. */
  tuck(on: boolean): void {
    if (!on || !this.ready) return;
    const t = this.ctx!.currentTime;
    const f = this.burst(t, 0.26, 0.22, 'lowpass', 1800, 1.2);
    f?.frequency.exponentialRampToValueAtTime(350, t + 0.25);
    this.tone(t, 210, 140, 0.07, 0.1);
  }

  polePlant(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.025, 0.09, 'highpass', 4000, 0.7, 0, this.noise, 0.002);
    this.burst(t + 0.005, 0.06, 0.07, 'bandpass', 1800, 2, 0, this.grit);
  }

  /** 0..1, continuous (0 = hand off the snow). */
  handDrag(level: number): void {
    this.drag = clamp01(level);
  }

  /** Finish line: a fanfare arpeggio in key, a bell, and a soft crowd-like swell. */
  finish(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const s = CHORDS[this.chord].sting;
    this.duck(0.5, 1.5);
    [s[0], s[1], s[2], s[0] * 2, s[1] * 2, s[2] * 2].forEach((f, i) => this.partials(t + i * 0.085, f, 0.15, 1.1, MALLET, this.notes));
    this.partials(t + 0.52, s[0] * 4, 0.12, 2.6, BELL, this.notes);
    this.partials(t + 0.52, s[0] * 2, 0.1, 2.2, BELL, this.notes);
    for (const [freq, pan] of [[1100, -0.5], [2400, 0.5]]) {
      const src = this.ctx!.createBufferSource();
      src.buffer = this.grit;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      const p = this.ctx!.createStereoPanner();
      p.pan.value = pan;
      src.loop = true;
      src.connect(this.filter('bandpass', freq, 1.4)).connect(g).connect(p).connect(this.sfx);
      src.start(t, Math.random());
      src.stop(t + 2.5);
    }
  }

  medal(tier: number): void {
    this.chime(tier + 1);
  }

  /** Score count-up: a very soft tick, at most ~16 a second. */
  scoreTick(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    if (t - this.tickT < 0.06) return;
    this.tickT = t;
    this.tone(t, 2600, 2300, 0.025, 0.025, 'triangle');
  }

  jump(): void {
    if (this.ready) this.burst(this.ctx!.currentTime, 0.09, 0.18, 'highpass', 1400);
  }

  pump(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const f = this.burst(t, 0.16, 0.12, 'bandpass', 1500, 1.5);
    f?.frequency.exponentialRampToValueAtTime(3200, t + 0.12);
  }

  chime(steps = 3): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [1046.5, 1318.5, 1568, 2093].slice(0, steps).forEach((f, i) => {
      this.tone(t + i * 0.09, f, f, 0.7, 0.16, 'triangle');
      this.tone(t + i * 0.09, f * 2, f * 2, 0.35, 0.04);
    });
  }

  click(): void {
    if (this.ready) this.tone(this.ctx!.currentTime, 880, 660, 0.06, 0.12);
  }
}

/** Linear up to 0.7, then a tanh knee that never reaches full scale. */
function softClip(): Float32Array<ArrayBuffer> {
  const c = new Float32Array(1025);
  for (let i = 0; i < c.length; i++) {
    const x = (i / 512) - 1;
    const a = Math.abs(x);
    c[i] = a < 0.7 ? x : Math.sign(x) * (0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return c;
}
