import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {TEMPLATES, check, render, sheetRow, rawEmail} from '../../supabase/functions/cos-vendor-request/templates.ts';
import {createVendorHandler} from '../../supabase/functions/cos-vendor-request/index.ts';
import {ADD_DEFAULTS, DAYS} from '../../supabase/functions/cos-vendor-request/cif.ts';
import {unzip} from '../../supabase/functions/cos-vendor-request/xlsx.ts';

// Vendor emails from the unit card: same template every time, owner only, sent once, then logged.
const owner = 'e4abc521-1ef3-45a6-9829-b87faff78210', it = '00000000-0000-4000-8000-0000000000b1';
const unit = {unit: 'Spotter 268', customer: 'Blazer Building Southwest', site: 'Clayton at Tour 18', address: '17935 Hunters Terrace Dr, Humble, TX 77338', job: '22703'};
const SIM = '89852350825066019344';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema app_private;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean, archived_at timestamptz, full_name text, username text);
    create function app_private.cos_verified_fleet_actor(p uuid) returns boolean language sql as $$ select exists(select 1 from public.profiles where user_id=p and active and role::text in ('owner','it')) $$;
    create table public.camera_devices(id bigserial, unit_key text, device_name text, device_serial text, device_model text, device_type text, public_ip inet,
      source_metadata jsonb, activation_state text, do_not_use boolean);`);
  await db.query(`insert into public.camera_devices(unit_key,device_name,device_serial,device_model,device_type,public_ip,source_metadata,activation_state) values
    ('HELIOS 002','Helios 002 / Cam 002','S2','ALI-PB50','IPC','38.246.195.56','{"localIp":"192.168.10.15"}','active'),
    ('HELIOS 002','Helios 002 / Cam 001','S1','ALI-PB50','IPC','38.246.195.56','{"localIp":"192.168.10.14"}','active'),
    ('HELIOS 002','Helios 002 / PTZ 003','S3','ALI-PZ40','IPC','38.246.195.56','{"localIp":"192.168.10.16"}','active'),
    ('HELIOS 002','Helios 002 old','S9','ALI-PB50','IPC',null,'{}','deactivated'),
    ('HELIOS 003','Helios 003 / Cam 001','S4','ALI-PB50','IPC',null,'{}','active')`);
  await db.query("insert into public.profiles values($1,'owner',true,null,'James Martin','james'),($2,'it',true,null,'Teddy Hopper','teddy')", [owner, it]);
  const s = readFileSync(new URL('../../database-maintenance/cos-vendor-requests-v1.sql', import.meta.url), 'utf8');
  await db.exec(s); await db.exec(s);
  const s2 = readFileSync(new URL('../../database-maintenance/cos-vendor-requests-v2.sql', import.meta.url), 'utf8');
  await db.exec(s2); await db.exec(s2);
  // No vault here: the cron secret the function passes to the Operations sheet function.
  await db.exec("create or replace function public.cos_vendor_log_secret_v1() returns text language sql as $$ select 'cron-secret' $$");
});
after(() => db?.close());

const rpcOf = () => ({rpc: async (name, args) => {
  const keys = Object.keys(args);
  try { return {data: (await db.query(`select public.${name}(${keys.map((k, i) => k + '=>$' + (i + 1)).join(',')}) r`, keys.map(k => args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]))).rows[0].r, error: null}; }
  catch (e) { return {data: null, error: {message: e.message}}; }
}});
function server({gmail = {ok: true, id: 'gm-1'}, sheet = {ok: true}, account = 'jmartin@camerasonsite.com', who = owner} = {}) {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({url: String(url), body: init?.body});
    const json = (status, body) => ({ok: status < 300, status, json: async () => body});
    if (url.includes('oauth2.googleapis.com/token')) return json(200, {access_token: 'tok'});
    if (url.includes('userinfo')) return json(200, {email: account, email_verified: true});
    if (url.includes('gmail.googleapis.com')) { if (gmail.throw) throw Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}); return json(gmail.ok ? 200 : 403, gmail.ok ? {id: gmail.id} : {}); }
    if (url.includes('cos-deactivation-log')) {
      assert.equal(init.headers['x-camera-cron-secret'], 'cron-secret');
      const b = JSON.parse(init.body);
      if (b.action === 'check') return json(200, {sheet_opens: sheet.ok, tab_found: sheet.ok});
      return json(200, sheet.ok ? {ok: true, range: 'A290:I290'} : {ok: false, status: 403});
    }
    throw new Error('unexpected ' + url);
  };
  const handler = createVendorHandler({admin: rpcOf(), env: n => 'x-' + n, fetch, today: () => new Date('2026-11-25T20:00:00Z'),
    userClient: {auth: {getUser: async t => t === 'good' ? {data: {user: {id: who}}, error: null} : {data: null, error: {}}}}});
  const post = async (body, token = 'good') => {
    const r = await handler(new Request('https://x/fn', {method: 'POST', headers: {authorization: 'Bearer ' + token, origin: 'https://cypressriveroasis2023-sudo.github.io'}, body: JSON.stringify(body)}));
    return {status: r.status, body: await r.json()};
  };
  return {post, seen};
}

test('every request uses its one fixed template: the right inbox, IT@ in copy, one signature', () => {
  const v = check('sim_cancel_vendera', {...unit, sim: '8985 2350 8250 6601 9344', reason: 'Unit removed.'}).values;
  const mail = render('sim_cancel_vendera', v);
  assert.equal(mail.to, 'support@vendera.freshdesk.com');
  assert.equal(mail.cc, 'IT@camerasonsite.com');
  assert.equal(mail.subject, 'SIM cancellation request - Spotter 268 - SIM ' + SIM);
  assert.match(mail.body, /^Hello Vendera Support,\n\nPlease cancel service on the SIM card below\.\n\nSIM \(ICCID\): 89852350825066019344\nUnit: Spotter 268\n/);
  assert.equal(mail.body.match(/James Martin/g).length, 1);
  assert.equal(render('sim_cancel_simetry', v).to, 'support@simetry.com');
  for (const k of ['monitor_add', 'monitor_remove', 'monitor_swap']) assert.equal(TEMPLATES[k].to, 'techops@eyeforce.com');
  const swap = render('monitor_swap', check('monitor_swap', {unit: 'Spotter 268', new_unit: 'Spotter 271', site: 'Clayton at Tour 18', eye: 'eye 17351', date: '11/25/2026'}).values);
  assert.equal(swap.subject, 'EYE17351 | Clayton at Tour 18 | Unit swap: Spotter 268 to Spotter 271');
  // the same values always give the same email
  assert.deepEqual(render('sim_cancel_vendera', v), render('sim_cancel_vendera', v));
});

test('blanks are checked in plain words before anything is sent', () => {
  assert.deepEqual(check('sim_cancel_simetry', {...unit, sim: '', reason: 'x'}).missing, ['SIM number (ICCID)']);
  assert.deepEqual(check('sim_cancel_simetry', {...unit, sim: '12345', reason: 'x'}).missing, ['SIM number (ICCID): 18 to 22 digits']);
  assert.deepEqual(check('monitor_remove', {...unit, eye: '17351', date: '11/25/2026', reason: 'x'}).missing, ['Eyeforce account number: EYE then the digits']);
  assert.ok(check('monitor_add', {unit: 'Spotter 268'}).missing.includes('Call list (name, role and phone, in order)'));
  // header injection is impossible: line breaks are folded out of one-line fields
  assert.doesNotMatch(render('sim_cancel_vendera', check('sim_cancel_vendera', {...unit, unit: 'Spotter 268\r\nBcc: x@y.z', sim: SIM, reason: 'x'}).values).subject, /[\r\n]/);
});

test('the deactivation sheet row follows the sheet columns; account adds and swaps are not logged there', () => {
  const v = check('sim_cancel_vendera', {...unit, sim: SIM, reason: 'x'}).values;
  assert.deepEqual(sheetRow('sim_cancel_vendera', v, '11/25/2026'), ['11/25/2026', 'Blazer Building Southwest', 'Spotter 268', 'Clayton at Tour 18, 17935 Hunters Terrace Dr, Humble, TX 77338', '22703', '', 'EMAILED VENDERA 11/25/2026', '', '']);
  assert.equal(sheetRow('monitor_remove', check('monitor_remove', {...unit, eye: 'EYE1', date: 'd', reason: 'r'}).values, 'D')[7], 'EMAILED EYEFORCE D');
  assert.equal(sheetRow('monitor_add', {}, 'D'), null);
  assert.equal(sheetRow('monitor_swap', {}, 'D'), null);
});

test('the raw email is plain text from James with IT@ in Cc and a decodable body', () => {
  const raw = rawEmail(render('sim_cancel_simetry', check('sim_cancel_simetry', {...unit, sim: SIM, reason: 'Unit removed.'}).values), randomUUID());
  const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(text, /^From: "James Martin" <jmartin@camerasonsite\.com>\r\nTo: support@simetry\.com\r\nCc: IT@camerasonsite\.com\r\n/);
  const body = Buffer.from(text.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(body, /Hello Simetry Support/);
});

test('only the owner can preview or send; nothing goes out on a preview', async () => {
  assert.equal((await server().post({action: 'preview', kind: 'sim_cancel_vendera', values: unit}, 'bad')).status, 401);
  assert.equal((await server({who: it}).post({action: 'preview', kind: 'sim_cancel_vendera', values: unit})).status, 403);
  const s = server();
  const p = await s.post({action: 'preview', kind: 'sim_cancel_vendera', values: {...unit, sim: SIM, reason: 'x'}});
  assert.equal(p.body.mail.to, 'support@vendera.freshdesk.com');
  assert.deepEqual((await s.post({action: 'preview', kind: 'sim_cancel_vendera', values: unit})).body, {ok: false, missing: ['SIM number (ICCID)', 'Reason']});
  assert.equal(s.seen.length, 0);
});

test('send: one email from James, then one sheet row; a retry never sends twice', async () => {
  const s = server(), id = randomUUID(), req = {action: 'send', kind: 'sim_cancel_vendera', request_id: id, values: {...unit, sim: SIM, reason: 'Unit removed.'}};
  const r = await s.post(req);
  assert.deepEqual(r.body, {ok: true, state: 'sent', sheet: 'added A290:I290', by: 'James Martin', to: 'support@vendera.freshdesk.com'});
  assert.equal(s.seen.filter(x => x.url.includes('gmail')).length, 1);
  const row = JSON.parse(s.seen.find(x => x.url.includes('cos-deactivation-log')).body).row;
  assert.equal(row[0], '11/25/2026'); assert.equal(row[6], 'EMAILED VENDERA 11/25/2026');
  const again = await s.post(req);
  assert.equal(again.body.state, 'sent');
  assert.equal(s.seen.filter(x => x.url.includes('gmail')).length, 1);
  const rec = (await db.query("select state, gmail_id, sheet, requested_by_name from app_private.vendor_requests where id=$1", [id])).rows[0];
  assert.deepEqual(rec, {state: 'sent', gmail_id: 'gm-1', sheet: 'added A290:I290', requested_by_name: 'James Martin'});
});

test('a wrong Google account, a Gmail refusal or a lost Gmail answer are told plainly and never resent', async () => {
  let r = await server({account: 'someone@else.com'}).post({action: 'send', kind: 'sim_cancel_simetry', request_id: randomUUID(), values: {...unit, sim: SIM, reason: 'x'}});
  assert.deepEqual([r.body.state, r.body.error], ['failed', "The Google connection is not James's account."]);
  r = await server({gmail: {ok: false}}).post({action: 'send', kind: 'sim_cancel_simetry', request_id: randomUUID(), values: {...unit, sim: SIM, reason: 'x'}});
  assert.equal(r.body.state, 'failed');
  const s = server({gmail: {throw: true}}), id = randomUUID();
  r = await s.post({action: 'send', kind: 'sim_cancel_simetry', request_id: id, values: {...unit, sim: SIM, reason: 'x'}});
  assert.deepEqual([r.body.state, r.body.error], ['review', 'No answer from Gmail. Check your Sent folder before sending again.']);
  r = await s.post({action: 'send', kind: 'sim_cancel_simetry', request_id: id, values: {...unit, sim: SIM, reason: 'x'}});
  assert.equal(r.body.state, 'review');
  assert.equal(s.seen.filter(x => x.url.includes('gmail')).length, 1);
});

test('a sheet that cannot be written still leaves the email sent, and says so', async () => {
  const r = await server({sheet: {ok: false}}).post({action: 'send', kind: 'monitor_remove', request_id: randomUUID(), values: {...unit, eye: 'EYE17351', date: '11/25/2026', reason: 'x'}});
  assert.deepEqual([r.body.ok, r.body.sheet, r.body.to], [true, 'failed (403)', 'techops@eyeforce.com']);
  const recent = (await server().post({action: 'recent', unit: 'spotter 268'})).body.recent;
  assert.ok(recent.length >= 2);
  assert.deepEqual(Object.keys(recent[0]).sort(), ['at', 'by', 'error', 'kind', 'sheet', 'state', 'subject', 'to']);
});

// The Eyeforce account form (CIF): approved IT fills and sends it; the filled form goes along as an attachment.
const form = () => ({...ADD_DEFAULTS, unit: 'Helios 002', site: 'Mesa Village MHP', address: '8945 Forest Hollow, Houston, TX 77078', date: '11/25/2026',
  contacts: 'Juan Perez, super, 832-555-0101', cams_total: '3', customer_type: 'Multi-Family / Apartments', facility_type: 'Secure Enclosed Fenced Area',
  issues: 'Copper theft at night.', s_sun_start: '6pm', s_sun_end: '6am',
  ...Object.fromEntries(DAYS.slice(1).flatMap(([k]) => [['s_' + k + '_start', 'Same as above'], ['s_' + k + '_end', 'Same as above']])),
  cam1_name: 'Helios 002 / Cam 001', cam1_type: 'IP Camera', cam1_ip: '38.246.195.56', cam1_port: '1400 web, 1454 RTSP', cam1_login: 'admin', cam1_password: 'Pa$$<w0rd>', cam1_audio: 'YES'});
const mimeParts = raw => {
  const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
  const boundary = /boundary="([^"]+)"/.exec(text)[1];
  return {text, parts: text.split('--' + boundary).slice(1, -1).map(p => { const [head, ...b] = p.split('\r\n\r\n'); return {head, body: Buffer.from(b.join('').replace(/\r\n/g, ''), 'base64')}; })};
};

test('approved IT sees only the two Eyeforce forms, and can look up the unit cameras', async () => {
  const t = await server({who: it}).post({action: 'templates'});
  assert.deepEqual(Object.keys(t.body.templates).sort(), ['monitor_add', 'monitor_swap']);
  assert.equal(t.body.owner, false);
  assert.equal(t.body.templates.monitor_add.defaults.mgr, 'Felipe Presas');
  assert.ok(t.body.templates.monitor_add.fields.find(f => f.key === 'foliage').options.includes('WILL BE TRIMMED'));
  assert.equal(Object.keys((await server().post({action: 'templates'})).body.templates).length, 5);
  const cams = (await server({who: it}).post({action: 'cameras', unit: 'Helios 002'})).body.cameras;
  assert.deepEqual(cams.map(c => [c.name, c.type, c.port]), [['Helios 002 / Cam 001', 'IP Camera', '1400 web, 1454 RTSP'],
    ['Helios 002 / Cam 002', 'IP Camera', '1500 web, 1554 RTSP'], ['Helios 002 / PTZ 003', 'PTZ Camera', '1600 web, 1654 RTSP']]);
  assert.deepEqual((await server({who: it}).post({action: 'cameras', unit: 'nothing'})).body.cameras, []);
  assert.equal((await server({who: it}).post({action: 'send', kind: 'sim_cancel_vendera', request_id: randomUUID(), values: {...unit, sim: SIM, reason: 'x'}})).status, 403);
});

test('the account form checks its lists and blanks in plain words', async () => {
  const bad = {...form(), foliage: 'maybe', customer_type: 'OTHER', s_sun_start: 'Same as above', audio: 'YES', speakers: ''};
  for (let i = 1; i <= 16; i++) delete bad['cam' + i + '_name'];
  const r = (await server({who: it}).post({action: 'preview', kind: 'monitor_add', values: bad})).body;
  assert.equal(r.ok, false);
  for (const m of ['Trees, bushes or animals that could cause false alarms?: pick one from the list', 'If OTHER, what it is', 'How many speakers', 'Camera 1: its name']) assert.ok(r.missing.includes(m), m);
  assert.ok(r.missing.some(m => /^Sunday: "Same as above"/.test(m)));
});

test('IT sends the account form: summary in the email, the filled Eyeforce form attached, signed once by the tech', async () => {
  const s = server({who: it}), id = randomUUID();
  const p = await s.post({action: 'preview', kind: 'monitor_add', values: form()});
  assert.equal(p.body.form, 'CIF Mesa Village MHP 11 25 2026.xlsx');
  assert.doesNotMatch(p.body.mail.body, /Pa\$\$/);
  assert.match(p.body.mail.body, /Camera logins and passwords are in the attached form, tab 3\./);
  assert.match(p.body.mail.body, /Crime in progress: 1 - Dispatch immediately then notify contact list/);
  assert.equal(p.body.mail.body.match(/Teddy Hopper/g).length, 1);
  assert.doesNotMatch(p.body.mail.body, /Operations Manager/);
  const r = await s.post({action: 'send', kind: 'monitor_add', request_id: id, values: form()});
  assert.deepEqual([r.body.ok, r.body.to, r.body.sheet], [true, 'techops@eyeforce.com', 'not_logged_here']);
  const raw = JSON.parse(s.seen.find(x => x.url.includes('gmail')).body).raw;
  const {text, parts} = mimeParts(raw);
  assert.match(text, /^From: "Teddy Hopper via COS" <jmartin@camerasonsite\.com>\r\nTo: techops@eyeforce\.com\r\nCc: IT@camerasonsite\.com/);
  assert.equal(parts.length, 2);
  assert.match(parts[1].head, /filename="CIF Mesa Village MHP 11 25 2026\.xlsx"/);
  const files = await unzip(new Uint8Array(parts[1].body));
  const tab1 = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')), tab3 = new TextDecoder().decode(files.get('xl/worksheets/sheet5.xml'));
  assert.match(tab1, /<c r="A3"[^>]*t="inlineStr"><is><t xml:space="preserve">Mesa Village MHP\n8945 Forest Hollow/);
  assert.match(tab1, /<c r="J25"[^>]*><is><t xml:space="preserve">NOT AT THIS TIME</);
  assert.match(tab3, /<c r="G15"[^>]*><is><t xml:space="preserve">Pa\$\$&lt;w0rd&gt;</);
  assert.match(new TextDecoder().decode(files.get('xl/ctrlProps/ctrlProp3.xml')), /checked="Checked"/);
  assert.doesNotMatch(new TextDecoder().decode(files.get('xl/ctrlProps/ctrlProp1.xml')), /checked/);
  assert.match(new TextDecoder().decode(files.get('xl/workbook.xml')), /fullCalcOnLoad="1"/);
  assert.doesNotMatch(new TextDecoder().decode(files.get('xl/sharedStrings.xml')), /1q2w3e4r5t/);
  // COS keeps the request, but never the camera password.
  const rec = (await db.query('select vals, mail, requested_by_name from app_private.vendor_requests where id=$1', [id])).rows[0];
  assert.equal(rec.vals.cam1_password, '(given)');
  assert.equal(rec.requested_by_name, 'Teddy Hopper');
  assert.doesNotMatch(JSON.stringify(rec), /Pa\$\$/);
});

test('a unit swap goes with the new unit cameras on the form, and James still signs his own', async () => {
  const s = server();
  const v = {eye: 'EYE17351', unit: 'Helios 003', new_unit: 'Helios 002', site: 'Mesa Village MHP', date: '11/25/2026', cam_brand: 'ALIBI', cam1_name: 'Helios 002 / Cam 001'};
  const r = await s.post({action: 'send', kind: 'monitor_swap', request_id: randomUUID(), values: v});
  assert.equal(r.body.state, 'sent');
  const {parts} = mimeParts(JSON.parse(s.seen.find(x => x.url.includes('gmail')).body).raw);
  const mail = parts[0].body.toString("utf8").replace(/\r\n/g, "\n");
  assert.match(mail, /Unit taken out: Helios 003\nUnit put in: Helios 002/);
  assert.equal(mail.match(/James Martin/g).length, 1);
  const files = await unzip(new Uint8Array(parts[1].body));
  assert.match(new TextDecoder().decode(files.get('xl/worksheets/sheet5.xml')), /<c r="A15"[^>]*><is><t xml:space="preserve">Helios 002 \/ Cam 001</);
  const f = await s.post({action: 'form', kind: 'monitor_swap', values: v});
  assert.equal(f.body.name, 'CIF swap EYE17351 Mesa Village MHP 11 25 2026.xlsx');
  assert.ok(Buffer.from(f.body.b64, 'base64').length > 40000);
});

test('the cancellation row goes through the Operations sheet account, with formulas made plain text', async () => {
  const s = server();
  const c = await s.post({action: 'check'});
  assert.deepEqual([c.body.can_edit_sheets, c.body.sheet_opens], [true, true]);
  assert.equal((await server({sheet: {ok: false}}).post({action: 'check'})).body.can_edit_sheets, false);
  await s.post({action: 'send', kind: 'sim_cancel_simetry', request_id: randomUUID(), values: {...unit, customer: '=HYPERLINK("x")', sim: SIM, reason: 'x'}});
  const row = JSON.parse(s.seen.filter(x => x.url.includes('cos-deactivation-log')).at(-1).body).row;
  assert.equal(row[1], "'=HYPERLINK(\"x\")");
  assert.ok(!s.seen.some(x => x.url.includes('sheets.googleapis.com')));
});
