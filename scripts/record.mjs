// Records a short gameplay clip (Playwright video) for the README GIF.
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';

const out = 'docs/media/_raw';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, recordVideo: { dir: out, size: { width: 960, height: 540 } } });
const page = await context.newPage();
await page.goto(process.argv[2] ?? 'http://localhost:4180/');
await page.waitForFunction(() => !!window.__sillage);
const k = await page.evaluate(() => { window.__sillage.play('couloir-noir'); return window.__sillage.features().find((f) => f.type === 'kicker'); });
await page.evaluate((z) => { window.__sillage.teleport(z, 55); window.__sillage.autopilot(68, 1.2); }, k.z0 - 70);
await page.waitForTimeout(11000);
await context.close();
const f = readdirSync(out).find((n) => n.endsWith('.webm'));
renameSync(`${out}/${f}`, 'docs/media/_clip.webm');
await browser.close();
console.log('recorded docs/media/_clip.webm');
