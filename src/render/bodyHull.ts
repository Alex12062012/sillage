import { Vector3 } from 'three';

/**
 * The realistic skier's body as capsules fixed to our bones, measured on her mesh (avatar.ts), so a pole can be kept
 * off her: a pole only knows its fist and its direction, and the poses (tuck, carve, grab, flips) aimed it through
 * her chest or her thighs.
 */
export interface HullPart { bone: number; a: Vector3; b: Vector3; r: number }

const pct = (v: number[], q: number) => {
  const s = [...v].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/** Unit principal axis of points about their centre (power iteration on the covariance). */
function principal(pts: Vector3[], c: Vector3): Vector3 {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  const v = new Vector3(0.1, 1, 0.1);
  for (let k = 0; k < 50; k++) v.set(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z).normalize();
  return v;
}

/**
 * Capsules round `pts` along `axis` through `c`, one per slice of the bulk (2 % to 98 % along the axis), each as wide as
 * `q` of its slice's points: a tapered limb (wide at the hip, thin at the knee) stays snug.
 */
function slices(bone: number, pts: Vector3[], c: Vector3, axis: Vector3, q: number, k: number, out: HullPart[]): void {
  const t = pts.map((p) => p.clone().sub(c).dot(axis));
  const d = pts.map((p, i) => p.clone().sub(c).addScaledVector(axis, -t[i]).length());
  const t0 = pct(t, 0.02), t1 = pct(t, 0.98), step = (t1 - t0) / k;
  for (let s = 0; s < k; s++) {
    const lo = t0 + s * step, hi = lo + step;
    const ds = d.filter((_, i) => t[i] >= lo - 1e-6 && t[i] <= hi + 1e-6);
    if (ds.length < 4) continue;
    const r = pct(ds, q);
    // the capsule's ends round off past its slice: pull them in by half the radius (the neighbours overlap anyway)
    const a = Math.min(lo + r * 0.5, (lo + hi) / 2), b = Math.max(hi - r * 0.5, (lo + hi) / 2);
    out.push({ bone, a: c.clone().addScaledVector(axis, a), b: c.clone().addScaledVector(axis, b), r });
  }
}

/**
 * Capsules for the points of each bone (in that bone's frame). Limbs and the head: slices along their principal axis.
 * The torso's bones (`wide`: wider than deep): upright slices, in two columns side by side, so the flanks are covered
 * without padding the chest and the back.
 */
export function fitHull(points: Map<number, Vector3[]>, wide: Set<number>, q = 0.98): HullPart[] {
  const out: HullPart[] = [];
  for (const [bone, pts] of points) {
    if (pts.length < 12) continue;
    const c = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(pts.length);
    if (!wide.has(bone)) { slices(bone, pts, c, principal(pts, c), q, 4, out); continue; }
    const W = pct(pts.map((p) => Math.abs(p.x - c.x)), q), D = pct(pts.map((p) => Math.abs(p.z - c.z)), q);
    const up = new Vector3(0, 1, 0);
    if (W <= D * 1.15) { slices(bone, pts, c, up, q, 3, out); continue; }
    for (const sg of [-1, 1]) {
      const half = pts.filter((p) => (p.x - c.x) * sg >= 0);
      slices(bone, half, c.clone().setX(c.x + sg * (W - D)), up, q, 3, out);
    }
  }
  return out;
}

const d1 = new Vector3(), d2 = new Vector3(), rr = new Vector3();
/** Closest points of segments p1→q1 and p2→q2 (Ericson): their parameters, written in `st`. */
export function closestOnSegments(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3, st: [number, number]): void {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  rr.subVectors(p1, p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(rr);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) { st[0] = st[1] = 0; return; }
  if (a < 1e-12) t = Math.min(1, Math.max(0, f / e));
  else {
    const c = d1.dot(rr);
    if (e < 1e-12) s = Math.min(1, Math.max(0, -c / a));
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  st[0] = s;
  st[1] = t;
}

const tip = new Vector3(), pp = new Vector3(), qq = new Vector3(), n = new Vector3(), st: [number, number] = [0, 0];
/**
 * Pivots `dir` (unit) about `from` until the segment from → from + dir·len (radius `r`, `rTip` over its last
 * `tipLen`: the basket) clears every capsule by `margin`. Each pass pushes the nearest point of the segment straight
 * out of the capsule it is in; `away` breaks the tie when the segment crosses a capsule's axis. The capsules of bone
 * `skip` (the forearm holding it) count only 14 cm past the fist. True if it moved.
 */
export function clearSegment(from: Vector3, dir: Vector3, len: number, r: number, rTip: number, tipLen: number,
  caps: { a: Vector3; b: Vector3; r: number; bone: number }[], skip: number, margin: number, away: Vector3, passes = 6): boolean {
  let any = false;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const c of caps) {
      tip.copy(from).addScaledVector(dir, len);
      closestOnSegments(from, tip, c.a, c.b, st);
      pp.copy(from).addScaledVector(dir, len * st[0]);
      qq.copy(c.a).lerp(c.b, st[1]);
      // the fist itself is in it (no pivot gets it out); the forearm holding it ends in the fist: only past the glove
      if (st[0] * len < (c.bone === skip ? 0.14 : 0.04)) continue;
      const need = c.r + (st[0] * len > len - tipLen ? rTip : r) + margin;
      n.subVectors(pp, qq);
      const dist = n.length();
      if (dist >= need) continue;
      if (dist < 1e-5) n.copy(away);
      else n.divideScalar(dist);
      // the point at st·len along the pole moves by (need − dist) along n
      dir.addScaledVector(n, (need - dist) / Math.max(st[0] * len, 0.12)).normalize();
      moved = any = true;
    }
    if (!moved) break;
  }
  return any;
}

const sa = new Vector3(), sb = new Vector3(), st2: [number, number] = [0, 0];
/** How deep the capsule a→b (radius r) sits in the capsules whose bone is in `mask` (bit per bone), 0 if clear. */
export function capsuleDepth(a: Vector3, b: Vector3, r: number, caps: { a: Vector3; b: Vector3; r: number; bone: number }[], mask: number, margin = 0, scale = 1): number {
  let worst = 0;
  for (const c of caps) {
    if (!(mask & (1 << c.bone))) continue;
    closestOnSegments(a, b, c.a, c.b, st2);
    sa.copy(a).lerp(b, st2[0]);
    sb.copy(c.a).lerp(c.b, st2[1]);
    worst = Math.max(worst, c.r * scale + r + margin - sa.distanceTo(sb));
  }
  return worst;
}

const cp = new Vector3(), cn = new Vector3();
/** Pushes the sphere at `p` (radius r) out of the capsules whose bone is in `mask`; `away` if it sits on an axis. */
export function pushOut(p: Vector3, r: number, caps: { a: Vector3; b: Vector3; r: number; bone: number }[], mask: number, margin: number, away: Vector3, passes = 4): void {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const c of caps) {
      if (!(mask & (1 << c.bone))) continue;
      closestOnSegments(p, p, c.a, c.b, st2);
      cp.copy(c.a).lerp(c.b, st2[1]);
      cn.subVectors(p, cp);
      const d = cn.length(), need = c.r + r + margin;
      if (d >= need) continue;
      if (d < 1e-5) cn.copy(away);
      else cn.divideScalar(d);
      p.addScaledVector(cn, need - d);
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * The deepest overlap between a capsule of a bone in `maskA` and one of a bone in `maskB` (0 if clear), their radii
 * times `scale` (the capsules hold 98 % of a slice's vertices: fat for the knees of wide ski pants).
 */
export function hullOverlap(caps: { a: Vector3; b: Vector3; r: number; bone: number }[], maskA: number, maskB: number, margin: number, scale = 1): number {
  let worst = 0;
  for (const c of caps) if (maskA & (1 << c.bone)) worst = Math.max(worst, capsuleDepth(c.a, c.b, c.r * scale, caps, maskB, margin, scale));
  return worst;
}

/** A bitmask of bones, for the functions above. */
export const maskOf = (...bones: number[]) => bones.reduce((m, b) => m | (1 << b), 0);

const tp = new Vector3(), tq = new Vector3(), tt = new Vector3(), st3: [number, number] = [0, 0];
/** How deep the segment from → from + dir·len (as clearSegment sees it) sits in the capsules, 0 if clear. */
export function segmentDepth(from: Vector3, dir: Vector3, len: number, r: number, rTip: number, tipLen: number,
  caps: { a: Vector3; b: Vector3; r: number; bone: number }[], skip: number, margin: number): number {
  let worst = 0;
  tt.copy(from).addScaledVector(dir, len);
  for (const c of caps) {
    closestOnSegments(from, tt, c.a, c.b, st3);
    if (st3[0] * len < (c.bone === skip ? 0.14 : 0.04)) continue;
    tp.copy(from).addScaledVector(dir, len * st3[0]);
    tq.copy(c.a).lerp(c.b, st3[1]);
    worst = Math.max(worst, c.r + (st3[0] * len > len - tipLen ? rTip : r) + margin - tp.distanceTo(tq));
  }
  return worst;
}
