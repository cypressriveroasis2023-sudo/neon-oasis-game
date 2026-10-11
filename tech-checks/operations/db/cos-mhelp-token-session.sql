-- Protected token rotation. Human roles have no table or RPC access.
-- Credentials stay encrypted in Vault and are returned only to service-role code.
-- Apply the signature replacement and its grants as one transaction, so the
-- old six-argument overload cannot bypass the reconnect lease/CAS checks.
begin;
create table if not exists public.cos_mhelp_token_state (
  singleton boolean primary key default true check (singleton),
  portal_id text not null check (portal_id ~ '^[1-9][0-9]{0,14}$'),
  access_secret_id uuid not null,
  refresh_secret_id uuid not null,
  expires_at timestamptz,
  revision bigint not null default 1,
  lease_id uuid,
  lease_until timestamptz,
  last_committed_lease uuid,
  updated_at timestamptz not null default now()
);
alter table public.cos_mhelp_token_state
  add column if not exists lease_kind text,
  add column if not exists lease_revision bigint,
  add column if not exists lease_request_id uuid,
  add column if not exists last_reconnect_request uuid,
  add column if not exists last_reconnect_base_revision bigint,
  add column if not exists last_reconnect_lease uuid;
-- Preserve an in-flight renewal installed by the previous six-argument RPC.
update public.cos_mhelp_token_state set lease_kind='renew',lease_revision=revision
  where lease_id is not null and lease_kind is null;
alter table public.cos_mhelp_token_state enable row level security;
revoke all on public.cos_mhelp_token_state from public, anon, authenticated;
grant select on public.cos_mhelp_token_state to service_role;

drop function if exists public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text);
create or replace function public.cos_mhelp_token_session(
  p_action text,
  p_session uuid default null,
  p_access_token text default null,
  p_refresh_token text default null,
  p_expires_at timestamptz default null,
  p_portal_id text default null,
  p_expected_revision bigint default null,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, vault as $$
declare
  state public.cos_mhelp_token_state%rowtype;
  access_value text;
  refresh_value text;
  access_id uuid;
  refresh_id uuid;
  session_id uuid;
  reconnect_result jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'mHelp token session is service-only' using errcode='42501';
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
      raise exception 'mHelp reconnect configuration changed' using errcode='40001';
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
$$;
revoke all on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid) from public, anon, authenticated;
grant execute on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
