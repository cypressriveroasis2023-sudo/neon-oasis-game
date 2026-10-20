import test from 'node:test';import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {fieldProductScope} from '../src/fieldProductScope.ts';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
import {fleetDashboardRows,fleetDashboardSummary,filterFleetDashboard,initialFleetFilters} from '../src/fleetDashboardModel.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {resource,snapshot,withStatus} from './fixtures/camera-evidence-fixtures.mjs';

test('a raw outage without a reviewed Product-ID link stays outside the shared Field totals',()=>{
 const f=fieldProductFixture(),orphan={...f.units[1],id:'00000000-0000-4000-8000-000000000269',unitNumber:'Spotter 269'};
 f.units.push(orphan);f.field.items=f.units;f.field.inventoryItems=f.units;Object.assign(f.field.summary,{fieldUnits:5,missingGps:5});
 const item={...f.roster.items[1],id:'cos_unit:'+orphan.id,unitId:orphan.id,unit:orphan,unitNumber:orphan.unitNumber,productIds:[],sourceRecordIds:[],representedUnitIds:[orphan.id]};f.roster.items.push(item);
 for(const key of ['totalRecords','activeRecords','field','linkedUnitRecords'])f.roster.summary[key]++;
 const health=snapshot([...f.health.rows,withStatus(resource(269,'Spotter 269'),'offline')]),before=structuredClone(f.field),pair=reconcileFleetSnapshot(health,f.field,f.now);
 const info=fieldCameraHealth(orphan,f.units,pair.health,f.now);assert.equal(info.state,'unknown');assert.equal(info.identity,'missing');assert.match(info.reason,/not linked.*Field Product ID/);
 const rows=fleetDashboardRows(f.units,pair.health,null,null,f.now),counts=fleetDashboardSummary(filterFleetDashboard(rows,initialFleetFilters,'fleet')),products=mhelpFieldHealth(f.upload,f.roster,rows,f.now);
 assert.equal(rows.find(row=>row.id===orphan.id).countedFieldCamera,false);assert.equal(counts.offline,products.counts.offline);assert.equal(counts.online,products.counts.online);assert.equal(counts.unknown,products.counts.unverified);
 assert.equal(pair.health.rows.find(row=>row.id===269).evidence.status,'offline');assert.deepEqual(f.field,before);
});
test('held, candidate, inactive and source-only products cannot authorize native health',()=>{
 for(const change of [f=>f.upload.records[0].binding.placementHeld=true,f=>f.upload.records[0].binding.candidateUnitIds=[f.units[1].id],f=>f.upload.records[0].binding.state='held']){
  const f=fieldProductFixture();change(f);const scope=fieldProductScope(f.field,f.now);assert(!scope.unitIds.includes(f.units[0].id));
 }
 const f=fieldProductFixture();assert.deepEqual(fieldProductScope(f.field,f.now).unitIds,f.units.map(unit=>unit.id));
});
test('incomplete or duplicate authority fails instead of assigning a possible match',()=>{
 const f=fieldProductFixture();assert.throws(()=>fieldProductScope({...f.field,fleetRoster:null},f.now),/could not be verified/);
 assert.throws(()=>fieldProductScope({...f.field,uploadInventory:{...f.upload,records:[...f.upload.records,f.upload.records[0]]}},f.now),/could not be verified/);
 assert.equal(fieldProductScope({items:[]},f.now),undefined);
});
