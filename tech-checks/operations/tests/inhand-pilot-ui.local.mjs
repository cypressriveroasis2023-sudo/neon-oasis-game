import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cases } from './fixtures/inhand-pilot-local-cases.mjs';
const spec = new URL('./inhand-pilot-ui.browser.spec.mjs', import.meta.url);
const source = (await readFile(spec, 'utf8'))
  .replace("from '@playwright/test'", "from './fixtures/inhand-pilot-local-cases.mjs'")
  .replace(/from '(\.\/[^']+)'/g, (_, path) => 'from ' + JSON.stringify(new URL(path, spec).href));
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const output = '/tmp/cos-inhand-pilot-ui-direct';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox'] });
let failures = 0, passed = 0;
try {
  for (const width of [390, 1024, 1440]) {
    for (const [index, item] of cases.entries()) {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173', viewport: { width, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const prefix = output + '/' + width + '-' + String(index + 1).padStart(2, '0');
      try { await item.run({ page }, { outputPath: name => prefix + '-' + name }); passed++; console.log('PASS', width, item.name); }
      catch (error) { failures++; console.error('FAIL', width, item.name, error); await page.screenshot({ path: prefix + '-failure.png', fullPage: true }).catch(() => {}); }
      finally { await context.close(); }
    }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed, failures, cases: cases.length, viewports: [390, 1024, 1440], output }));
if (failures) process.exitCode = 1;
