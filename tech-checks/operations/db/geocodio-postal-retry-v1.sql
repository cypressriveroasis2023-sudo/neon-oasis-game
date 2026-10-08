-- REVIEW ARTIFACT ONLY. Legacy project; apply after both postal-precision patches.
-- Fixed, frozen cohort: one policy version, <=80 manifest entries and <=80 full-address hashes.
-- Does not replace either list_due queue function (including the live queue-prefilter v2).
-- Enrollment never changes a provider cache, attempts, leases, source rows or budgets.
begin;
create table if not exists app_private.cos_imported_postal_retry_batches(
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 policy_version text not null check(policy_version='us_zip_precision_v1'),
 manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 80),
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,policy_version));
create table if not exists app_private.cos_imported_postal_retry_jobs(
 organization_id uuid not null,policy_version text not null check(policy_version='us_zip_precision_v1'),
 address_sha256 text not null,address text not null,binding jsonb not null,
 census_before jsonb not null,fallback_before jsonb,
 phase text not null default 'census' check(phase in ('census','geocodio','complete','exhausted','cancelled')),
 census_request_id uuid,geocodio_request_id uuid,
 census_claims integer not null default 0 check(census_claims between 0 and 3),
 geocodio_claims integer not null default 0 check(geocodio_claims between 0 and 3),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,address_sha256,policy_version),
 foreign key(organization_id,policy_version) references app_private.cos_imported_postal_retry_batches(organization_id,policy_version),
 check(address_sha256=encode(sha256(convert_to(address,'UTF8')),'hex')),
 check(binding->>'addressSha256'=address_sha256 and jsonb_typeof(binding#>'{installation,zip}')='string'
  and binding#>>'{installation,zip}'~'^[0-9]{5}-[0-9]{4}$'));
alter table app_private.cos_imported_postal_retry_batches enable row level security;
alter table app_private.cos_imported_postal_retry_jobs enable row level security;
revoke all on app_private.cos_imported_postal_retry_batches,app_private.cos_imported_postal_retry_jobs from public,anon,authenticated,service_role;
grant select,insert on app_private.cos_imported_postal_retry_batches to service_role;
grant select,insert,update on app_private.cos_imported_postal_retry_jobs to service_role;

-- Distinguish a stale source/Owner override from transient legacy lock contention.
create or replace function app_private.cos_postal_retry_current(p_retry app_private.cos_imported_postal_retry_jobs)
returns text language plpgsql set search_path='' as $$
declare guard jsonb; job app_private.cos_imported_geocode_jobs;
begin
 guard:=app_private.cos_imported_legacy_guard(p_retry.binding->>'unitNumber');
 if guard->>'busy'='true' then return 'busy'; end if;
 select * into job from app_private.cos_imported_geocode_jobs where organization_id=p_retry.organization_id
  and entity_kind=p_retry.binding->>'entityKind' and native_unit_id=(p_retry.binding->>'nativeUnitId')::uuid for share;
 if not found or job.invalidated or job.binding is distinct from p_retry.binding or guard->>'allowed' is distinct from 'true'
  or job.legacy_guard_sha256 is distinct from guard->>'sha256' then return 'stale'; end if;
 return 'current';
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

create or replace function public.cos_imported_geocode_postal_retry_list_due(p_organization_id uuid,p_limit integer default 80)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_imported_postal_retry_jobs; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 result jsonb:='[]'; stage text; v_now timestamptz:=clock_timestamp(); v_day date:=(clock_timestamp() at time zone 'America/New_York')::date;
 enabled boolean; guard text; marker_state text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 80 then raise exception 'At most 80 retry hashes required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then return result; end if;
 select exists(select 1 from app_private.cos_geocodio_control ctl where singleton and ctl.enabled and free_only)
  and exists(select 1 from app_private.cos_geocodio_account_state where singleton and (blocked_until is null or blocked_until<=v_now)
   and (cooldown_until is null or cooldown_until<=v_now)) into enabled;
 -- Fixed frozen cohort only. The ordinary optimized queue implementation is untouched.
 for r in select * from app_private.cos_imported_postal_retry_jobs where organization_id=p_organization_id and policy_version='us_zip_precision_v1'
  and phase in ('census','geocodio') order by address_sha256 loop
  marker_state:=app_private.cos_postal_retry_current(r);
  if marker_state='stale' then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=v_now
    where organization_id=p_organization_id and address_sha256=r.address_sha256 and policy_version='us_zip_precision_v1' and phase in ('census','geocodio','exhausted');
   continue;
  elsif marker_state<>'current' then continue; end if;
  select legacy_guard_sha256 into guard from app_private.cos_imported_geocode_jobs where organization_id=p_organization_id and binding=r.binding;
  select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=r.address_sha256 and address=r.address;
  if not found or c.status in ('success','invalid_address') then continue; end if;
  select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=r.address_sha256 and address=r.address;
  if f.status='success' then continue; end if;
  stage:=null;
  if r.phase='census' and (c.lease_until is null or c.lease_until<=v_now) and (c.next_attempt_at is null or c.next_attempt_at<=v_now)
   and (c.status='pending' and c.active_request_id is not null or (r.census_claims<3 and (c.attempt_day is distinct from v_day or c.attempts<3)))
   and ((r.census_request_id is null and c.status='no_match' and to_jsonb(c)=r.census_before
     and (r.fallback_before is null and f.organization_id is null or to_jsonb(f)=r.fallback_before))
    or r.census_request_id is not null and c.status in ('pending','provider_error')) then stage:='census';
  elsif r.phase='geocodio' and enabled and c.status='no_match'
   and exists(select 1 from app_private.cos_imported_census_requests q where q.request_id=r.census_request_id and q.binding=r.binding
    and q.completed_at=c.geocoded_at and q.outcome->>'status'='no_match')
   and (f.lease_until is null or f.lease_until<=v_now) and (f.next_attempt_at is null or f.next_attempt_at<=v_now)
   and (f.status='pending' and f.active_request_id is not null or r.geocodio_claims<3 and (f.attempt_day is distinct from v_day or f.attempts<3))
   and (f.organization_id is null or r.geocodio_request_id is null and f.status='no_match' and to_jsonb(f)=r.fallback_before
    or r.geocodio_request_id is not null and f.status in ('pending','provider_error','deferred')) then stage:='geocodio';
  end if;
  if stage is not null then
   result:=result||jsonb_build_array(jsonb_build_object('binding',r.binding,'legacyGuardSha256',guard,'stage',stage));
   if jsonb_array_length(result)>=p_limit then exit; end if;
  end if;
 end loop;
 return result;
end $$;

create or replace function public.cos_imported_geocode_census_claim(p_organization_id uuid,p_binding jsonb,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_census_cache; req app_private.cos_imported_census_requests; owner app_private.cos_field_geocode_cache;
 retry app_private.cos_imported_postal_retry_jobs; fallback app_private.cos_field_geocode_fallback_cache; v_retry boolean:=false; marker_state text;
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
 select * into owner from app_private.cos_field_geocode_cache where organization_id=p_organization_id and address_sha256=sha and cos_field_geocode_cache.address=c.address and status='no_match' and not coalesce(retry.phase='census' and retry.binding=p_binding,false) order by geocoded_at desc limit 1;
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
 return jsonb_build_object('claimed',true,'claimToken',req.claim_token,'record',app_private.cos_imported_census_record(p_binding,guard,c));
end $$;

create or replace function public.cos_imported_geocode_census_finish(p_organization_id uuid,p_binding jsonb,p_claim_token uuid,p_source_current boolean,p_status text,
 p_latitude double precision default null,p_longitude double precision default null,p_matched_address text default null,p_reason text default null)
returns jsonb language plpgsql set search_path='' as $$
declare c app_private.cos_imported_census_cache; req app_private.cos_imported_census_requests; v_now timestamptz; current_binding boolean; v_outcome jsonb; v_reason text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);perform app_private.cos_imported_assert_binding(p_organization_id,p_binding);
 if p_claim_token is null or p_status is null or p_status not in ('success','no_match','invalid_address','provider_error') then raise exception 'Invalid imported Census completion.' using errcode='22023'; end if;
 v_reason:=case when p_status='no_match' then coalesce(p_reason,'no_match') when p_status='invalid_address' then p_status else p_reason end;
 if p_status='success' and (p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180)
  or p_matched_address is null or length(btrim(p_matched_address)) not between 1 and 600 or p_matched_address~'[[:cntrl:]]'
  or not app_private.cos_imported_matched_postal(p_binding,p_matched_address) or p_reason is not null)
  or p_status<>'success' and (p_latitude is not null or p_longitude is not null or p_matched_address is not null)
  or p_status='provider_error' and (p_reason is null or p_reason not in ('provider_timeout','provider_unavailable','invalid_response'))
  or p_status='no_match' and p_reason is not null and not app_private.cos_postal_safe_no_match_reason(p_reason)
  or p_status='invalid_address' and p_reason is not null and p_reason<>p_status then raise exception 'Invalid safe Census result.' using errcode='22023'; end if;
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
  if p_source_current is false then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=v_now
    where organization_id=p_organization_id and address_sha256=p_binding->>'addressSha256' and policy_version='us_zip_precision_v1' and binding=p_binding and phase in ('census','geocodio');
  end if;
  update app_private.cos_imported_census_requests set completed_at=v_now,outcome=jsonb_build_object('reason','superseded_or_expired') where request_id=req.request_id;
  return jsonb_build_object('accepted',false,'record',null); end if;
 update app_private.cos_imported_census_requests set completed_at=v_now,outcome=v_outcome where request_id=req.request_id;
 update app_private.cos_imported_census_cache set status=p_status,reason=v_reason,latitude=p_latitude,longitude=p_longitude,matched_address=p_matched_address,
  geocoded_at=v_now,active_request_id=null,lease_until=null,updated_at=v_now,
  next_attempt_at=case when p_status='provider_error' then case when attempts>=3 then app_private.cos_geocodio_next_reset(v_now)
   else v_now+case when attempts=1 then interval '30 seconds' else interval '120 seconds' end end end
  where organization_id=p_organization_id and address_sha256=p_binding->>'addressSha256' returning * into c;
 update app_private.cos_imported_postal_retry_jobs set phase=case when p_status='no_match' then 'geocodio'
  when p_status in ('success','invalid_address') then 'complete' when census_claims>=3 then 'exhausted' else 'census' end,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_binding->>'addressSha256' and policy_version='us_zip_precision_v1'
   and phase='census' and binding=p_binding and census_request_id=req.request_id;
 return jsonb_build_object('accepted',true,'record',app_private.cos_imported_census_record(p_binding,req.legacy_guard_sha256,c));
end $$;

create or replace function public.cos_imported_geocode_reserve(p_organization_id uuid,p_binding jsonb,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; v_guard text; p_unit_key text; p_address text; p_address_sha256 text;
 retry app_private.cos_imported_postal_retry_jobs; census app_private.cos_imported_census_cache; v_retry boolean:=false; marker_state text;
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
 select c.* into census from app_private.cos_imported_census_cache c where c.organization_id=p_organization_id and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
 if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','census_required','record',null); end if;
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
 v_retry:=retry.phase='geocodio' and retry.binding=p_binding and retry.geocodio_request_id is null and r.status='no_match' and to_jsonb(r)=retry.fallback_before
  and exists(select 1 from app_private.cos_imported_census_requests q where q.request_id=retry.census_request_id and q.binding=p_binding
   and q.completed_at=census.geocoded_at and q.outcome->>'status'='no_match');
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
 return jsonb_build_object('reserved',true,'reservationToken',reservation.reservation_token,'reason',null,
  'record',app_private.cos_imported_record(p_binding,v_guard,r),'resetAt',v_reset,'sendBefore',reservation.send_before,'remaining',ctl.daily_limit-v_credits);
end $$;

create or replace function public.cos_imported_geocode_finish(p_organization_id uuid,p_binding jsonb,p_reservation_token uuid,p_source_current boolean,p_status text,
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
  or not app_private.cos_imported_matched_postal(p_binding,p_matched_address)
  or p_accuracy_type is null or p_accuracy_type not in ('rooftop','range_interpolation')
  or p_accuracy is null or not(p_accuracy between 0.9 and 1)
  or p_match_type is not null and p_match_type not in ('building_centroid','parcel_centroid')
  or p_accuracy_type='range_interpolation' and p_match_type is not null or p_reason is not null or p_retry_after_seconds is not null)
  or p_status<>'success' and (p_latitude is not null or p_longitude is not null or p_matched_address is not null
   or p_accuracy_type is not null or p_accuracy is not null or p_match_type is not null)
  or p_status='no_match' and (p_reason is not null and not app_private.cos_postal_safe_no_match_reason(p_reason) or p_retry_after_seconds is not null)
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
  if p_source_current is false then
   update app_private.cos_imported_postal_retry_jobs set phase='cancelled',updated_at=v_now
    where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1' and binding=p_binding and phase in ('census','geocodio');
  end if;
  -- Keep expired/stale credit charged; cache remains unavailable until reserve recovers its lease.
  update app_private.cos_geocodio_reservations set completed_at=v_now,outcome=jsonb_build_object('reason','superseded_or_expired') where request_id=reservation.request_id;
  return jsonb_build_object('accepted',false,'record',null);
 end if;
 v_status:=p_status; v_reason:=case when p_status='no_match' then coalesce(p_reason,'no_match') else p_reason end;
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
 update app_private.cos_imported_postal_retry_jobs set phase=case when p_status in ('success','no_match') then 'complete'
  when geocodio_claims>=3 then 'exhausted' else 'geocodio' end,updated_at=v_now
  where organization_id=p_organization_id and address_sha256=p_address_sha256 and policy_version='us_zip_precision_v1'
   and phase='geocodio' and binding=p_binding and geocodio_request_id=reservation.request_id;
 return jsonb_build_object('accepted',true,'record',app_private.cos_imported_record(p_binding,v_guard,r));
end $$;

create or replace function public.cos_field_geocode_fallback_reserve(p_organization_id uuid,p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; rejected app_private.cos_field_geocode_fallback_rejections;
 account app_private.cos_geocodio_account_state; reservation app_private.cos_geocodio_reservations;
 retry app_private.cos_imported_postal_retry_jobs; marker_state text;
 v_now timestamptz; v_day date; v_reset timestamptz; v_reason text; v_next timestamptz; v_credits integer; v_send_before timestamptz;
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
end $$;
-- Separate ordinary reader retains the v2 prefilter and excludes frozen policy holds.
-- The installed cos_imported_geocode_list_due definition, identity and ACL remain untouched.
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

revoke all on function public.cos_imported_geocode_postal_retry_enroll(uuid,jsonb),public.cos_imported_geocode_postal_retry_list_due(uuid,integer),public.cos_imported_geocode_postal_ordinary_list_due(uuid,integer) from public,anon,authenticated;
grant execute on function public.cos_imported_geocode_postal_retry_enroll(uuid,jsonb),public.cos_imported_geocode_postal_retry_list_due(uuid,integer),public.cos_imported_geocode_postal_ordinary_list_due(uuid,integer) to service_role;
revoke all on function app_private.cos_postal_retry_current(app_private.cos_imported_postal_retry_jobs) from public,anon,authenticated;
grant execute on function app_private.cos_postal_retry_current(app_private.cos_imported_postal_retry_jobs) to service_role;
-- All replaced RPC signatures, invoker roles and previous execution ACLs are retained.
commit;
