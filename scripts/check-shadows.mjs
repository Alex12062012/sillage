// Checks, without looking at an image, that the sun's shadows are drawn when the sun is low and in the camera's back:
// dark pixels with shadows on vs off, and with the casters behind the camera dropped (keep = 0).
// Usage: node scripts/check-shadows.mjs [--quality=medium] (needs `npm run build:test && npm run preview`)
import { chromium } from '@playwright/test';
const q = (process.argv.find((a) => a.startsWith('--quality=')) ?? '--quality=medium').split('=')[1];
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript((qq) => localStorage.setItem('sillage.save.v1', JSON.stringify({ version: 1, medals: {}, records: {}, outfit: 'ember', seenHint: true, settings: { quality: qq, volume: 0, music: false } })), q);
const p = await ctx.newPage();
await p.goto('http://localhost:4180/?station=rousses');
await p.waitForFunction(() => window.__sillage?.raw().view?.reliefMs > 0, null, { timeout: 60000 });
for (const t of [0.62, 0.72, 0.8]) {
  const r = await p.evaluate(async (t) => {
    const a = window.__sillage, g = a.raw(), v = g.view;
    a.time(t);
    const d = g.sky.sunDirection, az = Math.atan2(d.x, -d.z) * 180 / Math.PI;
    // the tree nearest the start BEHIND the camera: the camera 12 m down-sun of it, looking away from the sun and down
    const s = g.skier.pos, tree = g.mountain.obstaclesBetween(-1e5, 1e5).filter((o) => o.kind === 'tree').sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z))[0];
    const len = Math.hypot(d.x, d.z);
    a.photo({ x: tree.x - (d.x / len) * 12, z: tree.z - (d.z / len) * 12, up: 6, yaw: -az, pitch: -22, fov: 60 });
    const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const shot = async () => { await frames(20); const c = g.renderer.domElement; const x = document.createElement('canvas'); x.width = 240; x.height = 135; const cx = x.getContext('2d'); g.frame(0); cx.drawImage(c, 0, 0, 240, 135); return cx.getImageData(0, 0, 240, 135).data; };
    const on = await shot();
    g.sky.sun.castShadow = false; const off = await shot(); g.sky.sun.castShadow = true;
    const keeps = v.trees.map((tr) => tr.keep); v.trees.forEach((tr) => { tr.keep = 0; tr.dirty = true; }); const front = await shot(); v.trees.forEach((tr, i) => { tr.keep = keeps[i]; tr.dirty = true; });
    const dark = (A, B) => { let n = 0; for (let i = 0; i < A.length; i += 4) if (A[i] + A[i + 1] + A[i + 2] < 0.9 * (B[i] + B[i + 1] + B[i + 2])) n++; return n / (A.length / 4); };
    const behind = v.trees[0].mesh.count;
    return { t, sunUp: Math.asin(d.y) * 180 / Math.PI, az, shadowed: dark(on, off), shadowedWithoutBack: dark(front, off), nearTrees: behind };
  }, t);
  console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
}
await b.close();
