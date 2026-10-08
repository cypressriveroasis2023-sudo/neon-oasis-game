-- REVIEW ARTIFACT ONLY: legacy geocoder project; apply AFTER geocodio-free-fallback.sql.
-- Synthetic fixture tests only. No import, vendor request, secret, or production action.
-- Native imported bindings are typed jobs, never fabricated Owner placement audits.
begin;
alter table app_private.cos_geocodio_reservations
 add column job_kind text not null default 'owner_audit' check(job_kind in ('owner_audit','native_import')),
 add column native_binding jsonb,
 add column legacy_guard_sha256 text,
 alter column audit_id drop not null,
 add constraint cos_geocodio_reservation_job_binding check(
  (job_kind='owner_audit' and audit_id is not null and native_binding is null and legacy_guard_sha256 is null)
  or (job_kind='native_import' and audit_id is null and jsonb_typeof(native_binding)='object' and native_binding is not null
   and legacy_guard_sha256 is not null and legacy_guard_sha256~'^[a-f0-9]{64}$'));

create table app_private.cos_imported_geocode_cursor(
 organization_id uuid primary key,event_id bigint not null default 0 check(event_id>=0),
 scan_generation uuid not null default gen_random_uuid(),last_page_count integer check(last_page_count between 0 and 100));
insert into app_private.cos_imported_geocode_cursor(organization_id,event_id) values('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',0);
create table app_private.cos_imported_geocode_events(
 organization_id uuid not null,event_id bigint not null,event jsonb not null,
 primary key(organization_id,event_id));
create unique index cos_imported_event_revision on app_private.cos_imported_geocode_events(organization_id,(event->>'entityKind'),(event->>'nativeUnitId'),(event->>'sourceRevision'));
create table app_private.cos_imported_geocode_jobs(
 organization_id uuid not null,entity_kind text not null check(entity_kind in ('equipment_unit','tracker')),
 native_unit_id uuid not null,product_id text not null,source_revision uuid not null,event_id bigint not null,
 invalidated boolean not null default false,binding jsonb,unit_number text,address text,address_sha256 text,legacy_guard_sha256 text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,entity_kind,native_unit_id),
 unique(organization_id,native_unit_id),unique(organization_id,product_id),
 check(binding is null or (jsonb_typeof(binding)='object' and unit_number is not null and address is not null
  and address_sha256 is not null and legacy_guard_sha256 is not null)));
create index cos_imported_geocode_jobs_address on app_private.cos_imported_geocode_jobs(organization_id,address_sha256) where binding is not null;
create table app_private.cos_imported_census_requests(
 request_id uuid primary key,claim_token uuid not null unique default gen_random_uuid(),organization_id uuid not null,
 binding jsonb not null,legacy_guard_sha256 text not null,address_sha256 text not null,
 reserved_at timestamptz not null,lease_until timestamptz not null,completed_at timestamptz,outcome jsonb);
create table app_private.cos_imported_census_cache(
 organization_id uuid not null,address_sha256 text not null,address text not null,
 status text not null default 'pending' check(status in ('pending','success','no_match','invalid_address','provider_error')),
 reason text check(reason in ('no_match','invalid_address','provider_timeout','provider_unavailable','invalid_response')),
 attempts integer not null default 0 check(attempts between 0 and 3),attempt_day date,
 active_request_id uuid references app_private.cos_imported_census_requests(request_id),lease_until timestamptz,next_attempt_at timestamptz,
 latitude double precision,longitude double precision,matched_address text,geocoded_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),primary key(organization_id,address_sha256),
 check(address=app_private.cos_geocode_normalize_address(address) and address_sha256=encode(sha256(convert_to(address,'UTF8')),'hex')),
 check((status='pending' and active_request_id is not null and lease_until is not null) or (active_request_id is null and lease_until is null)),
 check(case when status='success' then latitude is not null and latitude between -90 and 90 and longitude is not null and longitude between -180 and 180
   and matched_address is not null and length(btrim(matched_address)) between 1 and 600 and matched_address!~'[[:cntrl:]]' and geocoded_at is not null and reason is null
  else latitude is null and longitude is null and matched_address is null end));

alter table app_private.cos_imported_geocode_cursor enable row level security;
alter table app_private.cos_imported_geocode_events enable row level security;
alter table app_private.cos_imported_geocode_jobs enable row level security;
alter table app_private.cos_imported_census_requests enable row level security;
alter table app_private.cos_imported_census_cache enable row level security;
revoke all on app_private.cos_imported_geocode_cursor,app_private.cos_imported_geocode_events,app_private.cos_imported_geocode_jobs,
 app_private.cos_imported_census_requests,app_private.cos_imported_census_cache from public,anon,authenticated,service_role;
grant select,update on app_private.cos_imported_geocode_cursor to service_role;
grant select,insert on app_private.cos_imported_geocode_events to service_role;
grant select,insert,update on app_private.cos_imported_geocode_jobs,app_private.cos_imported_census_requests,app_private.cos_imported_census_cache to service_role;

-- This is exclusively a deny/suppression key. NEVER use it to assign a native
-- source, copy an address, or claim a positive legacy/native identity match.
create function app_private.cos_imported_concern_key(p_label text)
returns text language plpgsql immutable strict set search_path='' as $$
declare m text[]; family text; number_parts text[];
begin
 m:=regexp_match(btrim(p_label),'^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$','i');
 if m is null then m:=regexp_match(btrim(p_label),'^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$','i'); end if;
 if m is null then return 'full:'||upper(regexp_replace(btrim(p_label),'\s+',' ','g')); end if;
 family:=regexp_replace(upper(m[1]),'\s','','g');
 family:=case family when 'RI' then 'RECON' when 'RII' then 'RECON2' when 'RECONII' then 'RECON2' else family end;
 number_parts:=string_to_array(m[2],'.');
 if number_parts[1]::integer=0 then return 'full:'||upper(regexp_replace(btrim(p_label),'\s+',' ','g')); end if;
 return 'typed:'||family||'|'||(number_parts[1]::integer)::text||case when cardinality(number_parts)>1 then '.'||number_parts[2] else '' end;
end $$;

create function app_private.cos_imported_address(p_binding jsonb)
returns text language sql immutable strict set search_path='' as $$
 select app_private.cos_geocode_normalize_address(concat_ws(', ',p_binding#>>'{installation,street}',p_binding#>>'{installation,city}',concat_ws(' ',p_binding#>>'{installation,state}',p_binding#>>'{installation,zip}')))
$$;
create function app_private.cos_imported_assert_binding(p_organization_id uuid,p_binding jsonb)
returns void language plpgsql set search_path='' as $$
declare k text; address text;
begin
 if p_binding is null or jsonb_typeof(p_binding) is distinct from 'object'
  or p_binding->'schemaVersion' is distinct from '1'::jsonb or p_binding->>'organizationId' is distinct from p_organization_id::text
  or p_binding->>'sourceSystem' is distinct from 'mhelpdesk_product_import' or p_binding->>'eligibility' is distinct from 'FIELD'
  or p_binding->>'entityKind' is null or p_binding->>'entityKind' not in ('equipment_unit','tracker')
  or (select count(*) from jsonb_object_keys(p_binding))<>18
  or exists(select 1 from jsonb_object_keys(p_binding) x where x not in ('schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','unitNumber','family','variant','sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','installation','suppliedComponents','eligibility','eventId')) then
  raise exception 'Invalid imported source binding.' using errcode='22023'; end if;
 foreach k in array array['nativeUnitId','sourceRevision','productId','unitNumber','family','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId'] loop
  if jsonb_typeof(p_binding->k) is distinct from 'string' then raise exception 'Invalid imported source field.' using errcode='22023'; end if;
 end loop;
 if p_binding->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_binding->>'sourceRevision'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_binding->>'productId'!~'^[1-9][0-9]{0,18}$' or p_binding->>'eventId'!~'^[1-9][0-9]{0,18}$'
  or (p_binding->>'productId')::numeric>9223372036854775807 or (p_binding->>'eventId')::numeric>9223372036854775807
  or length(p_binding->>'unitNumber') not between 1 and 160 or length(p_binding->>'family') not between 1 and 160
  or p_binding->>'unitNumber'~'[[:cntrl:]]' or p_binding->>'family'~'[[:cntrl:]]'
  or not (p_binding->'variant'='null'::jsonb or jsonb_typeof(p_binding->'variant')='string' and length(p_binding->>'variant') between 1 and 160 and p_binding->>'variant'!~'[[:cntrl:]]')
  or p_binding->>'sourceFileSha256'!~'^[a-f0-9]{64}$' or p_binding->>'sourceRowSha256'!~'^[a-f0-9]{64}$'
  or p_binding->>'addressSha256'!~'^[a-f0-9]{64}$' or p_binding->>'nativeGuardSha256'!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_binding->'installation') is distinct from 'object' then raise exception 'Invalid imported source fields.' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_binding->'installation'))<>4
  or jsonb_typeof(p_binding->'suppliedComponents') is distinct from 'object' then raise exception 'Invalid installation address.' using errcode='22023'; end if;
 foreach k in array array['street','state'] loop
  if jsonb_typeof(p_binding->'installation'->k) is distinct from 'string' or p_binding->'installation'->>k~'[[:cntrl:]]' then raise exception 'Invalid installation component.' using errcode='22023'; end if;
 end loop;
 foreach k in array array['city','zip'] loop
  if p_binding->'installation'->k is null or (p_binding->'installation'->k<>'null'::jsonb and jsonb_typeof(p_binding->'installation'->k) is distinct from 'string')
   or p_binding->'installation'->>k~'[[:cntrl:]]' then raise exception 'Invalid optional installation component.' using errcode='22023'; end if;
 end loop;
 if p_binding#>>'{installation,city}' is null and p_binding#>>'{installation,zip}' is null
  or length(p_binding#>>'{installation,street}') not between 1 and 250
  or p_binding#>>'{installation,city}' is not null and length(p_binding#>>'{installation,city}') not between 1 and 100
  or p_binding#>>'{installation,state}'!~'^[A-Z]{2}$'
  or p_binding#>>'{installation,zip}' is not null and p_binding#>>'{installation,zip}'!~'^[0-9]{5}(-[0-9]{4})?$'
  or p_binding->'suppliedComponents' is distinct from jsonb_build_object('street',true,'state',true,
   'city',p_binding#>>'{installation,city}' is not null,'zip',p_binding#>>'{installation,zip}' is not null) then
  raise exception 'Invalid installation address or supplied component flags.' using errcode='22023'; end if;
 address:=app_private.cos_imported_address(p_binding);
 if address is null or length(address) not between 1 and 600 or p_binding->>'addressSha256' is distinct from encode(sha256(convert_to(address,'UTF8')),'hex') then
  raise exception 'Imported address hash mismatch.' using errcode='22023'; end if;
end $$;

-- Never wait while holding one half of the legacy-table pair: an Owner writer
-- can insert an audit before upgrading its device-table lock. NOWAIT plus the
-- inner exception/savepoint releases a partial acquisition on contention, so
-- existing Owner writers cannot be trapped in an imported-reader lock cycle.
create function app_private.cos_imported_try_lock_legacy()
returns boolean language plpgsql set search_path='' as $$
begin
 begin
  lock table public.camera_devices in share mode nowait;
  lock table public.camera_inventory_audit in share mode nowait;
  return true;
 exception when lock_not_available then
  return false;
 end;
end $$;

-- When both locks are acquired, new aliases/audits and row edits are excluded
-- for this short transaction. Contention returns a held state without waiting.
create function app_private.cos_imported_legacy_guard(p_unit_number text)
returns jsonb language plpgsql set search_path='' as $$
declare concern text; devices jsonb; audits jsonb; ids bigint[]; suppressed boolean; variants integer;
begin
 if p_unit_number is null or length(p_unit_number) not between 1 and 160 then raise exception 'Imported unit label required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then return jsonb_build_object('allowed',false,'busy',true,'sha256',null); end if;
 concern:=app_private.cos_imported_concern_key(p_unit_number);
 select coalesce(jsonb_agg(jsonb_build_array(d.id::text,d.unit_key) order by d.id),'[]'),array_agg(d.id),count(distinct upper(btrim(d.unit_key)))
  into devices,ids,variants from public.camera_devices d where app_private.cos_imported_concern_key(d.unit_key)=concern;
 select coalesce(jsonb_agg(jsonb_build_array(a.id::text,a.unit_key,a.action::text,a.after_state->>'placement_contract',a.after_state->>'placement',a.device_ids) order by a.id),'[]'),
  coalesce(bool_or(a.after_state->>'placement_contract'='COS_CAMERA_PLACEMENT_V2'
   or a.device_ids&&coalesce(ids,'{}'::bigint[]) and app_private.cos_imported_concern_key(a.unit_key) is distinct from concern
   or a.action::text in ('MOVE_TO_ROOT','MOVE_TO_SHOP') or a.after_state->>'placement'='SHOP'),false)
  into audits,suppressed from public.camera_inventory_audit a
  where app_private.cos_imported_concern_key(a.unit_key)=concern or a.device_ids&&coalesce(ids,'{}'::bigint[]);
 return jsonb_build_object('allowed',not suppressed and variants<=1,'sha256',encode(sha256(convert_to(jsonb_build_object('concern',concern,'devices',devices,'audits',audits)::text,'UTF8')),'hex'));
end $$;

create function app_private.cos_imported_lock_binding(p_organization_id uuid,p_binding jsonb)
returns boolean language plpgsql set search_path='' as $$
declare guard jsonb; job app_private.cos_imported_geocode_jobs;
begin
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 guard:=app_private.cos_imported_legacy_guard(p_binding->>'unitNumber');
 select * into job from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
  and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid for share;
 return found and not job.invalidated and job.binding is not distinct from p_binding and guard->>'allowed'='true' and job.legacy_guard_sha256=guard->>'sha256';
end $$;

create function public.cos_imported_geocode_cursor_read(p_organization_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_geocode_cursor;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 select * into c from app_private.cos_imported_geocode_cursor where organization_id=p_organization_id;
 if not found then raise exception 'Imported source cursor unavailable.'; end if;
 return jsonb_build_object('eventId',c.event_id::text,'scanGeneration',c.scan_generation);
end $$;

-- The native source feed is a complete roster ordered by nonblocking event IDs,
-- not a globally committed watermark. Keep bounded scan progress across calls;
-- scan_complete wraps only after EOF so a late lower-ID commit is seen next cycle.
create function public.cos_imported_geocode_sync(p_organization_id uuid,p_scan_generation uuid,p_after_event_id text,p_events jsonb,p_next_event_id text)
returns jsonb language plpgsql set search_path='' as $$
declare cur app_private.cos_imported_geocode_cursor; previous bigint; next_id bigint; e jsonb; source jsonb; v_event_id bigint;
 guard jsonb; applied integer:=0; existing app_private.cos_imported_geocode_jobs; identity jsonb; saved_identity jsonb; replay boolean;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_scan_generation is null or p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$'
  or p_next_event_id is null or p_next_event_id!~'^(0|[1-9][0-9]{0,18})$'
  or p_after_event_id::numeric>9223372036854775807 or p_next_event_id::numeric>9223372036854775807
  or p_events is null or jsonb_typeof(p_events) is distinct from 'array' then raise exception 'Invalid source event page.' using errcode='22023'; end if;
 if jsonb_array_length(p_events)>100 then raise exception 'At most 100 source events required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then
  select * into cur from app_private.cos_imported_geocode_cursor where organization_id=p_organization_id;
  if not found then raise exception 'Imported source cursor unavailable.'; end if;
  return jsonb_build_object('accepted',false,'eventId',cur.event_id::text,'scanGeneration',cur.scan_generation,'applied',0,'reason','legacy_busy');
 end if;
 select * into cur from app_private.cos_imported_geocode_cursor where organization_id=p_organization_id for update;
 if not found then raise exception 'Imported source cursor unavailable.'; end if;
 next_id:=p_next_event_id::bigint;
 if cur.scan_generation<>p_scan_generation then
  return jsonb_build_object('accepted',false,'eventId',cur.event_id::text,'scanGeneration',cur.scan_generation,'applied',0); end if;
 replay:=cur.event_id<>p_after_event_id::bigint;
 if replay and (cur.event_id<>next_id or exists(select 1 from jsonb_array_elements(p_events) event
  where not exists(select 1 from app_private.cos_imported_geocode_events x where x.organization_id=p_organization_id and x.event=event-'source'))) then
  return jsonb_build_object('accepted',false,'eventId',cur.event_id::text,'scanGeneration',cur.scan_generation,'applied',0); end if;
 previous:=p_after_event_id::bigint;
 for e in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>6
   or exists(select 1 from jsonb_object_keys(e) k where k not in ('eventId','entityKind','nativeUnitId','productId','sourceRevision','source'))
   or jsonb_typeof(e->'eventId') is distinct from 'string' or e->>'eventId'!~'^[1-9][0-9]{0,18}$'
   or (e->>'eventId')::numeric>9223372036854775807 or e->>'entityKind' is null or e->>'entityKind' not in ('equipment_unit','tracker')
   or jsonb_typeof(e->'nativeUnitId') is distinct from 'string' or e->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(e->'sourceRevision') is distinct from 'string' or e->>'sourceRevision'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(e->'productId') is distinct from 'string' or e->>'productId'!~'^[1-9][0-9]{0,18}$'
   or (e->>'productId')::numeric>9223372036854775807 then raise exception 'Invalid source event.' using errcode='22023'; end if;
  v_event_id:=(e->>'eventId')::bigint;
  if v_event_id<=previous or v_event_id>next_id then raise exception 'Source event order mismatch.' using errcode='22023'; end if;
  identity:=e-'source';
  select x.event into saved_identity from app_private.cos_imported_geocode_events x where x.organization_id=p_organization_id and x.event_id=v_event_id;
  if found and saved_identity is distinct from identity then raise exception 'Immutable source event identity changed.' using errcode='22023'; end if;
  insert into app_private.cos_imported_geocode_events values(p_organization_id,v_event_id,identity) on conflict(organization_id,event_id) do nothing;
  source:=nullif(e->'source','null'::jsonb);
  if source is not null then
   perform app_private.cos_imported_assert_binding(p_organization_id,source);
   if source->>'eventId' is distinct from e->>'eventId' or source->>'entityKind' is distinct from e->>'entityKind'
    or source->>'nativeUnitId' is distinct from e->>'nativeUnitId' or source->>'productId' is distinct from e->>'productId'
    or source->>'sourceRevision' is distinct from e->>'sourceRevision' then raise exception 'Source envelope mismatch.' using errcode='22023'; end if;
  end if;
  select * into existing from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
   and entity_kind=e->>'entityKind' and native_unit_id=(e->>'nativeUnitId')::uuid for update;
  if found then
   if existing.product_id<>e->>'productId' then raise exception 'Imported source identity cannot be reassigned.' using errcode='22023'; end if;
   if existing.event_id>v_event_id then previous:=v_event_id;continue; end if;
   if existing.event_id=v_event_id then
    if existing.source_revision<>(e->>'sourceRevision')::uuid then raise exception 'Imported revision identity changed.' using errcode='22023'; end if;
    if source is null then
     update app_private.cos_imported_geocode_jobs set invalidated=true,updated_at=clock_timestamp() where organization_id=p_organization_id
      and entity_kind=existing.entity_kind and native_unit_id=existing.native_unit_id and not invalidated;
     if found then applied:=applied+1;end if;
    elsif existing.binding is distinct from source then
     -- A transient null source snapshot retires this revision. An old positive
     -- snapshot may not resurrect it; only a newer immutable revision may do so.
     if existing.binding is not null then raise exception 'Imported source snapshot changed without a revision.' using errcode='22023'; end if;
    end if;
    previous:=v_event_id;continue;
   end if;
  end if;
  guard:=case when source is not null then app_private.cos_imported_legacy_guard(source->>'unitNumber') end;
  insert into app_private.cos_imported_geocode_jobs(organization_id,entity_kind,native_unit_id,product_id,source_revision,event_id,binding,invalidated,unit_number,address,address_sha256,legacy_guard_sha256)
  values(p_organization_id,e->>'entityKind',(e->>'nativeUnitId')::uuid,e->>'productId',(e->>'sourceRevision')::uuid,v_event_id,
   source,source is null,source->>'unitNumber',app_private.cos_imported_address(source),source->>'addressSha256',guard->>'sha256')
  on conflict(organization_id,entity_kind,native_unit_id) do update set source_revision=excluded.source_revision,event_id=excluded.event_id,
   invalidated=excluded.invalidated,binding=excluded.binding,unit_number=excluded.unit_number,address=excluded.address,address_sha256=excluded.address_sha256,
   legacy_guard_sha256=excluded.legacy_guard_sha256,updated_at=clock_timestamp();
  applied:=applied+1;previous:=v_event_id;
 end loop;
 if previous<>next_id then raise exception 'Source cursor cannot skip unseen events.' using errcode='22023'; end if;
 if not replay then
  update app_private.cos_imported_geocode_cursor set event_id=next_id,last_page_count=jsonb_array_length(p_events) where organization_id=p_organization_id;
 end if;
 return jsonb_build_object('accepted',true,'eventId',next_id::text,'scanGeneration',cur.scan_generation,'applied',applied);
end $$;

create function public.cos_imported_geocode_scan_complete(p_organization_id uuid,p_after_event_id text,p_scan_generation uuid)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_geocode_cursor;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_scan_generation is null or p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$' or p_after_event_id::numeric>9223372036854775807 then
  raise exception 'Invalid completed scan identity.' using errcode='22023'; end if;
 select * into c from app_private.cos_imported_geocode_cursor where organization_id=p_organization_id for update;
 if not found then raise exception 'Imported source cursor unavailable.'; end if;
 if c.scan_generation<>p_scan_generation or c.event_id<>p_after_event_id::bigint or c.last_page_count is null or c.last_page_count>=100 then
  return jsonb_build_object('accepted',false,'eventId',c.event_id::text,'scanGeneration',c.scan_generation); end if;
 update app_private.cos_imported_geocode_cursor set event_id=0,scan_generation=gen_random_uuid(),last_page_count=null
  where organization_id=p_organization_id returning * into c;
 return jsonb_build_object('accepted',true,'eventId','0','scanGeneration',c.scan_generation);
end $$;

create function public.cos_imported_geocode_invalidate(p_organization_id uuid,p_binding jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare changed integer;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 update app_private.cos_imported_geocode_jobs set invalidated=true,updated_at=clock_timestamp()
  where organization_id=p_organization_id and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid
   and binding=p_binding and not invalidated;
 get diagnostics changed=row_count;
 return jsonb_build_object('accepted',changed=1);
end $$;

create function app_private.cos_imported_record(p_binding jsonb,p_guard text,p_geo app_private.cos_field_geocode_fallback_cache)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',p_binding,'jobKind','native_import','legacyGuardSha256',p_guard,'address',p_geo.address,
  'status',p_geo.status,'provider','geocodio','source','geocodio_automatic_address_estimate','confidence','estimate',
  'accuracyType',p_geo.accuracy_type,'accuracy',p_geo.provider_accuracy,'matchType',p_geo.provider_match_type,
  'verified',false,'liveGps',false,'latitude',p_geo.latitude,'longitude',p_geo.longitude,'matchedAddress',p_geo.matched_address,
  'geocodedAt',p_geo.geocoded_at,'reason',p_geo.reason,'attempts',p_geo.attempts,'nextAttemptAt',p_geo.next_attempt_at,
  'leaseUntil',p_geo.lease_until,'updatedAt',p_geo.updated_at)
$$;
create function app_private.cos_imported_census_record(p_binding jsonb,p_guard text,p_census app_private.cos_imported_census_cache)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',p_binding,'jobKind','native_import','legacyGuardSha256',p_guard,'address',p_census.address,
  'status',p_census.status,'provider','us_census_address_range','benchmark','Public_AR_Current','source','us_census_address_range_estimate',
  'confidence','address_range_interpolation','accuracyType','range_interpolation','accuracy',null,'matchType',null,
  'verified',false,'liveGps',false,'latitude',p_census.latitude,'longitude',p_census.longitude,'matchedAddress',p_census.matched_address,
  'geocodedAt',p_census.geocoded_at,'reason',p_census.reason,'attempts',p_census.attempts,'nextAttemptAt',p_census.next_attempt_at,
  'leaseUntil',p_census.lease_until,'updatedAt',p_census.updated_at)
$$;
create function app_private.cos_imported_status_record(p_binding jsonb,p_guard text,p_status text,p_reason text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',p_binding,'jobKind','native_import','legacyGuardSha256',p_guard,
  'status',p_status,'reason',p_reason,'provider',null,'verified',false,'liveGps',false,
  'latitude',null,'longitude',null,'matchedAddress',null,'geocodedAt',null)
$$;

create function public.cos_imported_geocode_list_due(p_organization_id uuid,p_limit integer default 80)
returns jsonb language plpgsql set search_path='' as $$
declare job app_private.cos_imported_geocode_jobs; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 result jsonb:='[]'; seen text[]:='{}'; stage text; v_now timestamptz:=clock_timestamp(); guard jsonb; enabled boolean;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 80 then raise exception 'At most 80 imported addresses required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then return '[]'::jsonb; end if;
 select exists(select 1 from app_private.cos_geocodio_control ctl where singleton and ctl.enabled and free_only)
  and exists(select 1 from app_private.cos_geocodio_account_state where singleton and (blocked_until is null or blocked_until<=v_now)
   and (cooldown_until is null or cooldown_until<=v_now)) into enabled;
 for job in select * from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id and binding is not null and not invalidated order by event_id,entity_kind,native_unit_id loop
  if job.address_sha256=any(seen) then continue; end if;
  guard:=app_private.cos_imported_legacy_guard(job.unit_number);
  if guard->>'allowed'<>'true' or guard->>'sha256' is distinct from job.legacy_guard_sha256 then continue; end if;
  select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
  stage:=null;
  if not found or c.status in ('pending','provider_error') and (c.lease_until is null or c.lease_until<=v_now) and (c.next_attempt_at is null or c.next_attempt_at<=v_now) then stage:='census';
  elsif c.status='no_match' and enabled then
   select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
   if not found or f.status in ('pending','provider_error','deferred') and (f.lease_until is null or f.lease_until<=v_now) and (f.next_attempt_at is null or f.next_attempt_at<=v_now) then stage:='geocodio'; end if;
  end if;
  if stage is not null then
   result:=result||jsonb_build_array(jsonb_build_object('binding',job.binding,'legacyGuardSha256',job.legacy_guard_sha256,'stage',stage));
   seen:=array_append(seen,job.address_sha256);
   if jsonb_array_length(result)>=p_limit then exit; end if;
  end if;
 end loop;
 return result;
end $$;

create function public.cos_imported_geocode_census_claim(p_organization_id uuid,p_binding jsonb,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_census_cache; req app_private.cos_imported_census_requests; owner app_private.cos_field_geocode_cache;
 address text; sha text; guard text; v_now timestamptz; v_day date;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 if p_request_id is null then raise exception 'Census request identity required.' using errcode='22023'; end if;
 if not app_private.cos_imported_lock_binding(p_organization_id,p_binding) then return jsonb_build_object('claimed',false,'claimToken',null,'reason','superseded','record',null); end if;
 address:=app_private.cos_imported_address(p_binding);sha:=p_binding->>'addressSha256';
 select legacy_guard_sha256 into guard from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('claimed',false,'claimToken',null,'reason','configuration_unavailable','record',null); end if;
 v_now:=clock_timestamp();v_day:=(v_now at time zone 'America/New_York')::date;
 if exists(select 1 from app_private.cos_imported_census_requests where request_id=p_request_id) then return jsonb_build_object('claimed',false,'claimToken',null,'reason','request_replayed','record',null); end if;
 insert into app_private.cos_imported_census_cache(organization_id,address_sha256,address) values(p_organization_id,sha,address) on conflict do nothing;
 select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=sha for update;
 if c.address is distinct from address then raise exception 'Imported Census hash binding changed.' using errcode='40001'; end if;
 if c.status in ('success','no_match','invalid_address') then return jsonb_build_object('claimed',false,'claimToken',null,'reason','cache_hit','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 if c.active_request_id is not null then
  if c.lease_until>v_now then return jsonb_build_object('claimed',false,'claimToken',null,'reason','duplicate_inflight','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
  update app_private.cos_imported_census_requests set completed_at=v_now,outcome=jsonb_build_object('reason','lease_expired') where request_id=c.active_request_id and completed_at is null;
  update app_private.cos_imported_census_cache set status='provider_error',reason='provider_timeout',active_request_id=null,lease_until=null,
   next_attempt_at=case when attempts>=3 and attempt_day=v_day then app_private.cos_geocodio_next_reset(v_now) else v_now+interval '120 seconds' end,updated_at=v_now
   where organization_id=p_organization_id and address_sha256=sha returning * into c;
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','provider_timeout','record',app_private.cos_imported_census_record(p_binding,guard,c));
 end if;
 if c.next_attempt_at>v_now or c.attempt_day=v_day and c.attempts>=3 then return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_deferred','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 -- Legacy Census success validation discards ZIP+4; never promote such a
 -- success into the stricter imported pipeline. Only a safe no_match can be reused.
 select * into owner from app_private.cos_field_geocode_cache where organization_id=p_organization_id and address_sha256=sha and cos_field_geocode_cache.address=c.address and status='no_match' order by geocoded_at desc limit 1;
 if found then
  update app_private.cos_imported_census_cache set status=owner.status,reason=owner.reason,latitude=owner.latitude,longitude=owner.longitude,
   matched_address=owner.matched_address,geocoded_at=owner.geocoded_at,updated_at=v_now where organization_id=p_organization_id and address_sha256=sha returning * into c;
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','cache_hit','record',app_private.cos_imported_census_record(p_binding,guard,c));
 end if;
 if exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=p_organization_id and x.address_sha256=sha and x.address=c.address and x.status='pending' and x.lease_until>v_now) then
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','duplicate_inflight','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 insert into app_private.cos_imported_census_requests(request_id,organization_id,binding,legacy_guard_sha256,address_sha256,reserved_at,lease_until)
 values(p_request_id,p_organization_id,p_binding,guard,sha,v_now,v_now+interval '60 seconds') returning * into req;
 update app_private.cos_imported_census_cache set status='pending',reason=null,attempts=case when attempt_day=v_day then attempts+1 else 1 end,
  attempt_day=v_day,active_request_id=p_request_id,lease_until=req.lease_until,next_attempt_at=null,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=sha returning * into c;
 return jsonb_build_object('claimed',true,'claimToken',req.claim_token,'record',app_private.cos_imported_census_record(p_binding,guard,c));
end $$;

create function public.cos_imported_geocode_census_finish(p_organization_id uuid,p_binding jsonb,p_claim_token uuid,p_source_current boolean,p_status text,
 p_latitude double precision default null,p_longitude double precision default null,p_matched_address text default null,p_reason text default null)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_census_cache; req app_private.cos_imported_census_requests; v_now timestamptz; current_binding boolean; v_outcome jsonb; v_reason text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 if p_claim_token is null or p_status is null or p_status not in ('success','no_match','invalid_address','provider_error') then raise exception 'Invalid imported Census completion.' using errcode='22023'; end if;
 v_reason:=case when p_status in ('no_match','invalid_address') then p_status else p_reason end;
 if p_status='success' and (p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180)
  or p_matched_address is null or length(btrim(p_matched_address)) not between 1 and 600 or p_matched_address~'[[:cntrl:]]' or p_reason is not null)
  or p_status<>'success' and (p_latitude is not null or p_longitude is not null or p_matched_address is not null)
  or p_status='provider_error' and (p_reason is null or p_reason not in ('provider_timeout','provider_unavailable','invalid_response'))
  or p_status in ('no_match','invalid_address') and p_reason is not null and p_reason<>p_status then raise exception 'Invalid safe Census result.' using errcode='22023'; end if;
 current_binding:=app_private.cos_imported_lock_binding(p_organization_id,p_binding) and p_source_current is true;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 select * into req from app_private.cos_imported_census_requests where claim_token=p_claim_token and organization_id=p_organization_id and binding=p_binding for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=p_binding->>'addressSha256' for update;
 v_outcome:=jsonb_build_object('status',p_status,'latitude',p_latitude,'longitude',p_longitude,'matchedAddress',p_matched_address,'reason',v_reason);
 v_now:=clock_timestamp();
 if req.completed_at is not null then return jsonb_build_object('accepted',current_binding and req.outcome=v_outcome,'record',case when current_binding then app_private.cos_imported_census_record(p_binding,req.legacy_guard_sha256,c) end); end if;
 if not current_binding or req.lease_until<=v_now or c.active_request_id is distinct from req.request_id then
  update app_private.cos_imported_census_requests set completed_at=v_now,outcome=jsonb_build_object('reason','superseded_or_expired') where request_id=req.request_id;
  return jsonb_build_object('accepted',false,'record',null); end if;
 update app_private.cos_imported_census_requests set completed_at=v_now,outcome=v_outcome where request_id=req.request_id;
 update app_private.cos_imported_census_cache set status=p_status,reason=v_reason,latitude=p_latitude,longitude=p_longitude,matched_address=p_matched_address,
  geocoded_at=v_now,active_request_id=null,lease_until=null,updated_at=v_now,
  next_attempt_at=case when p_status='provider_error' then case when attempts>=3 then app_private.cos_geocodio_next_reset(v_now)
   else v_now+case when attempts=1 then interval '30 seconds' else interval '120 seconds' end end end
  where organization_id=p_organization_id and address_sha256=p_binding->>'addressSha256' returning * into c;
 return jsonb_build_object('accepted',true,'record',app_private.cos_imported_census_record(p_binding,req.legacy_guard_sha256,c));
end $$;

-- Paid imported wrappers deliberately share the existing account lock,
-- address cache, request UUID namespace, and daily counter with Owner jobs.
create function public.cos_imported_geocode_reserve(p_organization_id uuid,p_binding jsonb,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; v_guard text; p_unit_key text; p_address text; p_address_sha256 text;
 account app_private.cos_geocodio_account_state; reservation app_private.cos_geocodio_reservations;
 v_now timestamptz; v_day date; v_reset timestamptz; v_reason text; v_next timestamptz; v_credits integer; v_send_before timestamptz;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 p_unit_key:=p_binding->>'unitNumber';p_address:=app_private.cos_imported_address(p_binding);p_address_sha256:=p_binding->>'addressSha256';
 if p_request_id is null then raise exception 'Reservation identity required.' using errcode='22023'; end if;
 if not app_private.cos_imported_lock_binding(p_organization_id,p_binding) then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','superseded','record',null); end if;
 select legacy_guard_sha256 into v_guard from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
  and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid;
 -- Global account row lock precedes every budget/address write, across organizations.
 -- No HTTP happens in this transaction. Return only after reservation and credit commit.
 select * into account from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;
 perform 1 from app_private.cos_imported_census_cache c where c.organization_id=p_organization_id and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
 v_now:=clock_timestamp(); v_day:=(v_now at time zone 'America/New_York')::date; v_reset:=app_private.cos_geocodio_next_reset(v_now); v_send_before:=app_private.cos_geocodio_send_before(v_now);
 if exists(select 1 from app_private.cos_geocodio_reservations where request_id=p_request_id) then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','reservation_replayed','record',null,'resetAt',v_reset); end if;
 insert into app_private.cos_field_geocode_fallback_cache(organization_id,address,address_sha256)
 values(p_organization_id,p_address,p_address_sha256) on conflict (organization_id,address_sha256) do nothing;
 select * into r from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=p_address_sha256 for update;
 if r.address is distinct from p_address then raise exception 'Address hash binding changed.' using errcode='40001'; end if;
 if r.status in ('success','no_match') then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','cache_hit','record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset); end if;
 if r.active_request_id is not null then
  if r.lease_until>v_now then
   return jsonb_build_object('reserved',false,'reservationToken',null,'reason','duplicate_inflight','record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset); end if;
  -- An uncertain/timeout request is consumed forever. Do not resend in this invocation.
  update app_private.cos_geocodio_reservations set completed_at=v_now,outcome=jsonb_build_object('reason','lease_expired')
   where request_id=r.active_request_id and completed_at is null;
  update app_private.cos_field_geocode_fallback_cache set status='provider_error',reason='provider_timeout',active_request_id=null,lease_until=null,
   next_attempt_at=case when attempts>=3 and attempt_day=v_day then v_reset else v_now+interval '120 seconds' end,updated_at=v_now
   where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','provider_timeout','record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset);
 end if;
 select * into ctl from app_private.cos_geocodio_control where singleton;
 if not found or not ctl.enabled or not ctl.free_only then v_reason:='configuration_unavailable'; v_next:=v_reset;
 elsif account.blocked_until>v_now then v_reason:='provider_forbidden'; v_next:=account.blocked_until;
 elsif account.cooldown_until>v_now then v_reason:='provider_rate_limited'; v_next:=account.cooldown_until;
 elsif r.next_attempt_at>v_now then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason',r.reason,'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset);
 elsif r.attempt_day=v_day and r.attempts>=3 then v_reason:='daily_attempt_limit'; v_next:=v_reset;
 elsif v_send_before is null then v_reason:='budget_exhausted'; v_next:=v_reset;
 else
  insert into app_private.cos_geocodio_daily_budget(budget_day) values(v_day) on conflict do nothing;
  -- Atomic guard is defense in depth alongside the serialized account lock.
  update app_private.cos_geocodio_daily_budget set credits=credits+1 where budget_day=v_day and credits<ctl.daily_limit returning credits into v_credits;
  if not found then v_reason:='budget_exhausted'; v_next:=v_reset; end if;
 end if;
 if v_reason is not null then
  update app_private.cos_field_geocode_fallback_cache set status='deferred',reason=v_reason,next_attempt_at=v_next,updated_at=v_now
   where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason',v_reason,'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset);
 end if;
 insert into app_private.cos_geocodio_reservations(request_id,organization_id,audit_id,unit_key,address,address_sha256,budget_day,reserved_at,lease_until,send_before,job_kind,native_binding,legacy_guard_sha256)
 values(p_request_id,p_organization_id,null,p_unit_key,p_address,p_address_sha256,v_day,v_now,v_now+interval '60 seconds',v_send_before,'native_import',p_binding,v_guard) returning * into reservation;
 update app_private.cos_field_geocode_fallback_cache set status='pending',reason=null,
  attempts=case when attempt_day=v_day then attempts+1 else 1 end,attempt_day=v_day,
  active_request_id=p_request_id,lease_until=reservation.lease_until,next_attempt_at=null,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
 return jsonb_build_object('reserved',true,'reservationToken',reservation.reservation_token,'reason',null,
  'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset,'sendBefore',reservation.send_before,'remaining',ctl.daily_limit-v_credits);
end $$;

create function public.cos_imported_geocode_finish(p_organization_id uuid,p_binding jsonb,p_reservation_token uuid,p_source_current boolean,p_status text,
 p_latitude double precision default null,p_longitude double precision default null,p_matched_address text default null,
 p_accuracy_type text default null,p_accuracy double precision default null,p_match_type text default null,p_reason text default null,p_retry_after_seconds integer default null)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; reservation app_private.cos_geocodio_reservations;
 v_now timestamptz; v_reset timestamptz; v_current boolean; v_outcome jsonb; v_next timestamptz; v_status text; v_reason text; v_guard text; p_unit_key text; p_address text; p_address_sha256 text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 p_unit_key:=p_binding->>'unitNumber';p_address:=app_private.cos_imported_address(p_binding);p_address_sha256:=p_binding->>'addressSha256';
 if p_reservation_token is null or p_status is null or p_status not in ('success','no_match','provider_error') then
  raise exception 'Invalid fallback completion.' using errcode='22023'; end if;
 if p_status='success' and (p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180)
  or p_matched_address is null or length(btrim(p_matched_address)) not between 1 and 600 or p_matched_address~'[[:cntrl:]]'
  or p_accuracy_type is null or p_accuracy_type not in ('rooftop','range_interpolation')
  or p_accuracy is null or not(p_accuracy between 0.9 and 1)
  or p_match_type is not null and p_match_type not in ('building_centroid','parcel_centroid')
  or p_accuracy_type='range_interpolation' and p_match_type is not null or p_reason is not null or p_retry_after_seconds is not null)
  or p_status<>'success' and (p_latitude is not null or p_longitude is not null or p_matched_address is not null
   or p_accuracy_type is not null or p_accuracy is not null or p_match_type is not null)
  or p_status='no_match' and (p_reason is not null and p_reason<>'no_match' or p_retry_after_seconds is not null)
  or p_status='provider_error' and (p_reason is null or p_reason not in ('provider_timeout','provider_unavailable','invalid_response','provider_forbidden','provider_rate_limited'))
  or p_retry_after_seconds is not null and (p_reason is distinct from 'provider_rate_limited' or p_retry_after_seconds not between 1 and 86400) then
  raise exception 'Invalid safe fallback result.' using errcode='22023'; end if;
 v_outcome:=jsonb_build_object('status',p_status,'latitude',p_latitude,'longitude',p_longitude,'matchedAddress',p_matched_address,
  'accuracyType',p_accuracy_type,'accuracy',p_accuracy,'matchType',p_match_type,'reason',p_reason,'retryAfterSeconds',p_retry_after_seconds);
 -- The source-current assertion is service-only and must follow a fresh native
 -- bridge read. The local deny-only guard is recomputed independently here.
 v_current:=app_private.cos_imported_lock_binding(p_organization_id,p_binding) and p_source_current is true;
 select legacy_guard_sha256 into v_guard from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
  and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 if v_current then
  perform 1 from app_private.cos_imported_census_cache c where c.organization_id=p_organization_id and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
  v_current:=found;
 end if;
 select * into reservation from app_private.cos_geocodio_reservations where reservation_token=p_reservation_token
  and organization_id=p_organization_id and job_kind='native_import' and audit_id is null and native_binding=p_binding
  and unit_key=p_unit_key and address=p_address and address_sha256=p_address_sha256 for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 v_now:=clock_timestamp(); v_reset:=app_private.cos_geocodio_next_reset(v_now);
 select * into r from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=p_address_sha256 for update;
 if reservation.completed_at is not null then
  -- A sweeper may expire a lease before a delayed HTTP 403/429 reaches finish.
  -- Accept its account-stop signal once, without accepting or refunding the request.
  -- Replays cannot extend the stop on a subsequent day.
  if reservation.outcome->>'reason'='lease_expired' and p_reason in ('provider_forbidden','provider_rate_limited') then
   if p_reason='provider_forbidden' then
    update app_private.cos_geocodio_account_state set blocked_until=greatest(blocked_until,v_reset) where singleton;
   else
    update app_private.cos_geocodio_account_state set cooldown_until=greatest(cooldown_until,
     v_now+make_interval(secs=>greatest(30,least(86400,coalesce(p_retry_after_seconds,60))))) where singleton;
   end if;
   update app_private.cos_geocodio_reservations set outcome=jsonb_build_object('reason','late_account_signal','providerReason',p_reason)
    where request_id=reservation.request_id;
  end if;
  return jsonb_build_object('accepted',v_current and reservation.outcome=v_outcome,'record',case when v_current then app_private.cos_imported_record(p_binding,v_guard,r) end);
 end if;
 if p_reason='provider_forbidden' then
  update app_private.cos_geocodio_account_state set blocked_until=greatest(blocked_until,v_reset) where singleton;
 elsif p_reason='provider_rate_limited' then
  v_next:=v_now+make_interval(secs=>greatest(30,least(86400,coalesce(p_retry_after_seconds,60))));
  update app_private.cos_geocodio_account_state set cooldown_until=greatest(cooldown_until,v_next) where singleton;
 end if;
 if not v_current or reservation.lease_until<=v_now or r.active_request_id is distinct from reservation.request_id then
  -- Keep expired/stale credit charged; cache remains unavailable until reserve recovers its lease.
  update app_private.cos_geocodio_reservations set completed_at=v_now,outcome=jsonb_build_object('reason','superseded_or_expired') where request_id=reservation.request_id;
  return jsonb_build_object('accepted',false,'record',null);
 end if;
 v_status:=p_status; v_reason:=case when p_status='no_match' then 'no_match' else p_reason end;
 if p_status='provider_error' then
  if p_reason='provider_forbidden' then v_status:='deferred'; v_next:=v_reset;
  elsif p_reason='provider_rate_limited' then
   v_status:='deferred'; v_next:=greatest(v_next,case when r.attempts>=3 then v_reset else v_now end);
  elsif r.attempts>=3 then v_status:='deferred'; v_next:=v_reset;
  else v_next:=v_now+case when r.attempts=1 then interval '30 seconds' else interval '120 seconds' end;
  end if;
 end if;
 update app_private.cos_geocodio_reservations set completed_at=v_now,outcome=v_outcome where request_id=reservation.request_id;
 update app_private.cos_field_geocode_fallback_cache set status=v_status,reason=v_reason,
  latitude=p_latitude,longitude=p_longitude,matched_address=p_matched_address,accuracy_type=p_accuracy_type,
  provider_accuracy=p_accuracy,provider_match_type=p_match_type,geocoded_at=v_now,
  active_request_id=null,lease_until=null,next_attempt_at=v_next,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
 return jsonb_build_object('accepted',true,'record',app_private.cos_imported_record(p_binding,v_guard,r));
end $$;


create function public.cos_imported_geocode_read_many(p_organization_id uuid,p_bindings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_binding jsonb; job app_private.cos_imported_geocode_jobs; guard jsonb; c app_private.cos_imported_census_cache;
 f app_private.cos_field_geocode_fallback_cache; result jsonb:='[]'; record jsonb; legacy_locked boolean;
begin
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501'; end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' then
  if not app_private.cos_verified_fleet_actor(auth.uid()) then raise exception 'Owner account required.' using errcode='42501'; end if;
 end if;
 if p_bindings is null or jsonb_typeof(p_bindings) is distinct from 'array' then raise exception 'Imported bindings required.' using errcode='22023'; end if;
 if jsonb_array_length(p_bindings)>250 then raise exception 'At most 250 imported bindings required.' using errcode='22023'; end if;
 legacy_locked:=app_private.cos_imported_try_lock_legacy();
 for v_binding in select value from jsonb_array_elements(p_bindings) loop
  perform app_private.cos_imported_assert_binding(p_organization_id,v_binding);
  select * into job from app_private.cos_imported_geocode_jobs j where j.organization_id=p_organization_id and j.entity_kind=v_binding->>'entityKind'
   and j.native_unit_id=(v_binding->>'nativeUnitId')::uuid and j.binding=v_binding for share;
  if not found then continue; end if;
  if not legacy_locked then
   result:=result||jsonb_build_array(app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'held','legacy_busy'));
   continue;
  end if;
  guard:=app_private.cos_imported_legacy_guard(job.unit_number);
  if job.invalidated or guard->>'allowed'<>'true' or guard->>'sha256' is distinct from job.legacy_guard_sha256 then
   record:=app_private.cos_imported_status_record(v_binding,guard->>'sha256','held',case when job.invalidated then 'source_changed' else 'legacy_override' end);
  else
   select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
   if not found then record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'pending','census_pending');
   elsif c.status<>'no_match' then record:=app_private.cos_imported_census_record(v_binding,job.legacy_guard_sha256,c);
   else
    select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
    if found then record:=app_private.cos_imported_record(v_binding,job.legacy_guard_sha256,f);
    elsif not exists(select 1 from app_private.cos_geocodio_control where singleton and enabled and free_only) then
     record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'deferred','configuration_unavailable');
    else record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'pending','geocodio_pending'); end if;
   end if;
  end if;
  result:=result||jsonb_build_array(record);
 end loop;
 return result;
end $$;

-- Explicit privilege isolation for every new helper and RPC. The existing
-- Owner/IT reader gate is the only authenticated surface; workers are service-only.
do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('app_private','public') and p.proname like 'cos_imported_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function public.cos_imported_geocode_read_many(uuid,jsonb) to authenticated;
commit;
