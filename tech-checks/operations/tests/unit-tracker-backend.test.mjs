import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {checkedTrackerRequest,checkedTrackerSnapshot,createUnitTracker,UNIT_TRACKER_CONTRACT as contract,UNIT_TRACKER_WORKBOOK as workbookId} from '../../supabase/functions/cos-operations-pages/unitTracker.ts';
import {fleetRouteAllowed,verifiedItFleet,fleetFeatures} from '../../supabase/functions/cos-operations-pages/fleetAccess.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const connector={enabled:false,state:'awaiting_sheets_connection'};
const snapshot=()=>({contract,workbookId,queueEnabled:true,connector,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
const changes={placement:'SHOP',siteLabel:null};
const identity={family:'SNIPERS',fullVariant:'Sniper 2',unitLabel:'003'};
const input=()=>({requestId:randomUUID(),kind:'add',identity:{...identity},changes:{...changes}});
const receipt=body=>({requestId:body.requestId,kind:body.kind,status:'awaiting_sheets_connection',createdAt:'2026-10-09T00:00:00Z',identity:{...identity,unitId:null,sourceRecordId:null},expectedSourceRevision:null,changes:{...body.changes},before:null,proposed:{placement:'SHOP',street:null,city:null,state:null,zip:null,siteLabel:null,customerLabel:null}});
test('only bounded read and queue routes are granted to exact verified IT, without expanding unrelated routes',()=>{
 const id=randomUUID();for(const[method,path]of[['GET','/api/unit-tracker'],['GET','/api/unit-tracker/'+id],['GET','/api/unit-tracker/requests/'+id],['POST','/api/unit-tracker/requests']])assert.equal(fleetRouteAllowed(method,path),true);
 for(const[method,path]of[['POST','/api/unit-tracker'],['POST','/api/unit-tracker/'+id],['GET','/api/unit-tracker/requests'],['POST','/api/unit-tracker/publish'],['GET','/api/unit-tracker/003'],['POST','/api/owner-identity/approve']])assert.equal(fleetRouteAllowed(method,path),false);
 assert.equal(fleetFeatures().unitTracker,true);assert.equal(verifiedItFleet({department:'it',legacyOwner:false,legacyId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actorId:'d0757b64-9623-4adc-afff-21cc7853e88a'}),true);
 assert.equal(verifiedItFleet({department:'it',legacyOwner:false,actorId:'d0757b64-9623-4adc-afff-21cc7853e88a'}),false);
});
test('strict request allowlist preserves null versus omitted, rejects caller identity on updates and formulas',()=>{
 const a=input();assert.deepEqual(checkedTrackerRequest(a),a);assert.equal(Object.hasOwn(checkedTrackerRequest(a).changes,'street'),false);
 const u={requestId:randomUUID(),kind:'update',unitId:randomUUID(),expectedSourceRevision:randomUUID(),changes:{customerLabel:null}};
 assert.deepEqual(checkedTrackerRequest(u),u);
 for(const bad of [{...u,identity},{...u,actorId:randomUUID()},{...u,changes:{}},{...u,changes:{formula:'=1'}},{...u,changes:{siteLabel:'=1'}},{...u,changes:{siteLabel:'10.2.3.4'}},{...a,identity:{...identity,fullVariant:'003'}},{...a,identity:{...identity,unitLabel:'10.2.3.4'}}])assert.throws(()=>checkedTrackerRequest(bad));
});
test('unavailable backend is explicit while authorization errors propagate',async()=>{
 const fallback=createUnitTracker({actorPayload:{},rpc:async()=>{throw Object.assign(new Error('Unavailable'),{status:503});}});
 const result=await fallback('/api/unit-tracker','GET',null);assert.equal(result.availability,'unavailable');assert.equal(result.queueEnabled,false);assert.deepEqual(result.connector,connector);
 for(const status of [401,403])await assert.rejects(createUnitTracker({actorPayload:{},rpc:async()=>{throw Object.assign(new Error('Denied'),{status});}})('/api/unit-tracker','GET',null),e=>e.status===status);
});
test('backend never invents persistence after failed, partial, misbound or allegedly published response',async()=>{
 const a=input();
 for(const response of [{created:true},{created:true,ownedByCurrentActor:true,connector,request:{...receipt(a),requestId:randomUUID()}},{created:true,ownedByCurrentActor:true,connector,request:{...receipt(a),status:'published'}},{created:true,connector:{enabled:true,state:'connected'},request:receipt(a)},{created:true,ownedByCurrentActor:true,connector,request:{...receipt(a),proposed:{...receipt(a).proposed,street:'Unexpected'}}}]){
  const handler=createUnitTracker({actorPayload:{},rpc:async()=>response});await assert.rejects(handler('/api/unit-tracker/requests','POST',a));
 }
});
test('same request ID reaches only named native RPC and no external transport exists',async()=>{
 const calls=[],a=input();const handler=createUnitTracker({actorPayload:{p_actor_user_id:'actor',p_organization_id:'org'},rpc:async(name,args)=>{calls.push({name,args});return {created:calls.length===1,ownedByCurrentActor:true,connector,request:receipt(args.p_request)};}});
 assert.equal((await handler('/api/unit-tracker/requests','POST',a)).created,true);assert.equal((await handler('/api/unit-tracker/requests','POST',a)).created,false);
 assert.deepEqual(calls.map(c=>c.args.p_request.requestId),[a.requestId,a.requestId]);assert.equal(calls.every(c=>c.name==='cos_unit_tracker_enqueue'),true);
 const source=await readFile(new URL('../../supabase/functions/cos-operations-pages/unitTracker.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|Deno\.env|process\.env|googleapis\.com/);
});
test('snapshot requires explicit list limits and cannot advertise an active Sheets connector',()=>{
 assert.equal(checkedTrackerSnapshot(snapshot()).availability,'available');
 for(const data of [{...snapshot(),connector:{enabled:true,state:'connected'}},{...snapshot(),sourcesTruncated:undefined},{...snapshot(),sourcesHeld:undefined},{...snapshot(),workbookId:'old_workbook'},{...snapshot(),sources:Array(2001).fill({})}])assert.throws(()=>checkedTrackerSnapshot(data));
});
const ownerLegacy='e4abc521-1ef3-45a6-9829-b87faff78210',ownerActor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const actors=[{legacy:ownerLegacy,actor:ownerActor,name:'Owner',dept:'owner',role:'owner'},{legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',dept:'it',role:'it_technician'},{legacy:'b7cc3cbf-d11e-4d4a-9742-c07701857911',actor:'3caf7c00-627f-445f-bce4-ddeae574ee5c',name:'Victor Garcia',dept:'it',role:'it_technician'},{legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',dept:'service',role:'service_technician'}];
function bridge(who,denied=false){
 const calls=[];const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-test-key',fetch:async(url,init={})=>{
  const data=init.body?JSON.parse(init.body):null;calls.push({url,data});const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
  if(url.includes('/auth/v1/user'))return json({id:who.legacy});
  if(url.includes('/rest/v1/profiles?'))return json([{user_id:who.legacy,full_name:who.name,role:who.dept,active:true,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return json([{user_id:who.actor,display_name:who.name,department:who.dept,active:true}]);
  if(url.includes('/rest/v1/user_roles?'))return json([{role_id:randomUUID(),roles:{code:who.role,organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'}}]);
  if(url.endsWith('/rpc/cos_unit_tracker_snapshot'))return denied?json({code:'42501',message:'Denied'},400):json(snapshot());
  if(url.endsWith('/rpc/cos_unit_tracker_enqueue'))return json({created:true,ownedByCurrentActor:true,connector,request:receipt(data.p_request)});
  throw Error('Unexpected URL '+url);
 }});
 const request=(path,method='GET',body={})=>handler(new Request('https://bridge.example',{method:'POST',headers:{Authorization:'Bearer synthetic-token','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method,body})}));
 return{calls,request};
}
test('bridge authenticates Owner/verified IT, binds real actor, and denies Service and server-side revoked permission',async()=>{
 for(const who of actors){const f=bridge(who);const response=await f.request('/api/unit-tracker');assert.equal(response.status,who.dept==='service'?403:200);
  if(who.dept==='service'){assert.equal(f.calls.some(c=>c.url.includes('cos_unit_tracker_')),false);continue;}
  assert.equal((await f.request('/api/unit-tracker/requests','POST',input())).status,200);
  const rpcCall=f.calls.find(c=>c.url.endsWith('cos_unit_tracker_enqueue'));assert.equal(rpcCall.data.p_actor_user_id,who.actor);
  assert.equal(f.calls.some(c=>/google|sheets/.test(c.url)),false);
 }
 assert.equal((await bridge(actors[0],true).request('/api/unit-tracker')).status,403);
});
test('selected source read requires exact pending ID and exact source UUID receipt binding',async()=>{
 const unitId=randomUUID(),requestId=randomUUID(),sourceRevision=randomUUID();
 const source={...identity,unitId,sourceRevision,sourceIdentity:{sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:'+workbookId+':12:'+identity.fullVariant+'|'+identity.unitLabel},fields:{placement:'SHOP',street:null,city:null,state:null,zip:null,siteLabel:null,customerLabel:null},pendingRequestId:null};
 const read=async row=>createUnitTracker({actorPayload:{},rpc:async()=>({...row,contract,workbookId,queueEnabled:true,connector})})('/api/unit-tracker/'+unitId,'GET',null);
 assert.equal((await read({...source,pendingRequest:null})).pendingRequest,null);
 const pending={...receipt({requestId,kind:'update',changes:{siteLabel:'Pending site'}}),identity:{...identity,unitId,sourceRecordId:source.sourceIdentity.sourceRecordId},expectedSourceRevision:sourceRevision,before:source.fields,proposed:{...source.fields,siteLabel:'Pending site'}};
 assert.equal((await read({...source,pendingRequestId:requestId,pendingRequest:pending})).pendingRequest.requestId,requestId);
 for(const row of [{...source,pendingRequest:undefined},{...source,pendingRequestId:requestId,pendingRequest:null},{...source,pendingRequestId:randomUUID(),pendingRequest:pending},{...source,pendingRequestId:requestId,pendingRequest:{...pending,identity:{...pending.identity,unitId:randomUUID()}}}])await assert.rejects(read(row),/verified|incomplete/);
});
test('full bridge returns definite 400 for locally invalid tracker requests instead of uncertain 503',async()=>{
 const f=bridge(actors[0]);const response=await f.request('/api/unit-tracker/requests','POST',{...input(),identity:{...identity,unitLabel:'001/A'}});assert.equal(response.status,400);assert.equal(f.calls.some(c=>c.url.endsWith('/rpc/cos_unit_tracker_enqueue')),false);
});
test('exact request lookup exposes verified caller ownership and cannot return a different request ID',async()=>{
 const a=input(),value={request:receipt(a),ownedByCurrentActor:true,connector};const handler=createUnitTracker({actorPayload:{},rpc:async name=>{assert.equal(name,'cos_unit_tracker_request_read');return value;}});
 assert.equal((await handler('/api/unit-tracker/requests/'+a.requestId,'GET',null)).ownedByCurrentActor,true);
 value.ownedByCurrentActor=false;assert.equal((await handler('/api/unit-tracker/requests/'+a.requestId,'GET',null)).ownedByCurrentActor,false);
 value.request={...value.request,requestId:randomUUID()};await assert.rejects(handler('/api/unit-tracker/requests/'+a.requestId,'GET',null));
 value.request=null;value.ownedByCurrentActor=false;assert.equal((await handler('/api/unit-tracker/requests/'+a.requestId,'GET',null)).request,null);
});
