// Offline caller contracts only: synthetic provider/auth/RPC responses, no sockets.
// This is not the unavailable captured-v33/corrected-webhook or real Edge/PG gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as owned from '../../supabase/functions/_shared/reconOwnedMetadataV2.ts';
import {projectReconProviderInventory} from '../../supabase/functions/_shared/reconProviderInventory.ts';

const source=readFileSync(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source.replace(/^import .*;\s*$/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const gid=n=>'01'+n.toString(16).toUpperCase().padStart(4,'0')+'0000000000';
const old='2026-01-01T01:02:03.000Z';
const list=()=>[{guid:gid(1),type:'bridge_4g',area:'Synthetic Field',name:'Synthetic bridge'},
 {guid:gid(2),type:'detector_hdr_xrl',area:'Synthetic Field',name:'Synthetic detector one'},
 {guid:gid(3),type:'detector_hdr_xrl',area:'Synthetic Field',name:'Synthetic detector two'}];
const locals=()=>[{id:101,external_device_id:gid(2),device_serial:'reconeyez:'+gid(2),activation_state:'active',organization:'Manual field',unit_key:'RI-001',source_last_seen_at:old,last_online_at:old,last_probe_online_at:old,source_metadata:{battery_updated_at:old,battery_status_updated_at:old,custom:{preserve:true}}},
 {id:102,external_device_id:gid(9),device_serial:'reconeyez:'+gid(9),activation_state:'deactivated',organization:'Manual shop',unit_key:'RII-002',source_last_seen_at:old}];
const trackers=()=>[{canonical_family:'Recon',unit_tag:'001',source_label:'Synthetic Recon 001',tracker_state:'field_or_unknown'},
 {canonical_family:'Recon 2',unit_tag:'002',source_label:'Synthetic Recon 2 002',tracker_state:'field_or_unknown'},
 {canonical_family:'Recon 2',unit_tag:'003',source_label:'Synthetic missing Recon 2',tracker_state:'field_or_unknown'}];
const clone=value=>structuredClone(value);
const ok=data=>({data,error:null});
const hash=value=>createHash('sha256').update(value).digest('hex');

function fixture(options={}){
 const operations=[],savedLocals=clone(options.locals??locals()),savedTrackers=clone(options.trackers??trackers());
 const observedAt=new Date(Date.now()-(options.beginAge??1000)).toISOString();
 let sourceClockOffset=0,projectionCalls=0;
 class SourceDate extends Date{static now(){return Date.now()+sourceClockOffset}}
 const attempt={schema_version:2,outcome:'begun',request_id:null,kind:'inventory_reconcile',attempt_id:'00000000-0000-4000-8000-000000000101',ordinal:7,
  observed_at:observedAt,expires_at:new Date(Date.parse(observedAt)+120000).toISOString(),retain_until:new Date(Date.parse(observedAt)+600000).toISOString(),expected_config_revision:4};
 let handler,stored=null,finishCalls=0;
 const terminal=(result,fingerprint='a'.repeat(64),kind='success')=>({schema_version:2,attempt_id:attempt.attempt_id,kind:attempt.kind,ordinal:attempt.ordinal,observed_at:attempt.observed_at,
  outcome:'applied',applied:true,terminal_outcome:kind,current:true,input_fingerprint:fingerprint,reason_code:kind==='success'?null:'provider_unavailable',result:kind==='success'?result:null});
 const duplicate=value=>({...value,outcome:'duplicate',applied:false,current:options.lookupCurrent??true});
 const resultLookup=value=>({schema_version:2,attempt_id:attempt.attempt_id,kind:attempt.kind,ordinal:attempt.ordinal,observed_at:attempt.observed_at,state:value?value.terminal_outcome:'pending',current:value?value.current:false,terminal:value});
 const db={auth:{getUser:async()=>ok({user:options.unauthorized?null:{id:'synthetic-owner'}})},
  async rpc(name,args={}){
   operations.push({rpc:name,args:clone(args)});
   if(name==='verify_camera_health_cron_secret')return ok(options.cron??false);
   if(name==='recon_begin_attempt_v2'){
    attempt.request_id=args.p_request_id;
    return options.begin?options.begin(clone(attempt)):ok(clone(attempt));
   }
   if(name==='get_reconeyez_integration_secrets'){
    if(options.secretHang)return new Promise(()=>{});
    if(options.secretThrow)throw Error('synthetic private credential read error');
    return options.secretError?{data:null,error:{message:'synthetic private DB detail'}}:ok({username:options.username??'synthetic-user',password:options.password??'synthetic-password',server_host:'synthetic.invalid',server_port:Object.hasOwn(options,'serverPort')?options.serverPort:9028});
   }
   if(name==='recon_finish_reconcile_v2'){
    finishCalls++;
    const d=args.p_diagnostics;
    const q={inventory_total:args.p_inventory_count,detectors:args.p_detector_count,matched_local_detectors:d.matched_local_detectors,
     unmatched_provider_detectors:d.unmatched_provider_detectors,local_active:d.local_active,local_shop:d.local_shop,diagnostics_sha256:await owned.reconOwnedFingerprint(d)};
    const fingerprint=await owned.reconOwnedFingerprint({identity_inventory:args.p_identity_inventory,inventory_count:args.p_inventory_count,
     detector_count:args.p_detector_count,diagnostics:d,server_host:args.p_server_host,server_port:args.p_server_port});
    const value=terminal(q,fingerprint);
    if(options.commitBeforeError)stored=value;
    if(options.finish)return options.finish({args:clone(args),value:clone(value),call:finishCalls});
    stored=value;return ok(value);
   }
   if(name==='recon_attempt_result_v2'){
    if(options.lookup)return options.lookup({attempt:clone(attempt),stored:stored?duplicate(stored):null,resultLookup});
    return ok(resultLookup(stored?duplicate(stored):null));
   }
   if(name==='recon_fail_attempt_v2'){
    if(options.fail)return options.fail({attempt:clone(attempt),terminal,duplicate});
    const value=terminal(null,'f'.repeat(64),'failure');value.reason_code=args.p_reason_code;stored=value;return ok(value);
   }
   throw Error('Unexpected synthetic RPC '+name);
  },
  from(table){
   const builder={select(columns){operations.push({table,select:columns});return builder},eq(){return builder},in(){return builder},order(){return builder},limit(){return builder},
    update(patch){operations.push({table,update:patch});throw Error('Direct write forbidden in Recon fixture')},
    insert(patch){operations.push({table,insert:patch});throw Error('Direct write forbidden in Recon fixture')},
    upsert(patch){operations.push({table,upsert:patch});throw Error('Direct write forbidden in Recon fixture')},
    maybeSingle:async()=>ok({role:options.role??'owner',active:options.active??true}),
    then(resolve,reject){
     if(options.readThrow===table)return Promise.reject(Error('synthetic private source detail')).then(resolve,reject);
     const data=table==='camera_devices'?savedLocals:table==='equipment_master'?savedTrackers:table==='camera_integration_events'?(options.events??[]):null;
     return Promise.resolve(options.readError===table?{data:null,error:{message:'synthetic private DB detail'}}:ok(data)).then(resolve,reject);
    }};return builder;
  }};
 const bindings={...owned,Date:SourceDate,
  projectReconProviderInventory:async(...args)=>{const value=await projectReconProviderInventory(...args);if(++projectionCalls===options.advanceAfterProjection)sourceClockOffset+=46000;return value;},
  reconOwnedFingerprint:async value=>{const result=await owned.reconOwnedFingerprint(value);if(options.advanceAfterFingerprint&&Object.hasOwn(value,'identity_inventory'))sourceClockOffset+=46000;return result;},createClient:()=>db,
  Deno:{env:{get:()=> 'synthetic-only'},serve:fn=>{handler=fn}},EdgeRuntime:{waitUntil:()=>{}},scheduleCameraMhelpIntake:()=>{},
  fetch:async(url,init)=>{
   operations.push({provider:true,url,signal:init.signal});
   if(options.fetch)return options.fetch(url,init);
   return new Response(options.body??JSON.stringify(options.list??list()),{status:options.providerStatus??200});
  }};
 // Execute in Node's own realm so the actual canonical plain-object validator
 // sees ordinary objects; provider/auth/transport are all explicit synthetic inputs.
 const runtime=new Function(...Object.keys(bindings),compiled+'\nreturn {reconInventory,stubOtherProviders(){starInventory=async()=>({synthetic:true});avigilonInventory=async()=>({synthetic:true});witnessInventory=async()=>({synthetic:true})}};')(...Object.values(bindings));
 if(options.stubOtherProviders)runtime.stubOtherProviders();
 return {operations,attempt,savedLocals,savedTrackers,run:async(mode='reconeyez')=>{
  const response=await handler(new Request('https://synthetic.invalid/reconcile',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json'},body:JSON.stringify({mode})}));
  return {status:response.status,body:await response.json()};
 }};
}
const calls=(f,name)=>f.operations.filter(op=>op.rpc===name);
const finishArgs=f=>calls(f,'recon_finish_reconcile_v2')[0]?.args;
const directWrites=f=>f.operations.filter(op=>op.update||op.insert||op.upsert);

test('Recon begins before credentials/provider/source reads and commits one validated owner operation with paired original time',async()=>{
 const f=fixture(),before=clone(f.savedLocals),r=await f.run();assert.equal(r.status,200);
 const begin=f.operations.findIndex(op=>op.rpc==='recon_begin_attempt_v2'),secret=f.operations.findIndex(op=>op.rpc==='get_reconeyez_integration_secrets'),provider=f.operations.findIndex(op=>op.provider);
 assert(begin>=0&&secret>begin&&provider>secret);assert.equal(calls(f,'recon_begin_attempt_v2')[0].args.p_kind,'inventory_reconcile');
 assert.equal(calls(f,'recon_finish_reconcile_v2').length,1);assert.equal(calls(f,'recon_fail_attempt_v2').length,0);assert.deepEqual(directWrites(f),[]);
 assert(!f.operations.some(op=>op.table==='camera_integrations'));assert.deepEqual(f.savedLocals,before);
 const args=finishArgs(f);assert.equal(args.p_identity_inventory.observedAt,f.attempt.observed_at);assert.equal(args.p_diagnostics.reconciled_at,f.attempt.observed_at);
 assert.equal(args.p_server_host,'synthetic.invalid');assert.equal(args.p_server_port,9028);assert.equal(args.p_inventory_count,3);assert.equal(args.p_detector_count,2);
 assert.equal(r.body.reconeyez.matched_local_detectors,1);assert.equal(r.body.reconeyez.unmatched_provider_detectors,1);
 assert.equal(r.body.reconeyez.diagnostics_sha256,await owned.reconOwnedFingerprint(args.p_diagnostics));
 assert.deepEqual(r.body.reconeyez.tracker_coverage['Recon 2'].missing_field_units,['Synthetic missing Recon 2']);
 assert(!JSON.stringify(args).includes('synthetic-password'));
});

test('malformed begin, missing authority and expired original deadline stop before provider access',async()=>{
 for(const options of [{begin:a=>ok({...a,extra:true})},{begin:a=>ok({...a,ordinal:'7'})},{beginAge:116000},{unauthorized:true},{role:'service'},{active:false}]){
  const f=fixture(options),r=await f.run();assert(r.status>=400);assert(!f.operations.some(op=>op.provider));
  assert.equal(calls(f,'get_reconeyez_integration_secrets').length,0);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);assert.equal(calls(f,'recon_fail_attempt_v2').length,0);
 }
});

test('partial, rejected, malformed and failed provider responses use the same original token and only fixed safe failure reasons',async()=>{
 for(const [options,reason]of [[{providerStatus:206},'partial_inventory'],[{providerStatus:401},'provider_rejected'],[{providerStatus:503},'provider_unavailable'],[{body:'invalid'},'invalid_inventory'],[{list:[...list(),list()[0]]},'invalid_inventory'],[{fetch:async()=>{throw Error('synthetic private provider failure')}},'provider_unavailable']]){
  const f=fixture(options),r=await f.run();assert.equal(r.status,502);assert.equal(calls(f,'recon_begin_attempt_v2').length,1);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);
  assert.deepEqual(calls(f,'recon_fail_attempt_v2').map(c=>c.args),[{p_attempt_id:f.attempt.attempt_id,p_reason_code:reason}]);
  assert.deepEqual(directWrites(f),[]);assert(!JSON.stringify(r.body).includes('synthetic private'));
 }
});

test('failed or thrown credentials/local/tracker/event reads cannot publish partial diagnostics',async()=>{
 for(const options of [{secretError:true},{secretThrow:true},...['camera_devices','equipment_master','camera_integration_events'].flatMap(table=>[{readError:table},{readThrow:table}])]){
  const f=fixture(options),r=await f.run();assert.equal(r.status,502);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);
  assert.equal(calls(f,'recon_fail_attempt_v2').length,1);assert.equal(calls(f,'recon_fail_attempt_v2')[0].args.p_reason_code,'source_read_failed');assert.deepEqual(directWrites(f),[]);
 }
});

test('source reads reserve finalization time and cannot wait beyond the original attempt budget',async()=>{
 const f=fixture({beginAge:114800,secretHang:true}),started=Date.now(),r=await f.run();
 assert.equal(r.status,502);assert(Date.now()-started<1500);assert.equal(calls(f,'recon_fail_attempt_v2').length,1);
 assert.equal(calls(f,'recon_fail_attempt_v2')[0].args.p_reason_code,'source_read_failed');assert(!f.operations.some(op=>op.provider));
});

test('the original 45-second provider deadline includes both proof projections and full canonical hashing',async()=>{
 for(const options of [{advanceAfterProjection:1},{advanceAfterProjection:2},{advanceAfterFingerprint:true}]){
  const f=fixture(options),r=await f.run();assert.equal(r.status,502);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);
  assert.equal(calls(f,'recon_fail_attempt_v2').length,1);assert.equal(calls(f,'recon_fail_attempt_v2')[0].args.p_reason_code,'provider_unavailable');
  assert.equal(calls(f,'recon_begin_attempt_v2').length,1);assert.deepEqual(directWrites(f),[]);
 }
});

test('provider response consumption is bounded even when a synthetic body ignores its abort signal',async()=>{
 const f=fixture({beginAge:114800,fetch:async()=>({status:200,text:()=>new Promise(()=>{})})}),started=Date.now(),r=await f.run();
 assert.equal(r.status,502);assert(Date.now()-started<1500);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);
 assert.equal(calls(f,'recon_fail_attempt_v2')[0].args.p_reason_code,'provider_unavailable');
});

test('late/config-changed success remains PT409 and never enters either old timestamp-free reconcile catch writer',async()=>{
 for(const mode of ['reconeyez','recon','all']){
  const f=fixture({stubOtherProviders:true,finish:()=>({data:null,error:{code:'PT409',message:'synthetic private DB text'}})}),r=await f.run(mode);
  assert.equal(r.status,409);assert.deepEqual(r.body,{error:'Reconeyez inventory refresh was superseded.',code:'PT409'});
  assert.equal(calls(f,'recon_fail_attempt_v2').length,0);assert.deepEqual(directWrites(f),[]);
 }
});

test('older definite failures are no-ops in the shared domain, without inventing a second token or direct error update',async()=>{
 const f=fixture({providerStatus:503,fail:({attempt})=>ok({schema_version:2,attempt_id:attempt.attempt_id,kind:attempt.kind,ordinal:attempt.ordinal,observed_at:attempt.observed_at,
  outcome:'superseded',applied:false,terminal_outcome:null,current:false,input_fingerprint:null,reason_code:'superseded',result:null})});
 const r=await f.run();assert.equal(r.status,502);assert.equal(calls(f,'recon_begin_attempt_v2').length,1);assert.equal(calls(f,'recon_fail_attempt_v2').length,1);assert.deepEqual(directWrites(f),[]);
});

test('a lost success acknowledgment recovers the same committed attempt and full fingerprint before returning invocation diagnostics',async()=>{
 const f=fixture({commitBeforeError:true,finish:()=>{throw Error('synthetic lost acknowledgment')}}),r=await f.run();
 assert.equal(r.status,200);assert.equal(calls(f,'recon_attempt_result_v2').length,1);assert.equal(calls(f,'recon_finish_reconcile_v2').length,1);assert.equal(calls(f,'recon_begin_attempt_v2').length,1);
 assert.equal(calls(f,'recon_fail_attempt_v2').length,0);assert(r.body.reconeyez.tracker_coverage);assert.deepEqual(directWrites(f),[]);
});

test('malformed finish acknowledgment recovers pending then retries exactly the same token/input, never a fresh attempt',async()=>{
 const f=fixture({finish:({value,call})=>ok(call===1?{...value,extra:true}:value)}),r=await f.run();
 assert.equal(r.status,200);const finishes=calls(f,'recon_finish_reconcile_v2');assert.equal(finishes.length,2);assert.deepEqual(finishes[0].args,finishes[1].args);
 assert.equal(calls(f,'recon_begin_attempt_v2').length,1);assert.equal(calls(f,'recon_fail_attempt_v2').length,0);
});

test('unresolved publication and native40001 remain safe uncertainty without fabricated failure, success or diagnostics',async()=>{
 for(const code of [null,'40001']){
  const f=fixture({finish:()=>({data:null,error:{code,message:'synthetic private backend detail'}})}),r=await f.run();
  assert.equal(r.status,502);assert(!r.body.reconeyez);assert(!JSON.stringify(r.body).includes('synthetic private'));
  assert.equal(calls(f,'recon_begin_attempt_v2').length,1);assert.equal(calls(f,'recon_finish_reconcile_v2').length,2);assert.equal(calls(f,'recon_fail_attempt_v2').length,0);assert.deepEqual(directWrites(f),[]);
 }
});

test('success publication discovering terminal failure is PT409 and never issues another failure finalizer',async()=>{
 const f=fixture({finish:({value})=>ok({...value,terminal_outcome:'failure',reason_code:'provider_unavailable',result:null})}),r=await f.run();
 assert.equal(r.status,409);assert.equal(r.body.code,'PT409');assert.equal(calls(f,'recon_fail_attempt_v2').length,0);assert.deepEqual(directWrites(f),[]);
});

test('wrong identity, full-input hash, diagnostic hash or counts cannot verify a commit or expose diagnostics',async()=>{
 const mutate=[value=>({...value,attempt_id:'00000000-0000-4000-8000-000000000999'}),value=>({...value,input_fingerprint:'0'.repeat(64)}),
  value=>({...value,result:{...value.result,diagnostics_sha256:'0'.repeat(64)}}),value=>({...value,result:{...value.result,local_active:value.result.local_active+1}})];
 for(const change of mutate){const f=fixture({finish:({value})=>ok(change(value))}),r=await f.run();assert.equal(r.status,502);assert(!r.body.reconeyez);assert.equal(calls(f,'recon_fail_attempt_v2').length,0);}
});

test('failure recovery of an already committed historical success returns compact Q without current invocation diagnostics',async()=>{
 const q={inventory_total:9,detectors:8,matched_local_detectors:7,unmatched_provider_detectors:1,local_active:7,local_shop:1,diagnostics_sha256:'b'.repeat(64)};
 const f=fixture({providerStatus:503,lookupCurrent:false,fail:({terminal,duplicate})=>ok(duplicate(terminal(q)))}),r=await f.run();
 assert.equal(r.status,200);assert.deepEqual(r.body.reconeyez,q);assert(!Object.hasOwn(r.body.reconeyez,'tracker_coverage'));assert(!Object.hasOwn(r.body.reconeyez,'server'));
});

test('bridge event context keeps the original observation time and inventory remains read-only for every local device clock',async()=>{
 const f=fixture({events:[{external_device_id:gid(1),observed_at:old}]}),before=clone(f.savedLocals),r=await f.run();assert.equal(r.status,200);
 assert.equal(finishArgs(f).p_identity_inventory.groups[0].bridgeLastEventAt,old);assert.deepEqual(f.savedLocals,before);assert.deepEqual(directWrites(f),[]);
});

test('a nullable saved source port retains the bounded legacy9028 fallback in the guarded publication',async()=>{
 const f=fixture({serverPort:null}),r=await f.run();assert.equal(r.status,200);assert.equal(finishArgs(f).p_server_port,9028);assert.equal(r.body.reconeyez.server,'synthetic.invalid:9028');
});

test('UTF-8 label limits, controls, family shapes and 1000-label bound reject instead of truncate',async()=>{
 const missing=label=>[{canonical_family:'Recon',unit_tag:'999',source_label:label,tracker_state:'field_or_unknown'}];
 for(const label of ['x'.repeat(128),'🌵'.repeat(32),'"'.repeat(128)]){const f=fixture({trackers:missing(label)}),r=await f.run();assert.equal(r.status,200);assert.equal(finishArgs(f).p_diagnostics.tracker_coverage.Recon.missing_field_units[0],label);}
 for(const rows of [missing('x'.repeat(129)),missing('🌵'.repeat(32)+'x'),missing('bad\nlabel'),[{...missing('x')[0],canonical_family:'Other'}],[{...missing('x')[0],tracker_state:'unknown'}],Array.from({length:1001},()=>missing('x')[0])]){
  const f=fixture({trackers:rows}),r=await f.run();assert.equal(r.status,502);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);
 }
});

test('conflicting local aliases cannot claim more matched physical detectors than available local rows',async()=>{
 const f=fixture({locals:[{...locals()[0],external_device_id:gid(2),device_serial:'reconeyez:'+gid(3)}]}),r=await f.run();
 assert.equal(r.status,502);assert.equal(calls(f,'recon_finish_reconcile_v2').length,0);assert.equal(calls(f,'recon_fail_attempt_v2')[0].args.p_reason_code,'source_read_failed');
});

test('mixed field, shop and retired tracker rows retain every required missing field label with consistent family counts',async()=>{
 const rows=[
  ...['001','002','003'].map(tag=>({canonical_family:'Recon',unit_tag:tag,source_label:'Synthetic RI '+tag,tracker_state:'field_or_unknown'})),
  ...['004','005'].map(tag=>({canonical_family:'Recon',unit_tag:tag,source_label:'Synthetic shop '+tag,tracker_state:'shop'})),
  {canonical_family:'Recon',unit_tag:'006',source_label:'Synthetic retired',tracker_state:'retired'},
  ...['002','003'].map(tag=>({canonical_family:'Recon 2',unit_tag:tag,source_label:'Synthetic RII '+tag,tracker_state:'field_or_unknown'})),
  {canonical_family:'Recon 2',unit_tag:'010',source_label:'Synthetic RII shop',tracker_state:'shop'},
  {canonical_family:'Recon 2',unit_tag:'020',source_label:'Synthetic RII retired',tracker_state:'retired'}
 ];
 const f=fixture({trackers:rows}),r=await f.run();assert.equal(r.status,200);
 const coverage=finishArgs(f).p_diagnostics.tracker_coverage;
 assert.deepEqual(coverage.Recon,{tracker_total:6,field_or_unknown:3,shop:2,retired:1,matched_local_units:1,missing_local_units:5,
  missing_field_units:['Synthetic RI 002','Synthetic RI 003'],local_unit_namespace:'RI',namespace_inventory_present:true});
 assert.deepEqual(coverage['Recon 2'],{tracker_total:4,field_or_unknown:2,shop:1,retired:1,matched_local_units:1,missing_local_units:3,
  missing_field_units:['Synthetic RII 003'],local_unit_namespace:'RII',namespace_inventory_present:true});
 for(const family of Object.values(coverage))assert.equal(family.missing_field_units.length,Math.max(0,family.missing_local_units-family.shop-family.retired));
});

test('maximum ASCII/multibyte/quote-escaped missing-label fixtures hash the complete diagnostics within their bounded shape',async()=>{
 for(const label of ['x'.repeat(128),'🌵'.repeat(32),'"'.repeat(128)]){
  const rows=['Recon','Recon 2'].flatMap(family=>Array.from({length:1000},(_,i)=>({canonical_family:family,unit_tag:String(1000+i),source_label:label,tracker_state:'field_or_unknown'})));
  const f=fixture({trackers:rows}),r=await f.run();assert.equal(r.status,200);const diagnostics=finishArgs(f).p_diagnostics;
  const bytes=new TextEncoder().encode(owned.canonicalReconJson(diagnostics)).length;assert(bytes<=owned.RECON_V2_LIMITS.diagnostics_utf8_bytes);assert(bytes>250000);
  assert.equal(diagnostics.tracker_coverage['Recon 2'].missing_field_units.length,1000);assert.equal(r.body.reconeyez.diagnostics_sha256,await owned.reconOwnedFingerprint(diagnostics));
  const changed=clone(diagnostics);changed.tracker_coverage['Recon 2'].missing_field_units[999]='different-last-value';assert.notEqual(await owned.reconOwnedFingerprint(changed),r.body.reconeyez.diagnostics_sha256);
 }
});

test('other-provider helpers, Avigilon/witness sections and preexisting imports retain their reviewed bytes',()=>{
 const prefix=source.slice(source.indexOf('const cors='),source.indexOf('async function reconInventory'));
 const others=source.slice(source.indexOf('async function avigilonInventory'),source.indexOf('Deno.serve(async(req)'));
 assert.equal(hash(prefix),'229e5fbcd5581c351f62afa80e6152a656bf37a6d551062416ee70a2e6077dee');assert.equal(hash(others),'d8b268880663a514674c2a959a2d5940fb048af4b76d2204341491a9bb0f4aad');
 assert(source.startsWith('import { resolveStarResources, starResourceStatus } from "./star-resource-identity.js";\nimport { unmappedResourceDiagnostics } from "./unmapped-resource-diagnostics.js";\nimport "jsr:@supabase/functions-js/edge-runtime.d.ts";\nimport { createClient } from "npm:@supabase/supabase-js@2";\nimport { crypto } from "jsr:@std/crypto@1";\nimport {projectReconProviderInventory} from \'../_shared/reconProviderInventory.ts\';\nimport {scheduleCameraMhelpIntake} from \'../../../operations/intake/mhelpIntakeBackground.ts\';\n'));
});
