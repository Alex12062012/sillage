import {
  BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshLambertMaterial, Quaternion, Vector3,
  type BufferGeometry,
} from 'three';
import type { SkierState } from '../sim/skier';
import type { Ground } from '../sim/track';

export interface SkierColors { jacket: number; pants: number; helmet: number; skis: number }
export const DEFAULT_COLORS: SkierColors = { jacket: 0xff6b4a, pants: 0x2b3a55, helmet: 0xf4f6fa, skis: 0x3a7bd5 };

const mat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });
/** Box whose origin sits at one end, so it can rotate around a joint. */
function limb(w: number, len: number, d: number, m: MeshLambertMaterial): Mesh {
  const g: BufferGeometry = new BoxGeometry(w, len, d);
  g.translate(0, len / 2, 0);
  return new Mesh(g, m);
}

const SHIN = 0.46;
const THIGH = 0.46;
const ANKLE_Y = 0.13;
const up = new Vector3(0, 1, 0);
const qa = new Quaternion();
const qb = new Quaternion();
const tmp = new Vector3();

/**
 * Low-poly skier with a procedural pose: knees/hips flex with tuck, the body leans into carves
 * (lateral load), skis go sideways on a hockey-stop brake, arms balance in the air, and a crash is a
 * tumble with the skis flying off ("yard sale").
 */
export class SkierModel {
  readonly root = new Group();
  private lean = new Group();
  private body = new Group();
  private skis = new Group();
  private parts: Record<string, Mesh> = {};
  private mats: Record<keyof SkierColors, MeshLambertMaterial>;
  private crouch = 0.3;
  private leanAngle = 0;
  private brakeYaw = 0;
  private arms = 0;
  private tumble = 0;
  private loose: { mesh: Mesh; pos: Vector3; vel: Vector3; spin: number }[] = [];
  private wasCrashed = false;

  constructor(colors: SkierColors = DEFAULT_COLORS) {
    this.mats = { jacket: mat(colors.jacket), pants: mat(colors.pants), helmet: mat(colors.helmet), skis: mat(colors.skis) };
    const dark = mat(0x222c3a);
    const grey = mat(0x9aa4b2);
    const lens = mat(0xffa94d);

    // skis + boots
    for (const side of [-1, 1]) {
      const ski = new Mesh(new BoxGeometry(0.095, 0.03, 1.66), this.mats.skis);
      ski.position.set(side * 0.12, 0.015, 0.05);
      const tip = new Mesh(new BoxGeometry(0.095, 0.03, 0.18), this.mats.skis);
      tip.position.set(side * 0.12, 0.05, 0.92);
      tip.rotation.x = -0.45;
      const boot = new Mesh(new BoxGeometry(0.13, 0.15, 0.3), dark);
      boot.position.set(side * 0.12, 0.09, 0);
      this.skis.add(ski, tip, boot);
      this.parts[side < 0 ? 'skiR' : 'skiL'] = ski;
    }
    // legs, torso, head, arms, poles
    for (const n of ['shinL', 'shinR']) this.parts[n] = limb(0.12, SHIN, 0.13, this.mats.pants);
    for (const n of ['thighL', 'thighR']) this.parts[n] = limb(0.15, THIGH, 0.16, this.mats.pants);
    this.parts.torso = limb(0.38, 0.56, 0.24, this.mats.jacket);
    this.parts.head = new Mesh(new IcosahedronGeometry(0.15, 0), this.mats.helmet);
    this.parts.goggles = new Mesh(new BoxGeometry(0.24, 0.07, 0.06), lens);
    for (const n of ['armL', 'armR']) this.parts[n] = limb(0.1, 0.56, 0.1, this.mats.jacket);
    for (const n of ['poleL', 'poleR']) {
      const g = new CylinderGeometry(0.012, 0.012, 1.15, 5);
      g.translate(0, -0.575, 0);
      this.parts[n] = new Mesh(g, grey);
    }
    for (const k of ['shinL', 'shinR', 'thighL', 'thighR', 'torso', 'head', 'goggles', 'armL', 'armR', 'poleL', 'poleR']) {
      this.body.add(this.parts[k]);
    }
    this.lean.add(this.skis, this.body);
    this.root.add(this.lean);
    this.pose(0.3, 0);
  }

  setColors(c: SkierColors): void {
    for (const k of Object.keys(c) as (keyof SkierColors)[]) this.mats[k].color.setHex(c[k]);
  }

  /** Sagittal-plane pose: c = crouch 0..1, a = arm raise 0..1. Local frame: +z forward, +x left. */
  private pose(c: number, a: number): void {
    const p = this.parts;
    const shinA = 0.22 + 0.5 * c; // shin tilts forward
    const thighA = 0.3 + 0.95 * c; // thigh tilts back from the knee
    const backA = 0.2 + 0.85 * c; // torso pitches forward
    const kneeZ = Math.sin(shinA) * SHIN;
    const kneeY = ANKLE_Y + Math.cos(shinA) * SHIN;
    const hipZ = kneeZ - Math.sin(thighA) * THIGH;
    const hipY = kneeY + Math.cos(thighA) * THIGH;
    for (const [side, s] of [[1, 'L'], [-1, 'R']] as const) {
      const x = side * 0.12;
      p['shin' + s].position.set(x, ANKLE_Y, 0);
      p['shin' + s].rotation.set(shinA, 0, 0);
      p['thigh' + s].position.set(x, kneeY, kneeZ);
      p['thigh' + s].rotation.set(-thighA, 0, 0);
    }
    p.torso.position.set(0, hipY, hipZ);
    p.torso.rotation.set(backA, 0, 0);
    const shoulderY = hipY + Math.cos(backA) * 0.52;
    const shoulderZ = hipZ + Math.sin(backA) * 0.52;
    p.head.position.set(0, shoulderY + Math.cos(backA) * 0.2, shoulderZ + Math.sin(backA) * 0.2 + 0.02);
    p.goggles.position.set(0, p.head.position.y + 0.01, p.head.position.z + 0.13);
    // arms hang forward and down; tuck brings them in front of the knees; air raises them out
    const armPitch = 2.6 - 0.9 * c + 0.4 * a;
    for (const [side, s] of [[1, 'L'], [-1, 'R']] as const) {
      const arm = p['arm' + s];
      arm.position.set(side * 0.22, shoulderY - 0.06, shoulderZ);
      arm.rotation.set(armPitch, 0, side * (0.25 + 0.9 * a));
      const pole = p['pole' + s];
      tmp.set(0, 0.56, 0).applyEuler(arm.rotation).add(arm.position);
      pole.position.copy(tmp);
      pole.rotation.set(0.5 + 0.6 * c, 0, side * 0.12);
    }
  }

  update(s: SkierState, pos: Vector3, heading: number, g: Ground, dt: number): void {
    const k = 1 - Math.exp(-dt / 0.1);
    const crashed = s.crashTimer > 0;
    const wantCrouch = crashed ? 0.9 : s.airborne ? 0.35 : s.tuck ? 1 : s.braking ? 0.55 : 0.3 + Math.abs(s.edge) * 0.35;
    this.crouch += (wantCrouch - this.crouch) * k;
    this.arms += ((s.airborne ? 1 : 0) - this.arms) * k;
    this.pose(this.crouch, this.arms);

    // lean into the turn (physics edge = lateral load / grip)
    const wantLean = crashed || s.airborne ? 0 : -s.edge * 0.75;
    this.leanAngle += (wantLean - this.leanAngle) * (1 - Math.exp(-dt / 0.08));
    this.lean.rotation.z = this.leanAngle;
    // hockey-stop: skis and body swing ~65° across the line, toward the current turn
    const wantBrake = s.braking && !s.airborne ? (s.edge >= 0 ? 1.15 : -1.15) * Math.min(1, s.vel.length() / 4) : 0;
    this.brakeYaw += (wantBrake - this.brakeYaw) * (1 - Math.exp(-dt / 0.1));
    this.lean.rotation.y = this.brakeYaw;
    // flips pivot around the centre of mass (~0.9 m up), not the feet
    const flip = s.airborne ? s.flip : 0;
    this.lean.rotation.x = flip;
    this.lean.position.set(0, 0.9 * (1 - Math.cos(flip)), -0.9 * Math.sin(flip));

    // align to ground (blend toward vertical in the air), then yaw
    this.root.position.copy(pos);
    qa.setFromUnitVectors(up, s.airborne ? tmp.copy(s.normal).lerp(up, 0.6).normalize() : s.normal);
    qb.setFromAxisAngle(up, heading);
    this.root.quaternion.copy(qa).multiply(qb);

    this.crash(s, g, dt, crashed);
  }

  private crash(s: SkierState, g: Ground, dt: number, crashed: boolean): void {
    if (crashed && !this.wasCrashed) {
      this.tumble = 0;
      this.skis.visible = false;
      for (const [side, n] of [[1, 'skiL'], [-1, 'skiR']] as const) {
        const m = this.parts[n].clone();
        m.position.copy(this.root.position);
        this.root.parent?.add(m);
        this.loose.push({
          mesh: m, pos: m.position, spin: (side * 6 + (Math.random() - 0.5) * 4),
          vel: new Vector3(s.vel.x * 0.6 + side * 2, 4 + Math.random() * 2, s.vel.z * 0.6),
        });
      }
    }
    if (!crashed && this.wasCrashed) {
      this.skis.visible = true;
      for (const l of this.loose) l.mesh.removeFromParent();
      this.loose.length = 0;
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
    }
    this.wasCrashed = crashed;
    if (!crashed) return;
    this.tumble += dt;
    const roll = Math.min(1, this.tumble / 0.7);
    this.body.rotation.x = roll * Math.PI * 0.5 + Math.sin(this.tumble * 9) * 0.15 * (1 - roll);
    this.body.position.y = -0.35 * roll;
    for (const l of this.loose) {
      l.vel.y -= 11 * dt;
      l.pos.addScaledVector(l.vel, dt);
      const h = g.height(l.pos.x, l.pos.z) + 0.03;
      if (l.pos.y < h) { l.pos.y = h; l.vel.multiplyScalar(0.6); l.vel.y = Math.abs(l.vel.y) * 0.3; l.spin *= 0.7; }
      l.mesh.rotation.y += l.spin * dt;
    }
  }
}
