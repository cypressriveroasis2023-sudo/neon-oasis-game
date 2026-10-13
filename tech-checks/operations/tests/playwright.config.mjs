import { defineConfig } from '@playwright/test';
const origin=process.env.COS_OPERATIONS_BROWSER_ORIGIN||'http://127.0.0.1:4173';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Browser tests require an isolated loopback origin');

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.mjs',
  fullyParallel: true,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'desktop-1024', use: { browserName: 'chromium', viewport: { width: 1024, height: 900 } } },
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port '+new URL(origin).port+' --strictPort',
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
