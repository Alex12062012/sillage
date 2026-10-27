import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { RestoView, restoGeometry } from '../../src/render/restos';
import { makeMountain } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { STATIONS } from '../../src/sim/stations';

describe('the restaurants as drawn', () => {
  const m = makeMountain(STATIONS[0], ROUSSES);

  it('real: the floor on the highest ground (nothing buried), the plinth down to the lowest, as tall as the ridge', () => {
    for (const r of m.restos) {
      const b = new Box3().setFromBufferAttribute(restoGeometry(r, true).getAttribute('position') as never);
      expect(r.floor, r.name).toBeGreaterThanOrEqual(r.y);
      expect(b.min.y, r.name).toBeLessThanOrEqual(r.y);
      expect(b.max.y - r.floor, r.name).toBeGreaterThan(r.ridge - 0.5);
      expect(b.max.y - r.floor, r.name).toBeLessThan(r.ridge + 1.5); // the snow on the roof
    }
  });

  it('generic: the plain block of the other buildings', () => {
    const r = m.restos.find((q) => q.name === 'Le Poyet')!;
    const levels = Math.max(1, Math.round(r.eave / 2.9));
    const b = new Box3().setFromBufferAttribute(restoGeometry(r, false).getAttribute('position') as never);
    expect(b.max.y - r.floor).toBeGreaterThan(levels * 2.9);
    expect(b.max.y - r.floor).toBeLessThan(levels * 2.9 + Math.min(r.w, r.d) * 0.42 + 2.5);
  });

  it('costs at most 3 draw calls', () => {
    const v = new RestoView(m, true);
    let n = 0;
    v.group.traverse((o) => { if (o instanceof Mesh) n++; });
    expect(n).toBeLessThanOrEqual(3);
    v.setReal(false);
    n = 0;
    v.group.traverse((o) => { if (o instanceof Mesh) n++; });
    expect(n).toBeLessThanOrEqual(3);
  });
});
