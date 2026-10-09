import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,record,admin,reset,identity,guard,sql,ORG,hash} from './fixtures/existing-tracker-source-v3-fixture.mjs';
import {seed,rpc} from './fixtures/geocode-sources-database-fixture.mjs';
let db;before(async()=>{db=await fixture();});after(async()=>db?.close());beforeEach(async()=>reset(db));
const current=s=>rpc(db,'read_current_batch',{p_organization_id:ORG,p_sources:[identity(s)]});
const projected=s=>rpc(db,'map_projection',{p_organization_id:ORG,p_identities:[{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId}]});
const snap=async(d,tables)=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await d.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') v from ${t} x`)).rows[0].v])));
const protectedTables=['public.equipment_units','app_private.vision_tracker_locations','public.equipment_unit_location_history','app_private.cos_owner_identity_claims','app_private.cos_archived_representations','public.mhelpdesk_equipment_catalog','app_private.vision_source_inventory_v1'];
test('exact existing graph produces V3 source/proof without operational changes',async()=>{
 const r=await record(db),before=await snap(db,protectedTables),[s]=await admin(db,[r]);assert.equal(s.schemaVersion,3);assert.equal(s.entityKind,'equipment_unit');assert.equal(Object.hasOwn(s,'productId'),false);assert.equal(Object.hasOwn(s,'sourceProvenance'),false);assert.deepEqual((await current(s)).sources,[s]);
 const [m]=await projected(s);assert.equal(m.nativeSourceIdentity.contract,'COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V3');assert.equal(m.nativeSourceIdentity.trackerId,r.trackerId);assert.equal(m.nativeSourceIdentity.sourceRecordId,r.sourceRecordId);assert.equal(Object.hasOwn(m.nativeSourceIdentity,'productId'),false);assert.deepEqual(await snap(db,protectedTables),before);
});
test('no-op preserves revision/event; address/file revision obeys stale CAS',async()=>{
 const r=await record(db),[s]=await admin(db,[r]),before=await snap(db,['app_private.cos_geocode_source_events']);assert.deepEqual((await admin(db,[{...r,previousSourceRevision:s.sourceRevision}]))[0],s);assert.deepEqual(await snap(db,['app_private.cos_geocode_source_events']),before);
 const next={...r,previousSourceRevision:s.sourceRevision,sourceFileSha256:hash('new file'),sourceRowSha256:hash('new row'),installation:{...r.installation,street:'124 Main St'},addressSha256:hash('124 main st, houston, tx 77002-1234')};const [n]=await admin(db,[next]);assert.notEqual(n.sourceRevision,s.sourceRevision);assert.notEqual(n.eventId,s.eventId);assert.deepEqual((await db.query('select source_provenance p from app_private.cos_geocode_sources where native_unit_id=$1',[r.nativeUnitId])).rows[0].p,r.sourceProvenance);assert.deepEqual((await current(s)).sources,[null]);await assert.rejects(()=>admin(db,[next]),/revision changed/);
});
test('missing targets, cross UUIDs, forged creator/ProductId and duplicate batch deny',async()=>{
 const r=await record(db),b=await record(db,{number:'008',n:2});for(const patch of [{nativeUnitId:randomUUID()},{trackerId:randomUUID()},{trackerId:r.nativeUnitId},{createTracker:false},{createTracker:true},{productId:'123'}])await assert.rejects(()=>admin(db,[{...r,...patch}]));
 for(const patch of [{nativeUnitId:r.nativeUnitId},{trackerId:r.trackerId},{sourceRecordId:r.sourceRecordId}])await assert.rejects(()=>admin(db,[r,{...b,...patch}]),/Ambiguous reviewed batch/);assert.equal((await db.query('select count(*)::integer n from app_private.cos_geocode_sources')).rows[0].n,0);
});
test('family, suffix, decimals and zeros are exact; punctuation collisions only deny',async()=>{
 const r=await record(db,{family:'HELIOS',number:'007.1HDC4'});for(const label of ['SPOTTER 007.1HDC4','HELIOS 007.1','HELIOS 0071HDC4','HELIOS 7.1HDC4','HELIOS 007.1HDC2']){await assert.rejects(()=>admin(db,[{...r,trackerUnitNumber:label}]));await assert.rejects(()=>admin(db,[{...r,unitNumber:label,trackerUnitNumber:label}]));}
 for(const label of [r.unitNumber,'HELIOS 0071HDC4']){const id=randomUUID();await db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,placement) values($1,$2,$3,'FIELD')",[id,ORG,label]);await assert.rejects(()=>admin(db,[r]),/Native placement or GPS changed/);await db.query('delete from app_private.vision_tracker_locations where id=$1',[id]);}
 assert.equal((await admin(db,[r]))[0].unitNumber,'HELIOS 007.1HDC4');
});
test('source identity/provenance cannot change or replace existing mHelp',async()=>{
 const r=await record(db),[s]=await admin(db,[r]);for(const patch of [{sourceRecordId:r.sourceRecordId.replace('|007','|008')},{sourceSystem:'mhelpdesk_product_import'},{sourceProvenance:{...r.sourceProvenance,sourceRange:'A2:L2'}},{sourceProvenance:{...r.sourceProvenance,sourceRangeSha256:hash('changed')}}])await assert.rejects(()=>admin(db,[{...r,previousSourceRevision:s.sourceRevision,...patch}]));await assert.rejects(()=>db.query("update app_private.cos_geocode_sources set source_provenance=source_provenance||'{\"sourceRange\":\"A2:L2\"}' where native_unit_id=$1",[r.nativeUnitId]),/provenance is immutable/);
 await reset(db);const m=await seed(db,{label:'Spotter 009'}),[old]=(await db.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2) v',[ORG,[m]])).rows[0].v;const v={...r,nativeUnitId:m.nativeUnitId,trackerId:m.trackerId,unitNumber:m.unitNumber,trackerUnitNumber:m.unitNumber,sourceRecordId:r.sourceRecordId.replace('|007','|009'),sourceProvenance:{...r.sourceProvenance,fullIdentity:'Spotter|009'},previousSourceRevision:old.sourceRevision};v.nativeGuardSha256=await guard(db,v);await assert.rejects(()=>admin(db,[v]),/cannot be replaced/);
});
const authorities={
 malformedMetadata:r=>db.query("update public.equipment_units set metadata='[]' where id=$1",[r.nativeUnitId]),
 metadata:r=>db.query("update public.equipment_units set metadata='{\"productId\":\"91\"}' where id=$1",[r.nativeUnitId]),
 catalog:r=>db.query('insert into public.mhelpdesk_equipment_catalog(organization_id,product_id,product_model) values($1,91,$2)',[ORG,r.unitNumber]),
 inventory:r=>db.query("insert into app_private.vision_source_inventory_v1(organization_id,registered_unit_id,source_record_id) values($1,$2,'mhelp:91')",[ORG,r.nativeUnitId]),
 Owner:r=>db.query('insert into app_private.cos_owner_identity_claims(organization_id,native_unit_id,native_unit_label) values($1,$2,$3)',[ORG,r.nativeUnitId,r.unitNumber]),
 history:r=>db.query("insert into public.equipment_unit_location_history(organization_id,equipment_unit_id,latitude,source) values($1,$2,29,'owner_gps')",[ORG,r.nativeUnitId]),
 archive:r=>db.query('insert into app_private.cos_archived_representations(organization_id,canonical_native_id,canonical_tracker_id) values($1,$2,$3)',[ORG,r.nativeUnitId,r.trackerId]),
 GPS:r=>db.query("update public.equipment_units set gps_latitude=29,gps_longitude=-95,gps_source='owner' where id=$1",[r.nativeUnitId]),
 site:r=>db.query('update public.equipment_units set installed_site_id=$1 where id=$2',[randomUUID(),r.nativeUnitId]),
 retired:r=>db.query('update public.equipment_units set retired_at=now() where id=$1',[r.nativeUnitId]),
 reference:r=>db.query('update public.equipment_units set current_location_ref=$1 where id=$2',[randomUUID(),r.nativeUnitId]),
 uuid:r=>db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,'Unrelated 551','available')",[r.trackerId,ORG])
};
for(const [name,mutate] of Object.entries(authorities))test(name+' conflict blocks admission/read/map without changing authority',async()=>{
 const r=await record(db),[s]=await admin(db,[r]);await mutate(r);const before=await snap(db,protectedTables);assert.equal(await guard(db,r),null);assert.deepEqual((await current(s)).sources,[null]);assert.deepEqual(await projected(s),[]);await assert.rejects(()=>admin(db,[{...r,previousSourceRevision:s.sourceRevision}]));assert.deepEqual(await snap(db,protectedTables),before);
});
test('range/file/row evidence and address sanitation fail closed',async()=>{
 const r=await record(db);for(const patch of [{sourceFileSha256:'x'},{sourceRowSha256:'x'},{sourceProvenance:{...r.sourceProvenance,sourceRange:'A1:L2'}},{sourceProvenance:{...r.sourceProvenance,sourceRangeSha256:'x'}},{sourceProvenance:{...r.sourceProvenance,extra:'private'}},{installation:{...r.installation,street:'123 Main St password123'}},{installation:{...r.installation,street:'123 Main St Suite 2'}}])await assert.rejects(()=>admin(db,[{...r,...patch}]));
});
test('V2 administrator entrypoints remain tracker-only',async()=>{
 const r=await record(db),[s]=await admin(db,[r]);await assert.rejects(()=>db.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2)',[ORG,[{...r,previousSourceRevision:s.sourceRevision}]]),/Invalid reviewed source/);await assert.rejects(()=>db.query('select app_private.cos_tracker_sources_admin_revoke_reviewed($1,$2)',[ORG,[identity(s)]]),/revision changed/);assert.deepEqual((await current(s)).sources,[s]);
});
test('upgrade preserves V1/V2 bytes, protected epochs and all existing ACL/owner/wrapper properties',async()=>{
 const d=await fixture({upgrade:false});try{const m=await seed(d,{label:'HELIOS 099HDC4'});await d.query('select app_private.cos_geocode_sources_admin_import_reviewed($1,$2)',[ORG,[m]]);const id=randomUUID(),r={entityKind:'tracker',nativeUnitId:id,trackerId:id,sourceSystem:'google_sheet_tracker',sourceRecordId:'google_sheet:synthetic_sheet_123:12:Solar Pole 72|003',sourceProvenance:{sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:'Solar Pole 72|003',sourceRange:'A3:L3'},createTracker:true,unitNumber:'Solar Pole 72 003',trackerUnitNumber:'Solar Pole 72 003',family:'Solar Pole 72',trackerFamily:'SOLAR POLES & SKIDS',variant:null,sourceFileSha256:hash('file'),sourceRowSha256:hash('row'),installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},addressSha256:hash('123 main st, houston, tx 77002'),previousSourceRevision:null,placement:'FIELD'};await d.query('select app_private.cos_tracker_sources_admin_import_reviewed($1,$2)',[ORG,[r]]);
 const tables=[...protectedTables,'app_private.cos_geocode_sources','app_private.cos_geocode_source_events','app_private.cos_source_precedence_decisions'],before=await snap(d,tables),permissions=async()=>(await d.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proowner,p.prosecdef,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') order by 1,2,3")).rows,old=await permissions(),dtos=(await d.query('select jsonb_agg(app_private.cos_source_record(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v;
 await d.exec(sql('cos-existing-tracker-source-v3.sql'));assert.deepEqual(await snap(d,tables),before);assert.deepEqual((await d.query('select jsonb_agg(app_private.cos_source_record(s) order by native_unit_id) v from app_private.cos_geocode_sources s')).rows[0].v,dtos);const now=await permissions();for(const p of old)assert.deepEqual(now.find(x=>x.nspname===p.nspname&&x.proname===p.proname&&x.args===p.args),p);assert.equal((await d.query("select has_schema_privilege('service_role','app_private','USAGE') v")).rows[0].v,false);
 for(const role of ['anon','authenticated','service_role'])for(const name of ['cos_existing_tracker_sources_admin_import_reviewed(uuid,jsonb)','cos_existing_tracker_source_guard(uuid,uuid,text,text)','cos_source_current_guard(app_private.cos_geocode_sources)'])assert.equal((await d.query('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,'app_private.'+name])).rows[0].v,false);
 }finally{await d.close();}
});

test('bounded readers keep identical argument validation and deduplicate requested identities',async()=>{
 const r=await record(db),[source]=await admin(db,[r]),key={entityKind:'equipment_unit',nativeUnitId:r.nativeUnitId};
 const readers=['read_many','map_projection'];
 for(const ids of [null,{},[null],['bad'],[{nativeUnitId:r.nativeUnitId}],[{...key,entityKind:'camera'}],[{...key,nativeUnitId:'BAD'}],[{...key,unexpected:true}],Array.from({length:251},()=>key)]){
  const errors=[];for(const name of readers){try{await rpc(db,name,{p_organization_id:ORG,p_identities:ids});assert.fail('invalid request accepted');}catch(error){errors.push({code:error.code,message:error.message});}}
  assert.deepEqual(errors[0],errors[1]);assert.equal(errors[0].code,'22023');
 }
 for(const name of readers){
  assert.deepEqual(await rpc(db,name,{p_organization_id:ORG,p_identities:[]}),[]);
  assert.deepEqual(await rpc(db,name,{p_organization_id:ORG,p_identities:[{...key,entityKind:'tracker'}]}),[]);
  const result=await rpc(db,name,{p_organization_id:ORG,p_identities:[key,key,{...key,nativeUnitId:randomUUID()}]});assert.equal(result.length,1);assert.equal(result[0].sourceRevision,source.sourceRevision);
  for(const role of ['anon','authenticated'])await assert.rejects(()=>rpc(db,name,{p_organization_id:ORG,p_identities:[key]},role),error=>error.code==='42501');
  await assert.rejects(()=>rpc(db,name,{p_organization_id:randomUUID(),p_identities:[key]}),error=>error.code==='42501');
 }
});
