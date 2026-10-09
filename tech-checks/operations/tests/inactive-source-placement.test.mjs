import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {fixture,seed,reset,rpc,ORG} from './fixtures/geocode-sources-database-fixture.mjs';
import {sourceDto} from '../../supabase/functions/cos-geocode-sources/index.ts';
import {projectImportedSourceAddresses,projectImportedGeocodes,checkedImportedBinding} from '../../supabase/functions/cos-operations-pages/importedSourceProjection.ts';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
globalThis.crypto??=webcrypto;
const sql=name=>readFileSync(new URL('../db/'+name,import.meta.url),'utf8');
let db;
const admin=async(records)=>(await db.query('select app_private.cos_geocode_sources_admin_inactive_reviewed($1,$2) value',[ORG,records])).rows[0].value;
const inactive=r=>({...r,...(r.unitNumber.startsWith('Spotter ')?{family:'SPOTTER',variant:'HD'}:r.unitNumber.startsWith('Sniper ')?{family:'SNIPER',variant:null}:{}),placement:'INACTIVE',siteLabel:null,installation:null,addressSha256:null,sourceStatus:'DO NOT USE',sourceFullLabel:r.unitNumber+' - DO NOT USE',sourceObservedAt:'2026-10-01T00:00:00Z'});
before(async()=>{
 db=await fixture();await db.exec('alter table app_private.vision_tracker_locations add column customer text');
 for(const name of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','cos-inactive-source-placement.sql'])await db.exec(sql(name));
 await db.exec('revoke usage on schema app_private from service_role');
});
after(async()=>db?.close());beforeEach(async()=>reset(db));
const mapped=records=>rpc(db,'map_projection',{p_organization_id:ORG,p_identities:records.map(r=>({entityKind:r.entityKind,nativeUnitId:r.nativeUnitId}))});
const row=r=>({id:r.nativeUnitId,unitNumber:r.unitNumber,readOnly:r.entityKind==='tracker',_sourceField:true,status:'field',currentLocationType:'field',site:'Historical site',customer:'Historical customer',address:'Historical address',latitude:29,longitude:-95,coordinateSource:'us_census_address_range_estimate',hasUnitGps:false,recordSource:'Synthetic source',historicalLatitude:28,historicalLongitude:-94,historicalCoordinateSource:'historical observation'});
const snapshot=r=>({items:[r],inventoryItems:[r],summary:{fieldUnits:1},generatedAt:'2026-10-02T00:00:00Z'});
test('exact inactive source remains searchable inventory with no field pin, Shop move or fabricated health',async()=>{
 const r=inactive(await seed(db,{kind:'tracker',label:'Spotter 905HD'})),raw=row(r),before=structuredClone(raw);
 const nativeBefore=(await db.query('select to_jsonb(t) v from app_private.vision_tracker_locations t')).rows;
 const [source]=await admin([r]),[projection]=await mapped([r]);
 assert.equal(source.eligibility,'tombstone');assert.deepEqual(sourceDto(source),source);assert.equal(source.unitNumber,undefined);
 assert.equal(projection.placement,'INACTIVE');assert.equal(projection.installation,null);assert.equal(projection.addressSha256,null);
 const overlay=await projectImportedSourceAddresses(snapshot(raw),[projection],[],[]);
 const result=await projectOwnerPlacement(overlay,[],[]),target=result.inventoryItems[0];
 assert.equal(result.items.length,0);assert.equal(result.inventoryItems.length,1);assert.equal(target.id,r.nativeUnitId);assert.equal(target.unitNumber,r.unitNumber);
 assert.equal(target.importedPlacement,'INACTIVE');assert.equal(target.currentLocationType,'inactive');assert.equal(target.status,'inactive');assert.equal(target.site,'INACTIVE / DO NOT USE');
 for(const key of ['address','latitude','longitude','coordinateSource','placement','placementSource','placementAuditId'])assert.equal(target[key],null,key);
 assert.equal(target.historicalLatitude,before.historicalLatitude);assert.equal(target.historicalLongitude,before.historicalLongitude);assert.equal(target.historicalCoordinateSource,before.historicalCoordinateSource);
 assert.equal(target.activationState,undefined);assert.equal(target.cameraCount,undefined);assert.equal(target.health,undefined);assert.equal(await checkedImportedBinding(target.importedInstallation),null);
 assert.deepEqual(raw,before);assert.deepEqual((await db.query('select to_jsonb(t) v from app_private.vision_tracker_locations t')).rows,nativeBefore);
 const projected=await projectImportedGeocodes(result,[],[],[]);assert.equal(projected.inventoryItems[0].locationImportedGeocode,undefined);
});
test('FIELD to INACTIVE publishes one compatible tombstone and an exact retry is a no-op',async()=>{
 const r={...await seed(db,{kind:'tracker',label:'Spotter 905HD'}),family:'SPOTTER',variant:'HD'};
 const [old]=(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) v',[ORG,[r]])).rows[0].v;
 const next=inactive({...r,previousSourceRevision:old.sourceRevision}),[gone]=await admin([next]);
 assert.notEqual(gone.sourceRevision,old.sourceRevision);assert.equal(BigInt(gone.eventId),BigInt(old.eventId)+1n);
 assert.deepEqual(await admin([{...next,previousSourceRevision:gone.sourceRevision}]),[gone]);
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_source_events')).rows[0].n,2);
 const changes=await rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:old.eventId,p_limit:100});
 assert.deepEqual(changes.events,[{eventId:gone.eventId,entityKind:'tracker',nativeUnitId:r.nativeUnitId,productId:r.productId,sourceRevision:gone.sourceRevision,kind:'tombstone'}]);
 assert.equal(changes.nextEventId,gone.eventId);
});
test('inactive admission is SQL administrator only, with unchanged reader and importer grants',async()=>{
 const r=inactive(await seed(db,{kind:'tracker'}));
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);try{await assert.rejects(admin([r]),/permission denied/);}finally{await db.exec('reset role');}
  assert.equal((await db.query("select has_function_privilege($1,'app_private.cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }
 const props=(await db.query("select prosecdef,proconfig from pg_proc where oid='app_private.cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb)'::regprocedure")).rows[0];
 assert.equal(props.prosecdef,false);assert.deepEqual(props.proconfig,['search_path=""']);
 await assert.rejects(db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[ORG,[r]]),/Invalid reviewed source/);
 await db.exec('create role synthetic_import_reader;grant usage on schema app_private to synthetic_import_reader;grant execute on function app_private.cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb) to synthetic_import_reader;set role synthetic_import_reader');
 try{await assert.rejects(admin([r]),/Existing SQL administrator required/);}finally{await db.exec('reset role');}
});
test('missing/excess evidence, partial label, stale address, ambiguous identity and wrong disposition reject atomically',async()=>{
 const r=inactive(await seed(db,{kind:'tracker',label:'Spotter 905HD'}));
 for(const patch of [{sourceStatus:null},{sourceFullLabel:'Spotter 905 - DO NOT USE'},{trackerUnitNumber:'Spotter 905'},{sourceObservedAt:'infinity'},{sourceObservedAt:'2999-01-01T00:00:00Z'},{sourceObservedAt:null},{installation:{}},{installation:undefined},{addressSha256:'a'.repeat(64)},{suppliedComponents:{street:true}},{siteLabel:'Old customer'},{placement:'SHOP'},{placement:'FIELD'},{unexpected:'discard me'}])await assert.rejects(admin([{...r,...patch}]),/source|Source|address|Invalid/i);
 await assert.rejects(admin([r,{...r,productId:'99999'}]),/Ambiguous/);
 assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n,0);
});
test('changed native guard, manual tracker GPS, newer Owner placement and installed site hold inactive source',async()=>{
 const r=inactive(await seed(db,{kind:'tracker'}));await db.query("update app_private.vision_tracker_locations set address='Changed' where id=$1",[r.nativeUnitId]);
 await assert.rejects(admin([r]),/GPS changed/);
 await db.query("update app_private.vision_tracker_locations set latitude=30,longitude=-96,coordinate_source='manual' where id=$1",[r.nativeUnitId]);
 await assert.rejects(admin([r]),/GPS changed/);
 const other=inactive(await seed(db,{kind:'tracker',label:'Sniper 905',product:'99999'}));await admin([other]);const [source]=await mapped([other]);
 for(const patch of [{placementSource:'owner',placement:'FIELD'},{hasUnitGps:true},{locationVerification:'owner_verified'},{installedSiteId:randomUUID()},{placementStatus:'needs_identity_review'},{placement:'UNKNOWN'},{activeJobNumber:'JOB-123'}]){
  const raw={...row(other),...patch};assert.deepEqual((await projectImportedSourceAddresses(snapshot(raw),[source],[],[])).inventoryItems,[raw]);
 }
 for(const a of [{id:'1',unit_key:other.unitNumber,device_ids:[],action:'MOVE_TO_FIELD',contract:'COS_CAMERA_PLACEMENT_V2'},{id:'1',unit_key:other.unitNumber,device_ids:[],action:'MOVE_TO_ROOT'}]){
  const raw=row(other);assert.deepEqual((await projectImportedSourceAddresses(snapshot(raw),[source],[a],[])).inventoryItems,[raw]);
 }
});
test('inactive projection rejects malformed/fabricated contracts and source evidence',async()=>{
 const r=inactive(await seed(db,{kind:'tracker'}));await admin([r]);const [source]=await mapped([r]),raw=row(r);
 for(const patch of [{schemaVersion:undefined,sourceSystem:undefined},{organizationId:randomUUID()},{eligibility:'FIELD'},{installation:{street:'123 Example Rd'}},{addressSha256:'a'.repeat(64)},{suppliedComponents:{}},{sourceRevision:'bad'},{productId:null},{unitNumber:r.unitNumber+'HDC2'}])assert.deepEqual((await projectImportedSourceAddresses(snapshot(raw),[{...source,...patch}],[],[])).inventoryItems,[raw]);
});
test('migration preserves existing V1 and V2 bytes, event IDs, source revisions and original function body',async()=>{
 const old=await fixture();try{
  await old.exec('alter table app_private.vision_tracker_locations add column customer text');
  for(const name of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql'])await old.exec(sql(name));
  const r=await seed(old);await old.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[ORG,[r]]);
  const id=randomUUID(),v2={entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Pole 72|999',sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:'Solar Pole 72|999',sourceRange:'A999:L999'},createTracker:true,unitNumber:'Solar Pole 72 999',trackerUnitNumber:'Solar Pole 72 999',family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:r.sourceFileSha256,sourceRowSha256:r.sourceRowSha256,installation:r.installation,addressSha256:r.addressSha256,previousSourceRevision:null,placement:'FIELD',siteLabel:'Synthetic site',customerLabel:'Synthetic customer'};
  await old.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2)',[ORG,[v2]]);
  const capture=async()=>({sources:(await old.query('select jsonb_agg(to_jsonb(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v,events:(await old.query('select jsonb_agg(to_jsonb(e) order by event_id) v from app_private.cos_geocode_source_events e')).rows[0].v,dtos:(await old.query('select jsonb_agg(app_private.cos_source_record(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v,functions:(await old.query("select oid::regprocedure::text,prosrc,proowner,proacl::text,prosecdef,proconfig from pg_proc where oid in ('app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb)'::regprocedure,'public.cos_geocode_sources_map_projection(uuid,jsonb)'::regprocedure) order by oid")).rows,sequence:(await old.query('select last_value,is_called from app_private.cos_geocode_source_event_id_seq')).rows});
  const before=await capture();await old.exec(sql('cos-inactive-source-placement.sql'));await old.exec(sql('cos-inactive-source-placement.sql'));assert.deepEqual(await capture(),before);
  for(const dto of before.dtos)assert.deepEqual(sourceDto(dto),dto);
 }finally{await old.close();}
});
test('migration refuses changed execution security or search path even when original importer body hash matches',async()=>{
 for(const change of ['security definer',"set search_path to public",'owner to service_role']){
  const old=await fixture();try{
   await old.exec(sql('cos-geocode-sources-admin-import.sql'));
   await old.exec('alter function app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb) '+change);
   await assert.rejects(old.exec(sql('cos-inactive-source-placement.sql')),/Reviewed source importer changed/);
   await old.exec('rollback');
   assert.equal((await old.query("select to_regprocedure('app_private.cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb)') v")).rows[0].v,null);
   assert.equal((await old.query("select pg_get_constraintdef(oid) v from pg_constraint where conrelid='app_private.cos_geocode_sources'::regclass and conname='cos_geocode_sources_source_placement_check'")).rows[0].v.includes('INACTIVE'),false);
  }finally{await old.close();}
 }
});
