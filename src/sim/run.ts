import { TUNING as T } from '../tuning';
import type { RunStats } from './missions';
import type { SkierEvent, SkierState } from './skier';
import { Surface, type Ground, type Obstacle } from './track';

export type RunEvent =
  | { type: 'finish'; time: number; bonus: number }
  | { type: 'trick'; name: string; points: number; quality: string }
  /** x, z, h: the obstacle that was shaved (e.g. to shake the snow off that tree). */
  | { type: 'nearMiss'; dist: number; razor: boolean; side: number; points: number; chain: number; kind: Obstacle['kind']; offPiste: boolean; x: number; z: number; h: number }
  | { type: 'chainEnd'; chain: number }
  | { type: 'slowmo'; scale: number; hold: number; ease: number };

/** side: -1 = obstacle on the left of the screen, +1 = right (same convention as steer). */
interface Pass { minD: number; side: number; speed: number; offPiste: boolean; kind: Obstacle['kind']; seen: boolean; x: number; z: number; h: number }

export interface RunState {
  /** Race time: counts from the start gate (z = 0) to the finish line. */
  time: number;
  started: boolean;
  finished: boolean;
  finishZ: number;
  par: number;
  bestSpin: number;
  score: number;
  chain: number;
  chainTimer: number;
  bestChain: number;
  nearMisses: number;
  topSpeed: number;
  crashes: number;
  bestAirTime: number;
  longestJump: number;
  speedPts: number;
  passes: Map<number, Pass>;
}

export function createRun(finishZ = Infinity, par = 0): RunState {
  return {
    time: 0, started: false, finished: false, finishZ, par, bestSpin: 0, score: 0, chain: 0, chainTimer: 0, bestChain: 0, nearMisses: 0,
    topSpeed: 0, crashes: 0, bestAirTime: 0, longestJump: 0, speedPts: 0, passes: new Map(),
  };
}

const near: Obstacle[] = [];
const SPIN_POINTS: Record<number, number> = { 180: 150, 360: 300, 540: 500, 720: 800, 900: 1100, 1080: 1500 };
const QUALITY_MULT: Record<string, number> = { perfect: 1.25, clean: 1, switch: 1, sketchy: 0.5 };

/** Finish bonus: 1000 + 40 per second under par. */
export const finishBonus = (time: number, par: number) => Math.round(1000 + Math.max(0, par - time) * 40);

/** Spin of a landing rounded to the nearest half turn, in degrees. */
export const spinDegrees = (spin: number) => Math.round(Math.abs(spin) / Math.PI) * 180;

function landPoints(run: RunState, e: Extract<SkierEvent, { type: 'land' }>, out: RunEvent[]): void {
  const mult = QUALITY_MULT[e.quality] ?? 0;
  if (!mult) return;
  const deg = spinDegrees(e.spin);
  const spinPts = deg >= 180 ? (SPIN_POINTS[deg] ?? 1500 + ((deg - 1080) / 180) * 500) : 0;
  const flipPts = e.flips * 500;
  const grabPts = (e.grab ?? 0) * T.grabPoints;
  const pts = Math.round((e.airTime * T.airPoints + spinPts + flipPts + grabPts) * mult);
  run.score += pts;
  if (deg >= 180) run.bestSpin = Math.max(run.bestSpin, deg);
  if (spinPts || flipPts || grabPts) {
    const name = [deg >= 180 ? String(deg) : '', e.flips ? (e.flips > 1 ? `${e.flips}x flip` : 'flip') : '', grabPts ? 'grab' : ''].filter(Boolean).join(' + ');
    out.push({ type: 'trick', name, points: pts, quality: e.quality });
  }
}

/** Per physics step: stats, near-miss detection (swept min distance + "passed" test), chains, reward slow-mo. */
export function stepRun(run: RunState, s: SkierState, g: Ground, dt: number, skierEvents: SkierEvent[], out: RunEvent[]): void {
  if (run.finished) return;
  if (!run.started && s.pos.z >= 0) run.started = true;
  if (run.started) run.time += dt;
  if (s.pos.z >= run.finishZ) {
    run.finished = true;
    const bonus = finishBonus(run.time, run.par);
    run.score += bonus;
    endChain(run, out);
    out.push({ type: 'finish', time: run.time, bonus });
    return;
  }
  const speed = s.vel.length();
  run.topSpeed = Math.max(run.topSpeed, speed);
  if (speed > 60 / 3.6 && !s.airborne && s.crashTimer <= 0) run.speedPts += T.speedPoints * dt * ((speed * 3.6 - 60) / 20);
  if (run.speedPts >= 1) {
    const whole = Math.floor(run.speedPts);
    run.score += whole;
    run.speedPts -= whole;
  }

  for (const e of skierEvents) {
    if (e.type === 'crash') {
      run.crashes++;
      endChain(run, out);
      run.passes.clear();
    } else if (e.type === 'land' && e.quality !== 'crash') {
      landPoints(run, e, out);
      run.bestAirTime = Math.max(run.bestAirTime, e.airTime);
      run.longestJump = Math.max(run.longestJump, e.distance);
      if (e.airTime >= T.slowmoAirTime || Math.abs(e.spin) >= 2 * Math.PI - 0.6) {
        out.push({ type: 'slowmo', scale: T.slowmoScale, hold: T.slowmoHold, ease: T.slowmoEase });
      }
    }
  }

  if (run.chain > 0) {
    run.chainTimer -= dt;
    if (run.chainTimer <= 0) endChain(run, out);
  }

  if (s.crashTimer > 0 || !g.obstaclesNear) return;
  const fx = speed > 1 ? s.vel.x / speed : 0;
  const fz = speed > 1 ? s.vel.z / speed : 1;
  const offPiste = g.surface(s.pos.x, s.pos.z) === Surface.Powder;
  for (const p of run.passes.values()) p.seen = false;
  for (const o of g.obstaclesNear(s.pos.x, s.pos.z, 9, near)) {
    const dx = o.x - s.pos.x;
    const dz = o.z - s.pos.z;
    const along = dx * fx + dz * fz;
    const p = run.passes.get(o.id);
    if (along > -1.5) {
      const d = Math.hypot(dx, dz) - o.r - T.skierRadius;
      if (!p) run.passes.set(o.id, { minD: d, side: -Math.sign(fz * dx - fx * dz) || 1, speed, offPiste, kind: o.kind, seen: true, x: o.x, z: o.z, h: o.h });
      else {
        p.seen = true;
        if (d < p.minD) { p.minD = d; p.speed = speed; p.offPiste = offPiste; p.side = -Math.sign(fz * dx - fx * dz) || p.side; }
      }
    } else if (p) {
      p.seen = false; // passed behind: settle it below
    }
  }
  for (const [id, p] of run.passes) {
    if (p.seen) continue;
    run.passes.delete(id);
    if (p.minD > 0 && p.minD < T.nearMissDist && p.speed >= T.nearMissMinSpeed) nearMiss(run, p, out);
  }
}

function nearMiss(run: RunState, p: Pass, out: RunEvent[]): void {
  const razor = p.minD < T.razorDist;
  run.chain++;
  run.chainTimer = T.comboWindow;
  run.bestChain = Math.max(run.bestChain, run.chain);
  run.nearMisses++;
  const points = Math.round((razor ? T.razorPoints : T.nearMissPoints) * run.chain * (p.offPiste ? 2 : 1));
  run.score += points;
  out.push({ type: 'nearMiss', dist: p.minD, razor, side: p.side, points, chain: run.chain, kind: p.kind, offPiste: p.offPiste, x: p.x, z: p.z, h: p.h });
  if (razor) out.push({ type: 'slowmo', scale: T.razorTimeScale, hold: T.razorHold, ease: 0.08 });
}

function endChain(run: RunState, out: RunEvent[]): void {
  if (run.chain > 0) out.push({ type: 'chainEnd', chain: run.chain });
  run.chain = 0;
  run.chainTimer = 0;
}

/** The run as the challenges see it. */
export function runStats(run: RunState): RunStats {
  return {
    finished: run.finished, time: run.time, topKmh: run.topSpeed * 3.6, longestJump: run.longestJump,
    bestChain: run.bestChain, bestSpin: run.bestSpin, crashes: run.crashes, score: run.score,
  };
}

/** Game-time scale for reward slow-motion / hitstop, driven by REAL time so it always ends. */
export class SlowMo {
  scale = 1;
  private low = 1;
  private hold = 0;
  private ease = 0;
  private t = 0;

  trigger(low: number, hold: number, ease: number): void {
    if (this.scale < 1 && low >= this.scale) return; // a stronger effect is running
    this.low = low;
    this.hold = hold;
    this.ease = ease;
    this.t = 0;
    this.scale = low;
  }

  update(realDt: number): number {
    if (this.scale >= 1) return 1;
    this.t += realDt;
    if (this.t <= this.hold) this.scale = this.low;
    else if (this.t >= this.hold + this.ease) this.scale = 1;
    else {
      const k = (this.t - this.hold) / this.ease;
      this.scale = this.low + (1 - this.low) * k * k * (3 - 2 * k);
    }
    return this.scale;
  }
}
