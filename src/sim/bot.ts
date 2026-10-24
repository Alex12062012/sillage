import { TUNING as T } from '../tuning';
import type { SkierInput, SkierState } from './skier';
import type { Obstacle, Track } from './track';

const near: Obstacle[] = [];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Distance from point (px, pz) to segment (ax, az)-(bx, bz) in the ground plane. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

export interface BotMemory { offset: number }

/**
 * The simplest possible "player": pick the clearest lane a little ahead (preferring the current one),
 * hold a target speed (tuck / brake), never steer in the air. Used to prove the runs are finishable
 * without tricks, and to drive the browser for captures and FPS benchmarks.
 * `gap` < 1.6 m deliberately shaves obstacles (near-miss demo).
 */
export function botInput(s: SkierState, t: Track, out: SkierInput, targetSpeed: number, gap = 2.4, mem: BotMemory = { offset: 0 }): SkierInput {
  out.jump = false;
  out.flip = 0;
  out.grab = false;
  if (s.airborne) {
    out.steer = 0;
    out.brake = false;
    out.tuck = false;
    return out;
  }
  const speed = s.vel.length();
  const look = 12 + speed * 0.7;
  // the line a little ahead: down the corridor (+z, lanes along x), or down the piste under the skier
  const g = t.guide?.(s.pos.x, s.pos.z, look);
  const aheadZ = g ? g.z : s.pos.z + look;
  const cx = g ? g.x : t.centerX(aheadZ);
  const hw = g ? g.hw : t.def.halfWidth;
  const fl = g ? Math.hypot(cx - s.pos.x, aheadZ - s.pos.z) || 1 : 1;
  const fx = g ? (cx - s.pos.x) / fl : 0;
  const fz = g ? (aheadZ - s.pos.z) / fl : 1;
  const obstacles = t.obstaclesNear(s.pos.x + (fx * look) / 2, s.pos.z + (fz * look) / 2, look / 2 + 6, near)
    .filter((o) => (o.x - s.pos.x) * fx + (o.z - s.pos.z) * fz > 0.5);
  let best = mem.offset;
  let bestScore = -Infinity;
  for (let o = -(hw - 2.5); o <= hw - 2.5 + 1e-6; o += 1.25) {
    const ax = cx + o * fz;
    const az = aheadZ - o * fx;
    let clear = gap + 1;
    for (const ob of obstacles) {
      clear = Math.min(clear, segDist(ob.x, ob.z, s.pos.x, s.pos.z, ax, az) - ob.r - T.skierRadius);
    }
    const score = Math.min(clear, gap + 1) * 10 - Math.abs(o - mem.offset) * 0.35 - Math.abs(o) * 0.12;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  mem.offset = best;
  let desired = g ? Math.atan2(cx + best * fz - s.pos.x, aheadZ - best * fx - s.pos.z) : Math.atan2(cx + best - s.pos.x, look);
  const current = speed > 1 ? Math.atan2(s.vel.x, s.vel.z) : s.heading;
  // emergency: something within ~0.7 s sits on the current line → turn away from it now
  const vx = Math.sin(current);
  const vz = Math.cos(current);
  for (const ob of obstacles) {
    const dx = ob.x - s.pos.x;
    const dz = ob.z - s.pos.z;
    const along = dx * vx + dz * vz;
    if (along < 0 || along > Math.max(6, speed * 0.7)) continue;
    const lateral = dx * vz - dz * vx;
    if (Math.abs(lateral) < ob.r + T.skierRadius + 1.2) desired = current - Math.sign(lateral || 1) * 0.9;
  }
  const err = wrap(desired - current);
  out.steer = Math.max(-1, Math.min(1, -err * 2.4));
  out.brake = (speed > targetSpeed * 1.08 && Math.abs(err) < 0.15) || speed > targetSpeed * 1.35; // braking kills grip: turn first
  out.tuck = !out.brake && speed < targetSpeed * 0.9 && Math.abs(err) < 0.12;
  return out;
}
