/** Seeded PRNG (mulberry32): fast, 32-bit state, good enough for procedural placement. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash → [0, 1). */
export function hash2(seed: number, ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10); // C2: smooth normals for the physics

/** 2D value noise in [-1, 1]. */
export function valueNoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = hash2(seed, ix, iz);
  const b = hash2(seed, ix + 1, iz);
  const c = hash2(seed, ix, iz + 1);
  const d = hash2(seed, ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal sum of `octaves` value-noise layers, normalized to [-1, 1]. */
export function fbm(seed: number, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
