// Draft check for the camera-health-sweep endpoint-authority retry fix.
//
// The deployed v96 source is not stored in this repository. Supply it with
//   COS_SWEEP_V96_SOURCE=/path/to/camera-health-sweep/index.ts
// The recipe is applied to that exact file (its SHA-256 is pinned) and the
// tests run the real result: the whole bundle is loaded, and the deployed
// handler, authority factory and reader are called as they are. Only the
// platform edges are replaced: the database client, outbound fetch, the TCP
// connect and the clock. Without the file every test is skipped.
// Each authority object holds a timer until its own deadline, as in
// production, so run this file with --test-force-exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';

const recipe=JSON.parse(readFileSync(new URL('../../docs/camera-health-sweep-endpoint-retry-20261110/recipe.json',import.meta.url),'utf8'));
const baselinePath=process.env.COS_SWEEP_V96_SOURCE;
const available=!!baselinePath&&existsSync(baselinePath);
const sha=text=>createHash('sha256').update(text).digest('hex');
const baseline=available?readFileSync(baselinePath,'utf8'):'';
let patched=baseline,unfenced=baseline;
if(available)for(const edit of recipe.edits){assert.equal(patched.split(edit.before).length-1,edit.occurrences,edit.name);patched=patched.split(edit.before).join(edit.after);if(edit.name!=='collector-write-fence')unfenced=unfenced.split(edit.before).join(edit.after);}
const skip=available?false:'set COS_SWEEP_V96_SOURCE to the exact deployed v96 index.ts';

const H='a'.repeat(64),T='b'.repeat(64),SWEEP='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-health-sweep';
const label=(code,retryable)=>new Response(JSON.stringify({error:'Scheduled endpoint source unavailable',code,retryable}),{status:503,headers:{'content-type':'application/json'}});
const refused=(code='inventory_not_current')=>label(code,false);
const temporary=()=>label('read_unavailable',true);

/** Load a complete bundle (deployed or patched) with only its platform edges replaced. */
function load(text,{upstream,shardReply}={}){
 const program=text.replace(/^import [^\n]*\n/gm,'').replace(/^export \{[^}]*\};?\s*$/gm,'').replace(/^export /gm,'');
 const state={clock:Date.parse('2026-11-10T21:15:00Z'),upstream:0,shards:[],published:null,handler:null,rpcs:[],tables:{}};
 class Clock extends Date{constructor(...a){a.length?super(...a):super(state.clock);}static now(){return state.clock;}}
 const source=()=>Response.json({contract:'COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1',complete:true,sourceSha256:H,trackerSha256:T,observedAt:state.clock,products:[{productId:'11',placement:'FIELD',lifecycle:'UNFLAGGED',support:false,holds:[],reviewReasons:[],ip:'8.8.8.8'}]});
 const answer=value=>{const p=Promise.resolve(value);const chain=new Proxy(function(){},{get(_,k){if(k==='then')return p.then.bind(p);if(k==='catch')return p.catch.bind(p);if(k==='finally')return p.finally.bind(p);return()=>chain;},apply(){return chain;}});return chain;};
 const rpc=(name,args)=>{
  state.rpcs.push(name);
  if(name==='publish_camera_connection_v1')return {data:{ok:true},error:null};
  if(name==='cos_tracker_endpoint_commit_v1')return {data:{committed:true},error:null};
  if(name==='verify_camera_health_cron_secret')return {data:args.candidate==='synthetic',error:null};
  if(name==='cos_tracker_endpoint_source_v1')return {data:state.published,error:null};
  if(name==='cos_tracker_endpoint_claims_v1')return {data:{complete:true,observedAt:state.clock,devices:[{id:1,product_id:'11',connection_revision:1,public_ip:'8.8.8.8',expected_ports:[80],activation_state:'active',monitoring_enabled:true,device_name:'Cam 1',unit_key:'u1',organization:'COS'}],claims:[]},error:null};
  if(name==='cos_tracker_endpoint_publish_v1'){state.published={...args.p_source,assignmentEpoch:'c'.repeat(64),collisionEpoch:'d'.repeat(64),generation:(BigInt(args.p_expected)+1n).toString()};return {data:true,error:null};}
  return {data:null,error:null};
 };
 const db={rpc:(n,a)=>answer(rpc(n,a)),from:table=>answer({data:state.tables[table]||[],error:null,count:0})};
 const fetch=async(url,init={})=>{
  url=String(url);
  if(url.endsWith('/endpoint-source')){state.upstream++;state.clock+=40;const reply=await upstream(state.upstream,{source,state});return reply;}
  if(url===SWEEP){
   const body=JSON.parse(init.body);state.shards.push(body);
   const response=await state.handler(new Request(url,{method:'POST',headers:init.headers,body:init.body}));
   return shardReply?shardReply(response,body,state):response;
  }
  return new Response('{}',{status:404});
 };
 const context=vm.createContext({console:{log(){},warn(){},error(){},info(){}},setTimeout,clearTimeout,setInterval,clearInterval,AbortController,AbortSignal,Response,Request,Headers,TextEncoder,TextDecoder,ReadableStream,crypto,URL,URLSearchParams,structuredClone,queueMicrotask,Promise,JSON,Math,Date:Clock,
  fetch,createClient:()=>db,Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://goqrnolcvqnirjmzaeyk.supabase.co':'synthetic'},serve:h=>{state.handler=h;},connect:()=>Promise.reject(new Error('connection refused'))}});
 vm.runInContext(program+'\n;globalThis.__sweep={scheduledEndpointFromExistingCron,createScheduledEndpointEvidence,scheduledNativeSourceReader,collectScheduledDirect,setProduce:f=>{produce=f;}};',context,{filename:'camera-health-sweep.js'});
 const request=()=>new Request(SWEEP,{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic'},body:'{}'});
 return {state,db,api:context.__sweep,source,
  cycle:async()=>{const before=state.upstream,from=state.shards.length;const response=await state.handler(request());return {status:response.status,body:await response.json(),calls:state.upstream-before,shards:state.shards.slice(from)};},
  factory:(blocked=null,ms=95_000)=>context.__sweep.scheduledEndpointFromExistingCron(db,request(),state.clock+ms,blocked),
  advance:ms=>{state.clock+=ms;}};
}
const device={productId:'11',device:{id:1,connection_revision:1},host:'8.8.8.8',ports:[80]};
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));

test('the recipe applies to exactly the deployed v96 source and produces the recorded result',{skip},()=>{
 assert.equal(recipe.baselineVersion,96);assert.equal(sha(baseline),recipe.baselineSha256,'COS_SWEEP_V96_SOURCE is not the exact deployed v96 file');assert.equal(sha(patched),recipe.resultSha256);
 for(const edit of recipe.edits)assert.ok(/scheduledSourceRefusal|native_source_|ScheduledEndpointEvidence|ScheduledSourceBinding|scheduledEndpointFromExistingCron|endpointAuthority|endpoint_authority|readAuthority|refreshing|diagnostics|fetchSource|nativeSnapshot|begin\(candidate\)|noteShardAuthority|Endpoint authority blocked|publish_camera_connection_v1/.test(edit.before+edit.after),edit.name);
});
test('freshness, identity and hold guards are untouched',{skip},()=>{
 const count=(text,needle)=>text.split(needle).length-1;
 for(const guard of ['now() - value.readAt <= 26e3','now() - first.readAt > 26e3','now() - readAt > 26e3','if (evidence && !tickets[i]) return held("endpoint_authority_unverified");','if (products.length !== 1) return null;','throw Error("Scheduled target mismatch");','retained_claims_incomplete','matches(current.authority, a)','if (!secret || secret.length > 1024','if (nativeSnapshot && age >= 0 && age <= 20e3) return nativeSnapshot;','fallbackAge >= 0 && fallbackAge <= 26e3'])
  {assert.ok(count(baseline,guard)>0,guard);assert.equal(count(patched,guard),count(baseline,guard),guard);}
 assert.equal(count(patched,'return json({ error: "Endpoint authority preparation failed" }, 503);'),0);
 for(const kept of ['collectScheduledStar4Live(db, tcp,','const routers = shardCount > 1 ? dueRouters.filter(','const shardCount = 4;','for (let attempt = 0; attempt < 2; attempt++) {'])assert.equal(count(patched,kept),count(baseline,kept),kept);
});

// ---- reader ---------------------------------------------------------------
test('reader: a labelled refusal is asked for once; anything else keeps exactly one quick retry',{skip},async()=>{
 const run=async reply=>{let calls=0;const w=load(patched,{upstream:()=>temporary()});const read=w.api.scheduledNativeSourceReader({cronSecret:'synthetic',fetch:async()=>reply(++calls,w)});
  let code=null,value=null;try{value=await read(new AbortController().signal);}catch(error){code=error.code??error.message;}return {calls,code,value:value?.complete??null};};
 assert.deepEqual(await run(()=>refused()),{calls:1,code:'native_source_refused_inventory_not_current',value:null});
 assert.deepEqual(await run(()=>refused('inventory_incomplete')),{calls:1,code:'native_source_refused_inventory_incomplete',value:null});
 for(const reply of [()=>temporary(),()=>new Response('',{status:503}),()=>new Response('not json',{status:503}),()=>new Response(JSON.stringify({code:'inventory_not_current',retryable:'false'}),{status:503}),()=>new Response(JSON.stringify({code:'something_else',retryable:false}),{status:503})])
  assert.deepEqual(await run(reply),{calls:2,code:'native_source_http_503',value:null});
 assert.deepEqual(await run(()=>new Response('',{status:502})),{calls:2,code:'native_source_http_502',value:null});
 assert.equal((await run(()=>new Response(JSON.stringify({code:'inventory_not_current',retryable:false}),{status:500}))).code,'native_source_http_500');
 assert.deepEqual(await run((n,w)=>n===1?temporary():w.source()),{calls:2,code:null,value:true});
 assert.deepEqual(await run((n,w)=>w.source()),{calls:1,code:null,value:true});
});
test('reader: the label is bounded before it is read, not after',{skip},async()=>{
 const refusal=JSON.stringify({error:'x',code:'inventory_not_current',retryable:false});
 const run=async make=>{const pulls=[];const w=load(patched,{upstream:()=>temporary()});const read=w.api.scheduledNativeSourceReader({cronSecret:'synthetic',fetch:async()=>make(pulls)});let code;try{await read(new AbortController().signal);}catch(error){code=error.code;}return {code,pulled:pulls.reduce((a,b)=>a+b,0)};};
 // Declared too long: not read at all, even though the bytes that would arrive are a valid refusal.
 const declared=await run(pulls=>new Response(new ReadableStream({pull(c){pulls.push(refusal.length);c.enqueue(new TextEncoder().encode(refusal));c.close();}},{highWaterMark:0}),{status:503,headers:{'content-length':'100000'}}));
 assert.equal(declared.code,'native_source_http_503');assert.equal(declared.pulled,0,'a body declared over the limit is never pulled');
 for(const bad of ['-1','1e2','abc','513','99999'])assert.equal((await run(()=>new Response(refusal,{status:503,headers:{'content-length':bad}}))).code,'native_source_http_503',bad);
 // Undeclared and endless: abandoned at the limit instead of buffered.
 const endless=await run(pulls=>new Response(new ReadableStream({pull(c){pulls.push(256);c.enqueue(new Uint8Array(256).fill(32));}},{highWaterMark:0}),{status:503}));
 assert.equal(endless.code,'native_source_http_503');assert.ok(endless.pulled<=4096,'stopped after '+endless.pulled+' bytes');
 // Within the limit, declared or not, the refusal is recognised.
 assert.equal((await run(()=>new Response(refusal,{status:503,headers:{'content-length':String(refusal.length)}}))).code,'native_source_refused_inventory_not_current');
 assert.equal((await run(()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(refusal));c.close();}}),{status:503}))).code,'native_source_refused_inventory_not_current');
});

// ---- real authority factory ------------------------------------------------
const afterHealthyThenRefused=async text=>{
 let stale=false;const w=load(text,{upstream:(n,{source})=>stale?refused():source()});const authority=w.factory(null,600_000);
 assert.equal(await authority.prepare(),true);assert.equal(w.state.upstream,1);
 stale=true;let begun=0;
 // The saved snapshot is now past its 20-second reuse window but inside the 26-second fallback window, and stays there.
 w.advance(21_000);
 for(let round=0;round<20;round++){const before=authority.diagnostics().started;await authority.begin(device).catch(()=>null);await settle();begun+=authority.diagnostics().started-before;}
 return {upstream:w.state.upstream,begun,diagnostics:authority.diagnostics()};
};
test('deployed v96 has the fault: the snapshot cache answers for a source that is refusing',{skip},async()=>{
 const r=await afterHealthyThenRefused(baseline);
 assert.ok(r.upstream>=2,'upstream calls: '+r.upstream);assert.ok(r.begun>=19,'device work begun while the source was refusing: '+r.begun);assert.equal(r.diagnostics.preparation,'ready');
});
test('a refusal after a healthy preparation is authoritative across the snapshot cache',{skip},async()=>{
 const r=await afterHealthyThenRefused(patched);
 assert.equal(r.upstream,2,'one healthy read, one refused read, then none');
 assert.equal(r.diagnostics.blocked,'refused');assert.equal(r.diagnostics.preparation,'refused');assert.equal(r.diagnostics.failure,'native_source_refused_inventory_not_current');
 assert.ok(r.begun<=1,'at most the one request that was already holding a current authority when the refusal arrived: '+r.begun);
});
test('a refusal is not undone by a read that was already in flight and then succeeds',{skip},async()=>{
 const w=load(patched,{upstream:()=>temporary()});const reads=[];
 const readAuthority=()=>new Promise((resolve,reject)=>reads.push({resolve,reject}));
 const fresh=()=>({readAt:w.state.clock,products:[{productId:'11',endpointId:'1'}]});
 // Stand-in producer: uses the ticket exactly as the real one does (authority, endpoint check, re-read before commit).
 const outcomes=[];
 w.api.setProduce(async(productId,adapters,{signal})=>{try{await adapters.readAuthority(signal);await adapters.checkEndpoint({endpointId:'1',endpointRevision:'1',ip:'8.8.8.8',ports:[80],authorityGuard:'g'});await adapters.readAuthority(signal);outcomes.push('recheck_ok');return {status:'responded'};}catch(error){outcomes.push(error.message);return {status:'unknown'};}});
 const authority=w.api.createScheduledEndpointEvidence({deadline:w.state.clock+600_000,now:()=>w.state.clock,commitIfCurrent:async()=>({committed:false}),readAuthority});await settle();
 reads[0].resolve(fresh());assert.equal(await authority.prepare(),true);
 w.advance(11_000);                                   // old enough to start a background refresh
 const ticket=await authority.begin(device);assert.ok(ticket,'a ticket is issued while the authority is current');assert.equal(reads.length,2,'the background refresh is in flight');
 authority.finish(ticket,{startedAt:w.state.clock,at:w.state.clock+5,ports:{80:{online:true}}},true);w.advance(10);await settle();
 assert.equal(reads.length,3,'the ticket re-reads the authority before it may commit');
 reads[2].reject(Object.assign(Error('Native source refused'),{code:'native_source_refused_inventory_not_current'}));await settle();
 assert.equal(authority.diagnostics().blocked,'refused');
 reads[1].resolve(fresh());await settle();        // the earlier refresh now succeeds, late
 assert.equal(authority.diagnostics().blocked,'refused');assert.equal(authority.diagnostics().preparation,'refused');
 assert.equal(await authority.begin(device),null,'no ticket after the refusal, whatever the late read returned');
 assert.deepEqual(outcomes,['Native source refused']);assert.equal(reads.length,3,'and no further read');
 // The mirror image: the refusal arrives on the refresh while a ticket is mid-flight; the ticket cannot complete.
 const again=[],results=[];w.api.setProduce(async(productId,adapters,{signal})=>{try{await adapters.readAuthority(signal);await adapters.checkEndpoint({endpointId:'1',endpointRevision:'1',ip:'8.8.8.8',ports:[80],authorityGuard:'g'});await adapters.readAuthority(signal);results.push('recheck_ok');}catch(error){results.push(error.message);}return {status:'unknown'};});
 const second=w.api.createScheduledEndpointEvidence({deadline:w.state.clock+600_000,now:()=>w.state.clock,commitIfCurrent:async()=>({committed:false}),readAuthority:()=>new Promise((resolve,reject)=>again.push({resolve,reject}))});await settle();
 again[0].resolve(fresh());await second.prepare();w.advance(11_000);const held=await second.begin(device);assert.ok(held);
 again[1].reject(Object.assign(Error('Native source refused'),{code:'native_source_refused_inventory_incomplete'}));await settle();
 second.finish(held,{startedAt:w.state.clock,at:w.state.clock+5,ports:{80:{online:true}}},true);w.advance(10);await settle();
 assert.deepEqual(results,['Endpoint authority blocked']);assert.equal(again.length,2);assert.equal(second.diagnostics().blocked,'refused');
});
// ---- real factory, reader, producer and collector ---------------------------
const fleet={equipment_master:[{canonical_family:'Sniper',unit_tag:'58',source_label:'Sniper 58',tracker_state:'field_or_unknown'}],
 camera_devices:[{id:1,unit_key:'Sniper 58',device_name:'Cam 1',source:'2026_unit_tracker',mhelp_product_id:'11',public_ip:'8.8.8.8',expected_ports:[80],connection_revision:1,monitoring_profile:'sniper',monitoring_enabled:true,activation_state:'active',organization:'COS',last_health_checked_at:null}],camera_health_current:[]};
const collectWithHeldProbe=async(text,{refuseDuringProbe})=>{
 let stale=false;const w=load(text,{upstream:(n,{source})=>stale?refused():source()});Object.assign(w.state.tables,fleet);
 const authority=w.factory(null,90_000);assert.equal(await authority.prepare(),true);
 // The saved source is still inside its 26-second window, so the ticket is admitted from it.
 w.advance(21_000);if(refuseDuringProbe)stale=true;
 let release,probing;const started=new Promise(resolve=>probing=resolve),held=new Promise(resolve=>release=resolve);
 const probe=async()=>{probing();await held;return {online:true,latency_ms:5,error:null};};
 const run=w.api.collectScheduledDirect(w.db,probe,{startedAt:w.state.clock,deadlineMs:60_000,endpointEvidence:authority});
 await started;const during=authority.diagnostics();
 // The probe is in flight; let the background refresh finish before it completes.
 for(let i=0;i<50&&refuseDuringProbe&&authority.diagnostics().blocked!=='refused';i++)await settle();
 const blockedBeforeWrite=authority.diagnostics().blocked;
 release();const outcome=await run;
 return {during,blockedBeforeWrite,results:outcome.results,writes:w.state.rpcs.filter(n=>n==='publish_camera_connection_v1').length,receipts:w.state.rpcs.filter(n=>n==='cos_tracker_endpoint_commit_v1').length,diagnostics:authority.diagnostics()};
};
test('collector, healthy: the real producer admits the device, health is written and the receipt is committed',{skip},async()=>{
 const r=await collectWithHeldProbe(patched,{refuseDuringProbe:false});
 assert.equal(r.during.started,1,'a ticket was admitted before the probe');assert.equal(r.writes,1);assert.equal(r.receipts,1);
 assert.equal(r.results.length,1);assert.equal(r.results[0].published,true);assert.equal(r.results[0].status,'online');assert.equal(r.diagnostics.responded,1);assert.equal(r.diagnostics.blocked,null);
});
test('collector, without the write fence: a refusal during the probe still lets health be written (the reported race)',{skip},async()=>{
 const r=await collectWithHeldProbe(unfenced,{refuseDuringProbe:true});
 assert.equal(r.during.started,1);assert.equal(r.blockedBeforeWrite,'refused');
 assert.equal(r.writes,1,'health was written while the authority was refused');assert.equal(r.results[0].published,true);assert.equal(r.receipts,0,'only the later receipt was stopped');
});
test('collector, with the write fence: a refusal during an in-flight probe prevents the health write',{skip},async()=>{
 const r=await collectWithHeldProbe(patched,{refuseDuringProbe:true});
 assert.equal(r.during.started,1,'the ticket was admitted from the valid saved source');assert.equal(r.blockedBeforeWrite,'refused','the refusal was latched while the probe was held');
 assert.equal(r.writes,0,'no health write');assert.equal(r.receipts,0,'no receipt');
 assert.equal(JSON.stringify(r.results.map(x=>[x.status,x.reason,x.published])),JSON.stringify([['unknown','endpoint_authority_unverified',false]]));
 assert.equal(r.diagnostics.responded,0);assert.equal(r.diagnostics.blocked,'refused');
});
test('two consecutive temporary failures stop further reads; one failure followed by success does not',{skip},async()=>{
 const failing=load(patched,{upstream:()=>temporary()}),a=failing.factory(null,600_000);
 assert.equal(await a.prepare(),false);for(let i=0;i<60;i++){failing.advance(500);assert.equal(await a.begin(device).catch(()=>null),null);}await new Promise(r=>setTimeout(r,600));
 assert.equal(failing.state.upstream,4,'two reads, each with its one quick retry');assert.equal(a.diagnostics().blocked,'unavailable');assert.equal(a.diagnostics().authority_reads,2);
 let n=0;const blip=load(patched,{upstream:(c,{source})=>++n===1?temporary():source()}),b=blip.factory(null,600_000);
 assert.equal(await b.prepare(),true);assert.equal(b.diagnostics().blocked,null);assert.equal(blip.state.upstream,2);
});
test('a blocked directive makes the real factory read nothing at all',{skip},async()=>{
 for(const directive of ['refused','unavailable']){
  const w=load(patched,{upstream:(n,{source})=>source()}),a=w.factory(directive,600_000);
  assert.equal(await a.prepare(),false);for(let i=0;i<30;i++){w.advance(1000);assert.equal(await a.begin(device),null);}await settle();
  assert.equal(w.state.upstream,0);assert.equal(a.diagnostics().authority_reads,0);assert.equal(a.diagnostics().preparation,directive);
 }
 // Anything else is ignored rather than trusted.
 for(const junk of ['ready','REFUSED',true,{},1]){const w=load(patched,{upstream:(n,{source})=>source()}),a=w.factory(junk,600_000);assert.equal(await a.prepare(),true,String(junk));}
});

// ---- real handler -----------------------------------------------------------
const directives=shards=>shards.map(s=>s.endpoint_authority??null);
test('handler, inventory stale from the start: one upstream call, four shards still run and none of them reads',{skip},async()=>{
 const w=load(patched,{upstream:()=>refused()}),c=await w.cycle();
 assert.equal(c.status,200);assert.equal(c.body.state,'completed','the fan-out and its unrelated monitoring still complete');
 assert.equal(c.calls,1);assert.deepEqual(directives(c.shards),['refused','refused','refused','refused']);assert.deepEqual(c.shards.map(s=>s.shard_index),[0,1,2,3]);
});
test('handler, preparation fails for a temporary reason: two upstream calls, shards told not to read',{skip},async()=>{
 const w=load(patched,{upstream:()=>temporary()}),c=await w.cycle();
 assert.equal(c.body.state,'completed');assert.equal(c.calls,2);assert.deepEqual(directives(c.shards),['unavailable','unavailable','unavailable','unavailable']);
});
test('deployed v96 handler reproduces the reported counts',{skip},async()=>{
 const stale=load(baseline,{upstream:()=>refused()});assert.ok((await stale.cycle()).calls>=5,'v96 keeps reading after a failed preparation');
 const turning=load(baseline,{upstream:(n,{source})=>n===1?source():refused()}),c=await turning.cycle();assert.ok(c.calls>=5,'healthy parent then refused shards: '+c.calls);
});
test('handler, healthy parent then the inventory turns stale: the first pair of shards meets it, the rest are told',{skip},async()=>{
 const w=load(patched,{upstream:(n,{source})=>n===1?source():refused()}),c=await w.cycle();
 assert.equal(c.body.state,'completed');
 // Parent 1 (healthy) + the two shards that run together 1 each. This is the conditional bound: it is 3, not 1.
 assert.equal(c.calls,3);assert.deepEqual(directives(c.shards),[null,null,'refused','refused']);
});
test('handler, healthy parent then stale, with every first-wave shard retried: still three upstream calls',{skip},async()=>{
 const failedOnce=new Set();
 const w=load(patched,{upstream:(n,{source})=>n===1?source():refused(),shardReply:async(response,body)=>{
  // The shard ran, then its reply reaches the parent as a 503, which makes the parent retry that shard once.
  if(body.shard_index<2&&!failedOnce.has(body.shard_index)){failedOnce.add(body.shard_index);return new Response(await response.text(),{status:503,headers:{'content-type':'application/json'}});}
  return response;}});
 const c=await w.cycle();
 assert.equal(c.shards.length,6,'two shards were each called twice');assert.equal(c.calls,3,'the retried shards are told about the refusal and do not ask again');
 assert.deepEqual(c.shards.map(s=>[s.shard_index,s.endpoint_authority??null]).sort((a,b)=>String(a).localeCompare(String(b))),[[0,null],[0,'refused'],[1,null],[1,'refused'],[2,'refused'],[3,'refused']].sort((a,b)=>String(a).localeCompare(String(b))));
});
test('handler, healthy throughout: every shard reads its own authority and no directive is sent',{skip},async()=>{
 const w=load(patched,{upstream:(n,{source})=>source()}),c=await w.cycle();
 assert.equal(c.body.state,'completed');assert.deepEqual(directives(c.shards),[null,null,null,null]);assert.equal(c.calls,5,'parent and four shards, once each');
});
test('handler, next scheduled cycle starts clean and resumes when the inventory is current again',{skip},async()=>{
 let fresh=false;const w=load(patched,{upstream:(n,{source})=>fresh?source():refused()});
 const first=await w.cycle();w.advance(900_000);const second=await w.cycle();
 assert.equal(first.calls,1);assert.equal(second.calls,1,'asked once more, not remembered and not repeated');
 fresh=true;w.advance(900_000);const third=await w.cycle();assert.deepEqual(directives(third.shards),[null,null,null,null]);assert.equal(third.calls,5);
 // Twelve hours of quarter-hour cycles on a stale inventory: 48 upstream calls in all.
 const long=load(patched,{upstream:()=>refused()});for(let i=0;i<48;i++){await long.cycle();long.advance(900_000);}assert.equal(long.state.upstream,48);assert.equal(long.state.shards.length,192);
});
test('handler, a shard called on its own accepts only the two known directives',{skip},async()=>{
 for(const [sent,expected] of [['refused',0],['unavailable',0],['ready',1],[true,1],[undefined,1]]){
  const w=load(patched,{upstream:(n,{source})=>source()});
  const response=await w.state.handler(new Request(SWEEP,{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic'},body:JSON.stringify({batch_size:24,shard_index:0,shard_count:4,endpoint_authority:sent})}));
  const body=await response.json();assert.equal(w.state.upstream,expected,String(sent));assert.equal(body.endpoint_authority,expected?null:sent);
 }
 // The directive is only honoured on a shard call; it cannot switch the authority off for a whole cycle.
 const w=load(patched,{upstream:(n,{source})=>source()});await w.state.handler(new Request(SWEEP,{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic'},body:JSON.stringify({endpoint_authority:'refused'})}));assert.equal(w.state.upstream,5);
 // And nothing runs without the cron secret.
 const denied=load(patched,{upstream:()=>refused()});assert.equal((await denied.state.handler(new Request(SWEEP,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,403);assert.equal(denied.state.upstream,0);
});
