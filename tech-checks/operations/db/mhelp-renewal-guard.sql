-- Metadata only; existing Vault storage and atomic token lease/CAS are unchanged.
begin;
create table cos_mhelp_placement_private.rejected_refresh_grant(
 token_revision bigint primary key,rejected_at timestamptz not null default clock_timestamp(),
 reason text not null default 'invalid_grant' check(reason='invalid_grant')
);
alter table cos_mhelp_placement_private.rejected_refresh_grant enable row level security;
revoke all on cos_mhelp_placement_private.rejected_refresh_grant from public,anon,authenticated,service_role;
create function public.cos_mhelp_renewal_guard(p_action text,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare s public.cos_mhelp_token_state;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_action is null or p_action not in('check','reject') then raise exception 'Invalid renewal guard action';end if;
 perform pg_advisory_xact_lock(hashtextextended('cos-mhelp-token-state-v1',0));
 select * into strict s from public.cos_mhelp_token_state where singleton for update;
 if p_action='reject' then
  if p_lease is null or s.lease_id is distinct from p_lease or s.lease_kind is distinct from 'renew'
   or s.lease_revision is distinct from s.revision or s.lease_until is null or s.lease_until<=clock_timestamp() then raise exception 'Renewal lease changed';end if;
  insert into cos_mhelp_placement_private.rejected_refresh_grant(token_revision) values(s.revision) on conflict do nothing;
 elsif p_lease is not null and s.lease_id is distinct from p_lease then raise exception 'Renewal lease changed';
 end if;
 return jsonb_build_object('allowed',not exists(select 1 from cos_mhelp_placement_private.rejected_refresh_grant where token_revision=s.revision),'revision',s.revision);
end$$;
revoke all on function public.cos_mhelp_renewal_guard(text,uuid) from public,anon,authenticated;
grant execute on function public.cos_mhelp_renewal_guard(text,uuid) to service_role;
commit;
