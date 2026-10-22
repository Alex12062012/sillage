import { Vector3 } from 'three';

export const Surface = { Groomed: 0, Powder: 1, Ice: 2 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** What the physics needs from the world. Heights are analytic: the mesh only samples them. */
export interface Ground {
  height(x: number, z: number): number;
  normal(x: number, z: number, out?: Vector3): Vector3;
  surface(x: number, z: number): Surface;
  /** Where to put the skier back after a crash near `z` (defaults to in place, facing downhill). */
  respawn?(z: number): { x: number; z: number; heading: number };
}

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
 * A kicker across the piste, along +z: concave takeoff ramp → short table (the lip) →
 * steep landing that matches typical flight paths → recovery back to the parent slope.
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

export function kickerOffset(k: Kicker, x: number, z: number): number {
  const u = z - k.z;
  if (u <= 0) return 0;
  const w = 1 - smoothstep(k.halfWidth, k.halfWidth + 3, Math.abs(x - k.x));
  if (w <= 0) return 0;
  let h: number;
  if (u < k.ramp) {
    const t = u / k.ramp;
    h = k.height * t * t;
  } else if (u < k.ramp + k.knuckle) {
    h = k.height;
  } else if (u < k.ramp + k.knuckle + k.land) {
    h = k.height - (k.height + k.drop) * trapStep((u - k.ramp - k.knuckle) / k.land, 0.2);
  } else if (u < k.ramp + k.knuckle + k.land + k.recover) {
    h = -k.drop * (1 - trapStep((u - k.ramp - k.knuckle - k.land) / k.recover, 0.5));
  } else {
    return 0;
  }
  return h * w;
}

export interface TrackDef {
  id: string;
  name: string;
  seed: number;
  /** Start gate at z = 0, finish line at z = length. */
  length: number;
  slopeDeg: number;
  /** Half-width of the groomed piste (m). */
  halfWidth: number;
  kickers: { z: number; x?: number; size: keyof typeof KICKERS }[];
}

export interface Track extends Ground {
  def: TrackDef;
  centerX(z: number): number;
  respawn(z: number): { x: number; z: number; heading: number };
}

/** Lateral profile: gentle bowl on the piste, C1-continuous banks that steepen outside it. */
export function bank(d: number, halfWidth: number): number {
  const a = Math.abs(d);
  const out = a - halfWidth;
  return 1.2 * (a / halfWidth) ** 2 + (out > 0 ? 0.012 * out * out : 0);
}

export function makeTrack(def: TrackDef): Track {
  const tanS = Math.tan((def.slopeDeg * Math.PI) / 180);
  const kickers: Kicker[] = def.kickers.map((k) => ({ ...KICKERS[k.size], z: k.z, x: k.x ?? 0 }));
  const centerX = (_z: number) => 0;
  const height = (x: number, z: number) => {
    let h = -z * tanS + bank(x - centerX(z), def.halfWidth);
    for (const k of kickers) h += kickerOffset(k, x, z);
    return h;
  };
  return {
    def,
    centerX,
    height,
    normal: (x, z, out) => normalOf(height, x, z, out),
    surface: (x, z) => (Math.abs(x - centerX(z)) <= def.halfWidth ? Surface.Groomed : Surface.Powder),
    respawn: (z) => {
      const rz = Math.max(0, z - 4);
      return { x: centerX(rz), z: rz, heading: 0 };
    },
  };
}

/** Shared finite-difference normal for any height field. */
export function normalOf(height: (x: number, z: number) => number, x: number, z: number, out = new Vector3()): Vector3 {
  const e = 0.05;
  const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
  const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
  return out.set(-dx, 1, -dz).normalize();
}
