import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedSourceRecordedCoordinates,projectSourceRecordedCoordinates,readSourceRecordedCoordinates} from '../../supabase/functions/cos-operations-pages/sourceRecordedCoordinates.ts';
import {checkedAddressEstimate,addressEstimateLabel} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../src/fieldLocations.ts';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
import {mapReticleMarkup,clusterReticleMarkup} from '../src/fieldMapMarkers.ts';
import {sourceRecordedFixture,now,sha} from './fixtures/source-recorded-coordinates-fixture.mjs';
test('literal tracker coordinates with no house number remain source-recorded, unverified and non-live',async()=>{
 for(const native of [false,true])for(const imported of [false,true]){const f=await sourceRecordedFixture({native,imported});const projected=await projectSourceRecordedCoordinates(f.snapshot,[f.record],[],[],now),row=projected.items[0];const p=await checkedAddressEstimate(row,now);assert.equal(p.confidence,'source_recorded_unverified');assert.equal(p.coordinateRecordedAt,null);assert.equal(addressEstimateLabel(p),'Tracker-recorded coordinates (unverified)');assert.equal(isCurrentFieldPin(row),false);assert.deepEqual([row.latitude,row.longitude,row.coordinateSource],[null,null,null]);assert.equal(projected.summary.mappedUnits,0);assert.equal(fieldCameraHealth(row,[row],null,now).state,'support');}
 assert.match(mapReticleMarkup('Solar Stand 72 098','support','recorded'),/SRC/);assert.match(mapReticleMarkup('Solar Stand 72 098','support','recorded'),/#15a8ff/);assert.match(clusterReticleMarkup({online:0,offline:0,unknown:0,support:2},0,0,2),/>SRC</);
});
test('current address, native identity, source revision, Shop, Owner and manual GPS guard every point',async()=>{
 const f=await sourceRecordedFixture({native:true,imported:true});for(const patch of [{address:'Changed Rd, Test City, TX 77001'},{id:f.record.trackerId},{unitNumber:'Solar Skid 144 098'},{readOnly:true},{status:'shop'},{currentLocationType:'shop'},{placement:'SHOP'},{placement:'UNKNOWN'},{placementSource:'owner'},{placementAuditId:'40'},{placementStatus:'needs_identity_review'},{hasUnitGps:true},{installedSiteId:f.record.trackerId},{locationVerification:'owner_verified'},{locationVerification:'address_changed'},{importedInstallation:{...f.row.importedInstallation,sourceRevision:f.record.trackerId}},{importedPlacement:'SHOP'}])assert.equal(await checkedSourceRecordedCoordinates({...f.row,...patch},now),null,JSON.stringify(patch));
 const empty=await projectSourceRecordedCoordinates(f.snapshot,[],[],[],now);assert.equal(empty.items[0].locationSourceRecorded,undefined);
});
test('duplicates and new legacy Owner/IT/identity histories fail closed without adopting another family',async()=>{
 const f=await sourceRecordedFixture();assert.equal((await projectSourceRecordedCoordinates(f.snapshot,[f.record,f.record],[],[],now)).items[0].locationSourceRecorded,undefined);
 const duplicate={...f.row,id:'55555555-5555-4555-8555-555555555555',unitNumber:'Solar Stand 72 98'};
 const collision=await projectSourceRecordedCoordinates({...f.snapshot,inventoryItems:[f.row,duplicate]},[f.record],[],[],now);assert.equal(collision.items[0].locationSourceRecorded,undefined);
 const unrelated={...duplicate,unitNumber:'Solar Skid 144 098'};assert.ok((await projectSourceRecordedCoordinates({...f.snapshot,inventoryItems:[f.row,unrelated]},[f.record],[],[],now)).items[0].locationSourceRecorded);
 for(const action of ['EDIT_CONNECTION','EDIT_IDENTITY','MOVE_TO_FIELD','MOVE_TO_ROOT']){const audits=[{id:1,unit_key:f.row.unitNumber,action,contract:null,device_ids:[]}];assert.equal((await projectSourceRecordedCoordinates(f.snapshot,[f.record],audits,[],now)).items[0].locationSourceRecorded,undefined);}
});
test('reviewed property markers and manual GPS are never overwritten or reclassified',async()=>{
 const f=await sourceRecordedFixture();for(const patch of [{locationNote:'COS_ADDRESS_ESTIMATE_V2|reviewed-private-marker'},{historicalCoordinateSource:'geocodio_reviewed_property_estimate',historicalLatitude:31,historicalLongitude:-96},{coordinateSource:'geocodio_reviewed_property_estimate',latitude:31,longitude:-96},{coordinateSource:'manual',latitude:32,longitude:-97,hasUnitGps:true,locationVerification:'owner_verified',gpsRecordedAt:'2026-10-08T19:00:00Z',locationVerifiedAt:'2026-10-08T19:00:00Z'}]){const row={...f.row,...patch};const result=(await projectSourceRecordedCoordinates({...f.snapshot,items:[row],inventoryItems:[row]},[f.record],[],[],now)).items[0];assert.equal(result.locationSourceRecorded,undefined);for(const [key,value] of Object.entries(patch))assert.equal(result[key],value);}
});
test('false provider, timestamp, type and cell provenance claims are rejected',async()=>{
 const f=await sourceRecordedFixture();for(const patch of [{source:'geocodio'},{verified:true},{liveGps:true},{coordinateRecordedAt:'2026-10-08T19:00:00Z'},{appliedByDatabaseRole:'owner'},{sourceObservedAt:'2100-01-01T00:00:00Z'},{sourceObservedAt:'2026-02-30T00:00:00Z'},{latitude:'30'},{longitude:181},{family:'Solar Skid 144'},{coordinateCell:'N19?token'},{coordinateCellSha256:'no'},{sourceAddressSha256:sha('other')}])assert.equal(await checkedSourceRecordedCoordinates({...f.row,locationSourceRecorded:{...f.record,...patch}},now),null,JSON.stringify(patch));
});
test('native reads stay bounded and failure never returns a partial stale batch',async()=>{
 const f=await sourceRecordedFixture();const inventory=Array.from({length:251},(_,i)=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0'),readOnly:true}));const calls=[];const result=await readSourceRecordedCoordinates(inventory,async(name,args)=>{calls.push({name,args});return calls.length===1?[{...f.record,nativeUnitId:inventory[0].id}]:[];});assert.equal(result.length,1);assert.deepEqual(calls.map(c=>c.args.p_identities.length),[250,1]);assert.ok(calls.every(c=>c.name==='cos_source_recorded_coordinates_read_many'));assert.deepEqual(await readSourceRecordedCoordinates(inventory,async()=>{throw Error('unavailable')}),[]);assert.deepEqual(await readSourceRecordedCoordinates([inventory[0],inventory[0]],async()=>{throw Error('must not call')}),[]);
});

test('optional malformed/duplicate source DTO cannot take down the map or alter verified points',async()=>{
 const f=await sourceRecordedFixture();const owner={...f.row,placementSource:'owner',hasUnitGps:true,latitude:31,longitude:-96,coordinateSource:'manual',locationVerification:'owner_verified'};
 const snapshot={...f.snapshot,items:[owner],inventoryItems:[owner]};const {locationSourceRecorded:_stale,...unchanged}=owner;
 for(const records of [null,[{}],[f.record,f.record],[{...f.record,nativeUnitId:'invalid'}]]){const result=await projectSourceRecordedCoordinates(snapshot,records,[],[],now);assert.deepEqual(result.items,[unchanged]);assert.deepEqual(result.inventoryItems,[unchanged]);assert.equal(result.summary,snapshot.summary);}
 for(const records of [[{}],[f.record,f.record],[{...f.record,nativeUnitId:'invalid'}]])assert.deepEqual(await readSourceRecordedCoordinates([f.row],async()=>records),[]);
});

test('source timestamps retain valid offset dates across UTC midnight and reject nonexistent calendar days',async()=>{
 const f=await sourceRecordedFixture();
 const record={...f.record,sourceObservedAt:'2026-10-07T23:30:00-05:00',appliedAt:'2026-10-08T01:00:00-05:00'};
 assert.ok(await checkedSourceRecordedCoordinates({...f.row,locationSourceRecorded:record},Date.parse('2026-10-08T20:00:00Z')));
 assert.equal(await checkedSourceRecordedCoordinates({...f.row,locationSourceRecorded:{...record,sourceObservedAt:'2026-02-30T23:30:00-05:00'}},Date.parse('2026-10-08T20:00:00Z')),null);
});
