import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,ORG,hash} from './fixtures/geocode-sources-database-fixture.mjs';
let db,sourceReadProperties;
const sourceReaderProperties="select proname,proowner,prosecdef,proconfig,proacl::text from pg_proc where proname like 'cos_geocode_sources_%' order by proname";
before(async()=>{
 db=await fixture();
 await db.exec(`alter table public.equipment_units add column current_location_ref text,add column updated_at timestamptz default now(),add column retired_at timestamptz;
 alter table app_private.vision_tracker_locations add column unit_key text,add column customer text,add column reviewed_estimate_epoch text;
 create table public.equipment_models(id uuid primary key,name text,category text);
 create table public.vision_vigilant_devices(id uuid primary key,organization_id uuid,external_device_id text,device_type text,source text,last_seen_at timestamptz);
create table public.vision_vigilant_unit_matches(id uuid primary key,equipment_unit_id uuid,vigilant_device_id uuid);
 create table public.equipment_unit_location_history(id uuid primary key,equipment_unit_id uuid,latitude float8,longitude float8);
 create table public.equipment_assignments(id uuid primary key,equipment_unit_id uuid,status text);
 create table public.audit_events(id uuid primary key,entity_id uuid,entity_type text,event_type text);
 create table app_private.cos_owner_identity_claims(id uuid primary key,native_unit_id uuid);
 revoke usage on schema app_private from service_role;`);
 await db.exec(await readFile(new URL('../db/cos-geocode-sources-read-access.sql',import.meta.url),'utf8'));
 sourceReadProperties=(await db.query(sourceReaderProperties)).rows;
 await db.exec(await readFile(new URL('../db/cos-archived-representations.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));
async function pair(number='987654',family='Spotter'){
 const old=randomUUID(),canonical=randomUUID(),oldTracker=randomUUID(),canonicalTracker=randomUUID(),model=randomUUID();
 await db.query("insert into public.equipment_models values($1,$2,'camera_system')",[model,family]);
 for(const [native,tracker,label] of [[old,oldTracker,`${family} ${number}HDC2`],[canonical,canonicalTracker,`${family} ${number}HDC4S`]]){
  await db.query("insert into public.equipment_units(id,organization_id,model_id,unit_number,status) values($1,$2,$3,$4,'available')",[native,ORG,model,label]);
  await db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,unit_key,family,placement,source_name) values($1,$2,$3,$4,$5,'FIELD','Synthetic tracker')",[tracker,ORG,label,label.toLowerCase().replace(/[^a-z0-9]/g,''),family]);
 }
 const reviewedBefore=(await db.query('select app_private.cos_archive_before($1,$2,$3,$4) v',[old,canonical,oldTracker,canonicalTracker])).rows[0].v;
 return {archivedNativeId:old,canonicalNativeId:canonical,archivedTrackerId:oldTracker,canonicalTrackerId:canonicalTracker,reviewedBefore,reviewSha256:hash('synthetic review'),sourceEvidence:{sourceSystem:'owner_reviewed_tracker_duplicate_archive',spreadsheetId:'SYNTHETIC_TEST_TRACKER_ID',archiveRange:"'SPOTTER DUPLICATE ARCHIVE'!A2:BC2",activeRange:"'SPOTTERS'!A144:BC144",archiveRowSha256:hash('archive cell proof'),activeRowSha256:hash('active cell proof'),archiveDesignation:'duplicate',archiveHidden:true,approvalReference:'synthetic review only'}};
}
const install=r=>db.query('select app_private.cos_archive_import_reviewed($1,$2) v',[ORG,r]);
test('repeated reviewed admission fails safely without duplicate evidence or changed projection',async()=>{
 const r=await pair();await install([r]);
 const before=(await db.query('select to_jsonb(r) v from app_private.cos_archived_representations r order by id')).rows;
 const projected=await projection();
 await rejects(()=>install([r]),/duplicate key|unique constraint/i);
 assert.deepEqual((await db.query('select to_jsonb(r) v from app_private.cos_archived_representations r order by id')).rows,before);
 assert.deepEqual(await projection(),projected);
 assert.equal((await db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,0);
});
async function projection(org=ORG,role='service_role'){
 await db.exec('set local role '+role);try{return (await db.query('select public.cos_archived_representation_projection($1) v',[org])).rows[0].v;}finally{try{await db.exec('reset role');}catch{ /* Preserve original SQL error until savepoint rollback. */ }}
}
async function rejects(fn,pattern){await db.exec('savepoint rejected');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to rejected;release rejected');}}
test('actual backend role reads guarded projections while private schema stays inaccessible',async()=>{
 assert.deepEqual((await db.query(sourceReaderProperties)).rows,sourceReadProperties);
 const r=await pair();await install([r]);const rows=await projection();assert.equal(rows.length,1);assert.equal(rows[0].archivedNativeId,r.archivedNativeId);assert.equal(rows[0].canonicalNativeId,r.canonicalNativeId);assert.equal(rows[0].recordedByDatabaseRole,'postgres');assert.equal(rows[0].provenance,'postgres_admin_reviewed_source_archive');
 const acl=(await db.query("select has_schema_privilege('service_role','app_private','USAGE') private,p.prosecdef,p.proconfig from pg_proc p where oid='public.cos_archived_representation_projection(uuid)'::regprocedure")).rows[0];assert.equal(acl.private,false);assert.equal(acl.prosecdef,true);assert.deepEqual(acl.proconfig,['search_path=""']);
 for(const role of ['anon','authenticated'])await rejects(()=>projection(ORG,role),/permission denied/);
 await rejects(()=>projection(randomUUID()),/Archive source service access required/);
 await rejects(()=>db.query('select public.cos_archived_representation_projection($1)',[ORG]),/Archive source service access required/);
 await db.exec('set local role service_role');await rejects(()=>db.query('select * from app_private.cos_archived_representations'),/permission denied/);await rejects(()=>install([r]),/permission denied/);await db.exec('reset role');
});
test('review writes neither physical equipment nor source, component, history or health data',async()=>{
 const r=await pair();await db.query('update public.equipment_units set gps_latitude=29,gps_longitude=-95,gps_source=$1,health_last_seen=now() where id=$2',['owner_gps',r.canonicalNativeId]);
 await db.query("update app_private.vision_tracker_locations set latitude=29,longitude=-95,coordinate_source='geocodio_reviewed_property_estimate',address='123 Synthetic St' where id=$1",[r.canonicalTrackerId]);
 r.reviewedBefore=(await db.query('select app_private.cos_archive_before($1,$2,$3,$4) v',[r.archivedNativeId,r.canonicalNativeId,r.archivedTrackerId,r.canonicalTrackerId])).rows[0].v;
 const query="select (select jsonb_agg(to_jsonb(u) order by id) from public.equipment_units u) units,(select jsonb_agg(to_jsonb(t) order by id) from app_private.vision_tracker_locations t) tracker";
 const before=(await db.query(query)).rows;await install([r]);assert.equal((await projection()).length,1);assert.deepEqual((await db.query(query)).rows,before);
});
test('wrong family and stale exact before-images reject the whole administrative batch',async()=>{
 for(const mutate of [r=>r.reviewedBefore.oldNative.updated_at='2020-01-01T00:00:00+00:00',r=>r.reviewedBefore.oldTracker.address='changed',r=>r.sourceEvidence.archiveDesignation='unconfirmed']){
  const r=await pair();mutate(r);await rejects(()=>install([r]),/Archive before-image|Complete reviewed/);
 }
 const r=await pair();await db.query("update public.equipment_units set unit_number='Solar Spotter 987654HDC4S' where id=$1",[r.canonicalNativeId]);await db.query("update app_private.vision_tracker_locations set unit_number='Solar Spotter 987654HDC4S' where id=$1",[r.canonicalTrackerId]);r.reviewedBefore=(await db.query('select app_private.cos_archive_before($1,$2,$3,$4) v',[r.archivedNativeId,r.canonicalNativeId,r.archivedTrackerId,r.canonicalTrackerId])).rows[0].v;await rejects(()=>install([r]),/Archive before-image/);
});
test('cycles, chains, many-to-one and self mappings are rejected atomically',async()=>{
 const a=await pair(),b=await pair('987655');
 for(const patch of [{archivedNativeId:a.canonicalNativeId,canonicalNativeId:a.archivedNativeId},{canonicalNativeId:a.canonicalNativeId},{archivedNativeId:a.canonicalNativeId},{canonicalTrackerId:a.canonicalTrackerId}])await rejects(()=>install([a,{...b,...patch}]),/Archive before-image|unique constraint/);
 await rejects(()=>install([{...a,canonicalNativeId:a.archivedNativeId}]),/check constraint/);assert.equal((await projection()).length,0);
});
for(const [name,query,endpoint] of [
 ['GPS',"update public.equipment_units set gps_latitude=29 where id=$1",'archivedNativeId'],
 ['before image',"update app_private.vision_tracker_locations set address='New location' where id=$1",'archivedTrackerId'],
 ['provider claim',"insert into public.vision_vigilant_unit_matches values(gen_random_uuid(),$1,gen_random_uuid())",'archivedNativeId'],
 ['history',"insert into public.equipment_unit_location_history values(gen_random_uuid(),$1,29,-95)",'archivedNativeId'],
 ['active assignment',"insert into public.equipment_assignments values(gen_random_uuid(),$1,'active')",'archivedNativeId'],
 ['manual edit',"insert into public.audit_events values(gen_random_uuid(),$1,'equipment_units','equipment_units.update')",'archivedNativeId'],
 ['Owner claim',"insert into app_private.cos_owner_identity_claims values(gen_random_uuid(),$1)",'archivedNativeId'],
 ['canonical identity reassignment',"update public.equipment_units set unit_number='Spotter 999999HDC4S' where id=$1",'canonicalNativeId'],
 ])test(name+' permanently cancels the projection',async()=>{
 const r=await pair();await install([r]);assert.equal((await projection()).length,1);await db.query(query,[r[endpoint]]);assert.equal((await projection())[0].state,'conflict');assert.equal((await db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,1);
 });
test('reverting a before-image cannot resurrect old archive evidence',async()=>{
 const r=await pair();await install([r]);await db.query("update app_private.vision_tracker_locations set address='New' where id=$1",[r.archivedTrackerId]);await db.query('update app_private.vision_tracker_locations set address=null where id=$1',[r.archivedTrackerId]);assert.equal((await projection())[0].state,'conflict');
});
test('privileged caller cannot rewrite or erase existing evidence',async()=>{
 const r=await pair();await install([r]);for(const q of ['update app_private.cos_archived_representations set review_sha256=review_sha256','delete from app_private.cos_archived_representations','truncate app_private.cos_archived_representations cascade'])await rejects(()=>db.exec(q),/Archive evidence is immutable/);
});

test('source binding creation cancels suppression, including a canonical source change',async()=>{
 for(const endpoint of ['archived','canonical']){
  await db.exec('savepoint source_case');
  const r=await pair();await install([r]);
  await db.query(`insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,source_file_sha256,source_row_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id)
   values($1,'equipment_unit',$2,$3,'12345',$4,$4,'SPOTTERS',$5,$5,$5,'SHOP',true,'tombstone',gen_random_uuid(),1)`,[ORG,r[endpoint+'NativeId'],r[endpoint+'TrackerId'],r.reviewedBefore[endpoint==='archived'?'oldNative':'canonicalNative'].unit_number,hash('synthetic source')]);
  assert.equal((await projection())[0].state,'conflict');assert.equal((await db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,1);
  await db.exec('rollback to source_case;release source_case');
 }
});
test('pre-existing provider, history, assignment or Owner conflicts cannot be admitted',async()=>{
 for(const q of ["insert into public.vision_vigilant_unit_matches values(gen_random_uuid(),$1,gen_random_uuid())","insert into public.equipment_unit_location_history values(gen_random_uuid(),$1,29,-95)","insert into public.equipment_assignments values(gen_random_uuid(),$1,'active')","insert into app_private.cos_owner_identity_claims values(gen_random_uuid(),$1)"]){
  const r=await pair();await db.query(q,[r.archivedNativeId]);await rejects(()=>install([r]),/Archive before-image or authority changed/);
 }
});
test('reviewed timestamp serialization is stable across caller timezones',async()=>{
 const r=await pair();await db.exec("set local timezone='America/Chicago'");await install([r]);assert.equal((await projection()).length,1);
});

test('unrelated native health observations do not revoke a reviewed representation',async()=>{
 const r=await pair();await install([r]);
 await db.query('update public.equipment_units set health_last_seen=now() where id in($1,$2)',[r.archivedNativeId,r.canonicalNativeId]);
 assert.equal((await projection()).length,1);assert.equal((await db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,0);
 // Canonical operational timestamps do not alter its stable physical identity.
 await db.query("update public.equipment_units set updated_at=updated_at+interval '1 second' where id=$1",[r.canonicalNativeId]);assert.equal((await projection())[0].state,'active');
});

test('canonical move, GPS, source refresh, Owner operation and health remain one representation',async()=>{
 const r=await pair();
 await db.query(`insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,source_file_sha256,source_row_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id)
 values($1,'equipment_unit',$2,$3,'12345',$4,$4,'SPOTTERS',$5,$5,$5,'SHOP',true,'tombstone',gen_random_uuid(),1)`,[ORG,r.canonicalNativeId,r.canonicalTrackerId,r.reviewedBefore.canonicalNative.unit_number,hash('synthetic source')]);
 r.reviewedBefore=(await db.query('select app_private.cos_archive_before($1,$2,$3,$4) v',[r.archivedNativeId,r.canonicalNativeId,r.archivedTrackerId,r.canonicalTrackerId])).rows[0].v;
 await install([r]);
 const operations=[
  ['update public.equipment_units set status=$1,current_location_type=$2,gps_latitude=30,gps_longitude=-95,updated_at=now() where id=$3',['installed','field',r.canonicalNativeId]],
  ["update app_private.vision_tracker_locations set address='New authorized site',latitude=30,longitude=-95,source_verified_at=now(),imported_at=now() where id=$1",[r.canonicalTrackerId]],
  ["update app_private.cos_geocode_sources set site_label='New authorized site',source_file_sha256=$1,source_row_sha256=$1 where native_unit_id=$2",[hash('refreshed source'),r.canonicalNativeId]],
  ["insert into public.audit_events values(gen_random_uuid(),$1,'equipment_units','equipment_units.update')",[r.canonicalNativeId]],
  ["insert into public.equipment_unit_location_history values(gen_random_uuid(),$1,30,-95)",[r.canonicalNativeId]],
  ["insert into app_private.cos_owner_identity_claims values(gen_random_uuid(),$1)",[r.canonicalNativeId]],
 ];
 for(const [q,args] of operations){await db.query(q,args);const result=await projection();assert.equal(result.length,1);assert.equal(result[0].state,'active');}
 assert.equal((await db.query('select count(*)::int n from app_private.cos_archived_representation_revocations')).rows[0].n,0);
});
test('canonical provider observation survives but provider identity reassignment becomes conflict',async()=>{
 const r=await pair(),provider=randomUUID();await db.query('insert into public.vision_vigilant_devices(id,organization_id,external_device_id,source,device_type) values($1,$2,$3,$4,$5)',[provider,ORG,'synthetic-resource','test','camera']);
 await db.query('insert into public.vision_vigilant_unit_matches values(gen_random_uuid(),$1,$2)',[r.canonicalNativeId,provider]);await install([r]);
 await db.query('update public.vision_vigilant_devices set last_seen_at=now() where id=$1',[provider]);assert.equal((await projection())[0].state,'active');
 await db.query("update public.vision_vigilant_devices set external_device_id='different-physical-resource' where id=$1",[provider]);assert.equal((await projection())[0].state,'conflict');
});

test('ongoing source identity ignores future presentation metadata but binds source system and record identity',async()=>{
 const one={organization_id:ORG,entity_kind:'equipment_unit',native_unit_id:randomUUID(),tracker_id:randomUUID(),product_id:'123',unit_number:'Synthetic 1',tracker_unit_number:'Synthetic 1',family:'Synthetic',variant:null,source_system:'mhelpdesk',source_record_id:'product:123'};
 const projection=async rows=>(await db.query('select app_private.cos_archive_source_identities($1) v',[rows])).rows[0].v;
 const expected=await projection([one]);assert.deepEqual(await projection([{...one,new_customer_label:'New customer',future_v2_observation:{updatedAt:'2099-01-01'}}]),expected);
 for(const patch of [{source_system:'another-system'},{source_record_id:'product:456'},{product_id:'456'}])assert.notDeepEqual(await projection([{...one,...patch}]),expected);
});
