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
function fixture({receiptStatus=200,receipts='all',authenticated=true,onReceipt=null,requestSignal=undefined,productPlacement='FIELD',staleEstimate=false,onSnapshot=null,onPlacement=null}={}){
 const calls=[],unexpected=[];
 const native={id:'00000000-0000-4000-8000-000000000888',unitNumber:'Sniper 888',readOnly:false,_sourceField:true,placement:'FIELD',currentLocationType:'field',status:'field',address:'400 Native Example Road, Test City, TX 77001',customer:'Synthetic native customer',latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:at,gpsRecordedAt:at,hasUnitGps:false};
 const rawSnapshot={inventoryItems:[native],items:[native],summary:{fieldUnits:1,mappedUnits:1,unitGps:0,missingGps:0},generatedAt:at,...(staleEstimate?{sourceEquipmentEstimates:{contract:'COS_SOURCE_EQUIPMENT_ESTIMATES_V1',items:[{stale:true}]}}:{})};
 const products=Array.from({length:3},(_,i)=>({productId:String(920001+i),unitNumber:['Ranger 901','Solar Stand 72 902','Solar Skid 144 903'][i],category:'Synthetic source equipment',customerId:String(930001+i),customer:'Synthetic source customer '+(i+1),sourceAddress:{street:`${100*(i+1)} Example Road`,city:'Test City',state:'TX',zip:'77001'},sourceRow:i+2,placement:productPlacement,lifecycle:'UNFLAGGED',binding:null}));
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
  if(name==='appdeploy_field_map_snapshot'){if(onSnapshot)await onSnapshot(calls.filter(c=>new URL(c.url).pathname.endsWith('/appdeploy_field_map_snapshot')).length);return response(rawSnapshot);}
  if(name==='equipment_units')return response([{id:native.id,organization_id:org,unit_number:native.unitNumber,status:'field'}]);
  if(name==='cos_mhelp_placement_snapshot'){onPlacement?.();return response({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[],upload});}
  if(name==='cos_mhelp_location_snapshot')return response({contract:'COS_MHELP_FLEET_LOCATIONS_V1',items:[]});
  if(name==='cos_source_equipment_estimates_snapshot'){
   assert.equal(parsed.origin,nativeOrigin);assert.equal(parsed.pathname,'/rest/v1/rpc/cos_source_equipment_estimates_snapshot');assert.equal(init.method,'POST');
   assert.equal(headers.get('authorization'),'Bearer '+serviceKey);assert.equal(headers.get('apikey'),serviceKey);assert.notEqual(headers.get('authorization'),'Bearer '+callerToken);
   assert.deepEqual(body,{p_actor_user_id:actor,p_organization_id:org});assert.equal(parsed.search,'');
   if(receiptStatus!==200)return response({code:'42501',message:'Synthetic private receipt permission denied'},receiptStatus);
   const records=receipts==='empty'?[]:structuredClone(saved);if(receipts==='changed-record')records[1].uploadRecord.customer='Different synthetic customer';
   const result={sourceSha256:upload.sourceSha256,payloadSha256:upload.payloadSha256,records};
   if(onReceipt)return onReceipt({signal:init.signal,result,response});
   return response(result);
  }
  if(['camera_devices','vision_vigilant_unit_matches','vision_vigilant_devices','cos_fleet_placement_evidence_v1','cos_geocode_sources_map_projection','cos_archived_representation_projection','cos_source_recorded_coordinates_read_many'].includes(name))return response([]);
  unexpected.push(url);throw Error('Unexpected synthetic transport: '+parsed.pathname);
 };
 const handler=createOperationsHandler({platformUrl:nativeOrigin,serviceKey,fetch:transport,mhelpPlacementEnabled:true});
 const request=new Request('https://synthetic-bridge.invalid/functions/v1/cos-operations-pages',{method:'POST',signal:requestSignal,headers:{Authorization:'Bearer '+callerToken,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/field-map',method:'GET',body:null})});
 return {calls,unexpected,native,products,upload,saved,request,run:()=>handler(request)};
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

// Only the optional post-map read is bounded. These clocks and transports are local.
import {getEventListeners} from 'node:events';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const mockBudget=t=>t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-15T13:00:00Z')});
const assertNativeUnavailable=(map,base)=>{assert.deepEqual(nativeState(map),nativeState(base));assert.equal(map.sourceEquipmentEstimatesStatus,'unavailable');assert.equal(map.sourceEquipmentEstimates,undefined);};
const emptyNativeMap=async()=>await (await fixture({receipts:'empty'}).run()).json();

test('optional read succeeds before its 2000 ms ceiling and cleans up the timer and caller listener',async t=>{
 mockBudget(t);const clear=t.mock.method(globalThis,'clearTimeout'),started=deferred(),release=deferred();let signal;
 const f=fixture({onReceipt:async x=>{signal=x.signal;assert.equal(signal.aborted,false);started.resolve();await release.promise;return x.response(x.result);}}),listeners=getEventListeners(f.request.signal,'abort').length;
 const pending=f.run();await started.promise;t.mock.timers.tick(1999);release.resolve();const map=await (await pending).json();
 assert.equal(map.sourceEquipmentEstimates.items.length,3);assert.equal(map.sourceEquipmentEstimatesStatus,undefined);assert.equal(signal.aborted,true);assert.equal(getEventListeners(f.request.signal,'abort').length,listeners);assert.equal(clear.mock.callCount(),1);
 t.mock.timers.tick(10000);assert.equal(map.sourceEquipmentEstimates.items.length,3);assertReadOnlyTransport(f);
});

test('hung optional transport returns the complete native map at 2000 ms even when it ignores abort',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred();let signal,settled=false;
 const f=fixture({onReceipt:x=>{signal=x.signal;started.resolve();return new Promise(()=>{});}}),pending=f.run().then(r=>{settled=true;return r;});
 await started.promise;t.mock.timers.tick(1999);await turn();assert.equal(settled,false);assert.equal(signal.aborted,false);
 t.mock.timers.tick(1);const r=await pending;assert.equal(r.status,200);assertNativeUnavailable(await r.json(),base);assert.equal(signal.aborted,true);assert.equal(receiptCalls(f).length,1);assertReadOnlyTransport(f);
});

test('caller cancellation aborts only the optional read and keeps completed native state',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred(),controller=new AbortController();let signal;
 const f=fixture({requestSignal:controller.signal,onReceipt:x=>{signal=x.signal;started.resolve();return new Promise(()=>{});}}),listeners=getEventListeners(f.request.signal,'abort').length,pending=f.run();
 await started.promise;controller.abort();const r=await pending;assert.equal(r.status,200);assertNativeUnavailable(await r.json(),base);assert.equal(signal.aborted,true);assert.equal(getEventListeners(f.request.signal,'abort').length,listeners);assertReadOnlyTransport(f);
});

test('already-aborted caller never starts the optional receipt RPC',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),controller=new AbortController();controller.abort();
 const f=fixture({requestSignal:controller.signal}),r=await f.run();assert.equal(r.status,200);assertNativeUnavailable(await r.json(),base);assert.equal(receiptCalls(f).length,0);assertReadOnlyTransport(f);
});

test('late receipt success after timeout cannot promote points or revive stale estimate data',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred(),release=deferred();
 const f=fixture({staleEstimate:true,onReceipt:async x=>{started.resolve();await release.promise;return x.response(x.result);}}),pending=f.run();
 await started.promise;t.mock.timers.tick(2000);const r=await pending,body=await r.text(),map=JSON.parse(body);assertNativeUnavailable(map,base);assert(!body.includes('stale'));
 release.resolve();await turn();await turn();assert.equal(JSON.stringify(map),body);assert.equal(map.sourceEquipmentEstimates,undefined);assert.equal(receiptCalls(f).length,1);
 const next=await (await fixture().run()).json();assert.equal(next.sourceEquipmentEstimates.items.length,3);assertReadOnlyTransport(f);
});

test('late receipt rejection is handled after timeout without unhandled rejection',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred(),release=deferred(),unhandled=[];
 const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);t.after(()=>process.removeListener('unhandledRejection',onUnhandled));
 const f=fixture({onReceipt:async()=>{started.resolve();return release.promise;}}),pending=f.run();await started.promise;t.mock.timers.tick(2000);assertNativeUnavailable(await (await pending).json(),base);
 release.reject(Error('Synthetic late transport rejection'));await turn();await turn();assert.deepEqual(unhandled,[]);assertReadOnlyTransport(f);
});

test('response-body stall is bounded even after the receipt HTTP response arrives',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred();let body,result;
 const f=fixture({onReceipt:x=>{result=x.result;const response=new Response(new ReadableStream({start(c){body=c;started.resolve();}}),{status:200,headers:{'Content-Type':'application/json'}});return response;}}),pending=f.run();
 await started.promise;t.mock.timers.tick(2000);assertNativeUnavailable(await (await pending).json(),base);
 body.enqueue(new TextEncoder().encode(JSON.stringify(result)));body.close();await turn();assertReadOnlyTransport(f);
});

test('timeout during asynchronous projection validation cannot publish a late estimate',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),started=deferred(),release=deferred();let pause=false;
 const digest=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',async(...args)=>{if(pause){started.resolve();await release.promise;}return digest(...args);});
 const f=fixture({onReceipt:x=>{pause=true;return x.response(x.result);}}),pending=f.run();await started.promise;t.mock.timers.tick(2000);assertNativeUnavailable(await (await pending).json(),base);
 pause=false;release.resolve();await turn();await turn();assertReadOnlyTransport(f);
});

test('optional RPC failure returns unavailable and removes the caller abort listener',async t=>{
 mockBudget(t);const base=await emptyNativeMap(),f=fixture({onReceipt:async()=>{throw Error('Synthetic source read failure');}}),listeners=getEventListeners(f.request.signal,'abort').length;
 assertNativeUnavailable(await (await f.run()).json(),base);assert.equal(getEventListeners(f.request.signal,'abort').length,listeners);t.mock.timers.tick(2000);assertReadOnlyTransport(f);
});

test('no source candidate uses no optional RPC, timer, or unavailable fallback',async t=>{
 mockBudget(t);const timers=t.mock.method(globalThis,'setTimeout'),f=fixture({productPlacement:'SHOP'}),listeners=getEventListeners(f.request.signal,'abort').length,response=await f.run(),map=await response.json();assert.equal(response.status,200,JSON.stringify({map,unexpected:f.unexpected}));
 assert.equal(receiptCalls(f).length,0);assert.equal(timers.mock.callCount(),0);assert.equal(map.sourceEquipmentEstimatesStatus,undefined);assert.equal(map.sourceEquipmentEstimates,undefined);assert.deepEqual(map.inventoryItems.map(r=>r.id),[f.native.id]);assert.equal(getEventListeners(f.request.signal,'abort').length,listeners);assertReadOnlyTransport(f);
});


test('saved mHelp placement read starts while the final authority snapshot is pending',async()=>{
 let release,started=false,placements=0;const gate=new Promise(resolve=>{release=resolve;});
 const f=fixture({onSnapshot:async n=>{if(n===2){started=true;await gate;}},onPlacement:()=>{placements++;}});
 const pending=f.run();
 try{
  for(let i=0;i<100&&!started;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started,true);assert.equal(placements,1,'independent saved placement must not wait for fresh projection work');
 }finally{release();}
 const result=await pending;assert.equal(result.status,200);const map=await result.json();
 assert.equal(map.uploadInventory.payloadSha256,f.upload.payloadSha256);assertReadOnlyTransport(f);
});
