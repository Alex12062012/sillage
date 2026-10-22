import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { kickerLength, makeTrack, Surface, type TrackDef } from '../../src/sim/track';

const DEF: TrackDef = {
  id: 'test', name: 'Test', seed: 1234, length: 600, slopeDeg: 16, halfWidth: 22,
  kickers: [{ z: 200, size: 'medium' }],
};

describe('makeTrack', () => {
  it('is deterministic for a given definition', () => {
    const a = makeTrack(DEF);
    const b = makeTrack(DEF);
    for (let i = 0; i < 300; i++) {
      const x = Math.sin(i) * 60;
      const z = i * 2;
      expect(a.height(x, z)).toBe(b.height(x, z));
    }
  });

  it('descends along the centerline at about the nominal slope', () => {
    const t = makeTrack(DEF);
    const drop = t.height(t.centerX(50), 50) - t.height(t.centerX(150), 150);
    const deg = (Math.atan(drop / 100) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(DEF.slopeDeg - 2);
    expect(deg).toBeLessThan(DEF.slopeDeg + 2);
  });

  it('is a gentle bowl inside the piste and rises steeply outside (guides back to the line)', () => {
    const t = makeTrack(DEF);
    const z = 120;
    const c = t.centerX(z);
    const center = t.height(c, z);
    expect(t.height(c + DEF.halfWidth, z)).toBeGreaterThan(center + 0.5);
    expect(t.height(c - DEF.halfWidth, z)).toBeGreaterThan(center + 0.5);
    expect(t.height(c + DEF.halfWidth + 40, z)).toBeGreaterThan(center + 12);
  });

  it('is groomed on the piste and powder off it', () => {
    const t = makeTrack(DEF);
    expect(t.surface(t.centerX(100), 100)).toBe(Surface.Groomed);
    expect(t.surface(t.centerX(100) + DEF.halfWidth + 15, 100)).toBe(Surface.Powder);
  });

  it('is continuous with unit normals everywhere on the playable corridor', () => {
    const t = makeTrack(DEF);
    const n = new Vector3();
    for (let z = -20; z < DEF.length + 50; z += 1.7) {
      for (let x = -90; x <= 90; x += 9) {
        const h = t.height(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(Math.abs(t.height(x, z + 0.1) - h)).toBeLessThan(0.25);
        expect(Math.abs(t.normal(x, z, n).length() - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('places trees deterministically, lining the piste, never on a kicker, and queries them by radius', () => {
    const t = makeTrack(DEF);
    const all = t.obstaclesBetween(0, DEF.length);
    expect(all.length).toBeGreaterThan(100);
    expect(makeTrack(DEF).obstaclesBetween(0, DEF.length).map((o) => o.x)).toEqual(all.map((o) => o.x));
    for (const k of t.kickers) {
      for (const o of all) {
        const onKicker = o.z > k.z - 10 && o.z < k.z + kickerLength(k) + 6;
        expect(onKicker && Math.abs(o.x - t.centerX(o.z)) < 12).toBe(false);
      }
    }
    const onPiste = all.filter((o) => Math.abs(o.x - t.centerX(o.z)) < DEF.halfWidth - 3).length;
    const edges = all.filter((o) => Math.abs(Math.abs(o.x - t.centerX(o.z)) - DEF.halfWidth) < 8).length;
    expect(onPiste).toBeLessThan(edges / 3);
    const near = t.obstaclesNear(all[10].x, all[10].z, 2, []);
    expect(near).toContain(all[10]);
    for (const o of near) expect(Math.hypot(o.x - all[10].x, o.z - all[10].z)).toBeLessThan(2 + o.r + 1e-9);
  });

  it('respawns on the centerline facing down the track', () => {
    const t = makeTrack(DEF);
    const r = t.respawn(300);
    expect(Math.abs(r.x - t.centerX(r.z))).toBeLessThan(1e-9);
    expect(r.z).toBeLessThanOrEqual(300);
    expect(Math.abs(r.heading)).toBeLessThan(Math.PI / 2);
  });
});
