import './style.css';
import { WebGLRenderer } from 'three';
import { Game } from './game';
import type { SkierInput } from './sim/skier';
import { applyRun, COSMETICS, emptySave, isUnlocked, loadSave, saveSave, totalStars, type Save, type Settings } from './sim/progress';
import { TRACKS, trackById } from './sim/tracks';
import { TUNING } from './tuning';
import { createDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';
import { isTouch, Menus } from './ui/menus';
import { showResults } from './ui/results';

// ── persistence
const storage = (() => {
  try {
    localStorage.getItem('probe');
    return localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
})();
let save: Save = loadSave(storage);
if (!storage.getItem('sillage.save.v1')) {
  // first launch: comfort mode when the OS asks for reduced motion; phones start on Medium (DPR ≤ 1.5)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) save.settings.comfort = true;
  if (matchMedia('(pointer: coarse)').matches) save.settings.quality = 'medium';
}
const persist = () => saveSave(storage, save);

// ── renderer (MSAA only on the high setting; it is chosen at boot)
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: save.settings.quality === 'high', powerPreference: 'high-performance' });
const ui = document.getElementById('ui')!;
const hud = new Hud(ui);
const params = new URLSearchParams(location.search);
const lastTrack = params.get('track') ?? storage.getItem('sillage.last') ?? TRACKS[0].id;
const game = new Game(renderer, trackById(isUnlocked(save, lastTrack) || params.has('track') ? lastTrack : TRACKS[0].id), hud);

// ── touch buttons (pause, jump), mirrored for left-handed players
const touch = document.createElement('div');
touch.className = 'touch';
touch.innerHTML = `<button class="touch-btn pause" aria-label="Pause">II</button><button class="touch-btn jump" aria-label="Jump">↑</button><div class="fps"></div>`;
ui.appendChild(touch);
const fpsEl = touch.querySelector('.fps') as HTMLDivElement;
game.input.attachTouch(document.body);
touch.querySelector('.jump')!.addEventListener('pointerdown', () => game.input.pressJump());

// ── screens: attract (menus over a bot run) · run · paused · results
type Mode = 'attract' | 'run' | 'paused' | 'results';
let mode: Mode = 'attract';
let results: HTMLElement | null = null;

const menus = new Menus(document.body, {
  save: () => save,
  play: (id) => startRun(id),
  setOutfit: (id) => { save.outfit = id; persist(); applyOutfit(); },
  setSettings: (s) => { save.settings = s; persist(); applySettings(); },
  enableTilt: () => game.input.enableTilt(),
  resetProgress: () => { save = { ...emptySave(), settings: save.settings }; persist(); applyOutfit(); },
  click: () => game.audio.click(),
});

function applyOutfit(): void {
  game.setOutfit(COSMETICS.find((c) => c.id === save.outfit) ?? COSMETICS[0]);
}

let qualityScale = 1; // adaptive resolution multiplier
function applySettings(): void {
  const st: Settings = save.settings;
  const cap = { low: 1, medium: 1.5, high: 2 }[st.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap) * qualityScale);
  game.setQuality(st.quality);
  game.input.sensitivity = st.sensitivity;
  game.audio.setVolume(st.volume);
  game.audio.setMusic(st.music);
  game.cam.comfort = st.comfort;
  game.cam.firstPerson = st.camera === 'helmet';
  ui.classList.toggle('left-handed', st.leftHanded);
  fpsEl.hidden = !st.showFps;
  if (st.tilt && !game.input.tilt) void game.input.enableTilt();
  if (!st.tilt) game.input.tilt = false;
  resize();
}

function setMode(m: Mode): void {
  mode = m;
  game.paused = m === 'paused';
  hud.show(m === 'run' || m === 'paused');
  touch.classList.toggle('show', m === 'run' && isTouch());
}

function attract(): void {
  results?.remove();
  results = null;
  game.bestTiers = { ...save.medals };
  attractRun();
  setMode('attract');
  menus.main();
}

/** The menu background: the bot carving down the run, starting below the gate. */
function attractRun(): void {
  game.reset();
  game.bot = 52 / 3.6;
  game.startAt(70, 13);
}

function startRun(id: string): void {
  results?.remove();
  results = null;
  menus.hide();
  game.bot = null;
  game.input.override = null;
  if (game.track.def.id !== id) game.load(trackById(id));
  storage.setItem('sillage.last', id);
  game.bestTiers = { ...save.medals };
  game.reset();
  setMode('run');
  if (!save.seenHint) {
    hud.showHint(isTouch()
      ? '<b>Hold</b> left / right to carve · <b>both</b> to tuck · swipe <b>↑</b> jump · swipe <b>↓</b> brake'
      : '<b>← →</b> carve · <b>↑</b> tuck · <b>↓</b> brake · <b>Space</b> jump · <b>R</b> restart', 7);
    save.seenHint = true;
    persist();
  }
}

/** Restarting mid-run still banks the medals earned so far (speed, air, chain, spin). */
function bankPartial(): void {
  if (mode !== 'run' && mode !== 'paused') return;
  if (game.phase !== 'running') return;
  save = applyRun(save, game.track.def.id, { ...game.stats(), finished: false }).save;
  persist();
}

function restart(): void {
  bankPartial();
  startRun(game.track.def.id);
}

function pause(): void {
  if (mode !== 'run') return;
  setMode('paused');
  menus.pause({
    resume: () => { menus.hide(); setMode('run'); },
    restart: () => restart(),
    quit: () => { bankPartial(); attract(); },
  });
}

game.onStart = () => game.audio.unlock();
game.onFinish = (stats) => {
  if (mode === 'attract') {
    attractRun();
    return;
  }
  const id = game.track.def.id;
  const before = totalStars(save);
  const previous = save.records[id];
  const r = applyRun(save, id, stats);
  save = r.save;
  persist();
  const next = TRACKS[TRACKS.findIndex((t) => t.id === id) + 1];
  setMode('results');
  results = showResults(ui, {
    track: game.track.def, stats, previous, medals: save.medals, gained: r.gained,
    unlockedRuns: r.unlocked.map(trackById), starsBefore: before, starsAfter: totalStars(save),
    hasNext: !!next && isUnlocked(save, next.id),
  }, { retry: restart, next: () => next && startRun(next.id), menu: attract });
  if (r.gained.length) game.audio.chime(4);
};

game.readyText = isTouch() ? 'Hold a side or swipe <b>↑</b> to drop in' : 'Press <b>↑</b> or an arrow key to drop in';
touch.querySelector('.pause')!.addEventListener('click', pause);

const debug = createDebugPanel(document.body, () => {
  const i = renderer.info;
  const s = game.skier;
  return `fps ${game.fps.toFixed(0)}  calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k  particles ${game.particles}  dpr ${renderer.getPixelRatio().toFixed(2)}
${(s.vel.length() * 3.6).toFixed(0)} km/h  z ${s.pos.z.toFixed(0)}  edge ${s.edge.toFixed(2)}  skid ${s.skid.toFixed(2)}  ${s.airborne ? 'AIR' : ''}
score ${game.run.score}  chain ${game.run.chain}  near-misses ${game.run.nearMisses}  crashes ${game.run.crashes}`;
});

game.input.onKey = (code) => {
  game.audio.unlock();
  if (code === 'Backquote' || code === 'F2' || code === 'IntlBackslash') debug.toggle();
  if (mode === 'run') {
    if (code === 'KeyR') restart();
    if (code === 'Escape' || code === 'KeyP') pause();
    if (code === 'KeyC') { save.settings.camera = save.settings.camera === 'chase' ? 'helmet' : 'chase'; persist(); applySettings(); }
  } else if (mode === 'paused' && (code === 'Escape' || code === 'KeyP')) {
    menus.hide();
    setMode('run');
  } else if (mode === 'results' && (code === 'KeyR' || code === 'Enter')) {
    restart();
  } else if (menus.current && code === 'Escape') {
    if (mode === 'attract') menus.main();
  } else if (menus.current && (code === 'ArrowDown' || code === 'ArrowUp')) {
    menus.move(code === 'ArrowDown' ? 1 : -1);
  }
};
game.input.onPad = (b) => {
  if (menus.current || mode === 'results') {
    if (b === 'down' || b === 'up') menus.move(b === 'down' ? 1 : -1);
    if (b === 'a') (document.activeElement as HTMLElement | null)?.click();
    if (b === 'b' && menus.current === 'pause') { menus.hide(); setMode('run'); }
    return;
  }
  if (b === 'start') pause();
  if (b === 'y') restart();
  if (b === 'select') game.input.onKey?.('KeyC');
};
window.addEventListener('pointerdown', () => game.audio.unlock());

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  game.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);

// ── main loop with adaptive resolution (keeps mobile above 30 fps, ideally 60)
let last = performance.now();
let slow = 0;
let fast = 0;
let fpsT = 0;
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.frame(dt);
  if (mode === 'run' || mode === 'attract') {
    if (dt > 0.022) { slow += dt > 0.033 ? 2 : 1; fast = 0; } else if (dt < 0.0145) { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 60 && qualityScale > 0.5) { qualityScale = Math.max(0.5, qualityScale - (dt > 0.033 ? 0.15 : 0.1)); slow = 0; applySettings(); }
    if (fast > 600 && qualityScale < 1) { qualityScale = Math.min(1, qualityScale + 0.05); fast = 0; applySettings(); }
  }
  fpsT += dt;
  if (fpsT > 0.5 && !fpsEl.hidden) { fpsEl.textContent = `${game.fps.toFixed(0)} fps`; fpsT = 0; }
  requestAnimationFrame(loop);
}

// ── boot: apply settings, prewarm the world behind the loading screen, then the menu
applySettings();
applyOutfit();
attract();
const loading = document.getElementById('loading');
requestAnimationFrame((t) => {
  last = t;
  loading?.classList.add('done');
  window.setTimeout(() => loading?.remove(), 600);
  requestAnimationFrame(loop);
});

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
      time: game.run.time, finished: game.run.finished, phase: game.phase, mode, menu: menus.current, track: game.track.def.id,
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fov: game.cam.camera.fov, buildMs: game.chunkBuildMs,
      dpr: renderer.getPixelRatio(),
    };
  },
  drive: (o: Partial<SkierInput> | null) => { game.input.override = o; },
  restart,
  play: startRun,
  load: (id: string) => startRun(id),
  menu: attract,
  save: () => save,
  results: () => !!results,
  phase: () => game.phase,
  autopilot: (kmh: number | null, gap = 2.4) => { game.bot = kmh ? kmh / 3.6 : null; game.botGap = gap; },
  gpu: () => {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  },
  time: (t: number) => game.sky.setTime(t),
  tune: (key: keyof typeof TUNING, value: number) => { TUNING[key] = value; },
  features: () => game.track.features.map((f) => ({ ...f })),
  teleport: (z: number, kmh = 40) => { game.reset(); game.startAt(z, kmh / 3.6); },
  debug: () => debug.toggle(),
};
