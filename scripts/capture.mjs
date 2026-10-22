// Drives the game through window.__sillage, takes screenshots and fails on console errors.
// Usage: node scripts/capture.mjs <scenario> [url] [outDir]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [scenario = 'greybox', url = 'http://localhost:5180/', outDir = 'docs/captures'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const mobile = scenario.endsWith('-mobile');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 720 } });
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

if (scenario.startsWith('perf')) {
  if (mobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.evaluate(() => window.__sillage.autopilot(65));
  const samples = [];
  for (let i = 0; i < 24; i++) {
    await wait(500);
    samples.push((await state()).fps);
  }
  const st = await state();
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(JSON.stringify({ scenario, avgFps: +avg.toFixed(1), minFps: +Math.min(...samples).toFixed(1), calls: st.calls, tris: st.tris, z: Math.round(st.z) }));
  await shot(`perf-${mobile ? 'mobile' : 'desktop'}`);
}

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
