// The colliders (red, test build's debug API) over the models, 6 views: node scripts/collider-shots.mjs <outDir>
// Needs `npm run build:test && npm run preview`.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'docs/captures/colliders';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('sillage.tutorial', 'done-2');
  localStorage.setItem('sillage.save.v1', JSON.stringify({ version: 1, medals: {}, records: {}, outfit: 'ember', seenHint: true, settings: { quality: 'medium', volume: 0, music: false } }));
});
const p = await ctx.newPage();
await p.goto('http://localhost:4180/?station=rousses&portal=http://127.0.0.1:9');
await p.waitForFunction(() => !!window.__sillage?.raw().mountain, null, { timeout: 60000 });
await p.waitForTimeout(1500);
// targets: the first of each kind near the village (the foot of the Jouvenceaux)
const targets = await p.evaluate(() => {
  const m = window.__sillage.raw().mountain, home = { x: -1549, z: -1710 };
  const near = (list) => list.sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
  const obs = m.obstaclesBetween(-1e5, 1e5);
  const terrace = m.restos.filter((r) => r.terrace);
  return {
    trees: near(obs.filter((o) => o.kind === 'tree' && o.h < 25)),
    building: near(obs.filter((o) => o.kind === 'building' && o.box && o.box.hx < 12)),
    station: near(obs.filter((o) => o.kind === 'station')),
    resto: near(terrace.map((r) => { const sp = m.restoSpot(m.restos.indexOf(r)); return { x: r.x, z: r.z, name: r.name, sp }; })),
    net: ((q) => q && { x: (q.x + q.x2) / 2, z: (q.z + q.z2) / 2 })(near(m.equipment.filter((q) => q.kind === 'net'))),
    groomer: near(m.equipment.filter((q) => q.kind === 'groomer')),
  };
});
for (const [name, t] of Object.entries(targets)) {
  if (!t) { console.log(name, 'none'); continue; }
  const dist = { trees: 16, building: 30, station: 26, resto: 32, net: 16, groomer: 14 }[name];
  await p.evaluate(({ t, dist }) => {
    const api = window.__sillage;
    api.spot(t.x + 60, t.z + 60, 0); // the skier out of the way
    api.drive({ brake: true });
    // from the downhill side, aimed at the target's foot + 1.5 m
    const m = api.raw().mountain, cands = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([a, b]) => [t.x + a * dist * 0.7, t.z + b * dist * 0.7]);
    if (t.sp) { // a restaurant: from the snow in front of its sign, 12 m back, facing it
      const fx = Math.sin(t.sp.heading), fz = Math.cos(t.sp.heading), cx = t.sp.x - fx * 12, cz = t.sp.z - fz * 12;
      api.photo({ x: cx, z: cz, up: 5, yaw: (t.sp.heading * 180) / Math.PI, pitch: -10, fov: 60 });
      document.getElementById('ui').style.visibility = 'hidden';
      api.time(0.6);
      return;
    }
    const free = cands.filter(([x, z]) => m.obstaclesNear(x, z, 4, []).length === 0); // not inside a building
    const [cx, cz] = (free.length ? free : cands).sort((a, b) => m.height(a[0], a[1]) - m.height(b[0], b[1]))[0];
    const up = 2 + dist * 0.25, dy = m.height(t.x, t.z) + 1.5 - (m.height(cx, cz) + up);
    api.photo({ x: cx, z: cz, up, yaw: (Math.atan2(t.x - cx, t.z - cz) * 180) / Math.PI, pitch: (Math.atan2(dy, Math.hypot(t.x - cx, t.z - cz)) * 180) / Math.PI, fov: 50 });
    document.getElementById('ui').style.visibility = 'hidden';
    api.time(0.6);
  }, { t, dist });
  await p.waitForTimeout(1800);
  const n = await p.evaluate((t) => window.__sillage.colliders({ x: t.x, z: t.z, radius: 45 }), t);
  await p.evaluate(() => window.__sillage.time(0.6));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 80 });
  console.log(name, Math.round(t.x), Math.round(t.z), `${n} segments`);
}
await b.close();
