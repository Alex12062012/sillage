import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { makeMountain } from '../../src/sim/mountain';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

describe('free ride: Les Rousses, Dôle-Tuffes', () => {
  const m = makeMountain();
  const lift = (name: string) => m.lifts.find((l) => l.name === name)!;
  const end = (name: string, f: number) => {
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    m.liftPoint(lift(name), f, o);
    return m.height(o.x, o.z);
  };

  it('is the real massif: La Dôle above 1640 m, the Dappes chair climbs ~400 m, every real lift goes up', () => {
    expect(m.height(m.spawn.x, m.spawn.z)).toBeGreaterThan(1620);
    expect(end('Dappes', 1) - end('Dappes', 0)).toBeGreaterThan(350);
    expect(end('Dappes - Tuffes', 1)).toBeGreaterThan(1400);
    for (const l of m.lifts.filter((q) => q.len > 300)) expect(end(l.name, 1), l.name).toBeGreaterThan(end(l.name, 0) + 20);
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
    const trees = m.obstaclesBetween(-1e4, 1e4);
    expect(trees.length).toBeGreaterThan(8000);
    expect(trees.length).toBeLessThan(60000);
    for (const t of trees) {
      const h = m.pisteAt(t.x, t.z);
      expect(h, `tree at ${t.x | 0}, ${t.z | 0}`).toBeNull();
    }
  });

  it('the line-following bot skis down from La Dôle without getting stuck', () => {
    const s = createSkier(m, m.spawn.x, m.spawn.z, m.spawn.heading);
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
});
