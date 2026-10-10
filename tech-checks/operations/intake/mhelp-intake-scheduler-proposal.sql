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
  discovery_committed boolean not null default false, pending_manifest jsonb,
  check ((lease_id is null and lease_until is null) or (lease_id is not null and lease_until is not null))
);
alter table cos_mhelp_intake.scheduler_state enable row level security;
revoke all on cos_mhelp_intake.scheduler_state from public,anon,authenticated,service_role;

-- Retry metadata is private and bounded; the durable receipt and first snapshot
-- remain authoritative. A NULL due time means created or reconciliation-only.
alter table cos_mhelp_intake.receipts
  add column pending_next_at timestamptz,
  add column pending_attempt_count integer not null default 0 check(pending_attempt_count between 0 and 16),
  add column pending_last_lease uuid,
  add column pending_last_at timestamptz,
  add column pending_last_digest text,
  add column pending_last_outcome jsonb;
create index receipts_pending_due on cos_mhelp_intake.receipts(portal_id,pending_next_at,ticket_id)
  where state='review_needed' and pending_next_at is not null;
create index receipts_pending_last on cos_mhelp_intake.receipts(pending_last_at desc) where pending_last_at is not null;

-- Called in the same discovery-record transaction after acceptance. Observation
-- via discovery is not a retry attempt and does not increment the retry counter.
create function cos_mhelp_intake.schedule_pending_v1(p_portal text,p_ticket text)
returns void language sql security invoker set search_path='' as $function$
  update cos_mhelp_intake.receipts set pending_next_at=case
    when state='review_needed' and not (reason_codes && array['source_identity_changed_review_required','source_changed_review_required','existing_ticket_requires_reconciliation'])
      then clock_timestamp()+interval '5 minutes' else null end
  where portal_id=p_portal and ticket_id=p_ticket;
$function$;
revoke all on function cos_mhelp_intake.schedule_pending_v1(text,text) from public,anon,authenticated,service_role;

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
  -- Durable minimum poll cadence, including failed/expired runs. An idle
  -- trigger does not move last_attempt_at or postpone the next eligible run.
  if s.last_attempt_at+interval '5 minutes'>t then return jsonb_build_object('state','idle'); end if;
  -- Up to 15 minutes forward per successful run, plus 10 minutes overlap.
  -- The initial strict lower bound is floor minus 1ms to include the activation instant.
  next_end:=least(t,s.watermark+interval '15 minutes');
  if next_end<=s.watermark then return jsonb_build_object('state','idle'); end if;
  update cos_mhelp_intake.scheduler_state set lease_id=gen_random_uuid(),lease_until=t+interval '180 seconds',
    window_after=greatest(c.activated_at-interval '1 millisecond',s.watermark-interval '10 minutes'),window_before=next_end,
    lease_schema_contract=c.schema_contract,lease_activation_floor=c.activated_at,last_attempt_at=t,
    discovery_committed=false,pending_manifest=null
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
  return jsonb_build_object('portalId',s.portal_id,'schemaContract',s.lease_schema_contract,'discoveryCommitted',s.discovery_committed,
    'activationFloor',to_char(c.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAfter',to_char(s.window_after at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBefore',to_char(s.window_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $function$;

create function cos_mhelp_intake.commit_discovery_v1(p_lease uuid,p_expected_ticket_ids jsonb,p_total integer)
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
    discovery_committed=true,last_success_at=clock_timestamp(),failure_count=0,retry_after=null,last_error_code=null where portal_id=s.portal_id;
  return jsonb_build_object('state','complete','total',p_total,'watermarkAdvanced',true);
end $function$;

-- Freeze the due set exactly once. Only post-activation existing receipts can
-- enter it; discovery-window IDs are excluded to avoid duplicate source reads.
create function cos_mhelp_intake.pending_scope_v1(p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; items jsonb;
begin
  perform cos_mhelp_intake.validate_intake_lease_v1(p_lease);
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if not s.discovery_committed then raise exception 'MHELP_INTAKE_DISCOVERY_NOT_COMMITTED'; end if;
  if s.pending_manifest is null then
    select coalesce(jsonb_agg(jsonb_build_object('ticketId',r.ticket_id,'createdAt',
      to_char(r.source_created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by r.pending_next_at,r.ticket_id),'[]'::jsonb)
    into items from (select * from cos_mhelp_intake.receipts r
      where r.portal_id=s.portal_id and r.state='review_needed' and r.pending_next_at<=clock_timestamp()
        and not (r.reason_codes && array['source_identity_changed_review_required','source_changed_review_required','existing_ticket_requires_reconciliation'])
        and r.source_created_at>=s.lease_activation_floor and r.source_created_at<clock_timestamp()
        and r.first_payload->>'schemaContract'=s.lease_schema_contract
        and not (s.completed_ticket_ids ? r.ticket_id)
      order by r.pending_next_at,r.ticket_id limit 10 for update) r;
    update cos_mhelp_intake.scheduler_state set pending_manifest=items where portal_id=s.portal_id;
  else items:=s.pending_manifest; end if;
  return jsonb_build_object('contract','cos-mhelp-pending-scope-v1','leaseId',p_lease,
    'portalId',s.portal_id,'schemaContract',s.lease_schema_contract,
    'activationFloor',to_char(s.lease_activation_floor at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'leaseUntil',to_char(s.lease_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'tickets',items);
end $function$;

-- Every admitted item is completed at most once per lease. The exact same
-- normalized outcome may replay after a lost acknowledgement without double
-- backoff or re-creating assignments. A different outcome under that key rejects.
create function cos_mhelp_intake.record_pending_v1(p_lease uuid,p_outcome jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; r cos_mhelp_intake.receipts%rowtype;
  item jsonb; result jsonb; id text; digest text; attempts integer; cooldown integer:=0;
begin
  perform cos_mhelp_intake.validate_intake_lease_v1(p_lease);
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if not s.discovery_committed or s.pending_manifest is null then raise exception 'MHELP_INTAKE_PENDING_NOT_ADMITTED'; end if;
  if jsonb_typeof(p_outcome) is distinct from 'object' or octet_length(p_outcome::text)>110000
    or jsonb_typeof(p_outcome->'ticketId') is distinct from 'string'
    or coalesce(p_outcome->>'ticketId','') !~ '^[1-9][0-9]{0,14}$' then raise exception 'MHELP_INTAKE_INVALID_PENDING'; end if;
  id:=p_outcome->>'ticketId';
  select value into item from jsonb_array_elements(s.pending_manifest) where value->>'ticketId'=id;
  if not found then raise exception 'MHELP_INTAKE_PENDING_NOT_ADMITTED'; end if;
  select * into r from cos_mhelp_intake.receipts where portal_id=s.portal_id and ticket_id=id for update;
  if not found or r.source_created_at<s.lease_activation_floor
    or r.source_created_at is distinct from (item->>'createdAt')::timestamptz
    or r.first_payload->>'schemaContract' is distinct from s.lease_schema_contract then raise exception 'MHELP_INTAKE_PENDING_NOT_ADMITTED'; end if;
  digest:=encode(sha256(convert_to(p_outcome::text,'UTF8')),'hex');
  if r.pending_last_lease=p_lease then
    if r.pending_last_digest is distinct from digest then raise exception 'MHELP_INTAKE_PENDING_REPLAY_CHANGED'; end if;
    return r.pending_last_outcome;
  end if;
  if p_outcome ? 'identityChanged' then
    if exists(select 1 from jsonb_object_keys(p_outcome) k where k<>all(array['ticketId','identityChanged']))
      or p_outcome->'identityChanged' is distinct from 'true'::jsonb then raise exception 'MHELP_INTAKE_INVALID_PENDING'; end if;
    update cos_mhelp_intake.receipts set reason_codes=array['source_identity_changed_review_required'],review_required=true
      where portal_id=s.portal_id and ticket_id=id;
    result:=jsonb_build_object('state','review_needed','reasonCodes',array['source_identity_changed_review_required'],'assignmentIds',r.assignment_ids,'notifications',false);
  elsif p_outcome ? 'ticket' then
    if exists(select 1 from jsonb_object_keys(p_outcome) k where k<>all(array['ticketId','ticket']))
      or jsonb_typeof(p_outcome->'ticket') is distinct from 'object'
      or p_outcome#>>'{ticket,source,portalId}' is distinct from s.portal_id
      or p_outcome#>>'{ticket,source,ticketId}' is distinct from id
      or p_outcome#>>'{ticket,schemaContract}' is distinct from s.lease_schema_contract
      or (p_outcome#>>'{ticket,source,createdAt}')::timestamptz is distinct from (item->>'createdAt')::timestamptz then raise exception 'MHELP_INTAKE_INVALID_PENDING'; end if;
    result:=cos_mhelp_intake.accept_ticket_v1(p_outcome->'ticket');
    if result->>'state' not in ('created','existing','review_needed') then raise exception 'MHELP_INTAKE_INVALID_PENDING'; end if;
  else
    if exists(select 1 from jsonb_object_keys(p_outcome) k where k<>all(array['ticketId','code','retryable','retryAfterSeconds']))
      or jsonb_typeof(p_outcome->'code') is distinct from 'string'
      or p_outcome->>'code'<>all(array['SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL'])
      or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean'
      or (p_outcome->'retryable'='true'::jsonb and p_outcome->>'code'<>all(array['SOURCE_UNAVAILABLE','DEADLINE']))
      or (p_outcome ? 'retryAfterSeconds' and (jsonb_typeof(p_outcome->'retryAfterSeconds') is distinct from 'number'
        or (p_outcome->>'retryAfterSeconds') !~ '^[0-9]+$' or (p_outcome->>'retryAfterSeconds')::numeric>86400))
      then raise exception 'MHELP_INTAKE_INVALID_PENDING'; end if;
    cooldown:=coalesce((p_outcome->>'retryAfterSeconds')::integer,0);
    result:=jsonb_build_object('state','deferred','code',p_outcome->>'code');
  end if;
  attempts:=least(16,r.pending_attempt_count+1);
  update cos_mhelp_intake.receipts set pending_attempt_count=attempts,
    pending_next_at=case when state='created' or reason_codes && array['source_identity_changed_review_required','source_changed_review_required','existing_ticket_requires_reconciliation'] then null
      else clock_timestamp()+make_interval(secs=>greatest(cooldown,least(3600,300*power(2,least(attempts-1,4))::integer))) end,
    pending_last_lease=p_lease,pending_last_at=clock_timestamp(),pending_last_digest=digest,pending_last_outcome=result
    where portal_id=s.portal_id and ticket_id=id;
  return result;
end $function$;

create function cos_mhelp_intake.finish_intake_v1(p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype;
begin
  select * into s from cos_mhelp_intake.scheduler_state where completed_lease_id=p_lease for update;
  if found and s.lease_id is distinct from p_lease then
    return jsonb_build_object('state','complete','watermarkAdvanced',true); end if;
  perform cos_mhelp_intake.validate_intake_lease_v1(p_lease);
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if s.discovery_committed is not true then raise exception 'MHELP_INTAKE_DISCOVERY_NOT_COMMITTED'; end if;
  update cos_mhelp_intake.scheduler_state set lease_id=null,lease_until=null where lease_id=p_lease;
  return jsonb_build_object('state','complete','watermarkAdvanced',true);
end $function$;
revoke all on function cos_mhelp_intake.pending_scope_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.record_pending_v1(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.finish_intake_v1(uuid) from public,anon,authenticated,service_role;

-- Opt-in aggregate only. Existing Owner review_status v1 is unchanged.
create function cos_mhelp_intake.read_pending_status_v1()
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare waiting bigint; due bigint; oldest timestamptz; latest cos_mhelp_intake.receipts%rowtype; status text; code text;
begin
  select count(*),count(*) filter(where pending_next_at<=clock_timestamp()),min(source_created_at)
    into waiting,due,oldest from cos_mhelp_intake.receipts where state='review_needed' and pending_next_at is not null;
  if waiting>100000000 or due>waiting then raise exception 'MHELP_INTAKE_STATUS_LIMIT'; end if;
  select * into latest from cos_mhelp_intake.receipts where pending_last_at is not null order by pending_last_at desc,portal_id,ticket_id limit 1;
  status:=latest.pending_last_outcome->>'state';code:=latest.pending_last_outcome->>'code';
  if status is null or status<>all(array['created','existing','review_needed','deferred']) then status:=null; end if;
  if code is null or code<>all(array['SOURCE_UNAVAILABLE','SOURCE_INVALID','DEADLINE','CONFIGURATION','INTERNAL']) then code:=null; end if;
  return jsonb_build_object('contract','cos-mhelp-pending-status-v1','waitingCount',waiting,'dueCount',due,
    'oldestWaitingCreatedAt',to_char(oldest at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastRefreshAt',to_char(latest.pending_last_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastRefreshState',status,'lastRefreshCode',code);
end $function$;
revoke all on function cos_mhelp_intake.read_pending_status_v1() from public,anon,authenticated,service_role;

create function cos_mhelp_intake.fail_intake_v1(p_lease uuid,p_code text,p_retryable boolean,p_retry_after_seconds integer default 0)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare s cos_mhelp_intake.scheduler_state%rowtype; failures integer; delay_seconds integer;
begin
  if p_code is null or p_code<>all(array['SOURCE_UNAVAILABLE','SOURCE_INVALID','BATCH_LIMIT','WRITE_UNAVAILABLE','RECEIPT_INVALID','DEADLINE','CONFIGURATION','INTERNAL']) or p_retryable is null
    or p_retry_after_seconds is null or p_retry_after_seconds<0 or p_retry_after_seconds>86400 then
    raise exception 'MHELP_INTAKE_INVALID_FAILURE'; end if;
  select * into s from cos_mhelp_intake.scheduler_state where lease_id=p_lease for update;
  if not found then return jsonb_build_object('state','lease_lost'); end if;
  failures:=least(16,s.failure_count+1);
  delay_seconds:=greatest(p_retry_after_seconds,case when p_retryable then least(1800,30*power(2,least(failures-1,6))::integer) else 1800 end);
  update cos_mhelp_intake.scheduler_state set lease_id=null,lease_until=null,failure_count=failures,
    retry_after=clock_timestamp()+make_interval(secs=>delay_seconds),last_error_code=p_code where portal_id=s.portal_id;
  return jsonb_build_object('state','backoff','retryAfterSeconds',delay_seconds);
end $function$;

revoke all on function cos_mhelp_intake.begin_intake_v1() from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.validate_intake_lease_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.commit_discovery_v1(uuid,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function cos_mhelp_intake.fail_intake_v1(uuid,text,boolean,integer) from public,anon,authenticated,service_role;
commit;
