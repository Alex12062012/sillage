import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { buildHeroGeometry } from '../../src/render/skierHero';
import { BONES } from '../../src/render/skierMesh';

describe("the player's skier (hero)", () => {
  const tris = (t: 'low' | 'medium' | 'high') => buildHeroGeometry(t).geometry.getAttribute('position').count / 3;

  it('stays within its triangle budget per tier (≤ 10 k low, ≤ 30 k high)', () => {
    expect(tris('low')).toBeLessThanOrEqual(10_000);
    expect(tris('high')).toBeLessThanOrEqual(30_000);
    expect(tris('low')).toBeLessThan(tris('medium'));
    expect(tris('medium')).toBeLessThan(tris('high'));
  });

  it('is skinned to the same 20 bones, one colour slot and one PBR pair per vertex', () => {
    const { geometry, slots } = buildHeroGeometry('medium');
    const n = geometry.getAttribute('position').count;
    const idx = geometry.getAttribute('skinIndex');
    for (let i = 0; i < n; i++) expect(idx.getX(i)).toBeLessThan(BONES);
    expect(slots.length).toBe(n);
    expect(geometry.getAttribute('pbr').count).toBe(n);
    expect(geometry.groups.length).toBe(2); // body, goggle lens
  });

  it('keeps each part near its bone (authored in the bone frame, as the crowd model)', () => {
    const b = new Box3().setFromBufferAttribute(buildHeroGeometry('low').geometry.getAttribute('position') as never);
    // the skis run 1.7 m along z around the binding; nothing else reaches further than a pole's length
    expect(b.max.z).toBeLessThan(1.1);
    expect(b.min.z).toBeGreaterThan(-0.9);
    expect(b.max.y).toBeLessThan(1.25);
  });
});
