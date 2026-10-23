import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from '../core/rng';
import type { Lift, Mountain } from '../sim/mountain';
import { kickerLength, Surface } from '../sim/track';
import { paint, poleGeometry, treeGeometry } from './props';

const C_GROOMED = new Color(0xe9eff7);
const C_POWDER = new Color(0xf8fafd);
const C_ROCK = new Color(0x7b8596);
const C_LIP = new Color(0xffa860);
const PISTE_COLOR = { easy: new Color(0x2f6fde), medium: new Color(0xe0393e), hard: new Color(0x1d1f26) };
const TOWER_H = 10;
const CHAIR_GAP = 24;
const SIDE = 2.4; // half the distance between the up and down cables
export const LIFT_SPEED = 5; // m/s along the cable

const m4 = new Matrix4();
const q = new Quaternion();
const p3 = new Vector3();
const s3 = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();

/** One height-field mesh over the whole mountain: piste-groomed, powder, rock on the steeps, lit lips. */
function terrainMesh(m: Mountain, step: number, x0: number, x1: number, z0: number, z1: number, mat: MeshLambertMaterial): Mesh {
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new Color();
  const n = new Vector3();
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const k = (j * nx + i) * 3;
      pos[k] = x; pos[k + 1] = m.height(x, z); pos[k + 2] = z;
      m.normal(x, z, n);
      c.copy(m.surface(x, z) === Surface.Groomed ? C_GROOMED : C_POWDER);
      if (n.y < 0.86) c.lerp(C_ROCK, Math.min(1, (0.86 - n.y) / 0.14)); // rock shows through on the steeps
      c.multiplyScalar(0.94 + 0.06 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2)); // wind-blown shading
      for (const kk of m.kickers) {
        const u = z - kk.z;
        if (u > kk.ramp - 1 && u < kk.ramp + kk.knuckle + 1 && Math.abs(x - m.centerX(z)) < kk.halfWidth) c.lerp(C_LIP, 0.6);
      }
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new Mesh(g, mat);
}

/**
 * The ranges around the ski area, coarse: they meet the mountain's own heights at its border (and hide
 * just under it inside), then rise into fbm peaks; the valley opens below the village.
 */
function rangeMesh(m: Mountain, mat: MeshLambertMaterial): Mesh {
  const b = m.bounds;
  const STEP = 30;
  const X0 = b.x0 - 1500, X1 = b.x1 + 1500, Z0 = b.z0 - 1400, Z1 = b.z1 + 1800;
  const nx = Math.round((X1 - X0) / STEP) + 1;
  const nz = Math.round((Z1 - Z0) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new Color();
  for (let j = 0; j < nz; j++) {
    const z = Z0 + j * STEP;
    for (let i = 0; i < nx; i++) {
      const x = X0 + i * STEP;
      const cx = Math.min(b.x1, Math.max(b.x0, x));
      const cz = Math.min(b.z1, Math.max(b.z0, z));
      const d = Math.hypot(x - cx, z - cz); // distance outside the ski area
      const inside = Math.min(b.x1 - x, x - b.x0, b.z1 - z, z - b.z0); // > 0 inside
      const valley = z > b.z1 ? Math.min(1, Math.abs(x - m.lifts[0].bx) / 600) : 1;
      const peaks = fbm(91, x / 520, z / 520, 4) * 0.5 + 0.5;
      let y = m.height(cx, cz) + d * (0.45 * valley + 0.04) + peaks * peaks * 380 * Math.min(1, d / 500) * valley;
      if (inside > 0) y -= Math.min(4, inside * 0.1);
      const k = (j * nx + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const rock = Math.min(1, Math.max(0, (d - 250) / 600)) * (0.35 + 0.65 * fbm(17, x / 140, z / 140, 2) ** 2);
      c.copy(C_POWDER).lerp(C_ROCK, rock * 0.8);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new Mesh(g, mat);
}

/** Chalet: timber box, white snowy roof, warm windows. Merged per village. */
function chalet(x: number, y: number, z: number, w: number, d: number, yaw: number): BufferGeometry {
  const wood = paint(new BoxGeometry(w, 3.2, d).translate(0, 1.6, 0).toNonIndexed(), (_x, vy) => new Color(vy > 1.2 && vy < 2.2 ? 0x6b4730 : 0x7d5538));
  const roof = paint(new ConeGeometry(Math.hypot(w, d) * 0.62, 2.6, 4).rotateY(Math.PI / 4).scale(w / Math.hypot(w, d) * 1.45, 1, d / Math.hypot(w, d) * 1.45).translate(0, 4.5, 0).toNonIndexed(), () => new Color(0xf4f7fb));
  const win = paint(new BoxGeometry(w * 0.6, 0.8, d + 0.06).translate(0, 1.9, 0).toNonIndexed(), () => new Color(0xffc56b));
  wood.deleteAttribute('uv'); roof.deleteAttribute('uv'); win.deleteAttribute('uv');
  return mergeGeometries([wood, roof, win]).rotateY(yaw).translate(x, y, z);
}

/** Lift station: concrete base, a roof over the bullwheel. */
function station(x: number, y: number, z: number, yaw: number): BufferGeometry {
  const base = paint(new BoxGeometry(9, 4, 7).translate(0, 2, 0).toNonIndexed(), () => new Color(0x9aa3b0));
  const roof = paint(new BoxGeometry(11, 0.6, 9).translate(0, 7.4, 0).toNonIndexed(), () => new Color(0xd94f3d));
  const post = paint(new BoxGeometry(0.8, 4, 0.8).translate(0, 5.2, 0).toNonIndexed(), () => new Color(0x50596a));
  const wheel = paint(new CylinderGeometry(SIDE, SIDE, 0.4, 16).translate(0, TOWER_H - 0.8, 0).toNonIndexed(), () => new Color(0x2d3340));
  for (const g of [base, roof, post, wheel]) g.deleteAttribute('uv');
  return mergeGeometries([base, roof, post, wheel]).rotateY(yaw).translate(x, y, z);
}

interface LiftView { lift: Lift; towers: Vector3[]; len: number; yaw: number }

/**
 * The free-ride mountain: terrain, forests, piste poles, chairlifts (towers, cables, moving chairs),
 * a village of chalets. ~8 draw calls. update(dt) moves the chairs; seat() gives a chair position.
 */
export class MountainView {
  readonly group = new Group();
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private chairs: InstancedMesh;
  private fine: Mesh;
  private coarse: Mesh;
  private forest: InstancedMesh;
  private riderChair: Mesh;
  private lifts: LiftView[] = [];
  private t = 0;

  constructor(private m: Mountain) {
    const b = m.bounds;
    this.fine = terrainMesh(m, 5, b.x0, b.x1, b.z0, b.z1, this.material);
    this.coarse = terrainMesh(m, 10, b.x0, b.x1, b.z0, b.z1, this.material); // phones: a quarter of the triangles
    this.coarse.visible = false;
    this.group.add(this.fine, this.coarse, rangeMesh(m, this.material));
    // the park gets a fine patch so the kickers' ramps are true to the physics
    for (const k of m.kickers) {
      const cx = m.centerX(k.z + 20);
      const patch = terrainMesh(m, 1, cx - k.halfWidth - 6, cx + k.halfWidth + 6, k.z - 4, k.z + kickerLength(k) - k.recover + 4, this.material);
      patch.renderOrder = 1;
      patch.position.y = 0.03;
      this.group.add(patch);
    }

    const flat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // shuffled, so any prefix (lower quality) is an even thinning of the whole forest
    const trees = m.obstaclesBetween(-1e4, 1e4).filter((o) => o.kind === 'tree').sort((a, b) => ((a.id * 0.618) % 1) - ((b.id * 0.618) % 1));
    const forest = this.forest = new InstancedMesh(treeGeometry(), flat, trees.length);
    trees.forEach((o, i) => {
      q.setFromAxisAngle(up, (o.id * 2.39) % (Math.PI * 2));
      const s = o.h / 4.4;
      forest.setMatrixAt(i, m4.compose(p3.set(o.x, m.height(o.x, o.z) - 0.2, o.z), q, s3.set(s, s, s)));
    });
    forest.computeBoundingSphere();
    this.group.add(forest);

    // piste poles: both edges every 24 m, coloured by difficulty
    const marks: [number, number, Color][] = [];
    for (const p of m.pistes) {
      for (let z = p.z0 + 30; z < p.z1 - 40; z += 24) {
        for (const side of [-1, 1]) marks.push([p.x(z) + side * (p.halfWidth + 1), z, PISTE_COLOR[p.difficulty]]);
      }
    }
    const poles = new InstancedMesh(poleGeometry(), flat, marks.length);
    marks.forEach(([x, z, c], i) => {
      poles.setMatrixAt(i, m4.compose(p3.set(x, m.height(x, z), z), q.identity(), s3.set(1, 1, 1)));
      poles.setColorAt(i, c);
    });
    this.group.add(poles);

    // lifts: towers every ~90 m, two cables, stations
    const towerGeo = mergeGeometries([
      paint(new CylinderGeometry(0.35, 0.5, TOWER_H, 6).translate(0, TOWER_H / 2, 0).toNonIndexed(), () => new Color(0x5b6576)),
      paint(new BoxGeometry(SIDE * 2 + 1, 0.4, 0.4).translate(0, TOWER_H, 0).toNonIndexed(), () => new Color(0x3b4352)),
    ].map((g) => (g.deleteAttribute('uv'), g)));
    const towerPos: Matrix4[] = [];
    const cable: number[] = [];
    const built: BufferGeometry[] = [];
    for (const lift of m.lifts) {
      const len = Math.hypot(lift.tx - lift.bx, lift.tz - lift.bz);
      const yaw = Math.atan2(lift.tx - lift.bx, lift.tz - lift.bz);
      const n = Math.max(2, Math.round(len / 90));
      const towers: Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = lift.bx + (lift.tx - lift.bx) * f;
        const z = lift.bz + (lift.tz - lift.bz) * f;
        const y = m.height(x, z);
        towers.push(new Vector3(x, y + TOWER_H, z));
        if (i > 0 && i < n) towerPos.push(new Matrix4().compose(p3.set(x, y, z), q.setFromAxisAngle(up, yaw), s3.set(1, 1, 1)));
      }
      const v: LiftView = { lift, towers, len, yaw };
      this.lifts.push(v);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 40; i++) {
          this.cablePoint(v, i / 40, side, tmp);
          cable.push(tmp.x, tmp.y, tmp.z);
          this.cablePoint(v, (i + 1) / 40, side, tmp);
          cable.push(tmp.x, tmp.y, tmp.z);
        }
      }
      built.push(station(lift.bx, m.height(lift.bx, lift.bz), lift.bz, yaw), station(lift.tx, m.height(lift.tx, lift.tz), lift.tz, yaw + Math.PI));
    }
    const towersMesh = new InstancedMesh(towerGeo, flat, towerPos.length);
    towerPos.forEach((t, i) => towersMesh.setMatrixAt(i, t));
    this.group.add(towersMesh);
    const lines = new BufferGeometry();
    lines.setAttribute('position', new Float32BufferAttribute(cable, 3));
    this.group.add(new LineSegments(lines, new LineBasicMaterial({ color: 0x2b303a })));

    // the village around the main lift's bottom station
    const main = m.lifts[0];
    const homes: [number, number, number, number, number][] = [
      [-38, 30, 9, 7, 0.2], [-30, 52, 8, 10, 1.4], [22, 38, 11, 8, -0.3], [30, 62, 9, 9, 0.9], [-12, 78, 12, 8, 0.1],
      [44, 14, 8, 7, -1.1], [-52, 8, 7, 9, 0.6], [8, 96, 9, 8, -0.5],
    ];
    for (const [dx, dz, w, d, yaw] of homes) {
      const x = main.bx + dx;
      const z = main.bz + dz;
      built.push(chalet(x, m.height(x, z) - 0.3, z, w, d, yaw));
    }
    this.group.add(new Mesh(mergeGeometries(built), flat));

    // chairs: seat, back, hanger; spread along both cables of every lift
    const chairGeo = mergeGeometries([
      paint(new BoxGeometry(1.8, 0.12, 0.6).translate(0, -2.3, 0.1).toNonIndexed(), () => new Color(0x2a6bd1)),
      paint(new BoxGeometry(1.8, 0.7, 0.1).translate(0, -1.95, -0.2).toNonIndexed(), () => new Color(0x2a6bd1)),
      paint(new BoxGeometry(0.08, 2.3, 0.08).translate(0, -1.15, 0).toNonIndexed(), () => new Color(0x3b4352)),
    ].map((g) => (g.deleteAttribute('uv'), g)));
    const count = this.lifts.reduce((a, v) => a + Math.floor((2 * v.len) / CHAIR_GAP), 0);
    this.chairs = new InstancedMesh(chairGeo, flat, count);
    this.chairs.frustumCulled = false;
    this.riderChair = new Mesh(chairGeo, flat);
    this.riderChair.visible = false;
    this.group.add(this.chairs, this.riderChair);
    this.update(0);
  }

  /** Cable point at fraction f (0 = bottom) on the up (side +1) or down (-1) line, with a little sag. */
  private cablePoint(v: LiftView, f: number, side: number, out: Vector3): Vector3 {
    const n = v.towers.length - 1;
    const i = Math.min(n - 1, Math.floor(f * n));
    const t = f * n - i;
    out.lerpVectors(v.towers[i], v.towers[i + 1], t);
    out.y -= Math.sin(Math.PI * t) * 1.4;
    out.x += Math.cos(v.yaw) * SIDE * side;
    out.z -= Math.sin(v.yaw) * SIDE * side;
    out.y = Math.max(out.y, this.m.height(out.x, out.z) + 6.5); // chairs always clear the snow
    return out;
  }

  /** Seat position on lift `i` at fraction f of the way up; moves the rider's own chair there. */
  seat(i: number, f: number, out: Vector3): Vector3 {
    this.cablePoint(this.lifts[i], f, 1, out);
    this.riderChair.position.copy(out);
    this.riderChair.rotation.set(0, this.lifts[i].yaw, 0);
    this.riderChair.visible = true;
    return out.setY(out.y - 2.24); // the seat surface
  }

  /** Phones: coarser terrain off the park patches and a thinner forest (≈ 580k → 250k triangles on low). */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.fine.visible = q === 'high';
    this.coarse.visible = q !== 'high';
    this.forest.count = Math.round(this.forest.instanceMatrix.count * { low: 0.35, medium: 0.6, high: 1 }[q]);
  }

  /** Off the chair. */
  leaveSeat(): void {
    this.riderChair.visible = false;
  }

  liftLength(i: number): number {
    return this.lifts[i].len;
  }

  liftYaw(i: number): number {
    return this.lifts[i].yaw;
  }

  update(dt: number): void {
    this.t += dt;
    let k = 0;
    for (const v of this.lifts) {
      const loop = 2 * v.len;
      const n = Math.floor(loop / CHAIR_GAP);
      for (let i = 0; i < n; i++) {
        const s = (i * CHAIR_GAP + this.t * LIFT_SPEED) % loop;
        const goingUp = s < v.len;
        this.cablePoint(v, goingUp ? s / v.len : 2 - s / v.len, goingUp ? 1 : -1, p3);
        q.setFromAxisAngle(up, v.yaw + (goingUp ? 0 : Math.PI));
        this.chairs.setMatrixAt(k++, m4.compose(p3, q, s3.set(1, 1, 1)));
      }
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
