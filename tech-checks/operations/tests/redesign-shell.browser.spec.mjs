import {test, expect} from '@playwright/test';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(resolve(here, 'fixtures/cos-redesign-mockup', name), 'utf8');
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const artifacts = '/opt/cursor/artifacts';
const faces = `
@font-face{font-family:Inter;font-style:normal;font-weight:500 800;font-display:swap;src:url(/redesign/fonts/inter-latin.woff2) format("woff2")}
@font-face{font-family:"Inter Tight";font-style:normal;font-weight:500 800;font-display:swap;src:url(/redesign/fonts/inter-tight-latin.woff2) format("woff2")}
`;
const screens = [
  ['fleet', 'desktop', 1440, 900],
  ['fleet', 'phone', 390, 844],
  ['fleet', 'desktop', 1920, 1080],
  ['problems', 'desktop', 1440, 900],
  ['problems', 'phone', 390, 844],
  ['units', 'desktop', 1440, 900],
  ['units', 'phone', 390, 844],
  ['team', 'desktop', 1440, 900],
  ['team', 'phone', 390, 844],
  ['details', 'desktop', 1440, 900],
  ['details', 'phone', 390, 844],
  ['more', 'phone', 390, 844],
];

function host(src, role) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#060a11}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="Fleet shell" src="${src}"></iframe><script>
    addEventListener('message',event=>{
      if(event.origin!==location.origin||!event.data||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;
      event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:'${role}',accessToken:'synthetic-shell-only'},location.origin);
    });
  </script></body></html>`;
}

async function install(page, {role = 'Owner', parent = 'owner', name = 'James Martin', authorized = true} = {}) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/shell-host') {
      const src = url.searchParams.get('src');
      const parentRole = url.searchParams.get('parent') || parent;
      return route.fulfill({contentType: 'text/html', body: host(src, parentRole)});
    }
    if (url.origin === origin && url.pathname.startsWith('/mockup/')) {
      const file = url.pathname.slice('/mockup/'.length);
      if (file === 'app.css') return route.fulfill({contentType: 'text/css', body: faces + fixture('app.css')});
      if (file === 'app.js') return route.fulfill({contentType: 'text/javascript', body: fixture('app.js')});
      if (file === 'index.html') return route.fulfill({contentType: 'text/html', body: fixture('index.html')});
      return route.abort();
    }
    if (url.origin === origin) return route.continue();
    if (url.href !== edge) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const request = route.request().postDataJSON();
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/api/session');
    const data = request.path === '/api/session' ? {authorized, role, name, legacyOwner: role === 'Owner'} : {items: []};
    return route.fulfill({headers, contentType: 'application/json', body: JSON.stringify(data)});
  });
}

async function openShell(page, src) {
  await page.goto('/shell-host?src=' + encodeURIComponent(src));
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveAttribute('data-shell', 'office');
  await frame.locator('html').evaluate(() => document.fonts.ready);
  return frame;
}

async function pixels(page, left, right) {
  return page.evaluate(async ({left, right}) => {
    const load = b64 => new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.src = 'data:image/png;base64,' + b64; });
    const [a, b] = await Promise.all([load(left), load(right)]);
    const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(a, 0, 0);
    const da = ctx.getImageData(0, 0, a.width, a.height);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(b, 0, 0);
    const db = ctx.getImageData(0, 0, b.width, b.height);
    const out = ctx.createImageData(w, h);
    let mismatch = 0;
    const total = w * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ia = y < a.height && x < a.width ? (y * a.width + x) * 4 : -1;
      const ib = y < b.height && x < b.width ? (y * b.width + x) * 4 : -1;
      const dr = ia < 0 || ib < 0 ? 255 : Math.abs(da.data[ia] - db.data[ib]) + Math.abs(da.data[ia + 1] - db.data[ib + 1]) + Math.abs(da.data[ia + 2] - db.data[ib + 2]);
      if (dr > 18) {
        mismatch++;
        out.data[i] = 255; out.data[i + 1] = 40; out.data[i + 2] = 40; out.data[i + 3] = 255;
      } else {
        const p = ia < 0 ? ib : ia;
        const src = ia < 0 ? db : da;
        out.data[i] = src.data[p]; out.data[i + 1] = src.data[p + 1]; out.data[i + 2] = src.data[p + 2]; out.data[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    const side = document.createElement('canvas');
    side.width = w * 2 + 8; side.height = h;
    const sx = side.getContext('2d');
    sx.fillStyle = '#111'; sx.fillRect(0, 0, side.width, side.height);
    sx.drawImage(a, 0, 0); sx.drawImage(b, w + 8, 0);
    return {mismatch, total, pct: Math.round(mismatch / total * 10000) / 100, diff: canvas.toDataURL('image/png'), side: side.toDataURL('image/png')};
  }, {left, right});
}

test('owner and IT see the approved shell, a tech does not, and the phone fleet does not scroll', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Sizes are set inside this test');
  test.setTimeout(180000);
  mkdirSync(artifacts, {recursive: true});
  await install(page);
  const frame = await openShell(page, '/redesign/index.html?s=fleet&d=desktop');
  await expect(frame.getByRole('navigation', {name: 'Fleet'})).toBeVisible();
  const desktop = ['Fleet', 'Problems', 'Units', 'Boards', 'Team', 'Details', 'TV board'];
  await expect(frame.locator('aside a.nav')).toHaveText(desktop.map(name => name === 'Problems' ? 'Problems6' : name));
  await expect(frame.locator('a.nav', {hasText: 'Boards'})).toHaveAttribute('href', '/#daily-board');
  await expect(frame.locator('a.nav', {hasText: 'TV board'})).toHaveAttribute('href', '/?tvBoard=1#daily-board');
  await expect(frame.locator('.me b')).toHaveText('James M.');

  await page.setViewportSize({width: 390, height: 844});
  const phone = await openShell(page, '/redesign/index.html?s=fleet');
  await expect(phone.locator('a.tab')).toHaveCount(5);
  await expect(phone.locator('a.tab')).toHaveText(['Fleet', 'Problems6', 'Units', 'Boards', 'More']);
  const scroll = await phone.locator('html').evaluate(() => ({scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight, y: scrollY}));
  expect(scroll.y).toBe(0);
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client + 1);

  await page.setViewportSize({width: 1440, height: 900});
  await install(page, {role: 'IT', parent: 'it', name: 'Riley K'});
  await page.goto('/shell-host?parent=it&src=' + encodeURIComponent('/redesign/index.html?s=fleet&d=desktop'));
  const itFrame = page.frameLocator('iframe');
  await expect(itFrame.locator('html')).toHaveAttribute('data-shell', 'office');
  await expect(itFrame.locator('.me small')).toHaveText('IT');
  await expect(itFrame.locator('aside a.nav')).toHaveCount(7);

  await install(page, {role: 'Service', parent: 'service', name: 'Alex R', authorized: true});
  await page.goto('/shell-host?parent=service&src=' + encodeURIComponent('/redesign/index.html?s=fleet&d=phone'));
  const tech = page.frameLocator('iframe');
  await expect(tech.locator('html')).toHaveAttribute('data-shell', 'denied');
  await expect(tech.locator('a,button')).toHaveCount(0);
  for (const label of ['Fleet', 'Problems', 'Units', 'Boards', 'Team', 'Details', 'More', 'TV board']) {
    await expect(tech.getByText(label, {exact: true})).toHaveCount(0);
  }
});

test('built screens match the approved mockup render', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Sizes are set inside this test');
  test.setTimeout(240000);
  mkdirSync(artifacts, {recursive: true});
  await install(page);
  const report = [];
  for (const [screen, device, width, height] of screens) {
    await page.setViewportSize({width, height});
    const query = `s=${screen}&d=${device}`;
    const built = await openShell(page, `/redesign/index.html?${query}`);
    await built.locator('.shell, .ph').first().waitFor();
    const builtShot = await page.locator('iframe').screenshot();
    const targets = await built.locator('a.nav, a.tab, a.prow').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {text: node.innerText.replace(/\s+/g, ' ').trim().slice(0, 48), width: Math.round(box.width), height: Math.round(box.height)};
    }));
    await page.goto('/shell-host?src=' + encodeURIComponent(`/mockup/index.html?${query}`));
    const mock = page.frameLocator('iframe');
    await mock.locator('.shell, .ph').first().waitFor();
    await mock.locator('html').evaluate(() => document.fonts.ready);
    const mockShot = await page.locator('iframe').screenshot();
    const diff = await pixels(page, mockShot.toString('base64'), builtShot.toString('base64'));
    const stem = `shell_${screen}_${device}_${width}x${height}`;
    writeFileSync(`${artifacts}/${stem}_built.png`, builtShot);
    writeFileSync(`${artifacts}/${stem}_mockup.png`, mockShot);
    writeFileSync(`${artifacts}/${stem}_side.png`, Buffer.from(diff.side.split(',')[1], 'base64'));
    writeFileSync(`${artifacts}/${stem}_diff.png`, Buffer.from(diff.diff.split(',')[1], 'base64'));
    report.push({screen, device, width, height, pct: diff.pct, targets});
    expect(diff.pct, stem).toBe(0);
  }
  writeFileSync(`${artifacts}/shell_pixel_report.json`, JSON.stringify(report, null, 2));
});
