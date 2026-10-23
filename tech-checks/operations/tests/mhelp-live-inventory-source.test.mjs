import test from 'node:test';
import assert from 'node:assert/strict';
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
import {createInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
const source={equipmentId:'1',portalId:'224643',name:'Ranger 029.2',model:null,active:true,equipmentTypeId:'2',customerId:'3',serviceLocationId:'4'};
const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[source]};
const old={productId:'1',unitNumber:'Ranger 029.2',customerId:'3',customer:'Customer: Site',category:'Ranger',placement:'FIELD',lifecycle:'UNFLAGGED',sourceAddress:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},binding:null};
const baseline={sourceSha256:'a'.repeat(64),companyCustomerIds:['11','12','13','14'],records:[old]};
const parent={customerId:3,portalId:224643,name:'Customer',isServiceLocation:false,address1:'999 Billing Road'};
const site={customerId:3,serviceLocationId:4,portalId:224643,name:'Site',address1:'123 Main St',city:'Houston',state:'TX',zip:'77002'};
const catalog={totalRows:1,results:[{equipmentTypeId:2,portalId:224643,category:'Ranger'}]};
const reader=(overrides={})=>{const read=overrides.read|| (async path=>path.includes('/servicelocations')?{totalRows:1,results:[site]}:parent);return {review,baseline,verifyEquipment:async()=>review,...overrides,read:path=>path.startsWith('/equipmentTypes')?Promise.resolve(catalog):read(path)};};
test('reads only explicit service membership and service address, never billing address or GPS',async()=>{const r=await readInventorySource(reader());assert.equal(r.summary.field,1);assert.equal(r.records[0].customer,'Customer: Site');assert.equal(r.records[0].sourceAddress.street,'123 Main St');assert(!JSON.stringify(r).includes('Billing Road'));assert.equal(r.records[0].binding,null);});
test('all approved company IDs classify as Shop without a service read',async()=>{for(const company of baseline.companyCustomerIds){const equipment={...source,customerId:company,serviceLocationId:company};const v={...review,items:[equipment]};const r=await readInventorySource(reader({review:v,verifyEquipment:async()=>v,read:async path=>{assert(!path.includes('servicelocations'));return {...parent,customerId:Number(company)};}}));assert.equal(r.summary.shop,1);assert.deepEqual(r.records[0].sourceAddress,{street:'',city:'',state:'',zip:''});}});
test('incomplete addresses remain source data and do not invent coordinates',async()=>{const r=await readInventorySource(reader({read:async path=>path.includes('/servicelocations')?{totalRows:1,results:[{...site,address1:'',city:'Bridge road'}]}:parent}));assert.equal(r.records[0].sourceAddress.street,'');assert.equal(r.records[0].sourceAddress.city,'Bridge road');assert(!('latitude' in r.records[0]));});
test('wrong service portal and incomplete pages reject; unavailable membership stays unlocated',async()=>{await assert.rejects(readInventorySource(reader({read:async path=>path.includes('/servicelocations')?{totalRows:1,results:[{...site,portalId:9}]}:parent})));await assert.rejects(readInventorySource(reader({read:async path=>path.includes('/servicelocations')?{totalRows:2,results:[site]}:parent})));const r=await readInventorySource(reader({read:async path=>path.includes('/servicelocations')?{totalRows:1,results:[{...site,customerId:9}]}:parent}));assert.equal(r.records[0].addressReview,'service_membership_unavailable');assert.equal(r.records[0].sourceAddress.street,'');});
test('a source change while reading cannot be published',async()=>{await assert.rejects(readInventorySource(reader({verifyEquipment:async()=>({...review,items:[{...source,serviceLocationId:'5'}]})})),/changed during source read/);});
test('renamed products lose their camera binding and preserve possible identity targets for review',async()=>{const changed={...review,items:[{...source,name:'Ranger 029.3'}]};const b={...baseline,records:[{...old,binding:{nativeUnitId:'11111111-1111-4111-8111-111111111111',trackerId:null,guardCurrent:true}}]};const r=await readInventorySource(reader({review:changed,baseline:b,verifyEquipment:async()=>changed}));assert.equal(r.records[0].binding,null);assert.equal(r.records[0].holdReason,'api_equipment_label_changed');assert.deepEqual(r.records[0].possibleAliasUnitIds,['11111111-1111-4111-8111-111111111111']);});
test('shared customer/site reads are deduplicated',async()=>{const v={...review,totalRows:2,items:[source,{...source,equipmentId:'2',name:'Ranger 030'}]};const r=await readInventorySource(reader({review:v,verifyEquipment:async()=>v}));assert.deepEqual(r.sourceReads,{customers:1,serviceInventories:1});});
test('explicit default-service self-reference reads that exact customer address, never an unrelated service fallback',async()=>{const v={...review,items:[{...source,serviceLocationId:'3'}]};const r=await readInventorySource(reader({review:v,verifyEquipment:async()=>v,read:async path=>{assert(!path.includes('servicelocations'));return {...parent,address1:'123 Current Service St',city:'Houston',state:'TX',zip:'77002'};}}));assert.equal(r.records[0].sourceAddress.street,'123 Current Service St');assert.equal(r.records[0].addressReview,null);});
test('address supplements containing coordinates or access notes are not imported or sent to geocoding',async()=>{const r=await readInventorySource(reader({read:async path=>path.includes('/servicelocations')?{totalRows:1,results:[{...site,address2:'Coordinates: (30.123, -95.123)'}]}:parent}));assert.equal(r.records[0].sourceAddress.street,'123 Main St');assert(!JSON.stringify(r).includes('30.123'));});
test('returning Product IDs can reuse only their unchanged current historical identity proof',async()=>{const b={...baseline,records:[{...old,productId:'9',unitNumber:'Ranger 009'}],apiMissingRecords:[{...old,binding:{guardCurrent:true,nativeUnitId:'11111111-1111-4111-8111-111111111111',trackerId:null}}]};const r=await readInventorySource(reader({baseline:b}));assert.equal(r.records[0].binding.nativeUnitId,'11111111-1111-4111-8111-111111111111');b.apiMissingRecords[0].binding.guardCurrent=false;const held=await readInventorySource(reader({baseline:b}));assert.equal(held.records[0].binding,null);});
test('a changed equipment type cannot silently inherit a verified camera association',async()=>{const b={...baseline,records:[{...old,apiAssignment:{equipmentTypeId:'99'},binding:{guardCurrent:true,nativeUnitId:'11111111-1111-4111-8111-111111111111',trackerId:null}}]};const r=await readInventorySource(reader({baseline:b}));assert.equal(r.records[0].binding,null);assert.equal(r.records[0].holdReason,'api_equipment_type_changed');});

test('cached customer/address/category dates remain older than the true equipment comparison time',async()=>{
 const now='2026-10-20T18:00:00Z',observed='2026-10-20T16:00:00Z';const r=await readInventorySource(reader({now:()=>now,observedAt:()=>observed}));assert.equal(r.readAt,now);assert.equal(r.records[0].sourceDates.apiAddressObservedAt,observed);assert.equal(r.records[0].sourceDates.apiCustomerObservedAt,observed);assert.equal(r.records[0].sourceDates.apiCategoryObservedAt,observed);assert.equal(r.records[0].apiAssignment.placementProof.version,1);
 await assert.rejects(readInventorySource(reader({now:()=>now,observedAt:()=> '2026-10-20T14:00:00Z'})),/observation unavailable/);
 await assert.rejects(readInventorySource(reader({now:()=>now,observedAt:()=> '2026-10-21T14:00:00Z'})),/observation unavailable/);
});
test('new service membership refreshes the bounded cache once, while equipment consistency still rejects a concurrent move',async()=>{
 let refreshes=0;const now='2026-10-20T18:00:00Z';const v={...review,totalRows:2,items:[source,{...source,equipmentId:'2',name:'Ranger 030'}]};
 const r=await readInventorySource({review:v,baseline,now:()=>now,observedAt:()=>now,verifyEquipment:async()=>v,read:async(path,refresh)=>path.startsWith('/equipmentTypes')?catalog:path.includes('servicelocations')?(refresh?(refreshes++,{totalRows:1,results:[site]}):{totalRows:0,results:[]}):parent});assert.equal(refreshes,1);assert(r.records.every(r=>r.addressReview===null));
});
test('cached service addresses retain the exact multiline source text and older observation clocks',async()=>{
 let now=Date.parse('2026-10-22T00:00:00Z'),reads=0;
 const street='123 Main St\r\nSuite 2\tNorth',store=new Map();
 const vendor=async path=>{reads++;return path.startsWith('/equipmentTypes')?catalog:path.includes('/servicelocations')?{totalRows:1,results:[{...site,address1:street}]}:parent;};
 const cache=async(action,key,payload,observedAt)=>{if(action==='read'){const value=store.get(key);return value?{hit:true,...value}:{hit:false};}store.set(key,{payload,observedAt});return {saved:true};};
 const run=async()=>{const resource=createInventoryCache({read:vendor,cache,now:()=>now});return readInventorySource({review,baseline,read:resource.read,observedAt:resource.observedAt,readStats:resource.stats,verifyEquipment:async()=>review,now:()=>new Date(now).toISOString()});};
 const first=await run();assert.equal(first.records[0].sourceAddress.street,street);assert.equal(first.records[0].apiAssignment.placementProof.serviceVerified,true);assert.equal(reads,3);
 now+=15*60*1000;const second=await run();assert.equal(second.records[0].sourceAddress.street,street);assert.equal(reads,3);assert.equal(second.sourceReads.cacheHits,3);assert.equal(second.records[0].sourceDates.apiAddressObservedAt,first.records[0].sourceDates.apiAddressObservedAt);assert.notEqual(second.readAt,first.readAt);assert.equal(second.records[0].apiAssignment.placementProof.version,1);
});

test('publisher refresh rereads only selected resource paths, preserves category age and rejects changed equipment',async()=>{
 const now='2026-10-23T18:00:00Z',oldTime='2026-10-23T16:00:00Z';let calls=[];const dates=new Map();
 const options={review,baseline:{...baseline,publisherRefreshEquipmentIds:['1']},now:()=>now,observedAt:path=>dates.get(path)||oldTime,verifyEquipment:async()=>review,
 read:async(path,refresh)=>{calls.push({path,refresh});if(refresh)dates.set(path,now);return path.startsWith('/equipmentTypes')?catalog:path.includes('/servicelocations')?{totalRows:1,results:[site]}:parent;}};
 const r=await readInventorySource(options);assert.equal(calls.filter(c=>c.refresh).length,2);assert.equal(r.records[0].sourceDates.apiCustomerObservedAt,now);assert.equal(r.records[0].sourceDates.apiAddressObservedAt,now);assert.equal(r.records[0].sourceDates.apiCategoryObservedAt,oldTime);
 await assert.rejects(readInventorySource({...options,verifyEquipment:async()=>({...review,items:[{...source,customerId:'9'}]})}),/changed/);
 await assert.rejects(readInventorySource({...options,baseline:{...baseline,publisherRefreshEquipmentIds:Array(7).fill('1')}}),/selection/);
 await assert.rejects(readInventorySource({...options,read:async()=>{throw Error('provider wait');}}),/provider wait/);
});

test('queued refresh caps actual forced paths and drains failed workers before returning',async()=>{
 let forced=0,inFlight=0,verified=0;const now='2026-10-23T18:00:00Z';
 const sources=Array.from({length:6},(_,i)=>({...source,equipmentId:String(i+1),name:'Synthetic '+i,customerId:String(100+i),serviceLocationId:String(1000+i)}));
 const r={...review,totalRows:6,items:sources},b={...baseline,publisherRefreshEquipmentIds:sources.map(e=>e.equipmentId),records:sources.map(e=>({...old,productId:e.equipmentId,unitNumber:e.name,customerId:e.customerId}))};
 await assert.rejects(readInventorySource({review:r,baseline:b,now:()=>now,observedAt:()=>now,verifyEquipment:async()=>{verified++;return r;},read:async(path,refresh)=>{
  if(path.startsWith('/equipmentTypes'))return catalog;
  assert.equal(refresh,true);forced++;inFlight++;try{await new Promise(resolve=>setTimeout(resolve,1));const u=new URL(path,'https://example.test'),customer=Number(u.pathname.split('/')[2]);
   if(path.includes('/servicelocations')){const offset=Number(u.searchParams.get('rowIndex'));return {totalRows:5000,results:Array.from({length:200},(_,i)=>({...site,customerId:customer,serviceLocationId:10000+offset+i}))};}
   return {...parent,customerId:customer};
  }finally{inFlight--;}
 }}),/bound exceeded/);
 assert.equal(forced,12);assert.equal(inFlight,0);assert.equal(verified,0);
});
