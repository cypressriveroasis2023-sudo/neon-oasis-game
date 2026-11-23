import {test, expect} from '@playwright/test';
import {mountFleet, fresh} from './fleet-dashboard-fixtures.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

const unit = (name, extra = {}) => ({
  unit: name, placement: 'FIELD', site: 'Fixture yard', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh,
  cameraList: [{name: name + ' / Cam 1', status: 'online', atSite: true}], source: 'star4live', ...extra,
});
const units = [
  unit('HELIOS 001'),
  unit('SPOTTER 002', {state: 'RED', online: 0, offline: 1, site: 'Fixture depot', publicIp: '203.0.113.42', cameraList: [{name: 'SPOTTER 002 / Cam 1', status: 'offline', atSite: true}]}),
  unit('SPOTTER 003', {state: 'YELLOW', cameras: 2, offline: 1, cameraList: [{name: 'SPOTTER 003 / Cam 1', status: 'online', atSite: true}, {name: 'SPOTTER 003 / Cam 2', status: 'offline', atSite: true}]}),
  unit('SPOTTER 004', {state: 'UNKNOWN', online: 0, unknown: 1, observedAt: '2026-10-01T00:00:00Z', cameraList: [{name: 'SPOTTER 004 / Cam 1', status: 'offline', atSite: true}]}),
  unit('SNIPER 4-100', {placement: 'SHOP', site: null, state: 'RED', online: 0, offline: 1, source: 'ip_check', cameraList: [{name: 'SNIPER 4-100 / Cam 1', status: 'offline', atSite: true}]}),
];
const report = {
  contract: 'COS_STAR_UNIT_STATUS_V1', units, counts: countUnits(units),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: true, refreshedAt: fresh, source: 'Star4Live',
};

// The board draws inside a closed shadow root, so page-wide lookups elsewhere in COS never match it. This test reads it through the host's own handle.
const inBoard = (host, fn) => host.evaluate((element, source) => (0, eval)('(' + source + ')')(element.cosBoardRoot), fn.toString());
const tiles = host => inBoard(host, root => Object.fromEntries([...root.querySelectorAll('.tile')].map(tile => [tile.querySelector('.lab').textContent, tile.querySelector('.num').textContent])));

test('the phone Fleet screen opens on the board, counted by the shared count', async ({page}, info) => {
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  if (info.project.name !== 'mobile-390') {
    await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-shared-problem-count', /^\d+$/);
    await expect(host).toHaveCount(0);
    expect(state.errors).toEqual([]);
    return;
  }
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await inBoard(host, root => [...root.querySelectorAll('.mini')].map(mini => mini.textContent))).toEqual(['4in the field', '1in the shop', '0online in shop']);
  // The Fleet readout underneath is the same count: Up is online, Down plus Camera issues is offline.
  const landing = app.getByRole('region', {name: 'Phone technician landing'});
  await expect(landing.getByRole('group', {name: 'Camera units online, offline and unknown'}).locator('b')).toHaveText(['1', '2', '1']);
  // The board spans the phone and sits above everything else on Fleet.
  const board = await app.locator('.cos-board-landing').boundingBox(), old = await landing.boundingBox();
  expect(Math.round(board.x)).toBe(0);
  expect(Math.round(board.width)).toBe(390);
  expect(board.y + board.height).toBeLessThanOrEqual(old.y);
  // It opens on what is down. A shop unit is never listed as down.
  expect(await inBoard(host, root => [root.getElementById('count').textContent, ...[...root.querySelectorAll('#list .row .name')].map(name => name.textContent)])).toEqual(['1 field units down', 'Spotter 002']);
  // A unit page: diagnosis, cameras, and the IP held back until asked for.
  await inBoard(host, root => root.querySelector('#list .row').click());
  const sheet = await inBoard(host, root => ({open: root.getElementById('sheet').classList.contains('open'), text: root.getElementById('panel').textContent}));
  expect(sheet.open).toBe(true);
  expect(sheet.text).toContain('Spotter 002');
  expect(sheet.text).toContain('Star4Live: 0 of 1 online, 1 offline');
  expect(sheet.text).toContain('SPOTTER 002 / Cam 1');
  expect(sheet.text).toContain('ending .42');
  expect(sheet.text).not.toContain('203.0.113.42');
  expect(sheet.text).toContain('Hand fixes are not switched on for this screen yet.');
  await inBoard(host, root => root.querySelector('#panel .close').click());
  expect(await inBoard(host, root => root.getElementById('sheet').classList.contains('open'))).toBe(false);
  // Unknown is its own tile, never Down.
  await inBoard(host, root => root.querySelector('.tile.t-unknown').click());
  expect(await inBoard(host, root => [...root.querySelectorAll('#list .row .name')].map(name => name.textContent))).toEqual(['Spotter 004']);
  // Nothing of the board is reachable by a page-wide lookup, so the rest of COS is found exactly as before.
  await expect(app.getByRole('button', {name: 'Refresh', exact: true})).toHaveCount(0);
  await expect(app.getByText('Camera issues', {exact: true})).toHaveCount(0);
  expect(await host.evaluate(element => element.shadowRoot)).toBeNull();
  expect(state.errors).toEqual([]);
});

test('Refresh on the board reads the camera feed again and Fleet follows', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  // Spotter 002 comes back before the next read.
  report.units = units.map(row => row.unit === 'SPOTTER 002' ? unit('SPOTTER 002') : row);
  try {
    await inBoard(host, root => root.getElementById('refresh').click());
    await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '2'});
    const landing = app.getByRole('region', {name: 'Phone technician landing'});
    await expect(landing.getByRole('group', {name: 'Camera units online, offline and unknown'}).locator('b')).toHaveText(['2', '1', '1']);
    await expect.poll(() => inBoard(host, root => root.getElementById('toast').textContent)).toContain('New reading: Star4Live');
  } finally {
    report.units = units;
  }
  expect(state.errors).toEqual([]);
});

test('with no camera feed Fleet shows as before', async ({page}) => {
  const {app, state} = await mountFleet(page);
  await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-shared-problem-count', /^\d+$/);
  await expect(app.locator('.cos-board-landing')).toHaveCount(0);
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
