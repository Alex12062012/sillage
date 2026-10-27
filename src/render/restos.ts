import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, Float32BufferAttribute, Group, LinearFilter,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Mountain } from '../sim/mountain';
import type { Resto } from '../sim/restos';
import { paint } from './props';

const noUv = (g: BufferGeometry) => (g.deleteAttribute('uv'), g);
const SNOW = new Color(0xf4f7fb);
const STONE = new Color(0x8b8680);
const GLASS = new Color(0xffc56b);
const BOARD = new Color(0x4a3220);
const DECK = new Color(0x9a7650);
const PARASOLS = [0xd23b3b, 0xf2c14e];

/** Building: walls (timber, or render for the big ones), a snowy hipped roof, warm windows per floor. */
export function building(x: number, y: number, z: number, w: number, d: number, yaw: number, levels: number): BufferGeometry {
  const wall = levels * 2.9 + 0.4;
  const parts = [
    paint(new BoxGeometry(w, wall, d).translate(0, wall / 2, 0).toNonIndexed(), () => new Color(levels > 2 ? 0xd8ccb4 : 0x7d5538)),
    paint(new ConeGeometry(Math.hypot(w, d) * 0.62, Math.min(w, d) * 0.42 + 1, 4).rotateY(Math.PI / 4)
      .scale((w / Math.hypot(w, d)) * 1.45, 1, (d / Math.hypot(w, d)) * 1.45).translate(0, wall + Math.min(w, d) * 0.21 + 0.5, 0).toNonIndexed(), () => new Color(0xf4f7fb)),
  ];
  for (let l = 0; l < levels; l++) parts.push(paint(new BoxGeometry(w * 0.7, 0.8, d + 0.06).translate(0, 1.7 + l * 2.9, 0).toNonIndexed(), () => new Color(0xffc56b)));
  return mergeGeometries(parts.map(noUv)).rotateY(yaw).translate(x, y, z);
}

/** The facade the sign is on, in the building's own frame: its outward axis and side, its length, its distance from the centre. */
export function signFace(r: Resto): { axis: 'x' | 'z'; side: 1 | -1; len: number; off: number } {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw), fx = Math.sin(r.signYaw), fz = Math.cos(r.signYaw);
  const lu = fx * c - fz * s, lv = fx * s + fz * c;
  return Math.abs(lu) >= Math.abs(lv) ? { axis: 'x', side: lu >= 0 ? 1 : -1, len: r.d, off: r.w / 2 } : { axis: 'z', side: lv >= 0 ? 1 : -1, len: r.w, off: r.d / 2 };
}

/** A box on a facade: `along` the facade, `out` from the centre, its size across / up / through. */
function onFace(f: ReturnType<typeof signFace>, along: number, y: number, out: number, sx: number, sy: number, sz: number): BufferGeometry {
  return f.axis === 'z'
    ? new BoxGeometry(sx, sy, sz).translate(along, y, f.side * out).toNonIndexed()
    : new BoxGeometry(sz, sy, sx).translate(f.side * out, y, along).toNonIndexed();
}

const signWidth = (name: string, face: number) => Math.min(face * 0.8, Math.max(4, name.length * 0.42));
const signHeight = (r: Resto) => Math.min(r.eave - 0.7, 3.4);

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
 * Resto r as drawn, in world coordinates: real = its walls, windows and shutters, roof, terrace and parasols on the
 * sign's side, the sign board; generic = the plain block of the other buildings, with its sign board.
 */
export function restoGeometry(r: Resto, real: boolean): BufferGeometry {
  const f = signFace(r);
  const board = paint(onFace(f, 0, signHeight(r), f.off + 0.12, signWidth(r.name, f.len), 1.1, 0.2), () => BOARD);
  if (!real) {
    const levels = Math.max(1, Math.round(r.eave / 2.9));
    const g = building(0, -0.4, 0, r.w, r.d, 0, levels);
    const plinth = paint(new BoxGeometry(r.w + 0.3, r.floor - r.y + 1, r.d + 0.3).translate(0, -(r.floor - r.y + 1) / 2, 0).toNonIndexed(), () => STONE);
    return mergeGeometries([g, board, plinth].map((p) => (p.getAttribute('uv') ? noUv(p) : p))).rotateY(r.yaw).translate(r.x, r.floor, r.z);
  }
  const wall = new Color(r.wallColor), trim = new Color(r.trim);
  const parts: BufferGeometry[] = [
    paint(new BoxGeometry(r.w + 0.3, r.floor - r.y + 1, r.d + 0.3).translate(0, -(r.floor - r.y + 1) / 2, 0).toNonIndexed(), () => STONE), // the plinth, down the slope
    paint(new BoxGeometry(r.w, r.eave, r.d).translate(0, r.eave / 2, 0).toNonIndexed(), () => wall),
    board,
  ];
  if (r.wall === 'wood') parts.push(paint(new BoxGeometry(r.w + 0.06, 0.8, r.d + 0.06).translate(0, 0.4, 0).toNonIndexed(), () => STONE));
  // windows on every facade, a floor every 2.9 m, a shutter each side
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
          parts.push(paint(onFace(fc, a, y, face.off + 0.05, 1.2, 1.35, 0.12), () => trim));
          parts.push(paint(onFace(fc, a, y, face.off + 0.08, 0.9, 1.05, 0.12), () => GLASS));
          if (r.wall !== 'render' || r.trim !== r.wallColor) for (const s of [-1, 1]) parts.push(paint(onFace(fc, a + s * 0.9, y, face.off + 0.07, 0.45, 1.3, 0.1), () => trim));
        }
      }
    }
  }
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
      const pole = onFace(f, a, 1.7, f.off + 3, 0.12, 2.4, 0.12);
      const top = f.axis === 'z' ? [a, 2.9, f.side * (f.off + 3)] : [f.side * (f.off + 3), 2.9, a];
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

/** The station's restaurants: one mesh for the buildings (real or generic), one for the names on their signs. */
export class RestoView {
  readonly group = new Group();
  private body: Mesh;
  private names: Mesh;
  private material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

  constructor(private m: Mountain, real: boolean) {
    this.body = new Mesh(this.build(real), this.material);
    this.names = signs(m);
    this.group.add(this.body, this.names);
  }

  private build(real: boolean): BufferGeometry {
    return this.m.restos.length ? mergeGeometries(this.m.restos.map((r) => restoGeometry(r, real))) : new BufferGeometry();
  }

  setReal(real: boolean): void {
    this.body.geometry.dispose();
    this.body.geometry = this.build(real);
  }

  dispose(): void {
    this.body.geometry.dispose();
    this.names.geometry.dispose();
    (this.names.material as MeshBasicMaterial).map?.dispose();
    (this.names.material as MeshBasicMaterial).dispose();
    this.material.dispose();
  }
}
