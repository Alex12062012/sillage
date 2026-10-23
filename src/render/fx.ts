import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial, NormalBlending, Points,
  ShaderMaterial, Vector2, Vector3, Vector4, type BufferAttribute as Attr, type Object3D, type PerspectiveCamera,
} from 'three';
import type { LandQuality, SkierState } from '../sim/skier';
import { Surface, type Ground, type Obstacle } from '../sim/track';
import { TUNING as T } from '../tuning';

type Quality = 'low' | 'medium' | 'high';

/** Scene lighting the particles follow (shared Color/Vector3 objects are fine: read only). Colours are linear. */
export interface SceneLight { sun: Color; sunIntensity: number; sky: Color; ground: Color; sunDir: Vector3; hemiIntensity?: number }

/** Pixels per world-metre at distance 1 for point sizing. */
export const pointScale = (cam: PerspectiveCamera, viewportH: number) => viewportH / (2 * Math.tan((cam.fov * Math.PI) / 360));

// Snow particles are lit like the snow: hemisphere + sun on a sphere impostor (brighter on the sun side),
// mist is wrap-lit and glows when backlit by a low sun; grains can carry a sun glint (crystals).
const snowVert = /* glsl */ `
  attribute vec3 aData; // world size, alpha, glint
  uniform float uScale;
  uniform float uTime;
  uniform vec3 uSunV;
  uniform vec4 uBody; // skier torso: NDC x, y, view depth, NDC radius
  uniform vec2 uBodyK; // aspect, alpha kept in front of the body
  varying float vAlpha;
  varying float vGlint;
  varying float vScatter;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // never hide the skier: what flies between him and the lens thins out over his silhouette
    vec2 b = (gl_Position.xy / gl_Position.w - uBody.xy) * vec2(uBodyK.x, 0.6);
    float body = -mv.z < uBody.z - 0.3 ? mix(uBodyK.y, 1.0, smoothstep(uBody.w * 0.5, uBody.w, length(b))) : 1.0;
    float px = aData.x * uScale / max(0.1, -mv.z);
  #ifdef SOFT
    gl_PointSize = clamp(px, 1.5, 90.0);
  #else
    gl_PointSize = clamp(px, 1.5, 5.5); // grains stay crisp even right under the lens
  #endif
    // sub-pixel grains fade instead of aliasing; nothing smears the lens
    vAlpha = aData.y * min(1.0, px / 1.5) * smoothstep(1.2, 3.2, -mv.z) * body;
    vGlint = aData.z * pow(0.5 + 0.5 * sin(uTime * 31.0 + float(gl_VertexID) * 2.39), 3.0);
    vScatter = pow(max(dot(normalize(mv.xyz), uSunV), 0.0), 3.0); // ice dust glows when backlit
  }`;
const snowFrag = /* glsl */ `
  uniform vec3 uSunC;
  uniform vec3 uSkyC;
  uniform vec3 uGroundC;
  uniform vec3 uSunV;
  uniform vec3 uUpV;
  varying float vAlpha;
  varying float vGlint;
  varying float vScatter;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    c.y = -c.y;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    vec3 n = vec3(c, sqrt(1.0 - r2));
    // snow is translucent: mostly sky light, a little ground bounce underneath, wrapped sun
    vec3 hemi = mix(uGroundC, uSkyC, 0.7 + 0.3 * dot(n, uUpV));
  #ifdef SOFT
    // a puff self-shades (bluish underside, sunlit cap) so a white cloud still reads over white snow
    float a = exp(-r2 * 3.2) - 0.04;
    hemi = mix(uGroundC, uSkyC, 0.8 + 0.2 * dot(n, uUpV));
    vec3 col = hemi * 1.15 + uSunC * (dot(n, uSunV) * 0.25 + 0.75 + vScatter * 1.6);
  #else
    float a = smoothstep(1.0, 0.55, r2);
    vec3 col = hemi * 1.1 + uSunC * (dot(n, uSunV) * 0.2 + 0.85 + vScatter * 1.2) + uSunC * vGlint * 5.0;
    a = max(a, vGlint * 0.9 * a);
  #endif
    gl_FragColor = vec4(col, vAlpha * a);
    #include <colorspace_fragment>
  }`;

const scratch = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Packed particle pool: live particles occupy [0, n) (swap-remove on death), so the update loop and the
 * draw range only touch live ones. Each particle remembers the ground plane it was born over and settles,
 * slides and fades on it instead of falling through the snow.
 */
class Pool {
  readonly points: Points;
  readonly material: ShaderMaterial;
  n = 0;
  cap: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array;
  private plane: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private alpha0: Float32Array;
  private cursor = 0;
  private gn = new Vector3(0, 1, 0);
  private gd = 0;

  constructor(readonly max: number, soft: boolean, private gravity: number, private drag: number, private grow: number) {
    this.cap = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.data = new Float32Array(max * 3);
    this.plane = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aData', new BufferAttribute(this.data, 3));
    geo.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      vertexShader: snowVert, fragmentShader: snowFrag, transparent: true, depthWrite: false, blending: NormalBlending,
      defines: soft ? { SOFT: 1 } : {},
      uniforms: {
        uScale: { value: 500 }, uTime: { value: 0 }, uSunC: { value: new Color() }, uSkyC: { value: new Color() },
        uGroundC: { value: new Color() }, uSunV: { value: new Vector3(0, 1, 0) }, uUpV: { value: new Vector3(0, 1, 0) },
        uBody: { value: new Vector4() }, uBodyK: { value: new Vector2(1, 1) },
      },
    });
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  /** Ground plane (point + unit normal) for the particles emitted next. */
  ground(p: Vector3, n: Vector3): void {
    this.gn.copy(n);
    this.gd = n.dot(p);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, alpha: number, glint = 0): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else i = this.cursor = (this.cursor + 1) % this.cap; // full: recycle a live one
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.data[k] = size; this.data[k + 1] = 0; this.data[k + 2] = glint;
    const q = i * 4;
    this.plane[q] = this.gn.x; this.plane[q + 1] = this.gn.y; this.plane[q + 2] = this.gn.z; this.plane[q + 3] = this.gd;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha0[i] = alpha;
  }

  update(dt: number, wx: number, wz: number): void {
    const { pos, vel, data, plane } = this;
    const drag = Math.exp(-this.drag * dt);
    const slide = Math.exp(-7 * dt);
    const grow = 1 + this.grow * dt;
    const g = this.gravity * dt;
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const k = i * 3;
      const q = i * 4;
      // drag toward the (light) wind, then gravity
      let vx = wx + (vel[k] - wx) * drag;
      let vy = vel[k + 1] * drag - g;
      let vz = wz + (vel[k + 2] - wz) * drag;
      let x = pos[k] + vx * dt;
      let y = pos[k + 1] + vy * dt;
      let z = pos[k + 2] + vz * dt;
      const nx = plane[q], ny = plane[q + 1], nz = plane[q + 2];
      const h = nx * x + ny * y + nz * z - plane[q + 3];
      if (h < 0.02) {
        // on the snow: no sinking, slide to a stop, melt into the surface twice as fast
        x += nx * (0.02 - h); y += ny * (0.02 - h); z += nz * (0.02 - h);
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) { vx -= vn * nx; vy -= vn * ny; vz -= vn * nz; }
        vx *= slide; vy *= slide; vz *= slide;
        this.life[i] -= dt * 2;
      }
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      vel[k] = vx; vel[k + 1] = vy; vel[k + 2] = vz;
      const t = this.life[i] / this.maxLife[i];
      data[k] *= grow;
      data[k + 1] = this.alpha0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 25); // snap in, long fade out
      if (data[k + 2] > 0) data[k + 2] *= 1 - dt * 1.2;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    for (const name of ['position', 'aData']) {
      const a = geo.attributes[name] as Attr;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * 3);
      a.needsUpdate = true;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.data.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.plane.copyWithin(i * 4, j * 4, j * 4 + 4);
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.alpha0[i] = this.alpha0[j];
  }

  setLight(light: SceneLight, sunV: Vector3, upV: Vector3, scale: number, time: number, body: Vector4, aspect: number, keep: number): void {
    const u = this.material.uniforms;
    u.uBody.value.copy(body);
    u.uBodyK.value.set(aspect, keep);
    const hemiI = (light.hemiIntensity ?? 1.2) / Math.PI;
    u.uSunC.value.copy(light.sun).multiplyScalar(light.sunIntensity / Math.PI);
    u.uSkyC.value.copy(light.sky).multiplyScalar(hemiI);
    u.uGroundC.value.copy(light.ground).multiplyScalar(hemiI);
    u.uSunV.value.copy(sunV);
    u.uUpV.value.copy(upV);
    u.uScale.value = scale;
    u.uTime.value = time;
  }
}

/**
 * Speed lines: world-anchored streaks wrapped in a box ahead of the camera and stretched along the
 * skier's velocity (so they rush past exactly at his speed). Zero CPU; the screen centre stays clear.
 */
class SpeedLines {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor(count: number) {
    const box = new Vector3(22, 12, 46);
    const pos = new Float32Array(count * 4 * 3);
    const corner = new Float32Array(count * 4 * 2);
    const idx: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = Math.random() * box.x, y = Math.random() * box.y, z = Math.random() * box.z;
      for (let c = 0; c < 4; c++) {
        pos.set([x, y, z], (i * 4 + c) * 3);
        corner.set([c >> 1, (c & 1) * 2 - 1], (i * 4 + c) * 2);
      }
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new BufferAttribute(corner, 2));
    geo.setIndex(idx);
    this.material = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: {
        uCenter: { value: new Vector3() }, uBox: { value: box }, uVel: { value: new Vector3() },
        uRes: { value: new Vector3(1280, 720, 0) }, uAlpha: { value: 0 }, uColor: { value: new Color() },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aCorner; // x: 0 head / 1 tail, y: side
        uniform vec3 uCenter; uniform vec3 uBox; uniform vec3 uVel; uniform vec3 uRes; uniform float uAlpha;
        varying float vA;
        void main() {
          vec3 rel = mod(position - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 head = rel + uCenter;
          vec4 h = projectionMatrix * viewMatrix * vec4(head, 1.0);
          vec4 t = projectionMatrix * viewMatrix * vec4(head - uVel * 0.07, 1.0);
          if (h.w < 0.5 || t.w < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          vec2 hn = h.xy / h.w, tn = t.xy / t.w;
          vec2 d = (hn - tn) * uRes.xy;
          d = length(d) > 1e-3 ? normalize(d) : vec2(1.0, 0.0);
          vec4 p = mix(h, t, aCorner.x);
          p.xy += vec2(-d.y, d.x) * aCorner.y * (1.6 / uRes.xy) * p.w;
          gl_Position = p;
          // periphery only, soft at the box borders (wrap pops), never on the lens
          vec2 m = mix(hn, tn, 0.5) * vec2(uRes.x / uRes.y, 1.0);
          vec3 b = abs(rel) / (uBox * 0.5);
          float edge = (1.0 - smoothstep(0.6, 1.0, b.x)) * (1.0 - smoothstep(0.6, 1.0, b.y)) * (1.0 - smoothstep(0.5, 1.0, b.z));
          vA = uAlpha * (1.0 - aCorner.x) * smoothstep(0.55, 1.1, length(m)) * edge * smoothstep(1.5, 4.0, h.w);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          gl_FragColor = vec4(uColor * vA, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  update(cam: PerspectiveCamera, vel: Vector3, alpha: number, viewportH: number, light: SceneLight): void {
    this.mesh.visible = alpha > 0.002;
    if (!this.mesh.visible) return;
    const u = this.material.uniforms;
    cam.getWorldDirection(scratch);
    u.uCenter.value.copy(cam.position).addScaledVector(scratch, 18);
    u.uVel.value.copy(vel);
    u.uRes.value.set(viewportH * cam.aspect, viewportH, 0);
    u.uAlpha.value = alpha;
    u.uColor.value.copy(light.sky).lerp(light.sun, 0.3);
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

/** Cross-section of one ski's trench, in units of its half-width: soft outer edge, lip crest, groove floor. */
const PROFILE = [-1.7, -1, -0.35, 0.35, 1, 1.7];
const ACROSS = PROFILE.length;
const SLOT = 2 * ACROSS; // vertices per sample (2 skis)
const QUADS = 2 * (ACROSS - 1); // quads between two samples

/**
 * The "sillage": both skis' trenches sculpted in the snow — a narrow groove with a bright lip when
 * carving, a wide smear when skidding, a soft furrow in powder — cut while airborne. Ring buffer of
 * samples; a doubled index buffer lets one draw range skip the seam, so only the newest sample uploads.
 */
export class SkiTrails {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private nor: Float32Array;
  private col: Float32Array;
  private head: number;
  private last = new Vector3(Infinity, 0, 0);
  private dir = new Vector3();
  private n = new Vector3();
  private wasAir = true;

  constructor(private samples = 360, private spacing = 0.4) {
    const verts = samples * SLOT;
    this.pos = new Float32Array(verts * 3);
    this.nor = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    const idx = new Uint16Array((2 * samples - 1) * QUADS * 6);
    let w = 0;
    for (let q = 0; q < 2 * samples - 1; q++) {
      const a = (q % samples) * SLOT;
      const b = ((q + 1) % samples) * SLOT;
      for (let ski = 0; ski < 2; ski++) {
        for (let e = 0; e < ACROSS - 1; e++) {
          const v = ski * ACROSS + e;
          idx.set([a + v, b + v, a + v + 1, a + v + 1, b + v, b + v + 1], w);
          w += 6;
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 4));
    geo.setIndex(new BufferAttribute(idx, 1));
    this.head = samples - 1;
    this.mesh = new Mesh(geo, new MeshLambertMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.window();
  }

  reset(): void {
    this.col.fill(0);
    this.last.set(Infinity, 0, 0);
    this.wasAir = true;
    const a = this.mesh.geometry.attributes.color as Attr;
    a.clearUpdateRanges();
    a.needsUpdate = true;
  }

  /** Draw every quad except the one joining the newest sample to the oldest. */
  private window(): void {
    this.mesh.geometry.setDrawRange(((this.head + 1) % this.samples) * QUADS * 6, (this.samples - 1) * QUADS * 6);
  }

  private upload(name: 'position' | 'normal' | 'color', size: number): void {
    const a = this.mesh.geometry.attributes[name] as Attr;
    a.addUpdateRange(this.head * SLOT * size, SLOT * size);
    a.needsUpdate = true;
  }

  /**
   * Call every frame with the skier's ground position; samples every `spacing` metres.
   * skid 0..1 widens and smears the mark, edge 0..1 (|edge load|) deepens the carved groove.
   */
  update(pos: Vector3, heading: number, airborne: boolean, intensity: number, powder: boolean, width: number, g: Ground, skid = 0, edge = 0): void {
    if (airborne) {
      if (!this.wasAir) {
        // fade the newest sample out so no ribbon bridges the gap (jump chord, crash → respawn)
        for (let v = 0; v < SLOT; v++) this.col[(this.head * SLOT + v) * 4 + 3] = 0;
        this.upload('color', 4);
      }
      this.wasAir = true;
      return;
    }
    const d2 = this.last.distanceToSquared(pos);
    if (d2 < this.spacing * this.spacing) return;
    const brk = this.wasAir; // first sample after air or reset: invisible joint
    this.wasAir = false;
    // cross-section perpendicular to the actual path (a skid's skis point elsewhere)
    if (brk || d2 > 9) this.dir.set(Math.sin(heading), 0, Math.cos(heading));
    else this.dir.subVectors(pos, this.last).setY(0).normalize();
    this.last.copy(pos);
    this.head = (this.head + 1) % this.samples;
    this.window();

    const lx = this.dir.z; // path lateral (skier's left) in world
    const lz = -this.dir.x;
    const n = g.normal(pos.x, pos.z, this.n);
    const y0 = g.height(pos.x, pos.z) + 0.03;
    const e = Math.min(1, Math.abs(edge));
    const sk = Math.min(1, skid);
    // trench shape: half-width, groove shading (normal tilt), groove darkness, lip brightness
    const hw = powder ? width * 2.2 + sk * width * 2 : width * 0.5 * (1 + sk * 4.5);
    const tilt = powder ? 0.9 : (0.35 + 0.65 * e) * (1 - sk * 0.8) * T.trailGroove;
    const dark = powder ? 0.36 : (0.18 + 0.22 * e) * (1 - sk * 0.65) * T.trailGroove;
    const lip = powder ? 0.6 : 0.35 + 0.4 * e * (1 - sk);
    const a = brk ? 0 : intensity;
    for (let ski = 0; ski < 2; ski++) {
      const off = (ski === 0 ? 0.12 : -0.12) * (powder ? 1.3 : 1);
      for (let p = 0; p < ACROSS; p++) {
        const u = PROFILE[p];
        const lat = off + u * hw;
        const x = pos.x + lx * lat;
        const z = pos.z + lz * lat;
        const v = this.head * SLOT + ski * ACROSS + p;
        this.pos[v * 3] = x;
        this.pos[v * 3 + 1] = y0 - (n.x * lx * lat + n.z * lz * lat) / n.y; // on the local slope plane
        this.pos[v * 3 + 2] = z;
        // walls lean toward the groove centre (left wall faces +lat), outer slopes away: a lit U-trench
        const inner = Math.abs(u) < 0.5;
        const t = inner ? Math.sign(u) * -tilt : Math.abs(u) > 1.5 ? Math.sign(u) * tilt * 0.4 : 0;
        const nx = n.x + lx * t, ny = n.y, nz = n.z + lz * t;
        const nl = Math.hypot(nx, ny, nz);
        this.nor[v * 3] = nx / nl; this.nor[v * 3 + 1] = ny / nl; this.nor[v * 3 + 2] = nz / nl;
        const k = v * 4;
        if (inner) {
          // shadowed groove: blue-grey, a skid's smear is smoother and paler
          this.col[k] = 0.84 - dark * 1.1; this.col[k + 1] = 0.89 - dark * 0.9; this.col[k + 2] = 0.97 - dark * 0.45; this.col[k + 3] = a;
        } else if (Math.abs(u) < 1.5) {
          this.col[k] = 1; this.col[k + 1] = 1; this.col[k + 2] = 1; this.col[k + 3] = a * lip; // bright lip crest
        } else {
          this.col[k] = 0.9; this.col[k + 1] = 0.93; this.col[k + 2] = 0.98; this.col[k + 3] = 0;
        }
      }
    }
    this.upload('position', 3);
    this.upload('normal', 3);
    this.upload('color', 4);
  }
}

const QUALITY_K: Record<Quality, number> = { low: 0.45, medium: 0.75, high: 1 };
const rnd = Math.random;
/** Mostly fine dust, a few chunks. */
const grainSize = () => T.fxGrain * (0.4 + 1.6 * rnd() ** 3);

/**
 * Every snow reaction: rooster tails off the carving edges, the hockey-stop curtain, powder billows,
 * landing rings, crash clouds, snow shaken off shaved trees, hand-drag and pole-plant spurts, speed
 * lines. Two pooled point systems (crisp grains, soft mist) + one speed-line mesh; zero per-frame
 * allocation. Every number lives in TUNING (snow fx section).
 */
export class SnowFx {
  readonly objects: Object3D[];
  private grains = new Pool(1100, false, 9.5, 1.6, 0.15);
  private mist = new Pool(400, true, 0.35, 2.4, 0.9);
  private lines = new SpeedLines(90);
  private q = 1;
  private comfort = false;
  private time = 0;
  private grainAcc = 0;
  private mistAcc = 0;
  private brakeAcc = 0;
  private handAcc = 0;
  private lastPos = new Vector3();
  private lastN = new Vector3(0, 1, 0);
  private sunV = new Vector3();
  private upV = new Vector3();
  private t1 = new Vector3();
  private t2 = new Vector3();
  private brakeT = 0;
  private body = new Vector4();

  constructor() {
    this.objects = [this.mist.points, this.grains.points, this.lines.mesh];
  }

  get alive(): number {
    return this.grains.n + this.mist.n;
  }

  setQuality(q: Quality): void {
    this.q = QUALITY_K[q];
    this.grains.cap = Math.round(this.grains.max * this.q);
    this.mist.cap = Math.round(this.mist.max * this.q);
    this.grains.n = Math.min(this.grains.n, this.grains.cap);
    this.mist.n = Math.min(this.mist.n, this.mist.cap);
  }

  setComfort(on: boolean): void {
    this.comfort = on;
  }

  private ground(p: Vector3, n: Vector3): void {
    this.grains.ground(p, n);
    this.mist.ground(p, n);
  }

  /** Continuous emission (edges, brake, powder) + simulation + light uniforms. Call once per rendered frame. */
  update(s: SkierState, renderPos: Vector3, heading: number, gdt: number, camera: PerspectiveCamera, viewportH: number, light: SceneLight): void {
    this.time += gdt;
    this.lastPos.copy(renderPos);
    if (!s.airborne) this.lastN.copy(s.normal);
    const speed = s.vel.length();
    this.brakeT = s.braking && !s.airborne ? Math.min(1, this.brakeT + gdt * 5) : Math.max(0, this.brakeT - gdt * 4);
    if (!s.airborne && s.crashTimer <= 0 && speed > 2 && gdt > 0) this.emitEdges(s, renderPos, heading, speed, gdt);

    // a light breeze carries the mist (and nudges the grains)
    this.grains.update(gdt, 0.4, -0.3);
    this.mist.update(gdt, 0.8, -0.5);

    camera.updateMatrixWorld();
    this.sunV.copy(light.sunDir).transformDirection(camera.matrixWorldInverse);
    this.upV.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    const scale = pointScale(camera, viewportH);
    // the skier's torso on screen (a yard sale may engulf him)
    scratch.set(renderPos.x, renderPos.y + 0.9, renderPos.z).applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(0.5, -scratch.z);
    scratch.applyMatrix4(camera.projectionMatrix);
    this.body.set(scratch.x, scratch.y, depth, 0.8 / (depth * Math.tan((camera.fov * Math.PI) / 360)));
    const crashed = s.crashTimer > 0;
    this.grains.setLight(light, this.sunV, this.upV, scale, this.time, this.body, camera.aspect, crashed ? 1 : 0.35);
    this.mist.setLight(light, this.sunV, this.upV, scale, this.time, this.body, camera.aspect, crashed ? 1 : 0.12);

    const kmh = speed * 3.6;
    const ramp = Math.min(1, Math.max(0, (kmh - T.fxLinesFrom) / (T.fxLinesFull - T.fxLinesFrom)));
    const lines = this.comfort || s.crashTimer > 0 ? 0 : ramp * ramp * T.fxLines * (s.tuck ? 1 : 0.55);
    this.lines.update(camera, s.vel, lines, viewportH, light);
  }

  private emitEdges(s: SkierState, p: Vector3, heading: number, speed: number, dt: number): void {
    const powder = s.surface === Surface.Powder;
    const ice = s.surface === Surface.Ice;
    const fx = Math.sin(heading), fz = Math.cos(heading); // ski forward
    const lx = Math.cos(heading), lz = -Math.sin(heading); // ski lateral (skier's left)
    const e = Math.min(1, Math.abs(s.edge));
    const sk = Math.min(1, s.skid);
    const out = s.edge >= 0 ? -1 : 1; // snow leaves the outside of the turn
    const spd = smooth(speed, 3, 22);
    const load = Math.pow(e, 1.4) * 1.1 + sk * 0.8 + (powder ? 0.35 : 0.03);
    const n = s.normal;
    this.ground(p, n);
    const brake = this.brakeT * smooth(speed, 1.5, 16);

    // rooster tail: grains off the outside edges of both skis, tail-heavy, kick ∝ edge load × speed
    this.grainAcc += T.sprayRate * this.q * spd * load * (ice ? 0.5 : 1) * (1 - brake) * dt;
    while (this.grainAcc >= 1) {
      this.grainAcc -= 1;
      const r = rnd();
      const a = r * r; // 0 tail … 1 tip
      const along = -0.8 + 1.65 * a;
      const kick = (1.25 - 0.75 * a) * (0.6 + 0.6 * rnd());
      const side = (rnd() < 0.5 ? 0.12 : -0.12) + out * 0.05;
      const o = out * (0.8 + (1.2 + 4.6 * e + 2.5 * sk) * kick) * (0.5 + 0.5 * spd);
      const up = (0.8 + (1.5 + 3.2 * e) * kick * (0.3 + 0.7 * rnd())) * (powder ? 1.5 : 1); // the tail throws highest
      this.grains.emit(
        p.x + fx * along + lx * side, p.y + 0.04, p.z + fz * along + lz * side,
        s.vel.x * 0.8 + lx * o + n.x * up + (rnd() - 0.5) * 0.6, s.vel.y * 0.8 + n.y * up, s.vel.z * 0.8 + lz * o + n.z * up + (rnd() - 0.5) * 0.6,
        grainSize() * (0.75 + 0.5 * e * spd), T.sprayLife * (0.45 + 0.55 * rnd()), 0.95, ice ? 0.6 * rnd() : rnd() < 0.08 ? 0.5 : 0,
      );
    }

    // mist: a fine veil off the tails that lingers; billows in powder; the hockey-stop curtain
    const mistRate = T.fxMistRate * this.q * spd * (powder ? T.sprayPowder * (0.6 + e + sk) : load * (ice ? 0.4 : 1));
    this.mistAcc += (mistRate * (1 - brake) + T.fxMistRate * T.fxBrake * 1.6 * this.q * brake) * dt;
    while (this.mistAcc >= 1) {
      this.mistAcc -= 1;
      const along = -0.75 + rnd() * (powder ? 1.6 : 0.6);
      const side = (rnd() < 0.5 ? 0.12 : -0.12) + out * 0.1;
      if (brake > 0.3 && rnd() < brake) { this.curtainPuff(s, p, speed, out); continue; }
      const sz = powder ? T.fxMist * T.sprayPowder * (0.7 + 0.8 * rnd()) : T.fxMist * (0.5 + 0.7 * rnd()) * (0.6 + 0.6 * e);
      const o = out * (0.4 + 1.6 * e) * rnd();
      const up = powder ? 0.9 + 2.2 * rnd() : 0.3 + 0.8 * rnd();
      this.mist.emit(
        p.x + fx * along + lx * side, p.y + 0.12, p.z + fz * along + lz * side,
        s.vel.x * (powder ? 0.25 : 0.4) + lx * o + n.x * up, s.vel.y * 0.3 + n.y * up, s.vel.z * (powder ? 0.25 : 0.4) + lz * o + n.z * up,
        sz, T.fxMistLife * (powder ? 1.8 : 1) * (0.6 + 0.6 * rnd()), powder ? 0.34 : 0.14 + 0.16 * e + 0.1 * sk,
      );
    }

    // hockey stop: a thick curtain thrown ahead and outward off the leading edges, ramping with speed
    if (brake > 0) {
      this.brakeAcc += T.sprayRate * T.fxBrake * this.q * brake * dt;
      const vx = s.vel.x / speed, vz = s.vel.z / speed;
      while (this.brakeAcc >= 1) {
        this.brakeAcc -= 1;
        const u = (rnd() - 0.5) * 1.6; // along the skis, now across the line
        const fw = speed * (0.7 + 0.5 * rnd());
        const fan = (out * (2 + 5 * rnd()) + u * 2) * Math.min(1.2, speed / 14); // sprays wide, toward the tails, off the body
        const up = (1.6 + 3.8 * rnd()) * (0.4 + 0.6 * brake) * Math.min(1.3, 0.5 + speed / 18);
        this.grains.emit(
          p.x + vx * 0.3 + vz * u, p.y + 0.05, p.z + vz * 0.3 - vx * u,
          vx * fw + vz * fan + n.x * up, n.y * up, vz * fw - vx * fan + n.z * up,
          grainSize() * 1.3, T.sprayLife * (0.8 + 0.8 * rnd()), 0.95, rnd() < 0.06 ? 0.6 : 0,
        );
      }
    }
  }

  private curtainPuff(s: SkierState, p: Vector3, speed: number, out: number): void {
    const vx = s.vel.x / speed, vz = s.vel.z / speed;
    const u = (rnd() - 0.5) * 1.6;
    const fw = speed * (0.55 + 0.45 * rnd());
    const fan = (out * (1 + 3.5 * rnd()) + u * 1.5) * Math.min(1.2, speed / 14);
    const up = 1 + 2.2 * rnd();
    this.mist.emit(
      p.x + vx * 0.4 + vz * u, p.y + 0.25, p.z + vz * 0.4 - vx * u,
      vx * fw + vz * fan, up, vz * fw - vx * fan,
      T.fxMist * (1 + rnd()) * Math.min(1.4, 0.4 + speed / 14), T.fxMistLife * (0.9 + 0.8 * rnd()), 0.38,
    );
  }

  /** Lift-off: snow kicked off the lip (a pop stamps the skis into it: stronger). */
  takeoff(s: SkierState, pos: Vector3, jumped: boolean): void {
    this.ground(pos, s.normal);
    const k = (jumped ? 1.8 : 1) * this.q * T.fxBurst;
    const n = Math.round((jumped ? 40 : 22) * k);
    for (let i = 0; i < n; i++) {
      const up = 1 + 2.5 * rnd();
      this.grains.emit(
        pos.x + (rnd() - 0.5) * 0.4, pos.y + 0.05, pos.z + (rnd() - 0.5) * 0.4,
        s.vel.x * (0.25 + 0.4 * rnd()) + (rnd() - 0.5) * 3, up, s.vel.z * (0.25 + 0.4 * rnd()) + (rnd() - 0.5) * 3,
        T.fxGrain * (0.6 + rnd()), 0.5 + 0.5 * rnd(), 0.95,
      );
    }
    for (let i = 0; i < (jumped ? 8 : 4); i++) {
      this.mist.emit(pos.x, pos.y + 0.15, pos.z, s.vel.x * 0.3 + (rnd() - 0.5) * 2, 0.5 + rnd(), s.vel.z * 0.3 + (rnd() - 0.5) * 2, T.fxMist * (1 + rnd()), T.fxMistLife * 1.1, 0.38);
    }
  }

  /** Touchdown: a ground-hugging ring + a central puff ∝ impact speed; a perfect landing glitters. */
  land(s: SkierState, pos: Vector3, vn: number, quality: LandQuality): void {
    const n = s.normal;
    this.ground(pos, n);
    this.basis(n);
    const k = this.q * T.fxBurst;
    const impact = Math.min(1.6, 0.35 + vn / 9);
    const powder = s.surface === Surface.Powder;
    const ring = Math.round((24 + vn * 7) * k);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + rnd() * 0.3;
      const c = Math.cos(a), sn = Math.sin(a);
      const dx = this.t1.x * c + this.t2.x * sn, dy = this.t1.y * c + this.t2.y * sn, dz = this.t1.z * c + this.t2.z * sn;
      const sp = (3 + vn * 0.7) * (0.6 + 0.6 * rnd());
      const up = 0.8 + 2 * rnd() * impact;
      this.grains.emit(
        pos.x + dx * 0.35, pos.y + 0.05, pos.z + dz * 0.35,
        dx * sp + n.x * up + s.vel.x * 0.35, dy * sp + n.y * up + s.vel.y * 0.35, dz * sp + n.z * up + s.vel.z * 0.35,
        T.fxGrain * (0.7 + rnd()) * (0.8 + impact * 0.4), 0.55 + 0.5 * rnd(), 0.95,
      );
    }
    const puffs = Math.round((12 + vn * 2.5) * k * (powder ? 1.6 : 1));
    for (let i = 0; i < puffs; i++) {
      const a = rnd() * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const dx = this.t1.x * c + this.t2.x * sn, dz = this.t1.z * c + this.t2.z * sn;
      const ringPuff = i % 3 !== 0; // two thirds roll outward along the snow, a third rises in the middle
      const sp = ringPuff ? (1.5 + vn * 0.35) * (0.6 + 0.6 * rnd()) : 0.5 * rnd();
      const up = ringPuff ? 0.2 + 0.4 * rnd() : 0.8 + 1.4 * rnd() * impact;
      this.mist.emit(
        pos.x + dx * 0.4, pos.y + 0.15, pos.z + dz * 0.4,
        dx * sp + s.vel.x * 0.3, up, dz * sp + s.vel.z * 0.3,
        T.fxMist * (1 + 0.9 * rnd()) * impact * (powder ? 1.6 : 1), T.fxMistLife * (1 + 0.8 * rnd()) * (powder ? 1.5 : 1), powder ? 0.5 : 0.42,
      );
    }
    if (quality === 'perfect') {
      // glitter: a fountain of sun-catching crystals
      const g = Math.round(46 * k * (this.comfort ? 0.4 : 1));
      for (let i = 0; i < g; i++) {
        const a = rnd() * Math.PI * 2;
        const sp = 1 + 2.5 * rnd();
        this.grains.emit(
          pos.x, pos.y + 0.3, pos.z,
          Math.cos(a) * sp + s.vel.x * 0.5, 2.5 + 3.5 * rnd(), Math.sin(a) * sp + s.vel.z * 0.5,
          T.fxGrain * (0.5 + 0.6 * rnd()), 0.9 + 0.8 * rnd(), 1, 1,
        );
      }
    }
  }

  /** Yard sale: an explosion of snow and a cloud that hangs. */
  crash(s: SkierState, pos: Vector3): void {
    this.ground(pos, s.normal);
    const k = this.q * T.fxBurst;
    for (let i = 0; i < Math.round(170 * k); i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 2 + 6 * rnd();
      this.grains.emit(
        pos.x, pos.y + 0.3, pos.z,
        Math.cos(a) * sp + s.vel.x * 0.5, 2 + 6 * rnd(), Math.sin(a) * sp + s.vel.z * 0.5,
        T.fxGrain * (0.8 + 1.5 * rnd()), 0.8 + 0.8 * rnd(), 0.95,
      );
    }
    for (let i = 0; i < Math.round(40 * k); i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 0.8 + 3.5 * rnd();
      this.mist.emit(
        pos.x + Math.cos(a) * 0.3, pos.y + 0.2 + rnd() * 0.6, pos.z + Math.sin(a) * 0.3,
        Math.cos(a) * sp + s.vel.x * 0.4, 0.3 + 1.6 * rnd(), Math.sin(a) * sp + s.vel.z * 0.4,
        T.fxMist * (1.5 + 2 * rnd()), T.fxMistLife * (1.8 + 1.6 * rnd()), 0.45,
      );
    }
  }

  /** Near-miss: snow shaken off the shaved tree's branches (canopy bursts drifting down); rocks puff dust. */
  treeShake(x: number, y: number, z: number, h: number, kind: Obstacle['kind'], razor: boolean): void {
    this.t1.set(x, y, z);
    this.ground(this.t1, UP);
    const k = this.q * T.fxTreeShake * (razor ? 1.8 : 1);
    if (kind !== 'tree') {
      for (let i = 0; i < Math.round(6 * k); i++) {
        this.mist.emit(x + (rnd() - 0.5) * h, y + h * (0.6 + 0.5 * rnd()), z + (rnd() - 0.5) * h, (rnd() - 0.5) * 1.5, 0.3 + rnd(), (rnd() - 0.5) * 1.5, T.fxMist * (0.8 + rnd()), T.fxMistLife * 1.4, 0.3);
      }
      return;
    }
    const R = h * 0.23; // canopy radius at the base (sim: TREE_CANOPY × h / TREE_HEIGHT)
    for (let i = 0; i < Math.round(22 * k); i++) {
      const f = 0.3 + 0.65 * rnd(); // height fraction on the cone
      const r = R * (1.05 - f) * (0.7 + 0.4 * rnd());
      const a = rnd() * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      // a clump: a puff that drifts down + a few grains that drop
      this.mist.emit(x + cx * r, y + h * f, z + cz * r, cx * 1.5, -0.6 - rnd(), cz * 1.5, T.fxMist * (1 + 1.2 * rnd()), T.fxMistLife * (1.3 + rnd()), 0.5);
      for (let j = 0; j < 3; j++) {
        this.grains.emit(
          x + cx * r + (rnd() - 0.5) * 0.3, y + h * f, z + cz * r + (rnd() - 0.5) * 0.3,
          cx * (0.6 + 1.5 * rnd()), 0.5 - rnd(), cz * (0.6 + 1.5 * rnd()), T.fxGrain * (1 + 1.5 * rnd()), 1.2 + rnd(), 0.95, rnd() < 0.2 ? 0.8 : 0,
        );
      }
    }
  }

  /** Each frame while the glove skims the snow: a thin stream. strength 0..1. */
  handDrag(pos: Vector3, strength: number, dt: number): void {
    if (dt <= 0 || strength <= 0) return;
    this.ground(this.lastPos, this.lastN);
    this.handAcc += 120 * strength * this.q * dt;
    while (this.handAcc >= 1) {
      this.handAcc -= 1;
      this.grains.emit(pos.x, pos.y + 0.03, pos.z, (rnd() - 0.5) * 1.2, 0.6 + 1.2 * rnd(), (rnd() - 0.5) * 1.2, T.fxGrain * (0.5 + 0.6 * rnd()), 0.35 + 0.3 * rnd(), 0.9);
      if (rnd() < 0.12) this.mist.emit(pos.x, pos.y + 0.06, pos.z, 0, 0.3, 0, T.fxMist * 0.5, T.fxMistLife * 0.8, 0.18);
    }
  }

  /** A pole tip stabbing the snow: a tiny puff. */
  polePlant(pos: Vector3): void {
    this.ground(this.lastPos, this.lastN);
    for (let i = 0; i < 5; i++) {
      this.grains.emit(pos.x, pos.y + 0.03, pos.z, (rnd() - 0.5) * 1.4, 0.8 + rnd(), (rnd() - 0.5) * 1.4, T.fxGrain * (0.5 + 0.5 * rnd()), 0.3 + 0.3 * rnd(), 0.9);
    }
    this.mist.emit(pos.x, pos.y + 0.08, pos.z, 0, 0.4, 0, T.fxMist * 0.45, T.fxMistLife * 0.7, 0.22);
  }

  /** Tangent basis of the plane with normal n into t1, t2. */
  private basis(n: Vector3): void {
    this.t1.set(1, 0, 0).addScaledVector(n, -n.x).normalize();
    this.t2.crossVectors(n, this.t1);
  }
}

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
