import { BufferGeometry, Color, Float32BufferAttribute, Material } from 'three';

/**
 * The station's buildings as archetypes with procedural variants (DECISIONS.md, point 98): volumes, roof pitch and
 * overhang, ridge offset, balconies, colours and shop signs all come from a seed, so no two neighbours match.
 * - Jura farm: rendered walls, a broad low roof, a timber-clad gable top (Illico Resto's family);
 * - wooden chalet: dark or honey boarding over a stone plinth, a deep overhang, a balcony on the gable;
 * - log chalet: honey logs, a standing-seam steel roof with a deep overhang (the Chalet du Lac's family);
 * - Avoriaz residence: red cedar shingles, tall, a steep roof with an offset ridge, balconies on every floor;
 * - station block: rendered walls, wooden balconies, a gable roof.
 * Low triangle counts throughout: no bottom faces, no faces hidden in the volume, windows as single quads.
 */

/** Window glass marker (a vertex colour nothing else uses): dark sky-blue glass by day, warm light at dusk. */
export const WINDOW = new Color(1, 0, 1);
/** 0 by day, 1 when the windows are lit (Sky sets it from the sun's height). */
export const WINDOW_LIGHT = { value: 0 };

/** Adds the window marker's glass and evening glow to a lit, vertex-coloured material (after addHeightFog). */
export function addWindows(sh: { uniforms: Record<string, unknown>; fragmentShader: string }): void {
  sh.uniforms.uWindowLight = WINDOW_LIGHT;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWindowLight;\nfloat isWindow = 0.0;')
    .replace('#include <color_fragment>', `#include <color_fragment>
    #if defined( USE_COLOR )
      if (vColor.g < 0.02 && vColor.r > 0.97 && vColor.b > 0.97) {
        diffuseColor.rgb = vec3(0.045, 0.06, 0.085); // glass: dark, a little blue
        isWindow = 1.0;
      }
    #endif`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    // by day a faint sky reflection, at dusk the warm light of the rooms (2 700 K)
    totalEmissiveRadiance += isWindow * mix(vec3(0.02, 0.03, 0.045), vec3(1.0, 0.56, 0.2) * 1.3, uWindowLight);`);
}

/** Hooks a material for windows (and the height fog its prototype hook adds). */
export function withWindows<M extends Material>(mat: M): M {
  const base = Material.prototype.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base.call(mat, sh, r);
    addWindows(sh);
  };
  mat.customProgramCacheKey = () => 'windows';
  return mat;
}

type P = [number, number, number];

/** A little mesh builder: flat triangles with one colour each (non-indexed, normals per face). */
export class Geo {
  pos: number[] = [];
  col: number[] = [];

  tri(a: P, b: P, c: P, k: Color): this {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(k.r, k.g, k.b);
    return this;
  }

  /** a b c d counter-clockwise seen from outside. */
  quad(a: P, b: P, c: P, d: P, k: Color): this {
    return this.tri(a, b, c, k).tri(a, c, d, k);
  }

  /** The four walls of a box from y0 to y1 (no top, no bottom), centred on (cx, cz). */
  walls(cx: number, cz: number, w: number, d: number, y0: number, y1: number, k: Color, kSide = k): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], k); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], kSide); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], kSide); // -x
    return this;
  }

  /** A box with its top (a slab, a balcony floor): 10 triangles. */
  block(cx: number, cy: number, cz: number, w: number, h: number, d: number, k: Color, top = k): this {
    this.walls(cx, cz, w, d, cy - h / 2, cy + h / 2, k);
    const y = cy + h / 2, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    return this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], top);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** A gable roof, ridge along x over a w × d box whose walls stop at `eave`; returns the ridge height. */
export function gableRoof(g: Geo, w: number, d: number, eave: number, o: {
  pitch: number; over: number; gableOver: number; offset?: number; snow: Color; under: Color; edge: Color; gable: Color;
}): number {
  const half = d / 2, off = (o.offset ?? 0) * half; // the ridge moved towards -z by `offset` × half the depth
  const t = Math.tan(o.pitch);
  const ridge = eave + (half - Math.abs(off)) * t + Math.abs(off) * t * 0.5;
  const zr = -off;
  // each slope: from the eave line (overhanging) up to the ridge
  const xa = -w / 2 - o.gableOver, xb = w / 2 + o.gableOver;
  for (const s of [1, -1]) {
    const run = Math.abs(s * half - zr), drop = o.over * ((ridge - eave) / run);
    const ze = s * (half + o.over), ye = eave - drop;
    const near: P[] = [[xa, ye, ze], [xb, ye, ze]], top: P[] = [[xb, ridge, zr], [xa, ridge, zr]];
    if (s > 0) {
      g.quad(near[0], near[1], top[0], top[1], o.snow);
      g.quad(near[1], near[0], [xa, ye - 0.18, ze], [xb, ye - 0.18, ze], o.edge); // the snow's thickness on the eave
      g.quad([xb, ye - 0.18, ze], [xa, ye - 0.18, ze], [xa, ridge - 0.25, zr], [xb, ridge - 0.25, zr], o.under);
    } else {
      g.quad(near[1], near[0], top[1], top[0], o.snow);
      g.quad(near[0], near[1], [xb, ye - 0.18, ze], [xa, ye - 0.18, ze], o.edge);
      g.quad([xa, ye - 0.18, ze], [xb, ye - 0.18, ze], [xb, ridge - 0.25, zr], [xa, ridge - 0.25, zr], o.under);
    }
  }
  // the gable ends (both faces: seen from outside only, the inside is hidden by the roof)
  for (const sx of [1, -1]) {
    const x = (sx * w) / 2;
    const a: P = [x, eave, half], b: P = [x, eave, -half], c: P = [x, ridge - 0.1, zr];
    if (sx > 0) g.tri(a, b, c, o.gable);
    else g.tri(b, a, c, o.gable);
  }
  return ridge;
}

/** Windows on a facade: `n` per floor, each `ww` × `wh`, on the face at distance `off` along `axis` (+ or − `side`). */
export function windows(g: Geo, axis: 'x' | 'z', side: 1 | -1, len: number, off: number, floors: number, n: number, ww: number, wh: number, frame?: Color): void {
  const e = off + 0.03;
  for (let f = 0; f < floors; f++) {
    const y0 = 1.0 + f * 2.9, y1 = y0 + wh;
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n - 0.5) * len;
      const q = (u0: number, u1: number, v0: number, v1: number, k: Color, out: number) => {
        // corners counter-clockwise seen from outside
        if (axis === 'z') {
          const z = side * out;
          if (side > 0) g.quad([u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z], k);
          else g.quad([u1, v0, z], [u0, v0, z], [u0, v1, z], [u1, v1, z], k);
        } else {
          const x = side * out;
          if (side > 0) g.quad([x, v0, u1], [x, v0, u0], [x, v1, u0], [x, v1, u1], k);
          else g.quad([x, v0, u0], [x, v0, u1], [x, v1, u1], [x, v1, u0], k);
        }
      };
      if (frame) q(a - ww / 2 - 0.16, a + ww / 2 + 0.16, y0 - 0.16, y1 + 0.16, frame, e);
      q(a - ww / 2, a + ww / 2, y0, y1, WINDOW, e + (frame ? 0.02 : 0));
    }
  }
}

/** A wooden balcony along a facade: a floor slab with its snow and a solid railing (8 triangles). */
export function balcony(g: Geo, axis: 'x' | 'z', side: 1 | -1, along: number, len: number, off: number, y: number, depth: number, wood: Color, snow: Color): void {
  const c = off + depth / 2;
  if (axis === 'z') {
    g.block(along, y, side * c, len, 0.25, depth, wood, snow);
    const z = side * (off + depth);
    if (side > 0) g.quad([along - len / 2, y, z], [along + len / 2, y, z], [along + len / 2, y + 1.0, z], [along - len / 2, y + 1.0, z], wood);
    else g.quad([along + len / 2, y, z], [along - len / 2, y, z], [along - len / 2, y + 1.0, z], [along + len / 2, y + 1.0, z], wood);
  } else {
    g.block(side * c, y, along, depth, 0.25, len, wood, snow);
    const x = side * (off + depth);
    if (side > 0) g.quad([x, y, along + len / 2], [x, y, along - len / 2], [x, y + 1.0, along - len / 2], [x, y + 1.0, along + len / 2], wood);
    else g.quad([x, y, along - len / 2], [x, y, along + len / 2], [x, y + 1.0, along + len / 2], [x, y + 1.0, along - len / 2], wood);
  }
}

const SNOW = new Color(0xf2f5f9);
const SNOW_EDGE = new Color(0xe4e9f0);
const STONE = new Color(0x8f8a82);
const C = (hex: number) => new Color(hex);
const RENDERS = [0xcfc8b8, 0xd9d0bf, 0xc6beaf, 0xe2d8c3, 0xd4cdc2].map(C);
const BOARDS = [0x5e4330, 0x6e4c32, 0x7c5636, 0x4f3a2c].map(C);
const HONEY = [0xa8703c, 0x9a6634, 0xb27a44].map(C);
const CEDAR = [0x8c4a32, 0x7b4632, 0x6e3e2a, 0x93553a].map(C);
const EAVES = [0x3b2a20, 0x4a3426, 0x3d4146].map(C);
const SIGNS = [0x9b2c2c, 0x2f6b47, 0x24406b, 0xc28a2e, 0x6b2f5a].map(C);

const frac = (v: number) => v - Math.floor(v);
/** A stable pseudo-random value in [0, 1) per building and per question asked of it. */
const rnd = (seed: number, k: number) => frac(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453);

export type Archetype = 'farm' | 'chalet' | 'log' | 'residence' | 'block';

/** Which archetype a footprint gets: by station, size and height. */
export function archetypeOf(w: number, d: number, levels: number, alps: boolean, seed: number): Archetype {
  const area = w * d, r = rnd(seed, 1);
  if (alps) return levels >= 3 ? 'residence' : r < 0.3 ? 'log' : 'chalet';
  if (levels >= 4) return 'block';
  if (area > 260 || levels === 3) return r < 0.75 ? 'farm' : 'block';
  return r < 0.22 ? 'log' : r < 0.45 ? 'farm' : 'chalet';
}

/**
 * One building in local coordinates (centred, ground at y = 0, the long side along x), then turned and placed.
 * `near` false: the far version (walls and roof, no windows, balconies or signs).
 */
export function archetypeBuilding(x: number, y: number, z: number, w0: number, d0: number, yaw: number, levels: number, near: boolean, alps: boolean, seed: number): BufferGeometry {
  const g = new Geo();
  const kind = archetypeOf(w0, d0, levels, alps, seed);
  const turn = w0 >= d0 ? 0 : Math.PI / 2, w = Math.max(w0, d0), d = Math.min(w0, d0);
  const r = (k: number) => rnd(seed, k);
  const pick = <T,>(a: T[], k: number) => a[Math.floor(r(k) * a.length) % a.length];
  const eave = levels * 2.9 + 0.4;
  const floors = levels;
  let wall: Color, gable: Color, under: Color, edge = SNOW_EDGE, pitch: number, over: number, offset = 0;
  switch (kind) {
    case 'farm':
      wall = pick(RENDERS, 2); gable = pick(BOARDS, 3); under = pick(EAVES, 4); pitch = 0.42 + r(5) * 0.12; over = 0.6 + r(6) * 0.5;
      break;
    case 'chalet':
      wall = pick(BOARDS, 2); gable = wall; under = pick(EAVES, 4); pitch = (alps ? 0.5 : 0.45) + r(5) * 0.15; over = 1.0 + r(6) * 0.6;
      break;
    case 'log':
      wall = pick(HONEY, 2); gable = wall; under = EAVES[2]; edge = EAVES[2]; pitch = 0.45 + r(5) * 0.08; over = 1.4 + r(6) * 0.4;
      break;
    case 'residence':
      wall = pick(CEDAR, 2); gable = wall; under = pick(EAVES, 4); pitch = 0.85 + r(5) * 0.2; over = 0.5 + r(6) * 0.4; offset = (r(7) - 0.5) * 0.7;
      break;
    default:
      wall = pick(RENDERS, 2); gable = pick(BOARDS, 3); under = pick(EAVES, 4); pitch = 0.4 + r(5) * 0.1; over = 0.8;
  }
  // walls, with a stone plinth under timber (near only)
  const plinth = near && (kind === 'chalet' || kind === 'log') ? 0.9 : 0;
  if (plinth) g.walls(0, 0, w, d, 0, plinth, STONE);
  g.walls(0, 0, w, d, plinth, eave, wall);
  const ridge = gableRoof(g, w, d, eave, { pitch, over, gableOver: over * 0.8, offset, snow: SNOW, under, edge, gable });
  if (near && kind !== 'residence' && r(14) < 0.75) g.block(w * (r(15) - 0.5) * 0.6, ridge - 0.25, -d * 0.12, 0.6, 1.5, 0.6, STONE, SNOW); // a chimney
  if (near) {
    // windows: on the long sides, and on the gables of the smaller ones
    const nLong = Math.max(1, Math.min(kind === 'residence' ? 7 : 4, Math.floor(w / (kind === 'farm' ? 4.2 : 3.3))));
    const ww = kind === 'farm' ? 0.85 : kind === 'residence' ? 1.3 : 1.1, wh = kind === 'farm' ? 1.0 : 1.35;
    for (const s of [1, -1] as const) windows(g, 'z', s, w * 0.86, d / 2, floors, nLong, ww, wh);
    const nGable = Math.max(1, Math.min(3, Math.floor(d / 3.6)));
    for (const s of [1, -1] as const) windows(g, 'x', s, d * 0.8, w / 2, floors, nGable, ww, wh);
    // balconies: chalets on a gable (upper floor), residences on a long side at every floor above the ground
    const wood = kind === 'log' ? HONEY[1] : BOARDS[0];
    if ((kind === 'chalet' || kind === 'log') && levels >= 2 && r(8) < 0.8) balcony(g, 'x', r(9) < 0.5 ? 1 : -1, 0, d * 0.9, w / 2, 2.9 + 0.1, 1.2, wood, SNOW);
    if (kind === 'residence' || (kind === 'block' && r(8) < 0.7)) {
      const side = r(9) < 0.5 ? 1 : -1;
      for (let f = 1; f < floors; f++) balcony(g, 'z', side, 0, w * (0.55 + r(10) * 0.35), d / 2, f * 2.9 + 0.1, 1.3, kind === 'residence' ? CEDAR[2] : BOARDS[1], SNOW);
    }
    // a shop sign over the ground floor (one in three of the village ones)
    if (kind !== 'residence' && r(11) < 0.33) {
      const k = pick(SIGNS, 12), side = r(13) < 0.5 ? 1 : -1, len = Math.min(w * 0.5, 6), zf = side * (d / 2 + 0.06);
      if (side > 0) g.quad([-len / 2, 2.3, zf], [len / 2, 2.3, zf], [len / 2, 2.95, zf], [-len / 2, 2.95, zf], k);
      else g.quad([len / 2, 2.3, zf], [-len / 2, 2.3, zf], [-len / 2, 2.95, zf], [len / 2, 2.95, zf], k);
    }
  }
  return g.build().rotateY(turn + yaw).translate(x, y, z);
}

/**
 * Altitude restaurant (the generic restaurants, the Chalet du Lac's family): a log chalet on a stone footing, a
 * standing-seam steel roof with a deep overhang, big glazed bays onto a raised terrace with a plank railing and
 * parasols on the +z side, a chimney. Local frame: long side along x, ground at y = 0.
 */
export function altitudeRestaurant(w0: number, d0: number, eave: number, seed: number): BufferGeometry {
  const g = new Geo(), w = Math.max(w0, d0), d = Math.min(w0, d0), r = (k: number) => rnd(seed, k);
  const logs = HONEY[Math.floor(r(1) * HONEY.length) % HONEY.length], steel = EAVES[2], deck = C(0x9a7650);
  g.walls(0, 0, w, d, 0, 0.9, STONE);
  g.walls(0, 0, w, d, 0.9, eave, logs);
  const ridge = gableRoof(g, w, d, eave, { pitch: 0.47, over: 1.6, gableOver: 1.2, snow: SNOW, under: C(0x7a5230), edge: steel, gable: logs });
  g.block(w * 0.25, ridge - 0.2, -d * 0.12, 0.8, 1.6, 0.8, STONE, SNOW);
  // the bays onto the terrace, small windows elsewhere
  const n = Math.max(2, Math.floor(w / 3.4)), zf = d / 2 + 0.03;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n - 0.5) * w * 0.9;
    g.quad([a - 1.25, 0.95, zf], [a + 1.25, 0.95, zf], [a + 1.25, 3.0, zf], [a - 1.25, 3.0, zf], steel);
    g.quad([a - 1.12, 1.05, zf + 0.02], [a + 1.12, 1.05, zf + 0.02], [a + 1.12, 2.9, zf + 0.02], [a - 1.12, 2.9, zf + 0.02], WINDOW);
  }
  const floors = Math.max(1, Math.round((eave - 0.4) / 2.9));
  windows(g, 'z', -1, w * 0.85, d / 2, floors, Math.max(2, Math.floor(w / 3.6)), 0.9, 1.0);
  for (const s of [1, -1] as const) windows(g, 'x', s, d * 0.7, w / 2, floors, 2, 0.9, 1.0);
  // the terrace: a deck 5 m deep along +z, its railing on the three open sides, parasols
  const tl = w * 0.92, z0 = d / 2, z1 = d / 2 + 5;
  g.block(0, 0.45, (z0 + z1) / 2, tl, 0.9, 5, STONE, deck);
  g.quad([-tl / 2, 0.9, z1], [tl / 2, 0.9, z1], [tl / 2, 1.95, z1], [-tl / 2, 1.95, z1], logs);
  g.quad([tl / 2, 0.9, z1], [-tl / 2, 0.9, z1], [-tl / 2, 1.95, z1], [tl / 2, 1.95, z1], logs);
  for (const s of [1, -1]) {
    const x = (s * tl) / 2;
    g.quad([x, 0.9, s > 0 ? z1 : z0], [x, 0.9, s > 0 ? z0 : z1], [x, 1.95, s > 0 ? z0 : z1], [x, 1.95, s > 0 ? z1 : z0], logs);
    g.quad([x, 0.9, s > 0 ? z0 : z1], [x, 0.9, s > 0 ? z1 : z0], [x, 1.95, s > 0 ? z1 : z0], [x, 1.95, s > 0 ? z0 : z1], logs);
  }
  const np = Math.max(1, Math.floor(tl / 6)), cols = [C(0xd23b3b), C(0xf2c14e)];
  for (let k = 0; k < np; k++) {
    const x = ((k + 0.5) / np - 0.5) * tl, z = (z0 + z1) / 2 + 0.6, top = 3.4, k2 = cols[k % 2];
    g.walls(x, z, 0.1, 0.1, 0.9, top, GRIP_DARK);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, b = ((i + 1) / 6) * Math.PI * 2;
      const p: [number, number, number] = [x + Math.cos(a) * 1.7, top - 0.5, z - Math.sin(a) * 1.7], q: [number, number, number] = [x + Math.cos(b) * 1.7, top - 0.5, z - Math.sin(b) * 1.7];
      g.tri(p, q, [x, top, z], k2).tri(q, p, [x, top - 0.55, z], k2); // the canopy and its underside
    }
  }
  return g.build();
}
const GRIP_DARK = C(0x3b4352);
