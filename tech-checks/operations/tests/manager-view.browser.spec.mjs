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
