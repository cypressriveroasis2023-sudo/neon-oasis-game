// The Owner's "accept the unit list" route, driven in-process with a synthetic
// network. Proves the POST is reachable, that a list too old for the board can
// still be accepted, and that only the Owner can do it. No database is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const nativeOrigin='https://synthetic-native.invalid',serviceKey='synthetic-platform-service-key',callerToken='synthetic-owner-user-token';
const sha=v=>createHash('sha256').update(v).digest('hex');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
// Received two days ago: far past the 45-minute and 24-hour age gates.
const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha('synthetic census'),payloadSha256:sha('synthetic payload'),
 receivedAt:new Date(Date.now()-2*24*3600e3).toISOString(),records:[
  {productId:'2001',placement:'FIELD',sourceAddress:{street:'1 Test Rd'}},
  {productId:'2002',placement:'FIELD',sourceAddress:{street:'2 Test Rd'}},
  {productId:'2003',placement:'SHOP',sourceAddress:{street:'3 Test Rd'}}]};

function fixture({role='owner',refuse=false}={}){
 const calls=[],recorded=[],unexpected=[];
 const transport=async(url,init={})=>{
  const parsed=new URL(url),name=parsed.pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null;
  calls.push({url,body});
  if(parsed.pathname==='/auth/v1/user')return response({id:owner});
  if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role,active:true,archived_at:null}]);
  if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:role,active:true}]);
  if(name==='user_roles')return response([{role_id:'00000000-0000-4000-8000-000000000999',roles:{code:role,organization_id:org}}]);
  if(name==='cos_mhelp_placement_snapshot')return response({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[],upload});
  if(name==='cos_inventory_freeze_v1'){
   recorded.push(body);
   if(refuse)return response({code:'PT409',message:'COS inventory is already frozen; unfreeze first'},409);
   return response({contract:'COS_INVENTORY_FREEZE_RESULT_V1',id:body.p_request_id,applied:true,repeat:false});
  }
  unexpected.push(url);throw Error('Unexpected synthetic transport: '+parsed.pathname);
 };
 const handler=createOperationsHandler({platformUrl:nativeOrigin,serviceKey,fetch:transport});
 const send=(method,body)=>handler(new Request('https://synthetic-bridge.invalid/functions/v1/cos-operations-pages',{method:'POST',
  headers:{Authorization:'Bearer '+callerToken,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/inventory-freeze',method,body})}));
 return {calls,recorded,unexpected,send};
}

test('the Owner can accept a unit list that is too old for the board',async()=>{
 const f=fixture();
 const r=await f.send('POST',{action:'freeze',reason:'COS keeps this list now'});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.recorded.length,1);
 const call=f.recorded[0];
 assert.equal(call.p_actor_user_id,actor);assert.equal(call.p_organization_id,org);assert.equal(call.p_action,'freeze');
 assert.match(call.p_request_id,/^[0-9a-f-]{36}$/);
 assert.deepEqual({...call.p_payload,acceptedByName:undefined},{sourceSha256:upload.sourceSha256,recordCount:3,fieldCount:2,shopCount:1,
  acceptedByName:undefined,reason:'COS keeps this list now'});
 assert.ok(call.p_payload.acceptedByName);
 assert.equal('ipCensus' in call.p_payload,false,'the IP list is not read from the tracker here');
 assert.deepEqual(f.unexpected,[]);
});

test('releasing the list names no census',async()=>{
 const f=fixture();
 const r=await f.send('POST',{action:'unfreeze',reason:'Taking a fresh copy'});
 assert.equal(r.status,200);
 assert.equal('sourceSha256' in f.recorded[0].p_payload,false);
});

for(const [name,method,body,code] of [
 ['a GET',             'GET', {},                                   405],
 ['no reason',         'POST',{action:'freeze'},                    400],
 ['another action',    'POST',{action:'delete',reason:'x'},         400],
 ['a caller-made sha', 'POST',{action:'freeze',reason:'x',sourceSha256:'a'},400],
 ['a bad request id',  'POST',{action:'freeze',reason:'x',requestId:'nope'},400],
]){
 test('refused before the database: '+name,async()=>{
  const f=fixture();
  const r=await f.send(method,body);
  assert.equal(r.status,code,await r.clone().text());
  assert.equal(f.recorded.length,0);
 });
}

test('a database refusal is reported, not hidden',async()=>{
 const f=fixture({refuse:true});
 const r=await f.send('POST',{action:'freeze',reason:'again'});
 assert.ok(r.status>=400);
 assert.equal(f.recorded.length,1);
});
