import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, NormalBlending, Points,
  ShaderMaterial, Vector3, type PerspectiveCamera,
} from 'three';
import type { Ground } from '../sim/track';

const pointVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 80.0);
    vAlpha = aAlpha * smoothstep(0.6, 2.2, -mv.z); // no giant blobs on the lens
  }`;
const pointFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    gl_FragColor = vec4(uColor, vAlpha * smoothstep(0.25, 0.04, d));
  }`;

/** Pixels per world-metre at distance 1 for point sizing. */
export const pointScale = (cam: PerspectiveCamera, viewportH: number) => viewportH / (2 * Math.tan((cam.fov * Math.PI) / 360));

/** Pooled snow spray: edges in a carve, a wall when braking, clouds in powder, bursts on landings. */
export class SnowSpray {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private next = 0;
  alive = 0;

  constructor(private count = 900) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 500 }, uColor: { value: new Color(0xffffff) } }, blending: NormalBlending,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  burst(at: Vector3, n: number, speed: number, size: number): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(at.x, at.y + 0.1, at.z, Math.cos(a) * s, 1 + Math.random() * speed * 0.6, Math.sin(a) * s, size * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.5);
    }
  }

  update(dt: number): void {
    let alive = 0;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - 7 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.max(0, t) * 0.62;
      this.size[i] *= 1 + dt * 0.9; // puffs grow as they dissipate
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

/** Falling snow wrapped in a box around the camera: zero CPU per frame, strong speed cue. */
export class Flakes {
  readonly points: Points;
  readonly material: ShaderMaterial;

  constructor(count: number) {
    const box = new Vector3(44, 26, 52);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box.x; pos[i * 3 + 1] = Math.random() * box.y; pos[i * 3 + 2] = Math.random() * box.z;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    this.material = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uCam: { value: new Vector3() }, uTime: { value: 0 }, uBox: { value: box }, uScale: { value: 500 }, uSize: { value: 0.07 } },
      vertexShader: /* glsl */ `
        uniform vec3 uCam; uniform float uTime; uniform vec3 uBox; uniform float uScale; uniform float uSize;
        varying float vFade;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.7 + position.y) * 0.5, -uTime * 1.3, cos(uTime * 0.5 + position.x) * 0.5);
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * uScale / max(0.1, -mv.z), 1.0, 4.5);
          vFade = smoothstep(uBox.z * 0.5, uBox.z * 0.15, length(p - uCam)) * smoothstep(0.6, 2.5, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying float vFade;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          if (dot(c, c) > 0.25) discard;
          gl_FragColor = vec4(vec3(0.85), vFade * 0.75);
        }`,
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  update(cam: PerspectiveCamera, time: number, scale: number): void {
    this.material.uniforms.uCam.value.copy(cam.position);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uScale.value = scale;
  }
}

/** The "sillage": two ribbons carved in the snow behind the skis, cut while airborne. */
export class SkiTrails {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private last = new Vector3(Infinity, 0, 0);
  private wasAir = true;

  constructor(private samples = 360, private spacing = 0.4) {
    const verts = samples * 4; // 2 skis × 2 edges
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    const idx: number[] = [];
    for (let ski = 0; ski < 2; ski++) {
      const o = ski * samples * 2;
      for (let i = 0; i < samples - 1; i++) {
        const a = o + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 4));
    const nor = new Float32Array(verts * 3);
    for (let i = 0; i < verts; i++) nor[i * 3 + 1] = 1; // lit like the snow it is carved in
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, new MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  reset(): void {
    this.col.fill(0);
    this.last.set(Infinity, 0, 0);
    this.wasAir = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  /** Call every frame with the skier's ground position; samples every `spacing` metres. */
  update(pos: Vector3, heading: number, airborne: boolean, intensity: number, powder: boolean, width: number, g: Ground): void {
    if (airborne) {
      if (!this.wasAir) {
        // fade the newest sample out so no ribbon bridges the gap (jump chord, crash → respawn)
        const n = this.samples;
        for (let ski = 0; ski < 2; ski++) for (let e = 0; e < 2; e++) this.col[(ski * n * 2 + (n - 1) * 2 + e) * 4 + 3] = 0;
        this.mesh.geometry.attributes.color.needsUpdate = true;
      }
      this.wasAir = true;
      return;
    }
    if (this.last.distanceToSquared(pos) < this.spacing * this.spacing) return;
    const brk = this.wasAir; // first sample after air or reset: invisible joint
    this.wasAir = false;
    this.last.copy(pos);
    const n = this.samples;
    // shift every ski strip one sample toward the start (oldest drops off)
    for (let ski = 0; ski < 2; ski++) {
      const o = ski * n * 2;
      this.pos.copyWithin(o * 3, (o + 2) * 3, (o + n * 2) * 3);
      this.col.copyWithin(o * 4, (o + 2) * 4, (o + n * 2) * 4);
    }
    const cx = Math.cos(heading); // ski lateral axis (local +x) in world
    const cz = -Math.sin(heading);
    const w = powder ? width * 1.8 : width;
    const a = brk ? 0 : intensity;
    const c = powder ? [0.66, 0.74, 0.87] : [0.74, 0.81, 0.9];
    for (let ski = 0; ski < 2; ski++) {
      const off = ski === 0 ? 0.12 : -0.12;
      const base = ski * n * 2 + (n - 1) * 2;
      for (let e = 0; e < 2; e++) {
        const lat = off + (e === 0 ? -w / 2 : w / 2);
        const x = pos.x + cx * lat;
        const z = pos.z + cz * lat;
        const v = base + e;
        this.pos[v * 3] = x; this.pos[v * 3 + 1] = g.height(x, z) + 0.025; this.pos[v * 3 + 2] = z;
        this.col[v * 4] = c[0]; this.col[v * 4 + 1] = c[1]; this.col[v * 4 + 2] = c[2]; this.col[v * 4 + 3] = a;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
