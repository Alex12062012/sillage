import { expect, test, type Page } from '@playwright/test';

/** Typed handle on the in-game debug API (window.__sillage). */
type Api = {
  state(): { phase: string; mode: string; kmh: number; z: number; finished: boolean; menu: string | null };
  drive(o: Record<string, unknown> | null): void;
  restart(): void;
  teleport(z: number, kmh: number): void;
  features(): unknown[];
  save(): { records: Record<string, { bestTime: number | null }>; medals: Record<string, number> };
  results(): boolean;
};
const call = <T>(page: Page, fn: (api: Api) => T) =>
  page.evaluate(`(${fn.toString()})(window.__sillage)`) as Promise<T>;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __sillage?: unknown }).__sillage, null, { timeout: 30_000 });
});

test.afterEach(async () => {
  expect(errors, 'console errors').toEqual([]);
});

test('boots behind a loading screen into the main menu', async ({ page }, info) => {
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.locator('.brand h1')).toHaveText(/sillage/i);
  expect((await call(page, (a) => a.state())).mode).toBe('attract');
  await page.screenshot({ path: `docs/captures/e2e-${info.project.name}-menu.jpg`, type: 'jpeg', quality: 75 });
});

test('a run starts from the menu and answers the controls', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  expect((await call(page, (a) => a.state())).phase).toBe('ready');
  await call(page, (a) => a.drive({ tuck: true }));
  await expect.poll(async () => (await call(page, (a) => a.state())).kmh, { timeout: 20_000 }).toBeGreaterThan(15);
  const st = await call(page, (a) => a.state());
  expect(st.phase).toBe('running');
  expect(st.mode).toBe('run');
  await page.screenshot({ path: `docs/captures/e2e-${info.project.name}-run.jpg`, type: 'jpeg', quality: 75 });
});

test('restart is instant (< 1 s to the next rendered frame)', async ({ page }) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  await call(page, (a) => a.drive({ tuck: true }));
  await expect.poll(async () => (await call(page, (a) => a.state())).z, { timeout: 20_000 }).toBeGreaterThan(20);
  const ms = await page.evaluate(async () => {
    const api = (window as unknown as { __sillage: Api }).__sillage;
    const t0 = performance.now();
    api.restart();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  expect(ms).toBeLessThan(1000);
  const st = await call(page, (a) => a.state());
  expect(st.z).toBeLessThan(0);
});

test('crossing the finish line shows the results and saves the record', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  await call(page, (a) => a.teleport(1080, 40));
  await expect.poll(() => call(page, (a) => a.results()), { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
  const save = await call(page, (a) => a.save());
  expect(save.records['combe-douce']).toBeTruthy();
  await page.screenshot({ path: `docs/captures/e2e-${info.project.name}-results.jpg`, type: 'jpeg', quality: 75 });
  await page.getByRole('button', { name: /Retry/ }).click();
  expect((await call(page, (a) => a.state())).phase).toBe('ready');
});

test('pause and resume keep the run', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  await call(page, (a) => a.drive({ tuck: true }));
  await expect.poll(async () => (await call(page, (a) => a.state())).kmh, { timeout: 20_000 }).toBeGreaterThan(10);
  if (info.project.name === 'mobile') await page.locator('.touch-btn.pause').tap();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const z1 = (await call(page, (a) => a.state())).z;
  await page.waitForTimeout(500);
  expect((await call(page, (a) => a.state())).z).toBeCloseTo(z1, 3);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await call(page, (a) => a.state())).z, { timeout: 10_000 }).toBeGreaterThan(z1 + 1);
});
