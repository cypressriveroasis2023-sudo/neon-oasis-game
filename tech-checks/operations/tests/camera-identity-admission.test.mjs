import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraScope} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
import {cameraDashboardSummary} from '../src/cameraDashboardSummary.ts';
import {cameraOverview,cameraUnitDisplayState,healthWithFieldInventory} from '../src/cameraHealthCounts.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
test('an active customer folder cannot admit Field placement, including a different tracker label',()=>{
 const device={unit_key:'SOLARSPOTTER099',organization:'Former synthetic customer',activation_state:'ACTIVE'};
 assert.equal(cameraScope(device,[{canonical_family:'Spotter',unit_tag:'099',source_label:'Solar Spotter 099',tracker_state:'shop'}]),'unknown');
 assert.equal(cameraScope({...device,__ownerPlacement:'SHOP'}),'shop');
 assert.equal(cameraScope({...device,__ownerPlacement:'FIELD'}),'field');
});
test('a matching label without a receipt stays review while preserving source observations',()=>{
 const f=fieldProductFixture();f.health.unitIdentities=[];
 const result=fieldCameraHealth(f.units[1],f.units,f.health,f.now);
 assert.equal(result.state,'unknown');assert.equal(result.identity,'missing');assert.equal(result.association,undefined);
 assert.equal(result.rows[0].evidence.status,'offline');
 const overview=cameraOverview(f.health,f.now,f.units);
 assert.ok(overview.groups.every(g=>!g.linkedIdentity));
 assert.ok(overview.groups.every(g=>cameraUnitDisplayState(g)==='verifying'));
 assert.equal(overview.groups.find(g=>g.rows.some(r=>r.evidence.status==='offline')).rows[0].evidence.status,'offline');
 assert.equal(overview.summary.offline,0);
 const dashboard=cameraDashboardSummary(f.health,f.now);assert.match(dashboard.headline,/equipment identity review/);assert.doesNotMatch(dashboard.headline,/No .*recorded|No .*flagged/);
});
test('accepted resource receipts continue to verify existing camera observations',()=>{
 const f=fieldProductFixture();const result=fieldCameraHealth(f.units[1],f.units,f.health,f.now);
 assert.equal(result.state,'offline');assert.equal(result.identity,'matched');assert.ok(result.association);
 assert.ok(cameraOverview(f.health,f.now,f.units).groups.some(g=>g.linkedIdentity&&g.unitIdentity?.unitId===f.units[1].id));
});

test('unreviewed resource labels cannot hide exact inventory-only drill-down rows',()=>{
 const f=fieldProductFixture();f.health.unitIdentities=[];
 const augmented=healthWithFieldInventory(f.health,f.units,f.now);
 const overview=cameraOverview(augmented,f.now,f.units);
 for(const unit of f.units.slice(0,3)){
  const inventory=overview.groups.find(g=>g.rows.length===1&&g.rows[0].id==='field:'+unit.id);
  assert.ok(inventory);assert.equal(inventory.linkedIdentity,false);assert.equal(cameraUnitDisplayState(inventory),'verifying');
 }
 assert.equal(overview.cameras.total,3);assert.equal(f.health.rows.length,3);
 assert.deepEqual(healthWithFieldInventory(augmented,f.units,f.now),augmented);
});

test('inventory review preserves suffixes and distinct IDs without creating name bindings',()=>{
 const f=fieldProductFixture();f.health.unitIdentities=[];
 const units=[{...f.units[0],unitNumber:'Solar Spotter 099HDC4'},{...f.units[1],unitNumber:'Solar Spotter 099HDC4'}];
 const health=healthWithFieldInventory(f.health,units,f.now);
 const placeholders=health.rows.filter(row=>String(row.id).startsWith('field:'));
 assert.deepEqual(placeholders.map(row=>row.unit),units.map(unit=>unit.unitNumber));
 assert.equal(new Set(placeholders.map(row=>row.id)).size,2);
 for(const unit of units){const state=fieldCameraHealth(unit,units,health,f.now);assert.equal(state.state,'unknown');assert.equal(state.association,undefined);}
});
