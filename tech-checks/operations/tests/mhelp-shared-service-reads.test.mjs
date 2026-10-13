import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPlacementObservations,createPlacementSyncHandler} from '../../supabase/functions/cos-mhelp-placement-sync/index.ts';
import {createFleetLocationReader} from '../../supabase/functions/cos-mhelp-placement-sync/locationReader.ts';
import {createPlacementParentReadCache} from '../../supabase/functions/cos-mhelp-placement-sync/parentReadCache.ts';
import {collectFleetLocations} from '../../supabase/functions/cos-mhelp-placement-sync/fleetLocations.ts';
const portal='224643';
const parent=id=>({customerId:id,portalId:portal,name:id==='99'?'Cameras Onsite':'Synthetic builder '+id,isServiceLocation:false,isActive:true});
const service=(id,customerId='11',extra={})=>({serviceLocationId:id,customerId,portalId:portal,name:'Synthetic installation '+id,isActive:true,address1:'123 Synthetic Street',city:'Houston',state:'TX',zip:'77002',latitude:29.76,longitude:-95.37,...extra});
const link={equipmentId:'1',fullLabel:'Helios 001',model:null};
const equipment={...link,name:link.fullLabel,active:true,customerId:'11',serviceLocationId:'201'};
const noGeocoder=async()=>{throw Error('Unexpected geocoder');};

test('placements and fleet addresses reuse complete parent pages without per-site customer GETs',async()=>{
 const parentCalls=[],pageCalls=[],cache=createPlacementParentReadCache();
 const assigned=[['11','201'],['11','202'],['11','201'],['12','301'],['12','301'],['99','999']];
 const links=assigned.map((_,i)=>({...link,equipmentId:String(i+1),fullLabel:'Helios '+String(i+1).padStart(3,'0')}));
 const rows=links.map((l,i)=>({...equipment,...l,name:l.fullLabel,customerId:assigned[i][0],serviceLocationId:assigned[i][1]}));
 const reader=createFleetLocationReader(async path=>{
  const hit=cache.read(path);if(hit)return hit;
  pageCalls.push(path);const id=/\/customers\/(\d+)\/servicelocations/.exec(path)?.[1];assert.ok(id,'No extra customer or billing read');
  const values=id==='11'?[service('201'),service('202')]:[service('301','12')];return {totalRows:values.length,results:values};
 },noGeocoder);
 const observations=await collectPlacementObservations(links,rows,async id=>{
  parentCalls.push(id);const raw=parent(id);cache.remember(id,raw);return {customerId:id,name:raw.name,isServiceLocation:false,placement:id==='99'?'SHOP':'FIELD'};
 },reader.placementService);
 const locations=await collectFleetLocations(links.map((l,i)=>({kind:'tracker',unitId:String(i),unitNumber:l.fullLabel,guard:'a'.repeat(64)})),rows,reader);
 assert.equal(observations.filter(r=>r.state==='confirmed').length,6);assert.equal(locations.filter(r=>r.state==='confirmed').length,6);
 assert.deepEqual(parentCalls.sort(),['11','12','99']);assert.equal(pageCalls.length,2);
 assert.equal(locations.at(-1).placement,'SHOP');assert.equal(locations.at(-1).address,null);assert.equal(observations.at(-1).siteLabel,'SHOP');
});
test('a valid service identity verifies placement while its incomplete address is held',async()=>{
 const reader=createFleetLocationReader(async path=>path.includes('/servicelocations')?{totalRows:1,results:[service('201','11',{zip:null})]}:parent('11'),noGeocoder);
 const result=await collectPlacementObservations([link],[equipment],async id=>({...parent(id),placement:'FIELD'}),reader.placementService);
 assert.equal(result[0].state,'confirmed');assert.equal(result[0].placement,'FIELD');await assert.rejects(reader(equipment,null),/address review/);
});
test('wrong-parent, wrong-portal, inactive, contradictory and duplicate sites never verify placement',async()=>{
 for(const row of [service('201','88'),service('201','11',{portalId:'9'}),service('201','11',{isActive:false}),service('201','11',{isServiceLocation:false}),service('201','11',{name:'bad\u0000label'})]){
  const reader=createFleetLocationReader(async()=>({totalRows:1,results:[row]}),noGeocoder);
  const result=await collectPlacementObservations([link],[equipment],async id=>({...parent(id),placement:'FIELD'}),reader.placementService);
  assert.equal(result[0].reason,'service_location_unverified');
 }
 for(const page of [{totalRows:2,results:[service('201'),service('201')]},{totalRows:1,results:[]},{totalRows:0,results:[]}]){
  const reader=createFleetLocationReader(async()=>page,noGeocoder);await assert.rejects(reader.placementService('11','201'));
 }
});
test('a selected first-page site stays held if a later page is incomplete',async()=>{
 let calls=0;const reader=createFleetLocationReader(async()=>++calls===1?{totalRows:201,results:Array.from({length:200},(_,i)=>service(String(201+i)))}:{totalRows:201,results:[]},noGeocoder);
 await assert.rejects(reader.placementService('11','201'),/page incomplete/);assert.equal(calls,2);
});
test('Shop and failed parent reads never request service membership',async()=>{
 for(const customer of [null,{...parent('11'),isServiceLocation:true,placement:'FIELD'},{...parent('11'),placement:'SHOP'}]){
  let reads=0;const result=await collectPlacementObservations([link],[equipment],async()=>customer,async()=>{reads++;throw Error();});
  assert.equal(reads,0);assert.equal(result[0].state,customer?.placement==='SHOP'?'confirmed':'held');
 }
});
test('the scheduled handler verifies services before collecting and committing addresses',async()=>{
 const calls=[];const handler=createPlacementSyncHandler({authenticate:async()=>true,equipment:async()=>[equipment],customer:async id=>({...parent(id),placement:'FIELD'}),service:async(p,s)=>{calls.push('service');assert.deepEqual([p,s],['11','201']);return {customerId:s,name:'Synthetic installation',isServiceLocation:true,placement:'FIELD'};},locations:async()=>{calls.push('locations');return [];},rpc:async(name,body)=>{
  if(name.endsWith('begin'))return {leaseId:'synthetic-lease',links:[link]};assert.equal(name,'cos_mhelp_fleet_finish');calls.push('finish');assert.equal(body.p_observations[0].state,'confirmed');return {committed:true,confirmed:1,held:0};
 }});
 assert.equal((await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"run"}'}))).status,200);
 assert.deepEqual(calls,['service','locations','finish']);
});
