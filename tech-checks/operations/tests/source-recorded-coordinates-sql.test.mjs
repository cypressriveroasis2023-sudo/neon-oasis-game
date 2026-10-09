import {projectSourceRecordedCoordinates} from '../../supabase/functions/cos-operations-pages/sourceRecordedCoordinates.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import {reviewedLegacyEvidenceSha256} from '../../supabase/functions/cos-operations-pages/reviewedAddressEstimates.ts';
import {placementMatchKey} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,reset,seed,rpc,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
let db;
before(async()=>{db=await fixture();await db.exec('revoke usage on schema app_private from service_role');for(const f of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','source-recorded-coordinates.sql'])await db.exec(await readFile(new URL('../db/'+f,import.meta.url),'utf8'));});
after(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('truncate app_private.cos_source_recorded_coordinates');await reset(db);});
const bind=async r=>(await db.query('select app_private.cos_recorded_coordinate_binding($1,$2,$3,$4,$5,$6,$7) b',[r.entityKind,r.nativeUnitId,r.trackerId,r.unitNumber,r.trackerUnitNumber,r.productId,r.family])).rows[0].b;
const install=async(db,records)=>(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) value',[ORG,records])).rows[0].value;
const admin=async records=>(await db.query('select app_private.cos_source_recorded_coordinates_admin_import($1,$2) value',[ORG,records])).rows[0].value;
async function read(r,role='service_role',org=ORG,identities=[{entityKind:r.entityKind,nativeUnitId:r.nativeUnitId}]){await db.exec('set role '+role);try{return(await db.query('select public.cos_source_recorded_coordinates_read_many($1,$2) value',[org,identities])).rows[0].value;}finally{await db.exec('reset role');}}
async function point({kind='tracker',label='Solar Stand 72 098',product='7001',imported=false}={}){
 const base=await seed(db,{kind,label,product});await db.query("update app_private.vision_tracker_locations set family='SOLAR STANDS 72',address='Example Rd, Test City, TX 77001' where id=$1",[base.trackerId]);
 const r={entityKind:kind,nativeUnitId:base.nativeUnitId,trackerId:base.trackerId,productId:product,unitNumber:label,trackerUnitNumber:label,family:'SOLAR STANDS 72',typedIdentity:'typed:SOLARSTAND72|98',sourceSpreadsheetId:'synthetic_spreadsheet_00001',sourceSheetId:'123',coordinateCell:'N19',coordinateCellSha256:hash('30, -95'),sourceFileSha256:hash('file'),sourceRowSha256:hash('row'),sourceObservedAt:'2026-01-01T00:00:00Z',sourceAddressSha256:hash('example rd, test city, tx 77001'),latitude:30,longitude:-95,legacyEvidenceSha256:hash('synthetic'),previousRecordId:null};
 if(imported){const source={...base,family:r.family,nativeGuardSha256:(await bind(r)).nativeGuardSha256};await install(db,[source]);}
 return {...r,binding:await bind(r)};
}
test('administrator stores literal coordinates separately and service reads with private schema denied',async()=>{
 const r=await point();await admin([r]);const [saved]=await read(r);assert.equal(saved.source,'tracker_recorded_coordinates');assert.equal(saved.verified,false);assert.equal(saved.liveGps,false);assert.equal(saved.coordinateRecordedAt,null);assert.equal(saved.appliedByDatabaseRole,'postgres');
 assert.deepEqual((await db.query('select latitude,longitude,coordinate_source from app_private.vision_tracker_locations')).rows,[{latitude:null,longitude:null,coordinate_source:null}]);assert.equal((await db.query("select has_schema_privilege('service_role','app_private','USAGE') allowed")).rows[0].allowed,false);
 for(const role of ['anon','authenticated'])await assert.rejects(()=>read(r,role),/permission denied/);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(()=>admin([r]),/permission denied/);}finally{await db.exec('reset role');}}
 await assert.rejects(()=>read(r,'service_role',randomUUID()),/Source service access required/);await assert.rejects(()=>db.query('select public.cos_source_recorded_coordinates_read_many($1,$2)',[ORG,[]]),/Source service access required/);
});
test('native move then restoration never resurrects the prior coordinate; history is retained',async()=>{
 const r=await point();await admin([r]);await db.query("update app_private.vision_tracker_locations set placement='SHOP' where id=$1",[r.trackerId]);assert.deepEqual(await read(r),[]);await db.query("update app_private.vision_tracker_locations set placement='FIELD' where id=$1",[r.trackerId]);assert.deepEqual(await read(r),[]);assert.equal((await db.query('select count(*)::int n from app_private.cos_source_recorded_coordinates')).rows[0].n,1);await assert.rejects(()=>admin([r]),/Recorded coordinate revision changed/);
});
test('current source revision and address/native guards prevent stale replacement or replay',async()=>{
 const r=await point({imported:true});await admin([r]);assert.equal((await read(r)).length,1);await assert.rejects(()=>admin([r]),/Recorded coordinate revision changed/);await db.query("update app_private.cos_geocode_sources set source_row_sha256=$1 where native_unit_id=$2",[hash('changed'),r.nativeUnitId]);assert.deepEqual(await read(r),[]);await assert.rejects(()=>admin([r]),/Current source or native binding changed/);
});
test('new source admission suppresses a prior tracker-only source binding',async()=>{
 const r=await point();await admin([r]);const base={...r,installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002-1234'},addressSha256:hash('123 main st, houston, tx 77002-1234'),nativeGuardSha256:r.binding.nativeGuardSha256,previousSourceRevision:null,placement:'FIELD',variant:null};for(const k of ['typedIdentity','sourceSpreadsheetId','sourceSheetId','coordinateCell','coordinateCellSha256','sourceObservedAt','sourceAddressSha256','latitude','longitude','legacyEvidenceSha256','previousRecordId','binding'])delete base[k];await install(db,[base]);assert.deepEqual(await read(r),[]);
});
test('address, duplicate padded labels and manual GPS permanently suppress source coordinates',async()=>{
 for(const mutation of ['address','duplicate','gps']){await db.exec('truncate app_private.cos_source_recorded_coordinates');await reset(db);const r=await point({kind:'equipment_unit'});await admin([r]);if(mutation==='address')await db.query("update app_private.vision_tracker_locations set address='Changed Rd, Test City, TX 77001' where id=$1",[r.trackerId]);if(mutation==='duplicate')await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'Solar Stand 72 98','available')",[randomUUID(),ORG]);if(mutation==='gps')await db.query('update public.equipment_units set gps_latitude=30,gps_longitude=-95 where id=$1',[r.nativeUnitId]);assert.deepEqual(await read(r),[]);await assert.rejects(()=>admin([r]),/Current source or native binding changed/);}
});
test('malformed provenance, duplicate identities, family mismatch and Shop are held',async()=>{
 const r=await point();for(const patch of [{sourceAddressSha256:hash('wrong')},{typedIdentity:'typed:SNIPER|98'},{family:'Solar Skid 144'},{latitude:91},{sourceObservedAt:'2100-01-01T00:00:00Z'}])await assert.rejects(()=>admin([{...r,...patch}]),/Invalid recorded coordinate provenance|Typed coordinate identity mismatch|Current source or native binding changed|Source address changed/);await assert.rejects(()=>admin([r,r]),/Duplicate recorded coordinate identity/);await assert.rejects(()=>read(r,'service_role',ORG,Array(251).fill({entityKind:r.entityKind,nativeUnitId:r.nativeUnitId})),/Invalid coordinate identities/);await db.query("update app_private.vision_tracker_locations set placement='SHOP' where id=$1",[r.trackerId]);await assert.rejects(()=>admin([r]),/Current source or native binding changed/);
});
test('new reader is bounded definer and all existing wrappers retain exact security settings',async()=>{
 const names=['cos_source_recorded_coordinates_read_many','cos_geocode_sources_list_changes','cos_geocode_sources_read_current','cos_geocode_sources_read_many','cos_geocode_sources_read_current_batch','cos_geocode_sources_map_projection'];const rows=(await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any($1)",[names])).rows;assert.equal(rows.length,6);for(const r of rows){assert.equal(r.prosecdef,true);assert.deepEqual(r.proconfig,['search_path=""']);assert.equal(r.anon,false);assert.equal(r.authenticated,false);assert.equal(r.service,true);}const r=await point({imported:true});assert.equal((await rpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:r.entityKind,nativeUnitId:r.nativeUnitId}]})).length,1);
});

test('denial concern keys preserve family digits, decimals and camera variants',async()=>{
 const cases={'Solar Stand 72 0098':'solarstand72|98','Solar Skid 144 098':'solarskid144|98','HELIOS 099HDC4':'helios|99hdc4','SNIPER 2 0098':'sniper2|98','HELIOS 099.2HDC4':'helios|99.2hdc4'};
 for(const [label,expected] of Object.entries(cases))assert.equal((await db.query('select app_private.cos_recorded_coordinate_concern($1) value',[label])).rows[0].value,expected);
});

test('plural production-shaped family survives actual SQL read through backend and frontend without raw renaming',async()=>{
 for(const imported of [false,true]){
  await db.exec('truncate app_private.cos_source_recorded_coordinates');await reset(db);
  const r=await point({imported});r.legacyEvidenceSha256=await reviewedLegacyEvidenceSha256(r.unitNumber,[],[],placementMatchKey);
  await admin([r]);const [record]=await read(r);
  const row={id:r.nativeUnitId,unitNumber:r.unitNumber,modelName:'SOLAR STANDS 72',readOnly:true,status:'field',currentLocationType:'field',address:r.binding.installationAddress,hasUnitGps:false,locationVerification:'address_only'};
  if(imported){const [source]=await rpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:r.entityKind,nativeUnitId:r.nativeUnitId}]});row.importedInstallation=source;row.importedPlacement='FIELD';}
  const snapshot={items:[row],inventoryItems:[row],summary:{fieldUnits:1,mappedUnits:0,unitGps:0,missingGps:1}};
  const projected=await projectSourceRecordedCoordinates(snapshot,[record],[],[]);
  assert.equal((await checkedAddressEstimate(projected.items[0])).source,'tracker_recorded_coordinates');
  assert.equal(record.family,'SOLAR STANDS 72');assert.equal(record.binding.trackerFamily,'SOLAR STANDS 72');
  assert.equal((await db.query('select family from app_private.vision_tracker_locations')).rows[0].family,'SOLAR STANDS 72');
 }
});

test('other-target ProductId sources block admission and later invalidate absent-source records permanently',async()=>{
 for(const before of [true,false]){
  await db.exec('truncate app_private.cos_source_recorded_coordinates');await reset(db);
  const r=await point();
  if(!before)await admin([r]);
  const other=await seed(db,{kind:'tracker',label:'HELIOS 087HDC4',product:r.productId});await install(db,[other]);
  assert.equal(await bind(r),null);
  if(before)await assert.rejects(()=>admin([r]),/Current source or native binding changed/);else assert.deepEqual(await read(r),[]);
  await db.query('delete from app_private.cos_geocode_sources where native_unit_id=$1',[other.nativeUnitId]);
  assert.notDeepEqual(await bind(r),r.binding);assert.deepEqual(await read(r),[]);
 }
});
test('active recorded ProductId is unique across targets and batches',async()=>{
 const first=await point();await admin([first]);
 const second=await point({label:'Solar Stand 72 097',product:'7002'});second.typedIdentity='typed:SOLARSTAND72|97';second.productId=first.productId;assert.equal(await bind(second),null);await assert.rejects(()=>admin([second]),/Current source or native binding changed/);
 await db.exec('truncate app_private.cos_source_recorded_coordinates');first.binding=await bind(first);second.binding=await bind(second);await assert.rejects(()=>admin([first,second]),/Duplicate recorded coordinate identity/);
});
