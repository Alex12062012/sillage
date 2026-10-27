import { Vector3 } from 'three';
import { fbm, mulberry32, valueNoise } from '../core/rng';

export const Surface = { Groomed: 0, Powder: 1, Ice: 2 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** What the physics needs from the world. Heights are analytic: the mesh only samples them. */
export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: Vector3): Vector3;
  surface(x: number, z: number): Surface;
  /** Where to put the skier back after a crash near `z` (defaults to in place, facing downhill). */
  respawn?(z: number, x?: number): { x: number; z: number; heading: number };
  /** Obstacles whose circle may intersect a disc of `radius` around (x, z). Reuses `out`. */
  obstaclesNear?(x: number, z: number, radius: number, out: Obstacle[]): Obstacle[];
  /** Relative normal speed above which this ground lets go of the skis (defaults to TUNING.launchThreshold). */
  launch?: number;
}

export interface Obstacle { id: number; x: number; z: number; r: number; h: number; kind: 'tree' | 'rock' | 'skier' | 'station' | 'building' | 'tower' }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** ∫ of a trapezoid slope profile normalized to [0,1]: ramps in, holds a constant slope, ramps out (C1). */
export function trapStep(t: number, a: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = 1 / (1 - a);
  if (t < a) return (s * t * t) / (2 * a);
  if (t < 1 - a) return s * (a / 2 + t - a);
  const r = 1 - t;
  return 1 - (s * r * r) / (2 * a);
}

/**
 * A kicker across the piste: concave takeoff ramp → short table (the lip) → long landing matched to
 * typical flight paths → recovery to the parent slope. `x` is the lateral offset from the centerline.
 */
export interface Kicker {
  z: number; x: number; halfWidth: number;
  height: number; ramp: number; knuckle: number; land: number; drop: number; recover: number;
}

export const KICKERS = {
  // calibrated by simulation (docs/FEEL.md journal): soft landings at 30-60 km/h, hard (not crash) above
  small: { z: 0, x: 0, halfWidth: 4, height: 0.6, ramp: 5, knuckle: 0.5, land: 26, drop: 5, recover: 20 },
  medium: { z: 0, x: 0, halfWidth: 5, height: 1.0, ramp: 7, knuckle: 1, land: 40, drop: 9, recover: 30 },
  large: { z: 0, x: 0, halfWidth: 6, height: 1.6, ramp: 9, knuckle: 1, land: 56, drop: 17, recover: 36 },
} satisfies Record<string, Kicker>;

export const kickerLength = (k: Kicker) => k.ramp + k.knuckle + k.land + k.recover;

/** Height offset of kicker `k` at along-track u = z - k.z and lateral distance `lat` from its axis. */
export function kickerProfile(k: Kicker, u: number, lat: number): number {
  if (u <= 0) return 0;
  const w = 1 - smoothstep(k.halfWidth, k.halfWidth + 3, Math.abs(lat));
  if (w <= 0) return 0;
  let h: number;
  if (u < k.ramp) {
    const t = u / k.ramp;
    h = k.height * t * t;
  } else if (u < k.ramp + k.knuckle) {
    h = k.height;
  } else if (u < k.ramp + k.knuckle + k.land) {
    h = k.height - (k.height + k.drop) * trapStep((u - k.ramp - k.knuckle) / k.land, 0.2);
  } else if (u < kickerLength(k)) {
    h = -k.drop * (1 - trapStep((u - k.ramp - k.knuckle - k.land) / k.recover, 0.5));
  } else {
    return 0;
  }
  return h * w;
}

/** Kicker on a straight test slope (x = world x). */
export const kickerOffset = (k: Kicker, x: number, z: number) => kickerProfile(k, z - k.z, x - k.x);

/** d/dt of trapStep: the trapezoid itself. */
function trapSlope(t: number, a: number): number {
  if (t <= 0 || t >= 1) return 0;
  const s = 1 / (1 - a);
  return s * (t < a ? t / a : t < 1 - a ? 1 : (1 - t) / a);
}

/** The takeoff part of a kicker (ramp, table, then fading over the landing): local to the piste. */
export function kickerBump(k: Kicker, u: number, lat: number): number {
  if (u <= 0 || u >= k.ramp + k.knuckle + k.land) return 0;
  const w = 1 - smoothstep(k.halfWidth, k.halfWidth + 3, Math.abs(lat));
  if (w <= 0) return 0;
  if (u < k.ramp) return k.height * (u / k.ramp) ** 2 * w;
  if (u < k.ramp + k.knuckle) return k.height * w;
  return k.height * (1 - trapStep((u - k.ramp - k.knuckle) / k.land, 0.2)) * w;
}

/**
 * Extra downhill slope (tan) of the landing dip at u: steeper landing, then a flatter recovery.
 * Integrated into the base profile, the dip spans the whole corridor like a natural headwall;
 * along the kicker axis, bump + dip equals kickerProfile exactly.
 */
export function kickerDipSlope(k: Kicker, u: number): number {
  const l0 = k.ramp + k.knuckle;
  if (u <= l0 || u >= kickerLength(k)) return 0;
  if (u < l0 + k.land) return (k.drop * trapSlope((u - l0) / k.land, 0.2)) / k.land;
  return (-k.drop * trapSlope((u - l0 - k.land) / k.recover, 0.5)) / k.recover;
}

/** Shared finite-difference normal for any height field. */
export function normalOf(height: (x: number, z: number) => number, x: number, z: number, out = new Vector3()): Vector3 {
  const e = 0.05;
  const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
  const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  return out.set(-dx, 1, -dz).normalize();
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface TrackDef {
  id: string;
  name: string;
  difficulty: Difficulty;
  seed: number;
  /** Start gate at z = 0, finish line at z = length. */
  length: number;
  slopeDeg: number;
  /** ± degrees of slope variation along the run. */
  slopeVar: number;
  /** Half-width of the groomed piste (m). */
  halfWidth: number;
  /** Lateral amplitude of the winding centerline (m). */
  curve: number;
  kickers: { size: keyof typeof KICKERS; z?: number }[];
  moguls: number;
  glades: number;
  cliffs: number;
  ice: number;
  arches: number;
  treeDensity: number;
  rockDensity: number;
  /** 0..1 (0.25 morning, 0.5 noon, 0.8 golden hour). */
  timeOfDay: number;
  /** Reference time (s) for the finish bonus and the race challenge. */
  par: number;
}

export type FeatureType = 'kicker' | 'moguls' | 'glade' | 'cliff' | 'ice' | 'arch';
export interface Feature { type: FeatureType; z0: number; z1: number; size?: keyof typeof KICKERS; height?: number }

export interface Track extends Ground {
  def: TrackDef;
  kickers: Kicker[];
  features: Feature[];
  centerX(z: number): number;
  respawn(z: number, x?: number): { x: number; z: number; heading: number };
  obstaclesNear(x: number, z: number, radius: number, out: Obstacle[]): Obstacle[];
  obstaclesBetween(z0: number, z1: number): Obstacle[];
  /** Open terrain (free ride): a point `ahead` m down the piste under (x, z), and its half-width. */
  guide?(x: number, z: number, ahead: number): { x: number; z: number; hw: number };
}

/** Lateral profile: gentle bowl on the piste, C1-continuous banks that steepen outside it. */
export function bank(d: number, halfWidth: number): number {
  const a = Math.abs(d);
  const out = a - halfWidth;
  return 1.2 * (a / halfWidth) ** 2 + (out > 0 ? 0.012 * out * out : 0);
}

/** Visual tree proportions shared with render/props.ts. */
export const TREE_HEIGHT = 4.4;
export const TREE_CANOPY = 1.0;
const BUCKET = 16;
const DEG = Math.PI / 180;
const FOOTPRINT: Record<FeatureType, [number, number]> = {
  kicker: [0, 0], moguls: [60, 90], glade: [90, 150], cliff: [30, 30], ice: [70, 120], arch: [24, 24],
};

/** Spatial index of static obstacles in 16 m slices along z. */
export function indexObstacles(list: Obstacle[]) {
  const buckets = new Map<number, Obstacle[]>();
  for (const o of list) {
    const k = Math.floor(o.z / BUCKET);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(o);
  }
  return {
    near(x: number, z: number, radius: number, out: Obstacle[]): Obstacle[] {
      out.length = 0;
      const k0 = Math.floor((z - radius - 2) / BUCKET);
      const k1 = Math.floor((z + radius + 2) / BUCKET);
      for (let k = k0; k <= k1; k++) {
        const b = buckets.get(k);
        if (!b) continue;
        for (const o of b) {
          const rr = radius + o.r;
          const dx = o.x - x;
          const dz = o.z - z;
          if (dx * dx + dz * dz < rr * rr) out.push(o);
        }
      }
      return out;
    },
    between(z0: number, z1: number): Obstacle[] {
      const res: Obstacle[] = [];
      for (let k = Math.floor(z0 / BUCKET); k <= Math.floor(z1 / BUCKET); k++) {
        for (const o of buckets.get(k) ?? []) if (o.z >= z0 && o.z < z1) res.push(o);
      }
      return res;
    },
  };
}

/** Feature layout: shuffled, placed in order with gaps inside [80, length - 100]. Never overlapping. */
function layoutFeatures(def: TrackDef, rnd: () => number): { features: Feature[]; kickers: Kicker[] } {
  const items: Feature[] = [];
  for (const k of def.kickers) items.push({ type: 'kicker', z0: k.z ?? NaN, z1: 0, size: k.size });
  const add = (type: FeatureType, n: number) => { for (let i = 0; i < n; i++) items.push({ type, z0: NaN, z1: 0 }); };
  add('moguls', def.moguls);
  add('glade', def.glades);
  add('cliff', def.cliffs);
  add('arch', def.arches);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const len = (f: Feature) => {
    if (f.type === 'kicker') return kickerLength(KICKERS[f.size!]) + 12;
    const [a, b] = FOOTPRINT[f.type];
    return a + (b - a) * rnd();
  };
  const lens = items.map(len);
  const start = 80;
  const end = def.length - 100;
  const total = lens.reduce((a, b) => a + b, 0);
  const gap = Math.max(10, (end - start - total) / (items.length + 1));
  let z = start + gap * (0.5 + rnd() * 0.5);
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    if (Number.isNaN(f.z0)) f.z0 = z;
    f.z1 = f.z0 + lens[i];
    if (f.type === 'cliff') f.height = 4 + rnd() * 2.5;
    z = f.z1 + gap * (0.6 + rnd() * 0.8);
  }
  // ice is a surface property: it may overlap other features
  for (let i = 0; i < def.ice; i++) {
    const zc = start + (end - start) * ((i + 0.5 + (rnd() - 0.5) * 0.4) / def.ice);
    const l = FOOTPRINT.ice[0] + (FOOTPRINT.ice[1] - FOOTPRINT.ice[0]) * rnd();
    items.push({ type: 'ice', z0: Math.max(start, zc - l / 2), z1: Math.min(end, zc + l / 2) });
  }
  const kickers = items
    .filter((f) => f.type === 'kicker')
    .map((f) => ({ ...KICKERS[f.size!], z: f.z0 + 6, x: 0 }));
  return { features: items.sort((a, b) => a.z0 - b.z0), kickers };
}

export function makeTrack(def: TrackDef): Track {
  const rnd = mulberry32(def.seed);
  const { features, kickers } = layoutFeatures(def, rnd);
  const L = def.length;

  // ── centerline: two seeded sines, straight at the start and the finish
  const lamA = 330 + rnd() * 120;
  const lamB = 150 + rnd() * 70;
  const phA = rnd() * Math.PI * 2;
  const phB = rnd() * Math.PI * 2;
  const ampA = def.curve * 0.62;
  const ampB = def.curve * 0.38;
  const taper = (z: number) => smoothstep(10, 120, z) * (1 - smoothstep(L - 160, L - 40, z));
  const rawCx = (z: number) => ampA * Math.sin((2 * Math.PI * z) / lamA + phA) + ampB * Math.sin((2 * Math.PI * z) / lamB + phB);
  const cx0 = rawCx(0);
  const centerX = (z: number) => (rawCx(z) - cx0) * taper(z);

  // ── slope along z (tan), with cliffs as narrow bells; integrated once into a Hermite table
  const tanBase = Math.tan(def.slopeDeg * DEG);
  const dTan = def.slopeVar * DEG * (1 + tanBase * tanBase);
  const lamS1 = 260 + rnd() * 120;
  const lamS2 = 110 + rnd() * 60;
  const phS1 = rnd() * Math.PI * 2;
  const phS2 = rnd() * Math.PI * 2;
  const cliffs = features.filter((f) => f.type === 'cliff');
  const tanStart = Math.tan(7 * DEG);
  const tanMin = Math.tan(4 * DEG);
  const tanRunout = Math.tan(3 * DEG);
  const slopeAt = (z: number) => {
    let s = tanBase + dTan * (0.6 * Math.sin((2 * Math.PI * z) / lamS1 + phS1) + 0.4 * Math.sin((2 * Math.PI * z) / lamS2 + phS2));
    for (const c of cliffs) {
      const u = (z - (c.z0 + 15)) / 1.3; // a sharp lip so the drop really launches you
      s += ((c.height ?? 5) / (1.3 * Math.sqrt(Math.PI))) * Math.exp(-u * u);
    }
    for (const k of kickers) s += kickerDipSlope(k, z - k.z);
    s = Math.max(s, tanMin); // never uphill: a stopped or crashed skier can always slide on (review finding)
    const w1 = smoothstep(-8, 45, z);
    const w2 = smoothstep(L + 20, L + 130, z);
    return (tanStart + (s - tanStart) * w1) * (1 - w2) + tanRunout * w2;
  };
  const Z0 = -150;
  const STEP = 0.5;
  const N = Math.ceil((L + 450 - Z0) / STEP) + 1;
  const Htab = new Float64Array(N);
  const Stab = new Float64Array(N);
  Stab[0] = slopeAt(Z0);
  for (let i = 1; i < N; i++) {
    const z = Z0 + i * STEP;
    Stab[i] = slopeAt(z);
    Htab[i] = Htab[i - 1] - (STEP / 6) * (Stab[i - 1] + 4 * slopeAt(z - STEP / 2) + Stab[i]); // Simpson
  }
  const baseH = (z: number) => {
    const f = clamp((z - Z0) / STEP, 0, N - 1.000001);
    const i = Math.floor(f);
    const t = f - i;
    const t2 = t * t;
    const t3 = t2 * t;
    // cubic Hermite with the exact slopes as tangents: C1 everywhere
    return (2 * t3 - 3 * t2 + 1) * Htab[i] - (t3 - 2 * t2 + t) * STEP * Stab[i]
      + (-2 * t3 + 3 * t2) * Htab[i + 1] - (t3 - t2) * STEP * Stab[i + 1];
  };

  const moguls = features.filter((f) => f.type === 'moguls');
  const ice = features.filter((f) => f.type === 'ice');
  const hw = def.halfWidth;
  const seed = def.seed;

  const height = (x: number, z: number) => {
    const d = x - centerX(z);
    const ad = Math.abs(d);
    let h = baseH(z) + bank(d, hw);
    const off = smoothstep(hw + 1, hw + 18, ad);
    if (off > 0) h += off * (fbm(seed, x * 0.022, z * 0.022, 3) * 6 + valueNoise(seed + 9, x * 0.3, z * 0.3) * 0.22);
    for (const m of moguls) {
      if (z < m.z0 || z > m.z1 || ad > hw + 2) continue;
      const w = smoothstep(m.z0, m.z0 + 10, z) * (1 - smoothstep(m.z1 - 10, m.z1, z)) * (1 - smoothstep(hw - 3, hw + 2, ad));
      h += w * 0.42 * Math.sin((2 * Math.PI * z) / 7.5) * Math.sin((2 * Math.PI * d) / 5.5 + z * 0.35);
    }
    for (const k of kickers) {
      const u = z - k.z;
      if (u > 0 && u < kickerLength(k)) h += kickerBump(k, u, d - k.x);
    }
    return h;
  };

  const surface = (x: number, z: number): Surface => {
    const ad = Math.abs(x - centerX(z));
    if (ad > hw + 2) return Surface.Powder;
    for (const f of ice) if (z > f.z0 && z < f.z1 && ad < hw - 1) return Surface.Ice;
    return Surface.Groomed;
  };

  // ── obstacles
  const list: Obstacle[] = [];
  const noGo = (z: number, ad: number) => {
    if (z < 40 && ad < hw + 4) return true; // start area
    if (z > L - 40 && z < L + 60 && ad < hw + 6) return true; // finish arch
    for (const k of kickers) if (z > k.z - 12 && z < k.z + kickerLength(k) + 8 && ad < k.halfWidth + 5) return true;
    for (const c of cliffs) if (z > c.z0 - 5 && z < c.z1 + 25 && ad < hw + 1) return true;
    return false;
  };
  const tree = (x: number, z: number, h: number) => {
    if (noGo(z, Math.abs(x - centerX(z)))) return;
    list.push({ id: list.length, x, z, r: TREE_CANOPY * (h / TREE_HEIGHT) * 0.85, h, kind: 'tree' });
  };
  const rock = (x: number, z: number, r: number) => {
    if (noGo(z, Math.abs(x - centerX(z)))) return;
    list.push({ id: list.length, x, z, r, h: r * 1.1, kind: 'rock' });
  };
  const glades = features.filter((f) => f.type === 'glade');
  const td = def.treeDensity;
  for (let z = -60; z < L + 160; z += 5 + rnd() * 5) {
    const c = centerX(z);
    for (const side of [-1, 1]) {
      // edge row: a soft wall that frames the line
      if (rnd() < 0.85) tree(c + side * (hw + 2.5 + rnd() * 5), z + rnd() * 3, 4.5 + rnd() * 3.5);
      // forest: clustered by noise, thinning toward the far banks
      const n = Math.round(td * 4 * (0.5 + 0.5 * fbm(seed + 3, z * 0.01, side * 3, 2)) + rnd());
      for (let k = 0; k < n; k++) tree(c + side * (hw + 9 + Math.pow(rnd(), 1.4) * 120), z + rnd() * 6, 6 + rnd() * 7);
      if (rnd() < 0.25 * def.rockDensity) rock(c + side * (hw + 4 + rnd() * 60), z + rnd() * 5, 0.8 + rnd() * 1.6);
    }
    // scattered near-miss bait on the piste (rarer on easy runs)
    if (rnd() < 0.05 * td) tree(c + (rnd() * 2 - 1) * (hw - 6), z, 4 + rnd() * 2);
    if (def.difficulty === 'hard' && rnd() < 0.05) rock(c + (rnd() * 2 - 1) * (hw - 4), z, 0.7 + rnd() * 0.6);
  }
  // glades: tree slaloms across the piste
  for (const g of glades) {
    for (let z = g.z0 + 8; z < g.z1 - 6; z += 10 + rnd() * 5) {
      const c = centerX(z);
      const count = hw > 18 ? 3 : 2;
      const xs: number[] = [];
      for (let tries = 0; xs.length < count && tries < 20; tries++) {
        const x = (rnd() * 2 - 1) * (hw - 3);
        if (xs.every((o) => Math.abs(o - x) > 6)) xs.push(x); // always leave real lanes between trunks
      }
      for (const x of xs) tree(c + x, z + rnd() * 3, 4 + rnd() * 2.5);
    }
  }
  // arches: two rock pillars framing the piste (the "portique")
  for (const a of features.filter((f) => f.type === 'arch')) {
    const z = a.z0 + 12;
    const c = centerX(z);
    for (const side of [-1, 1]) list.push({ id: list.length, x: c + side * (hw - 1.5), z, r: 1.3, h: 9, kind: 'rock' });
  }
  const index = indexObstacles(list);

  /** Back on the line a few metres up, on a spot clear of anything around or just ahead; else further up. */
  function respawn(z: number): { x: number; z: number; heading: number } {
    const rz = Math.max(0, z - 4);
    const c = centerX(rz);
    const heading = Math.atan((centerX(rz + 1) - centerX(rz - 1)) / 2);
    const tmp: Obstacle[] = [];
    for (const dx of [0, 3, -3, 6, -6, 9, -9]) {
      const x = c + dx;
      const blocked = index.near(x, rz + 5, 9, tmp).some((o) =>
        Math.hypot(o.x - x, o.z - rz) < o.r + 2 || (o.z > rz && o.z < rz + 12 && Math.abs(o.x - x) < o.r + 2));
      if (!blocked) return { x, z: rz, heading };
    }
    return rz > 0 ? respawn(rz + 1) : { x: c, z: rz, heading };
  }

  return {
    def,
    kickers,
    features,
    centerX,
    height,
    normal: (x, z, out) => normalOf(height, x, z, out),
    surface,
    obstaclesNear: index.near,
    obstaclesBetween: index.between,
    respawn,
  };
}
