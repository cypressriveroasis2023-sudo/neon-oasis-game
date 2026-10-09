import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTokenManager} from '../../supabase/functions/cos-operations-pages/mhelpTokenSession.ts';
import {createMhelpPartnerHandler} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
import {nativeMhelpTokens} from '../../supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts';
const portal='224643',lease='00000000-0000-4000-8000-000000000001';
const config={accessToken:'synthetic-old-access',refreshToken:'synthetic-old-refresh',clientId:'synthetic-client-id',clientSecret:'synthetic-client-secret'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function fixture({response={},fetchFailure=false,commitFailures=0,newPortal=portal}={}){
 const calls=[];let state={configured:false},committed=null;
 const manager=createMhelpTokenManager({getConfig:()=>config,session:async body=>{
  calls.push({kind:'session',...body});
  if(body.p_action==='read')return state;
  if(body.p_action==='bootstrap'){state={configured:true,portal_id:body.p_portal_id,access_token:body.p_access_token};return state;}
  if(body.p_action==='claim')return {...state,lease_id:lease,refresh_token:'synthetic-stored-refresh'};
  if(body.p_action==='commit'){committed=body;state={...state,access_token:body.p_access_token};if(commitFailures-->0)throw Error('synthetic-private-error');return {committed:true};}
  if(body.p_action==='release')return {released:true};
  throw Error('unexpected operation');
 },fetch:async(url,init)=>{
  calls.push({kind:'fetch',url,init});
  if(url.includes('login.mhelpdesk.com')){if(fetchFailure)throw Error('synthetic-private-token');return json({access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',token_type:'Bearer',expires_in:3600,...response});}
  assert.equal(url,'https://connect.mhelpdesk.com/api/v1.0/users/me');
  return json({portalId:Number(init.headers.Authorization.endsWith('synthetic-new-access')?newPortal:portal),email:'synthetic-private-email'});
 }});
 return {manager,calls,committed:()=>committed};
}
test('renewal uses the fixed production OAuth endpoint and atomically persists rotation before verifying new access',async()=>{
 const f=fixture(),result=await f.manager.renewAccess();assert.deepEqual(result,{accessToken:'synthetic-new-access',portalId:portal});
 const issued=f.calls.find(v=>v.kind==='fetch'&&v.url.includes('login.mhelpdesk.com'));
 assert.equal(issued.url,'https://login.mhelpdesk.com/connect/token');assert.equal(issued.init.method,'POST');assert.equal(issued.init.redirect,'error');
 const form=new URLSearchParams(issued.init.body);assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'synthetic-stored-refresh');assert.equal(form.get('client_id'),config.clientId);assert.equal(form.get('client_secret'),config.clientSecret);
 const saved=f.committed();assert.equal(saved.p_access_token,'synthetic-new-access');assert.equal(saved.p_refresh_token,'synthetic-new-refresh');assert.equal(saved.p_session,lease);
 const index=f.calls.findIndex(v=>v.p_action==='commit');assert(index<f.calls.findIndex(v=>v.kind==='fetch'&&v.init.headers.Authorization==='Bearer synthetic-new-access'));
 assert.deepEqual(await f.manager.getPartnerConfig(),result);
});
test('a lost commit acknowledgement is retried with the exact pair and lease',async()=>{
 const f=fixture({commitFailures:1});await f.manager.renewAccess();const commits=f.calls.filter(v=>v.p_action==='commit');assert.equal(commits.length,2);assert.deepEqual(commits[0],commits[1]);
});
test('simultaneous renewals share one request and use a stored rotated refresh token',async()=>{
 const f=fixture();const [a,b]=await Promise.all([f.manager.renewAccess(),f.manager.renewAccess()]);assert.deepEqual(a,b);assert.equal(f.calls.filter(v=>v.kind==='fetch'&&v.url.includes('login.mhelpdesk.com')).length,1);
});
test('failed issuance is sanitized and releases the existing lease; failed persistence retains it',async()=>{
 const f=fixture({fetchFailure:true});await assert.rejects(f.manager.renewAccess(),e=>e.message==='mHelpDesk secure token renewal is unavailable');assert(f.calls.some(v=>v.p_action==='release'));assert.equal(f.committed(),null);
 const g=fixture({commitFailures:2});await assert.rejects(g.manager.renewAccess());assert(!g.calls.some(v=>v.p_action==='release'));
});
test('rotation rejects malformed responses and different portals; an omitted refresh token preserves the stored token',async()=>{
 for(const response of [{access_token:'bad token'},{token_type:'Basic'},{expires_in:1},{expires_in:3600.5},{refresh_token:'bad token'}]){const f=fixture({response});await assert.rejects(f.manager.renewAccess());assert.equal(f.committed(),null);}
 const different=fixture({newPortal:'999'});await assert.rejects(different.manager.renewAccess());assert.equal(different.committed().p_refresh_token,'synthetic-new-refresh');
 const unrotated=fixture({response:{refresh_token:null}});await unrotated.manager.renewAccess();assert.equal(unrotated.committed().p_refresh_token,'synthetic-stored-refresh');
});
test('status never refreshes and an expired account read renews once before equipment access',async()=>{
 let renewals=0,reads=0;const h=createMhelpPartnerHandler({getConfig:async()=>({accessToken:'synthetic-expired'}),renewAccess:async()=>{renewals++;return {accessToken:'synthetic-current',portalId:portal};},readNativeUnits:async()=>[],fetch:async(url,init)=>{
  reads++;if(url.endsWith('/me'))return init.headers.Authorization==='Bearer synthetic-expired'?json({private:'synthetic-token'},401):json({portalId:Number(portal)});
  return json({totalRows:0,results:[]});
 }});
 await h('/api/mhelpdesk/partner/status','GET',{});assert.equal(reads,0);assert.equal(renewals,0);
 const preview=await h('/api/mhelpdesk/partner/preview','POST',{});assert.equal(preview.liveAccessVerified,true);assert.equal(renewals,1);assert.equal(reads,3);
 let attempts=0;const denied=createMhelpPartnerHandler({getConfig:()=>({accessToken:'synthetic'}),renewAccess:async()=>{attempts++;return {accessToken:'synthetic-current'};},readNativeUnits:async()=>[],fetch:async()=>json({},401)});
 await assert.rejects(denied('/api/mhelpdesk/partner/preview','POST',{}));assert.equal(attempts,1);
});
test('token RPC is fixed to the native backend and refuses other project configuration',async()=>{
 let calls=0;const m=nativeMhelpTokens(name=>name==='SUPABASE_URL'?'https://other.invalid':'synthetic',async()=>{calls++;throw Error('unexpected')});
 await assert.rejects(m.getPartnerConfig());assert.equal(calls,0);
});
