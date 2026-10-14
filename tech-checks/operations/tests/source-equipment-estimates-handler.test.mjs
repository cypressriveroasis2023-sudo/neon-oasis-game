// In-process authenticated handler tests. Every transport response is synthetic;
// no browser, socket, external fetch or provider invocation is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {sourceEquipmentLocationPins} from '../src/fleetLocationPins.ts';

// Fixed existing auth-map identities exercise the unchanged authentication gate.
// Equipment, addresses, product records, receipts and credentials below are synthetic.
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const nativeOrigin='https://synthetic-native.invalid',serviceKey='synthetic-platform-service-key',callerToken='synthetic-owner-user-token';
const sha=value=>createHash('sha256').update(value).digest('hex'),at='2026-10-06T17:45:00Z';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture({receiptStatus=200,receipts='all',authenticated=true}={}){
 const calls=[],unexpected=[];
 const native={id:'00000000-0000-4000-8000-000000000888',unitNumber:'Sniper 888',readOnly:false,_sourceField:true,placement:'FIELD',currentLocationType:'field',status:'field',address:'400 Native Example Road, Test City, TX 77001',customer:'Synthetic native customer',latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:at,gpsRecordedAt:at,hasUnitGps:false};
 const rawSnapshot={inventoryItems:[native],items:[native],summary:{fieldUnits:1,mappedUnits:1,unitGps:0,missingGps:0},generatedAt:at};
 const products=Array.from({length:3},(_,i)=>({productId:String(920001+i),unitNumber:['Ranger 901','Solar Stand 72 902','Solar Skid 144 903'][i],category:'Synthetic source equipment',customerId:String(930001+i),customer:'Synthetic source customer '+(i+1),sourceAddress:{street:`${100*(i+1)} Example Road`,city:'Test City',state:'TX',zip:'77001'},sourceRow:i+2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:null}));
 const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha('synthetic handler source export'),payloadSha256:sha('synthetic handler reviewed payload'),receivedAt:at,receivedAtPrecision:'second',exportAsOf:null,records:products};
 const saved=products.map((record,i)=>{
  const address=`${record.sourceAddress.street}, Test City, TX 77001`.toLowerCase();
  return {contract:'COS_SAVED_ADDRESS_CACHE_V1',productId:record.productId,sourceSha256:upload.sourceSha256,payloadSha256:upload.payloadSha256,uploadRecord:structuredClone(record),uploadRecordSha256:sha(JSON.stringify(record)),linkageGraphSha256:sha('synthetic unchanged source graph '+record.productId),receiptId:`00000000-0000-4000-8000-${String(940001+i).padStart(12,'0')}`,address,addressSha256:sha(address),status:'success',latitude:30+i,longitude:-95-i,matchedAddress:`${100*(i+1)} EXAMPLE RD, TEST CITY, TX, 77001`,geocodedAt:'2026-10-06T17:30:00Z',provider:'geocodio',accuracyType:'rooftop',accuracy:1,matchType:null,benchmark:null,verified:false,liveGps:false};
 });
 const transport=async(url,init={})=>{
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null,headers=new Headers(init.headers);calls.push({url,method:init.method||'GET',body,headers});
  if(parsed.pathname==='/auth/v1/user'){assert.equal(headers.get('authorization'),'Bearer '+callerToken);return authenticated?response({id:owner}):response({message:'Synthetic expired sign-in'},401);}
  if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(name==='user_roles')return response([{role_id:'00000000-0000-4000-8000-000000000999',roles:{code:'owner',organization_id:org}}]);
  if(name==='cos_owner_identity_snapshot')return response({revision:sha('synthetic empty crosswalk'),claims:[],nativeEpochs:[]});
  if(name==='appdeploy_field_map_snapshot')return response(rawSnapshot);
  if(name==='equipment_units')return response([{id:native.id,organization_id:org,unit_number:native.unitNumber,status:'field'}]);
  if(name==='cos_mhelp_placement_snapshot')return response({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[],upload});
  if(name==='cos_mhelp_location_snapshot')return response({contract:'COS_MHELP_FLEET_LOCATIONS_V1',items:[]});
  if(name==='cos_source_equipment_estimates_snapshot'){
   assert.equal(parsed.origin,nativeOrigin);assert.equal(parsed.pathname,'/rest/v1/rpc/cos_source_equipment_estimates_snapshot');assert.equal(init.method,'POST');
   assert.equal(headers.get('authorization'),'Bearer '+serviceKey);assert.equal(headers.get('apikey'),serviceKey);assert.notEqual(headers.get('authorization'),'Bearer '+callerToken);
   assert.deepEqual(body,{p_actor_user_id:actor,p_organization_id:org});assert.equal(parsed.search,'');
   if(receiptStatus!==200)return response({code:'42501',message:'Synthetic private receipt permission denied'},receiptStatus);
   const records=receipts==='empty'?[]:structuredClone(saved);if(receipts==='changed-record')records[1].uploadRecord.customer='Different synthetic customer';
   return response({sourceSha256:upload.sourceSha256,payloadSha256:upload.payloadSha256,records});
  }
  if(['camera_devices','vision_vigilant_unit_matches','vision_vigilant_devices','cos_fleet_placement_evidence_v1','cos_geocode_sources_map_projection','cos_archived_representation_projection','cos_source_recorded_coordinates_read_many'].includes(name))return response([]);
  unexpected.push(url);throw Error('Unexpected synthetic transport: '+parsed.pathname);
 };
 const handler=createOperationsHandler({platformUrl:nativeOrigin,serviceKey,fetch:transport,mhelpPlacementEnabled:true});
 return {calls,unexpected,native,products,upload,saved,run:()=>handler(new Request('https://synthetic-bridge.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer '+callerToken,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/field-map',method:'GET',body:null})}))};
}
const receiptCalls=f=>f.calls.filter(call=>new URL(call.url).pathname==='/rest/v1/rpc/cos_source_equipment_estimates_snapshot');
const nativeState=map=>({items:map.items,inventoryItems:map.inventoryItems,summary:map.summary,fleetRoster:map.fleetRoster});
function assertReadOnlyTransport(f){
 assert.deepEqual(f.unexpected,[]);assert.equal(f.calls.some(call=>/source_equipment.*(?:cache|read_many)|camera-field-geocode|geocoding\.geo\.census|api\.geocod/.test(call.url)),false);
 assert.equal(f.calls.some(call=>call.method!=='GET'&&!new URL(call.url).pathname.startsWith('/rest/v1/rpc/')),false);
 for(const call of receiptCalls(f))assert.equal(new URL(call.url).origin,nativeOrigin);
}
test('authenticated Owner field-map handler reads exactly three reviewed source estimates through the native service actor route',async()=>{
 const f=fixture(),r=await f.run(),map=await r.json();assert.equal(r.status,200,JSON.stringify({map,paths:f.calls.map(call=>new URL(call.url).pathname),unexpected:f.unexpected}));assert.equal(receiptCalls(f).length,1);assertReadOnlyTransport(f);
 assert.equal(map.sourceEquipmentEstimatesStatus,undefined);assert.equal(map.sourceEquipmentEstimates.contract,'COS_SOURCE_EQUIPMENT_ESTIMATES_V1');assert.equal(map.sourceEquipmentEstimates.items.length,3);
 assert.deepEqual(map.sourceEquipmentEstimates.items.map(item=>[item.recordId,item.productId,item.receiptId,item.uploadRecordSha256,item.latitude,item.longitude,item.verified,item.liveGps]),f.saved.map(item=>['mhelp_product:'+item.productId,item.productId,item.receiptId,item.uploadRecordSha256,item.latitude,item.longitude,false,false]));
 assert.equal(map.uploadInventory.payloadSha256,f.upload.payloadSha256);assert.deepEqual(map.inventoryItems.map(row=>row.id),[f.native.id]);assert.deepEqual(map.items.map(row=>[row.id,row.latitude,row.longitude]),[[f.native.id,f.native.latitude,f.native.longitude]]);
 const sourceRows=map.fleetRoster.items.filter(row=>row.kind==='source_equipment');assert.equal(sourceRows.length,3);assert(sourceRows.every(row=>row.unitId===null&&row.unit===null));
 const pins=await sourceEquipmentLocationPins(sourceRows,map.sourceEquipmentEstimates,map.uploadInventory);assert.equal(pins.length,3);assert(pins.every(pin=>pin.row===undefined));
 const baseline=fixture({receipts:'empty'}),baselineResponse=await baseline.run();assert.deepEqual(nativeState(map),nativeState(await baselineResponse.json()));assertReadOnlyTransport(baseline);
});
test('private native receipt permission failure is explicit and preserves the complete native map without fabricated source points',async()=>{
 const baseline=fixture({receipts:'empty'}),baselineMap=await (await baseline.run()).json();
 for(const receiptStatus of [401,403]){
  const f=fixture({receiptStatus}),r=await f.run(),map=await r.json();assert.equal(r.status,200,JSON.stringify({map,paths:f.calls.map(call=>new URL(call.url).pathname),unexpected:f.unexpected}));assert.equal(receiptCalls(f).length,1);assert.equal(map.sourceEquipmentEstimatesStatus,'unavailable');assert.equal(map.sourceEquipmentEstimates,undefined);assert.deepEqual(nativeState(map),nativeState(baselineMap));
  assert.deepEqual(await sourceEquipmentLocationPins(map.fleetRoster.items,map.sourceEquipmentEstimates,map.uploadInventory),[]);assert.deepEqual(map.items.map(row=>[row.id,row.latitude,row.longitude]),[[f.native.id,f.native.latitude,f.native.longitude]]);assertReadOnlyTransport(f);
 }
});
test('reviewed receipt with changed exact upload record is rejected instead of borrowing its address point',async()=>{
 const f=fixture({receipts:'changed-record'}),r=await f.run(),map=await r.json();assert.equal(r.status,200,JSON.stringify({map,paths:f.calls.map(call=>new URL(call.url).pathname),unexpected:f.unexpected}));assert.deepEqual(map.sourceEquipmentEstimates.items.map(item=>item.productId),[f.products[0].productId,f.products[2].productId]);assert.equal(map.inventoryItems.length,1);assertReadOnlyTransport(f);
});
test('failed Owner authentication cannot reach the native receipt reader or map snapshot',async()=>{
 const f=fixture({authenticated:false}),r=await f.run();assert.equal(r.status,401);assert.equal(receiptCalls(f).length,0);assert.equal(f.calls.some(call=>call.url.includes('/rest/v1/rpc/')),false);assertReadOnlyTransport(f);
});
