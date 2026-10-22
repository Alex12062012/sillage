import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { kickerLength, makeTrack, Surface, type TrackDef } from '../../src/sim/track';
import { TRACKS } from '../../src/sim/tracks';

const DEF: TrackDef = {
  id: 'test', name: 'Test', difficulty: 'medium', seed: 1234, length: 900, slopeDeg: 16, slopeVar: 3,
  halfWidth: 22, curve: 25, kickers: [{ size: 'medium' }], moguls: 1, glades: 1, cliffs: 1, ice: 1, arches: 1,
  treeDensity: 1, rockDensity: 1, timeOfDay: 0.5, par: 60,
};

describe('makeTrack', () => {
  it('is deterministic for a definition and differs between seeds', () => {
    const a = makeTrack(DEF);
    const b = makeTrack(DEF);
    const c = makeTrack({ ...DEF, seed: 999 });
    let diff = 0;
    for (let i = 0; i < 300; i++) {
      const x = Math.sin(i) * 60;
      const z = i * 3;
      expect(a.height(x, z)).toBe(b.height(x, z));
      diff += Math.abs(a.height(x, z) - c.height(x, z));
    }
    expect(diff).toBeGreaterThan(10);
  });

  it('descends along the centerline at about the nominal slope', () => {
    const t = makeTrack(DEF);
    const z0 = 60;
    const z1 = DEF.length - 60;
    const drop = t.height(t.centerX(z0), z0) - t.height(t.centerX(z1), z1);
    const deg = (Math.atan(drop / (z1 - z0)) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(DEF.slopeDeg - 2.5);
    expect(deg).toBeLessThan(DEF.slopeDeg + 3.5); // cliffs add drop
  });

  it('winds (real turns) but stays skiable: lateral drift slope under 0.75', () => {
    const t = makeTrack(DEF);
    let maxSlope = 0;
    let span = 0;
    for (let z = 0; z < DEF.length; z += 2) {
      maxSlope = Math.max(maxSlope, Math.abs(t.centerX(z + 1) - t.centerX(z - 1)) / 2);
      span = Math.max(span, Math.abs(t.centerX(z)));
    }
    expect(maxSlope).toBeLessThan(0.75);
    expect(span).toBeGreaterThan(8);
  });

  it('is a gentle bowl inside the piste and rises steeply outside (guides back to the line)', () => {
    const t = makeTrack(DEF);
    const z = 47;
    const c = t.centerX(z);
    const center = t.height(c, z);
    expect(t.height(c + DEF.halfWidth, z)).toBeGreaterThan(center + 0.5);
    expect(t.height(c - DEF.halfWidth, z)).toBeGreaterThan(center + 0.5);
    expect(t.height(c + DEF.halfWidth + 45, z)).toBeGreaterThan(center + 12);
  });

  it('is groomed on the piste, powder off it, and icy inside ice zones', () => {
    const t = makeTrack(DEF);
    expect(t.surface(t.centerX(30), 30)).toBe(Surface.Groomed);
    expect(t.surface(t.centerX(30) + DEF.halfWidth + 15, 30)).toBe(Surface.Powder);
    const ice = t.features.find((f) => f.type === 'ice')!;
    const zi = (ice.z0 + ice.z1) / 2;
    expect(t.surface(t.centerX(zi), zi)).toBe(Surface.Ice);
  });

  it('is continuous (except kicker lips and cliff faces) with unit normals on the corridor', () => {
    const t = makeTrack(DEF);
    const n = new Vector3();
    for (let z = -20; z < DEF.length + 100; z += 1.7) {
      const steep = t.features.some((f) => (f.type === 'kicker' || f.type === 'cliff') && z > f.z0 - 2 && z < f.z1 + 2);
      for (let x = -120; x <= 120; x += 9) {
        const h = t.height(x, z);
        expect(Number.isFinite(h)).toBe(true);
        if (!steep) expect(Math.abs(t.height(x, z + 0.1) - h)).toBeLessThan(0.25);
        expect(Math.abs(t.normal(x, z, n).length() - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('lays out features in order without overlap, inside the run, as requested by the definition', () => {
    const t = makeTrack(DEF);
    const f = t.features;
    expect(f.filter((x) => x.type === 'kicker').length).toBe(1);
    expect(f.filter((x) => x.type === 'cliff').length).toBe(1);
    expect(f.filter((x) => x.type === 'moguls').length).toBe(1);
    const solid = f.filter((x) => x.type !== 'ice').sort((a, b) => a.z0 - b.z0);
    for (let i = 1; i < solid.length; i++) expect(solid[i].z0).toBeGreaterThanOrEqual(solid[i - 1].z1);
    for (const x of f) {
      expect(x.z0).toBeGreaterThanOrEqual(80);
      expect(x.z1).toBeLessThanOrEqual(DEF.length - 100);
    }
  });

  it('keeps trees off kickers, cliffs and the start/finish, lines the piste, and fills glades', () => {
    const t = makeTrack(DEF);
    const all = t.obstaclesBetween(-50, DEF.length + 100);
    expect(all.length).toBeGreaterThan(500);
    expect(makeTrack(DEF).obstaclesBetween(0, DEF.length).map((o) => o.x)).toEqual(t.obstaclesBetween(0, DEF.length).map((o) => o.x));
    const d = (o: { x: number; z: number }) => Math.abs(o.x - t.centerX(o.z));
    for (const k of t.kickers) {
      for (const o of all) {
        const onKicker = o.z > k.z - 10 && o.z < k.z + kickerLength(k) + 6;
        expect(onKicker && d(o) < k.halfWidth + 4).toBe(false);
      }
    }
    for (const o of all) {
      if (o.z < 40 || (o.z > DEF.length - 40 && o.z < DEF.length + 40)) expect(d(o)).toBeGreaterThan(DEF.halfWidth - 1);
    }
    const glade = t.features.find((x) => x.type === 'glade')!;
    const inGlade = all.filter((o) => o.z > glade.z0 && o.z < glade.z1 && d(o) < DEF.halfWidth - 3).length;
    expect(inGlade).toBeGreaterThan(4);
  });

  it('queries obstacles by radius', () => {
    const t = makeTrack(DEF);
    const all = t.obstaclesBetween(0, DEF.length);
    const o0 = all[37];
    const near = t.obstaclesNear(o0.x, o0.z, 2, []);
    expect(near).toContain(o0);
    for (const o of near) expect(Math.hypot(o.x - o0.x, o.z - o0.z)).toBeLessThan(2 + o.r + 1e-9);
  });

  it('respawns on a clear line facing down the track', () => {
    const t = makeTrack(DEF);
    const r = t.respawn(300);
    expect(Math.abs(r.x - t.centerX(r.z))).toBeLessThanOrEqual(9);
    expect(r.z).toBeLessThanOrEqual(300);
    expect(Math.abs(r.heading)).toBeLessThan(Math.PI / 2);
  });
});

describe('the three runs', () => {
  it('are distinct, ordered by difficulty (steeper, narrower, more features)', () => {
    const [easy, medium, hard] = TRACKS;
    expect(new Set(TRACKS.map((t) => t.seed)).size).toBe(3);
    expect(easy.slopeDeg).toBeLessThan(medium.slopeDeg);
    expect(medium.slopeDeg).toBeLessThan(hard.slopeDeg);
    expect(easy.halfWidth).toBeGreaterThan(medium.halfWidth);
    expect(medium.halfWidth).toBeGreaterThan(hard.halfWidth);
    const count = (d: TrackDef) => d.kickers.length + d.moguls + d.glades + d.cliffs + d.ice + d.arches;
    expect(count(easy)).toBeLessThan(count(medium));
    expect(count(medium)).toBeLessThan(count(hard));
    for (const d of TRACKS) expect(() => makeTrack(d)).not.toThrow();
  });
});

describe('kicker split', () => {
  it('bump + integrated dip reproduce the calibrated kicker profile along its axis', async () => {
    const { KICKERS, kickerBump, kickerDipSlope, kickerProfile } = await import('../../src/sim/track');
    for (const k of [KICKERS.small, KICKERS.medium, KICKERS.large]) {
      let dip = 0;
      const du = 0.01;
      for (let u = 0; u < 140; u += du) {
        const want = kickerProfile(k, u, 0);
        expect(Math.abs(kickerBump(k, u, 0) + dip - want)).toBeLessThan(0.02);
        dip -= kickerDipSlope(k, u + du / 2) * du;
      }
    }
  });
});

describe('review regressions', () => {
  it('never builds an uphill basin across the corridor (a stopped skier can always slide on)', () => {
    for (const def of TRACKS) {
      const t = makeTrack(def);
      for (const side of [-1, 1]) {
        let prev = Infinity;
        for (let z = 0; z <= def.length; z += 1) {
          const h = t.height(t.centerX(z) + side * (def.halfWidth - 3), z);
          expect(h, `${def.id} z=${z} side=${side}`).toBeLessThanOrEqual(prev + 0.02);
          prev = h;
        }
      }
    }
  });

  it('never respawns the skier on or against an obstacle', async () => {
    const { TUNING } = await import('../../src/tuning');
    for (const def of TRACKS) {
      const t = makeTrack(def);
      for (let z = 1; z < def.length; z += 0.5) {
        const r = t.respawn(z);
        for (const o of t.obstaclesNear(r.x, r.z, 6, [])) {
          const d = Math.hypot(o.x - r.x, o.z - r.z);
          expect(d, `${def.id} respawn(${z}) near obstacle ${o.id}`).toBeGreaterThan(o.r + TUNING.skierRadius + 0.3);
        }
      }
    }
  });
});
