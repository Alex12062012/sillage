// FPS / draw calls / triangles / JS heap / GPU objects on the production build, per graphics tier, for PERF.md.
// Usage: node scripts/perf.mjs [--url=http://localhost:4180/] [--tiers=low,medium,high] [--profiles=desktop,mobile,lowend]
//        [--scenes=rousses,village,avoriaz,arcade] [--seconds=10] [--json=out.json]
// Needs `npm run preview`. "mobile" = Pixel 7 viewport and DPR, CPU throttled ×4 (Lighthouse's mid-range phone);
// "lowend" = the same at ×6. The GPU is NOT throttled: see docs/PERF.md for what that leaves unverified.
import { chromium, devices } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const url = opt('url', 'http://localhost:4180/');
const tiers = opt('tiers', 'low,medium,high').split(',');
const seconds = Number(opt('seconds', '10'));
const pixel = { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } };
const PROFILES = {
  desktop: { name: 'desktop 1280×720', ctx: { viewport: { width: 1280, height: 720 } }, cpu: 1 },
  mobile: { name: 'mobile Pixel 7, CPU ×4', ctx: pixel, cpu: 4 },
  lowend: { name: 'mobile Pixel 7, CPU ×6', ctx: pixel, cpu: 6 },
};
/** Each scene: the page to open and what the bot does there. */
const SCENES = {
  // Les Rousses, down the Jouvenceaux pistes into the village: forest, lifts, crowd, buildings
  rousses: { q: '?station=rousses', run: () => { const a = window.__sillage, g = a.raw(); g.unload(g.mountain.unload(9)); g.phase = 'running'; a.autopilot(60); } },
  // standing in the village at the foot of the lifts, looking at it (the densest view of buildings and people)
  village: { q: '?station=rousses', run: () => { const a = window.__sillage; a.spot(-1549.5, -1710.5, 2.36); a.drive({ brake: true }); } },
  avoriaz: { q: '?station=avoriaz', run: () => { const a = window.__sillage, g = a.raw(); g.toSummit(); a.autopilot(60); } },
  arcade: { q: '', run: () => { const a = window.__sillage; a.play('couloir-noir'); a.autopilot(65); } },
};
const profiles = opt('profiles', 'desktop,mobile').split(',').map((p) => PROFILES[p]);
const scenes = opt('scenes', 'rousses,village,arcade').split(',');

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const rows = [];
for (const p of profiles) {
  for (const tier of tiers) {
    for (const sc of scenes) {
      // one retry: a headless tab sometimes stalls on its first frame
      for (let attempt = 0; attempt < 2; attempt++) {
        const context = await browser.newContext(p.ctx);
        try {
          await context.addInitScript((q) => {
            localStorage.setItem('sillage.save.v1', JSON.stringify({ version: 1, medals: {}, records: {}, outfit: 'ember', seenHint: true, settings: { quality: q, volume: 0, music: false } }));
          }, tier);
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          const t0 = Date.now();
          await page.goto(url + SCENES[sc].q);
          await page.waitForFunction(() => !!window.__sillage, null, { timeout: 45000 });
          await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 45000 });
          const loadMs = Date.now() - t0;
          if (p.cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
          await page.evaluate(SCENES[sc].run);
          await page.waitForTimeout(3000); // settle: shaders compiled, patches built, adaptive resolution found its level
          const m = await page.evaluate(async (secs) => {
            const times = [];
            let last = performance.now();
            await new Promise((resolve) => {
              const t0 = last;
              const tick = (now) => {
                times.push(now - last);
                last = now;
                if (now - t0 < secs * 1000) requestAnimationFrame(tick); else resolve();
              };
              requestAnimationFrame(tick);
            });
            times.sort((a, b) => a - b);
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            const st = window.__sillage.state();
            const info = window.__sillage.raw().renderer.info;
            return {
              fps: 1000 / avg, p95: 1000 / times[Math.floor(times.length * 0.95)], p99: 1000 / times[Math.floor(times.length * 0.99)], worstMs: times[times.length - 1],
              calls: st.calls, tris: st.tris, dpr: st.dpr, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0,
              geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
              resolved: window.__sillage.tier?.() ?? null,
            };
          }, seconds);
          rows.push({ profile: p.name, tier, scene: sc, loadMs, ...m, errors: errors.length });
          console.log(JSON.stringify(rows[rows.length - 1], (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
          if (errors.length) console.log('  PAGE ERRORS:', errors.slice(0, 3).join(' | '));
          attempt = 2;
        } catch (e) {
          console.log(`  ${sc} ${tier} ${p.name}: ${String(e).split('\n')[0]}${attempt ? '' : ' (retrying)'}`);
        }
        await context.close();
      }
    }
  }
}
console.log('\n| Profil | Palier | Scène | FPS moyen | FPS p95 | FPS p99 | Draw calls | Triangles | Heap JS (Mo) | Géométries / textures | DPR | Chargement (ms) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.profile} | ${r.tier} | ${r.scene} | ${r.fps.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.calls} | ${Math.round(r.tris / 1000)} k | ${r.heap.toFixed(0)} | ${r.geometries} / ${r.textures} | ${r.dpr.toFixed(2)} | ${r.loadMs} |`);
}
const json = opt('json', '');
if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
await browser.close();
