import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {projectFieldGeocodes} from '../../supabase/functions/cos-operations-pages/fieldGeocodeProjection.ts';
import {projectMhelpFleetLocations} from '../../supabase/functions/cos-operations-pages/mhelpFleetLocationProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../src/fieldLocations.ts';
import {fixture,id,at,now} from './owner-census-once-fixtures.mjs';
globalThis.crypto??=webcrypto;
globalThis.fetch=async()=>{throw Error('Synthetic projection tests cannot contact a provider');};
const sourceHash='c'.repeat(64),mhelpPoint=[29.5,-95.5],censusPoint=[31,-96];
async function projected({history,state,coordinateSource='mHelpDesk service location',verified=false}){
 const f=fixture();
 if(!history)Object.assign(f.row,{hasUnitGps:false,gpsRecordedAt:null,historicalRecordedAt:null,historicalLatitude:null,historicalLongitude:null,historicalCoordinateSource:null,locationVerification:'address_only'});
 if(verified)Object.assign(f.row,{hasUnitGps:true,latitude:32,longitude:-97,coordinateSource:'manual',locationVerification:'owner_verified',locationVerifiedAt:at,gpsRecordedAt:at});
 const record={...f.row.locationGeocode};delete f.row.locationGeocode;
 record.censusOnlyState=state.startsWith('consumed')?'consumed':'ready';
 record.status=state.startsWith('consumed')?'success':'no_match';
 if(record.status==='success')Object.assign(record,{latitude:censusPoint[0],longitude:censusPoint[1],matchedAddress:'200 Synthetic Fixture Road, Testville, TX 77002',geocodedAt:at,censusOnlySourceSha256:sourceHash});
 if(state==='unenrolled'){delete record.censusOnly;delete record.censusOnlyState;delete record.censusOnlyGuard;}
 const receipts=state==='consumed_valid'?[{contract:'COS_OWNER_ONE_CENSUS_SOURCE_V1',nativeUnitId:id,auditId:record.auditId,unitKey:record.unitKey,addressSha256:record.addressSha256,nativeSourceSha256:sourceHash,complete:true}]:[];
 f.snapshot.ownerCensusProofs=state==='ready'||state==='consumed_missing_receipt'?[f.proof]:[];
 f.snapshot.inventoryItems=[f.row];
 const observedAt=new Date(now-60000).toISOString();
 const mhelp={contract:'COS_MHELP_FLEET_LOCATIONS_V1',lastSuccessAt:observedAt,items:[{unitId:id,unitNumber:f.row.unitNumber,state:'confirmed',guardCurrent:true,observedAt,placement:'FIELD',customer:'Synthetic builder',site:'Synthetic current site',address:f.row.address,point:mhelpPoint,coordinateSource}]};
 const before=structuredClone({snapshot:f.snapshot,record,receipts,mhelp});
 const census=await projectFieldGeocodes(f.snapshot,[record],false,receipts);
 const result=projectMhelpFleetLocations(census,mhelp,now),row=result.items[0];
 assert.deepEqual({snapshot:f.snapshot,record,receipts,mhelp},before,'projection inputs and saved history remain untouched');
 assert.ok(row.mhelpLocation,'actual protected-Owner projection retains supplemental evidence');
 assert.equal(row.address,f.row.address);assert.equal(row.placementSource,'owner');
 assert.deepEqual(row.mhelpLocation.point,mhelpPoint);
 for(const key of ['hasUnitGps','historicalRecordedAt','historicalLatitude','historicalLongitude','historicalCoordinateSource','locationNote'])assert.deepEqual(row[key],f.row[key],key+' stays unchanged');
 return {row,estimate:await checkedAddressEstimate(row,now)};
}
for(const coordinateSource of ['mHelpDesk service location','Census address estimate'])for(const history of [false,true])for(const state of ['held','ready','consumed_valid','consumed_missing_receipt'])test(`${coordinateSource}: ${state}, historical GPS ${history}, respects enrolled Owner result`,async()=>{
 const {row,estimate}=await projected({history,state,coordinateSource});
 assert.equal(row.locationGeocode.censusOnly,true);
 assert.equal(row.locationGeocode.status,state==='ready'?'no_match':state==='consumed_valid'?'success':'held');
 if(state==='consumed_valid'){
  assert.equal(estimate?.confidence,'address_range_interpolation');assert.deepEqual([estimate.latitude,estimate.longitude],censusPoint);
  assert.equal(estimate.secondaryUnitVerified,false);assert.equal(isCurrentFieldPin(row),false);
 }else assert.equal(estimate,null,'supplemental mHelp point cannot replace held, ready or missing-receipt outcome');
});
for(const coordinateSource of ['mHelpDesk service location','Census address estimate'])test('unenrolled no-GPS control preserves independent '+coordinateSource+' point',async()=>{
 const {row,estimate}=await projected({history:false,state:'unenrolled',coordinateSource});
 assert.equal(row.locationGeocode.censusOnly,undefined);assert.equal(estimate?.confidence,'mhelp_service_unverified');
 assert.deepEqual([estimate.latitude,estimate.longitude],mhelpPoint);assert.equal(isCurrentFieldPin(row),false);
});
test('unenrolled historical GPS control retains its pre-existing protection',async()=>{
 const {estimate}=await projected({history:true,state:'unenrolled'});assert.equal(estimate,null);
});
test('current Owner verified GPS remains authoritative with an enrolled record and same-address supplemental point',async()=>{
 const {row,estimate}=await projected({history:true,state:'consumed_valid',verified:true});
 assert.equal(isCurrentFieldPin(row),true);assert.equal(estimate,null);assert.deepEqual([row.latitude,row.longitude],[32,-97]);
});
