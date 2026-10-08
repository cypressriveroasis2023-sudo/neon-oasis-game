-- REVIEW ARTIFACT ONLY. Do not apply outside the serialized release procedure.
-- Additive to the fetched legacy Census RPC baseline. No Census DDL/RPC is replaced.
-- All Geocodio traffic for the one vendor account MUST use this ledger. It cannot
-- account for independent API keys, manual requests, another database, or dashboard use.
begin;

create table app_private.cos_geocodio_control (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 free_only boolean not null default false,
 daily_limit integer not null default 2400 check (daily_limit between 1 and 2400)
);
insert into app_private.cos_geocodio_control(singleton) values(true);
-- No credentials, credential-presence indicators, or vendor response bodies stored here.
create table app_private.cos_geocodio_account_state (
 singleton boolean primary key default true check (singleton),
 blocked_until timestamptz,
 cooldown_until timestamptz
);
insert into app_private.cos_geocodio_account_state(singleton) values(true);
create table app_private.cos_geocodio_daily_budget (
 budget_day date primary key,
 credits integer not null default 0 check (credits between 0 and 2400)
);
create table app_private.cos_geocodio_reservations (
 request_id uuid primary key,
 reservation_token uuid not null unique default gen_random_uuid(),
 organization_id uuid not null,
 audit_id text not null,
 unit_key text not null,
 address text not null,
 address_sha256 text not null,
 budget_day date not null references app_private.cos_geocodio_daily_budget(budget_day),
 reserved_at timestamptz not null,
 lease_until timestamptz not null,
 send_before timestamptz not null,
 completed_at timestamptz,
 outcome jsonb,
 check (lease_until > reserved_at and send_before > reserved_at and send_before <= lease_until)
);
create table app_private.cos_field_geocode_fallback_cache (
 organization_id uuid not null,
 address_sha256 text not null,
 address text not null check (length(address) between 1 and 600),
 status text not null default 'pending' check (status in ('pending','deferred','success','no_match','provider_error')),
 reason text check (reason in ('configuration_unavailable','budget_exhausted','provider_forbidden','provider_rate_limited','provider_timeout','provider_unavailable','invalid_response','daily_attempt_limit','no_match')),
 latitude double precision,
 longitude double precision,
 matched_address text,
 accuracy_type text check (accuracy_type in ('rooftop','range_interpolation')),
 provider_accuracy double precision,
 provider_match_type text check (provider_match_type in ('building_centroid','parcel_centroid')),
 geocoded_at timestamptz,
 attempts integer not null default 0 check (attempts between 0 and 3),
 attempt_day date,
 active_request_id uuid references app_private.cos_geocodio_reservations(request_id),
 lease_until timestamptz,
 next_attempt_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (organization_id,address_sha256),
 check (address=app_private.cos_geocode_normalize_address(address)),
 check (address_sha256=encode(sha256(convert_to(address,'UTF8')),'hex')),
 check ((status='pending' and active_request_id is not null and lease_until is not null)
     or (active_request_id is null and lease_until is null)),
 check (case when status='success' then
   latitude is not null and latitude between -90 and 90 and longitude is not null and longitude between -180 and 180
   and matched_address is not null and length(btrim(matched_address)) between 1 and 600 and matched_address!~'[[:cntrl:]]'
   and accuracy_type is not null and provider_accuracy is not null and provider_accuracy between 0.9 and 1
   and (accuracy_type='rooftop' or provider_match_type is null) and geocoded_at is not null and reason is null
  else latitude is null and longitude is null and matched_address is null and accuracy_type is null
   and provider_accuracy is null and provider_match_type is null end)
);
-- Per-audit parser rejection prevents unsafe-address queue starvation without
-- poisoning the shared address cache or touching another audit's in-flight request.
create table app_private.cos_field_geocode_fallback_rejections (
 organization_id uuid not null,
 audit_id text not null,
 unit_key text not null,
 address text not null,
 address_sha256 text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,audit_id),
 check (address=app_private.cos_geocode_normalize_address(address)),
 check (length(address) between 1 and 600 and address_sha256=encode(sha256(convert_to(address,'UTF8')),'hex'))
);
alter table app_private.cos_field_geocode_fallback_rejections enable row level security;
revoke all on app_private.cos_field_geocode_fallback_rejections from public,anon,authenticated,service_role;
grant select,insert,update on app_private.cos_field_geocode_fallback_rejections to service_role;

create index cos_geocodio_reservations_day on app_private.cos_geocodio_reservations(budget_day);

alter table app_private.cos_geocodio_control enable row level security;
alter table app_private.cos_geocodio_account_state enable row level security;
alter table app_private.cos_geocodio_daily_budget enable row level security;
alter table app_private.cos_geocodio_reservations enable row level security;
alter table app_private.cos_field_geocode_fallback_cache enable row level security;
revoke all on app_private.cos_geocodio_control,app_private.cos_geocodio_account_state,
 app_private.cos_geocodio_daily_budget,app_private.cos_geocodio_reservations,
 app_private.cos_field_geocode_fallback_cache from public,anon,authenticated,service_role;
grant select on app_private.cos_geocodio_control to service_role;
grant select,update on app_private.cos_geocodio_account_state to service_role;
grant select,insert,update on app_private.cos_geocodio_daily_budget,app_private.cos_geocodio_reservations,
 app_private.cos_field_geocode_fallback_cache to service_role;
-- service_role is the existing trusted backend role (BYPASSRLS), never a fleet Service user.

create function app_private.cos_geocodio_next_reset(p_now timestamptz)
returns timestamptz language sql stable strict set search_path='' as $$
 select (((p_now at time zone 'America/New_York')::date+1)::timestamp at time zone 'America/New_York')
$$;

-- A reservation close to reset cannot safely finish in its charged vendor day.
-- The worker must check the returned deadline immediately before its one fetch.
create function app_private.cos_geocodio_send_before(p_now timestamptz)
returns timestamptz language sql stable strict set search_path='' as $$
 select case when app_private.cos_geocodio_next_reset(p_now)-p_now>interval '60 seconds'
  then least(p_now+interval '10 seconds',app_private.cos_geocodio_next_reset(p_now)-interval '30 seconds') end
$$;

create function app_private.cos_geocodio_record(p app_private.cos_field_geocode_fallback_cache,p_audit_id text,p_unit_key text)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('auditId',p_audit_id,'unitKey',p_unit_key,'address',p.address,'addressSha256',p.address_sha256,
  'status',p.status,'provider','geocodio','source','geocodio_automatic_address_estimate','confidence','estimate',
  'accuracyType',p.accuracy_type,'accuracy',p.provider_accuracy,'matchType',p.provider_match_type,
  'verified',false,'liveGps',false,'latitude',p.latitude,'longitude',p.longitude,'matchedAddress',p.matched_address,
  'geocodedAt',p.geocoded_at,'reason',p.reason,'attempts',p.attempts,'nextAttemptAt',p.next_attempt_at,
  'leaseUntil',p.lease_until,'createdAt',p.created_at,'updatedAt',p.updated_at)
$$;

create function app_private.cos_geocodio_rejection_record(p app_private.cos_field_geocode_fallback_rejections)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('auditId',p.audit_id,'unitKey',p.unit_key,'address',p.address,'addressSha256',p.address_sha256,
  'status','no_match','reason','invalid_address','provider','geocodio','source','geocodio_automatic_address_estimate',
  'confidence','estimate','accuracyType',null,'accuracy',null,'matchType',null,'verified',false,'liveGps',false,
  'latitude',null,'longitude',null,'matchedAddress',null,'geocodedAt',null,'attempts',0,'nextAttemptAt',null,
  'leaseUntil',null,'createdAt',p.created_at,'updatedAt',p.created_at)
$$;

create function public.cos_field_geocode_fallback_reject_address(p_organization_id uuid,p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text)
returns jsonb language plpgsql set search_path='' as $$
declare rejected app_private.cos_field_geocode_fallback_rejections;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);
 if not app_private.cos_geocode_lock_current(p_audit_id,p_unit_key,p_address) then return jsonb_build_object('accepted',false,'record',null); end if;
 perform 1 from app_private.cos_field_geocode_cache c where c.organization_id=p_organization_id and c.audit_id=p_audit_id
  and c.unit_key=p_unit_key and c.address=p_address and c.address_sha256=p_address_sha256 and c.status='no_match' for share;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 insert into app_private.cos_field_geocode_fallback_rejections(organization_id,audit_id,unit_key,address,address_sha256)
 values(p_organization_id,p_audit_id,p_unit_key,p_address,p_address_sha256)
 on conflict (organization_id,audit_id) do update set unit_key=excluded.unit_key,address=excluded.address,address_sha256=excluded.address_sha256
 returning * into rejected;
 return jsonb_build_object('accepted',true,'record',app_private.cos_geocodio_rejection_record(rejected));
end $$;

create function public.cos_field_geocode_fallback_list_due(p_organization_id uuid,p_limit integer default 5,p_audit_id text default null,p_unit_key text default null)
returns jsonb language plpgsql set search_path='' as $$
declare v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Batch limit must be 1 through 5.' using errcode='22023'; end if;
 if (p_audit_id is null)<>(p_unit_key is null) or p_audit_id is not null and
  (p_audit_id!~'^[1-9][0-9]{0,18}$' or length(p_unit_key) not between 1 and 250) then
  raise exception 'Target audit and exact legacy unit must be supplied together.' using errcode='22023'; end if;
 if not exists(select 1 from app_private.cos_geocodio_control where singleton and enabled and free_only) then return '[]'; end if;
 if not exists(select 1 from app_private.cos_geocodio_account_state where singleton
  and (blocked_until is null or blocked_until<=v_now) and (cooldown_until is null or cooldown_until<=v_now)) then return '[]'; end if;
 select coalesce(jsonb_agg(x.record order by x.created_at,x.audit_id),'[]') into v_result from (
  select c.audit_id,c.created_at,case when f.organization_id is not null then app_private.cos_geocodio_record(f,c.audit_id,c.unit_key)
   else jsonb_build_object('auditId',c.audit_id,'unitKey',c.unit_key,'address',c.address,'addressSha256',c.address_sha256,
    'status','pending','provider','geocodio','confidence','estimate','verified',false,'liveGps',false) end record
  from app_private.cos_field_geocode_cache c
  join lateral app_private.cos_geocode_current_audit(c.audit_id) a on true
  left join app_private.cos_field_geocode_fallback_cache f on f.organization_id=c.organization_id and f.address_sha256=c.address_sha256 and f.address=c.address
  where c.organization_id=p_organization_id and c.status='no_match'
   and (p_audit_id is null or c.audit_id=p_audit_id and lower(btrim(c.unit_key))=lower(btrim(p_unit_key)))
   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)
   and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address')
   and c.address_sha256=encode(sha256(convert_to(c.address,'UTF8')),'hex')
   and not exists(select 1 from app_private.cos_field_geocode_fallback_rejections rejected where rejected.organization_id=c.organization_id
    and rejected.audit_id=c.audit_id and rejected.unit_key=c.unit_key and rejected.address=c.address and rejected.address_sha256=c.address_sha256)
   and (f.organization_id is null or f.status in ('pending','deferred','provider_error')
    and (f.lease_until is null or f.lease_until<=v_now) and (f.next_attempt_at is null or f.next_attempt_at<=v_now))
  order by c.created_at,c.audit_id limit p_limit
 ) x;
 return v_result;
end $$;

create function public.cos_field_geocode_fallback_reserve(p_organization_id uuid,p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text,p_request_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare r app_private.cos_field_geocode_fallback_cache; ctl app_private.cos_geocodio_control; rejected app_private.cos_field_geocode_fallback_rejections;
 account app_private.cos_geocodio_account_state; reservation app_private.cos_geocodio_reservations;
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

create function public.cos_field_geocode_fallback_finish(p_organization_id uuid,p_audit_id text,p_unit_key text,p_address text,p_address_sha256 text,p_reservation_token uuid,p_status text,
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
 return jsonb_build_object('accepted',true,'record',app_private.cos_geocodio_record(r,p_audit_id,p_unit_key));
end $$;

create function public.cos_field_geocode_fallback_read_many(p_organization_id uuid,p_audit_ids text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 -- Exact legacy Owner/approved IT gate. No supplied actor, user_metadata, or fleet Service authorization.
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501'; end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' then
  if not app_private.cos_verified_fleet_actor(auth.uid()) then raise exception 'Owner account required.' using errcode='42501'; end if;
 end if;
 if p_audit_ids is null or coalesce(array_ndims(p_audit_ids),1)<>1 or cardinality(p_audit_ids)>250
  or exists(select 1 from unnest(p_audit_ids) x where x is null or x!~'^[1-9][0-9]{0,18}$') then
  raise exception 'At most 250 audit identities required.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(case when rejected.audit_id is not null then app_private.cos_geocodio_rejection_record(rejected)
  else app_private.cos_geocodio_record(f,c.audit_id,c.unit_key) end order by c.audit_id),'[]') into v_result
 from app_private.cos_field_geocode_cache c join lateral app_private.cos_geocode_current_audit(c.audit_id) a on true
 left join app_private.cos_field_geocode_fallback_cache f on f.organization_id=c.organization_id and f.address_sha256=c.address_sha256 and f.address=c.address
 left join app_private.cos_field_geocode_fallback_rejections rejected on rejected.organization_id=c.organization_id and rejected.audit_id=c.audit_id
  and rejected.unit_key=c.unit_key and rejected.address=c.address and rejected.address_sha256=c.address_sha256
 where c.organization_id=p_organization_id and c.audit_id=any(p_audit_ids) and c.status='no_match'
  and (f.organization_id is not null or rejected.audit_id is not null)
  and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)
  and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address')
  and c.address_sha256=encode(sha256(convert_to(c.address,'UTF8')),'hex');
 return v_result;
end $$;

revoke all on function app_private.cos_geocodio_rejection_record(app_private.cos_field_geocode_fallback_rejections) from public,anon,authenticated;
grant execute on function app_private.cos_geocodio_rejection_record(app_private.cos_field_geocode_fallback_rejections) to service_role;
revoke all on function public.cos_field_geocode_fallback_reject_address(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.cos_field_geocode_fallback_reject_address(uuid,text,text,text,text) to service_role;
revoke all on function app_private.cos_geocodio_send_before(timestamptz),app_private.cos_geocodio_next_reset(timestamptz),app_private.cos_geocodio_record(app_private.cos_field_geocode_fallback_cache,text,text) from public,anon,authenticated;
grant execute on function app_private.cos_geocodio_send_before(timestamptz),app_private.cos_geocodio_next_reset(timestamptz),app_private.cos_geocodio_record(app_private.cos_field_geocode_fallback_cache,text,text) to service_role;
revoke all on function public.cos_field_geocode_fallback_list_due(uuid,integer,text,text),
 public.cos_field_geocode_fallback_reserve(uuid,text,text,text,text,uuid),
 public.cos_field_geocode_fallback_finish(uuid,text,text,text,text,uuid,text,double precision,double precision,text,text,double precision,text,text,integer),
 public.cos_field_geocode_fallback_read_many(uuid,text[]) from public,anon,authenticated;
grant execute on function public.cos_field_geocode_fallback_list_due(uuid,integer,text,text),
 public.cos_field_geocode_fallback_reserve(uuid,text,text,text,text,uuid),
 public.cos_field_geocode_fallback_finish(uuid,text,text,text,text,uuid,text,double precision,double precision,text,text,double precision,text,text,integer) to service_role;
grant execute on function public.cos_field_geocode_fallback_read_many(uuid,text[]) to authenticated,service_role;
commit;
