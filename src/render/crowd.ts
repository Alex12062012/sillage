import { Group, Vector3 } from 'three';
import { COSMETICS } from '../sim/progress';
import type { Mountain, Piste } from '../sim/mountain';
import { createSkier, type SkierState } from '../sim/skier';
import type { Ground } from '../sim/track';
import { SkierModel } from './skierModel';

interface Rider { model: SkierModel; s: SkierState; piste: Piste; d: number; speed: number; phase: number; amp: number; wave: number; obstacle: number }

const tmp = new Vector3();
const a = { x: 0, z: 0, dx: 0, dz: 0 };

/**
 * Other skiers on Les Rousses: kinematic, each carving its own rhythm down a real piste, into the next one
 * at its end, or back on top of another (they "took the lift"). Moving obstacles for the near-miss and crash code.
 */
export class Crowd {
  readonly group = new Group();
  private riders: Rider[] = [];
  private runs: Piste[];

  private ground: Ground;

  /** `drawn`: the snow's height as the view draws it (far from the player, a little off the physics' smooth surface). */
  constructor(private m: Mountain, private drawn: (x: number, z: number) => number = m.height, count = 8) {
    this.ground = { height: drawn, normal: m.normal, surface: m.surface };
    this.runs = m.pistes.filter((p) => !p.area && p.len > 300 && p.name);
    for (let i = 0; i < count; i++) {
      const o = COSMETICS[(i * 3 + 1) % COSMETICS.length];
      const model = new SkierModel(o);
      this.group.add(model.root, model.shadow);
      const piste = this.runs[(i * 7) % this.runs.length];
      m.dynamic.push({ id: 900000 + i, x: 0, z: 0, r: 0.45, h: 1.8, kind: 'skier' });
      this.riders.push({
        model, s: createSkier(m, piste.pts[0], piste.pts[1], 0), piste, d: (i * 397) % piste.len, speed: 12 + ((i * 7) % 6) * 1.6,
        phase: i * 1.7, amp: 0.35 + ((i * 5) % 4) * 0.12, wave: 26 + ((i * 11) % 5) * 6, obstacle: m.dynamic.length - 1,
      });
    }
  }

  /** Point on the rider's line at arc length d: the piste line plus its carving wiggle. */
  private line(r: Rider, d: number, out: { x: number; z: number }): void {
    this.m.along(r.piste, d, a);
    const w = Math.sin(r.phase + (d / r.wave) * Math.PI) * r.piste.halfWidth * r.amp;
    out.x = a.x + a.dz * w;
    out.z = a.z - a.dx * w;
  }

  update(dt: number, sunDir: Vector3): void {
    const p0 = { x: 0, z: 0 }, p1 = { x: 0, z: 0 }, p2 = { x: 0, z: 0 };
    for (const r of this.riders) {
      r.d += r.speed * dt * 0.92;
      if (r.d > r.piste.len - 5) {
        const n = r.piste.next;
        if (n && n.p.len - n.s > 60) {
          r.piste = n.p;
          r.d = n.s;
        } else {
          r.piste = this.runs[(this.runs.indexOf(r.piste) + 3 + r.obstacle) % this.runs.length];
          r.d = 0;
        }
      }
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
      r.model.update(s, s.pos, s.heading, this.ground, dt, sunDir);
      const o = this.m.dynamic[r.obstacle];
      o.x = p1.x;
      o.z = p1.z;
    }
  }
}
