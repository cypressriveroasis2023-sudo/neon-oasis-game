import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpTokenManager,MhelpReconnectRequiredError} from '../../supabase/functions/cos-operations-pages/mhelpTokenSession.ts';
import {createMhelpReadinessHandler} from '../../supabase/functions/cos-mhelp-readiness/index.ts';
const now=Date.parse('2026-10-20T12:00:00Z'),portal='224643',lease='00000000-0000-4000-8000-000000000001';
function fixture({expires=now+86400000,invalid=false,accountFails=false,lostAck=false}={}){
 const events=[],rejected=new Set();let held=false,rotations=0,commitCalls=0;
 const state={configured:true,portal_id:portal,access_token:'synthetic-old',refresh_token:'synthetic-refresh',revision:9,expires_at:new Date(expires).toISOString()};
 const options={now:()=>now,getConfig:()=>({clientId:'synthetic-client',clientSecret:'synthetic-secret'}),session:async body=>{
  events.push(body.p_action);if(body.p_action==='read')return{...state};
  if(body.p_action==='claim'){if(held)throw Error('lease busy');held=true;return{...state,lease_id:lease};}
  if(body.p_action==='release'){held=false;return{released:true};}
  if(body.p_action==='commit'){commitCalls++;if(state.access_token!==body.p_access_token){state.access_token=body.p_access_token;state.refresh_token=body.p_refresh_token;state.expires_at=body.p_expires_at;state.revision++;held=false;}if(lostAck&&commitCalls===1)throw Error('lost acknowledgment');return{committed:true};}
  throw Error('unexpected operation');
 },renewalGuard:async(action)=>{if(action==='reject')rejected.add(state.revision);return{allowed:!rejected.has(state.revision),revision:state.revision};},fetch:async url=>{
  if(String(url).includes('/connect/token')){rotations++;return invalid?Response.json({error:'invalid_grant',error_description:'synthetic-private'},{status:400}):Response.json({access_token:'synthetic-new',refresh_token:'synthetic-new-refresh',expires_in:86400,token_type:'Bearer'});}
  if(accountFails)throw Error('inventory-independent account failure');return Response.json({portalId:Number(portal)});
 }};
 return{manager:createMhelpTokenManager(options),other:()=>createMhelpTokenManager(options),state,events,rotations:()=>rotations,commitCalls:()=>commitCalls};
}
test('healthy expiry check is metadata-only and cannot claim that it renewed',async()=>{
 const f=fixture();const r=await f.manager.ensureAccess();assert.equal(r.renewed,false);assert.equal(r.expiresAt,f.state.expires_at);assert.equal(f.rotations(),0);assert.deepEqual(f.events,['read']);
});
test('six-hour margin renews once, persists both tokens, and a later check is cheap',async()=>{
 const f=fixture({expires:now+6*3600000});const r=await f.manager.ensureAccess();assert.equal(r.renewed,true);assert.equal(f.rotations(),1);assert.equal(f.state.revision,10);assert.equal(f.state.refresh_token,'synthetic-new-refresh');assert.equal((await f.manager.ensureAccess()).renewed,false);assert.equal(f.rotations(),1);
});
test('concurrent in-process checks share issuance and lost commit acknowledgment reuses the exact lease',async()=>{
 const f=fixture({expires:now+3600000,lostAck:true});const r=await Promise.all([f.manager.ensureAccess(),f.manager.ensureAccess()]);assert(r.every(v=>v.accessToken==='synthetic-new'));assert.equal(f.rotations(),1);assert.equal(f.commitCalls(),2);assert.equal(f.state.revision,10);
});
test('another worker with the old due observation uses the pair returned by the atomic claim',async()=>{
 const f=fixture({expires:now+3600000});await f.manager.ensureAccess();const result=await f.other().ensureAccess();assert.equal(result.renewed,false);assert.equal(result.accessToken,'synthetic-new');assert.equal(f.rotations(),1);
});
test('confirmed invalid_grant is revision-bound and suppresses later worker attempts',async()=>{
 const f=fixture({expires:now+3600000,invalid:true});await assert.rejects(f.manager.ensureAccess(),MhelpReconnectRequiredError);await assert.rejects(f.other().ensureAccess(),MhelpReconnectRequiredError);await assert.rejects(f.other().renewAccess(),MhelpReconnectRequiredError);assert.equal(f.rotations(),1);
 // Only a genuine later stored revision (e.g. secure reconnect) clears this hold.
 f.state.revision++;f.state.expires_at=new Date(now+86400000).toISOString();assert.equal((await f.other().ensureAccess()).renewed,false);
});
test('post-commit account failure cannot roll back a successful pair or trigger another scheduled rotation',async()=>{
 const f=fixture({expires:now+3600000,accountFails:true});await assert.rejects(f.manager.ensureAccess());assert.equal(f.state.revision,10);assert.equal(f.state.access_token,'synthetic-new');assert.equal(f.state.refresh_token,'synthetic-new-refresh');assert.equal((await f.other().ensureAccess()).renewed,false);assert.equal(f.rotations(),1);
});
test('scheduled handler returns safe expiry evidence without launching any inventory preview',async()=>{
 let previews=0;const handler=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{previews++;throw Error('must not scan');},ensureAccess:async()=>({portalId:portal,renewed:false,expiresAt:new Date(Date.now()+86400000).toISOString(),accessToken:'synthetic-never-return'})});
 const response=await handler(new Request('https://native.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"renew_access"}'}));const value=await response.json();assert.equal(value.state,'not_due');assert.equal(value.tokenRenewalVerified,false);assert.equal(value.sourceRefreshed,false);assert(!JSON.stringify(value).includes('synthetic'));assert.equal(previews,0);
});
test('only confirmed grant rejection requests reconnect; generic temporary failures remain generic',async()=>{
 for(const error of [new MhelpReconnectRequiredError(),Error('temporary')]){
  const handler=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error();},ensureAccess:async()=>{throw error;}});
  const r=await handler(new Request('https://native.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"renew_access"}'}));const v=await r.json();assert.equal(v.state==='reconnect_required',error instanceof MhelpReconnectRequiredError);assert.equal(r.status,error instanceof MhelpReconnectRequiredError?409:503);
 }
});
