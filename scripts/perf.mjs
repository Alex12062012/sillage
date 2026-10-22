// FPS / draw calls / triangles / chunk build time / JS heap on the production build, for PERF.md.
// Usage: node scripts/perf.mjs [url]   (expects `npm run preview` on :4180 by default)
import { chromium, devices } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4180/';
const tracks = ['combe-douce', 'crete-du-loup', 'couloir-noir'];
const profiles = [
  { name: 'desktop 1280×720', ctx: { viewport: { width: 1280, height: 720 } }, cpu: 1 },
  { name: 'mobile Pixel 7, CPU ×4', ctx: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } }, cpu: 4 },
  { name: 'low-end stress, CPU ×6', ctx: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } }, cpu: 6 },
];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const rows = [];
for (const p of profiles) {
  for (const t of tracks) {
    const context = await browser.newContext(p.ctx);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => !!window.__sillage);
    if (p.cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    await page.evaluate((id) => { window.__sillage.play(id); window.__sillage.autopilot(65); }, t);
    // measure real frame times in the page for 15 s of autopilot descent
    const m = await page.evaluate(async () => {
      const times = [];
      let last = performance.now();
      let maxBuild = 0;
      await new Promise((resolve) => {
        const t0 = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          maxBuild = Math.max(maxBuild, window.__sillage.state().buildMs);
          if (now - t0 < 15000) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times[Math.floor(times.length * 0.95)];
      const st = window.__sillage.state();
      const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
      return { fps: 1000 / avg, p95fps: 1000 / p95, calls: st.calls, tris: st.tris, maxBuild, heap, dpr: st.dpr, z: st.z };
    });
    rows.push({ profile: p.name, track: t, ...m, errors: errors.length });
    console.log(JSON.stringify(rows[rows.length - 1], (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
    await context.close();
  }
}
console.log('\n| Profil | Piste | FPS moyen | FPS p95 (frames lentes) | Draw calls | Triangles | Chunk max (ms) | Heap JS (Mo) | DPR final |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.profile} | ${r.track} | ${r.fps.toFixed(1)} | ${r.p95fps.toFixed(1)} | ${r.calls} | ${Math.round(r.tris / 1000)} k | ${r.maxBuild.toFixed(1)} | ${r.heap.toFixed(0)} | ${r.dpr.toFixed(2)} |`);
}
await browser.close();
