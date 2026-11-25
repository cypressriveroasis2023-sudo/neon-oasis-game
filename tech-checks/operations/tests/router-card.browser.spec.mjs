import {test, expect} from '@playwright/test';
import {mountFleet, fresh} from './fleet-dashboard-fixtures.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';
import {mountRouterFixture} from './fixtures/routers.mjs';

/* The InHand router box on a unit card, and the Link router list on the InHand Routers screen. Both read the
   Tech Check cos-router-details function; these stand-ins answer the way it does. */
const DETAILS = '**/functions/v1/cos-router-details';
const unit = (name, extra = {}) => ({
  unit: name, placement: 'FIELD', site: 'Fixture yard', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh,
  cameraList: [{name: name + ' / Cam 1', status: 'online', atSite: true}], source: 'star4live', ...extra,
});
const rows = [unit('HELIOS 001'), unit('SPOTTER 002', {state: 'RED', online: 0, offline: 1, cameraList: [{name: 'SPOTTER 002 / Cam 1', status: 'offline', atSite: true}]})];
const report = {contract: 'COS_STAR_UNIT_STATUS_V1', units: rows, counts: countUnits(rows),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: true, refreshedAt: fresh, source: 'Star4Live'};
const inBoard = (host, fn, value) => host.evaluate((element, [source, input]) => (0, eval)('(' + source + ')')(element.cosBoardRoot, input), [fn.toString(), value]);
const openUnit = async (host, name) => {
  await expect.poll(() => inBoard(host, (root, wanted) => { const row = [...root.querySelectorAll('#list .row')].find(r => r.querySelector('.name').textContent === wanted); row?.click(); return root.getElementById('pname')?.textContent || ''; }, name)).toBe(name);
};
const refreshed = host => expect.poll(() => inBoard(host, root => root.getElementById('refresh').disabled)).toBe(false);

async function detailsServer(page, body) {
  const seen = [];
  await page.route(DETAILS, async route => {
    const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const req = route.request().postDataJSON(); seen.push(req);
    const answer = typeof body === 'function' ? body(req) : {status: 200, json: body};
    return route.fulfill({status: answer.status, headers, json: answer.json});
  });
  return seen;
}

test('a unit card shows its router: Connected, the :8080 button, signal and carrier, and no SIM numbers', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect.poll(() => inBoard(host, root => root.querySelectorAll('.tile').length)).toBe(4);
  await detailsServer(page, {routers: [{unit: 'SPOTTER 002', serial: 'RF6150001', model: 'IR615', status: 'online', at: fresh,
    ip: '203.0.113.42', ipFrom: 'inhand', cosDiffers: true, port: 8080, sig: {level: 4, radio: '4G', band: 'B12', rsrp: -88},
    carrier: 'T-Mobile', fw: 'V2.3.0', gps: {lat: 45, lng: -120}}], unmatched: [], units: []});
  // The camera feed's server answers too, so Refresh works and re-reads the routers with it.
  await page.route('**/functions/v1/cos-unit-camera-status', route => route.request().method() === 'OPTIONS'
    ? route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}})
    : route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, json: report}));
  await inBoard(host, root => root.getElementById('refresh').click());
  await refreshed(host);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => inBoard(host, root => root.getElementById('rtrBox')?.textContent || '')).toContain('Connected');
  const box = await inBoard(host, root => { const b = root.getElementById('rtrBox'); const a = b.querySelector('a.rbtn'); return {text: b.textContent, href: a?.href, target: a?.target, rel: a?.rel}; });
  expect(box.href).toBe('http://203.0.113.42:8080/');
  expect(box.target).toBe('_blank');
  expect(box.rel).toContain('noopener');
  expect(box.text).toContain('Open router (:8080)');
  expect(box.text).toContain('Good · 4G · band B12 · -88 dBm');
  expect(box.text).toContain('T-Mobile');
  expect(box.text).toContain('InHand reports a different public IP');
  expect(box.text).toContain('Router status is a hint, not camera health');
  expect(box.text).not.toMatch(/iccid|imsi|89\d{15,}/i);
  // A field unit with no router linked says so, and points to the InHand Routers screen.
  await inBoard(host, root => root.querySelector('#panel .close').click());
  await inBoard(host, root => [...root.querySelectorAll('.tile')].find(t => t.querySelector('.lab').textContent === 'Up')?.click());
  await openUnit(host, 'Helios 001');
  await expect.poll(() => inBoard(host, root => root.getElementById('panel').textContent)).toContain('No InHand router is linked to this unit');
});

test('a stale router reading shows Unknown, never Connected or Offline', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect.poll(() => inBoard(host, root => root.querySelectorAll('.tile').length)).toBe(4);
  const old = new Date(Date.parse(fresh) - 3 * 3600e3).toISOString();
  await detailsServer(page, {routers: [{unit: 'SPOTTER 002', serial: 'RF6150001', status: 'offline', at: old, port: 8080}], unmatched: [], units: []});
  await page.route('**/functions/v1/cos-unit-camera-status', route => route.request().method() === 'OPTIONS'
    ? route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}})
    : route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, json: report}));
  await inBoard(host, root => root.getElementById('refresh').click());
  await refreshed(host);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => inBoard(host, root => root.getElementById('rtrBox')?.querySelector('.cst')?.textContent || '')).toBe('Unknown');
  expect(await inBoard(host, root => root.getElementById('rtrBox').textContent)).toContain('No public IP for this router yet');
});

test('Owner links an InHand router to its unit from the InHand Routers screen', async ({page}) => {
  const {frame} = await mountRouterFixture(page);
  let linked = false;
  const seen = await detailsServer(page, req => req.action === 'link'
    ? (linked = true, {status: 200, json: {ok: true, message: 'Linked RF6159999 to SOLARSPOTTER 052.'}})
    : {status: 200, json: {routers: [], unmatched: linked ? [] : [{serial: 'RF6159999', name: 'SS 052', model: 'IR615', online: true, lastSeen: null, at: new Date().toISOString()}], units: ['SOLARSPOTTER 052', 'SPOTTER 183']}});
  await frame.getByRole('navigation', {name: 'Equipment systems'}).getByRole('button', {name: 'Router connections', exact: true}).click();
  const list = frame.getByRole('region', {name: 'InHand routers not linked to a unit'});
  await expect(list).toContainText('SS 052');
  const pick = list.getByRole('combobox', {name: 'COS unit for router RF6159999'});
  await expect(pick).toHaveValue('SOLARSPOTTER 052');
  await pick.fill('NOT A UNIT');
  await expect(list.getByRole('button', {name: 'Link'})).toBeDisabled();
  await pick.fill('SOLARSPOTTER 052');
  await list.getByRole('button', {name: 'Link'}).click();
  await expect(list).toContainText('Every InHand router is linked to a unit.');
  expect(seen.filter(r => r.action === 'link')).toEqual([{action: 'link', unit: 'SOLARSPOTTER 052', serial: 'RF6159999'}]);
});

test('anyone who is not Owner or IT never sees the Link router list', async ({page}) => {
  const {frame} = await mountRouterFixture(page);
  await detailsServer(page, () => ({status: 403, json: {error: 'Owner or IT only.'}}));
  await frame.getByRole('navigation', {name: 'Equipment systems'}).getByRole('button', {name: 'Router connections', exact: true}).click();
  await expect(frame.getByRole('heading', {name: 'InHand router status'})).toBeVisible();
  await expect(frame.getByRole('region', {name: 'InHand routers not linked to a unit'})).toHaveCount(0);
  await expect(frame.getByText('Owner or IT only.')).toHaveCount(0);
});

test('an offline router reads Offline everywhere on the card, and its button is grey, not green', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect.poll(() => inBoard(host, root => root.querySelectorAll('.tile').length)).toBe(4);
  await detailsServer(page, {routers: [{unit: 'SPOTTER 002', serial: 'RF3022412359403', model: 'InHand IR300', status: 'offline', at: fresh,
    ip: '203.0.113.42', ipFrom: 'inhand', port: 8080, sig: {level: 4, radio: '4G', band: '66', rsrp: -81}, carrier: 'AT&T'}], unmatched: [], units: []});
  await page.route('**/functions/v1/cos-unit-camera-status', route => route.request().method() === 'OPTIONS'
    ? route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}})
    : route.fulfill({status: 200, headers: {'access-control-allow-origin': '*'}, json: report}));
  await inBoard(host, root => root.getElementById('refresh').click());
  await refreshed(host);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => inBoard(host, root => root.getElementById('rtrBox')?.querySelector('.cst')?.textContent || '')).toBe('Offline');
  const card = await inBoard(host, root => ({panel: root.getElementById('panel').textContent, off: root.querySelector('#rtrBox a.rbtn')?.classList.contains('off')}));
  expect(card.off).toBe(true);
  expect(card.panel).toMatch(/Router, InHand says.{0,20}Offline · /);
  expect(card.panel).not.toContain('Router readings have not loaded yet');
  expect(card.panel).toContain('The router is offline, so its page will not open');
  expect(card.panel).toContain('Last signal');
});
