/* global Buffer, URL */
// Builds src/sim/rousses-data.ts: the Dôle-Tuffes massif (Station des Rousses) from open data.
//   node scripts/rousses.mjs <download dir>
// The download dir holds (fetched once, see the curl lines below):
//   pistes.json  Overpass: way/relation[piste:type=downhill], way[aerialway], node[natural=peak] in 46.40,6.00,46.50,6.14
//   land.json    Overpass: forest/wood ways+relations, buildings, highways, parkings in 46.412,6.030,46.468,6.118
//   t_14_X_Y.png AWS terrain tiles (terrarium) z14 x 8466–8470, y 5798–5803 — the ski area (~6.6 m/px)
//   b_11_X_Y.png the same at z11 x 1056–1061, y 723–726 — the land around (Léman, the Jura ridges)
// curl -A <ua> --data-urlencode "data=<query>" https://overpass-api.de/api/interpreter
// curl https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// © OpenStreetMap contributors (ODbL) · terrain: Mapzen/AWS terrain tiles (SRTM, EU-DEM…).
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const dir = process.argv[2];
const out = new URL('../src/sim/rousses-data.ts', import.meta.url);

// ── minimal PNG decoder (8-bit RGB / RGBA, non-interlaced: what the terrain tiles are)
function png(file) {
  const b = readFileSync(file);
  let w = 0, h = 0, ch = 3;
  const idat = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); ch = b[o + 17] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * ch), stride = w * ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, up = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      px[dst + x] = (raw[src + x] + pred) & 255;
    }
  }
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = px[i * ch] * 256 + px[i * ch + 1] + px[i * ch + 2] / 256 - 32768;
  return e;
}

/** Elevation (m) at lat/lon from a mosaic of web-mercator tiles at zoom z, bilinear. */
function mosaic(prefix, z, xs, ys) {
  const n = 2 ** z, tiles = new Map();
  for (const x of xs) for (const y of ys) tiles.set(`${x},${y}`, png(join(dir, `${prefix}_${z}_${x}_${y}.png`)));
  const at = (gx, gy) => tiles.get(`${Math.floor(gx / 256)},${Math.floor(gy / 256)}`)[(gy % 256) * 256 + (gx % 256)];
  return (lat, lon) => {
    const r = (lat * Math.PI) / 180;
    const fx = ((lon + 180) / 360) * n * 256 - 0.5, fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256 - 0.5;
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
  };
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fine = mosaic('t', 14, range(8466, 8470), range(5798, 5803));
const wide = mosaic('b', 11, range(1056, 1061), range(723, 726));

// ── local frame: metres, x east, z south (right-handed with y up), origin at the middle of the massif
const LAT0 = 46.44, LON0 = 6.075;
const MY = 111195, MX = 111195 * Math.cos((LAT0 * Math.PI) / 180);
const toXZ = (lat, lon) => [(lon - LON0) * MX, (LAT0 - lat) * MY];
const toLL = (x, z) => [LAT0 - z / MY, LON0 + x / MX];
const r1 = (v) => Math.round(v * 10) / 10;

// the ski area (pistes span 46.424–46.457 N, 6.044–6.110 E) plus a margin of forest
const [X0, Z1] = toXZ(46.4185, 6.0385), [X1, Z0] = toXZ(46.4605, 6.1135);
const STEP = 20;
const nx = Math.ceil((X1 - X0) / STEP) + 1, nz = Math.ceil((Z1 - Z0) / STEP) + 1;
const H = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = fine(...toLL(X0 + i * STEP, Z0 + j * STEP));
let lo = Infinity, hi = -Infinity;
for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
const base = Math.floor(lo) - 1;
const enc16 = (arr, f) => Buffer.from(new Uint16Array(Array.from(arr, f)).buffer).toString('base64');

// the land around, coarse: 48 × 40 km
const BSTEP = 300, BX0 = -24000, BZ0 = -20000, bnx = 161, bnz = 134;
const BH = new Float32Array(bnx * bnz);
for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) BH[j * bnx + i] = wide(...toLL(BX0 + i * BSTEP, BZ0 + j * BSTEP));

// ── OSM
const osm = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).elements;
const pisteEls = osm('pistes.json'), land = osm('land.json');
const inMassif = (g) => g.every((p) => p.lat > 46.418 && p.lat < 46.458 && p.lon > 6.04 && p.lon < 6.112 && !(p.lat > 46.448 && p.lon > 6.095));
const local = (g) => g.map((p) => toXZ(p.lat, p.lon));
const elev = ([x, z]) => fine(...toLL(x, z));

// forests: even-odd scanline per polygon (all member ways of a relation together), OR'ed
const forest = new Uint8Array(nx * nz);
const forests = land.filter((e) => e.tags && (e.tags.landuse === 'forest' || e.tags.natural === 'wood'));
for (const e of forests) {
  const rings = e.type === 'way' ? [e.geometry] : e.members.filter((m) => m.geometry).map((m) => m.geometry);
  const segs = rings.flatMap((g) => local(g).map((p, k, a) => (k ? [a[k - 1], p] : null)).filter(Boolean));
  for (let j = 0; j < nz; j++) {
    const z = Z0 + j * STEP;
    const xs = [];
    for (const [[ax, az], [bx, bz]] of segs) if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil((xs[k] - X0) / STEP)); i < nx && X0 + i * STEP <= xs[k + 1]; i++) forest[j * nx + i] = 1;
    }
  }
}
const bits = new Uint8Array(Math.ceil((nx * nz) / 8));
forest.forEach((v, i) => { if (v) bits[i >> 3] |= 1 << (i & 7); });

// pistes: OSM ways, each oriented downhill; consecutive ways of the same named piste merged into one line
const DIFF = { novice: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black' };
let ways = pisteEls
  .filter((e) => e.type === 'way' && e.tags['piste:type'] === 'downhill' && e.geometry && inMassif(e.geometry))
  .map((e) => {
    let pts = local(e.geometry);
    const area = e.tags.area === 'yes';
    if (!area && elev(pts[0]) < elev(pts[pts.length - 1])) pts = pts.reverse();
    return { name: e.tags.name ?? e.tags['piste:name'] ?? '', diff: DIFF[e.tags['piste:difficulty']] ?? 'blue', area, pts };
  });
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2;
for (let merged = true; merged;) {
  merged = false;
  for (const a of ways) {
    const b = ways.find((w) => w !== a && !w.area && !a.area && w.name && w.name === a.name && near(a.pts[a.pts.length - 1], w.pts[0]));
    if (!b) continue;
    a.pts = a.pts.concat(b.pts.slice(1));
    ways = ways.filter((w) => w !== b);
    merged = true;
    break;
  }
}
const pistes = ways.map((w) => ({ name: w.name, diff: w.diff, ...(w.area ? { area: true } : {}), pts: w.pts.flat().map(r1) }));

// lifts: bottom → top; chairs seat riders, everything else tows them along the snow
const lifts = pisteEls
  .filter((e) => e.type === 'way' && e.tags.aerialway && !['station', 'cable_car', 'pylon'].includes(e.tags.aerialway) && inMassif(e.geometry))
  .map((e) => {
    let pts = local(e.geometry);
    if (elev(pts[0]) > elev(pts[pts.length - 1])) pts = pts.reverse();
    const kind = e.tags.aerialway === 'chair_lift' ? 'chair' : e.tags.aerialway === 'magic_carpet' ? 'carpet' : 'drag';
    return { name: e.tags.name ?? '', kind, seats: +(e.tags['aerialway:occupancy'] ?? 0), pts: pts.flat().map(r1) };
  });

// roads (cleared in winter), building footprints as oriented boxes
const inDomain = ([x, z]) => x > X0 && x < X1 && z > Z0 && z < Z1;
const roads = land
  .filter((e) => e.type === 'way' && /^(primary|secondary|tertiary)$/.test(e.tags?.highway ?? '') && e.geometry)
  .map((e) => local(e.geometry).filter(inDomain))
  .filter((g) => g.length > 1)
  .map((g) => g.flat().map(r1));
const buildings = land
  .filter((e) => e.type === 'way' && e.tags?.building && e.geometry)
  .map((e) => {
    const g = local(e.geometry);
    let best = 0, yaw = 0;
    for (let k = 1; k < g.length; k++) {
      const l = Math.hypot(g[k][0] - g[k - 1][0], g[k][1] - g[k - 1][1]);
      if (l > best) { best = l; yaw = Math.atan2(g[k][0] - g[k - 1][0], g[k][1] - g[k - 1][1]); }
    }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of g) {
      const u = x * c - z * s, v = x * s + z * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    const levels = +(e.tags['building:levels'] ?? 0) || ((u1 - u0) * (v1 - v0) > 500 ? 3 : 1);
    return { x: um * c + vm * s, z: -um * s + vm * c, w: u1 - u0, d: v1 - v0, yaw, levels, radar: /Radar/.test(e.tags.name ?? '') };
  })
  .filter((b) => inDomain([b.x, b.z]) && b.w > 3 && b.d > 3);
const radar = buildings.find((b) => b.radar);
const peaks = pisteEls.filter((e) => e.type === 'node' && e.tags.natural === 'peak').map((e) => [e.tags.name, ...toXZ(e.lat, e.lon).map(r1), +e.tags.ele || 0])
  .filter(([, x, z]) => inDomain([x, z]));

const data = {
  origin: [LAT0, LON0],
  grid: { x0: r1(X0), z0: r1(Z0), step: STEP, nx, nz, base, h: enc16(H, (v) => Math.round((v - base) * 100)), forest: Buffer.from(bits).toString('base64') },
  around: { x0: BX0, z0: BZ0, step: BSTEP, nx: bnx, nz: bnz, h: enc16(BH, (v) => Math.max(0, Math.round(v * 10))) },
  pistes,
  lifts,
  roads,
  buildings: buildings.filter((b) => !b.radar).map((b) => [b.x, b.z, b.w, b.d, b.yaw, b.levels].map((v, i) => (i === 4 ? Math.round(v * 1000) / 1000 : i === 5 ? v : r1(v)))),
  radar: radar ? [r1(radar.x), r1(radar.z)] : null,
  peaks,
};
writeFileSync(out, `// Generated by scripts/rousses.mjs — do not edit. © OpenStreetMap contributors (ODbL), terrain: AWS terrain tiles.\n` +
  `export const ROUSSES = ${JSON.stringify(data)};\n`);
console.log({ nx, nz, lo, hi, base, forestCells: forest.reduce((a, v) => a + v, 0), pistes: pistes.length, lifts: lifts.length, roads: roads.length, buildings: buildings.length, peaks, bytes: readFileSync(out).length });
for (const l of lifts) { const p = l.pts; console.log('lift', l.kind, l.name, Math.round(elev([p[0], p[1]])), '→', Math.round(elev([p.at(-2), p.at(-1)])), Math.round(Math.hypot(p.at(-2) - p[0], p.at(-1) - p[1])) + ' m'); }
for (const p of pistes) if (p.name) { const q = p.pts; console.log('piste', p.diff, p.name, Math.round(elev([q[0], q[1]])), '→', Math.round(elev([q.at(-2), q.at(-1)])), q.length / 2 + ' pts'); }
