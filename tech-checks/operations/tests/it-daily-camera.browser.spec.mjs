import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const origin = 'http://127.0.0.1:4173';
const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const deniedIds = ['visionLink', 'repairLink', 'ticketButton'];

function fixture(role) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden],.hidden{display:none!important}button,a{display:inline-block;min-height:44px;margin:5px}</style></head><body>
    <div id="authGate" class="${role ? 'hidden' : ''}">Synthetic authentication state</div>
    <a id="visionLink" href="./onsite-vision.html">OnSite Vision</a>
    <a id="repairLink" href="./it-send-repair.html">IT Send Repair</a>
    <button id="ticketButton" class="ticket-unit" onclick="fixtureActions.push('ticket')">Create service ticket</button>
    <button id="editFieldBtn" onclick="fixtureActions.push('placement')">Edit field information</button>
    <button id="editIpButton" onclick="fixtureActions.push('ip')">Edit IP address</button>
    <button id="verifyBtn" onclick="fixtureActions.push('verify')">Verify now</button>
    <a id="diagnosticsLink" href="./camera-health.html?unit=HELIOS%20001&action=edit-field#saved">Troubleshoot</a>
    <a id="detailLink" href="./camera-detail.html?id=17&action=edit-ip">Open saved IP / ports</a>
    <a id="providerLink" href="https://na.reconeyez.com" target="_blank" rel="noopener noreferrer">Open Reconeyez</a>
    <a id="deviceLink" href="http://192.0.2.5:8443" target="_blank" rel="noopener noreferrer">Open saved device</a>
    <a id="fieldLink" href="./?fieldUnit=HELIOS%20001">Field View</a>
    <button id="backBtn">Back to Camera Health</button>
    <button id="openDetailBtn" onclick="openCameraDetail(17)">Open selected camera</button>
    <script>
      let profile = ${role ? JSON.stringify({user_id: 'synthetic-camera-user', role, active: true, archived_at: null}) : 'null'};
      window.fixtureActions = [];
      window.fixtureSetProfile = role => {
        profile = role ? {user_id:'synthetic-camera-user',role,active:true,archived_at:null} : null;
        document.getElementById('authGate').classList.toggle('hidden', Boolean(role));
        document.body.classList.toggle('fixture-profile-change');
      };
      window.fixtureInject = () => {
        const node = document.createElement('section');
        node.innerHTML = '<a id="lateBrand" class="cos-added-brand" href="./onsite-vision.html">Brand Vision link</a><button id="lateTicket" class="ticket-unit">Late ticket</button><a id="lateDetail" href="./camera-detail.html?id=21">Late diagnostic detail</a>';
        node.querySelector('#lateTicket').onclick = () => fixtureActions.push('late-ticket');
        document.body.append(node);
      };
      function openCameraDetail(id) { fixtureActions.push('open-detail'); location.href='./camera-detail.html?id='+encodeURIComponent(id); }
      document.getElementById('backBtn').onclick = () => { fixtureActions.push('legacy-back'); location.href='./camera-health.html'; };
    </script>
    <script type="module" src="./it-daily-camera-host.js"></script>
  </body></html>`;
}

async function mount(page, {role = 'it', scoped = false, detail = false} = {}) {
  const state = {navigation: [], external: [], errors: []};
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { state.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/tech-checks/it-daily-camera-host.js') return route.fulfill({contentType: 'text/javascript', body: read('it-daily-camera-host.js') + '\nwindow.fixtureGuardLoaded = true;'});
    if (url.pathname === '/tech-checks/it-feature-availability.js') return route.fulfill({contentType: 'text/javascript', body: read('it-feature-availability.js')});
    if (request.isNavigationRequest()) {
      state.navigation.push(url.pathname + url.search);
      if (['/tech-checks/camera-health.html', '/tech-checks/camera-detail.html'].includes(url.pathname)) return route.fulfill({contentType: 'text/html', body: fixture(role)});
      return route.fulfill({contentType: 'text/html', body: '<main>Synthetic destination</main>'});
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(origin + '/tech-checks/' + (detail ? 'camera-detail.html?id=17' : 'camera-health.html') + (scoped ? (detail ? '&' : '?') + 'itDaily=1' : ''));
  await expect.poll(() => page.evaluate(() => window.fixtureGuardLoaded)).toBe(true);
  return state;
}

async function expectPaused(page, ids = deniedIds) {
  for (const id of ids) await expect(page.locator('#' + id)).toBeHidden();
  await page.evaluate(ids => ids.forEach(id => document.getElementById(id).click()), ids);
  expect(await page.evaluate(() => window.fixtureActions)).toEqual([]);
}

for (const [name, options] of [['IT', {role: 'it'}], ['daily-scoped Owner', {role: 'owner', scoped: true}]]) {
  test(name + ' preserves Camera Health actions while blocking paused navigation and ticket creation', async ({page}) => {
    const state = await mount(page, options), initialUrl = page.url();
    await expectPaused(page);
    expect(page.url()).toBe(initialUrl);
    for (const id of ['editFieldBtn', 'editIpButton', 'verifyBtn', 'providerLink', 'deviceLink', 'fieldLink']) await expect(page.locator('#' + id)).toBeVisible();
    await page.locator('#editFieldBtn').click(); await page.locator('#editIpButton').click(); await page.locator('#verifyBtn').click();
    expect(await page.evaluate(() => window.fixtureActions)).toEqual(['placement', 'ip', 'verify']);
    await expect(page.locator('#providerLink')).toHaveAttribute('href', 'https://na.reconeyez.com');
    await expect(page.locator('#deviceLink')).toHaveAttribute('href', 'http://192.0.2.5:8443');
    for (const id of ['diagnosticsLink', 'detailLink']) {
      const href = new URL(await page.locator('#' + id).getAttribute('href'), page.url());
      expect(href.searchParams.get('itDaily')).toBe('1');
    }
    await page.evaluate(() => { window.fixtureActions = []; window.fixtureInject(); });
    await expectPaused(page, ['lateBrand', 'lateTicket']);
    await expect(page.locator('#lateDetail')).toBeVisible();
    expect(new URL(await page.locator('#lateDetail').getAttribute('href'), page.url()).searchParams.get('itDaily')).toBe('1');
    expect(state.navigation).toHaveLength(1); expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
  });
}

test('unknown profile is contained until verified Owner controls are restored', async ({page}) => {
  const state = await mount(page, {role: null}); await expectPaused(page);
  await page.evaluate(() => window.fixtureSetProfile('owner'));
  for (const id of deniedIds) await expect(page.locator('#' + id)).toBeVisible();
  expect(await page.locator('#ticketButton').evaluate(node => node.inert)).toBe(false);
  await expect(page.locator('#detailLink')).toHaveAttribute('href', './camera-detail.html?id=17&action=edit-ip');
  await page.locator('#ticketButton').click(); expect(await page.evaluate(() => window.fixtureActions)).toEqual(['ticket']);
  await page.locator('#visionLink').click(); await expect(page).toHaveURL(origin + '/tech-checks/onsite-vision.html');
  expect(state.navigation.at(-1)).toBe('/tech-checks/onsite-vision.html'); expect(state.errors).toEqual([]);
});

test('ordinary Owner keeps original camera links, dynamic controls and repair navigation', async ({page}) => {
  const state = await mount(page, {role: 'owner'});
  for (const id of deniedIds) await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#diagnosticsLink')).toHaveAttribute('href', './camera-health.html?unit=HELIOS%20001&action=edit-field#saved');
  await page.evaluate(() => window.fixtureInject());
  await expect(page.locator('#lateBrand')).toBeVisible(); await expect(page.locator('#lateTicket')).toBeVisible();
  await expect(page.locator('#lateDetail')).toHaveAttribute('href', './camera-detail.html?id=21');
  await page.locator('#lateTicket').click(); expect(await page.evaluate(() => window.fixtureActions)).toEqual(['late-ticket']);
  await page.locator('#repairLink').click(); await expect(page).toHaveURL(origin + '/tech-checks/it-send-repair.html');
  expect(state.errors).toEqual([]);
});

test('scoped Owner diagnostic links preserve edit parameters and contain the destination after navigation', async ({page}) => {
  const state = await mount(page, {role: 'owner', scoped: true});
  await page.locator('#detailLink').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/tech-checks/camera-detail.html');
  const destination = new URL(page.url()); expect(destination.searchParams.get('id')).toBe('17'); expect(destination.searchParams.get('action')).toBe('edit-ip'); expect(destination.searchParams.get('itDaily')).toBe('1');
  await expect.poll(() => page.evaluate(() => window.fixtureGuardLoaded)).toBe(true); await expectPaused(page);
  expect(state.errors).toEqual([]);
});

for (const [name, options] of [['IT', {role: 'it'}], ['daily-scoped Owner', {role: 'owner', scoped: true}], ['ordinary Owner', {role: 'owner'}]]) {
  test(name + ' openCameraDetail and Back retain the correct presentation scope', async ({page}) => {
    const state = await mount(page, options), scoped = name !== 'ordinary Owner';
    await page.locator('#openDetailBtn').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tech-checks/camera-detail.html');
    expect(new URL(page.url()).searchParams.get('id')).toBe('17');
    expect(new URL(page.url()).searchParams.get('itDaily')).toBe(scoped ? '1' : null);
    await expect.poll(() => page.evaluate(() => window.fixtureGuardLoaded)).toBe(true);
    await page.locator('#backBtn').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tech-checks/camera-health.html');
    expect(new URL(page.url()).searchParams.get('itDaily')).toBe(scoped ? '1' : null);
    await expect.poll(() => page.evaluate(() => window.fixtureGuardLoaded)).toBe(true);
    if (scoped) await expectPaused(page); else await expect(page.locator('#ticketButton')).toBeVisible();
    expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
  });
}
