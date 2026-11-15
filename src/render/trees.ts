import { BufferGeometry, Color, Float32BufferAttribute, MeshLambertMaterial } from 'three';
import { addHeightFog } from './heightFog';

/**
 * Free-ride trees. Two shapes, each with a near and a far geometry:
 * - conifer: Norway spruce and silver fir (one shape; the species is its tint and its width, set per instance);
 * - bare tree: winter beeches low down, larches high in the Alps (the larch drawn taller and slimmer).
 * Vertex colours are not colours here: r = snow (0 to 1), g = shade (0 to 1), b = bark (0 needles, 1 wood).
 * The material mixes them with the instance tint (instanceColor), and adds a light sway in the wind.
 * Unit size: 4.4 high, as the arcade tree (scale = height / 4.4).
 */

type V = [number, number, number];
type Tri = { p: [V, V, V]; c: [V, V, V]; n: [V, V, V] };

const unit = (v: V): V => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Normals are given, rounded like a cone's: flat facets made the low-poly crowns read as crystals. */
function build(tris: Tri[]): BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { pos.push(...t.p[k]); col.push(...t.c[k]); nor.push(...t.n[k]); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

/** A star skirt: apex, then a rim of n points alternately long (drooping) and short (raised), each tier turned. */
function skirt(tris: Tri[], n: number, rimY: number, apexY: number, r: number, turn: number, snow: number, under: boolean): void {
  const rim: V[] = [], rc: V[] = [], rn: V[] = [], dn: V[] = [], ang: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2, long = i % 2 === 0;
    const rr = long ? r : r * 0.86, y = long ? rimY - 0.1 : rimY + 0.06;
    ang.push(a);
    rim.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
    rc.push(long ? [snow * 0.2, 1, 0] : [snow * 0.45, 0.9, 0]); // snow lies in the notches, less on the tips
    rn.push(unit([Math.cos(a), 0.55, Math.sin(a)]));
    dn.push(unit([Math.cos(a), -0.5, Math.sin(a)]));
  }
  const apex: V = [0, apexY, 0], ac: V = [snow, 0.95, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, mid = (ang[i] + ang[j] + (j ? 0 : Math.PI * 2)) / 2;
    tris.push({ p: [apex, rim[j], rim[i]], c: [ac, rc[j], rc[i]], n: [unit([Math.cos(mid) * 0.5, 1, Math.sin(mid) * 0.5]), rn[j], rn[i]] });
    if (under) {
      const hub: V = [0, rimY + 0.4, 0], hc: V = [0, 0.38, 0];
      tris.push({ p: [hub, rim[i], rim[j]], c: [hc, [0, 0.55, 0], [0, 0.55, 0]], n: [[0, -1, 0], dn[i], dn[j]] });
    }
  }
}

/** A prism of `n` sides from a to b (radius r0 at a, r1 at b), open ended. */
function prism(tris: Tri[], n: number, a: V, b: V, r0: number, r1: number, snowTop: number): void {
  const d: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(...d);
  const u: V = [d[0] / l, d[1] / l, d[2] / l];
  // two axes across the prism
  const ref: V = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1: V = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const n1 = Math.hypot(...e1);
  e1 = [e1[0] / n1, e1[1] / n1, e1[2] / n1];
  const e2: V = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const ring = (c: V, r: number) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [c[0] + e1[0] * cs + e2[0] * sn, c[1] + e1[1] * cs + e2[1] * sn, c[2] + e1[2] * cs + e2[2] * sn] as V;
  });
  const A = ring(a, r0), B = ring(b, r1), N = ring([0, 0, 0], 1);
  // snow on the upper side of a leaning branch only
  const cOf = (p: V, c: V): V => [Math.max(0, (p[1] - c[1]) / Math.max(r0, r1, 1e-3)) * snowTop, 0.9, 1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push({ p: [A[i], A[j], B[j]], c: [cOf(A[i], a), cOf(A[j], a), cOf(B[j], b)], n: [N[i], N[j], N[j]] });
    tris.push({ p: [A[i], B[j], B[i]], c: [cOf(A[i], a), cOf(B[j], b), cOf(B[i], b)], n: [N[i], N[j], N[i]] });
  }
}

/** Near conifer, 44 triangles: a short trunk and four star skirts, undersides on the two lowest (seen from a skier). */
export function coniferNear(): BufferGeometry {
  const t: Tri[] = [];
  prism(t, 4, [0, 0, 0], [0, 1.2, 0], 0.16, 0.12, 0);
  const tiers: [number, number, number][] = [[0.55, 2.2, 1.05], [1.3, 2.9, 0.86], [2.05, 3.6, 0.64], [2.8, 4.4, 0.42]];
  tiers.forEach(([rimY, apexY, r], k) => skirt(t, 6, rimY, apexY, r, k * 1.1, k === 3 ? 1 : 0.85, k < 2));
  return build(t);
}

/** Far conifer, 6 triangles: one star skirt without a base (never seen from below that far). */
export function coniferFar(): BufferGeometry {
  const t: Tri[] = [];
  skirt(t, 6, 0.6, 4.45, 0.98, 0, 0.9, false);
  return build(t);
}

/** Near bare tree, 46 triangles: trunk and six limbs, snow along their tops. */
export function bareNear(): BufferGeometry {
  const t: Tri[] = [];
  prism(t, 5, [0, 0, 0], [0, 3.6, 0], 0.17, 0.07, 0);
  const limbs: [number, number, number, number][] = [ // height on the trunk, direction, reach, rise
    [1.5, 0.3, 1.3, 1.5], [1.9, 2.4, 1.2, 1.6], [2.3, 4.3, 1.1, 1.5], [2.7, 1.3, 0.9, 1.3], [3.0, 3.4, 0.8, 1.2], [3.2, 5.4, 0.7, 1.1],
  ];
  for (const [y, a, reach, rise] of limbs) prism(t, 3, [0, y, 0], [Math.cos(a) * reach, y + rise, Math.sin(a) * reach], 0.07, 0.025, 0.7);
  return build(t);
}

/** Far bare tree, 5 triangles: the haze of twigs as one pale cone. */
export function bareFar(): BufferGeometry {
  const t: Tri[] = [];
  const n = 5, rim: V[] = [], rn: V[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    rim.push([Math.cos(a) * 0.9, 1.2, Math.sin(a) * 0.9]);
    rn.push(unit([Math.cos(a), 0.4, Math.sin(a)]));
  }
  // pale: the sky and the snow seen through the twigs
  for (let i = 0; i < n; i++) t.push({ p: [[0, 4.4, 0], rim[(i + 1) % n], rim[i]], c: [[0.8, 1, 0.3], [0.3, 1, 0.3], [0.3, 1, 0.3]], n: [[0, 1, 0], rn[(i + 1) % n], rn[i]] });
  return build(t);
}

/** Shared by every tree material: the wind's clock (s), advanced by MountainView. */
export const TREE_WIND = { value: 0 };

/** `snow`: how much of the snow mask is white (instances vary around it); bare trees hold less. */
export function treeMaterial(snow: number): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const uniforms = {
    uTreeTime: TREE_WIND,
    uTreeSnow: { value: snow },
    uBark: { value: new Color(0x4a3b30) },
    uSnowCol: { value: new Color(0xf2f5f9) },
  };
  mat.onBeforeCompile = (sh) => {
    addHeightFog(sh);
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;\nuniform float uTreeSnow;\nuniform vec3 uBark;\nvarying float vTreeSnow;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      // wind: a slow sway growing with the square of the height, out of phase from tree to tree
      float sway = pow(max(position.y, 0.0) / 4.4, 2.0);
      transformed.x += sin(uTreeTime * 1.1 + treeAt.x * 0.045 + treeAt.z * 0.02) * 0.035 * sway;
      transformed.z += sin(uTreeTime * 0.83 + treeAt.z * 0.05) * 0.025 * sway;`)
      .replace('#include <color_vertex>', ` // (before begin_vertex: treeAt serves both)
      #ifdef USE_INSTANCING
        vec3 treeAt = instanceMatrix[3].xyz;
      #else
        vec3 treeAt = vec3(0.0);
      #endif
      vColor = vec4(1.0);
      #ifdef USE_INSTANCING_COLOR
        vec3 tint = instanceColor.rgb;
      #else
        vec3 tint = vec3(0.06, 0.12, 0.06);
      #endif
      float treeHash = fract(sin(dot(floor(treeAt.xz), vec2(12.9898, 78.233))) * 43758.5453);
      vTreeSnow = color.r * (uTreeSnow + (treeHash - 0.5) * 0.4);
      vColor.rgb = mix(tint, uBark, color.b) * color.g;`);
    // the snow cut per pixel: a crisp white cap on each tier (cut per vertex, it was a grey gradient)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSnowCol;\nvarying float vTreeSnow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, smoothstep(0.34, 0.46, vTreeSnow));');
  };
  mat.customProgramCacheKey = () => 'tree';
  return mat;
}
