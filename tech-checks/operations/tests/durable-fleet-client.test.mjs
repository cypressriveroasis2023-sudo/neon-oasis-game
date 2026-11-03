import test from 'node:test';import assert from 'node:assert/strict';
import {durableFleetRead,restoredFleet} from '../src/durableFleetClient.ts';
import {completedBoard} from '../durable-board/project.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const fixture=()=>{const f=fieldProductFixture();return {contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:'old',payload:completedBoard(f.health,f.field,f.connections,null,f.now)},refresh:{state:'completed'},history:[]};};
test('a fresh app instance restores the exact original dated board without reading each vendor',async()=>{
 const record=fixture();let reads=0;
 for(let n=0;n<2;n++){
  const pair=await durableFleetRead({read:async()=>{reads++;return structuredClone(record);},current:()=>true,status:()=>{},publish:()=>assert.fail('no new batch'),failed:()=>assert.fail('no failure')});
  assert.equal(pair.readAt,record.latest.payload.fleet.readAt);assert.equal(pair.fieldMap.savedBoardReadAt,pair.readAt);
 }
 assert.equal(reads,2);
});
test('pending reads preserve old counts and publish only a finished new batch; sign-out fences late data',async()=>{
 const old=fixture();old.refresh.state='running';const next=structuredClone(old);next.latest.id='new';next.refresh.state='completed';
 let release;const gate=new Promise(r=>release=r);let valid=true,published=0;
 const pair=await durableFleetRead({read:async()=>published?next:old,current:()=>valid,status:()=>{},publish:()=>published++,failed:()=>{},delay:()=>gate});
 assert.equal(pair.readAt,old.latest.payload.fleet.readAt);valid=false;release();await new Promise(r=>setImmediate(r));assert.equal(published,0);
 let n=0;const events=[];
 await durableFleetRead({read:async()=>++n===1?old:next,current:()=>true,status:()=>{},publish:p=>events.push(p),failed:()=>assert.fail('completed'),delay:async()=>{}});
 await new Promise(r=>setImmediate(r));assert.equal(events.length,1);
});
test('failed update reports failure while returning the saved dated result',async()=>{
 const old=fixture();old.refresh.state='failed';let failed=0;
 const pair=await durableFleetRead({read:async()=>old,current:()=>true,status:()=>{},publish:()=>assert.fail('no partial publication'),failed:()=>failed++});
 assert.equal(failed,1);assert.equal(pair.readAt,old.latest.payload.fleet.readAt);
 assert.throws(()=>restoredFleet({...old,latest:{payload:{contract:'tampered'}}}),/invalid/);
});
