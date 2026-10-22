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
 * Low chase camera: follows the velocity (stable during spins), breathes when slow, rolls a little into
 * carves, pulls back in the air, widens its FOV with speed and shakes with trauma² (Eiserloh).
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

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(T.fovBase, aspect, 0.1, 1200);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  fovPunch(): void {
    this.punch = T.fovPunch;
  }

  snap(target: Vector3, heading: number): void {
    this.dir.set(Math.sin(heading), 0, Math.cos(heading));
    this.pos.copy(target).addScaledVector(this.dir, -T.camDistance).setY(target.y + T.camHeight);
    this.look.copy(target).addScaledVector(this.dir, T.camLookAhead);
    this.trauma = 0;
    this.punch = 0;
    this.pull = 0;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(target: Vector3, s: SkierState, dt: number): void {
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
      tmp.copy(target).addScaledVector(this.dir, -(T.camDistance + this.pull));
      tmp.y = target.y + T.camHeight + this.pull * 0.4;
      if (speed < 4 && !this.comfort) tmp.y += Math.sin(this.t * Math.PI * 0.5) * T.camBreath; // breathing
      this.pos.lerp(tmp, 1 - Math.exp(-dt / 0.09));
      tmp.copy(target).addScaledVector(this.dir, T.camLookAhead);
      tmp.y += 0.6;
      this.look.lerp(tmp, 1 - Math.exp(-dt / 0.06));
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
    this.camera.position.y += noise(ft, 2) * (shake * T.shakeMaxOffset + rumble);
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
