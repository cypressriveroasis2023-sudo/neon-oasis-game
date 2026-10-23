import test from 'node:test';import assert from 'node:assert/strict';
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
import {planPublishing,publisherRefreshCandidates,snapshotCell} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const cell=s=>snapshotCell({userEnteredValue:{stringValue:s}});
const places={shop:{customerId:'10',serviceLocationId:'10',customer:'Cameras Onsite LLC',site:'SHOP',placement:'SHOP',address:''},a:{customerId:'20',serviceLocationId:'21',customer:'Synthetic Builder A',site:'Synthetic Job A',placement:'FIELD',address:'100 Synthetic Street'},b:{customerId:'30',serviceLocationId:'31',customer:'Synthetic Builder B',site:'Synthetic Job B',placement:'FIELD',address:'200 Synthetic Street'}};
for(const [from,to] of [['a','b'],['shop','a'],['a','shop']])test(`same Product ID ${from} to ${to} refreshes real service evidence and preserves protected inputs`,async()=>{
 const before=places[from],after=places[to],now='2026-10-23T18:00:00Z',prior='2026-10-23T16:00:00Z';
 const equipment={equipmentId:'123',portalId:'224643',name:'Spotter 023.1',model:null,equipmentTypeId:'1',customerId:after.customerId,serviceLocationId:after.serviceLocationId,active:true};
 const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[equipment]};
 const baseline={sourceSha256:'a'.repeat(64),companyCustomerIds:['10'],publisherRefreshEquipmentIds:['123'],records:[{productId:'123',unitNumber:equipment.name,category:'SPOTTERS',customerId:before.customerId,placement:before.placement,apiAssignment:{customerId:before.customerId,serviceLocationId:before.serviceLocationId,equipmentTypeId:'1'},binding:{guardCurrent:true,trackerId:'synthetic-tracker'},sourceAddress:{street:before.address}}],protected:{ip:'192.0.2.10',sim:'synthetic-sim',history:['historical installation']}};
 const original=structuredClone(baseline),dates=new Map();
 const source=await readInventorySource({review,baseline,verifyEquipment:async()=>review,now:()=>now,observedAt:p=>dates.get(p)||prior,read:async(path,refresh)=>{
  if(path.startsWith('/equipmentTypes'))return {totalRows:1,results:[{equipmentTypeId:1,portalId:224643,category:'SPOTTERS'}]};
  assert.equal(refresh,true);dates.set(path,now);
  if(path.includes('/servicelocations'))return {totalRows:1,results:[{customerId:Number(after.customerId),serviceLocationId:Number(after.serviceLocationId),portalId:224643,name:after.site,isActive:true,address1:after.address,city:'Synthetic City',state:'TX',zip:'77002',countryId:'US'}]};
  return {customerId:Number(after.customerId),portalId:224643,name:after.customer,isServiceLocation:false,isActive:true};
 }});
 assert.deepEqual(baseline,original);const r=source.records[0];assert.equal(r.productId,'123');assert.equal(r.placement,after.placement);assert.equal(r.apiAssignment.customerId,after.customerId);assert.equal(r.apiAssignment.serviceLocationId,after.serviceLocationId);assert.equal(r.sourceAddress.street,after.address);assert.equal(r.binding.trackerId,'synthetic-tracker');assert(!('latitude' in r));assert(!('ip' in r));assert(!('sim' in r));
 const cells=[equipment.name,before.placement,before.customer,before.site].map(cell);
 const binding={equipmentId:'123',sheetId:2017346590,row:2,label:equipment.name,baseline:cells,pending:null,sourceCurrent:false,observation:{state:'confirmed',placement:after.placement,customerLabel:r.apiAssignment.placementProof.parentLabel,siteLabel:to==='shop'?'SHOP':r.apiAssignment.placementProof.siteLabel}};
 const row={sheetId:binding.sheetId,row:2,label:equipment.name,unique:true,cells};
 assert.deepEqual(publisherRefreshCandidates([binding],[row]),['123']);assert.equal(planPublishing([binding],[row]).requests.length,0);
 const plan=planPublishing([{...binding,sourceCurrent:true}],[row]);assert.equal(plan.intents.length,1);assert.deepEqual(plan.intents[0].cells.map(c=>c.entered.stringValue),[equipment.name,after.placement,after.customer,after.site]);assert(plan.requests.every(q=>[1,3,4].includes(q.updateCells.range.startColumnIndex)));
 const manual={...row,cells:[cells[0],cells[1],cell('Reviewed manual correction'),cells[3]]};assert.deepEqual(publisherRefreshCandidates([binding],[manual]),[]);assert.equal(planPublishing([{...binding,sourceCurrent:true}],[manual]).requests.length,0);
});
