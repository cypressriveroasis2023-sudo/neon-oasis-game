import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto,randomUUID} from 'node:crypto';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding,importedLegacyConcern} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {fixture as healthFixture,audit as ownerAudit} from './native-placement-alias-fixtures.mjs';
import {fixture as databaseFixture,seed,install,rpc,ORG} from './fixtures/geocode-sources-database-fixture.mjs';
globalThis.crypto??=webcrypto;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function bind(s){return {...s,nativeSourceIdentity:{contract:'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',trackerId:'55555555-5555-4555-8555-555555555555',trackerUnitNumber:s.unitNumber,...Object.fromEntries(['nativeUnitId','productId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'].map(k=>[k,s[k]]))}};}
async function fixture(placement='FIELD'){
 const f=await healthFixture();
 const source=bind({schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:'equipment_unit',nativeUnitId:f.sources.units[0].id,productId:'12345',unitNumber:f.sources.units[0].unit_number,family:'SPOTTERS',variant:'HDC2',sourceRevision:randomUUID(),sourceFileSha256:A,sourceRowSha256:B,nativeGuardSha256:C,eventId:'1',placement,eligibility:placement==='FIELD'?'FIELD':'tombstone',siteLabel:'Synthetic current customer: site',installation:placement==='FIELD'?{street:'123 Synthetic St',city:'Houston',state:'TX',zip:'77002'}:null,addressSha256:placement==='FIELD'?await addressDigest('123 Synthetic St, Houston, TX 77002'):null,suppliedComponents:placement==='FIELD'?{street:true,city:true,state:true,zip:true}:null});
 const row={id:source.nativeUnitId,unitNumber:source.unitNumber,readOnly:false,_sourceField:true,status:'field',currentLocationType:'field',hasUnitGps:false,installedSiteId:null,address:'1 Historical St, Houston, TX 77001',site:'Historical site',customer:'Historical customer',latitude:null,longitude:null};
 const snapshot={items:[row],inventoryItems:[row],summary:{}};
 return {source,row,snapshot,devices:f.sources.devices,audits:[],context:{nativeUnits:f.sources.units,identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]},currentSources:[source]},health:f};
}
const overlay=f=>projectImportedSourceAddresses(f.snapshot,[f.source],f.audits,f.devices,[],f.context);
async function record(s){return {jobKind:'native_import',binding:await checkedImportedBinding(s),legacyGuardSha256:A,status:'success',verified:false,liveGps:false,provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:29,longitude:-95,matchedAddress:'123 Synthetic St, Houston, TX 77002',geocodedAt:'2026-01-01T00:00:00Z'};}
async function assertHeld(f){assert.deepEqual((await overlay(f)).inventoryItems,[f.row]);}
for(const placement of ['FIELD','SHOP'])test('exact current registry proof permits source-only '+placement+' without inventing health or camera identity',async()=>{
 const f=await fixture(placement),before=structuredClone(f.context);assert.equal(importedLegacyConcern(f.row.unitNumber,[],f.devices),true);
 const map=await overlay(f),row=map.inventoryItems[0];assert.equal(row.importedPlacement,placement);assert.equal(map.items.length,placement==='FIELD'?1:0);assert.equal(row.placementSource,null);assert.equal(row.placementAuditId,null);assert.equal(row.customer,f.source.siteLabel);assert.equal(row.address,placement==='FIELD'?'123 Synthetic St, Houston, TX 77002':null);assert.equal(row.site,placement==='FIELD'?f.source.siteLabel:'SHOP / ROOT');assert.deepEqual(f.context,before);assert.equal(row.nativeSourceIdentity,undefined);assert.equal(row.unitIdentities,undefined);
});
test('a freshly verified native-provider proof remains unchanged by source projection',async()=>{
 const f=await fixture();f.context.identity=await f.health.identity();const before=structuredClone(f.context.identity);const map=await overlay(f);assert.equal(map.inventoryItems[0].importedPlacement,'FIELD');assert.deepEqual(f.context.identity,before);const placed=await projectOwnerPlacement(map,[],f.devices,f.context.identity,f.context.nativeUnits);assert.equal(placed.nativePlacementAliases.length,1);assert.equal(placed.nativePlacementAliases[0].proof,before.unitIdentities[0].proof);
});
test('same allowance projects a bound estimate only with the current registry evidence',async()=>{
 const f=await fixture(),map=await overlay(f),r=await record(f.source);const result=await projectImportedGeocodes(map,[r],[],f.devices,f.context);assert.equal(result.items[0].locationImportedGeocode.latitude,29);
 for(const context of [undefined,{...f.context,currentSources:[]},{...f.context,identity:{identityVersion:1,unitIdentities:[],identityWarnings:[{unitId:f.row.id,deviceIds:[],unitKeys:[],reason:'Revoked'}]}}])assert.equal((await projectImportedGeocodes(map,[r],[],f.devices,context)).items[0].locationImportedGeocode,undefined);
});
test('removed or changed registry identity, revisions and guards cannot authorize either stage',async()=>{
 for(const mutate of [s=>delete s.nativeSourceIdentity,s=>s.nativeSourceIdentity.trackerUnitNumber='Spotter 987654HDC4',s=>s.nativeSourceIdentity.trackerId='invalid',s=>s.nativeSourceIdentity.productId='999',s=>s.nativeSourceIdentity.sourceRevision=randomUUID(),s=>s.sourceRevision=randomUUID(),s=>s.sourceFileSha256=B,s=>s.sourceRowSha256=A,s=>s.nativeGuardSha256=A,s=>s.sourceSystem='untrusted',s=>s.organizationId=randomUUID()]){
  const f=await fixture(),map=await overlay(f),r=await record(f.source);mutate(f.source);await assertHeld(f);assert.equal((await projectImportedGeocodes(map,[r],[],f.devices,f.context)).items[0].locationImportedGeocode,undefined);
 }
});
test('fresh internally consistent source revision uses fresh address and rejects old geocode binding',async()=>{
 const f=await fixture(),map=await overlay(f),r=await record(f.source);f.source=bind({...f.source,sourceRevision:randomUUID(),eventId:'2'});f.context.currentSources=[f.source];assert.equal((await overlay(f)).items[0].importedInstallation.sourceRevision,f.source.sourceRevision);assert.equal((await projectImportedGeocodes(map,[r],[],f.devices,f.context)).items[0].locationImportedGeocode,undefined);
});
test('complete current native inventory and reviewed identity context are mandatory',async()=>{
 for(const mutate of [f=>f.context=undefined,f=>f.context.nativeUnits=[],f=>f.context.nativeUnits.push({...f.context.nativeUnits[0]}),f=>f.context.nativeUnits[0].unit_number='Spotter 987655HDC2',f=>f.context.nativeUnits[0].organization_id=randomUUID(),f=>f.context.nativeUnits.push({id:randomUUID(),unit_number:'Helios 500HDC4',organization_id:ORG}),f=>f.context.identity={identityVersion:2,unitIdentities:[],identityWarnings:[]},f=>f.context.identity.unitIdentities=[{}],f=>f.context.identity.identityWarnings=[{}],f=>f.context.identity.ownerConfirmedUnitIdentities=[]]){const f=await fixture();mutate(f);await assertHeld(f);}
});
test('same typed family/base native variants including the 204 hardware collision remain held',async()=>{
 const f=await fixture();f.source=bind({...f.source,unitNumber:'Spotter 204HDC4S'});f.context.currentSources=[f.source];f.row.unitNumber=f.source.unitNumber;f.context.nativeUnits[0].unit_number=f.source.unitNumber;f.devices[0].unit_key='SPOTTER 204';
 const other={...f.row,id:randomUUID(),unitNumber:'Spotter 204HDC4'};f.snapshot.inventoryItems.push(other);f.context.nativeUnits.push({id:other.id,organization_id:ORG,unit_number:other.unitNumber});assert.equal((await overlay(f)).inventoryItems[0].importedPlacement,undefined);
});
test('two legacy spellings or hardware variants never become a source-only allowance',async()=>{
 for(const label of ['Spotter 987654','SPOTTER 987654HDC4','SPOTTER 987654HDC2']){const f=await fixture();f.devices.push({...f.devices[0],id:9102,unit_key:label});await assertHeld(f);}
});
test('a bare number cannot cross the Solar Spotter and Spotter typed-family boundary',async()=>{
 const f=await fixture();f.source=bind({...f.source,unitNumber:'Solar Spotter 052HDC2'});f.context.currentSources=[f.source];f.row.unitNumber=f.source.unitNumber;f.context.nativeUnits[0].unit_number=f.source.unitNumber;f.devices[0].unit_key='SOLAR SPOTTER 052';f.source.nativeSourceIdentity.trackerUnitNumber='Spotter 052HDC2';await assertHeld(f);
});
test('any related audit retains its hold, including legacy Root, current Owner and cross-label device history',async()=>{
 for(const a of [{id:'40',unit_key:'SPOTTER 987654',action:'MOVE_TO_ROOT',contract:null,device_ids:['9101']},{id:'37',unit_key:'SPOTTER 987654',action:'MOVE_TO_ROOT',device_ids:['9101']},ownerAudit({id:'48'}),{id:'19',unit_key:'UNRELATED 1',action:'CHANGE_LABEL',device_ids:['9101']},{id:'20',unit_key:'SPOTTER 987654',action:'OTHER_AUDIT',device_ids:[]}]){const f=await fixture();f.audits=[a];await assertHeld(f);const clean=await fixture(),map=await overlay(clean);assert.equal((await projectImportedGeocodes(map,[await record(clean.source)],f.audits,clean.devices,clean.context)).items[0].locationImportedGeocode,undefined);}
});
test('identity warnings and verified competing group claims deny the display exception',async()=>{
 for(const mutate of [f=>f.context.identity.identityWarnings.push({unitId:f.row.id,reason:'Changed association',unitKeys:[],deviceIds:[]}),f=>f.context.identity.identityWarnings.push({unitId:randomUUID(),reason:'Cross-device conflict',unitKeys:[],deviceIds:['9101']}),f=>f.context.identity.unitIdentities.push({unitId:randomUUID(),unitNumber:'Another native',kind:'native_provider',proof:A,deviceIds:['9101'],unitKeys:['SPOTTER 987654']}),f=>f.context.identity.unitIdentities.push({unitId:f.row.id,unitNumber:f.row.unitNumber,kind:'native_provider',proof:A,deviceIds:['9102'],unitKeys:['SPOTTER 987654']})]){const f=await fixture();mutate(f);await assertHeld(f);}
});
test('current Owner placement, identity review, manual GPS and installation site still outrank the source',async()=>{
 for(const patch of [{placementSource:'owner',placement:'FIELD'},{placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{hasUnitGps:true},{locationVerification:'owner_verified'},{installedSiteId:randomUUID()}])for(const placement of ['FIELD','SHOP']){const f=await fixture(placement);Object.assign(f.row,patch);await assertHeld(f);}
});
test('map-only registry proof patch is idempotent, guarded and leaves bridge DTO and grants intact',async()=>{
 const db=await databaseFixture();try{
  const record=await seed(db),[source]=await install(db,[record]),args={p_organization_id:ORG,p_identities:[{entityKind:source.entityKind,nativeUnitId:source.nativeUnitId}]};
  // Match production: apply the scoped read-access repair, then deny direct
  // private-schema access. A broad fixture grant must not conceal a role outage.
  await db.exec(readFileSync(new URL('../db/cos-geocode-sources-read-access.sql',import.meta.url),'utf8'));
  await db.exec('revoke usage on schema app_private from service_role');
  const patch=readFileSync(new URL('../db/cos-geocode-sources-native-map-identity.sql',import.meta.url),'utf8');
  const properties="select proowner,prosecdef,proconfig,proacl::text from pg_proc where oid='public.cos_geocode_sources_map_projection(uuid,jsonb)'::regprocedure";
  const before=(await db.query(properties)).rows;assert.equal(before[0].prosecdef,true);assert.deepEqual(before[0].proconfig,['search_path=""']);
  await db.exec(patch);await db.exec(patch);assert.deepEqual((await db.query(properties)).rows,before);
  assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
  const [mapped]=await rpc(db,'map_projection',args);assert.equal(mapped.nativeSourceIdentity.trackerId,record.trackerId);assert.equal(mapped.nativeSourceIdentity.trackerUnitNumber,record.trackerUnitNumber);assert.equal(mapped.nativeSourceIdentity.sourceRevision,source.sourceRevision);assert.equal(source.nativeSourceIdentity,undefined);
  const read=await rpc(db,'read_many',args);assert.equal(read[0].nativeSourceIdentity,undefined);
  for(const role of ['anon','authenticated'])await assert.rejects(rpc(db,'map_projection',args,role),/permission denied/);
  await assert.rejects(rpc(db,'map_projection',{...args,p_organization_id:randomUUID()}),/Source service access required/);
  await assert.rejects(db.query('select public.cos_geocode_sources_map_projection($1,$2)',Object.values(args)),/Source service access required/);
  await db.exec('set role service_role');try{await assert.rejects(db.query('select * from app_private.cos_geocode_sources'),/permission denied for schema app_private/);}finally{await db.exec('reset role');}
  await db.query('update app_private.vision_tracker_locations set unit_number=$1 where id=$2',['HELIOS 100HDC4',record.trackerId]);assert.deepEqual(await rpc(db,'map_projection',args),[]);
 }finally{await db.close();}
});
test('reprojection removes a stale prior estimate when the current source proof or read disappears',async()=>{
 const f=await fixture(),map=await overlay(f),r=await record(f.source),shown=await projectImportedGeocodes(map,[r],[],f.devices,f.context);assert.ok(shown.items[0].locationImportedGeocode);
 for(const [records,context] of [[[],f.context],[[r],undefined],[[r],{...f.context,currentSources:[]}]])assert.equal((await projectImportedGeocodes(shown,records,[],f.devices,context)).items[0].locationImportedGeocode,undefined);
});
