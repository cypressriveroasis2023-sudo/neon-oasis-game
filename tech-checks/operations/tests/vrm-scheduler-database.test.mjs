import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixture, installSchedulerStubs, schedulerEnableSql, sql, registry, syntheticAccount,
} from './fixtures/vrm-fleet-database-fixture.mjs';

// Explicit pg_cron/pg_net/Vault metadata mocks only. The production registry is
// unmodified; enable/disable SQL retains its transaction/gates/function bodies,
// with only the two unsupported CREATE EXTENSION statements replaced by stubs.
let db, enableSql;
before(async () => {
  db=await fixture();
  await installSchedulerStubs(db);
  enableSql=await schedulerEnableSql();
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    rollback;
    truncate cron.job,net.synthetic_requests,vault.secrets restart identity;
    drop function if exists cos_vrm_private.enqueue_scheduled_sync();
    update cos_vrm_private.sync_state set source_user_id=null,last_attempt_at=null,last_success_at=null,
      lease_id=null,lease_until=null,retry_after_at=null,error_code=null;
  `);
});
const dbSnapshot=async()=> (await db.query('select public.cos_vrm_fleet_snapshot() value')).rows[0].value;
const enqueue=async()=> (await db.query('select cos_vrm_private.enqueue_scheduled_sync() value')).rows[0].value;
async function verifiedDiscovery() {
  const lease=(await db.query('select public.cos_vrm_fleet_begin() value')).rows[0].value.leaseId;
  assert.ok(lease);
  const result=await db.query('select public.cos_vrm_fleet_finish($1,$2,$3) value',[lease,syntheticAccount,[{installationId:1001,name:'Verified synthetic fleet'}]]);
  assert.equal(result.rows[0].value,true);
}
async function noSchedulerArtifacts() {
  assert.equal((await db.query('select count(*)::int n from cron.job')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,0);
  assert.equal((await db.query("select to_regprocedure('cos_vrm_private.enqueue_scheduled_sync()')::text value")).rows[0].value,null);
  assert.equal((await dbSnapshot()).scheduleActive,false);
}

test('scheduler enable refuses never-verified, stale, error, and missing-account states before any new artifacts', async () => {
  const variants=[
    'source_user_id=null,last_success_at=null,error_code=null',
    `source_user_id=${syntheticAccount},last_success_at=now()-interval '5 minutes',error_code=null`,
    `source_user_id=${syntheticAccount},last_success_at=now()-interval '6 minutes',error_code=null`,
    `source_user_id=${syntheticAccount},last_success_at=now(),error_code='access'`,
    'source_user_id=null,last_success_at=now(),error_code=null',
  ];
  const rows=await registry(db);
  for (const variant of variants) {
    await db.exec('update cos_vrm_private.sync_state set '+variant);
    await assert.rejects(()=>db.exec(enableSql),/Verify a successful manual VRM discovery/);
    await db.exec('rollback');
    await noSchedulerArtifacts();
    assert.deepEqual(await registry(db),rows);
  }
});

test('enable after real successful discovery creates one exact 15-minute job and keeps secrets out of command/results', async () => {
  await verifiedDiscovery();
  const rows=await registry(db);
  assert.equal((await dbSnapshot()).scheduleActive,false);
  const results=await db.exec(enableSql);
  const jobs=(await db.query('select jobname,schedule,command,active from cron.job')).rows;
  assert.deepEqual(jobs,[{
    jobname:'cos-vrm-fleet-discovery',schedule:'*/15 * * * *',command:'select cos_vrm_private.enqueue_scheduled_sync();',active:true,
  }]);
  assert.equal((await dbSnapshot()).scheduleActive,true);
  assert.equal((await db.query("select count(*)::int n from vault.secrets where name='cos_vrm_sync_secret' and length(secret)=64 and secret ~ '^[0-9a-f]{64}$'")).rows[0].n,1);
  assert.equal(JSON.stringify(results).includes('a1'.repeat(32)),false);
  assert.equal(JSON.stringify(jobs).includes('a1'.repeat(32)),false);
  assert.equal(JSON.stringify(await dbSnapshot()).includes('a1'.repeat(32)),false);
  assert.deepEqual(await registry(db),rows);
  const acl=(await db.query("select prosecdef,proconfig,not exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') no_public from pg_proc where oid='cos_vrm_private.enqueue_scheduled_sync()'::regprocedure")).rows[0];
  assert.deepEqual(acl,{prosecdef:true,proconfig:['search_path=""'],no_public:true});
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'cos_vrm_private.enqueue_scheduled_sync()','EXECUTE') allowed",[role])).rows[0].allowed,false);
    await db.exec('begin; set local role '+role);
    try { await assert.rejects(()=>db.query('select cos_vrm_private.enqueue_scheduled_sync()'),/permission denied/); }
    finally { await db.exec('rollback'); }
  }
  // A second administrative apply reuses its scoped secret and updates the same named job.
  const secretId=(await db.query("select id from vault.secrets where name='cos_vrm_sync_secret'")).rows[0].id;
  await db.exec(enableSql);
  assert.equal((await db.query('select count(*)::int n from cron.job')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,1);
  assert.equal((await db.query("select id from vault.secrets where name='cos_vrm_sync_secret'")).rows[0].id,secretId);
});

test('scheduler enqueues only the scoped credential to the exact function and respects busy/retry windows', async () => {
  await verifiedDiscovery();
  await db.exec(enableSql);
  assert.equal(await enqueue(),1);
  const request=(await db.query('select url,headers,body,timeout_milliseconds from net.synthetic_requests')).rows[0];
  assert.equal(request.url,'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-fleet-sync');
  assert.deepEqual(Object.keys(request.headers).sort(),['Content-Type','x-cos-vrm-sync'].sort());
  assert.equal(request.headers['Content-Type'],'application/json');
  assert.equal(request.headers['x-cos-vrm-sync'],'a1'.repeat(32)); // Known deterministic fixture value, never real Vault data.
  assert.deepEqual(request.body,{});
  assert.equal(request.timeout_milliseconds,30000);
  assert.equal((await db.query('select public.cos_vrm_scheduler_authorized($1) authorized',[request.headers['x-cos-vrm-sync']])).rows[0].authorized,true);
  await db.exec("update cos_vrm_private.sync_state set lease_id=gen_random_uuid(),lease_until=now()+interval '30 seconds'");
  assert.equal(await enqueue(),null);
  await db.exec("update cos_vrm_private.sync_state set lease_id=null,lease_until=null,retry_after_at=now()+interval '30 seconds'");
  assert.equal(await enqueue(),null);
  assert.equal((await db.query('select count(*)::int n from net.synthetic_requests')).rows[0].n,1);
  await db.exec("update cos_vrm_private.sync_state set retry_after_at=now()-interval '1 second'");
  assert.equal(await enqueue(),2);
});

test('failed schedule creation rolls back newly generated credential, function, and job atomically', async () => {
  await verifiedDiscovery();
  const rows=await registry(db);
  // Fault injection affects only the explicitly mocked cron extension.
  await db.exec("alter table cron.job add constraint reject_synthetic_schedule check (jobname <> 'cos-vrm-fleet-discovery')");
  try {
    await assert.rejects(()=>db.exec(enableSql),/reject_synthetic_schedule/);
    await db.exec('rollback');
    await noSchedulerArtifacts();
    assert.deepEqual(await registry(db),rows);
  } finally { await db.exec('alter table cron.job drop constraint reject_synthetic_schedule'); }
});

test('snapshot requires an active exact 15-minute job; disable is idempotent and retains fleet/secret/unrelated jobs', async () => {
  await verifiedDiscovery();
  await db.exec(enableSql);
  const rows=await registry(db), success=(await dbSnapshot()).lastSuccessAt;
  await db.exec("update cron.job set active=false");
  assert.equal((await dbSnapshot()).scheduleActive,false);
  await db.exec("update cron.job set active=true,schedule='* * * * *'");
  assert.equal((await dbSnapshot()).scheduleActive,false);
  await db.exec("update cron.job set schedule='*/15 * * * *'");
  assert.equal((await dbSnapshot()).scheduleActive,true);
  await db.exec("select cron.schedule('unrelated-synthetic-job','0 * * * *','select 1;')");
  const disableSql=await sql('cos-vrm-schedule-disable.sql');
  await db.exec(disableSql);
  await db.exec(disableSql);
  assert.deepEqual((await db.query('select jobname from cron.job')).rows,[{jobname:'unrelated-synthetic-job'}]);
  assert.equal((await dbSnapshot()).scheduleActive,false);
  assert.equal((await dbSnapshot()).lastSuccessAt,success);
  assert.deepEqual(await registry(db),rows);
  assert.equal((await db.query("select count(*)::int n from vault.secrets where name='cos_vrm_sync_secret'")).rows[0].n,1);
});
