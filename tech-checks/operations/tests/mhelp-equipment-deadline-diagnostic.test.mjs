import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpPartnerHandler,MhelpPartnerError,MhelpPartnerReadDeadlineError} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {createInventoryComparisonHandler} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';

const config={portalId:'224643',accessToken:'synthetic-private-token'};
const json=value=>Response.json(value);
const row=id=>({equipmentId:id,portalId:224643,equipmentTypeId:20,name:'Ranger '+id,model:null,customerId:21,serviceLocationId:22,IsActive:true});
const run=()=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'});
function partner(fetch,fullEquipmentReview=true,readNativeUnits=async()=>[]){return createMhelpPartnerHandler({getConfig:()=>config,fetch,fullEquipmentReview,readNativeUnits});}
function blocked(signal){return new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Error('synthetic-private-transport; customer address')),{once:true});});}

test('unchanged 20s Owner and 40s maintenance timers abort a stalled account and release the busy guard',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const full of [false,true]){
  let entered,healthy=false,nativeReads=0,signal;
  const ready=new Promise(resolve=>{entered=resolve;});
  const handler=partner(async(url,init)=>{signal=init.signal;if(!healthy){entered();return blocked(signal);}return url.endsWith('/me')?json({portalId:224643}):json({totalRows:1,results:[row(1)]});},full,async()=>{nativeReads++;return [];});
  let settled=false;const pending=handler('/api/mhelpdesk/partner/preview','POST',{}).finally(()=>{settled=true;});
  await ready;t.mock.timers.tick((full?40000:20000)-1);await Promise.resolve();assert.equal(signal.aborted,false);assert.equal(settled,false);
  const rejection=assert.rejects(pending,error=>error instanceof MhelpPartnerReadDeadlineError&&error.status===503&&error.provider===undefined&&!error.message.includes('synthetic-private'));
  t.mock.timers.tick(1);await rejection;assert.equal(signal.aborted,true);assert.equal(nativeReads,0);
  healthy=true;assert.equal((await handler('/api/mhelpdesk/partner/preview','POST',{})).items.length,1);assert.equal(nativeReads,1);
 }
});

test('actual paginated pass cannot publish a partial 1001-record census at the existing deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const indexBase of [0,1]){
 const rows=Array.from({length:1001},(_,i)=>row(i+1));let reachedLast,reads=0,baselines=0,writes=0,released=0,recorded;
 const lastPage=new Promise(resolve=>{reachedLast=resolve;});
 const read=partner(async(url,init)=>{
  reads++;if(url.endsWith('/me'))return json({portalId:224643});
  const start=Math.max(0,Number(new URL(url).searchParams.get('rowIndex')||0)-indexBase);
  if(start===1000){reachedLast();return blocked(init.signal);}
  return json({totalRows:1001,results:rows.slice(start,start+200)});
 });
 const handler=createInventoryComparisonHandler({authenticate:async()=>true,acquireRead:async()=>({allowed:true,leaseId:'00000000-0000-4000-8000-000000000001'}),releaseRead:async()=>{released++;},readEquipment:()=>read('/api/mhelpdesk/partner/preview','POST',{}),readBaseline:async()=>{baselines++;},writeSource:async()=>{writes++;},recordFailure:async code=>{recorded=code;}});
 const pending=handler(run());await lastPage;t.mock.timers.tick(40000);
 const response=await pending,body=await response.json();assert.equal(response.status,503);
 assert.deepEqual(body,{error:'Complete mHelpDesk inventory comparison unavailable',inventoryWrites:0,failureStage:'equipment',reason:'equipment_pass_deadline_exceeded'});
 assert.equal(reads,indexBase?8:7);assert.equal(baselines,0);assert.equal(writes,0);assert.equal(released,1);assert.equal(recorded,'inventory_source_unavailable');
 }
});

test('stream abort is distinguished from malformed JSON without exposing partial vendor content',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reading;
 const ready=new Promise(resolve=>{reading=resolve;});
 const read=partner(async(url,init)=>url.endsWith('/me')?json({portalId:224643}):new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(Error('synthetic-private-body')),{once:true});},pull(){reading();return new Promise(()=>{});}},{highWaterMark:0})));
 const pending=read('/api/mhelpdesk/partner/preview','POST',{});await ready;
 const rejection=assert.rejects(pending,error=>error instanceof MhelpPartnerReadDeadlineError&&!error.message.includes('synthetic-private'));
 t.mock.timers.tick(40000);await rejection;
 const invalid=partner(async()=>new Response('synthetic-private-invalid-json'));
 await assert.rejects(invalid('/api/mhelpdesk/partner/preview','POST',{}),error=>error instanceof MhelpPartnerError&&!(error instanceof MhelpPartnerReadDeadlineError)&&!error.message.includes('synthetic-private'));
});

test('second equipment pass reports the same bounded reason at resources and never writes',async()=>{
 const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[{equipmentId:'1',portalId:'224643',name:'Ranger 1',active:true}]};
 let writes=0,released=0;
 const handler=createInventoryComparisonHandler({authenticate:async()=>true,acquireRead:async()=>({allowed:true,leaseId:'00000000-0000-4000-8000-000000000001'}),releaseRead:async()=>{released++;},readEquipment:async()=>review,readBaseline:async()=>({sourceSha256:'a'.repeat(64),records:[{productId:'1',unitNumber:'Ranger 1'}]}),readSource:async()=>{throw new MhelpPartnerReadDeadlineError();},writeSource:async()=>{writes++;}});
 const body=await(await handler(run())).json();assert.equal(body.failureStage,'resources');assert.equal(body.reason,'equipment_pass_deadline_exceeded');assert.equal(body.inventoryWrites,0);assert.equal(writes,0);assert.equal(released,1);
});

test('ordinary transport, forged diagnostic fields and provider 429 remain distinct from own deadline',async()=>{
 const transport=partner(async()=>{throw Error('synthetic-private-transport');});
 await assert.rejects(transport('/api/mhelpdesk/partner/preview','POST',{}),error=>error instanceof MhelpPartnerError&&!(error instanceof MhelpPartnerReadDeadlineError)&&!error.message.includes('synthetic-private'));
 for(const cause of [Object.assign(Error('synthetic-private'),{name:'MhelpPartnerReadDeadlineError',reason:'equipment_pass_deadline_exceeded'}),{reason:'equipment_pass_deadline_exceeded',status:503},new MhelpPartnerError('synthetic-private',429,{operation:'equipment_read',httpStatus:429})]){
  let recorded;const handler=createInventoryComparisonHandler({authenticate:async()=>true,readEquipment:async()=>{throw cause;},readBaseline:async()=>{assert.fail('baseline must not be read');},recordFailure:async code=>{recorded=code;}});
  const response=await handler(run()),body=await response.json();assert.equal(response.status,503);assert.equal(body.reason,undefined);assert.equal(body.inventoryWrites,0);assert.equal(recorded,cause.status===429?'source_rate_limited':'inventory_source_unavailable');assert(!JSON.stringify(body).includes('synthetic-private'));
 }
});
