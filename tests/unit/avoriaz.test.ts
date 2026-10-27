import { describe, expect, it } from 'vitest';
import { AVORIAZ } from '../../src/sim/avoriaz-data';
import { botInput } from '../../src/sim/bot';
import { makeMountain } from '../../src/sim/mountain';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { STATIONS, stationOfTrack } from '../../src/sim/stations';
import { trackById } from '../../src/sim/tracks';
import { DT, input } from './helpers';

describe('free ride: Avoriaz, from Morzine to the Swiss Wall', () => {
  const st = stationOfTrack('free-avoriaz')!;
  const m = makeMountain(st, AVORIAZ);
  const o = { x: 0, z: 0, dx: 0, dz: 0 };
  const lift = (name: string) => m.lifts.find((l) => l.name === name)!;
  const end = (l: (typeof m.lifts)[number], f: number) => (m.liftPoint(l, f, o), m.height(o.x, o.z));

  it('is a station of its own: its free ride, its start, its summit', () => {
    expect(STATIONS.map((s) => s.id)).toEqual(['rousses', 'avoriaz']);
    expect(trackById('free-avoriaz').name).toBe('Avoriaz');
    expect(trackById('free').name).toBe('Les Rousses'); // saves from before keep their free ride
    expect(m.steep).toBe(1); // the Alps as they are
  });

  it('is the real Avoriaz: Super-Morzine climbs from the village, three gondolas, the Hauts-Forts above 2 350 m', () => {
    const sm = lift('Super-Morzine');
    expect(sm.kind).toBe('gondola');
    expect(end(sm, 0)).toBeGreaterThan(900);
    expect(end(sm, 0)).toBeLessThan(1020); // Morzine, ~960 m
    expect(end(sm, 1)).toBeGreaterThan(1400); // Super-Morzine, ~1 460 m
    expect(m.lifts.filter((l) => l.kind === 'gondola').map((l) => l.name).sort()).toEqual(['Ardent', 'Prodains Express 3S', 'Super-Morzine']);
    let top = 0;
    for (let i = 0; i < m.grid.h.length; i++) top = Math.max(top, m.grid.h[i]);
    expect(top).toBeGreaterThan(2350);
    for (const l of m.lifts.filter((q) => q.len > 600)) expect(end(l, 1), l.name).toBeGreaterThan(end(l, 0) + 50); // the Plateau chair: +73 m
  });

  it('starts in the Super-Morzine queue, in the village', () => {
    const sm = lift('Super-Morzine');
    expect(Math.hypot(m.spawn.x - sm.pts[0], m.spawn.z - sm.pts[1])).toBeLessThan(20);
    expect(m.height(m.spawn.x, m.spawn.z)).toBeLessThan(1020);
  });

  it('has the Swiss Wall, and it is steep', () => {
    const wall = m.pistes.filter((p) => /Mur Suisse/.test(p.name));
    expect(wall.length).toBeGreaterThan(0);
    let steepest = 0;
    for (const p of wall) {
      for (let s = 0; s + 40 <= p.len; s += 5) {
        m.along(p, s, o);
        const a = m.height(o.x, o.z);
        m.along(p, s + 40, o);
        steepest = Math.max(steepest, (Math.atan2(a - m.height(o.x, o.z), 40) * 180) / Math.PI);
      }
    }
    expect(steepest).toBeGreaterThan(30); // ~37° for real: the terrain tiles round it off a little
    expect(lift('Chavanette').kind).toBe('chair'); // and the chair back up from its foot, in Switzerland
  });

  it('graded pistes never climb more than a skate (the traverses back from Chavanette a little more)', () => {
    for (const p of m.pistes.filter((q) => !q.area)) {
      let lo = Infinity;
      for (let s = 0; s <= p.len; s += 5) {
        m.along(p, s, o);
        const h = m.height(o.x, o.z);
        expect(h - lo, `${p.name || 'piste'} at ${s} m`).toBeLessThan(12);
        lo = Math.min(lo, h);
      }
    }
  });

  it('has its forests, and no tree on a piste', () => {
    const trees = m.obstaclesBetween(-1e5, 1e5).filter((o) => o.kind === 'tree'); // lift stations stand where pistes end
    expect(trees.length).toBeGreaterThan(20000);
    for (const t of trees) expect(m.pisteAt(t.x, t.z), `tree at ${t.x | 0}, ${t.z | 0}`).toBeNull();
  });

  it('the line-following bot skis down from the summit without getting stuck', () => {
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
    expect(h0 - s.pos.y).toBeGreaterThan(300);
    expect(Math.hypot(s.pos.x - x0, s.pos.z - z0)).toBeGreaterThan(1000);
    expect(crashes).toBeLessThan(3);
  });

  it('is fast where it is steep: tucked down the reds and blacks a line-follower averages 80+ km/h', () => {
    const ev: SkierEvent[] = [];
    let sum = 0, n = 0;
    for (const p of m.pistes.filter((q) => !q.area && q.len > 400 && q.name && (q.difficulty === 'red' || q.difficulty === 'black'))) {
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
    expect(sum / n).toBeGreaterThan(80);
  }, 20000);
});
