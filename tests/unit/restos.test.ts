import { describe, expect, it } from 'vitest';
import { makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { STATIONS } from '../../src/sim/stations';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

describe('free ride: the restaurants of Les Rousses', () => {
  const m = makeMountain(STATIONS[0], ROUSSES);
  const inFootprint = (r: (typeof m.restos)[number], x: number, z: number) => {
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = x - r.x, dz = z - r.z;
    return Math.abs(dx * c - dz * s) < r.w / 2 && Math.abs(dx * s + dz * c) < r.d / 2;
  };

  it('has the ski area restaurants, each once', () => {
    const names = m.restos.map((r) => r.name);
    expect(m.restos.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Le Poyet');
    expect(names).toContain("Telemark'Afé");
  });

  it('places them on the detailed terrain, solid, in place of the generic box', () => {
    const b = m.bounds;
    for (const r of m.restos) {
      expect(r.x > b.x0 && r.x < b.x1 && r.z > b.z0 && r.z < b.z1, r.name).toBe(true);
      const solid = m.obstaclesNear(r.x, r.z, Math.max(r.w, r.d), []).filter((o) => o.kind === 'building');
      expect(solid.some((o) => Math.hypot(o.x - r.x, o.z - r.z) < Math.max(r.w, r.d) / 2), r.name).toBe(true);
      expect(m.scenery.buildings.some(([x, z]) => inFootprint(r, x, z)), `${r.name}: generic box left`).toBe(false);
    }
  });

  it('keeps pistes and lift stations clear', () => {
    for (const r of m.restos) {
      const h = m.pisteAt(r.x, r.z);
      if (h?.p.name) expect(h.d, `${r.name} on ${h.p.name}`).toBeGreaterThanOrEqual(h.p.halfWidth);
      for (const l of m.lifts) {
        for (const k of [0, l.pts.length - 2]) expect(Math.hypot(l.pts[k] - r.x, l.pts[k + 1] - r.z), `${r.name} / ${l.name}`).toBeGreaterThan(15);
      }
    }
  });

  it('turns each sign towards the nearest piste', () => {
    for (const r of m.restos) {
      let best = Infinity, bx = 0, bz = 0;
      for (const p of m.pistes) {
        if (p.area) continue;
        for (let k = 0; k < p.pts.length; k += 2) {
          const d = Math.hypot(p.pts[k] - r.x, p.pts[k + 1] - r.z);
          if (d < best) { best = d; bx = p.pts[k]; bz = p.pts[k + 1]; }
        }
      }
      const want = Math.atan2(bx - r.x, bz - r.z);
      const off = Math.abs(Math.atan2(Math.sin(r.signYaw - want), Math.cos(r.signYaw - want)));
      expect(off, r.name).toBeLessThan(0.2);
    }
  });

  it('has a free spot in front of each sign', () => {
    m.restos.forEach((r, i) => {
      const at = m.restoSpot(i);
      expect(m.clearSpot(at), r.name).toEqual(at);
      expect(Math.hypot(at.x - r.x, at.z - r.z), r.name).toBeLessThan(Math.max(r.w, r.d) / 2 + 15);
    });
  });

  it('Go there: you stand on the snow in front of the sign, no fall, no slide away', () => {
    m.restos.forEach((r, i) => {
      const at = m.restoSpot(i);
      const s = createSkier(m, at.x, at.z, at.heading);
      const ev: SkierEvent[] = [];
      for (let k = 0; k < 120; k++) stepSkier(s, input(), m, DT, ev);
      expect(s.crashTimer, r.name).toBe(0);
      expect(Math.hypot(s.pos.x - r.x, s.pos.z - r.z), r.name).toBeLessThan(Math.max(r.w, r.d) / 2 + 25);
    });
  });
});
