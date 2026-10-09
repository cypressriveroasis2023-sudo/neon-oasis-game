-- REVIEW ARTIFACT ONLY. Local candidate; no production application authorized.
-- Independent fixed cohort; existing RPC identities, invoker modes, owners and ACLs remain.
-- One Census request and at most one free-ledger fallback reservation per exact hash.
-- Before-images live separately from cache records; enrollment never resets cache state.
begin;
alter table app_private.cos_geocodio_account_state
 add column if not exists diagnostic_recovery_v1 jsonb;

-- Trigger execution needs no EXECUTE grant. This is not an RPC or definer boundary.
create or replace function app_private.cos_diagnostic_recovery_immutable()
returns trigger language plpgsql set search_path='' as $$
declare d jsonb; old_d jsonb; k text; b jsonb; c app_private.cos_imported_census_cache;
 f app_private.cos_field_geocode_fallback_cache; r jsonb;
begin
 if new.diagnostic_recovery_v1 is not distinct from old.diagnostic_recovery_v1 then return new; end if;
 r:=new.diagnostic_recovery_v1;
 if r is null or jsonb_typeof(r) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(r))<>3
  or r->>'policyVersion' is distinct from 'pre_selector_diagnostic_v1'
  or jsonb_typeof(r->'jobs') is distinct from 'object'
  or (select count(*) from jsonb_object_keys(r->'jobs')) not between 1 and 35
  or r->>'manifestSha256'!~'^[a-f0-9]{64}$' or r->>'manifestSha256' is null then
  raise exception 'Invalid bounded diagnostic cohort.' using errcode='22023'; end if;
 if old.diagnostic_recovery_v1 is not null then
  if (r-'jobs') is distinct from (old.diagnostic_recovery_v1-'jobs')
   or (select array_agg(key order by key) from jsonb_each(r->'jobs')) is distinct from
      (select array_agg(key order by key) from jsonb_each(old.diagnostic_recovery_v1->'jobs')) then
   raise exception 'Diagnostic cohort is frozen.' using errcode='22023'; end if;
 else
  if r->>'manifestSha256' is distinct from encode(sha256(convert_to((r->'jobs')::text,'UTF8')),'hex') then
   raise exception 'Diagnostic manifest digest mismatch.' using errcode='22023'; end if;
 end if;
 for k,d in select key,value from jsonb_each(r->'jobs') order by key loop
  if jsonb_typeof(d) is distinct from 'object' or (select count(*) from jsonb_object_keys(d))<>5
   or not(d ?& array['binding','censusBefore','fallbackBefore','censusRequestId','geocodioRequestId']) then
   raise exception 'Invalid diagnostic member.' using errcode='22023'; end if;
  old_d:=old.diagnostic_recovery_v1#>array['jobs',k];
  if old_d is not null then
   if (d-array['censusRequestId','geocodioRequestId']) is distinct from (old_d-array['censusRequestId','geocodioRequestId'])
    or old_d->'censusRequestId'<>'null'::jsonb and d->'censusRequestId' is distinct from old_d->'censusRequestId'
    or old_d->'geocodioRequestId'<>'null'::jsonb and d->'geocodioRequestId' is distinct from old_d->'geocodioRequestId' then
    raise exception 'Diagnostic evidence and spent requests are immutable.' using errcode='22023'; end if;
   if d->'censusRequestId' is distinct from old_d->'censusRequestId' and not exists(
    select 1 from app_private.cos_imported_census_requests q where q.request_id=(d->>'censusRequestId')::uuid
     and q.binding=d->'binding' and q.address_sha256=k and q.completed_at is null) then
    raise exception 'Diagnostic Census request must be real.' using errcode='22023'; end if;
   if d->'geocodioRequestId' is distinct from old_d->'geocodioRequestId' and not exists(
    select 1 from app_private.cos_geocodio_reservations q where q.request_id=(d->>'geocodioRequestId')::uuid
     and q.native_binding=d->'binding' and q.address_sha256=k and q.job_kind='native_import' and q.completed_at is null) then
    raise exception 'Diagnostic fallback reservation must be real.' using errcode='22023'; end if;
   continue;
  end if;
  b:=d->'binding';
  perform app_private.cos_imported_assert_binding('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',b);
  if b->>'addressSha256' is distinct from k or d->'censusRequestId' is distinct from 'null'::jsonb
   or d->'geocodioRequestId' is distinct from 'null'::jsonb then raise exception 'Diagnostic member is not unspent.' using errcode='22023'; end if;
  -- Enrollment is a reviewed administrative operation. Worker requests retain their
  -- normal legacy -> source row -> account lock order.
  if not app_private.cos_imported_lock_binding('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',b) then
   raise exception 'Diagnostic source is stale or held.' using errcode='40001'; end if;
  select * into c from app_private.cos_imported_census_cache where organization_id=(b->>'organizationId')::uuid and address_sha256=k for update;
  select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=(b->>'organizationId')::uuid and address_sha256=k for update;
  if c.organization_id is null or f.organization_id is null or c.status<>'no_match' or c.reason is distinct from 'no_match'
   or f.status<>'no_match' or f.reason is distinct from 'no_match' or c.address is distinct from app_private.cos_imported_address(b)
   or f.address is distinct from c.address or c.active_request_id is not null or f.active_request_id is not null
   or c.lease_until is not null or f.lease_until is not null or c.next_attempt_at is not null or f.next_attempt_at is not null
   or c.updated_at<'2026-10-08T21:27:00Z'::timestamptz or c.updated_at>='2026-10-09T00:08:00Z'::timestamptz
   or f.updated_at<'2026-10-08T21:27:00Z'::timestamptz or f.updated_at>='2026-10-09T00:08:00Z'::timestamptz
   or d->'censusBefore' is distinct from to_jsonb(c) or d->'fallbackBefore' is distinct from to_jsonb(f) then
   raise exception 'Diagnostic recovery requires exact historical rejected caches.' using errcode='40001'; end if;
  if exists(select 1 from app_private.cos_imported_postal_retry_jobs x where x.organization_id=c.organization_id and x.address_sha256=k)
   or exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=c.organization_id and x.address_sha256=k
    and (x.status='success' or x.status='pending' and x.lease_until>clock_timestamp())) then
   raise exception 'Diagnostic recovery overlaps protected or active work.' using errcode='40001'; end if;
 end loop;
 return new;
end $$;
revoke all on function app_private.cos_diagnostic_recovery_immutable() from public,anon,authenticated,service_role;
drop trigger if exists cos_diagnostic_recovery_immutable on app_private.cos_geocodio_account_state;
create trigger cos_diagnostic_recovery_immutable before update of diagnostic_recovery_v1 on app_private.cos_geocodio_account_state
 for each row execute function app_private.cos_diagnostic_recovery_immutable();

-- Existing RPC implementations are copied from the exact deployed readback.
CREATE OR REPLACE FUNCTION public.cos_imported_geocode_census_claim(p_organization_id uuid, p_binding jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c app_private.cos_imported_census_cache; req app_private.cos_imported_census_requests; owner app_private.cos_field_geocode_cache;
 retry app_private.cos_imported_postal_retry_jobs; fallback app_private.cos_field_geocode_fallback_cache; v_retry boolean:=false; marker_state text;
 address text; sha text; guard text; v_now timestamptz; v_day date;
diagnostic jsonb; diagnostic_current boolean:=false;
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
 select diagnostic_recovery_v1#>array['jobs',sha] into diagnostic from app_private.cos_geocodio_account_state where singleton;
 diagnostic_current:=diagnostic is not null and exists(select 1 from app_private.cos_imported_geocode_jobs j
  where j.organization_id=p_organization_id and j.binding=diagnostic->'binding' and not j.invalidated);
 if diagnostic_current then
  if diagnostic->'binding' is distinct from p_binding then return jsonb_build_object('claimed',false,'claimToken',null,'reason','diagnostic_bound_elsewhere','record',null); end if;
  if diagnostic->>'censusRequestId' is not null and not coalesce(c.active_request_id=(diagnostic->>'censusRequestId')::uuid and c.lease_until<=v_now,false) then
   return jsonb_build_object('claimed',false,'claimToken',null,'reason','diagnostic_spent','record',null); end if;
 end if;
 select * into fallback from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=sha for update;
 select * into retry from app_private.cos_imported_postal_retry_jobs where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1' for update;
 if retry.phase in ('census','geocodio','exhausted') then
  marker_state:=app_private.cos_postal_retry_current(retry);
  if marker_state='stale' then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=clock_timestamp() where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1';
   retry.phase:='cancelled';
  elsif marker_state='busy' then return jsonb_build_object('claimed',false,'claimToken',null,'reason','legacy_busy','record',null); end if;
 end if;
 -- A cancelled original revision cannot return through the ordinary retry path.
 -- Genuinely revised bindings keep their existing normal source-current behavior.
 if retry.phase='cancelled' then
  if retry.binding=p_binding then return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_cancelled','record',null);
  elsif app_private.cos_postal_retry_current(retry)<>'stale' then return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_bound_elsewhere','record',null); end if;
 end if;
 if retry.phase in ('census','geocodio','exhausted') and retry.binding is distinct from p_binding then
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_bound_elsewhere','record',null); end if;
 if retry.phase='exhausted' then return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_deferred','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 if retry.phase='census' and fallback.status='success' then
  update app_private.cos_imported_postal_retry_jobs set phase='complete',updated_at=clock_timestamp() where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1';
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','cache_hit','record',app_private.cos_imported_record(p_binding,guard,fallback)); end if;
 v_retry:=retry.phase='census' and retry.binding=p_binding and retry.census_request_id is null and c.status='no_match' and to_jsonb(c)=retry.census_before
  and (retry.fallback_before is null and fallback.organization_id is null or to_jsonb(fallback)=retry.fallback_before);
 if diagnostic_current and diagnostic->>'censusRequestId' is null then
  if c.status is distinct from 'no_match' or c is distinct from jsonb_populate_record(null::app_private.cos_imported_census_cache,diagnostic->'censusBefore')
   or fallback is distinct from jsonb_populate_record(null::app_private.cos_field_geocode_fallback_cache,diagnostic->'fallbackBefore')
   or exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=p_organization_id and x.address_sha256=sha and x.status='success') then
   return jsonb_build_object('claimed',false,'claimToken',null,'reason','diagnostic_cache_changed','record',null); end if;
  v_retry:=true;
 end if;
 if c.status in ('success','no_match','invalid_address') and not coalesce(v_retry,false) then return jsonb_build_object('claimed',false,'claimToken',null,'reason','cache_hit','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 if c.active_request_id is not null then
  if c.lease_until>v_now then return jsonb_build_object('claimed',false,'claimToken',null,'reason','duplicate_inflight','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
  update app_private.cos_imported_census_requests set completed_at=v_now,outcome=jsonb_build_object('reason','lease_expired') where request_id=c.active_request_id and completed_at is null;
  update app_private.cos_imported_census_cache set status='provider_error',reason='provider_timeout',active_request_id=null,lease_until=null,
   next_attempt_at=case when attempts>=3 and attempt_day=v_day then app_private.cos_geocodio_next_reset(v_now) else v_now+interval '120 seconds' end,updated_at=v_now
   where organization_id=p_organization_id and address_sha256=sha returning * into c;
  update app_private.cos_imported_postal_retry_jobs set phase='exhausted',updated_at=v_now
   where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1' and phase='census' and census_claims>=3;
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','provider_timeout','record',app_private.cos_imported_census_record(p_binding,guard,c));
 end if;
 if retry.phase='census' and retry.census_claims>=3 then
  update app_private.cos_imported_postal_retry_jobs set phase='exhausted',updated_at=v_now where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1';
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_deferred','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 if c.next_attempt_at>v_now or c.attempt_day=v_day and c.attempts>=3 then return jsonb_build_object('claimed',false,'claimToken',null,'reason','retry_deferred','record',app_private.cos_imported_census_record(p_binding,guard,c)); end if;
 -- Legacy Census success validation discards ZIP+4; never promote such a
 -- success into the stricter imported pipeline. Only a safe no_match can be reused.
 select * into owner from app_private.cos_field_geocode_cache where organization_id=p_organization_id and address_sha256=sha and cos_field_geocode_cache.address=c.address and status='no_match' and not diagnostic_current and not coalesce(retry.phase='census' and retry.binding=p_binding,false) order by geocoded_at desc limit 1;
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
 update app_private.cos_imported_postal_retry_jobs set census_request_id=req.request_id,census_claims=census_claims+1,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=sha and policy_version='us_zip_precision_v1' and phase='census' and binding=p_binding;
 if diagnostic_current then
  update app_private.cos_geocodio_account_state set diagnostic_recovery_v1=jsonb_set(diagnostic_recovery_v1,
   array['jobs',sha,'censusRequestId'],to_jsonb(req.request_id::text)) where singleton;
 end if;
 return jsonb_build_object('claimed',true,'claimToken',req.claim_token,'record',app_private.cos_imported_census_record(p_binding,guard,c));
end $function$

;
CREATE OR REPLACE FUNCTION public.cos_imported_geocode_reserve(p_organization_id uuid, p_binding jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; v_guard text; p_unit_key text; p_address text; p_address_sha256 text;
 retry app_private.cos_imported_postal_retry_jobs; census app_private.cos_imported_census_cache; v_retry boolean:=false; marker_state text;
 account app_private.cos_geocodio_account_state; reservation app_private.cos_geocodio_reservations;
 v_now timestamptz; v_day date; v_reset timestamptz; v_reason text; v_next timestamptz; v_credits integer; v_send_before timestamptz;
diagnostic jsonb; diagnostic_current boolean:=false;
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
 select c.* into census from app_private.cos_imported_census_cache c where c.organization_id=p_organization_id and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
 diagnostic:=account.diagnostic_recovery_v1#>array['jobs',p_address_sha256];
 diagnostic_current:=diagnostic is not null and exists(select 1 from app_private.cos_imported_geocode_jobs j
  where j.organization_id=p_organization_id and j.binding=diagnostic->'binding' and not j.invalidated);
 if diagnostic_current then
  if diagnostic->'binding' is distinct from p_binding then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','diagnostic_bound_elsewhere','record',null); end if;
  if not exists(select 1 from app_private.cos_imported_census_requests q where q.request_id=(diagnostic->>'censusRequestId')::uuid
   and q.organization_id=p_organization_id and q.binding=p_binding and q.completed_at=census.geocoded_at
   and q.outcome->>'status'='no_match') then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
 end if;
 select * into retry from app_private.cos_imported_postal_retry_jobs where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1' for update;
 if retry.phase in ('census','geocodio','exhausted') then
  marker_state:=app_private.cos_postal_retry_current(retry);
  if marker_state='stale' then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=clock_timestamp() where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1';
   retry.phase:='cancelled';
  elsif marker_state='busy' then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','legacy_busy','record',null); end if;
 end if;
 if retry.phase='cancelled' then
  if retry.binding=p_binding then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','retry_cancelled','record',null);
  elsif app_private.cos_postal_retry_current(retry)<>'stale' then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','retry_bound_elsewhere','record',null); end if;
 end if;
 if retry.phase='census' then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
 if retry.phase in ('geocodio','exhausted') and retry.binding is distinct from p_binding then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','retry_bound_elsewhere','record',null); end if;
 if retry.phase='exhausted' then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','retry_deferred','record',null); end if;
 if retry.phase='geocodio' and not exists(select 1 from app_private.cos_imported_census_requests q where q.request_id=retry.census_request_id and q.binding=p_binding
  and q.completed_at=census.geocoded_at and q.outcome->>'status'='no_match') then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
 v_now:=clock_timestamp(); v_day:=(v_now at time zone 'America/New_York')::date; v_reset:=app_private.cos_geocodio_next_reset(v_now); v_send_before:=app_private.cos_geocodio_send_before(v_now);
 if exists(select 1 from app_private.cos_geocodio_reservations where request_id=p_request_id) then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','reservation_replayed','record',null,'resetAt',v_reset); end if;
 insert into app_private.cos_field_geocode_fallback_cache(organization_id,address,address_sha256)
 values(p_organization_id,p_address,p_address_sha256) on conflict (organization_id,address_sha256) do nothing;
 select * into r from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=p_address_sha256 for update;
 if r.address is distinct from p_address then raise exception 'Address hash binding changed.' using errcode='40001'; end if;
 if diagnostic_current and diagnostic->>'geocodioRequestId' is not null
  and not coalesce(r.active_request_id=(diagnostic->>'geocodioRequestId')::uuid and r.lease_until<=v_now,false) then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','diagnostic_spent','record',null); end if;
 v_retry:=retry.phase='geocodio' and retry.binding=p_binding and retry.geocodio_request_id is null and r.status='no_match' and to_jsonb(r)=retry.fallback_before
  and exists(select 1 from app_private.cos_imported_census_requests q where q.request_id=retry.census_request_id and q.binding=p_binding
   and q.completed_at=census.geocoded_at and q.outcome->>'status'='no_match');
 if diagnostic_current and diagnostic->>'geocodioRequestId' is null then
  if r.status is distinct from 'no_match' or r is distinct from jsonb_populate_record(null::app_private.cos_field_geocode_fallback_cache,diagnostic->'fallbackBefore')
   or exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=p_organization_id and x.address_sha256=p_address_sha256 and x.status='success') then
   return jsonb_build_object('reserved',false,'reservationToken',null,'reason','diagnostic_cache_changed','record',null); end if;
  v_retry:=true;
 end if;
 if r.status in ('success','no_match') and not coalesce(v_retry,false) then
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
  update app_private.cos_imported_postal_retry_jobs set phase='exhausted',updated_at=v_now
   where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1' and phase='geocodio' and geocodio_claims>=3;
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','provider_timeout','record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset);
 end if;
 if retry.phase='geocodio' and retry.geocodio_claims>=3 then
  update app_private.cos_imported_postal_retry_jobs set phase='exhausted',updated_at=v_now where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1';
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','retry_deferred','record',app_private.cos_imported_record(p_binding,v_guard,r)); end if;
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
  if coalesce(v_retry,false) then return jsonb_build_object('reserved',false,'reservationToken',null,'reason',v_reason,
   'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset); end if;
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
 update app_private.cos_imported_postal_retry_jobs set geocodio_request_id=reservation.request_id,geocodio_claims=geocodio_claims+1,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1' and phase='geocodio' and binding=p_binding;
 if diagnostic_current then
  update app_private.cos_geocodio_account_state set diagnostic_recovery_v1=jsonb_set(diagnostic_recovery_v1,
   array['jobs',p_address_sha256,'geocodioRequestId'],to_jsonb(reservation.request_id::text)) where singleton;
 end if;
 return jsonb_build_object('reserved',true,'reservationToken',reservation.reservation_token,'reason',null,
  'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset,'sendBefore',reservation.send_before,'remaining',ctl.daily_limit-v_credits);
end $function$

;
CREATE OR REPLACE FUNCTION public.cos_field_geocode_fallback_reserve(p_organization_id uuid, p_audit_id text, p_unit_key text, p_address text, p_address_sha256 text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; rejected app_private.cos_field_geocode_fallback_rejections;
 account app_private.cos_geocodio_account_state; reservation app_private.cos_geocodio_reservations;
 retry app_private.cos_imported_postal_retry_jobs; marker_state text;
 v_now timestamptz; v_day date; v_reset timestamptz; v_reason text; v_next timestamptz; v_credits integer; v_send_before timestamptz;
diagnostic jsonb; diagnostic_guard jsonb;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);
 if p_request_id is null then raise exception 'Reservation identity required.' using errcode='22023'; end if;
 if not app_private.cos_geocode_lock_current(p_audit_id,p_unit_key,p_address) then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','superseded','record',null); end if;
 perform 1 from app_private.cos_field_geocode_cache c where c.organization_id=p_organization_id and c.audit_id=p_audit_id
  and c.unit_key=p_unit_key and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','ineligible','record',null); end if;
 select * into rejected from app_private.cos_field_geocode_fallback_rejections where organization_id=p_organization_id and audit_id=p_audit_id
  and unit_key=p_unit_key and address=p_address and address_sha256=p_address_sha256;
 if found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','invalid_address','record',app_private.cos_geocodio_rejection_record(rejected)); end if;
 -- Global account row lock precedes every budget/address write, across organizations.
 -- No HTTP happens in this transaction. Return only after reservation and credit commit.
 select * into account from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;
 diagnostic:=account.diagnostic_recovery_v1#>array['jobs',p_address_sha256];
 if diagnostic is not null then
  diagnostic_guard:=app_private.cos_imported_precedence_guard(diagnostic->'binding');
  if diagnostic_guard->>'busy'='true' or diagnostic_guard->>'allowed'='true' and exists(select 1 from app_private.cos_imported_geocode_jobs j
   where j.organization_id=p_organization_id and j.binding=diagnostic->'binding' and not j.invalidated
    and j.legacy_guard_sha256=diagnostic_guard->>'sha256') then
   return jsonb_build_object('reserved',false,'reservationToken',null,'reason','diagnostic_address_hold','record',null); end if;
 end if;
 -- Shared-address barrier: the frozen cohort's fresh Census pass must finish before any paid fallback.
 select m.* into retry from app_private.cos_imported_postal_retry_jobs m where m.organization_id=p_organization_id and m.address_sha256=p_address_sha256
  and m.address=p_address and m.policy_version='us_zip_precision_v1'
  and (m.phase in ('census','geocodio','exhausted','cancelled') or m.phase='complete' and exists(
   select 1 from app_private.cos_imported_census_cache c join app_private.cos_imported_census_requests q on q.request_id=m.census_request_id
    and q.completed_at=c.geocoded_at and q.outcome->>'status'='success'
   where c.organization_id=p_organization_id and c.address_sha256=p_address_sha256 and c.address=p_address and c.status='success')) for update;
 if found then
  marker_state:=app_private.cos_postal_retry_current(retry);
  if marker_state='stale' then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=clock_timestamp()
    where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1';
  else return jsonb_build_object('reserved',false,'reservationToken',null,'reason',case when retry.phase='complete' then 'census_success' else 'retry_deferred' end,'record',null); end if;
 end if;
 v_now:=clock_timestamp(); v_day:=(v_now at time zone 'America/New_York')::date; v_reset:=app_private.cos_geocodio_next_reset(v_now); v_send_before:=app_private.cos_geocodio_send_before(v_now);
 if exists(select 1 from app_private.cos_geocodio_reservations where request_id=p_request_id) then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','reservation_replayed','record',null,'resetAt',v_reset); end if;
 insert into app_private.cos_field_geocode_fallback_cache(organization_id,address,address_sha256)
 values(p_organization_id,p_address,p_address_sha256) on conflict (organization_id,address_sha256) do nothing;
 select * into r from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=p_address_sha256 for update;
 if r.address is distinct from p_address then raise exception 'Address hash binding changed.' using errcode='40001'; end if;
 if r.status in ('success','no_match') then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','cache_hit','record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset); end if;
 if r.active_request_id is not null then
  if r.lease_until>v_now then
   return jsonb_build_object('reserved',false,'reservationToken',null,'reason','duplicate_inflight','record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset); end if;
  -- An uncertain/timeout request is consumed forever. Do not resend in this invocation.
  update app_private.cos_geocodio_reservations set completed_at=v_now,outcome=jsonb_build_object('reason','lease_expired')
   where request_id=r.active_request_id and completed_at is null;
  update app_private.cos_field_geocode_fallback_cache set status='provider_error',reason='provider_timeout',active_request_id=null,lease_until=null,
   next_attempt_at=case when attempts>=3 and attempt_day=v_day then v_reset else v_now+interval '120 seconds' end,updated_at=v_now
   where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','provider_timeout','record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset);
 end if;
 select * into ctl from app_private.cos_geocodio_control where singleton;
 if not found or not ctl.enabled or not ctl.free_only then v_reason:='configuration_unavailable'; v_next:=v_reset;
 elsif account.blocked_until>v_now then v_reason:='provider_forbidden'; v_next:=account.blocked_until;
 elsif account.cooldown_until>v_now then v_reason:='provider_rate_limited'; v_next:=account.cooldown_until;
 elsif r.next_attempt_at>v_now then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason',r.reason,'record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset);
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
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason',v_reason,'record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset);
 end if;
 insert into app_private.cos_geocodio_reservations(request_id,organization_id,audit_id,unit_key,address,address_sha256,budget_day,reserved_at,lease_until,send_before)
 values(p_request_id,p_organization_id,p_audit_id,p_unit_key,p_address,p_address_sha256,v_day,v_now,v_now+interval '60 seconds',v_send_before) returning * into reservation;
 update app_private.cos_field_geocode_fallback_cache set status='pending',reason=null,
  attempts=case when attempt_day=v_day then attempts+1 else 1 end,attempt_day=v_day,
  active_request_id=p_request_id,lease_until=reservation.lease_until,next_attempt_at=null,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_address_sha256 returning * into r;
 return jsonb_build_object('reserved',true,'reservationToken',reservation.reservation_token,'reason',null,
  'record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key),'resetAt',v_reset,'sendBefore',reservation.send_before,'remaining',ctl.daily_limit-v_credits);
end $function$

;
CREATE OR REPLACE FUNCTION public.cos_imported_geocode_postal_ordinary_list_due(p_organization_id uuid, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare job app_private.cos_imported_geocode_jobs; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 result jsonb:='[]'; seen text[]:='{}'; stage text; v_now timestamptz:=clock_timestamp(); guard jsonb; enabled boolean; policy app_private.cos_imported_postal_retry_jobs; blocked_hashes text[]:='{}';
diagnostic jsonb; diagnostic_sha text;
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
 -- Fixed diagnostic addresses have priority and cannot fall through to ordinary
 -- provider-error retries. A genuinely new source revision follows existing rules.
 for diagnostic_sha,diagnostic in select key,value from app_private.cos_geocodio_account_state a,
  lateral jsonb_each(coalesce(a.diagnostic_recovery_v1->'jobs','{}'::jsonb)) where a.singleton order by key loop
  select * into job from app_private.cos_imported_geocode_jobs j where j.organization_id=p_organization_id
   and j.binding=diagnostic->'binding' and not j.invalidated;
  if not found then continue; end if;
  blocked_hashes:=array_append(blocked_hashes,diagnostic_sha);
  if not app_private.cos_imported_lock_binding(p_organization_id,job.binding) then continue; end if;
  select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=diagnostic_sha;
  select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=diagnostic_sha;
  stage:=null;
  if diagnostic->>'censusRequestId' is null and c.status='no_match'
   and c is not distinct from jsonb_populate_record(null::app_private.cos_imported_census_cache,diagnostic->'censusBefore') and f is not distinct from jsonb_populate_record(null::app_private.cos_field_geocode_fallback_cache,diagnostic->'fallbackBefore') then stage:='census';
  elsif c.active_request_id=(diagnostic->>'censusRequestId')::uuid and c.lease_until<=v_now then stage:='census';
  elsif c.status='no_match' and exists(select 1 from app_private.cos_imported_census_requests q
   where q.request_id=(diagnostic->>'censusRequestId')::uuid and q.binding=job.binding
    and q.completed_at=c.geocoded_at and q.outcome->>'status'='no_match') then
   if enabled and diagnostic->>'geocodioRequestId' is null and f.status='no_match'
    and f is not distinct from jsonb_populate_record(null::app_private.cos_field_geocode_fallback_cache,diagnostic->'fallbackBefore') then stage:='geocodio';
   elsif f.active_request_id=(diagnostic->>'geocodioRequestId')::uuid and f.lease_until<=v_now then stage:='geocodio'; end if;
  end if;
  if stage is not null and jsonb_array_length(result)<p_limit then
   result:=result||jsonb_build_array(jsonb_build_object('binding',job.binding,'legacyGuardSha256',job.legacy_guard_sha256,'stage',stage));
   seen:=array_append(seen,diagnostic_sha);
  end if;
 end loop;
 if jsonb_array_length(result)>=p_limit then return result; end if;
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
end $function$

;
commit;
