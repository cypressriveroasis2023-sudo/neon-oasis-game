import {defineConfig} from '@playwright/test';
// Watchful setup check on a phone-sized screen, against the real rules in an in-memory database.
export default defineConfig({testDir: '.', testMatch: ['watchful-setup.browser.spec.mjs'], timeout: 60000, expect: {timeout: 10000},
  fullyParallel: false, workers: 1, retries: 0, reporter: [['list']], outputDir: '../test-results-watchful',
  use: {trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: {width: 390, height: 844}, browserName: 'chromium',
    launchOptions: process.env.COS_TEST_CHROMIUM ? {executablePath: process.env.COS_TEST_CHROMIUM} : undefined}});
