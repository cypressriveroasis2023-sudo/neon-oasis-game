import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpReconnect,MhelpReconnectError} from '../../supabase/functions/cos-operations-pages/mhelpReconnect.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {checkedReconnectStatus} from '../src/mhelpReconnectModel.ts';
const portal='224643',requestId='00000000-0000-4000-8000-000000000001',lease='00000000-0000-4000-8000-000000000002';
const secret='synthetic-reconnect-secret',body={accessToken:secret+'-access',refreshToken:secret+'-refresh',expectedRevision:2,requestId};
const reply=(row,status=200)=>new Response(JSON.stringify(row),{status,headers:{'Content-Type':'application/json'}});
function fixture(change={}){
 const events=[];let configReads=0,committed=false;
 const flow=createMhelpReconnect({getConfig:()=>{configReads++;return {clientId:secret+'-client',clientSecret:secret+'-client-secret',...change.config};},session:async request=>{
  events.push({kind:'session',...request});
  if(request.p_action==='reconnect_status')return {configured:true,portal_id:portal,revision:committed?3:2,...(request.p_request_id?{committed,in_progress:change.pending===true}:{}),...change.status};
  if(request.p_action==='reconnect_claim'){
   if(change.claimFailure)throw Error(secret);
   return change.replay?{committed:true,portal_id:portal,revision:3}:{configured:true,portal_id:portal,revision:2,lease_id:lease};
  }
  if(request.p_action==='reconnect_commit'){
   if(change.commitFailures>0){change.commitFailures--;throw Error(secret);}
   committed=true;return {committed:true,portal_id:portal,revision:3};
  }
  if(request.p_action==='release')return {released:true};
  throw Error(secret);
 },fetch:async(url,init)=>{
  events.push({kind:'fetch',url,init});
  assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  if(change.fetcher)return change.fetcher(url,init);
  if(url==='https://login.mhelpdesk.com/connect/token')return reply(change.issued||{access_token:secret+'-issued',refresh_token:secret+'-rotated',token_type:'Bearer',expires_in:3600},change.tokenStatus||200);
  assert.equal(url,'https://connect.mhelpdesk.com/api/v1.0/users/me');
  return reply({portalId:Number(init.headers.Authorization===('Bearer '+body.accessToken)?(change.initialPortal||portal):(change.renewedPortal||portal)),email:secret},change.accountStatus||200);
 }});
 return {flow:{...flow,reconnect:(value,authorize=async()=>{})=>flow.reconnect(value,authorize)},events,configReads:()=>configReads,committed:()=>committed};
}
const safe=(e)=>e instanceof MhelpReconnectError&&!JSON.stringify(e).includes(secret)&&!e.message.includes(secret)&&e.cause===undefined;
test('explicit reconnect verifies input and normal refresh against immutable portal before saving only issued pair',async()=>{
 const f=fixture(),result=await f.flow.reconnect({...body});
 assert.deepEqual(result,{contract:'cos-mhelpdesk-reconnect-v1',state:'committed',portalId:portal,revision:3,renewalVerified:true,requestId});
 assert.deepEqual(f.events.map(v=>v.p_action||v.url),['reconnect_claim','https://connect.mhelpdesk.com/api/v1.0/users/me','https://login.mhelpdesk.com/connect/token','https://connect.mhelpdesk.com/api/v1.0/users/me','reconnect_commit']);
 const form=new URLSearchParams(f.events[2].init.body);
 assert.deepEqual(Object.fromEntries(form),{client_id:secret+'-client',client_secret:secret+'-client-secret',grant_type:'refresh_token',scope:'openid profile offline_access mhdapi',refresh_token:body.refreshToken});
 const saved=f.events.at(-1);assert.equal(saved.p_access_token,secret+'-issued');assert.equal(saved.p_refresh_token,secret+'-rotated');assert.equal(saved.p_expected_revision,2);assert.equal(saved.p_request_id,requestId);assert.equal(saved.p_portal_id,portal);assert.equal(saved.p_session,lease);
 assert(!JSON.stringify(result).includes(secret));
});
test('metadata status never reads client config, old Vault credentials, or calls vendor',async()=>{
 const f=fixture();assert.deepEqual(await f.flow.status({}),{contract:'cos-mhelpdesk-reconnect-v1',state:'ready',portalId:portal,revision:2,renewalVerified:false});
 assert.equal(f.configReads(),0);assert.deepEqual(f.events,[{kind:'session',p_action:'reconnect_status'}]);
});
test('invalid input has no side effects and accepts no identity/client/URL override',async()=>{
 for(const input of [null,[],{}, {...body,clientId:'no'},{...body,clientSecret:'no'},{...body,portalId:'999'},{...body,url:'no'},{...body,expectedRevision:0},{...body,expectedRevision:'2'},{...body,requestId:'bad'}, {...body,accessToken:'bad token'},{...body,refreshToken:'a'.repeat(16385)},{...body,accessToken:'bad\u0000token'}]){
  const f=fixture();await assert.rejects(f.flow.reconnect(input),safe);assert.equal(f.events.length,0);assert.equal(f.configReads(),0);
 }
 const f=fixture();await assert.rejects(f.flow.status({requestId}),safe);assert.equal(f.events.length,0);
});
test('denied/stale claim and invalid submitted account preserve old pair; claimed pre-rotation failures release lease',async()=>{
 const denied=fixture({claimFailure:true});await assert.rejects(denied.flow.reconnect(body),safe);assert.deepEqual(denied.events.map(v=>v.p_action),['reconnect_claim']);
 for(const change of [{initialPortal:'999'},{accountStatus:401},{config:{portalId:'999'}}]){
  const f=fixture(change);await assert.rejects(f.flow.reconnect(body),safe);assert(!f.committed());assert.equal(f.events.at(-1).p_action,'release');assert(!f.events.some(v=>v.url?.includes('login.')));
 }
});
test('cross-portal renewed response and invalid token responses never replace old pair and retain uncertain rotation lease',async()=>{
 for(const change of [{renewedPortal:'999'},{tokenStatus:400},{issued:{access_token:secret,token_type:'Basic',expires_in:3600}},{issued:{access_token:secret,token_type:'Bearer',expires_in:1}},{issued:{access_token:secret,token_type:'Bearer',expires_in:3600,refresh_token:'bad token'}}]){
  const f=fixture(change);await assert.rejects(f.flow.reconnect(body),safe);assert(!f.committed());assert(!f.events.some(v=>v.p_action==='release'||v.p_action==='reconnect_commit'));
 }
});
test('lost commit acknowledgement retries only same atomic commit; exact completed request does not rotate again',async()=>{
 const f=fixture({commitFailures:1});await f.flow.reconnect(body);const commits=f.events.filter(v=>v.p_action==='reconnect_commit');assert.equal(commits.length,2);assert.deepEqual(commits[0],commits[1]);
 const uncertain=fixture({commitFailures:2});await assert.rejects(uncertain.flow.reconnect(body),safe);assert(!uncertain.events.some(v=>v.p_action==='release'));assert.equal(uncertain.events.filter(v=>v.url?.includes('login.')).length,1);
 const replay=fixture({replay:true});const result=await replay.flow.reconnect(body);assert.equal(result.state,'committed');assert.equal(replay.events.length,1);
 const verified=await f.flow.status({requestId,expectedRevision:2});assert.equal(verified.state,'committed');assert.equal(verified.requestId,requestId);
});
test('simultaneous reconnect refuses second request rather than sharing caller credentials',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});const f=fixture({fetcher:async(url)=>{await gate;return url.includes('/connect/token')?reply({access_token:secret,token_type:'Bearer',expires_in:3600}):reply({portalId:Number(portal)});}});
 const first=f.flow.reconnect(body);await assert.rejects(f.flow.reconnect({...body,requestId:lease}),e=>safe(e)&&e.status===409);resume();await first;
 assert.equal(f.events.filter(v=>v.url?.includes('login.')).length,1);assert.equal(f.events.at(-1).p_refresh_token,body.refreshToken);
});
test('stalled or oversized provider response is bounded and cannot echo secret bytes',async t=>{
 const original=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>original(fn,delay===45000?2:delay,...args));
 for(const response of [()=>new Response('x'.repeat(32769)),()=>new Response(new ReadableStream({start(){},cancel(){return new Promise(()=>{});}})),()=>{throw Error(secret);}]){
  const f=fixture({fetcher:async()=>response()});await assert.rejects(f.flow.reconnect(body),safe);assert(!f.committed());assert.equal(f.events.at(-1).p_action,'release');
 }
});
test('browser model rejects extra fields, wrong portal, wrong revision and uncorrelated success',()=>{
 const good={contract:'cos-mhelpdesk-reconnect-v1',state:'committed',portalId:portal,revision:3,renewalVerified:true,requestId},attempt={requestId,expectedRevision:2,portalId:portal};
 assert.deepEqual(checkedReconnectStatus(good,attempt),good);
 for(const patch of [{access_token:secret},{portalId:'999'},{revision:2},{requestId:lease},{renewalVerified:false},{state:'unknown'}])assert.throws(()=>checkedReconnectStatus({...good,...patch},attempt));
 assert.throws(()=>checkedReconnectStatus(good));
});
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function routeFixture(change={}){
 const calls=[];let reconnects=0,authReads=0;const handler=createOperationsHandler({platformUrl:'https://native.example',serviceKey:'synthetic-server',mhelpReconnect:{status:async()=>{reconnects++;return {safe:true};},reconnect:async(value,reauthorize)=>{reconnects++;await reauthorize();if(change.failure)throw Object.assign(Error(secret),{body:secret});return {safe:true};}},fetch:async url=>{
  calls.push(url);if(url.includes('/auth/v1/user')){authReads++;if(change.afterAuth&&authReads>1)Object.assign(change,change.afterAuth);return reply(change.invalid?{}:{id:change.id||owner},change.invalid?401:200);}
  if(url.includes('/rest/v1/profiles?'))return reply([{user_id:change.id||owner,full_name:'Synthetic',role:change.role||'owner',active:!change.inactive,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return reply([{user_id:actor,display_name:'Synthetic',department:'owner',active:!change.nativeInactive}]);
  if(url.includes('/rest/v1/user_roles?'))return reply(change.revoked?[]:[{role_id:lease,roles:{code:'owner',organization_id:org}}]);
  throw Error(secret);
 }});return {handler,calls,count:()=>reconnects};
}
function request({origin='https://cypressriveroasis2023-sudo.github.io',contentType='application/json',method='POST',path='/api/mhelpdesk/partner/reconnect',direct=false,value=body,query=''}={}){
 return new Request('https://native.example/functions/v1/cos-operations-pages'+(direct?path:'')+query,{method:'POST',headers:{Authorization:'Bearer synthetic-session',...(origin?{Origin:origin}:{}),'Content-Type':contentType},body:JSON.stringify(direct?value:{path,method,body:value})});
}
test('Owner route is production-origin JSON POST only, gated before reconnect access for denied roles',async()=>{
 for(const origin of ['https://cypressriveroasis2023-sudo.github.io','https://cos-vision-integration-preview.pages.dev']){const ok=routeFixture();assert.equal((await ok.handler(request({origin}))).status,200);assert.equal(ok.count(),1);}
 for(const change of [{role:'it'},{role:'service'},{id:lease},{invalid:true},{inactive:true},{nativeInactive:true},{revoked:true}]){const f=routeFixture(change),r=await f.handler(request());assert([401,403].includes(r.status));assert.equal(f.count(),0);}
 for(const input of [{origin:''},{origin:'null'},{origin:'https://arbitrary-preview.pages.dev'},{origin:'https://evil.invalid'},{contentType:'text/plain'},{method:'GET'},{query:'?accessToken=synthetic'}]){const f=routeFixture(),r=await f.handler(request(input));assert([400,403,405,415].includes(r.status),JSON.stringify(input));assert.equal(f.count(),0);}
 const oversized=routeFixture();assert.equal((await oversized.handler(request({direct:true,value:{accessToken:'x'.repeat(36001)}}))).status,413);assert.equal(oversized.count(),0);
 const safeFailure=routeFixture({failure:true}),r=await safeFailure.handler(request());assert.equal(r.status,503);assert(!(await r.text()).includes(secret));
});


test('fresh Owner authorization is mandatory before any reconnect side effect and before commit or retry',async()=>{
 for(const deniedAt of [1,2,3,4,5]){
  const f=fixture({commitFailures:deniedAt===5?1:0});let checks=0;
  await assert.rejects(f.flow.reconnect(body,async()=>{if(++checks===deniedAt)throw new MhelpReconnectError(403);}),e=>safe(e)&&e.status===403);
  assert.equal(f.committed(),false);assert.equal(f.events.filter(v=>v.p_action==='reconnect_commit').length,deniedAt===5?1:0);
  if(deniedAt===1)assert.equal(f.events.length,0);
  if(deniedAt<=3)assert(!f.events.some(v=>v.url?.includes('login.')));
 }
});
test('the real route rechecks session, legacy role and linked native Owner role before the credential operation',async()=>{
 for(const afterAuth of [{invalid:true},{inactive:true},{role:'it'},{nativeInactive:true},{revoked:true},{id:lease}]){
  const f=routeFixture({afterAuth}),r=await f.handler(request());assert.equal(r.status,403);const result=await r.text();assert(!result.includes(secret));assert.equal(f.count(),1);
 }
});
test('omitting the trusted authorization callback fails closed without touching configuration or vendor',async()=>{
 let sideEffects=0;const flow=createMhelpReconnect({getConfig:()=>{sideEffects++;return{};},session:async()=>{sideEffects++;return{};},fetch:async()=>{sideEffects++;return reply({});}});
 await assert.rejects(flow.reconnect(body),e=>safe(e)&&e.status===403);assert.equal(sideEffects,0);
});
