-- REVIEW ARTIFACT: native project only. No production import or deployment here.
-- Source ownership is explicit: no synthetic Owner audits, equipment units or label joins.
begin;
-- IDs identify revisions; they are NOT a commit-order watermark. The consumer
-- scans latest rows in bounded pages and wraps to zero after each full pass.
create sequence app_private.cos_geocode_source_event_id_seq as bigint minvalue 1 no cycle;
create table app_private.cos_geocode_sources (
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 entity_kind text not null check(entity_kind in ('equipment_unit','tracker')),
 native_unit_id uuid primary key,
 tracker_id uuid not null unique,
 product_id text not null unique check(product_id~'^[1-9][0-9]{0,18}$' and product_id::numeric<=9223372036854775807),
 unit_number text not null check(length(unit_number) between 1 and 160 and unit_number=btrim(unit_number) and unit_number!~'[[:cntrl:]<>]'),
 tracker_unit_number text not null check(length(tracker_unit_number) between 1 and 160 and tracker_unit_number=btrim(tracker_unit_number) and tracker_unit_number!~'[[:cntrl:]<>]'),
 family text not null check(length(family) between 1 and 160 and family=btrim(family) and family!~'[[:cntrl:]<>]'),
 variant text check(length(variant) between 1 and 160 and variant=btrim(variant) and variant!~'[[:cntrl:]<>]'),
 site_label text check(site_label is null or (length(site_label) between 1 and 250 and site_label=btrim(site_label) and site_label!~'[[:cntrl:]<>@=]' and site_label!~*'https?:|password|passwd|pwd|token|secret|credential|gate[[:space:]-]*code|access[[:space:]-]*code')),
 source_file_sha256 text not null check(source_file_sha256~'^[a-f0-9]{64}$'),
 source_row_sha256 text not null check(source_row_sha256~'^[a-f0-9]{64}$'),
 street text check(length(street) between 1 and 250),
 city text check(length(city) between 1 and 100),
 state text check(state=any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP',' '))),
 zip text check(zip~'^[0-9]{5}(-[0-9]{4})?$'),
 address_sha256 text check(address_sha256~'^[a-f0-9]{64}$'),
 native_guard_sha256 text not null check(native_guard_sha256~'^[a-f0-9]{64}$'),
 source_placement text not null check(source_placement in ('FIELD','SHOP')),
 active boolean not null default true,
 eligibility text not null check(eligibility in ('FIELD','tombstone')),
 source_revision uuid not null,
 event_id bigint not null,
 imported_at timestamptz not null default clock_timestamp(),
 check(entity_kind<>'tracker' or native_unit_id=tracker_id),
 check((active and source_placement='FIELD' and eligibility='FIELD' and street is not null and state is not null and (city is not null or zip is not null) and address_sha256 is not null) or ((not active or source_placement='SHOP') and eligibility='tombstone'))
);
create table app_private.cos_geocode_source_events (
 event_id bigint primary key, organization_id uuid not null,
 entity_kind text not null, native_unit_id uuid not null, product_id text not null,
 source_revision uuid not null, kind text not null check(kind in ('upsert','tombstone'))
);
alter table app_private.cos_geocode_sources enable row level security;
alter table app_private.cos_geocode_source_events enable row level security;
revoke all on app_private.cos_geocode_sources,app_private.cos_geocode_source_events from public,anon,authenticated,service_role;
revoke all on sequence app_private.cos_geocode_source_event_id_seq from public,anon,authenticated,service_role;
grant usage on sequence app_private.cos_geocode_source_event_id_seq to service_role;
grant select,insert,update on app_private.cos_geocode_sources to service_role;
grant select,insert on app_private.cos_geocode_source_events to service_role;

create function app_private.cos_source_assert_service(p_org uuid)
returns void language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501'; end if;
end $$;
-- A deliberately broad concern key for DENIAL/INVALIDATION ONLY. Decimal and
-- token boundaries can collide, so this function must never bind identities.
create function app_private.cos_source_label(p_label text)
returns text language sql immutable strict set search_path='' as $$
 select regexp_replace(lower(p_label),'[^a-z0-9]','','g')
$$;
create function app_private.cos_source_address(p_street text,p_city text,p_state text,p_zip text)
returns text language sql immutable set search_path='' as $$
 select lower(btrim(regexp_replace(concat_ws(', ',p_street,p_city,concat_ws(' ',p_state,p_zip)),
 U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')))
$$;

-- Only explicitly bound records are read. Labels are used to reject ambiguity,
-- never to discover or select an identity. No notes, contacts or raw metadata.
create function app_private.cos_source_native_guard(p_kind text,p_id uuid,p_tracker uuid,p_unit_number text,p_tracker_number text)
returns text language plpgsql stable set search_path='' as $$
declare u record; t record; guard jsonb; n integer;
begin
 select id,organization_id,unit_number,family,placement,site,address,source_name,source_verified_at,imported_at,latitude,longitude,coordinate_source into t from app_private.vision_tracker_locations where id=p_tracker and organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 if not found or t.unit_number is distinct from p_tracker_number or t.placement not in ('FIELD','SHOP')
  or ((t.latitude is not null or t.longitude is not null or t.coordinate_source is not null)
   and coalesce(t.coordinate_source,'') not in ('us_census_address_range_estimate','geocodio_reviewed_property_estimate'))
  or ((t.latitude is null)<>(t.longitude is null)) then return null; end if;
 guard:=jsonb_build_object('trackerId',t.id,'trackerUnitNumber',t.unit_number,'family',t.family,
  'placement',t.placement,'site',t.site,'address',t.address,'sourceName',t.source_name,
  'sourceVerifiedAt',t.source_verified_at,'importedAt',t.imported_at,
  'latitude',t.latitude,'longitude',t.longitude,'coordinateSource',t.coordinate_source);
 if p_kind='tracker' then
  if p_id<>p_tracker or p_unit_number is distinct from t.unit_number then return null; end if;
  select count(*) into n from public.equipment_units x where x.organization_id=t.organization_id
   and app_private.cos_source_label(x.unit_number)=app_private.cos_source_label(t.unit_number);
  if n<>0 then return null; end if;
 elsif p_kind='equipment_unit' then
  select id,organization_id,unit_number,model_id,status,current_location_type,installed_site_id,gps_latitude,gps_longitude,gps_recorded_at,gps_source,gps_recorded_by,gps_accuracy_m into u from public.equipment_units where id=p_id and organization_id=t.organization_id;
  if not found or u.unit_number is distinct from p_unit_number or u.installed_site_id is not null
   or u.status in ('retired','deleted') or coalesce(u.current_location_type,'') not in ('','field')
   or u.gps_latitude is not null or u.gps_longitude is not null or u.gps_recorded_at is not null
   or u.gps_source is not null then return null; end if;
  select count(*) into n from public.equipment_units x where x.organization_id=t.organization_id
   and app_private.cos_source_label(x.unit_number)=app_private.cos_source_label(u.unit_number);
  if n<>1 then return null; end if;
  guard:=guard||jsonb_build_object('nativeId',u.id,'unitNumber',u.unit_number,'modelId',u.model_id,
   'status',u.status,'currentLocationType',u.current_location_type,'installedSiteId',u.installed_site_id,
   'latitude',u.gps_latitude,'longitude',u.gps_longitude,'gpsSource',u.gps_source,
   'gpsRecordedAt',u.gps_recorded_at,'gpsRecordedBy',u.gps_recorded_by,'gpsAccuracyM',u.gps_accuracy_m);
 else return null; end if;
 return encode(sha256(convert_to(guard::text,'UTF8')),'hex');
end $$;

create function app_private.cos_source_record(p app_private.cos_geocode_sources)
returns jsonb language sql stable strict set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'organizationId',p.organization_id,'sourceSystem','mhelpdesk_product_import',
 'entityKind',p.entity_kind,'nativeUnitId',p.native_unit_id,'productId',p.product_id,
 'sourceRevision',p.source_revision,'eventId',p.event_id::text,'eligibility',p.eligibility)
 || case when p.eligibility='FIELD' then jsonb_build_object('unitNumber',p.unit_number,'family',p.family,'variant',p.variant,
 'sourceFileSha256',p.source_file_sha256,'sourceRowSha256',p.source_row_sha256,'addressSha256',p.address_sha256,
 'nativeGuardSha256',p.native_guard_sha256,'suppliedComponents',jsonb_build_object('street',true,'city',p.city is not null,'state',true,'zip',p.zip is not null),'installation',jsonb_build_object('street',p.street,'city',p.city,'state',p.state,'zip',p.zip)) else '{}'::jsonb end
$$;

create function app_private.cos_source_change_event()
returns trigger language plpgsql set search_path='' as $$
declare existing app_private.cos_geocode_sources;
begin
 -- INSERT ... ON CONFLICT runs BEFORE INSERT even on the UPDATE path.
 -- Do not publish a phantom event before the eventual no-op/conflict update.
 if tg_op='INSERT' then
  select * into existing from app_private.cos_geocode_sources where native_unit_id=new.native_unit_id;
  if found then new.source_revision:=existing.source_revision;new.event_id:=existing.event_id;return new;end if;
 end if;
 if tg_op='UPDATE' then
  if row(new.native_unit_id,new.entity_kind,new.tracker_id,new.product_id,new.unit_number,new.tracker_unit_number,new.family,new.variant)
   is distinct from row(old.native_unit_id,old.entity_kind,old.tracker_id,old.product_id,old.unit_number,old.tracker_unit_number,old.family,old.variant) then
   raise exception 'Source identity bindings are immutable.' using errcode='22023'; end if;
  if (to_jsonb(new)-'source_revision'-'event_id'-'imported_at')=(to_jsonb(old)-'source_revision'-'event_id'-'imported_at') then
   new.source_revision:=old.source_revision;new.event_id:=old.event_id;new.imported_at:=old.imported_at;return new; end if;
 end if;
 -- No global row/advisory lock: native multi-statement writers keep their
 -- existing lock graph. Late commits are recovered by the next full scan.
 new.event_id:=nextval('app_private.cos_geocode_source_event_id_seq');
 new.source_revision:=gen_random_uuid();new.imported_at:=clock_timestamp();
 insert into app_private.cos_geocode_source_events values(new.event_id,new.organization_id,new.entity_kind,new.native_unit_id,new.product_id,new.source_revision,
  case when new.eligibility='FIELD' then 'upsert' else 'tombstone' end);
 return new;
end $$;
create trigger cos_source_change_event before insert or update on app_private.cos_geocode_sources
 for each row execute function app_private.cos_source_change_event();

-- This trigger only changes the source-owned ledger. Never modifies the native
-- update, historical GPS, source tracker, placement, audits, or health evidence.
-- A definer is required because ordinary native writers have no ledger grants.
create function app_private.cos_source_native_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_label text; new_label text; old_id uuid; new_id uuid;
begin
 if tg_op<>'INSERT' then old_label:=old.unit_number;old_id:=old.id;end if;
 if tg_op<>'DELETE' then new_label:=new.unit_number;new_id:=new.id;end if;
 update app_private.cos_geocode_sources s set eligibility='tombstone',active=false
 where s.active and (s.native_unit_id in (old_id,new_id) or s.tracker_id in (old_id,new_id)
  or app_private.cos_source_label(s.unit_number) in (app_private.cos_source_label(old_label),app_private.cos_source_label(new_label)))
 and s.native_guard_sha256 is distinct from app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return null;
end $$;
create trigger cos_geocode_source_tracker_changed after insert or update or delete on app_private.vision_tracker_locations
 for each row execute function app_private.cos_source_native_changed();
create trigger cos_geocode_source_equipment_changed after insert or update or delete on public.equipment_units
 for each row execute function app_private.cos_source_native_changed();

create function public.cos_geocode_sources_list_changes(p_organization_id uuid,p_after_event_id text,p_limit integer default 100)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; last_id text;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 if p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$' or p_after_event_id::numeric>9223372036854775807
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid bounded source cursor.' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',e.event_id::text,'entityKind',e.entity_kind,'nativeUnitId',e.native_unit_id,
  'productId',e.product_id,'sourceRevision',e.source_revision,'kind',case when e.eligibility='FIELD' then 'upsert' else 'tombstone' end) order by e.event_id),'[]'),max(e.event_id)::text into result,last_id
 from (select * from app_private.cos_geocode_sources where organization_id=p_organization_id and event_id>p_after_event_id::bigint order by event_id limit p_limit) e;
 return jsonb_build_object('events',result,'nextEventId',coalesce(last_id,p_after_event_id));
end $$;
create function public.cos_geocode_sources_read_current(p_organization_id uuid,p_entity_kind text,p_native_unit_id uuid,p_product_id text,p_source_revision uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 select app_private.cos_source_record(s) into result from app_private.cos_geocode_sources s
 where s.organization_id=p_organization_id and s.entity_kind=p_entity_kind and s.native_unit_id=p_native_unit_id
  and s.product_id=p_product_id and s.source_revision=p_source_revision
  and (s.eligibility='tombstone' or s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number));
 return jsonb_build_object('source',result);
end $$;
create function public.cos_geocode_sources_read_many(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 if jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities)>250 then raise exception 'Invalid source identities.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_identities) i where jsonb_typeof(i) is distinct from 'object'
  or i->>'entityKind' not in ('equipment_unit','tracker') or i->>'entityKind' is null
  or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or (i-'entityKind'-'nativeUnitId')<>'{}'::jsonb) then raise exception 'Invalid source identity.' using errcode='22023';end if;
 select coalesce(jsonb_agg(app_private.cos_source_record(s) order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.eligibility='FIELD'
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;

-- Privileged, reviewed CSV import only. It is deliberately NOT a bridge action.
-- The caller verifies immutable file/row bytes and whole-file ProductId/full-family/
-- full-variant uniqueness before this transaction. Native guards are rechecked here.
create function public.cos_geocode_sources_import_reviewed(p_organization_id uuid,p_records jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r jsonb; old_source app_private.cos_geocode_sources; source app_private.cos_geocode_sources;
 v_id uuid;v_tracker uuid;v_guard text;v_result jsonb:='[]';v_address text;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 250 then raise exception 'Invalid reviewed batch.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'nativeUnitId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'productId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'trackerId' having count(*)>1) then raise exception 'Ambiguous reviewed batch.' using errcode='22023';end if;
 -- Prelock the complete reviewed batch in deterministic order before mutations.
 -- Source event IDs use a sequence; native writers never acquire a global clock.
 for v_id in select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records) order by 1 loop
  if v_id is null then raise exception 'Native identity required.' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
 end loop;
 perform u.id from public.equipment_units u where u.id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by u.id for share;
 perform t.id from app_private.vision_tracker_locations t where t.id in (select (value->>'trackerId')::uuid from jsonb_array_elements(p_records)) order by t.id for share;
 perform s.native_unit_id from app_private.cos_geocode_sources s where s.native_unit_id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by s.native_unit_id for update;
 for r in select value from jsonb_array_elements(p_records) order by value->>'nativeUnitId' loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['entityKind','nativeUnitId','trackerId','productId','unitNumber','trackerUnitNumber','family','variant','sourceFileSha256','sourceRowSha256','installation','addressSha256','nativeGuardSha256','suppliedComponents','previousSourceRevision','placement','siteLabel'])<>'{}'::jsonb
   or r->>'entityKind' not in ('equipment_unit','tracker') or coalesce(r->>'placement','') not in ('FIELD','SHOP')
   or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,18}$'
   or coalesce(r->>'nativeGuardSha256','')!~'^[a-f0-9]{64}$' then raise exception 'Invalid reviewed source.' using errcode='22023';end if;
  v_id:=(r->>'nativeUnitId')::uuid;v_tracker:=(r->>'trackerId')::uuid;
  select * into old_source from app_private.cos_geocode_sources where native_unit_id=v_id for update;
  if found and old_source.source_revision is distinct from (r->>'previousSourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  if not found and r->>'previousSourceRevision' is not null then raise exception 'Source revision changed.' using errcode='40001';end if;
  v_guard:=app_private.cos_source_native_guard(r->>'entityKind',v_id,v_tracker,r->>'unitNumber',r->>'trackerUnitNumber');
  if v_guard is null or v_guard<>r->>'nativeGuardSha256' then raise exception 'Native placement or GPS changed.' using errcode='40001';end if;
  if r->>'placement'='FIELD' then
  if jsonb_typeof(r->'installation') is distinct from 'object' or ((r->'installation')-array['street','city','state','zip'])<>'{}'::jsonb
   or coalesce(r#>>'{installation,street}','')!~'^[0-9]{1,8}[A-Za-z]? +[A-Za-z0-9 .''-]+$'
   or ((r#>>'{installation,city}') is not null and (r#>>'{installation,city}')!~'^[A-Za-z][A-Za-z .''-]*$')
   or (r#>>'{installation,street}') is distinct from btrim(r#>>'{installation,street}')
   or (r#>>'{installation,city}') is distinct from btrim(r#>>'{installation,city}')
   or (r#>>'{installation,street}')~'[0-9]{3}[ .)-]+[0-9]{3}[ .-]+[0-9]{4}'
   or (r#>>'{installation,street}')~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\M'
   or (r#>>'{installation,city}')~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\M'
   or concat_ws(' ',r#>>'{installation,street}',r#>>'{installation,city}')~*'(password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox)[[:alnum:]_-]*|(gate|access)[[:space:]-]*code[[:alnum:]_-]*'
   or (r->'installation')::text~'\\u00[0-1][0-9a-f]' then raise exception 'Unsafe installation address.' using errcode='22023';end if;
  if r ? 'suppliedComponents' and r->'suppliedComponents' is distinct from jsonb_build_object('street',true,'city',r#>>'{installation,city}' is not null,'state',true,'zip',r#>>'{installation,zip}' is not null) then raise exception 'Supplied address mask mismatch.' using errcode='22023';end if;
  v_address:=app_private.cos_source_address(r#>>'{installation,street}',r#>>'{installation,city}',r#>>'{installation,state}',r#>>'{installation,zip}');
  if r->>'addressSha256' is distinct from encode(sha256(convert_to(v_address,'UTF8')),'hex') then raise exception 'Address digest mismatch.' using errcode='22023';end if;
  elsif r->'installation' is not null and r->'installation'<>'null'::jsonb or r->>'addressSha256' is not null then raise exception 'Shop has no geocoding address.' using errcode='22023';end if;
  insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,variant,
   site_label,source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id)
  values(p_organization_id,r->>'entityKind',v_id,v_tracker,r->>'productId',r->>'unitNumber',r->>'trackerUnitNumber',r->>'family',r->>'variant',
   r->>'siteLabel',r->>'sourceFileSha256',r->>'sourceRowSha256',r#>>'{installation,street}',r#>>'{installation,city}',r#>>'{installation,state}',r#>>'{installation,zip}',r->>'addressSha256',r->>'nativeGuardSha256',r->>'placement',true,case when r->>'placement'='FIELD' then 'FIELD' else 'tombstone' end,gen_random_uuid(),0)
  on conflict(native_unit_id) do update set entity_kind=excluded.entity_kind,tracker_id=excluded.tracker_id,product_id=excluded.product_id,
   unit_number=excluded.unit_number,tracker_unit_number=excluded.tracker_unit_number,family=excluded.family,variant=excluded.variant,
   site_label=excluded.site_label,source_file_sha256=excluded.source_file_sha256,source_row_sha256=excluded.source_row_sha256,street=excluded.street,city=excluded.city,state=excluded.state,zip=excluded.zip,
   address_sha256=excluded.address_sha256,native_guard_sha256=excluded.native_guard_sha256,source_placement=excluded.source_placement,active=true,eligibility=excluded.eligibility
  returning * into source;
  v_result:=v_result||jsonb_build_array(app_private.cos_source_record(source));
 end loop;
 return v_result;
end $$;

-- Explicit withdrawal for newly unsafe/missing/ambiguous reviewed CSV sources.
-- Omission from an import batch is not interpreted as deletion or SHOP placement.
create function public.cos_geocode_sources_revoke_reviewed(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare i jsonb; s app_private.cos_geocode_sources; result jsonb:='[]'; v_id uuid;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 250 then raise exception 'Invalid source revocations.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x group by x->>'nativeUnitId' having count(*)>1) then raise exception 'Duplicate source revocation.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) order by value->>'nativeUnitId' loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision'])<>'{}'::jsonb then raise exception 'Invalid source revocation.' using errcode='22023';end if;
  v_id:=(i->>'nativeUnitId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
  select * into s from app_private.cos_geocode_sources where organization_id=p_organization_id and native_unit_id=v_id for update;
  if not found or s.entity_kind is distinct from i->>'entityKind' or s.product_id is distinct from i->>'productId'
   or s.source_revision is distinct from (i->>'sourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=v_id returning * into s;
  result:=result||jsonb_build_array(app_private.cos_source_record(s));
 end loop;
 return result;
end $$;
revoke all on function public.cos_geocode_sources_revoke_reviewed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_geocode_sources_revoke_reviewed(uuid,jsonb) to service_role;

create function public.cos_geocode_sources_read_current_batch(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare i jsonb;result jsonb:='[]';
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 100 then raise exception 'Invalid source batch.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision'])<>'{}'::jsonb
   or coalesce(i->>'entityKind','') not in ('equipment_unit','tracker') or coalesce(i->>'productId','')!~'^[1-9][0-9]{0,18}$'
   or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(i->>'sourceRevision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid source identity.' using errcode='22023';end if;
  result:=result||jsonb_build_array(public.cos_geocode_sources_read_current(p_organization_id,i->>'entityKind',(i->>'nativeUnitId')::uuid,i->>'productId',(i->>'sourceRevision')::uuid)->'source');
 end loop;
 return jsonb_build_object('sources',result);
end $$;

-- Native field-map reader only. SHOP changes the effective display before the
-- existing legacy Owner/IT projector, whose newer decisions always win.
create function public.cos_geocode_sources_map_projection(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 perform app_private.cos_source_assert_service(p_organization_id);
 perform public.cos_geocode_sources_read_many(p_organization_id,p_identities);
 select coalesce(jsonb_agg(app_private.cos_source_record(s)||jsonb_build_object('entityKind',s.entity_kind,'nativeUnitId',s.native_unit_id,'productId',s.product_id,
  'sourceRevision',s.source_revision,'eventId',s.event_id::text,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,
  'nativeGuardSha256',s.native_guard_sha256,'unitNumber',s.unit_number,'placement',s.source_placement,'siteLabel',s.site_label,
  'nativeSourceIdentity',case when s.entity_kind='equipment_unit' then jsonb_build_object('contract','COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',
   'nativeUnitId',s.native_unit_id,'productId',s.product_id,'unitNumber',s.unit_number,'trackerId',s.tracker_id,'trackerUnitNumber',s.tracker_unit_number,
   'sourceRevision',s.source_revision,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,'nativeGuardSha256',s.native_guard_sha256) else null end,
  'installation',case when s.source_placement='FIELD' then jsonb_build_object('street',s.street,'city',s.city,'state',s.state,'zip',s.zip) else null end,
  'addressSha256',case when s.source_placement='FIELD' then s.address_sha256 else null end,
  'suppliedComponents',case when s.source_placement='FIELD' then jsonb_build_object('street',true,'city',s.city is not null,'state',true,'zip',s.zip is not null) else null end) order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.active
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;
revoke all on function public.cos_geocode_sources_read_current_batch(uuid,jsonb),public.cos_geocode_sources_map_projection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_geocode_sources_read_current_batch(uuid,jsonb),public.cos_geocode_sources_map_projection(uuid,jsonb) to service_role;

revoke all on function app_private.cos_source_assert_service(uuid),app_private.cos_source_label(text),app_private.cos_source_address(text,text,text,text),
 app_private.cos_source_native_guard(text,uuid,uuid,text,text),app_private.cos_source_record(app_private.cos_geocode_sources),
 app_private.cos_source_change_event(),app_private.cos_source_native_changed() from public,anon,authenticated,service_role;
grant execute on function app_private.cos_source_assert_service(uuid),app_private.cos_source_label(text),app_private.cos_source_address(text,text,text,text),
 app_private.cos_source_native_guard(text,uuid,uuid,text,text),app_private.cos_source_record(app_private.cos_geocode_sources),app_private.cos_source_change_event() to service_role;
revoke all on function public.cos_geocode_sources_list_changes(uuid,text,integer),public.cos_geocode_sources_read_current(uuid,text,uuid,text,uuid),
 public.cos_geocode_sources_read_many(uuid,jsonb),public.cos_geocode_sources_import_reviewed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_geocode_sources_list_changes(uuid,text,integer),public.cos_geocode_sources_read_current(uuid,text,uuid,text,uuid),
 public.cos_geocode_sources_read_many(uuid,jsonb),public.cos_geocode_sources_import_reviewed(uuid,jsonb) to service_role;
commit;
