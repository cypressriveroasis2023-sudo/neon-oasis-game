import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {checkedReviewedAddressEstimate,reviewedAddressPairMatches,reviewedApprovalDigest,reviewedApplicationDigest,reviewedEstimateSha256,reviewedLegacyEvidenceSha256,reviewedLegacyConcernKey,projectReviewedAddressEstimates,reviewedEstimatePrefix,reviewedEstimateSource} from '../shared/reviewedAddressEstimates.ts';
import {addressEstimateHumanNote,checkedAddressEstimate,addressEstimateLabel,addressEstimateTimestamp,reviewedDifferenceExplanation} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../src/fieldLocations.ts';
// Synthetic match-key callback. The live pipeline injects its existing placementMatchKey unchanged.
const placementMatchKey=value=>{const m=/^(SPOTTER|RANGER)\s+0*(\d+(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(String(value));return m?'typed:'+m[1].toUpperCase()+'|'+Number(m[2])+(m[3]?'|'+m[3].toUpperCase():''):'full:'+String(value).trim().toUpperCase();};
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const tracker='11111111-1111-4111-8111-111111111111',native='22222222-2222-4222-8222-222222222222',org='33333333-3333-4333-8333-333333333333',epoch='44444444-4444-4444-8444-444444444444';
const now=Date.parse('2026-10-08T02:30:00Z'),at='2026-10-08T01:00:00Z';
const humanNote=' Original human warning.  \n\nKeep every byte. ';
const devices=[{id:9001,unit_key:'SPOTTER 901'}],audits=[];
const categories=[
 ['approved_city_label_equivalence','100 W. Example Road, Original City, TX 77001','100 W Example Rd, Matched City, TX 77001'],
 ['approved_state_route_alias','200 Hwy 999, Test City, TX 77001','200 TX-999, Test City, TX 77001'],
 ['approved_missing_street_suffix','300 Exampleleaf, Test City, TX 77001','300 Exampleleaf Dr, Test City, TX 77001'],
];
function encode(p,note=humanNote){return reviewedEstimatePrefix+JSON.stringify(p)+'\n'+note;}
async function fixture({trackerOnly=false,category=0}={}) {
 const [kind,originalAddress,matchedAddress]=categories[category];
 const legacy=await reviewedLegacyEvidenceSha256('SPOTTER 901',audits,devices,placementMatchKey);
 const revision=await reviewedEstimateSha256(trackerOnly?'':'synthetic native revision');
 const p={schemaVersion:2,organizationId:org,trackerId:tracker,unitNumber:'Spotter 901',source:reviewedEstimateSource,
  originalAddress,originalAddressSha256:await reviewedEstimateSha256(originalAddress.replace(/\s+/g,' ').trim().toLowerCase()),matchedAddress,latitude:30,longitude:-95,
  provider:'geocodio',providerAccuracy:1,providerAccuracyType:'rooftop',providerMatchType:null,providerDataSource:'Synthetic county data',providerResultSha256:'a'.repeat(64),
  confidence:'approximate_property_location',verified:false,liveGps:false,requiresOwnerConfirmation:true,approvalReference:'synthetic-owner-approval',batchId:'synthetic-batch',approvedAt:at,retrievedAt:at,appliedAt:at,appliedByDatabaseRole:'synthetic-role',
  addressMatchReview:{kind,originalAddress,matchedAddress,approvedDifferencesOnly:true},
  binding:{trackerSourceEpoch:epoch,nativeId:trackerOnly?null:native,nativeUnitNumber:trackerOnly?null:'SPOTTER 901',nativeAuditIdsSha256:revision,legacyEvidenceSha256:legacy},
 };
 p.approvalSha256=await reviewedApprovalDigest(p);
 p.applicationSha256=await reviewedApplicationDigest(p);
 const row={id:trackerOnly?tracker:native,unitNumber:trackerOnly?p.unitNumber:'SPOTTER 901',address:originalAddress,status:'field',currentLocationType:trackerOnly?'field':null,readOnly:trackerOnly,
  hasUnitGps:false,installedSiteId:null,locationVerification:'coordinates_unverified',latitude:null,longitude:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:reviewedEstimateSource,
  addressEstimateOrganizationId:org,addressEstimateReviewEpoch:epoch,addressEstimateNativeRevision:revision,addressEstimateLegacyEvidenceSha256:legacy,addressEstimateTrackerId:trackerOnly?null:tracker,addressEstimateUnitNumber:trackerOnly?null:p.unitNumber,locationNote:encode(p)};
 return {row,p,approvals:new Set([p.approvalSha256]),applications:new Set([p.applicationSha256])};
}
const snapshot=row=>({items:[row],inventoryItems:[row],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1}});

test('all three bounded approved differences preserve street number, direction, state and ZIP',async()=>{
 for(let category=0;category<3;category++)for(const trackerOnly of [false,true]){
  const {row,p,approvals,applications}=await fixture({category,trackerOnly});
  const estimate=await checkedReviewedAddressEstimate(row,now,approvals,applications);
  assert.ok(estimate);assert.equal(estimate.confidence,'approximate_property_location');assert.equal(estimate.providerAccuracy,1);assert.equal(estimate.providerMatchType,null);
  assert.equal(isCurrentFieldPin(row),false);assert.equal(row.hasUnitGps,false);
  assert.match(addressEstimateLabel(estimate),/Geocodio/);assert.equal(addressEstimateTimestamp(estimate),at);assert.match(reviewedDifferenceExplanation(estimate),/Reviewed/);
  assert.equal(await checkedAddressEstimate(row,now),null,'Synthetic approvals must never pass the production allowlist');
  const {kind,originalAddress,matchedAddress}=p.addressMatchReview;
  assert.equal(reviewedAddressPairMatches(originalAddress,matchedAddress,kind),true);
  for(const bad of [matchedAddress.replace(/^\d+/, '999'),matchedAddress.replace('TX','OK'),matchedAddress.replace('77001','77002'),matchedAddress.replace('77001','77001-9999'),matchedAddress.replace(/^\d+ /,x=>x+'N ')])assert.equal(reviewedAddressPairMatches(originalAddress,bad,kind),false,bad);
 }
});

test('no category creates a broad fallback for unapproved city/route/suffix pairs',async()=>{
 const {row,p,approvals,applications}=await fixture();
 for(const changed of ['100 W Example Rd, Another City, TX 77001','100 W Other Rd, Matched City, TX 77001','100 E Example Rd, Matched City, TX 77001']){
  const q={...p,matchedAddress:changed,addressMatchReview:{...p.addressMatchReview,matchedAddress:changed}};
  q.approvalSha256=await reviewedApprovalDigest(q);
  assert.equal(await checkedReviewedAddressEstimate({...row,locationNote:encode(q)},now,approvals,applications),null);
 }
 assert.equal(reviewedAddressPairMatches('200 US Hwy 999, Test City, TX 77001',categories[1][2],categories[1][0]),false);
 assert.equal(reviewedAddressPairMatches('300 Exampleleaf Rd, Test City, TX 77001',categories[2][2],categories[2][0]),false);
});

test('every provider, source, approval, point and address mutation fails against fixed approval digest',async()=>{
 const {row,p,approvals,applications}=await fixture();
 const patches=[{benchmark:'Public_AR_Current'},{providerMatchQuality:'Exact'},{schemaVersion:1},{organizationId:tracker},{trackerId:native},{unitNumber:'Spotter 902'},{source:'us_census_address_range_estimate'},
  {provider:'census'},{providerAccuracy:0.9},{providerAccuracyType:'interpolation'},{providerMatchType:'rooftop'},{providerDataSource:'Other provider'},
  {providerResultSha256:'b'.repeat(64)},{confidence:'address_range_interpolation'},{verified:true},{liveGps:true},{requiresOwnerConfirmation:false},
  {approvalReference:'different-approval'},{batchId:'different-batch'},{approvalSha256:'f'.repeat(64)},{approvedAt:'2026-10-08T01:01:00Z'},
  {retrievedAt:'2026-10-08T00:59:00Z'},{latitude:30.000001},{longitude:-95.000001},{latitude:'30'},{longitude:181},{originalAddressSha256:'f'.repeat(64)},
  {originalAddress:p.originalAddress+' '},{matchedAddress:p.matchedAddress+' '},{appliedByDatabaseRole:''},{appliedAt:'2026-02-30T00:00:00Z'},{appliedAt:'2026-10-09T00:00:00Z'},
  {addressMatchReview:{...p.addressMatchReview,approvedDifferencesOnly:false}},{addressMatchReview:{...p.addressMatchReview,kind:'unreviewed'}},
 ];
 for(const patch of patches)assert.equal(await checkedReviewedAddressEstimate({...row,locationNote:encode({...p,...patch})},now,approvals,applications),null,JSON.stringify(patch));
 // Recomputing the approval hash is not authorization.
 const changed={...p,latitude:31};changed.approvalSha256=await reviewedApprovalDigest(changed);
 assert.equal(await checkedReviewedAddressEstimate({...row,historicalLatitude:31,locationNote:encode(changed)},now,approvals,applications),null);
});

test('epoch, native revision, identity, legacy hash, current placement and exact address bind every estimate',async()=>{
 for(const trackerOnly of [false,true]){
  const {row,p,approvals,applications}=await fixture({trackerOnly});
  const patches=[{id:org},{unitNumber:'SPOTTER 902'},{address:row.address+' '},{readOnly:!trackerOnly},{status:'shop'},
   {currentLocationType:'shop'},{currentLocationType:'site'},{currentLocationType:'truck'},{hasUnitGps:true},{installedSiteId:org},
   {locationVerification:'owner_verified'},{locationVerification:'address_changed'},{placementSource:'owner'},{placementAuditId:'100'},
   {placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{locationGeocode:{status:'pending'}},{addressEstimateOrganizationId:tracker},
   {addressEstimateReviewEpoch:org},{addressEstimateNativeRevision:'b'.repeat(64)},{addressEstimateLegacyEvidenceSha256:'b'.repeat(64)},
   {addressEstimateLegacyEvidenceSha256:null},{historicalLatitude:31},{historicalLongitude:-96},{historicalLatitude:[30]},{historicalLongitude:[-95]},{historicalLatitude:'30'},{historicalLatitude:{valueOf:()=>30}},{historicalLongitude:'-95'},{historicalCoordinateSource:'other_source'},
   ...(!trackerOnly?[{addressEstimateTrackerId:null},{addressEstimateUnitNumber:'Spotter 902'}]:[])];
  for(const patch of patches)assert.equal(await checkedReviewedAddressEstimate({...row,...patch},now,approvals,applications),null,JSON.stringify(patch));
  for(const patch of [{trackerSourceEpoch:org},{nativeId:org},{nativeUnitNumber:'SPOTTER 902'},{nativeAuditIdsSha256:'b'.repeat(64)},{legacyEvidenceSha256:'c'.repeat(64)}])assert.equal(await checkedReviewedAddressEstimate({...row,locationNote:encode({...p,binding:{...p.binding,...patch}})},now,approvals,applications),null,JSON.stringify(patch));
 }
});

test('legacy evidence is scoped, order-stable, and rejects Owner/IT/roster/alias changes',async()=>{
 const base=await reviewedLegacyEvidenceSha256('Spotter 901',audits,devices,placementMatchKey);
 assert.ok(base);
 const otherDevice={id:9999,unit_key:'RANGER 999'};
 const audit={id:10,unit_key:'SPOTTER 901',action:'EDIT_IDENTITY',contract:null,device_ids:[9001]};
 assert.notEqual(await reviewedLegacyEvidenceSha256('Spotter 901',[audit],devices,placementMatchKey),base);
 const stable=await reviewedLegacyEvidenceSha256('Spotter 901',[{...audit,id:'11'},audit],devices,placementMatchKey);
 assert.equal(await reviewedLegacyEvidenceSha256('Spotter 901',[audit,{...audit,id:'11'}],[otherDevice,...devices],placementMatchKey),stable);
 assert.equal(await reviewedLegacyEvidenceSha256('Spotter 901',[{...audit,unit_key:'RANGER 999',device_ids:[9999]}],[otherDevice,...devices],placementMatchKey),base);
 for(const changed of [[],[{id:9002,unit_key:'SPOTTER 901'}],[{id:9001,unit_key:'SPOTTER 902'}],[{id:9001,unit_key:'SPOTTER 0901'}],[...devices,{id:9002,unit_key:'SPOTTER 0901'}]])assert.notEqual(await reviewedLegacyEvidenceSha256('Spotter 901',audits,changed,placementMatchKey),base);
 assert.equal(await reviewedLegacyEvidenceSha256('Spotter 901',[{...audit,unit_key:'RANGER 999'}],devices,placementMatchKey),null);
 for(const changed of [[{...audit,device_ids:[null]}],[{...audit,id:null}],[audit,audit]])assert.equal(await reviewedLegacyEvidenceSha256('Spotter 901',changed,devices,placementMatchKey),null);
});

test('backend refreshes evidence itself and suppresses stale estimates without changing notes or verified pins',async()=>{
 const {row,p,approvals,applications}=await fixture();
 const projected=await projectReviewedAddressEstimates(snapshot({...row,addressEstimateLegacyEvidenceSha256:'forged'}),audits,devices,placementMatchKey,now,approvals,applications);
 assert.ok(await checkedReviewedAddressEstimate(projected.items[0],now,approvals,applications));
 assert.equal(projected.items[0].locationNote,row.locationNote);
 const changedAudits=[{id:20,unit_key:'SPOTTER 901',action:'EDIT_CONNECTION',contract:null,device_ids:[9001]}];
 const stale=await projectReviewedAddressEstimates(snapshot(row),changedAudits,devices,placementMatchKey,now,approvals,applications);
 assert.equal(stale.items[0].addressEstimateLegacyEvidenceSha256,null);assert.equal(stale.items[0].historicalLatitude,null);assert.equal(stale.items[0].locationNote,encode(p));
 assert.equal(addressEstimateHumanNote(stale.items[0].locationNote),humanNote);
 const gps={...row,latitude:32,longitude:-96,coordinateSource:'manual',hasUnitGps:true,locationVerification:'owner_verified',gpsRecordedAt:at,locationVerifiedAt:at};
 const kept=(await projectReviewedAddressEstimates(snapshot(gps),changedAudits,devices,placementMatchKey,now,approvals,applications)).items[0];
 assert.equal(kept.latitude,32);assert.equal(kept.longitude,-96);assert.equal(kept.coordinateSource,'manual');assert.equal(isCurrentFieldPin(kept),true);
 const census={...row,locationNote:'COS_ADDRESS_ESTIMATE_V1|legacy marker\nNote',historicalCoordinateSource:'us_census_address_range_estimate'};
 assert.deepEqual((await projectReviewedAddressEstimates(snapshot(census),changedAudits,devices,placementMatchKey,now,approvals,applications)).items[0],census);
});

test('same-address Owner Shop→Field round trip and tracker epoch replay cannot revive old markers',async()=>{
 const {row,approvals,applications}=await fixture();
 const owner={id:20,unit_key:'SPOTTER 901',action:'MOVE_TO_ROOT',contract:'COS_CAMERA_PLACEMENT_V2',device_ids:[9001],created_at:'2026-10-08T01:10:00Z',placement:'SHOP',request_id:org,control_id:epoch};
 const back={...owner,id:21,action:'MOVE_TO_FIELD',placement:'FIELD',site_label:'Synthetic job',street_address:row.address,created_at:'2026-10-08T01:11:00Z'};
 const moved=snapshot({...row,placement:'FIELD',placementSource:'owner',placementAuditId:'21',locationVerification:'address_changed'});
 const result=await projectReviewedAddressEstimates(moved,[owner,back],devices,placementMatchKey,now,approvals,applications);
 assert.equal(result.items[0].address,row.address);assert.equal(await checkedReviewedAddressEstimate(result.items[0],now,approvals,applications),null);assert.equal(result.items[0].historicalLatitude,null);
 const replay=await projectReviewedAddressEstimates(snapshot({...row,addressEstimateReviewEpoch:org}),audits,devices,placementMatchKey,now,approvals,applications);
 assert.equal(await checkedReviewedAddressEstimate(replay.items[0],now,approvals,applications),null);
});

test('native topology create/delete or duplicate/rename round trips invalidate tracker-only and native proofs',async()=>{
 for(const trackerOnly of [true,false]){
  const {row,approvals,applications}=await fixture({trackerOnly});
  assert.ok(await checkedReviewedAddressEstimate(row,now,approvals,applications));
  const afterTopologyAudit=await reviewedEstimateSha256('immutable topology audit IDs include create and delete');
  assert.equal(await checkedReviewedAddressEstimate({...row,addressEstimateNativeRevision:afterTopologyAudit},now,approvals,applications),null);
  assert.equal(await checkedReviewedAddressEstimate({...row,addressEstimateNativeRevision:null},now,approvals,applications),null);
 }
});

test('recomputed binding hashes cannot replay point approval against a newer application',async()=>{
 const {row,p,approvals,applications}=await fixture();
 for(const patch of [{trackerSourceEpoch:org},{nativeAuditIdsSha256:'b'.repeat(64)},{legacyEvidenceSha256:'c'.repeat(64)}]){
  const q={...p,binding:{...p.binding,...patch}};q.applicationSha256=await reviewedApplicationDigest(q);
  const changed={...row,addressEstimateReviewEpoch:q.binding.trackerSourceEpoch,addressEstimateNativeRevision:q.binding.nativeAuditIdsSha256,addressEstimateLegacyEvidenceSha256:q.binding.legacyEvidenceSha256,locationNote:encode(q)};
  assert.equal(await checkedReviewedAddressEstimate(changed,now,approvals,applications),null);
 }
 const missing={...p};delete missing.applicationSha256;assert.equal(await checkedReviewedAddressEstimate({...row,locationNote:encode(missing)},now,approvals,applications),null);
});

test('older unmarked generic-label evidence is a frozen concern baseline, never a placement override',async()=>{
 const {row,p}=await fixture();
 p.unitNumber='Spotter 901HDC2';p.binding.nativeUnitNumber='SPOTTER 901HDC2';
 const old={id:10,unit_key:'SPOTTER 901',action:'MOVE_TO_ROOT',contract:null,device_ids:[9001]};
 p.binding.legacyEvidenceSha256=await reviewedLegacyEvidenceSha256(p.unitNumber,[old],devices,placementMatchKey);
 assert.ok(p.binding.legacyEvidenceSha256);
 p.approvalSha256=await reviewedApprovalDigest(p);p.applicationSha256=await reviewedApplicationDigest(p);
 const approvals=new Set([p.approvalSha256]),applications=new Set([p.applicationSha256]);
 const input={...row,unitNumber:p.binding.nativeUnitNumber,addressEstimateUnitNumber:p.unitNumber,addressEstimateLegacyEvidenceSha256:p.binding.legacyEvidenceSha256,locationNote:encode(p)};
 const baseline=(await projectReviewedAddressEstimates(snapshot(input),[old],devices,placementMatchKey,now,approvals,applications)).items[0];
 assert.ok(await checkedReviewedAddressEstimate(baseline,now,approvals,applications));assert.equal(baseline.currentLocationType,row.currentLocationType);assert.equal(baseline.placementSource,undefined);
 const newer={...old,id:11,action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2'};
 const changed=(await projectReviewedAddressEstimates(snapshot(input),[old,newer],devices,placementMatchKey,now,approvals,applications)).items[0];
 assert.equal(await checkedReviewedAddressEstimate(changed,now,approvals,applications),null);assert.equal(changed.historicalLatitude,null);assert.equal(changed.placementSource,undefined);
 const conflict={...old,id:12,unit_key:'RANGER 901'};
 assert.equal(await reviewedLegacyEvidenceSha256(p.unitNumber,[old,conflict],devices,placementMatchKey),null);
 assert.equal(reviewedLegacyConcernKey('SPOTTER 901HDC2',placementMatchKey),reviewedLegacyConcernKey('SPOTTER 901',placementMatchKey));
 for(const unrelated of ['RANGER 901','SPOTTER 901.2','Unknown 901HDC2'])assert.notEqual(reviewedLegacyConcernKey(unrelated,placementMatchKey),reviewedLegacyConcernKey('SPOTTER 901HDC2',placementMatchKey));
 assert.equal(reviewedLegacyConcernKey('Unknown 901HDC2',placementMatchKey),'full:UNKNOWN 901HDC2');
 const rosterEdit=(await projectReviewedAddressEstimates(snapshot(input),[old],[...devices,{id:9002,unit_key:'SPOTTER 901HD4'}],placementMatchKey,now,approvals,applications)).items[0];
 assert.equal(rosterEdit.addressEstimateLegacyEvidenceSha256,null);
});

test('invalid V2 machine lines never swallow human notes or manufacture GPS times',async()=>{
 assert.equal(addressEstimateHumanNote(reviewedEstimatePrefix+'malformed\n'+humanNote),humanNote);
 const {row,approvals,applications}=await fixture();
 for(const value of [reviewedEstimatePrefix+'{',reviewedEstimatePrefix+'[]',reviewedEstimatePrefix+'null',reviewedEstimatePrefix+'x'.repeat(9000)])assert.equal(await checkedReviewedAddressEstimate({...row,locationNote:value},now,approvals,applications),null);
 const estimate=await checkedReviewedAddressEstimate(row,now,approvals,applications);assert.equal('geocodedAt' in estimate,false);assert.equal('providerMatchQuality' in estimate,false);assert.equal('benchmark' in estimate,false);
 const p=JSON.parse(row.locationNote.split('\n')[0].slice(reviewedEstimatePrefix.length));
 assert.ok(await checkedReviewedAddressEstimate({...row,locationNote:encode({...p,appliedAt:'2026-10-08T01:01:00.123456+00:00'})},now,approvals,applications));
 const source=readFileSync(new URL('../src/FieldMap.tsx',import.meta.url),'utf8');
 assert.match(source,/Provider-normalized address/);assert.match(source,/Original address:/);assert.match(source,/Result retrieved/);
 assert.match(source,/estimates are excluded from nearby distances/);assert.match(source,/document\.createTextNode\(estimate\?addressEstimateLabel/);
});
