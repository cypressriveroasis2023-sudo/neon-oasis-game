import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {projectImportedSourceAddresses,projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
globalThis.crypto??=webcrypto;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function fixture(kind='equipment_unit'){
 const native=kind==='equipment_unit',unitNumber=native?'Spotter 987654HDC2':'Sniper 987654',unitKey=native?'SPOTTER 987654':'SNIPER 987654',id=randomUUID();
 const source={schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:kind,nativeUnitId:id,productId:'123456',unitNumber,sourceRevision:randomUUID(),eventId:'8',sourceFileSha256:A,sourceRowSha256:B,nativeGuardSha256:C,placement:'SHOP',eligibility:'tombstone',installation:null,addressSha256:null,suppliedComponents:null,siteLabel:'Synthetic Shop',nativeSourceIdentity:null};
 if(native)source.nativeSourceIdentity={contract:'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',trackerId:randomUUID(),trackerUnitNumber:unitNumber,...Object.fromEntries(['nativeUnitId','productId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'].map(k=>[k,source[k]]))};
 const row={id,unitNumber,readOnly:!native,_sourceField:true,status:'field',currentLocationType:'field',site:'Old synthetic site',address:'100 Synthetic St, Testville, TX 77001',customer:'Old synthetic customer',hasUnitGps:false,installedSiteId:null,latitude:null,longitude:null};
 const device={id:9101,unit_key:unitKey,organization:'root',activation_state:'deactivated'};
 const audit={id:'40',unit_key:unitKey,device_ids:['9101'],action:'MOVE_TO_ROOT',created_at:'2026-10-01T12:00:00Z',contract:null,control_id:null,request_id:null,placement:null,site_label:null,street_address:null};
 const identity={identityVersion:1,unitIdentities:native?[{unitId:id,unitNumber,kind:'native_provider',unitKeys:[unitKey],deviceIds:['9101'],proof:A}]:[],identityWarnings:[]};
 return {source,row,snapshot:{items:[row],inventoryItems:[row],summary:{}},devices:[device],audits:[audit],context:{nativeUnits:native?[{id,unit_number:unitNumber,organization_id:ORG}]:[],identity,currentSources:[structuredClone(source)]}};
}
const overlay=f=>projectImportedSourceAddresses(f.snapshot,[f.source],f.audits,f.devices,[],f.context);
const held=async f=>assert.deepEqual((await overlay(f)).inventoryItems,f.snapshot.inventoryItems);
const refresh=f=>f.context.currentSources=[structuredClone(f.source)];

for(const kind of ['equipment_unit','tracker'])test('current '+kind+' SHOP agrees with an unchanged unmarked Root roster without changing identity',async()=>{
 const f=fixture(kind),before=structuredClone(f),result=await overlay(f),row=result.inventoryItems[0];
 assert.equal(result.items.length,0);assert.equal(row.importedPlacement,'SHOP');assert.equal(row.currentLocationType,'shop');assert.equal(row.address,null);assert.equal(row.site,'SHOP / ROOT');assert.equal(row.unitNumber,f.row.unitNumber);assert.equal(row.id,f.row.id);assert.equal(row.readOnly,f.row.readOnly);assert.equal(row.placementSource,null);assert.equal(row.placementAuditId,null);assert.equal(row.nativeSourceIdentity,undefined);assert.deepEqual(f,before);
 const placed=await projectOwnerPlacement(result,f.audits,f.devices,f.context.identity,f.context.nativeUnits);assert.equal(placed.items.length,0);assert.equal(placed.inventoryItems[0].unitNumber,f.row.unitNumber);
 const geocoded=await projectImportedGeocodes(placed,[],f.audits,f.devices,f.context);assert.equal(geocoded.inventoryItems[0].locationImportedGeocode,undefined);
});

test('an older unmarked Field move can precede the latest agreeing Root, while newer Field and ambiguous chronology hold',async()=>{
 for(const kind of ['equipment_unit','tracker']){
  const f=fixture(kind);f.audits.unshift({...f.audits[0],id:'39',action:'MOVE_TO_FIELD',created_at:'2026-09-30T12:00:00Z'});assert.equal((await overlay(f)).inventoryItems[0].importedPlacement,'SHOP');
  f.audits.push({...f.audits[0],id:'41',created_at:'2026-10-02T12:00:00Z'});await held(f);
  f.audits.pop();f.audits[0].created_at='2026-10-02T12:00:00Z';await held(f);
 }
});

test('the initial read without current sources holds; only the final exact source read may agree',async()=>{
 const f=fixture(),context=f.context;f.context={...context,currentSources:undefined};await held(f);f.context=context;assert.equal((await overlay(f)).inventoryItems[0].importedPlacement,'SHOP');
 for(const mutate of [f=>f.context=undefined,f=>f.context.currentSources=[],f=>f.context.currentSources.push(structuredClone(f.source)),f=>f.context.currentSources[0].sourceRevision=randomUUID(),f=>f.context.currentSources[0].eventId='9',f=>f.context.currentSources[0].sourceRowSha256=A,f=>f.context.currentSources[0].sourceFileSha256=B,f=>f.context.currentSources[0].nativeGuardSha256=A,f=>f.context.currentSources[0].productId='999999',f=>f.context.currentSources[0].siteLabel='Changed shop',f=>f.context.currentSources[0].placement='FIELD',f=>f.context.currentSources[0].nativeSourceIdentity.trackerId=randomUUID()]){const f=fixture();mutate(f);await held(f);}
});

test('native registry proof and current provider identity are both mandatory; hardware suffix stripping is never proof',async()=>{
 for(const mutate of [f=>delete f.source.nativeSourceIdentity,f=>f.source.nativeSourceIdentity.trackerUnitNumber='Spotter 987654HDC4',f=>f.source.nativeSourceIdentity.sourceRevision=randomUUID(),f=>f.source.nativeSourceIdentity.trackerId='invalid',f=>f.context.identity.unitIdentities=[],f=>f.context.identity.unitIdentities[0].kind='owner_placement',f=>f.context.identity.unitIdentities[0].unitId=randomUUID(),f=>f.context.identity.unitIdentities[0].unitNumber='Spotter 987654HDC4',f=>f.context.identity.unitIdentities[0].proof='invalid',f=>f.context.identity.unitIdentities[0].deviceIds=['9102'],f=>f.context.identity.unitIdentities[0].unitKeys=['Spotter 987654'],f=>f.context.identity.identityVersion=2]){const f=fixture();mutate(f);refresh(f);await held(f);}
 for(const label of ['Sniper 987654HDC2','987654','Spotter 987654']){const f=fixture('tracker');f.row.unitNumber=f.source.unitNumber=label;if(label!=='Sniper 987654HDC2')f.audits.push({...f.audits[0],id:'41',unit_key:label});refresh(f);await held(f);}
});

test('current complete native membership, unique rows and unique source products must agree',async()=>{
 for(const mutate of [f=>f.context.nativeUnits=[],f=>f.context.nativeUnits.push({...f.context.nativeUnits[0]}),f=>f.context.nativeUnits[0].unit_number='Spotter 987653HDC2',f=>f.context.nativeUnits[0].organization_id=randomUUID(),f=>f.snapshot.inventoryItems.push({...f.row}),f=>f.context.nativeUnits.push({id:randomUUID(),unit_number:'Helios 987650',organization_id:ORG}),f=>f.context.currentSources.push({...f.source,nativeUnitId:randomUUID()})]){const f=fixture();mutate(f);await held(f);}
});

test('replacement, added, missing, duplicated or reactivated devices hold every source kind',async()=>{
 for(const kind of ['equipment_unit','tracker'])for(const mutate of [f=>f.devices[0].id=9102,f=>f.devices=[],f=>f.devices.push({...f.devices[0],id:9102}),f=>f.devices.push({...f.devices[0]}),f=>f.devices[0].activation_state='active',f=>f.devices[0].organization='Another site',f=>f.audits[0].device_ids=['9102'],f=>f.audits[0].device_ids=['9101','9101']]){const f=fixture(kind);mutate(f);await held(f);}
});

test('duplicate spellings, hardware variants and competing same-family inventory cannot become an allowance',async()=>{
 for(const label of ['Spotter 987654','SPOTTER 987654HDC2','SPOTTER 987654HDC4']){const f=fixture();f.devices.push({...f.devices[0],id:9102,unit_key:label});await held(f);}
 for(const label of ['SPOTTER987654HDC2','Spotter 987654HDC4','Spotter 987654']){const f=fixture();f.snapshot.inventoryItems.push({...f.row,id:randomUUID(),readOnly:true,unitNumber:label});await held(f);}
});

test('warnings, competing device claims and cross-family associations hold',async()=>{
 for(const mutate of [f=>f.context.identity.identityWarnings.push({unitId:f.row.id,unitKeys:[],deviceIds:[]}),f=>f.context.identity.identityWarnings.push({unitId:randomUUID(),unitKeys:[],deviceIds:['9101']}),f=>f.context.identity.identityWarnings.push({unitId:randomUUID(),unitKeys:['SPOTTER 987654HDC4'],deviceIds:[]}),f=>f.context.identity.unitIdentities.push({...f.context.identity.unitIdentities[0],unitId:randomUUID()}),f=>f.context.identity.unitIdentities.push({...f.context.identity.unitIdentities[0],unitId:randomUUID(),unitKeys:['SNIPER 111111']}),f=>{f.devices[0].unit_key=f.context.identity.unitIdentities[0].unitKeys[0]='SNIPER 987654';}]){const f=fixture();mutate(f);await held(f);}
 const tracker=fixture('tracker');tracker.context.identity.unitIdentities=[{unitId:randomUUID(),unitNumber:'Sniper 987654',kind:'native_provider',unitKeys:['SNIPER 987654'],deviceIds:['9101'],proof:A}];await held(tracker);
});

test('cross-label device history, duplicate audits, malformed times and marked Owner moves remain holds',async()=>{
 for(const mutate of [f=>f.audits.push({...f.audits[0],id:'41',unit_key:'SNIPER 987654'}),f=>f.audits.push({...f.audits[0]}),f=>f.audits[0].created_at='invalid',f=>f.audits[0].contract='COS_CAMERA_PLACEMENT_V2',f=>f.audits[0].control_id=randomUUID(),f=>f.audits[0].request_id=randomUUID(),f=>f.audits[0].placement='SHOP',f=>f.audits[0].site_label='Owner site',f=>f.audits[0].street_address='Owner address',f=>f.audits[0].action='CHANGE_LABEL']){const f=fixture();mutate(f);await held(f);}
});

test('Owner placement, manual GPS, identity review and installed-site conflict outrank agreement',async()=>{
 for(const kind of ['equipment_unit','tracker'])for(const patch of [{placementSource:'owner'},{placementAuditId:'40'},{placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{hasUnitGps:true},{locationVerification:'owner_verified'},{installedSiteId:randomUUID()}]){const f=fixture(kind);Object.assign(f.row,patch);await held(f);}
});

test('Root history never makes a current FIELD source eligible under this agreement policy',async()=>{
 for(const kind of ['equipment_unit','tracker']){const f=fixture(kind);f.source.placement=f.source.eligibility='FIELD';refresh(f);await held(f);}
});

test('Sniper 301 and Spotter 311 remain separate from Spotter 301 and Sniper 311',async()=>{
 for(const [kind,target,other,key] of [['equipment_unit','Spotter 301HDC4','Sniper 301','SPOTTER 301'],['tracker','Sniper 311','Spotter 311HDC2','SNIPER 311']]){
  const f=fixture(kind);f.source.unitNumber=f.row.unitNumber=target;f.devices[0].unit_key=f.audits[0].unit_key=key;
  if(kind==='equipment_unit'){f.context.nativeUnits[0].unit_number=target;Object.assign(f.source.nativeSourceIdentity,{unitNumber:target,trackerUnitNumber:target});Object.assign(f.context.identity.unitIdentities[0],{unitNumber:target,unitKeys:[key]});}
  const otherRow={...f.row,id:randomUUID(),unitNumber:other,readOnly:true};f.snapshot.inventoryItems.push(otherRow);f.snapshot.items.push(otherRow);f.devices.push({...f.devices[0],id:9102,unit_key:kind==='tracker'?'SPOTTER 311':'SNIPER 301',organization:'Synthetic field',activation_state:'active'});refresh(f);
  const result=await overlay(f);assert.equal(result.inventoryItems[0].importedPlacement,'SHOP');assert.deepEqual(result.inventoryItems[1],otherRow);assert.deepEqual(result.items,[otherRow]);
 }
});

test('new reads revoke a former SHOP allowance when source, roster, identity or history changes',async()=>{
 const clean=fixture();assert.equal((await overlay(clean)).inventoryItems[0].importedPlacement,'SHOP');
 for(const mutate of [f=>f.context.currentSources=[],f=>f.devices[0].id=9102,f=>f.context.identity.unitIdentities=[],f=>f.audits.push({...f.audits[0],id:'41',action:'MOVE_TO_FIELD',created_at:'2026-10-02T12:00:00Z'})]){const f=structuredClone(clean);mutate(f);await held(f);}
});

test('already non-field rows retain their existing presentation',async()=>{
 for(const kind of ['equipment_unit','tracker']){const f=fixture(kind);f.row._sourceField=false;f.row.currentLocationType='shop';f.snapshot.items=[];await held(f);}
});
