// The art-direction captures: the same viewpoints before and after each visual layer (docs/captures/avant, apres-*).
// Usage: node scripts/shots.mjs <outDir> [--url=http://localhost:4180/] [--quality=high] [--mobile] [--only=jour,nuit]
// Needs `npm run preview` (the production build). Fails on a console error.
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const outDir = args.find((a) => !a.startsWith('--')) ?? 'docs/captures/avant';
const url = opt('url', 'http://localhost:4180/');
const quality = opt('quality', 'high');
const only = opt('only', '').split(',').filter(Boolean);
const mobile = args.includes('--mobile');
const [vw, vh] = opt('size', '1600x900').split('x').map(Number);
mkdirSync(outDir, { recursive: true });

/**
 * time: the sky's clock (0.5 noon, 0.8 golden hour, 0.95 dusk; night once the sky has one).
 * cam: a free camera (x, z in the station's metres, `up` above the snow, yaw / pitch in degrees; yaw 0 looks south).
 * play: instead, the game's own chase camera behind the bot (the HUD stays on).
 */
const SHOTS = opt('list', '') ? JSON.parse(readFileSync(opt('list', ''), 'utf8')) : [
  { name: 'jour', station: 'rousses', time: 0.5, cam: { x: 1872, z: 1552, up: 5, yaw: -150, pitch: -9, fov: 55 } },
  { name: 'soleil-bas', station: 'rousses', time: 0.8, cam: { x: -700, z: -640, up: 6, yaw: -146, pitch: -10, fov: 55 } },
  { name: 'nuit', station: 'rousses', time: 0.99, cam: { x: -1500, z: -1690, up: 4, yaw: 180, pitch: -2, fov: 55 } },
  { name: 'brume', station: 'rousses', time: 0.3, mist: true, cam: { x: -1088, z: -1207, up: 2.2, yaw: -147, pitch: -6, fov: 55 } },
  { name: 'vue-piste', station: 'rousses', time: 0.62, play: { piste: 'Nathalie Bouvier', s: 520, kmh: 50, wait: 4000 } },
  { name: 'vue-village', station: 'rousses', time: 0.7, cam: { x: -1549.5, z: -1710.5, up: 4, yaw: 135, pitch: -2, fov: 55 } },
  // beyond the six: the lift station up close, a restaurant, a forest edge, Avoriaz, an arcade run
  { name: 'extra-gare', station: 'rousses', time: 0.62, cam: { x: -1549.5, z: -1809.5, up: 4, yaw: 45, pitch: -2, fov: 55 } },
  { name: 'extra-illico', station: 'rousses', time: 0.72, cam: { x: -1514, z: -1747.6, up: 2.5, yaw: 118.7, pitch: 4, fov: 55 } },
  { name: 'extra-foret', station: 'rousses', time: 0.74, cam: { x: -1619, z: -514, up: 2.2, yaw: -73, pitch: -6, fov: 55 } },
  { name: 'extra-avoriaz', station: 'avoriaz', time: 0.74, cam: { x: 0, z: 0, up: 30, yaw: 30, pitch: -12, fov: 55 }, summitView: true },
  { name: 'extra-arcade', track: 'crete-du-loup', time: 0.8, play: { z: 300, kmh: 55, wait: 3000 } },
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pixel = devices['Pixel 7'];
const context = await browser.newContext(mobile
  ? { ...pixel, viewport: { width: pixel.viewport.height, height: pixel.viewport.width } }
  : { viewport: { width: vw, height: vh } });
await context.addInitScript((q) => {
  // the graphics level under test, and no stored run to resume
  const save = { version: 1, medals: {}, records: {}, outfit: 'ember', seenHint: true, settings: { quality: q, volume: 0, music: false } };
  localStorage.setItem('sillage.save.v1', JSON.stringify(save));
}, quality);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/socket|ERR_|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => page.waitForTimeout(ms);

let loaded = '';
for (const s of SHOTS) {
  if (only.length && !only.includes(s.name)) continue;
  const world = s.station ?? s.track;
  if (world !== loaded) {
    await page.goto(s.station ? `${url}?station=${s.station}` : url);
    await page.waitForFunction(() => !!window.__sillage, null, { timeout: 30000 });
    if (s.station) await page.waitForFunction(() => !!window.__sillage.raw().mountain, null, { timeout: 60000 });
    else await page.evaluate((id) => window.__sillage.play(id), s.track);
    await wait(1500);
    loaded = world;
  }
  await page.evaluate(({ s }) => {
    const api = window.__sillage, g = api.raw();
    api.photo(null);
    api.autopilot(null);
    const m = g.mountain;
    if (s.play) {
      if (m) {
        // on the named piste, `s` m down its line, facing down it
        const p = m.pistes.find((q) => q.name === s.play.piste && !q.area), o = { x: 0, z: 0, dx: 0, dz: 0 };
        m.along(p, s.play.s, o);
        api.spot(o.x, o.z, Math.atan2(o.dx, o.dz));
      } else api.teleport(s.play.z, s.play.kmh);
      api.autopilot(s.play.kmh);
    } else {
      let cam = s.cam;
      if (s.summitView) cam = { ...cam, x: m.summit.x, z: m.summit.z, yaw: (m.summit.heading * 180) / Math.PI };
      api.spot(cam.x, cam.z + 3, 0); // the skier out of frame, the detail patch under the lens
      api.drive({ brake: true });
      api.photo(cam);
    }
    document.getElementById('ui').style.visibility = s.play ? '' : 'hidden';
    api.time(s.time);
    if (s.mist) (api.mist ?? ((on) => { if (on) { g.sky.fog.near = 5; g.sky.fog.far = 420; } }))(true);
    else api.mist?.(false);
  }, { s });
  await wait(s.play?.wait ?? 2500);
  await page.evaluate((t) => window.__sillage.time(t), s.time); // (the day cycle moved on while waiting)
  await wait(120);
  await page.screenshot({ path: `${outDir}/${s.name}.jpg`, quality: 88, type: 'jpeg' });
  const st = await page.evaluate(() => { const st = window.__sillage.state(); return { fps: Math.round(st.fps), calls: st.calls, tris: st.tris, dpr: st.dpr }; });
  console.log(s.name.padEnd(16), JSON.stringify(st));
  if (s.mist) loaded = ''; // reload: the old fog has no way back
}
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
