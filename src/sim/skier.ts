import { Vector3 } from 'three';
import { TUNING as T } from '../tuning';
import { clamp, Surface, type Ground, type Obstacle } from './track';

/** steer: -1 left … +1 right (screen space). flip: -1 back … +1 front. jump: edge-triggered. grab: held in the air. */
export interface SkierInput { steer: number; tuck: boolean; brake: boolean; jump: boolean; flip: number; grab?: boolean }

export type LandQuality = 'perfect' | 'clean' | 'sketchy' | 'switch' | 'crash';
export type SkierEvent =
  | { type: 'takeoff' }
  | { type: 'jump' }
  | { type: 'pump' }
  /** Every switch from one carving edge to the other; clean = a held, unskidded turn (the rhythm beat). */
  | { type: 'edgeChange'; clean: boolean; carveTime: number; dir: number }
  | { type: 'grab' }
  /** grab = seconds of grab banked (released before touchdown); lateGrab = still grabbing at touchdown. */
  | { type: 'land'; vn: number; quality: LandQuality; spin: number; flips: number; airTime: number; distance: number; grab?: number; lateGrab?: boolean }
  | { type: 'crash'; reason: 'landing' | 'obstacle' };

export interface SkierState {
  pos: Vector3;
  vel: Vector3;
  /** Ski yaw: forward = (sin h, 0, cos h); 0 = downhill (+z). Steering right decreases it. */
  heading: number;
  yawRate: number;
  airborne: boolean;
  airTime: number;
  takeoffZ: number;
  takeoffX: number;
  spin: number;
  spinVel: number;
  flip: number;
  flipVel: number;
  /** Holding a grab right now (air only), and for how long this jump. */
  grab: boolean;
  grabTime: number;
  /** Signed lateral load / grip in [-1, 1] (+ = turning left): drives lean, spray and carve audio. */
  edge: number;
  /** 0..1 sideways sliding: speed loss, spray, scrape audio. */
  skid: number;
  surface: Surface;
  tuck: boolean;
  braking: boolean;
  crashTimer: number;
  carveDir: number;
  carveTime: number;
  carveIdle: number;
  carveClean: boolean;
  jumpCooldown: number;
  /** Ground normal under the skis (last contact). */
  normal: Vector3;
}

const PI = Math.PI;
const wrapPi = (a: number) => a - 2 * PI * Math.floor((a + PI) / (2 * PI));
const tmpN = new Vector3();
const tmpF = new Vector3();
const tmpC = new Vector3();
const near: Obstacle[] = [];

export function createSkier(g: Ground, x: number, z: number, heading: number): SkierState {
  return {
    pos: new Vector3(x, g.height(x, z), z),
    vel: new Vector3(),
    heading,
    yawRate: 0,
    airborne: false,
    airTime: 0,
    takeoffZ: z,
    takeoffX: x,
    spin: 0,
    spinVel: 0,
    flip: 0,
    flipVel: 0,
    grab: false,
    grabTime: 0,
    edge: 0,
    skid: 0,
    surface: g.surface(x, z),
    tuck: false,
    braking: false,
    crashTimer: 0,
    carveDir: 0,
    carveTime: 0,
    carveIdle: 0,
    carveClean: true,
    jumpCooldown: 0,
    normal: g.normal(x, z, new Vector3()),
  };
}

/** Ski axis projected on the plane of normal n. */
function skiForward(heading: number, n: Vector3, out: Vector3): Vector3 {
  out.set(Math.sin(heading), 0, Math.cos(heading));
  return out.addScaledVector(n, -out.dot(n)).normalize();
}

/** Rotate v around unit axis n (v ⟂ n assumed) by angle a. */
function rotateAround(v: Vector3, n: Vector3, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  tmpC.crossVectors(n, v);
  v.multiplyScalar(c).addScaledVector(tmpC, s);
}

const gripOf = (s: Surface) => (s === Surface.Ice ? T.gripIce : s === Surface.Powder ? T.gripPowder : T.gripGroomed);
const muOf = (s: Surface) => (s === Surface.Ice ? T.muIce : s === Surface.Powder ? T.muPowder : T.muGroomed);

export function stepSkier(s: SkierState, inp: SkierInput, g: Ground, dt: number, ev: SkierEvent[]): void {
  s.jumpCooldown = Math.max(0, s.jumpCooldown - dt);
  if (s.crashTimer > 0) crashStep(s, g, dt);
  else if (s.airborne) airStep(s, inp, g, dt, ev);
  else groundStep(s, inp, g, dt, ev);
}

function groundStep(s: SkierState, inp: SkierInput, g: Ground, dt: number, ev: SkierEvent[]): void {
  const n = g.normal(s.pos.x, s.pos.z, s.normal);
  s.surface = g.surface(s.pos.x, s.pos.z);
  s.braking = inp.brake;
  s.tuck = inp.tuck && !inp.brake;
  let speed = s.vel.length();

  // 1. Ski yaw follows the stick with inertia; authority shrinks with speed.
  const authority = (T.yawRateLow + (T.yawRateHigh - T.yawRateLow) * clamp(speed / T.yawSpeedRef, 0, 1)) * (s.tuck ? T.tuckSteer : 1);
  const target = -clamp(inp.steer, -1, 1) * authority;
  s.yawRate += (target - s.yawRate) * (1 - Math.exp(-dt / T.yawResponse));
  s.heading = wrapPi(s.heading + s.yawRate * dt);
  const f = skiForward(s.heading, n, tmpF);

  // 2. Gravity along the slope (+ pole push when slow and tucking).
  s.vel.addScaledVector(n, T.gravity * n.y * dt);
  s.vel.y -= T.gravity * dt;
  if (s.tuck && speed < T.poleMaxSpeed) s.vel.addScaledVector(f, T.poleAccel * dt);
  speed = s.vel.length();

  // 3. Carving: velocity turns toward the ski axis, at most grip / v rad/s. The rest is skid.
  let decel = 0;
  let edge = 0;
  let skid = 0;
  let dirSign = 1;
  if (speed > 0.05) {
    tmpC.copy(s.vel).divideScalar(speed);
    let cos = tmpC.dot(f);
    let sin = tmpC.cross(f).dot(n);
    if (cos < 0) { cos = -cos; sin = -sin; dirSign = -1; } // gliding backwards along the skis
    const ang = Math.atan2(sin, cos);
    const grip = gripOf(s.surface) * (inp.brake ? 0.3 : 1);
    const maxRot = (grip / Math.max(speed, T.gripMinSpeed)) * dt;
    const rot = clamp(ang, -maxRot, maxRot);
    rotateAround(s.vel, n, rot);
    const misalign = Math.abs(ang - rot);
    skid = clamp(Math.sin(misalign) * 2.5, 0, 1);
    decel += T.skidFriction * Math.sin(misalign);
    edge = clamp(((rot / dt) * speed) / grip, -1, 1);
  }

  // 4. Resistances: Coulomb friction, air drag, powder compaction, brake.
  const cda = inp.brake ? T.cdaBrake : s.tuck ? T.cdaTuck : T.cdaUpright;
  decel += muOf(s.surface) * T.gravity * n.y + ((0.5 * T.airDensity * cda) / T.mass) * speed * speed;
  if (s.surface === Surface.Powder) decel += T.powderDrag * speed;
  if (inp.brake) { decel += T.brakeDecel; skid = Math.max(skid, clamp(speed / 6, 0, 1)); }
  if (decel * dt >= speed) s.vel.set(0, 0, 0);
  else if (speed > 0) s.vel.multiplyScalar(1 - (decel * dt) / speed);
  s.skid += (skid - s.skid) * 0.3;
  s.edge += (edge - s.edge) * 0.3;

  // 5. Pump: a clean edge change after a held carve gives a little push (rhythm, GMA-style).
  pump(s, f, dirSign, inp, dt, ev);

  // 6. Move, then decide: stick to the ground or take off.
  s.pos.addScaledVector(s.vel, dt);
  if (collide(s, g, ev)) return;
  const h = g.height(s.pos.x, s.pos.z);
  const n2 = g.normal(s.pos.x, s.pos.z, tmpN);
  const vn = s.vel.dot(n2);
  if (inp.jump && s.jumpCooldown <= 0) {
    if (s.pos.y < h) s.pos.y = h;
    s.vel.addScaledVector(n2, T.jumpImpulse);
    ev.push({ type: 'jump' });
    takeoff(s, ev);
    return;
  }
  if (s.pos.y > h && vn > (g.launch ?? T.launchThreshold)) {
    takeoff(s, ev);
    return;
  }
  s.pos.y = h;
  const sp = s.vel.length();
  s.vel.addScaledVector(n2, -vn);
  const sp2 = s.vel.length();
  if (sp2 > 1e-9) s.vel.multiplyScalar(sp / sp2); // the normal force does no work: keep |v|
  s.normal.copy(n2);
}

function pump(s: SkierState, f: Vector3, dirSign: number, inp: SkierInput, dt: number, ev: SkierEvent[]): void {
  const dir = Math.abs(s.edge) > 0.3 ? Math.sign(s.edge) : 0;
  if (dir === 0) {
    s.carveIdle += dt;
    if (s.carveIdle > 0.6) s.carveDir = 0;
    return;
  }
  s.carveIdle = 0;
  if (dir === s.carveDir) {
    s.carveTime += dt;
    if (s.skid > 0.35) s.carveClean = false;
    return;
  }
  const speed = s.vel.length();
  if (s.carveDir !== 0) ev.push({ type: 'edgeChange', clean: s.carveTime >= T.pumpMinTurn && s.carveClean && !inp.brake, carveTime: s.carveTime, dir });
  if (s.carveDir !== 0 && s.carveTime >= T.pumpMinTurn && s.carveClean && !inp.brake && speed < T.pumpMaxSpeed && T.pumpBoost > 0) {
    s.vel.addScaledVector(f, T.pumpBoost * dirSign);
    ev.push({ type: 'pump' });
  }
  s.carveDir = dir;
  s.carveTime = 0;
  s.carveClean = s.skid <= 0.35;
}

function takeoff(s: SkierState, ev: SkierEvent[]): void {
  s.airborne = true;
  s.airTime = 0;
  s.spin = 0;
  s.flip = 0;
  s.spinVel = s.yawRate;
  s.flipVel = 0;
  s.grab = false;
  s.grabTime = 0;
  s.takeoffX = s.pos.x;
  s.takeoffZ = s.pos.z;
  s.jumpCooldown = 0.25;
  s.carveDir = 0;
  ev.push({ type: 'takeoff' });
}

function airStep(s: SkierState, inp: SkierInput, g: Ground, dt: number, ev: SkierEvent[]): void {
  s.airTime += dt;
  s.tuck = inp.tuck;
  s.braking = false;
  s.vel.y -= T.gravity * dt;
  const speed = s.vel.length();
  const k = (0.5 * T.airDensity * (inp.tuck ? T.cdaTuck : T.cdaUpright)) / T.mass;
  s.vel.multiplyScalar(1 - Math.min(0.5, k * speed * dt));

  const blend = 1 - Math.exp(-dt / T.airResponse);
  s.spinVel += (-clamp(inp.steer, -1, 1) * T.spinRate - s.spinVel) * blend;
  s.flipVel += (clamp(inp.flip, -1, 1) * T.flipRate - s.flipVel) * blend;
  s.heading = wrapPi(s.heading + s.spinVel * dt);
  s.spin += s.spinVel * dt;
  s.flip += s.flipVel * dt;
  const grab = !!inp.grab && s.airTime > T.grabDelay;
  if (grab && !s.grab) ev.push({ type: 'grab' });
  s.grab = grab;
  if (grab) s.grabTime += dt;
  s.skid *= 0.9;
  s.edge *= 0.9;

  s.pos.addScaledVector(s.vel, dt);
  if (collide(s, g, ev)) return;
  const h = g.height(s.pos.x, s.pos.z);
  if (s.pos.y <= h) land(s, g, h, ev);
}

/** Trees, rocks, other skiers: circles in the ground plane. Fast hit = crash, slow touch = blocked. */
function collide(s: SkierState, g: Ground, ev: SkierEvent[]): boolean {
  if (!g.obstaclesNear) return false;
  for (const o of g.obstaclesNear(s.pos.x, s.pos.z, T.skierRadius + 0.5, near)) {
    const dx = s.pos.x - o.x;
    const dz = s.pos.z - o.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const minD = o.r + T.skierRadius;
    if (d >= minD || s.pos.y - g.height(o.x, o.z) > o.h) continue;
    s.pos.x = o.x + (dx / d) * minD;
    s.pos.z = o.z + (dz / d) * minD;
    if (!s.airborne) s.pos.y = g.height(s.pos.x, s.pos.z);
    if (s.vel.length() > 5) {
      s.vel.multiplyScalar(0.25); // the tree wins
      startCrash(s, ev, 'obstacle');
      return true;
    }
    const into = (s.vel.x * dx + s.vel.z * dz) / d;
    if (into < 0) { s.vel.x -= (into * dx) / d; s.vel.z -= (into * dz) / d; }
  }
  return false;
}

function land(s: SkierState, g: Ground, h: number, ev: SkierEvent[]): void {
  const n = g.normal(s.pos.x, s.pos.z, s.normal);
  s.pos.y = h;
  const vn = Math.max(0, -s.vel.dot(n));
  s.vel.addScaledVector(n, -s.vel.dot(n));
  const speed = s.vel.length();
  const f = skiForward(s.heading, n, tmpF);
  const ang = speed > 0.5 ? Math.acos(clamp(tmpC.copy(s.vel).divideScalar(speed).dot(f), -1, 1)) : 0;
  const flipErr = Math.abs(wrapPi(s.flip));
  const flips = Math.round(Math.abs(s.flip) / (2 * PI));
  let quality: LandQuality;
  if (flipErr > T.landFlipTol || vn > T.landCrashVn) quality = 'crash';
  else if (ang <= T.landCleanAngle) quality = ang <= T.landPerfectAngle && vn < T.landHardVn ? 'perfect' : 'clean';
  else if (ang >= PI - T.landSwitchTol) quality = 'switch';
  else if (ang <= T.landCrashAngle) quality = 'sketchy';
  else quality = 'crash';

  const distance = Math.hypot(s.pos.x - s.takeoffX, s.pos.z - s.takeoffZ);
  const held = s.grabTime >= T.grabMinTime;
  ev.push({ type: 'land', vn, quality, spin: s.spin, flips, airTime: s.airTime, distance, grab: held && !s.grab ? s.grabTime : 0, lateGrab: held && s.grab });
  s.airborne = false;
  s.grab = false;
  s.grabTime = 0;
  s.spin = 0;
  s.flip = 0;
  s.spinVel = 0;
  s.flipVel = 0;
  s.yawRate = 0;
  if (quality === 'crash') {
    startCrash(s, ev, 'landing');
    return;
  }
  if (quality === 'switch') s.vel.multiplyScalar(T.switchLoss);
  if (quality === 'sketchy') s.vel.multiplyScalar(T.sketchyLoss);
  if (vn > T.landHardVn) s.vel.multiplyScalar(1 - T.hardLandMaxLoss * clamp((vn - T.landHardVn) / (T.landCrashVn - T.landHardVn), 0, 1));
  if (quality !== 'sketchy' && speed > 0.5) s.heading = Math.atan2(s.vel.x, s.vel.z); // forgiving: skis snap to the line
}

export function startCrash(s: SkierState, ev: SkierEvent[], reason: 'landing' | 'obstacle'): void {
  s.crashTimer = T.crashDuration;
  s.airborne = false;
  s.grab = false;
  s.tuck = false;
  s.braking = false;
  s.skid = 1;
  s.edge = 0;
  ev.push({ type: 'crash', reason });
}

function crashStep(s: SkierState, g: Ground, dt: number): void {
  s.crashTimer -= dt;
  const speed = s.vel.length();
  const d = T.crashDecel * dt;
  if (d >= speed) s.vel.set(0, 0, 0);
  else s.vel.multiplyScalar(1 - d / speed);
  s.pos.addScaledVector(s.vel, dt);
  s.pos.y = g.height(s.pos.x, s.pos.z);
  const n = g.normal(s.pos.x, s.pos.z, s.normal);
  s.vel.addScaledVector(n, -s.vel.dot(n));
  if (s.crashTimer <= 0) respawn(s, g);
}

function respawn(s: SkierState, g: Ground): void {
  const r = g.respawn ? g.respawn(s.pos.z, s.pos.x) : { x: s.pos.x, z: s.pos.z, heading: 0 };
  s.crashTimer = 0;
  s.pos.set(r.x, g.height(r.x, r.z), r.z);
  s.heading = r.heading;
  const n = g.normal(r.x, r.z, s.normal);
  s.vel.copy(skiForward(s.heading, n, tmpF)).multiplyScalar(T.respawnSpeed);
  s.yawRate = 0;
  s.skid = 0;
  s.edge = 0;
  s.carveDir = 0;
  s.airborne = false;
}
