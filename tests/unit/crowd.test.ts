import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Crowd } from '../../src/render/crowd';
import { makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { STATIONS } from '../../src/sim/stations';

describe('the crowd on the pistes: busy, some, none', () => {
  const m = makeMountain(STATIONS[0], ROUSSES);
  const crowd = new Crowd(m);
  const sun = new Vector3(0, 1, 0), cam = new Vector3(m.spawn.x, 0, m.spawn.z);
  const active = () => m.dynamic.filter((o) => o.kind === 'skier' && o.x < 1e8).length;
  crowd.update(0.016, sun, cam);
  const total = active();

  it('a station starts busy', () => {
    expect(total).toBeGreaterThan(20);
  });

  it('some keeps ~40 %, none keeps nobody, busy brings them all back', () => {
    crowd.setDensity('some');
    crowd.update(0.016, sun, cam);
    expect(Math.abs(active() - Math.round(total * 0.4))).toBeLessThanOrEqual(1);
    crowd.setDensity('none');
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(0);
    crowd.setDensity('busy');
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(total);
  });

  it('an average day puts ~315 skiers on the named pistes of Les Rousses, ×0.4 off-season, ×2.5 on a peak day', () => {
    expect(total).toBe(315);
    crowd.setTraffic(0.4);
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(126);
    crowd.setTraffic(2.5);
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(788);
    crowd.setDensity('some'); // the station's setting still scales it
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(315);
    crowd.setTraffic(9); // clamped to a peak day
    crowd.setDensity('busy');
    crowd.update(0.016, sun, cam);
    expect(active()).toBe(788);
    crowd.setTraffic(1);
  });

  it('each piste keeps its share over time: length × colour, as in the per-piste estimate', () => {
    const c2 = new Crowd(makeMountain(STATIONS[0], ROUSSES));
    const riders = (c2 as unknown as { riders: { piste: { name: string } }[] }).riders.slice(0, 315); // an average day
    const on = (name: string) => riders.filter((r) => r.piste.name === name).length;
    let b = 0, q = 0, n = 0;
    for (let s = 0; s < 3000; s++) {
      c2.update(0.5, sun, new Vector3(1e7, 0, 1e7));
      if (s > 800 && s % 20 === 0) {
        b += on('Balcon de la Dôle');
        q += on('Les Quatres-Murs');
        n++;
      }
    }
    expect(b / n).toBeGreaterThan(19); // ~25: a long green
    expect(b / n).toBeLessThan(31);
    expect(q / n).toBeLessThan(8); // ~4: a black, quiet
  });
});
