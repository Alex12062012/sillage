import { PerspectiveCamera, Vector3 } from 'three';

const tmp = new Vector3();

/** Low chase camera that follows the velocity (not the skis), so spins don't swing the view. */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private dir = new Vector3(0, 0, 1);
  private pos = new Vector3();
  private look = new Vector3();
  height = 2.1;
  distance = 4.6;
  lookAhead = 6;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(72, aspect, 0.1, 900);
  }

  snap(target: Vector3, heading: number): void {
    this.dir.set(Math.sin(heading), 0, Math.cos(heading));
    this.desired(target, this.pos);
    this.look.copy(target).addScaledVector(this.dir, this.lookAhead);
    this.apply();
  }

  update(target: Vector3, vel: Vector3, dt: number): void {
    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 1) {
      tmp.set(vel.x / hs, 0, vel.z / hs);
      this.dir.lerp(tmp, 1 - Math.exp(-dt / 0.22)).normalize();
    }
    this.desired(target, tmp);
    this.pos.lerp(tmp, 1 - Math.exp(-dt / 0.09));
    tmp.copy(target).addScaledVector(this.dir, this.lookAhead);
    tmp.y += 0.6;
    this.look.lerp(tmp, 1 - Math.exp(-dt / 0.06));
    this.apply();
  }

  private desired(target: Vector3, out: Vector3): Vector3 {
    return out.copy(target).addScaledVector(this.dir, -this.distance).setY(target.y + this.height);
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
