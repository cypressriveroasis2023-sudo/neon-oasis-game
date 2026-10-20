import test from 'node:test';import assert from 'node:assert/strict';
import {checkSavedCamera} from '../../supabase/functions/cos-operations-pages/cameraDiagnostics.ts';
import {prepareCameraDiagnosticsRuntime} from '../scripts/prepareCameraDiagnosticsRuntime.mjs';
import {createHash} from 'node:crypto';
const device={id:12,unit_key:'Sniper 12',public_ip:'8.8.8.8',expected_ports:[80,443],monitoring_enabled:true};
const body={unitKey:'Sniper 12',publicIp:'8.8.8.8',ports:[80,443],mode:'quick'};
function fixture(options={}){const calls=[];return {calls,input:{id:'12',body,headers:{Authorization:'Bearer synthetic-user',apikey:'synthetic-public'},fetcher:async(url,init)=>{calls.push({url,init});if(calls.length===1)return Response.json([options.device||device]);if(options.failure)return Response.json({error:'secret upstream detail'},{status:options.failure});return Response.json(options.result||{device_id:12,public_ip_used:'8.8.8.8',checked_at:'2026-10-20T21:30:00Z',ports:{80:{online:true,latency_ms:12,secret:'hidden'},443:{online:false,latency_ms:null}}});}}};}
for(const mode of ['quick','ports'])test('checks only the authenticated saved device in '+mode+' mode',async()=>{const f=fixture();f.input.body={...body,mode};const result=await checkSavedCamera(f.input);assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.headers.Authorization,'Bearer synthetic-user');assert.deepEqual(JSON.parse(f.calls[1].init.body),{device_id:12,fast_verify:mode==='quick',skip_provider_sync:true});assert.deepEqual(result.ports,[{port:80,reachable:true,latencyMs:12},{port:443,reachable:false,latencyMs:null}]);assert.doesNotMatch(JSON.stringify(result),/secret|provider|Bearer/);});
for(const change of [{unitKey:'Another unit'},{publicIp:'1.1.1.1'},{ports:[22]},{url:'https://evil.example'},{mode:'icmp'}])test('rejects changed or arbitrary target '+JSON.stringify(change),async()=>{const f=fixture();f.input.body={...body,...change};await assert.rejects(()=>checkSavedCamera(f.input));assert(f.calls.length<2);});
for(const change of [{public_ip:'192.168.1.1'},{monitoring_enabled:false}])test('never probes an unavailable saved connection '+JSON.stringify(change),async()=>{const f=fixture({device:{...device,...change}});await assert.rejects(()=>checkSavedCamera(f.input));assert.equal(f.calls.length,1);});
for(const status of [401,403,409,503])test('failed checker '+status+' supplies no success or upstream detail',async()=>{const f=fixture({failure:status});await assert.rejects(()=>checkSavedCamera(f.input),e=>!e.message.includes('secret'));assert.equal(f.calls.length,2);});
test('rejects a response from a changed endpoint',async()=>{const f=fixture({result:{device_id:12,public_ip_used:'1.1.1.1',checked_at:'2026-10-20T21:30:00Z',ports:{80:{online:true}}}});await assert.rejects(()=>checkSavedCamera(f.input));});
test('runtime overlay preserves every original byte and requires an exact reviewed hash',async()=>{const live='let verifiedFleetIt=verifiedItFleet(context);console.log("preserved");',hash=createHash('sha256').update(live).digest('hex');const prepared=await prepareCameraDiagnosticsRuntime(live,hash);assert(prepared.unrelatedBytesPreserved);assert(prepared.content.endsWith('console.log("preserved");'));await assert.rejects(()=>prepareCameraDiagnosticsRuntime(live,'wrong'));await assert.rejects(()=>prepareCameraDiagnosticsRuntime(live.replace('let','const'),createHash('sha256').update(live.replace('let','const')).digest('hex')));});

import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const users={owner:{id:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',role:'owner',name:'Owner',code:'owner'},it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',role:'it',name:'Teddy Hopper',code:'it_technician'},service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',role:'service',name:'Abel Cervantes',code:'service_technician'}};
for(const [role,active,expected] of [['owner',true,200],['it',true,200],['service',true,403],['owner',false,403],['it',false,403]])test(`authenticated bridge admission ${role} active=${active}`,async()=>{
 const user=users[role],calls=[];
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-service',fetch:async(url,init={})=>{
  calls.push({url,init});
  if(url.includes('/auth/v1/user'))return Response.json({id:user.id});
  if(url.includes('/profiles?'))return Response.json([{user_id:user.id,full_name:user.name,role:user.role,active,archived_at:null}]);
  if(url.includes('/user_profiles?'))return Response.json([{user_id:user.actor,display_name:user.name,department:user.role,active:true}]);
  if(url.includes('/user_roles?'))return Response.json([{roles:{code:user.code,organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);
  if(url.includes('/camera_devices?'))return Response.json([device]);
  if(url.endsWith('/camera-health-check'))return Response.json({device_id:12,public_ip_used:device.public_ip,checked_at:'2026-10-20T21:30:00Z',ports:{80:{online:true,latency_ms:10}}});
  throw Error('Unexpected synthetic request');
 }});
 const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-user','Content-Type':'application/json'},body:JSON.stringify({method:'POST',path:'/api/camera-health/devices/12/check',body})}));
 assert.equal(response.status,expected,await response.text());assert.equal(calls.filter(c=>c.url.endsWith('/camera-health-check')).length,expected===200?1:0);
});
