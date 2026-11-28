import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

// Watchful setup check: the acceptance tests of the 11/27 spec (section 8), run against the
// real change file through the same public functions the phone screens call.
const josh = '00000000-0000-4000-8000-0000000000a1', abel = '00000000-0000-4000-8000-0000000000a2';
const teddy = '00000000-0000-4000-8000-0000000000b1', james = '00000000-0000-4000-8000-0000000000c1';
const gone = '00000000-0000-4000-8000-0000000000d1';
const change = readFileSync(new URL('../../database-maintenance/watchful-setup-check-v1.sql', import.meta.url), 'utf8');
let db;

const as = async who => db.query("select set_config('test.actor', $1, false)", [who || '']);
async function call(who, fn, ...args) {
  await as(who);
  const marks = args.map((_, i) => '$' + (i + 1)).join(', ');
  const r = await db.query(`select public.${fn}(${marks}) as v`, args.map(a => a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a));
  return r.rows[0]?.v;
}
async function refuses(promise, pattern) {
  await assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
}
let photoN = 0;
async function photo(who, check) {
  const name = who + '/' + check + '/' + createHash('sha256').update(String(++photoN)).digest('hex') + '.jpg';
  await db.query("insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', $1, '{\"size\": 52000}')", [name]);
  return name;
}
const model = async (m, role) => (await db.query('select id from app_private.ws_device_models where model = $1 and device_role::text = $2', [m, role])).rows[0].id;
const items = (chk, code) => chk.sections.flatMap(s => s.items).filter(i => !code || i.code === code);

// Do every step that can be done, with a photo wherever one is required.
async function doAll(who, chk) {
  for (const it of items(chk)) {
    if (it.standardStatus === 'PLACEHOLDER' || it.result !== 'pending') continue;
    chk = await call(who, 'ws_set_item_v1', it.id, 'done', it.options?.[0] ?? null, null, null);
    if (it.evidence === 'required') chk = await call(who, 'ws_add_photo_v1', it.id, await photo(who, chk.id));
  }
  return chk;
}
async function walkAll(who, chk) {
  chk = await call(who, 'ws_test_mode_v1', chk.id, true, await photo(who, chk.id));
  for (const c of chk.selection.cameras.filter(c => !c.isSpeaker && !c.walk.passed))
    chk = await call(who, 'ws_walk_v1', c.id, true, new Date(Date.now() + 1000).toISOString(), await photo(who, chk.id));
  return call(who, 'ws_test_mode_v1', chk.id, false, await photo(who, chk.id));
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean default true, archived_at timestamptz, full_name text, username text);
    create table public.camera_devices(id bigserial primary key, unit_key text, device_name text, device_type text, device_model text,
      tech_check_unit_type text, do_not_use boolean default false, activation_state text);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    alter table storage.objects enable row level security;
    insert into public.profiles(user_id, role, full_name, active, archived_at) values
      ('${josh}','service','Josh',true,null), ('${abel}','service','Abel',true,null), ('${teddy}','it','Teddy',true,null),
      ('${james}','owner','James',true,null), ('${gone}','service','Old Tech',false,now());
    insert into public.camera_devices(unit_key, device_name, device_type, device_model, tech_check_unit_type) values
      ('SPOTTER 236','Spotter 236HD','NVR','ALI-NR040F-1','NVR'),
      ('SOLARSPOTTER 003','SS003_1','IPC','ALI-PB81-AI-D','Solar Spotter'), ('SOLARSPOTTER 003','SS003_2','IPC','ALI-PB81-AI-D','Solar Spotter'),
      ('SOLARSPOTTER 003','SS003_3','IPC','ALI-PB81-AI-D','Solar Spotter'), ('SOLARSPOTTER 003','SS003_4','IPC','ALI-PB81-AI-D','Solar Spotter'),
      ('HELIOS 005','Helios 005 - Cam 001','IPC','ALI-PB50-LUAIS-D','Helios'), ('HELIOS 005','Helios 005 - Cam 002','IPC','ALI-PB50-LUAIS-D','Helios'),
      ('HELIOS 005','Helios 005 - Cam 003','IPC','ALI-PZ40-UZAI-D','Helios'),
      ('SNIPER 302','Sniper 302','Sniper','Sniper','Sniper'), ('RANGER 024','Ranger 024','IPC','ALI-PT50-LUAIS-D','Ranger'),
      ('HELIOS 013','Helios 013 / PTZ Cam 003 & Cam 004','IPC','ALI-PZ40-UZAI-D','Helios'), ('HELIOS 013','Helios 013 / Cam 001','IPC','ALI-PB50-LUAIS-D','Helios'),
      ('RII005 - Newmark/Gembler','Camera 1: F1DC','Reconeyez detector','detector_hdr_xrl','Recon');
  `);
  await db.exec(change);
});
after(async () => { await db?.close(); });

test('only active Tech Check accounts get in', async () => {
  await refuses(call(null, 'ws_home_v1'), /Sign in to Tech Check/);
  await refuses(call(gone, 'ws_home_v1'), /Sign in to Tech Check/);
  const home = await call(josh, 'ws_home_v1');
  assert.equal(home.me.canTech, true); assert.equal(home.me.canOffice, false);
  assert.equal(home.quiet, null, 'Service does not see the quiet list');
  assert.ok((await call(teddy, 'ws_home_v1')).quiet, 'IT sees the quiet counts');
});

test('20-24 pick list and catalog', async () => {
  const spot = await call(josh, 'ws_options_v1', 'Spotter (NVR trailer)');
  assert.deepEqual(spot.choices.nvr.map(m => m.model), ['ALI-NR040F-1', 'ALI-NR041F-1', 'ALI-NR042F-1', 'ALI-NR042F-1-D']);
  assert.deepEqual(spot.choices.nvr_channel.map(m => m.model), ['ALI-FB21-A', 'ALI-FB41-UA-D']);
  const hel = await call(josh, 'ws_options_v1', 'Helios');
  assert.equal(hel.hasRecorder, false); assert.equal(hel.choices.nvr, undefined);
  assert.deepEqual([...hel.choices.standalone, ...hel.choices.ptz, ...hel.choices.speaker].map(m => m.model), ['ALI-PB50-LUAIS-D', 'ALI-PZ40-UZAI-D', 'model not read']);
  const n = (await db.query(`select (select count(*) from app_private.ws_unit_type_models where snapshot_units is not null)
    + (select count(*) from app_private.ws_unit_type_model_gaps) as n`)).rows[0].n;
  assert.equal(Number(n), 36, 'all 36 catalog rows loaded');
});

test('finding a unit fills in what COS already has on file', async () => {
  const [u] = await call(josh, 'ws_find_units_v1', 'spotter 236');
  assert.equal(u.key, 'SPOTTER 236'); assert.equal(u.label, 'Spotter 236HD');
  assert.equal(u.suggestedType, 'Spotter (NVR trailer)'); assert.equal(u.recorderModel, 'ALI-NR040F-1');
  const [ss] = await call(josh, 'ws_find_units_v1', 'ss003');
  assert.equal(ss.suggestedType, 'Solar Spotter (SS)'); assert.equal(ss.cameras.length, 4);
  assert.deepEqual(await call(josh, 'ws_find_units_v1', 'x'), []);
  assert.equal((await call(josh, 'ws_find_units_v1', 'helios 013'))[0].label, 'Helios 013', 'cut at the slash');
  assert.equal((await call(josh, 'ws_find_units_v1', 'rii005'))[0].label, 'RII005 - Newmark/Gembler', 'a bare camera name is never the unit name');
  assert.equal((await call(josh, 'ws_find_units_v1', 'sniper 302'))[0].label, 'Sniper 302', 'a unit number is never cut');
});

let nvrCheck, ssCheck;
test('25 NVR unit: mail items once, N1-N5 and P1-P4 per channel', async () => {
  let c = await call(josh, 'ws_start_v1', 'SPOTTER 236', 'Spotter 236HD', 'District West Phase 3', 'Spotter (NVR trailer)', 'new');
  assert.equal(c.status, 'draft');
  const again = await call(abel, 'ws_start_v1', 'spotter 236', 'Spotter 236HD', null, 'Spotter (NVR trailer)', 'new');
  assert.equal(again.id, c.id, 'a second start opens the same check, never a second one');
  const fb21 = await model('ALI-FB21-A', 'camera_on_nvr_channel');
  c = await call(josh, 'ws_save_selection_v1', c.id, false, await model('ALI-NR040F-1', 'nvr'), null, null, null,
    JSON.stringify([1, 2, 3, 4].map(p => ({position: p, role: 'camera_on_nvr_channel', model_id: fb21, name: 'Spotter 236HD ch' + p}))));
  assert.equal(items(c).filter(i => /^M/.test(i.code)).length, 8);
  assert.equal(items(c).filter(i => /^N/.test(i.code)).length, 20);
  assert.equal(items(c).filter(i => /^P/.test(i.code)).length, 16);
  assert.equal(c.status, 'in_progress');
  nvrCheck = c;
});

test('26 standalone PB81-AI-D unit: M1-M8 and C1-C5 per camera', async () => {
  let c = await call(abel, 'ws_start_v1', 'SOLARSPOTTER 003', 'SS003', null, 'Solar Spotter (SS)', 'new');
  const pb = await model('ALI-PB81-AI-D', 'camera_standalone');
  c = await call(abel, 'ws_save_selection_v1', c.id, true, null, null, null, null,
    JSON.stringify([1, 2, 3, 4].map(p => ({position: p, role: 'camera_standalone', model_id: pb, name: 'SS003_' + p}))));
  assert.equal(items(c).filter(i => /^M/.test(i.code)).length, 32);
  assert.equal(items(c).filter(i => /^C/.test(i.code)).length, 20);
  assert.ok(!c.sections.some(s => s.title === 'Recorder'));
  ssCheck = c;
});

test('22 Sniper: no device items, only Watchful items and the walk test', async () => {
  const av = await model('model not recorded in COS/Watchful', 'closed_system');
  let c = await call(josh, 'ws_start_v1', 'SNIPER 302', 'Sniper 302', null, 'Sniper', 'new');
  c = await call(josh, 'ws_save_selection_v1', c.id, true, null, null, null, av,
    JSON.stringify([1, 2].map(p => ({position: p, role: 'closed_system', model_id: av, name: 'Sniper 302 Cam ' + p}))));
  assert.deepEqual([...new Set(items(c).map(i => i.code))].sort(), ['A1', 'A2', 'A3', 'U1', 'U2', 'U3', 'U4', 'U5']);
  assert.equal(c.selection.cameras.filter(x => x.walk).length, 2);
});

test('27 30 31 32 placeholders, blockers, early events, failed attempts', async () => {
  let c = nvrCheck;
  const n5 = items(c, 'N5')[0];
  await refuses(call(josh, 'ws_set_item_v1', n5.id, 'done', null, null, null), /Pending standard/);
  assert.ok(items(c, 'N1').every(i => i.standardStatus === 'UNCONFIRMED'));
  assert.ok(c.notices.standard_unconfirmed.body.includes('13 working cameras'));
  await refuses(call(josh, 'ws_submit_v1', c.id), /not done/);
  const na = items(c, 'M8')[0];
  await refuses(call(josh, 'ws_set_item_v1', na.id, 'na', null, '', null), /reason is required/);
  await refuses(call(josh, 'ws_set_item_v1', items(c, 'N4')[0].id, 'done', 'every other tuesday', null, null), /Pick the arming hours/);
  c = await doAll(josh, c);
  assert.ok(!c.blockers.some(b => /N5/.test(b)), 'placeholders never block');
  assert.ok(c.blockers.some(b => /walk test not passed/.test(b)));
  await refuses(call(josh, 'ws_walk_v1', c.selection.cameras[0].id, true, new Date().toISOString(), await photo(josh, c.id)), /Test mode on first/);
  c = await call(josh, 'ws_test_mode_v1', c.id, true, await photo(josh, c.id));
  const cam = c.selection.cameras[0];
  await refuses(call(josh, 'ws_walk_v1', cam.id, true, new Date(Date.now() - 3600e3).toISOString(), await photo(josh, c.id)), /Not a pass/);
  for (let k = 0; k < 3; k++) c = await call(josh, 'ws_walk_v1', cam.id, false, null, null);
  const w = c.selection.cameras[0].walk;
  assert.equal(w.checkSettings, true); assert.equal(w.attempts.length, 3);
  for (const x of c.selection.cameras)
    c = await call(josh, 'ws_walk_v1', x.id, true, new Date(Date.now() + 1000).toISOString(), await photo(josh, c.id));
  await refuses(call(josh, 'ws_submit_v1', c.id), /Test mode is still recorded as on/);
  c = await call(josh, 'ws_test_mode_v1', c.id, false, await photo(josh, c.id));
  c = await call(josh, 'ws_submit_v1', c.id);
  assert.equal(c.status, 'awaiting_office'); assert.equal(c.canEdit, false);
  await refuses(call(josh, 'ws_set_item_v1', na.id, 'pending', null, null, null), /awaiting_office/);
  nvrCheck = c;
});

test('3.2 3.3 photos: one mail-page photo covers M1-M3, never on M4, only your own uploads', async () => {
  let c = ssCheck;
  for (const it of items(c)) if (it.standardStatus !== 'PLACEHOLDER') c = await call(abel, 'ws_set_item_v1', it.id, 'done', it.options?.[0] ?? null, null, null);
  const missing = () => c.blockers.filter(b => /\(M[123]\): photo missing/.test(b)).length;
  assert.equal(missing(), 12);
  const m2 = items(c, 'M2').find(i => c.selection.cameras.find(x => x.id === i.cameraId).position === 1);
  c = await call(abel, 'ws_add_photo_v1', m2.id, await photo(abel, c.id));
  assert.equal(missing(), 9);
  await refuses(call(abel, 'ws_add_photo_v1', items(c, 'M4')[0].id, await photo(abel, c.id)), /Do not photograph/);
  await refuses(call(abel, 'ws_add_photo_v1', m2.id, await photo(josh, c.id)), /did not upload/);
  await refuses(call(abel, 'ws_add_photo_v1', m2.id, abel + '/' + c.id + '/' + 'f'.repeat(64) + '.jpg'), /did not finish uploading/);
});

test('34 35 36 office sign-off', async () => {
  const c = nvrCheck, path = await photo(teddy, c.id);
  await refuses(call(josh, 'ws_sign_off_v1', c.id, 4, 4, path, null), /Only IT or the owner/);
  await refuses(call(teddy, 'ws_sign_off_v1', c.id, 3, 4, path, null), /Counts do not match/);
  await refuses(call(teddy, 'ws_sign_off_v1', c.id, 5, 5, path, null), /Counts do not match/);
  const done = await call(teddy, 'ws_sign_off_v1', c.id, 4, 4, path, null);
  assert.equal(done.status, 'live'); assert.equal(done.officeSignedBy, 'Teddy');
  const cams = (await db.query("select count(*) n from app_private.ws_unit_cameras where unit_key = 'SPOTTER 236' and not retired")).rows[0].n;
  assert.equal(Number(cams), 4);
  assert.equal((await db.query("select placement from app_private.ws_unit_placement where unit_key = 'SPOTTER 236'")).rows[0].placement, 'field');
});

test('23 33 35 model not on file, walk-test waiver, same-person sign-off', async () => {
  let c = await call(teddy, 'ws_start_v1', 'HELIOS 005', 'Helios 005', 'Quiet Acres', 'Helios', 'new');
  const pb50 = await model('ALI-PB50-LUAIS-D', 'camera_standalone');
  const label = await photo(teddy, c.id);
  await refuses(call(teddy, 'ws_save_selection_v1', c.id, true, null, null, null, null,
    JSON.stringify([{position: 1, role: 'camera_standalone', name: 'Helios 005 - Cam 001'}])), /enter the model exactly/);
  c = await call(teddy, 'ws_save_selection_v1', c.id, true, null, null, null, null, JSON.stringify([
    {position: 1, role: 'camera_standalone', model_id: pb50, name: 'Helios 005 - Cam 001'},
    {position: 2, role: 'camera_standalone', not_on_file: 'ALI-PB50-LUAIS-X', label_path: label, name: 'Helios 005 - Cam 002'},
    {position: 3, role: 'camera_ptz', model_id: await model('ALI-PZ40-UZAI-D', 'camera_ptz'), name: 'Helios 005 - Cam 003'},
    {position: 4, role: 'ip_speaker', model_id: await model('model not read', 'ip_speaker'), name: 'Helios 005 - IP Speaker'}]));
  const c2 = c.selection.cameras.find(x => x.position === 2);
  assert.equal(c2.labelPhoto, label);
  assert.ok(items(c).some(i => i.cameraId === c2.id && i.code === 'C1') && !items(c).some(i => i.cameraId === c2.id && i.code === 'C5'),
    'not-on-file camera uses the generic standard');
  assert.equal(c.selection.cameras.filter(x => x.walk).length, 3, 'speaker is not walk-tested');
  c = await doAll(teddy, c);
  c = await call(teddy, 'ws_test_mode_v1', c.id, true, await photo(teddy, c.id));
  for (const x of c.selection.cameras.filter(x => x.walk && x.position !== 3))
    c = await call(teddy, 'ws_walk_v1', x.id, true, new Date(Date.now() + 1000).toISOString(), await photo(teddy, c.id));
  c = await call(teddy, 'ws_test_mode_v1', c.id, false, await photo(teddy, c.id));
  const ptz = c.selection.cameras.find(x => x.position === 3);
  await refuses(call(teddy, 'ws_waive_walk_v1', ptz.id, 'mount broken'), /Only the owner/);
  await refuses(call(james, 'ws_waive_walk_v1', ptz.id, ''), /reason is required/);
  c = await call(james, 'ws_waive_walk_v1', ptz.id, 'PTZ on order, mount broken');
  c = await call(teddy, 'ws_submit_v1', c.id);
  const count = await photo(teddy, c.id);
  await refuses(call(teddy, 'ws_sign_off_v1', c.id, 3, 3, count, null), /model not on file/);
  c = await call(james, 'ws_map_model_v1', c.id, c2.id, pb50, 'label read as PB50-LUAIS-D');
  await refuses(call(teddy, 'ws_sign_off_v1', c.id, 3, 3, count, null), /different person/);
  await refuses(call(james, 'ws_sign_off_v1', c.id, 3, 3, count, null), /did not upload/);
  c = await call(james, 'ws_sign_off_v1', c.id, 3, 3, await photo(james, c.id), null);
  assert.equal(c.status, 'live');
  const flag = (await db.query("select flag_walk_test_waived from app_private.ws_unit_cameras where unit_key = 'HELIOS 005' and position = 3")).rows[0];
  assert.equal(flag.flag_walk_test_waived, true);
  const audit = (await db.query("select count(*) n from app_private.ws_audit_log where action in ('walk_test_waived','model_mapped')")).rows[0];
  assert.equal(Number(audit.n), 2);
  // the owner did the whole Sniper check alone: the office step needs a reason
  let s = await call(james, 'ws_check_v1', (await call(james, 'ws_find_units_v1', 'sniper 302'))[0].openCheck);
  s = await doAll(james, s); s = await walkAll(james, s); s = await call(james, 'ws_submit_v1', s.id);
  const p2 = await photo(james, s.id);
  await refuses(call(james, 'ws_sign_off_v1', s.id, 2, 2, p2, null), /different person/);
  s = await call(james, 'ws_sign_off_v1', s.id, 2, 2, p2, 'small crew tonight');
  assert.equal(s.status, 'live');
  assert.equal(Number((await db.query("select count(*) n from app_private.ws_audit_log where action = 'separation_override'")).rows[0].n), 1);
});

test('office send-back reopens only the flagged steps', async () => {
  let c = await call(abel, 'ws_start_v1', 'RANGER 024', 'Ranger 024', null, 'Ranger', 'new');
  const pt = await model('ALI-PT50-LUAIS-D', 'camera_standalone');
  c = await call(abel, 'ws_save_selection_v1', c.id, true, null, null, null, null, JSON.stringify([{position: 1, role: 'camera_standalone', model_id: pt, name: 'Ranger 024'}]));
  c = await doAll(abel, c); c = await walkAll(abel, c); c = await call(abel, 'ws_submit_v1', c.id);
  const c4 = items(c, 'C4')[0];
  c = await call(teddy, 'ws_send_back_v1', c.id, 'Arming hours should be nights and weekends', [c4.id]);
  assert.equal(c.status, 'returned');
  await refuses(call(abel, 'ws_set_item_v1', items(c, 'C1')[0].id, 'pending', null, null, null), /sent back/);
  // the first walk test was a while ago; the change happens now
  await db.query(`update app_private.ws_walk_test_attempts a set watchful_event_time = now() - interval '10 minutes'
    from app_private.ws_install_cameras c where c.id = a.install_camera_id and c.install_id = $1`, [c.id]);
  c = await call(abel, 'ws_set_item_v1', c4.id, 'done', 'Customer hours: nights and weekends', null, null);
  // the walk test must happen again after the change
  assert.ok(c.blockers.some(b => /walk test not passed/.test(b)));
  c = await walkAll(abel, c);
  c = await call(abel, 'ws_submit_v1', c.id);
  assert.equal(c.status, 'awaiting_office');
});

test('28 29 publishing a filled placeholder flags live units, keeps open checks on their version', async () => {
  await as(james);
  const old = (await db.query(`select t.id from app_private.ws_checklist_templates t join app_private.ws_device_models m on m.id = t.device_model_id
    where m.model = 'ALI-NR040F-1' and t.status = 'published'`)).rows[0].id;
  const draft = (await db.query('select app_private.ws_new_template_draft($1) as id', [old])).rows[0].id;
  await db.query("update app_private.ws_checklist_template_items set standard_status = 'CONFIRMED', standard = 'Intrusion linkage: Email', placeholder_key = null where template_id = $1 and code = 'N5'", [draft]);
  await db.query("select app_private.ws_publish_template($1, 'N5 from confirmed_standards.md')", [draft]);
  const flagged = (await db.query("select bool_and(flag_recheck_needed and 'N5' = any(flag_recheck_items)) ok from app_private.ws_unit_cameras where unit_key = 'SPOTTER 236' and not retired")).rows[0].ok;
  assert.equal(flagged, true);
  const live = await call(josh, 'ws_check_v1', nvrCheck.id);
  assert.equal(live.status, 'live', 'not blocked');
  await refuses(db.query("update app_private.ws_checklist_template_items set title = 'x' where template_id = $1", [old]), /cannot be changed/);
});

test('37-43 quiet cameras', async () => {
  const read = new Date(Date.now() - 3600e3), days = d => new Date(read - d * 86400e3).toISOString();
  await refuses(call(josh, 'ws_quiet_v1'), /Only IT or the owner/);
  const r = await call(teddy, 'ws_import_v1', 'csv', read.toISOString(), JSON.stringify([
    {site: 'District West Phase 3', unit: 'Spotter 236HD', camera: 'Spotter 236HD ch1', last_event_at: days(8)},
    {site: 'District West Phase 3', unit: 'Spotter 236HD', camera: 'Spotter 236HD ch2', last_event_at: days(6)},
    {site: 'District West Phase 3', unit: 'Spotter 236HD', camera: 'Spotter 236HD ch3', last_event_at: days(1)},
    {site: 'District West Phase 3', unit: 'Spotter 236HD', camera: 'Spotter 236HD - Cam 004', last_event_at: days(1)},
    {site: 'Quiet Acres', unit: 'Helios 005', camera: 'Helios 005 - Cam 001', last_event_at: days(2)},
    {site: 'Yard', unit: 'Spotter 999', camera: 'Spotter 999 ch1', last_event_at: days(30)}]));
  assert.deepEqual(r, {rows: 6, matched: 4, unmatched: 2});
  let q = await call(teddy, 'ws_quiet_v1');
  const cam = name => q.cameras.find(x => x.camera === name);
  assert.equal(cam('Spotter 236HD ch1').status, 'quiet');
  assert.equal(cam('Spotter 236HD ch2').status, 'ok'); assert.equal(cam('Spotter 236HD ch2').soon, true);
  assert.equal(cam('Spotter 236HD ch3').status, 'ok'); assert.equal(cam('Spotter 236HD ch3').soon, false);
  assert.equal(cam('Spotter 236HD ch4').status, 'unknown', 'unmatched name = Unknown');
  assert.equal(cam('Helios 005 - Cam 002').status, 'unknown', 'no data = Unknown');
  assert.equal(q.unmatched.length, 2);
  assert.ok(!JSON.stringify(q).match(/offline|outage/i), 'never Offline or Outage');
  const alert = cam('Spotter 236HD ch1').alert;
  await refuses(call(teddy, 'ws_ack_v1', alert.id, ''), /Say who is on it/);
  await call(teddy, 'ws_ack_v1', alert.id, 'Josh heading out Monday');
  q = await call(teddy, 'ws_quiet_v1');
  assert.equal(cam('Spotter 236HD ch1').alert.ackNote, 'Josh heading out Monday', 'ack marks who is on it, does not hide it');
  // 42 map the Cam 004 name to ch4; a never-checklisted unit can be watched as legacy
  await call(teddy, 'ws_map_name_v1', 'District West Phase 3', 'Spotter 236HD', 'Spotter 236HD - Cam 004', cam('Spotter 236HD ch4').id, null);
  await call(teddy, 'ws_map_name_v1', 'Yard', 'Spotter 999', 'Spotter 999 ch1', null, 'SPOTTER 999');
  q = await call(teddy, 'ws_quiet_v1');
  assert.equal(cam('Spotter 236HD ch4').status, 'ok'); assert.equal(q.unmatched.length, 0);
  assert.equal(cam('Spotter 999 ch1').legacy, true);
  // 40 a new event closes the alert
  await call(teddy, 'ws_import_v1', 'api', new Date().toISOString(), JSON.stringify([
    {site: 'District West Phase 3', unit: 'Spotter 236HD', camera: 'Spotter 236HD ch1', last_event_at: new Date().toISOString()}]));
  const closed = (await db.query("select close_reason from app_private.ws_quiet_camera_alerts where id = $1", [alert.id])).rows[0];
  assert.equal(closed.close_reason, 'event received');
  // 38 a unit in the shop is never quiet
  await call(teddy, 'ws_placement_v1', 'SPOTTER 999', 'shop', 'back for repair');
  q = await call(teddy, 'ws_quiet_v1');
  assert.equal(cam('Spotter 999 ch1').status, 'excluded'); assert.equal(cam('Spotter 999 ch1').alert, null);
  // 39 stale reading = Unknown
  const later = (await db.query("select status from app_private.ws_camera_status_at(now() + interval '2 days') where camera_name = 'Spotter 236HD ch3'")).rows[0];
  assert.equal(later.status, 'unknown');
  // 41 per-site N
  await refuses(call(teddy, 'ws_alert_setting_v1', 'site', 'District West Phase 3', 14, null), /Only the owner/);
  await call(james, 'ws_alert_setting_v1', 'site', 'District West Phase 3', 14, null);
  q = await call(teddy, 'ws_quiet_v1');
  assert.equal(cam('Spotter 236HD ch2').quietDays, 14); assert.equal(cam('Helios 005 - Cam 001').quietDays, 7);
  // 43 nothing here changes camera_devices
  const devices = (await db.query('select count(*) n from public.camera_devices')).rows[0].n;
  assert.equal(Number(devices), 13);
});

test('44 45 no secrets, no fields for them', async () => {
  const c = await call(josh, 'ws_start_v1', 'SPOTTER 777', 'Spotter 777', null, 'Spotter (NVR trailer)', 'new');
  const saved = await call(josh, 'ws_save_selection_v1', c.id, false, await model('ALI-NR040F-1', 'nvr'), null, null, null,
    JSON.stringify([{position: 1, role: 'camera_on_nvr_channel', model_id: await model('ALI-FB21-A', 'camera_on_nvr_channel'), name: 'Spotter 777 ch1'}]));
  const it = items(saved, 'U1')[0].id;
  await refuses(call(josh, 'ws_set_item_v1', it, 'done', null, null, 'cam at 192.168.1.64 reset'), /looks like an IP address/);
  await refuses(call(josh, 'ws_set_item_v1', it, 'na', null, 'token 9f8a7b6c5d4e3f2a1b0c9d8e7f', null), /looks like a token/);
  await refuses(call(josh, 'ws_set_item_v1', it, 'done', null, null, 'password: hunter2'), /looks like a password/);
  await refuses(call(josh, 'ws_start_v1', 'SPOTTER 778', 'Spotter 778', '10.0.0.5', 'Spotter (NVR trailer)', 'new'), /IP address/);
  const ok = await call(josh, 'ws_set_item_v1', it, 'done', null, null, 'Model ALI-PB81-AI-D, all good');
  assert.equal(items(ok, 'U1')[0].note, 'Model ALI-PB81-AI-D, all good');
  const cols = (await db.query(`select count(*) n from information_schema.columns where table_schema = 'app_private' and table_name like 'ws\\_%'
    and column_name ~* 'password|passwd|token|(^|_)ip(_|$)|ip_address|serial'`)).rows[0].n;
  assert.equal(Number(cols), 0);
});

test('47 48 audit is append-only; roles hold', async () => {
  await refuses(db.query('update app_private.ws_audit_log set reason = $1', ['x']), /cannot be changed/);
  await refuses(db.query('delete from app_private.ws_audit_log'), /cannot be changed/);
  const actions = (await db.query('select array_agg(distinct action) a from app_private.ws_audit_log')).rows[0].a;
  for (const a of ['install_created', 'selection_changed', 'item_result', 'evidence_uploaded', 'walk_test_attempt', 'test_mode_on', 'test_mode_off',
    'tech_submitted', 'office_signed_off', 'office_sent_back', 'walk_test_waived', 'separation_override', 'placeholder_filled', 'event_import',
    'name_mapped', 'alert_acknowledged', 'model_mapped', 'placement_set']) assert.ok(actions.includes(a), a);
  assert.ok((await db.query("select count(*) n from app_private.ws_audit_log where actor_user_id is null and action = 'item_result'")).rows[0].n == 0);
  const pub = (await db.query(`select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'ws\\_%' and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].n;
  assert.equal(Number(pub), 0, 'nothing callable without signing in');
  const tbl = (await db.query(`select count(*) n from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private' and c.relname like 'ws\\_%' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'select')`)).rows[0].n;
  assert.equal(Number(tbl), 0, 'tables only through the functions');
});
