import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRecordedFixture,now,sha} from './fixtures/source-recorded-coordinates-fixture.mjs';
import {checkedSourceRecordedCoordinates,projectSourceRecordedCoordinates} from '../../supabase/functions/cos-operations-pages/sourceRecordedCoordinates.ts';
import {reviewedLegacyEvidenceSha256} from '../../supabase/functions/cos-operations-pages/reviewedAddressEstimates.ts';
import {placementMatchKey} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
const lookup=(row,patch={})=>({jobKind:'native_import',binding:structuredClone(row.importedInstallation),status:'success',verified:false,liveGps:false,legacyGuardSha256:sha('legacy'),provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:31,longitude:-96,matchedAddress:'123 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:'2026-10-08T19:00:00Z',...patch});
async function projected(row,record){return projectSourceRecordedCoordinates({items:[row],inventoryItems:[row]},[record],[],[],now);}
test('exact current accepted estimate withholds distant source point and remains approximate',async()=>{
 const f=await sourceRecordedFixture({imported:true});f.row.locationImportedGeocode=lookup(f.row);const original=structuredClone(f);const result=await projected(f.row,f.record),r=result.items[0];
 assert.equal(r.locationSourceRecorded,undefined);assert.equal(r.locationSourceRecordedConflict.kind,'current_address_disagreement');assert(r.locationSourceRecordedConflict.distanceKm>100);assert.equal(r.locationSourceRecordedConflict.recordedLatitude,30);
 assert.equal(r.locationSourceRecordedConflict.recordedLongitude,-95);assert.equal(r.locationSourceRecordedConflict.coordinateCell,'N19');assert.equal(r.locationSourceRecordedConflict.sourceObservedAt,f.record.sourceObservedAt);assert.equal(r.locationSourceRecordedConflict.coordinateRecordedAt,null);
 const point=await checkedAddressEstimate(r,now);assert.deepEqual([point.latitude,point.longitude,point.confidence],[31,-96,'address_range_interpolation']);assert.equal(r.hasUnitGps,false);assert.deepEqual(f,original);
 assert.equal(await checkedSourceRecordedCoordinates(f.row,now),null,'old backend DTO is also guarded in client validator');
});
test('accepted Geocodio estimates also guard old DTOs while provider quality stays enforced',async()=>{
 for(const [accuracyType,matchType] of [['rooftop','parcel_centroid'],['rooftop','building_centroid'],['range_interpolation',null]]){
  const f=await sourceRecordedFixture({imported:true});f.row.locationImportedGeocode=lookup(f.row,{provider:'geocodio',accuracyType,matchType,accuracy:0.95});
  assert.equal(await checkedSourceRecordedCoordinates(f.row,now),null);assert.equal((await checkedAddressEstimate(f.row,now)).confidence,'automatic_address_estimate');
 }
});
test('the 20 km guard is conservative at its boundary',async()=>{
 for(const [km,withheld] of [[19.999,false],[20.001,true]]){
  const f=await sourceRecordedFixture({imported:true});f.row.locationImportedGeocode=lookup(f.row,{latitude:30+km/6371*180/Math.PI,longitude:-95});
  const r=(await projected(f.row,f.record)).items[0];assert.equal(Boolean(r.locationSourceRecordedConflict),withheld);
 }
});
test('large construction sites and nearby estimates retain unverified source points',async()=>{
 for(const latitude of [30.001,30.01,30.09,30.17]){const f=await sourceRecordedFixture({imported:true});f.row.locationImportedGeocode=lookup(f.row,{latitude,longitude:-95});const r=(await projected(f.row,f.record)).items[0];assert(r.locationSourceRecorded);assert.equal(r.locationSourceRecordedConflict,undefined);assert.equal((await checkedAddressEstimate(r,now)).confidence,'source_recorded_unverified');}
});
test('malformed, stale, wrong-address, unaccepted or lower-quality geocodes cannot suppress source',async()=>{
 const f=await sourceRecordedFixture({imported:true});for(const patch of [{status:'no_match'},{status:'pending'},{latitude:0,longitude:0},{latitude:'31'},{latitude:91},{verified:true},{liveGps:true},{legacyGuardSha256:'bad'},{geocodedAt:'2026-02-30T19:00:00Z'},{geocodedAt:'2100-01-01T00:00:00Z'},{matchedAddress:'124 Example Rd, Test City, TX 77001'},{binding:{...f.row.importedInstallation,sourceRevision:'55555555-5555-4555-8555-555555555555'}},{provider:'geocodio',accuracyType:'city',accuracy:1},{provider:'geocodio',accuracyType:'rooftop',accuracy:0.8}]){const r=(await projected({...f.row,locationImportedGeocode:lookup(f.row,patch)},f.record)).items[0];assert(r.locationSourceRecorded,JSON.stringify(patch));assert.equal(r.locationSourceRecordedConflict,undefined);}
});
test('Owner/manual/GPS and reviewed-property evidence is preserved with no conflict relabeling',async()=>{
 const f=await sourceRecordedFixture({imported:true});for(const patch of [{placementSource:'owner',placementAuditId:'48'},{hasUnitGps:true,locationVerification:'owner_verified',latitude:32,longitude:-97},{historicalCoordinateSource:'geocodio_reviewed_property_estimate',historicalLatitude:32,historicalLongitude:-97}]){const row={...f.row,...patch,locationImportedGeocode:lookup(f.row)},r=(await projected(row,f.record)).items[0];assert.equal(r.locationSourceRecorded,undefined);assert.equal(r.locationSourceRecordedConflict,undefined);for(const[k,v]of Object.entries(patch))assert.deepEqual(r[k],v);}
});
test('two distinct exact installation sources far apart are both held; same address alone is insufficient',async()=>{
 const a=await sourceRecordedFixture(),b=await sourceRecordedFixture();b.row.id=b.record.nativeUnitId=b.record.trackerId='55555555-5555-4555-8555-555555555555';b.record.recordId='66666666-6666-4666-8666-666666666666';b.row.unitNumber=b.record.unitNumber=b.record.trackerUnitNumber='Solar Stand 72 099';b.record.typedIdentity=placementMatchKey(b.row.unitNumber);b.record.productId='7002';b.record.legacyEvidenceSha256=await reviewedLegacyEvidenceSha256(b.row.unitNumber,[],[],placementMatchKey);b.record.latitude=32;
 for(const f of[a,b])Object.assign(f.row,{customer:'Synthetic customer',site:'Synthetic large site'});
 const snapshot={items:[a.row,b.row],inventoryItems:[a.row,b.row]},before=structuredClone(snapshot);const result=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert.equal(result.items.length,2);for(const r of result.items){assert.equal(r.locationSourceRecorded,undefined);assert.equal(r.locationSourceRecordedConflict.kind,'same_installation_disagreement');}assert.deepEqual(snapshot,before);
 b.row.site='Different installation';const separate=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert(separate.items.every(r=>r.locationSourceRecorded));
 b.row.site=a.row.site;b.record.recordId=a.record.recordId;const duplicateRecord=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert(duplicateRecord.items.every(r=>r.locationSourceRecorded));
 b.record.recordId='66666666-6666-4666-8666-666666666666';b.record.sourceRowSha256='invalid';const invalidPeer=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert(invalidPeer.items[0].locationSourceRecorded);assert.equal(invalidPeer.items[0].locationSourceRecordedConflict,undefined);assert.equal(invalidPeer.items[1].locationSourceRecorded,undefined);
 b.record.sourceRowSha256=sha('source-row');b.row.customer='Different customer';const differentCustomer=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert(differentCustomer.items.every(r=>r.locationSourceRecorded));b.row.customer=a.row.customer;
 b.row.site=a.row.site;b.record.latitude=30.01;const nearby=await projectSourceRecordedCoordinates(snapshot,[a.record,b.record],[],[],now);assert(nearby.items.every(r=>r.locationSourceRecorded));
});
test('invalidated source and stale conflict flags clear without hiding the unit',async()=>{
 const f=await sourceRecordedFixture();const row={...f.row,locationSourceRecordedConflict:{kind:'stale',distanceKm:100}};const r=(await projectSourceRecordedCoordinates({items:[row],inventoryItems:[row]},[],[],[],now)).items[0];assert.equal(r.id,row.id);assert.equal(r.locationSourceRecorded,undefined);assert.equal(r.locationSourceRecordedConflict,undefined);
});
