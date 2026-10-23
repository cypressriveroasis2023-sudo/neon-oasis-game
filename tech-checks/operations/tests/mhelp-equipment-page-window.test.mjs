import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpPartnerHandler,MhelpPartnerReadDeadlineError} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {createMhelpRequestBudget} from '../../supabase/functions/cos-operations-pages/mhelpRequestBudget.ts';
import {createMhelpReadBackoff} from '../../supabase/functions/cos-operations-pages/mhelpReadBackoff.ts';
import {createInventoryComparisonHandler} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';

const config={portalId:'224643',accessToken:'synthetic-private-token'};
const rows=Array.from({length:1001},(_,i)=>({equipmentId:i+1,portalId:224643,equipmentTypeId:20,name:'Ranger '+(i+1),customerId:21,serviceLocationId:22,IsActive:true}));
const allowed={allowed:true,reason:null,retryAt:null};
const run=()=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'});
const microtasks=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
async function advance(t,pending,max=45000){
 let done=false;pending.then(()=>{done=true;},()=>{done=true;});
 for(let elapsed=0;!done&&elapsed<=max;elapsed+=100){await microtasks();t.mock.timers.tick(100);}
 await microtasks();assert(done,'the pass must settle within its existing deadline');
 return pending;
}
function delayed(value,ms,signal,settled=()=>{}){
 return new Promise((resolve,reject)=>{
  const finish=()=>{signal.removeEventListener('abort',cancel);settled();resolve(value);};
  const timer=setTimeout(finish,ms),cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);settled();reject(Error('synthetic-private-transport'));};
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
 });
}
function fixture({indexBase=1,delay=()=>0,change=(_start,page)=>page,admit=async()=>allowed,transport}={}){
 let active=0,maxActive=0,nativeReads=0;const starts=[],admissions=[],completions=[];
 const vendor=async(url,init)=>{
  const account=url.endsWith('/me'),start=account?-1:Math.max(0,Number(new URL(url).searchParams.get('rowIndex')||0)-indexBase);
  starts.push({start,at:Date.now()});active++;maxActive=Math.max(maxActive,active);
  const value=account?Response.json({portalId:224643}):change(start,{totalRows:1001,results:rows.slice(start,start+200)},init.signal);
  const response=value instanceof Response?value:Response.json(value);
  return delayed(response,delay(start),init.signal,()=>{active--;completions.push(start);});
 };
 const budget=createMhelpRequestBudget({admit:async essential=>{admissions.push({essential,at:Date.now()});return admit(essential);},fetch:transport?transport(vendor):vendor});
 const handler=createMhelpPartnerHandler({getConfig:()=>config,fullEquipmentReview:true,fetch:budget.fetch,readNativeUnits:async()=>{nativeReads++;return [];}});
 return {read:()=>handler('/api/mhelpdesk/partner/preview','POST',{}),starts,admissions,completions,state:()=>({active,maxActive,nativeReads})};
}

test('1001 slow records complete inside unchanged 40s with both index modes, durable 400ms admission and reversed completions',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:100000});
 for(const indexBase of [0,1]){
  let nextStart=0,slots=0;
  const f=fixture({indexBase,delay:start=>start===-1?3000:start===400||start===800?6500:6000,admit:async()=>{
   const at=Date.now();if(at<nextStart)return {allowed:false,reason:'pacing',retryAt:new Date(nextStart).toISOString()};
   nextStart=at+400;slots++;return allowed;
  }});
  const started=Date.now(),review=await advance(t,f.read());
  assert(Date.now()-started<40000);assert.equal(review.partial,false);assert.equal(review.totalRows,1001);
  assert.deepEqual(review.items.map(r=>r.equipmentId),rows.map(r=>String(r.equipmentId)));
  assert.equal(f.state().maxActive,2);assert.equal(f.state().active,0);assert.equal(f.state().nativeReads,1);
  assert.equal(f.starts.length,indexBase?8:7);assert.equal(slots,f.starts.length,'no page or boundary retry bypasses admission');
  assert(f.admissions.length>slots,'parallel starts must re-admit a pacing refusal');
  assert(f.starts.every((r,i)=>i===0||r.at-f.starts[i-1].at>=400));
  assert(f.completions.indexOf(600)<f.completions.indexOf(400),'completion order must not change validation order');
 }
});

test('concurrent pages retain total, order, duplicate, parent portal, exact census and transport guards',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 for(const mode of ['ignored','total','order','duplicate','portal','short','hole','oversize','json','utf8']){
  const f=fixture({delay:()=>100,change:(start,page)=>{
   if(mode==='hole')return {...page,totalRows:700,results:start===400?page.results.slice(0,100):page.results};
   if(start!==600)return page;
   if(mode==='ignored')return {...page,results:rows.slice(0,200)};
   if(mode==='total')return {...page,totalRows:1002};
   if(mode==='order')return {...page,results:page.results.toReversed()};
   if(mode==='duplicate')return {...page,results:[rows[599],...page.results.slice(1)]};
   if(mode==='portal')return {...page,results:page.results.map(r=>({...r,portalId:999}))};
   if(mode==='short')return {...page,results:page.results.slice(0,100)};
   if(mode==='oversize')return new Response('synthetic-private',{headers:{'Content-Length':'1048577'}});
   if(mode==='json')return new Response('synthetic-private-invalid-json');
   return new Response(new Uint8Array([0xff]));
  }});
  const rejection=assert.rejects(f.read(),error=>!error.message.includes('synthetic-private'));
  await advance(t,rejection);assert.equal(f.state().nativeReads,0);assert.equal(f.state().active,0);
  assert(f.state().maxActive<=2);assert(!f.starts.some(r=>r.start>=800),'an invalid batch must not start the next batch');
 }
});

test('two unfinished page bodies abort and settle before the maintenance reader releases its guard',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let bodies=0,errors=0;
 const f=fixture({delay:()=>100,change:(start,page,signal)=>start<400?page:new Response(new ReadableStream({
  start(controller){bodies++;signal.addEventListener('abort',()=>{errors++;controller.error(Error('synthetic-private-body'));},{once:true});},
  pull(){return new Promise(()=>{});}
 },{highWaterMark:0}))});
 const started=Date.now();
 await advance(t,assert.rejects(f.read(),error=>error instanceof MhelpPartnerReadDeadlineError));
 assert(Date.now()-started<=40100);
 assert.equal(bodies,2);assert.equal(errors,2);assert.equal(f.state().nativeReads,0);assert.equal(f.state().active,0);
});

test('two stalled sibling requests settle at 40s before lease and busy release, with no partial source or extra admission',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const f=fixture({delay:start=>start>=400?100000:100});
 let releases=0,baselines=0,writes=0;
 const handler=createInventoryComparisonHandler({authenticate:async()=>true,acquireRead:async()=>({allowed:true,leaseId:'00000000-0000-4000-8000-000000000001'}),releaseRead:async()=>{assert.equal(f.state().active,0);releases++;},readEquipment:f.read,readBaseline:async()=>{baselines++;},writeSource:async()=>{writes++;}});
 const response=await advance(t,handler(run()));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Complete mHelpDesk inventory comparison unavailable',inventoryWrites:0,failureStage:'equipment',reason:'equipment_pass_deadline_exceeded'});
 assert.equal(f.state().maxActive,2);assert.equal(f.state().active,0);assert.equal(f.state().nativeReads,0);
 assert.equal(releases,1);assert.equal(baselines,0);assert.equal(writes,0);assert(!f.starts.some(r=>r.start>=800));
 // The same handler is available again; it must fail at its next real deadline,
 // rather than retain the busy guard or return an earlier partial census.
 const rejection=assert.rejects(f.read(),error=>error instanceof MhelpPartnerReadDeadlineError);
 await advance(t,rejection);assert.equal(f.state().active,0);
});

test('a lost, malformed or held sibling admission never falls back to I/O or publishes a partial review',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 for(const refusal of ['daily_budget','provider_wait','usage_not_yet_measured','malformed','lost']){
  let slots=0;
  const f=fixture({delay:()=>100,admit:async()=>{
   slots++;if(slots!==6)return allowed;
   if(refusal==='lost')throw Error('synthetic-private-ack');
   if(refusal==='malformed')return {allowed:true,reason:'daily_budget',retryAt:null};
   return {allowed:false,reason:refusal,retryAt:new Date(Date.now()+60000).toISOString()};
  }});
  await advance(t,assert.rejects(f.read(),error=>!error.message.includes('synthetic-private')));
  assert.equal(f.state().active,0);assert.equal(f.state().nativeReads,0);assert.equal(f.starts.length,5);
  assert(!f.starts.some(r=>r.start>=600));
 }
});

test('provider 429 in a parallel page still records its durable hold and an older sibling cannot clear it',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let held=false,limits=0,recoveries=0,backoff;
 const f=fixture({delay:start=>start===600?100:500,change:(start,page)=>start===600?new Response('synthetic-private-limit',{status:429,headers:{'Retry-After':'120'}}):page,transport:fetch=>{
  backoff=createMhelpReadBackoff({fetch,gate:async body=>{
   if(body.p_action==='gate_limit'){held=true;limits++;}
   if(body.p_action==='gate_recovered')recoveries++;
   return {allowed:!held,retryAt:held?new Date(Date.now()+120000).toISOString():null,leaseId:null,revision:held?1:0,consecutiveLimits:held?1:0};
  }});return backoff.fetch;
 }});
 await advance(t,assert.rejects(f.read(),error=>error.status===429&&error.provider?.operation==='equipment_read'&&!error.message.includes('synthetic-private')));
 assert.equal(limits,1);assert.equal(recoveries,0);assert.equal(held,true);assert.equal(f.state().active,0);assert.equal(f.state().nativeReads,0);
 const count=f.starts.length;await advance(t,assert.rejects(f.read(),error=>error.status===429));
 assert.equal(f.starts.length,count);assert.equal(backoff.snapshot().rateLimited,1);
});
