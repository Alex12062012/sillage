import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, InstancedMesh, Matrix4,
  MeshLambertMaterial, Quaternion, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TREE_CANOPY, TREE_HEIGHT, type Obstacle, type Track } from '../sim/track';

/** Paint every vertex of `g` with a colour from its height (snow on top of each tier). */
function paint(g: BufferGeometry, fn: (y: number) => Color): BufferGeometry {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getY(i));
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  return g;
}

/** One low-poly fir: trunk + three snow-capped tiers, 4.4 m tall, lower canopy radius 1.0 m. */
export function treeGeometry(): BufferGeometry {
  const bark = new Color(0x5a4636);
  const needle = new Color(0x2e5b52);
  const snow = new Color(0xeef3fa);
  const trunk = paint(new CylinderGeometry(0.12, 0.16, 1, 5).translate(0, 0.5, 0), () => bark);
  const tiers = [[TREE_CANOPY, 1.9, 0.6], [0.78, 1.7, 1.55], [0.55, 1.6, 2.5]].map(([r, h, y]) => {
    const g = new ConeGeometry(r, h, 7).translate(0, y + h / 2, 0);
    return paint(g, (vy) => (vy > y + h * 0.7 ? snow : needle.clone().lerp(snow, Math.max(0, (vy - y) / h - 0.55))));
  });
  const merged = mergeGeometries([trunk, ...tiers].map((g) => g.toNonIndexed()));
  return merged;
}

const m4 = new Matrix4();
const q = new Quaternion();
const s3 = new Vector3();
const p3 = new Vector3();
const up = new Vector3(0, 1, 0);

/** Instanced trees for a set of obstacles (one draw call). */
export function buildTrees(track: Track, list: Obstacle[], material = new MeshLambertMaterial({ vertexColors: true, flatShading: true })): InstancedMesh {
  const trees = list.filter((o) => o.kind === 'tree');
  const mesh = new InstancedMesh(treeGeometry(), material, Math.max(1, trees.length));
  trees.forEach((o, i) => {
    const sc = o.h / TREE_HEIGHT;
    q.setFromAxisAngle(up, (o.id * 2.399) % (Math.PI * 2));
    s3.set(sc, sc * (0.9 + ((o.id * 7) % 5) * 0.05), sc);
    p3.set(o.x, track.height(o.x, o.z) - 0.2, o.z);
    mesh.setMatrixAt(i, m4.compose(p3, q, s3));
  });
  mesh.count = trees.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
