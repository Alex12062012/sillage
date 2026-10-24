import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from '../core/rng';
import { DEEP, STEEP, type Lift, type Mountain, type PisteColor } from '../sim/mountain';
import { ROUSSES } from '../sim/rousses-data';
import { paint, poleGeometry, treeGeometry, treeGeometryLow } from './props';

const C_GROOMED = new Color(0xe9eff7);
const C_POWDER = new Color(0xf8fafd);
const C_ROCK = new Color(0xa3a298); // Jura limestone
const C_WOODS = new Color(0x7d8f88); // snow in the spruce shade: forests read dark from afar
const C_LAKE = new Color(0x56789a);
const C_FIELDS = new Color(0x9aa184);
const C_PINES = new Color(0x4b5e52);
const PISTE_COLOR: Record<PisteColor, Color> = { green: new Color(0x2fa84f), blue: new Color(0x2f6fde), red: new Color(0xe0393e), black: new Color(0x1d1f26) };
const LAKE = 372; // Léman (the land below the ski area keeps its true heights)
const CHAIR_GAP = 24;
const PERCH_GAP = 14;
const SIDE = 2.4; // half the distance between the up and down cables of a chair
const DSIDE = 1.3; // … of a drag lift (the track runs under the up line)

const m4 = new Matrix4();
const q = new Quaternion();
const p3 = new Vector3();
const s3 = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const pt = { x: 0, z: 0, dx: 0, dz: 0 };

const noUv = (g: BufferGeometry) => (g.deleteAttribute('uv'), g);

function gridMesh(nx: number, nz: number, pos: Float32Array, col: Float32Array, mat: MeshLambertMaterial): Mesh {
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], k);
      k += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return new Mesh(g, mat);
}

/**
 * The massif from its 10 m grid (every `every` nodes): groomed pistes, powder, the dark of the spruce woods,
 * limestone on the steeps. The border drops 25 m so it tucks under the land around.
 */
function terrainMesh(m: Mountain, every: number, mat: MeshLambertMaterial): Mesh {
  const G = m.grid;
  const nx = Math.floor((G.nx - 1) / every) + 1, nz = Math.floor((G.nz - 1) / every) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3, g = j * every * G.nx + i * every;
      pos[k] = G.x0 + i * every * G.step;
      pos[k + 2] = G.z0 + j * every * G.step;
      pos[k + 1] = G.h[g] - (i === 0 || j === 0 || i === nx - 1 || j === nz - 1 ? 25 * STEEP : 0);
    }
  }
  const mesh = gridMesh(nx, nz, pos, col, mat);
  const nrm = mesh.geometry.attributes.normal;
  const c = new Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i, k = v * 3, x = pos[k], z = pos[k + 2];
      const groom = G.groomed[j * every * G.nx + i * every];
      c.copy(C_POWDER).lerp(C_GROOMED, groom);
      if (m.forest(x, z) && groom < 0.5) c.lerp(C_WOODS, 0.55);
      const ny = nrm.getY(v);
      if (ny < 0.72) c.lerp(C_ROCK, Math.min(1, (0.72 - ny) / 0.14)); // snow holds up to ~45°: rock on the cliffs only
      c.multiplyScalar(0.95 + 0.05 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2)); // wind-blown shading
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  return mesh;
}

/**
 * The land around (48 × 40 km, the real heights): the Jura ridges, the Swiss plateau, the Léman. Tucked under the
 * massif where they overlap.
 */
function aroundMesh(m: Mountain, mat: MeshLambertMaterial): Mesh {
  const A = m.around, b = m.bounds;
  const pos = new Float32Array(A.nx * A.nz * 3), col = new Float32Array(A.nx * A.nz * 3);
  const c = new Color();
  for (let j = 0; j < A.nz; j++) {
    for (let i = 0; i < A.nx; i++) {
      const k = (j * A.nx + i) * 3, x = A.x0 + i * A.step, z = A.z0 + j * A.step;
      let y = A.h[j * A.nx + i];
      const h0 = A.h0[j * A.nx + i];
      const inside = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
      if (inside > 0) y -= inside > A.step ? 40 * STEEP : 4; // well under the massif: the steepened facets bulge
      const woods = Math.max(0, fbm(31, x / 900, z / 900, 3)) * 1.6;
      if (h0 < LAKE + 4) {
        y = Math.min(y, LAKE);
        c.copy(C_LAKE);
      } else {
        const snow = Math.min(1, Math.max(0, (h0 - 620) / 380)); // snow line on the true heights
        c.copy(C_FIELDS).lerp(C_POWDER, snow).lerp(C_PINES, Math.min(0.7, woods) * (0.5 + 0.5 * snow));
      }
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  return gridMesh(A.nx, A.nz, pos, col, mat);
}

/** Building: walls (timber, or render for the big ones), a snowy hipped roof, warm windows per floor. */
function building(x: number, y: number, z: number, w: number, d: number, yaw: number, levels: number): BufferGeometry {
  const wall = levels * 2.9 + 0.4;
  const parts = [
    paint(new BoxGeometry(w, wall, d).translate(0, wall / 2, 0).toNonIndexed(), () => new Color(levels > 2 ? 0xd8ccb4 : 0x7d5538)),
    paint(new ConeGeometry(Math.hypot(w, d) * 0.62, Math.min(w, d) * 0.42 + 1, 4).rotateY(Math.PI / 4)
      .scale((w / Math.hypot(w, d)) * 1.45, 1, (d / Math.hypot(w, d)) * 1.45).translate(0, wall + Math.min(w, d) * 0.21 + 0.5, 0).toNonIndexed(), () => new Color(0xf4f7fb)),
  ];
  for (let l = 0; l < levels; l++) parts.push(paint(new BoxGeometry(w * 0.7, 0.8, d + 0.06).translate(0, 1.7 + l * 2.9, 0).toNonIndexed(), () => new Color(0xffc56b)));
  return mergeGeometries(parts.map(noUv)).rotateY(yaw).translate(x, y, z);
}

/** Lift station: concrete base, a red roof over the bullwheel (smaller for drag lifts). */
function station(x: number, y: number, z: number, yaw: number, s: number, towerH: number): BufferGeometry {
  return mergeGeometries([
    paint(new BoxGeometry(9, 4, 7).translate(0, 2, 0).toNonIndexed(), () => new Color(0x9aa3b0)),
    paint(new BoxGeometry(11, 0.6, 9).translate(0, 7.4, 0).toNonIndexed(), () => new Color(0xd94f3d)),
    paint(new BoxGeometry(0.8, 4, 0.8).translate(0, 5.2, 0).toNonIndexed(), () => new Color(0x50596a)),
    paint(new CylinderGeometry(SIDE, SIDE, 0.4, 16).translate(0, towerH / s - 0.8, 0).toNonIndexed(), () => new Color(0x2d3340)),
  ].map(noUv)).scale(s, s, s).rotateY(yaw).translate(x, y, z);
}

/** Cleared roads (Route de la Faucille, des Jouvencelles…): a wet-asphalt ribbon, not where a piste crosses. */
function roads(m: Mountain): BufferGeometry {
  const pos: number[] = [];
  for (const r of ROUSSES.roads) {
    const pts: [number, number][] = [];
    for (let k = 2; k < r.length; k += 2) {
      const l = Math.hypot(r[k] - r[k - 2], r[k + 1] - r[k - 1]);
      for (let t = 0; t < l; t += 6) pts.push([r[k - 2] + ((r[k] - r[k - 2]) * t) / l, r[k - 1] + ((r[k + 1] - r[k - 1]) * t) / l]);
    }
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
      if (m.surface((ax + bx) / 2, (az + bz) / 2) === 0) continue; // groomed: a snow bridge over the road
      const l = Math.hypot(bx - ax, bz - az) || 1, nx = ((bz - az) / l) * 3.2, nz = (-(bx - ax) / l) * 3.2;
      const v = (x: number, z: number) => [x, m.height(x, z) + 0.2, z];
      pos.push(...v(ax + nx, az + nz), ...v(ax - nx, az - nz), ...v(bx + nx, bz + nz), ...v(bx + nx, bz + nz), ...v(ax - nx, az - nz), ...v(bx - nx, bz - nz));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return paint(g, () => new Color(0x63686f));
}

interface LiftView { lift: Lift; anchors: Vector3[]; cum: number[]; towerH: number; side: number; clear: number }

/**
 * Les Rousses, Dôle-Tuffes: terrain, the land around, forests, piste poles, chairlifts and drag lifts (towers,
 * cables, moving chairs and perches), the villages, roads and the radar on La Dôle. ~10 draw calls.
 */
export class MountainView {
  readonly group = new Group();
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private chairs: InstancedMesh;
  private perches: InstancedMesh;
  private fine: Mesh;
  private coarse: Mesh;
  private trees: InstancedMesh[] = [];
  private riderChair: Mesh;
  private riderPerch: Mesh;
  private lifts: LiftView[] = [];
  private t = 0;

  constructor(private m: Mountain) {
    this.fine = terrainMesh(m, 1, this.material);
    this.coarse = terrainMesh(m, 2, this.material); // phones: a quarter of the triangles
    this.coarse.visible = false;
    this.group.add(this.fine, this.coarse, aroundMesh(m, this.material));

    // spruces: shuffled, so any prefix (lower quality) is an even thinning; tall and slim
    const flat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const all = m.obstaclesBetween(-1e5, 1e5).filter((o) => o.kind === 'tree').sort((a, b) => ((a.id * 0.618) % 1) - ((b.id * 0.618) % 1));
    for (const [geo, list] of [[treeGeometry(), all.filter((o) => o.h < DEEP)], [treeGeometryLow(), all.filter((o) => o.h >= DEEP)]] as const) {
      const im = new InstancedMesh(geo, flat, list.length);
      list.forEach((o, i) => {
        q.setFromAxisAngle(up, (o.id * 2.39) % (Math.PI * 2));
        const s = o.h / 4.4;
        im.setMatrixAt(i, m4.compose(p3.set(o.x, m.height(o.x, o.z) - 0.3, o.z), q, s3.set(s * 0.72, s, s * 0.72)));
      });
      im.computeBoundingSphere();
      this.trees.push(im);
      this.group.add(im);
    }

    // piste poles: both edges every 30 m, coloured by difficulty (none standing in another piste)
    const marks: [number, number, Color][] = [];
    for (const p of m.pistes) {
      if (p.area) continue;
      for (let s = 15; s < p.len - 10; s += 30) {
        m.along(p, s, pt);
        for (const side of [-1, 1]) {
          const x = pt.x + pt.dz * side * (p.halfWidth + 1), z = pt.z - pt.dx * side * (p.halfWidth + 1);
          if (!m.pisteAt(x, z)) marks.push([x, z, PISTE_COLOR[p.difficulty]]);
        }
      }
    }
    const poles = new InstancedMesh(poleGeometry(), flat, marks.length);
    marks.forEach(([x, z, c], i) => {
      poles.setMatrixAt(i, m4.compose(p3.set(x, m.height(x, z), z), q.identity(), s3.set(1, 1, 1)));
      poles.setColorAt(i, c);
    });
    this.group.add(poles);

    // lifts: a tower at every OSM pylon (and every 120 / 80 m between), cables, stations
    const towerGeo = (h: number, side: number) => mergeGeometries([
      paint(new CylinderGeometry(0.3, 0.45, h, 6).translate(0, h / 2, 0).toNonIndexed(), () => new Color(0x5b6576)),
      paint(new BoxGeometry(side * 2 + 1, 0.4, 0.4).translate(0, h, 0).toNonIndexed(), () => new Color(0x3b4352)),
    ].map(noUv));
    const towers: [Matrix4[], Matrix4[]] = [[], []];
    const cable: number[] = [];
    const built: BufferGeometry[] = [];
    for (const lift of m.lifts) {
      const chair = lift.kind === 'chair';
      const v: LiftView = { lift, anchors: [], cum: [], towerH: chair ? 10 : 6.5, side: chair ? SIDE : DSIDE, clear: chair ? 6.5 : 4.5 };
      const gap = chair ? 120 : 80;
      for (let k = 0; k < lift.pts.length; k += 2) {
        const sub = k ? Math.max(1, Math.round((lift.cum[k / 2] - lift.cum[k / 2 - 1]) / gap)) : 1;
        for (let n = k ? 1 : 0; n <= (k ? sub : 0); n++) {
          const f = k ? (lift.cum[k / 2 - 1] + ((lift.cum[k / 2] - lift.cum[k / 2 - 1]) * n) / sub) / lift.len : 0;
          m.liftPoint(lift, f, pt);
          v.anchors.push(new Vector3(pt.x, m.height(pt.x, pt.z) + v.towerH, pt.z));
          v.cum.push(f * lift.len);
        }
      }
      this.lifts.push(v);
      if (lift.kind === 'carpet') {
        for (let k = 1; k < v.anchors.length; k++) {
          const a = v.anchors[k - 1], b = v.anchors[k], l = Math.hypot(b.x - a.x, b.z - a.z);
          built.push(noUv(paint(new BoxGeometry(1.3, 0.3, l).toNonIndexed(), () => new Color(0x2d3340)))
            .rotateX(-Math.atan2(b.y - a.y, l)).rotateY(Math.atan2(b.x - a.x, b.z - a.z)).translate((a.x + b.x) / 2, (a.y + b.y) / 2 - v.towerH + 0.15, (a.z + b.z) / 2));
        }
        continue;
      }
      for (let k = 1; k < v.anchors.length - 1; k++) {
        const a = v.anchors[k];
        towers[chair ? 0 : 1].push(new Matrix4().compose(p3.set(a.x, a.y - v.towerH, a.z), q.setFromAxisAngle(up, this.yawAt(v, v.cum[k] / lift.len)), s3.set(1, 1, 1)));
      }
      for (const side of [-1, 1]) {
        const n = Math.ceil(lift.len / 10);
        for (let i = 0; i < n; i++) {
          this.cablePoint(v, i / n, side, tmp);
          cable.push(tmp.x, tmp.y, tmp.z);
          this.cablePoint(v, (i + 1) / n, side, tmp);
          cable.push(tmp.x, tmp.y, tmp.z);
        }
      }
      const a = v.anchors[0], b = v.anchors[v.anchors.length - 1], s = chair ? 1 : 0.5;
      built.push(station(a.x, a.y - v.towerH, a.z, this.yawAt(v, 0), s, v.towerH), station(b.x, b.y - v.towerH, b.z, this.yawAt(v, 1) + Math.PI, s, v.towerH));
    }
    for (const [i, list] of towers.entries()) {
      const im = new InstancedMesh(towerGeo(i ? 6.5 : 10, i ? DSIDE : SIDE), flat, list.length);
      list.forEach((t, k) => im.setMatrixAt(k, t));
      this.group.add(im);
    }
    const lines = new BufferGeometry();
    lines.setAttribute('position', new Float32BufferAttribute(cable, 3));
    this.group.add(new LineSegments(lines, new LineBasicMaterial({ color: 0x2b303a })));

    // the real buildings (OSM footprints), the roads, the radar dome on La Dôle
    const ends = m.lifts.flatMap((l) => [[l.pts[0], l.pts[1]], [l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]]);
    for (const [x, z, w, d, yaw, levels] of ROUSSES.buildings) {
      if (ends.some(([ex, ez]) => Math.hypot(ex - x, ez - z) < Math.max(w, d) / 2 + 3)) continue; // a station: drawn as one
      built.push(building(x, m.height(x, z) - 0.4, z, w, d, yaw, levels));
    }
    built.push(roads(m));
    if (ROUSSES.radar) {
      const [x, z] = ROUSSES.radar, y = m.height(x, z);
      built.push(
        noUv(paint(new CylinderGeometry(5.5, 6.5, 9, 12).translate(x, y + 4.5, z).toNonIndexed(), () => new Color(0xd5d9de))),
        noUv(paint(new IcosahedronGeometry(8.5, 2).translate(x, y + 15, z), () => new Color(0xf6f8fa))),
      );
    }
    this.group.add(new Mesh(mergeGeometries(built), flat));

    // chairs (seat, back, hanger; wide as their seats) and drag perches (a rod and its disc)
    const chairGeo = mergeGeometries([
      paint(new BoxGeometry(1.8, 0.12, 0.6).translate(0, -2.3, 0.1).toNonIndexed(), () => new Color(0x2a6bd1)),
      paint(new BoxGeometry(1.8, 0.45, 0.1).translate(0, -2.05, -0.2).toNonIndexed(), () => new Color(0x2a6bd1)), // low back: the rider shows
      paint(new BoxGeometry(0.08, 2.3, 0.08).translate(0, -1.15, 0).toNonIndexed(), () => new Color(0x3b4352)),
    ].map(noUv));
    const perchGeo = mergeGeometries([
      paint(new CylinderGeometry(0.03, 0.03, 4.6, 4).translate(0, -2.3, 0).toNonIndexed(), () => new Color(0x8a919c)),
      paint(new CylinderGeometry(0.2, 0.2, 0.06, 8).translate(0, -4.6, 0).toNonIndexed(), () => new Color(0xe2b23a)),
    ].map(noUv));
    const count = (kind: Lift['kind'], gap: number) => this.lifts.filter((v) => v.lift.kind === kind).reduce((a, v) => a + Math.floor((2 * v.lift.len) / gap), 0);
    this.chairs = new InstancedMesh(chairGeo, flat, count('chair', CHAIR_GAP));
    this.perches = new InstancedMesh(perchGeo, flat, count('drag', PERCH_GAP));
    this.chairs.frustumCulled = this.perches.frustumCulled = false;
    this.riderChair = new Mesh(chairGeo, flat);
    this.riderPerch = new Mesh(perchGeo, flat);
    this.riderChair.visible = this.riderPerch.visible = false;
    this.group.add(this.chairs, this.perches, this.riderChair, this.riderPerch);
    this.update(0);
  }

  /** Index of the cable span at fraction f, and how far along it. */
  private span(v: LiftView, f: number): [number, number] {
    const s = Math.min(1, Math.max(0, f)) * v.lift.len;
    let k = 1;
    while (k < v.cum.length - 1 && v.cum[k] < s) k++;
    return [k, (s - v.cum[k - 1]) / (v.cum[k] - v.cum[k - 1] || 1)];
  }

  private yawAt(v: LiftView, f: number): number {
    const [k] = this.span(v, f);
    const a = v.anchors[k - 1], b = v.anchors[k];
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Cable point at fraction f (0 = bottom) on the up (side +1) or down (-1) line, with a little sag. */
  private cablePoint(v: LiftView, f: number, side: number, out: Vector3): Vector3 {
    const [k, t] = this.span(v, f);
    const a = v.anchors[k - 1], b = v.anchors[k];
    out.lerpVectors(a, b, t);
    out.y -= Math.sin(Math.PI * t) * (v.lift.kind === 'chair' ? 1.4 : 0.5);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    out.x += Math.cos(yaw) * v.side * side;
    out.z -= Math.sin(yaw) * v.side * side;
    out.y = Math.max(out.y, this.m.height(out.x, out.z) + v.clear); // chairs always clear the snow
    return out;
  }

  /** Seat position on chairlift `i` at fraction f of the way up; moves the rider's own chair there. */
  seat(i: number, f: number, out: Vector3): Vector3 {
    const v = this.lifts[i];
    this.cablePoint(v, f, 1, out);
    this.riderChair.position.copy(out);
    this.riderChair.rotation.set(0, this.yawAt(v, f), 0);
    this.riderChair.scale.set(Math.max(1, v.lift.seats / 3), 1, 1);
    this.riderChair.visible = true;
    return out.setY(out.y - 2.24); // the seat surface
  }

  /** Towed up drag lift / carpet `i`: on the snow under the up line; the perch hangs down to the rider. */
  tow(i: number, f: number, out: Vector3): Vector3 {
    const v = this.lifts[i];
    this.cablePoint(v, f, v.lift.kind === 'carpet' ? 0 : 1, out);
    if (v.lift.kind === 'drag') {
      this.riderPerch.position.copy(out);
      this.riderPerch.scale.set(1, (out.y - this.m.height(out.x, out.z) - 0.9) / 4.6, 1);
      this.riderPerch.visible = true;
    }
    return out.setY(this.m.height(out.x, out.z));
  }

  liftYaw(i: number, f: number): number {
    return this.yawAt(this.lifts[i], f);
  }

  /** Phones: coarser terrain and a thinner forest. */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.fine.visible = q === 'high';
    this.coarse.visible = q !== 'high';
    for (const t of this.trees) t.count = Math.round(t.instanceMatrix.count * { low: 0.3, medium: 0.5, high: 1 }[q]);
  }

  /** Off the lift. */
  leaveSeat(): void {
    this.riderChair.visible = this.riderPerch.visible = false;
  }

  update(dt: number): void {
    this.t += dt;
    let c = 0, d = 0;
    for (const v of this.lifts) {
      const chair = v.lift.kind === 'chair';
      if (!chair && v.lift.kind !== 'drag') continue;
      const loop = 2 * v.lift.len, gap = chair ? CHAIR_GAP : PERCH_GAP;
      const n = Math.floor(loop / gap);
      for (let i = 0; i < n; i++) {
        const s = (i * gap + this.t * v.lift.speed) % loop;
        const goingUp = s < v.lift.len;
        const f = goingUp ? s / v.lift.len : 2 - s / v.lift.len;
        this.cablePoint(v, f, goingUp ? 1 : -1, p3);
        q.setFromAxisAngle(up, this.yawAt(v, f) + (goingUp ? 0 : Math.PI));
        if (chair) this.chairs.setMatrixAt(c++, m4.compose(p3, q, s3.set(Math.max(1, v.lift.seats / 3), 1, 1)));
        else this.perches.setMatrixAt(d++, m4.compose(p3, q, s3.set(1, goingUp ? 0.85 : 0.35, 1))); // empty perches ride back retracted
      }
    }
    this.chairs.instanceMatrix.needsUpdate = this.perches.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
