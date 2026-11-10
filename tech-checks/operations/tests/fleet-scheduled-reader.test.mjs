import test from 'node:test';
import assert from 'node:assert/strict';
import {readScheduledNativeEndpointSource,createScheduledNativeEndpointSourceRuntime} from '../../docs/fleet-scheduled-repair-20261104/source/trackerEndpointNativeSource.mjs';
const hash='a'.repeat(64),trackerHash='b'.repeat(64),now=Date.parse('2026-11-04T18:30:00Z');
function fixture(){
 const records=[{productId:'11',unitNumber:'Sniper 1',category:'Sniper',placement:'FIELD',lifecycle:'UNFLAGGED',binding:{guardCurrent:true,trackerId:'tracker-11',nativeUnitId:null,expectedGuard:'c'.repeat(64)}},{productId:'12',unitNumber:'Stand 2',category:'Stand',placement:'SHOP',lifecycle:'UNFLAGGED',binding:null}];
 const source={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',complete:true,reviewed:true,sourceSha256:hash,apiSync:{enabled:true,lastSuccessAt:new Date(now-60000).toISOString()},records,apiMissingRecords:[{productId:'99'}],trackerEndpointMembership:{contract:'COS_TRACKER_ENDPOINT_MEMBERSHIP_V1',sourceSha256:hash,records:records.map(r=>({productId:r.productId,trackerId:r.binding?.trackerId,bindingGuard:r.binding?.expectedGuard,readOnlyTracker:true}))}};
 const tracker={expectedMhelpSourceSha256:hash,trackerSourceSha256:trackerHash,records:records.map(r=>({productId:r.productId,placement:r.placement,publicIp:r.placement==='FIELD'?'8.8.8.8':null,reviewReasons:[]}))};
 return {source,tracker};
}
const run=(f,readTracker=async()=>f.tracker)=>readScheduledNativeEndpointSource({readBaseline:async()=>f.source,readTracker,signal:new AbortController().signal,now:()=>now});
test('scheduled source passes the same complete absence proof into the repaired tracker reader',async()=>{
 const f=fixture();let called=false;
 const result=await run(f,async(records,sourceSha,signal,absent)=>{called=true;assert.equal(records,f.source.records);assert.equal(sourceSha,hash);assert.equal(signal.aborted,false);assert.deepEqual(absent,['99']);return f.tracker;});
 assert.equal(called,true);assert.equal(result.contract,'COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1');assert.equal(result.complete,true);assert.equal(result.products.length,2);assert.equal(result.products[1].support,true);assert.equal(result.products[1].placement,'SHOP');assert.equal(result.products[1].ip,null);assert.deepEqual(result.products[0].holds,[]);
});
test('stale, incomplete, duplicate or mismatched baselines fail before the tracker read',async()=>{
 for(const mutate of [f=>f.source.complete=false,f=>f.source.reviewed=false,f=>f.source.apiSync.lastSuccessAt=new Date(now-46*60000).toISOString(),f=>f.source.apiSync.lastSuccessAt=new Date(now+1).toISOString(),f=>f.source.records.push(f.source.records[0]),f=>f.source.trackerEndpointMembership.sourceSha256=trackerHash]){
  const f=fixture();mutate(f);let reads=0;await assert.rejects(run(f,async()=>{reads++;return f.tracker;}));assert.equal(reads,0);
 }
});
test('missing, duplicate and present-as-absent IDs cannot certify source membership',async()=>{
 for(const absent of [undefined,[{productId:'99'},{productId:'99'}],[{productId:'11'}],[{productId:'name-match'}]]){const f=fixture();f.source.apiMissingRecords=absent;await assert.rejects(run(f));}
});
test('Do Not Use and identity or placement conflicts stay visible as held',async()=>{
 for(const mutate of [f=>f.source.records[0].unitNumber='Sniper 1 DO NOT USE',f=>f.source.records[0].holdReason='identity_conflict',f=>f.source.records[0].placementHeld=true,f=>f.source.records[0].possibleAliasUnitIds=['ambiguous'],f=>f.source.trackerEndpointMembership.records[0].bindingGuard=trackerHash,f=>f.tracker.records[0].placement='SHOP']){
  const f=fixture();mutate(f);const r=await run(f);assert.deepEqual(r.products[0].holds,['existing_source_hold']);assert.equal(r.products[0].productId,'11');
 }
});
test('per-equipment review reasons are preserved rather than manufactured as an outage',async()=>{
 const f=fixture();f.tracker.records[0].reviewReasons=['customer_mismatch'];const r=await run(f);assert.deepEqual(r.products[0].reviewReasons,['customer_mismatch']);assert.equal(Object.hasOwn(r.products[0],'status'),false);
});
test('changed, incomplete or duplicate tracker census is rejected',async()=>{
 for(const mutate of [f=>f.tracker.expectedMhelpSourceSha256=trackerHash,f=>f.tracker.records.pop(),f=>f.tracker.records[1].productId='11',f=>f.tracker.records[1].productId='98']){const f=fixture();mutate(f);await assert.rejects(run(f));}
});
test('scheduled routes reject missing secret, browser origin and invalid methods without reading private data',async()=>{
 let calls=0;const handler=createScheduledNativeEndpointSourceRuntime({enabled:true,getEnv:n=>n==='SUPABASE_URL'?'https://tughscoxralhofrckvxy.supabase.co':undefined,fetch:async()=>{calls++;throw Error('must not run');}});
 const post=headers=>new Request('https://example.test/endpoint-source',{method:'POST',headers:{'content-type':'application/json',...headers},body:'{"action":"read"}'});
 assert.equal((await handler(post({}))).status,403);assert.equal((await handler(post({origin:'https://example.test'}))).status,405);assert.equal((await handler(new Request('https://example.test/endpoint-source'))).status,405);assert.equal(calls,0);
});
test('authenticated failure is a source error, never an Offline reading',async()=>{
 const handler=createScheduledNativeEndpointSourceRuntime({enabled:true,getEnv:n=>n==='SUPABASE_URL'?'https://tughscoxralhofrckvxy.supabase.co':'synthetic',fetch:async url=>String(url).endsWith('camera-mhelp-readiness')?Response.json({authenticated:true}):new Response('',{status:503})});
 const response=await handler(new Request('https://example.test/endpoint-source',{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic'},body:'{"action":"read"}'}));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Scheduled endpoint source unavailable',code:'read_unavailable',retryable:true});
});

// The scheduled caller must be able to tell an inventory that cannot become
// acceptable by asking again from a read that merely failed this time.
const scheduledRead=async baseline=>{
 const handler=createScheduledNativeEndpointSourceRuntime({enabled:true,now:()=>now,getEnv:n=>n==='SUPABASE_URL'?'https://tughscoxralhofrckvxy.supabase.co':'synthetic',fetch:async url=>String(url).endsWith('camera-mhelp-readiness')?Response.json({authenticated:true}):typeof baseline==='function'?baseline():Response.json(baseline)});
 const response=await handler(new Request('https://example.test/endpoint-source',{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic'},body:'{"action":"read"}'}));
 return {status:response.status,body:await response.json()};
};
test('a stale or incomplete accepted inventory is labelled as a refusal that retrying cannot change',async()=>{
 const stale=fixture();stale.source.apiSync.lastSuccessAt=new Date(now-2700001).toISOString();
 assert.deepEqual(await scheduledRead(stale.source),{status:503,body:{error:'Scheduled endpoint source unavailable',code:'inventory_not_current',retryable:false}});
 for(const mutate of [s=>{s.complete=false;},s=>{s.reviewed=false;},s=>{s.apiSync.enabled=false;},s=>{s.records=[];},s=>{delete s.apiSync.lastSuccessAt;}]){const f=fixture();mutate(f.source);const r=await scheduledRead(f.source);assert.equal(r.status,503);assert.equal(r.body.code,'inventory_not_current');assert.equal(r.body.retryable,false);}
 const partial=fixture();partial.source.trackerEndpointMembership.records.pop();
 assert.deepEqual(await scheduledRead(partial.source),{status:503,body:{error:'Scheduled endpoint source unavailable',code:'inventory_incomplete',retryable:false}});
 // Exactly at the 45-minute limit is still current: the freshness rule itself is unchanged.
 const edge=fixture();edge.source.apiSync.lastSuccessAt=new Date(now-2700000).toISOString();const atLimit=await scheduledRead(edge.source);assert.notEqual(atLimit.body.code,'inventory_not_current');
});
test('a baseline read that fails, times out or is unreadable stays a temporary failure',async()=>{
 for(const failing of [()=>new Response('',{status:500}),()=>new Response('',{status:503}),()=>{throw new DOMException('timed out','TimeoutError');},()=>new Response('{"contract":',{status:200,headers:{'content-type':'application/json'}})]){
  assert.deepEqual(await scheduledRead(failing),{status:503,body:{error:'Scheduled endpoint source unavailable',code:'read_unavailable',retryable:true}});
 }
});
