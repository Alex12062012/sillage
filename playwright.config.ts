import { defineConfig, devices } from '@playwright/test';

const gpu = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:4180',
    trace: 'retain-on-failure',
    launchOptions: { args: gpu },
  },
  webServer: process.env.E2E_URL
    ? undefined
    : { command: 'npm run build && npm run preview', url: 'http://localhost:4180', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
