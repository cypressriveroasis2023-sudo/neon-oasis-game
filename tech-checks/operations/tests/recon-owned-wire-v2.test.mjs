// Offline checks for the actual shared adapter; no Edge runtime or sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RECON_V2_LIMITS,canonicalReconJson,reconOwnedFingerprint,isReconTimestamp,validateReconBegin,validateReconFinish,validateReconResult,
 beginReconAttempt,recoverReconMutation,failReconAttempt,createReconAttempt,ReconOwnedConflict,ReconOwnedUnknown} from '../../supabase/functions/_shared/reconOwnedMetadataV2.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at=new Date().toISOString();
const token=(kind='inventory_sync')=>({schema_version:2,outcome:'begun',request_id:uuid(1),kind,attempt_id:uuid(2),ordinal:2,
 observed_at:at,expires_at:new Date(Date.parse(at)+(kind==='receiver_test'?60:120)*1000).toISOString(),retain_until:new Date(Date.parse(at)+600000).toISOString(),expected_config_revision:0});
const fingerprint='a'.repeat(64),compact={imported:2,active:1,shop:1,skipped_non_detectors:1};
const finish=(t=token())=>({schema_version:2,attempt_id:t.attempt_id,kind:t.kind,ordinal:t.ordinal,observed_at:t.observed_at,
 outcome:'applied',applied:true,terminal_outcome:'success',current:true,input_fingerprint:fingerprint,reason_code:null,result:compact});
const pending=t=>({schema_version:2,attempt_id:t.attempt_id,kind:t.kind,ordinal:t.ordinal,observed_at:t.observed_at,state:'pending',current:false,terminal:null});
const duplicate=t=>({...finish(t),outcome:'duplicate',applied:false});

test('source constants and supplied closed schema fixture retain their exact contract',()=>{
 assert.deepEqual(RECON_V2_LIMITS,JSON.parse(readFileSync(new URL('./fixtures/recon-v2/V2_CONSTANTS.json',import.meta.url))));
 const s=readFileSync(new URL('./fixtures/recon-v2/V2_RESPONSE_SCHEMAS.min.json',import.meta.url));
 assert.equal(s.length,41692);assert.equal(createHash('sha256').update(s).digest('hex'),'00e826c6048921f64a1817609bed4bd45e607f832902b93909e42a54118a1c7e');
 assert.deepEqual(Object.keys(JSON.parse(s).$defs),['begin','finish','lookup','receipt','record','edge_conflict']);
});
test('full canonical input preserves Unicode and array order and rejects lossy values',async()=>{
 const input={z:['é','e\u0301','𐀀','"\\\n',0,-0,true,null],a:{b:9007199254740991,a:'value'}};
 const expected=JSON.stringify({a:{a:'value',b:9007199254740991},z:input.z});
 assert.equal(canonicalReconJson(input),expected);
 assert.equal(await reconOwnedFingerprint(input),createHash('sha256').update(expected).digest('hex'));
 assert.notEqual(await reconOwnedFingerprint(input),await reconOwnedFingerprint({...input,z:[...input.z].reverse()}));
 for(const bad of [undefined,NaN,Infinity,1.1,9007199254740992,1n,{a:undefined},{a:()=>{}},new Date(),[,1],{é:'non-ASCII key'}])assert.throws(()=>canonicalReconJson(bad));
 const cyclic={};cyclic.a=cyclic;assert.throws(()=>canonicalReconJson(cyclic));
});
test('UTC timestamps retain precision and reject invalid calendars and zones',()=>{
 for(const value of ['2026-10-14T12:00:00Z','2026-10-14T12:00:00.123456+00:00','2024-02-29T23:59:59.999999Z'])assert.equal(isReconTimestamp(value),true,value);
 for(const value of ['1970-01-01T00:00:00Z','infinity','2026-02-30T12:00:00Z','2026-10-14T24:00:00Z','2026-10-14T12:00:00-01:00','2026-10-14T12:00:00.1234567Z',null,123])assert.equal(isReconTimestamp(value),false,String(value));
});
test('begin checks closed identity, safe integers, immutable deadlines and absent identity',()=>{
 const t=token();assert.deepEqual(validateReconBegin(t,{requestId:t.request_id,kind:t.kind}),t);
 for(const bad of [{...t,extra:true},{...t,ordinal:0},{...t,ordinal:9007199254740992},{...t,request_id:uuid(9)},
  {...t,expected_config_revision:-1},{...t,expires_at:t.observed_at},{...t,retain_until:t.expires_at},{...t,observed_at:'2026-02-30T12:00:00Z'}])assert.throws(()=>validateReconBegin(bad,{requestId:t.request_id,kind:t.kind}),ReconOwnedUnknown);
 const absent={...token('inventory_connect'),outcome:'absent',attempt_id:null,ordinal:null,expected_config_revision:null};
 assert.deepEqual(validateReconBegin(absent,{requestId:absent.request_id,kind:absent.kind}),absent);
 const seeded=createReconAttempt(absent);assert.equal(seeded.attempt_id,absent.request_id);assert.equal(seeded.observed_at,absent.observed_at);assert.equal(seeded.expires_at,absent.expires_at);
 assert.throws(()=>validateReconBegin({...absent,kind:'inventory_sync'},{requestId:absent.request_id,kind:'inventory_sync'}),ReconOwnedUnknown);
});
test('finish rejects wrong identity, result, fingerprint and nonmutating supersession shapes',()=>{
 const t=token(),f=finish(t);assert.deepEqual(validateReconFinish(f,{attempt:t,fingerprint}),f);
 for(const bad of [{...f,extra:true},{...f,attempt_id:uuid(9)},{...f,ordinal:3},{...f,observed_at:'2026-10-01T00:00:00Z'},
  {...f,input_fingerprint:'b'.repeat(64)},{...f,current:false},{...f,reason_code:'save_failed'},
  {...f,result:{...compact,active:100001}},{...f,result:{...compact,password:'synthetic-forbidden-field'}},
  {...f,result:{receiver_ready:true,ack_event_id:1,receiver_tested_at:at}}])assert.throws(()=>validateReconFinish(bad,{attempt:t,fingerprint}),ReconOwnedUnknown);
 const noOp={...f,outcome:'superseded',applied:false,current:false,terminal_outcome:null,input_fingerprint:null,reason_code:'superseded',result:null};
 assert.equal(validateReconFinish(noOp,{attempt:t}).outcome,'superseded');
 for(const bad of [{...noOp,terminal_outcome:'failure'},{...noOp,applied:true},{...noOp,reason_code:'internal_error'},{...noOp,result:compact}])assert.throws(()=>validateReconFinish(bad,{attempt:t}),ReconOwnedUnknown);
});
test('lookup requires duplicate terminal form and explicit null unknown identity',()=>{
 const t=token();assert.deepEqual(validateReconResult(pending(t),t),pending(t));
 const ok={...pending(t),state:'success',current:true,terminal:duplicate(t)};assert.deepEqual(validateReconResult(ok,t),ok);
 for(const bad of [{...ok,extra:true},{...ok,current:false},{...ok,terminal:finish(t)},{...ok,state:'failure'},
  {...pending(t),current:true},{...pending(t),kind:'receiver_test'},{...pending(t),state:'unknown'}])assert.throws(()=>validateReconResult(bad,t),ReconOwnedUnknown);
 const unknown={...pending(t),state:'unknown',kind:null,ordinal:null,observed_at:null};assert.equal(validateReconResult(unknown,t).state,'unknown');
});
test('PT409 is non-retryable while genuine40001 remains distinguishable and bounded',async()=>{
 const t=token();let calls=[];
 const conflictDb={rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:{code:'PT409',message:'untrusted diagnostic'}};}};
 await assert.rejects(()=>recoverReconMutation(conflictDb,t,'recon_finish_inventory_v2',{p_attempt_id:t.attempt_id},{fingerprint}),e=>e instanceof ReconOwnedConflict&&e.status===409&&e.message==='Reconeyez inventory refresh was superseded.');assert.equal(calls.length,1);
 calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return name==='recon_attempt_result_v2'?{data:pending(t),error:null}:{data:null,error:{code:'40001',message:'private backend diagnostic'}};}};
 await assert.rejects(()=>recoverReconMutation(db,t,'recon_finish_inventory_v2',{p_attempt_id:t.attempt_id},{fingerprint}),e=>e instanceof ReconOwnedUnknown&&e.databaseCode==='40001'&&!e.message.includes('private'));
 assert.deepEqual(calls.map(c=>c.name),['recon_finish_inventory_v2','recon_attempt_result_v2','recon_finish_inventory_v2','recon_attempt_result_v2']);assert(!calls.some(c=>/begin|fail/.test(c.name)));
});
test('lost and malformed acknowledgement recovers stored same-token result without another publication',async()=>{
 const t=token();for(const response of [{data:null,error:null},{data:{...finish(t),extra:'malformed'},error:null},{data:null,error:{code:'PGRST000'}}]){
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return name==='recon_attempt_result_v2'?{data:{...pending(t),state:'success',current:true,terminal:duplicate(t)},error:null}:response;}};
  assert.equal((await recoverReconMutation(db,t,'recon_finish_inventory_v2',{p_attempt_id:t.attempt_id,p_devices:['exact-input']},{fingerprint})).outcome,'duplicate');
  assert.deepEqual(calls.map(c=>c.name),['recon_finish_inventory_v2','recon_attempt_result_v2']);assert.equal(calls[1].args.p_attempt_id,t.attempt_id);
 }
});
test('unresolved publication retries exact input once without fresh begin or invented failure',async()=>{
 const t=token(),args={p_attempt_id:t.attempt_id,p_devices:[{identity:'complete'}]},calls=[];
 const db={rpc:async(name,input)=>{calls.push({name,input});if(name==='recon_attempt_result_v2')return {data:pending(t),error:null};throw new Error('synthetic transport lost');}};
 await assert.rejects(()=>recoverReconMutation(db,t,'recon_finish_inventory_v2',args,{fingerprint}),ReconOwnedUnknown);
 const writes=calls.filter(c=>c.name==='recon_finish_inventory_v2');assert.equal(writes.length,2);assert.strictEqual(writes[0].input,args);assert.strictEqual(writes[1].input,args);assert(!calls.some(c=>/begin|fail/.test(c.name)));
});
test('failure after committed success returns original success without manufacturing failure',async()=>{
 const t=token(),calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:duplicate(t),error:null};}};
 const r=await failReconAttempt(db,t,'provider_unavailable');assert.equal(r.terminal_outcome,'success');assert.deepEqual(r.result,compact);assert.equal(calls.length,1);
});

test('unknown begin acknowledgement recovers only the original stored request and never mints a replacement',async()=>{
 for(const malformed of [false,true]){
  const t=token(),calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return name==='recon_recover_begin_v2'?{data:{...t,outcome:'duplicate'},error:null}:malformed?{data:{...t,extra:true},error:null}:{data:null,error:{code:'PGRST000'}};}};
  const recovered=await beginReconAttempt(db,t.kind,t.request_id);assert.equal(recovered.attempt_id,t.attempt_id);assert.equal(recovered.observed_at,t.observed_at);assert.equal(recovered.outcome,'duplicate');
  assert.deepEqual(calls.map(c=>c.name),['recon_begin_attempt_v2','recon_recover_begin_v2']);assert.deepEqual(calls[0].args,calls[1].args);
 }
 const t=token();let calls=0;const native={rpc:async()=>{calls++;return {data:null,error:{code:'40001'}};}};
 await assert.rejects(()=>beginReconAttempt(native,t.kind,t.request_id),e=>e instanceof ReconOwnedUnknown&&e.databaseCode==='40001');assert.equal(calls,1);
 const absent={rpc:async(name)=>name==='recon_begin_attempt_v2'?{data:null,error:{code:'PGRST000'}}:{data:null,error:{code:'PT409'}}};
 await assert.rejects(()=>beginReconAttempt(absent,'inventory_connect',t.request_id),ReconOwnedConflict);
});
