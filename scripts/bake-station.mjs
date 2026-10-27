/* global Buffer, URL */
// Builds src/sim/<station>-data.ts: a ski area from open data, for the free ride.
//   node scripts/bake-station.mjs <station> <download dir> [control.png]
// Stations (see STATIONS below for what each download dir holds and where it came from):
//   rousses  the Dôle-Tuffes massif, Station des Rousses (Jura)
//   avoriaz  Avoriaz from Morzine (Super-Morzine) to the Swiss Wall (Portes du Soleil)
// curl -A <ua> --data-urlencode "data=<query>" https://overpass-api.de/api/interpreter (or overpass.osm.ch, overpass.openstreetmap.fr)
// curl https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// IGN BD TOPO (France): https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:<layer>
//   &OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&BBOX=<lonW>,<latS>,<lonE>,<latN>,CRS:84&COUNT=1000&STARTINDEX=<n>
// © OpenStreetMap contributors (ODbL) · IGN BD TOPO (Licence Ouverte) · terrain: Mapzen/AWS terrain tiles (SRTM, EU-DEM…).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { join } from 'node:path';

const [id, dir, controlPng] = process.argv.slice(2);

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
const osm = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).elements;
const geojson = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).features;
const ll = ([lon, lat]) => ({ lat, lon });
const complete = (g) => !!g && g.length > 1 && g.every(Boolean);

/** OSM elements of several downloads, each id once (the first complete copy wins: a server clips what lies outside its extract). */
function merged(files) {
  const by = new Map();
  for (const f of files.filter((n) => existsSync(join(dir, n)))) {
    for (const e of osm(f)) {
      const k = `${e.type}${e.id}`, ok = e.type === 'node' || (e.type === 'way' ? complete(e.geometry) : e.members.every((m) => m.type !== 'way' || complete(m.geometry)));
      if (!by.has(k) || (ok && !by.get(k).ok)) by.set(k, { e, ok });
    }
  }
  return [...by.values()].filter((v) => v.ok).map((v) => v.e);
}

/** Every ring of an OSM forest (a way, or all the member ways of a relation together: even-odd needs no ring building). */
const osmRings = (e) => (e.type === 'way' ? [e.geometry] : e.members.filter((m) => m.geometry).map((m) => m.geometry));

/**
 * The stations. Each reads its download dir into plain lists (lat/lon geometry) and says what belongs to the ski area.
 *   origin   the local frame's (0, 0); box the massif's 20 m grid [latS, lonW, latN, lonE]
 *   fine / wide  terrain tile mosaics (the massif ~6.6 m/px, the land around); around: the coarse land grid
 */
const STATIONS = {
  // pistes.json  Overpass: way/relation[piste:type=downhill], way[aerialway], node[natural=peak] in 46.40,6.00,46.50,6.14
  // land.json    Overpass: forest/wood ways+relations, buildings, highways, parkings in 46.412,6.030,46.468,6.118
  // t_14_X_Y.png z14 x 8466–8470, y 5798–5803 — the ski area · b_11_X_Y.png z11 x 1056–1061, y 723–726 — the Léman, the Jura ridges
  rousses: {
    name: 'ROUSSES', origin: [46.44, 6.075], box: [46.4185, 6.0385, 46.468, 6.1135], // north to La Cure (L'Arbezie, Chez Mamac)
    fine: ['t', 14, range(8466, 8470), range(5798, 5803)], wide: ['b', 11, range(1056, 1061), range(723, 726)],
    around: { step: 300, x0: -24000, z0: -20000, nx: 161, nz: 134 },
    read() {
      const pisteEls = osm('pistes.json'), land = osm('land.json');
      // the Dôle-Tuffes massif only: not the Serra, not La Trélasse
      const keep = (g) => g.every((p) => p.lat > 46.418 && p.lat < 46.458 && p.lon > 6.04 && p.lon < 6.112 && !(p.lat > 46.448 && p.lon > 6.095));
      return {
        pistes: pisteEls.filter((e) => e.type === 'way' && e.tags['piste:type'] === 'downhill' && e.geometry && keep(e.geometry)),
        lifts: pisteEls.filter((e) => e.type === 'way' && e.tags.aerialway && !['station', 'cable_car', 'pylon'].includes(e.tags.aerialway) && keep(e.geometry)),
        peaks: pisteEls.filter((e) => e.type === 'node' && e.tags.natural === 'peak'),
        forests: land.filter((e) => e.tags && (e.tags.landuse === 'forest' || e.tags.natural === 'wood')).map(osmRings),
        roads: land.filter((e) => e.type === 'way' && /^(primary|secondary|tertiary)$/.test(e.tags?.highway ?? '') && e.geometry).map((e) => e.geometry),
        buildings: land.filter((e) => e.type === 'way' && e.tags?.building && e.geometry)
          .map((e) => ({ ring: e.geometry, levels: +(e.tags['building:levels'] ?? 0), radar: /Radar/.test(e.tags.name ?? '') })),
      };
    },
  },

  // pistes.json, forests.json, buildings.json  Overpass (overpass.osm.ch, which clips France west of ~6.71 E); fr/pistes.json,
  //   fr/highways.json  the same from overpass.openstreetmap.fr (France complete): way/relation[piste:type=downhill], way[aerialway],
  //   node[natural=peak] in 46.13,6.66,46.25,6.88 · forests, buildings, highways, parkings in 46.160,6.690,46.222,6.830
  // border.json  way[boundary=administrative][admin_level=2] in 46.13,6.66,46.25,6.88
  // ign_vegetation.json, ign_buildings.json  IGN BD TOPO zone_de_vegetation, batiment in 6.69,46.16,6.83,46.222 (France:
  //   forests and buildings complete, with their heights)
  // t_14_X_Y.png z14 x 8496–8503, y 5813–5818 · b_10_X_Y.png z10 x 529–532, y 362–365 (the Léman, Mont Blanc, the Dents du Midi)
  avoriaz: {
    name: 'AVORIAZ', origin: [46.19, 6.77], box: [46.1621, 6.6934, 46.2179, 6.8258], from: 'Super-Morzine',
    fine: ['t', 14, range(8496, 8503), range(5813, 5818)], wide: ['b', 10, range(529, 532), range(362, 365)],
    around: { step: 300, x0: -32000, z0: -30000, nx: 214, nz: 261 },
    read({ toXZ }) {
      const els = merged(['fr/pistes.json', 'pistes.json']);
      // France is west of the border (it runs north–south here, Switzerland east of it)
      const border = osm('border.json').map((e) => e.geometry.map((p) => toXZ(p.lat, p.lon)));
      const chain = [border.find((g) => !border.some((h) => h !== g && near(h[h.length - 1], g[0])))];
      for (let g; (g = border.find((h) => near(h[0], chain[chain.length - 1].at(-1))));) chain.push(g);
      const line = chain.flat();
      const france = [...line, [line.at(-1)[0], 1e5], [-1e5, 1e5], [-1e5, -1e5], [line[0][0], -1e5]];
      const inFrance = ([x, z]) => inside(france, x, z);
      const intoSwitzerland = ([x, z]) => (inFrance([x, z]) ? 0 : Math.min(...line.slice(1).map((b, k) => segDist(x, z, line[k], b))));
      // the ski area: Super-Morzine (from the village) to the Swiss Wall, the Lindarets and Ardent; not the Pleney, not Châtel,
      // not Les Crosets (the pistes along the border ridge, a few hundred metres into Switzerland, belong to it)
      const area = ([x, z]) => x > -5600 && x < 4000 && z > -2800 && z < 2800 && !(x < -4600 && z > 900);
      const swissWall = (e) => /Chavanette/.test(e.tags.name ?? '');
      const keep = (e) => {
        const g = e.geometry.map((p) => toXZ(p.lat, p.lon));
        return g.every(area) && (g.every((p) => intoSwitzerland(p) < 600) || swissWall(e));
      };
      const FOREST = /^(Forêt|Bois)/;
      const swiss = (g) => !inFrance(toXZ(g[0].lat, g[0].lon));
      return {
        pistes: els.filter((e) => e.type === 'way' && e.tags['piste:type'] === 'downhill' && keep(e)),
        lifts: els.filter((e) => e.type === 'way' && e.tags.aerialway && keep(e)),
        peaks: els.filter((e) => e.type === 'node' && e.tags.natural === 'peak'),
        forests: [
          ...geojson('ign_vegetation.json').filter((f) => FOREST.test(f.properties.nature)).flatMap((f) => f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(ll)))),
          ...merged(['forests.json']).map(osmRings).filter((rings) => swiss(rings[0])),
        ],
        roads: merged(['fr/highways.json']).filter((e) => e.type === 'way' && /^(primary|secondary|tertiary)$/.test(e.tags.highway ?? '')).map((e) => e.geometry),
        buildings: [
          ...geojson('ign_buildings.json').map((f) => {
            const p = f.properties, wall = (p.altitude_minimale_toit ?? 0) - (p.altitude_minimale_sol ?? 0);
            return { ring: f.geometry.coordinates[0][0].map(ll), levels: p.nombre_d_etages || Math.max(1, Math.round((wall > 1 ? wall : (p.hauteur ?? 3) * 0.75) / 2.9)) };
          }),
          ...merged(['buildings.json']).filter((e) => e.type === 'way' && swiss(e.geometry)).map((e) => ({ ring: e.geometry, levels: +(e.tags['building:levels'] ?? 0) })),
        ],
      };
    },
  },
};

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2;
const segDist = (x, z, [ax, az], [bx, bz]) => {
  const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
};
const inside = (poly, x, z) => {
  let r = false;
  for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
    if ((poly[k][1] > z) !== (poly[m][1] > z) && x < poly[k][0] + ((z - poly[k][1]) / (poly[m][1] - poly[k][1])) * (poly[m][0] - poly[k][0])) r = !r;
  }
  return r;
};

const S = STATIONS[id];
if (!S || !dir) throw new Error(`usage: node scripts/bake-station.mjs <${Object.keys(STATIONS).join('|')}> <download dir> [control.png]`);
const out = new URL(`../src/sim/${id}-data.ts`, import.meta.url);
const fine = mosaic(...S.fine);
const wide = mosaic(...S.wide);

// ── local frame: metres, x east, z south (right-handed with y up), origin at the middle of the massif
const [LAT0, LON0] = S.origin;
const MY = 111195, MX = 111195 * Math.cos((LAT0 * Math.PI) / 180);
const toXZ = (lat, lon) => [(lon - LON0) * MX, (LAT0 - lat) * MY];
const toLL = (x, z) => [LAT0 - z / MY, LON0 + x / MX];
const r1 = (v) => Math.round(v * 10) / 10;

// the ski area plus a margin of forest
const [X0, Z1] = toXZ(S.box[0], S.box[1]), [X1, Z0] = toXZ(S.box[2], S.box[3]);
const STEP = 20;
const nx = Math.ceil((X1 - X0) / STEP) + 1, nz = Math.ceil((Z1 - Z0) / STEP) + 1;
const H = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = fine(...toLL(X0 + i * STEP, Z0 + j * STEP));
let lo = Infinity, hi = -Infinity;
for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
const base = Math.floor(lo) - 1;
const perM = 100 / Math.ceil((hi - base) / 655.35); // steps per metre of the 16-bit heights: 1 cm while the relief fits (610 m at Les Rousses)
const enc16 = (arr, f) => Buffer.from(new Uint16Array(Array.from(arr, f)).buffer).toString('base64');

// the land around, coarse
const A = S.around;
const BH = new Float32Array(A.nx * A.nz);
for (let j = 0; j < A.nz; j++) for (let i = 0; i < A.nx; i++) BH[j * A.nx + i] = wide(...toLL(A.x0 + i * A.step, A.z0 + j * A.step));

// ── what the station reads from its downloads
const src = S.read({ toXZ });
const local = (g) => g.map((p) => toXZ(p.lat, p.lon));
const elev = ([x, z]) => fine(...toLL(x, z));

// forests: even-odd scanline per polygon (all its rings together), OR'ed
const forest = new Uint8Array(nx * nz);
for (const rings of src.forests) {
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
const DIFF = { novice: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black', freeride: 'black', extreme: 'black' };
let ways = src.pistes.map((e) => {
  let pts = local(e.geometry);
  const area = e.tags.area === 'yes';
  if (!area && elev(pts[0]) < elev(pts[pts.length - 1])) pts = pts.reverse();
  return { name: e.tags.name ?? e.tags['piste:name'] ?? '', diff: DIFF[e.tags['piste:difficulty']] ?? 'blue', area, pts };
});
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

// lifts: bottom → top. Chairs seat riders, gondolas and cable cars carry them in a cabin, the rest tow them along the snow
const KIND = { chair_lift: 'chair', mixed_lift: 'chair', gondola: 'gondola', cable_car: 'gondola', magic_carpet: 'carpet', drag_lift: 'drag', 't-bar': 'drag', 'j-bar': 'drag', platter: 'drag', rope_tow: 'drag' };
let lines = src.lifts
  .filter((e) => KIND[e.tags.aerialway] || !['station', 'pylon', 'zip_line', 'goods', 'canopy'].includes(e.tags.aerialway))
  .map((e) => {
    let pts = local(e.geometry);
    if (elev(pts[0]) > elev(pts[pts.length - 1])) pts = pts.reverse();
    return { name: e.tags.name ?? '', kind: KIND[e.tags.aerialway] ?? 'drag', seats: +(e.tags['aerialway:occupancy'] ?? 0), pts };
  });
// a lift OSM splits at its pylons (same name, the top of one is the bottom of the next) is one lift
for (let merged = true; merged;) {
  merged = false;
  for (const a of lines) {
    const b = lines.find((l) => l !== a && l.name && l.name === a.name && l.kind === a.kind && near(a.pts[a.pts.length - 1], l.pts[0]));
    if (!b) continue;
    a.pts = a.pts.concat(b.pts.slice(1));
    lines = lines.filter((l) => l !== b);
    merged = true;
    break;
  }
}
let lifts = lines.map((l) => ({ ...l, pts: l.pts.flat().map(r1) }));

// the ski area is what the start lift reaches: a piste joins what its ends touch (or what touches it), a lift what its
// stations stand on (none of the dead ends that lead to another resort's lifts)
if (S.from) {
  const R = 50;
  const segNear = (p, x, z) => {
    for (let k = 2; k < p.length; k += 2) {
      const vx = p[k] - p[k - 2], vz = p[k + 1] - p[k - 1], t = Math.max(0, Math.min(1, ((x - p[k - 2]) * vx + (z - p[k - 1]) * vz) / (vx * vx + vz * vz || 1)));
      if (Math.hypot(x - p[k - 2] - vx * t, z - p[k - 1] - vz * t) < R) return true;
    }
    return p.length === 2 && Math.hypot(x - p[0], z - p[1]) < R;
  };
  const station = (l, f) => (f ? [l.pts.at(-2), l.pts.at(-1)] : [l.pts[0], l.pts[1]]);
  const nodes = [
    ...pistes.map((p) => ({ item: p, line: p.pts, ends: p.area ? Array.from({ length: p.pts.length / 2 }, (_, k) => [p.pts[2 * k], p.pts[2 * k + 1]]) : [[p.pts[0], p.pts[1]], [p.pts.at(-2), p.pts.at(-1)]] })),
    ...lifts.flatMap((l) => [0, 1].map((f) => ({ item: l, line: station(l, f), ends: [station(l, f)] }))), // each station on its own: you ride between them
  ];
  const touch = (a, b) => a.ends.some(([x, z]) => segNear(b.line, x, z)) || b.ends.some(([x, z]) => segNear(a.line, x, z));
  const reached = new Set(), todo = nodes.filter((n) => n.item.name === S.from && lifts.includes(n.item));
  if (!todo.length) throw new Error(`no lift named ${S.from}`);
  for (const n of todo) reached.add(n);
  while (todo.length) {
    const a = todo.pop();
    const ride = nodes.filter((n) => n.item === a.item && !reached.has(n)); // the other station of a lift
    for (const b of [...ride, ...nodes.filter((n) => !reached.has(n) && touch(a, n))]) { reached.add(b); todo.push(b); }
  }
  const keepItem = (it) => [...reached].some((n) => n.item === it);
  console.log('not reached from', S.from, [...pistes.filter((p) => !keepItem(p)).map((p) => `piste ${p.name || '·'}`), ...lifts.filter((l) => !keepItem(l)).map((l) => `lift ${l.name}`)].join(', '));
  pistes.splice(0, pistes.length, ...pistes.filter(keepItem));
  lifts = lifts.filter(keepItem);
}

// roads (cleared in winter), building footprints as oriented boxes
const inDomain = ([x, z]) => x > X0 && x < X1 && z > Z0 && z < Z1;
const roads = src.roads
  .map((g) => local(g).filter(inDomain))
  .filter((g) => g.length > 1)
  .map((g) => g.flat().map(r1));
const buildings = src.buildings
  .map((b) => {
    const g = local(b.ring);
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
    const levels = b.levels || ((u1 - u0) * (v1 - v0) > 500 ? 3 : 1);
    return { x: um * c + vm * s, z: -um * s + vm * c, w: u1 - u0, d: v1 - v0, yaw, levels, radar: !!b.radar };
  })
  .filter((b) => inDomain([b.x, b.z]) && b.w > 3 && b.d > 3);
const radar = buildings.find((b) => b.radar);
const peaks = src.peaks.map((e) => [e.tags.name, ...toXZ(e.lat, e.lon).map(r1), +e.tags.ele || 0]).filter(([, x, z]) => inDomain([x, z]));

const data = {
  origin: [LAT0, LON0],
  grid: { x0: r1(X0), z0: r1(Z0), step: STEP, nx, nz, base, ...(perM !== 100 ? { unit: 1 / perM } : {}), h: enc16(H, (v) => Math.round((v - base) * perM)), forest: Buffer.from(bits).toString('base64') },
  around: { x0: A.x0, z0: A.z0, step: A.step, nx: A.nx, nz: A.nz, h: enc16(BH, (v) => Math.max(0, Math.round(v * 10))) },
  pistes,
  lifts,
  roads,
  buildings: buildings.filter((b) => !b.radar).map((b) => [b.x, b.z, b.w, b.d, b.yaw, b.levels].map((v, i) => (i === 4 ? Math.round(v * 1000) / 1000 : i === 5 ? v : r1(v)))),
  radar: radar ? [r1(radar.x), r1(radar.z)] : null,
  peaks,
};
writeFileSync(out, `// Generated by scripts/bake-station.mjs ${id} — do not edit. © OpenStreetMap contributors (ODbL)${id === 'rousses' ? '' : ', IGN BD TOPO (Licence Ouverte)'}, terrain: AWS terrain tiles.\n` +
  `export const ${S.name} = ${JSON.stringify(data)};\n`);
console.log({ nx, nz, lo, hi, base, unit: 1 / perM, forestCells: forest.reduce((a, v) => a + v, 0), pistes: pistes.length, lifts: lifts.length, roads: roads.length, buildings: buildings.length, peaks, bytes: readFileSync(out).length });
for (const l of lifts) { const p = l.pts; console.log('lift', l.kind, l.name, Math.round(elev([p[0], p[1]])), '→', Math.round(elev([p.at(-2), p.at(-1)])), Math.round(Math.hypot(p.at(-2) - p[0], p.at(-1) - p[1])) + ' m'); }

// ── control image (top view: hillshade, forest, pistes, lifts), to read by eye before going further
if (controlPng) {
  const W = nx, Hh = nz, img = Buffer.alloc((W * 3 + 1) * Hh);
  const put = (i, j, r, g, b) => { if (i >= 0 && j >= 0 && i < W && j < Hh) { const o = j * (W * 3 + 1) + 1 + i * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; } };
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const dzx = (H[j * W + Math.min(W - 1, i + 1)] - H[j * W + Math.max(0, i - 1)]) / (2 * STEP), dzz = (H[Math.min(Hh - 1, j + 1) * W + i] - H[Math.max(0, j - 1) * W + i]) / (2 * STEP);
      const shade = Math.max(0, Math.min(1, 0.7 + (-dzx + dzz) * 0.6));
      const v = 120 + 120 * shade;
      if (forest[j * W + i]) put(i, j, v * 0.45, v * 0.62, v * 0.45); else put(i, j, v, v, v);
    }
  }
  const COL = { green: [30, 160, 70], blue: [40, 90, 230], red: [220, 40, 40], black: [10, 10, 10] };
  const line = (p, [r, g, b]) => {
    for (let k = 2; k < p.length; k += 2) {
      const l = Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
      for (let t = 0; t <= l; t += STEP / 3) put(Math.round((p[k - 2] + ((p[k] - p[k - 2]) * t) / l - X0) / STEP), Math.round((p[k - 1] + ((p[k + 1] - p[k - 1]) * t) / l - Z0) / STEP), r, g, b);
    }
  };
  for (const r of roads) line(r, [150, 110, 60]);
  for (const p of pistes) if (!p.area) line(p.pts, COL[p.diff]);
  for (const l of lifts) line(l.pts, l.kind === 'gondola' ? [230, 0, 230] : l.kind === 'chair' ? [255, 140, 0] : [255, 220, 0]);
  for (const b of buildings) put(Math.round((b.x - X0) / STEP), Math.round((b.z - Z0) / STEP), 120, 60, 30);
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Hh, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(controlPng, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
}
