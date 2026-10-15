import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fleetLocationPins,sourceEquipmentLocationPins,fleetLocationPinId,fleetLocationCoverage} from '../src/fleetLocationPins.ts';
import {fleetDashboardRows,fleetDashboardSummary,initialFleetFilters} from '../src/fleetDashboardModel.ts';
import {filterSourceEquipment} from '../src/fleetRecordedRoster.ts';
import FleetSourceEquipment from '../src/FleetSourceEquipment.tsx';
import {clusterReticleMarkup} from '../src/fieldMapMarkers.ts';
import {sourceEquipmentRecord,sourceEquipmentEstimate,sourceEquipmentEnvelope,sourceReceipt} from './fixtures/source-equipment-pin-fixtures.mjs';
const now=Date.parse('2026-10-06T18:00:00Z');
const pins=records=>sourceEquipmentLocationPins(records,sourceEquipmentEnvelope(records.map(r=>sourceEquipmentEstimate(r))),sourceReceipt,now);
test('source address pins have stable source identities and no native row or hardware health',async()=>{
 const records=[sourceEquipmentRecord(),sourceEquipmentRecord('910002',{unitNumber:'Solar Stand 902',family:'Stand'})],found=await pins(records);
 assert.equal(found.length,2);assert.deepEqual(found.map(fleetLocationPinId),records.map(r=>r.id));
 for(const pin of found){assert.equal(pin.kind,'source_equipment_estimate');assert.equal(pin.record.unit,null);assert.equal(pin.record.unitId,null);assert.equal(pin.row,undefined);assert.equal(pin.estimate.verified,false);assert.equal(pin.estimate.liveGps,false);assert.match(pin.estimate.receiptId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.match(pin.estimate.uploadRecordSha256,/^[a-f0-9]{64}$/);assert.deepEqual(pin.point,[30,-95]);}
 assert.equal(filterSourceEquipment(records,initialFleetFilters).length,2);assert.equal(filterSourceEquipment(records,{...initialFleetFilters,status:'online'}).length,0);assert.equal(filterSourceEquipment(records,{...initialFleetFilters,nearbyId:'native-center'}).length,0);
});
test('current, estimate and source pins form one counted population without changing 152 native pins',async()=>{
 const inventory=Array.from({length:152},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,unitNumber:'Sniper '+(i+1),address:'100 Example Road, Test City, TX 77001',placement:'FIELD',currentLocationType:'field',status:'field',latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:'2026-10-06T17:45:00Z',gpsRecordedAt:'2026-10-06T17:45:00Z'}));
 const rows=fleetDashboardRows(inventory,null,null,null,now),before=fleetDashboardSummary(rows),native=await fleetLocationPins(rows),records=[sourceEquipmentRecord(),sourceEquipmentRecord('910003')],source=await pins(records.slice(0,1)),all=[...native,...source];
 assert.equal(native.length,152);assert.equal(all.length,153);assert.deepEqual(fleetDashboardSummary(rows),before);assert.equal(inventory.length,152);assert.deepEqual(fleetLocationCoverage(rows,records,all),{missing:1,estimated:1});assert.deepEqual(fleetLocationCoverage([...rows,...rows],records.concat(records),all.concat(source)),{missing:1,estimated:1});
});
test('absent, invalid, duplicate, changed-receipt, changed-address and unsafe source evidence stays missing',async()=>{
 const record=sourceEquipmentRecord(),envelope=sourceEquipmentEnvelope([sourceEquipmentEstimate(record)]);
 assert.deepEqual(await sourceEquipmentLocationPins([record],undefined,sourceReceipt,now),[]);
 assert.deepEqual(await sourceEquipmentLocationPins([record],envelope,{},now),[]);
 assert.deepEqual(await sourceEquipmentLocationPins([record],envelope,{...sourceReceipt,payloadSha256:'f'.repeat(64)},now),[]);
 assert.deepEqual(await sourceEquipmentLocationPins([record],sourceEquipmentEnvelope([...envelope.items,...envelope.items]),sourceReceipt,now),[]);
 assert.deepEqual(await sourceEquipmentLocationPins([record,record],envelope,sourceReceipt,now),[]);
 for(const patch of [{sourceAddress:{...record.sourceAddress,street:'200 Changed Road'}},{customer:'Changed customer'},{representedUnitIds:['00000000-0000-4000-8000-000000000001']},{candidateUnitIds:['00000000-0000-4000-8000-000000000001']},{unitId:'00000000-0000-4000-8000-000000000001'},{reviewReason:'Identity held'}])assert.deepEqual(await sourceEquipmentLocationPins([{...record,...patch}],envelope,sourceReceipt,now),[]);
 for(const patch of [{receiptId:undefined},{receiptId:'invalid-receipt'},{uploadRecordSha256:undefined},{uploadRecordSha256:'invalid-hash'},{latitude:NaN},{geocodedAt:'2099-01-01T00:00:00Z'},{accuracy:0.5},{accuracyType:'place'},{verified:true},{liveGps:true}])assert.deepEqual(await sourceEquipmentLocationPins([record],sourceEquipmentEnvelope([sourceEquipmentEstimate(record,patch)]),sourceReceipt,now),[]);
 assert.deepEqual(fleetLocationCoverage([], [record], []),{missing:1,estimated:0});
});
test('Shop, inactive and held equipment cannot enter field pins or either location count',async()=>{
 const records=[sourceEquipmentRecord('910004',{placement:'shop'}),sourceEquipmentRecord('910005',{active:false,lifecycle:'do_not_use'}),sourceEquipmentRecord('910006',{kind:'identity_review',placement:'unknown',reviewReason:'Held'})];assert.deepEqual(await pins(records),[]);assert.deepEqual(fleetLocationCoverage([],records,[]),{missing:0,estimated:0});
});
test('source card discloses an accepted estimate without native actions and safely escapes text',()=>{
 const record=sourceEquipmentRecord('910007',{unitNumber:'Ranger <script>1</script>'}),estimate=sourceEquipmentEstimate(record);
 const html=renderToStaticMarkup(React.createElement(FleetSourceEquipment,{record,estimate,now,onSelect:()=>{}}));assert.match(html,/Estimated address · Unlinked equipment/);assert.match(html,/not live GPS or device health/);assert.match(html,/View estimated address/);assert.match(html,/data-record-id/);assert.doesNotMatch(html,/data-unit-id|href=|No map pin|<script>|Edit \/ verify|Create ticket/);
});
test('clusters count source equipment separately without adding any native health evidence',()=>{
 const noHealth={online:0,offline:0,unknown:0,support:0};const only=clusterReticleMarkup(noHealth,2,0,0,2);assert.match(only,/data-health="unlinked"/);assert.match(only,/data-unlinked-count="2"/);assert.match(only,/>2<\/b>/);assert.doesNotMatch(only,/support units|data-health="(?:online|offline|support|unknown)"/);
 const native={online:1,offline:0,unknown:0,support:0},mixed=clusterReticleMarkup(native,1,0,0,1);assert.match(mixed,/>2<\/b>/);assert.match(mixed,/data-health="mixed"/);assert.match(mixed,/data-unlinked-count="1"/);assert.deepEqual(native,{online:1,offline:0,unknown:0,support:0});
});
