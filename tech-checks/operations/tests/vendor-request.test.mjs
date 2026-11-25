import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {TEMPLATES, check, render, sheetRow, rawEmail} from '../../supabase/functions/cos-vendor-request/templates.ts';
import {createVendorHandler} from '../../supabase/functions/cos-vendor-request/index.ts';

// Vendor emails from the unit card: same template every time, owner only, sent once, then logged.
const owner = '00000000-0000-4000-8000-0000000000c1', it = '00000000-0000-4000-8000-0000000000b1';
const unit = {unit: 'Spotter 268', customer: 'Blazer Building Southwest', site: 'Clayton at Tour 18', address: '17935 Hunters Terrace Dr, Humble, TX 77338', job: '22703'};
const SIM = '89852350825066019344';
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema app_private;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean, archived_at timestamptz, full_name text, username text);`);
  await db.query("insert into public.profiles values($1,'owner',true,null,'James Martin','james'),($2,'it',true,null,'Teddy Hopper','teddy')", [owner, it]);
  const s = readFileSync(new URL('../../database-maintenance/cos-vendor-requests-v1.sql', import.meta.url), 'utf8');
  await db.exec(s); await db.exec(s);
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
    if (url.includes('sheets.googleapis.com')) return json(sheet.ok ? 200 : 403, sheet.ok ? {updates: {updatedRange: "'Deactivation History'!A290:I290"}} : {});
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
  assert.ok(check('monitor_add', {unit: 'Spotter 268'}).missing.includes('Call list (name and phone, in order)'));
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
  assert.match(text, /^From: James Martin <jmartin@camerasonsite\.com>\r\nTo: support@simetry\.com\r\nCc: IT@camerasonsite\.com\r\n/);
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
  const row = JSON.parse(s.seen.find(x => x.url.includes('sheets')).body).values[0];
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
