-- Protected token rotation. Human roles have no table or RPC access.
-- Credentials stay encrypted in Vault and are returned only to service-role code.
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
alter table public.cos_mhelp_token_state enable row level security;
revoke all on public.cos_mhelp_token_state from public, anon, authenticated;
grant select on public.cos_mhelp_token_state to service_role;

create or replace function public.cos_mhelp_token_session(
  p_action text,
  p_session uuid default null,
  p_access_token text default null,
  p_refresh_token text default null,
  p_expires_at timestamptz default null,
  p_portal_id text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, vault as $$
declare
  state public.cos_mhelp_token_state%rowtype;
  access_value text;
  refresh_value text;
  access_id uuid;
  refresh_id uuid;
  session_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'mHelp token session is service-only' using errcode='42501';
  end if;
  if p_action not in ('read','bootstrap','claim','commit','release') or p_action is null then
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
  if state.singleton is null then return jsonb_build_object('configured',false); end if;
  if p_action='commit' then
    -- A lost HTTP response may be retried without rolling the token backward.
    if state.last_committed_lease=p_session then return jsonb_build_object('committed',true); end if;
    if p_session is null or state.lease_id is distinct from p_session or state.lease_until<=now()
      or p_access_token is null or length(p_access_token) not between 1 and 16384 or p_access_token ~ '[[:space:]]'
      or p_refresh_token is null or length(p_refresh_token) not between 1 and 16384 or p_refresh_token ~ '[[:space:]]'
      or p_expires_at is null or p_expires_at<=now()+interval '10 seconds' or p_expires_at>now()+interval '2 days' then
      raise exception 'Invalid or expired mHelp token rotation' using errcode='22023';
    end if;
    perform vault.update_secret(state.access_secret_id,p_access_token);
    perform vault.update_secret(state.refresh_secret_id,p_refresh_token);
    update public.cos_mhelp_token_state set expires_at=p_expires_at,revision=revision+1,
      last_committed_lease=p_session,lease_id=null,lease_until=null,updated_at=now() where singleton;
    return jsonb_build_object('committed',true);
  elsif p_action='release' then
    update public.cos_mhelp_token_state set lease_id=null,lease_until=null where singleton and lease_id=p_session;
    return jsonb_build_object('released',true);
  elsif p_action='claim' then
    if state.lease_id is not null and state.lease_until>now() then
      raise exception 'mHelp token renewal is already running' using errcode='55P03';
    end if;
    session_id:=gen_random_uuid();
    update public.cos_mhelp_token_state set lease_id=session_id,lease_until=now()+interval '120 seconds' where singleton;
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
revoke all on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text) to service_role;
