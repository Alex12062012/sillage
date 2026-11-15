// Prints where things stand on a station (lifts, restaurants, spawn, summit, busiest pistes), to pick viewpoints.
// Usage: node scripts/scout.mjs [station id] [url]
import { chromium } from '@playwright/test';

const [station = 'rousses', url = 'http://localhost:4180/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e)));
await page.goto(`${url}?station=${station}`);
await page.waitForFunction(() => !!window.__sillage && window.__sillage.raw().mountain, null, { timeout: 30000 });
const info = await page.evaluate(() => {
  const g = window.__sillage.raw(), m = g.mountain, r = (v) => Math.round(v);
  const pt = { x: 0, z: 0, dx: 0, dz: 0 };
  return {
    bounds: m.bounds, spawn: m.spawn, summit: m.summit,
    grid: [m.grid.nx, m.grid.nz, m.grid.step],
    trees: m.obstaclesBetween(-1e5, 1e5).filter((o) => o.kind === 'tree').length,
    buildings: m.scenery.buildings.length, roads: m.scenery.roads.length,
    lifts: m.lifts.map((l, i) => `${i} ${l.name} ${l.kind}${l.seats} len ${r(l.len)} bottom ${r(l.pts[0])},${r(l.pts[1])} (${r(m.height(l.pts[0], l.pts[1]))} m) top ${r(l.pts[l.pts.length - 2])},${r(l.pts[l.pts.length - 1])} (${r(m.height(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]))} m)`),
    restos: m.restos.map((q, i) => `${i} ${q.name} ${r(q.x)},${r(q.z)} floor ${r(q.floor)} ${q.w}x${q.d} yaw ${q.yaw} sign ${q.signYaw.toFixed(2)}`),
    pistes: m.pistes.filter((p) => !p.area && p.len > 500 && p.name).map((p) => { m.along(p, p.len / 2, pt); return `${p.name} ${p.difficulty} len ${r(p.len)} mid ${r(pt.x)},${r(pt.z)} dir ${Math.round(Math.atan2(pt.dx, pt.dz) * 57.3)}° alt ${r(m.height(pt.x, pt.z))}`; }),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
