import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { STATIONS } from '../../src/sim/stations';
import { DT, input } from './helpers';

const m = makeMountain(STATIONS[0], ROUSSES);
const nets = m.equipment.filter((q) => q.kind === 'net') as { x: number; z: number; x2: number; z2: number }[];

/**
 * A bot let loose at (x, z) at 5 m/s along `heading` (arriving there: from a standstill on the flat it never pushes,
 * net or no net): does it reach a piste within `seconds`?
 */
function backOnPiste(x: number, z: number, heading: number, seconds = 45): boolean {
  const s = createSkier(m, x, z, heading), inp = input(), ev: SkierEvent[] = [];
  s.vel.set(Math.sin(heading) * 5, 0, Math.cos(heading) * 5);
  for (let k = 0; k < seconds / DT; k++) {
    botInput(s, m, inp, 30 / 3.6);
    stepSkier(s, inp, m, DT, ev);
    const h = m.pisteAt(s.pos.x, s.pos.z);
    if (h && h.d < h.p.halfWidth) return true;
  }
  return false;
}

describe('barriers: few, only where sure, never in the way (DECISIONS.md, point 108)', () => {
  it('leaves a gap after every net: never two in a row along an edge', () => {
    for (const a of nets) expect(nets.some((b) => b !== a && Math.hypot(b.x - a.x2, b.z - a.z2) < 1)).toBe(false);
    expect(nets.length).toBeLessThan(120); // it was 382 here, along every banked edge
  });

  it('a bot let loose off the piste finds its way back: behind the nets, above the pistes', () => {
    const starts: [number, number, number][] = [];
    // behind nets (6 m further out than the net, facing along it): only those not at a drop-off (you cannot climb a cliff)
    for (const q of nets) {
      const mx = (q.x + q.x2) / 2, mz = (q.z + q.z2) / 2, h = m.pisteAt(mx, mz, 30);
      if (!h || starts.length >= 6) continue;
      const o = { x: 0, z: 0, dx: 0, dz: 0 };
      m.along(h.p, h.s, o);
      const side = Math.sign((mx - o.x) * o.dz - (mz - o.z) * o.dx) || 1, bx = mx + o.dz * side * 6, bz = mz - o.dx * side * 6;
      if (m.height(bx, bz) < m.height(mx, mz) - 2) continue; // a drop-off behind it
      starts.push([bx, bz, Math.atan2(o.dx, o.dz)]);
    }
    // 15 m above the uphill edge of pistes, here and there
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const p of m.pistes.filter((q) => !q.area && q.len > 500).slice(0, 10)) {
      m.along(p, p.len / 2, o);
      for (const side of [-1, 1]) {
        const x = o.x + o.dz * side * (p.halfWidth + 15), z = o.z - o.dx * side * (p.halfWidth + 15);
        if (m.height(x, z) > m.height(o.x, o.z) + 1 && !m.pisteAt(x, z) && m.obstaclesNear(x, z, 3, []).length === 0) starts.push([x, z, Math.atan2(o.dx, o.dz)]);
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(6);
    for (const [x, z, h] of starts) expect(backOnPiste(x, z, h), `from ${Math.round(x)}, ${Math.round(z)}`).toBe(true);
  });
});
