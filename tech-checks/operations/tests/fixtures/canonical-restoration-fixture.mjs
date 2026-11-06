import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture as scopedFixture,actor,org} from './scoped-inventory-fixture.mjs';
import {disposableRestorationPostgres} from './canonical-restoration-postgres.mjs';
import {prepareCanonicalBindingRestorationSql,restorationDependencies} from '../../scripts/prepareCanonicalBindingRestorationSql.mjs';
import {sevenProducts} from '../../scripts/analyzeCanonicalBindingEvidence.mjs';
export {actor,org};
const file=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function restorationFixture({beforeInstall,beforeApply,database}={}){
 if(!database&&process.env.COS_RESTORATION_TEST_DATABASE_URL)database=await disposableRestorationPostgres();
 const f=await scopedFixture({database});const db=f.db;
 try{
  await db.exec(`alter table app_private.vision_tracker_locations add column ip text,add column sim text;
   create table public.vision_vigilant_devices(id uuid,organization_id uuid,external_device_id text,history jsonb);
   create table public.vision_vigilant_unit_matches(id uuid,organization_id uuid,equipment_unit_id uuid,camera_key text);
   create table app_private.cos_owner_identity_resources(device_id text,claim_id uuid);
   create table app_private.cos_owner_identity_revocations(claim_id uuid);
   create table app_private.cos_owner_identity_source_events(id bigint,native_unit_id uuid);
   create table public.user_profiles(user_id uuid,organization_id uuid,active boolean,department text);
   create table public.user_roles(user_id uuid,role_id uuid);
   create table public.roles(id uuid,organization_id uuid,code text);
   insert into public.user_profiles values('${actor}','${org}',true,'owner');
   insert into public.roles values('${actor}','${org}','owner');
   insert into public.user_roles values('${actor}','${actor}');`);
  await db.exec(`
   alter table public.equipment_units add column model_id uuid,add column updated_at timestamptz,add column gps_accuracy_m float8,add column gps_source text,add column gps_recorded_by uuid;
   alter table app_private.vision_tracker_locations add column coordinate_source text,add column source_name text,add column source_verified_at timestamptz,add column imported_at timestamptz,add column reviewed_estimate_epoch uuid;
   alter table app_private.cos_archived_representations add column id uuid default gen_random_uuid(),add column organization_id uuid,add column reviewed_before jsonb;
   create table app_private.cos_archived_representation_revocations(representation_id uuid);
   create table public.equipment_models(id uuid primary key,name text,category text);
   create table public.equipment_assignments(equipment_unit_id uuid,status text);
   create table public.audit_events(entity_id uuid,entity_type text,event_type text);
  `);
  const archive=file('db/cos-archived-representations.sql');
  await db.exec(archive.slice(archive.indexOf('create function app_private.cos_archive_native_before('),archive.indexOf('-- Invoker-only administrative import:')));
  // Real repository Owner directory/role assertion, no permissive Owner stub.
  const owner=file('db/owner_identity_crosswalk.sql');
  const a=owner.indexOf('create function app_private.cos_owner_identity_assert_actor('),z=owner.indexOf('create function app_private.cos_owner_identity_snapshot_value(');
  await db.exec('drop function app_private.cos_owner_identity_assert_actor(uuid,uuid,boolean);'+owner.slice(a,z));
  // Underlying permission fixture is explicit and can be revoked in tests.
  await db.exec(`create or replace function app_private.appdeploy_assume_actor(a uuid,o uuid) returns void language plpgsql as $$begin if a is distinct from '${actor}'::uuid or o is distinct from '${org}'::uuid then raise exception 'Unverified actor';end if;end$$;`);
  await db.exec(file('docs/drafts/cos-owner-canonical-evidence.sql'));
  // Apply the same production canonical-evidence importer anchors used by
  // prepareOwnerCanonicalEvidenceSql, to the real repository importer SQL.
  let live=file('db/mhelp-live-inventory.sql');
  live=live.replace('baseline jsonb;base_sha text;','identity_evidence jsonb;baseline jsonb;base_sha text;')
   .replace('baseline:=cos_mhelp_placement_private.upload_snapshot();',"baseline:=cos_mhelp_placement_private.upload_snapshot();\n identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(coalesce(baseline->'apiMissingRecords','[]'::jsonb)||(baseline->'records'));")
   .replace("b:=(old->'binding')-'guardCurrent';","b:=(identity_evidence->'bindings'->(old->>'productId')->'binding')-'guardCurrent';");
  await db.exec(live);
  const historical=[],rows=[];const targets=[];
  for(const [productId,unitNumber] of Object.entries(sevenProducts)){
   const tracker=randomUUID(),native=randomUUID();targets.push({productId,tracker,native});
   await db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,ip,sim) values($1,$2,$3,'192.0.2.9','synthetic-sim')",[tracker,org,unitNumber]);
   await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,$3,'available')",[native,org,unitNumber]);
   await db.query('insert into public.equipment_unit_location_history values($1)',[native]);
   await db.query("insert into public.vision_vigilant_devices values($1,$2,'synthetic-camera','[{\"old\":true}]')",[native,org]);
   const guard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[tracker,native])).rows[0].g;
   const binding={productId,fullLabel:unitNumber,trackerId:tracker,nativeUnitId:native,trackerLabel:unitNumber,nativeLabel:unitNumber,
    matchMethod:'exact_family_unit',canonicalKey:'SYNTHETIC:'+productId,reviewEvidence:{kind:'synthetic-private',productId},evidenceSha256:'e'.repeat(64),
    representationEvidenceSha256:'f'.repeat(64),representedUnitIds:[native],expectedGuard:guard};
   const row={productId,unitNumber,category:'Spotter',customerId:'11',customer:'Company',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:rows.length+2,
    sourceAddress:{street:'Recorded',city:'Houston',state:'TX',zip:'77001'},apiAssignment:{customerId:'11',equipmentTypeId:'9'},binding:null,
    placementHeld:true,holdReason:'Source assignment or protection changed; Owner installation review required'};
   rows.push(row);historical.push({...row,binding});
  }
  // Inventory-only and separately identified camera rows are outside all writes.
  rows.push({productId:'999001',unitNumber:'Sniper 230',binding:null,placement:'SHOP',lifecycle:'UNFLAGGED',inventoryOnlyReason:'no_sim',sourceRow:9});
  rows.push({productId:'999002',unitNumber:'Ranger 029.1',binding:null,sourceRow:10});
  rows.push({productId:'999003',unitNumber:'Ranger 029.2',binding:null,sourceRow:11});
  const base='d'.repeat(64),historySha='b'.repeat(64);
  const saveBatch=async(sha,receipt,data)=>db.query("insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex'),$2,$3)",[sha,JSON.stringify(receipt),JSON.stringify(data)]);
  const histReceipt={...f.receipt,reviewed:true,sourceSha256:historySha,recordCount:historical.length};
  await saveBatch(historySha,histReceipt,historical);
  const receipt={...f.receipt,sourceSha256:base,contract:'COS_MHELP_API_V1',portalId:'224643',complete:true,reviewed:true,recordCount:rows.length,trackerRecords:[]};
  await saveBatch(base,receipt,rows);
  await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[base]);
  await db.query('update cos_mhelp_placement_private.live_inventory_control set enabled=true,active_source_sha256=$1,last_success_at=clock_timestamp()',[base]);
  if(beforeInstall)await beforeInstall({db,rows,historical,historySha,histReceipt,saveBatch,base,targets});
  const installed={};for(const sig of restorationDependencies)installed[sig]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[sig])).rows[0].d;
  const candidate=await prepareCanonicalBindingRestorationSql(installed);
  if(beforeApply)await beforeApply({db,candidate});
  await db.exec(candidate);
  const expected=(await db.query("select jsonb_build_object('sourceSha256',$1::text,'payloadSha256',b.payload_sha256,'scopedRevision',0,'scopedSha256',cos_binding_restoration_private.digest(b.records)) v from cos_mhelp_placement_private.upload_batches b where source_sha256=$1",[base])).rows[0].v;
  const request=randomUUID(),confirmation='I approve restoring these seven exact historical canonical bindings only.';
  const call=async(action,digest=null,extra={})=>(await db.query('select public.cos_owner_restore_seven_bindings_v1($1,$2,$3,$4,$5,$6,$7) v',
   [extra.actor??actor,extra.org??org,extra.request??request,action,JSON.stringify(extra.expected??expected),digest,extra.confirmation??(action==='commit'?confirmation:null)])).rows[0].v;
  const stored=async()=>(await db.query("select cos_mhelp_placement_private.scoped_records($1) v",[base])).rows[0].v;
  const protectedTables=['equipment_units','vision_vigilant_devices','vision_vigilant_unit_matches'].map(t=>'public.'+t)
   .concat(['vision_tracker_locations','cos_geocode_sources','cos_archived_representations','cos_archived_representation_revocations','cos_owner_identity_claims','cos_owner_identity_resources','cos_owner_identity_revocations','cos_owner_identity_source_events'].map(t=>'app_private.'+t),'public.equipment_unit_location_history','cos_mhelp_placement_private.links','cos_mhelp_placement_private.upload_batches');
  const preserved=async()=>{const out={};for(const table of protectedTables)out[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') v from ${table} t`)).rows[0].v;return out;};
  return {db,call,stored,preserved,targets,request,expected,confirmation,rows,historical,base,installed};
 }catch(e){await db.close();delete e.query;throw e;}
}
