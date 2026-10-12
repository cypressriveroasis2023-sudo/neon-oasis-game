import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

const origin = 'http://127.0.0.1:4193';
process.env.COS_IT_DAILY_TEST_ORIGIN = origin;
export default defineConfig({
  ...base,
  testMatch: 'it-daily-mode.browser.spec.mjs',
  workers: 3,
  reporter: [['list']],
  outputDir: '../test-results-it-daily',
  use: {...base.use, baseURL: origin},
  webServer: {...base.webServer, command: 'npm run preview -- --host 127.0.0.1 --port 4193 --strictPort', url: origin},
});
