import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fleetInventorySnapshot} from '../src/useFleetInventory.ts';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
test('daily and shop totals use reviewed Product IDs, not native/tracker representations',()=>{
 const f=statusPinsFixture(),result=fleetInventorySnapshot(f.field,Date.parse(f.fresh));
 assert.equal(result.authority.total,1001);assert.equal(result.authority.field,287);assert.equal(result.authority.shop,714);
 assert.equal(result.records.filter(r=>r.placement==='SHOP').length,714);
 assert.notEqual(result.authority.total,f.field.inventoryItems.length);
});
test('invalid or duplicate census cannot become daily totals',()=>{
 const f=statusPinsFixture();f.field.uploadInventory.records[1].productId=f.field.uploadInventory.records[0].productId;
 assert.throws(()=>fleetInventorySnapshot(f.field,Date.parse(f.fresh)),/unavailable/);
 assert.throws(()=>fleetInventorySnapshot({items:[]}),/unavailable/);
});
test('manual Shop receipts use the same derived inventory as Fleet and leave source data intact',()=>{
 const f=statusPinsFixture(),original=JSON.stringify(f.field.uploadInventory),unit=f.field.inventoryItems[0];
 f.field.manualPlacementOverrides={contract:'COS_FLEET_SHOP_OVERRIDES_V1',items:[{unitId:unit.id,unitNumber:unit.unitNumber,auditId:'77777777-7777-4777-8777-777777777777',placement:'SHOP',recordedAt:'2026-10-06T18:00:01.000Z',sourceBindings:[{productId:f.field.uploadInventory.records[0].productId,sourceSha256:f.field.uploadInventory.sourceSha256,sourceUnitNumber:f.field.uploadInventory.records[0].unitNumber}]}]};
 const result=fleetInventorySnapshot(f.field,Date.parse(f.fresh)+2000);
 assert.equal(result.authority.field,286);assert.equal(result.authority.shop,715);assert.equal(result.authority.total,1001);
 assert.equal(JSON.stringify(f.field.uploadInventory),original);
});
