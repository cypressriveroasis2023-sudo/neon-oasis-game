import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetDisplayAddress,recordedAddressText} from '../src/fleetDisplayAddress.ts';
import {fleetDashboardRows,filterFleetDashboard,initialFleetFilters,fleetDashboardCsv} from '../src/fleetDashboardModel.ts';
import {filterSourceEquipment} from '../src/fleetRecordedRoster.ts';
const unit={id:'00000000-0000-4000-8000-000000000001',unitNumber:'Helios 901',placement:'FIELD',currentLocationType:'field',address:'200 Prior installation Road',latitude:30,longitude:-95};
const record={kind:'unit',unitId:unit.id,unitNumber:unit.unitNumber,source:'owner_supplied_mhelp_export',sourceAddress:{street:'100 Example Road\nSynthetic building',city:'Test City',state:'TX',zip:'77001 SAMPLE ENTRY'},observedAt:'2026-10-13T18:22:00Z',productIds:['9001']};
test('a proven MHelp roster link displays every file component without replacing installation evidence',()=>{
 const before=structuredClone(unit),address=fleetDisplayAddress(unit,record);
 assert.equal(address.text,'100 Example Road\nSynthetic building, Test City, TX 77001 SAMPLE ENTRY');assert.equal(address.label,'MHelp address');assert.equal(address.recordedAt,record.observedAt);assert.deepEqual(unit,before);
 const row={...fleetDashboardRows([unit],null,null,null)[0],displayAddress:address};assert.equal(filterFleetDashboard([row],{...initialFleetFilters,query:'SAMPLE ENTRY'}).length,1);
 const csv=fleetDashboardCsv([row]);assert(csv.includes(address.text));assert(csv.includes('MHelp address'));assert(csv.includes('200 Prior installation Road'));
});
test('blank MHelp addresses remain explicitly blank and no label/candidate association can assign them',()=>{
 assert.equal(fleetDisplayAddress(unit,{...record,sourceAddress:null}).text,'');
 for(const patch of [{source:'owner'},{kind:'identity_review'},{unitId:'00000000-0000-4000-8000-000000000002'},{unitNumber:'Helios 902'},{productIds:[]}])assert.deepEqual(fleetDisplayAddress(unit,{...record,...patch}),{text:unit.address,label:'Installation address',recordedAt:null});
 assert.equal(recordedAddressText({street:null,city:{bad:'not text'},state:'TX',zip:'77001'}),'TX 77001');
});
test('unlinked source equipment can be found by its own recorded address without receiving a UUID or pin',()=>{
 const source={...record,id:'mhelp_product:9001',kind:'source_equipment',unitId:null,unit:null,active:true,lifecycle:'active',placement:'field',family:'HELIOS',customer:'Synthetic customer'};
 assert.deepEqual(filterSourceEquipment([source],{...initialFleetFilters,query:'SAMPLE ENTRY'}),[source]);assert.equal(source.unitId,null);
});
