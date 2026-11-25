import {test, expect} from '@playwright/test';
import {mountFleet, fresh} from './fleet-dashboard-fixtures.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

/* James (25 Nov): "take me to unit in COS" opened the older UNIT DETAILS drawer. That is not part of his
   troubleshooting. On a device that shows the board, a unit asked for from another screen opens the board's own unit card. */
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
const shownBefore = page => page.addInitScript(() => { try { localStorage.setItem('cos.fleetBoard.shown', '1'); } catch {} });

test('a unit asked for from another screen opens on the board unit card, never the older details drawer', async ({page}) => {
  await shownBefore(page);
  const {app, state} = await mountFleet(page, false, {hash: '#fleet-dashboard?unitLabel=SPOTTER%20002', cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => inBoard(host, root => root.getElementById('pname')?.textContent || '')).toBe('Spotter 002');
  expect(await inBoard(host, root => root.getElementById('sheet').classList.contains('open'))).toBe(true);
  await expect(app.locator('.cos-fleet-drawer')).toHaveCount(0);
  await expect(app.getByText('UNIT DETAILS', {exact: true})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('a unit the board does not have is said on the board, and still no details drawer', async ({page}) => {
  await shownBefore(page);
  const {app} = await mountFleet(page, false, {hash: '#fleet-dashboard?unitLabel=RANGER%20999', cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => inBoard(host, root => root.getElementById('toast').textContent)).toContain('RANGER 999 is not on the board');
  await expect(app.locator('.cos-fleet-drawer')).toHaveCount(0);
});
