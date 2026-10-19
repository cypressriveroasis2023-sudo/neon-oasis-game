import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

test('legacy mHelp Sheets publisher cannot reverse an Owner move, retaining all original proof gates',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role;");
  await db.exec("create schema cos_mhelp_placement_private;create schema cos_sheets_placement_private;create schema cos_operational_private;");
  await db.exec("create table cos_mhelp_placement_private.links(equipment_id text primary key,tracker_id uuid,native_unit_id uuid,baseline_guard text,observation jsonb,observed_at timestamptz);");
  await db.exec("create table cos_mhelp_placement_private.control(singleton boolean,enabled boolean,error_code text,last_success_at timestamptz);");
  await db.exec("create table cos_operational_private.current_placements(product_id text primary key);");
  await db.exec("create function cos_mhelp_placement_private.guard(p_tracker uuid,p_native uuid) returns text language sql stable as $$select repeat('a',64)$$;");
  await db.exec("insert into cos_mhelp_placement_private.control values(true,true,null,clock_timestamp());");
  await db.exec("insert into cos_mhelp_placement_private.links values('123',null,null,repeat('a',64),'{\"state\":\"confirmed\"}',clock_timestamp());");
  await db.exec("create function cos_sheets_placement_private.source_current(p_link cos_mhelp_placement_private.links) returns boolean language sql stable set search_path='' as $$select coalesce(p_link.observation->>'state'='confirmed' and p_link.observed_at>clock_timestamp()-interval '20 minutes' and cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard and exists(select 1 from cos_mhelp_placement_private.control where singleton and enabled and error_code is null and last_success_at>clock_timestamp()-interval '20 minutes'),false)$$;");
  const state=async()=>Boolean((await db.query("select cos_sheets_placement_private.source_current(l) as s from cos_mhelp_placement_private.links l")).rows[0].s);
  assert.equal(await state(),true);
  const previous=(await db.query("select count(*)::int n from cos_mhelp_placement_private.links")).rows[0].n;
  await db.exec(await readFile(new URL('../docs/drafts/cos-operational-publisher-guard.sql',import.meta.url),'utf8'));
  assert.equal(await state(),true,'same confirmed source stays eligible without Owner changes');
  await db.exec("insert into cos_operational_private.current_placements values('123')");
  assert.equal(await state(),false,'Owner placement locks out old source publisher');
  await db.exec("delete from cos_operational_private.current_placements");
  assert.equal(await state(),true);
  await db.exec("update cos_mhelp_placement_private.control set error_code='source_rate_limited'");
  assert.equal(await state(),false,'source freshness gates still work');
  assert.equal((await db.query("select count(*)::int n from cos_mhelp_placement_private.links")).rows[0].n,previous);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   await assert.rejects(db.query("select cos_sheets_placement_private.source_current(l) from cos_mhelp_placement_private.links l"),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});
