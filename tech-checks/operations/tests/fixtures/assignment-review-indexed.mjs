import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {assignmentPostgres} from './assignment-postgres.mjs';

export const baseline=readFileSync(new URL('./assignment-review-before-20261021.sql',import.meta.url),'utf8');
export const signature='cos_mhelp_placement_private.assignment_review(uuid)';
export const stageId='11111111-1111-4111-8111-111111111111';
export const organizationId='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const activeSha='a'.repeat(64);
const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=(kind,index)=>`${String(kind).padStart(8,'0')}-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
const modelId=uuid(9,0);
const five=[['2233383','Solar Spotter 013'],['2300344','Solar Spotter 054'],['2226860','Spotter 261HDC2'],['2229407','Solar Spotter 008'],['2229931','Solar Stand 015']];
const address={street:'Recorded service address',city:'Houston',state:'TX',zip:'77001'};

/** Synthetic Product IDs and private state only. The five named regression
 * cases retain their required relationships, never real production credentials. */
export function reviewData(total=1001,held=354){
 const scoped=[],records=[],snapshots=[],natives=[],trackers=[],moves=[],links=[];
 for(let i=0;i<total;i++){
  const [productId,unitNumber]=five[i]||[String(8000000+i),`Synthetic Unit ${i}`];
  const bound=i<held,nativeId=i===4?null:uuid(1,i),trackerId=uuid(2,i);
  const changedGuard=i===1||i===2,currentGuard=digest(`protected:${productId}`);
  const binding=bound?{productId,fullLabel:unitNumber,nativeUnitId:nativeId,nativeLabel:nativeId?unitNumber:null,trackerId,trackerLabel:unitNumber,
   matchMethod:'reviewed_product_id',expectedGuard:changedGuard?digest(`before-shop:${productId}`):currentGuard}:null;
  const old={productId,unitNumber,category:'SPOTTER',placement:i===0?'SHOP':'FIELD',lifecycle:'UNFLAGGED',customer:i===0?'Shop':'Recorded customer',customerId:i===0?'100':'200',sourceAddress:address,binding};
  const proposed={...old,placement:i===0?'FIELD':i<5?'SHOP':old.placement,customer:i===0?'HEB Aledo':i<5?'Shop':old.customer,customerId:i===0?'300':i<5?'100':old.customerId,
   sourceAddress:i===0?{street:'14820 Skyline Ridge Rd',city:'Aledo',state:'TX',zip:'76008'}:address,
   ...(bound?{binding:null,placementHeld:true,holdReason:'Explicit existing identity review required'}:{})};
  scoped.push(old);records.push(proposed);
  if(!bound)continue;
  const reference={productId,customerId:old.customerId,placement:old.placement,serviceLocationId:null,observedAt:'2026-10-20T12:00:00Z'};
  // Full fixture:344 timestamp differences,8 assignment differences,2 no
  // continuity differences, in addition to the five actual source changes.
  const kind=i===1||i===2?null:i===0||i===3||i===4||i>=349?'assignment_difference':'timestamp_only';
  const continuity=kind?{kind,previousAssignment:reference,currentAssignment:{...reference,observedAt:'2026-10-21T12:00:00Z',...(kind==='assignment_difference'?{customerId:'999'}:{})}}:null;
  const link={equipment_id:productId,tracker_id:trackerId,native_unit_id:nativeId,full_label:unitNumber};links.push(link);
  const move=changedGuard?{id:uuid(3,i),unit_id:nativeId,organization_id:organizationId,unit_number:unitNumber,model_id:modelId,created_at:'2026-10-20T16:00:00Z',source_bindings:[{productId,sourceSha256:activeSha,sourceUnitNumber:unitNumber}]}:null;
  if(move)moves.push(move);
  snapshots.push({productId,originalBinding:binding,currentLinks:[link],shopReceipt:move,referenceEligible:true,protectedStateSha256:currentGuard,continuity,
   canonicalIdentityEvidence:{binding,provenance:null}});
  if(nativeId)natives.push({id:nativeId,organization_id:organizationId,unit_number:unitNumber,model_id:modelId,current_location_type:changedGuard?'shop':'field',status:changedGuard?'available':'installed',
   gps_latitude:i===0?32.70:null,gps_longitude:i===0?-97.60:null,gps_verified:false,installed_site_id:null,current_location_ref:null,retired_at:null,
   operational_ip:`192.0.2.${i%253+1}`,sim:`preserve-sim-${i}`});
  trackers.push({id:trackerId,organization_id:organizationId,unit_number:unitNumber,placement:changedGuard?'SHOP':'FIELD',customer:i===0?'Old internal customer':'Internal customer',site:i===0?'Old internal site':'Internal site',
   latitude:i===0?32.70:null,longitude:i===0?-97.60:null,gps_verified:false,operational_ip:`198.51.100.${i%253+1}`,sim:`preserve-tracker-sim-${i}`});
 }
 return {scoped,original:structuredClone(scoped),records,savedSnapshots:structuredClone(snapshots),currentSnapshots:snapshots,natives,trackers,moves,links,
  archived:[],geocode:[],claims:[],receiptContract:'COS_OWNER_ASSIGNMENT_CONTINUITY_V1',reviewReceipt:{}};
}

const tables={
 'public.equipment_units':'natives','app_private.vision_tracker_locations':'trackers','app_private.cos_fleet_shop_moves':'moves','cos_mhelp_placement_private.links':'links',
 'app_private.cos_archived_representations':'archived','app_private.cos_geocode_sources':'geocode','app_private.cos_owner_identity_claims':'claims',
};
export async function fixture(){
 const db=process.env.COS_ASSIGNMENT_POSTGRES_CI==='1'?assignmentPostgres():new PGlite();
 try{
  await db.exec(`
   create role anon;create role authenticated;create role service_role;
   create schema app_private;create schema cos_mhelp_placement_private;
   create table cos_mhelp_placement_private.owner_equipment_stages(id uuid primary key,actor_id uuid,organization_id uuid,applied_at timestamptz,expires_at timestamptz,source_bytes bytea,source_sha256 text,
    expected_active_sha256 text,expected_scoped_revision bigint,expected_scoped_sha256 text,records jsonb,receipt jsonb,review_receipt jsonb,verified_2027_sha256 text);
   create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);
   create table cos_mhelp_placement_private.scoped_control(base_sha256 text,revision bigint);
   create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,records jsonb);
   create table cos_mhelp_placement_private.fixture_source(singleton boolean primary key,scoped jsonb,failure_product text);
   create table cos_mhelp_placement_private.fixture_snapshots(product_id text primary key,snapshot jsonb);
   create table app_private.vision_tracker_locations(id uuid primary key,organization_id uuid,unit_number text,placement text,customer text,site text,latitude numeric,longitude numeric,gps_verified boolean,operational_ip text,sim text);
   create table public.equipment_units(id uuid primary key,organization_id uuid,unit_number text,model_id uuid,current_location_type text,status text,gps_latitude numeric,gps_longitude numeric,gps_verified boolean,installed_site_id uuid,current_location_ref text,retired_at timestamptz,operational_ip text,sim text);
   create table app_private.cos_fleet_shop_moves(id uuid primary key,unit_id uuid,organization_id uuid,unit_number text,model_id uuid,created_at timestamptz,source_bindings jsonb);
   create table app_private.cos_archived_representations(archived_tracker_id uuid,canonical_tracker_id uuid,archived_native_id uuid,canonical_native_id uuid);
   create table app_private.cos_geocode_sources(active boolean,tracker_id uuid,native_unit_id uuid,product_id text);
   create table app_private.cos_owner_identity_claims(native_unit_id uuid);
   create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,full_label text);
   create function cos_mhelp_placement_private.scoped_records(p_source text) returns jsonb language sql stable set search_path='' as $$select scoped from cos_mhelp_placement_private.fixture_source where singleton$$;
   -- This fixture isolates the changed function. The existing integration suite
   -- covers actual canonical recovery, locks and transaction admission.
   create function cos_mhelp_placement_private.assignment_review_snapshot(p_record jsonb) returns jsonb language plpgsql stable set search_path='' as $$begin
    if p_record->>'productId'=(select failure_product from cos_mhelp_placement_private.fixture_source where singleton) then raise exception 'synthetic evidence read failure';end if;
    return (select snapshot from cos_mhelp_placement_private.fixture_snapshots where product_id=p_record->>'productId');
   end $$;
   ${baseline};
   alter function cos_mhelp_placement_private.assignment_review(uuid) owner to postgres;
   revoke all on function cos_mhelp_placement_private.assignment_review(uuid) from public,anon,authenticated,service_role;
  `);
  const load=async data=>{
   await db.exec('truncate cos_mhelp_placement_private.owner_equipment_stages,cos_mhelp_placement_private.upload_control,cos_mhelp_placement_private.scoped_control,cos_mhelp_placement_private.upload_batches,cos_mhelp_placement_private.fixture_source,cos_mhelp_placement_private.fixture_snapshots,'+Object.keys(tables).join(','));
   for(const [table,key]of Object.entries(tables))await db.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table},$1::jsonb)`,[JSON.stringify(data[key])]);
   await db.query('insert into cos_mhelp_placement_private.fixture_source values(true,$1::jsonb,null)',[JSON.stringify(data.scoped)]);
   await db.query('insert into cos_mhelp_placement_private.fixture_snapshots select x->>\'productId\',x from jsonb_array_elements($1::jsonb) x',[JSON.stringify(data.currentSnapshots)]);
   await db.query('insert into cos_mhelp_placement_private.upload_control values(true,$1)',[activeSha]);
   await db.query('insert into cos_mhelp_placement_private.scoped_control values($1,7)',[activeSha]);
   await db.query('insert into cos_mhelp_placement_private.upload_batches values($1,$2::jsonb)',[activeSha,JSON.stringify(data.original)]);
   const receipt={assignmentContinuity:{contract:data.receiptContract,items:data.savedSnapshots}};
   await db.query(`insert into cos_mhelp_placement_private.owner_equipment_stages select $1::uuid,$2::uuid,$3::uuid,null,'2099-01-01'::timestamptz,convert_to('exact-synthetic-original-file','UTF8'),encode(sha256(convert_to('exact-synthetic-original-file','UTF8')),'hex'),$4,7,
    encode(sha256(convert_to(scoped::text,'UTF8')),'hex'),$5::jsonb,$6::jsonb,$7::jsonb,$8 from cos_mhelp_placement_private.fixture_source where singleton`,[stageId,uuid(8,0),organizationId,activeSha,JSON.stringify(data.records),JSON.stringify(receipt),JSON.stringify(data.reviewReceipt),'b'.repeat(64)]);
  };
  const read=()=>db.query('select cos_mhelp_placement_private.assignment_review($1::uuid) value',[stageId]).then(r=>r.rows[0].value);
  const catalog=()=>db.query(`select pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef,p.provolatile,p.proconfig,
   has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
   from pg_proc p where p.oid=$1::regprocedure`,[signature]).then(r=>r.rows[0]);
  // Hash the complete sorted state inside PostgreSQL so the real-PG adapter
  // need not print megabytes of synthetic protected records through psql.
  const protectedState=()=>db.query(`select encode(sha256(convert_to(jsonb_build_object(${[...Object.keys(tables),'cos_mhelp_placement_private.owner_equipment_stages','cos_mhelp_placement_private.upload_control','cos_mhelp_placement_private.scoped_control','cos_mhelp_placement_private.upload_batches','cos_mhelp_placement_private.fixture_source','cos_mhelp_placement_private.fixture_snapshots'].map(t=>`'${t}',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from ${t} x)`).join(',')})::text,'UTF8')),'hex') value`).then(r=>r.rows[0].value);
  return {db,load,read,catalog,protectedState};
 }catch(error){await db.close();throw error;}
}
