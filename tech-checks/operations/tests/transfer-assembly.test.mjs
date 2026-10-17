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
  const sql=await assembleBackend();await f.db.exec(sql);
  const settings=(await f.db.query('select enabled,reports_ready,receipt_link_ready,custody_ready from app_private.techcheck_transfer_settings')).rows[0];assert.deepEqual(settings,{enabled:false,reports_ready:false,receipt_link_ready:false,custody_ready:false});
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_location_keys_v7')).rows[0].n,0);assert.equal((await f.db.query('select app_private.techcheck_transfer_ready_v1() ready')).rows[0].ready,false);
  await assert.rejects(f.db.exec(sql),/Fresh-install package only/);await f.db.exec('rollback');
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events')).rows[0].n,0);
 }finally{await f.close();}
});
