import test from 'node:test';
import assert from 'node:assert/strict';
import {readSavedFleetRecovery} from '../src/SavedFleetEmergencyRoster.tsx';
import {guardFleetCommandRead} from '../src/fleetCommandCenterModel.ts';

const readAt='2026-11-07T07:53:57.000Z';
const now=Date.parse('2026-11-07T15:00:00Z');
function fixture(){
 const product=(id,placement)=>({productId:String(id),recordId:'mhelp_product:'+id,unitNumber:'Spotter '+id,category:'Spotter',
  placement,uploadLifecycle:'UNFLAGGED',customer:'Customer '+id,sourceAddress:{street:id+' Safe Street',city:'Houston',state:'TX',zip:'77001'}});
 const records=[product(101,'FIELD'),product(102,'FIELD'),product(103,'SHOP')];
 const upload={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',countBasis:'mhelp_product_records_not_unique_physical_units',
  source:'owner_supplied_mhelp_export',sourceSha256:'a'.repeat(64),receivedAt:'2026-11-07T07:00:00Z',
  summary:{totalRecords:3,fieldRecords:2,shopRecords:1,unflaggedFieldRecords:2,doNotUseRecords:0,missingRecords:0},records};
 return {contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{payload:{contract:'COS_SAVED_FLEET_BOARD_V1',fleet:{readAt,fieldMap:{uploadInventory:upload}},counts:{online:1,offline:1,unverified:0}}}};
}
test('read-only fallback retains each Product ID and original reading time without camera inference',()=>{
 const value=readSavedFleetRecovery(fixture(),now);
 assert.ok(value);assert.equal(value.readAt,readAt);assert.equal(value.field,2);assert.equal(value.shop,1);
 assert.equal(value.records.length,3);
 assert.deepEqual(value.records.map(r=>r.productId),['101','102','103']);
 assert.equal(value.records[0].address,'101 Safe Street, Houston, TX 77001');
 assert.ok(value.records.every(r=>!Object.hasOwn(r,'online')&&!Object.hasOwn(r,'status')&&!Object.hasOwn(r,'ip')));
});
test('fallback rejects invalid or ambiguous mHelp receipts instead of inventing a roster',()=>{
 const dup=fixture();dup.latest.payload.fleet.fieldMap.uploadInventory.records[1].productId='101';
 assert.equal(readSavedFleetRecovery(dup,now),null);
 const missing=fixture();missing.latest.payload.fleet.fieldMap.uploadInventory.summary.totalRecords=925;
 assert.equal(readSavedFleetRecovery(missing,now),null);
 const future=fixture();future.latest.payload.fleet.readAt='2099-01-01T00:00:00Z';
 assert.equal(readSavedFleetRecovery(future,now),null);
 assert.equal(readSavedFleetRecovery({contract:'bad'},now),null);
});
test('known source accounting conflicts fail closed without crashing the rest of Fleet',()=>{
 for(const message of ['The Field source and provider Product IDs differ.','Field inventory violates unique Product-ID accounting.','Fleet accounting does not reconcile.','Field provider totals do not reconcile to mHelp Product IDs.']){
  assert.deepEqual(guardFleetCommandRead(()=>{throw Error(message);}),{data:null,sourceMismatch:true});
 }
 assert.deepEqual(guardFleetCommandRead(()=>({online:4})),{data:{online:4},sourceMismatch:false});
 assert.throws(()=>guardFleetCommandRead(()=>{throw Error('Unexpected bug.');}),/Unexpected bug/);
});
