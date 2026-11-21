import {
  Bone, Color, DetachedBindMode, Euler, Group, Matrix4, MeshBasicMaterial, MeshLambertMaterial, NotEqualStencilFunc,
  Quaternion, ReplaceStencilOp, Skeleton, SkinnedMesh, Vector3, type BufferAttribute,
} from 'three';
import type { SkierEvent, SkierState } from '../sim/skier';
import { clamp, Surface, type Ground } from '../sim/track';
import { TUNING as T } from '../tuning';
import {
  ANKLE, B, BONES, buildSkierGeometry, FOREARM, GRIP, HIP_W, NECK, POLE, S, SHIN, SHOULDER, SLOTS, SPINE_LOW, SPINE_MID, THIGH,
  UPPER_ARM,
} from './skierMesh';
import { buildHeroGeometry, heroMaterial } from './skierHero';
import { loadAvatar, type Avatar, type Proportions } from './avatar';
import { capsuleDepth, clearSegment, closestOnSegments, hullOverlap, maskOf, pushOut, segmentDepth, type HullPart } from './bodyHull';

export interface SkierColors { jacket: number; pants: number; helmet: number; skis: number }
export const DEFAULT_COLORS: SkierColors = { jacket: 0xff6b4a, pants: 0x2b3a55, helmet: 0xf4f6fa, skis: 0x3a7bd5 };

const NEUTRALS: [number, number][] = [
  [S.glove, 0x1f2430], [S.boot, 0x2b3242], [S.buckle, 0xc9d1dc], [S.skin, 0xe2ab8c], [S.metal, 0xb9c2cf],
  [S.base, 0x1a1f29], [S.binding, 0x8d97a6], [S.strap, 0x232833], [S.lensTop, 0xffdc73], [S.lensBottom, 0xff6a2a],
];

/** Damped spring on one channel: f = natural frequency (Hz), z = damping ratio (< 1 overshoots, for life). */
class Spring {
  v = 0;
  constructor(public x = 0) {}
  to(target: number, f: number, z: number, dt: number): number {
    const w = 2 * Math.PI * f;
    const n = Math.ceil(dt * 120); // substeps keep semi-implicit Euler stable at low frame rates
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * z * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/** A ski or pole flying off in a crash: world-space rigid body bouncing on the snow. */
interface Loose { bone: number; axis: Vector3; c: number; half: number; pos: Vector3; vel: Vector3; q: Quaternion; w: Vector3 }

const gripOf = (s: Surface) => (s === Surface.Ice ? T.gripIce : s === Surface.Powder ? T.gripPowder : T.gripGroomed);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const UP = new Vector3(0, 1, 0);
// her body's parts, as bitmasks of bones (bodyHull.ts)
const LEG_MASK = maskOf(B.thighL, B.thighR, B.shinL, B.shinR, B.footL, B.footR);
const LEG_L = maskOf(B.thighL, B.shinL, B.footL, B.skiL);
const LEG_R = maskOf(B.thighR, B.shinR, B.footR, B.skiR);
const LOWER_L = maskOf(B.shinL, B.footL, B.skiL);
const LOWER_R = maskOf(B.shinR, B.footR, B.skiR);
const SKI_MASK = maskOf(B.skiL, B.skiR);
const UPPER_MASK = maskOf(B.spine, B.chest, B.head);
const TORSO_MASK = maskOf(B.pelvis, B.spine, B.chest, B.head);
const HAND_R = 0.06; // her gloved fist, fingers round the grip
const SWIVEL = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8].map((k) => (k * Math.PI) / 12);
const sq = new Quaternion();
const sw1 = new Vector3();
const sw2 = new Vector3();
const sw3 = new Vector3();
const sw4 = new Vector3();
const sw5 = new Vector3();
const lA = new Vector3();
const pw1 = new Vector3();
const pw2 = new Vector3();
const pw3 = new Vector3();
const pw4 = new Vector3();
const pw5 = new Vector3();
const pw6 = new Vector3();
const lB = new Vector3();
const lP = new Vector3();
const lN = new Vector3();
const lST: [number, number] = [0, 0];
const HIDDEN = new MeshBasicMaterial({ visible: false });
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const ONE = new Vector3(1, 1, 1);
// scratch (no per-frame allocation)
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const fx = new Vector3();
const fy = new Vector3();
const fz = new Vector3();
const ikD = new Vector3();
const ikP = new Vector3();
const qa = new Quaternion();
const qb = new Quaternion();
const eu = new Euler();
const m1 = new Matrix4();
const m2 = new Matrix4();

/** Two-bone IK: writes the middle joint of a → b (lengths l1, l2) bending toward `hint`; pulls b in if out of reach. */
function ik(a: Vector3, b: Vector3, l1: number, l2: number, hint: Vector3, mid: Vector3): void {
  ikD.subVectors(b, a);
  let d = ikD.length();
  ikD.divideScalar(d || 1);
  const dc = clamp(d, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
  if (dc !== d) b.copy(a).addScaledVector(ikD, (d = dc));
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  ikP.copy(hint).addScaledVector(ikD, -hint.dot(ikD));
  if (ikP.lengthSq() < 1e-8) ikP.crossVectors(ikD, X);
  mid.copy(a).addScaledVector(ikD, x).addScaledVector(ikP.normalize(), Math.sqrt(Math.max(0, l1 * l1 - x * x)));
}

/** Bone frame at a, +y toward b, +z as close to `hint` as possible. */
function seg(m: Matrix4, a: Vector3, b: Vector3, hint: Vector3): void {
  fy.subVectors(b, a).normalize();
  fx.crossVectors(fy, hint);
  if (fx.lengthSq() < 1e-6) fx.crossVectors(fy, Math.abs(fy.x) < 0.9 ? X : Z);
  fx.normalize();
  fz.crossVectors(fx, fy);
  m.makeBasis(fx, fy, fz).setPosition(a);
}

/** Pole direction toward horizontal heading (hx, hz) whose tip sits `clear` m above the snow plane (y = 0). */
function snowPole(out: Vector3, grip: Vector3, hx: number, hz: number, clear: number): void {
  const y = -clamp((grip.y - clear) / POLE, 0, 1);
  const k = Math.sqrt(1 - y * y) / (Math.hypot(hx, hz) || 1);
  out.set(hx * k, y, hz * k);
}

/**
 * Stylised-realistic skier: one skinned mesh (body + gear, 2 draw calls) driven by a procedural, spring-based pose
 * (stance, carving with inclination + angulation and two-bone IK legs, tuck, double-pole push, hockey stop, pop,
 * spins, grabs, flips, landings that soak through the legs, pole plants, crash yard sale, get-up), plus a planar
 * projected shadow (1 draw call, stencilled so overlapping parts never darken twice).
 * Body space: origin = snow under the feet, +z forward (ski heading), +x left, +y along the ground normal.
 */
export class SkierModel {
  readonly root = new Group();
  readonly shadow: SkinnedMesh;
  readonly handDrag = { active: false, pos: new Vector3(), strength: 0 };
  private body = new Group();
  private mesh: SkinnedMesh;
  private bones: Bone[] = [];
  private slots: Uint8Array;
  private colors: BufferAttribute;
  private palette = Array.from({ length: SLOTS }, () => new Color());
  private shadowMat = new MeshBasicMaterial({
    color: 0x34436a, transparent: true, opacity: 0.3, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilZPass: ReplaceStencilOp,
  });
  private firstPerson = false;

  // animation channels
  private drop = new Spring(0.12); // pelvis drop below straight legs (m)
  private rest = 0; // 0 skiing … 1 standing still (more upright)
  private incl = new Spring(); // lower-body inclination into the turn (rad, + = left)
  private counter = new Spring(); // upper-body yaw toward the fall line
  private brakeYaw = new Spring(); // hockey-stop ski yaw
  private tuckK = new Spring();
  private pushK = new Spring();
  private airK = new Spring();
  private grabK = new Spring();
  private flipK = new Spring();
  private lift = new Spring(); // feet pulled up in the air (m)
  private brakeK = new Spring();
  private armOut = new Spring();
  private spinLead = new Spring();
  private armFwd = new Spring(); // impulse-driven: arms reach forward on a hard landing
  private dragK = new Spring();
  private landC = new Spring(); // landing compression (m), kicked by the impact
  private settle = new Spring(); // crash: tumbling → sprawled
  private nrm = new Vector3(0, 1, 0);
  private suspY = 0;
  private suspV = 0;
  private suspSnap = true;
  private t = 0;
  private pushPhase = 0;
  private startPush = 0; // s of double-poling still owed after a standstill (the gate push-off is already fast)
  private wobT = 0;
  private wobSide = 1;
  private brakeSide = 1;
  private wasBraking = false;
  private grabSide = -1;
  private plantT = [-1, -1];
  private lastPlant = 0;
  private plantPending = false;
  private plantPos = new Vector3();
  private getUpT = -1;
  // crash
  private wasCrashed = false;
  private crashYaw = 0;
  private tumble = 0;
  private loose: Loose[];

  // pose (body space)
  private ankle = [new Vector3(), new Vector3()];
  private skiBase = [new Vector3(), new Vector3()];
  private hip = [new Vector3(), new Vector3()];
  private knee = [new Vector3(), new Vector3()];
  private shoulder = [new Vector3(), new Vector3()];
  private elbow = [new Vector3(), new Vector3()];
  private wrist = [new Vector3(), new Vector3()];
  private grip = [new Vector3(), new Vector3()];
  private poleDir = [new Vector3(), new Vector3()];
  private pelvis = new Vector3();
  private abd = new Vector3();
  private chest = new Vector3();
  private neck = new Vector3();
  private rollUp = new Vector3();
  private skiF = new Vector3();
  private kneeHint = new Vector3();
  private qP = new Quaternion();
  private qA = new Quaternion();
  private qT = new Quaternion();
  private qU = new Quaternion();
  private qH = new Quaternion();

  private look: SkierColors;
  /** Segment lengths the solver uses: ours, or the realistic model's once she is loaded (avatar.ts). */
  private P: Proportions = { thigh: THIGH, shin: SHIN, ankle: ANKLE, hipW: HIP_W, upperArm: UPPER_ARM, forearm: FOREARM, grip: GRIP, spineLow: SPINE_LOW, spineMid: SPINE_MID, neck: NECK, shoulder: SHOULDER };
  private avatar: Avatar | null = null;
  /** Her body as capsules on our bones, and the same in body space this frame (the poles keep off it). */
  private hull: HullPart[] = [];
  private hullNow: { a: Vector3; b: Vector3; r: number; bone: number }[] = [];
  /** Her upper arm's and forearm's widest radius (from her capsules). */
  private armR = [0.09, 0.065];
  private avatarWanted: 'low' | 'high' | null = null;

  /** `hero`: the player's detailed skier at that tier (skierHero.ts); the crowd keeps the light one. */
  constructor(colors: SkierColors = DEFAULT_COLORS, private hero: 'low' | 'medium' | 'high' | null = null) {
    this.look = colors;
    if (hero) this.shadowMat.opacity = 0.42; // the player's shadow a little firmer: it carries the jumps
    const { geometry, slots } = hero ? buildHeroGeometry(hero) : buildSkierGeometry();
    this.slots = slots;
    this.colors = geometry.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < BONES; i++) {
      const b = new Bone();
      b.matrixAutoUpdate = false;
      this.bones.push(b);
    }
    const skeleton = new Skeleton(this.bones, this.bones.map(() => new Matrix4()));
    this.mesh = new SkinnedMesh(geometry, [hero ? heroMaterial() : new MeshLambertMaterial({ vertexColors: true }), new MeshBasicMaterial({ vertexColors: true })]);
    this.mesh.add(...this.bones);
    this.mesh.bind(skeleton, new Matrix4());
    this.mesh.frustumCulled = false;
    // same geometry + skeleton, flattened onto the snow by its own (world) matrix
    const shadow = new SkinnedMesh(geometry, this.shadowMat);
    shadow.bindMode = DetachedBindMode;
    shadow.bind(skeleton, new Matrix4());
    shadow.matrixAutoUpdate = false;
    shadow.frustumCulled = false;
    shadow.renderOrder = 2; // after the ski trails, so they darken too
    this.shadow = shadow;
    this.body.add(this.mesh);
    this.root.add(this.body);
    const loose = (bone: number, axis: Vector3, c: number, half: number): Loose =>
      ({ bone, axis, c, half, pos: new Vector3(), vel: new Vector3(), q: new Quaternion(), w: new Vector3() });
    this.loose = [loose(B.skiL, Z, 0.1, 0.85), loose(B.skiR, Z, 0.1, 0.85), loose(B.poleL, UP, POLE / 2, POLE / 2), loose(B.poleR, UP, POLE / 2, POLE / 2)];
    this.setColors(colors);
    if (hero && typeof document !== 'undefined') this.wantAvatar(hero === 'low' ? 'low' : 'high');
  }

  /**
   * True while the realistic skier is being loaded and prepared, and 2.5 s after (her shader compiles and her textures
   * upload on the first frames): main.ts does not count those frames as a slow device.
   */
  get loadingAvatar(): boolean {
    return (!!this.avatarWanted && this.avatar?.tier !== this.avatarWanted) || performance.now() < this.avatarSettled;
  }
  private avatarSettled = 0;

  /**
   * The player's realistic skier (avatar.ts): loaded in the background, the built one stays until she is ready; then
   * her proportions drive the solver, her mesh replaces ours, her shadow ours.
   */
  private wantAvatar(tier: 'low' | 'high'): void {
    if (this.avatarWanted === tier) return;
    this.avatarWanted = tier;
    loadAvatar(tier, this.shadowMat).then((a) => {
      if (this.avatarWanted !== tier) { a.dispose(); return; }
      if (this.avatar) {
        this.body.remove(this.avatar.mesh);
        this.shadow.remove(this.avatar.shadow);
        this.avatar.dispose();
      }
      this.avatar = a;
      this.P = a.P;
      this.hull = a.hull;
      this.hullNow = a.hull.map((h) => ({ a: new Vector3(), b: new Vector3(), r: h.r, bone: h.bone }));
      const widest = (b: number) => Math.max(0.03, ...a.hull.filter((h) => h.bone === b).map((h) => h.r));
      this.armR = [widest(B.upperArmL), widest(B.forearmL)];
      this.body.add(a.mesh);
      this.mesh.visible = false;
      this.shadow.material = HIDDEN; // the built body's shadow; hers is a child (the same projection)
      this.shadow.add(a.shadow);
      a.recolor(this.palette);
      this.avatarSettled = performance.now() + 2500;
    }).catch((e) => console.warn('avatar: kept the built skier', e));
  }

  /** The hero's tier (graphics level): the same skeleton, a lighter or finer body. */
  setDetail(tier: 'low' | 'medium' | 'high'): void {
    if (!this.hero) return;
    if (this.avatarWanted) this.wantAvatar(tier === 'low' ? 'low' : 'high');
    if (tier === this.hero) return;
    this.hero = tier;
    const { geometry, slots } = buildHeroGeometry(tier), old = this.mesh.geometry;
    this.mesh.geometry = this.shadow.geometry = geometry;
    this.slots = slots;
    this.colors = geometry.getAttribute('color') as BufferAttribute;
    this.setColors(this.look);
    old.dispose();
  }

  setColors(c: SkierColors): void {
    this.look = c;
    const p = this.palette;
    p[S.jacket].setHex(c.jacket);
    p[S.pants].setHex(c.pants);
    p[S.helmet].setHex(c.helmet);
    p[S.skis].setHex(c.skis);
    p[S.jacketDark].copy(p[S.jacket]).multiplyScalar(0.62);
    p[S.pantsDark].copy(p[S.pants]).multiplyScalar(0.7);
    for (const [slot, hex] of NEUTRALS) p[slot].setHex(hex);
    const a = this.colors.array as Float32Array;
    for (let i = 0; i < this.slots.length; i++) {
      const col = p[this.slots[i]];
      a[i * 3] = col.r;
      a[i * 3 + 1] = col.g;
      a[i * 3 + 2] = col.b;
    }
    this.colors.needsUpdate = true;
    this.avatar?.recolor(p);
  }

  /** Helmet cam: the head and helmet collapse so nothing clips into the lens. */
  setFirstPerson(on: boolean): void {
    this.firstPerson = on;
  }

  /** On a chairlift: pos is then the seat; hips on it, knees bent, skis dangling, hands on the lap. */
  setSeated(on: boolean): void {
    this.seated = on;
  }
  private seated = false;

  /** True once per pole plant since the last call; writes the tip's world position. */
  consumePolePlant(out: Vector3): boolean {
    if (!this.plantPending) return false;
    this.plantPending = false;
    out.copy(this.plantPos);
    return true;
  }

  onEvent(e: SkierEvent): void {
    switch (e.type) {
      case 'jump':
        this.drop.v -= 3.4; // explosive extension; the knees pull up right after (lift spring)
        break;
      case 'land':
        this.landC.v += Math.min(e.vn, 14) * T.skierLandKick;
        this.lift.x = this.lift.v = 0;
        this.armFwd.v += e.quality === 'perfect' ? 3 : e.vn > T.landHardVn ? 9 : 4;
        if (e.quality === 'sketchy') {
          this.wobT = 0.6;
          this.wobSide = Math.random() < 0.5 ? -1 : 1;
        }
        break;
      case 'pump':
        this.drop.v -= 0.6;
        break;
      case 'edgeChange':
        this.drop.v -= e.clean ? 1.1 : 0.6; // cross-over: brief extension / unweighting
        if (this.t - this.lastPlant > 0.3 && this.tuckK.x < 0.3 && this.brakeK.x < 0.3 && this.airK.x < 0.3) {
          this.plantT[e.dir > 0 ? 0 : 1] = 0; // new inside pole
          this.lastPlant = this.t;
        }
        break;
      case 'grab':
        this.grabSide = -this.grabSide;
        break;
    }
  }

  update(s: SkierState, pos: Vector3, heading: number, g: Ground, dt: number, sunDir: Vector3): void {
    const d = Math.min(dt, 0.05);
    this.t += d;
    const crashed = s.crashTimer > 0;
    const air = s.airborne && !crashed;
    const ground = !air && !crashed;
    const speed = s.vel.length();
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    const vlx = s.vel.x * ch - s.vel.z * sh; // velocity in body space
    const vlz = s.vel.x * sh + s.vel.z * ch;
    if (crashed && !this.wasCrashed) this.startCrash(s, heading);
    if (!crashed && this.wasCrashed) this.endCrash();
    this.wasCrashed = crashed;

    // ── targets
    if (speed < 0.5) this.startPush = 1.2;
    else this.startPush = Math.max(0, this.startPush - d);
    const pushing = ground && s.tuck && (speed < T.poleMaxSpeed || this.startPush > 0);
    const tuck = s.tuck && !pushing && !crashed;
    const braking = ground && s.braking && speed > 0.5;
    if (braking && !this.wasBraking) {
      this.drop.v += 1.6; // check-crouch
      this.brakeSide = s.edge >= 0 ? 1 : -1;
    }
    this.wasBraking = braking;
    const ae = Math.abs(s.edge);
    const lean = ground && !braking ? Math.atan((s.edge * gripOf(s.surface)) / T.gravity) * T.skierLean : 0;
    const drag = ground && !tuck && !braking && ae > T.handDragEdge && speed * 3.6 > T.handDragKmh;
    const hAbove = air ? pos.y - g.height(pos.x, pos.z) : 0;
    const spot = air && s.vel.y < 0 && hAbove < -s.vel.y * 0.35 + 0.15;
    const flipping = air && Math.abs(s.flipVel) > 1.5;
    const idle = ground && speed < 0.3 ? Math.sin(this.t * 1.7) * 0.012 : 0;
    // standing still (the lift queue, a stop): taller and more upright; the ski stance comes back from 2 m/s
    this.rest += ((ground && !crashed && !tuck ? clamp(1 - speed / 2, 0, 1) : 0) - this.rest) * clamp(d * 3, 0, 1);
    const dropT = crashed ? 0.3 : air ? (spot ? 0.03 : 0.1) : 0.16 + ae * 0.06 + (tuck ? 0.24 : 0) + (braking ? 0.12 : 0) + (drag ? 0.06 : 0) + idle - 0.1 * this.rest;

    this.drop.to(dropT, 3.2, 0.55, d);
    this.incl.to(lean, 2.6, 0.85, d);
    this.counter.to(ground ? -s.edge * 0.32 : 0, 2.2, 0.7, d);
    this.brakeYaw.to(braking ? this.brakeSide * 1.15 * Math.min(1, speed / 4) : 0, 2.2, 0.75, d);
    this.tuckK.to(tuck ? 1 : 0, 2.4, 0.8, d);
    this.pushK.to(pushing ? 1 : 0, 3, 1, d);
    this.airK.to(air ? 1 : 0, 3, 0.75, d);
    this.grabK.to(air && s.grab ? 1 : 0, 3.5, 0.65, d);
    this.flipK.to(flipping && !spot ? 1 : 0, 3, 0.8, d);
    // knees up in the air (in a flip, short of her belly: her down jacket meets her shins at 0.5 m)
    this.lift.to(air && !spot ? (flipping ? (this.hull.length ? 0.4 : 0.5) : s.grab ? 0.42 : 0.14) : 0, 3.2, 0.6, d);
    this.brakeK.to(braking ? Math.min(1, speed / 3) : 0, 3, 0.9, d);
    this.armOut.to(air || crashed ? 1 : braking ? 0.8 : 0, 2.2, 0.5, d);
    this.spinLead.to(air ? clamp(s.spinVel * 0.11, -0.9, 0.9) : 0, 2.5, 0.6, d);
    this.armFwd.to(0, 2.5, 0.45, d);
    this.dragK.to(drag ? 1 : 0, 3, 0.8, d);
    this.settle.to(crashed && speed < 3 ? 1 : 0, 1.6, 0.9, d);
    if (pushing) this.pushPhase = (this.pushPhase + d * 1.3) % 1;
    else this.pushPhase = 0.12; // the first push starts at once

    // ── suspension: the body follows the feet through a spring (zero lag on a steady slope), so terrain
    // curvature and landings compress the legs instead of moving a rigid board
    if (!ground || this.suspSnap || Math.abs(pos.y - this.suspY) > 1) {
      this.suspY = pos.y;
      this.suspV = s.vel.y;
      this.suspSnap = false;
    } else {
      const w = 2 * Math.PI * T.skierAbsorb;
      const n = Math.ceil(d * 120);
      for (let i = 0; i < n; i++) {
        this.suspV += (w * w * (pos.y - this.suspY) + 2 * 0.5 * w * (s.vel.y - this.suspV)) * (d / n);
        this.suspY += this.suspV * (d / n);
      }
    }
    this.landC.to(0, 1.8, 0.6, d);
    const comp = ground ? clamp(pos.y - this.suspY + this.landC.x, -0.08, 0.4) : 0;

    // ── one-shot timers: sketchy wobble, pole plants, get-up
    let sway = 0;
    let wob = 0;
    if (this.wobT > 0) {
      this.wobT -= d;
      wob = Math.max(0, this.wobT / 0.6);
      sway = Math.sin(this.t * 13) * 0.2 * wob * this.wobSide;
    }
    const plantK = [0, 0];
    for (let i = 0; i < 2; i++) {
      const pt = this.plantT[i];
      if (pt < 0) continue;
      const nt = pt + d;
      plantK[i] = smooth(0, 0.07, nt) * (1 - smooth(0.2, 0.34, nt));
      if (pt < 0.07 && nt >= 0.07 && ground) this.plantPending = true; // the tip bites now (position set below)
      this.plantT[i] = nt > 0.34 ? -1 : nt;
    }
    let shake = 0;
    if (this.getUpT >= 0) {
      this.getUpT += d;
      shake = Math.sin(this.getUpT * 26) * Math.max(0, 1 - this.getUpT / 0.8);
      if (this.getUpT > 0.8) this.getUpT = -1;
    }
    const pk = this.pushK.x;
    const pf = Math.cos(2 * Math.PI * (this.pushPhase - 0.3)); // +1 hands forward (plant) … -1 hands back (end of push)
    const planted = pk * smooth(0.27, 0.32, this.pushPhase) * (1 - smooth(0.72, 0.8, this.pushPhase));

    this.solve(s, crashed, sway, wob, shake, plantK, pk, pf, planted, comp, vlx, vlz, speed);

    // ── root: ground point, aligned to a smoothed normal (toward vertical in the air), yawed by heading
    this.nrm.lerp(s.normal, 1 - Math.exp(-d / 0.06)).normalize();
    this.root.position.copy(pos);
    qa.setFromUnitVectors(UP, air ? v1.copy(this.nrm).lerp(UP, 0.6).normalize() : this.nrm);
    qb.setFromAxisAngle(UP, crashed ? this.crashYaw : heading);
    this.root.quaternion.copy(qa).multiply(qb);
    // flips pivot around the centre of mass (~0.9 m up); a crash tumbles around the curled body
    if (crashed) {
      this.tumble += (speed / 0.6) * d * (1 - this.settle.x);
      const lie = Math.round((this.tumble - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      const a = this.tumble + (lie - this.tumble) * this.settle.x;
      const ph = 0.55 + (0.17 - 0.55) * this.settle.x;
      this.body.quaternion.setFromEuler(eu.set(a, 0, Math.sin(this.t * 5) * 0.3 * (1 - this.settle.x), 'XYZ'));
      this.body.position.set(0, 0.6, 0).applyQuaternion(this.body.quaternion).multiplyScalar(-1).add(v1.set(0, ph, 0));
    } else {
      const flip = air ? s.flip : 0;
      this.body.quaternion.setFromAxisAngle(X, flip);
      this.body.position.set(0, 0.9 * (1 - Math.cos(flip)), -0.9 * Math.sin(flip));
    }
    this.root.updateMatrixWorld(true);
    if (crashed) this.flyLoose(g, d);
    this.avatar?.drive(this.bones, !crashed); // her bones follow ours (the loose skis and poles too)
    this.root.updateMatrixWorld(true);

    // ── outputs: glove skimming the snow, pole plant contact
    const inside = s.edge >= 0 ? 0 : 1;
    const hd = this.handDrag;
    hd.active = ground && this.dragK.x > 0.6 && this.grip[inside].y < 0.14;
    hd.strength = hd.active ? clamp(this.dragK.x, 0, 1) * Math.min(1, speed / 20) : 0;
    hd.pos.copy(this.grip[inside]).applyMatrix4(this.mesh.matrixWorld);
    hd.pos.y = g.height(hd.pos.x, hd.pos.z);
    if (this.plantPending) {
      const i = this.plantT[0] >= 0 && this.plantT[0] <= 0.2 ? 0 : 1;
      this.plantPos.copy(this.grip[i]).addScaledVector(this.poleDir[i], POLE).applyMatrix4(this.mesh.matrixWorld);
    }

    this.updateShadow(pos, g, sunDir, hAbove);
  }

  /** Builds the body-space pose from the channels and writes every bone matrix. */
  private solve(s: SkierState, crashed: boolean, sway: number, wob: number, shake: number, plantK: number[], pk: number, pf: number,
    planted: number, comp: number, vlx: number, vlz: number, speed: number): void {
    const bones = this.bones;
    const tk = this.tuckK.x;
    const ak = this.airK.x;
    const bk = this.brakeK.x;
    // the grab only as far as her knees are up: legs out to spot the landing, the hand lets go of the ski (it reached
    // for the boot through her thigh)
    const gk = this.grabK.x * clamp(this.lift.x / 0.3, 0, 1);
    const fk = this.flipK.x;
    const st = this.settle.x;
    const flail = crashed ? 1 - st : 0;
    const t = this.t;
    const incl = this.incl.x + sway;
    const by = this.brakeYaw.x;

    // skis: yawed (hockey stop), rolled on edge, slightly wider and inside ski leading in a carve
    const fsx = Math.sin(by);
    const fsz = Math.cos(by);
    const r = this.incl.x * 1.08 + bk * 0.55 * Math.sign(by) + sway * 0.5;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const sk = this.skiF.set(fsx, 0, fsz);
    const up = this.rollUp.set(fsz * sr, cr, -fsx * sr); // up rolled toward the ski's left
    const w = 0.115 + 0.03 * bk + 0.02 * Math.abs(this.incl.x);
    const lead = 0.1 * this.incl.x;
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? 1 : -1;
      const base = this.skiBase[i].set(fsz * sg * w + fsx * sg * lead, 0.045 * Math.abs(sr), -fsx * sg * w + fsz * sg * lead);
      const a = this.ankle[i].copy(base).addScaledVector(up, this.P.ankle);
      if (crashed) {
        // free legs: kick about while tumbling, then lie apart
        a.set(sg * (0.13 + 0.16 * st) + Math.sin(t * 9 + i * 2) * 0.12 * flail, this.P.ankle + (0.25 + 0.2 * Math.sin(t * 11 + i * 3)) * flail, 0.1 * st + Math.sin(t * 7 + i) * 0.2 * flail);
      }
    }
    // pelvis: over the feet, inclined into the turn, back in the tuck / the hockey stop
    const lift = this.lift.x;
    const ped = clamp(this.drop.x + comp + (pk ? pk * (0.06 + 0.1 * (1 - pf) * 0.5) : 0), -0.02, 0.5);
    const beta = bk * 0.28;
    const hipH = this.P.thigh + this.P.shin - ped;
    const pz = -0.05 - 0.13 * tk - 0.03 * bk + 0.04 * fk;
    const pel = this.pelvis.addVectors(this.ankle[0], this.ankle[1]).multiplyScalar(0.5);
    if (crashed) pel.set(0, this.P.ankle, 0);
    pel.x += Math.sin(incl) * hipH;
    pel.y += Math.cos(incl) * Math.cos(beta) * hipH;
    pel.z += -Math.sin(beta) * hipH + pz;
    for (let i = 0; i < 2; i++) { // knees up in the air: feet (and skis) tucked under the seat
      this.ankle[i].y += lift;
      this.ankle[i].z += lift * 0.25;
      this.skiBase[i].y += lift;
      this.skiBase[i].z += lift * 0.25;
    }
    if (this.seated) {
      pel.set(0, 0.1, -0.1);
      for (let i = 0; i < 2; i++) {
        this.ankle[i].set(i === 0 ? 0.14 : -0.14, -0.42, 0.38);
        this.skiBase[i].copy(this.ankle[i]).y -= this.P.ankle;
      }
    }
    this.qP.setFromEuler(eu.set(0.18 - 0.12 * this.rest + ped * 1.2 + tk * 0.35 + fk * 0.6, by * 0.55 + this.counter.x * 0.4, -incl * 0.8, 'YZX'));
    // knees forward over the skis and into the turn (angulation); legs by IK
    const kb = Math.sign(by) * 0.4 * bk; // hockey stop: knees toward the biting edge
    const kh = this.kneeHint.set(fsx + Math.sin(incl) * 0.6 * (1 - bk) + fsz * kb, 0.1 + fk, fsz - fsx * kb);
    const legs = () => {
      // keep both legs within reach (outside leg long, inside leg folds)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 2; i++) {
          const hp = this.hip[i].set(i === 0 ? this.P.hipW : -this.P.hipW, 0, 0).applyQuaternion(this.qP).add(pel);
          v1.subVectors(this.ankle[i], hp);
          const over = v1.length() - 0.975 * (this.P.thigh + this.P.shin);
          if (over > 0) pel.addScaledVector(v1.normalize(), over);
        }
      }
      // and never folded flat (her boot went into her thigh as her legs kicked in a crash, and in the flips): the
      // foot stays 52 % of the leg's length from the hip
      if (this.hull.length) {
        for (let i = 0; i < 2; i++) {
          v1.subVectors(this.ankle[i], this.hip[i]);
          const short = 0.52 * (this.P.thigh + this.P.shin) - v1.length();
          if (short > 0 && v1.lengthSq() > 1e-8) { v1.normalize().multiplyScalar(short); this.ankle[i].add(v1); this.skiBase[i].add(v1); }
        }
      }
      for (let i = 0; i < 2; i++) {
        this.hip[i].set(i === 0 ? this.P.hipW : -this.P.hipW, 0, 0).applyQuaternion(this.qP).add(pel);
        ik(this.hip[i], this.ankle[i], this.P.thigh, this.P.shin, kh, this.knee[i]);
      }
    };
    legs();
    // her legs never through each other (avatar.ts): in a hard carve the inside knee came down through the outside
    // boot and ski; the feet go apart, 2 cm at a time, until clear
    const solid = this.hull.length > 0 && !this.seated; // (in a crash too: her flailing limbs)
    for (let k = 0; solid && k < 8; k++) {
      this.legBones(kh, up, sk);
      this.refreshHull();
      if (hullOverlap(this.hullNow, LOWER_L, LEG_R, 0.004) <= 0 && hullOverlap(this.hullNow, LOWER_R, LEG_L, 0.004) <= 0) break;
      for (let i = 0; i < 2; i++) {
        v1.set(fsz, 0, -fsx).multiplyScalar(i === 0 ? 0.02 : -0.02); // across the skis
        this.ankle[i].add(v1);
        this.skiBase[i].add(v1);
      }
      legs();
    }

    // spine: forward with the crouch, the comma (upper body more upright than the legs), counter-rotation
    let pitchT = crashed ? 0.4 * flail + Math.sin(t * 8) * 0.3 * flail
      : 0.32 - 0.2 * this.rest + ped * 0.9 + tk * 0.8 + fk * 0.55 + gk * 0.5 + pk * (1 - pf) * 0.3 - (ak - fk - gk) * 0.12 + this.armFwd.x * 0.03;
    // (a grab: the trunk leans over the grabbing hand, so it reaches the ski outside the boot)
    const rollT = -incl * (1 - T.skierAngulation) - sway * 0.6 + shake * 0.12 + (crashed ? Math.sin(t * 6) * 0.4 * flail : 0)
      - gk * 0.35 * (this.grabSide > 0 ? 1 : -1);
    const yawT = this.counter.x + this.spinLead.x + (crashed ? Math.sin(t * 5) * 0.5 * flail : 0);
    const setSpine = () => {
      this.qT.setFromEuler(eu.set(pitchT, yawT, rollT, 'YZX'));
      this.qA.copy(this.qP).slerp(this.qT, 0.5);
      this.abd.set(0, this.P.spineLow, 0).applyQuaternion(this.qP).add(pel);
      this.chest.set(0, this.P.spineMid, 0).applyQuaternion(this.qA).add(this.abd);
      this.neck.set(0, this.P.neck, 0).applyQuaternion(this.qT).add(this.chest);
    };
    this.qU.setFromEuler(eu.set(0, yawT, rollT, 'YZX'));
    setSpine();
    // her body (avatar.ts): legs and torso where they are now; her chest and head kept off her thighs and shins (her
    // down jacket folded into them in the tuck and in the flips): the upper body straightens a little until clear
    if (solid) {
      this.legBones(kh, up, sk);
      for (let k = 0; k < 16; k++) {
        this.torsoBones();
        if (hullOverlap(this.hullNow, UPPER_MASK, LEG_MASK, 0.05) <= 0) break;
        pitchT -= 0.05;
        setSpine();
      }
    }
    // head: stabilised, looks along the velocity and a little into the turn; leads spins; shakes it off after a crash
    const look = speed > 1.5 && !crashed ? clamp(Math.atan2(vlx, vlz), -1.2, 1.2) : 0;
    const hy = look + s.edge * 0.28 + this.spinLead.x * 1.2 + shake * 0.4;
    this.qH.setFromEuler(eu.set(0.12 - tk * 0.3 - fk * 0.3 + gk * 0.2, hy, rollT * 0.4, 'YXZ'));
    this.qH.copy(qa.copy(this.qT).slerp(this.qH, crashed ? 0.2 : 0.85));

    // hands: targets around the shoulders (quiet hands in the upper-body frame), then two-bone IK
    const ins = s.edge >= 0 ? 0 : 1;
    const ef = Math.abs(this.incl.x) / 1.1;
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? 1 : -1;
      const shp = this.shoulder[i].set(this.P.shoulder.x * sg, this.P.shoulder.y, this.P.shoulder.z).applyQuaternion(this.qT).add(this.chest);
      const inside = i === ins ? 1 : 0;
      // stance: forward and wide; carving: outside hand low and forward, inside hand forward and up
      v1.set(sg * 0.24, -0.36 + ef * (inside ? 0.14 : -0.1), 0.36 + ef * (inside ? 0.05 : 0.12));
      v1.y += 0.06 * this.armFwd.x;
      v1.z += 0.2 * this.armFwd.x;
      v1.lerp(v2.set(sg * 0.48, -0.1, 0.18), this.armOut.x); // balance: arms out
      if (wob > 0) { // windmill
        const ph = t * 14 + sg * 1.6;
        v1.y += Math.sin(ph) * 0.28 * wob;
        v1.z += Math.cos(ph) * 0.25 * wob;
      }
      if (crashed) v1.set(sg * (0.35 + 0.25 * st) + Math.sin(t * 10 + i * 4) * 0.3 * flail, 0.15 * st + Math.sin(t * 12 + i) * 0.35 * flail, Math.cos(t * 9 + i * 2) * 0.3 * flail);
      if (pk > 0) v1.lerp(v2.set(sg * 0.22, -0.27 + 0.24 * pf, 0.1 + 0.38 * pf), pk); // double-pole cycle
      v1.z += 0.1 * plantK[i];
      v1.y -= 0.05 * plantK[i];
      // (offsets from the shoulder tuned for our arms: scaled to the model's reach, so shorter arms keep the same angles)
      const reach = (this.P.upperArm + this.P.forearm + this.P.grip) / (UPPER_ARM + FOREARM + GRIP);
      const tg = v3.copy(v1).multiplyScalar(reach).applyQuaternion(this.qU).add(shp);
      if (tk > 0) tg.lerp(v2.set(sg * 0.07, -0.13, 0.2).applyQuaternion(this.qU).add(this.neck), tk); // egg: fists under the chin
      // hold the knees, from the front and outside (lower, on her shins, her forearms crossed her wide ski pants)
      if (fk > 0) tg.lerp(v2.copy(this.knee[i]).add(v1.set(sg * 0.08, 0.05, 0.1)), fk);
      if (gk > 0) {
        if (i === (this.grabSide > 0 ? 0 : 1)) tg.lerp(v2.copy(this.ankle[i]).add(v1.set(sg * 0.09, -0.06, 0.1)), gk); // safety grab
        else tg.lerp(v2.set(sg * 0.5, 0.28, -0.12).multiplyScalar(reach).applyQuaternion(this.qU).add(shp), gk); // style arm
      }
      if (inside && this.dragK.x > 0) tg.lerp(v2.set(pel.x + sg * 0.3, 0.035, pel.z + 0.18), this.dragK.x); // glove on the snow
      if (this.seated) tg.set(sg * 0.2, 0.2, 0.3).add(pel); // hands on the lap
      // her fist out of her legs, her body and her head (a grab, the shins held in a flip, the tuck)
      if (solid) pushOut(tg, HAND_R, this.hullNow, LEG_MASK | TORSO_MASK | SKI_MASK, 0.006, v2.set(sg, 0, 0.3).applyQuaternion(this.qU).normalize());
      // elbows back and down, only a little out: wide-out elbows read as wings on slim arms
      const hint = v2.set(sg * 0.4, -0.55, -0.75).applyQuaternion(this.qU);
      ik(shp, tg, this.P.upperArm, this.P.forearm + this.P.grip, hint, this.elbow[i]);
      // no turn of the elbow clears her arm (a fist flung across her chest in a crash): the fist further out, again
      if (solid && this.swivelElbow(i, shp, tg) > 0) {
        pushOut(tg, HAND_R + 0.1, this.hullNow, LEG_MASK | TORSO_MASK | SKI_MASK, 0.006, v2.set(sg, 0, 0.3).applyQuaternion(this.qU).normalize());
        ik(shp, tg, this.P.upperArm, this.P.forearm + this.P.grip, v2.set(sg * 0.4, -0.55, -0.75).applyQuaternion(this.qU), this.elbow[i]);
        this.swivelElbow(i, shp, tg);
      }
      this.grip[i].copy(tg);
      this.wrist[i].subVectors(tg, this.elbow[i]).normalize().multiplyScalar(this.P.forearm).add(this.elbow[i]);

      // poles: back and down, tip clear of the snow; under the arms in the tuck; planted on the snow ahead / in the push
      const pd = this.poleDir[i].set(sg * 0.3, -0.62, -0.72).applyQuaternion(this.qU).normalize();
      if (this.grip[i].y + pd.y * POLE < 0.05) snowPole(pd, this.grip[i], pd.x, pd.z, 0.05);
      if (ak > 0) pd.lerp(v1.set(sg * 0.4, -0.5, -0.6).applyQuaternion(this.qU), ak);
      if (tk > 0) pd.lerp(v1.set(sg * 0.07, 0.18, -1).applyQuaternion(this.qU), tk);
      pd.normalize();
      if (plantK[i] > 0) {
        snowPole(v1, this.grip[i], sg * 0.4 - this.grip[i].x, 0.8 - this.grip[i].z, 0);
        pd.lerp(v1, plantK[i]).normalize();
      }
      if (planted > 0) {
        snowPole(v1, this.grip[i], sg * 0.3 - this.grip[i].x, 0.25 - (this.pushPhase - 0.3) * 2.2 - this.grip[i].z, 0);
        pd.lerp(v1, planted).normalize();
      }
      if (crashed) pd.set(sg * 0.3, -0.6, -0.5).normalize();
      // on a chair: down past her knees toward the footrest (back, they went through the seat; out, through her
      // neighbour)
      if (this.seated) pd.set(sg * 0.12, -0.7, 0.7).applyQuaternion(this.qU).normalize();
    }

    // bone matrices
    const m = (b: number) => bones[b].matrix;
    m(B.pelvis).compose(pel, this.qP, ONE);
    m(B.spine).compose(this.abd, this.qA, ONE);
    m(B.chest).compose(this.chest, this.qT, ONE);
    m(B.head).compose(this.neck, this.qH, this.firstPerson ? v1.setScalar(0) : ONE);
    for (let i = 0; i < 2; i++) {
      v2.set(0, 0, 1).applyQuaternion(this.qU);
      seg(m(B.upperArmL + i), this.shoulder[i], this.elbow[i], v1.set(0, 0, -1));
      seg(m(B.forearmL + i), this.elbow[i], this.wrist[i], v2);
      seg(m(B.handL + i), this.wrist[i], this.grip[i], v2);
      seg(m(B.thighL + i), this.hip[i], this.knee[i], kh);
      seg(m(B.shinL + i), this.knee[i], this.ankle[i], kh);
      fx.crossVectors(up, sk);
      m(B.footL + i).makeBasis(fx, up, sk).setPosition(this.ankle[i]);
      m(B.skiL + i).makeBasis(fx, up, sk).setPosition(this.skiBase[i]);
    }
    // poles: off her body (her capsules where her bones are now), then their bones
    if (this.hull.length && !crashed) {
      this.refreshHull();
      for (let i = 0; i < 2; i++) {
        const out = v1.set(i === 0 ? 1 : -1, 0, 0).applyQuaternion(this.qU);
        clearSegment(this.grip[i], this.poleDir[i], POLE, 0.02, 0.035, 0.1, this.hullNow, B.forearmL + i, 0.006, out);
        if (segmentDepth(this.grip[i], this.poleDir[i], POLE, 0.02, 0.035, 0.1, this.hullNow, B.forearmL + i, 0.006) > 0) this.swingPole(i, out);
      }
    }
    for (let i = 0; i < 2; i++) seg(m(B.poleL + i), this.grip[i], v1.copy(this.grip[i]).add(this.poleDir[i]), v3.set(i === 0 ? 1 : -1, 0, 0));
  }

  /**
   * The elbow turned round the shoulder–fist axis (15° steps, either way, up to 120°) until her arm clears her legs,
   * her head and, for the forearm, her torso (the upper arm meets it at the shoulder): the nearest clear turn, or the
   * least deep (returned, 0 if clear). Her forearms went through her thighs in the tuck and through her shins in the
   * flips.
   */
  private swivelElbow(i: number, shp: Vector3, tg: Vector3): number {
    const e0 = this.elbow[i], rel = sw1.subVectors(e0, shp), axis = sw2.subVectors(tg, shp).normalize();
    const rU = this.armR[0], rF = this.armR[1];
    const depth = (e: Vector3) => {
      sw4.subVectors(tg, e).normalize().multiplyScalar(this.P.forearm).add(e); // the wrist
      return Math.max(capsuleDepth(shp, e, rU, this.hullNow, LEG_MASK | maskOf(B.head), 0.004), capsuleDepth(e, sw4, rF, this.hullNow, LEG_MASK | TORSO_MASK | SKI_MASK, 0.004));
    };
    let bestD = depth(e0);
    if (bestD <= 0) return 0;
    const best = sw3.copy(e0);
    for (const a of SWIVEL) {
      const e = sw5.copy(rel).applyQuaternion(sq.setFromAxisAngle(axis, a)).add(shp); // (v3 holds the fist)
      const d = depth(e);
      if (d < bestD - 1e-4) { bestD = d; best.copy(e); }
      if (d <= 0) break;
    }
    e0.copy(best);
    return bestD;
  }

  /**
   * A pole still in her after clearSegment (squeezed between her chest and her thigh in a tuck through a turn): swung
   * outward round her up axis (10° steps, to 70°) and tipped up or down (to ±30°), the least turn that clears it,
   * else the shallowest.
   */
  private swingPole(i: number, out: Vector3): void {
    const d0 = pw1.copy(this.poleDir[i]), upA = pw2.set(0, 1, 0).applyQuaternion(this.qU), side = out.dot(pw3.crossVectors(upA, d0)) > 0 ? 1 : -1;
    const across = pw4.crossVectors(d0, upA).normalize();
    let best = Infinity;
    const keep = pw5.copy(d0);
    for (let yaw = 0; yaw <= 7; yaw++) {
      for (const tilt of [0, 1, -1, 2, -2, 3, -3]) {
        const d = pw6.copy(d0).applyQuaternion(sq.setFromAxisAngle(upA, side * yaw * 0.1745)).applyQuaternion(sq.setFromAxisAngle(across, tilt * 0.1745)).normalize();
        const depth = segmentDepth(this.grip[i], d, POLE, 0.02, 0.035, 0.1, this.hullNow, B.forearmL + i, 0.006);
        if (depth < best - 1e-4) { best = depth; keep.copy(d); }
        if (depth <= 0) { this.poleDir[i].copy(keep); return; }
      }
    }
    this.poleDir[i].copy(keep);
  }

  /** The legs' and skis' bone matrices from the pose (body space). */
  private legBones(kh: Vector3, up: Vector3, sk: Vector3): void {
    const bones = this.bones;
    for (let i = 0; i < 2; i++) {
      seg(bones[B.thighL + i].matrix, this.hip[i], this.knee[i], kh);
      seg(bones[B.shinL + i].matrix, this.knee[i], this.ankle[i], kh);
      fx.crossVectors(up, sk);
      bones[B.footL + i].matrix.makeBasis(fx, up, sk).setPosition(this.ankle[i]);
      bones[B.skiL + i].matrix.makeBasis(fx, up, sk).setPosition(this.skiBase[i]);
    }
  }

  /** The torso's bone matrices (the head along the chest, before its own look), then her capsules where they are. */
  private torsoBones(): void {
    const bones = this.bones;
    bones[B.pelvis].matrix.compose(this.pelvis, this.qP, ONE);
    bones[B.spine].matrix.compose(this.abd, this.qA, ONE);
    bones[B.chest].matrix.compose(this.chest, this.qT, ONE);
    bones[B.head].matrix.compose(this.neck, this.qT, ONE);
    this.refreshHull();
  }

  /** Her capsules (avatar.ts) in body space, from the bone matrices as they are now. */
  private refreshHull(): void {
    this.hull.forEach((h, k) => {
      const c = this.hullNow[k], m = this.bones[h.bone].matrix;
      c.a.copy(h.a).applyMatrix4(m);
      c.b.copy(h.b).applyMatrix4(m);
    });
  }

  /** Yard sale: skis and poles leave the body as rigid bodies with their current world pose. */
  private startCrash(s: SkierState, heading: number): void {
    this.crashYaw = s.vel.lengthSq() > 1 ? Math.atan2(s.vel.x, s.vel.z) : heading;
    this.tumble = 0;
    this.settle.x = this.settle.v = 0;
    this.plantT[0] = this.plantT[1] = -1;
    this.mesh.updateMatrixWorld(true);
    for (const l of this.loose) {
      m1.multiplyMatrices(this.mesh.matrixWorld, this.bones[l.bone].matrix).decompose(l.pos, l.q, v1);
      const ski = l.axis === Z;
      const r = () => Math.random() * 2 - 1;
      l.vel.copy(s.vel).multiplyScalar(ski ? 0.8 : 0.65).add(v1.set(r() * 2.5, (ski ? 3.5 : 2.5) + Math.random() * 2, r() * 2));
      l.w.set(r() * 9, r() * 12, r() * 7);
    }
  }

  private endCrash(): void {
    // respawn: loose gear is back on (the bones are posed normally again), quick get-up from a crouch
    this.getUpT = 0;
    this.drop.x = 0.42;
    this.drop.v = 0;
    this.incl.x = this.incl.v = 0;
    this.settle.x = this.settle.v = 0;
    this.body.quaternion.identity();
    this.body.position.set(0, 0, 0);
    this.suspSnap = true;
  }

  private flyLoose(g: Ground, d: number): void {
    m2.copy(this.mesh.matrixWorld).invert();
    if (this.hull.length) {
      // her body this frame (body space), the skis where they fly (not at her feet, where the pose put their bones):
      // the gear bounces off it and off each other
      for (const l of this.loose) this.bones[l.bone].matrix.compose(l.pos, l.q, ONE).premultiply(m2);
      this.refreshHull();
    }
    for (const l of this.loose) {
      l.vel.y -= T.gravity * d;
      l.pos.addScaledVector(l.vel, d);
      qa.set(l.w.x * d * 0.5, l.w.y * d * 0.5, l.w.z * d * 0.5, 1).normalize();
      l.q.premultiply(qa);
      // both ends against the snow
      const ax = v1.copy(l.axis).applyQuaternion(l.q);
      let pen = 0;
      for (let e = -1; e <= 1; e += 2) {
        v2.copy(l.pos).addScaledVector(ax, l.c + e * l.half);
        pen = Math.max(pen, g.height(v2.x, v2.z) + 0.02 - v2.y);
      }
      if (pen > 0) {
        l.pos.y += pen;
        if (l.vel.y < 0) l.vel.y *= -0.3;
        l.vel.x *= 0.8;
        l.vel.z *= 0.8;
        l.w.multiplyScalar(0.7);
        if (l.vel.lengthSq() < 4) { // settle flat on the slope
          const n = g.normal(l.pos.x, l.pos.z, v3);
          v2.copy(ax).addScaledVector(n, -ax.dot(n)).normalize();
          qb.setFromUnitVectors(ax, v2);
          l.q.premultiply(qa.identity().slerp(qb, Math.min(1, d * 10)));
        }
      }
      // off her body and the other pieces (a flying pole went through her head): out along the nearest way, bouncing
      if (this.hull.length) {
        const r = l.axis === Z ? 0.05 : 0.02;
        for (let pass = 0; pass < 3; pass++) {
          const ea = lA.copy(l.pos).addScaledVector(ax, l.c - l.half).applyMatrix4(m2);
          const eb = lB.copy(l.pos).addScaledVector(ax, l.c + l.half).applyMatrix4(m2);
          let moved = false;
          for (const c of this.hullNow) {
            if (c.bone === l.bone) continue;
            closestOnSegments(ea, eb, c.a, c.b, lST);
            lP.copy(ea).lerp(eb, lST[0]);
            lN.copy(c.a).lerp(c.b, lST[1]);
            lN.subVectors(lP, lN);
            const dist = lN.length(), need = c.r + r + 0.005;
            if (dist >= need) continue;
            if (dist < 1e-5) lN.set(0, 1, 0); else lN.divideScalar(dist);
            lN.transformDirection(this.mesh.matrixWorld); // to world
            l.pos.addScaledVector(lN, need - dist);
            const vn = l.vel.dot(lN);
            if (vn < 0) l.vel.addScaledVector(lN, -1.4 * vn);
            moved = true;
          }
          if (!moved) break;
        }
      }
      this.bones[l.bone].matrix.compose(l.pos, l.q, ONE).premultiply(m2);
    }
  }

  /**
   * Planar shadow: project the skinned body onto the ground plane under the skier along the sun (elevation clamped so
   * it stays readable at dawn and dusk); fades and shrinks with height so the air reads.
   */
  private updateShadow(pos: Vector3, g: Ground, sunDir: Vector3, h: number): void {
    const n = g.normal(pos.x, pos.z, v1);
    const gy = g.height(pos.x, pos.z);
    const L = v2.copy(sunDir);
    const minY = Math.sin((T.shadowMinElev * Math.PI) / 180);
    if (L.y < minY) {
      const hz = Math.hypot(L.x, L.z) || 1;
      const c = Math.sqrt(1 - minY * minY) / hz;
      L.set(L.x * c, minY, L.z * c);
    }
    const dnl = n.dot(L);
    const dp = n.x * pos.x + n.y * gy + n.z * pos.z + 0.01;
    const k = 1 - 0.25 * clamp(h / 8, 0, 1);
    const c = 1 - k;
    // X' = X - L (n·X - dp) / (n·L), then scaled by k about the ground point
    const px = L.x / dnl;
    const py = L.y / dnl;
    const pz = L.z / dnl;
    this.shadow.matrix.set(
      k * (1 - px * n.x), -k * px * n.y, -k * px * n.z, k * px * dp + c * pos.x,
      -k * py * n.x, k * (1 - py * n.y), -k * py * n.z, k * py * dp + c * gy,
      -k * pz * n.x, -k * pz * n.y, k * (1 - pz * n.z), k * pz * dp + c * pos.z,
      0, 0, 0, 1,
    );
    this.shadow.matrixWorldNeedsUpdate = true;
    this.shadowMat.opacity = T.shadowOpacity * (1 - 0.55 * clamp(h / 7, 0, 1));
  }
}
