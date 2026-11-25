import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

// Truck standard, extras and tech-to-tech moves, on top of the real return and
// handoff functions. The edits in techcheck-truck-extras-v1.sql are applied to the
// same text that is live (the anchors must match exactly once, or nothing changes).
const josh = '00000000-0000-4000-8000-0000000000a1', abel = '00000000-0000-4000-8000-0000000000a2';
const teddy = '00000000-0000-4000-8000-0000000000b1', james = '00000000-0000-4000-8000-0000000000c1';
const testSvc = '00000000-0000-4000-8000-0000000000a9';
const sql = name => readFileSync(new URL('../../database-maintenance/' + name, import.meta.url), 'utf8');
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean default true, archived_at timestamptz, full_name text, username text);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path='' as
      $$select coalesce((select role from public.profiles where user_id=auth.uid() and active),'pending'::public.app_role)$$;
    create function public.require_role(allowed public.app_role[]) returns void language plpgsql stable security definer set search_path='' as
      $$begin if auth.uid() is null then raise exception 'Authentication required'; end if;
        if not (public.current_app_role()=any(allowed)) then raise exception 'Not authorized for this action'; end if; end$$;
    create table public.equipment_master(equipment_key text primary key, unit_tag text not null, canonical_family text not null, workflow_type text,
      tracker_state text, tracker_public_ip text default '192.0.2.1', source_label text, updated_at timestamptz default now());
    create table public.unit_registry(unit_key text primary key, unit_tag text, equipment_type text, lifecycle_status text, current_holder_id uuid,
      current_holder_name text, current_site text, last_event text, updated_at timestamptz default now());
    create table public.service_truck_units(service_tech_id uuid, equipment_type text, unit_tag text, status text default 'unassigned',
      last_used_ticket_no text, last_used_at timestamptz, old_unit_tag text, assigned_by uuid, assigned_by_name text, assigned_at timestamptz,
      updated_at timestamptz default now(), primary key(service_tech_id, equipment_type));
    create table public.service_truck_inventory_audit(id uuid default gen_random_uuid(), service_tech_id uuid, service_tech_name text, item_kind text,
      item_slot text, before_value text, after_value text, action text, actor_id uuid, actor_name text, actor_role text, details jsonb, created_at timestamptz default clock_timestamp());
    -- the live audit trigger, reduced to its unit part
    create function public.audit_units() returns trigger language plpgsql security definer set search_path='' as $$ begin
      if row(old.unit_tag,old.status) is not distinct from row(new.unit_tag,new.status) then return new; end if;
      insert into public.service_truck_inventory_audit(service_tech_id,item_kind,item_slot,before_value,after_value,action,actor_id)
      values(new.service_tech_id,'unit',new.equipment_type,nullif(btrim(coalesce(old.unit_tag,'')),''),nullif(btrim(coalesce(new.unit_tag,'')),''),'changed',auth.uid());
      return new; end $$;
    create trigger service_truck_units_inventory_audit after update on public.service_truck_units for each row execute function public.audit_units();
    create table public.service_truck_restock_requests(id uuid primary key default gen_random_uuid(), service_tech_id uuid, service_tech_name text, item_kind text,
      item_type text, qty_needed integer, used_unit_tag text, old_unit_tag text, status text, reason text, updated_at timestamptz default now());
    create table public.service_truck_unit_history(id uuid primary key default gen_random_uuid(), service_tech_id uuid, equipment_type text, unit_tag text,
      event text, ticket_no text, old_unit_tag text, actor_id uuid, actor_name text, created_at timestamptz default now());
    create table public.service_truck_inventory_checks(service_tech_id uuid, check_date date, ready boolean, updated_at timestamptz default now());
    create table public.prep_tickets(id uuid primary key, status text, is_test boolean default false);
    create table public.prep_items(id uuid primary key, prep_ticket_id uuid, equipment_type text, unit_tag text);
    create table public.unit_returns(id uuid primary key, equipment_type text, unit_tag text, status text);
    create table public.app_notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, kind text, title text, body text, unit_tag text,
      check (kind = any (array['new_assignment','returned_unit','equipment_ready_service','owner_action','swap_site_registration','camera_health','camera_recovered'])));
    create table app_private.techcheck_transfers(id uuid primary key, it_actor uuid, service_actor uuid, it_name text, service_name text, manifest jsonb,
      state text, revision integer default 1, created_at timestamptz default now(), updated_at timestamptz default now(), purpose text);
    create table app_private.techcheck_transfer_reservations(equipment_key text primary key, transfer_id uuid);
    create table app_private.techcheck_handoff_baseline(id uuid primary key default gen_random_uuid(), service_tech_id uuid, equipment_type text, unit_tag text,
      accepted_at timestamptz default timestamptz '2026-11-25 06:00:00+00');
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text, metadata jsonb, primary key(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema auth, app_private, storage, public to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
  `);
  await db.query(`insert into public.profiles values
    ($1,'service',true,null,'Josh Mireles','josh'), ($2,'service',true,null,'Abel Cervantes','abel'),
    ($3,'it',true,null,'Teddy Hopper','teddy'), ($4,'owner',true,null,'James Martin','james'), ($5,'service',true,null,'Test Service','test')`,
    [josh, abel, teddy, james, testSvc]);
  // the real return, handoff and guard functions
  const integration = sql('techcheck-transfer-integration-v3.sql');
  const start = integration.indexOf('create function app_private.techcheck_transfer_legacy_guard_v1()');
  await db.exec(integration.slice(start, integration.indexOf('create function app_private.techcheck_transfer_legacy_ticket_guard_v1()', start)));
  const activation = sql('techcheck-handoff-activation-v1.sql');
  const hold = activation.indexOf('create function app_private.techcheck_transfer_custody_hold_v1');
  await db.exec(activation.slice(hold, activation.indexOf('revoke all on function app_private.techcheck_transfer_custody_hold_v1', hold)));
  await db.exec(sql('techcheck-ticketfree-returns-v1.sql'));
  await db.exec(sql('techcheck-ticketfree-multiselect-v2.sql'));
  await db.exec(sql('techcheck-handoff-required-v1.sql'));
  // the live covering check, which also counts the Nov 25 truck baseline
  await db.exec(`create or replace function app_private.techcheck_handoff_covering_v1(p_service_tech_id uuid, p_equipment_type text, p_unit_tag text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with keys as (select e.equipment_key from public.equipment_master e where e.canonical_family = p_equipment_type and lower(btrim(e.unit_tag)) = lower(btrim(p_unit_tag))),
  handoff as (select t.id, t.service_actor, t.updated_at as at from app_private.techcheck_transfers t where t.state = 'accepted'
      and exists(select 1 from keys k, jsonb_array_elements(t.manifest) m where m->>'equipment_key' = k.equipment_key)),
  baseline as (select b.id, b.service_tech_id as service_actor, b.accepted_at as at from app_private.techcheck_handoff_baseline b
      where b.equipment_type = p_equipment_type and lower(b.unit_tag) = lower(btrim(p_unit_tag))),
  latest as (select * from (select * from handoff union all select * from baseline) x order by at desc limit 1)
  select l.id from latest l where l.service_actor = p_service_tech_id
    and not exists(select 1 from public.service_truck_inventory_audit a where a.item_kind = 'unit' and a.item_slot = p_equipment_type
        and lower(btrim(a.after_value)) = lower(btrim(p_unit_tag)) and a.service_tech_id is distinct from p_service_tech_id and a.created_at > l.at)
$function$;`);
  // the trucks as they were on Nov 25
  for (const [tech, type, tag] of [[abel,'Sniper','322'],[abel,'Ranger','007'],[abel,'Spotter','261'],[abel,'Solar Spotter','010'],
                                    [josh,'Sniper','332'],[josh,'Ranger','008'],[josh,'Spotter','268'],[josh,'Solar Spotter','202']]) {
    await db.query("insert into public.service_truck_units(service_tech_id,equipment_type,unit_tag,status) values($1,$2,$3,'assigned')", [tech, type, tag]);
    await db.query('insert into app_private.techcheck_handoff_baseline(service_tech_id,equipment_type,unit_tag) values($1,$2,$3)', [tech, type, tag]);
    await equipment(type, tag, 'field_or_unknown');
  }
  await db.query("insert into public.service_truck_units(service_tech_id,equipment_type) select $1, t from unnest(array['Sniper','Ranger','Spotter','Solar Spotter']) t", [testSvc]);
  const extras = sql('techcheck-truck-extras-v1.sql');
  await db.exec(extras);
  await db.exec(extras); // running it twice changes nothing
});
after(async () => db?.close());

async function equipment(type, tag, state = 'shop') {
  const key = type.toLowerCase().replace(' ', '_') + ':' + tag;
  await db.query('insert into public.equipment_master(equipment_key,unit_tag,canonical_family,workflow_type,tracker_state) values($1,$2,$3,$3,$4) on conflict do nothing', [key, tag, type, state]);
  return key;
}
async function as(who, text, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [who || '']);
  await db.exec('set role authenticated');
  try { return (await db.query(text, params)).rows; } finally { await db.exec('reset role'); }
}
// a truck-screen save: runs with the signed-in tech, like service_save_my_truck_inventory_v3
const asSave = async (who, text, params = []) => { await db.exec('reset role'); await db.query("select set_config('test.actor',$1,false)", [who]); return (await db.query(text, params)).rows; };
const call = async (who, fn, args = []) => (await as(who, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args))[0].r;
// an uploaded photo: <me>/<move>/<sha256>.jpg in the moves bucket
async function photo(who, move, bucket = 'techcheck-truck-moves') {
  const path = who + '/' + move + '/' + createHash('sha256').update(randomUUID()).digest('hex') + '.jpg';
  await db.query("insert into storage.objects values($1,$2,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')", [bucket, path]);
  return path;
}
const give = async (from, to, type, tag, move = randomUUID()) => ({move, r: await call(from, 'truck_give_v1', [move, to, type, tag, [await photo(from, move)], 'For the site swap'])});
const pass = {number_matches: 'pass', no_damage: 'pass', all_parts: 'pass'};
const take = async (who, move, {checks = pass, sign = {method: 'typed', name: 'Josh Mireles'}, note = '', photos} = {}) =>
  call(who, 'truck_take_v1', [move, true, JSON.stringify(checks), photos || [await photo(who, move)], JSON.stringify(sign), note]);
const kind = (my, type) => my.kinds.find(k => k.type === type);
const slot = async (tech, type) => (await db.query('select unit_tag, status from public.service_truck_units where service_tech_id=$1 and equipment_type=$2', [tech, type])).rows[0];

test('each truck shows the standard and what it has, type by type; only Service reads its own truck', async () => {
  const my = await call(josh, 'truck_my_v1');
  assert.equal(my.me.name, 'Josh Mireles');
  assert.deepEqual(my.kinds.map(k => [k.type, k.required, k.have, k.slot?.tag]), [['Sniper',1,1,'332'],['Ranger',1,1,'008'],['Spotter',1,1,'268'],['Solar Spotter',1,1,'202']]);
  assert.deepEqual(my.techs.map(t => t.name), ['Abel Cervantes']);  // the test account is hidden
  await assert.rejects(call(teddy, 'truck_my_v1'), /Sign in as a Service technician/);
  await assert.rejects(as(josh, 'select * from app_private.truck_extra_units'), /permission denied/);
});

test('giving needs the unit on my truck, another tech, and a photo; a retried send is not doubled', async () => {
  const m1 = randomUUID();
  await assert.rejects(call(abel, 'truck_give_v1', [m1, josh, 'Ranger', '999', [await photo(abel, m1)], '']), /Ranger 999 is not on your truck in the app\. NEXT STEP/);
  await assert.rejects(call(abel, 'truck_give_v1', [m1, abel, 'Ranger', '007', [await photo(abel, m1)], '']), /Pick the Service tech/);
  await assert.rejects(call(abel, 'truck_give_v1', [m1, josh, 'Ranger', '007', [], '']), /Take at least 1 photo/);
  const other = randomUUID();
  await assert.rejects(call(abel, 'truck_give_v1', [m1, josh, 'Ranger', '007', [await photo(abel, other)], '']), /did not finish saving/);
  const {move} = await give(abel, josh, 'Ranger', '007');
  const again = await call(abel, 'truck_give_v1', [move, josh, 'Ranger', '007', [await photo(abel, move)], 'For the site swap']);
  assert.equal(again.sent.length, 1);
  await assert.rejects(give(abel, josh, 'Ranger', '007'), /already on its way to someone\. NEXT STEP/);
  const josh1 = await call(josh, 'truck_my_v1');
  assert.deepEqual(josh1.coming.map(m => [m.from, m.type, m.tag, m.note]), [['Abel Cervantes','Ranger','007','For the site swap']]);
  assert.equal((await db.query("select count(*)::int n from public.app_notifications where recipient_user_id=$1 and title like 'Abel Cervantes is giving you Ranger 007'", [josh])).rows[0].n, 1);
  // until Josh signs, it is still Abel's
  assert.equal((await slot(abel, 'Ranger')).unit_tag, '007');
  await call(abel, 'truck_cancel_give_v1', [move]);
  assert.equal((await call(josh, 'truck_my_v1')).coming.length, 0);
  await assert.rejects(take(josh, move), /already answered \(cancelled\)/);
});

test('taking needs every check, a matching number, a photo and a signature; a refusal needs a reason', async () => {
  const {move} = await give(abel, josh, 'Ranger', '007');
  await assert.rejects(take(abel, move), /not found/);                                   // only the receiver answers
  await assert.rejects(take(josh, move, {checks: {number_matches: 'pass'}}), /Answer every check/);
  await assert.rejects(take(josh, move, {checks: {...pass, number_matches: 'problem'}}), /does not match, so do not take it\. NEXT STEP/);
  await assert.rejects(take(josh, move, {checks: {...pass, no_damage: 'problem'}}), /Write what is wrong/);
  await assert.rejects(take(josh, move, {photos: []}), /Take at least 1 photo/);
  await assert.rejects(take(josh, move, {sign: {method: 'typed', name: 'Josh'}}), /Type your full name exactly as it shows: Josh Mireles/);
  await assert.rejects(take(josh, move, {sign: {method: 'drawn', path: 'x.jpg'}}), /did not finish saving/);
  await assert.rejects(call(josh, 'truck_take_v1', [move, false, null, [], null, '']), /Write why you are not taking it/);
  const refused = await call(josh, 'truck_take_v1', [move, false, null, [], null, 'This is not 007, it says 017']);
  assert.equal(refused.coming.length, 0);
  assert.equal((await slot(abel, 'Ranger')).unit_tag, '007');                           // still on Abel's truck
  assert.match((await db.query("select body from public.app_notifications where recipient_user_id=$1 order by ctid desc limit 1", [abel])).rows[0].body, /017/);
});

test('Abel gives Ranger 007 to Josh: it leaves Abel, lands on Josh as an extra, and counts for Josh', async () => {
  const {move} = await give(abel, josh, 'Ranger', '007');
  const drawn = await photo(josh, move);
  const after = await take(josh, move, {sign: {method: 'drawn', path: drawn}, checks: {...pass, all_parts: 'problem'}, note: 'Mount bracket missing'});
  const ranger = kind(after, 'Ranger');
  assert.deepEqual([ranger.have, ranger.required, ranger.slot.tag, ranger.extras.map(x => x.tag)], [2, 1, '008', ['007']]);
  assert.equal(after.recent[0].to_place, 'extra');
  const abelNow = await call(abel, 'truck_my_v1');
  assert.deepEqual([kind(abelNow, 'Ranger').have, kind(abelNow, 'Ranger').slot], [0, null]);
  assert.deepEqual(await slot(abel, 'Ranger'), {unit_tag: null, status: 'unassigned'});
  // the move is Josh's handoff for 007 now; Abel's is gone
  assert.equal((await db.query("select app_private.techcheck_handoff_covering_v1($1,'Ranger','007') c", [josh])).rows[0].c, move);
  assert.equal((await db.query("select app_private.techcheck_handoff_covering_v1($1,'Ranger','007') c", [abel])).rows[0].c, null);
  assert.deepEqual((await db.query("select event from public.service_truck_unit_history where unit_tag='007' order by event")).rows.map(r => r.event), ['GIVEN TO JOSH MIRELES', 'TAKEN FROM ABEL CERVANTES']);
  // Abel cannot type 007 back onto his own truck; Josh owns it
  await assert.rejects(asSave(abel, "update public.service_truck_units set unit_tag='007', status='assigned' where service_tech_id=$1 and equipment_type='Ranger'", [abel]), /is an extra on Josh Mireles's truck\. NEXT STEP/);
  // IT cannot hand out a unit that is an extra on a truck
  await db.query("update public.equipment_master set tracker_state='shop' where equipment_key='ranger:007'");
  assert.equal((await db.query("select app_private.techcheck_transfer_custody_hold_v1('ranger:007') h")).rows[0].h, 'Assigned truck equipment');
});

test('a swap can install an extra: the extra leaves, the truck slot and restock stay as they were', async () => {
  const site = await equipment('Ranger', '031', 'field_or_unknown');
  const r = randomUUID();
  const ctx = await call(josh, 'techcheck_ticketfree_context_v1');
  assert.deepEqual(ctx.truck.filter(t => t.family === 'Ranger').map(t => [t.unit_tag, t.place || 'slot']), [['008','slot'],['007','extra']]);
  await call(josh, 'submit_techcheck_ticketfree_return_v1', [r, site, 'ranger:007', 'Swapped at site', []]);
  const my = await call(josh, 'truck_my_v1');
  assert.deepEqual([kind(my, 'Ranger').have, kind(my, 'Ranger').extras.length, kind(my, 'Ranger').slot.tag], [1, 0, '008']);
  assert.deepEqual(await slot(josh, 'Ranger'), {unit_tag: '008', status: 'assigned'});
  assert.equal((await db.query("select count(*)::int n from public.service_truck_restock_requests where service_tech_id=$1", [josh])).rows[0].n, 0);
  assert.equal((await db.query("select removed_why from app_private.truck_extra_units where unit_tag='007'")).rows[0].removed_why, 'used_in_swap');
  // the slot unit still swaps exactly as before
  const site2 = await equipment('Ranger', '032', 'field_or_unknown');
  await call(josh, 'submit_techcheck_ticketfree_return_v1', [randomUUID(), site2, 'ranger:008', 'Swapped at site', []]);
  assert.deepEqual(await slot(josh, 'Ranger'), {unit_tag: '008', status: 'used_restock_due'});
  assert.equal((await db.query("select count(*)::int n from public.service_truck_restock_requests where service_tech_id=$1", [josh])).rows[0].n, 1);
});

test('IT hands Josh two Spotters: the first fills nothing (slot full) and both go on as extras; one goes back to IT unused', async () => {
  const [k1, k2] = [await equipment('Spotter', '401'), await equipment('Spotter', '402')];
  const handoff = randomUUID();
  await db.query(`insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state,purpose,updated_at)
    values($1,$2,$3,'Teddy Hopper','Josh Mireles',$4,'accepted','truck_replenishment',now())`,
    [handoff, teddy, josh, JSON.stringify([{equipment_key: k1, family: 'Spotter', unit_tag: '401'}, {equipment_key: k2, family: 'Spotter', unit_tag: '402'}])]);
  await db.query('insert into app_private.techcheck_transfer_reservations values($1,$3),($2,$3)', [k1, k2, handoff]);
  let my = await call(josh, 'truck_my_v1');
  assert.deepEqual(my.from_it.map(x => x.tag), ['401', '402']);
  my = await call(josh, 'truck_put_from_it_v1', ['Spotter', '401']);
  my = await call(josh, 'truck_put_from_it_v1', ['Spotter', '401']);                 // a second tap changes nothing
  my = await call(josh, 'truck_put_from_it_v1', ['Spotter', '402']);
  assert.deepEqual([kind(my, 'Spotter').have, kind(my, 'Spotter').extras.map(x => x.tag), my.from_it.length], [3, ['401', '402'], 0]);
  await assert.rejects(call(abel, 'truck_put_from_it_v1', ['Spotter', '401']), /not waiting to go on your truck/);
  // the finished handoff no longer blocks returning it
  const r = randomUUID();
  await call(josh, 'submit_techcheck_ticketfree_return_v1', [r, k2, null, 'Not needed', []]);
  assert.equal((await db.query("select removed_why from app_private.truck_extra_units where unit_tag='402'")).rows[0].removed_why, 'returned_to_it');
  assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where equipment_key=$1', [k2])).rows[0].n, 0);
  // an unfinished handoff still blocks
  const k3 = await equipment('Spotter', '403'), open = randomUUID();
  await db.query(`insert into app_private.techcheck_transfers(id,it_actor,service_actor,manifest,state,purpose) values($1,$2,$3,'[]','awaiting_service','truck_replenishment')`, [open, teddy, josh]);
  await db.query('insert into app_private.techcheck_transfer_reservations values($1,$2)', [k3, open]);
  await assert.rejects(call(josh, 'submit_techcheck_ticketfree_return_v1', [randomUUID(), k3, null, 'x', []]), /signed handoff or intake hold/);
});

test('typing my own extra into my truck screen moves it into the slot', async () => {
  await db.query("update public.service_truck_units set unit_tag=null, status='unassigned' where service_tech_id=$1 and equipment_type='Spotter'", [josh]);
  await asSave(josh, "update public.service_truck_units set unit_tag='401', status='assigned' where service_tech_id=$1 and equipment_type='Spotter'", [josh]);
  const my = await call(josh, 'truck_my_v1');
  assert.deepEqual([kind(my, 'Spotter').have, kind(my, 'Spotter').slot.tag, kind(my, 'Spotter').extras.length], [1, '401', 0]);
});

test('the owner sees every truck against the standard, can change the standard, and can take an extra off with a reason', async () => {
  await assert.rejects(call(josh, 'owner_truck_board_v1'), /Not authorized/);
  let board = await call(james, 'owner_truck_board_v1');
  assert.deepEqual(board.trucks.map(t => t.name), ['Abel Cervantes', 'Josh Mireles']);
  const abelTruck = board.trucks.find(t => t.name === 'Abel Cervantes');
  assert.deepEqual(kind(abelTruck, 'Ranger').have, 0);
  board = await call(james, 'owner_truck_standard_set_v1', ['Ranger', 2]);
  assert.equal(board.standard.find(s => s.type === 'Ranger').required, 2);
  await assert.rejects(call(james, 'owner_truck_standard_set_v1', ['Ranger', 11]), /0 to 10/);
  await assert.rejects(call(josh, 'owner_truck_standard_set_v1', ['Ranger', 3]), /Not authorized/);
  const {move} = await give(josh, abel, 'Spotter', '401');
  const abelAfter = await take(abel, move, {sign: {method: 'typed', name: 'abel  cervantes'}});
  assert.equal(kind(abelAfter, 'Spotter').extras[0].tag, '401');
  const extra = kind(abelAfter, 'Spotter').extras[0].id;
  await assert.rejects(call(james, 'owner_truck_extra_remove_v1', [extra, 'short']), /at least 10 characters/);
  board = await call(james, 'owner_truck_extra_remove_v1', [extra, 'Counted twice by mistake']);
  assert.equal(kind(board.trucks.find(t => t.name === 'Abel Cervantes'), 'Spotter').extras.length, 0);
  await assert.rejects(call(james, 'owner_truck_extra_remove_v1', [extra, 'Counted twice by mistake']), /no longer on the truck/);
});
