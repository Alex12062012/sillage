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
 * hips and a loose park jacket (long hem over the seat, contrast band, pockets, zip, collar, hood down); roomy sleeves
 * with cuffs; gloves with gauntlet, palm, curled fingers and thumb; baggy pants falling over four-buckle boots; helmet
 * with its brim, goggles with frame and strap, a balaclava; waisted twin-tip skis with
 * bindings; tapered poles with grips, straps and baskets. PBR: roughness and metalness per vertex (see heroMaterial).
 * `detail`: segments around each part (low 10, medium 14, high 20): ≤ 10 k triangles on low, ≤ 30 k on high.
 */

type Tier = 'low' | 'medium' | 'high';
interface Part { g: BufferGeometry; bone: number; slot: number }

/** Roughness and metalness of each colour slot (fabric matte, shells glossy, buckles and shafts metal). */
const PBR: Record<number, [number, number]> = {
  [S.jacket]: [0.72, 0], [S.pants]: [0.86, 0], [S.helmet]: [0.6, 0], [S.skis]: [0.32, 0], [S.jacketDark]: [0.8, 0],
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
  const sphere = (r: number, w = n, h = Math.max(6, Math.round(n * 0.7))) => new SphereGeometry(r, w, h);
  const cyl = (rTop: number, rBot: number, h: number, seg = n, open = false, t0 = 0, tl = Math.PI * 2) => new CylinderGeometry(rTop, rBot, h, seg, 1, open, t0, tl);
  const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);

  // ── pelvis: seat and hips in the pants, a little flatter front to back
  add(lathe([[0, -0.11], [0.09, -0.1], [0.15, -0.06], [0.172, 0.0], [0.168, 0.06], [0.152, 0.11], [0, 0.12]]), B.pelvis, S.pants, 0, 0.01, -0.012, 1, 1, 0.82);
  // ── abdomen: a boxy park jacket down to the hips, straight sides, dark hem trim with its drawcord toggles, the zip
  add(lathe([[0, -0.1], [0.208, -0.1], [0.21, -0.06], [0.205, 0.02], [0.2, 0.12], [0.205, 0.22], [0, 0.23]]), B.spine, S.jacket, 0, 0, 0, 1.08, 1, 0.84);
  add(cyl(0.21, 0.211, 0.026, n, true), B.spine, S.jacketDark, 0, -0.088, 0, 1.08, 1, 0.85);
  for (const x of [-1, 1]) add(cyl(0.007, 0.009, 0.03, 6), B.spine, S.strap, x * 0.1, -0.118, -0.17);
  add(box(0.012, 0.3, 0.008), B.spine, S.jacketDark, 0.03, 0.05, 0.178); // the zip, a little off centre, down to the hem
  // ── chest: a fitted puffy jacket, shoulders, the zip, a chest pocket, the high collar and the rolled hood
  add(lathe([[0, -0.03], [0.19, -0.03], [0.218, 0.04], [0.23, 0.12], [0.222, 0.2], [0.18, 0.26], [0.1, 0.29], [0, 0.29]]), B.chest, S.jacket, 0, 0, 0.004, 1.06, 1, 0.76);
  for (const x of [-1, 1]) add(sphere(0.1), B.chest, S.jacket, x * 0.18, 0.19, -0.008, 1, 0.9, 1); // broad, boxy shoulders
  add(cyl(0.233, 0.225, 0.1, n, true), B.chest, S.pants, 0, 0.07, 0.004, 1.06, 1, 0.77); // contrast band, in the pants colour
  add(box(0.012, 0.3, 0.008), B.chest, S.jacketDark, 0.03, 0.12, 0.184, 1, 1, 1, -0.16); // over the band too
  // the collar: a high funnel zipped up to the chin, the zip carrying on up its front
  add(lathe([[0.105, 0], [0.108, 0.05], [0.104, 0.1], [0.098, 0.11], [0.09, 0.114]]), B.chest, S.jacket, 0, 0.24, -0.006, 1, 1, 0.95);
  add(box(0.01, 0.1, 0.008), B.chest, S.jacketDark, 0.03, 0.3, 0.098);
  add(sphere(0.11), B.chest, S.jacket, 0, 0.3, -0.11, 1.1, 1.1, 0.72, -0.25); // the hood, down but standing up behind the neck, to the helmet's rim
  // ── head: a modelled face under the goggles (jaw, chin, cheekbones, nose, the mouth's line), the neck gaiter rolled
  // down round the neck, the helmet with its vents and the goggle clip, wide goggles with frame and strap
  add(cyl(0.046, 0.05, 0.08, Math.max(8, n - 4), true), B.head, S.skin, 0, 0.03, 0.006); // the neck
  add(lathe([[0.058, -0.012], [0.066, 0.012], [0.07, 0.04], [0.066, 0.062], [0.058, 0.07]]), B.head, S.jacketDark, 0, 0, 0.004);
  add(face(Math.max(16, Math.round(n * 1.6)), Math.max(12, Math.round(n * 1.2))), B.head, S.skin, 0, 0.134, 0.012);
  add(box(0.028, 0.0035, 0.004), B.head, S.strap, 0, 0.083, 0.1, 1, 1, 1, 0.15); // the mouth's line
  add(lathe([[0.122, 0.108], [0.134, 0.118], [0.138, 0.156], [0.13, 0.198], [0.106, 0.234], [0.065, 0.256], [0, 0.262]]), B.head, S.helmet, 0, 0, -0.014, 1, 1, 1.1);
  add(cyl(0.13, 0.134, 0.012, n, true, -0.42 * Math.PI, 0.84 * Math.PI), B.head, S.helmet, 0, 0.198, 0.012, 1, 1, 1.12); // brim over the goggles
  for (const x of [-0.035, 0.035]) add(box(0.016, 0.006, 0.05), B.head, S.binding, x, 0.248, 0.05, 1, 1, 1, -0.5); // vents, grey not black
  add(box(0.04, 0.026, 0.012), B.head, S.binding, 0, 0.156, -0.164); // the goggle clip at the back
  add(cyl(0.125, 0.125, 0.07, n, true, -0.36 * Math.PI, 0.72 * Math.PI), B.head, S.strap, 0, 0.154, 0.006, 1, 1, 1.07); // goggle frame
  add(cyl(0.142, 0.142, 0.036, n, true, 0.33 * Math.PI, 1.34 * Math.PI), B.head, S.strap, 0, 0.156, -0.014, 1, 1, 1.1); // strap round the helmet, on the shell
  put(lens, cyl(0.128, 0.128, 0.06, n, true, -0.32 * Math.PI, 0.64 * Math.PI), B.head, S.lensTop, 0, 0.154, 0.008, 1, 1, 1.07);
  // ── arms: sleeves narrowing to the elbow and the cuff; gloves: gauntlet, palm, fingers curled round the grip, thumb
  for (const [up, fore, hand] of [[B.upperArmL, B.forearmL, B.handL], [B.upperArmR, B.forearmR, B.handR]]) {
    add(lathe([[0, -0.03], [0.074, -0.025], [0.084, 0.04], [0.08, 0.15], [0.072, UPPER_ARM - 0.02], [0, UPPER_ARM + 0.02]]), up, S.jacket);
    add(cyl(0.086, 0.083, 0.1, n, true), up, S.pants, 0, 0.13, 0); // the band carries on round the sleeve
    add(sphere(0.07), fore, S.jacket, 0, 0.0, -0.004);
    add(lathe([[0.07, 0], [0.07, 0.08], [0.066, FOREARM - 0.06], [0.064, FOREARM - 0.02], [0, FOREARM]]), fore, S.jacket);
    add(cyl(0.068, 0.066, 0.05, n, true), fore, S.jacketDark, 0, FOREARM - 0.02, 0); // wide cuff over the gauntlet
    add(lathe([[0.062, -0.04], [0.058, 0.02], [0.048, 0.04], [0, 0.045]]), hand, S.glove, 0, 0, 0);
    add(sphere(0.046), hand, S.glove, 0, 0.06, 0.006, 1.1, 0.95, 0.9); // chunky mitt
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
    add(lathe([[0, -0.04], [0.1, -0.03], [0.11, 0.06], [0.104, 0.2], [0.1, THIGH - 0.06], [0.096, THIGH - 0.01], [0, THIGH + 0.02]]), thigh, S.pants, 0, 0, 0.004, 1, 1, 1.06);
    add(lathe([[0, -0.07], [0.07, -0.06], [0.094, -0.03], [0.096, 0.02], [0.095, 0.1], [0.094, 0.22], [0.1, 0.3], [0.102, SHIN - 0.05], [0.098, SHIN - 0.03]]), shin, S.pants, 0, 0, 0.006); // baggy leg down onto the boot
    for (const y of [SHIN - 0.13, SHIN - 0.08]) add(new TorusGeometry(0.1, 0.011, 5, n), shin, S.pants, 0, y, 0.006, 1, 1, 1, Math.PI / 2); // the fabric stacking at the ankle
    add(cyl(0.1, 0.098, 0.018, n, true), shin, S.pantsDark, 0, SHIN - 0.035, 0.006);
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

/**
 * The face, about the head's centre (the forehead and eyes go under the helmet and goggles): a sphere of 9.2 cm made
 * longer and narrower, the jaw tapering to the chin, the chin a little forward, cheekbones, and the nose pulled out
 * under the goggles' frame.
 */
function face(w: number, h: number): BufferGeometry {
  const g = new SphereGeometry(0.092, w, h);
  const p = g.getAttribute('position');
  const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    y *= 1.16;
    x *= 0.9;
    const low = Math.max(0, Math.min(1, -y / 0.1)), front = Math.max(0, z / 0.092);
    x *= 1 - 0.28 * low; // the jaw narrows to the chin
    z *= 1 - 0.12 * low * (1 - front);
    z += front * (0.012 * low * low + 0.006 * bump(Math.abs(x), y, 0.042, 0.0, 0.02, 0.018)); // chin, cheekbones
    z += front * 0.024 * bump(x, y, 0, -0.026, 0.011, 0.02) * (1 + 0.4 * Math.max(0, (-0.026 - y) / 0.02)); // the nose
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** 1.70 m twin-tip (origin = base under the boot): sidecut, rocker over the last 30 cm of the tip, the tail turned up too. */
function heroSki(tier: Tier): BufferGeometry {
  const g = new BoxGeometry(0.086, 0.016, 1.7, 2, 1, { low: 24, medium: 32, high: 44 }[tier]);
  g.translate(0, 0.008, 0.1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const tip = Math.max(0, (z - 0.65) / 0.3);
    const tail = Math.max(0, (-0.5 - z) / 0.25);
    const waist = 1 - 0.15 * Math.max(0, 1 - Math.abs(z - 0.05) / 0.8);
    const round = tip > 0.85 ? Math.sqrt(Math.max(0, 1 - ((tip - 0.85) / 0.15) ** 2)) : 1; // a rounded shovel
    pos.setX(i, pos.getX(i) * waist * (1 - 0.25 * tip * tip) * (0.35 + 0.65 * round));
    pos.setY(i, pos.getY(i) * (1 - 0.4 * tip) + 0.1 * tip * tip + 0.075 * tail * tail);
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
