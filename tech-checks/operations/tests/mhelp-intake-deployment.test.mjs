import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../legacy/mhelp-intake-fixture.mjs';
import {mhelpIntakeDeploymentSql} from '../legacy/deploymentAssembly.mjs';

test('intake definitions form one transaction without activation or external execution',async()=>{
  const sql=await mhelpIntakeDeploymentSql();
  assert.equal(sql.split('\n').filter(x=>x.trim()==='begin;').length,1);
  assert.equal(sql.split('\n').filter(x=>x.trim()==='commit;').length,1);
  assert(sql.indexOf('create schema cos_mhelp_intake')<sql.indexOf('create table cos_mhelp_intake.scheduler_state'));
  assert.match(sql,/set local lock_timeout='2s'/);assert.match(sql,/set local statement_timeout='30s'/);
  assert.doesNotMatch(sql,/\b(?:http_post|http_get|cron\.schedule|decrypted_secrets)\b/i);
  assert.doesNotMatch(sql,/insert into cos_mhelp_intake\.portal_config/i);
});

test('failed atomic deployment restores legacy attribution and leaves no new objects',async()=>{
  const db=await fixture({enabled:false,realScheduler:true});
  // Isolated synthetic database only: restore its pre-intake shape.
  await db.exec('drop function public.camera_mhelp_ticket_intake_v1(jsonb);drop schema cos_mhelp_intake cascade;alter table public.job_assignments drop constraint job_assignments_mhelp_actor_required;alter table public.job_assignments alter column assigned_by set not null;');
  const sql=await mhelpIntakeDeploymentSql();
  await assert.rejects(db.exec(sql.replace(/commit;\s*$/,'select definitely_missing_synthetic_deployment_check();\ncommit;')));
  await db.exec('rollback;');
  assert.equal((await db.query("select to_regnamespace('cos_mhelp_intake') is null as absent")).rows[0].absent,true);
  assert.equal((await db.query("select attnotnull from pg_attribute where attrelid='public.job_assignments'::regclass and attname='assigned_by'")).rows[0].attnotnull,true);
  await db.exec(sql);
  assert.equal((await db.query("select to_regclass('cos_mhelp_intake.scheduler_state') is not null as present")).rows[0].present,true);
  const acl=(await db.query("select has_function_privilege('service_role','public.camera_mhelp_ticket_intake_v1(jsonb)','execute') as service,has_function_privilege('authenticated','public.camera_mhelp_ticket_intake_v1(jsonb)','execute') as human,has_function_privilege('anon','public.camera_mhelp_ticket_intake_v1(jsonb)','execute') as public")).rows[0];
  assert.equal(acl.service,true);assert.equal(acl.human,false);assert.equal(acl.public,false);
  assert.equal((await db.query('select count(*)::integer n from cos_mhelp_intake.portal_config')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::integer n from public.job_assignments')).rows[0].n,0);
});
