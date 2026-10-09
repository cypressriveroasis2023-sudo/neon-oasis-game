import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverVrmInstallations,createVrmFleetReader,VrmDiscoveryError} from '../../supabase/functions/cos-operations-pages/vrmDiscovery.ts';
import {createVrmScheduledHandler} from '../../supabase/functions/cos-vrm-fleet-sync/index.ts';
const token='synthetic-provider-token',lease='11111111-1111-4111-8111-111111111111';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const row=(id,name='Unit '+id)=>({idSite:id,name,idUser:999,identifier:'not-the-installation-id',accessLevel:0,secret:'not-returned'});
const provider=(records,hook)=>async(url,init)=>{hook?.(url,init);return json(url.endsWith('/users/me')?{success:true,user:{id:123,email:'private@example.test'}}:{success:true,records});};
function storage(initial={}){
 let state={items:[{installationId:7,name:'Previous',available:true,lastSeenAt:'2026-10-09T12:00:00Z'}],lastAttemptAt:null,lastSuccessAt:'2026-10-09T12:00:00Z',errorCode:null,retryAfterAt:null,syncing:false,scheduleActive:false,...initial};
 const calls=[];let busy=false;
 const rpc=async(name,payload)=>{
  calls.push({name,payload});
  if(name==='cos_vrm_fleet_snapshot')return structuredClone(state);
  if(name==='cos_vrm_fleet_begin'){if(busy)return {leaseId:null};busy=true;return {leaseId:lease};}
  if(name==='cos_vrm_fleet_finish'){state={...state,items:payload.p_items.map(x=>({...x,available:true})),lastSuccessAt:'2026-10-09T18:00:00Z',errorCode:null};busy=false;return true;}
  if(name==='cos_vrm_fleet_fail'){state.errorCode=payload.p_error_code;busy=false;return true;}
  throw Error('Unhandled RPC');
 };return {rpc,calls,get:()=>state};
}
test('Uses current personal-token header and authenticated user.id; returns only ID/name',async()=>{
 const calls=[];const result=await discoverVrmInstallations(token,provider([row(10,'HELIOS 010'),row(11,'HELIOS 011')],(url,init)=>calls.push({url,init})));
 assert.deepEqual(result,{userId:123,items:[{installationId:10,name:'HELIOS 010'},{installationId:11,name:'HELIOS 011'}]});
 assert.deepEqual(calls.map(c=>c.url),['https://vrmapi.victronenergy.com/v2/users/me','https://vrmapi.victronenergy.com/v2/users/123/installations']);
 for(const c of calls){assert.equal(c.init.method,'GET');assert.equal(c.init.headers['X-Authorization'],'Token '+token);assert.equal(c.init.redirect,'error');assert.ok(c.init.signal);assert.equal(c.init.body,undefined);}
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes(token));
});
test('Zero and duplicate display names are valid, duplicate identity and malformed rows are not',async()=>{
 assert.deepEqual((await discoverVrmInstallations(token,provider([]))).items,[]);
 assert.equal((await discoverVrmInstallations(token,provider([row(1,'Same'),row(2,'Same')]))).items.length,2);
 for(const records of [[row(1),row(1)],[row(-1)],[row('1')],[row(1,'')],[row(1,' name ')],[row(1,'bad\n')],[null],{},null,Array.from({length:5001},(_,i)=>row(i+1))])await assert.rejects(discoverVrmInstallations(token,provider(records)),e=>e.code==='invalid_response');
});
test('Never reconcile partial, paginated, malformed or unsuccessful provider responses',async()=>{
 for(const data of [{success:true,records:[],next:'cursor'},{success:true,records:[],pagination:{}},{success:true,records:[],total:1},{success:true,records:[],count:1},{success:false,errors:{secret:token}},{records:[]}]){
  await assert.rejects(discoverVrmInstallations(token,async(url)=>url.endsWith('/users/me')?json({success:true,user:{id:123}}):json(data)),e=>e instanceof VrmDiscoveryError&&!e.message.includes(token));
 }
 for(const account of [{success:true,user:{idUser:123}},{success:true,user:{id:0}},{success:true,user:{id:'123'}}])await assert.rejects(discoverVrmInstallations(token,async()=>json(account)));
 await assert.rejects(discoverVrmInstallations(token,async()=>new Response('not JSON')),e=>e.code==='invalid_response');
 await assert.rejects(discoverVrmInstallations(token,async()=>new Response('x'.repeat(2*1024*1024+1))),e=>e.code==='invalid_response');
});
test('Provider errors sanitize bodies, preserve status meaning and honor bounded Retry-After',async()=>{
 for(const [status,code,delay,expected] of [[401,'access',null,60],[403,'access',null,60],[500,'provider',null,60],[429,'rate_limit','1200',1200],[429,'rate_limit','1',30],[429,'rate_limit','9999999',86400],[429,'rate_limit','invalid',900]]){
  await assert.rejects(discoverVrmInstallations(token,async()=>json({message:token},status,delay?{'retry-after':delay}:{})),e=>e.code===code&&e.retryAfterSeconds===expected&&!e.message.includes(token));
 }
 await assert.rejects(discoverVrmInstallations(token,async()=>{throw Error(token)}),e=>e.code==='provider'&&!e.message.includes(token));
});
test('Missing connection and cached reads never contact provider or acquire a write lease',async()=>{
 for(const configured of [false,true]){
  const db=storage();const read=createVrmFleetReader({rpc:db.rpc,getAccessToken:()=>configured?token:undefined,fetch:()=>{throw Error('Must not fetch')},now:()=>Date.parse('2026-10-09T18:00:00Z')});
  const result=await read(!configured);assert.equal(result.items[0].installationId,7);assert.equal(result.sync.connectionConfigured,configured);
  assert.deepEqual(db.calls.map(c=>c.name),['cos_vrm_fleet_snapshot']);assert.equal(result.sync.scheduleActive,false);assert.equal(result.sync.nextSyncAt,null);
 }
});
test('Successful refresh persists only ID/name and exact account; failure retains previous snapshot',async()=>{
 const db=storage();const read=createVrmFleetReader({rpc:db.rpc,getAccessToken:()=>token,fetch:provider([row(10)]),now:()=>Date.parse('2026-10-09T18:00:00Z')});
 const result=await read(true);assert.equal(result.items[0].installationId,10);assert.equal(result.sync.state,'current');
 assert.deepEqual(db.calls.find(x=>x.name==='cos_vrm_fleet_finish').payload,{p_lease_id:lease,p_user_id:123,p_items:[{installationId:10,name:'Unit 10'}]});
 const failed=storage();const before=structuredClone(failed.get().items);
 const error=await createVrmFleetReader({rpc:failed.rpc,getAccessToken:()=>token,fetch:async()=>json({secret:token},403)})(true);
 assert.deepEqual(error.items.map(({portalUrl,embedUrl,...x})=>x),before);assert.equal(error.sync.state,'stale');assert.ok(!JSON.stringify(error).includes(token));
 assert.ok(!failed.calls.some(c=>c.name==='cos_vrm_fleet_finish'));
});
test('Busy and rate-limited lease does not refetch; malformed lease fails closed',async()=>{
 for(const begin of [{leaseId:null},null,{}, {leaseId:'invalid'}]){
  const db=storage();const read=createVrmFleetReader({rpc:(name,p)=>name==='cos_vrm_fleet_begin'?Promise.resolve(begin):db.rpc(name,p),getAccessToken:()=>token,fetch:()=>{throw Error('No fetch')}});
  if(begin?.leaseId===null)assert.equal((await read(true)).items[0].installationId,7);else await assert.rejects(read(true));
 }
});
test('Account mismatch and unconfirmed persistence never report refreshed state',async()=>{
 const db=storage();const read=createVrmFleetReader({rpc:(name,p)=>name==='cos_vrm_fleet_finish'?Promise.resolve('account_changed'):db.rpc(name,p),getAccessToken:()=>token,fetch:provider([row(10)])});
 const result=await read(true);assert.equal(result.items[0].installationId,7);assert.equal(result.sync.state,'stale');assert.match(result.sync.error,/different Victron account/);
 assert.equal(db.calls.find(c=>c.name==='cos_vrm_fleet_fail').payload.p_error_code,'account_changed');
});
test('Scheduled endpoint rejects browser and bad/missing credentials before provider access',async()=>{
 const calls=[];const handler=createVrmScheduledHandler({platformUrl:'https://db.example',serviceKey:'synthetic-service',getAccessToken:()=>{throw Error('Must not read')},fetch:async(url,init)=>{calls.push({url,init});return json(false);}});
 for(const request of [new Request('https://edge.example',{method:'GET'}),new Request('https://edge.example',{method:'POST'}),new Request('https://edge.example',{method:'POST',headers:{origin:'https://app.example','x-cos-vrm-sync':'a'.repeat(64)}}),new Request('https://edge.example',{method:'POST',headers:{'x-cos-vrm-sync':'invalid'}})])assert.ok([401,405].includes((await handler(request)).status));
 assert.equal(calls.length,0);
 const denied=await handler(new Request('https://edge.example',{method:'POST',headers:{'x-cos-vrm-sync':'a'.repeat(64)}}));assert.equal(denied.status,401);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/cos_vrm_scheduler_authorized'));
 assert.ok(!(await denied.text()).includes('a'.repeat(64)));
});
test('Scheduled success response contains no names, account, portal or token data',async()=>{
 const db=storage();const remote=provider([row(10,'Private installation')]);
 const handler=createVrmScheduledHandler({platformUrl:'https://db.example',serviceKey:'synthetic-service',getAccessToken:()=>token,fetch:async(url,init)=>{
  if(url.startsWith('https://vrmapi.'))return remote(url,init);
  const name=url.split('/').pop();return json(name==='cos_vrm_scheduler_authorized'?true:await db.rpc(name,JSON.parse(init.body)));
 }});
 const response=await handler(new Request('https://edge.example',{method:'POST',headers:{'x-cos-vrm-sync':'a'.repeat(64)}}));
 const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['lastSuccessAt','ok','state']);assert.ok(!JSON.stringify(data).includes('Private'));
});
