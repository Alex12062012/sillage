import { Surface } from '../sim/track';

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

/**
 * Everything is synthesized: pink-noise wind through a bank of band-passes, edge hiss + granular
 * crunch, and one-shot thumps / whooshes / chimes. Created on the first user gesture (autoplay policy).
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilters: BiquadFilterNode[] = [];
  private carveGain!: GainNode;
  private carveFilter!: BiquadFilterNode;
  private gust = 0;
  private grainAcc = 0;
  private volume = 0.8;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    this.noise = this.pinkNoise(2);

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.master);
    [1, 1.7, 2.6].forEach((mult, i) => {
      const src = this.loop(i * 0.6);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 300 * mult;
      const g = ctx.createGain();
      g.gain.value = [1, 0.6, 0.35][i];
      src.connect(bp).connect(g).connect(this.windGain);
      this.windFilters.push(bp);
    });

    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    this.carveGain.connect(this.master);
    this.carveFilter = ctx.createBiquadFilter();
    this.carveFilter.type = 'bandpass';
    this.carveFilter.frequency.value = 3000;
    this.carveFilter.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    this.loop(1.1).connect(hp).connect(this.carveFilter).connect(this.carveGain);

    // iOS can leave the context "interrupted" after the tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private pinkNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
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

  private loop(offset: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  /** Continuous layers; call once per frame. */
  update(speed: number, edge: number, skid: number, surface: Surface, airborne: boolean, crashed: boolean, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.gust = Math.max(-1, Math.min(1, this.gust * 0.985 + (Math.random() - 0.5) * dt * 3));
    const w = windParams(speed);
    this.windGain.gain.setTargetAtTime(w.gain * (1 + 0.25 * this.gust), t, 0.12);
    this.windFilters.forEach((f, i) => {
      f.frequency.setTargetAtTime(w.freq * [1, 1.7, 2.6][i] * (1 + 0.08 * this.gust), t, 0.15);
      f.Q.setTargetAtTime(w.q, t, 0.2);
    });
    const level = crashed ? 0 : carveLevel(speed, edge, skid, airborne);
    this.carveGain.gain.setTargetAtTime(level, t, 0.05);
    const freq = surface === Surface.Powder ? 900 : surface === Surface.Ice ? 5200 : 2800 + Math.abs(edge) * 900;
    this.carveFilter.frequency.setTargetAtTime(freq, t, 0.08);
    // granular crunch (snow squeak), denser with edge load and skid
    if (!airborne && !crashed && speed > 2) {
      this.grainAcc += dt * (Math.abs(edge) * 26 + skid * 40) * clamp01(speed / 15);
      while (this.grainAcc >= 1) {
        this.grainAcc -= 1;
        this.grain(surface);
      }
    }
  }

  private grain(surface: Surface): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + Math.random() * 0.02;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (surface === Surface.Powder ? 600 : 1800) + Math.random() * 1600;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.08);
  }

  private burst(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q = 1, pan = 0): BiquadFilterNode | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random() * 1.2, dur + 0.05);
    return f;
  }

  private tone(t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  land(vn: number): void {
    if (!this.ready) return;
    const k = Math.max(0.15, Math.min(1, vn / 12));
    const t = this.ctx!.currentTime;
    this.burst(t, 0.16, 0.5 * k, 'lowpass', 520);
    this.tone(t, 120, 42, 0.18, 0.55 * k);
  }

  nearMiss(side: number, razor: boolean): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const f = this.burst(t, 0.38, razor ? 0.7 : 0.45, 'bandpass', 500, 2.2, side * 0.8);
    f?.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    f?.frequency.exponentialRampToValueAtTime(700, t + 0.38);
  }

  crash(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.45, 0.7, 'lowpass', 900);
    this.tone(t, 90, 38, 0.3, 0.6);
    for (let i = 1; i < 4; i++) this.burst(t + i * 0.13, 0.12, 0.25, 'bandpass', 1200 + i * 300, 2);
  }

  jump(): void {
    if (this.ready) this.burst(this.ctx!.currentTime, 0.09, 0.18, 'highpass', 1400);
  }

  pump(): void {
    if (this.ready) this.burst(this.ctx!.currentTime, 0.11, 0.12, 'bandpass', 2600, 1.5);
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
