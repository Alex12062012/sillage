import './style.css';
import {
  BoxGeometry, CapsuleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh,
  MeshLambertMaterial, Quaternion, Scene, Vector3, WebGLRenderer,
} from 'three';
import { Input } from './input/input';
import { ChaseCamera } from './render/camera';
import { buildTerrainMesh } from './render/terrain';
import { createSkier, stepSkier, type SkierEvent, type SkierInput } from './sim/skier';
import { makeTrack, type TrackDef } from './sim/track';

const DT = 1 / 60;
const MAX_STEPS = 5;

const GREYBOX: TrackDef = {
  id: 'greybox', name: 'Grey box', seed: 1, length: 1200, slopeDeg: 16, halfWidth: 24,
  kickers: [{ z: 250, size: 'small' }, { z: 520, size: 'medium' }, { z: 820, size: 'large' }],
};

// ── renderer & scene
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new Scene();
scene.background = new Color(0x9ec5e8);
scene.fog = new Fog(0x9ec5e8, 90, 420);
scene.add(new HemisphereLight(0xdfefff, 0x8a96aa, 1.6));
const sun = new DirectionalLight(0xfff1dc, 1.6);
sun.position.set(-40, 80, -30);
scene.add(sun);

const track = makeTrack(GREYBOX);
scene.add(buildTerrainMesh(track));

// ── grey-box skier: a capsule on two skis
const skierMesh = new Group();
const body = new Mesh(new CapsuleGeometry(0.3, 1.0, 4, 8), new MeshLambertMaterial({ color: 0xff7a3d }));
body.position.y = 0.85;
const skiGeo = new BoxGeometry(0.1, 0.04, 1.7);
const skiMat = new MeshLambertMaterial({ color: 0x2b3a55 });
const skiL = new Mesh(skiGeo, skiMat);
const skiR = new Mesh(skiGeo, skiMat);
skiL.position.set(-0.13, 0.02, 0);
skiR.position.set(0.13, 0.02, 0);
const lean = new Group();
lean.add(body, skiL, skiR);
skierMesh.add(lean);
scene.add(skierMesh);

const cam = new ChaseCamera(window.innerWidth / window.innerHeight);
const input = new Input();

// ── HUD
const ui = document.getElementById('ui')!;
const speedEl = document.createElement('div');
speedEl.className = 'hud-speed';
const debugEl = document.createElement('div');
debugEl.className = 'hud-debug';
ui.append(speedEl, debugEl);

// ── simulation state
let skier = createSkier(track, 0, 2, 0);
const prevPos = new Vector3();
const renderPos = new Vector3();
let prevHeading = 0;
const inp: SkierInput = { steer: 0, tuck: false, brake: false, jump: false, flip: 0 };
const events: SkierEvent[] = [];
let lastEvent = '';

function restart(): void {
  skier = createSkier(track, 0, 2, 0);
  prevPos.copy(skier.pos);
  prevHeading = skier.heading;
  cam.snap(skier.pos, 0);
}
input.onKey = (code) => { if (code === 'KeyR') restart(); };
restart();

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cam.camera.aspect = window.innerWidth / window.innerHeight;
  cam.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const up = new Vector3(0, 1, 0);
const qSlope = new Quaternion();
const qYaw = new Quaternion();

// ── fixed-step loop (60 Hz physics) with interpolated rendering
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

function frame(now: number): void {
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += frameDt;
  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS) {
    prevPos.copy(skier.pos);
    prevHeading = skier.heading;
    input.sample(inp, DT, skier.airborne);
    events.length = 0;
    stepSkier(skier, inp, track, DT, events);
    for (const e of events) {
      if (e.type === 'takeoff') input.lockAirInputs();
      if (e.type === 'land') lastEvent = `land ${e.quality} vn=${e.vn.toFixed(1)} air=${e.airTime.toFixed(2)}s`;
      if (e.type === 'crash') lastEvent = `crash (${e.reason})`;
    }
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0; // too slow: drop time instead of spiralling
  const alpha = acc / DT;

  renderPos.lerpVectors(prevPos, skier.pos, alpha);
  skierMesh.position.copy(renderPos);
  qSlope.setFromUnitVectors(up, skier.normal);
  qYaw.setFromAxisAngle(up, lerpAngle(prevHeading, skier.heading, alpha));
  skierMesh.quaternion.copy(qSlope).multiply(qYaw);
  lean.rotation.z = -skier.edge * 0.6;
  lean.rotation.x = skier.airborne ? skier.flip : 0;
  cam.update(renderPos, skier.vel, frameDt);

  fpsFrames++;
  fpsTime += frameDt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
  }
  const kmh = skier.vel.length() * 3.6;
  speedEl.innerHTML = `${Math.round(kmh)}<small>km/h</small>`;
  debugEl.textContent = `fps ${fps.toFixed(0)}  z ${skier.pos.z.toFixed(0)} m\n${skier.airborne ? 'AIR' : 'ground'} skid ${skier.skid.toFixed(2)} edge ${skier.edge.toFixed(2)}\n${lastEvent}\n←→ carve · ↑ tuck · ↓ brake · space jump · R restart`;
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── debug / test API (used by Playwright)
declare global {
  interface Window { __sillage: unknown }
}
window.__sillage = {
  state: () => ({
    x: skier.pos.x, y: skier.pos.y, z: skier.pos.z, kmh: skier.vel.length() * 3.6,
    airborne: skier.airborne, crashed: skier.crashTimer > 0, heading: skier.heading, fps, lastEvent,
  }),
  drive: (o: Partial<SkierInput> | null) => { input.override = o; },
  restart,
};
