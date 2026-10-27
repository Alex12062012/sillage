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
});
