-- REVIEW ARTIFACT ONLY. Apply to the legacy geocoder project after geocodio-imported-jobs.sql
-- and geocodio-postal-precision-rejections.sql. Idempotent; no source/cache rewrite or retry.
-- The original ZIP, address digest, native/source revision and Owner/GPS guards are preserved.
begin;

create or replace function app_private.cos_imported_matched_postal(p_binding jsonb,p_matched_address text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(app_private.cos_postal_matched_zip(p_matched_address) is not null
  and ((p_binding#>'{installation,zip}')='null'::jsonb
   or jsonb_typeof(p_binding#>'{installation,zip}')='string'
    and app_private.cos_postal_equivalent(p_binding#>>'{installation,zip}',app_private.cos_postal_matched_zip(p_matched_address))),false)
$$;

alter table app_private.cos_imported_census_cache drop constraint if exists cos_imported_census_cache_reason_check;
alter table app_private.cos_imported_census_cache add constraint cos_imported_census_cache_reason_check
 check(reason in ('invalid_address','provider_timeout','provider_unavailable','invalid_response','no_match','provider_empty','ambiguous_results','provider_warning','invalid_components','component_mismatch','formatted_address_mismatch','unsupported_method','low_accuracy','invalid_coordinates','provider_rejected'));

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
 return jsonb_build_object('accepted',true,'record',app_private.cos_imported_record(p_binding,v_guard,r));
end $$;

create or replace function app_private.cos_imported_record(p_binding jsonb,p_guard text,p_geo app_private.cos_field_geocode_fallback_cache)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',p_binding,'jobKind','native_import','legacyGuardSha256',p_guard,'address',p_geo.address,
  'status',case when rejected then 'no_match' else p_geo.status end,'provider','geocodio','source','geocodio_automatic_address_estimate','confidence','estimate',
  'accuracyType',case when rejected then null else p_geo.accuracy_type end,'accuracy',case when rejected then null else p_geo.provider_accuracy end,'matchType',case when rejected then null else p_geo.provider_match_type end,
  'verified',false,'liveGps',false,'latitude',case when rejected then null else p_geo.latitude end,'longitude',case when rejected then null else p_geo.longitude end,'matchedAddress',case when rejected then null else p_geo.matched_address end,
  'geocodedAt',p_geo.geocoded_at,'reason',case when rejected then 'formatted_address_mismatch' else p_geo.reason end,'attempts',p_geo.attempts,'nextAttemptAt',p_geo.next_attempt_at,
  'leaseUntil',p_geo.lease_until,'updatedAt',p_geo.updated_at)
 from (select p_geo.status='success' and not app_private.cos_imported_matched_postal(p_binding,p_geo.matched_address) rejected) validation
$$;

create or replace function app_private.cos_imported_census_record(p_binding jsonb,p_guard text,p_census app_private.cos_imported_census_cache)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('binding',p_binding,'jobKind','native_import','legacyGuardSha256',p_guard,'address',p_census.address,
  'status',case when rejected then 'no_match' else p_census.status end,'provider','us_census_address_range','benchmark','Public_AR_Current','source','us_census_address_range_estimate',
  'confidence','address_range_interpolation','accuracyType','range_interpolation','accuracy',null,'matchType',null,
  'verified',false,'liveGps',false,'latitude',case when rejected then null else p_census.latitude end,'longitude',case when rejected then null else p_census.longitude end,'matchedAddress',case when rejected then null else p_census.matched_address end,
  'geocodedAt',p_census.geocoded_at,'reason',case when rejected then 'formatted_address_mismatch' else p_census.reason end,'attempts',p_census.attempts,'nextAttemptAt',p_census.next_attempt_at,
  'leaseUntil',p_census.lease_until,'updatedAt',p_census.updated_at)
 from (select p_census.status='success' and not app_private.cos_imported_matched_postal(p_binding,p_census.matched_address) rejected) validation
$$;

revoke all on function app_private.cos_imported_matched_postal(jsonb,text) from public,anon,authenticated;
grant execute on function app_private.cos_imported_matched_postal(jsonb,text) to service_role;
commit;
