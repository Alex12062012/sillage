import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import { kickerLength, smoothstep, Surface, type Track } from '../sim/track';
import { TUNING as T } from '../tuning';

export const CHUNK = 64;

/** Lateral sample offsets from the centerline: dense on the piste, growing toward the far banks. */
function lateralOffsets(lod: number): number[] {
  const inner = lod === 0 ? 1.6 : 3.2;
  const side: number[] = [];
  for (let v = 0; v <= 32 + 1e-6; v += inner) side.push(v);
  let v = side[side.length - 1];
  let step = inner;
  while (v < 150) {
    step *= 1.22;
    v = Math.min(150, v + step);
    side.push(v);
  }
  return [...side.slice(1).reverse().map((x) => -x), ...side];
}
const OFFSETS = [lateralOffsets(0), lateralOffsets(1)];
const ROWS = [52, 26];

const C_GROOMED = new Color(0xedf2f8);
const C_POWDER = new Color(0xf7f9fd);
const C_ICE = new Color(0xc9ddf0);
const C_EDGE = new Color(0xc3d0e2);
const C_ROCK = new Color(0x7d8797);
const C_LIP = new Color(0xffa860);
const tmp = new Color();

/**
 * Builds one terrain chunk: a grid sheared along the winding centerline, heights sampled from the
 * analytic track, normals from the grid (ghost border → no seams), skirts to hide LOD cracks.
 */
export function buildChunkMesh(track: Track, index: number, lod: number, material: MeshLambertMaterial): Mesh {
  const offs = OFFSETS[lod];
  const C = offs.length;
  const R = ROWS[lod];
  const z0 = index * CHUNK;
  const dz = CHUNK / R;
  const hw = track.def.halfWidth;
  // ghost-bordered sample grid: rows -1..R+1, cols -1..C
  const GC = C + 2;
  const GR = R + 3;
  const P = new Float32Array(GR * GC * 3);
  for (let r = 0; r < GR; r++) {
    const z = z0 + (r - 1) * dz;
    const cx = track.centerX(z);
    for (let c = 0; c < GC; c++) {
      const ci = c - 1;
      const v = ci < 0 ? offs[0] - (offs[1] - offs[0]) : ci >= C ? offs[C - 1] + (offs[C - 1] - offs[C - 2]) : offs[ci];
      const x = cx + v;
      const k = (r * GC + c) * 3;
      P[k] = x;
      P[k + 1] = track.height(x, z);
      P[k + 2] = z;
    }
  }
  const verts = (R + 1) * C;
  const skirtVerts = 2 * C;
  const pos = new Float32Array((verts + skirtVerts) * 3);
  const nor = new Float32Array((verts + skirtVerts) * 3);
  const col = new Float32Array((verts + skirtVerts) * 3);
  const kick = track.kickers;
  for (let r = 0; r <= R; r++) {
    for (let c = 0; c < C; c++) {
      const g = ((r + 1) * GC + (c + 1)) * 3;
      const gl = g - 3;
      const gr = g + 3;
      const gu = g - GC * 3;
      const gd = g + GC * 3;
      // T_z × T_lat (both from neighbouring samples, shared across chunk borders)
      const ax = P[gd] - P[gu], ay = P[gd + 1] - P[gu + 1], az = P[gd + 2] - P[gu + 2];
      const bx = P[gr] - P[gl], by = P[gr + 1] - P[gl + 1], bz = P[gr + 2] - P[gl + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const i = r * C + c;
      const x = P[g], y = P[g + 1], z = P[g + 2];
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      nor[i * 3] = nx; nor[i * 3 + 1] = ny; nor[i * 3 + 2] = nz;
      // colour: surface, corduroy, piste edge line, kicker lips, rock on steep faces
      const d = offs[c];
      const ad = Math.abs(d);
      const surf = track.surface(x, z);
      if (surf === Surface.Ice) tmp.copy(C_ICE);
      else if (surf === Surface.Powder) tmp.copy(C_POWDER).multiplyScalar(0.985 + 0.015 * Math.sin(x * 0.7 + z * 0.4));
      else tmp.copy(C_GROOMED).multiplyScalar(1 - 0.022 * (Math.floor((d + 300) / 2.4) & 1));
      const edge = 1 - smoothstep(0.3, 1.6, Math.abs(ad - hw - 0.4));
      if (edge > 0) tmp.lerp(C_EDGE, edge * 0.55);
      for (const k of kick) {
        const u = z - k.z;
        if (u > k.ramp - 1.6 && u < k.ramp + k.knuckle + 0.2 && ad < k.halfWidth + 1) tmp.lerp(C_LIP, 0.55);
        else if (u > 0 && u < kickerLength(k) && ad < k.halfWidth + 1 && Math.abs(Math.abs(d - k.x) - k.halfWidth) < 0.5) tmp.lerp(C_LIP, 0.35);
      }
      const rock = smoothstep(0.74, 0.55, ny);
      if (rock > 0) tmp.lerp(C_ROCK, rock);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
  }
  // skirts under the first and last row
  for (let s = 0; s < 2; s++) {
    const r = s === 0 ? 0 : R;
    for (let c = 0; c < C; c++) {
      const src = r * C + c;
      const dst = verts + s * C + c;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - 4; pos[dst * 3 + 2] = pos[src * 3 + 2];
      nor.copyWithin(dst * 3, src * 3, src * 3 + 3);
      col.copyWithin(dst * 3, src * 3, src * 3 + 3);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C - 1; c++) {
      const a = r * C + c;
      idx.push(a, a + C, a + 1, a + 1, a + C, a + C + 1);
    }
  }
  for (let s = 0; s < 2; s++) {
    const r = s === 0 ? 0 : R;
    for (let c = 0; c < C - 1; c++) {
      const t0 = r * C + c;
      const b0 = verts + s * C + c;
      idx.push(t0, t0 + 1, b0, t0 + 1, b0 + 1, b0, t0, b0, t0 + 1, t0 + 1, b0, b0 + 1); // both windings
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, material);
  mesh.userData.own = true;
  return mesh;
}

/** Frees what a chunk owns: its terrain geometry and instance buffers (shared prop geometries stay). */
function disposeChunk(g: Group): void {
  g.traverse((o) => {
    if (o instanceof InstancedMesh) o.dispose();
    else if (o.userData.own) (o as Mesh).geometry.dispose();
  });
}

export type PropsBuilder = (track: Track, z0: number, z1: number, lod: number) => Object3D[];

interface Built { group: Group; used: number }

/**
 * Streams chunks around the camera: LOD 0 near, LOD 1 far, at most `maxBuilds` new chunks per frame,
 * LRU cache so a restart never rebuilds the start area.
 */
export class Terrain {
  readonly group = new Group();
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private cache = new Map<string, Built>();
  private shown = new Map<number, string>();
  private tick = 0;
  viewDistance = 470;
  lodDistance = 170;
  buildMs = 0;

  constructor(private track: Track, private props: PropsBuilder) {}

  private key(i: number, lod: number): string {
    return `${i}:${lod}`;
  }

  private build(i: number, lod: number): Built {
    const t0 = performance.now();
    const g = new Group();
    g.add(buildChunkMesh(this.track, i, lod, this.material));
    for (const o of this.props(this.track, i * CHUNK, (i + 1) * CHUNK, lod)) g.add(o);
    const b = { group: g, used: this.tick };
    this.cache.set(this.key(i, lod), b);
    this.buildMs = performance.now() - t0;
    return b;
  }

  /** Call every frame with the camera's z. Returns the number of chunks built this frame. */
  update(z: number, maxBuilds = 1): number {
    this.tick++;
    const i0 = Math.floor((z - 80) / CHUNK);
    const i1 = Math.floor((z + this.viewDistance) / CHUNK);
    let builds = 0;
    for (let i = i0; i <= i1; i++) {
      const dist = Math.abs((i + 0.5) * CHUNK - z);
      const lod = dist < this.lodDistance ? 0 : 1;
      const key = this.key(i, lod);
      let b = this.cache.get(key);
      if (!b) {
        if (builds >= maxBuilds && this.shown.has(i)) continue; // keep the other LOD for now
        b = this.build(i, lod);
        builds++;
      }
      b.used = this.tick;
      const cur = this.shown.get(i);
      if (cur !== key) {
        if (cur) this.cache.get(cur)?.group.removeFromParent();
        this.group.add(b.group);
        this.shown.set(i, key);
      }
    }
    for (const [i, key] of this.shown) {
      if (i < i0 || i > i1) {
        this.cache.get(key)?.group.removeFromParent();
        this.shown.delete(i);
      }
    }
    if (this.cache.size > 48) this.evict();
    return builds;
  }

  /** Synchronously builds everything visible from `z` (loading screen / restart). */
  prewarm(z: number): void {
    this.update(z, 99);
  }

  private evict(): void {
    const visible = new Set(this.shown.values());
    const old = [...this.cache.entries()].filter(([k]) => !visible.has(k) && !k.startsWith('0:') && !k.startsWith('-1:'));
    old.sort((a, b) => a[1].used - b[1].used);
    for (const [k, b] of old.slice(0, this.cache.size - 40)) {
      disposeChunk(b.group);
      this.cache.delete(k);
    }
  }

  dispose(): void {
    for (const b of this.cache.values()) disposeChunk(b.group);
    this.material.dispose();
    this.cache.clear();
    this.shown.clear();
    this.group.clear();
  }
}

/**
 * Sun glints on the snow: sparse ice crystals (one random facet per ~11 cm cell) that flash when they
 * mirror the sun into the camera. View dependent, so they twinkle as you ride; faded out beyond ~40 m
 * (no shimmer far away), only on bright snow (not rock, lips or piste edges). Patches the terrain
 * material in place; setQuality('low') turns it off, update(time) drives a slow twinkle.
 */
export function addSnowSparkle(material: MeshLambertMaterial): { setQuality(q: 'low' | 'medium' | 'high'): void; update(time: number): void } {
  const uniforms = { uSparkle: { value: 1 }, uSparkleTime: { value: 0 } };
  let level = 1;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSparkleW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSparkleW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSparkleW;
        uniform float uSparkle;
        uniform float uSparkleTime;
        vec3 sparkleHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yzz) * p3.zyx);
        }`)
      .replace('#include <opaque_fragment>', `
        #if NUM_DIR_LIGHTS > 0
        if (uSparkle > 0.0) {
          float dist = length(vViewPosition);
          float fade = smoothstep(42.0, 6.0, dist) * uSparkle * smoothstep(0.6, 0.8, diffuseColor.g);
          vec2 cp = vSparkleW.xz * 9.0;
          vec3 r = sparkleHash(floor(cp));
          if (fade > 0.0 && r.x > 0.76) {
            // a crystal spot at a random place in its cell, never smaller than ~1 px
            float rad = max(0.1, dist * 0.022);
            float spot = smoothstep(rad, rad * 0.4, length(fract(cp) - 0.2 - 0.6 * r.yz));
            vec3 facet = normalize(normal + (sparkleHash(floor(cp) + 17.0) - 0.5) * 0.9);
            vec3 hv = normalize(directionalLights[0].direction + normalize(vViewPosition));
            float spec = pow(max(dot(facet, hv), 0.0), 90.0);
            float tw = 0.65 + 0.35 * sin(uSparkleTime * 2.3 + r.y * 60.0);
            outgoingLight += directionalLights[0].color * (spec * spot * fade * tw * 6.0);
          }
        }
        #endif
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'snow-sparkle';
  material.needsUpdate = true;
  return {
    setQuality(q) {
      level = { low: 0, medium: 0.75, high: 1 }[q];
    },
    update(time) {
      uniforms.uSparkle.value = level * T.fxSparkle;
      uniforms.uSparkleTime.value = time;
    },
  };
}
