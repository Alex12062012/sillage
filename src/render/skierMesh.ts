import {
  BoxGeometry, BufferAttribute, CapsuleGeometry, CylinderGeometry, Euler, Matrix4, Quaternion, SphereGeometry, Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Bone ids. Limb bones: origin at the proximal joint, +y toward the next joint, +z = front. Body bones: +y up the spine. */
export const B = {
  pelvis: 0, spine: 1, chest: 2, head: 3,
  upperArmL: 4, upperArmR: 5, forearmL: 6, forearmR: 7, handL: 8, handR: 9, poleL: 10, poleR: 11,
  thighL: 12, thighR: 13, shinL: 14, shinR: 15, footL: 16, footR: 17, skiL: 18, skiR: 19,
} as const;
export const BONES = 20;

/** Colour slots: the four outfit colours, shades derived from them, then fixed neutrals. */
export const S = {
  jacket: 0, pants: 1, helmet: 2, skis: 3, jacketDark: 4, pantsDark: 5,
  glove: 6, boot: 7, buckle: 8, skin: 9, metal: 10, base: 11, binding: 12, strap: 13, lensTop: 14, lensBottom: 15,
} as const;
export const SLOTS = 16;

// Segment lengths (m) of a ~1.78 m athlete; the skeleton solver uses the same numbers.
export const THIGH = 0.44;
export const SHIN = 0.43;
export const ANKLE = 0.13; // ankle above the ski base (ski + plate + boot sole)
export const HIP_W = 0.095; // hip joint half-spacing
export const UPPER_ARM = 0.29;
export const FOREARM = 0.26;
export const GRIP = 0.07; // wrist → fist centre
export const POLE = 1.12; // fist → tip
export const SPINE_LOW = 0.08; // pelvis → abdomen bone
export const SPINE_MID = 0.2; // abdomen → chest bone
export const NECK = 0.26; // chest bone → head bone
export const SHOULDER = new Vector3(0.17, 0.2, -0.01); // shoulder joint in the chest frame (left; mirror x)

interface Part { g: BufferGeometry; bone: number; slot: number }
const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p = new Vector3();
const sc = new Vector3();

/**
 * One skinned mesh for the whole skier and gear: smooth primitives placed in each bone's frame, rigidly weighted
 * (bind pose = identity, so a vertex ends up at boneMatrix × its authored position). Returns the geometry
 * (group 0: Lambert body, group 1: the goggle lens) and the colour slot of every vertex, for cheap recolouring.
 */
export function buildSkierGeometry(): { geometry: BufferGeometry; slots: Uint8Array } {
  const body: Part[] = [];
  const lens: Part[] = [];
  const put = (list: Part[], g: BufferGeometry, bone: number, slot: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    g.deleteAttribute('uv');
    g.applyMatrix4(m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz)));
    list.push({ g, bone, slot });
  };
  const add = (g: BufferGeometry, bone: number, slot: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
    put(body, g, bone, slot, x, y, z, sx, sy, sz, rx, ry, rz);
  const sphere = (r: number, w = 12, h = 8) => new SphereGeometry(r, w, h);
  const capsule = (r: number, len: number, radial = 10) => new CapsuleGeometry(r, len, 3, radial);
  const cyl = (rTop: number, rBot: number, h: number, radial = 10, open = false, t0 = 0, tl = Math.PI * 2) =>
    new CylinderGeometry(rTop, rBot, h, radial, 1, open, t0, tl);

  // pelvis: seat and hips in the pants
  add(sphere(1, 14, 10), B.pelvis, S.pants, 0, 0.02, -0.015, 0.175, 0.13, 0.14);
  // abdomen + flared jacket hem
  add(capsule(0.15, 0.1, 12), B.spine, S.jacket, 0, 0.1, 0, 1.12, 1, 0.82);
  add(cyl(0.17, 0.185, 0.07, 14), B.spine, S.jacketDark, 0, -0.03, -0.005, 1, 1, 0.84);
  // chest: broad puffy jacket, shoulders, zip, collar
  add(sphere(1, 16, 10), B.chest, S.jacket, 0, 0.1, 0.005, 0.215, 0.2, 0.152);
  add(sphere(0.07, 10, 7), B.chest, S.jacket, 0, 0.06, 0.08, 1.8, 1, 0.85);
  for (const x of [-1, 1]) add(sphere(0.088, 12, 8), B.chest, S.jacket, x * 0.165, 0.195, -0.01);
  add(new BoxGeometry(0.014, 0.24, 0.012), B.chest, S.jacketDark, 0, 0.1, 0.152, 1, 1, 1, -0.12);
  add(cyl(0.078, 0.088, 0.1, 12), B.chest, S.jacketDark, 0, 0.27, -0.01);
  // head: neck gaiter, face, helmet shell, goggles (frame, strap, mirrored lens)
  add(cyl(0.052, 0.058, 0.1, 10), B.head, S.strap, 0, 0.03, 0);
  add(sphere(0.094, 12, 9), B.head, S.skin, 0, 0.13, 0.018, 1, 1.12, 1);
  add(new SphereGeometry(0.125, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.6), B.head, S.helmet, 0, 0.142, -0.008, 1, 1.02, 1.08);
  add(cyl(0.12, 0.12, 0.064, 14, true, -0.32 * Math.PI, 0.64 * Math.PI), B.head, S.strap, 0, 0.138, 0.004, 1, 1, 1.02);
  add(cyl(0.136, 0.136, 0.03, 14, true, 0.3 * Math.PI, 1.4 * Math.PI), B.head, S.strap, 0, 0.14, -0.008, 1, 1, 1.07);
  const lensG = cyl(0.126, 0.126, 0.05, 12, true, -0.28 * Math.PI, 0.56 * Math.PI);
  put(lens, lensG, B.head, S.lensTop, 0, 0.138, 0.006, 1, 1, 1.02);
  // arms: bulky sleeves, cuffs, gloves with gauntlets
  for (const [up, fore, hand] of [[B.upperArmL, B.forearmL, B.handL], [B.upperArmR, B.forearmR, B.handR]]) {
    add(capsule(0.062, 0.2), up, S.jacket, 0, 0.145, 0);
    add(capsule(0.054, 0.17), fore, S.jacket, 0, 0.12, 0);
    add(cyl(0.06, 0.06, 0.05, 10), fore, S.jacketDark, 0, 0.225, 0);
    add(cyl(0.05, 0.056, 0.07, 10), hand, S.glove, 0, 0.01, 0);
    add(sphere(0.05, 10, 7), hand, S.glove, 0, 0.068, 0.004, 0.95, 1.15, 1.05);
  }
  // poles: grip, shaft, basket (bone origin = fist, +y toward the tip)
  for (const pole of [B.poleL, B.poleR]) {
    add(cyl(0.017, 0.021, 0.16, 8), pole, S.base, 0, -0.01, 0);
    add(cyl(0.006, 0.0085, POLE - 0.07, 5), pole, S.metal, 0, 0.07 + (POLE - 0.07) / 2, 0);
    add(cyl(0.042, 0.042, 0.01, 8), pole, S.base, 0, POLE - 0.07, 0);
  }
  // legs: slightly baggy pants, knee, cuff over the boot, boot cuff with buckles (the cuff hinges with the shin)
  for (const [thigh, shin, foot] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]]) {
    add(capsule(0.09, 0.27, 12), thigh, S.pants, 0, THIGH / 2, 0.005, 1, 1, 1.05);
    add(sphere(0.078, 10, 7), shin, S.pants, 0, 0.0, 0.012);
    add(cyl(0.084, 0.072, 0.24, 12), shin, S.pants, 0, 0.12, 0.004);
    add(cyl(0.094, 0.088, 0.075, 12), shin, S.pantsDark, 0, 0.255, 0.004);
    add(cyl(0.077, 0.072, 0.17, 12), shin, S.boot, 0, 0.335, 0.004);
    for (const y of [0.31, 0.37]) add(cyl(0.08, 0.079, 0.016, 12), shin, S.buckle, 0, y, 0.004);
    // lower shell along the ski (foot bone: origin = ankle, +z along the ski)
    add(capsule(0.058, 0.2, 10), foot, S.boot, 0, -0.03, 0.035, 1.08, 1, 1, Math.PI / 2);
    add(sphere(0.07, 10, 7), foot, S.boot, 0, -0.012, -0.035);
    add(new BoxGeometry(0.112, 0.022, 0.32), foot, S.base, 0, -0.077, 0.035);
    add(new BoxGeometry(0.128, 0.016, 0.03), foot, S.buckle, 0, -0.0, 0.11, 1, 1, 1, -0.3);
  }
  // skis: waisted, tip and tail rise, coloured top sheet over a dark base; binding plate, toe and heel pieces
  for (const ski of [B.skiL, B.skiR]) {
    add(skiGeometry(), ski, S.skis);
    add(new BoxGeometry(0.074, 0.012, 0.44), ski, S.base, 0, 0.022, 0.0);
    add(new BoxGeometry(0.07, 0.034, 0.08), ski, S.binding, 0, 0.034, 0.19);
    add(new BoxGeometry(0.072, 0.042, 0.1), ski, S.binding, 0, 0.036, -0.17);
  }

  const list = [...body, ...lens];
  const geos = [mergeGeometries(body.map((x) => x.g)), mergeGeometries(lens.map((x) => x.g))];
  const geometry = mergeGeometries(geos, true);
  const n = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const slots = new Uint8Array(n);
  const ny = geometry.getAttribute('normal');
  const py = geometry.getAttribute('position');
  let v = 0;
  for (const part of list) {
    const c = part.g.getAttribute('position').count;
    for (let i = 0; i < c; i++, v++) {
      skinIndex[v * 4] = part.bone;
      skinWeight[v * 4] = 1;
      let slot = part.slot;
      if (slot === S.skis && ny.getY(v) < 0.5) slot = S.base; // edges and base
      if (slot === S.lensTop && py.getY(v) < 0.138) slot = S.lensBottom; // mirrored gradient
      slots[v] = slot;
    }
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3));
  for (const part of list) part.g.dispose();
  for (const g of geos) g.dispose();
  return { geometry, slots };
}

/** 1.70 m ski around the binding (origin = base under the boot): sidecut waist, rounded tip rise, small tail rise. */
function skiGeometry(): BufferGeometry {
  const g = new BoxGeometry(0.086, 0.016, 1.7, 1, 1, 20);
  g.translate(0, 0.008, 0.1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const tip = Math.max(0, (z - 0.68) / 0.27);
    const tail = Math.max(0, (-0.55 - z) / 0.2);
    const waist = 1 - 0.14 * Math.max(0, 1 - Math.abs(z - 0.05) / 0.8);
    pos.setX(i, pos.getX(i) * waist * (1 - 0.35 * tip * tip));
    pos.setY(i, pos.getY(i) + 0.09 * tip * tip + 0.035 * tail * tail);
  }
  g.computeVertexNormals();
  return g;
}
