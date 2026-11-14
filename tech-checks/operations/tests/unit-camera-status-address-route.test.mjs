// The camera status edit route, driven in-process with a synthetic network:
// an address is saved as typed with the one point the address service has for
// it, and no single location means nothing is recorded. No real provider, socket or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const nativeOrigin='https://synthetic-native.invalid',serviceKey='synthetic-platform-service-key',callerToken='synthetic-owner-user-token';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const census=(matches)=>({result:{addressMatches:matches}});
const katy={matchedAddress:'9500 KATY FWY, HOUSTON, TX, 77024',coordinates:{x:-95.534,y:29.7838}};

function fixture({geocode=census([katy]),geocodeStatus=200,edits=[]}={}){
 const calls=[],unexpected=[],recorded=[],asked=[];
 const transport=async(url,init={})=>{
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null,headers=new Headers(init.headers);
  calls.push({url,method:init.method||'GET',body});
  if(parsed.pathname==='/auth/v1/user'){assert.equal(headers.get('authorization'),'Bearer '+callerToken);return response({id:owner});}
  if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(name==='user_roles')return response([{role_id:'00000000-0000-4000-8000-000000000999',roles:{code:'owner',organization_id:org}}]);
  if(name==='camera_health_current')return response([{camera_device_id:50,overall_status:'online',checked_at:new Date(Date.now()-120000).toISOString()},{camera_device_id:60,overall_status:'online',checked_at:'2026-11-13T18:00:00Z'}]);
  if(name==='camera_devices'&&parsed.searchParams.get('source')!=='eq.vigilant_control_center')return response([
   {id:50,device_name:'Sniper 004',unit_key:'SNIPER 004',organization:'TRACKER FIELD',source:'2026_unit_tracker',activation_state:'active',public_ip:'203.0.113.4'},
   {id:60,device_name:'CAM 1',unit_key:'RII010 - Arcosa',organization:'RII010 - Arcosa',source:'reconeyez',activation_state:'active',source_last_seen_at:'2026-11-13T18:00:00Z',public_ip:null}]);
  if(name==='camera_devices')return response([
   {id:1,device_name:'SP306_1',unit_key:'SPOTTER 306',organization:'Evergen Equity - Chair King',vigilant_status:'Online',activation_state:'active',source_last_seen_at:'2026-11-12T22:18:00Z',public_ip:'38.246.194.14'},
   {id:2,device_name:'SS029_1',unit_key:'SOLARSPOTTER 029',organization:'root',vigilant_status:'Offline',activation_state:'active',source_last_seen_at:'2026-11-12T22:18:00Z',public_ip:null}]);
  if(name==='camera_integrations')return response(['vigilant','reconeyez'].map(provider=>({provider,enabled:true,last_sync_at:new Date(Date.now()-60000).toISOString(),last_sync_status:'ok'})));
  if(name==='cos_camera_unit_hand_edit_state_v1')return response({contract:'COS_UNIT_STATUS_HAND_EDITS_V1',edits});
  if(name==='cos_camera_unit_hand_edit_v1'){recorded.push(body);return response({contract:'COS_UNIT_STATUS_HAND_EDIT_RESULT_V1',id:body.p_request_id,applied:true,repeat:false});}
  if(parsed.hostname==='geocoding.geo.census.gov'){
   // Only the address text leaves COS, with the two fixed settings.
   assert.equal(parsed.pathname,'/geocoder/locations/onelineaddress');
   assert.deepEqual([...parsed.searchParams.keys()].sort(),['address','benchmark','format']);
   asked.push(parsed.searchParams.get('address'));
   return response(geocode,geocodeStatus);
  }
  unexpected.push(url);throw Error('Unexpected synthetic transport: '+parsed.pathname);
 };
 const handler=createOperationsHandler({platformUrl:nativeOrigin,serviceKey,fetch:transport});
 const send=(path,method,body)=>handler(new Request('https://synthetic-bridge.invalid/functions/v1/cos-operations-pages',{method:'POST',
  headers:{Authorization:'Bearer '+callerToken,'Content-Type':'application/json'},body:JSON.stringify({path,method,body})}));
 return {calls,unexpected,recorded,asked,send};
}
const geocodeCalls=f=>f.calls.filter(c=>c.url.includes('geocoding.geo.census.gov'));

test('a matched address is recorded with the point the geocoder found',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'9500 Katy Fwy, Houston, TX 77024',reason:'Placed today'});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.recorded.length,1);
 const p=f.recorded[0].p_payload;
 assert.equal(p.field,'address');assert.equal(p.value,'9500 Katy Fwy, Houston, TX 77024');
 assert.equal(p.latitude,29.7838);assert.equal(p.longitude,-95.534);assert.equal(p.matchedAddress,katy.matchedAddress);
 assert.equal(p.providerValue,null);
 assert.equal(f.recorded[0].p_actor_user_id,actor,'the actor is the signed-in session');
 assert.deepEqual(f.unexpected,[]);
});

for(const [name,geocode,status,pattern] of [
 ['no match',census([]),200,/could not find that address/],
 ['two matches',census([katy,katy]),200,/more than one place/],
 ['a match with no location',census([{matchedAddress:katy.matchedAddress,coordinates:{x:0,y:0}}]),200,/no usable location/],
 ['the address service is down',{error:'busy'},503,/unavailable/],
]){
 test('the address is still saved, without a pin, when '+name,async()=>{
  const f=fixture({geocode,geocodeStatus:status});
  const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'9500 Katy Fwy, Houston, TX 77024'});
  assert.equal(r.status,200,await r.clone().text());
  const data=await r.json();
  assert.equal(data.recorded.pinned,false);assert.match(data.recorded.pinNote,pattern);
  assert.equal(f.recorded.length,1);
  const p=f.recorded[0].p_payload;
  assert.equal(p.value,'9500 Katy Fwy, Houston, TX 77024');
  assert.equal('latitude' in p,false);assert.equal('matchedAddress' in p,false);
 });
}

// James, 2026-11-13: "i put the correct one so it shouldnt matter ... it should
// update what i say." The service's spelling differing from his is not a refusal.
test('the address is saved as typed even when the service spells it differently',async()=>{
 const f=fixture({geocode:census([{matchedAddress:'9500 KATY FREEWAY, HOUSTON, TX, 77024-1234',coordinates:{x:-95.534,y:29.7838}}])});
 const typed='9500 katy fwy  houston tx';
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:typed});
 assert.equal(r.status,200,await r.clone().text());
 const p=f.recorded[0].p_payload;
 assert.equal(p.value.toLowerCase().startsWith('9500 katy fwy'),true,'his text, not the service spelling');
 assert.equal(p.matchedAddress,'9500 KATY FREEWAY, HOUSTON, TX, 77024-1234');
 assert.equal(p.latitude,29.7838);assert.equal(p.longitude,-95.534);
 assert.deepEqual(f.asked,['9500 katy fwy houston tx']);
 assert.equal((await r.clone().json()).recorded.pinned,true);
});

test('a description instead of a street address is saved as typed, without a pin',async()=>{
 const f=fixture({geocode:census([])});
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'Behind the HEB on FM 1960'});
 assert.equal(r.status,200);
 assert.equal(f.recorded[0].p_payload.value,'Behind the HEB on FM 1960');
 assert.equal((await r.json()).recorded.pinned,false);
});

test('text carrying a code or a link is refused and never reaches the service',async()=>{
 for(const value of ['1 Main St gate code 4471','see https://example.invalid/1']){
  const f=fixture();
  const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value});
  assert.equal(r.status,422,value);
  assert.match((await r.json()).error,/street address only/);
  assert.equal(geocodeCalls(f).length,0);assert.equal(f.recorded.length,0);
 }
});

test('a caller cannot supply its own map point',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'9500 Katy Fwy, Houston, TX 77024',latitude:1,longitude:2});
 assert.equal(r.status,400);
 assert.equal(geocodeCalls(f).length,0);assert.equal(f.recorded.length,0);
});

test('other fields and a cleared address never call the geocoder or carry a point',async()=>{
 for(const body of [{unitKey:'SPOTTER 306',field:'site',value:'Evergen Equity - Chair King 2'},{unitKey:'SPOTTER 306',field:'address',action:'clear'}]){
  const f=fixture();
  const r=await f.send('/api/unit-camera-status/edit','POST',body);
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(geocodeCalls(f).length,0);
  assert.equal('latitude' in f.recorded[0].p_payload,false);
 }
});

test('the status read carries the pin for a unit with a recorded address',async()=>{
 const f=fixture({edits:[{unit_key:'SPOTTER 306',field:'address',action:'set',value:'9500 Katy Fwy, Houston, TX 77024',actor_name:'James',actor_role:'owner',
  created_at:'2026-11-12T23:00:00Z',latitude:29.7838,longitude:-95.534,matched_address:katy.matchedAddress}]});
 const r=await f.send('/api/unit-camera-status','GET',null);
 assert.equal(r.status,200);
 const unit=(await r.json()).units.find(u=>u.unit==='SPOTTER 306');
 assert.equal(unit.state,'GREEN');
 assert.deepEqual(unit.location,{latitude:29.7838,longitude:-95.534,matchedAddress:katy.matchedAddress,source:'hand'});
});

test('the read lists Avigilon and Reconeyez units beside Star4Live, each with its source',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status','GET');
 assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();
 assert.equal(data.otherSourcesRead,true);
 assert.deepEqual(data.units.map(u=>[u.unit,u.source,u.state]),[
  ['RII010 - Arcosa','reconeyez','GREEN'],['SNIPER 004','ip_check','GREEN'],['SOLARSPOTTER 029','star4live','RED'],['SPOTTER 306','star4live','GREEN']]);
 assert.equal(data.counts.field.units,3);
 assert.deepEqual(f.unexpected,[]);
});
test('an Avigilon unit has no Star4Live IP to correct by hand',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SNIPER 004',field:'public_ip',value:'8.8.8.8'});
 assert.equal(r.status,422,await r.clone().text());
 assert.equal(f.recorded.length,0);
});
test('an Avigilon unit can still be moved to the shop by hand',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SNIPER 004',field:'placement',value:'SHOP'});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.recorded[0].p_payload.unitKey,'SNIPER 004');
});
