import {test, expect} from '@playwright/test';
import {openWorkspace} from './navigation-helper.mjs';
import {manager, mount, unit, reportOf, inBoard} from './manager-view-fixtures.mjs';

// The TV board is the COS Board drawn large, on the real Tech Check host around the real built app.
const at = (latitude, longitude) => ({location: {latitude, longitude, matchedAddress: null, source: 'hand'}});
const down = name => ({state: 'RED', online: 0, offline: 1, cameraList: [{name: name + ' / Cam 1', status: 'offline', atSite: true}]});
const placed = [
  unit('SPOTTER 101', {...at(29.76, -95.37)}), unit('SPOTTER 102', {...at(29.78, -95.40)}),
  unit('SPOTTER 103', {...at(29.74, -95.33), ...down('SPOTTER 103'), site: 'Fixture depot'}),
  unit('SPOTTER 201', {...at(30.27, -97.74), ...down('SPOTTER 201'), site: 'Fixture lot'}), unit('SPOTTER 202', {...at(30.30, -97.70)}),
  unit('SPOTTER 301', {...at(32.78, -96.80)}),
  unit('SPOTTER 302', {...at(32.75, -97.33), state: 'YELLOW', cameras: 2, offline: 1, site: 'Fixture plaza',
    cameraList: [{name: 'SPOTTER 302 / Cam 1', status: 'online', atSite: true}, {name: 'SPOTTER 302 / Cam 2', status: 'offline', atSite: true}]}),
  unit('SPOTTER 401', {...at(29.42, -98.49)}),
  unit('SNIPER 101', {placement: 'SHOP', site: null, source: 'ip_check'}),
];
const tv = host => inBoard(host, root => {
  const shown = id => root.getElementById(id).getClientRects().length > 0, text = id => root.getElementById(id).textContent;
  return {
    on: root.getElementById('cosb').classList.contains('tv'), screen: shown('viewTv'), board: root.querySelector('main.wrap').getClientRects().length > 0,
    tiles: [...root.querySelectorAll('#tvTiles .tile')].map(tile => tile.querySelector('.num').textContent + ' ' + tile.querySelector('.lab').textContent),
    minis: [...root.querySelectorAll('#tvMinis span')].map(mini => mini.textContent), head: text('tvHead'),
    rows: [...root.querySelectorAll('#tvList .tvrow')].map(row => [...row.children].map(child => child.textContent).join(' | ')),
    title: text('tvMapTitle'), mapIn: root.getElementById('mapWrap').parentNode.id, pins: root.querySelectorAll('#mapPins .pin').length,
    read: text('tvRead'), clock: text('tvClock'), note: text('tvNote'),
  };
});
const boardTiles = host => inBoard(host, root => [...root.querySelectorAll('#tiles .tile')].map(tile => tile.querySelector('.num').textContent + ' ' + tile.querySelector('.lab').textContent));
const frameStyle = page => page.locator('#cosOperationsFrame').evaluate(frame => ({position: frame.style.position, inset: frame.style.inset}));

test('the TV board is the board drawn large: the same count, the down units by name, and the map walked area by area', async ({page}, info) => {
  const {frame, host, errors} = await mount(page, {manager: manager()}, reportOf(placed));
  await expect.poll(async () => (await boardTiles(host)).length).toBe(4);
  const counted = await boardTiles(host);
  expect(counted).toEqual(['2 Down', '1 Camera issues', '0 Unknown', '5 Up']);
  const wide = info.project.name === 'desktop-1440';
  // On a desk the board has a TV button. Everywhere, Boards opens the TV board.
  expect(await inBoard(host, root => root.getElementById('tvGo').getClientRects().length > 0)).toBe(wide);
  if (wide) await inBoard(host, root => root.getElementById('tvGo').click());
  else await openWorkspace(frame, 'Daily Board');
  await expect.poll(async () => (await tv(host)).on).toBe(true);
  await expect.poll(async () => (await tv(host)).pins).toBeGreaterThan(0);
  const first = await tv(host);
  expect(first).toMatchObject({on: true, screen: true, board: false, mapIn: 'tvMap'});
  // One count, drawn two ways.
  expect(first.tiles).toEqual(counted);
  expect(first.minis).toEqual(['8in the field', '1in the shop', '0online in shop']);
  // What needs someone, by name: down first, then camera issues.
  expect(first.head).toBe('2 down · 1 with camera issues');
  expect(first.rows).toEqual([
    'Spotter 103 | Down | Fixture depot · 0 of 1 online', 'Spotter 201 | Down | Fixture lot · 0 of 1 online', 'Spotter 302 | Camera issues | Fixture plaza · 1 of 2 online',
  ]);
  expect(first.read).toBe('Star4Live read Tue 12:55 PM · 5 min ago');
  expect(first.clock).toBe('1:00 PM');
  expect(first.note).toContain('A unit in the shop never counts as down.');
  expect(first.title).toBe('All field units · 8 units · 2 down · 1 with camera issues1 / 5');
  // The Tech Check app around the frame gives the TV the whole window.
  await expect.poll(() => frameStyle(page)).toEqual({position: 'fixed', inset: '0px'});
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  // It turns by itself. An arrow key steps it by hand: each area in turn, then round again.
  const titles = [first.title];
  // A key goes to the frame once someone has clicked in it, as the person who opened the TV board has.
  await host.click({position: {x: 20, y: 20}});
  for (let step = 0; step < 5; step += 1) { await page.keyboard.press('ArrowRight'); titles.push((await tv(host)).title); }
  expect(titles.slice(1)).toEqual([
    'Houston · 3 units · 1 down2 / 5', 'Austin · 2 units · 1 down3 / 5', 'San Antonio · 1 unit4 / 5', 'Dallas–Fort Worth · 2 units · 1 with camera issues5 / 5',
    'All field units · 8 units · 2 down · 1 with camera issues1 / 5',
  ]);

  // Escape closes it: the board is back as it was, with its one map where it belongs, and the window is handed back.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await tv(host)).on).toBe(false);
  const after = await tv(host);
  expect(after).toMatchObject({screen: false, board: true});
  expect(['mapBlock']).toContain(after.mapIn);
  expect(await boardTiles(host)).toEqual(counted);
  await expect.poll(() => frameStyle(page)).toEqual({position: '', inset: ''});
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#fleet-dashboard');
  expect(errors).toEqual([]);
});

test('Boards opens the TV board on a device that shows the board, and its Exit button leads back to the board', async ({page}) => {
  const {frame, host} = await mount(page, {manager: manager()}, reportOf(placed));
  await expect.poll(async () => (await boardTiles(host)).length).toBe(4);
  await openWorkspace(frame, 'Daily Board');
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#fleet-dashboard');
  await expect.poll(async () => (await tv(host)).on).toBe(true);
  // Nothing of the older Daily Board is on screen.
  await expect(frame.locator('.cos-daily-board')).toHaveCount(0);
  await expect.poll(() => frameStyle(page)).toEqual({position: 'fixed', inset: '0px'});
  const exits = await inBoard(host, root => ['tvExit', 'tvExitTop'].filter(id => root.getElementById(id).getClientRects().length > 0));
  expect(exits.length).toBeGreaterThan(0);
  await inBoard(host, (root, id) => root.getElementById(id).click(), exits[0]);
  await expect.poll(async () => (await tv(host)).on).toBe(false);
  expect(await tv(host)).toMatchObject({screen: false, board: true});
  await expect.poll(() => frameStyle(page)).toEqual({position: '', inset: ''});
});
