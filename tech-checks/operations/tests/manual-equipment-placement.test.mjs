// A person's Field / Shop entry wins over the accepted mHelp placement in
// every place counts are calculated: the shared inventory projection, the
// Fleet/TV census and the server-side saved board.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection.ts';
import {attachManualEquipment,checkedManualEquipmentSet} from '../../supabase/functions/cos-operations-pages/manualEquipment.ts';
import {completedBoard} from '../durable-board/project.ts';
import {cameraFieldProducts} from '../src/cameraFieldProducts.ts';
import {tvFieldCensus} from '../src/tvFieldCensus.ts';

const blank={displayName:null,placement:null,customer:null,siteName:null,address:null,deviceLink:null,note:null};
let n=0;const item=(productId,record)=>({productId,auditId:'10000000-0000-4000-8000-'+String(++n).padStart(12,'0'),revision:1,recordedAt:'2026-11-11T17:00:00Z',recordedByName:'Teddy Hopper',record:{...blank,...record}});
const receipt=(...records)=>({contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[],records});
const f=fieldProductFixture(),upload=f.field.uploadInventory;
const field=upload.records.filter(r=>r.placement==='FIELD'),shop=upload.records.filter(r=>r.placement==='SHOP');
const board=(records)=>completedBoard(f.health,{...f.field,manualPlacementOverrides:receipt(...records)},f.connections,null,f.now);
const base=completedBoard(f.health,f.field,f.connections,null,f.now);

test('the fixture has both Field and Shop equipment to move',()=>{assert.ok(field.length>=2);assert.ok(shop.length>=1);});
test('with no manual records nothing changes, and the accepted inventory object is returned untouched',()=>{
 assert.equal(manualShopInventory(upload,receipt()),upload);assert.equal(manualShopInventory(upload,{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[]}),upload);
 assert.equal(manualShopInventory(upload,receipt(item(field[0].productId,{note:'checked'}))).records.filter(r=>r.placement==='FIELD').length,field.length);
 assert.deepEqual(board([]).counts,base.counts);assert.deepEqual(board([]).inventory,base.inventory);
});
test('a manual Shop entry removes the unit from Field everywhere',()=>{
 const target=field[0],r=receipt(item(target.productId,{placement:'SHOP'})),next=manualShopInventory(upload,r);
 assert.equal(next.records.find(x=>x.productId===target.productId).placement,'SHOP');assert.equal(next.records.find(x=>x.productId===target.productId).cosManualPlacementFrom,'FIELD');
 assert.equal(next.summary.fieldRecords,upload.summary.fieldRecords-1);assert.equal(next.summary.shopRecords,upload.summary.shopRecords+1);assert.equal(next.cosManualRecordCount,1);
 assert.equal(upload.records.find(x=>x.productId===target.productId).placement,'FIELD','the accepted mHelp inventory itself is not modified');
 const saved=board([item(target.productId,{placement:'SHOP'})]);
 assert.equal(saved.inventory.field,base.inventory.field-1);assert.equal(saved.inventory.shop,base.inventory.shop+1);assert.equal(saved.inventory.total,base.inventory.total);
 assert.ok(!saved.units.some(u=>u.productId===target.productId),'it is no longer a Field unit on the saved board');
 const map={...f.field,productConnections:f.connections,manualPlacementOverrides:r};
 assert.equal(cameraFieldProducts(map,f.health,f.now,true).field,base.inventory.field-1);
 assert.equal(tvFieldCensus(map,map.inventoryItems||map.items||[],f.health,null,null,f.now).board.field,base.inventory.field-1);
});
test('a manual Field entry adds the unit to Field as unverified; it never invents an online or offline reading',()=>{
 const target=shop[0],records=[item(target.productId,{placement:'FIELD',siteName:'Buda'})];
 const saved=board(records);
 assert.equal(saved.inventory.field,base.inventory.field+1);assert.equal(saved.inventory.shop,base.inventory.shop-1);assert.equal(saved.inventory.total,base.inventory.total);
 const unit=saved.units.find(u=>u.productId===target.productId);assert.ok(unit,'it appears on the saved board');assert.ok(['unverified','not_applicable'].includes(unit.status),unit.status);
 assert.equal(saved.counts.online,base.counts.online);assert.equal(saved.counts.offline,base.counts.offline);
 // Every other unit keeps exactly the status, check time and reason it had: adding one unit by hand must not disturb the direct evidence of the rest.
 assert.deepEqual(saved.units.filter(u=>u.productId!==target.productId),base.units);
 const map={...f.field,productConnections:f.connections,manualPlacementOverrides:receipt(...records)};
 const live=cameraFieldProducts(map,f.health,f.now,true),plain=cameraFieldProducts({...f.field,productConnections:f.connections},f.health,f.now,true);
 const direct=board=>board.items.filter(p=>p.productId!==target.productId).map(p=>[p.productId,p.status,p.linked?.evidence?.basis??null,p.linked?.evidence?.association??null]);
 assert.deepEqual(direct(live),direct(plain),'direct connection evidence for the other units is untouched');
 assert.ok(plain.items.some(p=>p.linked?.evidence?.association==='exact_product_id_tracker_endpoint'),'the fixture really has direct evidence to lose');
 assert.match(live.items.find(p=>p.productId===target.productId).reason||'',/Placed in the Field by hand/);
});
test('manual wins in both directions at once, and the last entry for a Product ID is the one applied',()=>{
 const saved=board([item(field[0].productId,{placement:'SHOP'}),item(shop[0].productId,{placement:'FIELD'})]);
 assert.equal(saved.inventory.field,base.inventory.field);assert.equal(saved.inventory.total,base.inventory.total);
 assert.ok(!saved.units.some(u=>u.productId===field[0].productId));assert.ok(saved.units.some(u=>u.productId===shop[0].productId));
});
test('a manual entry that agrees with mHelp changes no count',()=>{
 const next=manualShopInventory(upload,receipt(item(field[0].productId,{placement:'FIELD'})));
 assert.deepEqual(next.summary,upload.summary);assert.equal(next.records.find(x=>x.productId===field[0].productId).cosManualRecordAuditId.length,36);
});
test('a record for a Product ID that is not in the inventory is ignored, not invented',()=>{
 const next=manualShopInventory(upload,receipt(item('999999999',{placement:'FIELD'})));assert.equal(next.records.length,upload.records.length);assert.deepEqual(next.summary,upload.summary);
});
test('malformed manual records refuse the projection instead of being half-applied',()=>{
 for(const bad of [{productId:'abc',auditId:'x',record:blank},{productId:'1',auditId:'x',record:{...blank,placement:'UNKNOWN'}},{productId:'1',auditId:'x',record:null},{productId:'1',record:blank}])
  assert.throws(()=>manualShopInventory(upload,receipt(bad)),/Manual equipment records are unavailable/);
});
test('the field map carries the verified records, and says so when they cannot be read',async()=>{
 const set={contract:'COS_MANUAL_EQUIPMENT_SET_V1',items:[item(field[0].productId,{placement:'SHOP'})]};
 const ready=await attachManualEquipment({a:1,manualPlacementOverrides:{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[{x:1}]}},async()=>set);
 assert.equal(ready.manualEquipmentState,'ready');assert.equal(ready.a,1);assert.deepEqual(ready.manualPlacementOverrides.items,[{x:1}]);assert.equal(ready.manualPlacementOverrides.records[0].productId,field[0].productId);
 for(const read of [async()=>{throw Error('down');},async()=>null,async()=>({contract:'COS_MANUAL_EQUIPMENT_SET_V1',items:[{...set.items[0],record:{placement:'X'}}]}),async()=>({contract:'COS_MANUAL_EQUIPMENT_SET_V1',items:[set.items[0],set.items[0]]})]){
  const down=await attachManualEquipment({a:1},read);assert.equal(down.manualEquipmentState,'unavailable');assert.deepEqual(down.manualPlacementOverrides,{contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[],records:[]});
 }
 assert.equal(checkedManualEquipmentSet(set).length,1);
});
