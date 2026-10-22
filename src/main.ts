import './style.css';
import { WebGLRenderer } from 'three';
import { Game } from './game';
import type { SkierInput } from './sim/skier';
import { trackById } from './sim/tracks';
import { createDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';
import { TUNING } from './tuning';


const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const ui = document.getElementById('ui')!;
const hud = new Hud(ui);
const params = new URLSearchParams(location.search);
const game = new Game(renderer, trackById(params.get('track') ?? ''), hud);

const debug = createDebugPanel(document.body, () => {
  const i = renderer.info;
  const s = game.skier;
  return `fps ${game.fps.toFixed(0)}  calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k  particles ${game.particles}
${(s.vel.length() * 3.6).toFixed(0)} km/h  z ${s.pos.z.toFixed(0)}  edge ${s.edge.toFixed(2)}  skid ${s.skid.toFixed(2)}  ${s.airborne ? 'AIR' : ''}
score ${game.run.score}  chain ${game.run.chain}  near-misses ${game.run.nearMisses}  crashes ${game.run.crashes}`;
});

game.input.onKey = (code) => {
  game.audio.unlock();
  if (code === 'KeyR') game.reset();
  if (code === 'KeyC') game.cam.firstPerson = !game.cam.firstPerson;
  if (code === 'Backquote' || code === 'F2' || code === 'IntlBackslash') debug.toggle();
};
window.addEventListener('pointerdown', () => game.audio.unlock());

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  game.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();
hud.showHint('<b>← →</b> carve · <b>↑</b> tuck · <b>↓</b> brake · <b>Space</b> jump · <b>R</b> restart', 6);

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ── debug / test API (used by Playwright)
declare global {
  interface Window { __sillage: unknown }
}
window.__sillage = {
  state: () => {
    const s = game.skier;
    return {
      x: s.pos.x, y: s.pos.y, z: s.pos.z, kmh: s.vel.length() * 3.6, airborne: s.airborne, crashed: s.crashTimer > 0,
      heading: s.heading, fps: game.fps, score: game.run.score, nearMisses: game.run.nearMisses, crashes: game.run.crashes,
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fov: game.cam.camera.fov, buildMs: game.chunkBuildMs,
    };
  },
  drive: (o: Partial<SkierInput> | null) => { game.input.override = o; },
  restart: () => game.reset(),
  load: (id: string) => game.load(trackById(id)),
  time: (t: number) => game.sky.setTime(t),
  tune: (key: keyof typeof TUNING, value: number) => { TUNING[key] = value; },
  features: () => game.track.features.map((f) => ({ ...f })),
  teleport: (z: number, kmh = 40) => {
    game.reset();
    const s = game.skier;
    const x = game.track.centerX(z);
    s.pos.set(x, game.track.height(x, z), z);
    s.heading = 0;
    s.vel.set(0, 0, kmh / 3.6);
    game.cam.snap(s.pos, 0);
  },
  probe: (fog: boolean, sky: boolean) => {
    game.sky.fog.far = fog ? 470 : 1e9;
    game.sky.fog.near = fog ? 120 : 1e9;
    game.scene.traverse((o) => { if (o.renderOrder < 0) o.visible = sky; });
    const c = game.cam.camera;
    return { cam: [c.position.x, c.position.y, c.position.z], ground: game.track.height(c.position.x, c.position.z) };
  },
  autopilot: (kmh: number | null, gap = 2.4) => { game.bot = kmh ? kmh / 3.6 : null; game.botGap = gap; },
  gpu: () => {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  },
  debug: () => debug.toggle(),
};
