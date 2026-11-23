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
const reportOf = (rows, extra = {}) => ({
  contract: 'COS_STAR_UNIT_STATUS_V1', units: rows, counts: countUnits(rows),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: true, refreshedAt: fresh, source: 'Star4Live', ...extra,
});
const report = reportOf(units);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REVISION = '11111111-2222-4333-8444-555555555555';

// The board draws inside a closed shadow root, so page-wide lookups elsewhere in COS never match it. These tests read it through the host's own handle.
const inBoard = (host, fn, value) => host.evaluate((element, [source, input]) => (0, eval)('(' + source + ')')(element.cosBoardRoot, input), [fn.toString(), value]);
const tiles = host => inBoard(host, root => Object.fromEntries([...root.querySelectorAll('.tile')].map(tile => [tile.querySelector('.lab').textContent, tile.querySelector('.num').textContent])));
const minis = host => inBoard(host, root => [...root.querySelectorAll('.mini')].map(mini => mini.textContent));
const panel = host => inBoard(host, root => root.getElementById('panel').textContent);
const fixButtons = host => inBoard(host, root => [...root.querySelectorAll('#panel .fixbtn')].map(button => button.textContent));
const toastText = host => inBoard(host, root => root.getElementById('toast').textContent);
const openUnit = async (host, name) => {
  expect(await inBoard(host, (root, wanted) => { const row = [...root.querySelectorAll('#list .row')].find(item => item.querySelector('.name').textContent === wanted); row?.click(); return Boolean(row); }, name)).toBe(true);
  await expect.poll(() => inBoard(host, root => root.getElementById('pname')?.textContent)).toBe(name);
};
const pressFix = async (host, label) => {
  expect(await inBoard(host, (root, wanted) => { const button = [...root.querySelectorAll('#panel .fixbtn, #panel button.lk')].find(item => item.textContent === wanted); button?.click(); return Boolean(button); }, label)).toBe(true);
};
const typeAndSave = async (host, id, value) => {
  await inBoard(host, (root, [field, text]) => { const input = root.getElementById(field); input.value = text; input.form.requestSubmit(); }, [id, value]);
};

/** A stand-in for the edit route: it records what was sent and answers the way the server does. */
async function editServer(page, start = units, flags = {}) {
  const server = {units: structuredClone(start), sent: [], fail: null, pinNote: null, reads: 0};
  const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS'};
  const edit = (row, field, value, clear) => {
    const hand = {...(row.handEdits || {})};
    const provider = {placement: row.providerPlacement ?? row.placement, site: row.providerSite !== undefined ? row.providerSite : row.site, public_ip: row.providerPublicIp !== undefined ? row.providerPublicIp : row.publicIp};
    if (clear) delete hand[field];
    else hand[field] = {value, by: 'Fixture Owner', role: 'owner', at: fresh, reason: null, providerValue: provider[field] ?? null, providerAgrees: false};
    const placement = hand.placement?.value || provider.placement;
    return {
      ...row, handEdits: hand, placement, site: placement === 'FIELD' ? (hand.site?.value ?? provider.site) : null,
      publicIp: hand.public_ip?.value ?? provider.public_ip, onlineInShop: placement === 'SHOP' && row.online > 0,
      providerPlacement: provider.placement, providerSite: provider.site, providerPublicIp: provider.public_ip,
      ...(hand.name ? {displayName: hand.name.value} : {displayName: undefined}),
      address: placement === 'FIELD' ? (hand.address?.value ?? null) : null,
      ...(field === 'address' ? {addressRevision: REVISION, location: !clear && !server.pinNote ? {latitude: 29.76, longitude: -95.36, matchedAddress: null, source: 'hand'} : null} : {}),
    };
  };
  await page.route('**/functions/v1/cos-unit-camera-status', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers: cors});
    const body = JSON.parse(route.request().postData() || '{}');
    if (!(body.path && body.path.endsWith('/edit'))) { server.reads += 1; return route.fulfill({status: 200, headers: cors, json: reportOf(server.units, flags)}); }
    server.sent.push(body.body);
    if (server.fail) return route.fulfill({status: server.fail.status, headers: cors, json: {error: server.fail.error}});
    const clear = body.body.action === 'clear';
    server.units = server.units.map(row => row.unit === body.body.unitKey ? edit(row, body.body.field, body.body.value ?? null, clear) : row);
    return route.fulfill({status: 200, headers: cors, json: {...reportOf(server.units, flags), recorded: {
      unit: body.body.unitKey, field: body.body.field, action: body.body.action || 'set', value: body.body.value ?? null, by: 'Fixture Owner', role: 'owner', duplicate: false,
      ...(body.body.field === 'address' && !clear ? {pinned: !server.pinNote, pinNote: server.pinNote} : {}),
    }}});
  });
  return server;
}

async function phoneBoard(page, start = units, flags = {}) {
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(start, flags)});
  const server = await editServer(page, start, flags);
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => inBoard(host, root => root.querySelectorAll('.tile').length)).toBe(4);
  return {app, state, host, server};
}

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
  expect(await minis(host)).toEqual(['4in the field', '1in the shop', '0online in shop']);
  // The Fleet readout underneath is the same count: Up is online, Down plus Camera issues is offline.
  const landing = app.getByRole('region', {name: 'Phone technician landing'});
  await expect(landing.getByRole('group', {name: 'Camera units online, offline and unknown'}).locator('b')).toHaveText(['1', '2', '1']);
  // The board spans the phone and sits above everything else on Fleet.
  const board = await app.locator('.cos-board-landing').boundingBox(), old = await landing.boundingBox();
  expect(Math.round(board.x)).toBe(0);
  expect(Math.round(board.width)).toBe(390);
  expect(board.y + board.height).toBeLessThanOrEqual(old.y);
  // The board's five tabs, as on the board itself.
  expect(await inBoard(host, root => [...root.querySelectorAll('.tab')].filter(tab => !tab.hidden).map(tab => tab.textContent))).toEqual(['Board', 'Map', 'Tech check', 'Punch list', 'Changes']);
  // It opens on what is down. A shop unit is never listed as down.
  expect(await inBoard(host, root => [root.getElementById('count').textContent, ...[...root.querySelectorAll('#list .row .name')].map(name => name.textContent)])).toEqual(['1 field units down', 'Spotter 002']);
  // A unit page: diagnosis, cameras, and the IP held back until asked for.
  await openUnit(host, 'Spotter 002');
  const sheet = await panel(host);
  expect(await inBoard(host, root => root.getElementById('sheet').classList.contains('open'))).toBe(true);
  expect(sheet).toContain('Star4Live: 0 of 1 online, 1 offline');
  expect(sheet).toContain('SPOTTER 002 / Cam 1');
  expect(sheet).toContain('ending .42');
  expect(sheet).not.toContain('203.0.113.42');
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
  const {app, state, host, server} = await phoneBoard(page);
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  // Spotter 002 comes back before the next read.
  server.units = server.units.map(row => row.unit === 'SPOTTER 002' ? unit('SPOTTER 002') : row);
  await inBoard(host, root => root.getElementById('refresh').click());
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '2'});
  const landing = app.getByRole('region', {name: 'Phone technician landing'});
  await expect(landing.getByRole('group', {name: 'Camera units online, offline and unknown'}).locator('b')).toHaveText(['2', '1', '1']);
  await expect.poll(() => toastText(host)).toContain('New reading: Star4Live');
  expect(server.sent).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('a hand fix on the board is saved through the Camera status route and shows who made it', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, state, host, server} = await phoneBoard(page);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP']);
  await pressFix(host, 'Move to shop');
  await expect.poll(() => toastText(host)).toBe('Saved.');
  // Exactly what Camera status sends: the unit's own key, one field, a fresh request id, and nothing about who is asking.
  expect(server.sent).toHaveLength(1);
  expect(Object.keys(server.sent[0]).sort()).toEqual(['field', 'requestId', 'unitKey', 'value']);
  expect(server.sent[0]).toMatchObject({unitKey: 'SPOTTER 002', field: 'placement', value: 'SHOP'});
  expect(server.sent[0].requestId).toMatch(UUID);
  // A unit in the shop is never down, on the board and in the Fleet count alike.
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await minis(host)).toEqual(['3in the field', '2in the shop', '0online in shop']);
  const landing = app.getByRole('region', {name: 'Phone technician landing'});
  await expect(landing.getByRole('group', {name: 'Camera units online, offline and unknown'}).locator('b')).toHaveText(['1', '1', '1']);
  // The unit page says it was set by hand, by whom, and offers the way back.
  const sheet = await panel(host);
  expect(sheet).toContain('Shop · set by hand');
  expect(sheet).toContain('Set by hand on this unit');
  expect(sheet).toContain('Fixture Owner set placement to “Shop”');
  expect(await fixButtons(host)).toEqual(['Move to field', 'Change site', 'Rename', 'Correct IP', 'Undo hand edits']);
  // The Changes tab lists every hand fix in force.
  await inBoard(host, root => root.querySelector('#panel .close').click());
  await inBoard(host, root => root.getElementById('tabActivity').click());
  expect(await inBoard(host, root => [root.getElementById('actNote').textContent, ...[...root.querySelectorAll('#activity li')].map(item => item.textContent.replace(/[A-Z][a-z]{2} \d.*$/, '').trim())])).toEqual(['Every hand fix in force in COS, newest first.', 'Spotter 002: Fixture Owner set placement to “Shop”']);
  // Undo asks first, then clears exactly what was set by hand.
  await inBoard(host, root => root.getElementById('tabBoard').click());
  await inBoard(host, root => [...root.querySelectorAll('.mini')].find(mini => /in the shop/.test(mini.textContent)).click());
  await openUnit(host, 'Spotter 002');
  await pressFix(host, 'Undo hand edits');
  expect(server.sent).toHaveLength(1);
  expect(await panel(host)).toContain('This clears what was set by hand on Spotter 002: placement. The unit goes back to what Star4Live reports.');
  await pressFix(host, 'Clear them');
  await expect.poll(() => server.sent.length).toBe(2);
  expect(server.sent[1]).toMatchObject({unitKey: 'SPOTTER 002', field: 'placement', action: 'clear'});
  expect('value' in server.sent[1]).toBe(false);
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP']);
  expect(state.errors).toEqual([]);
});

test('moving a shop unit to a site sends the placement, then the site', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {state, host, server} = await phoneBoard(page);
  await inBoard(host, root => [...root.querySelectorAll('.mini')].find(mini => /in the shop/.test(mini.textContent)).click());
  await openUnit(host, 'Sniper 4-100');
  // An Avigilon unit has no Star4Live IP to correct, so the board does not offer it.
  await expect.poll(() => fixButtons(host)).toEqual(['Move to field', 'Change site', 'Rename']);
  await pressFix(host, 'Move to field');
  expect(await panel(host)).toContain('Which site is it on?');
  await typeAndSave(host, 'fixInput', 'Fixture yard 2');
  await expect.poll(() => server.sent.length).toBe(2);
  expect(server.sent.map(edit => [edit.unitKey, edit.field, edit.value])).toEqual([['SNIPER 4-100', 'placement', 'FIELD'], ['SNIPER 4-100', 'site', 'Fixture yard 2']]);
  expect(server.sent[0].requestId).not.toBe(server.sent[1].requestId);
  await expect.poll(() => minis(host)).toEqual(['5in the field', '0in the shop', '0online in shop']);
  const sheet = await panel(host);
  expect(sheet).toContain('Field · set by hand');
  expect(sheet).toContain('Fixture yard 2');
  // A rename keeps the unit's own key and can be taken back by leaving the name empty.
  await pressFix(host, 'Rename');
  await typeAndSave(host, 'fixInput', 'Sniper 4-100 East');
  await expect.poll(() => inBoard(host, root => root.getElementById('pname').textContent)).toBe('Sniper 4-100 East');
  expect(server.sent[2]).toMatchObject({unitKey: 'SNIPER 4-100', field: 'name', value: 'Sniper 4-100 East'});
  await pressFix(host, 'Rename');
  await typeAndSave(host, 'fixInput', '');
  await expect.poll(() => inBoard(host, root => root.getElementById('pname').textContent)).toBe('Sniper 4-100');
  expect(server.sent[3]).toMatchObject({unitKey: 'SNIPER 4-100', field: 'name', action: 'clear'});
  expect(state.errors).toEqual([]);
});

test('an address is saved as typed, against the revision it was read with, and says when it has no pin', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const start = units.map(row => row.unit === 'SPOTTER 002' ? {...row, address: '100 Old Road, Houston, TX 77001', addressRevision: REVISION, handEdits: {address: {value: '100 Old Road, Houston, TX 77001', by: 'Fixture IT', role: 'it', at: fresh, reason: null, providerValue: null, providerAgrees: false}}} : row);
  const {state, host, server} = await phoneBoard(page, start);
  await openUnit(host, 'Spotter 002');
  expect(await panel(host)).toContain('100 Old Road, Houston, TX 77001');
  expect(await panel(host)).toContain('This address was typed by hand in COS. COS could not place a pin for it, so it is not on the map.');
  await pressFix(host, 'Change the address');
  expect(await inBoard(host, root => root.getElementById('pinInput').value)).toBe('100 Old Road, Houston, TX 77001');
  server.pinNote = 'The address service found no single location.';
  await typeAndSave(host, 'pinInput', '  200 new rd   houston tx  ');
  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0]).toMatchObject({unitKey: 'SPOTTER 002', field: 'address', value: '200 new rd   houston tx', expectedAddressRevision: REVISION});
  await expect.poll(() => toastText(host)).toBe('Saved. The address is saved without a pin: The address service found no single location.');
  expect(await panel(host)).toContain('200 new rd   houston tx');
  // A unit with no address typed yet sends a null revision, and a placed address becomes the unit's pin.
  await inBoard(host, root => root.querySelector('#panel .close').click());
  await inBoard(host, root => root.querySelector('.tile.t-issues').click());
  await openUnit(host, 'Spotter 003');
  server.pinNote = null;
  await pressFix(host, 'Set the address');
  await typeAndSave(host, 'pinInput', '300 Main St, Houston, TX 77002');
  await expect.poll(() => server.sent.length).toBe(2);
  expect(server.sent[1]).toMatchObject({unitKey: 'SPOTTER 003', field: 'address', value: '300 Main St, Houston, TX 77002', expectedAddressRevision: null});
  await expect.poll(() => panel(host)).toContain('Pin is from the address typed by hand in COS, at 29.76000, -95.36000.');
  expect(state.errors).toEqual([]);
});

test('a save that cannot be confirmed stops hand fixes until the person refreshes', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {state, host, server} = await phoneBoard(page);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => fixButtons(host)).toContain('Change site');
  server.fail = {status: 400, error: 'Use the Shop setting to put a unit in the shop; root is not a site name.'};
  await pressFix(host, 'Change site');
  await typeAndSave(host, 'fixInput', 'root');
  await expect.poll(() => toastText(host)).toBe('Not saved. Use the Shop setting to put a unit in the shop; root is not a site name. Tap Refresh before making another fix.');
  expect(server.sent).toHaveLength(1);
  // Nothing is sent again by itself, and nothing more can be sent until a fresh reading is on screen.
  await expect.poll(() => fixButtons(host)).toEqual([]);
  expect(await panel(host)).toContain('The last save could not be confirmed. Tap Refresh before making another fix.');
  expect(await inBoard(host, root => [...root.querySelectorAll('#panel button.lk')].map(button => button.textContent))).not.toContain('Set the address');
  server.fail = null;
  const reads = server.reads;
  await inBoard(host, root => root.getElementById('refresh').click());
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP']);
  expect(server.reads).toBeGreaterThan(reads);
  expect(server.sent).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

for (const [title, flags, says] of [
  ['saved hand fixes that could not be read', {handEditsRead: false}, 'The saved hand fixes could not be read, so a new one cannot be made safely. Tap Refresh to try again.'],
  ['a person who may not edit', {canEdit: false}, 'Hand fixes are for the Owner and IT.'],
]) test('the board only reads for ' + title, async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {state, host, server} = await phoneBoard(page, units, flags);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => panel(host)).toContain(says);
  expect(await fixButtons(host)).toEqual([]);
  // What is left is looking, not changing.
  expect(await inBoard(host, root => [...root.querySelectorAll('#panel button.lk')].map(button => button.textContent))).toEqual(['Show IP', 'Copy IP']);
  expect(server.sent).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('the Tech check tab opens the Tech Check screen COS already has', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, host} = await phoneBoard(page);
  await inBoard(host, root => root.getElementById('tabTech').click());
  await expect.poll(() => app.locator('body').evaluate(() => location.hash)).toBe('#tech-check');
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
});

test('with no camera feed Fleet shows as before', async ({page}) => {
  const {app, state} = await mountFleet(page);
  await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-shared-problem-count', /^\d+$/);
  await expect(app.locator('.cos-board-landing')).toHaveCount(0);
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
