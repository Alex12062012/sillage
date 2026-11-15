// Close-up of the player's skier, from the front: node scripts/hero-shot.mjs <out.jpg> <low|medium|high> (needs build:test + preview)
import { chromium } from '@playwright/test';
const [out, quality] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript((q) => {
  localStorage.setItem('sillage.tutorial', 'done-2');
  localStorage.setItem('sillage.save.v1', JSON.stringify({ version: 1, medals: {}, records: {}, outfit: 'ember', seenHint: true, settings: { quality: q, volume: 0, music: false } }));
}, quality);
const p = await ctx.newPage();
await p.goto('http://localhost:4180/?station=rousses');
await p.waitForFunction(() => !!window.__sillage?.raw().mountain, null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.evaluate(() => {
  const api = window.__sillage;
  api.autopilot(null);
  api.spot(-1619, -514, 0); // facing south (+z)
  api.drive({ brake: true });
  document.getElementById('ui').style.visibility = 'hidden';
  api.time(0.68);
});
await p.waitForTimeout(2500);
await p.evaluate(() => {
  // the camera 5 m in front of where the skier really stands, a little to the side, looking back at them
  const api = window.__sillage, s = api.state(), fx = Math.sin(s.heading), fz = Math.cos(s.heading);
  const x = s.x + fx * 4.6 + fz * 1.6, z = s.z + fz * 4.6 - fx * 1.6;
  const yaw = (Math.atan2(s.x - x, s.z - z) * 180) / Math.PI;
  api.photo({ x, z, up: 1.0, yaw, pitch: -4, fov: 30 });
});
await p.waitForTimeout(600);
await p.evaluate(() => window.__sillage.time(0.68));
await p.waitForTimeout(150);
await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
await b.close();
