import {
  BoxGeometry, BufferAttribute, CylinderGeometry, Euler, LatheGeometry, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry,
  TorusGeometry, Vector2, Vector3, type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHeightFog } from './heightFog';
import { B, FOREARM, POLE, S, SHIN, THIGH, UPPER_ARM } from './skierMesh';

/**
 * The player's skier, built in code on the same 20-bone skeleton as the crowd's (skierMesh.ts), so the pose solver,
 * the anchors and the feel are untouched (DECISIONS.md, point 106). Smooth turned silhouettes instead of capsules:
 * hips and a fitted jacket with hem, pockets, zip, high collar and rolled hood; sleeves with elbows and cuffs; gloves
 * with gauntlet, palm, curled fingers and thumb; pants with knees and boot gaiters; four-buckle boots with power strap;
 * helmet with its brim, goggles with frame and strap, a balaclava; quilted jacket and sleeves; waisted rockered skis with
 * bindings; tapered poles with grips, straps and baskets. PBR: roughness and metalness per vertex (see heroMaterial).
 * `detail`: segments around each part (low 10, medium 14, high 20): ≤ 10 k triangles on low, ≤ 30 k on high.
 */

type Tier = 'low' | 'medium' | 'high';
interface Part { g: BufferGeometry; bone: number; slot: number }

/** Roughness and metalness of each colour slot (fabric matte, shells glossy, buckles and shafts metal). */
const PBR: Record<number, [number, number]> = {
  [S.jacket]: [0.72, 0], [S.pants]: [0.86, 0], [S.helmet]: [0.28, 0], [S.skis]: [0.32, 0], [S.jacketDark]: [0.8, 0],
  [S.pantsDark]: [0.9, 0], [S.glove]: [0.62, 0], [S.boot]: [0.3, 0], [S.buckle]: [0.32, 0.85], [S.skin]: [0.55, 0],
  [S.metal]: [0.35, 0.9], [S.base]: [0.55, 0], [S.binding]: [0.4, 0.3], [S.strap]: [0.82, 0], [S.lensTop]: [0.1, 0.6], [S.lensBottom]: [0.1, 0.6],
};

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const sc = new Vector3();

export function buildHeroGeometry(tier: Tier): { geometry: BufferGeometry; slots: Uint8Array } {
  const n = { low: 10, medium: 14, high: 20 }[tier];
  const body: Part[] = [];
  const lens: Part[] = [];
  const put = (list: Part[], g: BufferGeometry, bone: number, slot: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    g.applyMatrix4(m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz)));
    list.push({ g: g.index ? g.toNonIndexed() : g, bone, slot });
  };
  const add = (g: BufferGeometry, bone: number, slot: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
    put(body, g, bone, slot, x, y, z, sx, sy, sz, rx, ry, rz);
  /** A turned shape around +y from a profile of [radius, height] points (closed when it starts and ends at r 0). */
  const lathe = (pts: [number, number][], seg = n) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg);
  /**
   * A down jacket's quilting: the profile cut into rows every ~1.7 cm, its radius swelling between seams `pitch` apart
   * (horizontal baffles; ±1.6 % of the radius). The ends (radius 0) stay closed.
   */
  const quilt = (pts: [number, number][], pitch: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [r0, y0] = pts[k], [r1, y1] = pts[k + 1], rows = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.017));
      for (let i = 0; i < rows; i++) {
        const t = i / rows, r = r0 + (r1 - r0) * t, y = y0 + (y1 - y0) * t;
        out.push([r > 0.02 ? r * (0.984 + 0.032 * Math.sin((Math.PI * y) / pitch) ** 2) : r, y]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const sphere = (r: number, w = n, h = Math.max(6, Math.round(n * 0.7))) => new SphereGeometry(r, w, h);
  const cyl = (rTop: number, rBot: number, h: number, seg = n, open = false, t0 = 0, tl = Math.PI * 2) => new CylinderGeometry(rTop, rBot, h, seg, 1, open, t0, tl);
  const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);

  // ── pelvis: seat and hips in the pants, a little flatter front to back
  add(lathe([[0, -0.11], [0.09, -0.1], [0.15, -0.06], [0.172, 0.0], [0.168, 0.06], [0.152, 0.11], [0, 0.12]]), B.pelvis, S.pants, 0, 0.01, -0.012, 1, 1, 0.82);
  // ── abdomen: the jacket's lower body, its hem a little flared, two hand pockets with zips
  add(lathe(quilt([[0, -0.06], [0.178, -0.06], [0.184, -0.03], [0.168, 0.04], [0.162, 0.12], [0.17, 0.22], [0, 0.23]], 0.075)), B.spine, S.jacket, 0, 0, 0, 1.06, 1, 0.8);
  add(cyl(0.186, 0.19, 0.035, n, true), B.spine, S.jacketDark, 0, -0.045, 0, 1.06, 1, 0.81);
  for (const x of [-1, 1]) add(box(0.012, 0.11, 0.008), B.spine, S.jacketDark, x * 0.12, 0.06, 0.128, 1, 1, 1, 0.1, 0, x * 0.35);
  // ── chest: a fitted puffy jacket, shoulders, the zip, a chest pocket, the high collar and the rolled hood
  add(lathe(quilt([[0, -0.03], [0.17, -0.03], [0.2, 0.04], [0.214, 0.12], [0.206, 0.2], [0.17, 0.26], [0.1, 0.29], [0, 0.29]], 0.075)), B.chest, S.jacket, 0, 0, 0.004, 1.06, 1, 0.74);
  for (const x of [-1, 1]) add(sphere(0.085), B.chest, S.jacket, x * 0.168, 0.196, -0.008, 1, 0.92, 1);
  add(box(0.014, 0.27, 0.01), B.chest, S.jacketDark, 0, 0.12, 0.158, 1, 1, 1, -0.16);
  add(box(0.09, 0.008, 0.008), B.chest, S.buckle, 0.085, 0.17, 0.15, 1, 1, 1, -0.2, 0, -0.08);
  add(lathe([[0.09, 0], [0.094, 0.05], [0.088, 0.1], [0.082, 0.11]], n), B.chest, S.jacketDark, 0, 0.255, -0.008);
  add(new TorusGeometry(0.085, 0.03, 6, n, Math.PI * 1.1), B.chest, S.jacketDark, 0, 0.31, -0.04, 1, 1, 0.9, Math.PI / 2 + 0.25, 0, Math.PI * -0.05);
  // ── head: neck gaiter up to the nose, a hint of face, helmet with brim and vents, goggles with frame and strap
  add(lathe([[0.054, -0.01], [0.058, 0.05], [0.07, 0.1], [0.082, 0.13], [0.07, 0.15], [0, 0.152]]), B.head, S.strap, 0, 0, 0.012, 1, 1, 1.05);
  add(sphere(0.09), B.head, S.strap, 0, 0.13, 0.01, 0.96, 1.1, 1); // a balaclava under the helmet: no bare face to look odd
  // (profiles run upwards: listed downwards, the faces turned inside and the shell showed its inside, dark and patchy)
  add(lathe([[0.122, 0.108], [0.134, 0.118], [0.138, 0.156], [0.13, 0.198], [0.106, 0.234], [0.065, 0.256], [0, 0.262]]), B.head, S.helmet, 0, 0, -0.014, 1, 1, 1.1);
  add(cyl(0.13, 0.134, 0.012, n, true, -0.42 * Math.PI, 0.84 * Math.PI), B.head, S.helmet, 0, 0.198, 0.012, 1, 1, 1.12); // brim over the goggles
  add(cyl(0.124, 0.124, 0.062, n, true, -0.34 * Math.PI, 0.68 * Math.PI), B.head, S.strap, 0, 0.152, 0.006, 1, 1, 1.06); // goggle frame
  add(cyl(0.134, 0.134, 0.034, n, true, 0.32 * Math.PI, 1.36 * Math.PI), B.head, S.strap, 0, 0.154, -0.012, 1, 1, 1.1); // strap round the helmet
  put(lens, cyl(0.127, 0.127, 0.052, n, true, -0.3 * Math.PI, 0.6 * Math.PI), B.head, S.lensTop, 0, 0.152, 0.008, 1, 1, 1.06);
  // ── arms: sleeves narrowing to the elbow and the cuff; gloves: gauntlet, palm, fingers curled round the grip, thumb
  for (const [up, fore, hand] of [[B.upperArmL, B.forearmL, B.handL], [B.upperArmR, B.forearmR, B.handR]]) {
    add(lathe(quilt([[0, -0.03], [0.06, -0.025], [0.068, 0.04], [0.064, 0.15], [0.058, UPPER_ARM - 0.02], [0, UPPER_ARM + 0.02]], 0.065)), up, S.jacket);
    add(sphere(0.056), fore, S.jacket, 0, 0.0, -0.004);
    add(lathe([[0.056, 0], [0.057, 0.08], [0.052, FOREARM - 0.06], [0.05, FOREARM - 0.03], [0, FOREARM - 0.02]]), fore, S.jacket);
    add(cyl(0.061, 0.058, 0.045, n, true), fore, S.jacketDark, 0, FOREARM - 0.035, 0);
    add(lathe([[0.058, -0.03], [0.054, 0.02], [0.046, 0.04], [0, 0.045]]), hand, S.glove, 0, 0, 0);
    add(sphere(0.042), hand, S.glove, 0, 0.06, 0.006, 1.1, 0.95, 0.9);
    add(new TorusGeometry(0.03, 0.021, 6, Math.max(6, n - 4), Math.PI * 1.2), hand, S.glove, 0, 0.075, 0.012, 1.15, 1, 1, 0, Math.PI / 2, -0.3);
    add(cyl(0.015, 0.018, 0.06, Math.max(6, n - 4)), hand, S.glove, 0.03, 0.058, 0.03, 1, 1, 1, 0.5, 0, -0.6);
  }
  // ── poles: shaped grip with its strap loop, tapered shaft, basket and tip (bone origin = fist, +y toward the tip)
  for (const pole of [B.poleL, B.poleR]) {
    add(lathe([[0.016, -0.09], [0.021, -0.08], [0.02, -0.02], [0.022, 0.05], [0.018, 0.08], [0.01, 0.09]], Math.max(6, n - 4)), pole, S.base);
    add(new TorusGeometry(0.035, 0.005, 4, Math.max(6, n - 4)), pole, S.strap, 0, -0.07, 0.02, 1, 1.6, 1, 0, Math.PI / 2, 0);
    add(cyl(0.0058, 0.0085, POLE - 0.1, Math.max(5, Math.round(n / 2))), pole, S.metal, 0, 0.09 + (POLE - 0.1) / 2, 0);
    add(cyl(0.044, 0.04, 0.012, Math.max(8, n - 2)), pole, S.base, 0, POLE - 0.075, 0);
    add(cyl(0.002, 0.007, 0.05, 5), pole, S.metal, 0, POLE - 0.03, 0);
  }
  // ── legs: thighs, knees, shins in the pants, gaiters over the boots; boots: upper cuff, four buckles, power strap
  for (const [thigh, shin, foot] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]]) {
    add(lathe([[0, -0.04], [0.088, -0.03], [0.098, 0.06], [0.092, 0.2], [0.08, THIGH - 0.06], [0.074, THIGH - 0.01], [0, THIGH + 0.02]]), thigh, S.pants, 0, 0, 0.004, 1, 1, 1.06);
    add(sphere(0.074), shin, S.pants, 0, 0.0, 0.016, 1, 1, 1.08);
    add(lathe([[0.076, 0], [0.078, 0.08], [0.072, 0.16], [0.07, 0.22], [0.088, 0.25], [0.094, 0.29], [0.086, 0.3]]), shin, S.pants, 0, 0, 0.004);
    add(cyl(0.095, 0.09, 0.03, n, true), shin, S.pantsDark, 0, 0.285, 0.004);
    add(lathe([[0.072, 0.27], [0.08, 0.3], [0.078, SHIN - 0.02], [0.084, SHIN + 0.01], [0.07, SHIN + 0.02]]), shin, S.boot, 0, 0, 0.006);
    add(box(0.13, 0.03, 0.03), shin, S.strap, 0, 0.3, 0.07);
    for (const y of [0.32, 0.375]) add(box(0.05, 0.014, 0.012), shin, S.buckle, 0.03, y, 0.085, 1, 1, 1, 0, -0.5);
    // lower shell along the ski (foot bone: origin = ankle, +z along the ski), the toe buckles, the sole
    add(lathe([[0, -0.15], [0.05, -0.13], [0.064, -0.06], [0.068, 0.04], [0.062, 0.14], [0.04, 0.2], [0, 0.205]]), foot, S.boot, 0, -0.04, 0.02, 1.0, 1, 0.8, Math.PI / 2);
    add(sphere(0.068), foot, S.boot, 0, -0.012, -0.04, 1, 1, 1.05);
    for (const z of [0.05, 0.12]) add(box(0.12, 0.012, 0.022), foot, S.buckle, 0, -0.004 + (0.12 - z) * 0.2, z, 1, 1, 1, -0.35);
    add(box(0.11, 0.024, 0.33), foot, S.base, 0, -0.078, 0.03);
  }
  // ── skis: waisted, rockered tip, small tail; top sheet, binding plate, toe and heel pieces with brakes
  for (const ski of [B.skiL, B.skiR]) {
    add(heroSki(tier), ski, S.skis);
    add(box(0.072, 0.012, 0.46), ski, S.base, 0, 0.024, 0.0);
    add(lathe([[0, 0], [0.042, 0.004], [0.036, 0.03], [0.02, 0.05], [0, 0.052]], 8), ski, S.binding, 0, 0.028, 0.19, 1, 1, 1.4);
    add(box(0.074, 0.046, 0.11), ski, S.binding, 0, 0.04, -0.17);
    for (const x of [-1, 1]) add(box(0.008, 0.008, 0.08), ski, S.metal, x * 0.045, 0.03, -0.1, 1, 1, 1, 0.5);
  }

  const list = [...body, ...lens];
  const geos = [mergeGeometries(body.map((x) => x.g)), mergeGeometries(lens.map((x) => x.g))];
  const geometry = mergeGeometries(geos, true); // each part keeps its own smooth normals
  const nv = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), slots = new Uint8Array(nv), pbr = new Float32Array(nv * 2);
  const ny = geometry.getAttribute('normal'), py = geometry.getAttribute('position');
  let v = 0;
  for (const part of list) {
    const c = part.g.getAttribute('position').count;
    for (let i = 0; i < c; i++, v++) {
      skinIndex[v * 4] = part.bone;
      skinWeight[v * 4] = 1;
      let slot = part.slot;
      if (slot === S.skis && ny.getY(v) < 0.5) slot = S.base; // edges and base
      if (slot === S.lensTop && py.getY(v) < 0.152) slot = S.lensBottom; // mirrored gradient
      slots[v] = slot;
      pbr[v * 2] = PBR[slot][0];
      pbr[v * 2 + 1] = PBR[slot][1];
    }
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(nv * 3), 3));
  geometry.setAttribute('pbr', new BufferAttribute(pbr, 2));
  for (const part of list) part.g.dispose();
  for (const g of geos) g.dispose();
  return { geometry, slots };
}

/** 1.70 m ski (origin = base under the boot): sidecut, rocker over the last 30 cm of the tip, small tail rise. */
function heroSki(tier: Tier): BufferGeometry {
  const g = new BoxGeometry(0.086, 0.016, 1.7, 2, 1, { low: 24, medium: 32, high: 44 }[tier]);
  g.translate(0, 0.008, 0.1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const tip = Math.max(0, (z - 0.65) / 0.3);
    const tail = Math.max(0, (-0.55 - z) / 0.2);
    const waist = 1 - 0.15 * Math.max(0, 1 - Math.abs(z - 0.05) / 0.8);
    const round = tip > 0.85 ? Math.sqrt(Math.max(0, 1 - ((tip - 0.85) / 0.15) ** 2)) : 1; // a rounded shovel
    pos.setX(i, pos.getX(i) * waist * (1 - 0.25 * tip * tip) * (0.35 + 0.65 * round));
    pos.setY(i, pos.getY(i) * (1 - 0.4 * tip) + 0.1 * tip * tip + 0.035 * tail * tail);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** The hero's material: standard (PBR), roughness and metalness read per vertex from the `pbr` attribute. */
export function heroMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    addHeightFog(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  mat.customProgramCacheKey = () => 'hero-pbr';
  return mat;
}
