import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {addressDigest} from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
import {checkedOwnerCensusOnlyRow,censusOnlyOwnerAddress,censusOnlyReason,OWNER_ONE_CENSUS_PREFIX} from '../../supabase/functions/camera-field-geocode/ownerCensusOnly.ts';

// Synthetic only. This ledger models atomic SQL decisions, not a concurrency proof
// for PostgreSQL; the companion database tests establish the durable hold itself.
const nativeUnitId='11111111-1111-4111-8111-111111111111';
const claimToken='22222222-2222-4222-8222-222222222222';
const full='123 Example Rd, Ste#700, Testville, TX 77001-1234';
const base='123 Example Rd, Testville, TX 77001-1234';
const target={auditId:'900',unitKey:'SYNTHETIC 900'};
const guard={nativeUnitId,nativeGuardSha256:'a'.repeat(64)};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const match=(matchedAddress=base)=>({matchedAddress,coordinates:{x:-95,y:30}});
const payload=(matches=[match()])=>({result:{addressMatches:matches}});
const request=(body=target,cron=false,authorization='Bearer synthetic-actor')=>new Request('https://synthetic.invalid',{method:'POST',headers:{...(cron?{'x-camera-cron-secret':'synthetic-secret'}:{}),...(authorization?{authorization}:{})},body:JSON.stringify(body)});

async function harness({provider,verify,claimResult,finishError=false,claimError=false,rowPatch={},omitVerifier=false,now=()=>Date.UTC(2026,0,1)}={}){
 const row={...target,address:full,addressSha256:await addressDigest(full),censusOnly:true,censusOnlyGuard:guard,...rowPatch};
 const ledger={consumed:false,claims:0,status:'pending',providerCalls:0,sourceReads:0};
 const calls=[],finishes=[];
 const rpc=async(name,args)=>{
  calls.push({name,args});
  if(name==='verify_camera_health_cron_secret')return args.candidate==='synthetic-secret';
  if(name==='cos_field_geocode_list_due')return args.p_audit_id?[{...row,status:ledger.status,censusOnlyState:ledger.consumed?'consumed':'ready',...rowPatch}]:[];
  if(name==='cos_field_geocode_claim'){
   assert.equal(args.p_audit_id,OWNER_ONE_CENSUS_PREFIX+target.auditId);
   assert.equal(args.p_unit_key,target.unitKey);assert.equal(args.p_address,full);assert.equal(args.p_address_sha256,row.addressSha256);
   const already=ledger.consumed;ledger.consumed=true;if(!already)ledger.claims++;
   if(claimError&&!already)throw Error('synthetic uncertain claim commit');
   return claimResult??{claimed:!already,...(!already?{claimToken}:{}),censusOnly:true,censusOnlyGuard:guard,record:{status:ledger.status,censusOnlyState:'consumed',leaseUntil:new Date(now()+120000).toISOString()}};
  }
  if(name==='cos_field_geocode_finish'){
   finishes.push(args);assert.equal(args.p_audit_id,target.auditId);assert.equal(args.p_address,full);assert.equal(args.p_address_sha256,row.addressSha256);assert.equal(args.p_claim_token,claimToken);
   if(finishError)throw Error('synthetic unknown finish outcome');
   ledger.status=args.p_status;return {accepted:true,record:{status:args.p_status}};
  }
  if(name==='cos_field_geocode_fallback_list_due')return [];
  throw Error('Unexpected fixture RPC: '+name);
 };
 const options={rpc,verifyFleetActor:async()=>true,geocodioApiKey:'synthetic-key',now,
  ...(!omitVerifier?{verifyOwnerCensusSource:async(binding,authorization)=>{
   ledger.sourceReads++;assert.equal(binding.auditId,target.auditId);assert.equal(binding.address,full);assert.deepEqual(binding.censusOnlyGuard,guard);
   assert.match(authorization,/^Bearer synthetic-/);return verify?verify(binding,ledger.sourceReads,authorization):true;
  }}:{}),
  fetch:async(url,init)=>{
   ledger.providerCalls++;assert.equal(ledger.consumed,true);
   const sent=new URL(url);assert.equal(sent.origin,'https://geocoding.geo.census.gov');assert.equal(sent.pathname,'/geocoder/locations/address');
   assert.deepEqual(Object.fromEntries(sent.searchParams),{street:'123 Example Rd',city:'Testville',state:'TX',zip:'77001-1234',benchmark:'Public_AR_Current',format:'json'});
   assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal);
   assert.deepEqual(init.headers,{Accept:'application/json'});assert.equal(init.body,undefined);
   for(const privateValue of [target.unitKey,nativeUnitId,guard.nativeGuardSha256,'Ste','synthetic-key','synthetic-secret'])assert.equal(url.includes(privateValue),false);
   return provider?provider(url,init):json(payload());
  }};
 const run=async(body=target,cron=false,authorization='Bearer synthetic-actor')=>{const response=await createGeocodeHandler(options)(request(body,cron,authorization));return {response,body:await response.json()};};
 return {row,ledger,calls,finishes,options,run};
}
const noFallback=h=>assert.equal(h.calls.some(({name})=>name.startsWith('cos_field_geocode_fallback_')||name.startsWith('cos_imported_')),false);

test('explicit Owner target consumes before one minimal request, rechecks source, finishes original full binding',async()=>{
 const h=await harness(),before=structuredClone(h.row),{response,body}=await h.run();
 assert.equal(response.status,200);assert.equal(body.censusOnly,true);assert.equal(body.allowance,'consumed');assert.deepEqual(body.results,[{auditId:target.auditId,status:'success',censusOnly:true,allowance:'consumed'}]);
 assert.deepEqual(body.fallbackResults,[]);assert.equal(body.importedResults,null);
 assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,1);assert.equal(h.ledger.sourceReads,3);assert.equal(h.finishes.length,1);assert.deepEqual(h.row,before);noFallback(h);
});

for(const [label,provider,status] of [
 ['no match',()=>json(payload([])),'no_match'],['ambiguous',()=>json(payload([match(),match()])),'no_match'],
 ['component mismatch',()=>json(payload([match(base.replace('77001','77002'))])),'no_match'],
 ['conflicting ZIP+4',()=>json(payload([match(base.replace('1234','9999'))])),'no_match'],
 ['invalid coordinates',()=>json(payload([{...match(),coordinates:{x:181,y:30}}])),'no_match'],
 ['HTTP error',()=>json({},503),'provider_error'],['rate limit',()=>json({},429),'provider_error'],
 ['network uncertainty',()=>{throw Error('synthetic private provider error');},'provider_error'],
 ['malformed response',()=>new Response('synthetic private response'),'provider_error'],
 ['redirect refusal',(_url,init)=>{assert.equal(init.redirect,'error');throw new TypeError('redirect');},'provider_error'],
])test(label+' stays terminal under its hold across duplicate requests and next-day scheduler',async()=>{
 let time=Date.UTC(2026,0,1);const h=await harness({provider,now:()=>time});
 const first=await h.run();assert.equal(first.response.status,200);assert.equal(first.body.results[0].status,status);
 assert.equal(h.finishes[0].p_reason,status==='no_match'?'no_match':label==='malformed response'?'invalid_response':'provider_unavailable');
 assert.equal((await h.run()).body.censusOnly,true);time+=86400000;await h.run();
 assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,1);assert.equal(h.finishes.length,1);noFallback(h);
 await h.run({},true);assert.equal(h.ledger.providerCalls,1);assert.equal(h.calls.filter(c=>c.name==='cos_field_geocode_claim').length,1);
});

test('timeout abort consumes once, records provider_error and never retries',async()=>{
 const original=globalThis.setTimeout;globalThis.setTimeout=(fn,_ms,...args)=>original(fn,0,...args);
 try{
  const h=await harness({provider:(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('synthetic timeout')),{once:true}))});
  assert.equal((await h.run()).body.results[0].status,'provider_error');assert.equal(h.finishes[0].p_reason,'provider_timeout');await h.run();assert.equal(h.ledger.providerCalls,1);noFallback(h);
 }finally{globalThis.setTimeout=original;}
});

test('concurrent targeted calls share one durable claim and never fallback',async()=>{
 let release,started;const wait=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const h=await harness({provider:async()=>{started();await wait;return json(payload());}});
 const first=h.run();await entered;const duplicate=await h.run();assert.equal(duplicate.body.censusOnly,true);release();await first;
 assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,1);assert.equal(h.finishes.length,1);noFallback(h);
});

for(const claimError of [true,false])test((claimError?'uncertain claim before fetch':'unknown finish after fetch')+' keeps its consumed allowance across retries',async()=>{
 const h=await harness({claimError,finishError:!claimError}),first=await h.run();assert.equal(first.response.status,503);
 assert.equal(first.body.censusOnly,true);assert.match(first.body.error,/no automatic retry or fallback/);
 assert.equal(first.body.allowance,claimError?'unknown':'consumed');assert.equal(first.body.error.includes('synthetic'),false);
 const duplicate=await h.run();assert.equal(duplicate.body.allowance,'consumed');
 assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,claimError?0:1);noFallback(h);
});

for(const cause of ['native identity drift','device roster drift','Owner audit drift','full address drift','new verified GPS'])test(cause+' before claim prevents provider and claim',async()=>{
 const h=await harness({verify:async()=>false}),{body}=await h.run();assert.equal(body.results[0].status,'superseded');
 assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);assert.equal(h.finishes.length,0);noFallback(h);
});
for(const throws of [false,true])test('native post-read '+(throws?'unavailable':'drift')+' cannot publish or refill allowance',async()=>{
 const h=await harness({verify:async(_binding,n)=>{if(n===3){if(throws)throw Error('synthetic source unavailable');return false;}return true;}}),first=await h.run();
 assert.equal(first.response.status,throws?503:200);assert.equal(h.finishes.length,0);assert.equal(h.ledger.providerCalls,1);
 await h.run();assert.equal(h.ledger.providerCalls,1);assert.equal(h.ledger.claims,1);noFallback(h);
});
for(const throws of [false,true])test('native post-claim '+(throws?'uncertainty':'drift')+' burns allowance before any provider send',async()=>{
 const h=await harness({verify:async(_binding,n)=>{if(n===2){if(throws)throw Error('synthetic source unavailable');return false;}return true;}}),first=await h.run();
 assert.equal(first.response.status,throws?503:200);assert.equal(first.body.allowance,'consumed');assert.equal(h.finishes.length,0);
 await h.run();assert.equal(h.ledger.providerCalls,0);assert.equal(h.ledger.claims,1);noFallback(h);
});
test('unconfigured fresh-native verifier fails closed without consuming or sending',async()=>{
 const h=await harness({omitVerifier:true}),{response,body}=await h.run();assert.equal(response.status,503);assert.equal(body.censusOnly,true);
 assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('consumed list marker returns saved status without verifier, claim or provider',async()=>{
 const h=await harness({omitVerifier:true,rowPatch:{censusOnlyState:'consumed',status:'provider_error'}}),{response,body}=await h.run();
 assert.equal(response.status,200);assert.equal(body.allowance,'consumed');assert.equal(body.results[0].status,'provider_error');
 assert.equal(h.ledger.sourceReads,0);assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
for(const notBefore of [undefined,'2026-01-01T00:08:00Z'])test('database draining marker preserves allowance and performs no work '+notBefore,async()=>{
 const h=await harness({omitVerifier:true,rowPatch:{censusOnlyState:'draining',...(notBefore?{censusOnlyNotBefore:notBefore}:{})},now:()=>Date.UTC(2030,0,1)}),{response,body}=await h.run();
 assert.equal(response.status,200);assert.equal(body.allowance,'available');assert.equal(body.results[0].status,'draining');assert.equal(body.results[0].censusOnlyNotBefore,notBefore);
 assert.equal(h.ledger.sourceReads,0);assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('a slow native proof cannot start a claim after the request time budget is exhausted',async()=>{
 let clock=0;const h=await harness({now:()=>clock,verify:async()=>{clock=90000;return true;}}),{body}=await h.run();
 assert.equal(body.censusOnly,true);assert.equal(body.allowance,'unknown');assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('guarded-only extended budget accommodates three slow fresh proofs within its lease',async()=>{
 let clock=0;const h=await harness({now:()=>clock,verify:async()=>{clock+=40000;return true;}}),{response,body}=await h.run();
 assert.equal(response.status,200);assert.equal(body.results[0].status,'success');assert.equal(clock,120000);
 assert.equal(h.ledger.sourceReads,3);assert.equal(h.ledger.providerCalls,1);assert.equal(h.finishes.length,1);noFallback(h);
});
test('ordinary handler retains its existing 100-second deadline',async()=>{
 let clock=0,claims=0;const handler=createGeocodeHandler({now:()=>clock,verifyFleetActor:async()=>true,rpc:async(name)=>{
  if(name==='cos_field_geocode_list_due'){clock=70000;return [{...target,address:full}];}
  claims++;throw Error('Ordinary deadline must prevent a new claim');
 },fetch:async()=>{throw Error('No fetch permitted');}});
 const response=await handler(request()),body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.results,[]);assert.equal(body.censusOnly,undefined);assert.equal(claims,0);
});
for(const leaseUntil of [undefined,'invalid','2025-12-31T23:59:59Z','2026-01-01T00:00:45Z'])test('uncertain, expired or short lease burns allowance without native read or provider '+leaseUntil,async()=>{
 const h=await harness({claimResult:{claimed:true,claimToken,censusOnly:true,censusOnlyGuard:guard,record:{leaseUntil}}}),{body}=await h.run();
 assert.equal(body.allowance,'consumed');assert.equal(h.ledger.sourceReads,1);assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('native post-claim delay past safe lease margin prevents the provider send',async()=>{
 let clock=Date.UTC(2026,0,1);const h=await harness({now:()=>clock,verify:async(_binding,n)=>{if(n===2)clock+=55000;return true;}}),{body}=await h.run();
 assert.equal(body.allowance,'consumed');assert.equal(body.results[0].status,'held');assert.equal(h.ledger.claims,1);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});

for(const patch of [{censusOnlyState:'pending'},{addressSha256:'0'.repeat(64)},{censusOnlyGuard:{}},{censusOnlyGuard:{...guard,extra:true}},{censusOnlyGuard:{...guard,nativeGuardSha256:'invalid'}},{auditId:'901'},{unitKey:'SYNTHETIC 901'}])test('malformed or mismatched policy row fails closed '+JSON.stringify(patch),async()=>{
 const h=await harness({rowPatch:patch}),{response}=await h.run();assert.equal(response.status,503);assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
for(const claimResult of [{claimed:true,claimToken},{claimed:true,claimToken,censusOnly:true},{claimed:true,claimToken:'invalid',censusOnly:true,censusOnlyGuard:guard},{claimed:true,claimToken,censusOnly:true,censusOnlyGuard:{...guard,nativeGuardSha256:'b'.repeat(64)}}])test('claim must echo exact policy and valid token '+JSON.stringify(claimResult),async()=>{
 const h=await harness({claimResult}),{response}=await h.run();assert.equal(response.status,503);assert.equal(h.ledger.providerCalls,0);assert.equal(h.finishes.length,0);noFallback(h);
});
test('policy enrolled between ordinary list and claim cannot send or fall back',async()=>{
 const h=await harness({rowPatch:{censusOnly:false}}),rpc=h.options.rpc;
 h.options.rpc=async(name,args)=>name==='cos_field_geocode_claim'?{claimed:false,censusOnly:true,censusOnlyGuard:guard,record:{status:'pending'}}:rpc(name,args);
 const {response,body}=await h.run();assert.equal(response.status,503);assert.equal(body.censusOnly,true);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});

test('cron secret with original actor proof can invoke one exact enrolled target without sweeps',async()=>{
 const h=await harness(),{response,body}=await h.run(target,true);assert.equal(response.status,200);assert.equal(body.censusOnly,true);assert.equal(body.importedResults,null);
 const list=h.calls.find(c=>c.name==='cos_field_geocode_list_due');assert.equal(list.args.p_audit_id,target.auditId);assert.equal(list.args.p_unit_key,target.unitKey);
 assert.equal(h.ledger.providerCalls,1);noFallback(h);
});
test('cron secret alone cannot replace actor proof or consume a ready allowance',async()=>{
 const h=await harness(),{response,body}=await h.run(target,true,'');assert.equal(response.status,503);assert.equal(body.allowance,'unknown');
 assert.equal(h.ledger.sourceReads,0);assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('source verification binds original authorization to each invocation without shared state',async()=>{
 const observed=[],h=await harness({verify:async(_binding,_n,authorization)=>{observed.push(authorization);return true;}});
 await h.run(target,false,'Bearer synthetic-first');assert.deepEqual(observed,['Bearer synthetic-first','Bearer synthetic-first','Bearer synthetic-first']);
 await h.run(target,false,'Bearer synthetic-second');assert.deepEqual(observed,['Bearer synthetic-first','Bearer synthetic-first','Bearer synthetic-first']);
});
for(const rows of [[],[{...target,address:full,censusOnly:false}]])test('targeted cron refuses missing or ordinary enrollment '+rows.length,async()=>{
 const h=await harness(),rpc=h.options.rpc;h.options.rpc=(name,args)=>name==='cos_field_geocode_list_due'?Promise.resolve(rows):rpc(name,args);
 assert.equal((await h.run(target,true)).response.status,409);assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);noFallback(h);
});
test('scheduled cron cannot consume a guarded row even if a queue unexpectedly returns it',async()=>{
 const h=await harness(),rpc=h.options.rpc;h.options.rpc=(name,args)=>name==='cos_field_geocode_list_due'?Promise.resolve([{...h.row,censusOnlyState:'ready'}]):rpc(name,args);
 const {body}=await h.run({},true);assert.equal(body.results[0].status,'held');assert.equal(h.ledger.claims,0);assert.equal(h.ledger.providerCalls,0);
});
for(const cron of [false,true])for(const body of [{...target,address:base},{...target,censusOnly:true},{auditId:target.auditId},{unitKey:target.unitKey},{auditId:OWNER_ONE_CENSUS_PREFIX+target.auditId,unitKey:target.unitKey}])test('HTTP cannot supply an address, opt-in, prefixed audit or partial target '+cron+' '+Object.keys(body).join(','),async()=>{
 const h=await harness();assert.equal((await h.run(body,cron)).response.status,400);assert.equal(h.calls.some(c=>c.name==='cos_field_geocode_list_due'),false);assert.equal(h.ledger.providerCalls,0);
});

test('Census-only structured adapter also preserves ZIP+4 for a non-suite source',async()=>{
 let sends=0;const result=await censusOnlyOwnerAddress(base,async(url)=>{sends++;assert.equal(new URL(url).searchParams.get('zip'),'77001-1234');return json(payload());});
 assert.equal(result.status,'success');assert.equal(sends,1);
});
test('unsafe suite cannot reach provider and invalid immutable source cannot be checked',async()=>{
 const address=full.replace('Ste#700','Ste#700, Gate code 9999');let sends=0;
 assert.equal((await censusOnlyOwnerAddress(address,async()=>{sends++;throw Error();})).status,'invalid_address');assert.equal(sends,0);
 assert.equal(await checkedOwnerCensusOnlyRow({...target,address,addressSha256:await addressDigest(address),censusOnly:true,censusOnlyState:'ready',censusOnlyGuard:guard}),null);
});
test('unexpected provider reasons cannot be persisted as a fabricated diagnosis',()=>{
 assert.throws(()=>censusOnlyReason({status:'provider_error',reason:'synthetic unexpected diagnostic'}),/Unsafe Census-only reason/);
 for(const reason of ['provider_timeout','provider_unavailable','invalid_response'])assert.equal(censusOnlyReason({status:'provider_error',reason}),reason);
});
