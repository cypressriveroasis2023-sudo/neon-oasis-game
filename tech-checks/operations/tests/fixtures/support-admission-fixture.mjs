import {readFile} from 'node:fs/promises';
import {fixture as sourceFixture,ORG,hash} from './geocode-sources-database-fixture.mjs';
export {ORG,hash};
export async function fixture(){
 const db=await sourceFixture();
 await db.exec(`
 alter table public.equipment_units add column metadata jsonb not null default '{}';
 alter table app_private.vision_tracker_locations alter column id set default gen_random_uuid();
 alter table app_private.vision_tracker_locations alter column imported_at set default now();
 alter table app_private.vision_tracker_locations add column customer text;
 alter table app_private.vision_tracker_locations add column reviewed_estimate_epoch uuid;
 alter table app_private.vision_tracker_locations add column unit_key text generated always as (regexp_replace(lower(unit_number),'[^a-z0-9]','','g')) stored;
 alter table app_private.vision_tracker_locations add unique(organization_id,unit_key);
 alter table app_private.vision_tracker_locations add check(placement in ('FIELD','SHOP'));
 alter table app_private.vision_tracker_locations add check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180));
 create table public.vision_vigilant_devices(id uuid default gen_random_uuid(),organization_id uuid,device_name text,device_type text);
 create table public.vision_vigilant_unit_matches(id uuid default gen_random_uuid(),organization_id uuid,equipment_unit_id uuid,camera_key text);
 create table public.vision_cameras(id uuid default gen_random_uuid(),organization_id uuid,equipment_unit_id uuid,camera_key text,internal_name text,customer_label text);
 create table public.equipment_models(id uuid primary key,name text);
 create table app_private.cos_owner_identity_claims(id uuid default gen_random_uuid(),organization_id uuid,native_unit_id uuid,native_unit_label text,legacy_unit_key text,product_association jsonb);
 create table public.audit_events(id uuid default gen_random_uuid(),organization_id uuid,entity_id uuid,previous_value jsonb,new_value jsonb);
 create table public.equipment_unit_location_history(id uuid default gen_random_uuid(),organization_id uuid,equipment_unit_id uuid);
 create table app_private.vision_source_inventory_v1(organization_id uuid,source_record_id text,unit_label text,unit_family text,source_payload jsonb,tracker_id uuid,registered_unit_id uuid);
 create table public.mhelpdesk_equipment_catalog(organization_id uuid,product_id bigint,product_model text,normalized_family text);
 revoke usage on schema app_private from service_role;`);
 await db.exec((await readFile(new URL('../../db/geocodio_reviewed_estimates.sql',import.meta.url),'utf8')).split('CREATE OR REPLACE FUNCTION public.appdeploy_field_map_snapshot')[0]);
 for(const file of ['cos-geocode-sources-admin-import.sql','support-source-admission.sql'])await db.exec(await readFile(new URL('../../db/'+file,import.meta.url),'utf8'));
 return db;
}
export function record(overrides={}){
 const installation={street:'123 Example Rd',city:'Example City',state:'TX',zip:'77002'};
 return {productId:'9000001',sourceLabel:'ST 901',kind:'stand',number:'901',capacity:null,sourceCategory:'Stand',sourceFileSha256:hash('synthetic-source-file'),sourceRowSha256:hash('synthetic-source-row'),sourceObservedAt:'2026-01-01T00:00:00Z',installation,originalInstallation:{...installation},normalization:'none',customer:'Synthetic Customer',siteLabel:'Synthetic Site',...overrides};
}
export function review(overrides={}){
 const readAt=new Date(Date.now()-1000).toISOString();
 return {reviewedAt:new Date().toISOString(),manifestSha256:hash('synthetic-manifest'),sourceFileSha256:hash('synthetic-source-file'),classifierVerified:true,inventories:['mhelp','tracker','archive','legacy'].map(kind=>({kind,sha256:hash(kind),readAt,rowCount:100,complete:true,conflicts:[]})),...overrides};
}
export async function admit(db,rows=[record()],apply=true,receipt=review(),org=ORG){return(await db.query('select app_private.cos_support_admit_reviewed($1,$2,$3,$4) value',[org,JSON.stringify(rows),JSON.stringify(receipt),apply])).rows[0].value;}
export async function withdraw(db,rows,org=ORG){return(await db.query('select app_private.cos_support_withdraw_reviewed($1,$2) value',[org,JSON.stringify(rows)])).rows[0].value;}
export async function state(db){return(await db.query(`select jsonb_build_object(
 'targets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')from app_private.vision_tracker_locations t),
 'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by native_unit_id),'[]')from app_private.cos_geocode_sources s),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by event_id),'[]')from app_private.cos_geocode_source_events e),
 'admissions',(select coalesce(jsonb_agg(to_jsonb(a) order by product_id),'[]')from app_private.cos_support_admissions a),
 'equipment',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]')from public.equipment_units u),
 'audits',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')from public.audit_events a)) value`)).rows[0].value;}
export async function reset(db){await db.exec(`reset role;truncate app_private.cos_support_admissions,app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units,public.equipment_models,public.vision_vigilant_devices,public.vision_vigilant_unit_matches,public.vision_cameras,app_private.cos_owner_identity_claims,public.audit_events,public.equipment_unit_location_history,app_private.vision_source_inventory_v1,public.mhelpdesk_equipment_catalog;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;`);}
