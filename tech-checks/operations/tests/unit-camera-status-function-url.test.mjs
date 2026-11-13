// The camera status function is reached at its own URL, not the Operations
// function's. The shared handler only reads its envelope under a name it knows,
// so the live tab answered "COS endpoint not found" for every signed-in read.
// This drives the handler with the real production URL shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {handlerUrl, servedEnvelopeBody} from '../../supabase/functions/cos-unit-camera-status/servedPath.ts';

const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const live='https://synthetic-project.invalid/functions/v1/cos-unit-camera-status';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const transport=async url=>{
 const parsed=new URL(url),name=parsed.pathname.split('/').at(-1);
 if(parsed.pathname==='/auth/v1/user')return response({id:owner});
 if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
 if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
 if(name==='user_roles')return response([{role_id:'00000000-0000-4000-8000-000000000999',roles:{code:'owner',organization_id:org}}]);
 if(name==='camera_devices')return response([{id:1,device_name:'SP306_1',unit_key:'SPOTTER 306',organization:'A Site',vigilant_status:'Online',activation_state:'active',source_last_seen_at:new Date().toISOString(),public_ip:null}]);
 if(name==='camera_integrations')return response([{provider:'vigilant',enabled:true,last_sync_at:new Date(Date.now()-60000).toISOString(),last_sync_status:'ok'}]);
 throw Error('Unexpected synthetic transport: '+parsed.pathname);
};
const handler=createOperationsHandler({platformUrl:'https://synthetic-native.invalid',serviceKey:'synthetic-key',fetch:transport});
const request=(url,path)=>new Request(url,{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json'},
 body:servedEnvelopeBody(JSON.stringify({path,method:'GET',body:null}))});

test('handed its own URL, the shared handler cannot find the route (the live fault)',async()=>{
 const r=await handler(request(live,'/api/unit-camera-status'));
 assert.equal(r.status,404);
});

test('handed the Operations name, the same request is served',async()=>{
 const r=await handler(request(handlerUrl(live),'/api/unit-camera-status'));
 assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();
 assert.equal(data.contract,'COS_STAR_UNIT_STATUS_V1');
 assert.equal(data.units[0].unit,'SPOTTER 306');
});

test('only the function name changes, and other paths are still refused',async()=>{
 assert.equal(handlerUrl(live),'https://synthetic-project.invalid/functions/v1/cos-operations-pages');
 assert.equal(handlerUrl(live+'?x=1'),'https://synthetic-project.invalid/functions/v1/cos-operations-pages?x=1');
 assert.equal(handlerUrl('https://h.invalid/functions/v1/cos-unit-camera-status-other'),'https://h.invalid/functions/v1/cos-unit-camera-status-other');
 const r=await handler(request(handlerUrl(live),'/api/session'));
 assert.equal(r.status,404);
});
