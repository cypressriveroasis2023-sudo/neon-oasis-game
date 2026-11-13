// The camera status edit route, driven in-process with a synthetic network:
// an address becomes a pin only with the point the Census geocoder matched, and
// no match means nothing is recorded. No real provider, socket or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const nativeOrigin='https://synthetic-native.invalid',serviceKey='synthetic-platform-service-key',callerToken='synthetic-owner-user-token';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const census=(matches)=>({result:{addressMatches:matches}});
const katy={matchedAddress:'9500 KATY FWY, HOUSTON, TX, 77024',coordinates:{x:-95.534,y:29.7838}};

function fixture({geocode=census([katy]),geocodeStatus=200,edits=[]}={}){
 const calls=[],unexpected=[],recorded=[];
 const transport=async(url,init={})=>{
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null,headers=new Headers(init.headers);
  calls.push({url,method:init.method||'GET',body});
  if(parsed.pathname==='/auth/v1/user'){assert.equal(headers.get('authorization'),'Bearer '+callerToken);return response({id:owner});}
  if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(name==='user_roles')return response([{role_id:'00000000-0000-4000-8000-000000000999',roles:{code:'owner',organization_id:org}}]);
  if(name==='camera_devices')return response([
   {id:1,device_name:'SP306_1',unit_key:'SPOTTER 306',organization:'Evergen Equity - Chair King',vigilant_status:'Online',activation_state:'active',source_last_seen_at:'2026-11-12T22:18:00Z',public_ip:'38.246.194.14'},
   {id:2,device_name:'SS029_1',unit_key:'SOLARSPOTTER 029',organization:'root',vigilant_status:'Offline',activation_state:'active',source_last_seen_at:'2026-11-12T22:18:00Z',public_ip:null}]);
  if(name==='camera_integrations')return response([{provider:'vigilant',enabled:true,last_sync_at:new Date(Date.now()-60000).toISOString(),last_sync_status:'ok'}]);
  if(name==='cos_camera_unit_hand_edit_state_v1')return response({contract:'COS_UNIT_STATUS_HAND_EDITS_V1',edits});
  if(name==='cos_camera_unit_hand_edit_v1'){recorded.push(body);return response({contract:'COS_UNIT_STATUS_HAND_EDIT_RESULT_V1',id:body.p_request_id,applied:true,repeat:false});}
  if(parsed.hostname==='geocoding.geo.census.gov'){
   // Only the address leaves COS: street, city, state, ZIP and the two fixed settings.
   assert.deepEqual([...parsed.searchParams.keys()].sort(),['benchmark','city','format','state','street','zip']);
   return response(geocode,geocodeStatus);
  }
  unexpected.push(url);throw Error('Unexpected synthetic transport: '+parsed.pathname);
 };
 const handler=createOperationsHandler({platformUrl:nativeOrigin,serviceKey,fetch:transport});
 const send=(path,method,body)=>handler(new Request('https://synthetic-bridge.invalid/functions/v1/cos-operations-pages',{method:'POST',
  headers:{Authorization:'Bearer '+callerToken,'Content-Type':'application/json'},body:JSON.stringify({path,method,body})}));
 return {calls,unexpected,recorded,send};
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

for(const [name,geocode,status,code,pattern] of [
 ['no match',census([]),200,422,/No exact address matched/],
 ['two matches',census([katy,katy]),200,422,/Several addresses matched/],
 ['a different address came back',census([{...katy,matchedAddress:'1 OTHER ST, HOUSTON, TX, 77024'}]),200,422,/different address/],
 ['the address service is down',{error:'busy'},503,503,/unavailable/],
]){
 test('nothing is recorded when '+name,async()=>{
  const f=fixture({geocode,geocodeStatus:status});
  const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'9500 Katy Fwy, Houston, TX 77024'});
  assert.equal(r.status,code);
  assert.match((await r.json()).error,pattern);
  assert.equal(f.recorded.length,0);
 });
}

test('an address that is not street, city, state and ZIP never reaches the geocoder',async()=>{
 const f=fixture();
 const r=await f.send('/api/unit-camera-status/edit','POST',{unitKey:'SPOTTER 306',field:'address',value:'behind the HEB'});
 assert.equal(r.status,422);
 assert.match((await r.json()).error,/street, city, state and ZIP/);
 assert.equal(geocodeCalls(f).length,0);assert.equal(f.recorded.length,0);
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
