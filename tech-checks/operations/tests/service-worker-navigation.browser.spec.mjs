import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const workerSource = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
const scopes = ['/', '/neon-oasis-game/tech-checks/'];

for (const scope of scopes) {
  test(`service worker preserves iframe retry route, cache and HTTP errors at ${scope}`, async ({ page, context }, testInfo) => {
    let mode = 'unavailable';
    const requests = [];
    const targetPath = `${scope}operations/dist/index.html`;
    const targetSuffix = `${targetPath}?v=fixture#field-map?unitLabel=fixture-unit`;
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://fixture.test');
      requests.push({ method: req.method, path: url.pathname, cookie: req.headers.cookie || '' });
      if (url.pathname === `${scope}sw.js`) {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        return res.end(workerSource);
      }
      if (url.pathname === targetPath) {
        if (mode === 'unavailable') return req.socket.destroy();
        if (mode === 'forbidden') {
          res.writeHead(403, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          return res.end('<h1>HTTP 403 fixture from server</h1>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end('<h1>Fixture live workspace</h1><p>Fixture field unit</p>');
      }
      if (url.pathname.endsWith('.js')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end('/* Isolated offline-navigation fixture; no application or auth code. */');
      }
      if (url.pathname.endsWith('.css')) {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        return res.end('');
      }
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      if (url.pathname === `${scope}fixture-parent.html`) {
        return res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}h1{font:16px system-ui;margin:8px}iframe{width:100%;height:calc(100vh - 42px);border:0}</style><h1>Fixture parent remains open</h1><iframe title="Fixture Operations" src="${targetSuffix}"></iframe>`);
      }
      return res.end('<h1>Fixture cached host shell</h1>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const appRoot = origin + scope;
    try {
      await context.addCookies([{ name: 'fixture-session', value: 'unchanged-fixture', url: origin, httpOnly: true, sameSite: 'Strict' }]);
      await page.goto(`${appRoot}fixture-setup.html`);
      // The only service worker inspected or registered is this local isolated fixture.
      await page.evaluate(async scope => {
        await navigator.serviceWorker.register(scope + 'sw.js', { scope });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        }
      }, scope);
      await page.goto(`${appRoot}fixture-parent.html`);
      const frame = page.frameLocator('iframe[title="Fixture Operations"]');
      await expect(frame.getByRole('heading', { name: "Workspace couldn't load" })).toBeVisible();
      await expect(frame.getByText('This page load does not tell us whether any camera or unit is online.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Fixture parent remains open' })).toBeVisible();
      const iframeUrl = () => page.frames().find(item => item.url().includes(targetPath))?.url();
      expect(iframeUrl()).toBe(origin + targetSuffix);
      await page.screenshot({ path: testInfo.outputPath('offline-iframe.png'), fullPage: true });
      for (let retry = 0; retry < 2; retry++) {
        await frame.getByRole('button', { name: 'Try again' }).click();
        await expect(frame.getByRole('heading', { name: "Workspace couldn't load" })).toBeVisible();
        expect(iframeUrl()).toBe(origin + targetSuffix);
        await expect(page.getByRole('heading', { name: 'Fixture parent remains open' })).toBeVisible();
      }
      mode = 'live';
      await frame.getByRole('button', { name: 'Try again' }).click();
      await expect(frame.getByRole('heading', { name: 'Fixture live workspace' })).toBeVisible();
      expect(iframeUrl()).toBe(origin + targetSuffix);
      mode = 'unavailable';
      await page.reload();
      await expect(frame.getByRole('heading', { name: 'Fixture live workspace' })).toBeVisible();
      mode = 'forbidden';
      await page.reload();
      await expect(frame.getByRole('heading', { name: 'HTTP 403 fixture from server' })).toBeVisible();
      await expect(frame.getByRole('heading', { name: 'Fixture live workspace' })).toHaveCount(0);
      expect((await context.cookies(origin)).find(cookie => cookie.name === 'fixture-session')?.value).toBe('unchanged-fixture');
      expect(requests.every(request => request.method === 'GET')).toBe(true);
      expect(requests.filter(request => request.path === targetPath).every(request => request.cookie.includes('fixture-session=unchanged-fixture'))).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
