import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCustodySource,readOwnerCustody} from '../../custody-read.js';
test('custody projection never includes signatures, credentials or inferred Product IDs',()=>{
 const value=projectCustodySource('handoffs',{version:1,transfers:[{id:'handoff',state:'awaiting_service',service_actor:'service',manifest:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001',sims:['000123'],secret:'hidden'}],access_token:'secret',events:[{signature:'private'}]}]});
 assert.equal(value.items[0].units[0].sims[0],'000123');assert.equal(value.items[0].units[0].batteries,null);assert.equal(value.items[0].state,'awaiting_service');
 assert.doesNotMatch(JSON.stringify(value),/secret|private|signature|access_token|productId/);
 assert.equal(projectCustodySource('handoffs',{version:1,transfers:Array.from({length:100},()=>({manifest:[]}))}).limited,true);
});
test('missing sources and battery quantities never turn into zeros',()=>{
 assert.throws(()=>projectCustodySource('returns',{version:1,returns:[]}));
 assert.throws(()=>projectCustodySource('trucks',{}));
 const trucks=projectCustodySource('trucks',[{units:[],sims:[],stock:{recon_battery_qty:0}}]);
 assert.equal(trucks[0].stock.recon_battery_qty,0);assert.equal(trucks[0].stock.agm_12v_110ah_qty,null);
});
test('Owner reader uses only three fixed reads, isolates failures, and fences session changes',async()=>{
 const calls=[];const db={rpc:async name=>{calls.push(name);return name==='techcheck_ticketfree_context_v1'?{data:{version:1,returns:[],pending_count:0}}:{error:{message:'unavailable'}};}};
 const value=await readOwnerCustody(db,()=>true);
 assert.deepEqual(calls,['owner_service_truck_inventory_v1','techcheck_transfer_context_v1','techcheck_ticketfree_context_v1']);
 assert.match(value.sources.handoffs.error,/unavailable/);assert.equal(value.sources.returns.value.pending,0);
 await assert.rejects(readOwnerCustody(db,()=>false),/Session changed/);assert.equal(calls.length,3);
 let current=true;await assert.rejects(readOwnerCustody({rpc:async()=>{current=false;return {error:{}};}},()=>current),/Session changed/);
});
