import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {checkedAddressEstimate,addressEstimatePrefix,addressEstimateSource,addressEstimateHumanNote} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../src/fieldLocations.ts';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const id='11111111-1111-4111-8111-111111111111',at='2026-10-07T12:00:00Z',now=Date.parse('2026-10-07T13:00:00Z');
const address='100 Example Road, Test City, TX 77001';
function fixture(patch={},rowPatch={}){
 const marker={schemaVersion:1,trackerId:id,unitNumber:'Sniper 901',addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),latitude:30,longitude:-95,provider:'us_census_address_range',benchmark:'Public_AR_Current',providerMatchQuality:'Exact',matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:at,confidence:'address_range_interpolation',verified:false,liveGps:false,requiresOwnerConfirmation:true,batchId:'synthetic-batch',approvalReference:'synthetic-approval',appliedByDatabaseRole:'synthetic-role',appliedAt:at,...patch};
 return {id,unitNumber:'Sniper 901',address,status:'field',currentLocationType:'field',readOnly:true,hasUnitGps:false,locationVerification:'coordinates_unverified',latitude:null,longitude:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:addressEstimateSource,locationNote:addressEstimatePrefix+JSON.stringify(marker)+'\nOriginal human note',...rowPatch};
}
test('strict provenance allows only an unverified estimate tied to the exact current tracker address',async()=>{
 const row=fixture(),estimate=await checkedAddressEstimate(row,now);
 assert.equal(estimate.latitude,30);assert.equal(estimate.longitude,-95);assert.equal(estimate.confidence,'address_range_interpolation');
 assert.equal(isCurrentFieldPin(row),false);assert.equal(row.hasUnitGps,false);assert.equal(row.locationVerification,'coordinates_unverified');
 assert.ok(await checkedAddressEstimate(fixture({}, {address:'  100 Example Road,  Test City, TX 77001 \n'}),now));
});
test('wrong identity, changed address, arbitrary old coordinates and confirmed location state never become estimates',async()=>{
 for(const patch of [{id:'22222222-2222-4222-8222-222222222222'},{unitNumber:'Sniper 902'},{address:'101 Example Road, Test City, TX 77001'},{historicalCoordinateSource:'2026_tracker_same_address'},{historicalLatitude:31},{readOnly:false},{hasUnitGps:true},{currentLocationType:'shop'},{status:'shop'},{locationVerification:'address_changed'},{locationNote:'ordinary historical note'}])assert.equal(await checkedAddressEstimate(fixture({},patch),now),null,JSON.stringify(patch));
 const verified=fixture({}, {latitude:30,longitude:-95,coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:at,locationVerifiedAt:at});
 assert.equal(isCurrentFieldPin(verified),true);assert.equal(await checkedAddressEstimate(verified,now),null);
});
test('unsupported, incomplete, ambiguous and future provider evidence fails closed',async()=>{
 for(const patch of [{schemaVersion:2},{provider:'ip_geolocation'},{providerMatchQuality:'Non_Exact'},{benchmark:'unsupported'},{confidence:'gps'},{verified:true},{liveGps:true},{requiresOwnerConfirmation:false},{approvalReference:''},{batchId:''},{appliedByDatabaseRole:''},{latitude:'30'},{longitude:181},{addressSha256:'0'.repeat(64)},{geocodedAt:'invalid'},{geocodedAt:'2026-10-08T00:00:00Z'},{appliedAt:'2026-10-06T00:00:00Z'},{matchedAddress:'100 EXAMPLE RD, OTHER CITY, TX, 77001'},{matchedAddress:'100 EXAMPLE RD, TEST CITY, CA, 77001'},{matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77002'},{matchedAddress:'100 OTHER RD, TEST CITY, TX, 77001'},{matchedAddress:'101 EXAMPLE RD, TEST CITY, TX, 77001'}])assert.equal(await checkedAddressEstimate(fixture(patch),now),null,JSON.stringify(patch));
 for(const note of [addressEstimatePrefix+'{',addressEstimatePrefix+'null',addressEstimatePrefix+'[]',addressEstimatePrefix+'x'.repeat(5000)])assert.equal(await checkedAddressEstimate(fixture({}, {locationNote:note}),now),null);
});
test('older projection can expose the same trusted estimate fields without becoming verified GPS',async()=>{
 const r=fixture({}, {historicalLatitude:null,historicalLongitude:null,historicalCoordinateSource:null,latitude:30,longitude:-95,coordinateSource:addressEstimateSource});
 assert.ok(await checkedAddressEstimate(r,now));assert.equal(isCurrentFieldPin(r),false);
});
test('shared installation addresses retain separate exact unit identities',async()=>{
 const first=await checkedAddressEstimate(fixture(),now);
 const second=await checkedAddressEstimate(fixture({trackerId:'22222222-2222-4222-8222-222222222222',unitNumber:'Sniper 902'},{id:'22222222-2222-4222-8222-222222222222',unitNumber:'Sniper 902'}),now);
 assert.deepEqual(first,second);
});
test('machine provenance does not suppress human warnings; impossible calendar dates are rejected',async()=>{
 assert.equal(addressEstimateHumanNote(fixture().locationNote),'Original human note');
 assert.equal(addressEstimateHumanNote(addressEstimatePrefix+'invalid\nWarning\nSecond line'),'Warning\nSecond line');
 assert.equal(addressEstimateHumanNote('Ordinary warning'),'Ordinary warning');
 assert.equal(await checkedAddressEstimate(fixture({geocodedAt:'2026-02-30T12:00:00Z'}),now),null);
});
