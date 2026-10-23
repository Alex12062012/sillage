import { fbm, mulberry32 } from '../core/rng';
import {
  clamp, indexObstacles, KICKERS, kickerBump, kickerDipSlope, normalOf, smoothstep, Surface,
  type Kicker, type Obstacle, type Track, type TrackDef,
} from './track';

/**
 * Free ride: one open mountain (GMA style) instead of a corridor. A valley bowl from the summit
 * (z ≈ -60) down to the village (z ≈ 1220), three groomed pistes and a little park on the blue,
 * forests between them, two chairlifts. Everything is open from the start. Pure, like track.ts.
 */
export const FREE_ID = 'free';

export interface Piste { name: string; difficulty: 'easy' | 'medium' | 'hard'; halfWidth: number; x(z: number): number; z0: number; z1: number }

/** A chairlift: straight line from the bottom station up to the top station (ground points). */
export interface Lift { name: string; bx: number; bz: number; tx: number; tz: number }

export interface Mountain extends Track {
  pistes: Piste[];
  lifts: Lift[];
  /** Moving skiers the near-miss / collision code should see (written by the free-ride crowd). */
  dynamic: Obstacle[];
  /** Domain the terrain mesh covers. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

export const FREE_DEF: TrackDef = {
  id: FREE_ID, name: 'Free ride', difficulty: 'easy', seed: 4242, length: Infinity, slopeDeg: 18, slopeVar: 0,
  halfWidth: 24, curve: 0, kickers: [], moguls: 0, glades: 0, cliffs: 0, ice: 0, arches: 0, treeDensity: 1, rockDensity: 1,
  timeOfDay: 0.5, par: 0,
};

const DEG = Math.PI / 180;
const BASE_X = 60; // the village and the main lift's bottom station
const SUMMIT_Z = -60;
const BASE_Z = 1180;

/** Bring every piste into the village at the bottom. */
const toBase = (x: number, z: number) => x + (BASE_X - x) * smoothstep(1040, 1170, z);
const fromTop = (x: number, z: number) => x * smoothstep(SUMMIT_Z, 140, z);

export const PISTES: Piste[] = [
  { name: 'Les Clarines', difficulty: 'easy', halfWidth: 24, z0: SUMMIT_Z, z1: BASE_Z,
    x: (z) => toBase(fromTop(-150 * Math.sin(z / 240) - 30 * Math.sin(z / 85 + 1), z), z) },
  { name: 'Le Chamois', difficulty: 'medium', halfWidth: 17, z0: SUMMIT_Z, z1: BASE_Z,
    x: (z) => toBase(fromTop(150 + 55 * Math.sin(z / 150 + 2), z), z) },
  { name: 'La Directe', difficulty: 'hard', halfWidth: 13, z0: SUMMIT_Z, z1: BASE_Z,
    x: (z) => toBase(fromTop(-20 + 28 * Math.sin(z / 110 + 0.5), z), z) },
];

export const LIFTS: Lift[] = [
  { name: 'Grand Télésiège', bx: BASE_X + 14, bz: BASE_Z + 16, tx: 40, tz: SUMMIT_Z - 10 },
  { name: 'Télésiège du Chamois', bx: 245, bz: 760, tx: 215, tz: 230 },
];

/** The park: three kickers on the blue (z, size). */
const PARK: [number, keyof typeof KICKERS][] = [[430, 'small'], [520, 'medium'], [640, 'large']];

export function makeMountain(): Mountain {
  const seed = FREE_DEF.seed;
  const rnd = mulberry32(seed);
  const bounds = { x0: -460, x1: 520, z0: -180, z1: 1320 };

  // ── long profile: steep under the summit, easing toward the village, a flat (slightly rising) run-out
  const park: Kicker[] = PARK.map(([z, size]) => ({ ...KICKERS[size], z, x: 0 }));
  const slopeAt = (z: number) => {
    const deg = 27 - 17 * smoothstep(-60, 1100, z) + 3 * Math.sin(z / 160);
    const t = Math.tan(deg * DEG);
    const dip = park.reduce((a, k) => a + kickerDipSlope(k, z - k.z), 0); // landing dips span the slope (track.ts)
    return Math.max(t + dip, 0.14) * (1 - smoothstep(1160, 1230, z)) - 0.03 * smoothstep(1200, 1290, z);
  };
  const Z0 = bounds.z0 - 20;
  const STEP = 2;
  const N = Math.ceil((bounds.z1 + 40 - Z0) / STEP) + 1;
  const H = new Float64Array(N);
  const S = new Float64Array(N);
  S[0] = slopeAt(Z0);
  for (let i = 1; i < N; i++) {
    S[i] = slopeAt(Z0 + i * STEP);
    H[i] = H[i - 1] - ((S[i - 1] + S[i]) / 2) * STEP;
  }
  const profile = (z: number) => {
    const f = clamp((z - Z0) / STEP, 0, N - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    // cubic Hermite with the known slopes: C1, so normals never jump
    const h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
    return h00 * H[i] + h10 * STEP * -S[i] + h01 * H[i + 1] + h11 * STEP * -S[i + 1];
  };

  const blue = PISTES[0];

  /** 1 on a piste, fading to 0 over 28 m beside it; and the nearest piste. */
  const pisteMask = (x: number, z: number) => {
    let m = 0;
    for (const p of PISTES) {
      if (z < p.z0 - 30 || z > p.z1 + 60) continue;
      m = Math.max(m, 1 - smoothstep(p.halfWidth, p.halfWidth + 28, Math.abs(x - p.x(z))));
    }
    return m;
  };
  // ridges run down the fall line (stretched along z) so no piste ever climbs; small bumps only off piste
  const ridges = (x: number, z: number) => fbm(seed, x / 210, z / 900, 3) * 40 * smoothstep(-80, 160, z) * (1 - smoothstep(900, 1120, z)); // calm summit and village, where pistes meet
  const bumps = (x: number, z: number) => fbm(seed + 7, x / 40, z / 40, 2) * 2.4;

  const mid = new Map(PISTES.map((p) => [p, p.x(600)])); // a piste rides the relief of its mean line: it never climbs
  const height = (x: number, z: number) => {
    // off piste the relief is free; on a piste it follows the relief of its mean line (flat across, never climbs);
    // where pistes meet (the summit, the village) their reliefs blend by weight, so the snow stays continuous
    let m = 0, wSum = 0, rOn = 0;
    for (const p of PISTES) {
      if (z < p.z0 - 30 || z > p.z1 + 60) continue;
      const w = 1 - smoothstep(p.halfWidth, p.halfWidth + 28, Math.abs(x - p.x(z)));
      if (w <= 0) continue;
      m = Math.max(m, w);
      wSum += w;
      rOn += ridges(mid.get(p)!, z) * w;
    }
    const r = (m > 0 ? ridges(x, z) * (1 - m) + (rOn / wSum) * m : ridges(x, z)) + bumps(x, z) * (1 - m);
    const ax = Math.abs(x - BASE_X * smoothstep(400, 1200, z));
    let y = profile(z) + 0.00042 * ax * ax + r;
    // valley walls and a rising village end (you always stop), capped so the mesh corners stay mountains, not needles
    const soft = (q: number, cap: number) => cap * (1 - Math.exp(-q / cap));
    y += soft(0.03 * Math.max(0, x - bounds.x1 + 70) ** 2 + 0.03 * Math.max(0, bounds.x0 + 70 - x) ** 2, 60);
    y += soft(0.02 * Math.max(0, z - bounds.z1 + 70) ** 2, 30);
    for (const k of park) y += kickerBump(k, z - k.z, x - blue.x(z));
    return y;
  };

  // ── forests: jittered grid, density from noise, none on pistes, lift lines, village or summit
  const liftDist = (x: number, z: number) => {
    let d = Infinity;
    for (const l of LIFTS) {
      const vx = l.tx - l.bx, vz = l.tz - l.bz;
      const t = clamp(((x - l.bx) * vx + (z - l.bz) * vz) / (vx * vx + vz * vz), 0, 1);
      d = Math.min(d, Math.hypot(x - l.bx - vx * t, z - l.bz - vz * t));
    }
    return d;
  };
  const list: Obstacle[] = [];
  const G = 7.5;
  for (let z = bounds.z0 + 60; z < bounds.z1 - 60; z += G) {
    for (let x = bounds.x0 + 40; x < bounds.x1 - 40; x += G) {
      const tx = x + (rnd() - 0.5) * G * 0.9;
      const tz = z + (rnd() - 0.5) * G * 0.9;
      const alpine = smoothstep(40, 260, tz); // sparse above the tree line
      const dens = (fbm(seed + 3, tx / 90, tz / 90, 2) * 0.5 + 0.55) * alpine;
      if (rnd() > dens * 0.75) continue;
      if (pisteMask(tx, tz) > 0.02 || liftDist(tx, tz) < 9 || tz > BASE_Z - 40 || tz < SUMMIT_Z + 40) continue;
      const h = 3.2 + rnd() * 3.4;
      list.push({ id: list.length, x: tx, z: tz, r: 1.0 * (h / 4.4) * 0.85, h, kind: 'tree' });
    }
  }
  const idx = indexObstacles(list);
  const dynamic: Obstacle[] = [];

  const surface = (x: number, z: number) => (pisteMask(x, z) > 0.55 ? Surface.Groomed : Surface.Powder);

  return {
    def: FREE_DEF,
    kickers: park,
    features: park.map((k) => ({ type: 'kicker' as const, z0: k.z, z1: k.z + 60, size: 'medium' as const })),
    pistes: PISTES,
    lifts: LIFTS,
    dynamic,
    bounds,
    height,
    normal: (x, z, out) => normalOf(height, x, z, out),
    surface,
    centerX: (z) => blue.x(z),
    respawn(z, x = blue.x(z)) {
      // back onto the nearest piste, a little uphill, facing down its line
      let p = PISTES[0];
      for (const q of PISTES) if (Math.abs(x - q.x(z)) < Math.abs(x - p.x(z))) p = q;
      const rz = clamp(z - 6, SUMMIT_Z + 5, BASE_Z);
      const px = p.x(rz);
      return { x: px, z: rz, heading: Math.atan2(p.x(rz + 2) - px, 2) };
    },
    obstaclesNear(x, z, radius, out) {
      idx.near(x, z, radius, out);
      for (const o of dynamic) if (Math.hypot(o.x - x, o.z - z) < radius + o.r) out.push(o);
      return out;
    },
    obstaclesBetween: (z0, z1) => idx.between(z0, z1),
  };
}

/** Where a free ride starts: on top, at the head of the blue. */
export const SUMMIT_SPAWN = { z: SUMMIT_Z + 8 };
