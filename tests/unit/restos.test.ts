import { describe, expect, it } from 'vitest';
import { makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { STATIONS } from '../../src/sim/stations';

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

  it('has a free spot in front of each sign', () => {
    m.restos.forEach((r, i) => {
      const at = m.restoSpot(i);
      expect(m.clearSpot(at), r.name).toEqual(at);
      expect(Math.hypot(at.x - r.x, at.z - r.z), r.name).toBeLessThan(Math.max(r.w, r.d) / 2 + 15);
    });
  });
});
