import { Group, Vector3 } from 'three';
import { mulberry32 } from '../core/rng';
import { COSMETICS } from '../sim/progress';
import type { Mountain, Piste, PisteColor } from '../sim/mountain';
import type { CrowdLevel } from '../sim/stationConfig';
import { createSkier, type SkierState } from '../sim/skier';
import type { Ground, Obstacle } from '../sim/track';
import { SkierModel } from './skierModel';

interface Rider { s: SkierState; piste: Piste; d: number; speed: number; phase: number; amp: number; wave: number; obstacle: Obstacle; dist: number; model: SkierModel | null }

const tmp = new Vector3();
const a = { x: 0, z: 0, dx: 0, dz: 0 };
/** How busy a piste is, per metre, by colour: the blues and greens of the resort's heart fill up, the blacks less. */
const BUSY: Record<PisteColor, number> = { green: 1.3, blue: 1.5, red: 1, black: 0.45 };
/** Skiers on the station per km of pistes, and how many of them are drawn (the nearest, within VIEW m). */
const PER_KM = 1.2;
const POOL = 24;
const VIEW = 380;
/** The share of the station's skiers out on the pistes, per the station's setting. */
const DENSITY: Record<CrowdLevel, number> = { busy: 1, some: 0.4, none: 0 };

/**
 * Other skiers on the station: kinematic, each carving its own rhythm down a real piste, into the next one at its
 * end, or back on top of another (they "took the lift"); more of them on the busy pistes. Moving obstacles for the
 * near-miss and crash code, all of them; only the nearest POOL get a body (skinned skiers cost a phone dearly).
 */
export class Crowd {
  readonly group = new Group();
  private riders: Rider[] = [];
  private runs: Piste[];
  private weights: number[];
  private pool: SkierModel[] = [];
  private rnd: () => number;
  private ground: Ground;
  /** How many riders are out (the first ones: the same faces whatever the setting). */
  private active = Infinity;

  /** `drawn`: the snow's height as the view draws it (far from the player, a little off the physics' smooth surface). */
  constructor(private m: Mountain, private drawn: (x: number, z: number) => number = m.height, count = Math.round(m.station.km * PER_KM)) {
    this.ground = { height: drawn, normal: m.normal, surface: m.surface };
    this.rnd = mulberry32(m.def.seed + 91);
    this.runs = m.pistes.filter((p) => !p.area && p.len > 300 && p.name);
    this.weights = this.runs.map((p) => p.len * BUSY[p.difficulty]);
    for (let i = 0; i < POOL; i++) {
      const model = new SkierModel(COSMETICS[(i * 3 + 1) % COSMETICS.length]);
      model.root.visible = model.shadow.visible = false;
      this.pool.push(model);
      this.group.add(model.root, model.shadow);
    }
    for (let i = 0; i < count; i++) {
      const piste = this.pick();
      const obstacle: Obstacle = { id: 900000 + i, x: 0, z: 0, r: 0.45, h: 1.8, kind: 'skier' };
      m.dynamic.push(obstacle);
      this.riders.push({
        s: createSkier(m, piste.pts[0], piste.pts[1], 0), piste, d: this.rnd() * piste.len, speed: 9 + this.rnd() * 10,
        phase: i * 1.7, amp: 0.25 + this.rnd() * 0.45, wave: 22 + this.rnd() * 30, obstacle, dist: Infinity, model: null,
      });
    }
  }

  /** The station's setting: busy, some, none (the players online are another matter: see OtherSkiers). */
  setDensity(level: CrowdLevel): void {
    this.active = Math.round(this.riders.length * DENSITY[level]);
  }

  /** A piste, the busier ones more often. */
  private pick(): Piste {
    let t = this.rnd() * this.weights.reduce((x, y) => x + y, 0);
    for (let k = 0; k < this.runs.length; k++) if ((t -= this.weights[k]) <= 0) return this.runs[k];
    return this.runs[this.runs.length - 1];
  }

  /** Point on the rider's line at arc length d: the piste line plus its carving wiggle. */
  private line(r: Rider, d: number, out: { x: number; z: number }): void {
    this.m.along(r.piste, d, a);
    const w = Math.sin(r.phase + (d / r.wave) * Math.PI) * r.piste.halfWidth * r.amp;
    out.x = a.x + a.dz * w;
    out.z = a.z - a.dx * w;
  }

  update(dt: number, sunDir: Vector3, cam: Vector3): void {
    const p0 = { x: 0, z: 0 }, p1 = { x: 0, z: 0 }, p2 = { x: 0, z: 0 };
    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      if (i >= this.active) { r.obstacle.x = r.obstacle.z = 1e9; r.dist = Infinity; continue; } // gone home: out of reach, not drawn
      r.d += r.speed * dt * 0.92;
      if (r.d > r.piste.len - 5) {
        const n = r.piste.next;
        if (n && n.p.len - n.s > 60) {
          r.piste = n.p;
          r.d = n.s;
        } else {
          r.piste = this.pick();
          r.d = 0;
        }
      }
      this.line(r, r.d, p1);
      r.obstacle.x = p1.x;
      r.obstacle.z = p1.z;
      r.dist = Math.hypot(p1.x - cam.x, p1.z - cam.z);
    }
    // the nearest ones keep (or get) a body
    const near = this.riders.filter((r) => r.dist < VIEW).sort((x, y) => x.dist - y.dist).slice(0, POOL);
    const keep = new Set(near);
    for (const r of this.riders) if (r.model && !keep.has(r)) r.model = null;
    const free = this.pool.filter((md) => !near.some((r) => r.model === md));
    for (const md of this.pool) md.root.visible = md.shadow.visible = false;
    for (const r of near) {
      if (!r.model) r.model = free.pop() ?? null;
      if (!r.model) continue;
      const s = r.s;
      this.line(r, r.d - 1, p0);
      this.line(r, r.d, p1);
      this.line(r, r.d + 1, p2);
      const dx = (p2.x - p0.x) / 2, dz = (p2.z - p0.z) / 2;
      const turn = (p2.x - 2 * p1.x + p0.x) * dz - (p2.z - 2 * p1.z + p0.z) * dx; // signed curvature, roughly
      s.pos.set(p1.x, this.drawn(p1.x, p1.z), p1.z);
      s.heading = Math.atan2(dx, dz);
      tmp.set(dx, 0, dz).normalize().multiplyScalar(r.speed);
      s.vel.copy(tmp);
      s.edge = Math.max(-1, Math.min(1, turn * r.speed * r.speed * 0.6)); // lateral accel / grip, roughly
      s.surface = this.m.surface(p1.x, p1.z);
      this.m.normal(p1.x, p1.z, s.normal);
      r.model.root.visible = r.model.shadow.visible = true;
      r.model.update(s, s.pos, s.heading, this.ground, dt, sunDir);
    }
  }
}
