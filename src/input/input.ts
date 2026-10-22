import type { SkierInput } from '../sim/skier';

const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

/**
 * Collects keyboard (and later touch / gamepad / tilt) into one SkierInput per physics step.
 * Digital steering is ramped so a tap gives a small carve and a hold a full one.
 */
export class Input {
  readonly keys = new Set<string>();
  /** Scripted override used by tests and the debug API (window.__sillage.drive). */
  override: Partial<SkierInput> | null = null;
  private steer = 0;
  private jumpQueued = false;
  private airLockSteer = false;
  private airLockFlip = false;
  onKey: ((code: string) => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.onKey?.(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Inputs held at takeoff must be released before they spin or flip (no accidental tricks). */
  lockAirInputs(): void {
    this.airLockSteer = this.steer !== 0;
    this.airLockFlip = this.has('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS');
  }

  sample(out: SkierInput, dt: number, airborne: boolean): SkierInput {
    const left = this.has('ArrowLeft', 'KeyA');
    const right = this.has('ArrowRight', 'KeyD');
    const up = this.has('ArrowUp', 'KeyW');
    const down = this.has('ArrowDown', 'KeyS');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    this.steer = approach(this.steer, target, dt / (target === 0 ? 0.06 : 0.15));

    out.steer = this.steer;
    out.tuck = up;
    out.brake = down;
    out.jump = this.jumpQueued;
    out.flip = (down ? 1 : 0) - (up ? 1 : 0);
    this.jumpQueued = false;

    if (airborne) {
      if (this.airLockSteer && target === 0) this.airLockSteer = false;
      if (this.airLockFlip && !up && !down) this.airLockFlip = false;
      if (this.airLockSteer) out.steer = 0;
      if (this.airLockFlip) out.flip = 0;
    }
    if (this.override) Object.assign(out, this.override);
    return out;
  }
}
