import { expect, test, type Frame } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'keyboard in an iframe');

type State = { track: string; mode: string; menu: string | null; kmh: number };
const state = (f: Frame) => f.evaluate(() => (window as unknown as { __sillage: { state(): State } }).__sillage.state());

test('?station=rousses&embed=1: straight into Les Rousses inside a resort website', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent(`<!doctype html><body style="margin:0"><h1>Station des Rousses</h1>
    <iframe src="${baseURL}/?station=rousses&embed=1" style="width:1000px;height:600px;border:0" allow="autoplay; fullscreen; gamepad"></iframe></body>`);
  const frame = page.frames().find((f) => f.url().includes('embed=1'))!;
  await frame.waitForFunction(() => !!(window as unknown as { __sillage?: unknown }).__sillage, null, { timeout: 30_000 });
  await expect.poll(async () => (await state(frame)).mode, { timeout: 20_000 }).toBe('run');
  const s = await state(frame);
  expect(s.track).toBe('free');
  expect(s.menu).toBeNull();
  await page.locator('iframe').click({ position: { x: 500, y: 300 } });
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await state(frame)).kmh, { timeout: 20_000 }).toBeGreaterThan(5); // slow under a loaded CI
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape');
  const pause = frame.locator('.menu');
  await expect(pause.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(pause.getByRole('button', { name: /Quit/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
