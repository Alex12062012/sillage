import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry,
  Quaternion, Vector3, type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng';
import { TREE_CANOPY, TREE_HEIGHT, type Difficulty, type Obstacle, type Track } from '../sim/track';

/** Paint every vertex of `g` with a colour from its position. */
export function paint(g: BufferGeometry, fn: (x: number, y: number, z: number) => Color): BufferGeometry {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  return g;
}

const BARK = new Color(0x5a4636);
const NEEDLE = new Color(0x2e5b52);
const SNOW = new Color(0xeef3fa);

/** One low-poly fir: trunk + three snow-capped tiers, 4.4 m tall, lower canopy radius 1.0 m. */
export function treeGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.12, 0.16, 1, 5).translate(0, 0.5, 0), () => BARK);
  const tiers = [[TREE_CANOPY, 1.9, 0.6], [0.78, 1.7, 1.55], [0.55, 1.6, 2.5]].map(([r, h, y]) =>
    paint(new ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), (_x, vy) =>
      vy > y + h * 0.7 ? SNOW : NEEDLE.clone().lerp(SNOW, Math.max(0, (vy - y) / h - 0.55))),
  );
  return mergeGeometries([trunk, ...tiers].map((g) => g.toNonIndexed()));
}

/** Far LOD: a single snowy cone (14 triangles). */
export function treeGeometryLow(): BufferGeometry {
  return paint(new ConeGeometry(TREE_CANOPY * 0.95, 3.9, 6).translate(0, 0.5 + 1.95, 0).toNonIndexed(), (_x, y) =>
    y > 3.4 ? SNOW : NEEDLE.clone().lerp(SNOW, Math.max(0, y / 4.4 - 0.5)));
}

/** Slate boulder of radius ~1, flat-shaded, sitting on y = 0, snow dusting on top. */
function rockGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1, 0); // already non-indexed
  const p = g.attributes.position;
  const rnd = mulberry32(77);
  const jitter = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, 0.75 + rnd() * 0.45);
    const k = jitter.get(key)!;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8 + 0.55, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return paint(g, (_x, y) => (y > 1.05 ? SNOW : new Color(0x6f7a8b)));
}

const DIFF_COLOR: Record<Difficulty, number> = { easy: 0x2f6fde, medium: 0xe0393e, hard: 0x1d1f26 };

/** Piste-edge pole with a difficulty-coloured top band. */
export function poleGeometry(): BufferGeometry {
  return paint(new CylinderGeometry(0.045, 0.045, 1.9, 5).translate(0, 0.95, 0).toNonIndexed(), (_x, y) =>
    y > 1.35 ? new Color(1, 1, 1) : new Color(0xf2f2f2));
}

/** Orange flag on a pole (kicker approach markers). */
function flagGeometry(): BufferGeometry {
  const pole = paint(new CylinderGeometry(0.04, 0.04, 2.4, 5).translate(0, 1.2, 0).toNonIndexed(), () => new Color(0xf2f2f2));
  pole.deleteAttribute('uv');
  const flag = new BufferGeometry();
  flag.setAttribute('position', new Float32BufferAttribute([0, 2.35, 0, 0, 1.75, 0, 0.75, 2.05, 0, 0, 2.35, 0, 0.75, 2.05, 0, 0, 1.75, 0], 3));
  flag.computeVertexNormals();
  paint(flag, () => new Color(0xff7a2d));
  return mergeGeometries([pole, flag]);
}

/** Yellow/black striped warning post (cliffs ahead). */
function warnGeometry(): BufferGeometry {
  return paint(new BoxGeometry(0.16, 1.6, 0.16, 1, 8, 1).translate(0, 0.8, 0).toNonIndexed(), (_x, y) =>
    Math.floor(y / 0.2) % 2 ? new Color(0x1e1e22) : new Color(0xffc21f));
}

const shared = {
  tree: [treeGeometry(), treeGeometryLow()],
  rock: rockGeometry(),
  pole: poleGeometry(),
  flag: flagGeometry(),
  warn: warnGeometry(),
};
const propMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const flagMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

const m4 = new Matrix4();
const q = new Quaternion();
const s3 = new Vector3();
const p3 = new Vector3();
const up = new Vector3(0, 1, 0);

function instanced(geo: BufferGeometry, count: number, mat = propMat): InstancedMesh {
  const m = new InstancedMesh(geo, mat, Math.max(1, count));
  m.count = 0;
  return m;
}
function put(m: InstancedMesh, x: number, y: number, z: number, scale: number, yaw: number, sy = scale, color?: Color): void {
  q.setFromAxisAngle(up, yaw);
  s3.set(scale, sy, scale);
  p3.set(x, y, z);
  m.setMatrixAt(m.count, m4.compose(p3, q, s3));
  if (color) m.setColorAt(m.count, color);
  m.count++;
}
function done(m: InstancedMesh): InstancedMesh | null {
  if (m.count === 0) { m.dispose(); return null; }
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

/** Everything that stands on one terrain chunk [z0, z1), at the chunk's LOD. */
export function buildChunkProps(track: Track, z0: number, z1: number, lod: number): Object3D[] {
  const obs: Obstacle[] = track.obstaclesBetween(z0, z1);
  const trees = instanced(shared.tree[lod], obs.length);
  const rocks = instanced(shared.rock, obs.length);
  for (const o of obs) {
    const y = track.height(o.x, o.z);
    if (o.kind === 'tree') {
      const sc = o.h / TREE_HEIGHT;
      put(trees, o.x, y - 0.2, o.z, sc, (o.id * 2.399) % (Math.PI * 2), sc * (0.9 + ((o.id * 7) % 5) * 0.05));
    } else if (o.kind === 'rock') {
      put(rocks, o.x, y - 0.25 * o.r, o.z, o.r, (o.id * 1.7) % (Math.PI * 2), o.h > 4 ? o.h / 1.25 : o.r);
    }
  }
  const out: (InstancedMesh | null)[] = [done(trees), done(rocks)];
  if (lod === 0) {
    const hw = track.def.halfWidth;
    const color = new Color(DIFF_COLOR[track.def.difficulty]);
    const poles = instanced(shared.pole, 16);
    for (let z = Math.ceil(z0 / 16) * 16; z < z1; z += 16) {
      if (z < 0 || z > track.def.length) continue;
      const c = track.centerX(z);
      for (const side of [-1, 1]) put(poles, c + side * (hw + 0.8), track.height(c + side * (hw + 0.8), z), z, 1, 0, 1, color);
    }
    out.push(done(poles));
    const flags = instanced(shared.flag, 8, flagMat);
    for (const k of track.kickers) {
      if (k.z - 14 < z0 || k.z - 14 >= z1) continue;
      for (const zz of [k.z - 14, k.z - 2]) {
        const c = track.centerX(zz) + k.x;
        for (const side of [-1, 1]) {
          const x = c + side * (k.halfWidth + 1.2);
          put(flags, x, track.height(x, zz), zz, 1, side < 0 ? Math.PI : 0);
        }
      }
    }
    out.push(done(flags));
    const warns = instanced(shared.warn, 8);
    for (const f of track.features) {
      if (f.type !== 'cliff') continue;
      for (const zz of [f.z0 - 10, f.z0 + 4]) {
        if (zz < z0 || zz >= z1) continue;
        const c = track.centerX(zz);
        for (const side of [-1, 1]) put(warns, c + side * (hw - 0.8), track.height(c + side * (hw - 0.8), zz), zz, 1, 0);
      }
    }
    out.push(done(warns));
  }
  return out.filter((m): m is InstancedMesh => m !== null);
}

/** Text banner texture (original wording, generated at runtime). */
function banner(text: string, bg: string, fg: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = '800 58px ui-rounded, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Start gate, finish arch and log "portiques" over the piste: built once per track. */
export function buildLandmarks(track: Track): Group {
  const g = new Group();
  const hw = track.def.halfWidth;
  const post = new MeshLambertMaterial({ color: 0x2b3a55, flatShading: true });
  const wood = new MeshLambertMaterial({ color: 0x7a5236, flatShading: true });
  const gate = (z: number, height: number, text: string, bg: string, fg: string, span: number) => {
    const c = track.centerX(z);
    const yL = track.height(c - span, z);
    const yR = track.height(c + span, z);
    const top = Math.max(yL, yR) + height;
    for (const [side, y] of [[-1, yL], [1, yR]] as const) {
      const h = top - y + 0.5;
      const m = new Mesh(new BoxGeometry(0.5, h, 0.5), post);
      m.position.set(c + side * span, y + h / 2 - 0.5, z);
      g.add(m);
    }
    const beam = new Mesh(new PlaneGeometry(span * 2 + 0.5, 1.6), new MeshBasicMaterial({ map: banner(text, bg, fg), side: DoubleSide, fog: true }));
    beam.position.set(c, top - 0.3, z);
    beam.rotation.y = Math.PI; // readable for a skier coming from -z
    g.add(beam);
  };
  gate(0, 5.2, 'SILLAGE · START', '#ff7a3d', '#ffffff', hw * 0.42);
  gate(track.def.length, 7.5, 'FINISH', '#1d2b45', '#ffd166', hw + 2);
  // portiques: rough log beam resting on the two rock pillars placed by the generator
  for (const f of track.features) {
    if (f.type !== 'arch') continue;
    const z = f.z0 + 12;
    const c = track.centerX(z);
    const y = Math.max(track.height(c - hw + 1.5, z), track.height(c + hw - 1.5, z)) + 8;
    const log = new Mesh(new CylinderGeometry(0.55, 0.55, (hw - 1.5) * 2 + 2, 7), wood);
    log.rotation.z = Math.PI / 2;
    log.position.set(c, y, z);
    g.add(log);
  }
  return g;
}
