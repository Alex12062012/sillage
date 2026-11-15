import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, Float32BufferAttribute, Group, LinearFilter,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Mountain } from '../sim/mountain';
import { signFace, type Resto } from '../sim/restos';

export { signFace };
import { paint } from './props';
import { altitudeRestaurant, balcony, Geo, gableRoof, windows, WINDOW, withWindows } from './buildings';

const noUv = (g: BufferGeometry) => (g.deleteAttribute('uv'), g);
const SNOW = new Color(0xf4f7fb);
const STONE = new Color(0x8b8680);
const GLASS = WINDOW; // dark by day, lit at dusk (buildings.ts)
const BOARD = new Color(0x4a3220);
const DECK = new Color(0x9a7650);
const PARASOLS = [0xd23b3b, 0xf2c14e];

/** A box on a facade: `along` the facade, `out` from the centre, its size across / up / through. */
function onFace(f: ReturnType<typeof signFace>, along: number, y: number, out: number, sx: number, sy: number, sz: number): BufferGeometry {
  return f.axis === 'z'
    ? new BoxGeometry(sx, sy, sz).translate(along, y, f.side * out).toNonIndexed()
    : new BoxGeometry(sz, sy, sx).translate(f.side * out, y, along).toNonIndexed();
}

const signWidth = (name: string, face: number) => Math.min(face * 0.8, Math.max(4, name.length * 0.42));
const signHeight = (r: Resto) => Math.max(2.6, Math.min(r.eave - 0.8, 4.4)); // under the eaves, above the parasols

/** A quad on a facade (see onFace), facing out. */
function faceQuad(g: Geo, f: { axis: 'x' | 'z'; side: 1 | -1 }, along: number, y: number, out: number, sx: number, sy: number, k: Color): void {
  const u0 = along - sx / 2, u1 = along + sx / 2, v0 = y - sy / 2, v1 = y + sy / 2;
  if (f.axis === 'z') {
    const z = f.side * out;
    if (f.side > 0) g.quad([u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z], k);
    else g.quad([u1, v0, z], [u0, v0, z], [u0, v1, z], [u1, v1, z], k);
  } else {
    const x = f.side * out;
    if (f.side > 0) g.quad([x, v0, u1], [x, v0, u0], [x, v1, u0], [x, v1, u1], k);
    else g.quad([x, v0, u0], [x, v0, u1], [x, v1, u1], [x, v1, u0], k);
  }
}

/** A triangle and its back (the gable ends: both sides drawn). */
function gableEnd(x: number, eave: number, ridge: number, half: number): BufferGeometry {
  const a = [x, eave, -half], b = [x, eave, half], c = [x, ridge, 0];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
  g.computeVertexNormals();
  return g;
}

/** The roof, its ridge along x (the long side), `long` × `short`: snow on top, the roof's colour on the edges. */
function roof(r: Resto, long: number, short: number): BufferGeometry[] {
  const roofCol = new Color(r.roofColor), wall = new Color(r.wallColor);
  const snowy = (g: BufferGeometry) => paint(g, (_x, y) => (y > 0 ? SNOW : roofCol));
  const rise = Math.max(0.5, r.ridge - r.eave);
  if (r.roof === 'flat') {
    return [
      snowy(new BoxGeometry(long + 0.4, 0.5, short + 0.4).toNonIndexed()).translate(0, r.eave + 0.25, 0),
      paint(new BoxGeometry(long * 0.3, rise, short * 0.3).translate(0, r.eave + rise / 2, 0).toNonIndexed(), () => roofCol), // the machine room
    ];
  }
  if (r.roof === 'hip') {
    const h = Math.hypot(long, short);
    return [paint(new ConeGeometry(h * 0.62, rise, 4).rotateY(Math.PI / 4).scale((long / h) * 1.5, 1, (short / h) * 1.5).translate(0, r.eave + rise / 2, 0).toNonIndexed(), () => SNOW)];
  }
  const half = short / 2, ang = Math.atan2(rise, half), slope = Math.hypot(half, rise) + 0.9;
  const parts = [gableEnd(long / 2, r.eave, r.ridge, half), gableEnd(-long / 2, r.eave, r.ridge, half)].map((g) => paint(g, () => wall));
  for (const side of [1, -1]) {
    const cx = (slope / 2 - 0.45) * Math.cos(ang), cy = r.eave + rise - (slope / 2 - 0.45) * Math.sin(ang);
    parts.push(snowy(new BoxGeometry(long + 1.6, 0.35, slope).toNonIndexed()).rotateX(side * ang).translate(0, cy + 0.18, side * cx));
  }
  return parts;
}

/**
 * Illico Resto (docs/restos/illico-resto.md, its 8 street views): a rendered Jura farm, R+1 and the attic. Grey-beige
 * rough render on the long sides, smooth sand render on the gables, a darker footing; on one gable a round stone arch
 * over a brown roller shutter; small windows in white stone frames; a board balcony at a corner under the eaves; a
 * shop window and a brown door at the end of a long side; a dark zinc roof edge. In the frame of `roof` (long side
 * along x), ground floor at y = 0.
 */
function farmResto(r: Resto): BufferGeometry {
  const g = new Geo(), L = Math.max(r.w, r.d), S = Math.min(r.w, r.d);
  const render = new Color(r.wallColor), sand = new Color(0xe0cf9e), footing = new Color(0x9d978d), frame = new Color(r.trim);
  const stone = new Color(0xa7a39b), shutter = new Color(0x3e2c20), wood = new Color(0x6b4a32), door = new Color(0x5a3a26);
  g.walls(0, 0, L, S, 0, 0.6, footing);
  g.walls(0, 0, L, S, 0.6, r.eave, render, sand);
  gableRoof(g, L, S, r.eave, {
    pitch: Math.atan2(r.ridge - r.eave, S / 2), over: 0.5, gableOver: 0.35, snow: SNOW, under: new Color(0x4a3426), edge: new Color(r.roofColor), gable: sand,
  });
  // the long sides: two floors of small framed windows (the shop's corner left free on +z)
  const n = Math.max(2, Math.floor(L / 4.6));
  windows(g, 'z', -1, L * 0.84, S / 2, 2, n, 0.85, 1.05, frame);
  windows(g, 'z', 1, L * 0.62, S / 2, 2, Math.max(2, n - 1), 0.85, 1.05, frame);
  // the shop window and the door at the -x end of the +z side
  const zf = S / 2 + 0.05, x0 = -L / 2 + 0.8;
  g.quad([x0 - 0.15, 0.55, zf], [x0 + 2.55, 0.55, zf], [x0 + 2.55, 2.75, zf], [x0 - 0.15, 2.75, zf], frame);
  g.quad([x0, 0.7, zf + 0.02], [x0 + 2.4, 0.7, zf + 0.02], [x0 + 2.4, 2.6, zf + 0.02], [x0, 2.6, zf + 0.02], WINDOW);
  g.quad([x0 + 3.0, 0, zf], [x0 + 4.0, 0, zf], [x0 + 4.0, 2.15, zf], [x0 + 3.0, 2.15, zf], door);
  // the arch gable (+x): stone jambs and a half-round ring, the roller shutter, the vent box above; one small window
  const x = L / 2 + 0.04, zc = -S * 0.12, half = 1.6, spring = 2.0, ring = 0.45;
  const face = (u0: number, v0: number, u1: number, v1: number, u2: number, v2: number, k: Color, dx = 0) =>
    g.tri([x + dx, v0, u0], [x + dx, v2, u2], [x + dx, v1, u1], k); // (z, y) points listed with z growing to the right: reversed to face +x
  const quadX = (za: number, zb: number, y0: number, y1: number, k: Color, dx = 0) =>
    g.quad([x + dx, y0, zb], [x + dx, y0, za], [x + dx, y1, za], [x + dx, y1, zb], k); // za < zb
  quadX(zc - half, zc + half, 0, spring, shutter, 0.01);
  quadX(zc - half - ring, zc - half, 0, spring, stone);
  quadX(zc + half, zc + half + ring, 0, spring, stone);
  const seg = 5;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI, a1 = ((k + 1) / seg) * Math.PI;
    const p = (a: number, rad: number): [number, number] => [zc + Math.cos(a) * rad, spring + Math.sin(a) * rad];
    const [i0z, i0y] = p(a0, half), [i1z, i1y] = p(a1, half), [o0z, o0y] = p(a0, half + ring), [o1z, o1y] = p(a1, half + ring);
    face(i0z, i0y, o0z, o0y, o1z, o1y, stone);
    face(i0z, i0y, o1z, o1y, i1z, i1y, stone);
    face(zc, spring, i0z, i0y, i1z, i1y, shutter, 0.01);
  }
  quadX(zc - 0.35, zc + 0.35, spring + half + ring + 0.15, spring + half + ring + 0.75, new Color(0x9aa0a6), 0.03);
  quadX(S * 0.22, S * 0.22 + 0.8, 4.0, 5.0, new Color(0x7a3b2e), 0.01);
  quadX(S * 0.22 + 0.12, S * 0.22 + 0.68, 4.12, 4.88, WINDOW, 0.03);
  // the other gable (−x): framed windows, the board balcony at the +z corner under the eaves
  windows(g, 'x', -1, S * 0.7, L / 2, 2, 2, 0.85, 1.05, frame);
  balcony(g, 'x', -1, S / 2 - 2.6, 5.2, L / 2, 3.3, 1.4, wood, SNOW);
  return g.build();
}

/**
 * Resto r as drawn, in world coordinates: real = its walls, windows and shutters, roof, terrace and parasols on the
 * sign's side, the sign board; generic = the plain block of the other buildings, with its sign board.
 */
export function restoGeometry(r: Resto, real: boolean): BufferGeometry {
  const f = signFace(r);
  const board = paint(onFace(f, 0, signHeight(r), f.off + 0.12, signWidth(r.name, f.len), 1.1, 0.2), () => BOARD);
  if (!real) {
    // the generic restaurant: the altitude restaurant archetype (log chalet, steel roof, terrace); the terrace on the
    // sign's facade when that is a long side
    const levels = Math.max(1, Math.round(r.eave / 2.9));
    const g = altitudeRestaurant(r.w, r.d, levels * 2.9 + 0.4, Math.round(r.x * 3.1 + r.z * 1.7)).translate(0, -0.4, 0);
    if (r.w < r.d) g.rotateY(Math.PI / 2);
    if (f.axis === (r.w >= r.d ? 'z' : 'x') && f.side < 0) g.rotateY(Math.PI); // the sign on the other long side
    const plinth = paint(new BoxGeometry(r.w + 0.3, r.floor - r.y + 1, r.d + 0.3).translate(0, -(r.floor - r.y + 1) / 2, 0).toNonIndexed(), () => STONE);
    return mergeGeometries([g, board, plinth].map((p) => (p.getAttribute('uv') ? noUv(p) : p))).rotateY(r.yaw).translate(r.x, r.floor, r.z);
  }
  const wall = new Color(r.wallColor), trim = new Color(r.trim);
  if (r.style === 'farm') {
    const body = farmResto(r);
    if (r.w < r.d) body.rotateY(Math.PI / 2);
    const plinth = paint(new BoxGeometry(r.w + 0.3, r.floor - r.y + 1, r.d + 0.3).translate(0, -(r.floor - r.y + 1) / 2, 0).toNonIndexed(), () => STONE);
    return mergeGeometries([body, noUv(board), noUv(plinth)].map((p) => (p.getAttribute('normal') ? p : (p.computeVertexNormals(), p))))
      .rotateY(r.yaw).translate(r.x, r.floor, r.z);
  }
  const parts: BufferGeometry[] = [
    paint(new BoxGeometry(r.w + 0.3, r.floor - r.y + 1, r.d + 0.3).translate(0, -(r.floor - r.y + 1) / 2, 0).toNonIndexed(), () => STONE), // the plinth, down the slope
    paint(new BoxGeometry(r.w, r.eave, r.d).translate(0, r.eave / 2, 0).toNonIndexed(), () => wall),
    board,
  ];
  if (r.wall === 'wood') parts.push(paint(new BoxGeometry(r.w + 0.06, 0.8, r.d + 0.06).translate(0, 0.4, 0).toNonIndexed(), () => STONE));
  // windows on every facade, a floor every 2.9 m, a shutter each side
  const wins = new Geo();
  const floors = Math.max(1, Math.round(r.eave / 2.9));
  for (const face of [{ axis: 'x' as const, len: r.d, off: r.w / 2 }, { axis: 'z' as const, len: r.w, off: r.d / 2 }]) {
    for (const side of [1, -1] as const) {
      const fc = { ...face, side };
      const n = Math.floor((face.len - 1.5) / 3.2);
      for (let fl = 0; fl < floors; fl++) {
        const y = 1.5 + fl * 2.9;
        if (y > r.eave - 0.8) break;
        for (let k = 0; k < n; k++) {
          const a = -((n - 1) * 3.2) / 2 + k * 3.2;
          if (fc.axis === f.axis && side === f.side && Math.abs(a) < signWidth(r.name, f.len) / 2 + 0.6 && Math.abs(y - signHeight(r)) < 1.4) continue; // the sign's place
          // quads, not boxes: 8 triangles a window instead of 48
          faceQuad(wins, fc, a, y, face.off + 0.03, 1.2, 1.35, trim);
          faceQuad(wins, fc, a, y, face.off + 0.05, 0.9, 1.05, GLASS);
          if (r.wall !== 'render' || r.trim !== r.wallColor) for (const s of [-1, 1]) faceQuad(wins, fc, a + s * 0.9, y, face.off + 0.07, 0.45, 1.3, trim);
        }
      }
    }
  }
  parts.push(wins.build());
  // the roof: its ridge along the long side
  const long = Math.max(r.w, r.d), short = Math.min(r.w, r.d);
  for (const g of roof(r, long, short)) parts.push(r.w >= r.d ? g : g.rotateY(Math.PI / 2));
  // the terrace: a deck along the sign's facade, parasols
  if (r.terrace) {
    const len = Math.min(f.len * 0.8, 24);
    parts.push(paint(onFace(f, 0, 0.25, f.off + 2.7, len, 0.5, 5), () => DECK));
    const n = Math.max(1, Math.floor(len / 5));
    for (let k = 0; k < n; k++) {
      const a = -((n - 1) * 5) / 2 + k * 5;
      const pole = onFace(f, a, 1.4, f.off + 3.6, 0.12, 2.0, 0.12);
      const top = f.axis === 'z' ? [a, 2.5, f.side * (f.off + 3.6)] : [f.side * (f.off + 3.6), 2.5, a];
      const col = new Color(PARASOLS[k % 2]);
      parts.push(paint(pole, () => trim), paint(new ConeGeometry(1.7, 0.6, 8).translate(top[0], top[1], top[2]).toNonIndexed(), () => col));
    }
  }
  return mergeGeometries(parts.map((p) => (p.getAttribute('uv') ? noUv(p) : p)).map((p) => (p.getAttribute('normal') ? p : (p.computeVertexNormals(), p))))
    .rotateY(r.yaw).translate(r.x, r.floor, r.z);
}

/** The names on the sign boards: one atlas row each, white letters on the board's dark wood, as wide as the name. */
function signs(m: Mountain): Mesh {
  const ROW = 64, W = 1024, PAD = 10;
  const mat = new MeshBasicMaterial({ transparent: true, alphaTest: 0.3 });
  const widths = m.restos.map(() => W - 2 * PAD); // text width per row (px): the whole row without a canvas (tests)
  if (typeof document !== 'undefined' && m.restos.length) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = ROW * m.restos.length;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    m.restos.forEach((r, i) => {
      let size = 46;
      g.font = `800 ${size}px system-ui, sans-serif`;
      while (g.measureText(r.name).width > W - 2 * PAD && size > 20) g.font = `800 ${--size}px system-ui, sans-serif`;
      widths[i] = g.measureText(r.name).width;
      g.fillText(r.name, W / 2, i * ROW + ROW / 2);
    });
    const tex = new CanvasTexture(c);
    tex.minFilter = LinearFilter;
    tex.anisotropy = 4;
    mat.map = tex;
  }
  const geos = m.restos.map((r, i) => {
    const f = signFace(r), board = signWidth(r.name, f.len) * 0.94;
    const px = widths[i] + 2 * PAD, aspect = px / ROW;
    const h = Math.min(0.9, board / aspect), w = h * aspect; // the name's own proportions, inside the board
    const g = new PlaneGeometry(w, h);
    const uv = g.getAttribute('uv');
    const u0 = (W - px) / 2 / W, u1 = 1 - u0, v0 = 1 - (i + 1) / m.restos.length, v1 = 1 - i / m.restos.length;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) > 0.5 ? u1 : u0, uv.getY(k) > 0.5 ? v1 : v0);
    const turn = f.axis === 'z' ? (f.side > 0 ? 0 : Math.PI) : f.side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const out = f.off + 0.24;
    g.rotateY(turn).translate(f.axis === 'x' ? f.side * out : 0, signHeight(r), f.axis === 'z' ? f.side * out : 0);
    return g.rotateY(r.yaw).translate(r.x, r.floor, r.z);
  });
  return new Mesh(m.restos.length ? mergeGeometries(geos) : new BufferGeometry(), mat);
}

/**
 * The station's restaurants: one mesh per 2 km square (real or generic buildings), so the camera culls the squares out
 * of view, and one for the names on their signs (DECISIONS.md, point 98). One mesh each cost a draw call per
 * restaurant in view (8 at the foot of Les Rousses); one for all was drawn whole, behind the camera too.
 */
export const RESTO_CELL = 2000;

export class RestoView {
  readonly group = new Group();
  private cells: { list: Resto[]; mesh: Mesh }[] = [];
  private names: Mesh;
  private material = withWindows(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));

  constructor(m: Mountain, real: boolean) {
    const byCell = new Map<string, Resto[]>();
    for (const r of m.restos) {
      const k = `${Math.floor(r.x / RESTO_CELL)},${Math.floor(r.z / RESTO_CELL)}`;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k)!.push(r);
    }
    for (const list of byCell.values()) this.cells.push({ list, mesh: new Mesh(this.build(list, real), this.material) });
    this.names = signs(m);
    this.group.add(...this.cells.map((c) => c.mesh), this.names);
  }

  private build(list: Resto[], real: boolean): BufferGeometry {
    return mergeGeometries(list.map((r) => restoGeometry(r, real)));
  }

  setReal(real: boolean): void {
    for (const c of this.cells) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = this.build(c.list, real);
    }
  }

  dispose(): void {
    for (const c of this.cells) c.mesh.geometry.dispose();
    this.names.geometry.dispose();
    (this.names.material as MeshBasicMaterial).map?.dispose();
    (this.names.material as MeshBasicMaterial).dispose();
    this.material.dispose();
  }
}
