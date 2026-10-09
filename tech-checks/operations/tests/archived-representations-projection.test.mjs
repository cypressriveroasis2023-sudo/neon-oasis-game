import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {checkedArchivedRepresentations,projectArchivedRepresentations,projectArchivedEquipmentRegistry} from '../../supabase/functions/cos-operations-pages/archivedRepresentationProjection.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import {fixture as healthFixture,audit as ownerAudit} from './native-placement-alias-fixtures.mjs';
import {identityDigest,ownerIdentityKey,ownerIdentityTuple,ownerPhysicalIdentityTuple,healthResourceKey,healthSourceUnitKey,verifiedHealthIdentities} from '../../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts';
globalThis.crypto??=webcrypto;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
async function fixture(){
 const h=await healthFixture(),old={id:randomUUID(),unitNumber:'Spotter 987654HDC2',readOnly:false,status:'available',hasUnitGps:false,installedSiteId:null,_sourceField:true,address:'Old address',latitude:null,longitude:null};
 const canonical={...old,id:h.sources.units[0].id,unitNumber:'Spotter 987654HDC4S',address:'123 Synthetic St, Houston, TX 77002'};
 const proof={contract:'COS_ARCHIVED_REPRESENTATION_V1',state:'active',conflictReason:null,organizationId:ORG,id:randomUUID(),revision:randomUUID(),archivedNativeId:old.id,canonicalNativeId:canonical.id,archivedTrackerId:randomUUID(),canonicalTrackerId:randomUUID(),archivedUnitNumber:old.unitNumber,canonicalUnitNumber:canonical.unitNumber,reviewSha256:A,evidenceSha256:B,beforeSha256:C,provenance:'postgres_admin_reviewed_source_archive',recordedByDatabaseRole:'postgres'};
 const source={schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:canonical.id,productId:'12345',unitNumber:canonical.unitNumber,family:'SPOTTERS',variant:'HDC4S',sourceRevision:randomUUID(),sourceFileSha256:A,sourceRowSha256:B,nativeGuardSha256:C,eventId:'1',placement:'FIELD',eligibility:'FIELD',siteLabel:'Synthetic current customer',installation:{street:'123 Synthetic St',city:'Houston',state:'TX',zip:'77002'},addressSha256:await addressDigest(canonical.address),suppliedComponents:{street:true,city:true,state:true,zip:true}};
 source.nativeSourceIdentity={contract:'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',trackerId:proof.canonicalTrackerId,trackerUnitNumber:canonical.unitNumber,...Object.fromEntries(['nativeUnitId','productId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'].map(k=>[k,source[k]]))};
 const snapshot={items:[old,canonical],inventoryItems:[old,canonical],summary:{fieldUnits:2}},devices=h.sources.devices,audits=[];
 const context={nativeUnits:[old,canonical].map(r=>({id:r.id,organization_id:ORG,unit_number:r.unitNumber,status:r.status})),identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]},archivedRepresentations:[proof],currentSources:[source]};
 return {old,canonical,proof,source,snapshot,devices,audits,context};
}
const overlay=f=>projectImportedSourceAddresses(f.snapshot,[f.source],f.audits,f.devices,[],f.context);
const accepted=f=>checkedArchivedRepresentations(f.snapshot.inventoryItems,[f.proof],f.audits,f.devices,f.context);
const project=f=>projectArchivedRepresentations(f.snapshot,[f.proof],f.audits,f.devices,f.context);
test('exact archive proof discounts only its archived competitor after full roster verification',async()=>{
 const f=await fixture(),before=structuredClone(f);assert.equal(accepted(f).length,1);
 assert.equal((await projectImportedSourceAddresses(f.snapshot,[f.source],[],f.devices,[],{...f.context,archivedRepresentations:[]})).inventoryItems[1].importedPlacement,undefined);
 const sourceMap=await overlay(f);assert.equal(sourceMap.inventoryItems.length,2);assert.equal(sourceMap.inventoryItems[1].importedPlacement,'FIELD');
 const placed=await projectOwnerPlacement(sourceMap,[],f.devices,f.context.identity,f.context.nativeUnits);
 const final=projectArchivedRepresentations(placed,[f.proof],[],f.devices,f.context);assert.deepEqual(final.inventoryItems.map(r=>r.id),[f.canonical.id]);assert.deepEqual(final.items.map(r=>r.id),[f.canonical.id]);assert.equal(final.items[0].address,f.canonical.address);assert.deepEqual(f,before);
});
test('canonical coordinates, address, health and identity proofs survive filtering byte for byte',async()=>{
 const f=await fixture();Object.assign(f.canonical,{latitude:29.99,longitude:-95.33,coordinateSource:'geocodio_reviewed_property_estimate',health:'online',unitIdentities:[{privateFixture:'untouched'}]});
 const before=structuredClone(f.canonical),identity=structuredClone(f.context.identity);const result=project(f);assert.deepEqual(result.items,[before]);assert.deepEqual(result.inventoryItems,[before]);assert.deepEqual(f.context.identity,identity);assert.equal(result.summary.mappedUnits,1);
 const registry=projectArchivedEquipmentRegistry({items:[f.old,f.canonical],trackerUnits:[{id:f.proof.archivedTrackerId,unitNumber:f.old.unitNumber,readOnly:true},{id:f.proof.canonicalTrackerId,unitNumber:f.canonical.unitNumber,readOnly:true}]},[f.proof],[],f.devices,f.context);assert.deepEqual(registry.items,[before]);assert.equal(registry.trackerUnits.length,1);assert.equal(registry.trackerUnits[0].id,f.proof.canonicalTrackerId);
});
test('stale proof, wrong family, missing full roster, new GPS and Owner authority restore archived visibility',async()=>{
 for(const mutate of [f=>f.context.nativeUnits.pop(),f=>f.context.nativeUnits.push({...f.context.nativeUnits[0]}),f=>f.proof.canonicalUnitNumber='Solar Spotter 987654HDC4S',f=>f.proof.beforeSha256='bad',f=>f.proof.provenance='owner_confirmation',f=>f.context.previousArchivedRepresentations=[],f=>f.context.previousArchivedRepresentations=[{...f.proof,revision:randomUUID()}],f=>f.old.hasUnitGps=true,f=>f.old.locationHistoryId=randomUUID(),f=>f.old.installedSiteId=randomUUID(),f=>f.old.placementSource='owner',f=>f.audits.push({id:'999',unit_key:'SPOTTER 987654',device_ids:[],contract:'COS_CAMERA_PLACEMENT_V2'}),f=>f.audits.push({id:'999',unit_key:'UNRELATED',device_ids:[f.devices[0].id]}),f=>f.devices[0].unit_key=f.old.unitNumber,f=>f.context.identity.identityWarnings.push({unitId:f.old.id,unitKeys:[],deviceIds:[]}),f=>f.context.identity.ownerConfirmedIdentityVersion=1]){
  const f=await fixture();mutate(f);assert.equal(accepted(f).length,0);assert.equal(project(f).inventoryItems.length,2);assert.equal((await overlay(f)).inventoryItems[1].importedPlacement,undefined);
 }
});
test('other competitors, decimal labels, cycles and shared targets never inherit the exception',async()=>{
 const f=await fixture();const extra={...f.old,id:randomUUID(),unitNumber:'Spotter 987654HDC4'};f.snapshot.inventoryItems.push(extra);f.context.nativeUnits.push({id:extra.id,organization_id:ORG,unit_number:extra.unitNumber});assert.equal((await overlay(f)).inventoryItems[1].importedPlacement,undefined);
 for(const extraProof of [{...f.proof,id:randomUUID()},{...f.proof,id:randomUUID(),archivedNativeId:f.proof.canonicalNativeId,canonicalNativeId:f.proof.archivedNativeId},{...f.proof,id:randomUUID(),archivedNativeId:randomUUID(),archivedTrackerId:randomUUID()}])assert.equal(checkedArchivedRepresentations(f.snapshot.inventoryItems,[f.proof,extraProof],[],f.devices,f.context).length,0);
 const decimal=await fixture();decimal.proof.archivedUnitNumber='Spotter 987654.1HDC2';assert.equal(accepted(decimal).length,0);
});
test('source-only geocode needs current source and both unchanged archive reads',async()=>{
 const f=await fixture(),map=await overlay(f),record={jobKind:'native_import',binding:await checkedImportedBinding(f.source),legacyGuardSha256:A,status:'success',verified:false,liveGps:false,provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:29,longitude:-95,matchedAddress:f.canonical.address,geocodedAt:'2026-01-01T00:00:00Z'};
 const result=await projectImportedGeocodes(map,[record],[],f.devices,{...f.context,previousArchivedRepresentations:[f.proof]});assert.equal(result.items.find(r=>r.id===f.canonical.id).locationImportedGeocode.latitude,29);
 for(const context of [{...f.context,archivedRepresentations:[]},{...f.context,previousArchivedRepresentations:[]},{...f.context,currentSources:[]}])assert.equal((await projectImportedGeocodes(result,[record],[],f.devices,context)).items.find(r=>r.id===f.canonical.id).locationImportedGeocode,undefined);
});
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
async function route(f,{path='/api/field-map',changeArchive=false,ownerAppears=false}={}){
 let archiveReads=0,snapshotReads=0,auditReads=0;const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'fixture-native-service',fetch:async(url,init={})=>{
  if(url.includes('/auth/v1/user'))return response({id:owner});
  if(url.includes('/rest/v1/profiles?'))return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(url.includes('/rest/v1/user_profiles?'))return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(url.includes('/rest/v1/user_roles?'))return response([{roles:{code:'owner',organization_id:ORG}}]);
  if(url.includes('/rest/v1/camera_devices?'))return response(f.devices);
  if(url.includes('/rest/v1/equipment_units?'))return response(f.context.nativeUnits);
  if(url.includes('/rest/v1/vision_vigilant_unit_matches?')||url.includes('/rest/v1/vision_vigilant_devices?'))return response([]);
  const name=url.split('/rest/v1/rpc/')[1];
  if(name==='appdeploy_field_map_snapshot'){snapshotReads++;return response(f.snapshot);}
  if(name==='appdeploy_equipment_registry_snapshot')return response({items:[f.old,f.canonical],trackerUnits:[]});
  if(name==='cos_archived_representation_projection'){archiveReads++;return response(changeArchive&&archiveReads>1?[]:[f.proof]);}
  if(name==='cos_geocode_sources_map_projection')return response([f.source]);
  if(name==='cos_owner_identity_snapshot')return response({revision:A,nativeEpochs:[],claims:[]});
  if(name==='cos_fleet_placement_evidence_v1'){auditReads++;return response(ownerAppears&&auditReads>1?[{id:'999',unit_key:'SPOTTER 987654',device_ids:[],action:'MOVE_TO_ROOT'}]:[]);}
  if(['cos_imported_geocode_read_many','cos_field_geocode_read_many','cos_field_geocode_fallback_read_many','cos_source_recorded_coordinates_read_many'].includes(name))return response([]);
  throw Error('Unexpected synthetic request '+name);
 }});
 const result=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method:'GET',body:null})}));assert.equal(result.status,200,await result.clone().text());return {map:await result.json(),archiveReads,snapshotReads};
}
test('composed Field Map route rereads archive proof, verifies full identity roster, filters only at final presentation',async()=>{
 const f=await fixture(),before=structuredClone(f),result=await route(f);assert.equal(result.archiveReads,2);assert.equal(result.snapshotReads,2);assert.deepEqual(result.map.inventoryItems.map(r=>r.id),[f.canonical.id]);assert.equal(result.map.items[0].address,f.canonical.address);assert.deepEqual(f,before);
});
test('composed Field Map restores both records if archive or Owner authority changes during lookup',async()=>{
 for(const options of [{changeArchive:true},{ownerAppears:true}]){const f=await fixture(),{map}=await route(f,options);assert.equal(map.inventoryItems.length,2);assert.equal(map.representationProjection.conflicts.length,1);assert.equal(map.items.length,0);assert.equal(map.inventoryItems.find(r=>r.id===f.canonical.id).importedPlacement,undefined);}
});
test('composed active equipment registry applies the same bounded presentation proof',async()=>{
 const f=await fixture(),{map,archiveReads}=await route(f,{path:'/api/equipment'});assert.equal(archiveReads,2);assert.deepEqual(map.items.map(r=>r.id),[f.canonical.id]);
});

test('canonical operational changes and a verified Owner move retain one representation',async()=>{
 const f=await fixture();Object.assign(f.canonical,{status:'installed',hasUnitGps:true,latitude:30,longitude:-95,address:'456 New Authorized St',currentLocationType:'field',placementSource:'owner',placement:'FIELD'});
 f.context.identity.unitIdentities=[{unitId:f.canonical.id,unitNumber:f.canonical.unitNumber,kind:'native_provider',proof:A,deviceIds:f.devices.map(d=>String(d.id)),unitKeys:[f.devices[0].unit_key]}];
 f.audits=[{id:'999',unit_key:f.devices[0].unit_key,device_ids:f.devices.map(d=>d.id),contract:'COS_CAMERA_PLACEMENT_V2',action:'MOVE_TO_FIELD'}];
 assert.equal(accepted(f).length,1);const final=project(f);assert.equal(final.items.length,1);assert.deepEqual(final.items[0],f.canonical);assert.equal(final.items[0].address,'456 New Authorized St');assert.equal(final.items[0].latitude,30);assert.equal(final.representationProjection.conflicts.length,0);
});
test('database identity conflict is visible and cannot silently recreate duplicate map pins',async()=>{
 const f=await fixture();f.proof.state='conflict';f.proof.conflictReason='archived_or_canonical_identity_changed';const final=project(f);
 assert.equal(final.items.length,0);assert.equal(final.inventoryItems.length,2);assert.ok(final.inventoryItems.every(r=>r.representationStatus==='conflict'&&r.placementStatus==='needs_identity_review'));
 assert.equal(final.placementReviews.length,1);assert.match(final.placementReviews[0].reason,/map pins are held/);
 const registry=projectArchivedEquipmentRegistry({items:[f.old,f.canonical],trackerUnits:[]},[f.proof],[],f.devices,f.context);assert.equal(registry.items.length,2);assert.equal(registry.items[0].status,f.old.status);assert.equal(registry.items[0].currentLocationType,f.old.currentLocationType);assert.equal(registry.items[0].representationStatus,'conflict');
});

async function movedVerifiedBundle(reviewOwner=false){
 const f=await fixture(),h=await healthFixture(f.canonical.unitNumber),a=ownerAudit();h.sources.units.push(f.context.nativeUnits[0]);h.sources.audits=[a];
 if(reviewOwner){h.review.owner.add(await identityDigest(ownerIdentityTuple(a)));
 h.review.ownerResources[await ownerIdentityKey(a.control_id)]={deviceIds:await Promise.all(a.device_ids.map(healthResourceKey)),unitKeys:[await healthSourceUnitKey(a.unit_key)]};
 h.review.ownerPhysical[await ownerIdentityKey(a.control_id)]=await identityDigest(ownerPhysicalIdentityTuple(a,h.sources.devices));
 }
 f.context.identity=await verifiedHealthIdentities(h.sources,h.review);f.context.nativeUnits=h.sources.units;f.audits=h.sources.audits;f.devices=h.sources.devices;
 return f;
}
test('actual verified bundle keeps an authorized canonical Owner move singular without changing health identity',async()=>{
 const f=await movedVerifiedBundle(),before=structuredClone(f.context.identity);assert.deepEqual(before.unitIdentities.map(p=>p.kind),['native_provider']);assert.equal(before.identityWarnings.length,0);
 assert.equal(accepted(f).length,1);const moved=await projectOwnerPlacement(f.snapshot,f.audits,f.devices,f.context.identity,f.context.nativeUnits);
 const final=projectArchivedRepresentations(moved,[f.proof],f.audits,f.devices,f.context);assert.equal(final.items.length,1);assert.equal(final.items[0].id,f.canonical.id);assert.equal(final.items[0].address,f.audits[0].street_address);assert.equal(final.items[0].placementSource,'owner');assert.deepEqual(f.context.identity,before);
});
test('actual overlapping native and Owner health claims remain held by the unchanged health verifier',async()=>{
 const f=await movedVerifiedBundle(true),before=structuredClone(f.context.identity);assert.equal(before.unitIdentities.length,0);assert.equal(before.identityWarnings.length,2);assert.ok(before.identityWarnings.every(w=>w.reason==='Health resources have more than one equipment identity.'));
 assert.equal(accepted(f).length,0);const moved=await projectOwnerPlacement(f.snapshot,f.audits,f.devices,f.context.identity,f.context.nativeUnits);const final=projectArchivedRepresentations(moved,[f.proof],f.audits,f.devices,f.context);assert.equal(final.items.length,0);assert.equal(final.representationProjection.conflicts.length,1);assert.deepEqual(f.context.identity,before);
});
test('wrong resource IDs, stale proof, wrong audit and reassignment stay explicit conflicts',async()=>{
 for(const mutate of [f=>f.context.identity.unitIdentities[0].deviceIds=['999'],f=>f.context.identity.unitIdentities[0].unitId=randomUUID(),f=>f.context.identity.unitIdentities[0].unitNumber='Changed native',f=>f.audits[0].unit_key=f.old.unitNumber,f=>f.audits[0].device_ids=['999'],f=>f.context.previousArchivedRepresentations=[{...f.proof,revision:randomUUID()}]]){
  const f=await movedVerifiedBundle();mutate(f);assert.equal(accepted(f).length,0);const final=project(f);assert.equal(final.items.length,0);assert.equal(final.representationProjection.conflicts.length,1);
 }
});
