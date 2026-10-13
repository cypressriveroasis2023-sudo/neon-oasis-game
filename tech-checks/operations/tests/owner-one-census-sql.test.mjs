import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,seed,ORG,OWNER} from './fixtures/geocodio-database-fixture.mjs';
let db;
const sql=async path=>readFile(new URL(path,import.meta.url),'utf8');
const acl=async()=> (await db.query("select p.oid::regprocedure::text identity,p.proacl::text acl,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1")).rows;
const call=async(name,args={})=>{
 await db.exec('set role service_role');
 try{return(await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}
 finally{await db.exec('reset role');}
};
const claim=(key,bounded=false)=>call('cos_field_geocode_claim',{...key,p_audit_id:(bounded?'owner_one_census_v1:':'')+key.p_audit_id});
const due=(key)=>call('cos_field_geocode_list_due',{p_organization_id:ORG,...(key?{p_audit_id:key.p_audit_id,p_unit_key:key.p_unit_key}:{})});
const fallbackDue=(key)=>call('cos_field_geocode_fallback_list_due',{p_organization_id:ORG,...(key?{p_audit_id:key.p_audit_id,p_unit_key:key.p_unit_key}:{})});
const reserve=key=>call('cos_field_geocode_fallback_reserve',{...key,p_request_id:randomUUID()});
const finish=(key,token,status='no_match')=>call('cos_field_geocode_finish',{...key,p_claim_token:token,p_status:status,p_latitude:status==='success'?29:null,p_longitude:status==='success'?-95:null,p_matched_address:status==='success'?key.p_address:null,p_reason:status==='provider_error'?'provider_timeout':null});
const policy=async()=> (await db.query('select owner_one_census_v1 value from app_private.cos_geocodio_account_state')).rows[0].value;
async function enroll(key,overrides={},mature=true){
 const c=(await db.query('select to_jsonb(c) data from app_private.cos_field_geocode_cache c where audit_id=$1',[key.p_audit_id])).rows[0].data;
 const a=(await db.query("select to_jsonb(a) data,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') sha from camera_inventory_audit a where id=$1",[Number(key.p_audit_id)])).rows[0];
 const p={policyVersion:'owner_one_census_v1',binding:{organizationId:ORG,auditId:key.p_audit_id,unitKey:key.p_unit_key,address:key.p_address,addressSha256:key.p_address_sha256,nativeUnitId:randomUUID(),nativeGuardSha256:'a'.repeat(64),nativeSourceSha256:'b'.repeat(64),auditSha256:a.sha,deviceIds:a.data.device_ids},approvalReference:'synthetic-approval',enrolledAt:new Date().toISOString(),censusBefore:c,claimToken:null,consumedAt:null,...overrides};
 await db.exec('begin;set local role service_role');
 try{
  assert.equal((await db.query('select app_private.cos_geocode_lock_current($1,$2,$3) valid',[key.p_audit_id,key.p_unit_key,key.p_address])).rows[0].valid,true);
  await db.query('select 1 from app_private.cos_field_geocode_cache where organization_id=$1 and audit_id=$2 for update',[ORG,key.p_audit_id]);
  await db.exec('select 1 from app_private.cos_geocodio_account_state where singleton for update');
  await db.query('update app_private.cos_geocodio_account_state set owner_one_census_v1=$1 where singleton and owner_one_census_v1 is null',[p]);
  await db.exec('commit');
 }catch(e){await db.exec('rollback');throw e;}finally{await db.exec('reset role');}
 // Test-only clock aging; production trigger never allows backdating/rearming.
 if(mature)await db.exec(`alter table app_private.cos_geocodio_account_state disable trigger cos_diagnostic_recovery_immutable;
 update app_private.cos_geocodio_account_state set owner_one_census_v1=jsonb_set(owner_one_census_v1,'{enrolledAt}',to_jsonb(clock_timestamp()-interval '481 seconds'));
 alter table app_private.cos_geocodio_account_state enable trigger cos_diagnostic_recovery_immutable;`);
 return p;
}
async function preparation(key,overrides={}){
 const c=(await db.query('select to_jsonb(c) data from app_private.cos_field_geocode_cache c where audit_id=$1',[key.p_audit_id])).rows[0].data;
 const a=(await db.query("select to_jsonb(a) data,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') sha from camera_inventory_audit a where id=$1",[Number(key.p_audit_id)])).rows[0];
 const marker={policyVersion:'owner_census_preparation_v1',binding:{organizationId:ORG,auditId:key.p_audit_id,unitKey:key.p_unit_key,addressSha256:key.p_address_sha256,nativeUnitId:randomUUID(),authorizingLegacyOwnerId:OWNER},auditSha256:a.sha,deviceIds:a.data.device_ids,censusBefore:c,approvalReference:'synthetic-prepare',preparedAt:'1900-01-01T00:00:00Z',...overrides};
 await db.exec('begin;set local role service_role');try{
  await db.query('select app_private.cos_geocode_lock_current($1,$2,$3)',[key.p_audit_id,key.p_unit_key,key.p_address]);
  await db.query('select 1 from app_private.cos_field_geocode_cache where audit_id=$1 for update',[key.p_audit_id]);
  await db.exec('select 1 from app_private.cos_geocodio_account_state where singleton for update');
  await db.query('update app_private.cos_geocodio_account_state set owner_census_preparation_v1=$1',[marker]);await db.exec('commit');
 }catch(e){await db.exec('rollback');throw e;}finally{await db.exec('reset role');}
 return marker;
}
async function reset(){
 // Test-only owner reset removes the guard trigger while clearing synthetic fixtures.
 await db.exec(`alter table app_private.cos_geocodio_account_state disable trigger cos_diagnostic_recovery_immutable;
 update app_private.cos_geocodio_account_state set owner_one_census_v1=null,owner_census_preparation_v1=null;
 alter table app_private.cos_geocodio_account_state enable trigger cos_diagnostic_recovery_immutable;
 truncate app_private.cos_field_geocode_cache,public.camera_inventory_audit,public.camera_devices,app_private.cos_field_geocode_fallback_cache,app_private.cos_geocodio_reservations,app_private.cos_geocodio_daily_budget;
 update app_private.cos_geocodio_control set enabled=true,free_only=true;`);
}
before(async()=>{
 db=await fixture({imported:true});
 await db.exec("insert into profiles(user_id,role,active) values('"+OWNER+"','owner',true)");
 for(const f of ['geocodio-tracker-source-v2.sql','source-precedence-contract.sql','geocodio-source-precedence.sql','geocodio-diagnostic-recovery-v1.sql'])await db.exec(await sql('../db/'+f));
 await db.exec(await sql('./fixtures/owner-census-baseline.sql'));
 // Model existing deployed service-only Owner RPC privileges before applying the patch.
 await db.exec(`revoke all on function public.cos_field_geocode_claim(uuid,text,text,text,text),public.cos_field_geocode_finish(uuid,text,text,text,text,uuid,text,double precision,double precision,text,text),public.cos_field_geocode_list_due(uuid,integer,text,text) from public,anon,authenticated;
 grant execute on function public.cos_field_geocode_claim(uuid,text,text,text,text),public.cos_field_geocode_finish(uuid,text,text,text,text,uuid,text,double precision,double precision,text,text),public.cos_field_geocode_list_due(uuid,integer,text,text) to service_role;`);
 await db.exec(`revoke all on function public.cos_field_geocode_read_many(uuid,text[]) from public,anon; grant execute on function public.cos_field_geocode_read_many(uuid,text[]) to authenticated,service_role;`);
 await db.exec('grant select on public.profiles to service_role'); // Model live existing table SELECT, verified read-only.
 const before=await acl();await db.exec(await sql('../db/owner-one-census-v1.sql'));assert.deepEqual(await acl(),before);
 await db.exec(await sql('../db/owner-one-census-v1.sql'));assert.deepEqual(await acl(),before);
});
after(async()=>db?.close());
test('enrollment preserves exact terminal cache and current audit; prefix alone grants nothing',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});const before=(await db.query('select to_jsonb(c) value from app_private.cos_field_geocode_cache c')).rows;
 assert.equal((await claim(key,true)).claimed,false);await enroll(key);
 assert.deepEqual((await db.query('select to_jsonb(c) value from app_private.cos_field_geocode_cache c')).rows,before);
 assert.deepEqual(await due(),[]);assert.equal((await due(key))[0].censusOnly,true);
 assert.equal((await claim(key)).claimed,false);assert.equal((await policy()).claimToken,null);
 const c=await claim(key,true);assert.equal(c.claimed,true);assert.equal(c.record.attempts,2);assert.equal(Date.parse(c.record.leaseUntil)-Date.parse(c.record.updatedAt),120000);assert.equal(c.censusOnly,true);assert.equal((await policy()).claimToken,c.claimToken);
 assert.equal((await claim(key,true)).claimed,false);assert.equal((await claim(key)).claimed,false);
});
test('no-match, timeout, successful estimate, crash and lease expiry never release allowance or Geocodio',async()=>{
 for(const status of ['no_match','provider_error','success','crash']){
  await reset();const key=await seed(db,{status:'invalid_address'});await enroll(key);const beforeAudit=(await db.query('select to_jsonb(a) value from camera_inventory_audit a')).rows;
  const c=await claim(key,true);
  if(status!=='crash')assert.equal((await finish(key,c.claimToken,status)).accepted,true);
  else await db.exec("update app_private.cos_field_geocode_cache set lease_until=clock_timestamp()-interval '1 day'");
  assert.equal((await claim(key,true)).claimed,false,status);assert.equal((await claim(key)).claimed,false,status);assert.deepEqual(await due(),[],status);
  assert.equal((await due(key))[0].censusOnlyState,'consumed',status);assert.deepEqual(await fallbackDue(),[],status);assert.deepEqual(await fallbackDue(key),[],status);assert.equal((await reserve(key)).reserved,false,status);
  assert.equal(Number((await db.query('select count(*) n from app_private.cos_geocodio_reservations')).rows[0].n),0,status);
  assert.deepEqual((await db.query('select to_jsonb(a) value from camera_inventory_audit a')).rows,beforeAudit,status);
  assert.equal((await policy()).censusBefore.attempts,1,status);
 }
});
test('allowance evidence is immutable; unchanged claim token finish is idempotent',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});const p=await enroll(key);const c=await claim(key,true);
 for(const value of [null,p,{...await policy(),approvalReference:'changed'}, {...await policy(),binding:{...p.binding,nativeSourceSha256:'c'.repeat(64)}}, {...await policy(),binding:{...p.binding,nativeSourceSha256:null}}]){
  await db.exec('set role service_role');await assert.rejects(db.query('update app_private.cos_geocodio_account_state set owner_one_census_v1=$1',[value]),/Invalid Owner|immutable/);await db.exec('reset role');
 }
 assert.equal((await finish(key,c.claimToken)).accepted,true);assert.equal((await finish(key,c.claimToken)).accepted,true);assert.equal((await finish(key,randomUUID())).accepted,false);
});
test('audit edits, new audit, or roster drift reject claims/finish and leave hold intact',async()=>{
 for(const drift of ['audit','roster','new']){
  await reset();const key=await seed(db,{status:'invalid_address'});await enroll(key);const c=await claim(key,true);
  if(drift==='audit')await db.exec("update camera_inventory_audit set after_state=after_state||'{\"note\":\"changed\"}'");
  else if(drift==='roster')await db.exec("insert into camera_devices(id,unit_key) values(999,'Unit-1')");
  else await db.exec("insert into camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) select 2,actor_id,action,unit_key,device_ids,after_state from camera_inventory_audit where id=1");
  assert.equal((await finish(key,c.claimToken,'success')).accepted,false);assert.equal((await claim(key,true)).claimed,false);assert.equal((await policy()).claimToken,c.claimToken);
 }
});
test('shared address enrollment fails; later shared Owner job cannot bypass hold',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});await seed(db,{id:2,address:key.p_address});await assert.rejects(enroll(key),/overlaps shared/);assert.equal(await policy(),null);
 await reset();const target=await seed(db,{status:'invalid_address'});await enroll(target);const shared=await seed(db,{id:2,address:target.p_address});
 assert.equal((await claim(shared)).claimed,false);assert.equal((await claim(shared,true)).claimed,false);assert.equal((await reserve(shared)).reason,'owner_one_census_hold');assert.deepEqual(await fallbackDue(shared),[]);assert.deepEqual(await due(shared),[]);
});
test('existing ordinary job behavior and access boundaries remain unchanged',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});await enroll(key);const unrelated=await seed(db,{id:2,address:'2 main st, houston, tx 77002'});
 assert.equal((await reserve(unrelated)).reserved,true);assert.equal((await claim(unrelated)).claimed,false);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(db.query('select public.cos_field_geocode_list_due($1)',[ORG]),/permission denied/);await db.exec('reset role');
 }
});

test('exact pre-guard handler cannot consume enrollment or reach either provider during rollout',async()=>{
 const {createGeocodeHandler}=await import('./owner-one-census-legacy-worker.mjs');
 for(const consumed of [false,true]){
  await reset();const key=await seed(db,{status:'invalid_address'});await enroll(key);
  if(consumed){const c=await claim(key,true);await finish(key,c.claimToken);}
  const before=await policy(),rpcNames=[];let network=0;
  const handler=createGeocodeHandler({verifyFleetActor:async()=>true,geocodioApiKey:'synthetic-key',rpc:async(name,args)=>{rpcNames.push([name,args]);return call(name,args);},fetch:async()=>{network++;throw Error('No provider request permitted');}});
  const response=await handler(new Request('https://example.test/geocode',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({auditId:key.p_audit_id,unitKey:key.p_unit_key})}));
  assert.equal(response.status,200);assert.equal(network,0);assert.deepEqual(await policy(),before);
  assert.equal(rpcNames.find(([name])=>name==='cos_field_geocode_claim')[1].p_audit_id,key.p_audit_id);
  assert.ok(rpcNames.some(([name])=>name==='cos_field_geocode_fallback_list_due'));
 }
});

test('new guarded HTTP handler and real SQL compose to one request, truthful attempts, and no fallback',async()=>{
 const {createGeocodeHandler}=await import('../../supabase/functions/camera-field-geocode/index.ts');
 for(const outcome of ['success','no_match','timeout','native_drift','native_pre_send']){
  await reset();const key=await seed(db,{address:'10 main st, ste 210, houston, tx 77002-1234',status:'invalid_address'});await enroll(key);
  const original=(await db.query('select to_jsonb(a) value from camera_inventory_audit a')).rows;let requests=0,verifications=0;
  const handler=createGeocodeHandler({verifyFleetActor:async()=>true,verifyOwnerCensusSource:async()=>{verifications++;return !(outcome==='native_drift'&&verifications>2||outcome==='native_pre_send'&&verifications>1);},rpc:call,fetch:async(url,init)=>{
   requests++;assert.equal(new URL(url).hostname,'geocoding.geo.census.gov');assert.equal(new URL(url).searchParams.get('zip'),'77002-1234');assert.equal(new URL(url).searchParams.get('street'),'10 main st');assert.equal(init.redirect,'error');
   if(outcome==='timeout')throw new DOMException('Timed out','TimeoutError');
   return new Response(JSON.stringify({result:{addressMatches:outcome==='no_match'?[]:[{matchedAddress:'10 MAIN ST, HOUSTON, TX 77002-1234',coordinates:{x:-95,y:29}}]}}));
  }});
  const request=()=>new Request('https://example.test/geocode',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({auditId:key.p_audit_id,unitKey:key.p_unit_key})});
  const response=await handler(request()),result=await response.json();assert.equal(response.status,200,outcome);assert.equal(result.censusOnly,true,outcome);assert.equal(requests,outcome==='native_pre_send'?0:1,outcome);
  assert.equal((await policy()).claimToken!==null,true);assert.equal((await db.query('select attempts from app_private.cos_field_geocode_cache')).rows[0].attempts,2);
  const repeat=await handler(request());assert.equal(repeat.status,200);assert.equal(requests,outcome==='native_pre_send'?0:1);assert.equal((await repeat.json()).allowance,'consumed');
  assert.equal((await reserve(key)).reserved,false);assert.deepEqual((await db.query('select to_jsonb(a) value from camera_inventory_audit a')).rows,original);
  assert.equal(Number((await db.query('select count(*) n from app_private.cos_geocodio_reservations')).rows[0].n),0);
 }
});

test('existing authorized read exposes only exact ready/consumed policy metadata and denies stale bindings',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});await enroll(key);
 const read=()=>call('cos_field_geocode_read_many',{p_organization_id:ORG,p_audit_ids:[key.p_audit_id]});
 let rows=await read();assert.equal(rows[0].censusOnlyState,'ready');assert.equal(rows[0].censusOnlySourceSha256,'b'.repeat(64));assert.deepEqual(Object.keys(rows[0].censusOnlyGuard).sort(),['nativeGuardSha256','nativeUnitId']);
 for(const forbidden of ['approvalReference','censusBefore','claimToken','consumedAt','deviceIds'])assert.equal(forbidden in rows[0],false);
 await claim(key,true);rows=await read();assert.equal(rows[0].censusOnlyState,'consumed');
 await db.exec("update camera_inventory_audit set after_state=after_state||'{\"note\":\"changed\"}'");rows=await read();assert.deepEqual(rows,[]);
 await db.query("select set_config('test.actor',$1,false)",[OWNER]);await db.exec('set role authenticated');
 assert.equal((await db.query('select public.cos_field_geocode_read_many($1,$2) result',[ORG,[key.p_audit_id]])).rows[0].result.length,0);
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[randomUUID()]);await db.exec('set role authenticated');
 await assert.rejects(db.query('select public.cos_field_geocode_read_many($1,$2)',[ORG,[key.p_audit_id]]),/Owner account required/);await db.exec('reset role');
});

test('ordinary Census remains independent of missing, null-policy, or unrelated fallback account state',async()=>{
 for(const mode of ['null','unrelated','missing']){
  await reset();
  if(mode==='unrelated'){const guarded=await seed(db,{id:10,status:'invalid_address'});await enroll(guarded);}
  if(mode==='missing')await db.exec('delete from app_private.cos_geocodio_account_state');
  const key=await seed(db,{id:20,status:'invalid_address'});
  await db.query("update app_private.cos_field_geocode_cache set status='pending',reason=null,attempts=0,claim_token=null,geocoded_at=null where audit_id=$1",[key.p_audit_id]);
  assert.equal((await due()).some(r=>r.auditId===key.p_audit_id),true,mode);
  assert.equal((await claim(key,true)).claimed,false,mode);
  const acquired=await claim(key);assert.equal(acquired.claimed,true,mode);assert.equal(acquired.record.attempts,1,mode);assert.equal(Date.parse(acquired.record.leaseUntil)-Date.parse(acquired.record.updatedAt),60000,mode);
  assert.equal((await finish(key,acquired.claimToken)).accepted,true,mode);
  assert.equal((await due()).some(r=>r.auditId===key.p_audit_id),false,mode);
  if(mode==='missing')await db.exec('insert into app_private.cos_geocodio_account_state(singleton) values(true)');
 }
});

test('enrollment rejects an outstanding old Census permit even after Owner source supersession',async()=>{
 await reset();const target=await seed(db,{id:10,status:'invalid_address'});const old=await seed(db,{id:11,address:target.p_address,status:'invalid_address'});
 await db.query("update app_private.cos_field_geocode_cache set status='pending',reason=null,geocoded_at=null,lease_until=clock_timestamp()-interval '1 day' where audit_id=$1",[old.p_audit_id]);
 await db.exec("insert into camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) select 12,actor_id,action,unit_key,device_ids,after_state||'{\"street_address\":\"12 main st, houston, tx 77002\"}' from camera_inventory_audit where id=11");
 await assert.rejects(enroll(target),/overlaps shared or active/);assert.equal(await policy(),null);
});

test('server owns the drain timestamp and consumption stays false until 480 seconds mature',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'});const started=Date.now();await enroll(key,{enrolledAt:'1900-01-01T00:00:00Z'},false);
 const p=await policy();assert.ok(Date.parse(p.enrolledAt)>=started);assert.equal(p.claimToken,null);
 const row=(await due(key))[0];assert.equal(row.censusOnlyState,'draining');assert.equal(Date.parse(row.censusOnlyNotBefore)-Date.parse(p.enrolledAt),480000);
 assert.equal((await claim(key,true)).claimed,false);assert.equal((await claim(key)).claimed,false);assert.equal((await policy()).claimToken,null);assert.equal((await db.query('select attempts from app_private.cos_field_geocode_cache')).rows[0].attempts,1);
 assert.deepEqual(await fallbackDue(key),[]);assert.equal((await reserve(key)).reserved,false);
});

test('mature guarded claim rechecks outstanding same-address permits before consumption',async()=>{
 await reset();const key=await seed(db,{id:10,status:'invalid_address'});await enroll(key);const other=await seed(db,{id:11,address:key.p_address,status:'invalid_address'});
 await db.query("update app_private.cos_field_geocode_cache set status='pending',reason=null,geocoded_at=null,lease_until=clock_timestamp()+interval '1 minute' where audit_id=$1",[other.p_audit_id]);
 assert.equal((await claim(key,true)).claimed,false);assert.equal((await policy()).claimToken,null);assert.equal((await db.query('select attempts from app_private.cos_field_geocode_cache where audit_id=$1',[key.p_audit_id])).rows[0].attempts,1);
});

test('preparation is exact Owner-only metadata, immutable and grants no claim or fallback',async()=>{
 await reset();const key=await seed(db,{status:'invalid_address'}),before=(await db.query('select to_jsonb(c) value from app_private.cos_field_geocode_cache c')).rows;
 const p=await preparation(key);assert.equal(await policy(),null);
 assert.equal((await claim(key,true)).claimed,false);assert.equal((await claim(key)).claimed,false);assert.equal((await reserve(key)).reserved,false);
 assert.deepEqual((await db.query('select to_jsonb(c) value from app_private.cos_field_geocode_cache c')).rows,before);
 const args={p_organization_id:ORG,p_audit_ids:[key.p_audit_id]};
 assert.equal((await call('cos_field_geocode_read_many',args))[0].censusPreparation,undefined);
 const reader=async actor=>{await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec('set role authenticated');try{return(await db.query('select cos_field_geocode_read_many($1,$2) result',[ORG,[key.p_audit_id]])).rows[0].result;}finally{await db.exec('reset role');}};
 assert.deepEqual((await reader(OWNER))[0].censusPreparation,{nativeUnitId:p.binding.nativeUnitId});
 const other=randomUUID();await db.query("insert into profiles(user_id,role,active) values($1,'owner',true)",[other]);assert.equal((await reader(other))[0].censusPreparation,undefined);
 for(const v of [null,{...p,approvalReference:'rebound'}]){await db.exec('set role service_role');await assert.rejects(db.query('update app_private.cos_geocodio_account_state set owner_census_preparation_v1=$1',[v]),/immutable/);await db.exec('reset role');}
 await db.exec("update camera_inventory_audit set after_state=after_state||'{\"note\":\"changed\"}'");assert.equal((await reader(OWNER))[0].censusPreparation,undefined);
});
test('preparation refuses ordinary no-match fallback and shared work, and real policy must match it',async()=>{
 await reset();let key=await seed(db,{status:'no_match'});await assert.rejects(preparation(key),/terminal evidence/);assert.equal(await policy(),null);
 await reset();key=await seed(db,{status:'invalid_address'});await seed(db,{id:2,address:key.p_address});await assert.rejects(preparation(key),/shared or active/);
 await reset();key=await seed(db,{status:'invalid_address'});const p=await preparation(key);
 await assert.rejects(enroll(key),/differs from immutable preparation/);assert.equal(await policy(),null);
 const {authorizingLegacyOwnerId,...binding}=p.binding;
 await enroll(key,{binding:{...binding,address:key.p_address,nativeGuardSha256:'a'.repeat(64),nativeSourceSha256:'b'.repeat(64),auditSha256:p.auditSha256,deviceIds:p.deviceIds}});
 assert.equal((await policy()).binding.nativeUnitId,p.binding.nativeUnitId);
 await db.query("select set_config('test.actor',$1,false)",[OWNER]);const r=await call('cos_field_geocode_read_many',{p_organization_id:ORG,p_audit_ids:[key.p_audit_id]});assert.equal(r[0].censusPreparation,undefined);
});
