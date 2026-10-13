import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
import {addressDigest,normalizeAddress} from '../../supabase/functions/camera-field-geocode/censusAddress.ts';
import {createGeocodeHandler} from '../../supabase/functions/camera-field-geocode/index.ts';
import {createOwnerCensusSourceVerifier,matchesOwnerCensusSource,OWNER_CENSUS_PROOF_CONTRACT} from '../../supabase/functions/camera-field-geocode/ownerCensusSource.ts';

const id='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
const address='123 Example Rd, Ste#700, Testville, TX 77001-1234',unitKey='SYNTHETIC 900',auditId='900';
const guard={nativeUnitId:id,nativeGuardSha256:'a'.repeat(64)};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
async function fixture(){
 const addressSha256=await addressDigest(address),binding={auditId,unitKey,address,addressSha256,censusOnlyGuard:guard};
 const row={id,unitNumber:unitKey,readOnly:false,placementSource:'owner',placement:'FIELD',placementAuditId:auditId,placementUnitKey:unitKey,status:'field',currentLocationType:'field',locationVerification:'address_changed',address};
 const proof={contract:OWNER_CENSUS_PROOF_CONTRACT,nativeUnitId:id,auditId,unitKey,addressSha256,nativeGuardSha256:guard.nativeGuardSha256,complete:true};
 const alias={contract:'COS_NATIVE_PLACEMENT_ALIAS_V1',writerContract:'COS_CAMERA_PLACEMENT_V2',unitId:id,unitNumber:unitKey,unitKey,auditId,proof:'b'.repeat(64),deviceIds:['901','902']};
 return {binding,row,proof,alias,snapshot:{placementProjectionVersion:2,items:[{...row}],inventoryItems:[{...row}],nativePlacementAliases:[alias],ownerCensusProofs:[proof]}};
}
test('a fresh actor-authenticated complete proof matches exact native placement and full-address binding',async()=>{
 const {snapshot,binding}=await fixture();assert.equal(await matchesOwnerCensusSource(snapshot,binding),true);
 // Retained historical GPS is not a current verified pin; the complete native
 // producer attests its separate history/GPS inputs in the immutable fingerprint.
 snapshot.items[0].hasUnitGps=true;snapshot.inventoryItems[0].hasUnitGps=true;
 assert.equal(await matchesOwnerCensusSource(snapshot,binding),true);
});
test('original Owner case and spacing match the normalized full-address cache without rewriting either source',async()=>{
 const {snapshot,binding}=await fixture(),original=' 123  Example Rd, Ste#700,  Testville, TX 77001-1234 ';
 binding.address=normalizeAddress(original);
 for(const row of [...snapshot.items,...snapshot.inventoryItems])row.address=original;
 const before=structuredClone({snapshot,binding});
 assert.equal(await matchesOwnerCensusSource(snapshot,binding),true);
 assert.deepEqual({snapshot,binding},before);
 snapshot.inventoryItems[0].address=original.replace('700','701');assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
});
for(const patch of [{contract:'unknown'},{complete:false},{complete:undefined},{auditId:'901'},{unitKey:'SYNTHETIC 901'},{addressSha256:'0'.repeat(64)},{nativeGuardSha256:'c'.repeat(64)},{nativeUnitId:token},{extra:'not allowed'}])test('incomplete or mismatched native proof is refused '+JSON.stringify(patch),async()=>{
 const {snapshot,binding}=await fixture();Object.assign(snapshot.ownerCensusProofs[0],patch);assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
});
for(const collection of ['ownerCensusProofs','nativePlacementAliases','items','inventoryItems'])test('missing or duplicate target in '+collection+' is refused',async()=>{
 const {snapshot,binding}=await fixture(),rows=snapshot[collection];snapshot[collection]=[];assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
 snapshot[collection]=[...rows,...rows];assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
});
for(const patch of [{placementSource:'imported'},{placement:'SHOP'},{status:'shop'},{currentLocationType:'shop'},{readOnly:true},{placementStatus:'needs_identity_review'},{locationVerification:'owner_verified'},{placementAuditId:'901'},{placementUnitKey:'SYNTHETIC 901'},{address:address.replace('700','701')}])test('current native presentation drift is refused '+JSON.stringify(patch),async()=>{
 const {snapshot,binding}=await fixture();Object.assign(snapshot.inventoryItems[0],patch);assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
});
for(const patch of [{contract:'unknown'},{writerContract:'unknown'},{auditId:'901'},{unitKey:'SYNTHETIC 901'},{proof:'bad'},{deviceIds:[]},{deviceIds:['901','901']},{deviceIds:['901',null]}])test('exact alias shape remains necessary '+JSON.stringify(patch),async()=>{
 const {snapshot,binding}=await fixture();Object.assign(snapshot.nativePlacementAliases[0],patch);assert.equal(await matchesOwnerCensusSource(snapshot,binding),false);
});
test('exact Owner proof reader uses fixed endpoint, exact four-field body and only the original bearer',async()=>{
 const {snapshot,binding}=await fixture();let calls=0;
 const verify=createOwnerCensusSourceVerifier(async(url,init)=>{
  calls++;assert.equal(url,'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages');
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal);
  assert.deepEqual(init.headers,{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Accept:'application/json'});
  assert.deepEqual(JSON.parse(init.body),{path:'/api/field-map/'+id+'/owner-census-proof',method:'POST',body:{auditId,unitKey,addressSha256:binding.addressSha256,nativeGuardSha256:guard.nativeGuardSha256}});return json(snapshot);
 });
 assert.equal(await verify(binding,'Bearer synthetic-owner'),true);assert.equal(calls,1);
 assert.equal(await verify(binding,''),false);assert.equal(await verify(binding,'synthetic-key'),false);assert.equal(calls,1);
});
test('missing new native contract never falls back to imported key or partial snapshot',async()=>{
 const {snapshot,binding}=await fixture();delete snapshot.ownerCensusProofs;
 let calls=0;const verify=createOwnerCensusSourceVerifier(async()=>{calls++;return json(snapshot);});
 assert.equal(await verify(binding,'Bearer synthetic-owner'),false);assert.equal(calls,1);
});
test('concurrent actors are passed independently; another Owner fingerprint is rejected',async()=>{
 const {snapshot,binding}=await fixture(),other=structuredClone(snapshot);other.ownerCensusProofs[0].nativeGuardSha256='c'.repeat(64);
 const calls=[],verify=createOwnerCensusSourceVerifier(async(_url,init)=>{const actor=init.headers.Authorization;calls.push(actor);return json(actor==='Bearer synthetic-first'?snapshot:other);});
 assert.deepEqual(await Promise.all([verify(binding,'Bearer synthetic-first'),verify(binding,'Bearer synthetic-second')]),[true,false]);
 assert.deepEqual(calls,['Bearer synthetic-first','Bearer synthetic-second']);
});
for(const [label,response] of [
 ['HTTP',()=>new Response('synthetic private response',{status:403})],['empty',()=>new Response(null)],
 ['invalid JSON',()=>new Response('synthetic private response')],['oversized',()=>new Response('x'.repeat(4194305))],
 ['invalid UTF8',()=>new Response(new Uint8Array([255]))],['network',()=>{throw Error('synthetic private network data');}],
])test('actor source '+label+' error is bounded, redacted and not retried',async()=>{
 const {binding}=await fixture();let calls=0;const verify=createOwnerCensusSourceVerifier(async()=>{calls++;return response();});
 await assert.rejects(verify(binding,'Bearer synthetic-owner'),error=>error.message==='Owner source verification unavailable');assert.equal(calls,1);
});
test('actor source timeout fails closed with no source retry',async()=>{
 const {binding}=await fixture(),original=globalThis.setTimeout;let calls=0;globalThis.setTimeout=(fn,_ms,...args)=>original(fn,0,...args);
 try{
  const verify=createOwnerCensusSourceVerifier(async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('private')),{once:true}));});
  await assert.rejects(verify(binding,'Bearer synthetic-owner'),/Owner source verification unavailable/);assert.equal(calls,1);
 }finally{globalThis.setTimeout=original;}
});
for(const stale of [false,true])for(const normalizedCache of [false,true])test('worker fresh exact proof reads preserve full cache binding, drift='+stale+', normalizedCache='+normalizedCache,async()=>{
 const {snapshot,binding}=await fixture();let nativeReads=0,providerCalls=0,finishes=0,claimed=false;
 if(normalizedCache){binding.address=normalizeAddress(address);for(const row of [...snapshot.items,...snapshot.inventoryItems])row.address='  '+address.replace('Example Rd','Example  Rd')+'  ';}
 const originalOwnerText=snapshot.items[0].address;
 const requestFetch=async(url)=>{
  if(url.includes('cos-operations-pages')){nativeReads++;const fresh=structuredClone(snapshot);if(stale&&nativeReads===3)fresh.ownerCensusProofs[0].nativeGuardSha256='c'.repeat(64);return json(fresh);}
  assert.equal(new URL(url).hostname,'geocoding.geo.census.gov');assert.equal(claimed,true);providerCalls++;
  return json({result:{addressMatches:[{matchedAddress:'123 Example Rd, Testville, TX 77001-1234',coordinates:{x:-95,y:30}}]}});
 };
 const handler=createGeocodeHandler({verifyFleetActor:async()=>true,verifyOwnerCensusSource:createOwnerCensusSourceVerifier(requestFetch),fetch:requestFetch,geocodioApiKey:'synthetic',rpc:async(name,args)=>{
  if(name==='cos_field_geocode_list_due')return [{...binding,status:'invalid_address',censusOnly:true,censusOnlyState:'ready'}];
  if(name==='cos_field_geocode_claim'){assert.equal(args.p_audit_id,'owner_one_census_v1:'+auditId);assert.equal(args.p_address,binding.address);assert.equal(args.p_address_sha256,binding.addressSha256);claimed=true;return {claimed:true,claimToken:token,censusOnly:true,censusOnlyGuard:guard,record:{leaseUntil:new Date(Date.now()+220000).toISOString()}};}
  if(name==='cos_field_geocode_finish'){assert.equal(args.p_address,binding.address);assert.equal(args.p_address_sha256,binding.addressSha256);finishes++;return {accepted:true,record:{status:'success'}};}
  throw Error('Unexpected RPC');
 }});
 const response=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-owner'},body:JSON.stringify({auditId,unitKey})})),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.allowance,'consumed');assert.equal(body.results[0].status,stale?'superseded':'success');
 assert.equal(nativeReads,3);assert.equal(providerCalls,1);assert.equal(finishes,stale?0:1);assert.deepEqual(body.fallbackResults,[]);
 assert.equal(snapshot.items[0].address,originalOwnerText);assert.equal(snapshot.inventoryItems[0].address,originalOwnerText);
});

test('source verifier80s deadline includes asynchronous canonical digest validation',async()=>{
 const {snapshot,binding}=await fixture(),originalNow=Date.now,originalDigest=crypto.subtle.digest;let clock=originalNow(),started=clock,calls=0;
 Date.now=()=>clock;
 crypto.subtle.digest=async function(...args){const result=await originalDigest.apply(this,args);clock=started+80001;return result;};
 try{
  const verify=createOwnerCensusSourceVerifier(async()=>{calls++;return json(snapshot);});
  await assert.rejects(verify(binding,'Bearer synthetic-owner'),/Owner source verification unavailable/);assert.equal(calls,1);
 }finally{Date.now=originalNow;crypto.subtle.digest=originalDigest;}
});
test('source verifier remains bounded at80s and accepts complete proof at79s without retry',async()=>{
 const {snapshot,binding}=await fixture(),originalNow=Date.now,originalTimer=globalThis.setTimeout;let clock=originalNow(),started=clock,calls=0;const budgets=[];
 Date.now=()=>clock;globalThis.setTimeout=(fn,ms,...args)=>{budgets.push(ms);return originalTimer(fn,ms,...args);};
 try{
  const verify=createOwnerCensusSourceVerifier(async()=>{calls++;clock=started+79000;return json(snapshot);});
  assert.equal(await verify(binding,'Bearer synthetic-owner'),true);assert.equal(calls,1);assert(budgets.includes(80000));
 }finally{Date.now=originalNow;globalThis.setTimeout=originalTimer;}
});
