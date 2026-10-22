/** Regressions found by the pre-release review (docs/DECISIONS.md, Phase 6). Desktop only. */
import { expect, test, type Page } from '@playwright/test';

type Api = {
  state(): { phase: string; mode: string; finished: boolean; menu: string | null };
  teleport(z: number, kmh: number): void;
  save(): { records: Record<string, { bestTime: number | null }> };
  results(): boolean;
};
const api = <T>(page: Page, fn: (a: Api) => T) => page.evaluate(`(${fn.toString()})(window.__sillage)`) as Promise<T>;

test.skip(({ isMobile }) => isMobile, 'keyboard / gamepad flows');

let errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // a standard-mapping gamepad the test can press through window.__pad
  await page.addInitScript(() => {
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __sillage?: unknown }).__sillage);
});
test.afterEach(() => expect(errors).toEqual([]));

const press = async (page: Page, button: number) => {
  await page.evaluate((b) => { (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[b] = { pressed: true, value: 1 }; }, button);
  await page.waitForTimeout(150);
  await page.evaluate((b) => { (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[b] = { pressed: false, value: 0 }; }, button);
  await page.waitForTimeout(150);
};

async function finishRun(page: Page) {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  await api(page, (a) => a.teleport(1085, 45));
}

test('retrying during the finish run-out still saves the finished run', async ({ page }) => {
  await finishRun(page);
  await expect.poll(() => api(page, (a) => a.state().finished), { timeout: 20_000 }).toBe(true);
  expect(await api(page, (a) => a.results())).toBe(false); // still in the 1.3 s run-out
  await page.keyboard.press('KeyR');
  const rec = (await api(page, (a) => a.save())).records['combe-douce'];
  expect(rec?.bestTime ?? null).not.toBeNull();
});

test('gamepad A on Retry starts a clean new run (no instant "record")', async ({ page }) => {
  await finishRun(page);
  await expect.poll(() => api(page, (a) => a.results()), { timeout: 20_000 }).toBe(true);
  const best = (await api(page, (a) => a.save())).records['combe-douce'].bestTime!;
  await press(page, 0); // A on the focused Retry
  await page.waitForTimeout(1800);
  const st = await api(page, (a) => a.state());
  expect(st.finished).toBe(false);
  expect(await api(page, (a) => a.results())).toBe(false);
  expect((await api(page, (a) => a.save())).records['combe-douce'].bestTime).toBe(best);
});

test('a gamepad can pause and resume', async ({ page }) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.locator('[data-run="combe-douce"]').click();
  await press(page, 7); // RT drops in
  await press(page, 9); // Start
  expect((await api(page, (a) => a.state())).mode).toBe('paused');
  await press(page, 0); // A on the focused Resume
  expect((await api(page, (a) => a.state())).mode).toBe('run');
});

test('Enter on a focused results button activates that button, not Retry', async ({ page }) => {
  await finishRun(page);
  await expect.poll(() => api(page, (a) => a.results()), { timeout: 20_000 }).toBe(true);
  await page.getByRole('button', { name: 'Menu' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect((await api(page, (a) => a.state())).mode).toBe('attract');
});
