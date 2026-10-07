import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {locationTag,installationAddressLink,fieldReachability,locationVerificationNote,normalizeLocationAddress,isCurrentFieldPin,historicalFieldCoordinates,parseLocationCoordinates} from '../src/fieldLocations.ts';
import {createGpsSaver} from '../src/gpsPersistence.ts';
const id='11111111-1111-4111-8111-111111111111', historyId='22222222-2222-4222-8222-222222222222';
const stamp='2026-10-06T16:00:00Z';
const unit={id,unitNumber:'FIX 001',status:'field',address:'1 Fixture St, Test City',latitude:null,longitude:null};
if(!globalThis.crypto)globalThis.crypto=webcrypto;
test('address-only records are not GPS and address lookup never uses an unrelated stored pin',()=>{
 assert.equal(locationTag(unit),'ADDRESS ONLY');
 assert.equal(installationAddressLink({...unit,latitude:30,longitude:-95}),'https://www.google.com/maps/search/?api=1&query=1%20Fixture%20St%2C%20Test%20City');
 assert.equal(locationTag({...unit,latitude:30,longitude:-95,coordinateSource:'manual'}),'HISTORICAL PIN');
 assert.equal(locationTag({...unit,latitude:30,longitude:-95,coordinateSource:'2026_tracker_same_address'}),'HISTORICAL PIN');
 assert.equal(locationTag({...unit,locationVerification:'address_changed'}),'ADDRESS CHANGED');
});
test('health requires exactly one saved equipment identity and current observation',()=>{
 const row={match:'exact_name',candidateUnit:{id},checkedAt:stamp,probeStatus:'online'};
 assert.equal(fieldReachability(unit,[row],Date.parse(stamp)+1000),'reachable');
 assert.equal(fieldReachability(unit,[row,row],Date.parse(stamp)+1000),'unknown');
 assert.equal(fieldReachability(unit,[{...row,match:'ambiguous'}],Date.parse(stamp)+1000),'unknown');
 assert.equal(fieldReachability(unit,[row],Date.parse(stamp)+3600000),'stale');
 assert.equal(fieldReachability(unit,[{...row,checkedAt:null}],Date.parse(stamp)),'unknown');
});
test('versioned verification marker hashes only whitespace/case-normalized addresses',async()=>{
 const note=await locationVerificationNote('\t 1 Fixture St,  Test City \n','checked entrance');
 const hash=createHash('sha256').update('1 fixture st, test city').digest('hex');
 assert.equal(note,`COS_FIELD_LOCATION_V1|address_sha256=${hash}|confirmed=true\nchecked entrance`);
 assert.notEqual(normalizeLocationAddress('1 Fixture Street'),normalizeLocationAddress('1 Fixture St'));
 await assert.rejects(locationVerificationNote(' ','note'),/Record the installation address/);
});
test('verification save checks current address projection and newest history, never retries writes',async()=>{
 const note=await locationVerificationNote(unit.address,'checked entrance');
 const input={latitude:30,longitude:-95,accuracyM:null,source:'manual',note};
 for(const problem of ['none','wrong address','newer history','wrong note','bad history id']){
  let writes=0;
  const snapshot={items:[{...unit,...input,hasUnitGps:true,gpsAccuracyM:null,coordinateSource:'manual',gpsRecordedAt:stamp,locationVerification:problem==='wrong address'?'address_changed':'owner_verified',locationVerifiedAt:stamp,locationHistoryId:historyId}],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:stamp};
  const record={...input,id:problem==='bad history id'?'invalid':historyId,recordedAt:problem==='newer history'?'2026-10-06T17:00:00Z':stamp,note:problem==='wrong note'?'ordinary note':note};
  const saver=createGpsSaver({post:async()=>{writes++;return {data:{...input,id,recordedAt:stamp}}},get:async path=>({data:path.endsWith('/history')?{items:[record]}:snapshot})});
  if(problem==='none')await saver.owner(id,input);else{await assert.rejects(saver.owner(id,input),/may have been saved/);await assert.rejects(saver.owner(id,input),/Refresh/);}
  assert.equal(writes,1);
 }
});
test('verification readback fails closed on ties, sub-millisecond newer writes, wrong source and malformed chronology',async()=>{
 const note=await locationVerificationNote(unit.address,'reviewed');
 const at='2026-10-06T16:00:00.000100Z', input={latitude:30,longitude:-95,accuracyM:null,source:'manual',note};
 const saved={...unit,...input,hasUnitGps:true,gpsAccuracyM:null,coordinateSource:'manual',gpsRecordedAt:at,locationVerification:'owner_verified',locationVerifiedAt:at,locationHistoryId:historyId};
 const snapshot={items:[saved],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:at};
 const record={...input,id:historyId,recordedAt:at};
 for(const history of [[record,{...record,id:'33333333-3333-4333-8333-333333333333',note:'ordinary'}],[{...record,recordedAt:'2026-10-06T16:00:00.000900Z'}],[{...record,source:'import'}],[record,{...record,id:'33333333-3333-4333-8333-333333333333',recordedAt:'invalid'}]]){
  let writes=0;const saver=createGpsSaver({post:async()=>{writes++;return {data:{...input,id,recordedAt:at}}},get:async path=>({data:path.endsWith('/history')?{items:history}:snapshot})});
  await assert.rejects(saver.owner(id,input),/may have been saved/);assert.equal(writes,1);assert.equal(saver.needsRefresh,true);
 }
});
test('historical tracker coordinates never become current or nearby merely because their address text matches',()=>{
 const old={...unit,unitNumber:'SYNTHETIC SOLAR SPOTTER 051',latitude:30.11,longitude:-95.22,coordinateSource:'2026_tracker_same_address',sourceVerifiedAt:stamp};
 assert.equal(isCurrentFieldPin(old),false);assert.equal(locationTag(old),'HISTORICAL PIN');
 assert.deepEqual(historicalFieldCoordinates(old),{latitude:30.11,longitude:-95.22,source:'2026_tracker_same_address',recordedAt:null});
 const verified={...old,coordinateSource:'site',gpsRecordedAt:stamp,locationVerifiedAt:stamp,locationVerification:'owner_verified'};
 assert.equal(isCurrentFieldPin(verified),true);assert.equal(locationTag(verified),'VERIFIED ADDRESS PIN');assert.equal(historicalFieldCoordinates(verified),null);
 for(const change of [{address:''},{locationVerifiedAt:null},{locationVerification:'address_changed'},{locationVerifiedAt:'2026-10-06T17:00:00Z'},{latitude:null}]) assert.equal(isCurrentFieldPin({...verified,...change}),false);
});
test('coordinate paste accepts explicit pairs and point queries, not addresses, short links or map camera centers',()=>{
 assert.deepEqual(parseLocationCoordinates(' (29.99, -95.3) '),{latitude:29.99,longitude:-95.3});
 assert.deepEqual(parseLocationCoordinates('https://www.google.com/maps/search/?api=1&query=29.99%2C-95.3'),{latitude:29.99,longitude:-95.3});
 assert.deepEqual(parseLocationCoordinates('https://www.google.com/maps/dir/?api=1&destination=29.99,-95.3'),{latitude:29.99,longitude:-95.3});
 for(const value of ['100 Example Road, Test City, TX 77001','https://www.google.com/maps/@29.99,-95.3,14z','https://www.google.com/maps/search/?api=1&query=100+Example+Road','https://maps.app.goo.gl/abc','https://evil.test/maps?q=29.99,-95.3','https://user:password@www.google.com/maps?q=29.99,-95.3','91,-95','29,181','(29,-95','29,-95)','NaN,-95','https://www.google.com/maps/dir/?query=29,-95&destination=40,-100','https://www.google.com/maps/search/?query=29,-95&query=40,-100','https://www.google.com/maps/search/?query=29,-95&query_place_id=other','https://www.google.com/maps/dir/?destination=29,-95&destination_place_id=other','https://www.google.com/maps/place/Another+Place?query=29,-95','https://www.google.com:8443/maps?q=29,-95'])assert.throws(()=>parseLocationCoordinates(value));
});
