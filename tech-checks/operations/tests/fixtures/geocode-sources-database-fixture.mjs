import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
export const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export async function fixture(){
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema app_private;
  create table public.equipment_units(id uuid primary key,organization_id uuid,unit_number text,model_id uuid,
   status text,current_location_type text,installed_site_id uuid,gps_latitude float8,gps_longitude float8,gps_recorded_at timestamptz,
   gps_source text,gps_recorded_by uuid,gps_accuracy_m float8,health_last_seen timestamptz);
  create table app_private.vision_tracker_locations(id uuid primary key,organization_id uuid,unit_number text,family text,
   placement text,site text,address text,source_name text,source_verified_at timestamptz,imported_at timestamptz,
   latitude float8,longitude float8,coordinate_source text,location_note text);
  grant usage on schema app_private to service_role;
  grant select,insert,update,delete on public.equipment_units,app_private.vision_tracker_locations to service_role;`);
  await db.exec(await readFile(new URL('../../db/cos-geocode-sources.sql',import.meta.url),'utf8'));
  return db;
 }catch(error){await db.close();throw error;}
}
export async function rpc(db,name,args,role='service_role'){
 await db.exec('reset role');await db.exec('set role '+role);
 try{return (await db.query('select public.cos_geocode_sources_'+name+'('+Object.keys(args).map((key,i)=>key+'=>$'+(i+1)).join(',')+') value',Object.values(args))).rows[0].value;}
 finally{await db.exec('reset role');}
}
export async function seed(db,{kind='equipment_unit',label='HELIOS 099HDC4',product='12345',placement='FIELD'}={}){
 const native=randomUUID(),tracker=kind==='tracker'?native:randomUUID();
 if(kind==='equipment_unit') await db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,$3,'available')",[native,ORG,label]);
 await db.query(`insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement,address,source_name,imported_at)
  values($1,$2,$3,'HELIOS','FIELD','1 historical ave, houston, tx 77002','Synthetic tracker',now())`,[tracker,ORG,label]);
 const guard=(await db.query('select app_private.cos_source_native_guard($1,$2,$3,$4,$4) value',[kind,native,tracker,label])).rows[0].value;
 const installation=placement==='FIELD'?{street:'123 Main St',city:'Houston',state:'TX',zip:'77002-1234'}:null;
 return {entityKind:kind,nativeUnitId:native,trackerId:tracker,productId:product,unitNumber:label,trackerUnitNumber:label,family:'HELIOS',variant:'HDC4',sourceFileSha256:hash('synthetic-file'),sourceRowSha256:hash(product),installation,addressSha256:installation?hash('123 main st, houston, tx 77002-1234'):null,nativeGuardSha256:guard,previousSourceRevision:null,placement};
}
export const install=(db,records)=>rpc(db,'import_reviewed',{p_organization_id:ORG,p_records:records});
export const read=(db,source)=>rpc(db,'read_current',{p_organization_id:ORG,p_entity_kind:source.entityKind,p_native_unit_id:source.nativeUnitId,p_product_id:source.productId,p_source_revision:source.sourceRevision});
export const events=(db,after='0',limit=100)=>rpc(db,'list_changes',{p_organization_id:ORG,p_after_event_id:after,p_limit:limit});
export async function reset(db){
 await db.exec('reset role;truncate app_private.cos_geocode_sources,app_private.cos_geocode_source_events,app_private.vision_tracker_locations,public.equipment_units;alter sequence app_private.cos_geocode_source_event_id_seq restart with 1;');
}
