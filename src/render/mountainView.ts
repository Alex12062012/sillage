import {
  Box3, BoxGeometry, BufferAttribute, DataTexture, LinearFilter, RedFormat, RGBAFormat, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute, Frustum, Group,
  IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Quaternion, Sphere, Vector3, Vector4,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from '../core/rng';
import { DEEP, towerGap, type Lift, type Mountain, type PisteColor } from '../sim/mountain';
import { treeLook } from '../sim/treeLook';
import { smoothstep } from '../sim/track';
import { paint } from './props';
import { chairGeometry, groomer, net, pisteSign, pole, snowGun, stationGeometry, towerGeometry, towerPad } from './models';
import { bareFar, bareNear, coniferFar, coniferNear, TREE_WIND, treeMaterial } from './trees';
import { addHeightFog, RELIEF } from './heightFog';
import { addSnowSurface, SNOW } from './snow';
import { RestoView } from './restos';
import { archetypeBuilding, Geo, withWindows } from './buildings';

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

/**
 * Per lift: tower height, half the distance between the cables, how high the cable stays over the snow, tower spacing
 * (between the OSM pylons), station scale, cable sag, carrier spacing. A gondola hangs 6-seat cabins every 60 m from
 * taller towers; a 3S (more than 12 seats) big cabins every 290 m, a few huge towers.
 */
interface Spec { towerH: number; side: number; clear: number; gap: number; station: number; sag: number; every: number; cabin: number }
function specOf(l: Lift): Spec {
  if (l.kind === 'gondola') {
    return l.seats > 12
      ? { towerH: 30, side: 4.5, clear: 14, gap: 420, station: 2.2, sag: 4, every: 290, cabin: 1.6 }
      : { towerH: 16, side: 3.2, clear: 9, gap: 220, station: 1.6, sag: 2.5, every: 60, cabin: 1 };
  }
  return l.kind === 'chair'
    ? { towerH: 10, side: SIDE, clear: 6.5, gap: 120, station: 1, sag: 1.4, every: CHAIR_GAP, cabin: 0 }
    : { towerH: 6.5, side: DSIDE, clear: 4.5, gap: 80, station: 0.5, sag: 0.5, every: PERCH_GAP, cabin: 0 };
}
/** A gondola cabin (scale 1): hanger, roof, open windows between the corner posts, the lower body; floor 3.6 m under the cable. */
const CABIN_FLOOR = 3.6;

const m4 = new Matrix4();
const q = new Quaternion();
const p3 = new Vector3();
const s3 = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const tmpC = new Color();
const col3 = new Color();
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

type Tile = { sphere: Sphere; lods: Uint32Array[] };

/**
 * A grid cut into `cells` × `cells` tiles, each with its triangles (indices into the grid's vertices) near and far
 * (every other vertex, a quarter of the triangles). The camera culls the tiles behind it (see Tiled).
 */
function gridTiles(src: Mesh, nx: number, nz: number, cells: number): Tile[] {
  const quads = (i0: number, i1: number, j0: number, j1: number, step: number): Uint32Array => {
    const out: number[] = [];
    for (let j = j0; j < j1; j += step) {
      for (let i = i0; i < i1; i += step) {
        const jn = Math.min(j + step, j1), inx = Math.min(i + step, i1);
        const a = j * nx + i, b = jn * nx + i, c = j * nx + inx, d = jn * nx + inx;
        out.push(a, b, c, c, b, d);
      }
    }
    return new Uint32Array(out);
  };
  const tiles: Tile[] = [], p = src.geometry.attributes.position, box = new Box3(), v = new Vector3();
  for (let j0 = 0; j0 < nz - 1; j0 += cells) {
    for (let i0 = 0; i0 < nx - 1; i0 += cells) {
      const j1 = Math.min(j0 + cells, nz - 1), i1 = Math.min(i0 + cells, nx - 1);
      box.makeEmpty();
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) box.expandByPoint(v.fromBufferAttribute(p, j * nx + i));
      // margin: the detail patch bends the heights a little
      tiles.push({ sphere: box.expandByScalar(60).getBoundingSphere(new Sphere()), lods: [quads(i0, i1, j0, j1, 1), quads(i0, i1, j0, j1, 2)] });
    }
  }
  return tiles;
}

/**
 * Tiles drawn as ONE mesh: at each refresh, the triangles of the tiles in the (wide) frustum, near or far version,
 * are copied into a single index buffer. One draw call however many tiles, so they can be small (finer culling).
 */
class Tiled {
  readonly mesh: Mesh;
  /** Tiles further than this (m, from the camera to the tile's edge) take their far version, if they have one. */
  far = Infinity;
  /** Tiles within this distance (m) are drawn even out of the frustum (shadow casters behind the camera). */
  keep = 0;
  private index: BufferAttribute;

  constructor(src: BufferGeometry, private tiles: Tile[], mat: MeshLambertMaterial) {
    const g = new BufferGeometry();
    for (const name in src.attributes) g.setAttribute(name, src.attributes[name]);
    this.index = new BufferAttribute(new Uint32Array(tiles.reduce((a, t) => a + Math.max(...t.lods.map((l) => l.length)), 0)), 1);
    this.index.setUsage(DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  update(cam: Vector3): void {
    const a = this.index.array as Uint32Array;
    let n = 0;
    for (const t of this.tiles) {
      const edge = t.sphere.center.distanceTo(cam) - t.sphere.radius;
      if (edge > this.keep && !wide.intersectsSphere(t.sphere)) continue;
      const l = t.lods[t.lods.length > 1 && edge > this.far ? 1 : 0];
      a.set(l, n);
      n += l.length;
    }
    this.mesh.geometry.setDrawRange(0, n);
    this.index.clearUpdateRanges();
    this.index.addUpdateRange(0, n);
    this.index.needsUpdate = true;
  }
}

const sph = new Sphere();
const viewProj = new Matrix4();
/** The camera's frustum, every frame (lift cabins), and a wider one refreshed now and then (trees, poles). */
const frustum = new Frustum();
/** The camera's frustum as of the last MountainView.update (the crowd culls its shadows with it). */
export const viewFrustum = frustum;
const wide = new Frustum();
const wideCam = new PerspectiveCamera();

/**
 * Static instances (trees, piste poles) refilled with only those in the (wide) frustum, through two meshes:
 * the detailed geometry up to `near` m, the simple one beyond (or nothing, without one). Two draw calls whatever
 * the size of the mountain: one instanced mesh over the whole massif was always drawn whole, behind the skier too.
 */
class Culled {
  readonly far: InstancedMesh | null;
  /** How many instances are drawn at all: a prefix of the list, which is shuffled, so it thins evenly. */
  total: number;
  readonly size: number;
  near = Infinity;
  /** Kept within this distance (m) even out of the frustum: shadow casters behind the camera (a low sun in the back). */
  keep = 0;
  dirty = true;
  private mats: Float32Array;
  private cols: Float32Array | null;

  /** `radius`: of a sphere around each instance's origin that holds it. */
  constructor(readonly mesh: InstancedMesh, farGeo: BufferGeometry | null, private radius: number) {
    this.size = this.total = mesh.count;
    this.mats = mesh.instanceMatrix.array.slice() as Float32Array;
    this.cols = (mesh.instanceColor?.array.slice() as Float32Array | undefined) ?? null;
    this.far = farGeo ? new InstancedMesh(farGeo, mesh.material, this.size) : null;
    for (const im of this.meshes) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      if (this.cols && !im.instanceColor) im.instanceColor = new InstancedBufferAttribute(new Float32Array(this.size * 3), 3);
    }
  }

  get meshes(): InstancedMesh[] {
    return this.far ? [this.mesh, this.far] : [this.mesh];
  }

  update(cam: Vector3): void {
    this.dirty = false;
    const r = this.radius, near2 = this.near * this.near, keep2 = this.keep * this.keep, M = this.mats, C = this.cols;
    const out = [this.mesh, this.far];
    const n = [0, 0];
    for (let i = 0; i < this.total; i++) {
      const o = i * 16, x = M[o + 12], y = M[o + 13], z = M[o + 14];
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 > keep2 && !wide.intersectsSphere(sph.set(p3.set(x, y, z), r))) continue;
      const k = d2 > near2 ? 1 : 0;
      const im = out[k];
      if (!im) continue;
      (im.instanceMatrix.array as Float32Array).set(M.subarray(o, o + 16), n[k] * 16);
      if (C) (im.instanceColor!.array as Float32Array).set(C.subarray(i * 3, i * 3 + 3), n[k] * 3);
      n[k]++;
    }
    for (let k = 0; k < 2; k++) {
      const im = out[k];
      if (!im) continue;
      im.count = n[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * Value at grid coordinates (fx, fz) as gridMesh's triangles draw it (each cell split from (i+1, j) to (i, j+1)):
 * node (i, j) of the ni × nj grid holds a[(j * ni + i) * stride + o].
 */
function onTriangles(a: ArrayLike<number>, stride: number, o: number, ni: number, nj: number, fx: number, fz: number): number {
  const i = Math.max(0, Math.min(ni - 2, Math.floor(fx))), j = Math.max(0, Math.min(nj - 2, Math.floor(fz)));
  const tx = fx - i, tz = fz - j;
  const k = (j * ni + i) * stride + o, kx = k + stride, kz = k + ni * stride, kxz = kz + stride;
  return tx + tz <= 1 ? a[k] + tx * (a[kx] - a[k]) + tz * (a[kz] - a[k]) : a[kxz] + (1 - tx) * (a[kz] - a[kxz]) + (1 - tz) * (a[kx] - a[kxz]);
}

/** Snow colour: groomed or powder, the dark of the spruce woods, limestone on the steeps, wind-blown shading. */
function snowColor(m: Mountain, x: number, z: number, groom: number, ny: number, c: Color): Color {
  c.copy(C_POWDER).lerp(C_GROOMED, groom);
  if (m.forest(x, z) && groom < 0.5) c.lerp(C_WOODS, 0.55);
  if (ny < 0.72) c.lerp(C_ROCK, Math.min(1, (0.72 - ny) / 0.14)); // snow holds up to ~45°: rock on the cliffs only
  return c.multiplyScalar(0.95 + 0.05 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2));
}

/** The massif from its 10 m grid (every `every` nodes). The border drops 25 m so it tucks under the land around. */
function terrainMesh(m: Mountain, every: number, mat: MeshLambertMaterial): Mesh {
  const G = m.grid;
  const nx = Math.floor((G.nx - 1) / every) + 1, nz = Math.floor((G.nz - 1) / every) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = G.x0 + i * every * G.step;
      pos[k + 2] = G.z0 + j * every * G.step;
      pos[k + 1] = G.h[j * every * G.nx + i * every] - (i === 0 || j === 0 || i === nx - 1 || j === nz - 1 ? 25 * m.steep : 0);
    }
  }
  const mesh = gridMesh(nx, nz, pos, col, mat);
  const nrm = mesh.geometry.attributes.normal;
  const c = new Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i, k = v * 3;
      snowColor(m, pos[k], pos[k + 2], G.groomed[j * every * G.nx + i * every], nrm.getY(v), c);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  return mesh;
}

/**
 * The snow around the skier. The physics rides the smooth (bicubic) surface of the 10 m grid, the massif mesh
 * draws flat triangles between its nodes (every other node on phones): in a hollow they stand up to 1 m (4 m)
 * above the skis. So a DETAIL_HALF m patch around the skier draws that smooth surface itself, every DETAIL_STEP
 * m, in the massif's hole; over its last DETAIL_MORPH m it bends onto the massif's triangles, so it meets them
 * without a step. Rebuilt a few rows a frame as you ride; its edges sit on the massif's 20 m grid lines.
 */
const DETAIL_HALF = 160;
const DETAIL_STEP = 2.5;
const DETAIL_SNAP = 20;
const DETAIL_MORPH = 40;
const DETAIL_N = (2 * DETAIL_HALF) / DETAIL_STEP + 1;
const DETAIL_ROWS = 8; // per frame: a rebuild takes ~17 frames (~11 m at 140 km/h)
const REFOCUS = 30; // the skier this far from the patch centre: build the next one
const SAFE = 60; // … this close to its edge (a lift, a teleport): build it now

interface Detail { mesh: Mesh; pos: Float32Array; nrm: Float32Array; col: Float32Array; x0: number; z0: number; every: number; row: number }

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
      if (inside > 0) y -= inside > A.step ? 40 * m.steep : 4; // well under the massif: the steepened facets bulge
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

/** Lift station: concrete base, a red roof over the bullwheel (smaller for drag lifts). */
function station(x: number, y: number, z: number, yaw: number, s: number, towerH: number): BufferGeometry {
  return stationGeometry(towerH / s, SIDE).scale(s, s, s).rotateY(yaw).translate(x, y, z);
}

/** Cleared roads (Route de la Faucille, des Jouvencelles, d'Avoriaz…): a wet-asphalt ribbon, not where a piste crosses. */
function roads(m: Mountain): BufferGeometry {
  const pos: number[] = [];
  for (const r of m.scenery.roads) {
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

interface LiftView { lift: Lift; spec: Spec; anchors: Vector3[]; cum: number[]; towerH: number; side: number; clear: number }

/**
 * A free-ride station: terrain, the land around, forests, piste poles, chairlifts, gondolas and drag lifts (towers,
 * cables, moving chairs, cabins and perches), the villages, roads and landmarks (the radar on La Dôle). ~12 draw calls.
 */
export class MountainView {
  readonly group = new Group();
  /** The snow near the skier (the detail patch, sun glints) and the land around. */
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** The massif mesh, with a hole where the detail patch is. */
  private massif = new MeshLambertMaterial({ vertexColors: true });
  private hole = { value: new Vector4() };
  private chairs: InstancedMesh;
  private cabins: InstancedMesh;
  private perches: InstancedMesh;
  private fine: Mesh;
  private coarse: Mesh;
  private every = 1;
  private details: [Detail, Detail];
  private shown: Detail | null = null;
  private building: Detail | null = null;
  private trees: Culled[] = [];
  /** Per tree list, the sort keys in order: a quality draws the prefix under its density (setQuality). */
  private treeKeys: Float32Array[] = [];
  /** Piste and lift equipment (poles, signs, nets, snow guns, groomers, tower pads): one tiled mesh, near only. */
  private props: Tiled;
  private propsDirty = true;
  private fineTiles: Tiled;
  private coarseTiles: Tiled;
  private aroundTiles: Tiled;
  private buildingTiles: Tiled;
  /** Palier bas : sièges et perches coupés au-delà de ça, cabines au-delà de ça. */
  private chairReach = Infinity;
  private cabinReach = Infinity;
  private lastCam = new Vector3(Infinity, 0, 0);
  /** Relief shadows on the 20 m grid: 255 lit, 0 behind a ridge; re-worked a few rows a frame when the sun moves. */
  private relief: { data: Uint8Array; nx: number; nz: number; tex: DataTexture; dir: Vector3; next: Vector3 | null; row: number };
  /** Time (ms) of the first, whole relief bake (at the first frame). */
  reliefMs = 0;
  /** Tree tops over the 10 m grid (m above the ground, 0 without a tree): the forest edges cast their shadows too. */
  private canopy: Float32Array = new Float32Array(0);
  /** Time (ms) to find the pistes' directions for the corduroy (at load). */
  groomMs = 0;
  private lastDir = new Vector3();
  private riderChair: Mesh;
  private riderCabin: Mesh;
  private riderPerch: Mesh;
  private lifts: LiftView[] = [];
  private t = 0;
  /** The restaurants, real or generic (the station's setting). */
  readonly restos: RestoView;

  constructor(private m: Mountain) {
    this.massif.onBeforeCompile = (sh) => {
      addHeightFog(sh);
      addSnowSurface(sh);
      sh.uniforms.uHole = this.hole;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHoleW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvHoleW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vHoleW;\nuniform vec4 uHole;')
        .replace('#include <clipping_planes_fragment>', 'if (vHoleW.x > uHole.x && vHoleW.x < uHole.z && vHoleW.y > uHole.y && vHoleW.y < uHole.w) discard;\n#include <clipping_planes_fragment>');
    };
    this.fine = terrainMesh(m, 1, this.massif);
    this.coarse = terrainMesh(m, 2, this.massif); // phones: a quarter of the triangles
    // drawn as tiles sharing their vertices; the whole meshes stay for the heights and colours (massifAt)
    const G = m.grid, A = m.around;
    this.fineTiles = new Tiled(this.fine.geometry, gridTiles(this.fine, G.nx, G.nz, 64), this.massif); // 640 m tiles
    this.coarseTiles = new Tiled(this.coarse.geometry, gridTiles(this.coarse, Math.floor((G.nx - 1) / 2) + 1, Math.floor((G.nz - 1) / 2) + 1, 32), this.massif);
    this.coarseTiles.mesh.visible = false;
    const around = aroundMesh(m, this.material);
    this.aroundTiles = new Tiled(around.geometry, gridTiles(around, A.nx, A.nz, Math.ceil(Math.max(A.nx, A.nz) / 12)), this.material);
    around.geometry.index = null;
    this.fineTiles.mesh.receiveShadow = this.coarseTiles.mesh.receiveShadow = true;
    this.group.add(this.fineTiles.mesh, this.coarseTiles.mesh, this.aroundTiles.mesh);
    const detail = (): Detail => {
      const pos = new Float32Array(DETAIL_N * DETAIL_N * 3), col = new Float32Array(DETAIL_N * DETAIL_N * 3);
      const mesh = gridMesh(DETAIL_N, DETAIL_N, pos, col, this.material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, pos, nrm: mesh.geometry.attributes.normal.array as Float32Array, col, x0: 0, z0: 0, every: 0, row: 0 };
    };
    this.details = [detail(), detail()];
    for (const d of this.details) d.mesh.receiveShadow = true;
    {
      const nx = Math.floor((G.nx - 1) / 2) + 1, nz = Math.floor((G.nz - 1) / 2) + 1, st = G.step * 2;
      const data = new Uint8Array(nx * nz).fill(255);
      const tex = new DataTexture(data, nx, nz, RedFormat);
      tex.magFilter = tex.minFilter = LinearFilter;
      tex.needsUpdate = true;
      this.relief = { data, nx, nz, tex, dir: new Vector3(), next: null, row: 0 };
      RELIEF.uRelief.value = tex;
      RELIEF.uReliefRect.value.set(G.x0 - st / 2, G.z0 - st / 2, 1 / (st * nx), 1 / (st * nz));
      RELIEF.uReliefOn.value = 1;
      // groomed snow on the 10 m grid, for the corduroy (snow.ts): R how groomed, G B the piste's direction as
      // (cos 2θ, sin 2θ), which blends smoothly between nodes (a groomer's lines have no front nor back)
      const t0 = performance.now(), gd = new Uint8Array(G.nx * G.nz * 4), dir = { x: 0, z: 0, dx: 0, dz: 0 };
      for (let j = 0; j < G.nz; j++) {
        for (let i = 0; i < G.nx; i++) {
          const k = j * G.nx + i, g = Math.min(1, Math.max(0, G.groomed[k]));
          gd[k * 4] = Math.round(255 * g);
          gd[k * 4 + 1] = gd[k * 4 + 2] = 128;
          if (g < 0.05) continue;
          const hit = m.pisteAt(G.x0 + i * G.step, G.z0 + j * G.step);
          if (!hit) continue;
          m.along(hit.p, hit.s, dir);
          const a = 2 * Math.atan2(dir.dz, dir.dx);
          gd[k * 4 + 1] = Math.round(127.5 + 127.5 * Math.cos(a));
          gd[k * 4 + 2] = Math.round(127.5 + 127.5 * Math.sin(a));
        }
      }
      this.groomMs = performance.now() - t0;
      const groom = new DataTexture(gd, G.nx, G.nz, RGBAFormat);
      groom.magFilter = groom.minFilter = LinearFilter;
      groom.needsUpdate = true;
      SNOW.uGroom.value = groom;
      SNOW.uGroomRect.value.set(G.x0 - G.step / 2, G.z0 - G.step / 2, 1 / (G.step * G.nx), 1 / (G.step * G.nz));
      SNOW.uGroomOn.value = 1;
    }

    // trees (DECISIONS.md, point 97): spruces and firs share the conifer shape, beeches low down and larches high in the
    // Alps the bare one. Each list is sorted so that any prefix (lower quality) thins evenly, the trees along the pistes
    // (h < DEEP) twice as slowly as those deep in the woods: treeKeys[k] holds the sorted keys, setQuality cuts them.
    const flat = withWindows(new MeshLambertMaterial({ vertexColors: true, flatShading: true })); // (windows: the buildings)
    const all = m.obstaclesBetween(-1e5, 1e5).filter((o) => o.kind === 'tree');
    let yLo = Infinity, yHi = -Infinity;
    const ys = all.map((o) => { const y = m.height(o.x, o.z); yLo = Math.min(yLo, y); yHi = Math.max(yHi, y); return y; });
    const alps = m.station.id === 'avoriaz';
    {
      // the trees' tops for the relief's shadows (bakeRelief): long shadows of the forest edges across the pistes
      const G = m.grid;
      this.canopy = new Float32Array(G.nx * G.nz);
      for (const o of all) {
        const i = Math.round((o.x - G.x0) / G.step), j = Math.round((o.z - G.z0) / G.step);
        if (i >= 0 && j >= 0 && i < G.nx && j < G.nz) this.canopy[j * G.nx + i] = Math.max(this.canopy[j * G.nx + i], o.h * 0.85);
      }
    }
    const kinds: { list: number[]; near: BufferGeometry; far: BufferGeometry; snow: number }[] = [
      { list: [], near: coniferNear(), far: coniferFar(), snow: 0.9 },
      { list: [], near: bareNear(), far: bareFar(), snow: 0.55 },
    ];
    // species, width and size from the simulation's rule (treeLook), the one that sets each tree's collider
    const looks = all.map((o, i) => treeLook(o.id, o.h, (ys[i] - yLo) / Math.max(1, yHi - yLo), alps));
    looks.forEach((l, i) => kinds[l.species >= 2 ? 1 : 0].list.push(i));
    const key = (i: number) => ((all[i].id * 0.618) % 1) * (all[i].h < DEEP ? 0.5 : 1);
    const tint = new Color();
    kinds.forEach(({ list, near, far, snow }) => {
      list.sort((a, b) => key(a) - key(b));
      this.treeKeys.push(Float32Array.from(list, key));
      const im = new InstancedMesh(near, treeMaterial(snow), list.length);
      list.forEach((i, n) => {
        const o = all[i], { species: sp, scale: s, wide, tall } = looks[i], h2 = (o.id * 0.56984) % 1, h3 = (o.id * 0.31831) % 1;
        q.setFromAxisAngle(up, (o.id * 2.39) % (Math.PI * 2));
        im.setMatrixAt(n, m4.compose(p3.set(o.x, ys[i] - 0.3, o.z), q, s3.set(s * wide, s * tall, s * wide)));
        // needle (or twig) colour per species, ±10 % per tree, a little warmer or bluer
        tint.setHex([0x30592f, 0x24493a, 0x9c938a, 0xa08458][sp]).multiplyScalar(0.9 + h3 * 0.2);
        tint.r *= 0.95 + h2 * 0.1;
        im.setColorAt(n, tint);
      });
      const t = new Culled(im, far, 25);
      t.mesh.castShadow = true; // the near ones only: the shadow pass must not redraw the forest to the horizon
      for (const x of t.meshes) x.visible = list.length > 0;
      this.trees.push(t);
      this.group.add(...t.meshes);
    });

    // piste poles: drawn with the other piste equipment, in the props layer below (placed by the simulation)

    // lifts: a tower at every OSM pylon (and every 120 / 80 / 220 m between), cables, stations
    const towerGeo = towerGeometry;
    const towers = new Map<string, { h: number; side: number; list: Matrix4[] }>();
    const cable: number[] = [];
    const built: BufferGeometry[] = [];
    for (const lift of m.lifts) {
      const spec = specOf(lift);
      const v: LiftView = { lift, spec, anchors: [], cum: [], towerH: spec.towerH, side: spec.side, clear: spec.clear };
      const gap = towerGap(lift); // where the towers stand: the same posts the skier hits (liftTowers)
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
      const key = `${v.towerH}:${v.side}`;
      if (!towers.has(key)) towers.set(key, { h: v.towerH, side: v.side, list: [] });
      for (let k = 1; k < v.anchors.length - 1; k++) {
        const a = v.anchors[k];
        towers.get(key)!.list.push(new Matrix4().compose(p3.set(a.x, a.y - v.towerH, a.z), q.setFromAxisAngle(up, this.yawAt(v, v.cum[k] / lift.len)), s3.set(1, 1, 1)));
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
      const a = v.anchors[0], b = v.anchors[v.anchors.length - 1], s = spec.station;
      built.push(station(a.x, a.y - v.towerH, a.z, this.yawAt(v, 0), s, v.towerH), station(b.x, b.y - v.towerH, b.z, this.yawAt(v, 1) + Math.PI, s, v.towerH));
    }
    for (const { h, side, list } of towers.values()) {
      const im = new InstancedMesh(towerGeo(h, side), flat, list.length);
      im.castShadow = true;
      list.forEach((t, k) => im.setMatrixAt(k, t));
      this.group.add(im);
    }
    const lines = new BufferGeometry();
    lines.setAttribute('position', new Float32BufferAttribute(cable, 3));
    this.group.add(new LineSegments(lines, new LineBasicMaterial({ color: 0x2b303a })));

    // the real buildings (OSM / IGN footprints), the roads, the radar dome on La Dôle
    const ends = m.lifts.flatMap((l) => [[l.pts[0], l.pts[1]], [l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]]);
    // by 2 km tiles (culled by the camera), each with a far version without the window bands: userData.lod = [near, far]
    const blocks = new Map<string, [BufferGeometry[], BufferGeometry[]]>();
    for (const [x, z, w, d, yaw, levels] of m.scenery.buildings) {
      if (ends.some(([ex, ez]) => Math.hypot(ex - x, ez - z) < Math.max(w, d) / 2 + 3)) continue; // a station: drawn as one
      const key = `${Math.floor(x / 2000)},${Math.floor(z / 2000)}`;
      if (!blocks.has(key)) blocks.set(key, [[], []]);
      const [near, far] = blocks.get(key)!, y = m.height(x, z) - 0.4;
      // an archetype per footprint (buildings.ts), its variant from a seed of its position: never twice the same
      const seed = Math.round(x * 7.31 + z * 3.17);
      near.push(archetypeBuilding(x, y, z, w, d, yaw, levels, true, alps, seed));
      far.push(archetypeBuilding(x, y, z, w, d, yaw, levels, false, alps, seed));
    }
    // all in one geometry (each tile's near version, then its far one), drawn through one index buffer (Tiled)
    const parts: BufferGeometry[] = [], tiles: Tile[] = [];
    let at = 0;
    const range = (count: number) => Uint32Array.from({ length: count }, (_, k) => at + k);
    for (const [near, far] of blocks.values()) {
      const lod = [mergeGeometries(near), mergeGeometries(far)];
      lod[0].computeBoundingSphere();
      const lods = lod.map((g) => {
        const r = range(g.attributes.position.count);
        at += g.attributes.position.count;
        return r;
      });
      tiles.push({ sphere: lod[0].boundingSphere!, lods });
      parts.push(...lod);
    }
    this.buildingTiles = new Tiled(parts.length ? mergeGeometries(parts) : new BufferGeometry(), tiles, flat);
    this.buildingTiles.mesh.castShadow = this.buildingTiles.mesh.receiveShadow = true;
    this.group.add(this.buildingTiles.mesh);
    // piste and lift equipment by 500 m tiles, no far version (DECISIONS.md, point 99): one draw call for all of it
    const kits = new Map<string, Geo>();
    const kit = (x: number, z: number) => {
      const key = `${Math.floor(x / 500)},${Math.floor(z / 500)}`;
      if (!kits.has(key)) kits.set(key, new Geo());
      return kits.get(key)!;
    };
    // what the simulation placed (Mountain.equipment), each piece where its collider is
    for (const q2 of m.equipment) {
      const g = kit(q2.x, q2.z), y = m.height(q2.x, q2.z);
      if (q2.kind === 'pole') pole(g, PISTE_COLOR[q2.difficulty], q2.x, y, q2.z);
      else if (q2.kind === 'sign') pisteSign(g, PISTE_COLOR[q2.difficulty], q2.x, y, q2.z, q2.yaw);
      else if (q2.kind === 'gun') snowGun(g, q2.x, y, q2.z, q2.yaw);
      else if (q2.kind === 'groomer') groomer(g, q2.x, y - 0.05, q2.z, q2.yaw);
      else net(g, [q2.x, y, q2.z], [q2.x2, m.height(q2.x2, q2.z2), q2.z2]);
    }
    // pads on the towers standing on a piste (their collider: the tower's, as wide as its foot)
    for (const v of this.lifts) {
      for (let k = 1; k < v.anchors.length - 1; k++) {
        const a = v.anchors[k], hit = m.pisteAt(a.x, a.z);
        if (hit && v.lift.kind !== 'carpet') towerPad(kit(a.x, a.z), a.x, a.y - v.towerH, a.z);
      }
    }
    {
      const parts: BufferGeometry[] = [], tiles: Tile[] = [];
      let at2 = 0;
      for (const g of kits.values()) {
        const geo = g.build();
        geo.computeBoundingSphere();
        const n = geo.attributes.position.count;
        tiles.push({ sphere: geo.boundingSphere!, lods: [Uint32Array.from({ length: n }, (_, k) => at2 + k), new Uint32Array(0)] });
        at2 += n;
        parts.push(geo);
      }
      this.props = new Tiled(parts.length ? mergeGeometries(parts) : new BufferGeometry(), tiles, flat);
      this.group.add(this.props.mesh);
    }
    built.push(roads(m));
    if (m.scenery.radar) {
      const [x, z] = m.scenery.radar, y = m.height(x, z);
      built.push(
        noUv(paint(new CylinderGeometry(5.5, 6.5, 9, 12).translate(x, y + 4.5, z).toNonIndexed(), () => new Color(0xd5d9de))),
        noUv(paint(new IcosahedronGeometry(8.5, 2).translate(x, y + 15, z), () => new Color(0xf6f8fa))),
      );
    }
    this.group.add(new Mesh(mergeGeometries(built), flat));
    this.restos = new RestoView(m, true);
    this.restos.group.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshLambertMaterial) o.castShadow = o.receiveShadow = true; }); // not the names
    this.group.add(this.restos.group);

    // chairs (seat, back, hanger; wide as their seats) and drag perches (a rod and its disc)
    const chairGeo = chairGeometry();
    const perchGeo = mergeGeometries([
      paint(new CylinderGeometry(0.03, 0.03, 4.6, 4).translate(0, -2.3, 0).toNonIndexed(), () => new Color(0x8a919c)),
      paint(new CylinderGeometry(0.2, 0.2, 0.06, 8).translate(0, -4.6, 0).toNonIndexed(), () => new Color(0xe2b23a)),
    ].map(noUv));
    const F = CABIN_FLOOR;
    const cabinGeo = mergeGeometries([
      paint(new BoxGeometry(0.1, 1.5, 0.1).translate(0, -0.75, 0).toNonIndexed(), () => new Color(0x3b4352)),
      paint(new BoxGeometry(2.1, 0.3, 2.1).translate(0, -1.6, 0).toNonIndexed(), () => new Color(0xd23b33)),
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => paint(new BoxGeometry(0.14, 1.0, 0.14).translate(a * 0.92, -2.25, b * 0.92).toNonIndexed(), () => new Color(0xd9dde3))),
      paint(new BoxGeometry(1.98, 0.95, 1.98).translate(0, -F + 0.475, 0).toNonIndexed(), () => new Color(0xd23b33)), // the windows above it are open: the rider shows
      paint(new BoxGeometry(2.0, 0.08, 2.0).translate(0, -F + 0.96, 0).toNonIndexed(), () => new Color(0xf2f4f7)),
    ].map(noUv));
    const count = (kind: Lift['kind']) => this.lifts.filter((v) => v.lift.kind === kind).reduce((a, v) => a + Math.floor((2 * v.lift.len) / v.spec.every), 0);
    this.chairs = new InstancedMesh(chairGeo, flat, count('chair'));
    this.cabins = new InstancedMesh(cabinGeo, flat, count('gondola'));
    this.perches = new InstancedMesh(perchGeo, flat, count('drag'));
    this.chairs.frustumCulled = this.cabins.frustumCulled = this.perches.frustumCulled = false;
    this.chairs.castShadow = this.cabins.castShadow = this.perches.castShadow = true;
    this.riderChair = new Mesh(chairGeo, flat);
    this.riderCabin = new Mesh(cabinGeo, flat);
    this.riderPerch = new Mesh(perchGeo, flat);
    this.riderChair.visible = this.riderCabin.visible = this.riderPerch.visible = false;
    this.group.add(this.chairs, this.cabins, this.perches, this.riderChair, this.riderCabin, this.riderPerch);
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
    out.y -= Math.sin(Math.PI * t) * v.spec.sag;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    out.x += Math.cos(yaw) * v.side * side;
    out.z -= Math.sin(yaw) * v.side * side;
    out.y = Math.max(out.y, this.m.height(out.x, out.z) + v.clear); // chairs always clear the snow
    return out;
  }

  /**
   * Seat position on chairlift or gondola `i` at fraction f of the way (up, or `down` the return line); moves the
   * rider's own chair or cabin there.
   */
  seat(i: number, f: number, out: Vector3, down = false): Vector3 {
    const v = this.lifts[i];
    this.cablePoint(v, f, down ? -1 : 1, out);
    const yaw = this.yawAt(v, f) + (down ? Math.PI : 0);
    if (v.lift.kind === 'gondola') {
      const s = v.spec.cabin;
      this.riderCabin.position.copy(out);
      this.riderCabin.rotation.set(0, yaw, 0);
      this.riderCabin.scale.setScalar(s);
      this.riderCabin.visible = true;
      return out.setY(out.y - CABIN_FLOOR * s + 0.45); // the bench along the cabin wall
    }
    this.riderChair.position.copy(out);
    this.riderChair.rotation.set(0, yaw, 0);
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

  liftYaw(i: number, f: number, down = false): number {
    return this.yawAt(this.lifts[i], f) + (down ? Math.PI : 0);
  }

  /** Phones: coarser terrain and a thinner forest. */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.fineTiles.mesh.visible = q === 'high';
    this.coarseTiles.mesh.visible = q !== 'high';
    this.coarseTiles.far = q === 'low' ? 1000 : Infinity;
    this.buildingTiles.far = { low: 800, medium: 1500, high: 3000 }[q]; // windows and balconies: not seen beyond
    this.chairReach = q === 'low' ? 700 : Infinity;
    this.cabinReach = q === 'low' ? 1500 : Infinity;
    this.every = q === 'high' ? 1 : 2; // the detail patch, bent onto the other mesh, is rebuilt at the next focus()
    // sapins simplifiés au-delà de 200 m (bas), 300 m (moyen), 450 m (élevé) : l'arcade le fait dès 170 m. Seuls les proches
    // projettent une ombre. Piquets coupés au-delà de 700 m au palier bas (moins d'un pixel)
    // density: the woods 50 / 65 / 100 %, the trees along the pistes twice that (keys halved, see the constructor)
    const dens = { low: 0.5, medium: 0.65, high: 1.01 }[q];
    this.trees.forEach((t, k) => {
      const keys = this.treeKeys[k];
      let lo = 0, hi = keys.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < dens) lo = mid + 1; else hi = mid; }
      t.total = lo;
      t.near = { low: 200, medium: 300, high: 450 }[q];
      t.dirty = true;
    });
    this.props.far = { low: 700, medium: 1500, high: 3000 }[q]; // poles, signs, nets…: under a pixel beyond
    // shadow casters behind the camera, within the reach of a low sun's shadows (shadow maps on medium / high only)
    const keep = { low: 0, medium: 150, high: 260 }[q];
    for (const t of this.trees) t.keep = keep;
    this.buildingTiles.keep = keep;
    this.propsDirty = true;
  }

  /** Height of the snow as drawn at (x, z): the detail patch near the skier, the massif's triangles beyond. */
  drawnHeight(x: number, z: number): number {
    const d = this.shown;
    if (d && x >= d.x0 && x <= d.x0 + 2 * DETAIL_HALF && z >= d.z0 && z <= d.z0 + 2 * DETAIL_HALF) {
      return onTriangles(d.pos, 3, 1, DETAIL_N, DETAIL_N, (x - d.x0) / DETAIL_STEP, (z - d.z0) / DETAIL_STEP);
    }
    return this.massifAt(x, z, 1);
  }

  /** Where the detail patch is drawn (empty before the first focus()). */
  detailRect(): { x0: number; z0: number; x1: number; z1: number } {
    const d = this.shown;
    return d ? { x0: d.x0, z0: d.z0, x1: d.x0 + 2 * DETAIL_HALF, z1: d.z0 + 2 * DETAIL_HALF } : { x0: 0, z0: 0, x1: 0, z1: 0 };
  }

  /**
   * Every frame, with the sun's direction: the relief's shadows. Worked out whole at the first call, then again
   * (all rows within ~20 frames, shown once done) when the sun has turned more than about 1°.
   */
  setSun(dir: Vector3): void {
    const r = this.relief;
    if (!r.next && r.dir.dot(dir) < 0.99985) {
      r.next = dir.clone();
      r.row = 0;
      if (this.reliefMs === 0) {
        const t0 = performance.now();
        while (r.next) this.bakeRelief(r.nz);
        this.reliefMs = performance.now() - t0;
        return;
      }
    }
    if (r.next) this.bakeRelief(Math.ceil(r.nz / 20));
  }

  private bakeRelief(rows: number): void {
    const r = this.relief, G = this.m.grid, d = r.next!, h = G.h, cp = this.canopy;
    const len = Math.hypot(d.x, d.z) || 1, dx = d.x / len / G.step, dz = d.z / len / G.step, tanE = d.y / len;
    for (const end = Math.min(r.nz, r.row + rows); r.row < end; r.row++) {
      const gj = r.row * 2;
      for (let i = 0; i < r.nx; i++) {
        const gi = i * 2, h0 = h[gj * G.nx + gi], k0 = gj * G.nx + gi;
        // under the trees (a tree on the node or next to it), only the ground shades: the crowns stand in the sun
        const open = !(cp[k0] || cp[k0 - 1] || cp[k0 + 1] || cp[k0 - G.nx] || cp[k0 + G.nx]);
        let worst = -1;
        // march towards the sun, 15 m to 3 km, steps growing by 20 %: the steepest rise seen is the horizon
        // (the ground and the tree tops on it: a forest edge 20 m high shades ~65 m of snow at 17° of sun)
        for (let s = 15; s < 3000; s *= 1.2) {
          const x = Math.round(gi + dx * s), z = Math.round(gj + dz * s);
          if (x < 0 || z < 0 || x >= G.nx || z >= G.nz) break;
          const k = z * G.nx + x, rise = (h[k] + (open ? cp[k] : 0) - h0) / s;
          if (rise > worst) worst = rise;
        }
        r.data[r.row * r.nx + i] = Math.round(255 * Math.min(1, Math.max(0, (tanE - worst) / 0.08 + 0.5))); // soft edge
      }
    }
    if (r.row >= r.nz) {
      r.dir.copy(d);
      r.next = null;
      r.tex.needsUpdate = true;
    }
  }

  /** Every frame, with the skier's position: keeps the detail patch around them. */
  focus(x: number, z: number): void {
    const d = this.shown;
    const x0 = this.snap(x, this.m.bounds.x0, this.m.bounds.x1), z0 = this.snap(z, this.m.bounds.z0, this.m.bounds.z1);
    const near = !d || x < d.x0 + SAFE || x > d.x0 + 2 * DETAIL_HALF - SAFE || z < d.z0 + SAFE || z > d.z0 + 2 * DETAIL_HALF - SAFE;
    if (!d || d.every !== this.every || (near && (x0 !== d.x0 || z0 !== d.z0))) { // (at the massif's edge it cannot follow)
      this.building = null; // a jump (lift top, respawn, quality change): now, whole
      this.advance(this.start(this.spare(), x0, z0), DETAIL_N + 1);
      return;
    }
    if (!this.building) {
      if ((x0 === d.x0 && z0 === d.z0) || Math.max(Math.abs(x - d.x0 - DETAIL_HALF), Math.abs(z - d.z0 - DETAIL_HALF)) < REFOCUS) return;
      this.building = this.start(this.spare(), x0, z0);
    }
    if (this.advance(this.building, DETAIL_ROWS)) this.building = null;
  }

  /** Component o (0 x, 1 y, 2 z) of the massif mesh's positions, normals or colours as drawn at (x, z); the land around beyond. */
  private massifAt(x: number, z: number, o: number, what: 'position' | 'normal' | 'color' = 'position'): number {
    const G = this.m.grid, b = this.m.bounds;
    if (what === 'position' && (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1)) return this.m.height(x, z);
    const ni = Math.floor((G.nx - 1) / this.every) + 1, nj = Math.floor((G.nz - 1) / this.every) + 1, st = G.step * this.every;
    const a = (this.every === 1 ? this.fine : this.coarse).geometry.attributes[what].array;
    return onTriangles(a, 3, o, ni, nj, (x - G.x0) / st, (z - G.z0) / st);
  }

  /** The patch corner for a skier at v: on the 20 m grid lines, inside the massif (off its tucked-under border). */
  private snap(v: number, lo: number, hi: number): number {
    const c = lo + Math.round((v - DETAIL_HALF - lo) / DETAIL_SNAP) * DETAIL_SNAP;
    return Math.max(lo + DETAIL_SNAP, Math.min(hi - DETAIL_SNAP - 2 * DETAIL_HALF, c));
  }

  private spare(): Detail {
    return this.details[0] === this.shown ? this.details[1] : this.details[0];
  }

  private start(d: Detail, x0: number, z0: number): Detail {
    d.x0 = x0;
    d.z0 = z0;
    d.every = this.every;
    d.row = 0;
    return d;
  }

  /**
   * `count` more rows of heights (the smooth surface, bent onto the massif's triangles near the edges), each
   * shaded once the next one is in; true (and swapped in, hole and all) once complete.
   */
  private advance(d: Detail, count: number): boolean {
    for (let n = 0; n < count && d.row <= DETAIL_N; n++, d.row++) {
      const j = d.row;
      if (j < DETAIL_N) {
        for (let i = 0; i < DETAIL_N; i++) {
          const k = (j * DETAIL_N + i) * 3, x = d.x0 + i * DETAIL_STEP, z = d.z0 + j * DETAIL_STEP;
          const smooth = this.m.height(x, z), w = this.morph(i, j);
          d.pos[k] = x;
          d.pos[k + 1] = w > 0 ? smooth + (this.massifAt(x, z, 1) - smooth) * w : smooth;
          d.pos[k + 2] = z;
        }
      }
      if (j > 0) this.shade(d, j - 1);
    }
    if (d.row <= DETAIL_N) return false;
    const g = d.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = true;
    g.computeBoundingSphere();
    if (this.shown) this.shown.mesh.visible = false;
    d.mesh.visible = true;
    this.shown = d;
    this.hole.value.set(d.x0, d.z0, d.x0 + 2 * DETAIL_HALF, d.z0 + 2 * DETAIL_HALF);
    return true;
  }

  /** 1 on the patch's edge (it lies on the massif's triangles) … 0 from DETAIL_MORPH m in (the smooth surface). */
  private morph(i: number, j: number): number {
    return 1 - smoothstep(0, DETAIL_MORPH, Math.min(i, j, DETAIL_N - 1 - i, DETAIL_N - 1 - j) * DETAIL_STEP);
  }

  /** Normals (central differences) and colours of row j; near the edges both blend into the massif's, so the seam does not show. */
  private shade(d: Detail, j: number): void {
    const G = this.m.grid, N = DETAIL_N, h = (i: number, jj: number) => d.pos[(Math.max(0, Math.min(N - 1, jj)) * N + Math.max(0, Math.min(N - 1, i))) * 3 + 1];
    const c = tmpC;
    for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 3, x = d.pos[k], z = d.pos[k + 2];
      tmp.set(h(i - 1, j) - h(i + 1, j), (i > 0 && i < N - 1 ? 2 : 1) * DETAIL_STEP, 0);
      tmp.z = ((h(i, j - 1) - h(i, j + 1)) * tmp.y) / ((j > 0 && j < N - 1 ? 2 : 1) * DETAIL_STEP);
      tmp.normalize();
      const groom = onTriangles(G.groomed, 1, 0, G.nx, G.nz, (x - G.x0) / G.step, (z - G.z0) / G.step);
      snowColor(this.m, x, z, groom, tmp.y, c);
      const w = this.morph(i, j);
      if (w > 0) {
        tmp.lerp(p3.set(this.massifAt(x, z, 0, 'normal'), this.massifAt(x, z, 1, 'normal'), this.massifAt(x, z, 2, 'normal')), w).normalize();
        c.lerp(col3.setRGB(this.massifAt(x, z, 0, 'color'), this.massifAt(x, z, 1, 'color'), this.massifAt(x, z, 2, 'color')), w);
      }
      d.nrm[k] = tmp.x; d.nrm[k + 1] = tmp.y; d.nrm[k + 2] = tmp.z;
      d.col[k] = c.r; d.col[k + 1] = c.g; d.col[k + 2] = c.b;
    }
  }

  /** Off the lift. */
  leaveSeat(): void {
    this.riderChair.visible = this.riderCabin.visible = this.riderPerch.visible = false;
  }

  update(dt: number, cam?: PerspectiveCamera): void {
    this.t += dt;
    TREE_WIND.value = this.t;
    if (cam) {
      cam.updateMatrixWorld();
      frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      // trees and poles: refilled when the camera has moved 10 m or turned 8°, against a frustum 24° wider
      cam.getWorldDirection(tmp);
      const moved = cam.position.distanceToSquared(this.lastCam) > 100 || tmp.dot(this.lastDir) < 0.99;
      if (moved || this.propsDirty || this.trees.some((t) => t.dirty)) {
        this.lastCam.copy(cam.position);
        this.lastDir.copy(tmp);
        wideCam.copy(cam);
        wideCam.fov = Math.min(150, cam.fov + 24);
        wideCam.updateProjectionMatrix();
        wide.setFromProjectionMatrix(viewProj.multiplyMatrices(wideCam.projectionMatrix, cam.matrixWorldInverse));
        for (const t of this.trees) t.update(cam.position);
        for (const t of [this.fineTiles, this.coarseTiles, this.aroundTiles, this.buildingTiles]) if (t.mesh.visible) t.update(cam.position);
        this.props.update(cam.position);
        this.propsDirty = false;
      }
    }
    let c = 0, d = 0, g = 0;
    for (const v of this.lifts) {
      const kind = v.lift.kind;
      if (kind === 'carpet') continue;
      const loop = 2 * v.lift.len, gap = v.spec.every;
      const n = Math.floor(loop / gap);
      for (let i = 0; i < n; i++) {
        const s = (i * gap + this.t * v.lift.speed) % loop;
        const goingUp = s < v.lift.len;
        const f = goingUp ? s / v.lift.len : 2 - s / v.lift.len;
        this.cablePoint(v, f, goingUp ? 1 : -1, p3);
        if (cam && (!frustum.intersectsSphere(sph.set(p3, 8)) || p3.distanceTo(cam.position) > (kind === 'gondola' ? this.cabinReach : this.chairReach))) continue; // out of sight: not drawn
        q.setFromAxisAngle(up, this.yawAt(v, f) + (goingUp ? 0 : Math.PI));
        if (kind === 'chair') this.chairs.setMatrixAt(c++, m4.compose(p3, q, s3.set(Math.max(1, v.lift.seats / 3), 1, 1)));
        else if (kind === 'gondola') this.cabins.setMatrixAt(g++, m4.compose(p3, q, s3.setScalar(v.spec.cabin)));
        else this.perches.setMatrixAt(d++, m4.compose(p3, q, s3.set(1, goingUp ? 0.85 : 0.35, 1))); // empty perches ride back retracted
      }
    }
    this.chairs.count = c;
    this.cabins.count = g;
    this.perches.count = d;
    this.chairs.instanceMatrix.needsUpdate = this.cabins.instanceMatrix.needsUpdate = this.perches.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose();
    });
    this.material.dispose();
    this.relief.tex.dispose();
    RELIEF.uReliefOn.value = 0;
    SNOW.uGroom.value.dispose();
    SNOW.uGroomOn.value = 0;
    this.massif.dispose();
  }
}
