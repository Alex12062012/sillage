// Drives the game through window.__sillage, takes screenshots and fails on console errors.
// Usage: node scripts/capture.mjs <scenario> [url] [outDir]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [scenario = 'greybox', url = 'http://localhost:5180/', outDir = 'docs/captures'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const mobile = scenario.endsWith('-mobile') || scenario.startsWith('touch');
const landscape = scenario.includes('landscape');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pixel = devices['Pixel 7'];
const context = await browser.newContext(mobile
  ? { ...pixel, viewport: landscape ? { width: pixel.viewport.height, height: pixel.viewport.width } : pixel.viewport }
  : { viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__sillage.state());
const drive = (o) => page.evaluate((x) => window.__sillage.drive(x), o);
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.jpg`, quality: 80, type: 'jpeg' });
  const s = await state();
  console.log(name.padEnd(22), JSON.stringify(s, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
};
const until = async (pred, timeout = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred(await state())) return true;
    await wait(50);
  }
  return false;
};

await page.goto(url);
page.on('load', () => {});
await page.waitForFunction(() => !!window.__sillage, null, { timeout: 15000 });
await wait(800);
console.log('GPU:', await page.evaluate(() => window.__sillage.gpu()));

if (scenario.startsWith('greybox')) {
  await shot('p1-start');
  await drive({ tuck: true });
  await wait(3000);
  await shot('p1-tuck-3s');
  await drive({ steer: 0.7 });
  await wait(1200);
  await shot('p1-carve');
  await drive({ brake: true, steer: 0 });
  await wait(1500);
  await shot('p1-brake');
  await page.evaluate(() => window.__sillage.restart());
  await drive({ tuck: true });
  await until((s) => s.z > 236);
  await drive({});
  const flew = await until((s) => s.airborne, 4000);
  await wait(250);
  await shot('p1-kicker-air');
  await until((s) => !s.airborne, 5000);
  await wait(300);
  await shot('p1-kicker-landed');
  console.log('kicker flew:', flew);
  await drive({ jump: true });
  await wait(60);
  await drive({});
  await wait(200);
  await shot('p1-pop');
}

if (scenario.startsWith('feel')) {
  await shot('p2-start');
  await page.evaluate(() => window.__sillage.autopilot(60));
  await wait(2500);
  await shot('p2-cruise');
  await page.evaluate(() => window.__sillage.autopilot(null));
  await drive({ steer: 0.8 });
  await wait(700);
  await shot('p2-carve-spray');
  await drive({ brake: true, steer: 0 });
  await wait(450);
  await shot('p2-brake-spray');
  await drive(null);
  await page.evaluate(() => window.__sillage.restart());
  await page.evaluate(() => window.__sillage.autopilot(75));
  await until((s) => s.z > 500, 45000);
  await page.evaluate(() => window.__sillage.autopilot(null));
  await drive({});
  await until((s) => s.airborne, 6000);
  await wait(500);
  await shot('p2-kicker-air');
  await until((s) => !s.airborne, 6000);
  await wait(80);
  await shot('p2-landing');
  await page.evaluate(() => window.__sillage.autopilot(62, 0.9));
  await until((s) => s.nearMisses > 0, 40000);
  await wait(120);
  await shot('p2-near-miss');
  await page.evaluate(() => window.__sillage.debug());
  await wait(500);
  await shot('p2-debug-panel');
}

if (scenario.startsWith('world')) {
  for (const id of ['combe-douce', 'crete-du-loup', 'couloir-noir']) {
    await page.evaluate((t) => { window.__sillage.load(t); window.__sillage.restart(); }, id);
    await wait(600);
    await shot(`p3-${id}-start`);
    await page.evaluate(() => window.__sillage.autopilot(55));
    await wait(9000);
    await shot(`p3-${id}-run`);
    // high "drone" view: is the line readable from above?
    await page.evaluate(() => { window.__sillage.tune('camHeight', 24); window.__sillage.tune('camDistance', 34); window.__sillage.tune('camLookAhead', 60); });
    await wait(1500);
    await shot(`p3-${id}-drone`);
    await page.evaluate(() => { window.__sillage.tune('camHeight', 2); window.__sillage.tune('camDistance', 4.6); window.__sillage.tune('camLookAhead', 7); });
    await until((s) => s.airborne, 25000);
    await wait(350);
    await shot(`p3-${id}-air`);
    await page.evaluate(() => window.__sillage.autopilot(null));
  }
}

if (scenario.startsWith('features')) {
  for (const id of ['crete-du-loup', 'couloir-noir']) {
    await page.evaluate((t) => window.__sillage.load(t), id);
    const feats = await page.evaluate(() => window.__sillage.features());
    const seen = new Set();
    for (const f of feats) {
      if (seen.has(f.type)) continue;
      seen.add(f.type);
      const z = f.type === 'arch' ? f.z0 - 8 : f.type === 'cliff' ? f.z0 + 2 : f.z0 - 20;
      await page.evaluate((zz) => window.__sillage.teleport(zz, 35), z);
      await drive({ brake: true });
      await wait(900);
      await drive(null);
      await shot(`p3-${id}-${f.type}`);
    }
  }
}

if (scenario.startsWith('loop')) {
  // full run on the easy track by the autopilot → results screen, then a timed restart
  await page.evaluate(() => { localStorage.clear(); window.__sillage.load('combe-douce'); });
  await wait(400);
  await shot('p4-ready');
  await page.evaluate(() => window.__sillage.autopilot(78));
  await until((s) => s.z > 120, 30000);
  await shot('p4-hud-running');
  await page.waitForFunction(() => window.__sillage.results(), null, { timeout: 120000 });
  await wait(900);
  await shot('p4-results');
  const t = await page.evaluate(async () => {
    const t0 = performance.now();
    window.__sillage.restart();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  console.log(JSON.stringify({ restartMs: +t.toFixed(1), save: await page.evaluate(() => window.__sillage.save()) }));
  await page.evaluate(() => window.__sillage.autopilot(null));
  await wait(300);
  await shot('p4-after-restart');
}

if (scenario.startsWith('menus')) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__sillage);
  await wait(1200);
  await shot('p5-main-menu');
  // keyboard only: Play is focused → Enter; first card focused → Enter; ArrowUp drops in
  await page.keyboard.press('Enter');
  await wait(300);
  await shot('p5-select');
  await page.keyboard.press('Enter');
  await wait(500);
  console.log('after select:', JSON.stringify(await state(), (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
  await shot('p5-ready-hint');
  await page.keyboard.down('ArrowUp');
  await wait(2500);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  await wait(600);
  await page.keyboard.up('ArrowLeft');
  await shot('p5-keyboard-run');
  const st = await state();
  console.log('keyboard run:', JSON.stringify({ phase: st.phase, mode: st.mode, kmh: Math.round(st.kmh), x: +st.x.toFixed(1), z: Math.round(st.z) }));
  await page.keyboard.press('Escape');
  await wait(300);
  await shot('p5-pause');
  await page.keyboard.press('Escape');
  await wait(200);
  await page.evaluate(() => window.__sillage.menu());
  await wait(300);
  await page.click('[data-go="locker"]');
  await wait(300);
  await shot('p5-locker');
  await page.click('[data-go="main"]');
  await page.click('[data-go="settings"]');
  await wait(300);
  await shot('p5-settings');
}

if (scenario.startsWith('touch')) {
  const cdp = await context.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__sillage);
  await wait(1200);
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-menu`);
  await page.tap('[data-go="select"]');
  await wait(300);
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-select`);
  await page.tap('[data-run="combe-douce"]');
  await wait(500);
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-ready`);
  // both thumbs = tuck (drops in), then hold the right half = carve right (-x), then swipe up = jump
  await touch('touchStart', [[vw * 0.2, vh * 0.7], [vw * 0.8, vh * 0.7]]);
  await wait(2200);
  await touch('touchEnd', []);
  const s0 = await state();
  await touch('touchStart', [[vw * 0.8, vh * 0.6]]);
  await wait(900);
  await touch('touchEnd', []);
  const s1 = await state();
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-carve`);
  await touch('touchStart', [[vw * 0.5, vh * 0.75]]);
  await touch('touchMove', [[vw * 0.5, vh * 0.68]]);
  await touch('touchMove', [[vw * 0.5, vh * 0.55]]);
  await wait(120);
  const s2 = await state();
  await touch('touchEnd', []);
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-jump`);
  console.log('touch:', JSON.stringify({ droppedIn: s0.phase, kmhAfterTuck: Math.round(s0.kmh), carveDx: +(s1.x - s0.x).toFixed(2), jumped: s2.airborne }));
  await page.tap('.touch-btn.pause');
  await wait(300);
  console.log('pause menu:', (await state()).menu);
  await shot(`p5-touch-${landscape ? 'land' : 'port'}-pause`);
}

if (scenario.startsWith('pad')) {
  // a standard-mapping gamepad, driven from the test through window.__pad
  await page.addInitScript(() => {
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__sillage);
  await wait(900);
  const press = async (i, ms = 120) => {
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: true, value: 1 }; }, i);
    await wait(ms);
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: false, value: 0 }; }, i);
    await wait(120);
  };
  await press(0); // A on Play
  await press(0); // A on the first run
  const st0 = await state();
  await page.evaluate(() => { window.__pad.buttons[7] = { pressed: true, value: 1 }; }); // RT = tuck (drops in)
  await wait(1500);
  await page.evaluate(() => { window.__pad.buttons[7] = { pressed: false, value: 0 }; window.__pad.axes[0] = 0.9; }); // stick right
  const x0 = (await state()).x;
  await wait(800);
  await page.evaluate(() => { window.__pad.axes[0] = 0; });
  const st1 = await state();
  await press(9); // Start = pause
  const st2 = await state();
  console.log('pad:', JSON.stringify({ menuToRun: st0.mode, phase: st1.phase, kmh: Math.round(st1.kmh), stickRightDx: +(st1.x - x0).toFixed(2), startPauses: st2.mode }));
}

if (scenario.startsWith('perf')) {
  if (mobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const track = process.env.TRACK || 'couloir-noir';
  await page.evaluate((t) => { window.__sillage.load(t); }, track);
  await page.evaluate(() => window.__sillage.autopilot(65));
  const samples = [];
  let maxBuild = 0;
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const st = await state();
    samples.push(st.fps);
    maxBuild = Math.max(maxBuild, st.buildMs);
  }
  console.log(JSON.stringify({ track, lastChunkBuildMsMax: +maxBuild.toFixed(1) }));
  const st = await state();
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(JSON.stringify({ scenario, avgFps: +avg.toFixed(1), minFps: +Math.min(...samples).toFixed(1), calls: st.calls, tris: st.tris, z: Math.round(st.z) }));
  await shot(`perf-${mobile ? 'mobile' : 'desktop'}`);
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
