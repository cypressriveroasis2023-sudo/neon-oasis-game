import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture as baseFixture,seed,ORG,hash} from './geocode-sources-database-fixture.mjs';
export {ORG,hash};
export const sql=name=>readFileSync(new URL('../../db/'+name,import.meta.url),'utf8');
export const extraSchema=`
 alter table public.equipment_units add column metadata jsonb default '{}',add column current_location_ref uuid,add column retired_at timestamptz;
 alter table app_private.vision_tracker_locations add column customer text,add column reviewed_estimate_epoch uuid default gen_random_uuid();
 create table public.equipment_unit_location_history(id uuid default gen_random_uuid(),organization_id uuid,equipment_unit_id uuid,latitude numeric,source text);
 create table app_private.cos_owner_identity_claims(id uuid default gen_random_uuid(),organization_id uuid,native_unit_id uuid,native_unit_label text,legacy_unit_key text,product_association jsonb,source_epoch text);
 create table app_private.cos_archived_representations(id uuid default gen_random_uuid(),organization_id uuid,archived_native_id uuid,canonical_native_id uuid,archived_tracker_id uuid,canonical_tracker_id uuid,revision uuid default gen_random_uuid());
 create table public.mhelpdesk_equipment_catalog(id uuid default gen_random_uuid(),organization_id uuid,product_id bigint,product_model text);
 create table app_private.vision_source_inventory_v1(organization_id uuid,registered_unit_id uuid,tracker_id uuid,unit_label text,source_record_id text,source_payload jsonb);
`;
export async function fixture({upgrade=true}={}){
 const db=await baseFixture();await db.exec(extraSchema);
 for(const name of ['cos-geocode-sources-read-access.sql','cos-geocode-sources-admin-import.sql','cos-tracker-source-v2.sql','source-precedence-contract.sql','cos-source-precedence.sql'])await db.exec(sql(name));
 await db.exec('revoke usage on schema app_private from service_role');
 if(upgrade)await db.exec(sql('cos-existing-tracker-source-v3.sql'));
 return db;
}
export const admin=async(db,records)=>(await db.query('select app_private.cos_existing_tracker_sources_admin_import_reviewed($1,$2) value',[ORG,records])).rows[0].value;
export const guard=async(db,r)=>(await db.query('select app_private.cos_existing_tracker_source_guard($1,$2,$3,$4) value',[r.nativeUnitId,r.trackerId,r.unitNumber,r.trackerUnitNumber])).rows[0].value;
export async function record(db,{family='Spotter',number='007',n=1}={}){
 const r=await seed(db,{label:family+' '+number,product:String(900000+n)});delete r.productId;
 r.family=family;r.variant=null;r.sourceSystem='google_sheet_tracker';r.sourceRecordId=`google_sheet:synthetic_sheet_123:12:${family}|${number}`;
 r.sourceProvenance={sheetId:'synthetic_sheet_123',tabId:'12',fullIdentity:family+'|'+number,sourceRange:`A${n}:L${n}`,sourceRangeSha256:hash('synthetic bounded range '+n)};
 r.customerLabel='Synthetic customer';r.siteLabel='Synthetic site';r.nativeGuardSha256=await guard(db,r);return r;
}
export async function reset(db){await db.exec('reset role;truncate app_private.cos_source_precedence_decisions,app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,public.mhelpdesk_equipment_catalog,app_private.vision_source_inventory_v1;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;');}
export const identity=s=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,sourceSystem:s.sourceSystem,sourceRecordId:s.sourceRecordId,sourceRevision:s.sourceRevision});
