import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Headless Chromium acks mouseMoved and mousePressed, then never returns from
// Input.dispatchMouseEvent mouseReleased. The button is already visible, enabled,
// stable, and the hit target. Both the fixture page and the app frame stop
// answering evaluate while that command is in flight, so the click sits in
// "performing click action" until the test timeout. The headless shell turns
// --allow-pre-commit-input back on itself, which is the path that waits. After
// the same actionability and hit-target checks, deliver the click on the element.
const require = createRequire(import.meta.url);
const dom = require(join(dirname(fileURLToPath(import.meta.url)), '../node_modules/playwright-core/lib/server/dom.js'));
if (!dom.ElementHandle.prototype.deliverClickOnElement) {
  const pointerClick = dom.ElementHandle.prototype._click;
  dom.ElementHandle.prototype._click = function(progress, options) {
    const plain = !options.trial && !(options.modifiers && options.modifiers.length) && (!options.button || options.button === 'left') && !options.position && (!options.clickCount || options.clickCount === 1);
    if (!plain) return pointerClick.call(this, progress, options);
    return this._retryPointerAction(progress, 'click', true, async () => {
      await this.evaluate(node => {
        if (typeof node.click !== 'function') throw new Error('Element has no click method');
        node.click();
      });
    }, options);
  };
  dom.ElementHandle.prototype.deliverClickOnElement = true;
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.mjs',
  fullyParallel: true,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'desktop-1024', use: { browserName: 'chromium', viewport: { width: 1024, height: 900 } } },
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
