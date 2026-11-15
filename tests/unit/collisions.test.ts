import { describe, expect, it } from 'vitest';
import { makeMountain, towerScale } from '../../src/sim/mountain';
import { ROUSSES } from '../../src/sim/rousses-data';
import { createSkier, stepSkier, type SkierEvent } from '../../src/sim/skier';
import { STATIONS } from '../../src/sim/stations';
import { boxObstacle, obstacleGap, type Obstacle } from '../../src/sim/track';
import { treeLook } from '../../src/sim/treeLook';
import { TUNING as T } from '../../src/tuning';
import { DT, input } from './helpers';

const m = makeMountain(STATIONS[0], ROUSSES);
const all = m.obstaclesBetween(-1e5, 1e5);
const n = { x: 0, z: 0 };

/**
 * Drives the skier at 10 m/s from `from` (m away, on the side `dir`) straight at o for 3 s: the deepest it got into o,
 * and how far it went towards it in the first second (blocked: less than `from`; it may then slide round a trunk).
 */
function ram(o: Obstacle, from: number, dir: [number, number]): { deepest: number; moved: number } {
  const len = Math.hypot(...dir), ux = dir[0] / len, uz = dir[1] / len;
  const s = createSkier(m, o.x + ux * from, o.z + uz * from, Math.atan2(-ux, -uz));
  const ev: SkierEvent[] = [];
  let deepest = Infinity, moved = 0;
  const x0 = s.pos.x, z0 = s.pos.z;
  for (let k = 0; k < 180; k++) {
    s.vel.x = -ux * 10;
    s.vel.z = -uz * 10;
    stepSkier(s, input(), m, DT, ev);
    deepest = Math.min(deepest, obstacleGap(o, s.pos.x, s.pos.z, n));
    if (k === 59) moved = -((s.pos.x - x0) * ux + (s.pos.z - z0) * uz);
  }
  return { deepest, moved };
}

describe('collisions match what is drawn (DECISIONS.md, point 107)', () => {
  it('parks the groomers off the pistes, away from the start queue', () => {
    const groomers = m.equipment.filter((q) => q.kind === 'groomer');
    expect(groomers.length).toBeGreaterThan(0);
    for (const g of groomers) {
      expect(m.pisteAt(g.x, g.z)).toBeNull();
      expect(Math.hypot(g.x - m.spawn.x, g.z - m.spawn.z)).toBeGreaterThan(15);
    }
  });

  it('a rectangle: inside, outside, past a corner', () => {
    const b = boxObstacle(0, 10, 20, 4, 2, Math.cos(0.5), -Math.sin(0.5), 5, 'building');
    expect(obstacleGap(b, 10, 20, n)).toBeCloseTo(-2); // the centre: out by the short side
    const lx = 6, wx = 10 + lx * Math.cos(0.5), wz = 20 - lx * Math.sin(0.5); // 2 m past the end, on its axis
    expect(obstacleGap(b, wx, wz, n)).toBeCloseTo(2);
    expect(n.x).toBeCloseTo(Math.cos(0.5));
    const cx = 10 + 7 * Math.cos(0.5) + 5 * Math.sin(0.5), cz = 20 - 7 * Math.sin(0.5) + 5 * Math.cos(0.5); // 3 m and 3 m past a corner
    expect(obstacleGap(b, cx, cz, n)).toBeCloseTo(Math.hypot(3, 3));
  });

  it('a building stops the skier; a building, a tree and a lift tower are never entered', () => {
    const building = all.find((o) => o.kind === 'building' && o.box && o.box.hx > 6 && o.box.hx < 15)!;
    const tree = all.find((o) => o.kind === 'tree' && o.h < 20 && m.obstaclesNear(o.x, o.z, 8, []).length === 1)!;
    const tower = all.find((o) => o.kind === 'tower' && m.obstaclesNear(o.x, o.z, 8, []).length === 1)!;
    for (const [o, from, dir] of [[building, building.box!.hz + 6, [-building.box!.s, building.box!.c]], [tree, 6, [1, 0.3]], [tower, 6, [0.4, 1]]] as const) {
      const r = ram(o, from, dir as [number, number]);
      expect(r.deepest, o.kind).toBeGreaterThan(T.skierRadius - 0.02); // the skier's edge at the outline, not past it
      // a flat facade stops the skier; round a trunk or a post they slide off sideways (never through: see deepest)
      if (o.kind === 'building') expect(r.moved, o.kind).toBeLessThan(from);
    }
  });

  it('where nothing stands, the skier goes straight on', () => {
    // down the middle of a wide piste, 25 m with nothing within 2 m of the line
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    let found: { x: number; z: number; dx: number; dz: number } | null = null;
    for (const p of m.pistes.filter((q) => !q.area && q.halfWidth > 8 && q.len > 300)) {
      for (let s = 60; s < p.len - 60 && !found; s += 20) {
        m.along(p, s, o);
        const c = { ...o };
        let clear = true;
        for (let a = 0; a <= 26 && clear; a += 1) clear = m.obstaclesNear(c.x - c.dx * a, c.z - c.dz * a, 2, []).length === 0;
        if (clear) found = c;
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const ghost: Obstacle = { id: -1, x: found!.x, z: found!.z, r: 0.01, h: 0.01, kind: 'rock' }; // a target, not in the index
    const r = ram(ghost, 25, [-found!.dx, -found!.dz]);
    expect(r.moved).toBeGreaterThan(9); // 1 s at 10 m/s, only the snow in the way
  });

  it('every collider is the drawn shape: trees, towers, stations, buildings, equipment', () => {
    const trees = all.filter((o) => o.kind === 'tree');
    let lo = Infinity, hi = -Infinity;
    for (const o of trees) { const y = m.height(o.x, o.z); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    for (const o of trees.slice(0, 400)) expect(o.r).toBeCloseTo(treeLook(o.id, o.h, (m.height(o.x, o.z) - lo) / Math.max(1, hi - lo), false).r);
    const towers = all.filter((o) => o.kind === 'tower');
    expect(towers.every((o) => o.r >= 0.75 && o.r <= 0.75 * 3)).toBe(true);
    expect(towers.some((o) => o.r === 0.75 * towerScale(m.lifts.find((l) => l.kind === 'chair')!))).toBe(true);
    for (const o of all.filter((q) => q.kind === 'station')) expect(o.box && o.box.hx / o.box.hz).toBeCloseTo(4.5 / 3.5);
    for (const [x, z, w, d] of m.scenery.buildings.slice(0, 200)) {
      const b = all.find((o) => o.kind === 'building' && Math.hypot(o.x - x, o.z - z) < 0.01);
      if (!b) continue; // a station's ticket office: drawn as the station
      expect(b.box!.hx).toBeCloseTo(Math.max(w, d) / 2);
      expect(b.box!.hz).toBeCloseTo(Math.min(w, d) / 2);
    }
    for (const q of m.equipment) {
      const hit = all.some((o) => o.kind === 'prop' && obstacleGap(o, q.x, q.z, n) < 0.5);
      expect(hit, q.kind).toBe(true);
    }
  });
});
