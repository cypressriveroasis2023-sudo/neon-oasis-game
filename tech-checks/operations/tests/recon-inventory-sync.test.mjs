// Actual connector source in a synthetic Node VM: no Deno/Edge/server/provider runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {prepareReconInventory,syncReconInventory} from '../../supabase/functions/reconeyez-connect/inventorySync.ts';
import * as owner from '../../supabase/functions/_shared/reconOwnedMetadataV2.ts';
const at='2026-10-14T12:00:00.000Z';
const list=[{guid:'AA00000100000001',type:'bridge',area:'Synthetic field',name:'Synthetic bridge'},
 {guid:'BB00000100000001',type:'detector',area:'Synthetic field',name:'Synthetic detector',description:'Synthetic description'},
 {guid:'CC00000100000001',type:'detector',area:'Synthetic shop',name:'Synthetic stored detector'},
 {guid:'DD00000100000001',type:'accessory',area:'Synthetic field',name:'Synthetic accessory'}];
const result={imported:2,active:1,shop:1,skipped_non_detectors:2};
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function begin(kind='inventory_sync'){
 const now=new Date().toISOString();return {schema_version:2,outcome:'begun',request_id:uuid(1),kind,attempt_id:uuid(2),ordinal:1,
 observed_at:now,expires_at:new Date(Date.parse(now)+(kind==='receiver_test'?60:120)*1000).toISOString(),retain_until:new Date(Date.parse(now)+600000).toISOString(),expected_config_revision:0};
}
function terminal(t,q,fingerprint='a'.repeat(64),reason=null){return {schema_version:2,attempt_id:t.attempt_id,kind:t.kind,ordinal:t.ordinal,observed_at:t.observed_at,
 outcome:'applied',applied:true,terminal_outcome:reason?'failure':'success',current:true,input_fingerprint:fingerprint,reason_code:reason,result:reason?null:q};}
const lookup=(t,stored)=>({schema_version:2,attempt_id:t.attempt_id,kind:t.kind,ordinal:t.ordinal,observed_at:t.observed_at,state:stored?stored.terminal_outcome:'pending',current:!!stored,terminal:stored?{...stored,outcome:'duplicate',applied:false}:null});

test('complete inventory retains opaque identity proof and one observation time without health evidence',async()=>{
 const args=await prepareReconInventory(list,at);assert.equal(args.p_observed_at,at);assert.equal(args.p_identity_inventory.observedAt,at);
 assert.equal(args.p_inventory_count,4);assert.equal(args.p_identity_inventory.resourceCount,4);assert.equal(args.p_skipped_non_detectors,2);assert.equal(args.p_devices.length,2);assert.equal(args.p_devices[1].activation_state,'deactivated');
 const proof=JSON.stringify(args.p_identity_inventory);for(const d of list)for(const key of ['guid','area','name'])assert(!proof.includes(d[key]));
 for(const group of args.p_identity_inventory.groups)assert.equal(group.bridgeLastEventAt,null);
 for(const d of args.p_devices){assert.deepEqual(Object.keys(d.source_metadata).sort(),['area','description','guid','reconeyez_type']);assert(!Object.keys(d).some(k=>/health|battery|last_seen|last_online/.test(k)));}
});
test('invalid duplicate or partial inventory is rejected before any finalizer',async()=>{
 for(const invalid of [[],[...list,{...list[0]}],[...list,{guid:'invalid',type:'bridge',area:'Synthetic field'}],list.map((d,i)=>i===0?{...d,area:''}:d)]){
  let calls=0;await assert.rejects(()=>syncReconInventory({rpc:async()=>{calls++;throw Error('unexpected');}},invalid,begin()),/complete inventory identities/);assert.equal(calls,0);
 }
});
function handlerFixture(action,scenario='ok',role='owner'){
 const calls=[],deliveries=[];let handler,t,stored,receiverBody;
 const db={auth:{getUser:async()=>({data:{user:role==='anonymous'?null:{id:'synthetic-owner'}}})},from:table=>{
  if(table!=='profiles')throw Error('No integration snapshot/direct write may be used by this action');
  return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,active:true}})})})};
 },rpc:async(name,args={})=>{
  calls.push({name,args});
  if(name==='recon_begin_attempt_v2'){
   if(scenario==='begin-error')return {data:null,error:{code:'PGRST000'}};
   if(scenario==='begin-serialization')return {data:null,error:{code:'40001'}};
   t={...begin(args.p_kind),request_id:args.p_request_id};
   if(scenario.startsWith('absent'))t={...t,outcome:'absent',attempt_id:null,ordinal:null,expected_config_revision:null};
   return scenario==='begin-lost-ack'?{data:null,error:{code:'PGRST000'}}:{data:t,error:null};
  }
  if(name==='recon_recover_begin_v2')return scenario==='begin-error'?{data:null,error:{code:'PT409'}}:{data:{...t,outcome:'duplicate'},error:null};
  if(name==='get_reconeyez_integration_secrets')return {data:{username:'synthetic-username',password:'synthetic-password',server_host:'synthetic.invalid',server_port:9028,webhook_secret:'synthetic-webhook'},error:null};
  if(name==='recon_finish_inventory_v2'||name==='recon_create_inventory_v2'){
   if(scenario==='stale'||scenario==='equal'||scenario==='cas-loser')return {data:null,error:{code:'PT409',message:'private SQL text'}};
   if(scenario==='serialization')return {data:null,error:{code:'40001',message:'private backend error'}};
   const input={devices:args.p_devices,identity_inventory:args.p_identity_inventory,inventory_count:args.p_inventory_count,skipped_non_detectors:args.p_skipped_non_detectors};
   stored=terminal(t.outcome==='absent'?owner.createReconAttempt(t):t,result,await owner.reconOwnedFingerprint(input));
   if(scenario==='lost-ack')return {data:null,error:null};
   if(scenario==='bad-counts')return {data:{...stored,result:{...result,imported:1}},error:null};
   return {data:stored,error:null};
  }
  if(name==='recon_attempt_result_v2'){
   if(t.kind==='receiver_test'&&receiverBody&&scenario!=='receiver-unknown'){
    const hash=await owner.reconOwnedFingerprint({attempt_id:t.attempt_id,body:receiverBody});
    stored=terminal(t,{receiver_ready:true,ack_event_id:101,receiver_tested_at:t.observed_at},hash);
   }
   if(scenario==='bad-counts')return {data:lookup(t,{...stored,result:{...result,imported:1}}),error:null};
   return {data:lookup(t,stored),error:null};
  }
  if(name==='recon_fail_attempt_v2')return {data:terminal(t,null,'b'.repeat(64),args.p_reason_code),error:null};
  throw Error('Unexpected or separately committed writer '+name);
 }};
 const source=readFileSync(new URL('../../supabase/functions/reconeyez-connect/index.ts',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(compiled,{exports:{},Request,Response,URL,btoa,crypto,AbortController,AbortSignal,setTimeout,clearTimeout,...owner,syncReconInventory,
  // VM literals have a distinct Object.prototype; clone across that synthetic realm boundary only.
  reconOwnedFingerprint:value=>owner.reconOwnedFingerprint(structuredClone(value)),
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-only'},serve:fn=>{handler=fn;}},createClient:()=>db,
  fetch:async(url,options)=>{
   deliveries.push({url,options});
   if(action==='test_webhook'){
    receiverBody=JSON.parse(options.body);if(scenario==='receiver-unknown')throw Error('synthetic uncertain delivery');return new Response('{}',{status:202});
   }
   return new Response(JSON.stringify(scenario==='fetch-invalid'?[]:list),{status:scenario==='fetch-partial'||scenario==='absent-partial'?206:scenario==='fetch-accepted'?202:200});
  }});
 return {calls,deliveries,token:()=>t,run:()=>handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({action,username:'synthetic-username',password:'synthetic-password'})}))};
}
test('connect and sync begin before source access and publish once through the guarded atomic inventory writer',async()=>{
 for(const action of ['connect','sync']){
  const f=handlerFixture(action),response=await f.run();assert.equal(response.status,200);assert.equal((await response.json()).imported,2);
  assert.equal(f.calls[0].name,'recon_begin_attempt_v2');assert.equal(f.calls.filter(c=>c.name==='recon_finish_inventory_v2').length,1);
  assert(!f.calls.some(c=>c.name==='save_reconeyez_credentials'));
  const w=f.calls.find(c=>c.name==='recon_finish_inventory_v2');assert.equal(w.args.p_identity_inventory.observedAt,f.token().observed_at);assert.equal(w.args.p_attempt_id,f.token().attempt_id);
  assert.equal(w.args.p_username,action==='connect'?'synthetic-username':null);assert.equal(w.args.p_password,action==='connect'?'synthetic-password':null);
 }
});
test('definite invalid and206 sources finish only the original existing attempt with a safe reason',async()=>{
 for(const action of ['connect','sync'])for(const scenario of ['fetch-invalid','fetch-partial','fetch-accepted']){
  const f=handlerFixture(action,scenario),r=await f.run();assert.equal(r.status,502);assert(!f.calls.some(c=>c.name==='recon_finish_inventory_v2'));
  const fail=f.calls.find(c=>c.name==='recon_fail_attempt_v2');assert.equal(fail.args.p_attempt_id,f.token().attempt_id);assert.equal(fail.args.p_reason_code,scenario==='fetch-partial'?'partial_inventory':scenario==='fetch-accepted'?'provider_unavailable':'invalid_inventory');
 }
});
test('stale and equal attempts preserve the exact HTTP409 contract without retry or failure publication',async()=>{
 for(const action of ['connect','sync'])for(const scenario of ['stale','equal']){
  const f=handlerFixture(action,scenario),r=await f.run();assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'Reconeyez inventory refresh was superseded.',code:'PT409'});
  assert.equal(f.calls.filter(c=>c.name==='recon_finish_inventory_v2').length,1);assert(!f.calls.some(c=>c.name==='recon_fail_attempt_v2'||c.name==='recon_attempt_result_v2'));
 }
});
test('genuine40001 is bounded same-token recovery andHTTP502, without invented source failure',async()=>{
 for(const action of ['connect','sync']){
  const f=handlerFixture(action,'serialization'),r=await f.run();assert.equal(r.status,502);assert(!JSON.stringify(await r.json()).includes('private'));
  const writes=f.calls.filter(c=>c.name==='recon_finish_inventory_v2');assert.equal(writes.length,2);assert.deepEqual(writes[0].args,writes[1].args);assert(!f.calls.some(c=>c.name==='recon_fail_attempt_v2'));
 }
});
test('lost acknowledgement recovers compact stored success and wrong counts never fabricate success',async()=>{
 for(const action of ['connect','sync']){
  const f=handlerFixture(action,'lost-ack'),r=await f.run();assert.equal(r.status,200);assert.equal(f.calls.filter(c=>c.name==='recon_finish_inventory_v2').length,1);assert.equal(f.calls.filter(c=>c.name==='recon_attempt_result_v2').length,1);
  const bad=handlerFixture(action,'bad-counts'),badResponse=await bad.run();assert.equal(badResponse.status,502);assert(!bad.calls.some(c=>c.name==='recon_fail_attempt_v2'));
 }
});
test('first connect uses create-only atomic finalizer and absence failure never touches a concurrent row',async()=>{
 const f=handlerFixture('connect','absent-ok'),r=await f.run();assert.equal(r.status,200);const create=f.calls.find(c=>c.name==='recon_create_inventory_v2');assert(create);assert.equal(create.args.p_request_id,f.token().request_id);assert.equal(create.args.p_observed_at,f.token().observed_at);assert(!f.calls.some(c=>c.name==='save_reconeyez_credentials'));
 const failed=handlerFixture('connect','absent-partial');assert.equal((await failed.run()).status,502);assert(!failed.calls.some(c=>/create|finish|fail/.test(c.name)));
});
test('authorization and uncertain begin prevent provider work and all source access',async()=>{
 for(const [action,role,status] of [['connect','it',403],['test_webhook','it',403],['sync','anonymous',401]]){
  const f=handlerFixture(action,'ok',role);assert.equal((await f.run()).status,status);assert.equal(f.calls.length,0);assert.equal(f.deliveries.length,0);
 }
 const f=handlerFixture('sync','begin-error');assert.equal((await f.run()).status,409);assert.deepEqual(f.calls.map(c=>c.name),['recon_begin_attempt_v2','recon_recover_begin_v2']);assert.equal(f.deliveries.length,0);
 const recovered=handlerFixture('sync','begin-lost-ack');assert.equal((await recovered.run()).status,200);assert.deepEqual(recovered.calls.slice(0,2).map(c=>c.name),['recon_begin_attempt_v2','recon_recover_begin_v2']);
 const native=handlerFixture('sync','begin-serialization');assert.equal((await native.run()).status,502);assert.deepEqual(native.calls.map(c=>c.name),['recon_begin_attempt_v2']);assert.equal(native.deliveries.length,0);
});
test('receiver uses correlated original body and authenticated stored result, never HTTP acceptance as readiness',async()=>{
 const f=handlerFixture('test_webhook'),r=await f.run();assert.equal(r.status,200);const q=await r.json();assert.equal(q.receiver_ready,true);assert.equal(q.ack_event_id,101);
 assert.equal(f.calls[0].name,'recon_begin_attempt_v2');assert.equal(f.calls[0].args.p_kind,'receiver_test');
 const body=JSON.parse(f.deliveries[0].options.body);assert.deepEqual(body.cos_receiver_test_v2,{schema_version:2,attempt_id:f.token().attempt_id});assert.equal(body.timestamp,f.token().observed_at);
 const uncertain=handlerFixture('test_webhook','receiver-unknown');assert.equal((await uncertain.run()).status,502);assert.equal(uncertain.deliveries.length,2);assert.equal(uncertain.deliveries[0].options.body,uncertain.deliveries[1].options.body);assert(!uncertain.calls.some(c=>c.name==='recon_fail_attempt_v2'));
});
