import { expect, test, type Page } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'a sales demo on a laptop');

const api = <T>(page: Page, fn: string) => page.evaluate(`(async (a) => ${fn})(window.__sillage)`) as Promise<T>;
const boot = async (page: Page, url: string) => {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as { __sillage?: unknown }).__sillage, null, { timeout: 30_000 });
  await api<void>(page, "a.play('free')");
};

test('?setup: the station settings, live and exported', async ({ page }) => {
  test.setTimeout(240_000); // the station is built twice
  await boot(page, '/?setup');
  const panel = page.locator('.setup');
  await expect(panel).toBeVisible();
  expect(await api<number>(page, 'a.skiers()')).toBeGreaterThan(20);
  await panel.getByRole('radio', { name: 'Nobody' }).check();
  await expect.poll(() => api<number>(page, 'a.skiers()'), { timeout: 20_000 }).toBe(0);
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export settings' }).click();
  expect((await download).suggestedFilename()).toBe('rousses.config.json');
  await panel.getByRole('radio', { name: /As remembered/ }).click({ noWaitAfter: true }); // the station is rebuilt: the page reloads
  await page.waitForURL(/slopes=memory/);
  await page.waitForFunction(() => !!(window as unknown as { __sillage?: unknown }).__sillage, null, { timeout: 30_000 });
  await api<void>(page, "a.play('free')");
  await expect(page.locator('.setup').getByRole('radio', { name: /As remembered/ })).toBeChecked();
  await expect(page.locator('.setup').getByRole('radio', { name: 'Nobody' })).toBeChecked(); // kept in the URL
});

test('no ?setup: no station settings for visitors', async ({ page }) => {
  await boot(page, '/');
  await expect(page.locator('.setup')).toHaveCount(0);
  await expect(page.locator('.setup-toggle')).toHaveCount(0);
});

test('Settings: the traffic, from an off-season weekday to a peak day', async ({ page }) => {
  await boot(page, '/');
  expect(await api<number>(page, 'a.skiers()')).toBe(315); // an average day at Les Rousses
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  const traffic = page.getByRole('slider', { name: /Traffic/ });
  const ski = async (t: string, n: number) => { // the game waits while its menu is open: they set off on Resume
    await traffic.fill(t);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => api<number>(page, 'a.skiers()'), { timeout: 10_000 }).toBe(n);
  };
  await ski('2.5', 788);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await ski('0.4', 126);
});
