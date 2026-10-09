import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
export const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const OWNER='00000000-0000-4000-8000-000000000001';
export const IT='4f7044b5-86b6-411f-8898-39bb64b4ddbc';
export const SERVICE='00000000-0000-4000-8000-000000000003';
export const hash=s=>createHash('sha256').update(s).digest('hex');

// Synthetic, disposable prerequisite schema. Only columns used by the current
// legacy geocoder are modeled; no production records, dumps, or credentials.
// The identity/current-device predicates deliberately match the legacy helper
// semantics. This fixture never installs or changes anything on Supabase.
const legacySchema=String.raw`
set time zone 'UTC';
create role anon; create role authenticated; create role service_role bypassrls;
create schema app_private; create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.actor',true),'')::uuid
$$;
create table public.profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz);
create function app_private.cos_verified_fleet_actor(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.user_id=p_user_id and p.active=true and p.archived_at is null
  and (p.role::text='owner' or (p.role::text='it' and p.user_id in
   ('4f7044b5-86b6-411f-8898-39bb64b4ddbc'::uuid,'b7cc3cbf-d11e-4d4a-9742-c07701857911'::uuid))))
$$;
create table public.camera_devices(id bigint primary key,unit_key text);
create table public.camera_inventory_audit(id bigint primary key,actor_id uuid,action text,unit_key text,device_ids bigint[] default '{}',after_state jsonb);
create function app_private.cos_geocode_unit_key(p_label text)
returns text language sql immutable strict set search_path='' as $$
 select case when length(btrim(p_label)) between 1 and 250 then btrim(p_label) end
$$;
create function app_private.cos_geocode_normalize_address(p_address text)
returns text language sql immutable strict set search_path='' as $$
 select lower(btrim(regexp_replace(p_address, U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')))
$$;
create function app_private.cos_geocode_assert_key(p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text)
returns void language plpgsql set search_path='' as $$
begin
 if p_audit_id is null or p_audit_id!~'^[1-9][0-9]{0,18}$' or length(p_unit_key) not between 1 and 250 or p_unit_key is null
  or p_address is null or length(p_address) not between 1 and 600
  or p_address is distinct from app_private.cos_geocode_normalize_address(p_address)
  or p_address_sha256 is distinct from encode(sha256(convert_to(p_address,'UTF8')),'hex') then
  raise exception 'Invalid exact geocode key.' using errcode='22023'; end if;
 if p_audit_id::numeric>9223372036854775807 then raise exception 'Invalid audit identity.' using errcode='22023'; end if;
end $$;
create function app_private.cos_geocode_assert_service(p_organization_id uuid)
returns void language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Service geocode access required.' using errcode='42501'; end if;
end $$;
create function app_private.cos_geocode_current_audit(p_audit_id text)
returns setof public.camera_inventory_audit language sql stable set search_path='' as $$
 select a.* from public.camera_inventory_audit a
 where a.id=case when p_audit_id ~ '^[1-9][0-9]{0,18}$' then
   case when p_audit_id::numeric<=9223372036854775807 then p_audit_id::bigint end end and a.action::text='MOVE_TO_FIELD'
  and a.after_state->>'placement_contract'='COS_CAMERA_PLACEMENT_V2' and a.after_state->>'placement'='FIELD'
  and app_private.cos_geocode_unit_key(a.unit_key) is not null
  and length(app_private.cos_geocode_normalize_address(a.after_state->>'street_address')) between 1 and 600
  and app_private.cos_verified_fleet_actor(a.actor_id)
  and not exists(select 1 from public.camera_inventory_audit n where lower(btrim(n.unit_key))=lower(btrim(a.unit_key)) and n.id>a.id)
  and cardinality(a.device_ids)>0
  and a.device_ids @> (select array_agg(d.id order by d.id) from public.camera_devices d where lower(btrim(d.unit_key))=lower(btrim(a.unit_key)))
  and a.device_ids <@ (select array_agg(d.id order by d.id) from public.camera_devices d where lower(btrim(d.unit_key))=lower(btrim(a.unit_key)))
$$;
create function app_private.cos_geocode_lock_current(p_audit_id text,p_unit_key text,p_address text)
returns boolean language plpgsql set search_path='' as $$
declare v_label text; a public.camera_inventory_audit;
begin
 select unit_key into v_label from public.camera_inventory_audit where id=case when p_audit_id ~ '^[1-9][0-9]{0,18}$' then
  case when p_audit_id::numeric<=9223372036854775807 then p_audit_id::bigint end end;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(btrim(v_label)),702001));
 perform id from public.camera_devices where lower(btrim(unit_key))=lower(btrim(v_label)) order by id for share;
 select * into a from app_private.cos_geocode_current_audit(p_audit_id);
 return found and app_private.cos_geocode_unit_key(a.unit_key)=p_unit_key
  and app_private.cos_geocode_normalize_address(a.after_state->>'street_address')=p_address;
end $$;
create table app_private.cos_field_geocode_cache(
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 audit_id text not null check(audit_id~'^[1-9][0-9]{0,18}$'),
 unit_key text not null check(length(unit_key) between 1 and 250 and unit_key=btrim(unit_key)),
 address text not null check(length(address) between 1 and 600 and address=app_private.cos_geocode_normalize_address(address)),
 address_sha256 text not null check(address_sha256=encode(sha256(convert_to(address,'UTF8')),'hex')),
 provider text not null default 'us_census_address_range' check(provider='us_census_address_range'),
 benchmark text not null default 'Public_AR_Current' check(benchmark='Public_AR_Current'),
 status text not null default 'pending' check(status in ('pending','success','no_match','invalid_address','provider_error')),
 attempts smallint not null default 0 check(attempts between 0 and 3),claim_token uuid,lease_until timestamptz,next_attempt_at timestamptz,
 latitude double precision,longitude double precision,matched_address text,geocoded_at timestamptz,
 reason text check(reason in ('provider_timeout','provider_unavailable','invalid_response','lease_expired','no_match','invalid_address')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,audit_id),
 check(case when status='success' then latitude is not null and longitude is not null and latitude between -90 and 90
  and longitude between -180 and 180 and matched_address is not null and length(btrim(matched_address)) between 1 and 600
  and matched_address!~'[[:cntrl:]]' and geocoded_at is not null and reason is null
  else latitude is null and longitude is null and matched_address is null end),
 check(case when status='pending' then reason is null and geocoded_at is null and next_attempt_at is null
  and ((attempts=0 and claim_token is null and lease_until is null) or (attempts>0 and claim_token is not null and lease_until is not null))
  else lease_until is null and attempts>0 and claim_token is not null and geocoded_at is not null end),
 check(case when status='provider_error' then reason in ('provider_timeout','provider_unavailable','invalid_response','lease_expired') and reason is not null
  and ((attempts<3 and next_attempt_at is not null) or (attempts=3 and next_attempt_at is null))
  when status='no_match' then reason='no_match' and reason is not null and next_attempt_at is null
  when status='invalid_address' then reason='invalid_address' and reason is not null and next_attempt_at is null
  else next_attempt_at is null end)
);
grant usage on schema app_private,auth to service_role;
grant select,insert,update on app_private.cos_field_geocode_cache,public.camera_devices,public.camera_inventory_audit to service_role;
grant execute on all functions in schema app_private,public to service_role;
`;
export async function fixture({imported=false}={}){
 const db=new PGlite();
 try{
  await db.exec(legacySchema);
  db.fixtureLegacyDefinitions=(await db.query("select p.proname,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and (p.proname like 'cos_geocode_%' or p.proname='cos_verified_fleet_actor') order by p.proname")).rows;
  await db.exec(await readFile(new URL('../../db/geocodio-free-fallback.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../db/geocodio-postal-precision-rejections.sql',import.meta.url),'utf8'));
  db.fixtureOwnerDefinitions=(await db.query("select p.proname,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cos_field_geocode_fallback_%' order by p.proname")).rows;
  if(imported){
   await db.exec(await readFile(new URL('../../db/geocodio-imported-jobs.sql',import.meta.url),'utf8'));
   await db.exec(await readFile(new URL('../../db/geocodio-imported-list-due-v2.sql',import.meta.url),'utf8'));
   await db.exec(await readFile(new URL('../../db/geocodio-imported-postal-precision-rejections.sql',import.meta.url),'utf8'));
   await db.exec(await readFile(new URL('../../db/geocodio-postal-retry-v1.sql',import.meta.url),'utf8'));
   db.fixtureHasPostalRetry=true;
   db.fixtureHasImported=true;
  }
  return db;
 }catch(error){await db.close();throw error;}
}
export async function reset(db){
 if(db.fixtureHasPostalRetry) await db.exec(`reset role;truncate app_private.cos_imported_postal_retry_jobs,app_private.cos_imported_postal_retry_batches;`);
 if(db.fixtureHasImported) await db.exec(`reset role;truncate app_private.cos_imported_geocode_jobs,app_private.cos_imported_geocode_events,app_private.cos_imported_census_requests,app_private.cos_imported_census_cache;update app_private.cos_imported_geocode_cursor set event_id=0,scan_generation=gen_random_uuid(),last_page_count=null;`);
 await db.exec(`reset role; truncate public.profiles;
 insert into public.profiles(user_id,role,active,archived_at) values
 ('${OWNER}','owner',true,null),('${IT}','it',true,null),('${SERVICE}','service',true,null);
 truncate app_private.cos_field_geocode_fallback_rejections,app_private.cos_field_geocode_fallback_cache,app_private.cos_geocodio_reservations,app_private.cos_geocodio_daily_budget,app_private.cos_field_geocode_cache,public.camera_inventory_audit,public.camera_devices;
 update app_private.cos_geocodio_control set enabled=true,free_only=true,daily_limit=2400;
 update app_private.cos_geocodio_account_state set blocked_until=null,cooldown_until=null;`);
}
export async function seed(db,{id=1,unit=`Unit-${id}`,address=`${id} main st, houston, tx 77002`,status='no_match',actor=OWNER,devices=[id]}={}){
 await db.exec('reset role');
 for(const device of devices) await db.query('insert into public.camera_devices(id,unit_key) values($1,$2)',[device,unit]);
 await db.query(`insert into public.camera_inventory_audit(id,actor_id,action,unit_key,device_ids,after_state) values($1,$2,'MOVE_TO_FIELD',$3,$4,$5)`,[id,actor,unit,devices,{placement_contract:'COS_CAMERA_PLACEMENT_V2',placement:'FIELD',street_address:address}]);
 await db.query(`insert into app_private.cos_field_geocode_cache(organization_id,audit_id,unit_key,address,address_sha256,status,reason,attempts,claim_token,geocoded_at,latitude,longitude,matched_address)
  values($1,$2,$3,$4,$5,$6,$7,1,$8,clock_timestamp(),$9,$10,$11)`,[ORG,''+id,unit,address,hash(address),status,status==='success'?null:status,randomUUID(),status==='success'?29.1:null,status==='success'?-95.1:null,status==='success'?address:null]);
 return {p_organization_id:ORG,p_audit_id:''+id,p_unit_key:unit,p_address:address,p_address_sha256:hash(address)};
}
export async function rpc(db,name,args,role='service_role',actor=null){
 await db.exec('reset role');
 if(actor!==null) await db.query("select set_config('test.actor',$1,false)",[actor]);
 await db.exec(`set role ${role}`);
 try{
  return (await db.query(`select public.cos_field_geocode_fallback_${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(args))).rows[0].result;
 }finally{await db.exec('reset role');}
}
export const reserve=(db,key,request=randomUUID())=>rpc(db,'reserve',{...key,p_request_id:request});
export const finish=(db,key,token,result={p_status:'success',p_latitude:29.1,p_longitude:-95.1,p_matched_address:key.p_address,p_accuracy_type:'rooftop',p_accuracy:1,p_match_type:'building_centroid'})=>rpc(db,'finish',{...key,p_reservation_token:token,...result});
export const credits=async db=>Number((await db.query('select coalesce(sum(credits),0) as credits from app_private.cos_geocodio_daily_budget')).rows[0].credits);
