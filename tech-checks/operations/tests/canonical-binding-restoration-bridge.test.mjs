import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalBindingRestorationBridge} from '../../supabase/functions/cos-operations-pages/canonicalBindingRestoration.mjs';
const actor='22222222-2222-4222-8222-222222222222',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',id='33333333-3333-4333-8333-333333333333';
const expected={sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),scopedSha256:'c'.repeat(64),scopedRevision:0};
const body={action:'stage',requestId:id,expected};
const items=['1910800','2221820','2232675','2232677','2274337','2275201','2336149'].map(productId=>({productId}));
const request=b=>new Request('https://synthetic.invalid/restoration',{method:'POST',body:JSON.stringify(b)});
test('fresh Owner verification happens on stage and commit; actor is exclusively server-derived',async()=>{
 let calls=0;const seen=[];
 const bridge=createCanonicalBindingRestorationBridge({authenticateOwner:async()=>{calls++;return {actorId:actor,organizationId:org,active:true,department:'owner',roleCode:'owner'};},rpc:async(name,args)=>{seen.push({name,args});return {contract:args.p_action==='stage'?'COS_SEVEN_BINDING_STAGE_V1':'COS_SEVEN_BINDING_COMMIT_V1',requestId:id,applied:args.p_action==='commit',items,
  expected,digest:'d'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),reviewDigest:args.p_digest,sourceSha256:expected.sourceSha256,
  actorId:actor,organizationId:org,revision:1,authorizationSha256:'e'.repeat(64),afterScopedSha256:'f'.repeat(64),beforeScopedSha256:expected.scopedSha256};}});
 await bridge(request(body));await bridge(request({...body,action:'commit',digest:'d'.repeat(64),confirmation:'I approve these exact seven historical bindings.'}));
 assert.equal(calls,2);assert.ok(seen.every(x=>x.args.p_actor===actor&&x.args.p_org===org));
 await assert.rejects(bridge(request({...body,actorId:actor})),/Exact/);assert.equal(seen.length,2);
});
test('unverified/revoked/IT sessions and invalid bodies never reach RPC',async()=>{
 let writes=0;
 for(const owner of [null,{actorId:actor,organizationId:org,active:false,department:'owner',roleCode:'owner'},{actorId:actor,organizationId:org,active:true,department:'it',roleCode:'it_technician'}]){
  const bridge=createCanonicalBindingRestorationBridge({authenticateOwner:async()=>owner,rpc:async()=>{writes++;}});await assert.rejects(bridge(request(body)),/Owner/);
 }
 const bridge=createCanonicalBindingRestorationBridge({authenticateOwner:async()=>({actorId:actor,organizationId:org,active:true,department:'owner',roleCode:'owner'}),rpc:async()=>{writes++;}});
 for(const b of [{...body,records:[]},{...body,expected:{...expected,scopedRevision:-1}},{...body,action:'commit',digest:'d'.repeat(64),confirmation:'yes'}])await assert.rejects(bridge(request(b)),/Exact/);
 assert.equal(writes,0);
});
test('uncertain RPC outcomes and mismatched receipts cannot be reported as successful',async()=>{
 const owner={actorId:actor,organizationId:org,active:true,department:'owner',roleCode:'owner'};
 const bridge=createCanonicalBindingRestorationBridge({authenticateOwner:async()=>owner,rpc:async()=>({contract:'COS_SEVEN_BINDING_STAGE_V1',requestId:id,applied:true,items:[]})});
 await assert.rejects(bridge(request(body)),/inspect request status/);
});
test('seven duplicate items, wrong source and wrong Owner commit receipts are rejected',async()=>{
 const owner={actorId:actor,organizationId:org,active:true,department:'owner',roleCode:'owner'};
 const good={contract:'COS_SEVEN_BINDING_COMMIT_V1',requestId:id,applied:true,items,reviewDigest:'d'.repeat(64),sourceSha256:expected.sourceSha256,
  actorId:actor,organizationId:org,revision:1,authorizationSha256:'e'.repeat(64),afterScopedSha256:'f'.repeat(64),beforeScopedSha256:expected.scopedSha256};
 for(const bad of [{...good,items:Array(7).fill(items[0])},{...good,sourceSha256:'0'.repeat(64)},{...good,actorId:id},{...good,revision:0}]){
  const bridge=createCanonicalBindingRestorationBridge({authenticateOwner:async()=>owner,rpc:async()=>bad});
  await assert.rejects(bridge(request({...body,action:'commit',digest:good.reviewDigest,confirmation:'I approve these seven exact historical bindings.'})),/inspect request status/);
 }
});
