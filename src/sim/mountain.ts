import { fbm, mulberry32 } from '../core/rng';
import { freeDef, type Station, type StationData } from './stations';
import { clamp, indexObstacles, normalOf, smoothstep, Surface, type Obstacle, type Track } from './track';

/**
 * Free ride: a real ski area, 1:1 (Les Rousses, Avoriaz…). Real relief (terrain tiles), real pistes, lifts, forests
 * and buildings (OpenStreetMap, IGN), baked by scripts/bake-station.mjs. Metres, x east, z south.
 * Pistes are graded like the real ones: a flat bench across, smoothed along, (almost) never climbing.
 * Pure, like track.ts.
 */

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
/** Chairs seat you, gondolas (and cable cars) carry you in a cabin, drag lifts and carpets pull you along the snow. */
export interface Lift { name: string; kind: 'chair' | 'gondola' | 'drag' | 'carpet'; seats: number; pts: number[]; cum: number[]; len: number; speed: number }
/** A lift station's size (the view draws it 9 m across, 7 m along the line, 4 m high under its roof, at this scale); carpets have none. */
export const stationScale = (l: Lift): number =>
  l.kind === 'gondola' ? (l.seats > 12 ? 2.2 : 1.6) : l.kind === 'chair' ? 1 : l.kind === 'drag' ? 0.5 : 0;
/** How far from a bottom station's centre you can board (Space): its half-width and a few metres. */
export const boardReach = (l: Lift): number => 4.5 * stationScale(l) + 9;

export interface PisteHit { p: Piste; d: number; s: number }
export interface Spot { x: number; z: number; heading: number }

export interface Mountain extends Track {
  station: Station;
  /** How many times its large-scale relief is steepened (1: as it is). */
  steep: number;
  pistes: Piste[];
  lifts: Lift[];
  /** Moving skiers the near-miss / collision code should see (written by the free-ride crowd). */
  dynamic: Obstacle[];
  /** The 10 m height / grooming grids the view meshes directly; the forest mask. */
  grid: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array; groomed: Float32Array };
  forest(x: number, z: number): boolean;
  /** The land around (48 × 40 km, 300 m): heights in metres, steepened like the massif (h) and true (h0). */
  around: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array; h0: Float32Array };
  bounds: { x0: number; x1: number; z0: number; z1: number };
  /** Roads, building boxes (x, z, width, depth, yaw, levels), a landmark dome: what the view draws as they are. */
  scenery: { roads: number[][]; buildings: number[][]; radar: number[] | null };
  /** In the start lift's queue, facing it. */
  spawn: Spot;
  /** Off the summit lift, at the head of the piste that drops the most. */
  summit: Spot;
  /** Nearest piste line within `max` m (areas excluded). */
  pisteAt(x: number, z: number, max?: number): PisteHit | null;
  /** Point (and unit direction) at arc length s down a piste. */
  along(p: Piste, s: number, out: { x: number; z: number; dx: number; dz: number }): void;
  /** Point at fraction f up a lift line, with its direction. */
  liftPoint(l: Lift, f: number, out: { x: number; z: number; dx: number; dz: number }): void;
  /** Off lift i at the top, facing down the nearest piste. */
  unload(i: number): Spot;
  /**
   * `at`, or the nearest free place beside or behind it, never ahead: another skier standing there (a player
   * online, a bot) would be hit again and again by every spawn there (T, R, the respawn after a fall, a lift's top).
   */
  clearSpot(at: Spot): Spot;
  /** A point `ahead` m down the piste under (x, z), for the bot. */
  guide(x: number, z: number, ahead: number): { x: number; z: number; hw: number };
}

/**
 * The Jura is gentle (8–12° pistes): Les Rousses steepens its large-scale relief (the 300 m land-around grid)
 * station.steep times (2.3) above station.h0 (1160 m, the foot of Les Jouvencelles), keeping the local detail as
 * it is; below, the land (the valleys, the Léman) stays true. Tucked from the big lifts' tops you then average
 * ≈ 105 km/h; La Dôle rises to ≈ 2 300 m. The Alps (Avoriaz) are steep enough as they are.
 */
const steepen = (S: number, H0: number) => (h: number) => (S === 1 ? h : h + (S - 1) * 25 * Math.log1p(Math.exp((h - H0) / 25))); // softplus: no crease at H0

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

/** Moving average of a polyline's points over ±r neighbours, narrowing towards the ends (which stay put). */
function smooth(src: number[], r: number): number[] {
  const n = src.length / 2;
  return src.map((_, k) => {
    const i = k >> 1, w = Math.min(i, n - 1 - i, r);
    let sum = 0;
    for (let q = i - w; q <= i + w; q++) sum += src[2 * q + (k & 1)];
    return sum / (2 * w + 1);
  });
}

const pointIn = (poly: number[], x: number, z: number) => {
  let inside = false;
  for (let k = 0, m = poly.length - 2; k < poly.length; m = k, k += 2) {
    if ((poly[k + 1] > z) !== (poly[m + 1] > z) && x < poly[k] + ((z - poly[k + 1]) / (poly[m + 1] - poly[k + 1])) * (poly[m] - poly[k])) inside = !inside;
  }
  return inside;
};

const WIDTH: Record<PisteColor, number> = { green: 15, blue: 15, red: 14, black: 12 };
/** Where clearSpot looks, in order: [metres ahead (never > 0), metres to the side]. */
const SLOTS = [[0, 0], [0, 4], [0, -4], [-6, 0], [-6, 4], [-6, -4], [-12, 0], [0, 8], [0, -8], [-12, 5], [-12, -5], [-18, 0], [-18, 6], [-18, -6], [-26, 0]];

export function makeMountain(st: Station, R: StationData): Mountain {
  const seed = st.seed;
  const rnd = mulberry32(seed);
  const steep = steepen(st.steep, st.h0);

  // ── raw relief: the massif (20 m) faded into the land around (300 m) over its last 300 m; the land around
  // (the large scale) steepened, the massif's own detail (fine − around) added back as it is
  const F = R.grid, A = R.around;
  const fh = Float32Array.from(decode16(F.h), F.unit ? (v) => F.base + v * F.unit! : (v) => F.base + v / 100);
  const ah0 = Float32Array.from(decode16(A.h), (v) => v / 10);
  const ah = ah0.map(steep);
  const fx1 = F.x0 + (F.nx - 1) * F.step, fz1 = F.z0 + (F.nz - 1) * F.step;
  const aroundOf = (a: Float32Array, x: number, z: number) => bicubic(a, A.nx, A.nz, (x - A.x0) / A.step, (z - A.z0) / A.step);
  const aroundH = (x: number, z: number) => aroundOf(ah, x, z);
  const inner = (x: number, z: number) => smoothstep(0, 300, Math.min(x - F.x0, fx1 - x, z - F.z0, fz1 - z));
  const raw = (x: number, z: number) => {
    const w = inner(x, z);
    const big = aroundH(x, z);
    return w > 0 ? big + (bicubic(fh, F.nx, F.nz, (x - F.x0) / F.step, (z - F.z0) / F.step) - aroundOf(ah0, x, z)) * w : big;
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
    let pts = area ? src.pts : resample(smooth(resample(src.pts, DS), 10), DS); // OSM corners rounded off: you carve, not zig-zag
    if (!area && raw(pts[0], pts[1]) < raw(pts[pts.length - 2], pts[pts.length - 1])) {
      pts = pts.map((_, k) => pts[pts.length - 2 - k + 2 * (k % 2)]); // downhill on the steepened relief
    }
    const n = pts.length / 2;
    const hraw = Array.from({ length: n }, (_, k) => raw(pts[2 * k], pts[2 * k + 1]));
    const avg = (a: number[], r: number) => a.map((_, k) => {
      const w = Math.min(k, n - 1 - k, r); // symmetric, narrowing at the ends: a slope stays a slope
      let sum = 0;
      for (let q = k - w; q <= k + w; q++) sum += a[q];
      return sum / (2 * w + 1);
    });
    // smoothed over ±80 m (a long, round profile: at 140 km/h a convex roll tighter than ~170 m launches you),
    // never climbing, cut at most 6 m deep (the terrain tiles read the spruce canopy, so the true ground in a
    // forest cut is lower anyway; only a real col still climbs, slowly), then the kinks that leaves rounded off
    let lo = Infinity;
    const hc = avg(avg(hraw, 16).map((h) => (lo = Math.max(Math.min(lo, h), h - 6))), 12);
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
  /** The piste dropping the most over its next `over` m, from its point nearest (x, z) within r m (and below `top`). */
  const steepest = (x: number, z: number, r: number, skip?: Piste, over = 200, top = Infinity): { p: Piste; s: number } | null => {
    let best = 0, res: { p: Piste; s: number } | null = null;
    for (const p of lines) {
      if (p === skip) continue;
      let k = -1, d = r;
      for (let q = 0; q < p.pts.length; q += 2) {
        const dq = Math.hypot(p.pts[q] - x, p.pts[q + 1] - z);
        if (dq < d) { d = dq; k = q / 2; }
      }
      const drop = k < 0 || p.hc[k] > top ? 0 : p.hc[k] - benchAt(p, k * DS + over);
      if (drop > best) { best = drop; res = { p, s: k * DS }; }
    }
    return res;
  };
  for (const p of lines) p.next = steepest(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1], 40, p);

  // ── lifts
  const lifts: Lift[] = R.lifts.map((l) => {
    const cum = [0];
    for (let k = 2; k < l.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(l.pts[k] - l.pts[k - 2], l.pts[k + 1] - l.pts[k - 1]));
    const kind = l.kind as Lift['kind'];
    const speed = kind === 'gondola' ? (l.seats > 12 ? 7 : 5) : kind === 'chair' ? 5 : kind === 'drag' ? 4 : 2; // a 3S runs at 7 m/s
    return { name: l.name, kind, seats: l.seats, pts: l.pts, cum, len: cum[cum.length - 1], speed };
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
  /**
   * Off a lift you look down the run: towards the piste that drops fastest from within 120 m (one that starts
   * no higher than you), if the first 20 m that way go down; else down the fall line.
   */
  const facing = (x: number, z: number): number => {
    const y = height(x, z);
    const h = steepest(x, z, 120, undefined, 200, y + 1);
    if (h) {
      along(h.p, h.s + 25, pt);
      const a = Math.atan2(pt.x - x, pt.z - z);
      if (height(x + Math.sin(a) * 20, z + Math.cos(a) * 20) < y) return a;
    }
    const n = normalOf(height, x, z);
    return Math.atan2(n.x, n.z);
  };
  const unload = (i: number): Spot => {
    const l = lifts[i];
    liftPoint(l, 1, pt);
    const off = l.kind === 'chair' || l.kind === 'gondola' ? 12 : 5;
    const x = pt.x + pt.dx * off, z = pt.z + pt.dz * off;
    return { x, z, heading: facing(x, z) };
  };
  // the summit (La Dôle, the Mossettes…): at the head of the piste dropping the most over 600 m from the summit lift's top
  const top = unload(Math.max(0, lifts.findIndex((l) => l.name === st.summit)));
  const first = steepest(top.x, top.z, 150, undefined, 600);
  let summit = top;
  if (first) {
    along(first.p, first.s + 8, pt);
    summit = { x: pt.x, z: pt.z, heading: Math.atan2(pt.dx, pt.dz) };
  }
  // the start: in the start lift's queue (the Jouvenceaux at the foot of Les Jouvencelles, Super-Morzine in the village), facing it
  const base = lifts.find((l) => l.name === st.start) ?? lifts[0];
  liftPoint(base, 0, pt);
  // beside the line, looking up it (the station, the chairs climbing): 12 m from the bottom, the first push boards it
  const spawn = { x: pt.x - pt.dx * 9 + pt.dz * 8, z: pt.z - pt.dz * 9 - pt.dx * 8, heading: Math.atan2(pt.dx, pt.dz) };

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
  // lift stations, top and bottom: solid, two circles across the line cover the 9 × 7 m base
  for (const l of lifts) {
    const s = stationScale(l);
    if (!s) continue;
    for (const f of [0, 1]) {
      liftPoint(l, f, pt);
      for (const side of [-1, 1]) {
        list.push({ id: list.length, x: pt.x + pt.dz * side * s, z: pt.z - pt.dx * side * s, r: 3.5 * s, h: 7.6 * s, kind: 'station' });
      }
    }
  }
  const idx = indexObstacles(list);
  const dynamic: Obstacle[] = [];

  const m: Mountain = {
    def: freeDef(st),
    station: st,
    steep: st.steep,
    kickers: [],
    features: [],
    pistes,
    lifts,
    dynamic,
    grid: { x0: bounds.x0, z0: bounds.z0, step: STEP, nx, nz, h: gh, groomed: gg },
    forest,
    around: { x0: A.x0, z0: A.z0, step: A.step, nx: A.nx, nz: A.nz, h: ah, h0: ah0 },
    bounds,
    scenery: { roads: R.roads, buildings: R.buildings, radar: R.radar },
    spawn,
    summit,
    height,
    launch: 4, // at 140 km/h the steepened rolls would throw you off every crest: only a real drop (or a jump) does
    normal: (x, z, out) => normalOf(height, x, z, out),
    surface: (x, z) => (groomedAt(x, z) > 0.5 ? Surface.Groomed : Surface.Powder),
    centerX: () => m.spawn.x, // no single line on an open mountain: spawn / bot use spawn and guide()
    respawn(z, x = m.summit.x) {
      // back onto the nearest piste, a little uphill, facing down its line; far from any, in the nearest lift's queue
      const h = pisteAt(x, z, 250);
      if (!h) {
        const l = lifts.reduce((a, b) => (Math.hypot(b.pts[0] - x, b.pts[1] - z) < Math.hypot(a.pts[0] - x, a.pts[1] - z) ? b : a));
        liftPoint(l, 0, pt);
        return m.clearSpot({ x: pt.x - pt.dx * 12, z: pt.z - pt.dz * 12, heading: Math.atan2(pt.dx, pt.dz) });
      }
      along(h.p, Math.max(0, h.s - 6), pt);
      return m.clearSpot({ x: pt.x, z: pt.z, heading: Math.atan2(pt.dx, pt.dz) });
    },
    clearSpot(at) {
      const fx = Math.sin(at.heading), fz = Math.cos(at.heading);
      const near: Obstacle[] = [];
      for (const [a, side] of SLOTS) {
        const x = at.x + fx * a + fz * side, z = at.z + fz * a - fx * side;
        near.length = 0;
        const busy = m.obstaclesNear(x, z, 2.5, near).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + (o.kind === 'skier' ? 2.5 : 0.8));
        if (!busy) return { x, z, heading: at.heading };
      }
      return at;
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
      let p = h?.p, s = (h?.s ?? 0) + ahead;
      if (p && s > p.len) {
        s = p.next ? p.next.s + s - p.len : s;
        p = p.next?.p;
      }
      if (!p) {
        // off the pistes (or at the end of the last one): down the fall line
        const n = normalOf(height, x, z);
        const l = Math.hypot(n.x, n.z) || 1;
        return { x: x + (n.x / l) * ahead, z: z + (n.z / l) * ahead, hw: 6 };
      }
      along(p, s, pt);
      return { x: pt.x, z: pt.z, hw: p.halfWidth };
    },
  };
  return m;
}
