import type { SkierInput, SkierState } from './skier';
import type { Obstacle, Track } from './track';

const near: Obstacle[] = [];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The simplest possible "player": aim at the piste centre a little ahead, sidestep trees on the line,
 * tuck when slow and straight, brake when too fast. Used to prove the tracks are finishable without
 * tricks, and to drive the browser for captures and FPS benchmarks.
 */
export function botInput(s: SkierState, t: Track, out: SkierInput, targetSpeed: number, gap = 2.4): SkierInput {
  const speed = s.vel.length();
  const look = 10 + speed * 0.6;
  const aheadZ = s.pos.z + look;
  let aimX = t.centerX(aheadZ);
  // dodge: any obstacle within the next ~2 s whose disc crowds the line → aim to pass it at `gap` m
  for (const o of t.obstaclesNear(s.pos.x, s.pos.z + look * 0.6, look, near)) {
    if (o.z < s.pos.z + 1 || o.z > aheadZ + 4) continue;
    const lineX = s.pos.x + (aimX - s.pos.x) * ((o.z - s.pos.z) / look);
    const lateral = lineX - o.x;
    const clear = o.r + gap;
    if (Math.abs(lateral) < clear) aimX = o.x + (lateral >= 0 ? 1 : -1) * (clear + 0.6) * (look / Math.max(2, o.z - s.pos.z));
  }
  const desired = Math.atan2(aimX - s.pos.x, aheadZ - s.pos.z);
  const current = speed > 1 ? Math.atan2(s.vel.x, s.vel.z) : s.heading;
  const err = wrap(desired - current);
  out.steer = Math.max(-1, Math.min(1, -err * 2.4));
  out.brake = speed > targetSpeed * 1.08;
  out.tuck = !out.brake && speed < targetSpeed * 0.9 && Math.abs(err) < 0.12;
  out.jump = false;
  out.flip = 0;
  return out;
}
