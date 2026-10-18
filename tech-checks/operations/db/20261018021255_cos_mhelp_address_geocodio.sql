-- LEGACY geocoder project only. Adds an operator-enrolled address reference
-- job kind to the existing account ledger; no native/Owner identity is invented.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
do $$begin
 if to_regclass('app_private.cos_geocodio_control') is null
 or to_regprocedure('app_private.cos_geocodio_send_before(timestamp with time zone)') is null
 then raise exception 'Existing Geocodio account ledger required';end if;
end$$;

alter table app_private.cos_geocodio_reservations add column mhelp_address_binding jsonb;
alter table app_private.cos_geocodio_reservations drop constraint cos_geocodio_reservations_job_kind_check;
alter table app_private.cos_geocodio_reservations add constraint cos_geocodio_reservations_job_kind_check
 check(job_kind in ('owner_audit','native_import','mhelp_address_reference'));
alter table app_private.cos_geocodio_reservations drop constraint cos_geocodio_reservation_job_binding;
alter table app_private.cos_geocodio_reservations add constraint cos_geocodio_reservation_job_binding check(
 (job_kind='owner_audit' and audit_id is not null and native_binding is null and legacy_guard_sha256 is null and mhelp_address_binding is null)
 or (job_kind='native_import' and audit_id is null and jsonb_typeof(native_binding)='object' and native_binding is not null
  and legacy_guard_sha256 is not null and legacy_guard_sha256~'^[a-f0-9]{64}$' and mhelp_address_binding is null)
 or (job_kind='mhelp_address_reference' and audit_id is null and native_binding is null and legacy_guard_sha256 is null
  and mhelp_address_binding is not null and jsonb_typeof(mhelp_address_binding)='object'
  and mhelp_address_binding->>'sourceSha256' is not null and mhelp_address_binding->>'sourceSha256'~'^[a-f0-9]{64}$'
  and mhelp_address_binding->>'payloadSha256' is not null and mhelp_address_binding->>'payloadSha256'~'^[a-f0-9]{64}$'
  and mhelp_address_binding->>'addressSha256' is not null and mhelp_address_binding->>'addressSha256'~'^[a-f0-9]{64}$'
  and mhelp_address_binding=jsonb_build_object('sourceSha256',mhelp_address_binding->>'sourceSha256','payloadSha256',mhelp_address_binding->>'payloadSha256','addressSha256',mhelp_address_binding->>'addressSha256')));

create table app_private.cos_mhelp_address_geocodio_jobs(
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
 payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),
 address_sha256 text not null check(address_sha256~'^[a-f0-9]{64}$'),
 street text not null check(length(street) between 3 and 250 and street~'^[0-9]+[A-Za-z]?[[:space:]]+' and street!~'[[:cntrl:]<>@=]'),
 city text not null check(length(city)<=100 and city!~'[[:cntrl:]<>@=]'),
 state text not null check(state~'^[A-Z]{2}$'),zip text not null check(zip~'^[0-9]{5}(-[0-9]{4})?$'),
 product_count integer not null check(product_count between 1 and 287),
 approval_reference text not null check(length(approval_reference) between 1 and 300),
 status text not null default 'queued' check(status in ('queued','reserved','received','provider_error')),
 request_id uuid unique references app_private.cos_geocodio_reservations(request_id),
 http_status integer check(http_status between 100 and 599),reason text,
 receipt jsonb,receipt_sha256 text check(receipt_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 primary key(source_sha256,payload_sha256,address_sha256),
 check((status='queued' and request_id is null and completed_at is null and reason is null and receipt is null and receipt_sha256 is null)
  or (status='reserved' and request_id is not null and completed_at is null and reason is null and receipt is null and receipt_sha256 is null)
  or (status='received' and request_id is not null and completed_at is not null and reason is null and http_status=200
   and receipt is not null and jsonb_typeof(receipt)='object' and receipt_sha256 is not null)
  or (status='provider_error' and request_id is not null and completed_at is not null and reason is not null and receipt is null and receipt_sha256 is null))
);
alter table app_private.cos_mhelp_address_geocodio_jobs enable row level security;
revoke all on app_private.cos_mhelp_address_geocodio_jobs from public,anon,authenticated,service_role;

create function public.cos_mhelp_address_geocodio_claim_v1(p_source_sha256 text,p_payload_sha256 text,p_address_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job app_private.cos_mhelp_address_geocodio_jobs;ctl app_private.cos_geocodio_control;
 account app_private.cos_geocodio_account_state;reservation app_private.cos_geocodio_reservations;
 v_now timestamptz;v_day date;v_send_before timestamptz;v_credits integer;binding jsonb;
begin
 -- Same account-first lock order, reset clock and atomic credit ceiling as all
 -- existing Geocodio callers. No separate free allowance or refunds exist.
 select * into account from app_private.cos_geocodio_account_state where singleton for update;
 if not found then raise exception 'Existing account controls required';end if;
 select * into job from app_private.cos_mhelp_address_geocodio_jobs where source_sha256=p_source_sha256
  and payload_sha256=p_payload_sha256 and address_sha256=p_address_sha256 for update;
 if not found then return jsonb_build_object('claimed',false,'status','not_enrolled');end if;
 if job.status<>'queued' then return jsonb_build_object('claimed',false,'status',job.status);end if;
 select * into ctl from app_private.cos_geocodio_control where singleton for share;
 if not found or not ctl.enabled or not ctl.free_only then return jsonb_build_object('claimed',false,'status','configuration_unavailable');end if;
 v_now:=clock_timestamp();v_day:=(v_now at time zone 'America/New_York')::date;
 v_send_before:=app_private.cos_geocodio_send_before(v_now);
 if v_send_before is null or account.blocked_until>v_now or account.cooldown_until>v_now
 then return jsonb_build_object('claimed',false,'status','account_deferred');end if;
 insert into app_private.cos_geocodio_daily_budget(budget_day) values(v_day) on conflict do nothing;
 update app_private.cos_geocodio_daily_budget set credits=credits+1 where budget_day=v_day and credits<ctl.daily_limit returning credits into v_credits;
 if not found then return jsonb_build_object('claimed',false,'status','budget_exhausted');end if;
 binding:=jsonb_build_object('sourceSha256',job.source_sha256,'payloadSha256',job.payload_sha256,'addressSha256',job.address_sha256);
 insert into app_private.cos_geocodio_reservations(request_id,organization_id,audit_id,unit_key,address,address_sha256,
  budget_day,reserved_at,lease_until,send_before,job_kind,mhelp_address_binding)
 values(gen_random_uuid(),'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',null,'MHELP_ADDRESS_SHA256:'||job.address_sha256,
  concat_ws(', ',job.street,nullif(job.city,''),job.state||' '||job.zip),job.address_sha256,
  v_day,v_now,v_now+interval '60 seconds',v_send_before,'mhelp_address_reference',binding) returning * into reservation;
 update app_private.cos_mhelp_address_geocodio_jobs set status='reserved',request_id=reservation.request_id
 where source_sha256=job.source_sha256 and payload_sha256=job.payload_sha256 and address_sha256=job.address_sha256;
 return jsonb_build_object('claimed',true,'requestId',reservation.request_id,'reservationToken',reservation.reservation_token,
  'sendBefore',reservation.send_before,'address',jsonb_build_object('street',job.street,'city',job.city,'state',job.state,'zip',job.zip));
end$$;
revoke all on function public.cos_mhelp_address_geocodio_claim_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.cos_mhelp_address_geocodio_claim_v1(text,text,text) to service_role;

create function public.cos_mhelp_address_geocodio_finish_v1(p_source_sha256 text,p_payload_sha256 text,p_address_sha256 text,
 p_request_id uuid,p_reservation_token uuid,p_status text,p_reason text,p_http_status integer,p_receipt jsonb,p_retry_after_seconds integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job app_private.cos_mhelp_address_geocodio_jobs;reservation app_private.cos_geocodio_reservations;
 v_now timestamptz;v_status text:=p_status;v_reason text:=p_reason;v_receipt jsonb:=p_receipt;
begin
 if p_status is null or p_status not in ('received','provider_error') or p_http_status is not null and p_http_status not between 100 and 599
  or (p_status='received' and (p_reason is not null or p_http_status is distinct from 200 or p_receipt is null
   or jsonb_typeof(p_receipt) is distinct from 'object' or jsonb_typeof(p_receipt->'results') is distinct from 'array'))
  or (p_status='provider_error' and (p_receipt is not null or p_reason is null or p_reason not in
   ('provider_forbidden','provider_rate_limited','provider_timeout','provider_unavailable','invalid_response','expired_before_send')))
  or p_retry_after_seconds is not null and (p_reason is distinct from 'provider_rate_limited' or p_retry_after_seconds not between 60 and 86400)
 then raise exception 'Invalid address receipt' using errcode='22023';end if;
 if p_receipt is not null and (octet_length(p_receipt::text)>100000 or jsonb_array_length(p_receipt->'results')>50)
 then raise exception 'Address receipt too large' using errcode='22023';end if;
 perform 1 from app_private.cos_geocodio_account_state where singleton for update;
 if not found then raise exception 'Existing account controls required';end if;
 select * into job from app_private.cos_mhelp_address_geocodio_jobs where source_sha256=p_source_sha256
  and payload_sha256=p_payload_sha256 and address_sha256=p_address_sha256 for update;
 if not found or job.status<>'reserved' or job.request_id is distinct from p_request_id
 then return jsonb_build_object('accepted',false);end if;
 select * into reservation from app_private.cos_geocodio_reservations where request_id=p_request_id and reservation_token=p_reservation_token
  and job_kind='mhelp_address_reference' and audit_id is null and native_binding is null and legacy_guard_sha256 is null
  and mhelp_address_binding=jsonb_build_object('sourceSha256',p_source_sha256,'payloadSha256',p_payload_sha256,'addressSha256',p_address_sha256) for update;
 if not found or reservation.completed_at is not null then return jsonb_build_object('accepted',false);end if;
 v_now:=clock_timestamp();
 -- Provider account-stop signals still apply even if a worker finishes late.
 if p_reason='provider_forbidden' then
  update app_private.cos_geocodio_account_state set blocked_until=greatest(blocked_until,app_private.cos_geocodio_next_reset(v_now)) where singleton;
 elsif p_reason='provider_rate_limited' then
  update app_private.cos_geocodio_account_state set cooldown_until=greatest(cooldown_until,v_now+make_interval(secs=>coalesce(p_retry_after_seconds,86400))) where singleton;
 end if;
 if reservation.lease_until<=v_now then v_status:='provider_error';v_reason:='lease_expired';v_receipt:=null;end if;
 update app_private.cos_geocodio_reservations set completed_at=v_now,
  outcome=jsonb_build_object('source','mhelp_address_reference','status',v_status,'reason',v_reason,'httpStatus',p_http_status)
 where request_id=p_request_id;
 update app_private.cos_mhelp_address_geocodio_jobs set status=v_status,reason=v_reason,http_status=p_http_status,receipt=v_receipt,
  receipt_sha256=case when v_receipt is not null then encode(sha256(convert_to(v_receipt::text,'UTF8')),'hex') end,completed_at=v_now
 where source_sha256=p_source_sha256 and payload_sha256=p_payload_sha256 and address_sha256=p_address_sha256;
 return jsonb_build_object('accepted',true,'status',v_status);
end$$;
revoke all on function public.cos_mhelp_address_geocodio_finish_v1(text,text,text,uuid,uuid,text,text,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.cos_mhelp_address_geocodio_finish_v1(text,text,text,uuid,uuid,text,text,integer,jsonb,integer) to service_role;
commit;
