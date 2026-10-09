-- REVIEW ONLY. Legacy project after tracker V2 and source-precedence-contract.sql.
-- Existing Owner/IT audit rows, queue leases, caches and budgets are never changed here.
begin;
create table app_private.cos_imported_precedence_reviews(
 decision_id uuid primary key,binding jsonb not null,reviewed_by text not null check(length(btrim(reviewed_by)) between 1 and 250),
 authorization_sha256 text not null check(authorization_sha256~'^[a-f0-9]{64}$'),recorded_at timestamptz not null default clock_timestamp(),
 check(binding#>>'{sourcePrecedence,decisionId}'=decision_id::text));
alter table app_private.cos_imported_precedence_reviews enable row level security;
revoke all on app_private.cos_imported_precedence_reviews from public,anon,authenticated,service_role;
grant select on app_private.cos_imported_precedence_reviews to service_role;

-- Digest of precisely the projected evidence, separate from the FULL original
-- audit row digest below. Length-prefixes avoid null, separator and Unicode ambiguity.
create function app_private.cos_source_precedence_audit_sha(p public.camera_inventory_audit)
returns text language sql stable strict set search_path='' as $$
 select encode(sha256(convert_to(string_agg(case when v is null then '-1:' else octet_length(v)::text||':'||v end,'' order by n),'UTF8')),'hex')
 from unnest(array[p.id::text,p.unit_key,p.action::text,p.after_state->>'placement_contract',p.after_state->>'placement',p.after_state->>'control_id',
  to_jsonb(p)->>'request_id',p.after_state->>'site_label',p.after_state->>'street_address',
  ((extract(epoch from (to_jsonb(p)->>'created_at')::timestamptz)*1000000)::bigint)::text,
  (select string_agg(d::text,',' order by d) from unnest(p.device_ids) d)]) with ordinality fields(v,n)
$$;

create function app_private.cos_imported_precedence_matches(p_binding jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare p jsonb:=p_binding->'sourcePrecedence';a public.camera_inventory_audit;ids bigint[];actual_ids bigint[];concern text;related integer;
begin
 if not (p_binding ? 'sourcePrecedence') then return false;end if;
 perform app_private.cos_source_precedence_assert(p_binding);
 ids:=array(select d::bigint from jsonb_array_elements_text(p->'deviceIds') d order by d::bigint);
 concern:=app_private.cos_imported_concern_key(p_binding->>'unitNumber');
 -- Exact model identity, never a family/base alias for a suffixed native unit.
 if upper(regexp_replace(p_binding->>'unitNumber','[[:space:]#-]','','g')) is distinct from upper(regexp_replace(p->>'unitKey','[[:space:]#-]','','g')) then return false;end if;
 select array_agg(d.id order by d.id) into actual_ids from public.camera_devices d
 where app_private.cos_imported_concern_key(d.unit_key)=concern or d.id=any(ids);
 if actual_ids is distinct from ids or exists(select 1 from public.camera_devices d where d.id=any(ids) and d.unit_key is distinct from p->>'unitKey') then return false;end if;
 select count(*) into related from public.camera_inventory_audit history where app_private.cos_imported_concern_key(history.unit_key)=concern or history.device_ids&&ids;
 if related<>1 then return false;end if;
 select * into a from public.camera_inventory_audit where id=(p->>'legacyAuditId')::bigint;
 if not found or a.unit_key is distinct from p->>'unitKey' or a.action::text<>'MOVE_TO_ROOT'
  or a.after_state->>'placement_contract' is not null or a.after_state->>'placement' is not null or a.after_state->>'control_id' is not null
  or to_jsonb(a)->>'request_id' is not null or a.after_state->>'site_label' is not null or a.after_state->>'street_address' is not null
  or array(select d from unnest(a.device_ids) d order by d) is distinct from ids
  or (to_jsonb(a)->>'created_at') is null or (to_jsonb(a)->>'created_at')::timestamptz>=(p->>'reviewedAt')::timestamptz
  or app_private.cos_source_precedence_audit_sha(a) is distinct from p->>'legacyAuditSha256'
  or encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') is distinct from p->>'legacyAuditRowSha256' then return false;end if;
 return true;
end $$;

create function app_private.cos_imported_precedence_guard(p_binding jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare g jsonb;
begin
 g:=app_private.cos_imported_legacy_guard(p_binding->>'unitNumber');
 if not (p_binding ? 'sourcePrecedence') then return g;end if;
 -- Even an otherwise allowed record with a decision needs the current exact
 -- registered review. Disappearing/relabelled evidence never falls through.
 if g->>'busy'='true' then return g;end if;
 if exists(select 1 from app_private.cos_imported_precedence_reviews r where r.decision_id=(p_binding#>>'{sourcePrecedence,decisionId}')::uuid and r.binding=p_binding)
  and app_private.cos_imported_precedence_matches(p_binding) then return g||jsonb_build_object('allowed',true);end if;
 return g||jsonb_build_object('allowed',false);
end $$;

create function app_private.cos_imported_precedence_admin_review(p_binding jsonb,p_reviewed_by text,p_authorization_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user is distinct from 'postgres' then raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 perform app_private.cos_imported_assert_binding('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',p_binding);
 if not app_private.cos_imported_try_lock_legacy() then raise exception 'Legacy placement is busy.' using errcode='40001';end if;
 if not app_private.cos_imported_precedence_matches(p_binding) then raise exception 'Reviewed audit or camera roster changed.' using errcode='40001';end if;
 insert into app_private.cos_imported_precedence_reviews(decision_id,binding,reviewed_by,authorization_sha256)
 values((p_binding#>>'{sourcePrecedence,decisionId}')::uuid,p_binding,p_reviewed_by,p_authorization_sha256);
 return jsonb_build_object('decisionId',p_binding#>>'{sourcePrecedence,decisionId}','registered',true);
end $$;
revoke all on function app_private.cos_source_precedence_audit_sha(public.camera_inventory_audit),app_private.cos_imported_precedence_matches(jsonb),app_private.cos_imported_precedence_guard(jsonb),app_private.cos_imported_precedence_admin_review(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.cos_source_precedence_audit_sha(public.camera_inventory_audit),app_private.cos_imported_precedence_matches(jsonb),app_private.cos_imported_precedence_guard(jsonb) to service_role;

-- Existing function bodies below change only binding validation and the six
-- placement-guard call sites. Function signatures, ACLs, definer and search_path stay intact.

create or replace function app_private.cos_imported_assert_binding(p_organization_id uuid,p_binding jsonb)
returns void language plpgsql set search_path='' as $$
declare k text; address text;
begin
 if p_binding is null or jsonb_typeof(p_binding) is distinct from 'object'
  or not coalesce((p_binding->'schemaVersion'='1'::jsonb and p_binding->>'sourceSystem'='mhelpdesk_product_import' or p_binding->'schemaVersion'='2'::jsonb and p_binding->>'sourceSystem'='google_sheet_tracker'),false) or p_binding->>'organizationId' is distinct from p_organization_id::text
  or p_binding->>'eligibility' is distinct from 'FIELD'
  or p_binding->>'entityKind' is null or p_binding->>'entityKind' not in ('equipment_unit','tracker')
  or (select count(*) from jsonb_object_keys(p_binding-'sourcePrecedence'))<>18
  or exists(select 1 from jsonb_object_keys(p_binding) x where x not in ('schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','sourceRecordId','unitNumber','family','variant','sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','installation','suppliedComponents','eligibility','eventId','sourcePrecedence')) then
  raise exception 'Invalid imported source binding.' using errcode='22023'; end if;
 perform app_private.cos_source_precedence_assert(p_binding);
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

create or replace function app_private.cos_imported_lock_binding(p_organization_id uuid,p_binding jsonb)
returns boolean language plpgsql set search_path='' as $$
declare guard jsonb; job app_private.cos_imported_geocode_jobs;
begin
 perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 guard:=app_private.cos_imported_precedence_guard(p_binding);
 select * into job from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id
  and entity_kind=p_binding->>'entityKind' and native_unit_id=(p_binding->>'nativeUnitId')::uuid for share;
 return found and not job.invalidated and job.binding is not distinct from p_binding and guard->>'allowed'='true' and job.legacy_guard_sha256=guard->>'sha256';
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
  guard:=case when source is not null then app_private.cos_imported_precedence_guard(source) end;
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

create or replace function public.cos_imported_geocode_list_due(p_organization_id uuid,p_limit integer default 80)
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
 -- Exclude caches that cannot produce work before scanning legacy devices/audits.
 -- Keep every eligible unit (no LIMIT or address DISTINCT here): a held first
 -- unit must not hide a later allowed unit at the same address.
 for job in
  select j.* from app_private.cos_imported_geocode_jobs j
  left join app_private.cos_imported_census_cache census
   on census.organization_id=j.organization_id and census.address_sha256=j.address_sha256 and census.address=j.address
  left join app_private.cos_field_geocode_fallback_cache fallback
   on fallback.organization_id=j.organization_id and fallback.address_sha256=j.address_sha256 and fallback.address=j.address
  where j.organization_id=p_organization_id and j.binding is not null and not j.invalidated
   and (census.organization_id is null
    or census.status in ('pending','provider_error')
     and (census.lease_until is null or census.lease_until<=v_now)
     and (census.next_attempt_at is null or census.next_attempt_at<=v_now)
    or census.status='no_match' and enabled
     and (fallback.organization_id is null
      or fallback.status in ('pending','provider_error','deferred')
       and (fallback.lease_until is null or fallback.lease_until<=v_now)
       and (fallback.next_attempt_at is null or fallback.next_attempt_at<=v_now)))
  order by j.event_id,j.entity_kind,j.native_unit_id loop
  if job.address_sha256=any(seen) then continue; end if;
  guard:=app_private.cos_imported_precedence_guard(job.binding);
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

create or replace function public.cos_imported_geocode_read_many(p_organization_id uuid,p_bindings jsonb)
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
  guard:=app_private.cos_imported_precedence_guard(job.binding);
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

create or replace function app_private.cos_postal_retry_current(p_retry app_private.cos_imported_postal_retry_jobs)
returns text language plpgsql set search_path='' as $$
declare guard jsonb; job app_private.cos_imported_geocode_jobs;
begin
 guard:=app_private.cos_imported_precedence_guard(p_retry.binding);
 if guard->>'busy'='true' then return 'busy'; end if;
 select * into job from app_private.cos_imported_geocode_jobs where organization_id=p_retry.organization_id
  and entity_kind=p_retry.binding->>'entityKind' and native_unit_id=(p_retry.binding->>'nativeUnitId')::uuid for share;
 if not found or job.invalidated or job.binding is distinct from p_retry.binding or guard->>'allowed' is distinct from 'true'
  or job.legacy_guard_sha256 is distinct from guard->>'sha256' then return 'stale'; end if;
 return 'current';
end $$;

create or replace function public.cos_imported_geocode_postal_ordinary_list_due(p_organization_id uuid,p_limit integer default 80)
returns jsonb language plpgsql set search_path='' as $$
declare job app_private.cos_imported_geocode_jobs; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 result jsonb:='[]'; seen text[]:='{}'; stage text; v_now timestamptz:=clock_timestamp(); guard jsonb; enabled boolean; policy app_private.cos_imported_postal_retry_jobs; blocked_hashes text[]:='{}';
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 80 then raise exception 'At most 80 imported addresses required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then return '[]'::jsonb; end if;
 -- At most 80 frozen hashes. Exclude policy holds BEFORE the ordinary queue limit.
 -- A genuinely changed source/Owner state restores ordinary work under its own guards.
 for policy in select * from app_private.cos_imported_postal_retry_jobs
  where organization_id=p_organization_id and policy_version='us_zip_precision_v1'
   and phase in ('census','geocodio','exhausted','cancelled') loop
  if app_private.cos_postal_retry_current(policy)<>'stale' then blocked_hashes:=array_append(blocked_hashes,policy.address_sha256); end if;
 end loop;
 select exists(select 1 from app_private.cos_geocodio_control ctl where singleton and ctl.enabled and free_only)
  and exists(select 1 from app_private.cos_geocodio_account_state where singleton and (blocked_until is null or blocked_until<=v_now)
   and (cooldown_until is null or cooldown_until<=v_now)) into enabled;
 -- Exclude caches that cannot produce work before scanning legacy devices/audits.
 -- Keep every eligible unit (no LIMIT or address DISTINCT here): a held first
 -- unit must not hide a later allowed unit at the same address.
 for job in
  select j.* from app_private.cos_imported_geocode_jobs j
  left join app_private.cos_imported_census_cache census
   on census.organization_id=j.organization_id and census.address_sha256=j.address_sha256 and census.address=j.address
  left join app_private.cos_field_geocode_fallback_cache fallback
   on fallback.organization_id=j.organization_id and fallback.address_sha256=j.address_sha256 and fallback.address=j.address
  where j.organization_id=p_organization_id and j.binding is not null and not j.invalidated
   and not(j.address_sha256=any(blocked_hashes))
   and (census.organization_id is null
    or census.status in ('pending','provider_error')
     and (census.lease_until is null or census.lease_until<=v_now)
     and (census.next_attempt_at is null or census.next_attempt_at<=v_now)
    or census.status='no_match' and enabled
     and (fallback.organization_id is null
      or fallback.status in ('pending','provider_error','deferred')
       and (fallback.lease_until is null or fallback.lease_until<=v_now)
       and (fallback.next_attempt_at is null or fallback.next_attempt_at<=v_now)))
  order by j.event_id,j.entity_kind,j.native_unit_id loop
  if job.address_sha256=any(seen) then continue; end if;
  guard:=app_private.cos_imported_precedence_guard(job.binding);
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
-- Same verified Owner/IT reader gate as imported estimates; no new role grant.
-- Returns only a source binding already supplied by the caller, when the exact
-- full audit row and roster are still current. No reasons/before_state leave SQL.
create function public.cos_imported_precedence_read_current(p_organization_id uuid,p_bindings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; result jsonb:='[]';g jsonb;
begin
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501';end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' then
  if not app_private.cos_verified_fleet_actor(auth.uid()) then raise exception 'Owner account required.' using errcode='42501';end if;
 end if;
 if jsonb_typeof(p_bindings) is distinct from 'array' or jsonb_array_length(p_bindings)>250 then raise exception 'Reviewed bindings required.' using errcode='22023';end if;
 if not app_private.cos_imported_try_lock_legacy() then return result;end if;
 for b in select value from jsonb_array_elements(p_bindings) loop
  perform app_private.cos_imported_assert_binding(p_organization_id,b);
  if not (b ? 'sourcePrecedence') then raise exception 'Source precedence required.' using errcode='22023';end if;
  g:=app_private.cos_imported_precedence_guard(b);
  if g->>'allowed'='true' then result:=result||jsonb_build_array(b);end if;
 end loop;
 return result;
end $$;
revoke all on function public.cos_imported_precedence_read_current(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cos_imported_precedence_read_current(uuid,jsonb) to authenticated,service_role;
commit;
