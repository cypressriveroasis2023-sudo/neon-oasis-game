import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {cameraOverview,cameraUnitDisplayState,healthWithFieldInventory} from '../src/cameraHealthCounts.ts';
import {fieldCameraHealth,validateCameraHealth} from '../src/fieldCameraHealth.ts';
import {snapshot,resource,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const unit={id,unitNumber:'Helios 1',modelName:'Helios',status:'field',currentLocationType:'field',placement:'FIELD',address:'Synthetic site'};
const map=units=>({items:units.filter(u=>u.placement==='FIELD'),inventoryItems:units,summary:{fieldUnits:units.filter(u=>u.placement==='FIELD').length,mappedUnits:0,unitGps:0,missingGps:units.filter(u=>u.placement==='FIELD').length},generatedAt:fresh});
const health=rows=>({...snapshot(rows),identityVersion:1,unitIdentities:[{unitId:id,unitNumber:unit.unitNumber,kind:'native_provider',deviceIds:rows.map(r=>String(r.id)),unitKeys:[...new Set(rows.map(r=>r.unit))],proof:'a'.repeat(64)}],identityWarnings:[]});
test('both views use the exact same guarded unit status after current placement reconciliation',()=>{
 const raw=health([resource(1,'Helios 1',{scope:'unknown'})]),before=structuredClone(raw);const pair=reconcileFleetSnapshot(raw,map([unit]),now);assert.equal(pair.health.rows[0].scope,'field');assert.equal(pair.health.rows[0].evidence,raw.rows[0].evidence);validateCameraHealth(pair.health);
 const pin=fieldCameraHealth(unit,[unit],pair.health,now),overview=cameraOverview(pair.health,now,[unit]);assert.equal(pin.state,'online');assert.equal(cameraUnitDisplayState(overview.groups[0]),pin.state);assert.deepEqual(overview.operational,{monitored:1,online:1,offline:0,unknown:0});assert.deepEqual(raw,before);
 const shop={...unit,placement:'SHOP',currentLocationType:'shop'};const moved=reconcileFleetSnapshot(raw,map([shop]),now),shopOverview=cameraOverview(moved.health,now,[shop]);assert.equal(moved.health.rows[0].scope,'shop');assert.equal(shopOverview.operational.monitored,0);assert.equal(shopOverview.operational.unknown,0);assert.equal(shopOverview.scopes.shop,1);
});
test('a similar or duplicate name never moves real provider resources; partial identity is rejected',()=>{
 const raw=snapshot([resource(1,'Helios 1',{scope:'unknown'})]);assert.equal(reconcileFleetSnapshot(raw,map([unit]),now).health.rows[0].scope,'unknown');
 const identity=health([resource(1)]);identity.unitIdentities[0].deviceIds.push('2');assert.equal(reconcileFleetSnapshot(identity,map([unit]),now).health.rows[0].scope,'field');
 const unknown=health([resource(1,'Helios 1',{scope:'unknown'})]);assert.equal(reconcileFleetSnapshot(unknown,map([unit,{...unit,id:other}]),now).health.rows[0].scope,'field');
 const duplicated=map([unit,{...unit}]);assert.throws(()=>reconcileFleetSnapshot(unknown,duplicated,now),/inconsistent/);
});
test('known shop inventory with no provider resource appears in Shop and never becomes unknown-field health',()=>{
 const shop={...unit,placement:'SHOP',currentLocationType:'shop'},h=healthWithFieldInventory(snapshot([]),[shop],now),overview=cameraOverview(h,now,[shop]);validateCameraHealth(h);assert.equal(overview.scopes.shop,1);assert.equal(overview.operational.unknown,0);assert.equal(overview.summary.monitored,0);
});
test('complete multiple source keys become one verified native unit in both views',()=>{
 const rows=[resource(1,'Helios 1'),resource(2,'Helios secondary')],h=health(rows),pair=reconcileFleetSnapshot(h,map([unit]),now),overview=cameraOverview(pair.health,now,[unit]);assert.equal(overview.groups.length,1);assert.equal(overview.groups[0].name,'Helios 1');assert.equal(cameraUnitDisplayState(overview.groups[0]),fieldCameraHealth(unit,[unit],pair.health,now).state);
});
test('Fleet and field-map reject different generations and reassigned receipt membership',()=>{
 const token={contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'tenant',generation:'1',rosterRevision:'r1',admitted:true};
 const raw={...health([resource(1,'Helios 1')]),avigilonAuthority:token};raw.rows[0].avigilonPublication={receiptId:'73',unitId:id,rosterUnitId:'r1'};
 const field={...map([unit]),avigilonAuthority:token};assert.equal(reconcileFleetSnapshot(raw,field,now).health.rows[0].avigilonPublication.receiptId,'73');
 assert.throws(()=>reconcileFleetSnapshot(raw,{...field,avigilonAuthority:{...token,generation:'2'}},now),/authority changed/);
 assert.throws(()=>reconcileFleetSnapshot(raw,map([unit]),now),/authority unavailable/);
 assert.throws(()=>reconcileFleetSnapshot(raw,{...map([{...unit,placement:'SHOP'}]),avigilonAuthority:token},now),/current Field/);
 assert.throws(()=>reconcileFleetSnapshot({...raw,unitIdentities:[{...raw.unitIdentities[0],unitId:other}]},field,now),/current Field/);
});
