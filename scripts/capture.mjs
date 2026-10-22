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
await page.waitForFunction(() => !!window.__sillage, null, { timeout: 15000 });
await wait(800);

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

console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
