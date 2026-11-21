import { BufferGeometry, Float32BufferAttribute, Matrix4, Points, PointsMaterial, Vector3, type SkinnedMesh } from 'three';
import { B } from './skierMesh';

/**
 * Debug only (the test build's API, never production): where the player's realistic skier passes through herself in
 * the current pose. Her skinned mesh is posed on the CPU (as the GPU does), each triangle goes to the bone of ours its
 * vertices follow, and every pair of parts that should never meet (a pole and a leg, the two skis, a forearm and the
 * chest...) is tested triangle against triangle. Neighbours that share a joint (thigh and shin, hand and its pole) are
 * not. Also counts the triangles stretched or crushed by the pose (cloth artefacts), against the rest pose.
 */
export interface ClipReport {
  /** Intersecting triangle pairs, by pair of parts ("poleL×thighR"). */
  hits: Record<string, number>;
  total: number;
  /** Triangles whose longest edge grew past ×1.5 or shrank under ×0.6, by part. */
  stretched: Record<string, number>;
  worstStretch: number;
  /** A few contact points (mesh space), the first ones found (of the pairs matching `focus`, if given). */
  at: number[][];
  /** The most stretched triangles (×1.5 and more): centre, ratio, first vertex (focus 'stretch' marks them yellow). */
  stretchAt: number[][];
}

const NAME = ['pelvis', 'spine', 'chest', 'head', 'uarmL', 'uarmR', 'farmL', 'farmR', 'handL', 'handR', 'poleL', 'poleR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'skiL', 'skiR'];
const TORSO = [B.pelvis, B.spine, B.chest];

/** Parts that share a joint (or a grip), so may touch: never tested. */
function neighbours(a: number, b: number): boolean {
  if (a === b) return true;
  const t = (x: number) => TORSO.includes(x as 0 | 1 | 2);
  if (t(a) && t(b)) return true;
  const pair = (x: number, y: number) => (a === x && b === y) || (a === y && b === x);
  if (pair(B.head, B.chest) || pair(B.head, B.spine)) return true;
  for (let s = 0; s < 2; s++) {
    if (TORSO.some((x) => pair(x, B.upperArmL + s))) return true;
    if (pair(B.pelvis, B.thighL + s)) return true;
    if (pair(B.upperArmL + s, B.forearmL + s) || pair(B.forearmL + s, B.handL + s) || pair(B.handL + s, B.poleL + s)) return true;
    if (pair(B.thighL + s, B.shinL + s) || pair(B.shinL + s, B.footL + s) || pair(B.footL + s, B.skiL + s)) return true;
  }
  return false;
}

const e1 = new Vector3(), e2 = new Vector3(), pv = new Vector3(), tv = new Vector3(), qv = new Vector3(), dir = new Vector3();
/** Does segment p→q cross triangle abc (strictly inside both)? Writes the crossing in `out`. */
function segTri(p: Vector3, q: Vector3, a: Vector3, b: Vector3, c: Vector3, out: Vector3): boolean {
  dir.subVectors(q, p);
  e1.subVectors(b, a);
  e2.subVectors(c, a);
  pv.crossVectors(dir, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  tv.subVectors(p, a);
  const u = tv.dot(pv) * inv;
  if (u <= 0 || u >= 1) return false;
  qv.crossVectors(tv, e1);
  const v = dir.dot(qv) * inv;
  if (v <= 0 || u + v >= 1) return false;
  const t = e2.dot(qv) * inv;
  if (t <= 0 || t >= 1) return false;
  out.copy(p).addScaledVector(dir, t);
  return true;
}

const A = [new Vector3(), new Vector3(), new Vector3()], Bt = [new Vector3(), new Vector3(), new Vector3()], hit = new Vector3();
const tmp = new Vector3(), acc = new Vector3(), sk1 = new Vector3();

export function clipCheck(mesh: SkinnedMesh, follow: Int8Array, markers = true, focus?: string): ClipReport {
  const only = focus ? new RegExp(focus) : null;
  const geo = mesh.geometry, pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const n = pos.count, nt = Math.floor(n / 3);
  const sk = mesh.skeleton, mats = sk.bones.map((b, i) => new Matrix4().multiplyMatrices(b.matrix, sk.boneInverses[i]));
  // posed positions (mesh space) and the part of each vertex (the bone of ours its heaviest joint follows)
  const P = new Float32Array(n * 3), part = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    tmp.fromBufferAttribute(pos, i);
    acc.set(0, 0, 0);
    let best = -1, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      const j = si.getComponent(i, k);
      acc.addScaledVector(sk1.copy(tmp).applyMatrix4(mats[j]), w);
      if (w > bw) { bw = w; best = j; }
    }
    P[i * 3] = acc.x; P[i * 3 + 1] = acc.y; P[i * 3 + 2] = acc.z;
    part[i] = best >= 0 ? follow[best] : -1;
  }
  // per triangle: its part (the majority of its vertices), its bounds; stretch against the rest pose
  const tp = new Int8Array(nt), box = new Float32Array(nt * 6);
  const stretched: Record<string, number> = {}, stretchAt: number[][] = [];
  let worstStretch = 1;
  const edge = (arr: ArrayLike<number>, i: number, j: number) => Math.hypot(arr[i * 3] - arr[j * 3], arr[i * 3 + 1] - arr[j * 3 + 1], arr[i * 3 + 2] - arr[j * 3 + 2]);
  const rest = pos.array as ArrayLike<number>;
  for (let t = 0; t < nt; t++) {
    const a = t * 3, b = a + 1, c = a + 2;
    tp[t] = part[b] === part[c] ? part[b] : part[a];
    for (let k = 0; k < 3; k++) {
      box[t * 6 + k] = Math.min(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]);
      box[t * 6 + 3 + k] = Math.max(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]);
    }
    const r0 = Math.max(edge(rest, a, b), edge(rest, b, c), edge(rest, c, a));
    if (r0 < 0.004) continue; // slivers: their ratio means nothing
    const r1 = Math.max(edge(P, a, b), edge(P, b, c), edge(P, c, a));
    const k = r1 / r0;
    if (k > 1.5 || k < 0.6) {
      const nm = NAME[tp[t]] ?? '?';
      if (k > 1.5) stretchAt.push([(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3, k, a]);
      stretched[nm] = (stretched[nm] ?? 0) + 1;
      if (Math.abs(Math.log(k)) > Math.abs(Math.log(worstStretch))) worstStretch = k;
    }
  }
  // triangles by part
  const byPart: number[][] = NAME.map(() => []);
  for (let t = 0; t < nt; t++) if (tp[t] >= 0) byPart[tp[t]].push(t);
  const bounds = byPart.map((list) => {
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of list) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], box[t * 6 + k]); bb[3 + k] = Math.max(bb[3 + k], box[t * 6 + 3 + k]); }
    return bb;
  });
  const overlap = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) =>
    a[ao] <= b[bo + 3] && b[bo] <= a[ao + 3] && a[ao + 1] <= b[bo + 4] && b[bo + 1] <= a[ao + 4] && a[ao + 2] <= b[bo + 5] && b[bo + 2] <= a[ao + 5];
  const load = (dst: Vector3[], t: number) => { for (let k = 0; k < 3; k++) dst[k].fromArray(P, (t * 3 + k) * 3); };
  // the fabric of a triangle, for the report: J jacket, P pants (avatar.ts: the jacket's atlas half is u < 0.5)
  const uvA = geo.getAttribute('uv'), tintA = geo.getAttribute('tint');
  const fab = (t: number) => (!tintA || tintA.getX(t * 3) <= 0 ? '' : uvA.getX(t * 3) < 0.5 ? 'J' : 'P');
  const hits: Record<string, number> = {}, at: number[][] = [];
  let total = 0;
  for (let ga = 0; ga < NAME.length; ga++) {
    for (let gb = ga + 1; gb < NAME.length; gb++) {
      if (neighbours(ga, gb) || !byPart[ga].length || !byPart[gb].length || !overlap(bounds[ga], 0, bounds[gb], 0)) continue;
      let count = 0;
      for (const ta of byPart[ga]) {
        if (!overlap(box, ta * 6, bounds[gb], 0)) continue;
        load(A, ta);
        for (const tb of byPart[gb]) {
          if (!overlap(box, ta * 6, box, tb * 6)) continue;
          load(Bt, tb);
          let crossed = false;
          for (let k = 0; k < 3 && !crossed; k++) crossed = segTri(A[k], A[(k + 1) % 3], Bt[0], Bt[1], Bt[2], hit) || segTri(Bt[k], Bt[(k + 1) % 3], A[0], A[1], A[2], hit);
          if (crossed) {
            count++;
            const key = `${NAME[ga]}${fab(ta)}×${NAME[gb]}${fab(tb)}`;
            hits[key] = (hits[key] ?? 0) + 1;
            if (at.length < 2000 && (!only || only.test(key))) at.push([hit.x, hit.y, hit.z]);
          }
        }
      }
      total += count;
    }
  }
  const old = mesh.getObjectByName('clip-markers');
  if (old) mesh.remove(old);
  const shown = focus === 'stretch' ? stretchAt.map((p) => p.slice(0, 3)) : at;
  if (markers && shown.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(shown.flat(), 3));
    const pts = new Points(g, new PointsMaterial({ color: focus === 'stretch' ? 0xffee00 : 0xff00ff, size: 6, sizeAttenuation: false, depthTest: false }));
    pts.name = 'clip-markers';
    pts.renderOrder = 10;
    mesh.add(pts);
  }
  return { hits, total, stretched, worstStretch: Math.round(worstStretch * 100) / 100, at: at.slice(0, 12), stretchAt: stretchAt.sort((x, y) => y[3] - x[3]).slice(0, 20) };
}
