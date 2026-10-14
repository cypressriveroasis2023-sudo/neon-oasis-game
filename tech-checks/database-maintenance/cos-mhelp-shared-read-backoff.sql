-- Durable mHelp read backoff. No credentials or customer data are stored here.
-- Accept the original base installer and its exact PT409-only successor.
-- This install-once backoff script follows cos-mhelp-token-session.sql. For an
-- already-installed backoff routine, use cos-mhelp-reconnect-business-conflict.sql.
do $$ begin if md5(pg_get_functiondef('public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)'::regprocedure)) not in ('b62daba9db048c3d3dbfea704609ef63','708e5a62ca5302e320cc447a0e8dc11a') then raise exception 'Token control changed; refresh the reviewed migration' using errcode='40001'; end if; end $$;
create table cos_mhelp_placement_private.read_backoff (
 singleton boolean primary key default true check(singleton),
 blocked_until timestamptz,probe_until timestamptz,probe_lease uuid,
 consecutive_limits integer not null default 0 check(consecutive_limits between 0 and 8),
 revision bigint not null default 0,last_limited_at timestamptz
);
alter table cos_mhelp_placement_private.read_backoff enable row level security;
revoke all on cos_mhelp_placement_private.read_backoff from public,anon,authenticated,service_role;
insert into cos_mhelp_placement_private.read_backoff(singleton) values(true);

CREATE OR REPLACE FUNCTION public.cos_mhelp_token_session(p_action text, p_session uuid DEFAULT NULL::uuid, p_access_token text DEFAULT NULL::text, p_refresh_token text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_portal_id text DEFAULT NULL::text, p_expected_revision bigint DEFAULT NULL::bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'vault'
AS $function$
declare
  state public.cos_mhelp_token_state%rowtype;
  access_value text;
  refresh_value text;
  access_id uuid;
  refresh_id uuid;
  session_id uuid;
  reconnect_result jsonb;
  backoff cos_mhelp_placement_private.read_backoff%rowtype;
  gate_now timestamptz;
  gate_allowed boolean;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'mHelp token session is service-only' using errcode='42501';
  end if;
  -- Reuse the existing service-only RPC without changing its signature or ACL.
  -- These actions return timing metadata only, before any credential is read.
  if p_action in ('gate_read','gate_admit','gate_limit','gate_recovered') then
    if p_access_token is not null or p_refresh_token is not null or p_portal_id is not null or p_request_id is not null
      or (p_action <> 'gate_limit' and p_expires_at is not null)
      or (p_action <> 'gate_recovered' and p_expected_revision is not null) then
      raise exception 'Invalid read backoff operation' using errcode='22023';
    end if;
    select * into strict backoff from cos_mhelp_placement_private.read_backoff where singleton for update;
    gate_now:=clock_timestamp();
    if p_action='gate_limit' then
      update cos_mhelp_placement_private.read_backoff set
        consecutive_limits=case when last_limited_at is null or last_limited_at < gate_now-interval '1 minute' then least(8,consecutive_limits+1) else consecutive_limits end,
        last_limited_at=gate_now,revision=revision+1,probe_until=null,probe_lease=null where singleton returning * into backoff;
      update cos_mhelp_placement_private.read_backoff set
        blocked_until=greatest(blocked_until,p_expires_at,gate_now+make_interval(secs=>least(21600,900*power(2,backoff.consecutive_limits-1)::integer)))
        where singleton returning * into backoff;
    elsif p_action='gate_admit' and (backoff.blocked_until is null or backoff.blocked_until<=gate_now)
      and (backoff.probe_until is null or backoff.probe_until<=gate_now) and backoff.consecutive_limits>0 then
      update cos_mhelp_placement_private.read_backoff set probe_lease=gen_random_uuid(),probe_until=gate_now+interval '2 minutes'
        where singleton returning * into backoff;
      p_session:=backoff.probe_lease;
    elsif p_action='gate_recovered' and backoff.revision=p_expected_revision and backoff.probe_lease=p_session
      and backoff.probe_until>gate_now and (backoff.blocked_until is null or backoff.blocked_until<=gate_now) then
      update cos_mhelp_placement_private.read_backoff set blocked_until=null,probe_until=null,probe_lease=null,
        consecutive_limits=0,revision=revision+1 where singleton returning * into backoff;
    end if;
    gate_allowed:=(backoff.blocked_until is null or backoff.blocked_until<=gate_now)
      and (backoff.probe_until is null or backoff.probe_until<=gate_now or backoff.probe_lease=p_session);
    return jsonb_build_object('allowed',coalesce(gate_allowed,false),'retryAt',case when coalesce(gate_allowed,false) then null else greatest(backoff.blocked_until,backoff.probe_until) end,
      'leaseId',case when p_action in ('gate_admit','gate_recovered') and coalesce(gate_allowed,false) then backoff.probe_lease else null end,
      'revision',backoff.revision,'consecutiveLimits',backoff.consecutive_limits);
  end if;
  if p_action not in ('read','bootstrap','claim','commit','release',
    'reconnect_status','reconnect_claim','reconnect_commit') or p_action is null then
    raise exception 'Unsupported mHelp token operation' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cos-mhelp-token-state-v1',0));
  select * into state from public.cos_mhelp_token_state where singleton for update;
  if p_action='bootstrap' and state.singleton is null then
    if p_portal_id is null or p_portal_id !~ '^[1-9][0-9]{0,14}$'
      or p_access_token is null or length(p_access_token) not between 1 and 16384 or p_access_token ~ '[[:space:]]'
      or p_refresh_token is null or length(p_refresh_token) not between 1 and 16384 or p_refresh_token ~ '[[:space:]]' then
      raise exception 'Invalid mHelp token configuration' using errcode='22023';
    end if;
    access_id := vault.create_secret(p_access_token,'cos_mhelp_access_token_v1','COS server access token');
    refresh_id := vault.create_secret(p_refresh_token,'cos_mhelp_refresh_token_v1','COS server refresh token');
    insert into public.cos_mhelp_token_state(singleton,portal_id,access_secret_id,refresh_secret_id)
      values(true,p_portal_id,access_id,refresh_id) returning * into state;
  end if;
  if p_action='reconnect_status' then
    -- Return before reading Vault. Browser-facing callers get metadata only.
    reconnect_result:=jsonb_build_object('configured',state.singleton is not null,
      'portal_id',state.portal_id,'revision',state.revision);
    if p_request_id is not null or p_expected_revision is not null then
      reconnect_result:=reconnect_result || jsonb_build_object(
        'committed',coalesce(state.last_reconnect_request=p_request_id
          and state.last_reconnect_base_revision=p_expected_revision,false),
        'in_progress',coalesce(state.lease_kind='reconnect'
          and state.lease_request_id=p_request_id and state.lease_revision=p_expected_revision
          and state.lease_id is not null and state.lease_until>now(),false));
    end if;
    if reconnect_result->>'committed'='true' then
      reconnect_result:=reconnect_result || jsonb_build_object('revision',state.last_reconnect_base_revision+1);
    end if;
    return reconnect_result;
  end if;
  if p_action in ('reconnect_claim','reconnect_commit') and
    (p_expected_revision is null or p_expected_revision<1 or p_request_id is null) then
    raise exception 'Invalid mHelp reconnect request' using errcode='22023';
  end if;
  if state.singleton is null then return jsonb_build_object('configured',false); end if;
  if p_action in ('reconnect_claim','reconnect_commit') then
    -- A reconnect receipt is independent of normal renewal's receipt. An exact
    -- lost-ack retry remains successful after later renewals without rewriting
    -- either secret or claiming another lease. Never treat a new base as replay.
    if state.last_reconnect_request=p_request_id then
      if state.last_reconnect_base_revision is distinct from p_expected_revision
        or (p_action='reconnect_commit' and
          (p_session is null or state.last_reconnect_lease is distinct from p_session
            or p_portal_id is distinct from state.portal_id))
        or (p_action='reconnect_claim' and p_portal_id is not null
          and p_portal_id is distinct from state.portal_id) then
        raise exception 'Invalid mHelp reconnect retry' using errcode='22023';
      end if;
      return jsonb_build_object('committed',true,'portal_id',state.portal_id,
        'revision',state.last_reconnect_base_revision+1);
    end if;
    if state.revision is distinct from p_expected_revision then
      raise exception 'mHelp reconnect configuration changed' using errcode='PT409';
    end if;
    if p_action='reconnect_claim' then
      if p_portal_id is not null and p_portal_id is distinct from state.portal_id then
        raise exception 'Invalid mHelp reconnect portal' using errcode='22023';
      end if;
      -- Even a duplicate request cannot receive the existing usable lease.
      -- The owner can inspect status after a lost claim acknowledgement.
      if state.lease_id is not null and state.lease_until>now() then
        raise exception 'mHelp token renewal is already running' using errcode='55P03';
      end if;
      session_id:=gen_random_uuid();
      update public.cos_mhelp_token_state set lease_id=session_id,
        lease_until=now()+interval '120 seconds',lease_kind='reconnect',
        lease_revision=p_expected_revision,lease_request_id=p_request_id where singleton;
      return jsonb_build_object('configured',true,'portal_id',state.portal_id,
        'revision',state.revision,'lease_id',session_id);
    end if;
    if p_session is null or state.lease_id is distinct from p_session
      or state.lease_until is null or state.lease_until<=now()
      or state.lease_kind is distinct from 'reconnect'
      or state.lease_request_id is distinct from p_request_id
      or state.lease_revision is distinct from p_expected_revision
      or p_portal_id is distinct from state.portal_id
      or p_access_token is null or length(p_access_token) not between 1 and 16384 or p_access_token ~ '[[:space:]]'
      or p_refresh_token is null or length(p_refresh_token) not between 1 and 16384 or p_refresh_token ~ '[[:space:]]'
      or p_expires_at is null or p_expires_at<=now()+interval '10 seconds' or p_expires_at>now()+interval '2 days' then
      raise exception 'Invalid or expired mHelp reconnect' using errcode='22023';
    end if;
    -- Both Vault writes and the CAS metadata are one PostgreSQL transaction.
    -- If either write fails, the old pair and revision remain intact.
    perform vault.update_secret(state.access_secret_id,p_access_token);
    perform vault.update_secret(state.refresh_secret_id,p_refresh_token);
    update public.cos_mhelp_token_state set expires_at=p_expires_at,revision=revision+1,
      last_reconnect_request=p_request_id,last_reconnect_base_revision=p_expected_revision,
      last_reconnect_lease=p_session,lease_id=null,lease_until=null,
      lease_kind=null,lease_revision=null,lease_request_id=null,updated_at=now() where singleton;
    return jsonb_build_object('committed',true,'portal_id',state.portal_id,'revision',state.revision+1);
  elsif p_action='commit' then
    -- A lost HTTP response may be retried without rolling the token backward.
    if state.last_committed_lease=p_session then return jsonb_build_object('committed',true); end if;
    if p_session is null or state.lease_id is distinct from p_session or state.lease_until is null or state.lease_until<=now()
      or state.lease_kind is distinct from 'renew'
      or p_access_token is null or length(p_access_token) not between 1 and 16384 or p_access_token ~ '[[:space:]]'
      or p_refresh_token is null or length(p_refresh_token) not between 1 and 16384 or p_refresh_token ~ '[[:space:]]'
      or p_expires_at is null or p_expires_at<=now()+interval '10 seconds' or p_expires_at>now()+interval '2 days' then
      raise exception 'Invalid or expired mHelp token rotation' using errcode='22023';
    end if;
    perform vault.update_secret(state.access_secret_id,p_access_token);
    perform vault.update_secret(state.refresh_secret_id,p_refresh_token);
    update public.cos_mhelp_token_state set expires_at=p_expires_at,revision=revision+1,
      last_committed_lease=p_session,lease_id=null,lease_until=null,
      lease_kind=null,lease_revision=null,lease_request_id=null,updated_at=now() where singleton;
    return jsonb_build_object('committed',true);
  elsif p_action='release' then
    update public.cos_mhelp_token_state set lease_id=null,lease_until=null,
      lease_kind=null,lease_revision=null,lease_request_id=null where singleton and lease_id=p_session;
    return jsonb_build_object('released',true);
  elsif p_action='claim' then
    if state.lease_id is not null and state.lease_until>now() then
      raise exception 'mHelp token renewal is already running' using errcode='55P03';
    end if;
    session_id:=gen_random_uuid();
    update public.cos_mhelp_token_state set lease_id=session_id,lease_until=now()+interval '120 seconds',
      lease_kind='renew',lease_revision=state.revision,lease_request_id=null where singleton;
    select decrypted_secret into refresh_value from vault.decrypted_secrets where id=state.refresh_secret_id;
    if refresh_value is null then raise exception 'mHelp token storage is unavailable'; end if;
  end if;
  select decrypted_secret into access_value from vault.decrypted_secrets where id=state.access_secret_id;
  if access_value is null then raise exception 'mHelp token storage is unavailable'; end if;
  return jsonb_build_object('configured',true,'portal_id',state.portal_id,
    'access_token',access_value,'expires_at',state.expires_at,'revision',state.revision)
    || case when p_action='claim' then jsonb_build_object('lease_id',session_id,'refresh_token',refresh_value) else '{}'::jsonb end;
end;
$function$;

-- Add safe retry metadata to the existing status; preserve both function ACLs.
create or replace function public.cos_mhelp_placement_status() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('contract','COS_MHELP_PLACEMENT_V1','enabled',c.enabled,'sheetsPublisher',false,
 'lastAttemptAt',c.last_attempt_at,'lastSuccessAt',c.last_success_at,
 'errorCode',case when greatest(b.blocked_until,b.probe_until)>clock_timestamp() then 'source_rate_limited' else c.error_code end,
 'readBackoff',jsonb_build_object('retryAt',case when greatest(b.blocked_until,b.probe_until)>clock_timestamp() then greatest(b.blocked_until,b.probe_until) else null end,'consecutiveLimits',b.consecutive_limits),
 'links',(select count(*) from cos_mhelp_placement_private.links))
 from cos_mhelp_placement_private.control c cross join cos_mhelp_placement_private.read_backoff b where c.singleton and b.singleton
$$;
create or replace function public.cos_mhelp_placement_fail(p_lease_id uuid) returns void language sql security definer set search_path='' as $$
 update cos_mhelp_placement_private.control set lease_id=null,lease_until=null,
 error_code=case when (select greatest(blocked_until,probe_until)>clock_timestamp() from cos_mhelp_placement_private.read_backoff where singleton) then 'source_rate_limited' else 'source_read_unavailable' end
 where singleton and lease_id=p_lease_id
$$;

