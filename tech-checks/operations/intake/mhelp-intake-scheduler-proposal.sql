-- LOCAL PROPOSAL ONLY. Apply after legacy/mhelp-intake-proposal.sql definitions.
-- Private helpers only; no scheduler activation, public grants, network or secrets.
-- The ONE service-only public RPC routes to these helpers using its own role.
begin;
create table cos_mhelp_intake.scheduler_state (
  portal_id text primary key references cos_mhelp_intake.portal_config(portal_id),
  watermark timestamptz not null,
  lease_id uuid, lease_until timestamptz, window_after timestamptz, window_before timestamptz,
  lease_schema_contract text, lease_activation_floor timestamptz,
  failure_count integer not null default 0 check(failure_count between 0 and 16),
  retry_after timestamptz, last_error_code text, last_attempt_at timestamptz, last_success_at timestamptz,
  completed_lease_id uuid, completed_total integer, completed_ticket_ids jsonb,
  check ((lease_id is null and lease_until is null) or (lease_id is not null and lease_until is not null))
);
alter table cos_mhelp_intake.scheduler_state enable row level security;
revoke all on cos_mhelp_intake.scheduler_state from public,anon,authenticated,service_role;

create function cos_mhelp_intake.begin_intake_v1()
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare
  c cos_mhelp_intake.portal_config%rowtype;
  s cos_mhelp_intake.scheduler_state%rowtype;
  t timestamptz:=clock_timestamp(); n integer; next_end timestamptz;
begin
  -- A fixed connector, not a caller-selected portal. Serialize creation, too.
  perform pg_advisory_xact_lock(hashtextextended('cos_mhelp_intake.scheduler',0));
  select count(*) into n from cos_mhelp_intake.portal_config where enabled;
  if n=0 then return jsonb_build_object('state','disabled'); end if;
  if n<>1 then raise exception 'MHELP_INTAKE_CONFIGURATION'; end if;
  select * into c from cos_mhelp_intake.portal_config where enabled for share;
  if c.activated_at is null or c.activated_at>t or coalesce(btrim(c.schema_contract),'')='' or coalesce(btrim(c.schema_evidence),'')='' then
    raise exception 'MHELP_INTAKE_CONFIGURATION'; end if;
  insert into cos_mhelp_intake.scheduler_state(portal_id,watermark) values(c.portal_id,c.activated_at) on conflict do nothing;
  select * into s from cos_mhelp_intake.scheduler_state where portal_id=c.portal_id for update;
  if s.watermark<c.activated_at or s.watermark>t then raise exception 'MHELP_INTAKE_CONFIGURATION'; end if;
  if s.lease_until>t then return jsonb_build_object('state','busy'); end if;
  if s.retry_after>t then return jsonb_build_object('state','backoff'); end if;
  -- Up to 15 minutes forward per successful run, plus 10 minutes overlap.
  -- The initial strict lower bound is floor minus 1ms to include the activation instant.
  next_end:=least(t,s.watermark+interval '15 minutes');
  if next_end<=s.watermark then return jsonb_build_object('state','idle'); end if;
  update cos_mhelp_intake.scheduler_state set lease_id=gen_random_uuid(),lease_until=t+interval '180 seconds',
    window_after=greatest(c.activated_at-interval '1 millisecond',s.watermark-interval '10 minutes'),window_before=next_end,
    lease_schema_contract=c.schema_contract,lease_activation_floor=c.activated_at,last_attempt_at=t
  where portal_id=c.portal_id returning * into s;
  return jsonb_build_object('state','leased','leaseId',s.lease_id,'portalId',c.portal_id,'schemaContract',c.schema_contract,
    'activationFloor',to_char(c.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAfter',to_char(s.window_after at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBefore',to_char(s.window_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'leaseUntil',to_char(s.lease_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $function$;

create function cos_mhelp_intake.validate_intake_lease_v1(p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; c cos_mhelp_intake.portal_config%rowtype;
begin
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if not found or s.lease_until<=clock_timestamp() then raise exception 'MHELP_INTAKE_LEASE_LOST'; end if;
  select * into c from cos_mhelp_intake.portal_config where portal_id=s.portal_id for share;
  if not found or not c.enabled or c.activated_at is distinct from s.lease_activation_floor or c.schema_contract is distinct from s.lease_schema_contract then
    raise exception 'MHELP_INTAKE_CONFIGURATION_CHANGED'; end if;
  return jsonb_build_object('portalId',s.portal_id,'schemaContract',s.lease_schema_contract,
    'activationFloor',to_char(c.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAfter',to_char(s.window_after at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBefore',to_char(s.window_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $function$;

create function cos_mhelp_intake.finish_intake_v1(p_lease uuid,p_expected_ticket_ids jsonb,p_total integer)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; ids text[]; n integer;
begin
  -- A response lost after COMMIT may retry the SAME finish safely.
  select * into s from cos_mhelp_intake.scheduler_state where completed_lease_id=p_lease for update;
  if found then
    if s.completed_total is distinct from p_total or s.completed_ticket_ids is distinct from p_expected_ticket_ids then raise exception 'MHELP_INTAKE_INCOMPLETE_BATCH'; end if;
    return jsonb_build_object('state','complete','total',s.completed_total,'watermarkAdvanced',true);
  end if;
  perform cos_mhelp_intake.validate_intake_lease_v1(p_lease);
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if p_total is null or p_total<0 or p_total>500 or jsonb_typeof(p_expected_ticket_ids) is distinct from 'array' then
    raise exception 'MHELP_INTAKE_INCOMPLETE_BATCH'; end if;
  if jsonb_array_length(p_expected_ticket_ids)<>p_total or exists(select 1 from jsonb_array_elements(p_expected_ticket_ids) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 128) then
    raise exception 'MHELP_INTAKE_INCOMPLETE_BATCH'; end if;
  select coalesce(array_agg(x#>>'{}'),'{}'::text[]),count(distinct x#>>'{}') into ids,n from jsonb_array_elements(p_expected_ticket_ids) x;
  if n<>p_total then raise exception 'MHELP_INTAKE_INCOMPLETE_BATCH'; end if;
  -- Review receipts count as durable; disabled/excluded/unrecorded tickets do not.
  select count(*) into n from cos_mhelp_intake.receipts r where r.portal_id=s.portal_id and r.ticket_id=any(ids)
    and r.state in ('created','review_needed') and r.source_created_at>=s.lease_activation_floor
    and r.source_created_at>s.window_after and r.source_created_at<s.window_before
    and r.first_payload->>'schemaContract'=s.lease_schema_contract;
  if n<>p_total then raise exception 'MHELP_INTAKE_MISSING_RECEIPTS'; end if;
  update cos_mhelp_intake.scheduler_state set watermark=greatest(watermark,window_before),completed_lease_id=p_lease,completed_total=p_total,completed_ticket_ids=p_expected_ticket_ids,
    lease_id=null,lease_until=null,last_success_at=clock_timestamp(),failure_count=0,retry_after=null,last_error_code=null where portal_id=s.portal_id;
  return jsonb_build_object('state','complete','total',p_total,'watermarkAdvanced',true);
end $function$;

create function cos_mhelp_intake.fail_intake_v1(p_lease uuid,p_code text,p_retryable boolean)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; failures integer; delay_seconds integer;
begin
  if p_code is null or p_code<>all(array['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL']) or p_retryable is null then
    raise exception 'MHELP_INTAKE_INVALID_FAILURE'; end if;
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if not found then return jsonb_build_object('state','lease_lost'); end if;
  failures:=least(16,s.failure_count+1);
  delay_seconds:=case when p_retryable then least(1800,30*power(2,least(failures-1,6))::integer) else 1800 end;
  update cos_mhelp_intake.scheduler_state set lease_id=null,lease_until=null,failure_count=failures,
    retry_after=clock_timestamp()+make_interval(secs=>delay_seconds),last_error_code=p_code where portal_id=s.portal_id;
  return jsonb_build_object('state','backoff','retryAfterSeconds',delay_seconds);
end $function$;

revoke all on function cos_mhelp_intake.begin_intake_v1() from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.validate_intake_lease_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.finish_intake_v1(uuid,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.fail_intake_v1(uuid,text,boolean) from public,anon,authenticated,service_role;
commit;
