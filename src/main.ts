import './style.css';
import { WebGLRenderer } from 'three';
import { Game } from './game';
import type { SkierInput } from './sim/skier';
import { applyRun, COSMETICS, emptySave, isUnlocked, loadSave, saveSave, totalStars, type Save, type Settings } from './sim/progress';
import { loadedStation, loadStation, stationOfTrack } from './sim/stations';
import { TRACKS, trackById } from './sim/tracks';
import { TUNING } from './tuning';
import { createDebugPanel } from './ui/debug';
import { Hud } from './ui/hud';
import { isTouch, Menus } from './ui/menus';
import { showResults } from './ui/results';
import { TrailMap } from './ui/trailMap';

// ── persistence
const storage = (() => {
  try {
    localStorage.setItem('sillage.probe', '1'); // write probe: quota-full / old private modes throw here
    localStorage.removeItem('sillage.probe');
    return localStorage;
  } catch {
    const mem = new Map<string, string>(); // progress lives for this session only
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
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
const renderer = new WebGLRenderer({ canvas, antialias: save.settings.quality === 'high', powerPreference: 'high-performance', stencil: true });
const ui = document.getElementById('ui')!;
const hud = new Hud(ui);
const params = new URLSearchParams(location.search);
const lastTrack = params.get('track') ?? storage.getItem('sillage.last') ?? TRACKS[0].id;
let firstTrack = isUnlocked(save, lastTrack) || params.has('track') ? lastTrack : TRACKS[0].id;
const firstStation = stationOfTrack(firstTrack); // the last run was an open mountain: behind the menu again (its data first)
if (firstStation) await loadStation(firstStation).catch(() => { firstTrack = TRACKS[0].id; });
const game = new Game(renderer, trackById(firstTrack), hud);

// ── touch buttons (pause, jump), mirrored for left-handed players
const touch = document.createElement('div');
touch.className = 'touch';
touch.innerHTML = `<button class="touch-btn pause" aria-label="Pause">II</button><button class="touch-btn map" aria-label="Trail map">Map</button><button class="touch-btn jump" aria-label="Jump">↑</button>`;
ui.insertBefore(touch, hud.el); // before the HUD so `.touch.show ~ .hud` can shift the score clear of the button
const fpsEl = document.createElement('div');
fpsEl.className = 'fps';
ui.appendChild(fpsEl);
const onlineEl = document.createElement('div'); // players online on the station (free ride)
onlineEl.className = 'online';
onlineEl.hidden = true;
ui.appendChild(onlineEl);
game.input.attachTouch(document.body);
touch.querySelector('.jump')!.addEventListener('pointerdown', () => game.input.pressJump());
// free ride: the station's trail map (M, the map button); the game waits while it is open
const trailMap = new TrailMap(ui, () => game.mapMarkers(), (i) => { closeMap(); game.toLift(i); }, () => closeMap());
touch.querySelector('.map')!.addEventListener('click', () => openMap());

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
  game.input.haptics = st.vibration;
  game.audio.setVolume(st.volume);
  game.audio.setMusic(st.music);
  game.setComfort(st.comfort);
  game.setFirstPerson(st.camera === 'helmet');
  ui.classList.toggle('left-handed', st.leftHanded);
  ui.classList.toggle('comfort', st.comfort); // gentler HUD overlays
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
  touch.classList.toggle('free', !!game.mountain);
}

/** Your name for the online free ride (kept in the browser; a random one until you choose). */
function playerName(): string {
  try {
    const n = storage.getItem('sillage.name')?.trim();
    if (n) return n.slice(0, 16);
    const fresh = `Skier${Math.floor(100 + Math.random() * 900)}`;
    storage.setItem('sillage.name', fresh);
    return fresh;
  } catch {
    return 'Skier';
  }
}

function attract(): void {
  game.goOffline();
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

async function startRun(id: string): Promise<void> {
  const station = stationOfTrack(id);
  if (station && !loadedStation(station)) await loadStation(station); // its own chunk, fetched the first time
  results?.remove();
  results = null;
  menus.hide();
  game.bot = null;
  game.input.override = null;
  if (game.track.def.id !== id) game.load(trackById(id));
  try { storage.setItem('sillage.last', id); } catch { /* not critical */ }
  game.bestTiers = { ...save.medals };
  game.reset();
  setMode('run');
  if (station) game.goOnline(playerName(), params.get('portal') ?? undefined); // the other players on the station, through the portal (?portal=<url> for a local one)
  else game.goOffline();
  if (station) {
    hud.showHint(`<b>${station.name}</b> · ${station.area} — ski into a lift's bottom station to ride up · ${isTouch()
      ? 'hold <b>both</b> to skate on the flats · <b>Map</b> to find a lift' : `<b>↑</b> skates on the flats · <b>T</b> top of ${station.summitName} · <b>M</b> trail map`} · <small>map © OpenStreetMap${station.id === 'rousses' ? '' : ' · IGN'}</small>`, 8);
  } else if (!save.seenHint) {
    hud.showHint(isTouch()
      ? '<b>Hold</b> left / right to carve · <b>both</b> to tuck (grab in the air) · swipe <b>↑</b> jump · swipe <b>↓</b> brake'
      : '<b>← →</b> carve · <b>↑</b> tuck · <b>↓</b> brake · <b>Space</b> jump, hold to grab · <b>R</b> restart', 8);
    save.seenHint = true;
    persist();
  }
}

/**
 * Leaving a run early still banks what it earned: live medals mid-run, and the whole finished run if
 * the player retries during the run-out before the results screen appears.
 */
function bankPartial(): void {
  if (mode !== 'run' && mode !== 'paused') return;
  if (game.phase === 'ready') return;
  save = applyRun(save, game.track.def.id, game.stats()).save;
  persist();
}

function restart(): void {
  bankPartial();
  startRun(game.track.def.id);
}

function openMap(): void {
  if (mode !== 'run' || !game.mountain) return;
  setMode('paused');
  trailMap.show(game.mountain);
}

function closeMap(): void {
  if (!trailMap.open) return;
  trailMap.hide();
  setMode('run');
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

game.input.onKey = (code, key = '') => {
  const isMap = key.toLowerCase() === 'm'; // by letter: on AZERTY the M key is not KeyM
  game.audio.unlock();
  if (code === 'Backquote' || code === 'F2' || code === 'IntlBackslash') debug.toggle();
  if (mode === 'run') {
    if (code === 'KeyR') restart();
    if (code === 'KeyT') game.toSummit();
    if (isMap) openMap();
    if (code === 'Escape' || code === 'KeyP') pause();
    if (code === 'KeyC') { save.settings.camera = save.settings.camera === 'chase' ? 'helmet' : 'chase'; persist(); applySettings(); }
  } else if (trailMap.open) {
    if (isMap || code === 'Escape') closeMap();
  } else if (mode === 'paused' && (code === 'Escape' || code === 'KeyP')) {
    menus.hide();
    setMode('run');
  } else if (mode === 'results') {
    if (code === 'KeyR') restart();
    if ((code === 'ArrowDown' || code === 'ArrowUp' || code === 'ArrowLeft' || code === 'ArrowRight') && results) {
      menus.move(code === 'ArrowDown' || code === 'ArrowRight' ? 1 : -1, results);
    }
  } else if (menus.current && code === 'Escape') {
    if (mode === 'attract') menus.main();
  } else if (menus.current && (code === 'ArrowDown' || code === 'ArrowUp')) {
    menus.move(code === 'ArrowDown' ? 1 : -1);
  }
};
game.input.onPad = (b) => {
  if (menus.current || mode === 'results') {
    if (b === 'down' || b === 'up') menus.move(b === 'down' ? 1 : -1, mode === 'results' && results ? results : undefined);
    if (b === 'a') (document.activeElement as HTMLElement | null)?.click();
    if (b === 'b' && menus.current === 'pause') { menus.hide(); setMode('run'); }
    return;
  }
  if (trailMap.open) {
    if (b === 'b' || b === 'start') closeMap();
    return;
  }
  if (b === 'start') pause();
  if (b === 'y') restart();
  if (b === 'select') game.input.onKey?.('KeyC', 'c');
};
// touch activation happens on release (iOS): unlock on both ends of the gesture
for (const ev of ['pointerdown', 'pointerup', 'touchend'] as const) window.addEventListener(ev, () => game.audio.unlock());

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
  const n = mode === 'run' || mode === 'paused' ? game.onlineCount() : null;
  onlineEl.hidden = n === null;
  if (n !== null) onlineEl.textContent = `● ${n} online`;
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
      dpr: renderer.getPixelRatio(), cam: game.cam.camera.position.toArray().map((v) => Math.round(v)),
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
  spot: (x: number, z: number, heading = 0) => { game.unload({ x, z, heading }); game.phase = 'running'; }, // free ride
  debug: () => debug.toggle(),
};
