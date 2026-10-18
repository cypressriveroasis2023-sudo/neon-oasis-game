import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assembleBackend,migrations} from '../../transfers/assemble-backend.mjs';
import {custodyFixture} from './helpers/custody-fixture.mjs';
test('review assembly is one atomic transaction with exact prerequisites, held settings and no key material',async()=>{
 const sql=await assembleBackend();assert.equal(migrations.length,8);assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1);assert.ok(sql.includes('Fresh-install package only'));assert.ok(sql.includes('Reviewed prerequisite changed'));assert.ok(sql.includes('Installation must remain held'));assert.doesNotMatch(sql,/insert into app_private\.techcheck_location_keys_v7/);assert.doesNotMatch(sql,/set enabled=true/);
});
test('exact assembled install passes on real PostgreSQL, keeps all flags false, and rejects an unreviewed reinstall',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const f=await custodyFixture({install:false});
 try{
  await f.db.exec("create schema extensions;create extension pgcrypto with schema extensions;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;create table morning_checks(id uuid default gen_random_uuid(),service_tech_id uuid,submitted_at timestamptz default now(),truck_checks jsonb,taking_trailer boolean,trailer_checks jsonb,is_test boolean default false)");
  for(const name of ['service-daily-reports-v1.sql','service-daily-individual-sim-photos-v2.sql','service-daily-battery-type-photos-v3.sql','service-daily-signoff-attachments-v4.sql'])await f.db.exec(await f.readMigration(name));
  for(const row of JSON.parse(await readFile(new URL('./fixtures/custody-prerequisites-20261017.json',import.meta.url),'utf8')))await f.db.exec(row.definition);
  await f.db.exec('grant execute on function public.complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role');
  // Match the installed public-schema defaults, which otherwise silently add
  // service_role execution to every newly created browser RPC.
  await f.db.exec('alter default privileges in schema public grant execute on functions to authenticated,service_role');
  const sql=await assembleBackend();await f.db.exec(sql);
  const browserRpcs=['techcheck_transfer_readiness_v1','techcheck_transfer_context_v1','submit_techcheck_transfer_v1','submit_techcheck_transfer_v7','techcheck_daily_receipts_v5','complete_service_daily_report_v5','owner_techcheck_return_reviews_v6','owner_release_techcheck_return_v7'];
  const grants=(await f.db.query("select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service_role from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (select jsonb_array_elements_text($1::jsonb)) order by p.proname",[browserRpcs])).rows;
  assert.equal(grants.length,browserRpcs.length);for(const row of grants)assert.deepEqual(row,{proname:row.proname,anon:false,authenticated:true,service_role:false});
  assert.equal((await f.db.query("select has_function_privilege('service_role','public.complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') kept")).rows[0].kept,true);
  const settings=(await f.db.query('select enabled,reports_ready,receipt_link_ready,custody_ready from app_private.techcheck_transfer_settings')).rows[0];assert.deepEqual(settings,{enabled:false,reports_ready:false,receipt_link_ready:false,custody_ready:false});
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_location_keys_v7')).rows[0].n,0);assert.equal((await f.db.query('select app_private.techcheck_transfer_ready_v1() ready')).rows[0].ready,false);
  await assert.rejects(f.db.exec(sql),/Fresh-install package only/);await f.db.exec('rollback');
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events')).rows[0].n,0);
 }finally{await f.close();}
});
