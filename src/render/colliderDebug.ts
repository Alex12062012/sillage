import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { Obstacle } from '../sim/track';

/**
 * Debug only (the test build's API, never production): the colliders the skier hits, drawn as red outlines at the
 * snow and at their height (capped at 4 m), within `radius` m of (x, z). Circles as 24-gons, rectangles as boxes.
 */
export function colliderLines(list: Obstacle[], height: (x: number, z: number) => number, x: number, z: number, radius: number): LineSegments {
  const v: number[] = [];
  const seg = (a: number[], b: number[]) => v.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const o of list) {
    if (Math.hypot(o.x - x, o.z - z) > radius + o.r) continue;
    const y0 = height(o.x, o.z) + 0.05, y1 = y0 + Math.min(o.h, 4);
    const ring: number[][] = [];
    if (o.box) {
      const { c, s, hx, hz } = o.box;
      for (const [lx, lz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) ring.push([o.x + lx * c - lz * s, o.z + lx * s + lz * c]);
    } else for (let k = 0; k < 24; k++) ring.push([o.x + Math.cos((k / 24) * Math.PI * 2) * o.r, o.z + Math.sin((k / 24) * Math.PI * 2) * o.r]);
    ring.forEach(([px, pz], k) => {
      const [qx, qz] = ring[(k + 1) % ring.length];
      seg([px, y0, pz], [qx, y0, qz]);
      seg([px, y1, pz], [qx, y1, qz]);
      if (o.box || k % 6 === 0) seg([px, y0, pz], [px, y1, pz]);
    });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  const lines = new LineSegments(g, new LineBasicMaterial({ color: 0xff2a2a, depthTest: false, transparent: true }));
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  return lines;
}
