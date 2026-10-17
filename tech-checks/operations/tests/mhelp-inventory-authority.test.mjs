import test from 'node:test';
import assert from 'node:assert/strict';
import {readMhelpInventoryAuthority,showMhelpProductHeadline} from '../src/mhelpInventoryAuthority.ts';

const at=Date.parse('2026-10-16T23:00:00Z');
const row=(id,placement,life='UNFLAGGED')=>({
 recordId:'mhelp_product:'+id,productId:id,placement,uploadLifecycle:life
});
const saved=(records,receivedAt='2026-10-13T18:22:00Z')=>({
 contract:'COS_MHELP_UPLOAD_INVENTORY_V1',
 countBasis:'mhelp_product_records_not_unique_physical_units',
 sourceSha256:'a'.repeat(64),receivedAt,records,
 summary:{totalRecords:records.length,
  fieldRecords:records.filter(x=>x.placement==='FIELD').length,
  shopRecords:records.filter(x=>x.placement==='SHOP').length,
  unflaggedFieldRecords:records.filter(x=>x.placement==='FIELD'&&x.uploadLifecycle==='UNFLAGGED').length,
  doNotUseRecords:records.filter(x=>x.uploadLifecycle==='DO_NOT_USE').length,
  missingRecords:records.filter(x=>x.uploadLifecycle==='MISSING').length}
});
test('physical counts come from exact Product IDs, never combined roster representation counts',()=>{
 const value=saved([row('100','FIELD'),row('101','SHOP'),row('102','FIELD','DO_NOT_USE')]);
 const a=readMhelpInventoryAuthority({...value,fleetRoster:{summary:{field:318}}},at);
 assert.deepEqual({...a,sourceSha256:undefined,receivedAt:undefined},{
  total:3,field:2,shop:1,fieldActive:1,inactive:1,stale:true,
  sourceSha256:undefined,receivedAt:undefined});
});
test('receipt source timestamp is explicit and never claimed live',()=>{
 const v=saved([row('100','FIELD')],'2026-10-16T22:30:00Z');
 assert.equal(readMhelpInventoryAuthority(v,at)?.stale,false);
 assert.equal(readMhelpInventoryAuthority({...v,receivedAt:'2099-01-01T00:00:00Z'},at),null);
});
test('rejects a missing Product ID, duplicate Product ID, and mismatched summary',()=>{
 const v=saved([row('100','FIELD'),row('101','SHOP')]);
 assert.equal(readMhelpInventoryAuthority({...v,records:[v.records[0],v.records[0]]},at),null);
 assert.equal(readMhelpInventoryAuthority({...v,summary:{...v.summary,fieldRecords:1,shopRecords:0}},at),null);
 assert.equal(readMhelpInventoryAuthority({...v,records:[{...v.records[0],productId:''},v.records[1]]},at),null);
});
test('rejects spoofed contract and inactive lifecycle mismatch',()=>{
 const v=saved([row('100','FIELD'),row('101','SHOP','MISSING')]);
 assert.equal(readMhelpInventoryAuthority({...v,contract:'COS_COMBINED_FLEET_ROSTER_V1'},at),null);
 assert.equal(readMhelpInventoryAuthority({...v,records:[row('100','FIELD'),row('101','SHOP','UNFLAGGED')]},at),null);
});
test('Shop and unverified map health never reclassify physical equipment',()=>{
 const v=saved([row('100','SHOP'),row('101','FIELD')]);
 assert.deepEqual([readMhelpInventoryAuthority(v,at)?.field,readMhelpInventoryAuthority(v,at)?.shop],[1,1]);
});

test('1001 distinct mHelp Product IDs render 287 Field and 714 Shop independently of COS combined 318',()=>{
 const rows=Array.from({length:1001},(_,i)=>row(String(i+1),i<287?'FIELD':'SHOP'));
 const receipt=saved(rows);
 const actual=readMhelpInventoryAuthority({...receipt,fleetRoster:{summary:{field:318}}},at);
 assert.equal(actual?.total,1001);
 assert.equal(actual?.field,287);
 assert.equal(actual?.shop,714);
 assert.equal(actual?.stale,true);
});
test('whole-inventory headline only appears in default unfiltered Field view',()=>{
 const defaults={placement:'field',query:'',family:'all',provider:'all',nearbyId:'',installationStatus:'all',retired:false};
 assert.equal(showMhelpProductHeadline(defaults,true,true),true);
 assert.equal(showMhelpProductHeadline({...defaults,query:'Ranger'},true,true),false);
 assert.equal(showMhelpProductHeadline({...defaults,placement:'shop'},true,true),false);
 assert.equal(showMhelpProductHeadline({...defaults,family:'Solar Spotter'},true,true),false);
 assert.equal(showMhelpProductHeadline({...defaults,provider:'Avigilon'},true,true),false);
 assert.equal(showMhelpProductHeadline({...defaults,nearbyId:'native-unit'},true,true),false);
 assert.equal(showMhelpProductHeadline({...defaults,retired:true},true,true),false);
 assert.equal(showMhelpProductHeadline(defaults,false,true),false);
 assert.equal(showMhelpProductHeadline(defaults,true,false),false);
});
