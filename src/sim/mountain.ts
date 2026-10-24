import { fbm, mulberry32 } from '../core/rng';
import { clamp, indexObstacles, normalOf, smoothstep, Surface, type Obstacle, type Track, type TrackDef } from './track';
import { ROUSSES as R } from './rousses-data';

/**
 * Free ride: the Dôle-Tuffes massif of the Station des Rousses (Jura), 1:1. Real relief (terrain tiles), real
 * pistes, lifts, forests and buildings (OpenStreetMap), baked by scripts/rousses.mjs. Metres, x east, z south.
 * Pistes are graded like the real ones: a flat bench across, smoothed along, (almost) never climbing.
 * Pure, like track.ts.
 */
export const FREE_ID = 'free';

export type PisteColor = 'green' | 'blue' | 'red' | 'black';
export interface Piste {
  name: string; difficulty: PisteColor; halfWidth: number;
  /** Groomed area (a polygon), not a line: only grooms the snow. */
  area: boolean;
  /** Line resampled every DS m, downhill: x, z pairs; bench height per point. */
  pts: number[]; hc: number[]; len: number;
  /** Where the line runs into another piste at its end. */
  next: { p: Piste; s: number } | null;
}
export interface Lift { name: string; kind: 'chair' | 'drag' | 'carpet'; seats: number; pts: number[]; cum: number[]; len: number; speed: number }
export interface PisteHit { p: Piste; d: number; s: number }
export interface Spot { x: number; z: number; heading: number }

export interface Mountain extends Track {
  pistes: Piste[];
  lifts: Lift[];
  /** Moving skiers the near-miss / collision code should see (written by the free-ride crowd). */
  dynamic: Obstacle[];
  /** The 10 m height / grooming grids the view meshes directly; the forest mask. */
  grid: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array; groomed: Float32Array };
  forest(x: number, z: number): boolean;
  /** The land around (48 × 40 km, 300 m): heights in metres. */
  around: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array };
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** On top of La Dôle, by the radar. */
  spawn: Spot;
  /** Nearest piste line within `max` m (areas excluded). */
  pisteAt(x: number, z: number, max?: number): PisteHit | null;
  /** Point (and unit direction) at arc length s down a piste. */
  along(p: Piste, s: number, out: { x: number; z: number; dx: number; dz: number }): void;
  /** Point at fraction f up a lift line, with its direction. */
  liftPoint(l: Lift, f: number, out: { x: number; z: number; dx: number; dz: number }): void;
  /** Off lift i at the top, facing down the nearest piste. */
  unload(i: number): Spot;
  /** A point `ahead` m down the piste under (x, z), for the bot. */
  guide(x: number, z: number, ahead: number): { x: number; z: number; hw: number };
}

export const FREE_DEF: TrackDef = {
  id: FREE_ID, name: 'Les Rousses', difficulty: 'easy', seed: 4242, length: Infinity, slopeDeg: 18, slopeVar: 0,
  halfWidth: 14, curve: 0, kickers: [], moguls: 0, glades: 0, cliffs: 0, ice: 0, arches: 0, treeDensity: 1, rockDensity: 1,
  timeOfDay: 0.5, par: 0,
};

/** Trees this tall or more stand deep in the woods (the view draws them simpler). */
export const DEEP = 25;
const DS = 5; // piste resampling step
const STEP = 10; // height grid
const CELL = 32; // piste segment hash

const decode16 = (b64: string) => {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Uint16Array(u8.buffer);
};

/** Catmull-Rom bicubic on a grid (C1: normals never jump), clamped at the edges. */
function bicubic(a: ArrayLike<number>, nx: number, nz: number, fx: number, fz: number): number {
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (jj: number) => {
    const r = clamp(jj, 0, nz - 1) * nx;
    return cr(a[r + clamp(i - 1, 0, nx - 1)], a[r + clamp(i, 0, nx - 1)], a[r + clamp(i + 1, 0, nx - 1)], a[r + clamp(i + 2, 0, nx - 1)], tx);
  };
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return [Math.hypot(px - ax - vx * t, pz - az - vz * t), t];
}

/** Polyline resampled every `ds` m. */
function resample(src: number[], ds: number): number[] {
  const out = [src[0], src[1]];
  let carry = 0;
  for (let k = 2; k < src.length; k += 2) {
    const ax = src[k - 2], az = src[k - 1], l = Math.hypot(src[k] - ax, src[k + 1] - az);
    let t = ds - carry;
    for (; t <= l; t += ds) out.push(ax + ((src[k] - ax) * t) / l, az + ((src[k + 1] - az) * t) / l);
    carry = l - (t - ds);
  }
  if (carry > 0.5) out.push(src[src.length - 2], src[src.length - 1]);
  return out;
}

const pointIn = (poly: number[], x: number, z: number) => {
  let inside = false;
  for (let k = 0, m = poly.length - 2; k < poly.length; m = k, k += 2) {
    if ((poly[k + 1] > z) !== (poly[m + 1] > z) && x < poly[k] + ((z - poly[k + 1]) / (poly[m + 1] - poly[k + 1])) * (poly[m] - poly[k])) inside = !inside;
  }
  return inside;
};

const WIDTH: Record<PisteColor, number> = { green: 15, blue: 15, red: 14, black: 12 };

export function makeMountain(): Mountain {
  const seed = FREE_DEF.seed;
  const rnd = mulberry32(seed);

  // ── raw relief: the massif (20 m) faded into the land around (300 m) over its last 300 m
  const F = R.grid, A = R.around;
  const fh = Float32Array.from(decode16(F.h), (v) => F.base + v / 100);
  const ah = Float32Array.from(decode16(A.h), (v) => v / 10);
  const fx1 = F.x0 + (F.nx - 1) * F.step, fz1 = F.z0 + (F.nz - 1) * F.step;
  const aroundH = (x: number, z: number) => bicubic(ah, A.nx, A.nz, (x - A.x0) / A.step, (z - A.z0) / A.step);
  const inner = (x: number, z: number) => smoothstep(0, 300, Math.min(x - F.x0, fx1 - x, z - F.z0, fz1 - z));
  const raw = (x: number, z: number) => {
    const w = inner(x, z);
    const a = w < 1 ? aroundH(x, z) : 0;
    return w > 0 ? a * (1 - w) + bicubic(fh, F.nx, F.nz, (x - F.x0) / F.step, (z - F.z0) / F.step) * w : a;
  };
  const fbits = Uint8Array.from(atob(F.forest), (c) => c.charCodeAt(0));
  const forest = (x: number, z: number) => {
    const i = Math.round((x - F.x0) / F.step), j = Math.round((z - F.z0) / F.step);
    if (i < 0 || j < 0 || i >= F.nx || j >= F.nz) return false;
    const k = j * F.nx + i;
    return ((fbits[k >> 3] >> (k & 7)) & 1) === 1;
  };

  // ── pistes: resampled lines with their graded bench (smoothed along, never climbing more than 3 m)
  const pistes: Piste[] = R.pistes.map((src) => {
    const area = 'area' in src && !!src.area;
    const diff = src.diff as PisteColor;
    const narrow = !src.name || /Liaison|Route|Balcon/.test(src.name);
    const pts = area ? src.pts : resample(src.pts, DS);
    const n = pts.length / 2;
    const hraw = Array.from({ length: n }, (_, k) => raw(pts[2 * k], pts[2 * k + 1]));
    const hs = hraw.map((_, k) => {
      let a = 0, c = 0;
      for (let q = Math.max(0, k - 5); q <= Math.min(n - 1, k + 5); q++) { a += hraw[q]; c++; }
      return a / c;
    });
    // never climbing, cut at most 6 m deep (the terrain tiles read the spruce canopy, so the true ground
    // in a forest cut is lower anyway): only a real col still climbs, slowly
    let lo = Infinity;
    const hc = hs.map((h) => (lo = Math.max(Math.min(lo, h), h - 6)));
    return { name: src.name, difficulty: diff, halfWidth: narrow ? 7 : WIDTH[diff], area, pts, hc, len: (n - 1) * DS, next: null };
  });
  const lines = pistes.filter((p) => !p.area);
  const areas = pistes.filter((p) => p.area).map((p) => {
    const xs = p.pts.filter((_, k) => k % 2 === 0), zs = p.pts.filter((_, k) => k % 2 === 1);
    return { pts: p.pts, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });

  // segment hash: every 5 m piece of every line, in each 32 m cell its band (± width + fade) touches
  const hash = new Map<number, [Piste, number][]>();
  const key = (i: number, j: number) => i * 4096 + j;
  for (const p of lines) {
    const pad = p.halfWidth + 18;
    for (let k = 0; k + 3 < p.pts.length; k += 2) {
      const ax = p.pts[k], az = p.pts[k + 1], bx = p.pts[k + 2], bz = p.pts[k + 3];
      for (let i = Math.floor((Math.min(ax, bx) - pad) / CELL); i <= Math.floor((Math.max(ax, bx) + pad) / CELL); i++) {
        for (let j = Math.floor((Math.min(az, bz) - pad) / CELL); j <= Math.floor((Math.max(az, bz) + pad) / CELL); j++) {
          const kk = key(i + 2048, j + 2048);
          let b = hash.get(kk);
          if (!b) hash.set(kk, (b = []));
          b.push([p, k]);
        }
      }
    }
  }
  /** Each line's nearest point under (x, z) (only lines whose band reaches it). */
  const near: PisteHit[] = [];
  const nearLines = (x: number, z: number): PisteHit[] => {
    near.length = 0;
    for (const [p, k] of hash.get(key(Math.floor(x / CELL) + 2048, Math.floor(z / CELL) + 2048)) ?? []) {
      const [d, t] = segDist(x, z, p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]);
      const h = near.find((q) => q.p === p);
      if (!h) near.push({ p, d, s: (k / 2 + t) * DS });
      else if (d < h.d) { h.d = d; h.s = (k / 2 + t) * DS; }
    }
    return near;
  };
  const benchAt = (p: Piste, s: number) => {
    const f = clamp(s / DS, 0, p.hc.length - 1.001), k = Math.floor(f);
    return p.hc[k] + (p.hc[k + 1] - p.hc[k]) * (f - k);
  };

  // ── the 10 m grid: raw relief, benched under the pistes, small bumps off them
  const bounds = { x0: F.x0, x1: fx1, z0: F.z0, z1: fz1 };
  const nx = Math.round((fx1 - F.x0) / STEP) + 1, nz = Math.round((fz1 - F.z0) / STEP) + 1;
  const gh = new Float32Array(nx * nz), gg = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = F.x0 + i * STEP, z = F.z0 + j * STEP;
      let m = 0, wSum = 0, bench = 0, groom = 0;
      for (const h of nearLines(x, z)) {
        const w = 1 - smoothstep(h.p.halfWidth, h.p.halfWidth + 16, h.d);
        if (w <= 0) continue;
        m = Math.max(m, w);
        wSum += w;
        bench += benchAt(h.p, h.s) * w;
        groom = Math.max(groom, 1 - smoothstep(h.p.halfWidth - 1, h.p.halfWidth + 4, h.d));
      }
      for (const a of areas) if (x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1 && pointIn(a.pts, x, z)) groom = Math.max(groom, 0.6); // soft: their edges are straight
      const r = raw(x, z);
      const bumps = fbm(seed + 7, x / 60, z / 60, 2) * 1.0 * inner(x, z);
      gh[j * nx + i] = (m > 0 ? r * (1 - m) + (bench / wSum) * m : r) + bumps * (1 - m) * (1 - groom);
      gg[j * nx + i] = groom;
    }
  }
  const height = (x: number, z: number) =>
    x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1 ? aroundH(x, z) : bicubic(gh, nx, nz, (x - bounds.x0) / STEP, (z - bounds.z0) / STEP);
  const groomedAt = (x: number, z: number) => {
    const fx = clamp((x - bounds.x0) / STEP, 0, nx - 1.001), fz = clamp((z - bounds.z0) / STEP, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * nx + i;
    return (gg[k] * (1 - tx) + gg[k + 1] * tx) * (1 - tz) + (gg[k + nx] * (1 - tx) + gg[k + nx + 1] * tx) * tz;
  };

  const pisteAt = (x: number, z: number, max = 0): PisteHit | null => {
    let best: PisteHit | null = null;
    for (const h of nearLines(x, z)) if (h.d <= h.p.halfWidth + max && (!best || h.d < best.d)) best = { ...h };
    return best;
  };
  const along = (p: Piste, s: number, out: { x: number; z: number; dx: number; dz: number }) => {
    const f = clamp(s / DS, 0, p.pts.length / 2 - 1.001), k = Math.floor(f), t = f - k;
    const ax = p.pts[2 * k], az = p.pts[2 * k + 1], bx = p.pts[2 * k + 2], bz = p.pts[2 * k + 3], l = Math.hypot(bx - ax, bz - az) || 1;
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    out.dx = (bx - ax) / l;
    out.dz = (bz - az) / l;
  };
  for (const p of lines) {
    const ex = p.pts[p.pts.length - 2], ez = p.pts[p.pts.length - 1];
    const h = nearLines(ex, ez).filter((q) => q.p !== p && q.d < 25 && q.s < q.p.len - 20).sort((a, b) => a.d - b.d)[0];
    if (h) p.next = { p: h.p, s: h.s };
  }

  // ── lifts
  const lifts: Lift[] = R.lifts.map((l) => {
    const cum = [0];
    for (let k = 2; k < l.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(l.pts[k] - l.pts[k - 2], l.pts[k + 1] - l.pts[k - 1]));
    const kind = l.kind as Lift['kind'];
    return { name: l.name, kind, seats: l.seats, pts: l.pts, cum, len: cum[cum.length - 1], speed: kind === 'chair' ? 5 : kind === 'drag' ? 4 : 2 };
  });
  const liftPoint = (l: Lift, f: number, out: { x: number; z: number; dx: number; dz: number }) => {
    const s = clamp(f, 0, 1) * l.len;
    let k = 1;
    while (k < l.cum.length - 1 && l.cum[k] < s) k++;
    const ax = l.pts[2 * k - 2], az = l.pts[2 * k - 1], bx = l.pts[2 * k], bz = l.pts[2 * k + 1];
    const seg = l.cum[k] - l.cum[k - 1] || 1, t = (s - l.cum[k - 1]) / seg;
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    out.dx = (bx - ax) / seg;
    out.dz = (bz - az) / seg;
  };
  const pt = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Facing down the nearest piste (or the fall line) from (x, z). */
  const facing = (x: number, z: number): number => {
    const h = pisteAt(x, z, 60);
    if (h) {
      along(h.p, h.s + 10, pt);
      const down = height(x + pt.dx * 15, z + pt.dz * 15) <= height(x - pt.dx * 15, z - pt.dz * 15) ? 1 : -1; // short pieces may run either way
      return Math.atan2(pt.dx * down, pt.dz * down);
    }
    const n = normalOf(height, x, z);
    return Math.atan2(n.x, n.z);
  };
  const unload = (i: number): Spot => {
    const l = lifts[i];
    liftPoint(l, 1, pt);
    const x = pt.x + pt.dx * (l.kind === 'chair' ? 12 : 5), z = pt.z + pt.dz * (l.kind === 'chair' ? 12 : 5);
    return { x, z, heading: facing(x, z) };
  };
  // the start: on top of La Dôle, at the head of the longest piste leaving the Dappes chair's top station
  const top = unload(Math.max(0, lifts.findIndex((l) => l.name === 'Dappes')));
  const first = lines.filter((p) => Math.hypot(p.pts[0] - top.x, p.pts[1] - top.z) < 150).sort((a, b) => b.len - a.len)[0];
  let spawn = top;
  if (first) {
    along(first, 8, pt);
    spawn = { x: pt.x, z: pt.z, heading: Math.atan2(pt.dx, pt.dz) };
  }

  // ── obstacles: a cleared corridor under every lift, around roads and buildings
  const clear = new Uint8Array(nx * nz);
  const stamp = (x: number, z: number, r: number) => {
    for (let j = Math.floor((z - r - bounds.z0) / STEP); j <= Math.ceil((z + r - bounds.z0) / STEP); j++) {
      for (let i = Math.floor((x - r - bounds.x0) / STEP); i <= Math.ceil((x + r - bounds.x0) / STEP); i++) {
        if (i >= 0 && j >= 0 && i < nx && j < nz) clear[j * nx + i] = 1;
      }
    }
  };
  const stampLine = (p: number[], r: number) => {
    for (let k = 2; k < p.length; k += 2) {
      const l = Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
      for (let t = 0; t <= l; t += 4) stamp(p[k - 2] + ((p[k] - p[k - 2]) * t) / l, p[k - 1] + ((p[k + 1] - p[k - 1]) * t) / l, r);
    }
  };
  for (const l of lifts) stampLine(l.pts, 8);
  for (const r of R.roads) stampLine(r, 6);
  for (const b of R.buildings) stamp(b[0], b[1], Math.max(b[2], b[3]) / 2 + 4);
  if (R.radar) stamp(R.radar[0], R.radar[1], 16);
  const cleared = (x: number, z: number) => clear[Math.round((z - bounds.z0) / STEP) * nx + Math.round((x - bounds.x0) / STEP)] === 1;

  // ── trees: tall Jura spruces. Dense along the pistes (where you see them), thinner deep in the woods,
  // a few lone ones out on the pastures. h ≥ DEEP marks the far ones (the view draws them simpler).
  const list: Obstacle[] = [];
  const G = 8;
  for (let z = bounds.z0 + 20; z < bounds.z1 - 20; z += G) {
    for (let x = bounds.x0 + 20; x < bounds.x1 - 20; x += G) {
      const tx = x + (rnd() - 0.5) * G * 0.9, tz = z + (rnd() - 0.5) * G * 0.9;
      const roll = rnd();
      if (cleared(tx, tz) || groomedAt(tx, tz) > 0.02) continue;
      const h = pisteAt(tx, tz, 46);
      if (h && h.d < h.p.halfWidth + 3) continue;
      const woods = forest(tx, tz);
      const edge = !!h;
      if (woods ? !edge && roll > 0.11 : roll > (edge ? 0.012 : 0.004)) continue;
      const th = edge || !woods ? 11 + rnd() * 13 : DEEP + rnd() * 7;
      list.push({ id: list.length, x: tx, z: tz, r: 0.7 + th * 0.03, h: th, kind: 'tree' });
    }
  }
  const idx = indexObstacles(list);
  const dynamic: Obstacle[] = [];

  const m: Mountain = {
    def: FREE_DEF,
    kickers: [],
    features: [],
    pistes,
    lifts,
    dynamic,
    grid: { x0: bounds.x0, z0: bounds.z0, step: STEP, nx, nz, h: gh, groomed: gg },
    forest,
    around: { x0: A.x0, z0: A.z0, step: A.step, nx: A.nx, nz: A.nz, h: ah },
    bounds,
    spawn,
    height,
    normal: (x, z, out) => normalOf(height, x, z, out),
    surface: (x, z) => (groomedAt(x, z) > 0.5 ? Surface.Groomed : Surface.Powder),
    centerX: () => m.spawn.x, // no single line on an open mountain: spawn / bot use spawn and guide()
    respawn(z, x = m.spawn.x) {
      // back onto the nearest piste, a little uphill, facing down its line
      const h = pisteAt(x, z, 250);
      if (!h) return m.spawn;
      along(h.p, Math.max(0, h.s - 6), pt);
      return { x: pt.x, z: pt.z, heading: Math.atan2(pt.dx, pt.dz) };
    },
    obstaclesNear(x, z, radius, out) {
      idx.near(x, z, radius, out);
      for (const o of dynamic) if (Math.hypot(o.x - x, o.z - z) < radius + o.r) out.push(o);
      return out;
    },
    obstaclesBetween: (z0, z1) => idx.between(z0, z1),
    pisteAt,
    along,
    liftPoint,
    unload,
    guide(x, z, ahead) {
      const h = pisteAt(x, z, 40);
      if (!h) {
        const n = normalOf(height, x, z);
        const l = Math.hypot(n.x, n.z) || 1;
        return { x: x + (n.x / l) * ahead, z: z + (n.z / l) * ahead, hw: 6 };
      }
      let p = h.p, s = h.s + ahead;
      if (s > p.len && p.next) { s = p.next.s + s - p.len; p = p.next.p; }
      along(p, s, pt);
      return { x: pt.x, z: pt.z, hw: p.halfWidth };
    },
  };
  return m;
}
