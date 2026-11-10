// Draft check for the camera-health-sweep endpoint-authority retry fix.
//
// The deployed v96 source is not stored in this repository. Supply it with
//   COS_SWEEP_V96_SOURCE=/path/to/camera-health-sweep/index.ts
// The recipe is applied to that exact file (its SHA-256 is pinned) and the
// tests run against the result. Without the file every test is skipped.
// Each authority object holds a timer until its own 95-second deadline, as in
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
let patched=baseline;
if(available)for(const edit of recipe.edits){assert.equal(baseline.split(edit.before).length-1,edit.occurrences,edit.name);patched=patched.split(edit.before).join(edit.after);}
const skip=available?false:'set COS_SWEEP_V96_SOURCE to the exact deployed v96 index.ts';

// Lift whole top-level declarations out of the patched bundle, unchanged.
function declaration(name){
 const start=patched.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);
 let i=patched.indexOf('{',patched.indexOf(')',start)),depth=0;
 // The parameter list may itself contain braces (destructuring); find the body by the first "{" after the closing ") {".
 i=patched.indexOf(') {',start)+2;
 do{const c=patched[i];if(c==='{')depth++;else if(c==='}')depth--;i++;}while(depth);
 return patched.slice(start,i);
}
const variable=name=>{const m=new RegExp('^var '+name+' = .*;$','m').exec(patched);assert.ok(m,name);return m[0];};

function load({now,fetch}){
 const context=vm.createContext({console:{warn(){},error(){},log(){}},setTimeout,clearTimeout,AbortController,Promise,Response,TextDecoder,JSON,Number,Math,Error,Boolean,Date:{now},fetch,
  // Stands in for the per-device producer; these tests never reach a device check.
  produce:async()=>({status:'unknown'})});
 vm.runInContext([variable('URL2'),variable('SCHEDULED_SOURCE_REFUSALS'),declaration('scheduledSourceRefusal'),declaration('scheduledNativeSourceReader'),declaration('createScheduledEndpointEvidence'),
  'globalThis.api={scheduledNativeSourceReader,createScheduledEndpointEvidence,URL2};'].join('\n'),context);
 return context.api;
}

const refusedReply=(code='inventory_not_current')=>new Response(JSON.stringify({error:'Scheduled endpoint source unavailable',code,retryable:false}),{status:503,headers:{'content-type':'application/json'}});
const temporaryReply=()=>new Response(JSON.stringify({error:'Scheduled endpoint source unavailable',code:'read_unavailable',retryable:true}),{status:503,headers:{'content-type':'application/json'}});
const sourceReply=()=>Response.json({contract:'COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1',complete:true,products:[{productId:'11'}]});

/** One scheduled cycle with the same shape as the deployed handler: the parent
 *  prepares the shared authority, then four shards run two at a time, each
 *  preparing its own authority and asking for a ticket per device per wave. */
function world(upstream){
 let clock=1_000_000;const calls=[];
 const fetch=async url=>{calls.push(url);clock+=40;return upstream(calls.length);};
 const api=load({now:()=>clock,fetch});
 const evidenceFor=blocked=>{
  const reader=api.scheduledNativeSourceReader({cronSecret:'synthetic',fetch});
  return api.createScheduledEndpointEvidence({deadline:clock+95_000,now:()=>clock,blocked,commitIfCurrent:async()=>false,
   readAuthority:async signal=>{const source=await reader(signal);return {readAt:clock,products:source.products};}});
 };
 const shard=async(directive,{waves=4,devices=6}={})=>{
  const evidence=evidenceFor(directive);const prepared=await evidence.prepare();let tickets=0;
  for(let wave=0;wave<waves;wave++){
   const results=await Promise.all(Array.from({length:devices},(_,d)=>evidence.begin({productId:'11',device:{id:wave*devices+d,connection_revision:1},host:'198.51.100.7',ports:[80]}).catch(()=>null)));
   tickets+=results.filter(Boolean).length;clock+=3_000;
  }
  return {prepared,tickets,diagnostics:evidence.diagnostics(),current:()=>evidence.diagnostics()};
 };
 const cycle=async(options)=>{
  const before=calls.length,shared=evidenceFor(null);
  let prepared=false;try{prepared=await shared.prepare()===true;}catch{prepared=false;}
  const directive=prepared?null:shared.diagnostics().blocked==='refused'?'refused':'unavailable';
  const parentCalls=calls.length-before,shards=[];
  for(let first=0;first<4;first+=2)shards.push(...await Promise.all([shard(directive,options),shard(directive,options)]));
  return {prepared,directive,parentCalls,shardCalls:calls.length-before-parentCalls,total:calls.length-before,shards,parent:shared.diagnostics()};
 };
 return {calls,cycle,shard,advance:ms=>{clock+=ms;}};
}

test('the recipe applies to exactly the deployed v96 source and produces the recorded result',{skip},()=>{
 assert.equal(recipe.baselineVersion,96);assert.equal(sha(baseline),recipe.baselineSha256,'COS_SWEEP_V96_SOURCE is not the exact deployed v96 file');assert.equal(sha(patched),recipe.resultSha256);
 // Every edit is confined to the endpoint-authority chain and the two handler lines that call it.
 for(const edit of recipe.edits)assert.ok(/scheduledSourceRefusal|native_source_|ScheduledEndpointEvidence|ScheduledSourceBinding|scheduledEndpointFromExistingCron|endpointAuthority|endpoint_authority|readAuthority|refreshing|diagnostics|fetchSource/.test(edit.before+edit.after),edit.name);
});
test('freshness, identity and hold guards are untouched',{skip},()=>{
 const count=(text,needle)=>text.split(needle).length-1;
 for(const guard of ['now() - value.readAt <= 26e3','now() - first.readAt > 26e3','now() - readAt > 26e3','if (evidence && !tickets[i]) return held("endpoint_authority_unverified");','if (products.length !== 1) return null;','throw Error("Scheduled target mismatch");','retained_claims_incomplete','matches(current.authority, a)','if (!secret || secret.length > 1024'])
  {assert.ok(count(baseline,guard)>0,guard);assert.equal(count(patched,guard),count(baseline,guard),guard);}
 // Unrelated monitoring is not gated on the authority: the fan-out still runs after a failed preparation.
 assert.equal(count(patched,'return json({ error: "Endpoint authority preparation failed" }, 503);'),0);
 for(const kept of ['collectScheduledStar4Live(db, tcp,','const routers = shardCount > 1 ? dueRouters.filter(','const shardCount = 4;','for (let attempt = 0; attempt < 2; attempt++) {'])assert.equal(count(patched,kept),count(baseline,kept),kept);
});
test('reader: a labelled refusal is asked for once; an unlabelled failure keeps exactly one quick retry',{skip},async()=>{
 const run=async reply=>{const calls=[];const api=load({now:Date.now,fetch:async()=>{calls.push(1);return reply(calls.length);}});
  const read=api.scheduledNativeSourceReader({cronSecret:'synthetic',fetch:async()=>{calls.push(1);return reply(calls.length);}});
  let code=null,value=null;try{value=await read(new AbortController().signal);}catch(error){code=error.code??error.message;}return {calls:calls.length,code,value};};
 assert.deepEqual(await run(()=>refusedReply()),{calls:1,code:'native_source_refused_inventory_not_current',value:null});
 assert.deepEqual(await run(()=>refusedReply('inventory_incomplete')),{calls:1,code:'native_source_refused_inventory_incomplete',value:null});
 // Anything that is not an exact, known, non-retryable label is a temporary failure.
 for(const reply of [()=>temporaryReply(),()=>new Response('',{status:503}),()=>new Response('not json',{status:503}),()=>new Response(JSON.stringify({code:'inventory_not_current',retryable:'false'}),{status:503}),()=>new Response(JSON.stringify({code:'something_else',retryable:false}),{status:503}),()=>new Response(JSON.stringify({code:'inventory_not_current',retryable:false,pad:'x'.repeat(600)}),{status:503})])
  assert.deepEqual(await run(reply),{calls:2,code:'native_source_http_503',value:null});
 assert.deepEqual(await run(()=>new Response('',{status:502})),{calls:2,code:'native_source_http_502',value:null});
 // A refusal label on any other status is ignored.
 assert.equal((await run(()=>new Response(JSON.stringify({code:'inventory_not_current',retryable:false}),{status:500}))).code,'native_source_http_500');
 const recovered=await run(n=>n===1?temporaryReply():sourceReply());assert.equal(recovered.calls,2);assert.equal(recovered.value.complete,true);
 const healthy=await run(()=>sourceReply());assert.equal(healthy.calls,1);assert.equal(healthy.code,null);
});
test('stale inventory: one upstream call for the whole cycle, none from the four concurrent shards',{skip},async()=>{
 const w=world(()=>refusedReply()),c=await w.cycle({waves:6,devices:24});
 assert.equal(c.prepared,false);assert.equal(c.directive,'refused');assert.equal(c.parentCalls,1);assert.equal(c.shardCalls,0);assert.equal(c.total,1);
 assert.equal(c.parent.preparation,'refused');assert.equal(c.parent.failure,'native_source_refused_inventory_not_current');
 for(const s of c.shards){assert.equal(s.prepared,false);assert.equal(s.tickets,0,'every device is held, as it is today without a current authority');assert.equal(s.diagnostics.preparation,'refused');assert.equal(s.diagnostics.authority_reads,0);}
});
test('failed preparation for a temporary reason: bounded in the parent, no further reads from the shards',{skip},async()=>{
 const w=world(()=>temporaryReply()),c=await w.cycle({waves:6,devices:24});
 assert.equal(c.prepared,false);assert.equal(c.directive,'unavailable');assert.equal(c.parentCalls,2,'one read with its single quick retry');assert.equal(c.shardCalls,0);
 for(const s of c.shards){assert.equal(s.tickets,0);assert.equal(s.diagnostics.preparation,'unavailable');assert.equal(s.diagnostics.authority_reads,0);}
});
test('a shard that is called on its own cannot loop: per-device refreshes stop after two failed reads',{skip},async()=>{
 // No parent directive, as with a direct shard call or an older parent.
 const temporary=world(()=>temporaryReply()),t=await temporary.shard(null,{waves:12,devices:24});
 // The second read is started by a device request and not awaited by it; let its quick retry finish.
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(t.tickets,0);assert.equal(t.diagnostics.authority_reads,2);assert.equal(temporary.calls.length,4,'two reads, each with one quick retry, then no more for 288 device requests');assert.equal(t.current().blocked,'unavailable');assert.equal(t.current().authority_reads,2);
 const refused=world(()=>refusedReply()),r=await refused.shard(null,{waves:12,devices:24});
 assert.equal(refused.calls.length,1);assert.equal(r.diagnostics.authority_reads,1);assert.equal(r.diagnostics.blocked,'refused');
 // Four such shards at once: four calls in total, however many devices they hold.
 const four=world(()=>refusedReply());await Promise.all([1,2,3,4].map(()=>four.shard(null,{waves:8,devices:24})));assert.equal(four.calls.length,4);
});
test('temporary failure that recovers: the retry succeeds, the cycle proceeds and total upstream calls stay bounded',{skip},async()=>{
 const w=world(n=>n===1?temporaryReply():sourceReply()),c=await w.cycle({waves:4,devices:24});
 assert.equal(c.prepared,true);assert.equal(c.directive,null);assert.equal(c.parentCalls,2);
 for(const s of c.shards){assert.equal(s.prepared,true);assert.equal(s.diagnostics.preparation,'ready');assert.equal(s.diagnostics.blocked,null);}
 // Each shard reads on start and refreshes as its authority ages past ten seconds: a handful, never one per device.
 assert.ok(c.shardCalls>=4&&c.shardCalls<=4*4,String(c.shardCalls));assert.ok(c.total<=18);
 // A failure in the middle of a healthy shard is retried once and does not block it.
 let n=0;const blip=world(()=>++n===2?temporaryReply():sourceReply()),s=await blip.shard(null,{waves:5,devices:6});assert.equal(s.diagnostics.blocked,null);assert.equal(s.diagnostics.preparation,'ready');
});
test('next scheduled cycle starts clean: asks once while still refused, and resumes as soon as the inventory is current',{skip},async()=>{
 let fresh=false;const w=world(()=>fresh?sourceReply():refusedReply());
 const first=await w.cycle(),second=await w.cycle();
 assert.equal(first.total,1);assert.equal(second.total,1,'the refusal is not remembered across cycles, and is not repeated within one');
 fresh=true;const third=await w.cycle();assert.equal(third.prepared,true);assert.equal(third.directive,null);assert.ok(third.total>=5);for(const s of third.shards)assert.equal(s.diagnostics.preparation,'ready');
 // Twelve hours of quarter-hour cycles on a stale inventory: 48 upstream calls, not hundreds.
 fresh=false;const stale=world(()=>refusedReply());for(let i=0;i<48;i++)await stale.cycle({waves:6,devices:24});assert.equal(stale.calls.length,48);
});
test('an authority that is read but already too old is not accepted and counts toward the limit',{skip},async()=>{
 let clock=5_000_000,reads=0;const api=load({now:()=>clock,fetch:async()=>sourceReply()});
 const evidence=api.createScheduledEndpointEvidence({deadline:clock+95_000,now:()=>clock,commitIfCurrent:async()=>false,readAuthority:async()=>{reads++;return {readAt:clock-26_001,products:[{productId:'11'}]};}});
 assert.equal(await evidence.prepare(),false);for(let i=0;i<50;i++)assert.equal(await evidence.begin({productId:'11',device:{id:i,connection_revision:1},host:'198.51.100.7',ports:[80]}),null);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reads,2);assert.equal(evidence.diagnostics().blocked,'unavailable');
});
test('the handler passes the directive to its shards and shards accept only the two known values',{skip},()=>{
 assert.ok(patched.includes('prepared = await sharedAuthority.prepare() === true;'));
 assert.ok(patched.includes('endpointAuthorityDirective = sharedAuthority.diagnostics().blocked === "refused" ? "refused" : "unavailable";'));
 assert.ok(patched.includes('...endpointAuthorityDirective ? { endpoint_authority: endpointAuthorityDirective } : {} }),'));
 assert.ok(patched.includes('const endpointAuthorityBlocked = isShardCall && (body.endpoint_authority === "refused" || body.endpoint_authority === "unavailable") ? body.endpoint_authority : null;'));
 // A directive can only stop reads. It cannot supply or vouch for an authority.
 assert.ok(patched.includes('let blocked = blockedAtStart === "refused" || blockedAtStart === "unavailable" ? blockedAtStart : null'));
});
