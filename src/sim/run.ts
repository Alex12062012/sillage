import { TUNING as T } from '../tuning';
import type { SkierEvent, SkierState } from './skier';
import { Surface, type Ground, type Obstacle } from './track';

export type RunEvent =
  | { type: 'nearMiss'; dist: number; razor: boolean; side: number; points: number; chain: number; kind: Obstacle['kind']; offPiste: boolean }
  | { type: 'chainEnd'; chain: number }
  | { type: 'slowmo'; scale: number; hold: number; ease: number };

/** side: -1 = obstacle on the left of the screen, +1 = right (same convention as steer). */
interface Pass { minD: number; side: number; speed: number; offPiste: boolean; kind: Obstacle['kind']; seen: boolean }

export interface RunState {
  time: number;
  score: number;
  chain: number;
  chainTimer: number;
  bestChain: number;
  nearMisses: number;
  topSpeed: number;
  crashes: number;
  bestAirTime: number;
  longestJump: number;
  passes: Map<number, Pass>;
}

export function createRun(): RunState {
  return {
    time: 0, score: 0, chain: 0, chainTimer: 0, bestChain: 0, nearMisses: 0,
    topSpeed: 0, crashes: 0, bestAirTime: 0, longestJump: 0, passes: new Map(),
  };
}

const near: Obstacle[] = [];

/** Per physics step: stats, near-miss detection (swept min distance + "passed" test), chains, reward slow-mo. */
export function stepRun(run: RunState, s: SkierState, g: Ground, dt: number, skierEvents: SkierEvent[], out: RunEvent[]): void {
  run.time += dt;
  const speed = s.vel.length();
  run.topSpeed = Math.max(run.topSpeed, speed);

  for (const e of skierEvents) {
    if (e.type === 'crash') {
      run.crashes++;
      endChain(run, out);
      run.passes.clear();
    } else if (e.type === 'land' && e.quality !== 'crash') {
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
      if (!p) run.passes.set(o.id, { minD: d, side: -Math.sign(fz * dx - fx * dz) || 1, speed, offPiste, kind: o.kind, seen: true });
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
  out.push({ type: 'nearMiss', dist: p.minD, razor, side: p.side, points, chain: run.chain, kind: p.kind, offPiste: p.offPiste });
  if (razor) out.push({ type: 'slowmo', scale: T.razorTimeScale, hold: T.razorHold, ease: 0.08 });
}

function endChain(run: RunState, out: RunEvent[]): void {
  if (run.chain > 0) out.push({ type: 'chainEnd', chain: run.chain });
  run.chain = 0;
  run.chainTimer = 0;
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
