import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
export const repo=fileURLToPath(new URL('../../',import.meta.url));
export const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',sha='a'.repeat(64),auth='b'.repeat(64),request='99999999-9999-4999-8999-999999999999';
export const t=i=>`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,n=i=>`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`;
export async function fixture(count=2,providedDb=null,options={}){
 const db=providedDb||new (await import('@electric-sql/pglite')).PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema app_private;
 create table app_private.vision_tracker_locations(id uuid primary key,organization_id uuid,unit_number text,unit_key text,family text,placement text,customer text,site text,address text,latitude float8,longitude float8,source_name text,source_verified_at timestamptz,imported_at timestamptz,coordinate_source text);
 create table public.equipment_units(id uuid primary key,organization_id uuid,unit_number text,model_id uuid,retired_at timestamptz,status text,installed_site_id uuid,current_location_ref uuid,current_location_type text,gps_latitude float8,gps_longitude float8,gps_recorded_at timestamptz,gps_source text,gps_recorded_by uuid,gps_accuracy_m float8);
 create table public.equipment_unit_location_history(equipment_unit_id uuid,note text);
 create table app_private.cos_owner_identity_claims(native_unit_id uuid,note text);
 create function app_private.appdeploy_assume_actor(uuid,uuid) returns void language sql as $$select null::void$$;
 create function app_private.has_permission(uuid,text) returns boolean language sql as $$select true$$;`);
 await db.exec(await readFile(repo+'db/cos-geocode-sources.sql','utf8'));
 await db.exec(await readFile(repo+'db/cos-geocode-sources-admin-import.sql','utf8'));
 await db.exec(await readFile(repo+'db/cos-tracker-source-v2.sql','utf8'));
 await db.exec(await readFile(repo+'db/source-precedence-contract.sql','utf8'));
 await db.exec(await readFile(repo+'db/cos-source-precedence.sql','utf8'));
 await db.exec(await readFile(repo+'db/cos-existing-tracker-source-v3.sql','utf8'));
 const archive=await readFile(repo+'db/cos-archived-representations.sql','utf8');
 await db.exec(archive.slice(archive.indexOf('create table app_private.cos_archived_representations'),archive.indexOf('-- Exactly the reviewed allowlist')));
 await db.exec(archive.slice(archive.indexOf('create function app_private.cos_archive_changed()'),archive.indexOf('create trigger cos_archive_native_changed')));
 await db.exec("create trigger cos_archive_source_changed after insert or update or delete on app_private.cos_geocode_sources for each row execute function app_private.cos_archive_changed('native_unit_id');");
 await db.exec(await readFile(repo+'db/source-recorded-coordinates.sql','utf8'));
 await db.exec(await readFile(repo+'tests/fixtures/source-admission-trigger-baseline.sql','utf8'));
 await db.exec(await readFile(repo+'db/20261012173408_cos_mhelp_placement_sync.sql','utf8'));
 await db.exec(await readFile(repo+'db/mhelp_upload_overlay.sql','utf8'));
 const records=[],trackers=[];
 for(let i=1;i<=count;i++){
  const label='Spotter '+String(i).padStart(3,'0');
  await db.query(`insert into app_private.vision_tracker_locations(id,organization_id,unit_number,unit_key,family,placement,customer,site,address) values($1,$2,$3,$3,'SPOTTER','FIELD','Synthetic customer','Synthetic site','101 Example Road')`,[t(i),org,label]);
  await db.query(`insert into public.equipment_units(id,organization_id,unit_number,status,current_location_type) values($1,$2,$3,'available','field')`,[n(i),org,label]);
  if(i===1&&options.archive)await db.query(`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)`,[org,n(90),n(i),t(90),t(i),sha]);
  if(i===1&&options.coordinates){const cb=(await db.query("select app_private.cos_recorded_coordinate_binding('equipment_unit',$1,$2,$3,$3,$4,'SPOTTER') b",[n(i),t(i),label,String(100+i)])).rows[0].b;
   await db.query(`insert into app_private.cos_source_recorded_coordinates(organization_id,entity_kind,native_unit_id,tracker_id,payload) values($1,'equipment_unit',$2,$3,$4)`,[org,n(i),t(i),{productId:String(100+i),unitNumber:label,trackerUnitNumber:label,family:'SPOTTER',binding:cb}]);}
  const guard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[t(i),n(i)])).rows[0].g;
  const binding={productId:String(100+i),trackerId:t(i),nativeUnitId:n(i),trackerLabel:label,nativeLabel:label,fullLabel:label,matchMethod:'exact_family_unit',canonicalKey:'SPOTTER:'+i,representedUnitIds:[n(i)],representationEvidenceSha256:sha,reviewEvidence:{method:'synthetic'},evidenceSha256:sha,expectedGuard:guard};
  records.push({productId:String(100+i),unitNumber:label,category:'Spotter',customerId:'12',customer:'Synthetic customer',sourceAddress:{street:'101 Example Road',city:'Sample',state:'TX',zip:'77001'},sourceRow:i+1,placement:'FIELD',lifecycle:'UNFLAGGED',placementHeld:false,binding});
  trackers.push({recordId:'tracker:synthetic:'+i,unitNumber:label,placement:'FIELD',lifecycle:'ACTIVE',matchedProductId:String(100+i),binding:{state:'linked',trackerId:t(i),nativeUnitId:n(i),unitIds:[t(i),n(i)],representedUnitIds:[n(i)],unitLabels:{[t(i)]:label,[n(i)]:label},expectedGuard:guard}});
 }
 const receipt={contract:'COS_MHELP_UPLOAD_V1',sourceSha256:sha,libraryFileId:'libfile_synthetic',receivedAt:'2026-01-01T12:00:00Z',receivedAtPrecision:'minute',receivedMessageId:'SyntheticMessage',exportAsOf:null,authorizationSha256:auth,recordCount:count,companyCustomerIds:['11'],trackerSource:{contract:'COS_CURRENT_TRACKER_CENSUS_V1',complete:true,sourceSha256:sha,observedAt:'2026-01-01T12:00:00Z',totalSourceRecords:count},trackerRecords:trackers};
 await db.query('select cos_mhelp_placement_private.review_upload($1,$2,null,true)',[receipt,records]);
 await db.exec(await readFile(repo+'db/mhelp-source-continuity.sql','utf8'));
 const admissions=[];
 for(let i=1;i<=count;i++){
  const r=records[i-1];const hashes=(await db.query(`select app_private.cos_source_native_guard('equipment_unit',$1,$2,$3,$3) native, encode(sha256(convert_to(app_private.cos_source_address('101 Example Road','Sample','TX','77001'),'UTF8')),'hex') address,encode(sha256(convert_to(($4::jsonb-'binding')::text,'UTF8')),'hex') row`,[n(i),t(i),r.unitNumber,r])).rows[0];
  admissions.push({entityKind:'equipment_unit',nativeUnitId:n(i),trackerId:t(i),productId:r.productId,unitNumber:r.unitNumber,trackerUnitNumber:r.unitNumber,family:'SPOTTER',variant:null,sourceFileSha256:sha,sourceRowSha256:hashes.row,installation:{street:'101 Example Road',city:'Sample',state:'TX',zip:'77001'},addressSha256:hashes.address,nativeGuardSha256:hashes.native,suppliedComponents:{street:true,city:true,state:true,zip:true},previousSourceRevision:null,placement:'FIELD',siteLabel:r.customer});
 }
 const expected=(await db.query('select cos_mhelp_placement_private.continuity_bindings($1) b',[admissions])).rows[0].b;
 const payload=(await db.query('select payload_sha256 p from cos_mhelp_placement_private.upload_batches')).rows[0].p;
 const call=async(a=admissions,e=expected,id=request)=>(await db.query('select cos_mhelp_placement_private.admit_sources_continuity($1,$2,$3,$4,$5,$6,$7) result',[id,org,sha,payload,a,e,auth])).rows[0].result;
 const rollback=async()=>(await db.query('select cos_mhelp_placement_private.rollback_sources_continuity($1,$2,$3,$4) result',[request,sha,payload,auth])).rows[0].result;
 const snapshot=async()=>(await db.query('select cos_mhelp_placement_private.upload_snapshot() s')).rows[0].s;
 const counts=async()=>(await db.query(`select (select count(*) from app_private.cos_geocode_sources)::int sources,(select count(*) from app_private.cos_geocode_source_events)::int events,(select count(*) from cos_mhelp_placement_private.source_admissions)::int admissions,(select count(*) from cos_mhelp_placement_private.source_continuity)::int transitions`)).rows[0];
 return {db,records,receipt,admissions,expected,payload,call,rollback,snapshot,counts};
}
