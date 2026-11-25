import {test, expect} from '@playwright/test';
import {fresh} from './fleet-dashboard-fixtures.mjs';
import {mount, manager} from './manager-view-fixtures.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';
import {TEMPLATES as REAL, DEFAULTS, check, render} from '../../supabase/functions/cos-vendor-request/templates.ts';
import {cifFileName} from '../../supabase/functions/cos-vendor-request/cif.ts';

/* Email a vendor from the unit card. The Tech Check cos-vendor-request function holds the templates and sends;
   this stand-in answers the way it does (its own tests are vendor-request.test.mjs). */
const VENDOR = '**/functions/v1/cos-vendor-request';
const unit = (name, extra = {}) => ({unit: name, placement: 'FIELD', site: 'Clayton at Tour 18', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh,
  cameraList: [{name: name + ' / Cam 1', status: 'online', atSite: true}], source: 'star4live', ...extra});
const rows = [unit('HELIOS 001'), unit('SPOTTER 002', {state: 'RED', online: 0, offline: 1, cameraList: [{name: 'SPOTTER 002 / Cam 1', status: 'offline', atSite: true}]})];
const report = {contract: 'COS_STAR_UNIT_STATUS_V1', units: rows, counts: countUnits(rows),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: true, refreshedAt: fresh, source: 'Star4Live'};
const inBoard = (host, fn, value) => host.evaluate((element, [source, input]) => (0, eval)('(' + source + ')')(element.cosBoardRoot, input), [fn.toString(), value]);
const openUnit = (host, name) => expect.poll(() => inBoard(host, (root, wanted) => { const row = [...root.querySelectorAll('#list .row')].find(r => r.querySelector('.name').textContent === wanted); row?.click(); return root.getElementById('pname')?.textContent || ''; }, name)).toBe(name);
const venText = host => inBoard(host, root => root.getElementById('venBox')?.textContent || '');
const tap = (host, label) => expect.poll(() => inBoard(host, (root, wanted) => { const b = [...root.querySelectorAll('#venBox button')].find(x => x.textContent.trim() === wanted && !x.disabled); b?.click(); return Boolean(b); }, label)).toBe(true);
const type = (host, label, value) => inBoard(host, (root, [wanted, text]) => { const f = root.querySelector('#venBox [aria-label="' + wanted + '"]'); f.value = text; f.dispatchEvent(new Event('input', {bubbles: true})); return true; }, [label, value]);
const TEMPLATES = {
  sim_cancel_vendera: {title: 'Cancel SIM with Vendera', button: 'Cancel SIM: Vendera', to: 'support@vendera.freshdesk.com', sheet: 'sim', defaults: {reason: 'Removed.'},
    fields: [{key: 'unit', label: 'Unit', required: true}, {key: 'site', label: 'Site', required: true}, {key: 'sim', label: 'SIM number (ICCID)', required: true}, {key: 'reason', label: 'Reason', required: true, long: true}]},
  sim_cancel_simetry: {title: 'Cancel SIM with Simetry', button: 'Cancel SIM: Simetry', to: 'support@simetry.com', sheet: 'sim', defaults: {reason: 'Removed.'},
    fields: [{key: 'unit', label: 'Unit', required: true}, {key: 'site', label: 'Site', required: true}, {key: 'sim', label: 'SIM number (ICCID)', required: true}, {key: 'reason', label: 'Reason', required: true, long: true}]},
  monitor_remove: {title: 'Remove a monitoring account (Stages and Watchful)', button: 'Remove account', to: 'techops@eyeforce.com', sheet: 'monitoring', defaults: {}, fields: [{key: 'unit', label: 'Unit', required: true}]},
};
async function vendorServer(page, {deny = false, sheet = 'added A290:I290'} = {}) {
  const seen = [];
  await page.route(VENDOR, async route => {
    const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const req = route.request().postDataJSON(); seen.push(req);
    if (deny) return route.fulfill({status: 403, headers, json: {error: 'Only the owner can send vendor emails.'}});
    if (req.action === 'templates') return route.fulfill({headers, json: {templates: TEMPLATES}});
    if (req.action === 'check') return route.fulfill({headers, json: {account_ok: true, can_send: true, can_edit_sheets: !sheet.startsWith('failed'), sheet_opens: !sheet.startsWith('failed')}});
    if (req.action === 'recent') return route.fulfill({headers, json: {recent: seen.some(r => r.action === 'send') ? [{kind: 'sim_cancel_simetry', state: 'sent', by: 'James Martin', at: fresh, to: 'support@simetry.com', subject: 'SIM cancellation request - SPOTTER 002 - SIM 89852350825066019344', sheet, error: null}] : []}});
    if (!/^\d{19,20}$/.test(req.values?.sim || '')) return route.fulfill({headers, json: {ok: false, missing: ['SIM number (ICCID)']}});
    const mail = {to: 'support@simetry.com', cc: 'IT@camerasonsite.com', subject: 'SIM cancellation request - ' + req.values.unit + ' - SIM ' + req.values.sim, body: 'Hello Simetry Support,\n\nPlease cancel service on the SIM card below.\n\nThank you,\n\nJames Martin'};
    if (req.action === 'preview') return route.fulfill({headers, json: {ok: true, mail}});
    return route.fulfill({headers, json: {ok: true, state: 'sent', sheet, by: 'James Martin', to: mail.to}});
  });
  return seen;
}
async function board(page) {
  const {host} = await mount(page, {manager: manager()}, report);
  await expect.poll(() => inBoard(host, root => root.querySelectorAll('#list .row').length)).toBeGreaterThan(0);
  return host;
}

test('a SIM cancellation from the unit card: pick, fill the SIM, see the exact email, send once, logged to the sheet', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'one phone size is enough here');
  const host = await board(page);
  const seen = await vendorServer(page);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => venText(host)).toContain('Cancel SIM: Simetry');
  expect(await venText(host)).toContain('Monitoring account (Stages and Watchful)');
  expect(await venText(host)).not.toContain('cannot');
  await tap(host, 'Cancel SIM: Simetry');
  // what the card knows is already filled in
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Unit"]').value)).toBe('Spotter 002');
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Site"]').value)).toBe('Clayton at Tour 18');
  await tap(host, 'Preview email');
  await expect.poll(() => venText(host)).toContain('Fill in: SIM number (ICCID)');
  await type(host, 'SIM number (ICCID)', '89852350825066019344');
  await tap(host, 'Preview email');
  await expect.poll(() => venText(host)).toContain('Subject');
  const text = await venText(host);
  for (const part of ['support@simetry.com', 'IT@camerasonsite.com', 'SIM cancellation request - Spotter 002 - SIM 89852350825066019344', 'Hello Simetry Support']) expect(text).toContain(part);
  await tap(host, 'Send email');
  await expect.poll(() => venText(host)).toContain('Sent to support@simetry.com.');
  expect(await venText(host)).toContain('Added to the deactivation sheet (A290:I290).');
  await expect.poll(() => venText(host)).toContain('Sent for Spotter 002');
  const sends = seen.filter(r => r.action === 'send');
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({kind: 'sim_cancel_simetry', values: {unit: 'Spotter 002', site: 'Clayton at Tour 18', sim: '89852350825066019344', reason: 'Removed.'}});
  expect(sends[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
});

test('when the sheet cannot be written, the card says to add the row by hand', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'one phone size is enough here');
  const host = await board(page);
  await vendorServer(page, {sheet: 'failed (403)'});
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => venText(host)).toContain('cannot write to the deactivation sheet yet');
  await tap(host, 'Cancel SIM: Vendera');
  await type(host, 'SIM number (ICCID)', '89852350825066019344');
  await tap(host, 'Preview email');
  await tap(host, 'Send email');
  await expect.poll(() => venText(host)).toContain('The deactivation sheet was NOT updated (failed (403)). Add the row by hand.');
});

test('a sign-in the server refuses (Service) never sees the vendor box', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'one phone size is enough here');
  const host = await board(page);
  await vendorServer(page, {deny: true});
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => inBoard(host, root => Boolean(root.getElementById('pname')))).toBe(true);
  await page.waitForTimeout(500);
  expect(await inBoard(host, root => Boolean(root.getElementById('venBox')))).toBe(false);
});

// Approved IT: the Eyeforce account form, filled on the card and sent with the form attached. The stand-in uses the
// function's own templates and checks, so the lists and the problems shown are the real ones.
async function formServer(page) {
  const seen = [];
  await page.route(VENDOR, async route => {
    const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const req = route.request().postDataJSON(); seen.push(req);
    if (req.action === 'templates') return route.fulfill({headers, json: {owner: false, templates: Object.fromEntries(['monitor_add', 'monitor_swap'].map(k => [k, {...REAL[k], defaults: DEFAULTS[k]}]))}});
    if (req.action === 'check') return route.fulfill({headers, json: {account_ok: true, can_send: true, can_edit_sheets: false, sheet_opens: false}});
    if (req.action === 'recent') return route.fulfill({headers, json: {recent: []}});
    if (req.action === 'cameras') return route.fulfill({headers, json: {cameras: [
      {name: 'SPOTTER 002 / Cam 1', type: 'IP Camera', ip: '38.1.2.3', port: '1400 web, 1454 RTSP', serial: 'S1'},
      {name: 'SPOTTER 002 / Cam 2', type: 'IP Camera', ip: '38.1.2.3', port: '1500 web, 1554 RTSP', serial: 'S2'}]}});
    const {values, missing} = check(req.kind, req.values);
    if (missing.length) return route.fulfill({headers, json: {ok: false, missing}});
    if (req.action === 'preview') return route.fulfill({headers, json: {ok: true, mail: render(req.kind, values, {name: 'Teddy Hopper', james: false, it: true}), form: cifFileName(req.kind, values)}});
    return route.fulfill({headers, json: {ok: true, state: 'sent', sheet: 'not_logged_here', by: 'Teddy Hopper', to: 'techops@eyeforce.com'}});
  });
  return seen;
}
const pick = (host, label, value) => inBoard(host, (root, [wanted, text]) => { const f = root.querySelector('#venBox [aria-label="' + wanted + '"]'); f.value = text; f.dispatchEvent(new Event('change', {bubbles: true})); return f.value; }, [label, value]);

test('IT fills the Eyeforce account form on the card: cameras from COS, plain problems, the email and the attached form', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'one phone size is enough here');
  const host = await board(page);
  const seen = await formServer(page);
  await openUnit(host, 'Spotter 002');
  await expect.poll(() => venText(host)).toContain("Fill in Eyeforce's form here");
  const start = await venText(host);
  expect(start).not.toContain('Cancel SIM');
  expect(start).not.toContain('deactivation sheet');
  await tap(host, 'Add account');
  await expect.poll(() => venText(host)).toContain('2 cameras filled in from COS');
  for (const s of ['Site and account', 'Services', 'Type of site', 'Monitoring schedule', 'Dispatch action plan', 'Cameras on the unit (form tab 3)']) expect(await venText(host)).toContain(s);
  // Eyeforce's defaults are filled in; the drop-downs carry Eyeforce's own lists.
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Eyeforce account manager"]').value)).toBe('Felipe Presas');
  expect(await inBoard(host, root => [...root.querySelector('#venBox [aria-label="Facility type"]').options].map(o => o.value))).toContain('Secure Enclosed Fenced Area');
  await tap(host, 'Preview email and form');
  await expect.poll(() => venText(host)).toContain('Fill in: ');
  const problems = await venText(host);
  for (const m of ['Address', 'Call list (name, role and phone, in order)', 'Customer type', 'Sunday start']) expect(problems).toContain(m);
  await type(host, 'Address', '17935 Hunters Terrace Dr, Humble, TX 77338');
  await type(host, 'Call list (name, role and phone, in order)', 'Juan Perez, super, 832-555-0101');
  await pick(host, 'Customer type', 'Multi-Family / Apartments');
  await pick(host, 'Facility type', 'Secure Enclosed Fenced Area');
  await type(host, 'Break-ins, problems and what the operators should look for', 'Copper theft at night.');
  await pick(host, 'Sunday start', '6pm');
  await pick(host, 'Sunday end', '6am');
  await tap(host, 'Same hours every day');
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Friday start"]').value)).toBe('Same as above');
  await type(host, 'Camera 1 Login name', 'admin');
  await type(host, 'Camera 1 Password', 'secret-1');
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Camera 1 Password"]').type)).toBe('password');
  await tap(host, "Use camera 1's login for all");
  expect(await inBoard(host, root => root.querySelector('#venBox [aria-label="Camera 2 Password"]').value)).toBe('secret-1');
  await tap(host, 'Preview email and form');
  await expect.poll(() => venText(host)).toContain('Attached');
  const mail = await venText(host);
  for (const part of ['techops@eyeforce.com', 'CIF Clayton at Tour 18', 'Juan Perez, super, 832-555-0101', 'Camera logins and passwords are in the attached form, tab 3.', 'Teddy Hopper']) expect(mail).toContain(part);
  expect(mail).not.toContain('secret-1');
  await tap(host, 'Send email');
  await expect.poll(() => venText(host)).toContain('Sent to techops@eyeforce.com.');
  const send = seen.filter(r => r.action === 'send');
  expect(send).toHaveLength(1);
  expect(send[0].values).toMatchObject({unit: 'Spotter 002', cam1_name: 'SPOTTER 002 / Cam 1', cam2_password: 'secret-1', s_mon_start: 'Same as above'});
});
