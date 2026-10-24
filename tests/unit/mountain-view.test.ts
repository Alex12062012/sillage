import { describe, expect, it } from 'vitest';
import { MountainView } from '../../src/render/mountainView';
import { botInput } from '../../src/sim/bot';
import { makeMountain } from '../../src/sim/mountain';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { DT, input } from './helpers';

describe('free ride view: the snow you see is the snow you ski on', () => {
  const m = makeMountain();
  const view = new MountainView(m);
  const b = m.bounds;

  // high draws every 10 m node, medium and low every other one (up to 4 m above the skis before the detail patch)
  for (const q of ['high', 'medium'] as const) {
    it(`skis never sink into the drawn snow (${q} quality)`, () => {
      view.setQuality(q);
      const o = { x: 0, z: 0, dx: 0, dz: 0 };
      const ev: SkierEvent[] = [];
      const sink: number[] = [];
      let worst = 0, where = '';
      for (const p of m.pistes.filter((r) => !r.area && r.len > 400).filter((_, i) => i % 2 === 0)) {
        m.along(p, 0, o);
        const s = createSkier(m, o.x, o.z, Math.atan2(o.dx, o.dz));
        const inp = input();
        for (let t = 0; t < 15; t += DT) {
          botInput(s, m, inp, 160 / 3.6);
          inp.tuck = !s.airborne && !inp.brake;
          stepSkier(s, inp, m, DT, ev);
          view.focus(s.pos.x, s.pos.z);
          // (the game sends you back 30 m from the massif's edge)
          if (s.airborne || s.pos.x < b.x0 + 30 || s.pos.x > b.x1 - 30 || s.pos.z < b.z0 + 30 || s.pos.z > b.z1 - 30) continue;
          const d = view.drawnHeight(s.pos.x, s.pos.z) - s.pos.y;
          sink.push(d);
          if (d > worst) { worst = d; where = `${p.name || 'piste'} at ${s.pos.x | 0}, ${s.pos.z | 0}`; }
        }
      }
      sink.sort((x, y) => x - y);
      expect(sink[Math.floor(sink.length * 0.99)]).toBeLessThan(0.05);
      expect(worst, where).toBeLessThan(0.15); // a 2.5 m patch on a 10 m grid: a few cm (the game shows the skis on the drawn snow anyway)
    }, 20000);
  }

  it('the detail around the skier meets the far terrain without a step', () => {
    view.setQuality('medium');
    view.focus(m.summit.x, m.summit.z);
    const r = view.detailRect();
    expect(r.x1 - r.x0).toBeGreaterThan(200);
    let worst = 0;
    for (let t = 0; t <= 1; t += 1 / 97) {
      const x = r.x0 + (r.x1 - r.x0) * t, z = r.z0 + (r.z1 - r.z0) * t;
      for (const [ax, az, nx, nz] of [[x, r.z0, 0, -1], [x, r.z1, 0, 1], [r.x0, z, -1, 0], [r.x1, z, 1, 0]]) {
        const inside = view.drawnHeight(ax - nx * 1e-3, az - nz * 1e-3), outside = view.drawnHeight(ax + nx * 1e-3, az + nz * 1e-3);
        worst = Math.max(worst, Math.abs(inside - outside));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('follows the skier, a few rows a frame, and stays put at the massif edge', () => {
    view.setQuality('high');
    let x = m.summit.x - 500;
    const z = m.summit.z;
    view.focus(x, z);
    for (let k = 0; k < 60 * 20; k++) {
      x += 30 / 60;
      view.focus(x, z);
      const r = view.detailRect();
      expect(Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z)).toBeGreaterThan(90);
    }
    const edge = b.x1 - 35, r0 = (view.focus(edge, z), view.detailRect());
    view.focus(edge + 2, z);
    expect(view.detailRect()).toEqual(r0); // clamped: no rebuild every frame
  });
});
