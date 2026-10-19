import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkedMoveCommand,createOperationalMoves} from '../../supabase/functions/cos-operations-pages/operationalMoves.ts';
const actorPayload={p_actor_user_id:'11111111-1111-4111-8111-111111111111',p_organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'};
const sha='a'.repeat(64),requestId=randomUUID();
const command={productId:'123',expectedSourceSha256:sha,expectedRevision:0,requestId,placement:'SHOP',customer:'',site:'',address:''};
const snapshot={contract:'COS_OPERATIONAL_TRANSFER_V1',sourceSha256:sha,items:[{productId:'123',unitNumber:'Ranger 028',placement:'FIELD',sourcePlacement:'FIELD',customer:'Builder',site:'Site',address:'100 Main St',sourceAddress:{street:'100 Main St'},lifecycle:'UNFLAGGED',revision:0,operationalOverride:false,syncState:'source_recorded',changedAt:null}]};
test('Owner move endpoint uses exactly one RPC and never reads Fleet, health, mHelpDesk or Sheets',async()=>{
 const calls=[];const handler=createOperationalMoves({actorPayload,rpc:async(name,body)=>{
  calls.push({name,body});
  return name==='cos_operational_transfer_snapshot'?snapshot:{committed:true,replayed:false,productId:'123',revision:1,placement:'SHOP',syncState:'pending'};
 }});
 const units=await handler('/api/operational-units','GET',null);
 assert.equal(units.items.length,1);assert.equal(calls[0].name,'cos_operational_transfer_snapshot');
 const receipt=await handler('/api/operational-units/move','POST',command);
 assert.equal(receipt.placement,'SHOP');assert.equal(receipt.syncState,'pending');
 assert.equal(calls.length,2);
 assert.equal(calls[1].name,'cos_operational_transfer_apply');
 assert.deepEqual(calls[1].body,{
  ...actorPayload,p_product_id:command.productId,p_expected_source_sha256:sha,
  p_expected_revision:0,p_request_id:requestId,p_placement:'SHOP',p_customer:'',p_site:'',p_address:''
 });
});
test('bad Product IDs, unrecognized fields and unsupported commands fail before reaching the database',async()=>{
 let writes=0;const handler=createOperationalMoves({actorPayload,rpc:async()=>{writes++;return {}; }});
 for(const input of [
  {...command,productId:'Ranger 028'},
  {...command,source:'mhelp'},
  {...command,placement:'ONLINE'},
  {...command,expectedSourceSha256:'0'},
  {...command,requestId:'reuse'},
  {...command,expectedRevision:-1},
  {...command,placement:'FIELD',customer:'',site:'',address:''}
 ]) await assert.rejects(handler('/api/operational-units/move','POST',input));
 assert.equal(writes,0);
 await assert.rejects(handler('/api/operational-units','POST',command));
});
test('camera status changes never change the operational placement',()=>{
 const parsed=checkedMoveCommand({...command,placement:'FIELD',customer:'Builder',site:'New Site',address:'12 North Main, Houston, TX'});
 assert.equal(parsed.placement,'FIELD');
 assert.equal(Object.hasOwn(parsed,'online'),false);
 assert.equal(Object.hasOwn(parsed,'cameraHealth'),false);
});
