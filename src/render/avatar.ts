import {
  AnimationMixer, Bone, BufferAttribute, CanvasTexture, Color, DetachedBindMode, LinearFilter, LinearMipmapLinearFilter, Matrix4,
  MeshStandardMaterial, NoColorSpace, Skeleton, SkinnedMesh, SRGBColorSpace, Vector3, type BufferGeometry, type Material, type Mesh,
  type Object3D, type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHeightFog } from './heightFog';
import { B, BONES, POLE, S } from './skierMesh';

/**
 * The player's realistic skier (DECISIONS.md, point 113): "Skiing Lady" by lancehuang526 (CC BY 4.0), prepared by
 * scripts/build-avatar.mjs, driven by our own skeleton. Every one of her Rigify bones follows the one of our 20 bones
 * it belongs to (her rest pose expressed in that bone's frame), so the pose solver (glide, carve, brake, tuck, jumps,
 * flips, crashes) and the feel are untouched; her proportions replace ours in the solver (see Proportions) so nothing
 * is stretched. Her fingers keep the grip of her own animation's first frame; her skis and poles are re-framed onto
 * our ski and pole bones. All in one skinned mesh and one material (a texture atlas for the jacket and the pants,
 * vertex colours for the rest): one draw call, plus the planar shadow.
 */

/** Segment lengths and offsets the pose solver uses (skierModel.ts): ours by default, hers once she is loaded. */
export interface Proportions {
  thigh: number; shin: number; ankle: number; hipW: number; upperArm: number; forearm: number; grip: number;
  spineLow: number; spineMid: number; neck: number; shoulder: Vector3;
}

const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);
const fx = new Vector3(), fy = new Vector3(), fz = new Vector3();
/** As skierModel's seg(): bone frame at a, +y toward b, +z as close to `hint` as possible. */
function seg(m: Matrix4, a: Vector3, b: Vector3, hint: Vector3): Matrix4 {
  fy.subVectors(b, a).normalize();
  fx.crossVectors(fy, hint);
  if (fx.lengthSq() < 1e-6) fx.crossVectors(fy, Math.abs(fy.x) < 0.9 ? X : Z);
  fx.normalize();
  fz.crossVectors(fx, fy);
  return m.makeBasis(fx, fy, fz).setPosition(a);
}

/** Which of our bones a Rigify bone (name without dots and index) follows, -1 if none by name. */
function ourBone(name: string): number {
  const side = /([LR])(\d{3})?$/.exec(name)?.[1] === 'R' ? 1 : 0;
  if (/^DEF-spine$|^DEF-pelvis/.test(name)) return B.pelvis;
  if (/^DEF-spine00[12]$/.test(name)) return B.spine;
  if (/^DEF-spine003$|^DEF-shoulder|^DEF-breast/.test(name)) return B.chest;
  if (/^DEF-upper_arm/.test(name)) return B.upperArmL + side;
  if (/^DEF-forearm/.test(name)) return B.forearmL + side;
  // the face's bones, by their names' start: unanchored, "ear" matched "forEARm" and the forearms followed the head
  if (/^DEF-spine00[456]$|^DEF-(jaw|eye|ear|lip|cheek|nose|brow|tongue|teeth|forehead|chin|temple|lid)/i.test(name)) return B.head;
  if (/^DEF-(hand|f_|thumb|palm)/.test(name)) return B.handL + side;
  if (/^DEF-thigh/.test(name)) return B.thighL + side;
  if (/^DEF-shin/.test(name)) return B.shinL + side;
  if (/^DEF-(foot|toe|heel)/.test(name)) return B.footL + side;
  return -1;
}

/**
 * Recolour slot of a part, from its material and how high it sits (255: it keeps its own colour). The loader names
 * meshes after their nodes, so the helmet's shell is the white part above the shoulders.
 */
function slotOf(mat: string, centreY: number): number {
  if (mat === 'jacket') return S.jacket;
  if (mat === 'pants') return S.pants;
  if (mat === 'coated_white' && centreY > 1.45) return S.helmet;
  if (/green/.test(mat)) return S.skis; // the accents of skis, poles and boots
  return 255;
}

export class Avatar {
  readonly mesh: SkinnedMesh;
  readonly shadow: SkinnedMesh;
  readonly tier: 'low' | 'high';
  private bones: Bone[];
  private follow: Int8Array;
  private offsets: Matrix4[];
  private base: Float32Array;
  private colors: BufferAttribute;

  constructor(tier: 'low' | 'high', readonly P: Proportions, geometry: BufferGeometry, material: Material, shadowMat: Material,
    bones: Bone[], inverses: Matrix4[], follow: Int8Array, offsets: Matrix4[], private slots: Uint8Array, private hands: HandRig[]) {
    this.tier = tier;
    this.bones = bones;
    this.follow = follow;
    this.offsets = offsets;
    this.colors = geometry.getAttribute('color') as BufferAttribute;
    this.base = (this.colors.array as Float32Array).slice();
    const skeleton = new Skeleton(bones, inverses);
    this.mesh = new SkinnedMesh(geometry, material);
    this.mesh.add(...bones);
    this.mesh.bind(skeleton, new Matrix4());
    this.mesh.frustumCulled = false;
    this.shadow = new SkinnedMesh(geometry, shadowMat);
    this.shadow.bindMode = DetachedBindMode;
    this.shadow.bind(skeleton, new Matrix4());
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 2;
  }

  /**
   * Every frame, after the pose: each of her bones from the one of ours it follows. Her hands then take the pole as in
   * her own animation: oriented by the pole's axis and the forearm (frame G), set back on our wrist; her fingers follow
   * her hand; her pole moves into her fist by the same few centimetres.
   */
  drive(ours: Bone[]): void {
    for (let j = 0; j < this.bones.length; j++) this.bones[j].matrix.multiplyMatrices(ours[this.follow[j]].matrix, this.offsets[j]);
    this.hands.forEach((h, side) => {
      // the hand first: on our pole (its fist at our grip) as in her animation
      const pole = ours[B.poleL + side].matrix, fore = ours[B.forearmL + side].matrix, e = pole.elements, f = fore.elements;
      handFrame(gNow, ga.set(e[12], e[13], e[14]), gb.set(e[4], e[5], e[6]), gc.set(f[4], f[5], f[6]));
      const hand = this.bones[h.joint].matrix.multiplyMatrices(gNow, h.rel);
      for (const fg of h.fingers) this.bones[fg.joint].matrix.multiplyMatrices(hand, fg.rel);
      this.bones[h.pole].matrix.copy(pole);
      // then the arm reaches that wrist (two-bone IK with her lengths, the elbow where ours bends): the glove stays in
      // the sleeve
      const sh = aSh.setFromMatrixPosition(ours[B.upperArmL + side].matrix), wr = aWr.setFromMatrixPosition(hand);
      const ourElbow = aEl.setFromMatrixPosition(fore);
      aHint.copy(ourElbow).sub(aMid.copy(sh).add(wr).multiplyScalar(0.5));
      ik2(sh, wr, this.P.upperArm, this.P.forearm, aHint, ourElbow);
      seg(aUp, sh, ourElbow, aBack);
      seg(aFore, ourElbow, wr, gc.set(f[8], f[9], f[10]));
      for (const j of h.upper) this.bones[j].matrix.multiplyMatrices(aUp, this.offsets[j]);
      for (const j of h.fore) this.bones[j].matrix.multiplyMatrices(aFore, this.offsets[j]);
    });
  }

  /** The outfit's colours on the slotted parts (the jacket and the pants tint their fabric texture). */
  recolor(palette: Color[]): void {
    const a = this.colors.array as Float32Array;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s === 255) { a[i * 3] = this.base[i * 3]; a[i * 3 + 1] = this.base[i * 3 + 1]; a[i * 3 + 2] = this.base[i * 3 + 2]; continue; }
      a[i * 3] = palette[s].r; a[i * 3 + 1] = palette[s].g; a[i * 3 + 2] = palette[s].b;
    }
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).map?.dispose();
    (this.mesh.material as MeshStandardMaterial).normalMap?.dispose();
    (this.mesh.material as Material).dispose();
  }
}

const loader = new GLTFLoader();

/**
 * A hand's rig: its joint, its pose in the frame G of the pole it holds (handFrame), its fingers in the hand's frame,
 * the gear bone of its pole, the joints of its upper arm and forearm (re-aimed at the hand).
 */
interface HandRig { joint: number; rel: Matrix4; fingers: { joint: number; rel: Matrix4 }[]; pole: number; upper: number[]; fore: number[] }
const aSh = new Vector3(), aWr = new Vector3(), aEl = new Vector3(), aMid = new Vector3(), aHint = new Vector3(), aD = new Vector3(), aP = new Vector3();
const aUp = new Matrix4(), aFore = new Matrix4(), aBack = new Vector3(0, 0, -1);
/** Two-bone IK (as skierModel's): the middle joint of a → b, lengths l1 and l2, bending toward `hint`, written in `mid`. */
function ik2(a: Vector3, b: Vector3, l1: number, l2: number, hint: Vector3, mid: Vector3): void {
  aD.subVectors(b, a);
  let d = aD.length();
  aD.divideScalar(d || 1);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  aP.copy(hint).addScaledVector(aD, -hint.dot(aD));
  if (aP.lengthSq() < 1e-8) aP.crossVectors(aD, X);
  mid.copy(a).addScaledVector(aD, x).addScaledVector(aP.normalize(), Math.sqrt(Math.max(0, l1 * l1 - x * x)));
}
const gNow = new Matrix4(), ga = new Vector3(), gb = new Vector3(), gc = new Vector3(), gx = new Vector3(), gz = new Vector3();
/** G: origin in the fist, +y along the pole to its tip, +z along the forearm (made square to the pole). */
function handFrame(m: Matrix4, fist: Vector3, poleAxis: Vector3, forearm: Vector3): Matrix4 {
  gb.copy(poleAxis).normalize();
  gz.copy(forearm).addScaledVector(gb, -forearm.dot(gb));
  if (gz.lengthSq() < 1e-8) gz.set(0, 0, 1).addScaledVector(gb, -gb.z);
  gz.normalize();
  gx.crossVectors(gb, gz);
  return m.makeBasis(gx, gb, gz).setPosition(fist);
}

/** Loads and prepares her (`low`: the simplified file, 512 px textures). */
export async function loadAvatar(tier: 'low' | 'high', shadowMat: Material): Promise<Avatar> {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/skier-${tier}.glb`);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const skinned: SkinnedMesh[] = [], gear: Mesh[] = [];
  scene.traverse((o: Object3D) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
    else if ((o as Mesh).isMesh && /^(ski|pole)/i.test(o.name)) gear.push(o as Mesh);
  });
  const skeleton = skinned[0].skeleton;
  const rig = skeleton.bones, nRig = rig.length;
  const bind = skeleton.boneInverses.map((m) => m.clone().invert()); // each joint's rest frame, in her model space
  const key = rig.map((b) => b.name.replace(/_\d+$/, ''));
  const at = (k: string) => {
    const i = key.indexOf(k);
    if (i < 0) throw new Error(`avatar: no bone ${k}`);
    return new Vector3().setFromMatrixPosition(bind[i]);
  };

  // her rest pose as our 20 bones see it (the same frame rules as the solver), and her proportions
  const hip = [at('DEF-thighL'), at('DEF-thighR')], knee = [at('DEF-shinL'), at('DEF-shinR')], ankle = [at('DEF-footL'), at('DEF-footR')];
  const shoulder = [at('DEF-upper_armL'), at('DEF-upper_armR')], elbow = [at('DEF-forearmL'), at('DEF-forearmR')], wrist = [at('DEF-handL'), at('DEF-handR')];
  const knuckle = [at('DEF-f_middle01L'), at('DEF-f_middle01R')];
  const grip = wrist.map((w, i) => w.clone().lerp(knuckle[i], 0.95));
  const pel = hip[0].clone().add(hip[1]).multiplyScalar(0.5), abd = at('DEF-spine001'), chest = at('DEF-spine003'), neck = at('DEF-spine004');
  let soleY = Infinity;
  for (const m of skinned) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) soleY = Math.min(soleY, p.getY(i));
  }
  const avg = (f: (i: number) => number) => (f(0) + f(1)) / 2;
  const P: Proportions = {
    thigh: avg((i) => hip[i].distanceTo(knee[i])), shin: avg((i) => knee[i].distanceTo(ankle[i])),
    ankle: avg((i) => ankle[i].y) - soleY + 0.035, // + the binding plate the boot stands on (our skis)
    hipW: (hip[0].x - hip[1].x) / 2,
    upperArm: avg((i) => shoulder[i].distanceTo(elbow[i])), forearm: avg((i) => elbow[i].distanceTo(wrist[i])), grip: avg((i) => wrist[i].distanceTo(grip[i])),
    spineLow: pel.distanceTo(abd), spineMid: abd.distanceTo(chest), neck: chest.distanceTo(neck),
    shoulder: shoulder[0].clone().sub(chest),
  };
  const rest = Array.from({ length: BONES }, () => new Matrix4());
  rest[B.pelvis].setPosition(pel);
  rest[B.spine].setPosition(abd);
  rest[B.chest].setPosition(chest);
  rest[B.head].setPosition(neck);
  const back = new Vector3(0, 0, -1), front = new Vector3(0, 0, 1);
  for (let i = 0; i < 2; i++) {
    seg(rest[B.upperArmL + i], shoulder[i], elbow[i], back);
    seg(rest[B.forearmL + i], elbow[i], wrist[i], front);
    seg(rest[B.handL + i], wrist[i], grip[i], front);
    seg(rest[B.thighL + i], hip[i], knee[i], front);
    seg(rest[B.shinL + i], knee[i], ankle[i], front);
    rest[B.footL + i].makeBasis(X, new Vector3(0, 1, 0), Z).setPosition(ankle[i]);
  }

  // the grip: her fingers as in her animation's first frame, relative to her hand
  const grasp = new Map<number, Matrix4>();
  if (gltf.animations.length) {
    const mixer = new AnimationMixer(scene);
    mixer.clipAction(gltf.animations[0]).play();
    mixer.update(0);
    scene.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const h = key.indexOf(`DEF-hand${side}`);
      const handInv = rig[h].matrixWorld.clone().invert();
      key.forEach((k, j) => {
        if (/^DEF-(f_|thumb|palm)/.test(k) && k.endsWith(side) || new RegExp(`^DEF-(f_|thumb|palm).*${side}\\d{3}$`).test(k)) {
          grasp.set(j, bind[h].clone().multiply(handInv.clone().multiply(rig[j].matrixWorld)));
        }
      });
    }
    mixer.stopAllAction();
  }

  // each joint: the bone of ours it follows (by name, else the nearest rest origin) and its offset in that bone
  const follow = new Int8Array(nRig + 4), offsets: Matrix4[] = [];
  const restInv = rest.map((m) => m.clone().invert()), v = new Vector3();
  for (let j = 0; j < nRig; j++) {
    let b = ourBone(key[j]);
    if (b < 0) {
      v.setFromMatrixPosition(bind[j]);
      let best = Infinity;
      for (let k = 0; k < 18; k++) { const d = v.distanceToSquared(new Vector3().setFromMatrixPosition(rest[k])); if (d < best) { best = d; b = k; } }
    }
    follow[j] = b;
    // her ski pants a little fuller round thighs and shins (slim, under the bulky jacket, they read as thin legs)
    // and her sleeves fuller (a down jacket: they read thin against her body)
    const legs = b >= B.thighL && b <= B.shinR, k = legs ? 1.12 : b === B.upperArmL || b === B.upperArmR ? 1.2 : b === B.forearmL || b === B.forearmR ? 1.15 : 1;
    offsets.push(new Matrix4().makeScale(k, 1, k).multiply(restInv[b]).multiply(grasp.get(j) ?? bind[j]));
  }
  [B.skiL, B.skiR, B.poleL, B.poleR].forEach((b, k) => { follow[nRig + k] = b; offsets.push(new Matrix4()); });

  // the forearm's second half (Rigify's twist bone) of each side: the jacket's cuff follows it, not the hand
  const wristOf = ['L', 'R'].map((sd) => { const i = key.indexOf(`DEF-forearm${sd}001`); return i >= 0 ? i : key.indexOf(`DEF-forearm${sd}`); });
  // the atlas: the jacket's and the pants' textures side by side, a white (and flat-normal) band under them
  const texOf = (name: string) => skinned.map((m) => m.material as MeshStandardMaterial).find((mt) => mt.name === name);
  const jacket = texOf('jacket'), pants = texOf('pants');
  const size = (jacket?.map?.image as { width: number } | undefined)?.width ?? 512, band = Math.max(8, size / 8), W = size * 2, H = size + band;
  const atlas = (pick: (m: MeshStandardMaterial | undefined) => Texture | null | undefined, fill: string) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.fillStyle = fill;
    g.fillRect(0, 0, W, H);
    for (const [k, m] of [[0, jacket], [1, pants]] as const) {
      const img = pick(m)?.image as CanvasImageSource | undefined;
      if (img) g.drawImage(img, k * size, 0, size, size);
    }
    return c;
  };
  const base = atlas((m) => m?.map, '#ffffff'), normals = atlas((m) => m?.normalMap, 'rgb(128,128,255)');
  // the fabric's mean brightness (linear, measured by the build), so a tint keeps its shading but takes the outfit's colour
  const meanLum = (m: MeshStandardMaterial | undefined) => (m?.userData.meanLum as number | undefined) ?? 0.2;
  const gain = [1 / meanLum(jacket), 1 / meanLum(pants)];

  // one geometry: her skinned parts as they are, her skis and poles re-framed onto our gear bones
  const parts: BufferGeometry[] = [], slotList: number[] = [];
  const add = (geo: BufferGeometry, mat: MeshStandardMaterial, gearBone = -1, frame?: Matrix4) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
    if (frame) g.applyMatrix4(frame);
    const n = g.getAttribute('position').count;
    const which = mat.name === 'jacket' ? 0 : mat.name === 'pants' ? 1 : -1;
    const uv = g.getAttribute('uv'), uvs = new Float32Array(n * 2), col = new Float32Array(n * 3), pbr = new Float32Array(n * 2), tint = new Float32Array(n);
    g.computeBoundingBox();
    const slot = slotOf(mat.name, gearBone >= 0 ? 0 : (g.boundingBox!.min.y + g.boundingBox!.max.y) / 2);
    for (let i = 0; i < n; i++) {
      if (which >= 0 && uv) { uvs[i * 2] = (which + uv.getX(i)) * 0.5; uvs[i * 2 + 1] = (uv.getY(i) * size) / H; tint[i] = gain[which]; }
      else { uvs[i * 2] = 0.5; uvs[i * 2 + 1] = (size + band / 2) / H; }
      const c = which >= 0 ? new Color(1, 1, 1) : mat.color;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      pbr[i * 2] = mat.roughness; pbr[i * 2 + 1] = mat.metalness;
      slotList.push(slot);
    }
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('pbr', new BufferAttribute(pbr, 2));
    g.setAttribute('tint', new BufferAttribute(tint, 1));
    if (gearBone >= 0) {
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = gearBone; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    } else {
      // her skin indices as 16-bit integers (meshopt may hand them over as bytes); on the jacket, what followed a hand
      // follows the forearm instead: the sleeve's lining was dragged out of the cuff like a flap when the hand turned
      const si = g.getAttribute('skinIndex'), out = new Uint16Array(n * 4);
      for (let i = 0; i < n * 4; i++) {
        const j = si.array[i] as number;
        out[i] = mat.name === 'jacket' && (follow[j] === B.handL || follow[j] === B.handR) ? wristOf[follow[j] - B.handL] : j;
      }
      g.setAttribute('skinIndex', new BufferAttribute(out, 4));
      const sw = g.getAttribute('skinWeight'), w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) w[i * 4 + k] = sw.getComponent(i, k);
      g.setAttribute('skinWeight', new BufferAttribute(w, 4));
    }
    parts.push(g);
  };
  for (const m of skinned) add(m.geometry, m.material as MeshStandardMaterial);

  const poleAnim: ({ fist: Vector3; axis: Vector3 } | null)[] = [null, null];
  // skis and poles: each side's pieces framed as our bones are (ski: origin under the boot, +y up, +z to the tip;
  // pole: origin in the fist, +y to the tip, POLE long)
  for (const kind of ['ski', 'pole'] as const) {
    for (const side of [0, 1]) {
      // each piece to the side of the nearer foot (skis) or hand (poles), as she holds them in her animation's first
      // frame (by the sign of x, both skis went to one side: she carves there)
      const near = [0, 1].map((sd) => new Vector3().setFromMatrixPosition(rig[key.indexOf(`DEF-${kind === 'ski' ? 'foot' : 'hand'}${sd ? 'R' : 'L'}`)].matrixWorld));
      const pieces = gear.filter((m) => {
        if (!m.name.toLowerCase().startsWith(kind)) return false;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const c = new Vector3().copy(m.geometry.boundingSphere!.center).applyMatrix4(m.matrixWorld);
        return (c.distanceTo(near[1]) < c.distanceTo(near[0]) ? 1 : 0) === side;
      });
      if (!pieces.length) continue;
      const pts: Vector3[] = [], held: Vector3[] = [];
      for (const m of pieces) {
        const p = m.geometry.getAttribute('position'), mat = (m.material as MeshStandardMaterial).name;
        for (let i = 0; i < p.count; i += 1) {
          const w = new Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          pts.push(w);
          if (/^plast/.test(mat)) held.push(w); // the binding (skis), the handle (poles)
        }
      }
      const { toLocal: frame, fist, axis } = gearFrame(kind, pts, held);
      if (kind === 'pole') poleAnim[side] = { fist, axis };
      for (const m of pieces) add(m.geometry, m.material as MeshStandardMaterial, nRig + (kind === 'ski' ? side : 2 + side), frame.clone().multiply(m.matrixWorld));
    }
  }
  // her hands as they hold the poles in her animation's first frame (the scene is still posed there)
  const hands: HandRig[] = [];
  for (const [side, sfx] of [[0, 'L'], [1, 'R']] as const) {
    const h = key.indexOf(`DEF-hand${sfx}`), fo = key.indexOf(`DEF-forearm${sfx}`), pa = poleAnim[side];
    if (h < 0 || fo < 0 || !pa) continue;
    const handW = rig[h].matrixWorld, wristA = new Vector3().setFromMatrixPosition(handW), elbowA = new Vector3().setFromMatrixPosition(rig[fo].matrixWorld);
    const g = handFrame(new Matrix4(), pa.fist, pa.axis, wristA.clone().sub(elbowA));
    const handInv = handW.clone().invert();
    const fingers = [...grasp.keys()].filter((j) => key[j].endsWith(sfx)).map((j) => ({ joint: j, rel: handInv.clone().multiply(rig[j].matrixWorld) }));
    const upper = [...follow.keys()].filter((j) => j < nRig && follow[j] === B.upperArmL + side);
    const fore = [...follow.keys()].filter((j) => j < nRig && follow[j] === B.forearmL + side);
    hands.push({ joint: h, rel: g.invert().multiply(handW), fingers, pole: nRig + 2 + side, upper, fore });
  }
  const geometry = mergeGeometries(parts);
  for (const g of parts) g.dispose();

  const map = new CanvasTexture(base), normalMap = new CanvasTexture(normals);
  for (const t of [map, normalMap]) { t.flipY = false; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 4; }
  map.colorSpace = SRGBColorSpace;
  normalMap.colorSpace = NoColorSpace;
  const material = avatarMaterial(map, normalMap);
  const bones = Array.from({ length: nRig + 4 }, () => { const b = new Bone(); b.matrixAutoUpdate = false; return b; });
  const inverses = [...skeleton.boneInverses.map((m) => m.clone()), ...[0, 1, 2, 3].map(() => new Matrix4())];
  for (const m of skinned) { m.geometry.dispose(); (m.material as Material).dispose(); }
  return new Avatar(tier, P, geometry, material, shadowMat, bones, inverses, follow, offsets, Uint8Array.from(slotList), hands.length === 2 ? hands : []);
}

/** The frame of a ski or a pole from its own points (principal axis), as our gear bones define them. */
function gearFrame(kind: 'ski' | 'pole', pts: Vector3[], held: Vector3[]): { toLocal: Matrix4; fist: Vector3; axis: Vector3 } {
  const c = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(pts.length);
  // principal axis by power iteration on the covariance
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += d[a] * d[b]; }
  const power = (v: Vector3, deflate?: Vector3) => {
    for (let k = 0; k < 40; k++) {
      const x = cov[0] * v.x + cov[1] * v.y + cov[2] * v.z, y = cov[3] * v.x + cov[4] * v.y + cov[5] * v.z, z = cov[6] * v.x + cov[7] * v.y + cov[8] * v.z;
      v.set(x, y, z);
      if (deflate) v.addScaledVector(deflate, -v.dot(deflate));
      v.normalize();
    }
    return v;
  };
  const u = power(new Vector3(0.3, 0.2, 1));
  const hc = held.length ? held.reduce((a, p) => a.add(p), new Vector3()).divideScalar(held.length) : c.clone();
  const m = new Matrix4();
  if (kind === 'pole') {
    // the basket is the wider end: +y points there (the tip); the fist 7 cm below the other end (the handle's top);
    // scaled to POLE from fist to tip. (The handle and the basket share a material: their centroid was mid-pole.)
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const t = p.clone().sub(c).dot(u); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const spread = (near: (t: number) => boolean) => {
      let r = 0;
      for (const p of pts) { const d = p.clone().sub(c), t = d.dot(u); if (near(t)) r = Math.max(r, d.addScaledVector(u, -t).length()); }
      return r;
    };
    const len = hi - lo;
    if (spread((t) => t < lo + len * 0.12) > spread((t) => t > hi - len * 0.12)) u.negate(); // basket at the low end: flip
    let top = Infinity, tip = -Infinity;
    for (const p of pts) { const t = p.clone().sub(c).dot(u); top = Math.min(top, t); tip = Math.max(tip, t); }
    const fist = c.clone().addScaledVector(u, top + 0.07);
    seg(m, fist, fist.clone().add(u), X);
    const s = POLE / Math.max(0.5, tip - top - 0.07);
    return { toLocal: new Matrix4().makeScale(1, s, 1).multiply(m.invert()), fist, axis: u.clone() };
  }
  // ski: n the thinnest axis, pointing from the base to the binding; +z to the end that rises (the tip)
  const second = power(new Vector3(0, 1, 0.1), u);
  const n = new Vector3().crossVectors(u, second).normalize();
  if (n.dot(hc.clone().sub(c)) < 0) n.negate();
  let lo = Infinity, hi = -Infinity, rise = 0;
  for (const p of pts) { const t = p.clone().sub(c).dot(u); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  for (const p of pts) {
    const t = p.clone().sub(c).dot(u), h = p.clone().sub(c).dot(n);
    if (t > hi - (hi - lo) * 0.1) rise += h; else if (t < lo + (hi - lo) * 0.1) rise -= h;
  }
  if (rise < 0) u.negate();
  let base = Infinity;
  for (const p of pts) base = Math.min(base, p.clone().sub(c).dot(n));
  // across: the ski's own middle (its binding parts are not symmetric: brake, lever); along: the binding's centre, 8 cm
  // ahead of the bone (our ski bone sits under the ankle, her boot's middle is ahead of it); up: the base
  const origin = c.clone().addScaledVector(u, hc.clone().sub(c).dot(u) - 0.08).addScaledVector(n, base);
  const x = new Vector3().crossVectors(n, u).normalize(), zz = new Vector3().crossVectors(x, n).normalize();
  m.makeBasis(x, n, zz).setPosition(origin);
  return { toLocal: m.invert(), fist: origin, axis: u.clone() };
}

/** Standard (PBR) material: roughness and metalness per vertex; the jacket and the pants tint their fabric. */
function avatarMaterial(map: Texture, normalMap: Texture): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ map, normalMap, vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    addHeightFog(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nattribute float tint;\nvarying vec2 vPbr;\nvarying float vTint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;\nvTint = tint;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;\nvarying float vTint;')
      .replace('#include <map_fragment>', `
      vec4 texel = texture2D( map, vMapUv );
      if (vTint > 0.0) {
        // the fabric's shading in the outfit's colour (vertex colour); saturated details (piping) keep their own
        float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
        float sat = max(texel.r, max(texel.g, texel.b)) - min(texel.r, min(texel.g, texel.b));
        diffuseColor.rgb *= mix(vColor.rgb * lum * vTint, texel.rgb, smoothstep(0.08, 0.2, sat));
      } else diffuseColor.rgb *= texel.rgb;`)
      .replace('#include <color_fragment>', 'if (vTint <= 0.0) diffuseColor.rgb *= vColor.rgb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  mat.customProgramCacheKey = () => 'avatar';
  return mat;
}
