import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { liftTowers, makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { STATIONS } from '../../src/sim/stations';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

describe('free ride: Les Rousses, Dôle-Tuffes', () => {
  const m = makeMountain(STATIONS[0], ROUSSES);
  const lift = (name: string) => m.lifts.find((l) => l.name === name)!;
  const end = (name: string, f: number) => {
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    m.liftPoint(lift(name), f, o);
    return m.height(o.x, o.z);
  };

  it('is the real massif: La Dôle above 1640 m, the Dappes chair climbs ~400 m, every real lift goes up', () => {
    expect(m.height(m.summit.x, m.summit.z)).toBeGreaterThan(1620);
    expect(end('Dappes', 1) - end('Dappes', 0)).toBeGreaterThan(350);
    expect(end('Dappes - Tuffes', 1)).toBeGreaterThan(1400);
    for (const l of m.lifts.filter((q) => q.len > 300)) expect(end(l.name, 1), l.name).toBeGreaterThan(end(l.name, 0) + 20);
  });

  it('reaches La Cure: the detailed grid covers ~46.468 N', () => {
    expect(m.bounds.z0).toBeLessThan(-3100); // (46.44 − 46.468) × 111195 ≈ −3113 m: L'Arbezie, Chez Mamac
  });

  it('graded pistes never climb more than a skate', () => {
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const p of m.pistes.filter((q) => !q.area)) {
      let lo = Infinity;
      for (let s = 0; s <= p.len; s += 5) {
        m.along(p, s, o);
        const h = m.height(o.x, o.z);
        expect(h - lo, `${p.name || 'piste'} at ${s} m`).toBeLessThan(6); // a skate: real cols, and benches meeting at junctions
        lo = Math.min(lo, h);
      }
    }
  });

  it('has its forests, and no tree on a piste', () => {
    const trees = m.obstaclesBetween(-1e4, 1e4).filter((o) => o.kind === 'tree'); // lift stations stand where pistes end
    expect(trees.length).toBeGreaterThan(8000);
    expect(trees.length).toBeLessThan(60000);
    for (const t of trees) {
      const h = m.pisteAt(t.x, t.z);
      expect(h, `tree at ${t.x | 0}, ${t.z | 0}`).toBeNull();
    }
  });

  it('is fast: tucked down the main runs from a standstill, a line-follower averages 90+ km/h (100–110 once rolling)', () => {
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    const ev: SkierEvent[] = [];
    let sum = 0, n = 0;
    for (const p of m.pistes.filter((q) => !q.area && q.len > 400 && q.name && !/Liaison|Route|Balcon/.test(q.name))) {
      m.along(p, 0, o);
      const s = createSkier(m, o.x, o.z, Math.atan2(o.dx, o.dz));
      const inp = input();
      for (let t = 0; t < 40; t += DT) {
        botInput(s, m, inp, 160 / 3.6);
        inp.tuck = !s.airborne && !inp.brake;
        stepSkier(s, inp, m, DT, ev);
        sum += s.vel.length() * 3.6;
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(90);
  });

  it('the line-following bot skis down from La Dôle without getting stuck', () => {
    const s = createSkier(m, m.summit.x, m.summit.z, m.summit.heading);
    const h0 = s.pos.y, x0 = s.pos.x, z0 = s.pos.z;
    const inp = input();
    const ev: SkierEvent[] = [];
    let crashes = 0;
    for (let t = 0; t < 120; t += DT) {
      ev.length = 0;
      botInput(s, m, inp, 50 / 3.6);
      stepSkier(s, inp, m, DT, ev);
      crashes += ev.filter((e) => e.type === 'crash').length;
    }
    expect(h0 - s.pos.y).toBeGreaterThan(150); // La Dôle's pistes are long and gentle: ~190 m down in 2 min
    expect(Math.hypot(s.pos.x - x0, s.pos.z - z0)).toBeGreaterThan(800);
    expect(crashes).toBeLessThan(3);
  });

  it('the buildings and the lift towers are solid', () => {
    const solid = (x: number, z: number, kind: string, r: number) =>
      m.obstaclesNear(x, z, r + 30, []).some((o) => o.kind === kind && Math.hypot(o.x - x, o.z - z) < o.r + r);
    for (const [x, z, w, d] of m.scenery.buildings) expect(solid(x, z, 'building', 0), `building at ${x | 0}, ${z | 0}`).toBe(Math.max(w, d) > 0);
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const l of m.lifts.filter((q) => q.kind !== 'carpet')) {
      for (const f of liftTowers(l)) {
        m.liftPoint(l, f, o);
        expect(solid(o.x, o.z, 'tower', 0.3), `${l.name} tower at ${f.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('the start queue: every place has a clear way ahead, past the lift station (players online fill it)', () => {
    const at = m.spawn, fx = Math.sin(at.heading), fz = Math.cos(at.heading);
    for (const side of [0, 4, -4, 8, -8]) {
      const x0 = at.x + fz * side, z0 = at.z - fx * side;
      for (let a = 0; a <= 20; a += 1) {
        const x = x0 + fx * a, z = z0 + fz * a;
        const hit = m.obstaclesNear(x, z, 1, []).filter((o) => o.kind === 'station' && Math.hypot(o.x - x, o.z - z) < o.r + 0.5);
        expect(hit.length, `side ${side}, ${a} m ahead`).toBe(0);
      }
    }
  });

  it('a spawn where someone stands moves beside or behind them, never ahead (no hit again and again)', () => {
    const at = m.summit;
    expect(m.clearSpot(at)).toEqual(at); // nobody there: right there
    const other = { id: 123456, x: at.x, z: at.z, r: 0.45, h: 1.8, kind: 'skier' as const };
    m.dynamic.push(other);
    try {
      const sp = m.clearSpot(at);
      const dx = sp.x - at.x, dz = sp.z - at.z;
      expect(Math.hypot(dx, dz)).toBeGreaterThan(2.5);
      expect(dx * Math.sin(at.heading) + dz * Math.cos(at.heading)).toBeLessThanOrEqual(1e-9); // not ahead
      expect(sp.heading).toBe(at.heading);
      // the respawn after a fall there too
      const r = m.respawn!(at.z, at.x);
      expect(Math.hypot(r.x - other.x, r.z - other.z)).toBeGreaterThan(2.5);
    } finally {
      m.dynamic.splice(m.dynamic.indexOf(other), 1);
    }
  });
});
