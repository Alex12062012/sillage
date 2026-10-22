import { Vector3 } from 'three';
import { Surface, type Ground } from '../../src/sim/track';
import { createSkier, stepSkier, type SkierEvent, type SkierInput, type SkierState } from '../../src/sim/skier';

export const DT = 1 / 60;
export const kmh = (v: number) => v * 3.6;
export const ms = (kmhValue: number) => kmhValue / 3.6;

export const input = (over: Partial<SkierInput> = {}): SkierInput => ({
  steer: 0, tuck: false, brake: false, jump: false, flip: 0, ...over,
});

/** Infinite plane descending toward +z at `deg`, with an optional height offset field. */
export function slopeGround(deg: number, extra?: (x: number, z: number) => number, surface = Surface.Groomed): Ground {
  const t = Math.tan((deg * Math.PI) / 180);
  const height = (x: number, z: number) => -z * t + (extra ? extra(x, z) : 0);
  return {
    height,
    normal(x, z, out = new Vector3()) {
      const e = 0.05;
      const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
      const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
      return out.set(-dx, 1, -dz).normalize();
    },
    surface: () => surface,
  };
}

export function skierAt(ground: Ground, z = 0, speed = 0, heading = 0): SkierState {
  const s = createSkier(ground, 0, z, heading);
  s.vel.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed);
  const n = ground.normal(0, z, new Vector3());
  s.vel.addScaledVector(n, -s.vel.dot(n));
  if (speed > 0) s.vel.setLength(speed);
  return s;
}

/** Steps the skier for `seconds`, calling `drive` each step to choose the input. Returns all events. */
export function simulate(
  s: SkierState,
  ground: Ground,
  seconds: number,
  drive: (s: SkierState, t: number) => SkierInput = () => input(),
  onStep?: (s: SkierState, t: number, events: SkierEvent[]) => void,
): SkierEvent[] {
  const all: SkierEvent[] = [];
  const events: SkierEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    events.length = 0;
    stepSkier(s, drive(s, i * DT), ground, DT, events);
    all.push(...events);
    onStep?.(s, (i + 1) * DT, events);
  }
  return all;
}

/** Signed heading (rad) of the horizontal velocity, 0 = +z. */
export const velHeading = (s: SkierState) => Math.atan2(s.vel.x, s.vel.z);
