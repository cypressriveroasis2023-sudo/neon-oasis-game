import {test, expect} from '@playwright/test';
import {mountFleet, field, fresh, units as fleetUnits} from './fleet-dashboard-fixtures.mjs';
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
// The older Fleet readout. It is read by its own markup because it may be folded away under the board.
const readout = app => app.locator(".cos-phone-landing p[aria-label='Camera units online, offline and unknown'] b");
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
    if (body.path === '/api/unit-camera-status/link-a') {
      server.linked = [...(server.linked || []), body.body];
      server.units = server.units.map(row => row.unit === body.body.unitKey ? {...row, productId: body.body.productId} : row);
      return route.fulfill({status: 200, headers: cors, json: {...reportOf(server.units, flags), linked: {unit: body.body.unitKey, productId: body.body.productId, label: 'SNIPER 200', by: 'Fixture Owner', duplicate: false}}});
    }
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

test('Fleet opens on the board, counted by the shared count', async ({page}, info) => {
  const phone = info.project.name === 'mobile-390';
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await minis(host)).toEqual(['4in the field', '1in the shop', '0online in shop']);
  // The board's five tabs, as on the board itself.
  expect(await inBoard(host, root => [...root.querySelectorAll('.tab')].filter(tab => !tab.hidden).map(tab => tab.textContent))).toEqual(['Board', 'Map', 'Tech check', 'Punch list', 'Changes']);
  // The board is the Fleet screen at every width. Nothing of the older screen is on it: not its view, not its
  // row of tabs, not its jump button, and no button to bring any of them back.
  const board = app.locator('.cos-board-landing');
  await expect(board).toHaveAttribute('data-board', 'on');
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('.cos-fleet-map-jump')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect(app.getByRole('navigation', {name: 'Fleet dashboard views', exact: true})).toHaveCount(0);
  await expect(app.getByRole('region', {name: 'Phone technician landing'})).toHaveCount(0);
  await expect(board.locator('button')).toHaveCount(0);
  await expect(app.getByText('older Fleet', {exact: false})).toHaveCount(0);
  const box = await board.boundingBox();
  if (phone) {
    // On a phone it runs edge to edge, and the frame Fleet draws round its screen is gone with the rest.
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(390);
    expect(await app.locator('.cos-fleet-dashboard').evaluate(element => getComputedStyle(element).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
  }
  // The older screen's count is still kept underneath, out of sight, and it is the same count: Up is online, Down plus Camera issues is offline.
  await expect(readout(app)).toHaveText(['1', '2', '1']);
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

for (const it of [false, true]) test('Camera Health opens on the same board, for ' + (it ? 'an IT tech' : 'the owner'), async ({page}) => {
  // Camera Health is the other way into this screen. It used to open the older Fleet health view.
  const {app, state} = await mountFleet(page, it, {hash: '#camera-health', cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await expect(app.locator('.cos-board-landing')).toHaveAttribute('data-board', 'on');
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect(app.getByRole('navigation', {name: 'Fleet dashboard views', exact: true})).toHaveCount(0);
  await expect(app.locator('.cos-board-landing button')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('Refresh on the board reads the camera feed again and Fleet follows', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, state, host, server} = await phoneBoard(page);
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  // Spotter 002 comes back before the next read.
  server.units = server.units.map(row => row.unit === 'SPOTTER 002' ? unit('SPOTTER 002', {observedAt: '2026-10-06T17:58:00Z'}) : row);
  await inBoard(host, root => root.getElementById('refresh').click());
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '2'});
  await expect(readout(app)).toHaveText(['2', '1', '1']);
  await expect.poll(() => toastText(host)).toContain('New reading: Star4Live');
  // The message sits above COS's bottom bar, never on top of it.
  const bar = await app.locator('.operations-bottom-nav').boundingBox();
  expect(bar.height).toBeGreaterThan(40);
  const said = await inBoard(host, root => { const box = root.getElementById('toast').getBoundingClientRect(); return {shown: root.getElementById('toast').classList.contains('show'), bottom: box.bottom}; });
  expect(said.shown).toBe(true);
  expect(said.bottom).toBeLessThanOrEqual(bar.y - 8);
  // Asked again before Star4Live has been read again, it says so. It does not call the same reading new.
  await inBoard(host, root => root.getElementById('refresh').click());
  await expect.poll(() => toastText(host)).toMatch(/^No newer Star4Live reading yet\. Last read .+\.$/);
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '2'});
  expect(server.sent).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('the board has one count: mHelp once its list has loaded, with no other way of counting to pick', async ({page}) => {
  // A device that had picked the camera-systems count does not keep it.
  await page.addInitScript(() => { try { localStorage.setItem('cos-count-mode', 'feeds'); } catch {} });
  const record = (id, unitNumber, category, placement, customer) => ({recordId: 'mhelp_product:' + id, productId: String(id), unitNumber, category, placement, uploadLifecycle: 'UNFLAGGED', customer});
  const value = structuredClone(field);
  value.uploadInventory = {
    contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', source: 'mhelpdesk_api', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: 'a'.repeat(64), receivedAt: fresh, lastApiReadAt: fresh,
    // mHelp has Spotter 002 back in the shop and lists a Spotter 009 the camera systems do not see. It lists neither Spotter 004 nor the Sniper.
    records: [record(1, 'Helios 001', 'Helios Solar Tower', 'FIELD', 'Fixture Homes'), record(2, 'Spotter 002', 'Spotter', 'SHOP', 'Shop'), record(3, 'Spotter 003', 'Spotter', 'FIELD', 'Fixture Homes: Lot 3'), record(9, 'Spotter 009', 'Spotter', 'FIELD', 'Fixture Homes: Lot 9')],
    summary: {totalRecords: 4, fieldRecords: 3, shopRecords: 1, unflaggedFieldRecords: 3, doNotUseRecords: 0, missingRecords: 0},
  };
  const {app, state} = await mountFleet(page, false, {cameraStatus: report, field: value});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  // The count is mHelp's: the unit mHelp has in the shop is not down, the one only mHelp lists is counted, and the two it does not list are set aside.
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await minis(host)).toEqual(['3in the field', '1in the shop', '0online in shop', '2not in mHelp']);
  const line = await inBoard(host, root => root.getElementById('modeRow').textContent);
  expect(line).toMatch(/^One count: mHelp, the official list, read .+\. A unit is in the field, at the site mHelp gives, until mHelp shows it back in the shop or it is moved by hand here\.$/);
  // There is nothing to pick, here or on the TV board, and the old choice is forgotten.
  expect(await inBoard(host, root => [root.querySelectorAll('#modeRow button').length, root.getElementById('tvMode'), root.getElementById('cosb').textContent.includes('Camera systems')])).toEqual([0, null, false]);
  expect(await app.locator('body').evaluate(() => localStorage.getItem('cos-count-mode'))).toBeNull();
  expect(state.errors).toEqual([]);
});

test('until the mHelp list has loaded the board marks its count as not the official one', async ({page}) => {
  // James read the board twice within a minute and got two different counts, because the first read came before
  // the mHelp list arrived. Both were honest: without mHelp the board counts the camera records COS holds, a
  // different set of units. That count still shows, because a board with no numbers is worse, but it is marked
  // so it cannot be taken for the official one. A sentence above the tiles did not do that; this does.
  const {host, state} = await phoneBoard(page);
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await inBoard(host, root => [root.getElementById('modeRow').textContent, root.querySelectorAll('#modeRow button').length])).toEqual(['The mHelp list has not loaded, so this shows only what the camera systems can see. It is not the official count.', 0]);
  expect(await minis(host)).toEqual(['4in the field', '1in the shop', '0online in shop']);
  // The mark sits with the numbers: the block carries it, and the caveat is inside the counts, not above them.
  expect(await inBoard(host, root => [
    root.getElementById('kpi').classList.contains('prov'),
    root.getElementById('provNote').hidden,
    root.getElementById('provNote').textContent,
  ])).toEqual([true, false, 'Not the official count. These are what the camera systems can see, until mHelp has loaded.']);
  expect(state.errors).toEqual([]);
});

test('what is fixed by hand is off the punch list and stays off', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const record = (id, unitNumber, category, placement, customer) => ({recordId: 'mhelp_product:' + id, productId: String(id), unitNumber, category, placement, uploadLifecycle: 'UNFLAGGED', customer});
  const value = structuredClone(field);
  value.uploadInventory = {
    contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', source: 'mhelpdesk_api', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: 'a'.repeat(64), receivedAt: fresh, lastApiReadAt: fresh,
    // mHelp has both Spotters in the field. Star4Live has Spotter 002 in the shop; a person moved Spotter 003 to the shop by hand.
    records: [record(1, 'Helios 001', 'Helios Solar Tower', 'FIELD', 'Fixture Homes'), record(2, 'Spotter 002', 'Spotter', 'FIELD', 'Fixture Homes: Lot 2'), record(3, 'Spotter 003', 'Spotter', 'FIELD', 'Fixture Homes: Lot 3')],
    summary: {totalRecords: 3, fieldRecords: 3, shopRecords: 0, unflaggedFieldRecords: 3, doNotUseRecords: 0, missingRecords: 0},
  };
  const byHand = {placement: {value: 'SHOP', by: 'Fixture Owner', role: 'owner', at: fresh, reason: null, providerValue: 'FIELD', providerAgrees: false}};
  const rows = [
    units[0],
    {...units[1], placement: 'SHOP', site: null},
    {...units[2], placement: 'SHOP', site: null, providerPlacement: 'FIELD', providerSite: 'Fixture yard', providerPublicIp: null, handEdits: byHand},
  ];
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(rows), field: value});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  // mHelp wins over Star4Live for Spotter 002, so it is in the field and down. The hand fix wins for Spotter 003, so it is in the shop.
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '0', Unknown: '0', Up: '1'});
  expect(await minis(host)).toEqual(['2in the field', '1in the shop', '1online in shop', '0not in mHelp']);
  // A tile and the list under it can never disagree. Picking a family none of
  // these units belongs to empties the list, so every tile reads zero too. The
  // tiles used to count every unit whatever the chips said, which is how the
  // board came to show "1 online in shop" over a list that said nothing matches.
  await inBoard(host, root => [...root.querySelectorAll('#fam .chip')].find(chip => chip.textContent === 'Recon II').click());
  expect(await minis(host)).toEqual(['0in the field', '0in the shop', '0online in shop', '0not in mHelp']);
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '0', Unknown: '0', Up: '0'});
  await inBoard(host, root => [...root.querySelectorAll('#fam .chip')].find(chip => chip.textContent === 'All').click());
  expect(await minis(host)).toEqual(['2in the field', '1in the shop', '1online in shop', '0not in mHelp']);
  await inBoard(host, root => root.getElementById('tabPunch').click());
  const chips = () => inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].map(chip => chip.textContent));
  // Only the unit nobody has settled is open. The one set by hand is under its own heading, with what mHelp still says.
  await expect.poll(chips).toEqual(['Placed differently · 1', 'Field, no IP in COS · 0', 'Field, no camera feed · 0', 'Field feed, not in mHelp · 0', 'Names differ · 0', 'Shop, no camera feed · 0', 'Shop feed, not in mHelp · 0', 'Router problems · 0', 'Fixed by hand · 1']);
  expect(await inBoard(host, root => [root.querySelector('#punchTop .big').textContent, ...[...root.querySelectorAll('#punchList .prow .name')].map(name => name.textContent)])).toEqual(['1 place where the camera systems disagree with mHelp', 'Spotter 002']);
  await inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].find(chip => chip.textContent.startsWith('Fixed by hand')).click());
  expect(await inBoard(host, root => [root.getElementById('punchCount').textContent, ...[...root.querySelectorAll('#punchList .prow')].map(row => row.textContent)])).toEqual([
    'Set by hand in COS, so these are off the list and stay off. mHelp still shows them differently: make the same change there when you can.',
    'Spotter 003mHelp: Field at Fixture Homes: Lot 3COS, by hand: Shop']);
  expect(state.errors).toEqual([]);
});

test('a corrected IP is saved, and the save says that Up or Down still comes from Star4Live', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {host, state, server} = await phoneBoard(page);
  await openUnit(host, 'Spotter 002');
  await pressFix(host, 'Correct IP');
  await typeAndSave(host, 'fixInput', '203.0.113.77');
  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0]).toMatchObject({unitKey: 'SPOTTER 002', field: 'public_ip', value: '203.0.113.77'});
  await expect.poll(() => toastText(host)).toBe("Saved. Spotter 002 still shows Down: Up or Down comes from Star4Live's own reading of its cameras, so it clears when Star4Live sees them online.");
  // The unit is still down, and the corrected IP is kept on its card as a hand fix.
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await fixButtons(host)).toContain('Undo hand edits');
  expect(state.errors).toEqual([]);
});

test('a hand fix on the board is saved through the Camera status route and shows who made it', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, state, host, server} = await phoneBoard(page);
  await openUnit(host, 'Spotter 002');
  // None of these fixture units has an A#, so Add A# is offered with the other record fixes (James, 25 Nov).
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP', 'Add A#']);
  // What is wrong comes first, then troubleshooting; fixing the record comes after the unit's own pages.
  const heads = await inBoard(host, root => [...root.querySelectorAll('#panel .box > h3')].map(head => head.textContent));
  expect(heads[0]).toBe('Diagnosis');
  expect(heads.indexOf('Fix the record')).toBe(heads.indexOf('Open') + 1);
  await pressFix(host, 'Move to shop');
  // The save says what it did to the count, once the saved reading is on the board.
  await expect.poll(() => toastText(host)).toBe('Saved. The count changed: Down 1 to 0.');
  // Exactly what Camera status sends: the unit's own key, one field, a fresh request id, and nothing about who is asking.
  expect(server.sent).toHaveLength(1);
  expect(Object.keys(server.sent[0]).sort()).toEqual(['field', 'requestId', 'unitKey', 'value']);
  expect(server.sent[0]).toMatchObject({unitKey: 'SPOTTER 002', field: 'placement', value: 'SHOP'});
  expect(server.sent[0].requestId).toMatch(UUID);
  // A unit in the shop is never down, on the board and in the Fleet count alike.
  await expect.poll(() => tiles(host)).toEqual({Down: '0', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(await minis(host)).toEqual(['3in the field', '2in the shop', '0online in shop']);
  await expect(readout(app)).toHaveText(['1', '1', '1']);
  // The unit page says it was set by hand, by whom, and offers the way back.
  const sheet = await panel(host);
  expect(sheet).toContain('Shop · set by hand');
  expect(sheet).toContain('Set by hand on this unit');
  expect(sheet).toContain('Fixture Owner set placement to “Shop”');
  expect(await fixButtons(host)).toEqual(['Move to field', 'Change site', 'Rename', 'Correct IP', 'Add A#', 'Undo hand edits']);
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
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP', 'Add A#']);
  expect(state.errors).toEqual([]);
});

test('moving a shop unit to a site sends the placement, then the site', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {state, host, server} = await phoneBoard(page);
  await inBoard(host, root => [...root.querySelectorAll('.mini')].find(mini => /in the shop/.test(mini.textContent)).click());
  await openUnit(host, 'Sniper 4-100');
  // Every unit can have its IP put right by hand, an Avigilon unit included: COS checks it at that address.
  await expect.poll(() => fixButtons(host)).toEqual(['Move to field', 'Change site', 'Rename', 'Correct IP', 'Add A#']);
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
  await expect.poll(() => fixButtons(host)).toEqual(['Move to shop', 'Change site', 'Rename', 'Correct IP', 'Add A#']);
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

test('the Tech check tab hands an IT sign-in to its own tech checks', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const {app, host} = await phoneBoard(page);
  // An IT sign-in is the one whose manager read is refused. The board then sends the tab to the Tech Check app.
  await inBoard(host, root => root.getElementById('tabTech').click());
  await expect.poll(() => app.locator('body').evaluate(() => location.hash)).toBe('#tech-check');
});

test('a unit asked for from another screen that cannot be opened is explained above the board', async ({page}, info) => {
  const phone = info.project.name === 'mobile-390';
  const {app, state} = await mountFleet(page, false, {hash: '#fleet-dashboard?unitLabel=RANGER%20999', cameraStatus: report});
  const host = app.locator('.cos-board-host'), board = app.locator('.cos-board-landing');
  await expect(host).toBeVisible();
  // Fleet's own words for it, once, where they are seen: above the board.
  const notice = app.locator('.cos-board-notice'), below = app.locator(".cos-fleet-content>p.cos-fleet-message[role='status']");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText('This unit is not in the current inventory. Shop / ROOT and unresolved placement remain available through the placement filters.');
  await expect(below).toHaveText(await notice.textContent());
  await expect(below).toBeHidden();
  await expect(app.getByRole('status').filter({hasText: 'not in the current inventory'})).toHaveCount(1);
  const said = await notice.boundingBox(), drawn = await host.boundingBox();
  expect(said.y + said.height).toBeLessThanOrEqual(drawn.y + 1);
  // On a phone it spans the screen, as the board under it does.
  if (phone) { expect(Math.round(said.x)).toBe(0); expect(Math.round(said.width)).toBe(390); }
  // It is still only the board underneath, and the board is whole: every unit, not only the one asked for.
  await expect(board).toHaveAttribute('data-board', 'on');
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect(app.locator('.cos-fleet-drawer')).toHaveCount(0);
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(state.errors).toEqual([]);
});

test('a unit opened from another screen shows in its own panel, and closing it leaves only the board', async ({page}) => {
  const {app, state} = await mountFleet(page, false, {hash: '#fleet-dashboard?unit=' + fleetUnits[1].id, cameraStatus: report});
  const host = app.locator('.cos-board-host'), board = app.locator('.cos-board-landing');
  await expect(app.locator('.cos-fleet-drawer>h2')).toHaveText('Spotter 1');
  await expect(host).toBeAttached();
  await expect(app.locator('.cos-board-notice')).toHaveCount(0);
  await app.getByRole('button', {name: 'Close unit details', exact: true}).click();
  await expect(app.locator('.cos-fleet-drawer')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-board', 'on');
  await expect(host).toBeVisible();
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  expect(state.errors).toEqual([]);
});

// Holds the app's own read of the camera feed until the test lets it go, so the moment before it arrives can be looked at.
const holdFeed = page => page.addInitScript(() => {
  const real = window.fetch.bind(window);
  let release; const gate = new Promise(resolve => { release = resolve; });
  window.cosTestReleaseFeed = release;
  window.fetch = async (input, init) => { if (String(typeof input === 'string' ? input : input?.url).includes('cos-unit-camera-status')) await gate; return real(input, init); };
});
const shownBefore = page => page.addInitScript(() => { try { localStorage.setItem('cos.fleetBoard.shown', '1'); } catch {} });

test('a device that has shown the board opens straight to it, and the older screen never shows first', async ({page}) => {
  await shownBefore(page);
  await holdFeed(page);
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host'), board = app.locator('.cos-board-landing');
  // The feed has not arrived. The board is already the screen, saying it is loading, and nothing of the older screen shows.
  await expect(host).toBeVisible();
  await expect(board).toHaveAttribute('data-board', 'on');
  expect(await inBoard(host, root => root.getElementById('asofMain').textContent)).toBe('Loading the camera reading…');
  expect(await inBoard(host, root => root.querySelectorAll('.tile').length)).toBe(0);
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect(app.locator('.cos-board-notice')).toHaveCount(0);
  // The feed arrives, and the same screen fills in.
  await app.locator('body').evaluate(() => window.cosTestReleaseFeed());
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await expect(board).toHaveAttribute('data-board', 'on');
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  expect(await app.locator('body').evaluate(() => localStorage.getItem('cos.fleetBoard.shown'))).toBe('1');
  expect(state.errors).toEqual([]);
});

test('the first time on a device, the older screen gives way once the board is on screen, and the device is remembered', async ({page}) => {
  await holdFeed(page);
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  // Nothing says this device shows the board yet, so Fleet is as it was until there is a board to show.
  await expect(app.locator('.cos-fleet-content')).toBeVisible();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeVisible();
  await expect(app.locator('.cos-board-landing')).toHaveCount(0);
  expect(await app.locator('body').evaluate(() => localStorage.getItem('cos.fleetBoard.shown'))).toBeNull();
  await app.locator('body').evaluate(() => window.cosTestReleaseFeed());
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeHidden();
  await expect.poll(() => app.locator('body').evaluate(() => localStorage.getItem('cos.fleetBoard.shown'))).toBe('1');
  expect(state.errors).toEqual([]);
});

test('when the board cannot load on a device that has shown it, Fleet says so above the older screen and can try again', async ({page}) => {
  await shownBefore(page);
  // No camera feed is served: the read fails.
  const {app, state} = await mountFleet(page);
  const notice = app.locator('.cos-board-notice');
  await expect(notice).toContainText('The board could not be loaded, so this is the older Fleet screen.');
  await expect(app.locator('.cos-board-landing')).toHaveAttribute('data-board', 'off');
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
  // Fleet still opens: the older screen stands in, whole.
  await expect(app.locator('.cos-fleet-content')).toBeVisible();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeVisible();
  // The device is no longer taken to show the board, so the next visit does not wait for it.
  expect(await app.locator('body').evaluate(() => localStorage.getItem('cos.fleetBoard.shown'))).toBeNull();
  // The feed comes back. Try again brings the board.
  const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS'};
  await page.route('**/functions/v1/cos-unit-camera-status', route => route.request().method() === 'OPTIONS' ? route.fulfill({status: 204, headers: cors}) : route.fulfill({status: 200, headers: cors, json: report}));
  await notice.getByRole('button', {name: 'Try again', exact: true}).click();
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await expect(app.locator('.cos-board-landing')).toHaveAttribute('data-board', 'on');
  await expect(app.locator('.cos-fleet-content')).toBeHidden();
  await expect(app.locator('.cos-board-notice')).toHaveCount(0);
  await expect.poll(() => app.locator('body').evaluate(() => localStorage.getItem('cos.fleetBoard.shown'))).toBe('1');
  expect(state.errors).toEqual([]);
});

test('a device with the board switched off keeps the older Fleet screen', async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('cos.fleetBoard.off', '1'); } catch {} });
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-shared-problem-count', /^\d+$/);
  await expect(readout(app)).toHaveText(['1', '2', '1']);
  await expect(app.locator('.cos-board-landing')).toHaveCount(0);
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
  await expect(app.locator('.cos-fleet-content')).toBeVisible();
  await expect(app.locator('nav.cos-fleet-tabs')).toBeVisible();
  expect(state.errors).toEqual([]);
});

// Units with a place on the map: two towns far apart, one spot with a mix of states, one spot where both units are down.
const at = (latitude, longitude) => ({location: {latitude, longitude, matchedAddress: null, source: 'hand'}});
const down = name => ({state: 'RED', online: 0, offline: 1, cameraList: [{name: name + ' / Cam 1', status: 'offline', atSite: true}]});
const placed = [
  unit('SPOTTER 101', {...at(29.76, -95.37)}),
  unit('SPOTTER 102', {...at(29.76, -95.37)}),
  unit('SPOTTER 103', {...at(29.76, -95.37), ...down('SPOTTER 103')}),
  unit('SPOTTER 201', {...at(30.27, -97.74), ...down('SPOTTER 201')}),
  unit('SPOTTER 202', {...at(30.27, -97.74), ...down('SPOTTER 202')}),
  unit('SPOTTER 301', {...at(32.78, -96.80)}),
  unit('SPOTTER 401', {...at(27.80, -97.40)}),
];
const mapView = host => inBoard(host, root => {
  const svg = root.getElementById('mapSvg'), box = root.getElementById('mapWrap').getBoundingClientRect();
  const [, tx, ty, z] = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(root.getElementById('mapBase').getAttribute('transform') || '') || [];
  return {x: box.x, y: box.y, w: box.width, h: box.height, tx: +tx, ty: +ty, z: +z, touch: svg.style.touchAction};
});
const MAP_W = 649.5, MAP_H = 660;   // the drawn map, in its own units
// The drawing covers its box on every side. No part of the box is ever left empty.
const covers = view => {
  expect(view.tx).toBeLessThanOrEqual(0.5);
  expect(view.ty).toBeLessThanOrEqual(0.5);
  expect(view.tx + MAP_W * view.z).toBeGreaterThanOrEqual(view.w - 0.5);
  expect(view.ty + MAP_H * view.z).toBeGreaterThanOrEqual(view.h - 0.5);
};

test('the map always fills its box and cannot be dragged out of it, and on a phone a swipe on the whole map scrolls the page', async ({page}, info) => {
  const phone = info.project.name === 'mobile-390';
  const {app, state} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await expect.poll(() => tiles(host)).toEqual({Down: '1', 'Camera issues': '1', Unknown: '1', Up: '1'});
  await inBoard(host, root => root.getElementById('tabMap').click());
  const read = () => mapView(host);
  await expect.poll(async () => (await read()).z).toBeGreaterThan(0);
  const drag = async (dx, dy) => {
    await host.scrollIntoViewIfNeeded();
    const now = await read(), cx = now.x + now.w / 2, cy = now.y + now.h / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let step = 1; step <= 10; step++) await page.mouse.move(cx + dx * step / 10, cy + dy * step / 10);
    await page.mouse.up();
    await page.waitForTimeout(80);
    return read();
  };
  const start = await read();
  covers(start);
  // Dragged hard every way, it stays in its box.
  for (const [dx, dy] of [[0, -900], [0, 900], [-900, 0], [900, 0]]) covers(await drag(dx, dy));
  // Zoomed in there is more drawing than box, so a finger moves the map; it still cannot leave.
  await inBoard(host, root => { for (let press = 0; press < 3; press++) root.getElementById('zin').click(); });
  await expect.poll(async () => (await read()).z).toBeGreaterThan(start.z * 4);
  const close = await read();
  expect(MAP_H * close.z).toBeGreaterThan(close.h);
  expect(close.touch).toBe('none');
  for (const [dx, dy] of [[0, -2000], [0, 2000], [-2000, 0], [2000, 0]]) covers(await drag(dx, dy));
  // Zoomed all the way out the drawing still covers the box: it stops at the size that just fills it.
  await inBoard(host, root => { for (let press = 0; press < 12; press++) root.getElementById('zout').click(); });
  // The drawing is redrawn on the next frame, so wait for it to settle at its smallest size.
  await expect.poll(async () => { const view = await read(); return Math.min(MAP_W * view.z - view.w, MAP_H * view.z - view.h); }).toBeLessThan(0.6);
  const far = await read();
  covers(far);
  if (phone) {
    // On a phone the box has the drawing's own shape, so the whole drawing is in view and an up-or-down swipe is the page's to scroll.
    expect(Math.abs(far.h / far.w - MAP_H / MAP_W)).toBeLessThan(0.01);
    expect(MAP_H * far.z).toBeLessThanOrEqual(far.h + 0.6);
    await expect.poll(async () => (await read()).touch).toBe('pan-y');
  }
  expect(state.errors).toEqual([]);
});

test('on a phone the map opens on the whole drawing when the units are spread across it', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'The whole drawing fits the phone box; a desktop box is wider than the drawing.');
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(placed)});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await inBoard(host, root => root.getElementById('tabMap').click());
  await expect.poll(async () => (await mapView(host)).z).toBeGreaterThan(0);
  // Fitting these units alone would zoom in by a hair and leave a drawing that eats every swipe. It opens on all of it instead.
  await expect.poll(async () => { const view = await mapView(host); return Math.abs(view.z - view.w / MAP_W); }).toBeLessThan(0.002);
  const view = await mapView(host);
  covers(view);
  expect(MAP_H * view.z).toBeLessThanOrEqual(view.h + 0.6);
  expect(view.touch).toBe('pan-y');
  expect(state.errors).toEqual([]);
});

test('a spot with units in more than one state is a ring with its own count of down units, never one red circle', async ({page}) => {
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(placed)});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await inBoard(host, root => root.getElementById('tabMap').click());
  const pins = () => inBoard(host, root => [...root.querySelectorAll('#mapPins .pin')].map(pin => ({
    label: pin.getAttribute('aria-label'), ring: pin.querySelectorAll('.arc').length, mixed: Boolean(pin.querySelector('.mixbase')),
    total: pin.querySelector('text.mix')?.textContent ?? pin.querySelector('text:not(.badn)')?.textContent ?? '',
    down: pin.querySelector('text.badn')?.textContent ?? '', fill: pin.querySelector('circle:not(.ring):not(.mixbase):not(.arc):not(.bad)')?.getAttribute('fill') ?? '',
  })).sort((a, b) => a.label.localeCompare(b.label)));
  await expect.poll(async () => (await pins()).length).toBe(4);
  expect(await pins()).toEqual([
    // Both units here are down, so the circle is red and says two.
    {label: '2 units here: 2 Down', ring: 0, mixed: false, total: '2', down: '', fill: 'var(--down)'},
    // One of three is down. The ring shows the mix, the middle says three, and the red number says one.
    {label: '3 units here: 1 Down, 2 Up', ring: 2, mixed: true, total: '3', down: '1', fill: ''},
    {label: 'Spotter 301, Up', ring: 0, mixed: false, total: '', down: '', fill: 'var(--up)'},
    {label: 'Spotter 401, Up', ring: 0, mixed: false, total: '', down: '', fill: 'var(--up)'},
  ]);
  // The counts above the map are its key, each with the colour of its pins.
  expect(await inBoard(host, root => [...root.querySelectorAll('#mapChips .chip')].map(chip => [chip.textContent, chip.querySelector('.dot')?.className ?? '']))).toEqual([
    ['All 7', ''], ['Down 3', 'dot s-down'], ['Camera issues 0', 'dot s-issues'], ['Unknown 0', 'dot s-unknown'], ['Up 4', 'dot s-up'],
  ]);
  expect(await inBoard(host, root => root.getElementById('mapNote').textContent)).toContain('A ring is a mix, and its red number is how many are down.');
  // Asking for the down units alone leaves only them: the mixed spot becomes one red pin.
  await inBoard(host, root => [...root.querySelectorAll('#mapChips .chip')].find(chip => chip.textContent.startsWith('Down')).click());
  await expect.poll(async () => (await pins()).map(pin => pin.label)).toEqual(['2 units here: 2 Down', 'Spotter 103, Down']);
  expect(state.errors).toEqual([]);
});

test('on a desk the board is one screen: a slim bar, the counts in a row, the list and the live map side by side, and a count tile filters both', async ({page}, info) => {
  const {app, host, state} = await phoneBoard(page, placed);
  const layout = () => inBoard(host, root => {
    const box = id => { const r = root.getElementById(id).getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom}; };
    return {wide: root.getElementById('cosb').classList.contains('wide'), side: !root.getElementById('boardSide').hidden, mapIn: root.getElementById('mapBlock').parentNode.id,
      main: box('boardList'), map: box('mapWrap'), board: box('cosb'), tall: innerHeight, across: innerWidth,
      tabsInBar: Boolean(root.querySelector('.tabs').closest('.top')), page: document.documentElement.scrollHeight,
      countTops: [...new Set([...root.querySelectorAll('.tile, .mini')].map(item => Math.round(item.getBoundingClientRect().top)))].length,
      listScrolls: getComputedStyle(root.getElementById('boardList')).overflowY, rowTall: Math.round(root.querySelector('#list .row').getBoundingClientRect().height),
      shown: ['mapChips', 'mapNote', 'mapList'].filter(id => root.getElementById(id).getClientRects().length > 0),
      pins: [...root.querySelectorAll('#mapPins .pin')].map(pin => pin.getAttribute('aria-label')).sort()};
  });
  const tile = label => inBoard(host, (root, wanted) => [...root.querySelectorAll('.tile')].find(item => item.querySelector('.lab').textContent === wanted).click(), label);
  if (info.project.name !== 'desktop-1440') {
    // James: "I wish this would show me the map and all units online and offline in the field right when I log
    // in and go to the home page." There is no room beside the list on a phone or a small window, so the map
    // goes under the counts and above the list instead of a tab away. It is the same map moved, with its pins,
    // and the map tab's own filters and list stay off it there.
    await expect.poll(async () => (await layout()).pins.length).toBeGreaterThan(0);
    expect(await layout()).toMatchObject({wide: false, side: false, mapIn: 'boardMain', shown: [], tabsInBar: false});
    // Moved, not copied: one map in the document, and it sits between the counts and the list.
    expect(await inBoard(host, root => [
      root.querySelectorAll('#mapWrap').length,
      [...root.getElementById('boardMain').children].map(child => child.id),
    ])).toEqual([1, ['modeRow', 'kpi', 'mapBlock', 'boardList']]);
    return;
  }
  await expect.poll(async () => (await layout()).pins.length).toBeGreaterThan(0);
  const first = await layout();
  expect(first).toMatchObject({wide: true, side: true, mapIn: 'boardSide', shown: []});
  // No frame and no page title: the board starts at the menu's edge and the top of the window, and reaches the right edge.
  await expect(app.locator('.company-utility-bar')).toBeHidden();
  const menu = await app.locator('aside.operations-sidebar').evaluate(element => element.getBoundingClientRect().right);
  expect(Math.abs(first.board.x - menu)).toBeLessThanOrEqual(1);
  expect(first.board.y).toBeLessThanOrEqual(1);
  expect(Math.abs(first.board.right - first.across)).toBeLessThanOrEqual(1);
  // One screen: the board is exactly as tall as the window and the page itself has nothing to scroll.
  expect(Math.abs(first.board.h - first.tall)).toBeLessThanOrEqual(1);
  expect(first.page).toBeLessThanOrEqual(first.tall + 1);
  // The tabs sit in the top bar, and every count is in one row under it.
  expect(first).toMatchObject({tabsInBar: true, countTops: 1});
  // Side by side: the list on the left with room of its own, the map beside it, all of the map on screen in its own shape.
  expect(first.main.right).toBeLessThanOrEqual(first.map.x);
  expect(first.main.w).toBeGreaterThanOrEqual(480);
  expect(first.map.h).toBeGreaterThanOrEqual(420);
  expect(first.map.bottom).toBeLessThanOrEqual(first.tall + 1);
  expect(Math.abs(first.map.w / first.map.h - 649.5 / 660)).toBeLessThan(0.02);
  // The list scrolls inside its own pane, which ends at the bottom of the window, and a unit is one line in it.
  expect(first.listScrolls).toBe('auto');
  expect(first.main.bottom).toBeLessThanOrEqual(first.tall + 1);
  expect(first.rowTall).toBeLessThan(50);
  // The board opens on what is down, and so does the map beside it.
  expect(first.pins).toEqual(['2 units here: 2 Down', 'Spotter 103, Down']);
  await tile('Up');
  await expect.poll(async () => (await layout()).pins).toEqual(['2 units here: 2 Up', 'Spotter 301, Up', 'Spotter 401, Up']);
  // Tapping the same tile again shows every field unit, in the list and on the map.
  await tile('Up');
  await expect.poll(async () => (await layout()).pins).toEqual(['2 units here: 2 Down', '3 units here: 1 Down, 2 Up', 'Spotter 301, Up', 'Spotter 401, Up']);
  // The Map tab still has the one map to itself, showing everything, with its own key.
  await tile('Down');
  await inBoard(host, root => root.getElementById('tabMap').click());
  await expect.poll(async () => (await layout()).mapIn).toBe('viewMap');
  const alone = await layout();
  expect(alone).toMatchObject({side: false, shown: ['mapChips', 'mapNote', 'mapList']});
  expect(alone.pins).toHaveLength(4);
  expect(alone.map.w).toBeGreaterThan(first.map.w);
  expect(await inBoard(host, root => root.querySelector('#mapChips .chip[aria-pressed="true"]').textContent)).toBe('All 7');
  // Back on the Board tab the map is beside the list again.
  await inBoard(host, root => root.getElementById('tabBoard').click());
  await expect.poll(async () => (await layout()).mapIn).toBe('boardSide');
  await expect.poll(async () => (await layout()).pins).toEqual(['2 units here: 2 Down', 'Spotter 103, Down']);
  // A unit opens in a panel at the side, with the board still in view behind it.
  await openUnit(host, 'Spotter 103');
  const drawer = await inBoard(host, root => { const r = root.getElementById('panel').getBoundingClientRect(); return {x: r.x, right: r.right, w: r.width}; });
  expect(drawer.x).toBeGreaterThan(first.board.x + first.board.w * 0.45);
  expect(Math.abs(drawer.right - first.across)).toBeLessThanOrEqual(1);
  expect(state.errors).toEqual([]);
});

test('with no camera feed Fleet shows as before', async ({page}) => {
  const {app, state} = await mountFleet(page);
  await expect(app.locator('.cos-fleet-dashboard')).toHaveAttribute('data-shared-problem-count', /^\d+$/);
  await expect(app.locator('.cos-board-landing')).toHaveCount(0);
  await expect(app.locator('.cos-board-host')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('the other COS screens open from the board, by the names IT sees', async ({page}) => {
  const {app} = await mountFleet(page, false, {cameraStatus: report});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  const screens = root => [...root.querySelectorAll('#screensLinks button')].map(button => button.textContent);
  await expect.poll(() => inBoard(host, screens)).toEqual(['Camera Health', 'InHand Routers', 'Victron Power', '2027 Unit Tracker']);
  expect(await inBoard(host, root => root.getElementById('screensRow').hidden)).toBe(false);
  // The board says why COS's three counts differ, so nobody has to ask.
  expect(await inBoard(host, root => root.querySelector('.foot').textContent)).toContain('counts stands and poles as well');
  await inBoard(host, root => { [...root.querySelectorAll('#screensLinks button')].find(button => button.textContent === 'Camera Health').click(); });
  await expect.poll(() => host.evaluate(element => element.ownerDocument.defaultView.location.hash)).toBe('#camera-health');
});

test('Moved in VCC lists camera records VCC disagrees with, and one tap fixes one', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  // James, 25 Nov: a camera moved from 253 to 265 in VCC stayed under 253 in COS. VCC is right about its own cameras.
  const record = (id, unitNumber, category, placement, customer) => ({recordId: 'mhelp_product:' + id, productId: String(id), unitNumber, category, placement, uploadLifecycle: 'UNFLAGGED', customer});
  const value = structuredClone(field);
  value.uploadInventory = {
    contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', source: 'mhelpdesk_api', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: 'c'.repeat(64), receivedAt: fresh, lastApiReadAt: fresh,
    records: [record(1, 'Helios 001', 'Helios Solar Tower', 'FIELD', 'Fixture Homes'), record(2, 'Spotter 002', 'Spotter', 'FIELD', 'Fixture Homes: Lot 2')],
    summary: {totalRecords: 2, fieldRecords: 2, shopRecords: 0, unflaggedFieldRecords: 2, doNotUseRecords: 0, missingRecords: 0},
  };
  const moved = {key: 'moved:sn-moved-1', kind: 'moved', cameraId: 7, serial: 'SN-MOVED-1', vccName: 'Spotter 002 CAM 4', cosName: 'Helios 001 Cam 2', fromUnit: 'HELIOS 001', toUnit: 'SPOTTER 002', canApply: true, why: 'VCC names this camera for SPOTTER 002. COS has it under HELIOS 001.'};
  const renamed = {key: 'moved:sn-ren', kind: 'moved', rename: true, cameraId: 8, serial: 'SN-REN', vccName: 'Spotter 002 CAM 4', cosName: 'Spotter 002 CAM 1', fromUnit: 'SPOTTER 002', toUnit: 'SPOTTER 002', canApply: true, why: 'VCC calls this camera Spotter 002 CAM 4. COS calls it Spotter 002 CAM 1.'};
  const shop = {key: 'new:sn-shop', kind: 'new', serial: 'SN-SHOP', vccName: 'Shop', toUnit: null, canApply: false, why: 'Its VCC name gives no unit.'};
  const vccMoves = {fresh: true, syncedAt: fresh, items: [moved, renamed, shop]};
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(units, {vccMoves}), field: value, skipInitialFieldCount: true});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  const sent = [];
  await page.route('**/functions/v1/cos-unit-camera-status', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const envelope = JSON.parse(request.postData() || '{}');
    if (envelope.path !== '/api/unit-camera-status/vcc-move') return route.fallback();
    sent.push(envelope.body);
    return route.fulfill({status: 200, headers: {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
      json: {...reportOf(units, {vccMoves: {fresh: true, syncedAt: fresh, items: [renamed, shop]}}), vccMoved: {key: moved.key, kind: 'moved', unit: 'SPOTTER 002', name: 'Spotter 002 CAM 4', state: 'active', by: 'Fixture Owner'}}});
  });
  await inBoard(host, root => root.getElementById('tabPunch').click());
  const chips = () => inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].map(chip => chip.textContent));
  await expect.poll(chips).toContain('Moved in VCC \u00b7 3');
  await inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].find(chip => chip.textContent.startsWith('Moved in VCC')).click());
  const shown = await inBoard(host, root => root.getElementById('viewPunch').textContent);
  expect(shown).toContain('VCC names this camera for SPOTTER 002');
  expect(shown).toContain('Its VCC name gives no unit');
  // Only the item with one safe answer gets a button.
  expect(await inBoard(host, root => [...root.querySelectorAll('#punchList .pdone')].map(b => b.textContent))).toEqual(['Move it', "Use VCC's name"]);
  expect(shown).toContain('Camera number differs from VCC');
  await inBoard(host, root => root.querySelector('#punchList .pdone').click());
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({key: 'moved:sn-moved-1'});
  await expect.poll(() => toastText(host)).toContain('Spotter 002 CAM 4 is now on SPOTTER 002');
  await expect.poll(chips).toContain('Moved in VCC \u00b7 2');
  expect(state.errors).toEqual([]);
});

test('a field unit COS cannot check at all is a job on the punch list', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const record = (id, unitNumber, category, placement, customer) => ({recordId: 'mhelp_product:' + id, productId: String(id), unitNumber, category, placement, uploadLifecycle: 'UNFLAGGED', customer});
  const value = structuredClone(field);
  value.uploadInventory = {
    contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', source: 'mhelpdesk_api', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: 'b'.repeat(64), receivedAt: fresh, lastApiReadAt: fresh,
    records: [record(1, 'Helios 001', 'Helios Solar Tower', 'FIELD', 'Fixture Homes'), record(2, 'Spotter 002', 'Spotter', 'FIELD', 'Fixture Homes: Lot 2'),
      record(9, 'Sniper 401', 'Sniper 2', 'FIELD', 'Fixture Homes: Lot 9')],
    summary: {totalRecords: 3, fieldRecords: 3, shopRecords: 0, unflaggedFieldRecords: 3, doNotUseRecords: 0, missingRecords: 0},
  };
  // COS checks a Sniper by pinging a saved address. This one has none, so it can only ever show Unknown.
  const rows = [units[0], units[1], unit('SNIPER 401', {state: 'UNKNOWN', online: 0, unknown: 1, source: 'ip_check', publicIp: null,
    site: 'Fixture yard', observedAt: '2026-10-01T00:00:00Z', cameraList: [{name: 'SNIPER 401 / Cam 1', status: 'unknown', atSite: true}]})];
  const {app, state} = await mountFleet(page, false, {cameraStatus: reportOf(rows), field: value});
  const host = app.locator('.cos-board-host');
  await expect(host).toBeVisible();
  await inBoard(host, root => root.getElementById('tabPunch').click());
  const chips = () => inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].map(chip => chip.textContent));
  await expect.poll(chips).toContain('Field, no IP in COS \u00b7 1');
  await inBoard(host, root => [...root.querySelectorAll('#punchChips .chip')].find(chip => chip.textContent.startsWith('Field, no IP in COS')).click());
  const shown = await inBoard(host, root => root.getElementById('viewPunch').textContent);
  expect(shown).toContain('Sniper 401');
  expect(shown).toContain('no IP address saved, so this unit has never been checked');
  expect(shown).toContain('open the unit and add the IP under Fix the record');
  expect(shown).not.toContain('Helios 001');
  expect(state.errors).toEqual([]);
});

test('a Sniper with no IP saved says why it is Unknown and sends you to the fix', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  // COS pings a saved address to tell whether a Sniper is up. With no address there is nothing to ping.
  const rows = [...units, unit('SNIPER 400', {state: 'UNKNOWN', online: 0, unknown: 1, source: 'ip_check', publicIp: null,
    observedAt: '2026-10-01T00:00:00Z', cameraList: [{name: 'SNIPER 400 / Cam 1', status: 'unknown', atSite: true}]})];
  const {host, state} = await phoneBoard(page, rows);
  // The list opens on Down; this unit is one of the Unknown.
  await inBoard(host, root => [...root.querySelectorAll('.tile')].find(tile => tile.querySelector('.lab').textContent === 'Unknown').click());
  await openUnit(host, 'Sniper 400');
  const card = await panel(host);
  expect(card).toContain('COS has no IP address for this unit, so it cannot be checked at all');
  expect(card).toContain('Add the IP under Fix the record');
  // Not the answer for a unit COS cannot reach at all.
  expect(card).not.toContain('Tap Refresh on the board. If it stays Unknown');
  expect(await fixButtons(host)).toContain('Correct IP');
  expect(state.errors).toEqual([]);
});

test('a corrected IP can be saved on any unit, and the save names the system that still decides Up or Down', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  // A Sniper's reading is COS's own check of the address, so the IP is the one fix that matters most on it.
  const rows = [...units, unit('SNIPER 200', {state: 'RED', online: 0, offline: 1, source: 'ip_check', publicIp: '203.0.113.9',
    cameraList: [{name: 'SNIPER 200 / Cam 1', status: 'offline', atSite: true}]})];
  const {host, server, state} = await phoneBoard(page, rows);
  await openUnit(host, 'Sniper 200');
  expect(await fixButtons(host)).toContain('Correct IP');
  await pressFix(host, 'Correct IP');
  await typeAndSave(host, 'fixInput', '203.0.113.77');
  await expect.poll(() => server.sent.length).toBe(1);
  expect(server.sent[0]).toMatchObject({unitKey: 'SNIPER 200', field: 'public_ip', value: '203.0.113.77'});
  await expect.poll(() => toastText(host)).toBe("Saved. Sniper 200 still shows Down: Up or Down comes from COS's own check of this unit, so it clears at the next check that finds its cameras online.");
  expect(state.errors).toEqual([]);
});


test('a unit with no A# can be given one from the card, and Check it now then uses it', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  // James, 25 Nov: "it says it doesnt have an a# but i cant add it manualy". Tech Check checks who and which A#.
  const rows = [...units, unit('SNIPER 200', {state: 'RED', online: 0, offline: 1, source: 'ip_check', publicIp: '203.0.113.9',
    cameraList: [{name: 'SNIPER 200 / Cam 1', status: 'offline', atSite: true}]})];
  const {host, server, state} = await phoneBoard(page, rows);
  await openUnit(host, 'Sniper 200');
  expect(await panel(host)).toContain('Add it under Fix the record with Add A#');
  expect(await fixButtons(host)).toContain('Add A#');
  await pressFix(host, 'Add A#');
  await typeAndSave(host, 'fixInput', 'A# 2226712');
  await expect.poll(() => (server.linked || []).length).toBe(1);
  expect(server.linked[0]).toEqual({unitKey: 'SNIPER 200', productId: '2226712'});
  await expect.poll(() => toastText(host)).toContain('A# 2226712 linked');
  // With an A# the card offers the check, and no longer offers Add A#.
  await expect.poll(() => fixButtons(host)).not.toContain('Add A#');
  expect(await inBoard(host, root => [...root.querySelectorAll('#panel .tools .tool b')].map(b => b.textContent))).toContain('Check this unit now');
  expect(state.errors).toEqual([]);
});

test('a unit with cameras off names them and walks a tech through it without leaving COS', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'the board is the phone Fleet screen');
  const record = (id, unitNumber, placement) => ({recordId: 'mhelp_product:' + id, productId: String(id), unitNumber, category: 'Spotter', placement, uploadLifecycle: 'UNFLAGGED', customer: 'Fixture Homes'});
  const value = structuredClone(field);
  value.uploadInventory = {contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', source: 'mhelpdesk_api', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: 'a'.repeat(64), receivedAt: fresh, lastApiReadAt: fresh,
    records: [record(3, 'Spotter 003', 'FIELD')], summary: {totalRecords: 1, fieldRecords: 1, shopRecords: 0, unflaggedFieldRecords: 1, doNotUseRecords: 0, missingRecords: 0}};
  // Each camera carries its forwarded web port; the card links Web and HTTPS for it.
  const withPorts = structuredClone(report);
  for (const unit of withPorts.units) if (unit.cameraList) unit.cameraList = unit.cameraList.map((camera, i) => ({...camera, port: [1400, 1500, 1600, 1700][i] ?? undefined}));
  for (const unit of withPorts.units) if (/SPOTTER 003/i.test(unit.unit)) unit.publicIp = '203.0.113.130';
  const {app, state} = await mountFleet(page, false, {cameraStatus: withPorts, field: value, skipInitialFieldCount: true});
  const host = app.locator('.cos-board-host');
  await expect.poll(() => tiles(host)).toMatchObject({'Camera issues': '1'});
  await inBoard(host, root => [...root.querySelectorAll('.tile')].find(tile => tile.querySelector('.lab').textContent === 'Camera issues').click());
  await openUnit(host, 'Spotter 003');
  const card = await panel(host);
  const camLinks = await inBoard(host, root => [...root.querySelectorAll('#panel .camlinks a')].map(a => a.textContent + ' ' + new URL(a.href).port));
  expect(camLinks.slice(0, 4)).toEqual(['Web 1400', 'HTTPS 1443', 'Web 1500', 'HTTPS 1543']);
  // SIM and cell signal tools sit in the Open box (James, 25 Nov).
  expect(await inBoard(host, root => [...root.querySelectorAll('#panel .simtools a')].map(a => a.textContent + ' ' + new URL(a.href).host))).toEqual(['Coverage map map.coveragemap.com', 'Downdetector downdetector.com', 'Simetry simetry.onelogin.com']);
  if (process.env.SHOT) { await inBoard(host, root => root.querySelector('#panel .camlinks')?.closest('.box')?.scrollIntoView()); await page.screenshot({path: process.env.SHOT.replace('.png', '-cams.png')}); }
  // The diagnosis names the camera that is off, instead of saying "listed below".
  expect(card).toContain('Off: SPOTTER 003 / Cam 2');
  expect(card).not.toContain('listed below');
  const heads = await inBoard(host, root => [...root.querySelectorAll('#panel .box > h3')].map(head => head.textContent));
  expect(heads.indexOf('Troubleshoot')).toBeGreaterThan(heads.indexOf('Diagnosis'));
  // James: the tools must not blend in. A bright bar right under the diagnosis names them and jumps to them.
  expect(await inBoard(host, root => [...root.querySelectorAll('#panel .tools .tool b')].map(b => b.textContent))).toContain('Troubleshoot');
  expect(await inBoard(host, root => root.querySelector('#panel .tools')?.previousElementSibling?.querySelector('h3')?.textContent)).toBe('Diagnosis');
  expect(heads.indexOf('Troubleshoot')).toBeLessThan(heads.indexOf('Fix the record'));
  const answer = label => inBoard(host, (root, wanted) => { const b = [...root.querySelectorAll('#panel .trbtn')].find(x => x.textContent === wanted); b?.click(); return Boolean(b); }, label);
  if (process.env.SHOT) { await inBoard(host, root => root.querySelector('#panel .tools').scrollIntoView({block: 'center'})); await page.screenshot({path: process.env.SHOT.replace('.png', '-top.png')}); }
  expect(await answer('No, or not sure')).toBe(true);
  if (process.env.SHOT) { await inBoard(host, root => root.querySelector('#panel .trb').scrollIntoView()); await page.screenshot({path: process.env.SHOT.replace('.png', '-step.png')}); }
  // Every step points somewhere in COS, never to Star4Live.
  expect(await inBoard(host, root => root.querySelector('#panel .trb').textContent)).not.toMatch(/Star4Live/);
  for (const label of ['Still off', 'Yes, it answers', 'Still off']) {
    if (!(await answer(label))) break;
  }
  await expect.poll(() => inBoard(host, root => root.querySelector('#panel .trres')?.textContent || '')).toContain('Manager help');
  // Send to IT: the result goes to COS for the next IT sheet, with the note as shown and nothing scheduled.
  const sent = [];
  await page.route('**/functions/v1/cos-unit-camera-status', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const envelope = JSON.parse(request.postData() || '{}');
    if (envelope.path !== '/api/unit-camera-status/troubleshoot') return route.fallback();
    sent.push(envelope.body);
    return route.fulfill({status: 200, headers: {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
      json: {contract: 'COS_TROUBLESHOOT_SENT_V1', id: envelope.body.requestId, recordedAt: '2026-11-25T18:00:00Z', by: 'Fixture Owner', duplicate: false}});
  });
  expect(await inBoard(host, root => { const b = root.querySelector('#panel .trsend'); b?.click(); return Boolean(b); })).toBe(true);
  await expect.poll(() => inBoard(host, root => root.querySelector('#panel .trsent')?.textContent || '')).toContain('Sent to IT by Fixture Owner');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({unitName: 'Spotter 003', managerHelp: true, result: 'The camera itself is likely bad'});
  expect(sent[0].note).toContain('SPOTTER 003 / Cam 2 is off');
  expect(sent[0].note).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  expect(await inBoard(host, root => root.querySelector('#panel .trnote').textContent)).toContain('SPOTTER 003 / Cam 2 is off');
  // Answering troubleshooting writes nothing anywhere.
  expect(state.errors).toEqual([]);
  if (process.env.SHOT) { await inBoard(host, root => root.querySelector('#panel .trb').scrollIntoView()); await page.screenshot({path: process.env.SHOT}); }
});
