import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttemptFixture,attemptId,MINUTE,refused,unknown,connected,ORIGINAL_PUBLISHER_SHA256} from '../lib/fixture.mjs';

// All arithmetic tests use a synthetic clock substituted only in the loaded SQL
// draft. These are single-session PGlite results, never deployed-catalog, Edge,
// grant, multi-session locking or actual PostgreSQL concurrency proof.
const time=value=>Date.parse(value);
const preserved=snapshot=>({health:snapshot.health,history:snapshot.history,device:snapshot.device});
async function fixtureRun(run,options) {
 const f=await createAttemptFixture(options);
 try{return await run(f);}finally{await f.close();}
}
async function observe(f,ports=[refused()],advance=0) {
 if(advance)await f.advance(advance);
 const ticket=await f.begin();assert.equal(ticket.ok,true);
 assert.equal(ticket.phase,'pending');assert.equal(typeof ticket.sequence,'string');
 const result=await f.complete(ticket,{ports});
 return {ticket,result};
}
function refusedResult(result,count) {
 assert.equal(result.ok,true);assert.equal(result.validity,'refused');
 assert.equal(result.status,count===3?'offline':'verifying');
 assert.equal(result.consecutive_failures,count);assert.equal(result.health_published,true);
}
async function seedTwo(f,ports=[refused()]) {
 refusedResult((await observe(f,ports)).result,1);
 refusedResult((await observe(f,ports,15*MINUTE)).result,2);
}

test('real-clock synthetic-catalog smoke keeps the existing publisher owner and role boundary',t=>fixtureRun(async f=>{
 t.diagnostic(JSON.stringify({localDraftSha256:f.draftSqlSha256,capturedPublisherSha256:f.originalPublisherSha256,catalog:'synthetic',clock:'real',actualPostgreSQLConcurrency:'NOT RUN'}));
 assert.equal(f.syntheticClock,false);assert.equal(f.clockReplacements,0);
 assert.equal(f.originalPublisherSha256,ORIGINAL_PUBLISHER_SHA256);
 const ticket=await f.begin();assert.equal(ticket.ok,true);assert.equal(ticket.phase,'pending');
 const result=await f.complete(ticket,{completedAt:new Date().toISOString()});
 refusedResult(result,1);
 assert.equal((await f.snapshot()).receipts.length,1);
},{syntheticClock:false}));

test('refusal/refusal/completed-unverified/refusal restarts at one and preserves definitive evidence through unverified',()=>fixtureRun(async f=>{
 await seedTwo(f);const before=await f.snapshot();
 const {result:unverified}=await observe(f,[unknown()],MINUTE);
 assert.equal(unverified.ok,true);assert.equal(unverified.validity,'unverified');
 assert.equal(unverified.health_published,false);assert.equal(unverified.consecutive_failures,0);
 const after=await f.snapshot();assert.deepEqual(preserved(after),preserved(before));
 assert.equal(after.receipts.length,3);assert.equal(after.state.length,1);
 assert.equal(unverified.checked_at,null);assert.equal(time(unverified.completed_at),f.now);
 const receipt=after.receipts.find(row=>row.attempt_id===unverified.attempt_id);
 assert.equal(time(receipt.valid_observed_at),f.now);assert.equal(time(receipt.reported_completed_at),f.now);
 assert.equal(time(after.state[0].observed_at),f.now);assert.equal(time(after.state[0].last_definitive_at),time(before.health.checked_at));
 const {result}=await observe(f,[refused()],MINUTE);refusedResult(result,1);
 const final=await f.snapshot();assert.equal(time(final.health.first_failed_at),f.now);
 assert.equal(final.health.confirmed_outage,false);assert.equal(final.receipts.length,4);
}));

test('normal 0/15/30-minute refusals reach the capped third count',()=>fixtureRun(async f=>{
 const first=f.now;
 for(const count of [1,2,3,3]) {
  const {result}=await observe(f,[refused()],count===1?0:15*MINUTE);refusedResult(result,count);
  assert.equal(time((await f.snapshot()).health.first_failed_at),first);
 }
 assert.equal((await f.snapshot()).health.confirmed_outage,true);
}));

test('exact 20-minute adjacent gaps continue while 20 minutes plus one millisecond restart',async()=>{
 for(const gap of [20*MINUTE,20*MINUTE+1])await fixtureRun(async f=>{
  await seedTwo(f);const {result}=await observe(f,[refused()],gap);
  refusedResult(result,gap===20*MINUTE?3:1);
  if(gap>20*MINUTE)assert.equal(time((await f.snapshot()).health.first_failed_at),f.now);
 });
});

test('a skipped quarter-hour poll restarts but a continuous first failure older than 35 minutes remains',async()=>{
 await fixtureRun(async f=>{await seedTwo(f);refusedResult((await observe(f,[refused()],30*MINUTE)).result,1);assert.equal(time((await f.snapshot()).health.first_failed_at),f.now);});
 await fixtureRun(async f=>{
  const first=f.now;
  for(let index=0;index<4;index++)refusedResult((await observe(f,[refused()],index?15*MINUTE:0)).result,Math.min(3,index+1));
  const health=(await f.snapshot()).health;assert.equal(time(health.first_failed_at),first);assert.ok(f.now-first>35*MINUTE);
 });
});

test('legacy unclassified health counts never seed the private attempt sequence',()=>fixtureRun(async f=>{
 await f.pg.query("insert into camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,checked_at,consecutive_failures,confirmed_outage,first_failed_at) values(1,'offline',false,$1::jsonb,$2::timestamptz,3,true,$3::timestamptz)",[
  {'443':{online:false},_connection:{revision:'0',ip:'8.8.4.1',checkedAt:new Date(f.now-MINUTE).toISOString(),status:'offline',reachable:false,consecutiveFailures:3}},
  new Date(f.now-MINUTE).toISOString(),new Date(f.now-24*60*MINUTE).toISOString()
 ]);
 refusedResult((await observe(f)).result,1);assert.equal(time((await f.snapshot()).health.first_failed_at),f.now);
}));

test('equal distinct observation times publish a fresh count one at the same actual time; older times cannot publish',()=>fixtureRun(async f=>{
 await seedTwo(f);const equalTime=f.now;
 const equal=await observe(f);refusedResult(equal.result,1);
 const first=await f.snapshot();assert.equal(time(first.health.checked_at),equalTime);assert.equal(time(first.health.first_failed_at),equalTime);
 await f.advance(MINUTE);const ticket=await f.begin();
 const older=await f.complete(ticket,{completedAt:new Date(f.now-2*MINUTE).toISOString()});
 assert.equal(older.validity,'unverified');assert.equal(older.health_published,false);
 assert.deepEqual(preserved(await f.snapshot()),preserved(first));
 refusedResult((await observe(f,[refused()],MINUTE)).result,1);
}));

test('scheduled and manual registrations share one adjacent refusal sequence',()=>fixtureRun(async f=>{
 const first=await f.begin({argsOverride:{p_source:'automatic_tcp_sweep'}});refusedResult(await f.complete(first),1);
 await f.advance(15*MINUTE);const manual=await f.begin({argsOverride:{p_source:'manual_tcp_check'}});refusedResult(await f.complete(manual),2);
 await f.advance(15*MINUTE);const third=await f.begin({argsOverride:{p_source:'automatic_tcp_sweep'}});refusedResult(await f.complete(third),3);
 const final=await f.snapshot();assert.equal(final.receipts.length,3);assert.equal(final.health.confirmed_outage,true);
}));

test('future, missing and malformed observation times finalize barriers without inventing a socket time',async()=>{
 for(const makeTime of [f=>new Date(f.now+1).toISOString(),()=>null,()=>undefined,()=>'',()=> 'invalid timestamp',()=> '2026-10-14T12:00:00+99:99',()=> '2026-10-14T24:00:00Z',()=> '2026-10-14T12:00:60Z'])await fixtureRun(async f=>{
  await seedTwo(f);const before=await f.snapshot();await f.advance(MINUTE);
  const ticket=await f.begin(),completedAt=makeTime(f);
  const result=await f.complete(ticket,{completedAt,payloadOverride:{result:{completed_at:completedAt,ports:[refused()]}}});
  assert.equal(result.validity,'unverified');assert.equal(result.health_published,false);
  const after=await f.snapshot();assert.deepEqual(preserved(after),preserved(before));
  assert.equal(result.completed_at,null);assert.equal(result.checked_at,null);assert.equal(after.state[0].observed_at,null);
  assert.equal(after.receipts.find(row=>row.attempt_id===ticket.attempt_id).valid_observed_at,null);
  refusedResult((await observe(f,[refused()],MINUTE)).result,1);
 });
});

test('duplicate begin and completion reuse the immutable receipt without extra state/history/count changes',()=>fixtureRun(async f=>{
 const id=attemptId(700),a=await f.begin({id}),before=await f.snapshot();
 const b=await f.begin({id});assert.equal(b.sequence,a.sequence);assert.equal(b.registered_at,a.registered_at);
 assert.deepEqual(await f.snapshot(),before);
 const first=await f.complete(a),applied=await f.snapshot();refusedResult(first,1);
 const replay=await f.complete(a);assert.deepEqual(replay,first);assert.deepEqual(await f.snapshot(),applied);
 const read=await f.read(a);assert.deepEqual(read,first);assert.deepEqual(await f.snapshot(),applied);
}));

test('conflicting ID binding, sequence or frozen completion payload cannot alter an applied result',()=>fixtureRun(async f=>{
 const id=attemptId(701),ticket=await f.begin({id}),bound=await f.binding();
 const beginConflict=await f.begin({id,bindingOverride:{...bound,organization:'Different site'}});
 assert.equal(beginConflict.ok,false);assert.equal(beginConflict.reason,'attempt_conflict');
 refusedResult(await f.complete(ticket),1);const applied=await f.snapshot();
 const wrongSequence=await f.complete(ticket,{payloadOverride:{sequence:String(BigInt(ticket.sequence)+1n)}});
 assert.equal(wrongSequence.ok,false);assert.equal(wrongSequence.reason,'attempt_conflict');
 const payloadConflict=await f.complete(ticket,{ports:[connected()]});
 assert.equal(payloadConflict.ok,false);assert.equal(payloadConflict.reason,'attempt_conflict');
 assert.deepEqual(await f.snapshot(),applied);
}));

test('a newer unverified completion supersedes a delayed older refusal without changing definitive health',()=>fixtureRun(async f=>{
 await seedTwo(f);const before=await f.snapshot();await f.advance(MINUTE);
 const old=await f.begin();await f.advance(1);const newer=await f.begin();
 const pending=await f.snapshot(),oldTime=new Date(f.now-1).toISOString();
 const whilePending=await f.complete(old,{completedAt:oldTime});assert.equal(whilePending.reason,'superseded');assert.equal(whilePending.is_current,false);
 const afterPending=await f.snapshot();assert.deepEqual(afterPending.state,pending.state);assert.deepEqual(preserved(afterPending),preserved(before));
 const replayBegin=await f.begin({id:old.attempt_id});assert.equal(replayBegin.sequence,old.sequence);assert.equal(replayBegin.is_current,false);
 assert.deepEqual(await f.snapshot(),afterPending);
 const u=await f.complete(newer,{ports:[unknown()]});assert.equal(u.validity,'unverified');
 const afterNew=await f.snapshot();assert.deepEqual(preserved(afterNew),preserved(before));
 const late=await f.complete(old,{completedAt:new Date(f.now-1).toISOString()});
 assert.equal(late.reason,'superseded');assert.equal(late.health_published,false);assert.equal(late.is_current,false);
 const afterOld=await f.snapshot();assert.deepEqual(preserved(afterOld),preserved(before));assert.deepEqual(afterOld.state,afterNew.state);
 assert.deepEqual(await f.read(old),late);
 assert.deepEqual(await f.complete(old,{completedAt:new Date(f.now-1).toISOString()}),late);
 const conflict=await f.complete(old,{completedAt:new Date(f.now-1).toISOString(),ports:[connected()]});
 assert.equal(conflict.ok,false);assert.equal(conflict.reason,'attempt_conflict');assert.deepEqual(await f.snapshot(),afterOld);
 refusedResult((await observe(f,[refused()],MINUTE)).result,1);
}));

test('an abandoned pending attempt breaks continuity when superseded by the next registered refusal',()=>fixtureRun(async f=>{
 await seedTwo(f);await f.advance(MINUTE);const pending=await f.begin();
 refusedResult((await observe(f,[refused()],MINUTE)).result,1);
 const after=await f.snapshot(),late=await f.complete(pending);
 assert.equal(late.reason,'superseded');assert.equal(late.health_published,false);
 assert.deepEqual(preserved(await f.snapshot()),preserved(after));
}));

test('expired registration cannot publish or reuse the older refusal seed',()=>fixtureRun(async f=>{
 await seedTwo(f);await f.advance(MINUTE);const ticket=await f.begin(),before=await f.snapshot();
 await f.setNow(time(ticket.expires_at)+1);
 const expired=await f.complete(ticket);assert.equal(expired.validity,'unverified');assert.equal(expired.health_published,false);
 assert.deepEqual(preserved(await f.snapshot()),preserved(before));
 refusedResult((await observe(f,[refused()],MINUTE)).result,1);
}));

test('expired duplicate begin and read cannot renew the pending ticket or authorize transport',()=>fixtureRun(async f=>{
 const id=attemptId(800),ticket=await f.begin({id}),before=await f.snapshot();
 await f.setNow(time(ticket.expires_at)+1);
 const repeated=await f.begin({id}),read=await f.read(ticket);
 assert.equal(repeated.sequence,ticket.sequence);assert.equal(repeated.expires_at,ticket.expires_at);
 assert.equal(repeated.is_current,false);assert.equal(read.is_current,false);
 assert.deepEqual(await f.snapshot(),before);
}));

test('endpoint, configured-array order, source and lifecycle edits invalidate old tickets without stale writes',async()=>{
 const mutations=[
  "update camera_devices set public_ip='8.8.4.9' where id=1",
  "update camera_devices set expected_ports='{443,80}' where id=1",
  "update camera_devices set source='manual' where id=1",
  "update camera_devices set unit_key='SNIPER 999' where id=1",
  "update camera_devices set device_name='Sniper 001 changed' where id=1",
  "update camera_devices set organization='Different site' where id=1",
  "update camera_devices set activation_state='decommissioned' where id=1",
  "update camera_devices set monitoring_enabled=false where id=1"
 ];
 for(const mutation of mutations)await fixtureRun(async f=>{
  const ticket=await f.begin();await f.pg.exec(mutation);const changed=await f.snapshot();
  const result=await f.complete(ticket,{ports:[refused(80),refused(443)]});
  assert.equal(result.health_published,false,mutation);assert.equal(result.validity,'unverified',mutation);
  assert.deepEqual(preserved(await f.snapshot()),preserved(changed),mutation);
 },{ports:[80,443]});
});

test('existing endpoint revision defeats IP and profile change-and-restore ABA',async()=>{
 for(const edit of ["public_ip='8.8.4.9'","monitoring_profile='helios'"])await fixtureRun(async f=>{
  const ticket=await f.begin(),original=await f.device();
  await f.pg.exec('update camera_devices set '+edit+' where id=1');
  await f.pg.query('update camera_devices set public_ip=$1::inet,monitoring_profile=$2 where id=1',[original.public_ip,original.monitoring_profile]);
  assert.notEqual((await f.device()).connection_revision,original.connection_revision);
  const changed=await f.snapshot(),result=await f.complete(ticket);
  assert.equal(result.health_published,false);assert.equal(result.validity,'unverified');
  assert.deepEqual(preserved(await f.snapshot()),preserved(changed));
 });
});

test('profile leave preserves unrelated legacy behavior while direct reentry retains the attempt requirement',()=>fixtureRun(async f=>{
 const ticket=await f.begin();await f.pg.exec("update camera_devices set monitoring_profile='helios' where id=1");
 const before=await f.snapshot(),read=await f.read(ticket);assert.equal(read.health_published,false);assert.equal(read.is_current,false);
 assert.deepEqual(await f.snapshot(),before);
 const payload={checked_at:new Date(f.now).toISOString(),port_status:{443:{online:true}},overall_status:'online',ip_reachable:true,consecutive_failures:0,confirmed_outage:false};
 const unrelated=await f.rpc({...await f.baseArgs(),p_health:payload});assert.equal(unrelated.ok,true);
 const outside=await f.snapshot();assert.equal(outside.health.overall_status,'unknown');assert.equal(outside.health.consecutive_failures,0);
 assert.deepEqual(outside.state,before.state);assert.deepEqual(outside.receipts,before.receipts);
 await f.pg.exec("update camera_devices set monitoring_profile='sniper' where id=1");const reentry=await f.snapshot();
 const legacy=await f.rpc({...await f.baseArgs(),p_health:payload});assert.equal(legacy.ok,false);assert.equal(legacy.reason,'direct_attempt_required');
 assert.deepEqual(await f.snapshot(),reentry);
}));

test('uppercase direct-profile spelling cannot bypass the legacy direct rejection',()=>fixtureRun(async f=>{
 await f.begin();await f.pg.exec("update camera_devices set monitoring_profile='SNIPER' where id=1");
 const before=await f.snapshot(),legacy=await f.rpc({...await f.baseArgs(),p_health:{checked_at:new Date(f.now).toISOString(),port_status:{443:{online:true}},overall_status:'online',ip_reachable:true,consecutive_failures:0}});
 assert.equal(legacy.ok,false);assert.equal(legacy.reason,'direct_attempt_required');assert.deepEqual(await f.snapshot(),before);
}));

test('an invalid supplied full-family master snapshot cannot admit a direct attempt',async()=>{
 for(const patch of [{tracker_state:'retired'},{source_label:'Sniper 999'},{canonical_family:'Sniper 2'}])await fixtureRun(async f=>{
  const bound=await f.binding(),before=await f.snapshot();
  const result=await f.begin({bindingOverride:{...bound,master:{...bound.master,...patch}}});
  assert.equal(result.ok,false);assert.deepEqual(await f.snapshot(),before);
 });
});

test('invalid saved public endpoints and empty, duplicate or invalid configured ports never admit attempts',async()=>{
 for(const ports of [[],[443,443],[0],[65536]])await fixtureRun(async f=>{
  const before=await f.snapshot(),result=await f.begin();assert.equal(result.ok,false);assert.deepEqual(await f.snapshot(),before);
 },{ports});
 for(const ip of [null,'10.0.0.1','127.0.0.1','169.254.169.254'])await fixtureRun(async f=>{
  await f.pg.query('update camera_devices set public_ip=$1::inet where id=1',[ip]);
  const before=await f.snapshot(),result=await f.begin();assert.equal(result.ok,false);assert.deepEqual(await f.snapshot(),before);
 });
});

test('missing, extra, duplicate and malformed result ports are durable unverified barriers',async()=>{
 const invalid=[[],[refused(80)],[refused(80),refused(443),refused(8443)],
  [refused(80),refused(80),refused(443)],[refused('80'),refused(443)],
  [refused(80.5),refused(443)],[refused(0),refused(443)],[refused(65536),refused(443)],
  [refused(80),{...refused(443),state:'false'}],null,{'80':refused(80),'443':refused(443)}];
 await fixtureRun(async f=>{
  for(const ports of invalid) {
   const valid=[refused(80),refused(443)];await seedTwo(f,valid);const before=await f.snapshot();
   await f.advance(MINUTE);const ticket=await f.begin(),result=await f.complete(ticket,{ports});
   assert.equal(result.validity,'unverified',JSON.stringify(ports));assert.equal(result.health_published,false);
   assert.deepEqual(preserved(await f.snapshot()),preserved(before));
   await f.advance(MINUTE);
  }
 },{ports:[80,443]});
});

test('one configured-port success with explicit unknown siblings publishes success and resets the streak',()=>fixtureRun(async f=>{
 const failures=[refused(80),refused(443)];await seedTwo(f,failures);await f.advance(MINUTE);
 const success=(await observe(f,[connected(443),unknown(80,'not_attempted')])).result;
 assert.equal(success.validity,'connected');assert.equal(success.status,'online');assert.equal(success.consecutive_failures,0);assert.equal(success.health_published,true);
 const health=(await f.snapshot()).health;assert.equal(health.first_failed_at,null);assert.equal(health.confirmed_outage,false);
 assert.deepEqual(Object.keys(health.port_status).filter(key=>key!=='_connection').sort(),['443','80']);
 refusedResult((await observe(f,failures,MINUTE)).result,1);
},{ports:[80,443]}));

test('partial all-failed manual results and explicit timeout/abort/route/collector unknown states break continuity',()=>fixtureRun(async f=>{
 for(const reason of ['not_attempted','probe_unverified']) {
  const ports=[refused(80),refused(443)];await seedTwo(f,ports);const before=await f.snapshot();
  const result=(await observe(f,[refused(80),unknown(443,reason)],MINUTE)).result;
  assert.equal(result.validity,'unverified');assert.equal(result.health_published,false);
  assert.deepEqual(preserved(await f.snapshot()),preserved(before));await f.advance(MINUTE);
 }
},{ports:[80,443]}));

test('unverified preserves acknowledgements; a fresh refused streak clears old acknowledgement without recovery',()=>fixtureRun(async f=>{
 await seedTwo(f);await f.pg.query('update camera_health_current set acknowledged_at=$1::timestamptz,acknowledged_by=$2::uuid where camera_device_id=1',[new Date(f.now).toISOString(),attemptId(999)]);
 const before=await f.snapshot();await observe(f,[unknown()],MINUTE);assert.deepEqual(preserved(await f.snapshot()),preserved(before));
 refusedResult((await observe(f,[refused()],MINUTE)).result,1);
 const after=(await f.snapshot()).health;assert.equal(after.acknowledged_at,null);assert.equal(after.acknowledged_by,null);assert.equal(after.last_recovered_at,before.health.last_recovered_at);
}));

test('a continuous acknowledged outage retains its acknowledgement until genuine connection recovery',()=>fixtureRun(async f=>{
 await seedTwo(f);const acknowledgedAt=new Date(f.now).toISOString();
 await f.pg.query('update camera_health_current set acknowledged_at=$1::timestamptz,acknowledged_by=$2::uuid where camera_device_id=1',[acknowledgedAt,attemptId(998)]);
 refusedResult((await observe(f,[refused()],MINUTE)).result,3);
 assert.equal(time((await f.snapshot()).health.acknowledged_at),time(acknowledgedAt));
 const success=(await observe(f,[connected()],MINUTE)).result;assert.equal(success.status,'online');
 const health=(await f.snapshot()).health;assert.equal(health.acknowledged_at,null);assert.equal(health.acknowledged_by,null);assert.equal(time(health.last_recovered_at),f.now);
}));

test('legacy direct publication is rejected while unrelated-profile legacy semantics are preserved',()=>fixtureRun(async f=>{
 const args=await f.baseArgs(),before=await f.snapshot();
 const payload={checked_at:new Date(f.now).toISOString(),port_status:{443:{online:false,latency_ms:null,error:'Connection refused'}},overall_status:'offline',ip_reachable:false,consecutive_failures:3,confirmed_outage:true,detail:'Synthetic legacy observation'};
 const legacy=await f.rpc({...args,p_health:payload});assert.equal(legacy.ok,false);assert.equal(legacy.reason,'direct_attempt_required');assert.deepEqual(await f.snapshot(),before);
 await f.pg.exec("insert into camera_devices(id,unit_key,source,public_ip,expected_ports,monitoring_profile,monitoring_enabled,source_status,organization,activation_state) values(20,'Synthetic unrelated','other_provider','8.8.4.20','{443}','helios',true,'online','Synthetic site','active')");
 const unrelated=await f.rpc({...args,p_device_id:20,p_public_ip:'8.8.4.20',p_revision:0,p_expected_ports:[443],p_monitoring_profile:'helios',p_health:payload});
 assert.equal(unrelated.ok,true);
 const rows=await f.pg.query('select to_jsonb(h) as row from camera_health_current h where camera_device_id=20'),health=rows.rows[0].row;
 assert.equal(health.overall_status,'online');assert.equal(health.consecutive_failures,0);assert.equal(health.confirmed_outage,false);
 assert.deepEqual((await f.snapshot()).state,before.state);assert.deepEqual((await f.snapshot()).receipts,before.receipts);
}));
