import {test, expect} from '@playwright/test';
import {openWorkspace} from './navigation-helper.mjs';
import {now} from './fleet-dashboard-fixtures.mjs';
import {RILEY, manager, mount, inBoard, seen, textOf, press, fill, rpcCalls, openManager} from './manager-view-fixtures.mjs';

test('the owner gets a Manager tab instead of a tech check, and Tech Check opens it', async ({page}) => {
  const {frame, host, errors} = await mount(page);
  // The manager view is offered by the Tech Check app around the board, to the owner sign-in.
  await expect.poll(() => seen(host, 'tabManager')).toBe(true);
  expect(await seen(host, 'tabTech')).toBe(false);
  expect(await inBoard(host, root => [...root.querySelectorAll('.tab')].filter(tab => !tab.hidden).map(tab => tab.textContent))).toEqual(['Board', 'Map', 'Manager', 'Punch list', 'Changes']);

  await openWorkspace(frame, 'Tech Check');
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#fleet-dashboard');
  await expect.poll(() => seen(host, 'viewManager')).toBe(true);
  expect(await inBoard(host, root => root.getElementById('tabManager').getAttribute('aria-selected'))).toBe('true');
  await expect(frame.getByRole('button', {name: /^IT check in \/ out/})).toHaveCount(0);

  // Cameras: the Board tab's own numbers, and the down unit by name.
  await expect.poll(() => inBoard(host, root => [...root.querySelectorAll('#mgNow .mgnum')].map(item => item.innerText.replace(/\s+/g, ' ').trim()))).toEqual(['1 Down', '1 Camera issues', '1 Unknown', '1 Up']);
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgNow .mgdown .chip')].map(chip => chip.textContent))).toEqual(['Spotter 002']);

  // Today's truck inspections, test accounts left out of the count.
  await expect.poll(() => textOf(host, 'mgChecks')).toContain('1 of 2 trucks ready. No inspection today from Riley Fixture.');
  const checks = await inBoard(host, root => [...root.querySelectorAll('#mgChecks .mgtech')].map(tech => ({
    who: tech.querySelector('.who').textContent, ready: tech.querySelector('.pill').textContent,
    lines: [...tech.querySelectorAll('.chk')].map(line => line.querySelector('.dot').className.replace('dot ', '') + ' ' + line.querySelector('b').textContent + ': ' + line.querySelector('b + span').textContent),
  })));
  expect(checks).toEqual([
    {who: 'Avery Fixture', ready: 'Truck ready', lines: ['ok Truck inspection: Done 9:37 AM', 'info Trailer inspection: Not taking a trailer', 'ok Truck stock check: Done 9:45 AM']},
    {who: 'Riley Fixture', ready: 'Not ready', lines: ['bad Truck inspection: Not done today', 'bad Trailer inspection: Not done today', 'bad Truck stock check: Stock is short']},
  ]);
  expect(await textOf(host, 'mgChecks')).toContain('Truck inspections · Tue, Oct 6');

  // What is on each truck. A unit the board has in the field is called out.
  const trucks = await inBoard(host, root => [...root.querySelectorAll('#mgTrucks .mgtruck')].map(card => ({
    who: card.querySelector('.who').textContent, sum: card.querySelector('.mgsum').textContent,
    items: [...card.querySelectorAll('.mgitem')].map(item => item.textContent + (item.classList.contains('none') ? ' !' : '')),
    flags: [...card.querySelectorAll('.mgflag')].map(flag => flag.textContent), note: card.querySelector('p.note')?.textContent ?? null,
  })));
  expect(trucks).toEqual([
    {who: 'Avery Fixture', sum: 'Fully stocked', note: null,
      items: ['Sniper 101', 'Ranger 007', 'Spotter 002', 'Solar Spotter 013', '10001', '10002', '10003', 'Recon batteries 25 of 25', 'AGM 12V 110Ah 4 of 4', 'LiTime 12V 100Ah 2 of 2', '12V 35Ah 4 of 4'],
      flags: ['Spotter 002 is on this truck, but the board has it in the field (Down).']},
    {who: 'Riley Fixture', sum: '1 unit missing · 1 SIM missing · batteries short · 1 used, waiting on a replacement', note: 'Waiting on IT: Spotter (requested).',
      items: ['Sniper 102', 'No Ranger !', 'Spotter 055 · used on #7001', 'Solar Spotter 014', '20001', '20002', 'No SIM 3 !', 'Recon batteries 25 of 25', 'AGM 12V 110Ah 3 of 4 !', 'LiTime 12V 100Ah 2 of 2', '12V 35Ah 4 of 4'],
      flags: []},
  ]);
  await press(host, '#mgTrucks', 'Show 1 test account');
  await expect.poll(() => inBoard(host, root => [...root.querySelectorAll('#mgTrucks .mgtruck .who')].map(who => who.textContent))).toEqual(['Avery Fixture', 'Riley Fixture', 'Test ServiceTest']);

  // The read used the owner's own signed-in client, for today in Central time.
  const reads = await rpcCalls(page, 'owner_tech_command_board_v2');
  expect(reads.length).toBeGreaterThan(0);
  expect(reads[0].args).toEqual({p_date: new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago'}).format(new Date(now))});
  expect(await rpcCalls(page, 'owner_save_service_truck_inventory_batch_v1')).toEqual([]);
  expect(errors).toEqual([]);
});

test('a truck is changed from the manager view, saved in the same shape as the truck editor, and the tech is sent to check it again', async ({page}) => {
  const {frame, host} = await mount(page);
  await openManager(frame, host);
  await press(host, '#mgTrucks .mgtruck:nth-child(2)', 'Add or remove');
  await expect.poll(() => seen(host, 'mgEdit')).toBe(true);
  expect(await inBoard(host, root => root.getElementById('mgEdit').querySelector('.who').textContent)).toBe('Change Riley Fixture’s truck');
  // Nothing is saved until something really changes.
  expect(await inBoard(host, root => ({off: root.getElementById('mgSave').disabled, says: root.getElementById('mgDiff').innerText.trim()}))).toEqual({off: true, says: 'Nothing is changed yet.'});

  await fill(host, 'Ranger', ' 031 ');
  await fill(host, 'Sniper', '');
  await fill(host, 'SIM 3', '20003');
  await fill(host, 'SIM 1', '');
  await fill(host, 'AGM 12V 110Ah (carries 4)', '4');
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgDiff .mgdiff li')].map(item => item.textContent))).toEqual([
    'Sniper 102 comes off the truck', 'Ranger 031 goes on the truck', 'Spotter 055 is marked used. Saving marks it ready on the truck again.', 'SIM 3: 20003 goes on the truck', 'AGM 12V 110Ah: 3 becomes 4',
  ]);
  expect(await textOf(host, 'mgDiff')).toContain('It is saved with your name. Riley then has to check the truck again in Tech Check before leaving.');
  await fill(host, 'Recon batteries (carries 25)', 'lots');
  expect(await inBoard(host, root => ({off: root.getElementById('mgSave').disabled, says: root.querySelector('#mgDiff .mgerr').textContent}))).toEqual({off: true, says: 'Enter a whole number for Recon batteries.'});
  await fill(host, 'Recon batteries (carries 25)', '25');

  // The database turns one down: its own words are shown and the typing is kept.
  await page.evaluate(() => { window.fixture.saveError = 'Unit 031 is already assigned to another Service Tech truck.'; });
  await press(host, '#mgEdit', 'Save truck');
  await expect.poll(() => inBoard(host, root => root.querySelector('#mgDiff .mgerr')?.textContent ?? null)).toBe('Unit 031 is already assigned to another Service Tech truck.');
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgEdit .mgfield input')].slice(0, 2).map(input => input.value))).toEqual(['', ' 031 ']);

  await page.evaluate(() => { window.fixture.saveError = null; });
  await press(host, '#mgEdit', 'Save truck');
  await expect.poll(() => seen(host, 'mgEdit')).toBe(false);
  const saves = await rpcCalls(page, 'owner_save_service_truck_inventory_batch_v1');
  expect(saves).toHaveLength(2);
  // Every unit slot is sent, a blank one comes off. A SIM that is not being replaced is sent blank and so is left alone.
  expect(saves[1].args).toEqual({p_service_tech_id: RILEY, p_payload: {
    units: {Sniper: '', Ranger: '031', Spotter: '055', 'Solar Spotter': '014'},
    sims: {1: '', 2: '', 3: '20003'},
    stock: {'Recon Battery': 25, 'AGM 12V 110Ah': 4, 'LiTime 12V 100Ah': 2, '12V 35Ah': 4},
  }});
  await expect.poll(() => inBoard(host, root => root.getElementById('toast').textContent)).toBe('Riley Fixture’s truck is saved. Riley has to check the truck again before leaving.');
  // The screen shows what was kept, read again after the save.
  await expect.poll(() => inBoard(host, root => [...root.querySelectorAll('#mgTrucks .mgtruck:nth-child(2) .mgitem')].slice(0, 7).map(item => item.textContent)))
    .toEqual(['No Sniper', 'Ranger 031', 'Spotter 055', 'Solar Spotter 014', '20001', '20002', '20003']);
  // The older truck screen is told to read the change as well. The save that was turned down changed nothing, so it was not.
  await expect.poll(() => page.evaluate(() => window.fixture.refreshed)).toBe(1);

  // Cancel throws the typing away and saves nothing.
  await press(host, '#mgTrucks .mgtruck:nth-child(1)', 'Add or remove');
  await fill(host, 'Sniper', '999');
  await press(host, '#mgEdit', 'Cancel');
  await expect.poll(() => seen(host, 'mgEdit')).toBe(false);
  expect(await rpcCalls(page, 'owner_save_service_truck_inventory_batch_v1')).toHaveLength(2);
  expect(await inBoard(host, root => root.querySelector('#mgTrucks .mgtruck .mgitem').textContent)).toBe('Sniper 101');
});

test('every handoff between IT and Service is listed with who signed, and its photos and signatures open in place', async ({page}) => {
  const {frame, host} = await mount(page);
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgX')).toContain('2 handoffs on record, 1 still open.');
  const rows = () => inBoard(host, root => [...root.querySelectorAll('#mgX .mgx')].map(row => ({
    name: row.querySelector('.name').textContent, sub: [...row.querySelectorAll('.sub')].map(sub => sub.textContent), state: row.querySelector('.pill').textContent,
  })));
  expect(await rows()).toEqual([
    {name: 'Ranger 031', state: 'Waiting on Service', sub: ['Installation · Jordan Fixture to Riley Fixture', 'Tue 10:00 AM · 1 photo · 1 signature · Tap to see them']},
    {name: 'Sniper 101', state: 'Received', sub: ['Truck replenishment · Jordan Fixture to Avery Fixture', 'Mon 1:00 PM · 1 photo · 2 signatures · Tap to see them']},
  ]);
  // No photo is fetched until a handoff is opened.
  expect(await page.evaluate(() => window.fixture.photos)).toEqual([]);
  await inBoard(host, root => root.querySelectorAll('#mgX .mgx .pmain')[1].click());
  await expect.poll(() => inBoard(host, root => [...root.querySelectorAll('#mgX .mgev p')].map(line => line.textContent))).toEqual([
    'Handed over by Jordan Fixture · Mon 11:00 AM · signed', 'Received by Avery Fixture · Mon 1:00 PM · signed · 1 difference recorded',
  ]);
  await expect.poll(() => inBoard(host, root => [...root.querySelectorAll('#mgX .mgshot img')].map(image => image.alt + ' ' + image.src))).toEqual([
    'Photo https://photos.fixture.test/fixture-it/handoff-1/unit-photo-0001.jpg', 'Signature https://photos.fixture.test/fixture-it/handoff-1/signature-0001.jpg',
    'Signature https://photos.fixture.test/fixture-service/handoff-1/signature-0002.jpg',
  ]);
  // Each link is short-lived, from the handoff evidence store, and only for a file this log listed. The path that climbs out of the store was never listed.
  expect((await page.evaluate(() => window.fixture.photos)).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    {bucket: 'techcheck-transfer-evidence', path: 'fixture-it/handoff-1/signature-0001.jpg', seconds: 300},
    {bucket: 'techcheck-transfer-evidence', path: 'fixture-it/handoff-1/unit-photo-0001.jpg', seconds: 300},
    {bucket: 'techcheck-transfer-evidence', path: 'fixture-service/handoff-1/signature-0002.jpg', seconds: 300},
  ]);
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgX .mgev a.lk')].map(link => link.textContent + ' ' + link.href))).toEqual(['Open the signed report https://drive.google.com/file/d/fixtureReport0001/view']);
  // The frame itself cannot ask for any other file.
  const refused = await frame.locator('body').evaluate(() => new Promise(resolve => {
    const requestId = crypto.randomUUID();
    addEventListener('message', event => { if (event.data?.type === 'COS_MANAGER_RESPONSE' && event.data.requestId === requestId) resolve(event.data.error); });
    parent.postMessage({type: 'COS_MANAGER_REQUEST', requestId, kind: 'photo', path: 'someone-else/private/file-0001.jpg'}, location.origin);
  }));
  expect(refused).toBe('invalid');
  expect(await page.evaluate(() => window.fixture.photos.length)).toBe(3);

  // The older screens stay one tap away, off the page until asked for.
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgTools .mgmore button')].length)).toBe(0);
  await press(host, '#mgTools', 'Other Tech Check screens');
  await press(host, '#mgTools', 'Handoffs desk');
  await expect.poll(() => page.evaluate(() => window.fixture.routes)).toEqual(['handoffs']);
  await expect(page.getByRole('heading', {name: 'handoffs check tool'})).toBeVisible();
  // Coming back from one of those screens lands on the manager view again, not on a tech's check.
  await page.locator('#cosOperationsReturn').click();
  await expect(frame.locator('.cos-board-host')).toBeVisible();
  await expect.poll(() => seen(frame.locator('.cos-board-host'), 'viewManager')).toBe(true);
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#fleet-dashboard');
  await expect(frame.getByRole('button', {name: /^IT check in \/ out/})).toHaveCount(0);
});

test('when the handoff log cannot be read the trucks and inspections still show', async ({page}) => {
  const fixture = {manager: manager()}; fixture.manager.context = null;
  const {frame, host} = await mount(page, fixture);
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgX')).toContain('The handoff log could not be read just now.');
  expect(await textOf(host, 'mgChecks')).toContain('1 of 2 trucks ready.');
});

test('where the manager records cannot be read, Tech Check is the page it was and there is no Manager tab', async ({page}) => {
  // The Tech Check app is there, but has no database client to read with.
  const {frame, host} = await mount(page, {client: false});
  await expect.poll(() => seen(host, 'tabTech')).toBe(true);
  await openWorkspace(frame, 'Tech Check');
  await expect(frame.getByRole('heading', {name: 'Tech Check', exact: true})).toBeVisible();
  await expect(frame.getByRole('button', {name: /^IT check in \/ out/})).toBeVisible();
  await expect(frame.locator('.cos-manager-door')).toHaveCount(0);
  await openWorkspace(frame, 'Fleet Dashboard');
  await expect(frame.locator('.cos-board-host')).toBeVisible();
  expect(await seen(frame.locator('.cos-board-host'), 'tabManager')).toBe(false);
  expect(await page.evaluate(() => window.fixture.rpc)).toEqual([]);
});

test('an owner the database turns away is told so on the Manager tab and offered the older screen', async ({page}) => {
  const {frame, host} = await mount(page, {manager: null});
  await openWorkspace(frame, 'Tech Check');
  await expect.poll(() => seen(host, 'viewManager')).toBe(true);
  await expect.poll(() => textOf(host, 'mgChecks')).toContain('Trucks and inspections could not be read just now.');
  expect(await inBoard(host, root => [...root.querySelectorAll('#mgChecks button')].map(button => button.textContent))).toEqual(['Try again', 'Open the older truck screen']);
  await press(host, '#mgChecks', 'Open the older truck screen');
  await expect.poll(() => page.evaluate(() => window.fixture.routes)).toEqual(['team']);
});

test('the Manager tab shows the handoff check: trucks with no handoff, loads without one, and unsigned handoffs', async ({page}) => {
  const fixture = {manager: manager()};
  fixture.manager.gaps = {mode: 'enforce',
    on_truck_without_handoff: [{service_tech: 'Riley Fixture', equipment_type: 'Sniper', unit_tag: '102', loaded_by: 'Riley Fixture', loaded_at: '2026-11-25T14:00:00Z', in_equipment_list: false}],
    loaded_without_handoff: [{service_tech: 'Riley Fixture', equipment_type: 'Ranger', unit_tag: '008', by: 'Owner Fixture', reason: 'Swapped on site', kind: 'owner_override', at: '2026-11-25T15:00:00Z'}],
    handoffs_not_finished: [{state: 'awaiting_service', from: 'Jordan Fixture', to: 'Riley Fixture', hours_waiting: 5.4, units: ['Spotter 268']}]};
  const {frame, host} = await mount(page, fixture);
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgGap')).toContain('3 things to look at.');
  const text = await textOf(host, 'mgGap');
  for (const part of ['On a truck with no handoff', 'Riley Fixture · Sniper 102', 'Not in the COS equipment list',
    'Loaded without a handoff (last 7 days)', 'Riley Fixture · Ranger 008', 'You loaded it without a handoff', 'Swapped on site',
    'Handoffs not finished after 4 hours', 'Spotter 268', 'Jordan Fixture to Riley Fixture', 'Waiting on Service', 'waiting 5 h']) expect(text).toContain(part);
});

test('the handoff check says all clear when nothing is missing, and says so when it cannot be read', async ({page}) => {
  const clear = {manager: manager()};
  clear.manager.gaps = {mode: 'enforce', on_truck_without_handoff: [], loaded_without_handoff: [], handoffs_not_finished: []};
  let {frame, host} = await mount(page, clear);
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgGap')).toContain('All clear. Every unit on a truck came through a signed handoff.');
  ({frame, host} = await mount(page, {manager: manager()}));
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgGap')).toContain('The handoff check could not be read just now.');
  expect(await textOf(host, 'mgChecks')).toContain('1 of 2 trucks ready.');
});

// Small helpers for the SIM drawer box, which lives outside the truck editor.
const typeIn = (host, selector, value) => inBoard(host, (root, [sel, text]) => {
  const field = root.querySelector(sel); field.value = text; field.dispatchEvent(new Event('input', {bubbles: true})); return true;
}, [selector, value]);
const pressInRow = async (host, sim, label) => expect(await inBoard(host, (root, [wanted, name]) => {
  const row = [...root.querySelectorAll('#mgSim .prow')].find(item => item.textContent.includes(wanted));
  const button = row && [...row.querySelectorAll('button')].find(item => item.textContent.trim() === name && !item.disabled);
  button?.click(); return Boolean(button);
}, [sim, label])).toBe(true);
const typeInRow = (host, sim, value) => inBoard(host, (root, [wanted, text]) => {
  const row = [...root.querySelectorAll('#mgSim .prow')].find(item => item.textContent.includes(wanted));
  const field = row.querySelector('input'); field.value = text; field.dispatchEvent(new Event('input', {bubbles: true})); return true;
}, [sim, value]);

test('the SIM drawer shows what is in the drawer and what is out, and the owner adds and marks cards', async ({page}) => {
  const fixture = {manager: manager()};
  fixture.manager.sims = {require_listed: false,
    cards: [{sim: '89012600000000000001', carrier: 'Simetry', status: 'in_drawer', location: null, note: null, updated_by: 'Owner Fixture', updated_at: '2026-11-25T15:00:00Z'},
      {sim: '89012600000000000002', carrier: 'Vendera', status: 'in_unit', location: 'Sniper 332 → Riley Fixture', note: null, updated_by: 'Jordan Fixture', updated_at: '2026-11-25T16:00:00Z'}],
    not_in_drawer: [{sim: '89012600000000000077', detail: 'Handed over in Sniper 332 to Riley Fixture', by: 'Jordan Fixture', at: '2026-11-25T16:00:00Z'}]};
  const {frame, host} = await mount(page, fixture);
  await openManager(frame, host);
  await expect.poll(() => textOf(host, 'mgSim')).toContain('1 SIM in the drawer.');
  let text = await textOf(host, 'mgSim');
  for (const part of ['1 out in units or on trucks · 0 bad or deactivated.', '1 SIM handed out that were not on the drawer list', '89012600000000000077', '89012600000000000001 · Simetry']) expect(text).toContain(part);
  // what is out, and where
  await press(host, '#mgSim', 'Out (1)');
  expect(await textOf(host, 'mgSim')).toContain('Sniper 332 → Riley Fixture');
  // add cards: spaces and dashes are dropped, repeats and junk are reported
  await press(host, '#mgSim', 'In the drawer (1)');
  await press(host, '#mgSim', 'Add SIM cards');
  await typeIn(host, '#mgSim textarea', '8901 2600 0000 0000 003\n89012600000000000001\n12');
  await typeIn(host, '#mgSim input[list="simCarriers"]', 'Vendera');
  await press(host, '#mgSim', 'Add to drawer');
  await page.waitForTimeout(1500);console.log('RPC', JSON.stringify((await page.evaluate(() => window.fixture.rpc)).filter(c=>c.name.startsWith('sim'))));
  await expect.poll(() => textOf(host, 'mgSim')).toContain('2 SIMs in the drawer.');
  text = await textOf(host, 'mgSim');
  for (const part of ['1 SIM added. 1 already on the list. Not SIM numbers: 12.', '8901260000000000003 · Vendera']) expect(text).toContain(part);
  // marking a card bad needs a reason
  await press(host, '#mgSim', 'Close');
  await pressInRow(host, '89012600000000000001', 'Mark bad');
  await pressInRow(host, '89012600000000000001', 'Save');
  await expect.poll(() => textOf(host, 'mgSim')).toContain('Write why first.');
  await typeInRow(host, '89012600000000000001', 'Will not register');
  await pressInRow(host, '89012600000000000001', 'Save');
  await expect.poll(() => textOf(host, 'mgSim')).toContain('1 SIM in the drawer.');
  await press(host, '#mgSim', 'Bad (1)');
  expect(await textOf(host, 'mgSim')).toContain('Will not register');
  const calls = (await page.evaluate(() => window.fixture.rpc)).map(c => c.name).filter(n => n.startsWith('sim_drawer_') && n !== 'sim_drawer_v1');
  expect(calls).toEqual(['sim_drawer_add_v1', 'sim_drawer_mark_v1']);
});
