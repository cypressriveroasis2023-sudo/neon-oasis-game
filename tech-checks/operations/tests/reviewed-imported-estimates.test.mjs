import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'../../..');
const require=createRequire(path.join(root,'tech-checks/operations/package.json'));
const ts=require('typescript'),cache=new Map(),approvals=new Set(),applications=new Set();
// Load exact production sources. Only the existing V2 test-policy arguments are
// supplied by this isolated loader; neither validator nor production lists change.
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const localRequire=name=>{if(!name.startsWith('.'))return require(name);let p=path.resolve(path.dirname(file),name);if(!existsSync(p))p+='.ts';return load(p);};
 vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(module.exports,localRequire,module);
 if(file.endsWith('/reviewedAddressEstimates.ts')){
  const check=module.exports.checkedReviewedAddressEstimate;
  module.exports.checkedReviewedAddressEstimate=(row,now,a=approvals,b=applications)=>check(row,now,a,b);
 }
 return module.exports;
}
globalThis.crypto??=webcrypto;
const native=path.join(root,'tech-checks/supabase/functions/cos-operations-pages');
const v2=load(path.join(native,'reviewedAddressEstimates.ts'));
const source=load(path.join(native,'importedSourceProjection.ts'));
const placement=load(path.join(native,'placementProjection.ts'));
const ui=load(path.join(root,'tech-checks/operations/src/fieldAddressEstimates.ts'));
const locations=load(path.join(root,'tech-checks/operations/src/fieldLocations.ts'));
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',tracker='11111111-1111-4111-8111-111111111111',unit='22222222-2222-4222-8222-222222222222',epoch='44444444-4444-4444-8444-444444444444';
const at='2026-10-08T01:00:00Z',now=Date.parse('2026-10-08T19:00:00Z'),devices=[{id:9001,unit_key:'SPOTTER 901'}];
const categories=[['approved_city_label_equivalence','100 W. Example Road','Original City','100 W Example Rd, Matched City, TX 77001'],['approved_state_route_alias','200 Hwy 999','Test City','200 TX-999, Test City, TX 77001'],['approved_missing_street_suffix','300 Exampleleaf','Test City','300 Exampleleaf Dr, Test City, TX 77001']];
async function fixture({trackerOnly=false,historical=true,category=0}={}){
 const [kind,street,city,matchedAddress]=categories[category],address=`${street}, ${city}, TX 77001`,label=trackerOnly?'Spotter 901':'SPOTTER 901';
 const legacy=await v2.reviewedLegacyEvidenceSha256(label,[],devices,placement.placementMatchKey),revision=await v2.reviewedEstimateSha256('unchanged synthetic revision');
 const p={schemaVersion:2,organizationId:org,trackerId:tracker,unitNumber:'Spotter 901',source:v2.reviewedEstimateSource,originalAddress:address,originalAddressSha256:await v2.reviewedEstimateSha256(address.toLowerCase()),matchedAddress,latitude:30,longitude:-95,provider:'geocodio',providerAccuracy:1,providerAccuracyType:'rooftop',providerMatchType:null,providerDataSource:'Synthetic county data',providerResultSha256:'a'.repeat(64),confidence:'approximate_property_location',verified:false,liveGps:false,requiresOwnerConfirmation:true,approvalReference:'synthetic-owner-approval',batchId:'synthetic-batch',approvedAt:at,retrievedAt:at,appliedAt:at,appliedByDatabaseRole:'synthetic-role',addressMatchReview:{kind,originalAddress:address,matchedAddress,approvedDifferencesOnly:true},binding:{trackerSourceEpoch:epoch,nativeId:trackerOnly?null:unit,nativeUnitNumber:trackerOnly?null:label,nativeAuditIdsSha256:revision,legacyEvidenceSha256:legacy}};
 p.approvalSha256=await v2.reviewedApprovalDigest(p);p.applicationSha256=await v2.reviewedApplicationDigest(p);approvals.add(p.approvalSha256);applications.add(p.applicationSha256);
 const row={id:trackerOnly?tracker:unit,unitNumber:label,readOnly:trackerOnly,_sourceField:true,address,site:'Old synthetic site',status:'field',currentLocationType:trackerOnly?'field':null,hasUnitGps:false,installedSiteId:null,locationVerification:'coordinates_unverified',latitude:historical?null:30,longitude:historical?null:-95,coordinateSource:historical?null:v2.reviewedEstimateSource,historicalLatitude:historical?30:null,historicalLongitude:historical?-95:null,historicalCoordinateSource:historical?v2.reviewedEstimateSource:null,addressEstimateOrganizationId:org,addressEstimateReviewEpoch:epoch,addressEstimateNativeRevision:revision,addressEstimateLegacyEvidenceSha256:legacy,addressEstimateTrackerId:trackerOnly?null:tracker,addressEstimateUnitNumber:trackerOnly?null:p.unitNumber,locationNote:v2.reviewedEstimatePrefix+JSON.stringify(p)+'\nHuman warning retained.'};
 const binding={schemaVersion:1,organizationId:org,sourceSystem:'mhelpdesk_product_import',entityKind:trackerOnly?'tracker':'equipment_unit',nativeUnitId:row.id,productId:'12345',unitNumber:label,family:'SPOTTER',variant:null,sourceRevision:'55555555-5555-4555-8555-555555555555',sourceFileSha256:'b'.repeat(64),sourceRowSha256:'c'.repeat(64),addressSha256:p.originalAddressSha256,nativeGuardSha256:'d'.repeat(64),installation:{street,city,state:'TX',zip:'77001'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD',eventId:'1'};
 return {row,p,binding,source:{...binding,placement:'FIELD',siteLabel:'Current synthetic site'}};
}
const snapshot=row=>({items:[row],inventoryItems:[row],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1}});
async function composed(f,{provider='us_census_address_range',sources=[f.source],audits=[],previous=[]}={}){
 let map=await source.projectImportedSourceAddresses(snapshot(f.row),sources,audits,devices,previous);
 map=await placement.projectOwnerPlacement(map,audits,devices);
 const binding=map.items[0]?.importedInstallation;
 const result=binding?{binding,jobKind:'native_import',legacyGuardSha256:'e'.repeat(64),status:'success',verified:false,liveGps:false,provider,benchmark:'Public_AR_Current',accuracyType:'range_interpolation',accuracy:1,matchType:null,latitude:31,longitude:-96,matchedAddress:map.items[0].address,geocodedAt:at}:null;
 map=await source.projectImportedGeocodes(map,result?[result]:[],audits,devices);
 map=await v2.projectReviewedAddressEstimates(map,audits,devices,placement.placementMatchKey,now,approvals,applications);
 return map;
}
for(const historical of [true,false])for(const trackerOnly of [true,false])for(let category=0;category<3;category++)test(`same-address V2 wins imported Census and Geocodio: historical=${historical} tracker=${trackerOnly} category=${category}`,async()=>{
 const f=await fixture({historical,trackerOnly,category}),expected=await v2.checkedReviewedAddressEstimate(f.row,now);assert.ok(expected);
 const pending=await source.projectImportedSourceAddresses(snapshot(f.row),[f.source],[],devices);assert.deepEqual(await ui.checkedAddressEstimate(pending.items[0],now),expected,'V2 must remain visible before imported lookup completes');
 for(const provider of ['us_census_address_range','geocodio']){const map=await composed(f,{provider}),row=map.items[0];assert.ok(row);assert.deepEqual(await ui.checkedAddressEstimate(row,now),expected);assert.equal(row.locationNote,f.row.locationNote);assert.equal(row.hasUnitGps,false);assert.equal(locations.isCurrentFieldPin(row),false);assert.equal(row.address,f.row.address);assert.equal(row.currentLocationType,'field');}
});
test('outside imported roster keeps existing reviewed estimates and provenance',async()=>{for(const trackerOnly of [true,false]){const f=await fixture({trackerOnly}),map=await composed(f,{sources:[]});assert.deepEqual(await ui.checkedAddressEstimate(map.items[0],now),await v2.checkedReviewedAddressEstimate(f.row,now));}});
test('changed imported address never keeps old V2 coordinates',async()=>{const f=await fixture();f.source.installation.street='999 Different Road';f.source.addressSha256=await v2.reviewedEstimateSha256('999 Different Road, Original City, TX 77001'.toLowerCase());const row=(await composed(f)).items[0];const estimate=await ui.checkedAddressEstimate(row,now);assert.ok(estimate);assert.notEqual(estimate.source,v2.reviewedEstimateSource);assert.equal(estimate.latitude,31);assert.equal(row.historicalLatitude,null);});
test('stale epochs/native/legacy proof and address_changed never revive V2',async()=>{for(const patch of [{addressEstimateReviewEpoch:unit},{addressEstimateNativeRevision:'f'.repeat(64)},{locationVerification:'address_changed'}]){const f=await fixture();Object.assign(f.row,patch);const row=(await composed(f)).items[0];assert.notEqual((await ui.checkedAddressEstimate(row,now))?.source,v2.reviewedEstimateSource,JSON.stringify(patch));}const f=await fixture(),audits=[{id:77,unit_key:'SPOTTER 901',action:'EDIT_CONNECTION',contract:null,device_ids:[9001]}];assert.notEqual((await ui.checkedAddressEstimate((await composed(f,{audits})).items[0],now))?.source,v2.reviewedEstimateSource);});
test('Owner/manual verified GPS stays authoritative and reviewed estimate is absent',async()=>{for(const patch of [{placement:'FIELD',placementSource:'owner',placementAuditId:'77'},{latitude:33,longitude:-97,coordinateSource:'manual',hasUnitGps:true,locationVerification:'owner_verified',gpsRecordedAt:at,locationVerifiedAt:at}]){const f=await fixture();Object.assign(f.row,patch);const map=await composed(f),row=map.inventoryItems[0];assert.equal(await ui.checkedAddressEstimate(row,now),null);if(patch.hasUnitGps){assert.equal(row.latitude,33);assert.equal(row.longitude,-97);assert.equal(row.coordinateSource,'manual');}}});
test('SHOP and vanished current source never expose reviewed V2 pins',async()=>{const f=await fixture();for(const opts of [{sources:[{...f.source,placement:'SHOP'}]},{sources:[],previous:[f.source]}]){const map=await composed(f,opts);assert.equal(map.items.length,0);assert.equal(await ui.checkedAddressEstimate(map.inventoryItems[0],now),null);}});

test('unapproved sealed digest cannot become a reviewed point through an import',async()=>{const f=await fixture();approvals.delete(f.p.approvalSha256);const row=(await composed(f)).items[0];assert.notEqual((await ui.checkedAddressEstimate(row,now))?.source,v2.reviewedEstimateSource);approvals.add(f.p.approvalSha256);applications.delete(f.p.applicationSha256);const stale=(await composed(f)).items[0];assert.notEqual((await ui.checkedAddressEstimate(stale,now))?.source,v2.reviewedEstimateSource);});
test('valid historical V2 never promotes unrelated direct coordinates or manual provenance',async()=>{
 const f=await fixture({historical:true});Object.assign(f.row,{latitude:35,longitude:-99,coordinateSource:'unverified_legacy_manual'});
 const expected=await v2.checkedReviewedAddressEstimate(f.row,now);assert.ok(expected);
 const row=(await composed(f)).items[0];assert.deepEqual(await ui.checkedAddressEstimate(row,now),expected);assert.equal(row.latitude,null);assert.equal(row.longitude,null);assert.equal(row.coordinateSource,null);assert.equal(row.historicalLatitude,30);assert.equal(row.historicalLongitude,-95);assert.equal(row.historicalCoordinateSource,v2.reviewedEstimateSource);
});

test('reviewed priority cannot bypass malformed or contradictory imported source bindings',async()=>{
 const f=await fixture({historical:false}),expected=await v2.checkedReviewedAddressEstimate(f.row,now);assert.ok(expected);
 for(const absent of [null,undefined])assert.deepEqual(await ui.checkedAddressEstimate({...f.row,importedInstallation:absent},now),expected);
 const map=await source.projectImportedSourceAddresses(snapshot(f.row),[f.source],[],devices),row=map.items[0];assert.deepEqual(await ui.checkedAddressEstimate(row,now),expected);
 const changedAddress={...f.binding,installation:{...f.binding.installation,street:'999 Different Road'},addressSha256:await v2.reviewedEstimateSha256('999 Different Road, Original City, TX 77001'.toLowerCase())};
 for(const patch of [{importedInstallation:{}},{importedInstallation:false},{importedInstallation:0},{importedInstallation:''},{importedInstallation:null},{importedPlacement:'SHOP'},{currentLocationType:'shop'},
  {importedInstallation:{...f.binding,nativeUnitId:tracker}},{importedInstallation:{...f.binding,unitNumber:'SPOTTER 902'}},{importedInstallation:{...f.binding,entityKind:'tracker'}},
  {importedInstallation:{...f.binding,sourceSystem:'untrusted'}},{importedInstallation:{...f.binding,sourceRevision:'stale'}},{importedInstallation:changedAddress}]){
  assert.equal(await ui.checkedAddressEstimate({...row,...patch},now),null,JSON.stringify(patch));
 }
});
