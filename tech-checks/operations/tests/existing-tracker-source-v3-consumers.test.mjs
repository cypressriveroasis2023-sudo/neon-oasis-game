import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {createGeocodeSourcesHandler,sourceDto} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {checkedImportedSource,createSourceReader,sourceIdentity} from '../../supabase/functions/camera-field-geocode/importedSources.ts';
import {processImportedGeocodes} from '../../supabase/functions/camera-field-geocode/importedGeocodeSweep.ts';
import {checkedImportedBinding,projectImportedSourceAddresses,projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {addressDigest} from '../../supabase/functions/cos-operations-pages/censusAddress.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
globalThis.crypto??=webcrypto;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const proofFields=['sourceSystem','sourceRecordId','nativeUnitId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'];
function withProof(source,trackerId=randomUUID()){
 return {...source,nativeSourceIdentity:{contract:'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V3',trackerId,trackerUnitNumber:source.unitNumber,...Object.fromEntries(proofFields.map(k=>[k,source[k]]))}};
}
async function fixture(placement='FIELD',full='Helios|001HDC4'){
 const [family,number]=full.split('|'),source=withProof({schemaVersion:3,organizationId:ORG,sourceSystem:'google_sheet_tracker',entityKind:'equipment_unit',nativeUnitId:randomUUID(),sourceRecordId:'google_sheet:synthetic_sheet_123:12:'+full,sourceRevision:randomUUID(),eventId:'1',unitNumber:family+' '+number,family,variant:null,sourceFileSha256:A,sourceRowSha256:B,nativeGuardSha256:C,placement,eligibility:placement==='FIELD'?'FIELD':'tombstone',siteLabel:'Synthetic site',customerLabel:'Synthetic customer',installation:placement==='FIELD'?{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'}:null,suppliedComponents:placement==='FIELD'?{street:true,city:true,state:true,zip:true}:null,addressSha256:placement==='FIELD'?await addressDigest('123 Main St, Houston, TX 77002'):null});
 const row={id:source.nativeUnitId,unitNumber:source.unitNumber,readOnly:false,_sourceField:true,status:'field',currentLocationType:'field',recordSource:'Native equipment registry',source:'native',nativeIdentity:{kind:'equipment_unit',id:source.nativeUnitId},hasUnitGps:false,installedSiteId:null,latitude:null,longitude:null,address:'100 Historical Rd, Houston, TX 77001',site:'Historical site',customer:'Historical customer'};
 return {source,row,snapshot:{items:[row],inventoryItems:[row],summary:{}},audits:[],devices:[],context:{nativeUnits:[{id:row.id,unit_number:row.unitNumber,organization_id:ORG}],identity:{identityVersion:1,unitIdentities:[],identityWarnings:[]},currentSources:[structuredClone(source)]}};
}
const overlay=f=>projectImportedSourceAddresses(f.snapshot,[f.source],f.audits,f.devices,[],f.context);
const refresh=f=>f.context.currentSources=[structuredClone(f.source)];
const held=async f=>assert.deepEqual((await overlay(f)).inventoryItems,[f.row]);
const estimate=async source=>({jobKind:'native_import',binding:await checkedImportedBinding(source),legacyGuardSha256:C,status:'success',verified:false,liveGps:false,provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:29,longitude:-95,matchedAddress:'123 Main St, Houston, TX 77002',geocodedAt:'2026-01-01T00:00:00Z'});

test('SQL-shaped V3 binding traverses the bounded bridge and both readers without map-only or private data',async()=>{
 const f=await fixture(),expected=await checkedImportedBinding(f.source),calls=[];
 const bridge=createGeocodeSourcesHandler({readKey:A,rpc:async(name,args)=>{calls.push({name,args});return {sources:[{...f.source,private:'MUST NOT CROSS',sourceProvenance:{sourceRange:'A1:L1'}}]};}});
 const reader=createSourceReader(A,async(url,init)=>{assert.ok(new TextEncoder().encode(init.body).length<=32768);return bridge(new Request(url,init));});
 const [binding]=await reader.currentMany([sourceIdentity(f.source)]);
 assert.deepEqual(binding,expected);assert.deepEqual(sourceDto(f.source),expected);assert.equal(binding.schemaVersion,3);
 assert.equal(binding.entityKind,'equipment_unit');assert.equal(binding.productId,undefined);assert.equal(binding.nativeSourceIdentity,undefined);assert.equal(binding.sourceProvenance,undefined);assert.equal(binding.private,undefined);
 assert.deepEqual(calls[0].args.p_sources,[sourceIdentity(f.source)]);
});

for(const full of ['Helios|001HDC4','Spotter|204HDC4S','Solar Spotter|204HDC4S','Sniper 4|0001.20HDC2'])test('V3 preserves the complete typed label '+full,async()=>{
 const f=await fixture('FIELD',full),source=await checkedImportedSource(sourceDto(f.source));assert.equal(source.unitNumber,full.replace('|',' '));assert.ok(await checkedImportedBinding(source));
 const map=await overlay(f),row=map.items[0];assert.equal(row.id,f.row.id);assert.equal(row.unitNumber,f.row.unitNumber);assert.equal(row.readOnly,false);assert.equal(row.source,'native');assert.deepEqual(row.nativeIdentity,f.row.nativeIdentity);assert.equal(row.recordSource,'Native equipment registry');assert.equal(row.addressSource,'Tracker imported installation address');assert.equal(row.nativeSourceIdentity,undefined);
 const result=await projectImportedGeocodes(map,[await estimate(f.source)],[],[],f.context);assert.ok(await checkedAddressEstimate(result.items[0]));assert.equal(result.items[0].hasUnitGps,false);assert.equal(result.items[0].latitude,null);assert.equal(result.items[0].longitude,null);assert.equal(result.items[0].placementAuditId,null);
});

test('V3 rejects version/entity/system/product confusion and every full-label mismatch',async()=>{
 const f=await fixture();
 for(const patch of [{schemaVersion:2},{entityKind:'tracker'},{sourceSystem:'mhelpdesk_product_import'},{productId:'42'},{productId:null},{sourceRecordId:'123'},{sourceRecordId:f.source.sourceRecordId.replace('|001','|1')},{sourceRecordId:f.source.sourceRecordId.replace('Helios|','Spotter|')},{unitNumber:'Helios 1HDC4'},{unitNumber:'Helios 001HDC4S'},{unitNumber:'Helios 001HDC2'},{unitNumber:'HELIOS 001HDC4'},{family:'HELIOS'},{variant:'HDC4'}]){
  const bad={...f.source,...patch};assert.equal(await checkedImportedSource(bad),null);assert.equal(await checkedImportedBinding(bad),null);assert.throws(()=>sourceDto(bad));
 }
});

test('all V3 map sources require exact current native/tracker registry proof even without legacy cameras',async()=>{
 for(const change of [s=>delete s.nativeSourceIdentity,s=>s.nativeSourceIdentity.contract='COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',s=>s.nativeSourceIdentity.productId='42',s=>s.nativeSourceIdentity.sourceSystem='mhelpdesk_product_import',s=>s.nativeSourceIdentity.sourceRecordId+='x',s=>s.nativeSourceIdentity.nativeUnitId=randomUUID(),s=>s.nativeSourceIdentity.trackerId='bad',s=>s.nativeSourceIdentity.trackerUnitNumber='Helios 1HDC4',s=>s.nativeSourceIdentity.trackerUnitNumber='Helios 001HDC4S',s=>s.nativeSourceIdentity.trackerUnitNumber='Spotter 001HDC4',s=>s.nativeSourceIdentity.sourceRevision=randomUUID(),s=>s.nativeSourceIdentity.sourceFileSha256=B,s=>s.nativeSourceIdentity.sourceRowSha256=A,s=>s.nativeSourceIdentity.nativeGuardSha256=A]){
  for(const placement of ['FIELD','SHOP']){const f=await fixture(placement);change(f.source);refresh(f);await held(f);}
 }
});

test('a fresh exact V3 source is required again before presenting a saved estimate',async()=>{
 const f=await fixture(),map=await overlay(f),record=await estimate(f.source);
 for(const context of [undefined,{...f.context,currentSources:[]},{...f.context,currentSources:[withProof({...f.source,sourceRevision:randomUUID()})]},{...f.context,currentSources:[{...f.source,nativeSourceIdentity:undefined}]}])assert.equal((await projectImportedGeocodes(map,[record],[],[],context)).items[0].locationImportedGeocode,undefined);
 const stale=await projectImportedGeocodes(map,[record],[],[],f.context);assert.ok(stale.items[0].locationImportedGeocode);
 assert.equal((await projectImportedGeocodes(stale,[],[],[],f.context)).items[0].locationImportedGeocode,undefined);
});

test('unsupported source versions and estimates are skipped before duplicate or malformed identity checks',async()=>{
 const f=await fixture(),future={schemaVersion:4,nativeUnitId:f.row.id,entityKind:'equipment_unit',sourceSystem:'future',sourceRecordId:'invalid'};
 const map=await projectImportedSourceAddresses(f.snapshot,[future,f.source,{schemaVersion:99}],[],[],[],{...f.context,currentSources:[future,f.source]});
 assert.equal(map.items[0].importedInstallation.schemaVersion,3);
 const record=await estimate(f.source),result=await projectImportedGeocodes(map,[{binding:future},record,{binding:{schemaVersion:99}}],[],[],f.context);assert.ok(await checkedAddressEstimate(result.items[0]));
 assert.equal(sourceDto(future),null);
 const reader=createSourceReader(A,async()=>response({sources:[future,sourceDto(f.source)]}));assert.deepEqual(await reader.currentMany([sourceIdentity(f.source),sourceIdentity(f.source)]),[null,await checkedImportedSource(f.source)]);
});

test('V3 tombstones retain typed identity and redact every former address and guard',async()=>{
 const f=await fixture('SHOP'),dto=sourceDto(f.source);assert.equal(dto.schemaVersion,3);assert.equal(dto.entityKind,'equipment_unit');assert.equal(dto.sourceRecordId,f.source.sourceRecordId);assert.equal(dto.eligibility,'tombstone');
 assert.deepEqual(Object.keys(dto).sort(),['schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','sourceRecordId','sourceRevision','eventId','eligibility'].sort());
 const reader=createSourceReader(A,async()=>response({sources:[dto]}));assert.deepEqual(await reader.currentMany([sourceIdentity(f.source)]),[null]);
});

async function shopFixture(){
 const f=await fixture('SHOP'),unitKey='HELIOS 001';f.devices=[{id:9101,unit_key:unitKey,organization:'root',activation_state:'deactivated'}];
 f.audits=[{id:'40',unit_key:unitKey,device_ids:['9101'],action:'MOVE_TO_ROOT',created_at:'2026-10-01T12:00:00Z',contract:null,control_id:null,request_id:null,placement:null,site_label:null,street_address:null}];
 f.context.identity.unitIdentities=[{unitId:f.row.id,unitNumber:f.row.unitNumber,kind:'native_provider',unitKeys:[unitKey],deviceIds:['9101'],proof:A}];return f;
}
test('V3 composes the reviewed agreeing SHOP helper without acquiring provider identity',async()=>{
 const f=await shopFixture(),before=structuredClone(f),map=await overlay(f);assert.equal(map.items.length,0);assert.equal(map.inventoryItems[0].importedPlacement,'SHOP');assert.equal(map.inventoryItems[0].recordSource,f.row.recordSource);assert.equal(map.inventoryItems[0].readOnly,false);assert.equal(map.inventoryItems[0].nativeSourceIdentity,undefined);assert.deepEqual(f,before);
 for(const change of [f=>f.context.identity.unitIdentities=[],f=>f.context.currentSources=[],f=>f.context.currentSources[0].nativeSourceIdentity.trackerId=randomUUID(),f=>f.context.currentSources[0].customerLabel='Changed customer',f=>f.context.currentSources.push({...f.source,nativeUnitId:randomUUID()}),f=>f.devices[0].activation_state='active',f=>f.audits.push({...f.audits[0],id:'41',action:'MOVE_TO_FIELD',created_at:'2026-10-02T12:00:00Z'}),f=>f.context.identity.identityWarnings.push({unitId:f.row.id,unitKeys:[],deviceIds:[]})]){const heldFixture=await shopFixture();change(heldFixture);await held(heldFixture);}
});

test('V3 exact native/tracker proof retains the existing source-only display exception without creating health identity',async()=>{
 const f=await fixture();f.devices=[{id:9101,unit_key:'HELIOS 001'}];const before=structuredClone(f.context);
 const map=await overlay(f);assert.equal(map.items[0].importedPlacement,'FIELD');assert.equal(map.items[0].recordSource,f.row.recordSource);assert.equal(map.items[0].nativeSourceIdentity,undefined);assert.equal(map.items[0].unitIdentities,undefined);assert.equal(map.items[0].nativePlacementAliases,undefined);assert.deepEqual(f.context,before);assert.deepEqual(f.context.identity.unitIdentities,[]);
 for(const change of [f=>f.devices.push({id:9102,unit_key:'HELIOS 001HDC2'}),f=>f.audits.push({id:'40',unit_key:'HELIOS 001',device_ids:['9101'],action:'MOVE_TO_ROOT',contract:null}),f=>f.context.identity.identityWarnings.push({unitId:f.row.id,deviceIds:[],unitKeys:[]})]){const candidate=await fixture();candidate.devices=[{id:9101,unit_key:'HELIOS 001'}];change(candidate);await held(candidate);}
});

test('existing Owner, identity, manual GPS and native site guards still outrank V3 source addresses',async()=>{
 for(const placement of ['FIELD','SHOP'])for(const patch of [{placementSource:'owner'},{placementStatus:'needs_identity_review'},{placement:'UNKNOWN'},{hasUnitGps:true},{locationVerification:'owner_verified'},{installedSiteId:randomUUID()}]){const f=await fixture(placement);Object.assign(f.row,patch);await held(f);}
});

// SQL-shaped RPC fixtures exercise the actual bridge/queue worker/map DTO chain.
// Database constraints and quota locking are covered separately by SQL tests.
for(const censusMatch of [true,false])test('SQL-shaped V3 bridge → existing queue → map roundtrip '+(censusMatch?'Census':'Geocodio'),async()=>{
 const f=await fixture(),generation=randomUUID(),bindings=[],providerCalls={census:0,geocodio:0},calls=[];let cursor='0',stage=null,record=null;
 const bridge=createGeocodeSourcesHandler({readKey:A,rpc:async(name,args)=>{
  if(name==='cos_geocode_sources_list_changes')return args.p_after_event_id==='0'?{events:[{...sourceIdentity(f.source),eventId:'1',kind:'upsert'}],nextEventId:'1'}:{events:[],nextEventId:'1'};
  assert.equal(name,'cos_geocode_sources_read_current_batch');return {sources:args.p_sources.map(identity=>JSON.stringify(identity)===JSON.stringify(sourceIdentity(f.source))?f.source:null)};
 }});
 const requestFetch=async(url,init)=>{
  const u=new URL(url);if(u.hostname==='tughscoxralhofrckvxy.supabase.co')return bridge(new Request(url,init));
  if(u.hostname==='geocoding.geo.census.gov'){providerCalls.census++;return response({result:{addressMatches:censusMatch?[{matchedAddress:'123 Main St, Houston, TX 77002',coordinates:{x:-95,y:29}}]:[]}});}
  assert.equal(u.origin,'https://api.geocod.io');providerCalls.geocodio++;return response({results:[{address_components:{number:'123',formatted_street:'Main St',city:'Houston',state_province:'TX',postal_code:'77002',country:'US'},formatted_address:'123 Main St, Houston, TX 77002',location:{lat:29,lng:-95},accuracy:1,accuracy_type:'range_interpolation',match_type:null}]});
 };
 const rpc=async(name,args)=>{
  calls.push(name);assert.equal(args.p_organization_id,ORG);
  if(name==='cos_imported_geocode_cursor_read')return {eventId:cursor,scanGeneration:generation};
  if(name==='cos_imported_geocode_sync'){
   for(const event of args.p_events){assert.equal(event.productId,undefined);assert.equal(event.source.schemaVersion,3);assert.equal(event.source.nativeSourceIdentity,undefined);bindings.push(event.source);stage='census';}
   cursor=args.p_next_event_id;return {accepted:true,eventId:cursor,scanGeneration:generation,applied:args.p_events.length};
  }
  if(name==='cos_imported_geocode_scan_complete')return {};
  if(name==='cos_imported_geocode_postal_retry_list_due')return [];
  if(name==='cos_imported_geocode_postal_ordinary_list_due')return [{binding:{schemaVersion:4},stage:'census'},...(stage?[{binding:bindings[0],stage}]:[])];
  assert.deepEqual(args.p_binding,bindings[0]);
  if(name==='cos_imported_geocode_census_claim')return {claimed:true,claimToken:randomUUID()};
  if(name==='cos_imported_geocode_reserve')return {reserved:true,reservationToken:randomUUID(),sendBefore:new Date(Date.now()+100000).toISOString()};
  assert.ok(['cos_imported_geocode_census_finish','cos_imported_geocode_finish'].includes(name));assert.equal(args.p_source_current,true);
  if(args.p_status!=='success'){stage='geocodio';return {accepted:true};}
  stage=null;record={jobKind:'native_import',binding:args.p_binding,legacyGuardSha256:C,status:'success',verified:false,liveGps:false,provider:name.endsWith('census_finish')?'us_census_address_range':'geocodio',benchmark:name.endsWith('census_finish')?'Public_AR_Current':null,latitude:args.p_latitude,longitude:args.p_longitude,matchedAddress:args.p_matched_address,geocodedAt:'2026-01-01T00:00:00Z',accuracyType:args.p_accuracy_type,accuracy:args.p_accuracy,matchType:args.p_match_type};return {accepted:true};
 };
 const run=()=>processImportedGeocodes({rpc,fetch:requestFetch,sourceReadKey:A,geocodioApiKey:'synthetic-key',deadlineMs:Date.now()+100000});
 const summary=await run();assert.equal(summary.syncedSources,1);assert.equal(summary.consideredAddresses,1);assert.deepEqual(providerCalls,{census:1,geocodio:censusMatch?0:1});assert.equal(calls.filter(name=>name==='cos_imported_geocode_reserve').length,censusMatch?0:1);
 const map=await projectImportedGeocodes(await overlay(f),[record],[],[],f.context);assert.ok(await checkedAddressEstimate(map.items[0]));assert.equal(map.items[0].recordSource,'Native equipment registry');assert.equal(map.items[0].hasUnitGps,false);assert.equal(map.items[0].latitude,null);
 await run();assert.deepEqual(providerCalls,{census:1,geocodio:censusMatch?0:1});
});
