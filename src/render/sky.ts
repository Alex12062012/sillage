import {
  BackSide, BufferGeometry, DoubleSide, Color, DirectionalLight, Float32BufferAttribute, Fog, HemisphereLight, Mesh, ShaderMaterial,
  SphereGeometry, Vector3, type Scene,
} from 'three';
import { fbm } from '../core/rng';

interface Mood {
  t: number;
  top: number; horizon: number; sun: number; sunI: number; sky: number; ground: number; hemiI: number; elev: number;
}

/** Time-of-day keyframes (morning → noon → golden hour → dusk). Fog = horizon colour. */
const MOODS: Mood[] = [
  { t: 0.15, top: 0x58709f, horizon: 0xe9b8a6, sun: 0xffc59a, sunI: 1.1, sky: 0xbfc9ec, ground: 0x7c7f9f, hemiI: 1.05, elev: 5 },
  { t: 0.3, top: 0x5f93d3, horizon: 0xf3d8c6, sun: 0xffdcb4, sunI: 1.55, sky: 0xd3e2ff, ground: 0x8b91b0, hemiI: 1.25, elev: 16 },
  { t: 0.52, top: 0x3d7ed0, horizon: 0xcfe4f6, sun: 0xfff3e2, sunI: 1.85, sky: 0xe4f0ff, ground: 0x8e9cb5, hemiI: 1.35, elev: 52 },
  { t: 0.8, top: 0x45559d, horizon: 0xffb27f, sun: 0xffad6b, sunI: 1.6, sky: 0xbcc4ef, ground: 0x80708e, hemiI: 1.1, elev: 9 },
  { t: 0.95, top: 0x2e3566, horizon: 0xd98c88, sun: 0xff8f6b, sunI: 0.9, sky: 0x8f97c9, ground: 0x5d5672, hemiI: 0.9, elev: 2 },
];

const ca = new Color();
const cb = new Color();
const lerpHex = (a: number, b: number, k: number, out: Color) => out.copy(ca.setHex(a)).lerp(cb.setHex(b), k);

/** Gradient sky dome, distant low-poly peaks, sun + hemisphere light and fog, all driven by one time-of-day value. */
export class Sky {
  readonly sun = new DirectionalLight(0xffffff, 1.8);
  readonly hemi = new HemisphereLight(0xffffff, 0x888888, 1.3);
  readonly fog: Fog;
  private dome: Mesh;
  private peaks: Mesh;
  private domeMat: ShaderMaterial;
  private peakMat: ShaderMaterial;
  private sunDir = new Vector3();
  time = 0.5;

  constructor(scene: Scene) {
    this.fog = new Fog(0xcfe4f6, 120, 470);
    scene.fog = this.fog;
    scene.background = this.fog.color; // fallback behind the dome
    this.domeMat = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new Color() }, uHorizon: { value: new Color() }, uSun: { value: new Color() }, uSunDir: { value: new Vector3() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
          float s = max(dot(normalize(vDir), uSunDir), 0.0);
          col += uSun * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new Mesh(new SphereGeometry(1400, 24, 12), this.domeMat);
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;

    this.peakMat = new ShaderMaterial({
      fog: false, depthWrite: false, side: DoubleSide,
      uniforms: { uHorizon: { value: new Color() }, uTint: { value: new Color() } },
      vertexShader: /* glsl */ `
        attribute float aH;
        varying float vH;
        void main() { vH = aH; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon; uniform vec3 uTint;
        varying float vH;
        void main() {
          vec3 rock = mix(uHorizon, uTint, 0.55);
          vec3 snow = mix(uHorizon, vec3(1.0), 0.75);
          gl_FragColor = vec4(mix(rock, snow, smoothstep(0.45, 0.8, vH)), 1.0);
        }`,
    });
    this.peaks = new Mesh(peakRing(), this.peakMat);
    this.peaks.renderOrder = -1;
    this.peaks.frustumCulled = false;
    scene.add(this.dome, this.peaks, this.sun, this.sun.target, this.hemi);
    this.setTime(0.5);
  }

  setTime(t: number): void {
    this.time = ((t % 1) + 1) % 1;
    let a = MOODS[0];
    let b = MOODS[MOODS.length - 1];
    for (let i = 0; i < MOODS.length - 1; i++) {
      if (this.time >= MOODS[i].t && this.time <= MOODS[i + 1].t) { a = MOODS[i]; b = MOODS[i + 1]; break; }
    }
    const k = b.t === a.t ? 0 : Math.min(1, Math.max(0, (this.time - a.t) / (b.t - a.t)));
    const u = this.domeMat.uniforms;
    lerpHex(a.top, b.top, k, u.uTop.value);
    lerpHex(a.horizon, b.horizon, k, u.uHorizon.value);
    lerpHex(a.sun, b.sun, k, u.uSun.value);
    this.fog.color.copy(u.uHorizon.value);
    this.peakMat.uniforms.uHorizon.value.copy(u.uHorizon.value);
    lerpHex(a.ground, b.ground, k, this.peakMat.uniforms.uTint.value);
    lerpHex(a.sun, b.sun, k, this.sun.color);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    lerpHex(a.sky, b.sky, k, this.hemi.color);
    lerpHex(a.ground, b.ground, k, this.hemi.groundColor);
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    const elev = ((a.elev + (b.elev - a.elev) * k) * Math.PI) / 180;
    // sun from the front-left, so slopes facing the skier are lit and shadows read
    this.sunDir.set(-0.55 * Math.cos(elev), Math.sin(elev), 0.8 * Math.cos(elev)).normalize();
    u.uSunDir.value.copy(this.sunDir);
  }

  /** The distant peak ring (hidden in free ride, which has its own ranges). */
  showPeaks(on: boolean): void {
    this.peaks.visible = on;
  }

  /** Unit vector pointing to the sun (world space); shared, do not modify. */
  get sunDirection(): Vector3 {
    return this.sunDir;
  }

  /** Keep the dome, peaks and sun anchored on the camera. */
  update(cam: Vector3): void {
    this.dome.position.copy(cam);
    this.peaks.position.set(cam.x, cam.y - 40, cam.z);
    this.sun.position.copy(cam).addScaledVector(this.sunDir, 100);
    this.sun.target.position.copy(cam);
  }
}

/** A ring of jagged low-poly peaks far away (drawn behind everything, no fog). */
function peakRing(): BufferGeometry {
  const N = 180;
  const R = 1100;
  const pos: number[] = [];
  const hs: number[] = [];
  const height = (i: number) => {
    const a = i / N;
    return 0.25 + 0.75 * Math.max(0, fbm(91, Math.cos(a * Math.PI * 2) * 3 + 10, Math.sin(a * Math.PI * 2) * 3, 4) * 0.5 + 0.5) ** 1.6;
  };
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const h0 = height(i);
    const h1 = height(i + 1);
    const H = 330;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R, x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    pos.push(x0, -60, z0, x0, h0 * H, z0, x1, -60, z1, x1, -60, z1, x0, h0 * H, z0, x1, h1 * H, z1);
    hs.push(0, h0, 0, 0, h0, h1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new Float32BufferAttribute(hs, 1));
  return g;
}
