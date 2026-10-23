import { Group, Vector3 } from 'three';
import { COSMETICS } from '../sim/progress';
import type { Mountain } from '../sim/mountain';
import { createSkier, type SkierState } from '../sim/skier';
import { SkierModel } from './skierModel';

interface Rider { model: SkierModel; s: SkierState; piste: number; z: number; speed: number; phase: number; amp: number; wave: number; obstacle: number }

const tmp = new Vector3();

/**
 * Other skiers on the free-ride mountain: kinematic, each carving its own rhythm down a piste, then
 * back on top (they "took the lift"). They are moving obstacles for the near-miss and the crash code.
 */
export class Crowd {
  readonly group = new Group();
  private riders: Rider[] = [];

  constructor(private m: Mountain, count = 8) {
    for (let i = 0; i < count; i++) {
      const o = COSMETICS[(i * 3 + 1) % COSMETICS.length];
      const model = new SkierModel(o);
      this.group.add(model.root, model.shadow);
      const piste = i % m.pistes.length;
      const z = -40 + ((i * 397) % 1150);
      m.dynamic.push({ id: 900000 + i, x: 0, z, r: 0.45, h: 1.8, kind: 'skier' });
      this.riders.push({
        model, s: createSkier(m, m.pistes[piste].x(z), z, 0), piste, z, speed: 8 + ((i * 7) % 6),
        phase: i * 1.7, amp: 0.35 + ((i * 5) % 4) * 0.12, wave: 26 + ((i * 11) % 5) * 6, obstacle: m.dynamic.length - 1,
      });
    }
  }

  private lineX(r: Rider, z: number): number {
    const p = this.m.pistes[r.piste];
    return p.x(z) + Math.sin(r.phase + z / r.wave * Math.PI) * p.halfWidth * r.amp;
  }

  update(dt: number, sunDir: Vector3): void {
    for (const r of this.riders) {
      const p = this.m.pistes[r.piste];
      r.z += r.speed * dt * 0.92;
      if (r.z > p.z1 - 30) {
        r.piste = (r.piste + 1) % this.m.pistes.length;
        r.z = 20 + (r.obstacle % 4) * 15; // back on top, below the summit platform
      }
      const s = r.s;
      const x = this.lineX(r, r.z);
      const dx = (this.lineX(r, r.z + 1) - this.lineX(r, r.z - 1)) / 2;
      const ddx = this.lineX(r, r.z + 1) - 2 * x + this.lineX(r, r.z - 1);
      s.pos.set(x, this.m.height(x, r.z), r.z);
      s.heading = Math.atan2(dx, 1);
      tmp.set(dx, 0, 1).normalize().multiplyScalar(r.speed);
      s.vel.copy(tmp);
      s.edge = Math.max(-1, Math.min(1, ddx * r.speed * r.speed * 0.6)); // lateral accel / grip, roughly
      s.surface = this.m.surface(x, r.z);
      this.m.normal(x, r.z, s.normal);
      r.model.update(s, s.pos, s.heading, this.m, dt, sunDir);
      const o = this.m.dynamic[r.obstacle];
      o.x = x;
      o.z = r.z;
    }
  }
}
