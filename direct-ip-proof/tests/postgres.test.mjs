/** Actual independent-session gates. Runs ONLY against the ephemeral hosted service. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createFixture,refused,unknown} from '../lib/fixture.mjs';
import {assertHostedPostgres} from '../lib/database.mjs';
assertHostedPostgres();
const definitive=s=>({health:s.health,history:s.history,device:s.device});
const stmt='select public.publish_camera_connection_v1($1::bigint,$2::bigint,$3::inet,$4::integer[],$5::text,$6::jsonb,$7::text) as value';
const values=a=>[a.p_device_id,a.p_revision,a.p_public_ip,a.p_expected_ports,a.p_monitoring_profile,a.p_health,a.p_source];
const args=async(f,t,op='complete',ports=[refused()],completedAt=new Date().toISOString())=>({...await f.baseArgs(),p_health:{direct_attempt:{version:1,op,attempt_id:t?.attempt_id||randomUUID(),
 ...(t?{sequence:t.sequence}:{}),binding:t?.binding||await f.binding(),...(op==='complete'?{result:{completed_at:completedAt,ports}}:{})}}});
async function beginTransaction(c){await c.query('begin');await c.query("set local role service_role;set local request.jwt.claim.role='service_role'");}
async function invoke(c,a){return (await c.query(stmt,values(a))).rows[0].value;}
function start(f,c,a){const p=invoke(c,a);p.catch(()=>{});f.inFlight.push(p);return p;}
async function blocked(f,waiting,blocker) {
 const until=Date.now()+5000;
 while(Date.now()<until){const row=(await f.pg.query('select pg_blocking_pids($1) as pids',[waiting.processID])).rows[0];
  if(row.pids.includes(blocker.processID))return;await delay(20);}
 throw Error('Expected independently observed PostgreSQL lock wait was not reached');
}
async function scenario(fn,options={}){const f=await createFixture({backend:'postgres',syntheticClock:false,...options});f.inFlight=[];try{return await fn(f);}finally{await f.close();await Promise.allSettled(f.inFlight);}}
async function shortExpiry(f,t,milliseconds=1800){
 const at=new Date(Date.now()+milliseconds).toISOString();
 await f.pg.query('update camera_direct_health_private.attempt_state set expires_at=$1::timestamptz where current_attempt_id=$2',[at,t.attempt_id]);
 await f.pg.query("update camera_direct_health_private.attempt_receipts set expires_at=$1::timestamptz,registration_receipt=jsonb_set(registration_receipt,'{expires_at}',to_jsonb($1::timestamptz)) where attempt_id=$2",[at,t.attempt_id]);
 return Date.parse(at);
}
async function afterExpiry(expiry){await delay(Math.max(0,expiry-Date.now()+50));}

// Every contention assertion waits for pg_blocking_pids, never an assumed timing.
test('independent clients serialize the missing first-state row and issue unique sequence 1/2',()=>scenario(async f=>{
 const a=await f.database.newClient(),b=await f.database.newClient();await beginTransaction(a);await beginTransaction(b);
 const one=await invoke(a,await args(f,null,'begin'));assert.equal(one.sequence,'1');
 const secondArgs=await args(f,null,'begin'),pending=start(f,b,secondArgs);await blocked(f,b,a);
 assert.equal((await f.snapshot()).state.length,0,'uncommitted first registration must be invisible');
 await a.query('commit');const two=await pending;await b.query('commit');assert.equal(two.sequence,'2');
 const snapshot=await f.snapshot();assert.equal(snapshot.receipts.length,2);assert.equal(snapshot.state.length,1);assert.equal(snapshot.state[0].current_attempt_id,two.attempt_id);
 const stale=await f.rpc(await args(f,one));assert.equal(stale.reason,'superseded');assert.equal(stale.health_published,false);
 const u=await f.rpc(await args(f,two,'complete',[unknown()]));assert.equal(u.validity,'unverified');
 const next=await f.begin();assert.equal((await f.complete(next)).consecutive_failures,1);
}));

test('independent same-ID registrations return one immutable ticket after commit',()=>scenario(async f=>{
 const a=await f.database.newClient(),b=await f.database.newClient();await beginTransaction(a);await beginTransaction(b);
 const payload=await args(f,null,'begin'),one=await invoke(a,payload),pending=start(f,b,payload);await blocked(f,b,a);
 await a.query('commit');const two=await pending;await b.query('commit');assert.deepEqual(two,one);assert.equal((await f.snapshot()).receipts.length,1);
}));

test('independent duplicate completions publish once and retain frozen completion time',()=>scenario(async f=>{
 const ticket=await f.begin(),payload=await args(f,ticket);
 const a=await f.database.newClient(),b=await f.database.newClient();await beginTransaction(a);await beginTransaction(b);
 const first=await invoke(a,payload),pending=start(f,b,payload);await blocked(f,b,a);
 assert.equal((await f.snapshot()).health,null,'uncommitted health must be invisible');
 await a.query('commit');const replay=await pending;await b.query('commit');assert.deepEqual(replay,first);
 const snapshot=await f.snapshot();assert.equal(snapshot.receipts.length,1);assert.equal(snapshot.history.length,1);assert.equal(snapshot.health.consecutive_failures,1);
 assert.equal(Date.parse(snapshot.health.checked_at),Date.parse(payload.p_health.direct_attempt.result.completed_at));
}));

test('new registration waits for older completion commit, then seeds exactly the committed refusal',()=>scenario(async f=>{
 const ticket=await f.begin(),a=await f.database.newClient(),b=await f.database.newClient();await beginTransaction(a);await beginTransaction(b);
 assert.equal((await invoke(a,await args(f,ticket))).consecutive_failures,1);
 const pending=start(f,b,await args(f,null,'begin'));await blocked(f,b,a);await a.query('commit');const next=await pending;await b.query('commit');
 await delay(2);const out=await f.rpc(await args(f,next));assert.equal(out.consecutive_failures,2);
}));

test('rollback of a registered-but-uncommitted attempt never consumes visible sequence or permits receipt reuse',()=>scenario(async f=>{
 const a=await f.database.newClient(),b=await f.database.newClient();await beginTransaction(a);await beginTransaction(b);
 const payload=await args(f,null,'begin'),one=await invoke(a,payload),pending=start(f,b,payload);await blocked(f,b,a);
 await a.query('rollback');const two=await pending;await b.query('commit');assert.equal(two.sequence,'1');assert.equal(two.attempt_id,one.attempt_id);
 assert.equal((await f.snapshot()).receipts.length,1);
}));

test('failure after health/device mutation rolls back health, history, receipt and state atomically',()=>scenario(async f=>{
 const ticket=await f.begin(),before=await f.snapshot();
 await f.pg.exec(`create function public.proof_fail_history() returns trigger language plpgsql as $$begin raise exception 'synthetic history failure' using errcode='P0001';end $$;
 create trigger zz_proof_fail_history before insert on public.camera_health_history for each row execute function public.proof_fail_history();`);
 await assert.rejects(()=>f.complete(ticket),e=>e.code==='P0001');assert.deepEqual(await f.snapshot(),before);
 await f.pg.exec('drop trigger zz_proof_fail_history on public.camera_health_history;drop function public.proof_fail_history()');
 assert.equal((await f.complete(ticket)).consecutive_failures,1);assert.equal((await f.snapshot()).receipts.length,1);
}));

test('endpoint edit held in another transaction defeats stale queued completion',()=>scenario(async f=>{
 const ticket=await f.begin(),payload=await args(f,ticket),editor=await f.database.newClient(),writer=await f.database.newClient();
 await editor.query('begin');await editor.query("update camera_devices set public_ip='8.8.8.8' where id=1");await beginTransaction(writer);
 const pending=start(f,writer,payload);await blocked(f,writer,editor);await editor.query('commit');const changed=await f.snapshot();
 const result=await pending;await writer.query('commit');assert.equal(result.health_published,false);assert.equal(result.reason,'binding_changed');
 assert.deepEqual(definitive(await f.snapshot()),definitive(changed));
}));

test('existing health-row lock wait past a shortened fixture ticket expiry preserves definitive evidence',()=>scenario(async f=>{
 assert.equal((await f.complete(await f.begin())).consecutive_failures,1);await delay(2);
 const ticket=await f.begin(),before=await f.snapshot(),holder=await f.database.newClient(),writer=await f.database.newClient();
 await holder.query('begin');await holder.query('select * from camera_health_current where camera_device_id=1 for update');
 const expiry=await shortExpiry(f,ticket);await beginTransaction(writer);const pending=start(f,writer,await args(f,ticket));await blocked(f,writer,holder);
 assert(Date.now()<expiry,'fixture setup must reach the intended lock before expiry');await afterExpiry(expiry);await holder.query('commit');
 const result=await pending;await writer.query('commit');assert.equal(result.health_published,false);assert.equal(result.reason,'attempt_expired');
 assert.deepEqual(definitive(await f.snapshot()),definitive(before));
}));

test('GATE: first-health BEFORE INSERT trigger wait past expiry must not publish definitive state',()=>scenario(async f=>{
 const ticket=await f.begin(),before=await f.snapshot(),holder=await f.database.newClient(),writer=await f.database.newClient();
 await holder.query('select pg_advisory_lock(91364001)');
 await f.pg.exec(`create function public.proof_wait_insert() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(91364001);return new;end $$;
 create trigger zz_proof_wait_insert before insert on public.camera_health_current for each row execute function public.proof_wait_insert();`);
 const expiry=await shortExpiry(f,ticket);await beginTransaction(writer);const pending=start(f,writer,await args(f,ticket));await blocked(f,writer,holder);
 assert(Date.now()<expiry,'fixture setup must reach the trigger wait before expiry');await afterExpiry(expiry);await holder.query('select pg_advisory_unlock(91364001)');
 const result=await pending;await writer.query('commit');
 // This is deliberately a hard gate, not skipped or expected-failure. The local
 // synthetic-clock diagnostic shows the reviewed SQL lacks this late recheck.
 assert.equal(result.health_published,false,'expired trigger-wait completion must remain unverified');
 assert.deepEqual(definitive(await f.snapshot()),definitive(before));
}));

test('diagnostic only: privileged trigger-bypass writer can create the otherwise locked first-health insertion conflict',t=>scenario(async f=>{
 const ticket=await f.begin(),holder=await f.database.newClient(),writer=await f.database.newClient(),other=await f.database.newClient();
 await holder.query('select pg_advisory_lock(91364002)');
 await f.pg.exec(`create function public.proof_wait_conflict() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(91364002);return new;end $$;
 create trigger zz_proof_wait_conflict before insert on public.camera_health_current for each row execute function public.proof_wait_conflict();`);
 await beginTransaction(writer);const payload=await args(f,ticket),pending=start(f,writer,payload);await blocked(f,writer,holder);
 // Explicitly privileged synthetic raw writer: replica mode avoids the fixture
 // FK/trigger device lock. This probes the open catalog/writer boundary; it is
 // NOT evidence that a cooperating production writer can bypass that lock.
 await other.query('begin');await other.query('set local session_replication_role=replica');
 const newer=new Date(Date.now()+1000).toISOString();
 await other.query("insert into camera_health_current(camera_device_id,overall_status,ip_reachable,checked_at,port_status,consecutive_failures) values(1,'online',true,$1::timestamptz,$2::jsonb,0)",[newer,{_connection:{revision:'0',ip:'8.8.4.1',checkedAt:newer,status:'online',reachable:true}}]);
 await other.query('commit');const preserved=(await f.snapshot()).health;await holder.query('select pg_advisory_unlock(91364002)');
 const result=await pending;await writer.query('commit');
 const after=(await f.snapshot()).health;
 t.diagnostic(JSON.stringify({scope:'privileged raw writer outside cooperating boundary',newerObservation:newer,healthPublished:result.health_published,newerHealthPreserved:JSON.stringify(after)===JSON.stringify(preserved)}));
 assert.equal(result.ok,true,'the harness must obtain the actual publisher result');
}));

test('a normal independent first-health insert holds its FK device lock before publisher admission and preserves newer evidence',()=>scenario(async f=>{
 const ticket=await f.begin(),payload=await args(f,ticket),other=await f.database.newClient(),writer=await f.database.newClient();
 await other.query('begin');
 const newer=new Date(Date.now()+500).toISOString();
 await other.query("insert into camera_health_current(camera_device_id,overall_status,ip_reachable,checked_at,port_status,consecutive_failures) values(1,'online',true,$1::timestamptz,$2::jsonb,0)",[newer,{_connection:{revision:'0',ip:'8.8.4.1',checkedAt:newer,status:'online',reachable:true}}]);
 await beginTransaction(writer);const pending=start(f,writer,payload);await blocked(f,writer,other);await other.query('commit');
 const preserve=(await f.snapshot()).health,result=await pending;await writer.query('commit');
 assert.equal(result.health_published,false);assert.equal(result.reason,'older_observation');assert.deepEqual((await f.snapshot()).health,preserve);
}));
