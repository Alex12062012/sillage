import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { SkierState } from '../sim/skier';
import { TUNING as T } from '../tuning';

const tmp = new Vector3();

/** Pure mapping speed → FOV (degrees) before smoothing. Exported for tests. */
export function targetFov(speed: number, tuck: boolean): number {
  return T.fovBase + T.fovMaxBoost * MathUtils.smoothstep(speed, T.fovSpeedMin, T.fovSpeedRef) + (tuck ? T.fovTuckBoost : 0);
}

/** Cheap smooth noise in [-1,1] (sum of incommensurate sines). */
const noise = (t: number, seed: number) =>
  (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.17 + seed * 2.3) * 0.2);

/**
 * Low chase camera: follows the velocity (stable during spins), breathes when slow, rolls and dips a
 * little into carves, pulls back in the air, dips on impacts (spring), widens its FOV with speed and
 * beats, shakes with trauma² (Eiserloh), and swings round to the front for the finish run-out.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  comfort = false;
  firstPerson = false;
  private dir = new Vector3(0, 0, 1);
  private pos = new Vector3();
  private look = new Vector3();
  private fov = T.fovBase;
  private punch = 0;
  private roll = 0;
  private pull = 0;
  private trauma = 0;
  private t = 0;
  private dipY = 0;
  private dipV = 0;
  private orbit = -1; // finish-shot clock (s), -1 = off

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(T.fovBase, aspect, 0.2, 3000);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  fovPunch(): void {
    this.fovKick(T.fovPunch);
  }

  fovKick(deg: number): void {
    this.punch = Math.max(this.punch, deg);
  }

  /** A clean carving beat: a small FOV pulse that grows with the flow level. */
  beat(level: number): void {
    this.fovKick(T.beatFovKick + level * 0.4);
  }

  /** Landing impact: the lens dips and springs back, ∝ impact speed. */
  impact(vn: number): void {
    if (!this.comfort) this.dipV -= Math.min(vn, 14) * T.camImpactDip * 23;
  }

  /** Finish run-out: swing round to face the skier's hockey stop. */
  finishShot(): void {
    if (!this.firstPerson) this.orbit = 0;
  }

  snap(target: Vector3, heading: number): void {
    this.dir.set(Math.sin(heading), 0, Math.cos(heading));
    this.pos.copy(target).addScaledVector(this.dir, -T.camDistance).setY(target.y + T.camHeight);
    this.look.copy(target).addScaledVector(this.dir, T.camLookAhead);
    this.trauma = 0;
    this.punch = 0;
    this.pull = 0;
    this.dipY = 0;
    this.dipV = 0;
    this.orbit = -1;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** `ground(x, z)` keeps the lens above the snow on steep slopes and banks. */
  update(target: Vector3, s: SkierState, dt: number, ground?: (x: number, z: number) => number): void {
    this.t += dt;
    const speed = s.vel.length();
    const hs = Math.hypot(s.vel.x, s.vel.z);
    if (hs > 1 && s.crashTimer <= 0) {
      tmp.set(s.vel.x / hs, 0, s.vel.z / hs);
      this.dir.lerp(tmp, 1 - Math.exp(-dt / 0.22)).normalize();
    }

    // FOV: speed + tuck + near-miss punch, smoothed (fixed in comfort mode)
    const want = this.comfort ? T.fovBase : targetFov(speed, s.tuck) + this.punch;
    this.fov += (want - this.fov) * (1 - Math.exp(-dt / T.fovSmoothing));
    this.punch *= Math.exp(-dt / 0.35);

    if (this.firstPerson) {
      this.pos.copy(target).setY(target.y + 1.55);
      tmp.copy(target).addScaledVector(this.dir, 12);
      tmp.y = target.y + 0.4;
      this.look.lerp(tmp, 1 - Math.exp(-dt / 0.05));
    } else {
      this.pull += ((s.airborne ? T.camAirPullback : 0) - this.pull) * (1 - Math.exp(-dt / 0.35));
      // impact spring (~2.2 Hz, ζ ≈ 0.55), integrated in real time
      this.dipV += (-191 * this.dipY - 15 * this.dipV) * Math.min(dt, 0.05);
      this.dipY += this.dipV * Math.min(dt, 0.05);
      const carveDrop = this.comfort || s.airborne ? 0 : T.camCarveDrop * Math.abs(s.edge) * MathUtils.smoothstep(speed, 8, 25);
      if (this.orbit >= 0) {
        // finish shot: from behind to three-quarter front, a little further and lower
        this.orbit += dt;
        const k = MathUtils.smootherstep(this.orbit, 0, 1.8);
        const a = k * 2.3;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const dist = T.camDistance + 1.6 * k;
        tmp.set(target.x - (this.dir.x * c - this.dir.z * sn) * dist, 0, target.z - (this.dir.x * sn + this.dir.z * c) * dist);
        tmp.y = target.y + T.camHeight - 0.35 * k;
      } else {
        tmp.copy(target).addScaledVector(this.dir, -(T.camDistance + this.pull));
        tmp.y = target.y + T.camHeight + this.pull * 0.4 - carveDrop;
      }
      if (speed < 4 && !this.comfort) tmp.y += Math.sin(this.t * Math.PI * 0.5) * T.camBreath; // breathing
      if (ground) {
        // never inside the slope behind the skier, and never hidden by a bank in between
        tmp.y = Math.max(tmp.y, ground(tmp.x, tmp.z) + 1.3);
        const mx = (tmp.x + target.x) / 2;
        const mz = (tmp.z + target.z) / 2;
        const lift = ground(mx, mz) + 0.9 - (tmp.y + target.y) / 2;
        if (lift > 0) tmp.y += lift * 2;
      }
      this.pos.lerp(tmp, 1 - Math.exp(-dt / (this.orbit >= 0 ? 0.2 : 0.09)));
      if (ground) this.pos.y = Math.max(this.pos.y, ground(this.pos.x, this.pos.z) + 0.9);
      if (this.orbit >= 0) tmp.copy(target).setY(target.y + 0.9); // frame the skier
      else {
        tmp.copy(target).addScaledVector(this.dir, T.camLookAhead);
        tmp.y += 0.6;
      }
      this.look.lerp(tmp, 1 - Math.exp(-dt / (this.orbit >= 0 ? 0.15 : 0.06)));
    }

    // roll into carves
    const wantRoll = this.comfort ? 0 : -s.edge * MathUtils.degToRad(T.camRollMax);
    this.roll += (wantRoll - this.roll) * (1 - Math.exp(-dt / 0.25));

    // shake = trauma² + a fine speed rumble
    this.trauma = Math.max(0, this.trauma - T.traumaDecay * dt);
    const shake = this.comfort ? 0 : this.trauma * this.trauma;
    const rumble = this.comfort || s.airborne ? 0 : T.speedRumble * MathUtils.smoothstep(speed, 19, 33);
    const ft = this.t * T.shakeFreq;
    this.camera.position.copy(this.pos);
    this.camera.position.x += noise(ft, 1) * (shake * T.shakeMaxOffset + rumble);
    this.camera.position.y += noise(ft, 2) * (shake * T.shakeMaxOffset + rumble) + this.dipY;
    this.camera.lookAt(this.look);
    this.camera.rotateZ(this.roll + noise(ft, 3) * shake * MathUtils.degToRad(T.shakeMaxRoll));

    // portrait screens keep a usable horizontal field
    const a = this.camera.aspect;
    const vfov = a >= 1 ? this.fov : MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(this.fov) / 2) / Math.pow(a, 0.55)));
    if (Math.abs(vfov - this.camera.fov) > 0.01) {
      this.camera.fov = Math.min(vfov, 100);
      this.camera.updateProjectionMatrix();
    }
  }

  get currentFov(): number {
    return this.fov;
  }
}
