import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

// The SIM drawer: every SIM card on hand, and where each one went.
let db;
const owner = '00000000-0000-4000-8000-0000000000c1';
const teddy = '00000000-0000-4000-8000-0000000000b1';
const josh = '00000000-0000-4000-8000-0000000000a1';
const transfer = '00000000-0000-4000-8000-000000000201';

async function as(who, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('test.actor',$1,false)", [who || '']);
  await db.exec('set role authenticated');
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const drawer = async who => (await as(who, 'select public.sim_drawer_v1() r'))[0].r;
const card = async sim => (await db.query('select * from app_private.sim_drawer where sim_number=$1', [sim])).rows[0];
async function event(kind, sims, id) {
  await db.query(`insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,snapshot) values($1,$2,$3,'Teddy Hopper',$4,$5::jsonb)`,
    [id, transfer, teddy, kind, JSON.stringify({actual: [{family: 'Sniper', unit_tag: '332', sims}]})]);
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
    create table app_private.techcheck_transfers(id uuid primary key, service_name text);
    create table app_private.techcheck_transfer_events(id uuid primary key, transfer_id uuid, actor_id uuid, actor_name text, kind text, snapshot jsonb);
    create table public.service_truck_sims(service_tech_id uuid, slot_no integer, sim_number text, status text, primary key(service_tech_id, slot_no));
    grant usage on schema public to authenticated;
  `);
  await db.query(`insert into public.profiles values ($1,'owner',true,'James Martin','james'),($2,'it',true,'Teddy Hopper','teddy'),($3,'service',true,'Josh Mireles','josh')`, [owner, teddy, josh]);
  await db.query(`insert into app_private.techcheck_transfers values ($1,'Josh Mireles')`, [transfer]);
  for (const slot of [1, 2, 3]) await db.query('insert into public.service_truck_sims values($1,$2,null,$3)', [josh, slot, 'unassigned']);
  await db.exec(await readFile(new URL('../../database-maintenance/techcheck-sim-drawer-v1.sql', import.meta.url), 'utf8'));
  await db.exec('grant execute on all functions in schema public to authenticated');
});
after(async () => db?.close());

test('owner and IT add cards, numbers are cleaned, repeats and junk are reported, Service cannot', async () => {
  const [{r}] = await as(owner, "select public.sim_drawer_add_v1(array['8901 2600 0000 0000 001','89012600000000000002','89012600000000000002','12'],'Simetry','box A') r");
  assert.deepEqual(r, {added: ['8901260000000000001', '89012600000000000002'], already_listed: ['89012600000000000002'], not_a_sim_number: ['12']});
  const [{r: again}] = await as(teddy, "select public.sim_drawer_add_v1(array['8901260000000000001','89012600000000000003'],'Vendera') r");
  assert.deepEqual(again.added, ['89012600000000000003']);
  assert.deepEqual(again.already_listed, ['8901260000000000001']);
  await assert.rejects(as(josh, "select public.sim_drawer_add_v1(array['89012600000000000009']) r"), /Not authorized/);
  await assert.rejects(as(josh, 'select public.sim_drawer_v1() r'), /Not authorized/);
  const list = await drawer(owner);
  assert.equal(list.cards.length, 3);
  assert.ok(list.cards.every(c => c.status === 'in_drawer'));
  assert.equal((await card('89012600000000000003')).added_by_name, 'Teddy Hopper');
});

test('a SIM handed over in a handoff leaves the drawer and shows where it went; a cancel puts it back', async () => {
  await event('checkout', ['89012600000000000002', 'NA', '89012600000000000077'], '00000000-0000-4000-8000-000000000301');
  const out = await card('89012600000000000002');
  assert.equal(out.status, 'in_unit');
  assert.equal(out.location, 'Sniper 332 → Josh Mireles');
  const list = await drawer(teddy);
  assert.deepEqual(list.not_in_drawer.map(x => x.sim), ['89012600000000000077']);
  assert.match(list.not_in_drawer[0].detail, /Sniper 332 to Josh Mireles/);
  await event('cancel', [], '00000000-0000-4000-8000-000000000302');
  assert.equal((await card('89012600000000000002')).status, 'in_drawer');
  assert.equal((await card('89012600000000000002')).location, null);
});

test('a drawer SIM put in a truck slot is on that truck, and leaves it when swapped out', async () => {
  await db.query("update public.service_truck_sims set sim_number='89012600000000000003',status='assigned' where service_tech_id=$1 and slot_no=2", [josh]);
  assert.equal((await card('89012600000000000003')).status, 'on_truck');
  assert.equal((await card('89012600000000000003')).location, "Josh Mireles's truck, slot 2");
  await db.query("update public.service_truck_sims set sim_number=null,status='unassigned' where service_tech_id=$1 and slot_no=2", [josh]);
  assert.equal((await card('89012600000000000003')).status, 'in_unit');
});

test('a card can be marked bad only with a reason, and put back in the drawer', async () => {
  await assert.rejects(as(owner, "select public.sim_drawer_mark_v1('8901260000000000001','bad') r"), /Write why/);
  await as(owner, "select public.sim_drawer_mark_v1('8901260000000000001','bad','Will not register') r");
  assert.equal((await card('8901260000000000001')).status, 'bad');
  await as(teddy, "select public.sim_drawer_mark_v1('8901 2600 0000 0000 001','in_drawer') r");
  assert.equal((await card('8901260000000000001')).status, 'in_drawer');
  await assert.rejects(as(owner, "select public.sim_drawer_mark_v1('99999999999','bad','x') r"), /not on the drawer list/);
  const history = (await db.query("select event from app_private.sim_drawer_history where sim_number='8901260000000000001' order by id")).rows.map(r => r.event);
  assert.deepEqual(history, ['added', 'marked', 'marked']);
});

test('a broken drawer never stops a handoff from saving', async () => {
  await db.exec('alter table app_private.sim_drawer rename to sim_drawer_moved');
  await event('checkout', ['89012600000000000002'], '00000000-0000-4000-8000-000000000303');
  assert.equal((await db.query("select count(*)::int n from app_private.techcheck_transfer_events where id='00000000-0000-4000-8000-000000000303'")).rows[0].n, 1);
  await db.exec('alter table app_private.sim_drawer_moved rename to sim_drawer');
});
