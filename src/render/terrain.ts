import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { Surface, type Track } from '../sim/track';

/** Phase 1 grey box: one grid mesh sampling the analytic height field (replaced by streamed chunks in Phase 3). */
export function buildTerrainMesh(track: Track, step = 2): Mesh {
  const x0 = -110;
  const x1 = 110;
  const z0 = -40;
  const z1 = track.def.length + 80;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const groomed = new Color(0xc9ccd2);
  const powder = new Color(0xa9adb6);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const k = (j * nx + i) * 3;
      pos[k] = x;
      pos[k + 1] = track.height(x, z);
      pos[k + 2] = z;
      const c = track.surface(x, z) === Surface.Groomed ? groomed : powder;
      const stripe = (Math.floor(z / 10) & 1) * 0.04; // distance cue for the grey box
      col[k] = c.r - stripe;
      col[k + 1] = c.g - stripe;
      col[k + 2] = c.b - stripe;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx[p++] = a; idx[p++] = a + nx; idx[p++] = a + 1;
      idx[p++] = a + 1; idx[p++] = a + nx; idx[p++] = a + nx + 1;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
}
