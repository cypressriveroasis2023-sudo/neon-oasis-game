import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedInactiveInventory,inactiveInventoryMatches} from '../src/fieldMapInventory.ts';
import {checkedFieldMap} from '../src/gpsPersistence.ts';
import {inactiveUnit,fieldUnit,inventorySnapshot} from './inactive-inventory-fixtures.mjs';

test('optional inventory preserves old snapshots and validates V1 native/V1 tracker/V2 tracker inactive rows separately',()=>{
  assert.deepEqual(checkedInactiveInventory({items:[fieldUnit()]}),[]);
  const snapshot=inventorySnapshot(), before=structuredClone(snapshot);
  assert.equal(checkedFieldMap(snapshot),snapshot);
  assert.deepEqual(checkedInactiveInventory(snapshot).map(row=>row.unitNumber),['Helios 401','Solar Stand 402','Skid 403']);
  assert.deepEqual(snapshot,before);
  assert.equal(snapshot.summary.fieldUnits,1);
});
test('inactive search matches case-insensitive labels, models and source customer without selecting a field unit',()=>{
  const inventory=checkedInactiveInventory(inventorySnapshot());
  for(const [query,labels] of [['  hELios 401 ',['Helios 401']],['support equipment',['Solar Stand 402','Skid 403']],['retired customer',inventory.map(row=>row.unitNumber)],['DO NOT USE',inventory.map(row=>row.unitNumber)],['missing',[]],['',inventory.map(row=>row.unitNumber)]])assert.deepEqual(inventory.filter(row=>inactiveInventoryMatches(row,query)).map(row=>row.unitNumber),labels);
});
test('malformed optional inventories, duplicated identities and field/inactive overlap fail admission',()=>{
  for(const inventoryItems of [null,{},[null],[{}],[inactiveUnit(),inactiveUnit()]])assert.throws(()=>checkedInactiveInventory({items:[],inventoryItems}));
  const row=inactiveUnit();assert.throws(()=>checkedInactiveInventory(inventorySnapshot([row],[{...fieldUnit(),id:row.id}])));
  assert.throws(()=>checkedInactiveInventory({items:[row]}),/returned as a field unit/);
});
test('inconsistent inactive placement, coordinates, identity and exact provenance never enter field consumers',()=>{
  const mutations=[row=>row.status='field',row=>row.currentLocationType='field',row=>row.importedPlacement='FIELD',row=>row.placement='FIELD',row=>row.placementSource='owner',row=>row.placementAuditId='5',row=>row.site='Former field site',row=>row.address='123 Old Street',row=>row.latitude=29,row=>row.longitude=-95,row=>row.coordinateSource='manual',row=>row.hasUnitGps=true,row=>row.locationVerification='owner_verified',row=>row.installedSiteId=fieldUnit().id,row=>row.readOnly=undefined,row=>row.importedInstallation.entityKind='tracker',row=>row.importedInstallation.nativeUnitId=fieldUnit().id,row=>row.importedInstallation.placement='FIELD',row=>row.importedInstallation.sourceRevision='bad',row=>row.importedInstallation.eventId='0',row=>row.importedInstallation.nativeGuardSha256='A'.repeat(64),row=>row.importedInstallation.sourceFileSha256='bad',row=>row.importedInstallation.sourceRowSha256=null,row=>row.importedInstallation.productId='-1',row=>row.importedInstallation.schemaVersion=1,row=>row.importedInstallation.latitude=29,row=>delete row.importedInstallation.eventId];
  for(const mutate of mutations){const row=inactiveUnit();mutate(row);assert.throws(()=>checkedInactiveInventory(inventorySnapshot([row])),/inconsistent/,mutate.toString());assert.throws(()=>checkedInactiveInventory({items:[row]}),/returned as a field unit/,mutate.toString());}
});
test('V2 inactive tracker contract cannot borrow V1 identity or claim an equipment unit',()=>{
  for(const mutate of [row=>row.importedInstallation.productId='123',row=>row.importedInstallation.sourceSystem='mhelpdesk_product_import',row=>row.importedInstallation.sourceRecordId='bad',row=>{row.readOnly=false;row.importedInstallation.entityKind='equipment_unit';}]){const row=inactiveUnit(3,2,true);mutate(row);assert.throws(()=>checkedInactiveInventory(inventorySnapshot([row])),/inconsistent/);}
});
test('effective Owner FIELD and SHOP placements outrank retained historical INACTIVE source metadata',()=>{
  for(const placement of ['FIELD','SHOP']){const row={...inactiveUnit(),placementSource:'owner',placement,placementAuditId:'43',currentLocationType:placement.toLowerCase(),...(placement==='FIELD'?{status:'field',address:'123 Owner Street'}:{})};assert.deepEqual(checkedInactiveInventory(inventorySnapshot(placement==='FIELD'?[]:[row],placement==='FIELD'?[row]:[])),[]);}
  const row={...inactiveUnit(),placementSource:'owner',placement:'FIELD',placementAuditId:'bad',currentLocationType:'field'};
  assert.throws(()=>checkedInactiveInventory(inventorySnapshot([row])),/inconsistent/);
});
test('unrelated native inactive status and placement review inventory preserve existing snapshots',()=>{
  const native={...inactiveUnit(),importedPlacement:undefined,importedInstallation:undefined};
  const held={...inactiveUnit(2,1,true),placement:'UNKNOWN',placementStatus:'needs_identity_review',locationVerification:'address_changed'};
  assert.deepEqual(checkedInactiveInventory(inventorySnapshot([native,held])),[]);
  assert.throws(()=>checkedInactiveInventory({items:[native]}),/returned as a field unit/);
  assert.throws(()=>checkedInactiveInventory({items:[held]}),/returned as a field unit/);
});
test('inactive source inventory never claims current jobs, verification or placement/address guards',()=>{
  for(const key of ['activeJobNumber','locationHistoryId','locationVerifiedAt','placementUnitKey','placementUpdatedAt','addressSource','addressUpdatedAt']){const row={...inactiveUnit(),[key]:'unexpected-current-guard'};assert.throws(()=>checkedInactiveInventory(inventorySnapshot([row])),/inconsistent/,key);}
});
