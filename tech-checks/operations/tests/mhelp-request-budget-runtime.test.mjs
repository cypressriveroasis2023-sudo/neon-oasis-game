import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeMhelpTokens} from '../../supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts';
const native='https://tughscoxralhofrckvxy.supabase.co',data='https://connect.mhelpdesk.com/api/v1.0/portal/224643/equipment';
const env=n=>({SUPABASE_URL:native,SUPABASE_SERVICE_ROLE_KEY:'synthetic-only-service'})[n];
test('local quota refusal never becomes a provider cooldown and never touches vendor or token storage',async()=>{
 const calls=[];const t=nativeMhelpTokens(env,async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});assert.equal(url,native+'/rest/v1/rpc/cos_mhelp_request_budget');return Response.json({allowed:false,reason:'daily_budget',retryAt:new Date(Date.now()+60000).toISOString()});});
 assert.equal((await t.fetch(data)).status,429);assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{p_essential:false});assert.deepEqual(t.readBackoff(),{deferred:0,rateLimited:0,nextReadAt:null});
});
test('genuine provider 429 is still durably recorded after a separate budget admission',async()=>{
 const actions=[];let vendor=0;const until=new Date(Date.now()+60000).toISOString();
 const t=nativeMhelpTokens(env,async(url,init)=>{
  if(String(url).endsWith('/cos_mhelp_request_budget')){actions.push('budget');return Response.json({allowed:true,reason:null,retryAt:null});}
  if(String(url).endsWith('/cos_mhelp_token_session')){const body=JSON.parse(init.body);actions.push(body.p_action);return Response.json({allowed:body.p_action==='gate_admit',retryAt:body.p_action==='gate_admit'?null:until,leaseId:null,revision:body.p_action==='gate_admit'?0:1,consecutiveLimits:body.p_action==='gate_admit'?0:1});}
  assert.equal(url,data);vendor++;return new Response('{}',{status:429,headers:{'Retry-After':'60'}});
 });
 assert.equal((await t.fetch(data)).status,429);assert.equal(vendor,1);assert.deepEqual(actions,['budget','gate_admit','gate_limit']);assert.equal(t.readBackoff().rateLimited,1);
});
test('account and token requests share the same gate and essential reserve class',async()=>{
 const classes=[];const t=nativeMhelpTokens(env,async(url,init)=>{assert.equal(url,native+'/rest/v1/rpc/cos_mhelp_request_budget');classes.push(JSON.parse(init.body));return Response.json({allowed:false,reason:'provider_wait',retryAt:new Date(Date.now()+60000).toISOString()});});
 for(const url of ['https://login.mhelpdesk.com/connect/token','https://connect.mhelpdesk.com/api/v1.0/users/me'])assert.equal((await t.fetch(url)).status,429);
 assert.deepEqual(classes,[{p_essential:true},{p_essential:true}]);
});
test('missing, malformed and failing RPCs cannot fall back to direct fetch',async()=>{
 for(const response of [()=>new Response('{}',{status:503}),()=>Response.json({allowed:true}),()=>new Response('x'.repeat(4097)),()=>{throw Error('offline');}]){
  let vendor=0;const t=nativeMhelpTokens(env,async(url)=>{if(!String(url).startsWith(native))vendor++;return response();});await assert.rejects(t.fetch(data));assert.equal(vendor,0);
 }
});

test('an admitted ordinary data read replaces a stale caller token with the current persisted revision',async()=>{
 const actions=[];const t=nativeMhelpTokens(env,async(url,init)=>{const u=String(url);if(u.endsWith('/cos_mhelp_request_budget')){actions.push('admit');return Response.json({allowed:true,reason:null,retryAt:null});}if(u.endsWith('/cos_mhelp_token_session')){const body=JSON.parse(init.body);actions.push(body.p_action);return body.p_action==='read'?Response.json({configured:true,portal_id:'224643',revision:10,access_token:'synthetic-current'}):Response.json({allowed:true,retryAt:null,leaseId:null,revision:0,consecutiveLimits:0});}assert.equal(u,data);actions.push('vendor');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer synthetic-current');return Response.json({results:[],totalRows:0});});
 assert.equal((await t.fetch(data,{headers:{Authorization:'Bearer synthetic-old',Accept:'application/json'}})).status,200);assert.deepEqual(actions,['admit','gate_admit','read','vendor']);
});
