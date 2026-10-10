/** Synthetic, isolated scheduler SQL tests. No network, credentials or activation. */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {BATCH_CONTRACT,INTAKE_LIMITS,IntakeFault,runMhelpIntake} from '../intake/mhelpIntakeRuntime.ts';

const base=Date.parse('2026-10-10T12:00:00.000Z');
const minute=60000;
const sql=await readFile(new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url),'utf8');
let database;
after(async()=>{await database?.close();});

async function fixture() {
  const db=database ||= new PGlite();
  await db.exec(`drop schema if exists cos_mhelp_intake cascade;
    drop schema if exists synthetic_clock cascade;
    drop role if exists anon;drop role if exists authenticated;drop role if exists service_role;
    create role anon;create role authenticated;create role service_role;
    create schema cos_mhelp_intake;
    create table cos_mhelp_intake.portal_config(portal_id text primary key,enabled boolean,
      activated_at timestamptz,schema_contract text,schema_evidence text);
    create table cos_mhelp_intake.receipts(portal_id text,ticket_id text,source_created_at timestamptz,
      state text,first_payload jsonb,reason_codes text[] not null default '{}',primary key(portal_id,ticket_id));
    insert into cos_mhelp_intake.portal_config values('17',true,'2026-10-10T11:00:00Z',
      'synthetic-only','Synthetic schema evidence');
    create schema synthetic_clock;
    create table synthetic_clock.current_time(value timestamptz not null);
    insert into synthetic_clock.current_time values('2026-10-10T12:00:00Z');
    create function synthetic_clock.clock_timestamp() returns timestamptz
      language sql volatile set search_path='' as $$select value from synthetic_clock.current_time$$;`);
  // Bind only the clock in this isolated copy. Production has no caller-controlled
  // clock or schedule input. All guards, locks, updates and privileges execute from
  // the real proposal; exact boundary tests need no wall-clock sleeps/tolerances.
  await db.exec(sql.replaceAll('clock_timestamp()','synthetic_clock.clock_timestamp()'));
  const clock=async elapsed=>db.query('update synthetic_clock.current_time set value=$1::timestamptz',
    [new Date(base+elapsed).toISOString()]);
  const state=async()=>(await db.query('select * from cos_mhelp_intake.scheduler_state')).rows[0];
  const begin=async()=>(await db.query('select cos_mhelp_intake.begin_intake_v1() value')).rows[0].value;
  const commit=async(id,ids=[])=>(await db.query('select cos_mhelp_intake.commit_discovery_v1($1,$2::jsonb,$3) value',[id,JSON.stringify(ids),ids.length])).rows[0].value;
  const release=async id=>(await db.query('select cos_mhelp_intake.finish_intake_v1($1) value',[id])).rows[0].value;
  const finish=async(id,ids=[])=>{const result=await commit(id,ids);await release(id);return result;};
  const fail=async(id,seconds=0,retryable=true)=>(await db.query(
    "select cos_mhelp_intake.fail_intake_v1($1,'SOURCE_UNAVAILABLE',$2,$3) value",
    [id,retryable,seconds])).rows[0].value;
  return {db,clock,state,begin,finish,commit,release,fail};
}

test('SQL durable cadence turns repeating 3/3/9-minute triggers into eight source reads per hour',async()=>{
  const f=await fixture();
  let sourceReads=0,elapsed=0;
  const actions=[],completed=[];
  const rpc=async input=>{
    actions.push(input.action);
    if(input.action==='begin')return f.begin();
    if(input.action==='commit_discovery')return f.commit(input.leaseId,input.expectedTicketIds);
    if(input.action==='finish')return f.release(input.leaseId);
    assert.fail('Empty successful scans must not record or fail');
  };
  for(let hour=0;hour<2;hour++)for(const offset of [3,6,9,18,21,24,33,36,39,48,51,54]){
    elapsed=(hour*60+offset)*minute;
    await f.clock(elapsed);
    const before=await f.state(),oldReads=sourceReads,start=actions.length;
    const result=await runMhelpIntake({enabled:true,rpc,now:()=>base+elapsed,
      readSource:async window=>{sourceReads++;return {contract:BATCH_CONTRACT,portalId:'17',
        schemaContract:'synthetic-only',window,totalRows:0,partial:false,tickets:[]};}});
    const eligible=![6,21,36,51].includes(offset);
    assert.equal(result.state,eligible?'complete':'idle',`Trigger at +${hour*60+offset} minutes`);
    assert.equal(sourceReads-oldReads,eligible?1:0,'Idle returns before any source/vendor access');
    assert.equal(result.watermarkAdvanced,eligible);
    if(eligible){
      completed.push(hour*60+offset);
      assert.deepEqual(actions.slice(start),['begin','commit_discovery','finish']);
      assert.equal((await f.state()).last_attempt_at.getTime(),base+elapsed);
    }else{
      assert.deepEqual(actions.slice(start),['begin']);
      assert.deepEqual(await f.state(),before,'Idle must preserve cursor, lease, attempt and success state');
    }
  }
  assert.deepEqual(completed,[3,9,18,24,33,39,48,54,63,69,78,84,93,99,108,114]);
  assert.equal(sourceReads,16);
  assert(completed.slice(1).every((value,index)=>value-completed[index]>=5));
});

test('SQL minimum cadence is exactly five minutes and idle triggers do not slide eligibility',async()=>{
  const f=await fixture();
  assert.equal(INTAKE_LIMITS.cadenceSeconds,300);
  const first=await f.begin();
  assert.equal(first.state,'leased','No prior attempt is immediately eligible');
  assert.equal(Date.parse(first.leaseUntil)-base,180000,'Lease duration remains 180 seconds');
  assert.equal(Date.parse(first.createdBefore)-Date.parse(first.activationFloor),15*minute);
  await f.finish(first.leaseId);
  const saved=await f.state();
  for(const elapsed of [3*minute,5*minute-1]){
    await f.clock(elapsed);
    assert.deepEqual(await f.begin(),{state:'idle'});
    assert.deepEqual(await f.state(),saved);
  }
  await f.clock(5*minute);
  const second=await f.begin();
  assert.equal(second.state,'leased','Exact equality is eligible');
  assert.notEqual(second.leaseId,first.leaseId);
  assert.equal(Date.parse(second.createdAfter),Date.parse(first.createdBefore)-10*minute);
  assert.equal(Date.parse(second.createdBefore)-Date.parse(first.createdBefore),15*minute);
  assert.equal((await f.state()).last_attempt_at.getTime(),base+5*minute);
  assert.equal((await f.state()).watermark.getTime(),saved.watermark.getTime(),'Lease alone never advances cursor');
});

test('lost begin acknowledgement cannot repeat vendor work or bypass lease and durable minimum cadence',async()=>{
  const f=await fixture();let elapsed=0,loseBegin=true,sourceReads=0;
  const options={enabled:true,now:()=>base+elapsed,sleep:async()=>{},random:()=>0,
    rpc:async input=>{
      if(input.action==='begin'){
        const value=await f.begin();
        if(loseBegin){loseBegin=false;throw new IntakeFault('WRITE_UNAVAILABLE',true);}
        return value;
      }
      if(input.action==='commit_discovery')return f.commit(input.leaseId,input.expectedTicketIds);
    if(input.action==='finish')return f.release(input.leaseId);
      assert.fail('Lost begin acknowledgement must not record or clear an unknown lease');
    },
    readSource:async window=>{sourceReads++;return {contract:BATCH_CONTRACT,portalId:'17',
      schemaContract:'synthetic-only',window,totalRows:0,partial:false,tickets:[]};},
  };
  assert.equal((await runMhelpIntake(options)).state,'busy','Retry observes the already committed lease');
  const admitted=await f.state();assert(admitted.lease_id);assert.equal(admitted.last_attempt_at.getTime(),base);
  assert.equal(admitted.watermark.toISOString(),'2026-10-10T11:00:00.000Z');assert.equal(sourceReads,0);
  elapsed=3*minute;await f.clock(elapsed);
  assert.equal((await runMhelpIntake(options)).state,'idle');assert.equal(sourceReads,0);
  assert.deepEqual(await f.state(),admitted,'Expiry alone cannot erase a committed attempt');
  elapsed=5*minute;await f.clock(elapsed);
  assert.equal((await runMhelpIntake(options)).state,'complete');assert.equal(sourceReads,1);
  assert.equal((await f.state()).watermark.toISOString(),'2026-10-10T11:15:00.000Z');
});

test('SQL disabled, live lease and persisted backoff retain priority over minimum cadence',async()=>{
  const f=await fixture();
  await f.db.exec('update cos_mhelp_intake.portal_config set enabled=false');
  assert.deepEqual(await f.begin(),{state:'disabled'});
  assert.equal(await f.state(),undefined);
  await f.db.exec('update cos_mhelp_intake.portal_config set enabled=true');
  await f.begin();
  await f.db.query('update cos_mhelp_intake.scheduler_state set retry_after=$1',[new Date(base+4*minute).toISOString()]);
  const saved=await f.state();
  await f.clock(2*minute);
  assert.deepEqual(await f.begin(),{state:'busy'},'Live lease wins even when backoff is also active');
  await f.clock(3*minute);
  assert.deepEqual(await f.begin(),{state:'backoff'},'Lease expires at equality; cooldown wins over cadence');
  await f.clock(4*minute);
  assert.deepEqual(await f.begin(),{state:'idle'},'Expired cooldown cannot bypass the minimum cadence');
  assert.deepEqual(await f.state(),saved);
  await f.db.exec('update cos_mhelp_intake.portal_config set enabled=false');
  assert.deepEqual(await f.begin(),{state:'disabled'});
  assert.deepEqual(await f.state(),saved);
  await f.db.exec('update cos_mhelp_intake.portal_config set enabled=true');
  await f.clock(5*minute);
  assert.equal((await f.begin()).state,'leased');
});

test('SQL crash with no failure persistence waits through lease expiry and cadence before replay',async()=>{
  const f=await fixture(),first=await f.begin(),saved=await f.state();
  await f.db.query(`insert into cos_mhelp_intake.receipts(portal_id,ticket_id,source_created_at,state,first_payload) values('17','42',
    $1::timestamptz+interval '1 second','review_needed','{"schemaContract":"synthetic-only"}')`,[first.activationFloor]);
  await f.clock(3*minute);
  assert.deepEqual(await f.begin(),{state:'idle'});
  assert.deepEqual(await f.state(),saved);
  await f.clock(5*minute);
  const replay=await f.begin();
  assert.equal(replay.state,'leased');
  assert.notEqual(replay.leaseId,first.leaseId);
  assert.equal(replay.createdAfter,first.createdAfter);
  assert.equal(replay.createdBefore,first.createdBefore);
  const active=await f.state();
  await assert.rejects(f.finish(first.leaseId,['42']),/LEASE_LOST/);
  assert.deepEqual(await f.fail(first.leaseId),{state:'lease_lost'});
  assert.deepEqual(await f.state(),active,'Stale workers cannot mutate the newer lease');
  const result=await f.finish(replay.leaseId,['42']);
  assert.deepEqual(result,{state:'complete',total:1,watermarkAdvanced:true});
  const completed=await f.state();
  await f.clock(6*minute);
  assert.deepEqual(await f.finish(replay.leaseId,['42']),result,'Lost finish acknowledgement remains replayable');
  assert.deepEqual(await f.begin(),{state:'idle'});
  assert.deepEqual(await f.state(),completed,'Finish replay and idle preserve the durable attempt timestamp');
});

test('SQL failed polls honor both minimum cadence and the longer provider or permanent cooldown',async()=>{
  for(const [provider,retryable,delay]of [[0,true,30],[600,true,600],[0,false,1800]]){
    const f=await fixture(),first=await f.begin();
    // A failure can occur later in the 120-second run budget. Cadence is measured
    // from the admitted attempt; backoff is independently measured from failure.
    await f.clock(minute);
    assert.deepEqual(await f.fail(first.leaseId,provider,retryable),{state:'backoff',retryAfterSeconds:delay});
    const failed=await f.state();
    assert.equal(failed.last_attempt_at.getTime(),base);
    assert.equal(failed.watermark.toISOString(),first.activationFloor);
    await f.clock(minute+delay*1000-1);
    assert.deepEqual(await f.begin(),{state:'backoff'});
    assert.deepEqual(await f.state(),failed);
    if(delay<240){
      await f.clock(minute+delay*1000);
      assert.deepEqual(await f.begin(),{state:'idle'},'Short cooldown equality still waits for five minutes');
      assert.deepEqual(await f.state(),failed);
    }else{
      await f.clock(5*minute);
      assert.deepEqual(await f.begin(),{state:'backoff'},'Five minutes cannot shorten a longer cooldown');
      assert.deepEqual(await f.state(),failed);
    }
    await f.clock(Math.max(5*minute,minute+delay*1000));
    const next=await f.begin();
    assert.equal(next.state,'leased','Equality at the later eligibility bound is allowed');
    assert.equal(next.createdAfter,first.createdAfter);
    assert.equal(next.createdBefore,first.createdBefore);
    assert.equal((await f.state()).watermark.getTime(),failed.watermark.getTime());
    await f.finish(next.leaseId);
    const complete=await f.state();
    assert.equal(complete.failure_count,0);assert.equal(complete.retry_after,null);
    assert.deepEqual(await f.begin(),{state:'idle'},'Successful recovery does not erase the attempt cooldown');
    assert.deepEqual(await f.state(),complete);
  }
});

test('SQL cadence adds no public access, caller-controlled arguments or scheduler activation',async()=>{
  const f=await fixture();
  for(const role of ['anon','authenticated','service_role']){
    const permissions=(await f.db.query(`select
      has_function_privilege($1,'cos_mhelp_intake.begin_intake_v1()','execute') helper,
      has_table_privilege($1,'cos_mhelp_intake.scheduler_state','select,insert,update,delete') state`,[role])).rows[0];
    assert.deepEqual(permissions,{helper:false,state:false});
  }
  assert.equal((await f.db.query("select relrowsecurity value from pg_class where oid='cos_mhelp_intake.scheduler_state'::regclass")).rows[0].value,true);
  assert.equal((await f.db.query("select pronargs value from pg_proc where oid='cos_mhelp_intake.begin_intake_v1()'::regprocedure")).rows[0].value,0);
  assert.doesNotMatch(sql,/\bgrant\b|cron\.schedule|net\.http|synthetic_clock/i);
});
