import test from 'node:test';import assert from 'node:assert/strict';
import {createTransferPlacementPublisher} from './publisherAdapter.mjs';
import {afterCompletedCycle} from './afterCompletedCycle.mjs';
const base={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',complete:true,reviewed:true,sourceSha256:'a'.repeat(64),apiSync:{enabled:true,lastSuccessAt:new Date().toISOString()},records:[{productId:'9001',placement:'SHOP',lifecycle:'UNFLAGGED',binding:{productId:'9001',nativeUnitId:'native-1',guardCurrent:true,expectedGuard:'b'.repeat(64)}}]};
const crosswalk={reviewed:true,revision:'c'.repeat(64),records:[{productId:'9001',nativeUnitId:'native-1',equipmentKey:'solar_spotter:53',family:'Solar Spotter',unitTag:'53'}]};
function fixture({changeRegister=false,changeSource=false,rejectWrite=false,reviewed=true}={}){
 let registerReads=0,nativeReads=0,writes=0;
 const db={rpc:async(name,args)=>{assert.equal(name,'cos_admit_transfer_placement_v1');if(args.p_packet===null)return {data:2};writes++;return rejectWrite?{error:{message:'synthetic timeout'}}:{data:3};},from:table=>{assert.equal(table,'equipment_master');const q={select:()=>q,order:()=>q,range:async()=>({data:[{equipment_key:'solar_spotter:53',canonical_family:'Solar Spotter',source_family:'Solar Spotter',workflow_type:'Solar Spotter',unit_tag:changeRegister&&registerReads++?'54':'53',updated_at:'2026-01-01T00:00:00Z'}]})};return q;}};
 const publisher=createTransferPlacementPublisher({db,readNative:async()=>({contract:'COS_CAMERA_SNAPSHOT_SOURCE_V1',complete:true,baseline:{...base,sourceSha256:changeSource&&nativeReads++?'d'.repeat(64):base.sourceSha256}}),readReviewedCrosswalk:async()=>({...crosswalk,reviewed})});
 return {publisher,writes:()=>writes};
}
test('legacy identity, native revision and unreviewed bridges fail before mutation',async()=>{
 for(const options of [{changeRegister:true},{changeSource:true},{reviewed:false}]){const f=fixture(options);await assert.rejects(f.publisher.run());assert.equal(f.writes(),0);}
});
test('uncertain admission is surfaced once, never automatically retried',async()=>{
 const f=fixture({rejectWrite:true});await assert.rejects(f.publisher.run(),/reconcile head before retry/);assert.equal(f.writes(),1);
});
test('cancellation does not read or admit a source',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.publisher.run({signal:controller.signal}),/Cancelled/);assert.equal(f.writes(),0);
});
test('optional post-cycle binding preserves completed result and never starts another scan',async()=>{
 let calls=0;const publisher={run:async()=>{calls++;return {generation:3};}},result={state:'completed',runId:'synthetic-cycle'};
 assert.deepEqual(await afterCompletedCycle(result,{publisher:null,deadline:10000,now:()=>0}),result);
 for(const state of ['already_running','not_published','commit_uncertain'])assert.deepEqual(await afterCompletedCycle({state},{publisher,deadline:10000,now:()=>0}),{state});
 assert.equal(calls,0);
 const saved=await afterCompletedCycle(result,{publisher,deadline:10000,now:()=>0});assert.equal(saved.runId,result.runId);assert.equal(saved.state,'completed');assert.equal(saved.transferPlacement.generation,3);assert.equal(calls,1);
 const deferred=await afterCompletedCycle(result,{publisher,deadline:500,now:()=>0});assert.equal(deferred.transferPlacement.state,'deferred');assert.equal(calls,1);
 const failed=await afterCompletedCycle(result,{publisher:{run:async()=>{throw Error('synthetic failure');}},deadline:10000,now:()=>0});assert.equal(failed.state,'completed');assert.equal(failed.transferPlacement.state,'unavailable');
});
