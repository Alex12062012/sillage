import './style.css';
import { WebGLRenderer } from 'three';
import { Game } from './game';
import type { SkierInput } from './sim/skier';
import type { TrackDef } from './sim/track';
import { createDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';

const GREYBOX: TrackDef = {
  id: 'greybox', name: 'Grey box', seed: 7, length: 1200, slopeDeg: 16, halfWidth: 24,
  kickers: [{ z: 250, size: 'small' }, { z: 520, size: 'medium' }, { z: 820, size: 'large' }],
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const ui = document.getElementById('ui')!;
const hud = new Hud(ui);
const game = new Game(renderer, GREYBOX, hud);

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
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fov: game.cam.camera.fov,
    };
  },
  drive: (o: Partial<SkierInput> | null) => { game.input.override = o; },
  restart: () => game.reset(),
  autopilot: (kmh: number | null, gap = 2.4) => { game.bot = kmh ? kmh / 3.6 : null; game.botGap = gap; },
  gpu: () => {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  },
  debug: () => debug.toggle(),
};
