-- REVIEW ARTIFACT: legacy project, after imported/postal/queue artifacts.
-- Same queue, cursor, Census/Geocodio caches, reservations and 2400-credit control.
-- No vendor calls, source sync, enrollment or grants beyond this helper's existing service boundary.
begin;
alter table app_private.cos_imported_geocode_jobs
 alter column product_id drop not null,
 add column source_system text not null default 'mhelpdesk_product_import',
 add column source_record_id text;
create unique index cos_imported_typed_source_identity on app_private.cos_imported_geocode_jobs(organization_id,source_system,coalesce(source_record_id,product_id));
create function app_private.cos_imported_source_identity(p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid typed source identity.' using errcode='22023';end if;
 if p->>'sourceSystem'='google_sheet_tracker' then
  if p->>'entityKind' is distinct from 'tracker' or p ? 'productId' or jsonb_typeof(p->'sourceRecordId') is distinct from 'string'
   or length(p->>'sourceRecordId')>400 or p->>'sourceRecordId'!~'^google_sheet:[A-Za-z0-9_-]{10,128}:(0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$'
   then raise exception 'Invalid tracker source identity.' using errcode='22023';end if;
  return jsonb_build_object('sourceSystem','google_sheet_tracker','sourceRecordId',p->>'sourceRecordId');
 end if;
 if coalesce(p->>'sourceSystem','mhelpdesk_product_import')<>'mhelpdesk_product_import' or p ? 'sourceRecordId'
  or jsonb_typeof(p->'productId') is distinct from 'string' or p->>'productId'!~'^[1-9][0-9]{0,18}$'
  or (p->>'productId')::numeric>9223372036854775807 then raise exception 'Invalid product source identity.' using errcode='22023';end if;
 return jsonb_build_object('sourceSystem','mhelpdesk_product_import','sourceRecordId',p->>'productId');
end $$;
revoke all on function app_private.cos_imported_source_identity(jsonb) from public,anon,authenticated;
grant execute on function app_private.cos_imported_source_identity(jsonb) to service_role;
alter table app_private.cos_imported_geocode_jobs add constraint cos_imported_typed_identity check(
 (source_system='mhelpdesk_product_import' and product_id is not null and source_record_id is null)
 or (source_system='google_sheet_tracker' and entity_kind='tracker' and product_id is null and source_record_id is not null));


create or replace function app_private.cos_imported_assert_binding(p_organization_id uuid,p_binding jsonb)
returns void language plpgsql set search_path='' as $$
declare k text; address text;
begin
 if p_binding is null or jsonb_typeof(p_binding) is distinct from 'object'
  or not coalesce((p_binding->'schemaVersion'='1'::jsonb and p_binding->>'sourceSystem'='mhelpdesk_product_import' or p_binding->'schemaVersion'='2'::jsonb and p_binding->>'sourceSystem'='google_sheet_tracker'),false) or p_binding->>'organizationId' is distinct from p_organization_id::text
  or p_binding->>'eligibility' is distinct from 'FIELD'
  or p_binding->>'entityKind' is null or p_binding->>'entityKind' not in ('equipment_unit','tracker')
  or (select count(*) from jsonb_object_keys(p_binding))<>18
  or exists(select 1 from jsonb_object_keys(p_binding) x where x not in ('schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','sourceRecordId','unitNumber','family','variant','sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','installation','suppliedComponents','eligibility','eventId')) then
  raise exception 'Invalid imported source binding.' using errcode='22023'; end if;
 perform app_private.cos_imported_source_identity(p_binding);
 foreach k in array array['nativeUnitId','sourceRevision','unitNumber','family','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId'] loop
  if jsonb_typeof(p_binding->k) is distinct from 'string' then raise exception 'Invalid imported source field.' using errcode='22023'; end if;
 end loop;
 if p_binding->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_binding->>'sourceRevision'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_binding->>'eventId'!~'^[1-9][0-9]{0,18}$'
 or (p_binding->>'eventId')::numeric>9223372036854775807
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

create or replace function public.cos_imported_geocode_sync(p_organization_id uuid,p_scan_generation uuid,p_after_event_id text,p_events jsonb,p_next_event_id text)
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
  if jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>(case when e->>'sourceSystem'='google_sheet_tracker' then 7 else 6 end)
   or exists(select 1 from jsonb_object_keys(e) k where k not in ('eventId','entityKind','nativeUnitId','productId','sourceSystem','sourceRecordId','sourceRevision','source'))
   or jsonb_typeof(e->'eventId') is distinct from 'string' or e->>'eventId'!~'^[1-9][0-9]{0,18}$'
   or (e->>'eventId')::numeric>9223372036854775807 or e->>'entityKind' is null or e->>'entityKind' not in ('equipment_unit','tracker')
   or jsonb_typeof(e->'nativeUnitId') is distinct from 'string' or e->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(e->'sourceRevision') is distinct from 'string' or e->>'sourceRevision'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid source event.' using errcode='22023'; end if;
  perform app_private.cos_imported_source_identity(e);
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
    or source->>'nativeUnitId' is distinct from e->>'nativeUnitId' or app_private.cos_imported_source_identity(source) is distinct from app_private.cos_imported_source_identity(e)
    or source->>'sourceRevision' is distinct from e->>'sourceRevision' then raise exception 'Source envelope mismatch.' using errcode='22023'; end if;
  end if;
  select * into existing from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
   and entity_kind=e->>'entityKind' and native_unit_id=(e->>'nativeUnitId')::uuid for update;
  if found then
   if jsonb_build_object('sourceSystem',existing.source_system,'sourceRecordId',coalesce(existing.source_record_id,existing.product_id)) is distinct from app_private.cos_imported_source_identity(e) then raise exception 'Imported source identity cannot be reassigned.' using errcode='22023'; end if;
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
  insert into app_private.cos_imported_geocode_jobs(organization_id,entity_kind,native_unit_id,product_id,source_system,source_record_id,source_revision,event_id,binding,invalidated,unit_number,address,address_sha256,legacy_guard_sha256)
  values(p_organization_id,e->>'entityKind',(e->>'nativeUnitId')::uuid,e->>'productId',coalesce(e->>'sourceSystem','mhelpdesk_product_import'),e->>'sourceRecordId',(e->>'sourceRevision')::uuid,v_event_id,
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

create or replace function public.cos_imported_geocode_postal_retry_enroll(p_organization_id uuid,p_bindings jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare manifest jsonb; prior jsonb; b jsonb; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 n integer:=0;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_bindings is null or jsonb_typeof(p_bindings) is distinct from 'array' then raise exception 'Reviewed retry manifest required.' using errcode='22023'; end if;
 if jsonb_array_length(p_bindings) not between 1 and 80 then raise exception 'Retry manifest must contain 1 to 80 bindings.' using errcode='22023'; end if;
 select jsonb_agg(value order by value->>'addressSha256',value::text) into manifest from (select distinct value from jsonb_array_elements(p_bindings)) d;
 -- Validate/lock current identities before the global account row, as existing workers do.
 for b in select value from jsonb_array_elements(manifest) loop
  perform app_private.cos_imported_assert_binding(p_organization_id,b);
  if b->'schemaVersion' is distinct from '1'::jsonb or b->>'sourceSystem' is distinct from 'mhelpdesk_product_import' then raise exception 'Historical postal cohort requires V1 product sources.' using errcode='22023';end if;
  if jsonb_typeof(b#>'{installation,zip}') is distinct from 'string' or b#>>'{installation,zip}'!~'^[0-9]{5}-[0-9]{4}$' then
   raise exception 'Retry manifest requires original string ZIP+4 bindings.' using errcode='22023'; end if;
 end loop;
 -- A replay is read-only even after the enrolled sources changed or completed.
 select x.manifest into prior from app_private.cos_imported_postal_retry_batches x
  where x.organization_id=p_organization_id and x.policy_version='us_zip_precision_v1';
 if found then
  if prior is distinct from manifest then raise exception 'Postal retry cohort is frozen.' using errcode='22023'; end if;
  select count(*) into n from app_private.cos_imported_postal_retry_jobs where organization_id=p_organization_id and policy_version='us_zip_precision_v1';
  return jsonb_build_object('policyVersion','us_zip_precision_v1','enrolled',0,'existing',n,'skipped',0);
 end if;
 for b in select value from jsonb_array_elements(manifest) loop
  if not app_private.cos_imported_lock_binding(p_organization_id,b) then raise exception 'Retry source is not current or is held.' using errcode='40001'; end if;
 end loop;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then raise exception 'Geocoder configuration unavailable.' using errcode='22023'; end if;
 -- Recheck under the common serialization lock: concurrent enrollments cannot expand the cohort.
 select x.manifest into prior from app_private.cos_imported_postal_retry_batches x
  where x.organization_id=p_organization_id and x.policy_version='us_zip_precision_v1';
 if found then
  if prior is distinct from manifest then raise exception 'Postal retry cohort is frozen.' using errcode='22023'; end if;
  select count(*) into n from app_private.cos_imported_postal_retry_jobs where organization_id=p_organization_id and policy_version='us_zip_precision_v1';
  return jsonb_build_object('policyVersion','us_zip_precision_v1','enrolled',0,'existing',n,'skipped',0);
 end if;
 insert into app_private.cos_imported_postal_retry_batches(organization_id,policy_version,manifest) values(p_organization_id,'us_zip_precision_v1',manifest);
 for b in select distinct on(value->>'addressSha256') value from jsonb_array_elements(manifest) order by value->>'addressSha256',value::text loop
  select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=b->>'addressSha256' for update;
  if not found or c.status<>'no_match' or c.reason is distinct from 'no_match' or c.address is distinct from app_private.cos_imported_address(b)
   or c.active_request_id is not null or c.lease_until is not null then raise exception 'Retry requires an exact terminal Census no_match.' using errcode='40001'; end if;
  select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=b->>'addressSha256' for update;
  if found and (f.status<>'no_match' or f.reason is distinct from 'no_match' or f.address is distinct from c.address or f.active_request_id is not null or f.lease_until is not null) then
   raise exception 'Retry fallback must be absent or exact terminal no_match.' using errcode='40001'; end if;
  -- Never enroll while another legacy Census request for this address is in flight.
  if exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=p_organization_id and x.address_sha256=c.address_sha256
   and x.address=c.address and x.status='pending' and x.lease_until>clock_timestamp()) then raise exception 'Retry address is in flight.' using errcode='40001'; end if;
  insert into app_private.cos_imported_postal_retry_jobs(organization_id,policy_version,address_sha256,address,binding,census_before,fallback_before)
   values(p_organization_id,'us_zip_precision_v1',c.address_sha256,c.address,b,to_jsonb(c),case when f.organization_id is not null then to_jsonb(f) end);
  n:=n+1;
 end loop;
 return jsonb_build_object('policyVersion','us_zip_precision_v1','enrolled',n,'existing',0,'skipped',0);
end $$;

commit;
