import {readFile} from 'node:fs/promises';
import {fixture,org,sha,auth,request,t,n} from './source-admission-continuity.mjs';
export {org,sha,auth,request,t,n};
export const baselineSql=await readFile(new URL('./placement-snapshot-live-baseline.sql',import.meta.url),'utf8');
export const candidateSql=await readFile(new URL('../../db/mhelp-placement-snapshot-dedup.sql',import.meta.url),'utf8');
export const baselineCatalog=JSON.parse(await readFile(new URL('./placement-snapshot-live-catalog.json',import.meta.url),'utf8'));
export const catalogSql=`select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,
 encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
 p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef security_definer,p.provolatile volatility,
 p.proparallel parallel,p.proconfig settings,p.prorettype::regtype::text returns,lan.lanname language
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language lan on lan.oid=p.prolang
 where (n.nspname='public' and p.proname='cos_mhelp_placement_snapshot') or
 (n.nspname='cos_mhelp_placement_private' and p.proname in ('guard','upload_snapshot','upload_tracker_snapshot','upload_binding_guard','continuity_current'))
 order by n.nspname,p.proname`;
export const snapshot=async db=>(await db.query('select public.cos_mhelp_placement_snapshot($1,$2) value',[t(1),org])).rows[0].value;
export async function smallFixture(providedDb=null){
 const f=await fixture(2,providedDb);await f.db.exec(baselineSql);return f;
}
// Representative counts and deliberately generic generated values only. No imported source rows.
export async function representativeFixture(providedDb=null){
 const f=await smallFixture(providedDb),db=f.db;
 await db.exec(`insert into app_private.vision_tracker_locations(id,organization_id,unit_number,unit_key,family,placement,customer,site,address)
 select ('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,'${org}','Spotter '||lpad(i::text,3,'0'),'Spotter '||lpad(i::text,3,'0'),'SPOTTER','FIELD','Synthetic customer','Synthetic site','101 Example Road'
 from generate_series(3,770) i;
 insert into public.equipment_units(id,organization_id,unit_number,status)
 select ('22222222-2222-4222-8222-'||lpad(i::text,12,'0'))::uuid,'${org}','Spotter '||lpad(i::text,3,'0'),'available' from generate_series(3,378) i;
 update public.equipment_units set current_location_type=null;
 create unique index synthetic_tracker_identity on app_private.vision_tracker_locations(organization_id,unit_key);
 create unique index synthetic_native_identity on public.equipment_units(organization_id,unit_number);
 create index synthetic_history_unit on public.equipment_unit_location_history(equipment_unit_id);
 create index synthetic_claim_native on app_private.cos_owner_identity_claims(native_unit_id);
 insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,
 source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility)
 select '${org}',case when i<=237 then 'equipment_unit' else 'tracker' end,
 (case when i<=237 then '22222222-2222-4222-8222-' else '11111111-1111-4111-8111-' end||lpad(i::text,12,'0'))::uuid,
 ('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,(100+i)::text,'Spotter '||lpad(i::text,3,'0'),'Spotter '||lpad(i::text,3,'0'),'SPOTTER',
 '${sha}','${sha}','101 Example Road','Sample','TX','77001','${sha}','${sha}','FIELD',true,'FIELD' from generate_series(1,434) i;
 insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,full_label,source_revision,baseline_guard,baseline_customer_id,baseline_location_id,authorization_sha256,observation,observed_at)
 select s.product_id,s.tracker_id,case when s.entity_kind='equipment_unit' then s.native_unit_id end,s.tracker_unit_number,
 case when s.entity_kind='equipment_unit' then s.unit_number end,s.unit_number,s.source_revision,
 cos_mhelp_placement_private.guard(s.tracker_id,case when s.entity_kind='equipment_unit' then s.native_unit_id end),'12','88','${auth}',
 jsonb_build_object('state',case when s.product_id::int-100<=203 or s.product_id::int-100 between 238 and 401 then 'confirmed' else 'held' end,'reason',null,'placement','FIELD','customerId','12','serviceLocationId','88','customerLabel','Synthetic customer','siteLabel','Synthetic site'),
 '2026-01-01T12:00:00Z' from app_private.cos_geocode_sources s;`);
 const guards=(await db.query(`select i,cos_mhelp_placement_private.upload_binding_guard(
 ('11111111-1111-4111-8111-'||lpad(i::text,12,'0'))::uuid,
 case when i<=237 then ('22222222-2222-4222-8222-'||lpad(i::text,12,'0'))::uuid end) guard from generate_series(1,770) i`)).rows;
 const records=[],trackers=[];
 // 564 source bindings + 756 tracker bindings; overlap 550 => exactly 770 identities.
 const sourceIds=[...Array.from({length:550},(_,i)=>i+1),...Array.from({length:14},(_,i)=>i+757)];
 for(let i=0;i<1001;i++){
  const id=sourceIds[i],label='Spotter '+String(id||1000+i).padStart(3,'0');
  records.push({productId:String(100+i+1),unitNumber:label,category:'Spotter',customerId:'12',customer:'Synthetic customer',sourceAddress:{street:'101 Example Road',city:'Sample',state:'TX',zip:'77001'},sourceRow:i+2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:id?{trackerId:t(id),nativeUnitId:id<=237?n(id):null,expectedGuard:guards[id-1].guard,reviewEvidence:{privateSynthetic:true}}:null});
 }
 for(let i=1;i<=810;i++)trackers.push({recordId:'tracker:synthetic:'+String(i).padStart(4,'0'),unitNumber:'Spotter '+String(i).padStart(3,'0'),placement:'FIELD',lifecycle:'ACTIVE',ownerQuote:'Synthetic private quote',binding:i<=756?{state:'linked',trackerId:t(i),nativeUnitId:i<=237?n(i):null,expectedGuard:guards[i-1].guard,reviewEvidence:{privateSynthetic:true}}:{state:'held',trackerId:null,nativeUnitId:null,expectedGuard:null}});
 const receipt={...f.receipt,recordCount:1001,trackerRecords:trackers,trackerSource:{...f.receipt.trackerSource,totalSourceRecords:810}};
 await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1,records=$2',[receipt,records]);
 await db.exec('analyze');
 return {...f,records,receipt,population:{trackers:770,natives:378,links:434,confirmedLinks:367,sourceRecords:1001,sourceBound:564,trackerRecords:810,trackerLinked:756,distinctTriples:770}};
}
