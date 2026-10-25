import test from 'node:test';import assert from 'node:assert/strict';
import {createInventoryComparisonHandler} from '../../supabase/functions/cos-mhelp-inventory-sync/index.ts';
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
import {createInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
import {validateEvidenceRefresh,evidenceRefreshSelection,evidenceRefreshReceipt} from '../../supabase/functions/cos-mhelp-inventory-sync/manualRefresh.ts';
import {planPublishing,publisherRefreshCandidates,snapshotCell} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const sha='a'.repeat(64),lease='11111111-1111-4111-8111-111111111111';
const equipment={equipmentId:'1',portalId:'224643',name:'Synthetic 029.2',model:null,active:true,equipmentTypeId:'2',customerId:'3',serviceLocationId:'4'};
const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[equipment]};
const old={productId:'1',unitNumber:equipment.name,category:'Ranger',customerId:'3',lifecycle:'UNFLAGGED',holdReason:null,sourceAddress:{street:'',city:'',state:'',zip:''},binding:null};
const baseline={sourceSha256:sha,companyCustomerIds:['11'],records:[old],publisherRefreshEquipmentIds:[]};
const request={action:'refresh',equipmentIds:['1'],sourceSha256:sha};
const req=body=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const parent={customerId:3,portalId:224643,name:'Customer',isServiceLocation:false,isActive:true};
const site={customerId:3,serviceLocationId:4,portalId:224643,name:'Site',isActive:true,address1:'Synthetic Street'};
const catalog={totalRows:1,results:[{equipmentTypeId:2,portalId:224643,category:'Ranger'}]};
const payload=path=>path.startsWith('/equipmentTypes')?catalog:path.includes('/servicelocations')?{totalRows:1,results:[site]}:parent;
function harness(overrides={}){
 const events=[];const h=createInventoryComparisonHandler({authenticate:async()=>true,acquireRead:async()=>({allowed:true,leaseId:lease}),releaseRead:async()=>events.push('release'),readEquipment:async()=>{events.push('equipment');return review;},readBaseline:async()=>baseline,
 readSource:async(r,b,ids)=>{events.push(['resources',ids]);const times=new Map();return readInventorySource({review:r,baseline:b,refreshEquipmentIds:ids,read:async(path,force)=>{if(force)times.set(path,new Date().toISOString());return payload(path);},observedAt:path=>times.get(path)||new Date(Date.now()-3600000).toISOString(),verifyEquipment:async()=>review});},writeSource:async()=>{events.push('write');throw Error('Must not write');},recordFailure:async()=>events.push('source-fail'),...overrides});return {h,events};
}
test('manual request preserves exact IDs, rejects duplicates, aliases, unbounded and altered payloads',()=>{
 assert.deepEqual(validateEvidenceRefresh(request),{equipmentIds:['1'],sourceSha256:sha});
 for(const bad of [{...request,equipmentIds:[]},{...request,equipmentIds:['1','1']},{...request,equipmentIds:['01']},{...request,equipmentIds:['1.1']},{...request,equipmentIds:Array.from({length:7},(_,i)=>String(i+1))},{...request,sourceSha256:'wrong'},{...request,force:true}])assert.throws(()=>validateEvidenceRefresh(bad));
 for(const b of [{...baseline,sourceSha256:'b'.repeat(64)},{...baseline,records:[{...old,holdReason:'Owner review'}]},{...baseline,records:[{...old,lifecycle:'MISSING'}]},{...baseline,records:[{...old,unitNumber:'Synthetic 029'}]},{...baseline,records:[]}])assert.throws(()=>evidenceRefreshSelection(request,review,b));
 assert.throws(()=>evidenceRefreshSelection(request,{...review,items:[{...equipment,active:false}]},baseline));
});
test('authenticated refresh forces genuine selected customer/site reads, returns dated proof and never commits inventory or bindings',async()=>{
 const before=structuredClone(baseline),{h,events}=harness();const response=await h(req(request)),body=await response.json();assert.equal(response.status,200);assert.equal(body.evidenceRefresh.observations.length,1);assert.equal(body.evidenceRefresh.observations[0].equipmentId,'1');assert.equal(body.evidenceRefresh.acceptedSourceChanged,false);assert.equal(body.evidenceRefresh.publisherBindingsChanged,false);assert.deepEqual(events,['equipment',['resources',['1']],'release']);assert.deepEqual(baseline,before);
});
test('unauthenticated, paused, throttled and incomplete-source requests cannot start resource reads',async()=>{
 for(const [overrides,status] of [[{authenticate:async()=>false},403],[{acquireRead:async()=>({allowed:false,reason:'inventory_paused',retryAt:null})},202],[{acquireRead:async()=>({allowed:false,reason:'source_rate_limited',retryAt:new Date().toISOString()})},202],[{readEquipment:async()=>({...review,partial:true})},503],[{readBaseline:async()=>({...baseline,sourceSha256:'b'.repeat(64)})},503],[{acquireRead:undefined},503]]){const {h,events}=harness(overrides);assert.equal((await h(req(request))).status,status);assert(!events.some(e=>Array.isArray(e)));assert(!events.includes('write'));}
});
test('partial provider failure and equipment drift drain workers, release the lease and never commit or claim freshness',async()=>{
 for(const failure of ['provider','equipment','membership']){
 let inFlight=0;const {h,events}=harness({readSource:async(r,b,ids)=>readInventorySource({review:r,baseline:b,refreshEquipmentIds:ids,observedAt:()=>new Date().toISOString(),verifyEquipment:async()=>failure==='equipment'?{...review,items:[{...equipment,serviceLocationId:'9'}]}:review,read:async path=>{inFlight++;try{await new Promise(resolve=>setTimeout(resolve,1));if(path.includes('servicelocations')){if(failure==='provider')throw Error('private provider body');if(failure==='membership')return {totalRows:0,results:[]};}return payload(path);}finally{inFlight--;}}})});
 const response=await h(req(request)),body=await response.json();assert.equal(response.status,503);assert.equal(inFlight,0);assert(!body.evidenceRefresh);assert(!JSON.stringify(body).includes('private provider'));assert.deepEqual(events,['equipment','release']);
 }
});
test('explicit refresh replaces cache observations, normal reads retain dates, and publisher holds remain independent',async()=>{
 let now=Date.now()-3600000,calls=0;const store=new Map();
 const cache=async(action,key,payload,observedAt)=>{if(action==='read')return store.has(key)?{hit:true,...store.get(key)}:{hit:false};store.set(key,{payload,observedAt});return {saved:true};};
 const run=async ids=>{const c=createInventoryCache({now:()=>now,cache,read:async path=>{calls++;return payload(path);}});return readInventorySource({review,baseline,refreshEquipmentIds:ids,read:c.read,observedAt:c.observedAt,now:()=>new Date(now).toISOString(),verifyEquipment:async()=>review});};
 const initial=await run();assert.equal(calls,3);now+=3600000;const normal=await run();assert.equal(calls,3);assert.equal(normal.records[0].sourceDates.apiCustomerObservedAt,initial.records[0].sourceDates.apiCustomerObservedAt);
 const fresh=await run(['1']);assert.equal(calls,5);assert.equal(fresh.records[0].sourceDates.apiCustomerObservedAt,new Date(now).toISOString());assert.equal(fresh.records[0].sourceDates.apiCategoryObservedAt,initial.records[0].sourceDates.apiCategoryObservedAt);
 assert.equal(evidenceRefreshReceipt(request,fresh,now,now).observations.length,1);assert.throws(()=>evidenceRefreshReceipt(request,normal,now,now));
 const cells=['Synthetic 029.2','FIELD','Customer','Site'].map(v=>snapshotCell({userEnteredValue:{stringValue:v}}));const b={equipmentId:'1',sheetId:2017346590,row:2,label:'Synthetic 029.2',baseline:cells,pending:null,sourceCurrent:true,observation:{state:'confirmed',placement:'FIELD',customerLabel:'Customer',siteLabel:'Site'}},row={sheetId:b.sheetId,row:2,label:b.label,cells,unique:true};
 assert.equal(planPublishing([b],[row]).results[0].state,'unchanged');assert.deepEqual(publisherRefreshCandidates([{...b,sourceCurrent:false}],[row]),[]);
 const manual={...row,cells:cells.map((c,i)=>i===2?snapshotCell({userEnteredValue:{stringValue:'Manual correction'}}):c)};assert.equal(planPublishing([b],[manual]).results[0].reason,'manual_sheet_change');assert.equal(planPublishing([b],[{...row,label:'Another identity'}]).results[0].reason,'sheet_identity_changed');
});
