import {test, expect} from '@playwright/test';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shellRoot = resolve(here, '../redesign');
const mockRoot = resolve(here, 'fixtures/cos-redesign-mockup');
const shots = resolve(here, '../test-results/redesign-shell');
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'};
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

function fileFrom(root, pathname, prefix) {
  const relative = pathname.slice(prefix.length);
  const path = resolve(root, relative);
  if (!path.startsWith(root + '/') && path !== root) return null;
  return readFileSync(path);
}

function host(src, role) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#060a11}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="Fleet shell" src="${src}"></iframe><script>
    addEventListener('message',event=>{
      if(event.origin!==location.origin||!event.data||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;
      event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:'${role}',accessToken:'synthetic-shell-only'},location.origin);
    });
  </script></body></html>`;
}

async function install(page) {
  const session = {role: 'Owner', parent: 'owner', name: 'James Martin', authorized: true};
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/shell-host') {
      session.role = url.searchParams.get('role') || 'Owner';
      session.parent = url.searchParams.get('parent') || 'owner';
      session.name = url.searchParams.get('name') || 'James Martin';
      session.authorized = url.searchParams.get('authorized') !== '0';
      const src = url.searchParams.get('src');
      return route.fulfill({contentType: 'text/html', body: host(src, session.parent)});
    }
    if (url.origin === origin && url.pathname.startsWith('/tech-checks/operations/redesign/')) {
      const body = fileFrom(shellRoot, url.pathname, '/tech-checks/operations/redesign/');
      return route.fulfill({contentType: types[extname(url.pathname)] || 'application/octet-stream', body});
    }
    // The comparison mockup is the frozen fixture, byte for byte. Nothing is prepended.
    if (url.origin === origin && url.pathname.startsWith('/mockup-original/')) {
      const body = fileFrom(mockRoot, url.pathname, '/mockup-original/');
      return route.fulfill({contentType: types[extname(url.pathname)] || 'application/octet-stream', body});
    }
    if (url.origin === origin) return route.continue();
    if (url.href !== edge) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const request = route.request().postDataJSON();
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/api/session');
    return route.fulfill({headers, contentType: 'application/json', body: JSON.stringify({authorized: session.authorized, role: session.role, name: session.name, legacyOwner: session.role === 'Owner'})});
  });
}

async function openShell(page, query) {
  await page.goto('/shell-host?src=' + encodeURIComponent('/tech-checks/operations/redesign/index.html?' + query));
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
    let mismatch = 0;
    const total = w * h;
    const out = ctx.createImageData(w, h);
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
    side.width = a.width + b.width + 8; side.height = Math.max(a.height, b.height);
    const sx = side.getContext('2d');
    sx.fillStyle = '#111'; sx.fillRect(0, 0, side.width, side.height);
    sx.drawImage(a, 0, 0); sx.drawImage(b, a.width + 8, 0);
    return {mismatch, total, pct: Math.round(mismatch / total * 10000) / 100, width: a.width, height: a.height, builtWidth: b.width, builtHeight: b.height, diff: canvas.toDataURL('image/png'), side: side.toDataURL('image/png')};
  }, {left, right});
}

test('owner and IT see the shell, links resolve, and a tech sees nothing', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Sizes are set inside this test');
  await install(page);
  await page.setViewportSize({width: 1440, height: 900});
  const frame = await openShell(page, 's=fleet&d=desktop');
  const boards = frame.locator('aside a.nav', {hasText: /^Boards/});
  const tv = frame.locator('aside a.nav', {hasText: 'TV board'});
  const boardsUrl = new URL(await boards.evaluate(node => node.href));
  const tvUrl = new URL(await tv.evaluate(node => node.href));
  expect(boardsUrl.pathname).toBe('/tech-checks/operations/dist/index.html');
  expect(boardsUrl.hash).toBe('#daily-board');
  expect(tvUrl.pathname).toBe('/tech-checks/index.html');
  expect(tvUrl.searchParams.get('tvBoard')).toBe('1');
  await expect(frame.locator('.me b')).toHaveText('James M.');

  await page.setViewportSize({width: 390, height: 844});
  const phone = await openShell(page, 's=fleet');
  await expect(phone.locator('a.tab')).toHaveCount(5);
  const scroll = await phone.locator('html').evaluate(() => ({scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight, y: scrollY}));
  expect(scroll.y).toBe(0);
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client + 1);
  const phoneBoards = new URL(await phone.locator('a.tab', {hasText: 'Boards'}).evaluate(node => node.href));
  expect(phoneBoards.pathname).toBe('/tech-checks/operations/dist/index.html');
  expect(phoneBoards.hash).toBe('#daily-board');
  await phone.locator('a.tab', {hasText: 'More'}).click();
  await expect(phone.locator('h1')).toHaveText('More');
  const phoneTv = new URL(await phone.locator('a.prow', {hasText: 'TV board'}).evaluate(node => node.href));
  expect(phoneTv.pathname).toBe('/tech-checks/index.html');
  expect(phoneTv.searchParams.get('tvBoard')).toBe('1');

  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/shell-host?parent=it&role=IT&name=Riley%20K&src=' + encodeURIComponent('/tech-checks/operations/redesign/index.html?s=fleet&d=desktop'));
  const itFrame = page.frameLocator('iframe');
  await expect(itFrame.locator('html')).toHaveAttribute('data-shell', 'office');
  await expect(itFrame.locator('.me small')).toHaveText('IT');

  await page.goto('/shell-host?parent=service&role=Service&name=Alex%20R&src=' + encodeURIComponent('/tech-checks/operations/redesign/index.html?s=fleet&d=phone'));
  const tech = page.frameLocator('iframe');
  await expect(tech.locator('html')).toHaveAttribute('data-shell', 'denied');
  await expect(tech.locator('a,button')).toHaveCount(0);
  for (const label of ['Fleet', 'Problems', 'Units', 'Boards', 'Team', 'Details', 'More', 'TV board']) {
    await expect(tech.getByText(label, {exact: true})).toHaveCount(0);
  }
});

test('built screens are diffed against the unmodified mockup', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Sizes are set inside this test');
  test.setTimeout(240000);
  mkdirSync(shots, {recursive: true});
  await install(page);
  const report = [];
  for (const [screen, device, width, height] of screens) {
    await page.setViewportSize({width, height});
    const query = `s=${screen}&d=${device}`;
    await page.goto('/mockup-original/index.html?' + query);
    await page.locator('.shell, .ph').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const mockShot = await page.screenshot();
    await openShell(page, query);
    const builtShot = await page.locator('iframe').screenshot();
    const diff = await pixels(page, mockShot.toString('base64'), builtShot.toString('base64'));
    const stem = `shell_${screen}_${device}_${width}x${height}`;
    writeFileSync(join(shots, stem + '_mockup.png'), mockShot);
    writeFileSync(join(shots, stem + '_built.png'), builtShot);
    writeFileSync(join(shots, stem + '_side.png'), Buffer.from(diff.side.split(',')[1], 'base64'));
    writeFileSync(join(shots, stem + '_diff.png'), Buffer.from(diff.diff.split(',')[1], 'base64'));
    report.push({screen, device, width, height, pct: diff.pct, mockWidth: diff.width, builtWidth: diff.builtWidth});
    expect(diff.pct, stem).toBeLessThan(0.2);
  }
  await page.setViewportSize({width: 700, height: 900});
  await page.goto('/mockup-original/index.html?s=fleet');
  await page.locator('.shell, .ph').first().waitFor();
  const mockWide = await page.screenshot();
  await openShell(page, 's=fleet');
  const builtPhone = await page.locator('iframe').screenshot();
  writeFileSync(join(shots, 'shell_fleet_auto_700_mockup_desktop.png'), mockWide);
  writeFileSync(join(shots, 'shell_fleet_auto_700_built_phone.png'), builtPhone);
  writeFileSync(join(shots, 'report.json'), JSON.stringify(report, null, 2));
});
