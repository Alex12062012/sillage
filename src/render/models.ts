import { BufferGeometry, Color } from 'three';
import { Geo, gableRoof, WINDOW } from './buildings';

/**
 * Lift and piste equipment, built in code (DECISIONS.md, point 99): chair, tower, lift station, piste pole, piste sign,
 * safety net, fan snow gun, parked groomer, tower pad. Flat triangles with one colour each (see Geo), no hidden faces.
 */

type P = [number, number, number];

/** A square bar from a to b (4 sides, no ends): hangers, arms, posts. */
export function bar(g: Geo, a: P, b: P, r: number, k: Color): void {
  const d: P = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d);
  const u: P = [d[0] / l, d[1] / l, d[2] / l];
  const ref: P = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (x: P, y: P): P => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  let e1 = cross(u, ref);
  const n1 = Math.hypot(...e1);
  e1 = [e1[0] / n1, e1[1] / n1, e1[2] / n1];
  const e2 = cross(u, e1);
  const at = (c: P, i: number): P => {
    const t = (i / 4) * Math.PI * 2 + Math.PI / 4, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [c[0] + e1[0] * cs + e2[0] * sn, c[1] + e1[1] * cs + e2[1] * sn, c[2] + e1[2] * cs + e2[2] * sn];
  };
  for (let i = 0; i < 4; i++) g.quad(at(a, i), at(a, i + 1), at(b, i + 1), at(b, i), k);
}

/** A vertical tube of n sides from y0 to y1 at (cx, cz), radius r0 to r1, without its ends. */
export function tube(g: Geo, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, n: number, k: Color): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    g.quad([cx + Math.cos(a) * r0, y0, cz - Math.sin(a) * r0], [cx + Math.cos(b) * r0, y0, cz - Math.sin(b) * r0],
      [cx + Math.cos(b) * r1, y1, cz - Math.sin(b) * r1], [cx + Math.cos(a) * r1, y1, cz - Math.sin(a) * r1], k);
  }
}

/** A flat disc of n sides at height y, facing up (or down). */
function disc(g: Geo, cx: number, cz: number, y: number, r: number, n: number, k: Color, down = false): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    const p: P = [cx + Math.cos(a) * r, y, cz - Math.sin(a) * r], q: P = [cx + Math.cos(b) * r, y, cz - Math.sin(b) * r];
    if (down) g.tri([cx, y, cz], q, p, k);
    else g.tri([cx, y, cz], p, q, k);
  }
}

const C = (hex: number) => new Color(hex);
const STEEL = C(0x7d8692), DARK = C(0x2d3340), GRIP = C(0x3b4352), CUSHION = C(0x2a6bd1), CONCRETE = C(0xa19d95);
const SNOW = C(0xf2f5f9), ORANGE = C(0xf07a22), WHITE = C(0xeef1f4);

/**
 * A chair (scale 1 = 3 seats, stretched in x by the instance), hung 2.3 m under the grip: the seat and back stay where
 * the rider's pose expects them (seat top at −2.24, centred 0.1 m forward). Grip, hanger bent to the back, cushioned
 * back with its frame, armrests, the safety bar raised overhead.
 */
export function chairGeometry(): BufferGeometry {
  const g = new Geo();
  g.block(0, -0.12, 0, 0.3, 0.24, 0.4, GRIP);
  bar(g, [0, -0.2, 0], [0, -1.5, 0], 0.045, STEEL);
  bar(g, [0, -1.5, 0], [0, -1.78, -0.3], 0.045, STEEL);
  bar(g, [-0.92, -1.78, -0.3], [0.92, -1.78, -0.3], 0.035, STEEL);
  g.block(0, -2.03, -0.25, 1.8, 0.45, 0.08, CUSHION);
  g.block(0, -2.3, 0.1, 1.8, 0.12, 0.6, CUSHION);
  for (const s of [-1, 1]) {
    bar(g, [s * 0.93, -2.24, 0.38], [s * 0.93, -1.95, -0.28], 0.03, STEEL); // armrest
    bar(g, [s * 0.93, -1.95, -0.28], [s * 0.93, -1.1, 0.12], 0.03, STEEL); // the safety bar's arm, raised
  }
  bar(g, [-0.93, -1.1, 0.12], [0.93, -1.1, 0.12], 0.03, STEEL);
  return g.build();
}

/** A lift tower `h` high, its cross-arm `side` each way: concrete foot, tapered mast, sheave trains at the arm's ends. */
export function towerGeometry(h: number, side: number): BufferGeometry {
  const g = new Geo(), k = Math.max(1, h / 10); // gondola towers are stouter
  g.block(0, 0.3, 0, 1.4 * k, 0.6, 1.4 * k, CONCRETE, SNOW);
  tube(g, 0, 0, 0.6, h, 0.34 * k, 0.2 * k, 6, STEEL);
  g.block(0, h, 0, side * 2 + 1, 0.4 * k, 0.4, GRIP);
  for (const s of [-1, 1]) g.block(s * side, h - 0.32 * k, 0, 0.32, 0.26 * k, 2.4 * Math.min(k, 1.6), DARK);
  return g.build();
}

/**
 * A chairlift station (scale 1, the gondola's scaled up): a concrete platform with its snow, a steel post, the
 * bull-wheel at the cable's height, a gabled canopy on four posts, an operator's cabin with windows.
 */
export function stationGeometry(towerH: number, side: number): BufferGeometry {
  const g = new Geo();
  g.block(0, 0.6, 0, 9, 1.2, 7, CONCRETE, C(0xdfe3e8));
  const wheelY = towerH - 0.8, eave = Math.max(7.1, wheelY + 0.7); // the canopy over the bull-wheel
  for (const [x, z] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) bar(g, [x, 1.2, z], [x, eave, z], 0.14, STEEL);
  g.block(0, (1.2 + wheelY) / 2, 0, 0.8, wheelY - 1.2, 0.8, GRIP);
  tube(g, 0, 0, wheelY - 0.2, wheelY + 0.2, side, side, 12, DARK);
  disc(g, 0, 0, wheelY + 0.2, side, 12, DARK);
  disc(g, 0, 0, wheelY - 0.2, side, 12, DARK, true);
  gableRoof(g, 11, 9, eave, { pitch: 0.28, over: 0.3, gableOver: 0.2, snow: SNOW, under: C(0xb8423a), edge: C(0xd94f3d), gable: C(0xd94f3d) });
  // the operator's cabin on the platform, by the exit
  g.walls(3.0, -2.0, 2.6, 2.2, 1.2, 3.7, C(0xd8d2c4));
  g.block(3.0, 3.8, -2.0, 2.9, 0.2, 2.5, GRIP, SNOW);
  g.quad([1.9, 2.3, -0.88], [4.1, 2.3, -0.88], [4.1, 3.3, -0.88], [1.9, 3.3, -0.88], WINDOW);
  g.quad([4.32, 2.3, -1.0], [4.32, 2.3, -3.0], [4.32, 3.3, -3.0], [4.32, 3.3, -1.0], WINDOW);
  return g.build();
}

/** A piste pole in its piste's colour, baked into g (the props layer): post and plate, 12 triangles. */
export function pole(g: Geo, k: Color, x: number, y: number, z: number): void {
  const s = new Geo();
  bar(s, [0, 0, 0], [0, 1.9, 0], 0.045, k);
  const a: P = [-0.02, 1.62, -0.14], b: P = [-0.02, 1.62, 0.14], c: P = [-0.02, 1.86, 0.14], d: P = [-0.02, 1.86, -0.14];
  s.quad(a, b, c, d, k).quad(b, a, d, c, k);
  append(g, s, x, y, z, 0);
}

/** A piste sign: two posts and a panel in the piste's colour with a white border, facing +z. */
export function pisteSign(g: Geo, k: Color, x: number, y: number, z: number, yaw: number): void {
  const s = new Geo();
  for (const px of [-0.45, 0.45]) bar(s, [px, 0, -0.04], [px, 1.9, -0.04], 0.04, GRIP);
  s.block(0, 1.6, 0, 1.15, 0.75, 0.06, WHITE);
  s.quad([-0.5, 1.28, 0.035], [0.5, 1.28, 0.035], [0.5, 1.92, 0.035], [-0.5, 1.92, 0.035], k);
  append(g, s, x, y, z, yaw);
}

/** A safety net between two ground points (a and b, their heights included): two posts, the orange mesh both ways. */
export function net(g: Geo, a: P, b: P): void {
  bar(g, a, [a[0], a[1] + 1.8, a[2]], 0.05, GRIP);
  bar(g, b, [b[0], b[1] + 1.8, b[2]], 0.05, GRIP);
  const a0: P = [a[0], a[1] + 0.2, a[2]], b0: P = [b[0], b[1] + 0.2, b[2]], b1: P = [b[0], b[1] + 1.7, b[2]], a1: P = [a[0], a[1] + 1.7, a[2]];
  g.quad(a0, b0, b1, a1, ORANGE).quad(b0, a0, a1, b1, ORANGE);
}

/** A fan snow gun on its carriage, barrel tilted up towards +z. */
export function snowGun(g: Geo, x: number, y: number, z: number, yaw: number): void {
  const s = new Geo();
  s.block(0, 0.35, 0, 1.0, 0.5, 1.5, GRIP);
  bar(s, [0, 0.6, 0], [0, 1.5, 0.1], 0.08, STEEL);
  // the barrel: a tube along its own axis, built upright then tilted 25° and lifted
  const b = new Geo();
  tube(b, 0, 0, -0.75, 0.75, 0.6, 0.55, 8, C(0xe8b62c)); // a bright barrel: read from the chairlift
  disc(b, 0, 0, -0.75, 0.6, 8, DARK, true);
  disc(b, 0, 0, 0.75, 0.55, 8, C(0x1d2128));
  const bg = b.build().rotateX(Math.PI / 2 - 0.44).translate(0, 1.9, 0.25);
  const p = bg.attributes.position.array as Float32Array, c = bg.attributes.color.array as Float32Array;
  s.pos.push(...p);
  s.col.push(...c);
  append(g, s, x, y, z, yaw);
}

/** A groomer parked for the day: tracks, red body, cabin with windows, front blade, rear tiller; facing +z. */
export function groomer(g: Geo, x: number, y: number, z: number, yaw: number): void {
  const s = new Geo(), red = C(0xc8312b);
  for (const sx of [-1, 1]) s.block(sx * 1.25, 0.42, 0, 0.75, 0.84, 4.8, DARK);
  s.block(0, 1.25, -0.3, 2.3, 0.9, 3.8, red);
  s.walls(0, 0.7, 2.0, 1.8, 1.7, 2.8, red);
  s.block(0, 2.9, 0.7, 2.1, 0.2, 1.9, red, SNOW);
  s.quad([-0.95, 1.95, 1.61], [0.95, 1.95, 1.61], [0.95, 2.7, 1.61], [-0.95, 2.7, 1.61], WINDOW);
  for (const sx of [-1, 1]) s.quad([sx * 1.01, 1.95, sx > 0 ? 1.5 : -0.1], [sx * 1.01, 1.95, sx > 0 ? -0.1 : 1.5], [sx * 1.01, 2.7, sx > 0 ? -0.1 : 1.5], [sx * 1.01, 2.7, sx > 0 ? 1.5 : -0.1], WINDOW);
  s.block(0, 0.65, 2.9, 3.4, 1.1, 0.25, STEEL);
  s.block(0, 0.5, -2.85, 2.8, 0.55, 1.0, GRIP);
  append(g, s, x, y, z, yaw);
}

/** An orange pad around a tower's foot (towers standing on a piste). */
export function towerPad(g: Geo, x: number, y: number, z: number): void {
  const s = new Geo();
  tube(s, 0, 0, 0, 2.4, 0.75, 0.75, 8, ORANGE);
  disc(s, 0, 0, 2.4, 0.75, 8, ORANGE);
  append(g, s, x, y, z, 0);
}

/** Copies a local model into g, turned by yaw (local +z towards (sin yaw, cos yaw)) and placed at (x, y, z). */
function append(g: Geo, s: Geo, x: number, y: number, z: number, yaw: number): void {
  const c = Math.cos(yaw), sn = Math.sin(yaw), p = s.pos;
  for (let i = 0; i < p.length; i += 3) g.pos.push(x + p[i] * c + p[i + 2] * sn, y + p[i + 1], z - p[i] * sn + p[i + 2] * c);
  g.col.push(...s.col);
}

const WOOD = C(0x7a5236), WOOD_DARK = C(0x5a3c28), IRON = C(0x3a3f47);

/** A park bench: seat and back in wood on iron legs, snow on the seat; facing +z. */
export function bench(g: Geo, x: number, y: number, z: number, yaw: number): void {
  const s = new Geo();
  s.block(0, 0.45, 0, 1.6, 0.06, 0.42, WOOD, SNOW);
  s.block(0, 0.72, -0.2, 1.6, 0.34, 0.05, WOOD);
  for (const lx of [-0.7, 0.7]) { bar(s, [lx, 0, 0.15], [lx, 0.45, 0.12], 0.03, IRON); bar(s, [lx, 0, -0.18], [lx, 0.9, -0.22], 0.03, IRON); }
  append(g, s, x, y, z, yaw);
}

/** A ski rack 2.4 m long, five pairs of skis leaning on it (colours from `seed`); along x. */
export function skiRack(g: Geo, x: number, y: number, z: number, yaw: number, seed: number): void {
  const s = new Geo(), cols = [0x3a7bd5, 0xe0393e, 0xf2c14e, 0x2fa84f, 0xeef1f4, 0x1d1f26].map(C);
  for (const lx of [-1.15, 1.15]) bar(s, [lx, 0, 0], [lx, 1.25, 0], 0.04, IRON);
  bar(s, [-1.2, 1.2, 0], [1.2, 1.2, 0], 0.035, IRON);
  bar(s, [-1.2, 0.5, 0], [1.2, 0.5, 0], 0.03, IRON);
  for (let k = 0; k < 5; k++) {
    const lx = -0.9 + k * 0.45, c = cols[(seed + k * 7) % cols.length];
    for (const dx of [-0.05, 0.05]) s.block(lx + dx, 0.85, 0.12, 0.07, 1.7, 0.02, c);
  }
  append(g, s, x, y, z, yaw);
}

/** A street lamp 4.5 m high, its arm towards +z; the glass glows at dusk (the window marker). */
export function lamp(g: Geo, x: number, y: number, z: number, yaw: number, far = false): void {
  const s = new Geo();
  if (far) { bar(s, [0, 0, 0], [0, 4.5, 0], 0.07, IRON); append(g, s, x, y, z, yaw); return; }
  tube(s, 0, 0, 0, 4.4, 0.09, 0.06, 6, C(0x5b6576)); // a lighter grey: the black tube vanished against the trees
  bar(s, [0, 4.35, 0], [0, 4.45, 0.55], 0.035, C(0x5b6576));
  s.block(0, 4.25, 0.6, 0.42, 0.34, 0.42, C(0x5b6576), SNOW);
  // the lantern under the head, its glass on four sides
  for (const [a, b] of [[[-0.15, 3.86, 0.75], [0.15, 3.86, 0.75]], [[0.15, 3.86, 0.45], [-0.15, 3.86, 0.45]], [[0.15, 3.86, 0.75], [0.15, 3.86, 0.45]], [[-0.15, 3.86, 0.45], [-0.15, 3.86, 0.75]]] as const) {
    s.quad([a[0], a[1], a[2]], [b[0], b[1], b[2]], [b[0], b[1] + 0.22, b[2]], [a[0], a[1] + 0.22, a[2]], WINDOW);
  }
  append(g, s, x, y, z, yaw);
}

/** A ski patrol hut, 3 × 2.5 m: boarded walls, a snowy gable roof, a door and a window; its door on +z. */
export function hut(g: Geo, x: number, y: number, z: number, yaw: number, far = false): void {
  const s = new Geo();
  s.walls(0, 0, 3, 2.5, 0, 2.3, WOOD_DARK);
  gableRoof(s, 3, 2.5, 2.3, { pitch: 0.55, over: 0.35, gableOver: 0.3, snow: SNOW, under: WOOD, edge: C(0xe4e9f0), gable: WOOD_DARK });
  if (!far) {
    s.quad([0.3, 0, 1.26], [1.1, 0, 1.26], [1.1, 1.9, 1.26], [0.3, 1.9, 1.26], C(0xc8312b));
    s.quad([-1.1, 1.0, 1.26], [-0.3, 1.0, 1.26], [-0.3, 1.7, 1.26], [-1.1, 1.7, 1.26], WINDOW);
    // the rescue sign on the gable: a white cross on red
    s.quad([-0.45, 2.45, 1.27], [0.45, 2.45, 1.27], [0.45, 3.1, 1.27], [-0.45, 3.1, 1.27], C(0xc8312b));
    s.quad([-0.08, 2.53, 1.28], [0.08, 2.53, 1.28], [0.08, 3.02, 1.28], [-0.08, 3.02, 1.28], WHITE);
    s.quad([-0.28, 2.7, 1.28], [0.28, 2.7, 1.28], [0.28, 2.86, 1.28], [-0.28, 2.86, 1.28], WHITE);
  }
  append(g, s, x, y, z, yaw);
}

/** The piste map board: two posts, a framed board with a small roof, facing +z. */
export function mapBoard(g: Geo, x: number, y: number, z: number, yaw: number, far = false): void {
  const s = new Geo();
  for (const lx of [-1.1, 1.1]) bar(s, [lx, 0, 0], [lx, 2.6, 0], 0.06, WOOD_DARK);
  s.block(0, 1.75, 0, 2.6, 1.5, 0.08, WOOD_DARK);
  if (!far) {
    s.quad([-1.2, 1.08, 0.045], [1.2, 1.08, 0.045], [1.2, 2.42, 0.045], [-1.2, 2.42, 0.045], C(0xe9eef2));
    // the map's pistes, a few strokes of colour
    for (const [k, x0, x1, y0, y1] of [[0x2f6fde, -0.9, -0.2, 2.3, 1.2], [0xe0393e, -0.1, 0.4, 2.35, 1.15], [0x1d1f26, 0.5, 1.0, 2.3, 1.3], [0x2fa84f, -1.0, 1.0, 1.25, 1.2]] as const) {
      s.quad([x1, y1 - 0.04, 0.05], [x1 + 0.06, y1, 0.05], [x0 + 0.06, y0, 0.05], [x0, y0 - 0.04, 0.05], C(k));
    }
  }
  s.block(0, 2.62, 0, 2.9, 0.08, 0.4, WOOD_DARK, SNOW);
  append(g, s, x, y, z, yaw);
}
