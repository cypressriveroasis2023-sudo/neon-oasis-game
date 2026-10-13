import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import {now as browserFixtureNow} from './fixtures/camera-evidence-fixtures.mjs';
import {fleetLocationPins} from '../src/fleetLocationPins.ts';
import {fleetDashboardRows,initialFleetFilters,filterFleetDashboard} from '../src/fleetDashboardModel.ts';
import {withSyntheticEstimate} from './fixtures/fleet-location-fixtures.mjs';
const unit=(n,patch={})=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,unitNumber:'Sniper '+n,address:'100 Example Road, Test City, TX 77001',placement:'FIELD',currentLocationType:'field',status:'field',...patch});
test('one validated point population separates missing locations, estimates and verified installations',async()=>{
 const now=Date.parse('2026-10-13T12:00:00Z'),at='2026-10-07T12:00:00Z';
 const inventory=[unit(1,{latitude:29.7,longitude:-95.4,coordinateSource:'site',locationVerification:'owner_verified',locationVerifiedAt:at,gpsRecordedAt:at}),withSyntheticEstimate(unit(2)),unit(3),withSyntheticEstimate(unit(4,{placement:'SHOP',currentLocationType:'shop',status:'available'})),withSyntheticEstimate(unit(5,{activeInventoryEligible:false}))];
 const rows=fleetDashboardRows(inventory,null,null,null,now),pins=await fleetLocationPins(rows),ids=new Set(pins.map(pin=>pin.row.id));
 assert.deepEqual(pins.map(pin=>[pin.row.name,pin.kind]),[['Sniper 1','current'],['Sniper 2','estimate']]);
 assert.equal(rows[1].locationVerified,false);assert.equal(rows[1].locationNeedsReview,true);
 const field=filterFleetDashboard(rows,initialFleetFilters);assert.deepEqual(field.filter(row=>!ids.has(row.id)).map(row=>row.name),['Sniper 3']);
 assert.equal(field.length,3);assert.equal(pins.length+field.filter(row=>!ids.has(row.id)).length,field.length);
});
test('a rejected or changed-address estimate stays missing; raw coordinates are never counted',async()=>{
 const estimate=withSyntheticEstimate(unit(1));estimate.address='200 Different Road, Test City, TX 77001';
 const rows=fleetDashboardRows([estimate,unit(2,{latitude:30,longitude:-95})],null,null,null);
 assert.deepEqual(await fleetLocationPins(rows),[]);
});

test('the synthetic accepted estimate predates the actual browser clock and future evidence still fails closed',async()=>{const row=withSyntheticEstimate(unit(9));assert(await checkedAddressEstimate(row,browserFixtureNow));const note=JSON.parse(row.locationNote.split('|')[1]);note.geocodedAt=note.appliedAt='2026-10-07T12:00:00Z';assert.equal(await checkedAddressEstimate({...row,locationNote:'COS_ADDRESS_ESTIMATE_V1|'+JSON.stringify(note)},browserFixtureNow),null);});
