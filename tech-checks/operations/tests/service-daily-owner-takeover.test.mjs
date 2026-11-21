import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

let db;
const owner='00000000-0000-4000-8000-000000000101';
const tech='00000000-0000-4000-8000-000000000102';
const other='00000000-0000-4000-8000-000000000103';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema auth;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $f$
 select nullif(current_setting('test.actor',true),'')::uuid $f$;
 create table public.profiles(
 user_id uuid primary key,role text,active boolean,archived_at timestamptz,
 full_name text,username text);
 create table public.morning_checks(
 id uuid primary key default gen_random_uuid(),service_tech_id uuid,submitted_at timestamptz default now(),
 is_test boolean default false,truck_checks jsonb,taking_trailer boolean,trailer_checks jsonb);
 create table public.service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table public.service_truck_sims(service_tech_id uuid,slot_no integer,sim_number text,status text);
 create table public.service_truck_stock(
 service_tech_id uuid primary key,recon_battery_qty integer,agm_12v_110ah_qty integer,
 litime_12v_100ah_qty integer,battery_12v_35ah_qty integer,
 updated_at timestamptz default now(),updated_by uuid,updated_by_name text);
 create table public.service_truck_restock_requests(service_tech_id uuid,status text);
 create table public.service_truck_inventory_checks(service_tech_id uuid,check_date date,ready boolean);
 create table app_private.service_daily_reports(
 id uuid primary key,service_tech_id uuid references public.profiles(user_id),
 check_date date,actor_name text,request jsonb,snapshot jsonb,photos jsonb,
 delivery_status text default 'queued',submitted_at timestamptz default now());
 create function public.service_truck_stock_complete_v1(p_tech uuid)
 returns boolean language sql stable as $f$ select exists(select 1 from public.service_truck_stock
 where service_tech_id=p_tech and recon_battery_qty>=25 and agm_12v_110ah_qty>=4
 and litime_12v_100ah_qty>=2 and battery_12v_35ah_qty>=4) $f$;
 create function public.service_departure_readiness_v1(p_service_tech_id uuid default auth.uid())
 returns jsonb language plpgsql security definer set search_path='' as $f$
 declare
  v_active_restock integer := 0;
  v_inspection_ready boolean:=false;
  v_inventory_ready boolean:=false;
  v_units jsonb;v_sims jsonb;v_stock jsonb;v_restocks jsonb;
 begin
  select exists(select 1 from public.morning_checks
  where service_tech_id=p_service_tech_id
   and timezone('America/Chicago',submitted_at)::date=timezone('America/Chicago',now())::date)
   into v_inspection_ready;
  select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) into v_units
    from public.service_truck_units u where u.service_tech_id=p_service_tech_id;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_sims
    from public.service_truck_sims s where s.service_tech_id=p_service_tech_id;
  select to_jsonb(s) into v_stock from public.service_truck_stock s where s.service_tech_id=p_service_tech_id;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_restocks
    from public.service_truck_restock_requests r where r.service_tech_id=p_service_tech_id
      and r.status not in ('issued','cancelled');
  select coalesce(ready,false) into v_inventory_ready from public.service_truck_inventory_checks
    where service_tech_id=p_service_tech_id and check_date=timezone('America/Chicago',now())::date;
  return jsonb_build_object(
    'service_tech_id',p_service_tech_id,
    'inspection_ready',v_inspection_ready,
    'inventory_ready',coalesce(v_inventory_ready,false),
    'units',v_units,'sims',v_sims,'stock',v_stock,'restock_requests',v_restocks,
    'departure_ready',coalesce(v_inspection_ready,false) and coalesce(v_inventory_ready,false),
    'stub',true
  );
 end $f$;
 create function public.owner_tech_command_board_v2(p_date date default timezone('America/Chicago',now())::date)
 returns jsonb language plpgsql as $f$
 declare t jsonb:='{"truck_ready":false}';d jsonb;sc boolean:=true;vc boolean:=false;
 begin
  d:=public.service_departure_readiness_v1('${tech}'::uuid);
  return jsonb_build_object(
    'truck_ready',coalesce((t->>'truck_ready')::boolean,false) and sc and vc,
    'stub',true
  );
 end $f$;
 grant usage on schema auth,app_private to authenticated;
 grant execute on function auth.uid() to authenticated;
 insert into public.profiles values
 ('${owner}','owner',true,null,'Synthetic Owner','owner'),
 ('${tech}','service',true,null,'Synthetic Service','service'),
 ('${other}','service',true,null,'Other Service','other');
 insert into public.morning_checks(service_tech_id,truck_checks,taking_trailer,trailer_checks)
 values('${tech}',(select jsonb_object_agg('truck_'||i,true) from generate_series(1,8)i),
 true,(select jsonb_object_agg('trailer_'||i,true) from generate_series(1,7)i));
 insert into public.service_truck_units(service_tech_id,equipment_type,unit_tag,status) values
 ('${tech}','Sniper','193','assigned'),('${tech}','Ranger','025','assigned'),
 ('${tech}','Spotter','224','assigned'),('${tech}','Solar Spotter','013','assigned');
 insert into public.service_truck_sims(service_tech_id,slot_no,sim_number,status) values
 ('${tech}',1,'601953','assigned'),('${tech}',2,'601950','assigned'),('${tech}',3,'601959','assigned');
 insert into public.service_truck_stock(service_tech_id,recon_battery_qty,agm_12v_110ah_qty,litime_12v_100ah_qty,battery_12v_35ah_qty)
 values('${tech}',25,4,2,4);
 `);
 const original=await readFile(new URL('../../database-maintenance/service-daily-owner-takeover-v1.sql',import.meta.url),'utf8');
 // Synthetic functions do not share production hashes. The original release
 // migration retains and enforces both drift guards.
 const fixture=original.replace(/do \$guard\$[\s\S]*?end \$guard\$;/,'');
 assert.notEqual(fixture,original);
 await db.exec(fixture);
});
after(async()=>db?.close());
async function call(who,arg){
 await db.exec('reset role');
 await db.query("select set_config('test.actor',$1,false)",[who]);
 await db.exec('set role authenticated');
 try{
  return (await db.query(`select public.owner_takeover_service_daily_v1(
   p_report_id=>$1,p_service_tech_id=>$2,p_check_date=>$3,p_reason=>$4,
   p_authorize_departure=>$5,p_owner_acknowledged=>$6) result`,
   [arg.id,tech,today(),arg.reason,arg.departure,arg.acknowledged])).rows[0].result;
 }finally{await db.exec('reset role');}
}
const args=(departure=false)=>({
 id:randomUUID(),reason:'Owner administrative completion; Service inventory was not physically verified.',
 departure,acknowledged:true
});
async function query(sql,params=[]){await db.exec('reset role');return (await db.query(sql,params)).rows;}

test('non-Owner and missing acknowledgement cannot sign for the Service Tech',async()=>{
 await assert.rejects(call(other,args()),/Owner account required/);
 await assert.rejects(call(owner,{...args(),acknowledged:false}),/Acknowledge/);
 assert.equal((await query('select count(*)::int n from app_private.service_daily_reports'))[0].n,0);
});
test('Owner may authorize a documented exception; no technician verification is forged',async()=>{
 const a=args(true),r=await call(owner,a);
 assert.equal(r.delivery_status,'queued');
 assert.equal(r.inventory_ready,false);
 assert.equal(r.service_signed,false);
 const rows=await query('select r.snapshot,r.photos,t.owner_id,t.departure_authorized from app_private.service_daily_reports r join app_private.service_daily_owner_takeovers_v1 t on t.report_id=r.id where r.id=$1',[a.id]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].owner_id,owner);
 assert.equal(rows[0].departure_authorized,true);
 assert.equal(rows[0].snapshot.signature.method,'owner_administrative');
 assert.equal(rows[0].snapshot.signature.signed_by,owner);
 assert.equal(rows[0].snapshot.owner_takeover.inventory_physically_verified,false);
 assert.equal(rows[0].photos.length,0);
 assert.equal((await query('select count(*)::int n from public.service_truck_inventory_checks'))[0].n,0);
 assert.equal((await call(owner,a)).replayed,true);
 await assert.rejects(call(owner,args()),/already exists/);
});
test('owner exception never changes inventory_ready and auto-revokes on stock change',async()=>{
 let d=(await query("select public.service_departure_readiness_v1($1) as d",[tech]))[0].d;
 assert.equal(d.inventory_ready,false);
 assert.equal(d.owner_departure_authorized,true);
 assert.equal(d.departure_ready,true);
 const b=(await query("select public.owner_tech_command_board_v2() as d"))[0].d;
 assert.equal(b.owner_authorized,true);assert.equal(b.truck_ready,false);
 await query("update public.service_truck_stock set recon_battery_qty=24,updated_at=now()+interval '1 second' where service_tech_id=$1",[tech]);
 d=(await query("select public.service_departure_readiness_v1($1) as d",[tech]))[0].d;
 assert.equal(d.owner_departure_authorized,false);
 assert.equal(d.departure_ready,false);
 assert.equal((await query('select count(*)::int n from public.service_truck_inventory_checks'))[0].n,0);
});
