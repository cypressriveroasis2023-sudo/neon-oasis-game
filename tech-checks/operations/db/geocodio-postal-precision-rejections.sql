-- REVIEW ARTIFACT ONLY. Apply to the legacy geocoder project after geocodio-free-fallback.sql.
-- Idempotent patch: existing RPC signatures, role gates, source keys and budget ledger are unchanged.
-- Deploy this before geocodio-imported-postal-precision-rejections.sql and updated Edge functions.
begin;

-- A ZIP is never normalized by truncation: two explicit ZIP+4 values must agree.
-- Source bindings still require JSON strings; provider numeric handling belongs to the typed adapter.
create or replace function app_private.cos_postal_equivalent(p_expected text,p_actual text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_expected~'^[0-9]{5}(-[0-9]{4})?$' and p_actual~'^[0-9]{5}(-[0-9]{4})?$'
  and left(p_expected,5)=left(p_actual,5)
  and (length(p_expected)=5 or length(p_actual)=5 or p_expected=p_actual),false)
$$;

-- This is a postal persistence/read guard, not a substitute for provider component,
-- formatted-address, quality, ambiguity or coordinate validation in the adapter.
create or replace function app_private.cos_postal_matched_zip(p_address text)
returns text language plpgsql immutable set search_path='' as $$
declare parts text[];
begin
 if p_address is null or length(p_address)>600 or p_address~'[[:cntrl:]]' then return null; end if;
 parts:=regexp_match(p_address,'^\s*[0-9]+[A-Z]?\s+[A-Za-z0-9 .''-]+,\s*[A-Za-z .''-]+,\s*([A-Z]{2})(?:\s*,\s*|\s+)([0-9]{5}(?:-[0-9]{4})?)\s*$','i');
 if parts is null or upper(parts[1])<>all(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP',' ')) then return null; end if;
 return parts[2];
end $$;

create or replace function app_private.cos_postal_safe_no_match_reason(p_reason text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_reason in ('no_match','provider_empty','ambiguous_results','provider_warning','invalid_components','component_mismatch','formatted_address_mismatch','unsupported_method','low_accuracy','invalid_coordinates','provider_rejected'),false)
$$;

alter table app_private.cos_field_geocode_fallback_cache
 drop constraint if exists cos_field_geocode_fallback_cache_reason_check;
alter table app_private.cos_field_geocode_fallback_cache
 add constraint cos_field_geocode_fallback_cache_reason_check check(reason in
 ('configuration_unavailable','budget_exhausted','provider_forbidden','provider_rate_limited','provider_timeout','provider_unavailable','invalid_response','daily_attempt_limit','no_match','provider_empty','ambiguous_results','provider_warning','invalid_components','component_mismatch','formatted_address_mismatch','unsupported_method','low_accuracy','invalid_coordinates','provider_rejected'));

create or replace function public.cos_field_geocode_fallback_finish(p_organization_id uuid,p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text,p_reservation_token uuid,p_status text,
 p_latitude double precision default null,p_longitude double precision default null,p_matched_address text default null,
 p_accuracy_type text default null,p_accuracy double precision default null,p_match_type text default null,p_reason text default null,p_retry_after_seconds integer default null)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; reservation app_private.cos_geocodio_reservations;
 v_now timestamptz; v_reset timestamptz; v_current boolean; v_outcome jsonb; v_next timestamptz; v_status text; v_reason text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);
 if p_reservation_token is null or p_status is null or p_status not in ('success','no_match','provider_error') then
  raise exception 'Invalid fallback completion.' using errcode='22023'; end if;
 if p_status='success' and (p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180)
  or p_matched_address is null or length(btrim(p_matched_address)) not between 1 and 600 or p_matched_address~'[[:cntrl:]]'
  or not app_private.cos_postal_equivalent(app_private.cos_postal_matched_zip(p_address),app_private.cos_postal_matched_zip(p_matched_address))
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
 -- Preserve legacy unit/device lock order. Even a superseded valid reservation may
 -- carry a genuine 403/429: honor its account stop, but never publish its coordinates.
 v_current:=app_private.cos_geocode_lock_current(p_audit_id,p_unit_key,p_address);
 if v_current then
  perform 1 from app_private.cos_field_geocode_cache c where c.organization_id=p_organization_id and c.audit_id=p_audit_id
   and c.unit_key=p_unit_key and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
  v_current:=found and not exists(select 1 from app_private.cos_field_geocode_fallback_rejections where organization_id=p_organization_id
   and audit_id=p_audit_id and unit_key=p_unit_key and address=p_address and address_sha256=p_address_sha256);
 end if;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 select * into reservation from app_private.cos_geocodio_reservations where reservation_token=p_reservation_token
  and organization_id=p_organization_id and audit_id=p_audit_id and unit_key=p_unit_key and address=p_address and address_sha256=p_address_sha256 for update;
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
  return jsonb_build_object('accepted',v_current and reservation.outcome=v_outcome,'record',case when v_current then app_private.cos_geocodio_record(r,p_audit_id,p_unit_key) end);
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
 return jsonb_build_object('accepted',true,'record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key));
end $$;

create or replace function app_private.cos_geocodio_record(p app_private.cos_field_geocode_fallback_cache,p_audit_id text,p_unit_key text)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('auditId',p_audit_id,'unitKey',p_unit_key,'address',p.address,'addressSha256',p.address_sha256,
  'status',case when rejected then 'no_match' else p.status end,'provider','geocodio','source','geocodio_automatic_address_estimate','confidence','estimate',
  'accuracyType',case when rejected then null else p.accuracy_type end,'accuracy',case when rejected then null else p.provider_accuracy end,'matchType',case when rejected then null else p.provider_match_type end,
  'verified',false,'liveGps',false,'latitude',case when rejected then null else p.latitude end,'longitude',case when rejected then null else p.longitude end,'matchedAddress',case when rejected then null else p.matched_address end,
  'geocodedAt',p.geocoded_at,'reason',case when rejected then 'formatted_address_mismatch' else p.reason end,'attempts',p.attempts,'nextAttemptAt',p.next_attempt_at,
  'leaseUntil',p.lease_until,'createdAt',p.created_at,'updatedAt',p.updated_at)
 from (select p.status='success' and not app_private.cos_postal_equivalent(
  app_private.cos_postal_matched_zip(p.address),app_private.cos_postal_matched_zip(p.matched_address)) rejected) validation
$$;

-- CREATE OR REPLACE preserves the existing RPC/helper ACLs. New helpers are private.
revoke all on function app_private.cos_postal_equivalent(text,text),app_private.cos_postal_matched_zip(text),
 app_private.cos_postal_safe_no_match_reason(text) from public,anon,authenticated;
grant execute on function app_private.cos_postal_equivalent(text,text),app_private.cos_postal_matched_zip(text),
 app_private.cos_postal_safe_no_match_reason(text) to service_role;
commit;
