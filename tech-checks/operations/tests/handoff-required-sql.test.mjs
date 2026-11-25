import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

// A Service truck takes a new unit only through an accepted IT handoff.
let db;
const josh = '00000000-0000-4000-8000-0000000000a1';
const abel = '00000000-0000-4000-8000-0000000000a2';
const teddy = '00000000-0000-4000-8000-0000000000b1';
const owner = '00000000-0000-4000-8000-0000000000c1';

async function as(who, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [who || '']);
  await db.exec('set role authenticated');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const save = (who, units) => as(who, 'select public.service_save_my_truck_inventory_v3($1::jsonb) r', [JSON.stringify(units)]);
const slot = async (who, type) => (await db.query('select unit_tag from public.service_truck_units where service_tech_id=$1 and equipment_type=$2', [who, type])).rows[0].unit_tag;
const exceptions = async () => (await db.query('select * from app_private.techcheck_handoff_exceptions order by created_at')).rows;
async function handoff(id, to, key, family, tag, state, minutesAgo = 60) {
  await db.query(`insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state,created_at,updated_at)
    values($1,$2,$3,'Teddy Hopper',(select full_name from public.profiles where user_id=$3),$4::jsonb,$5,now()-make_interval(mins=>$6+5),now()-make_interval(mins=>$6))`,
    [id, teddy, to, JSON.stringify([{equipment_key: key, family, unit_tag: tag}]), state, minutesAgo]);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create type public.app_role as enum ('pending','it','service','owner');
    create table public.profiles(user_id uuid primary key, role public.app_role, active boolean default true, full_name text, username text);
    create function public.current_app_role() returns public.app_role language sql stable security definer set search_path='' as
      $$select coalesce((select role from public.profiles where user_id=auth.uid() and active),'pending'::public.app_role)$$;
    create function public.require_role(allowed public.app_role[]) returns void language plpgsql stable security definer set search_path='' as
      $$begin if auth.uid() is null then raise exception 'Authentication required'; end if;
        if not (public.current_app_role()=any(allowed)) then raise exception 'Not authorized for this action'; end if; end$$;
    create table public.equipment_master(equipment_key text primary key, canonical_family text, unit_tag text);
    create table app_private.techcheck_transfers(id uuid primary key, it_actor uuid, service_actor uuid, it_name text, service_name text,
      manifest jsonb, state text, created_at timestamptz, updated_at timestamptz);
    create table public.service_truck_units(service_tech_id uuid, equipment_type text, unit_tag text, status text default 'unassigned',
      assigned_by uuid, assigned_by_name text, assigned_at timestamptz, updated_at timestamptz, primary key(service_tech_id, equipment_type));
    create table public.service_truck_inventory_audit(id bigserial, service_tech_id uuid, item_kind text, item_slot text, after_value text, created_at timestamptz default now());
    create table public.service_truck_inventory_checks(service_tech_id uuid, check_date date, ready boolean, updated_at timestamptz);
    -- The live save, reduced to its unit part.
    create function public.service_save_my_truck_inventory_v3(p_units jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
      declare v_type text; v_value text; begin
        perform public.require_role(array['service'::public.app_role]);
        foreach v_type in array array['Sniper','Ranger','Spotter','Solar Spotter'] loop
          v_value := nullif(btrim(coalesce(p_units->>v_type,'')),'');
          update public.service_truck_units set unit_tag=v_value, status=case when v_value is null then 'unassigned' else 'assigned' end,
            assigned_by=auth.uid(), assigned_at=now(), updated_at=now() where service_tech_id=auth.uid() and equipment_type=v_type;
        end loop; return '{}'; end $$;
    grant usage on schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);
  await db.query(`insert into public.profiles values
    ($1,'service',true,'Josh Mireles','josh'),($2,'service',true,'Abel Cervantes','abel'),
    ($3,'it',true,'Teddy Hopper','teddy'),($4,'owner',true,'James Martin','james')`, [josh, abel, teddy, owner]);
  await db.exec(`insert into public.equipment_master values
    ('sniper:332','Sniper','332'),('sniper:328','Sniper','328'),('spotter:268','Spotter','268'),('ranger:008','Ranger','008'),('solar_spotter:039','Solar Spotter','039')`);
  for (const tech of [josh, abel]) for (const type of ['Sniper', 'Ranger', 'Spotter', 'Solar Spotter'])
    await db.query('insert into public.service_truck_units(service_tech_id,equipment_type) values($1,$2)', [tech, type]);
  await db.exec(await readFile(new URL('../../database-maintenance/techcheck-handoff-required-v1.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

test('typing a unit with no handoff is refused, nothing is saved, and the message gives the next step', async () => {
  await assert.rejects(save(josh, {Sniper: '332'}), err => {
    assert.match(err.message, /^Sniper 332 was not added to your truck\. IT has not handed it to you in the app\. NEXT STEP: Ask IT/);
    assert.match(err.message, /"Check Out \/ Hand Off"/);
    assert.match(err.message, /"Verify equipment received"/);
    return true;
  });
  assert.equal(await slot(josh, 'Sniper'), null);
  assert.equal((await exceptions()).length, 0);
});

test('each kind of stuck handoff tells the tech the one thing to do next', async () => {
  await handoff('00000000-0000-4000-8000-000000000101', josh, 'spotter:268', 'Spotter', '268', 'awaiting_service', 300);
  await assert.rejects(save(josh, {Spotter: '268'}), /waiting for YOUR signature\. NEXT STEP: Open "Equipment received from IT"/);
  await handoff('00000000-0000-4000-8000-000000000102', josh, 'ranger:008', 'Ranger', '008', 'discrepancy', 300);
  await assert.rejects(save(josh, {Ranger: '008'}), /did not match what IT sent.*NEXT STEP: Call IT or James/);
  await handoff('00000000-0000-4000-8000-000000000103', abel, 'solar_spotter:039', 'Solar Spotter', '039', 'accepted');
  await assert.rejects(save(josh, {'Solar Spotter': '039'}), /IT handed it to Abel Cervantes, not to you\. NEXT STEP: Ask IT to hand Solar Spotter 039 to you/);
  await assert.rejects(save(josh, {Sniper: '999'}), /not in the COS equipment list.*NEXT STEP: Check the unit number/);
});

test('an accepted handoff to this tech lets the unit on; saving it again and emptying a slot still work', async () => {
  await handoff('00000000-0000-4000-8000-000000000104', josh, 'sniper:328', 'Sniper', '328', 'accepted');
  await save(josh, {Sniper: '328'});
  assert.equal(await slot(josh, 'Sniper'), '328');
  await save(josh, {Sniper: '328'}); // daily save, no change
  await save(josh, {}); // slot emptied after use at a site
  assert.equal(await slot(josh, 'Sniper'), null);
  assert.equal((await exceptions()).length, 0);
});

test('a handoff stops covering the unit once it has gone onto another truck', async () => {
  await db.query("insert into public.service_truck_inventory_audit(service_tech_id,item_kind,item_slot,after_value) values($1,'unit','Sniper','328')", [abel]);
  await assert.rejects(save(josh, {Sniper: '328'}), /NEXT STEP: Ask IT to hand Sniper 328 to you again/);
});

test('units already on a truck before the change stay put', async () => {
  await db.exec("alter table public.service_truck_units disable trigger techcheck_handoff_required_guard_v1");
  await db.query("update public.service_truck_units set unit_tag='332',status='assigned' where service_tech_id=$1 and equipment_type='Sniper'", [abel]);
  await db.exec("alter table public.service_truck_units enable trigger techcheck_handoff_required_guard_v1");
  await save(abel, {Sniper: '332'});
  assert.equal(await slot(abel, 'Sniper'), '332');
});

test('only the owner can load without a handoff, a reason is required, and it is recorded', async () => {
  const call = who => as(who, "select public.owner_load_truck_unit_without_handoff_v1($1,'Ranger','008',$2) r", [abel, 'Swapped on site with James present']);
  await assert.rejects(call(teddy), /Not authorized/);
  await assert.rejects(call(josh), /Not authorized/);
  await assert.rejects(as(owner, "select public.owner_load_truck_unit_without_handoff_v1($1,'Ranger','008','ok') r", [abel]), /Write why/);
  await call(owner);
  assert.equal(await slot(abel, 'Ranger'), '008');
  const [row] = (await exceptions()).filter(x => x.unit_tag === '008');
  assert.equal(row.kind, 'owner_override');
  assert.equal(row.actor_name, 'James Martin');
  assert.equal(row.reason, 'Swapped on site with James present');
  // the reason does not leak to a later change in the same session
  await assert.rejects(save(josh, {Sniper: '332'}), /NEXT STEP/);
});

test('log mode lets a load through but records it', async () => {
  await db.exec("update app_private.techcheck_handoff_enforcement set mode='log'");
  await save(josh, {Spotter: '268'});
  assert.equal((await exceptions()).at(-1).kind, 'log_mode');
  await db.exec("update app_private.techcheck_handoff_enforcement set mode='enforce'");
});

test('the daily list shows trucks without handoffs, loads without handoffs and unfinished handoffs; only the owner can read it', async () => {
  await assert.rejects(as(josh, 'select public.techcheck_handoff_gaps_v1() r'), /Not authorized/);
  await assert.rejects(as(teddy, 'select public.techcheck_handoff_gaps_v1() r'), /Not authorized/);
  const [{r}] = await as(owner, 'select public.techcheck_handoff_gaps_v1() r');
  const without = r.on_truck_without_handoff.map(x => x.service_tech + ' ' + x.equipment_type + ' ' + x.unit_tag).sort();
  assert.deepEqual(without, ['Abel Cervantes Ranger 008', 'Abel Cervantes Sniper 332', 'Josh Mireles Spotter 268']);
  assert.deepEqual(r.loaded_without_handoff.map(x => x.kind).sort(), ['log_mode', 'owner_override']);
  assert.deepEqual(r.handoffs_not_finished.map(x => x.state).sort(), ['awaiting_service', 'discrepancy']);
  // a fresh one inside 4 hours is not called late
  await handoff('00000000-0000-4000-8000-000000000105', josh, 'sniper:332', 'Sniper', '332', 'awaiting_service', 30);
  const [{r: again}] = await as(owner, 'select public.techcheck_handoff_gaps_v1() r');
  assert.equal(again.handoffs_not_finished.length, 2);
  // a report run with no signed-in person can read it
  await db.query("select set_config('test.actor','',false)");
  assert.ok((await db.query('select public.techcheck_handoff_gaps_v1() r')).rows[0].r.checked_at);
});

test('returns: a return needs at least one photo, and returns IT has not checked in after 4 hours show on the owner list', async () => {
  // Live photo check and returns table, reduced to what the change touches.
  await db.exec(`
    create table app_private.techcheck_ticketfree_returns_v1(id uuid primary key, service_tech_name text, family text, unit_tag text,
      used_family text, used_tag text, state text, submitted_at timestamptz);
    create function app_private.techcheck_ticketfree_photos_v1(p_id uuid, p_paths text[]) returns void language plpgsql security definer set search_path='' as $function$
declare path text;
begin
 if p_paths is null or cardinality(p_paths)>8 then raise exception 'Use no more than eight photos.';end if;
 foreach path in array p_paths loop
  if path is null or path !~ '[.]jpg$' then raise exception 'Save each photo under this signed-in return before submitting.';end if;
 end loop;
end$function$;
    insert into app_private.techcheck_ticketfree_returns_v1 values
      ('00000000-0000-4000-8000-000000000201','Josh Mireles','Sniper','420',null,null,'waiting_it',now()-interval '6 hours'),
      ('00000000-0000-4000-8000-000000000202','Abel Cervantes',null,null,'Ranger','011','identity_review',now()-interval '30 hours'),
      ('00000000-0000-4000-8000-000000000203','Josh Mireles','Spotter','111',null,null,'waiting_it',now()-interval '1 hour'),
      ('00000000-0000-4000-8000-000000000204','Josh Mireles','Spotter','112',null,null,'checked_in',now()-interval '9 hours');`);
  await db.exec('select app_private.techcheck_ticketfree_photos_v1(gen_random_uuid(), array[]::text[])'); // before: none allowed
  const sql = await readFile(new URL('../../database-maintenance/techcheck-returns-evidence-v1.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // running it twice changes nothing
  await assert.rejects(db.exec('select app_private.techcheck_ticketfree_photos_v1(gen_random_uuid(), array[]::text[])'), /Take at least one photo of the equipment/);
  await assert.rejects(db.exec('select app_private.techcheck_ticketfree_photos_v1(gen_random_uuid(), null)'), /no more than eight/);
  await db.exec("select app_private.techcheck_ticketfree_photos_v1(gen_random_uuid(), array['a.jpg'])");
  await assert.rejects(db.exec("select app_private.techcheck_ticketfree_photos_v1(gen_random_uuid(), array['a.png'])"), /Save each photo/);
  const [{r}] = await as(owner, 'select public.techcheck_handoff_gaps_v1() r');
  assert.deepEqual(r.returns_not_checked_in.map(x => [x.unit, x.from, x.state]),
    [['Ranger 011', 'Abel Cervantes', 'identity_review'], ['Sniper 420', 'Josh Mireles', 'waiting_it']]);
  assert.ok(r.returns_not_checked_in[0].hours_waiting >= 29);
  assert.ok(Array.isArray(r.handoffs_not_finished)); // the rest of the list is unchanged
  await assert.rejects(as(josh, 'select public.techcheck_handoff_gaps_v1() r'), /Not authorized/);
  const saved = (await db.query('select fn from app_private.techcheck_returns_evidence_backup_v1 order by fn')).rows.map(x => x.fn);
  assert.deepEqual(saved, ['techcheck_handoff_gaps_v1', 'techcheck_ticketfree_photos_v1']);
});
