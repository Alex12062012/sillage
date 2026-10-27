import { describe, expect, it } from 'vitest';
import { botInput } from '../../src/sim/bot';
import { makeMountain, SLOPES, type Mountain, type PisteColor } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { DEFAULT_CONFIG } from '../../src/sim/stationConfig';
import { STATIONS } from '../../src/sim/stations';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

const st = STATIONS[0];
const real = makeMountain(st, ROUSSES, { ...DEFAULT_CONFIG, slopes: 'real' });
const fun = makeMountain(st, ROUSSES, { ...DEFAULT_CONFIG, slopes: 'fun' });
const memory = makeMountain(st, ROUSSES, { ...DEFAULT_CONFIG, slopes: 'memory' });

/** Drop over length of the graded pistes of these colours, all together. */
const slope = (m: Mountain, colors: PisteColor[]) => {
  let drop = 0, len = 0;
  for (const p of m.pistes) if (!p.area && colors.includes(p.difficulty)) { drop += p.hc[0] - p.hc[p.hc.length - 1]; len += p.len; }
  return drop / len;
};
const maxStep = (m: Mountain) => {
  let mx = 0;
  const g = m.grid;
  for (let j = 1; j < g.nz; j++) for (let i = 1; i < g.nx; i++) {
    const h = g.h[j * g.nx + i];
    mx = Math.max(mx, Math.abs(h - g.h[j * g.nx + i - 1]), Math.abs(h - g.h[(j - 1) * g.nx + i]));
  }
  return mx;
};

describe('slopes: real, steeper for fun, as remembered', () => {
  it('real is the game as it is (La Dôle at 2269 m)', () => {
    expect(real.height(real.summit.x, real.summit.z)).toBeCloseTo(2269.1, 0);
    expect(makeMountain(st, ROUSSES).height(real.summit.x, real.summit.z)).toBeCloseTo(2269.1, 0);
  });

  it('as remembered: the blacks 30 %+ steeper, the reds 10 %+, the greens and blues as they are', () => {
    expect(slope(memory, ['black']) / slope(real, ['black'])).toBeGreaterThanOrEqual(1.3);
    expect(slope(memory, ['red']) / slope(real, ['red'])).toBeGreaterThanOrEqual(1.1);
    const gb = slope(memory, ['green', 'blue']) / slope(real, ['green', 'blue']);
    expect(gb).toBeGreaterThan(0.95);
    expect(gb).toBeLessThan(1.05);
  });

  it('fun: every piste 15 %+ steeper', () => {
    const all: PisteColor[] = ['green', 'blue', 'red', 'black'];
    expect(slope(fun, all) / slope(real, all)).toBeGreaterThanOrEqual(1.15);
  });

  it('no step in the snow: nothing steeper than the accent itself makes it', () => {
    expect(maxStep(memory)).toBeLessThanOrEqual(maxStep(real) * SLOPES.memory.accent.black);
  });

  for (const [name, m] of [['fun', fun], ['memory', memory]] as const) {
    it(`${name}: graded pistes still never climb more than a skate`, () => {
      const o = { x: 0, z: 0, dx: 0, dz: 0 };
      for (const p of m.pistes.filter((q) => !q.area)) {
        let lo = Infinity;
        for (let s = 0; s <= p.len; s += 5) {
          m.along(p, s, o);
          const h = m.height(o.x, o.z);
          expect(h - lo, `${p.name || 'piste'} at ${s} m`).toBeLessThan(6);
          lo = Math.min(lo, h);
        }
      }
    });

    it(`${name}: the bot still skis down from La Dôle, hardly ever falling`, () => {
      const s = createSkier(m, m.summit.x, m.summit.z, m.summit.heading);
      const h0 = s.pos.y, inp = input(), ev: SkierEvent[] = [];
      let crashes = 0;
      for (let t = 0; t < 120; t += DT) {
        ev.length = 0;
        botInput(s, m, inp, 50 / 3.6);
        stepSkier(s, inp, m, DT, ev);
        crashes += ev.filter((e) => e.type === 'crash').length;
      }
      expect(h0 - s.pos.y).toBeGreaterThan(150);
      expect(crashes).toBeLessThan(3);
    });
  }
});
