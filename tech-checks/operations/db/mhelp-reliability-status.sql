-- Safe metadata for existing actor-scoped snapshots. No credential values,
-- source rows, role grants or schedule definitions are changed.
begin;
create table cos_mhelp_placement_private.verified_auth_revision(
 token_revision bigint primary key,verified_at timestamptz,renewal_failed_at timestamptz
);
alter table cos_mhelp_placement_private.verified_auth_revision enable row level security;
revoke all on cos_mhelp_placement_private.verified_auth_revision from public,anon,authenticated,service_role;
create function public.cos_mhelp_auth_observation(p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare s public.cos_mhelp_token_state;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('cos-mhelp-token-state-v1',0));
 select * into strict s from public.cos_mhelp_token_state where singleton for update;
 -- An account check of an older pair cannot verify a concurrent replacement.
 if p_revision is null or p_revision is distinct from s.revision or s.expires_at is null or s.expires_at<=clock_timestamp()
  or exists(select 1 from cos_mhelp_placement_private.rejected_refresh_grant where token_revision=s.revision)
 then return jsonb_build_object('verified',false);end if;
 insert into cos_mhelp_placement_private.verified_auth_revision(token_revision,verified_at) values(s.revision,clock_timestamp())
 on conflict(token_revision) do update set verified_at=excluded.verified_at,renewal_failed_at=null;
 return jsonb_build_object('verified',true);
end$$;
revoke all on function public.cos_mhelp_auth_observation(bigint) from public,anon,authenticated;
grant execute on function public.cos_mhelp_auth_observation(bigint) to service_role;

-- A transient renewal/check failure is visible separately from invalid_grant.
create function public.cos_mhelp_renewal_failure(p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare current_revision bigint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('cos-mhelp-token-state-v1',0));
 select revision into strict current_revision from public.cos_mhelp_token_state where singleton for update;
 if p_revision is null or p_revision is distinct from current_revision then return jsonb_build_object('recorded',false);end if;
 insert into cos_mhelp_placement_private.verified_auth_revision(token_revision,renewal_failed_at) values(p_revision,clock_timestamp())
 on conflict(token_revision) do update set renewal_failed_at=excluded.renewal_failed_at;
 return jsonb_build_object('recorded',true);
end$$;
revoke all on function public.cos_mhelp_renewal_failure(bigint) from public,anon,authenticated;
grant execute on function public.cos_mhelp_renewal_failure(bigint) to service_role;

create function public.cos_mhelp_reliability_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.cos_mhelp_token_state;cfg cos_mhelp_placement_private.request_budget_config;
 live cos_mhelp_placement_private.live_inventory_control;hold_at timestamptz;verified_at timestamptz;failed_at timestamptz;
 rejected boolean;admitted integer;retry_at timestamptz;now_at timestamptz:=clock_timestamp();busy boolean;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 select * into strict s from public.cos_mhelp_token_state where singleton;
 select * into strict live from cos_mhelp_placement_private.live_inventory_control where singleton;
 select * into strict cfg from cos_mhelp_placement_private.request_budget_config where singleton;
 select greatest(blocked_until,probe_until) into hold_at from cos_mhelp_placement_private.read_backoff where singleton;
 select v.verified_at,v.renewal_failed_at into verified_at,failed_at from cos_mhelp_placement_private.verified_auth_revision v where token_revision=s.revision;
 select exists(select 1 from cos_mhelp_placement_private.rejected_refresh_grant where token_revision=s.revision) into rejected;
 select d.admitted into admitted from cos_mhelp_placement_private.request_budget_day d where utc_day=(now_at at time zone 'UTC')::date;
 retry_at:=greatest(hold_at,cfg.initial_hold_until,case when coalesce(admitted,0)>=cfg.daily_limit-cfg.essential_reserve
  then date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC'+interval '1 day' else null end);
 if retry_at<=now_at then retry_at:=null;end if;
 select lease_until>now_at into busy from cos_mhelp_placement_private.inventory_read_lease where singleton;
 return jsonb_build_object('contract','COS_MHELP_RELIABILITY_STATUS_V1',
  'auth',jsonb_build_object('state',case when rejected then 'reconnect_required' when verified_at is not null and s.expires_at>now_at then 'verified' else 'not_yet_verified' end,'verifiedAt',verified_at,'renewalCheckFailed',failed_at is not null,'renewalFailedAt',failed_at),
  'inventory',jsonb_build_object('paused',not live.enabled,'updating',coalesce(busy,false),'lastAttemptAt',live.last_attempt_at,'lastSuccessAt',live.last_success_at,
   'failed',live.error_code is not null,'nextEligibleAt',retry_at));
end$$;
revoke all on function public.cos_mhelp_reliability_status() from public,anon,authenticated;
grant execute on function public.cos_mhelp_reliability_status() to service_role;

-- Gate actual dispatch with the same native control reported by the status.
-- Explicitly start paused during the coordinated rollout. No full read may run
-- until the tested worker rollout and matching scheduler resumption are ready.
update cos_mhelp_placement_private.live_inventory_control set enabled=false where singleton;
do $patch$
declare old text;next text;anchor text;
begin
 old:=pg_get_functiondef('public.cos_mhelp_inventory_read_lease(text,uuid)'::regprocedure);
 anchor:=' -- Respect the durable vendor cooldown.';
 if position('inventory_paused' in old)>0 or (length(old)-length(replace(old,anchor,'')))/length(anchor)<>1 then raise exception 'Inventory read gate changed';end if;
 next:=replace(old,anchor,$gate$ if (select enabled from cos_mhelp_placement_private.live_inventory_control where singleton) is distinct from true then
  return jsonb_build_object('allowed',false,'reason','inventory_paused','retryAt',null);end if;
$gate$||anchor);execute next;
 old:=pg_get_functiondef('public.cos_mhelp_placement_from_inventory()'::regprocedure);
 anchor:='if not ctl.enabled then return jsonb_build_object(''handled'',false);end if;';
 if (length(old)-length(replace(old,anchor,'')))/length(anchor)<>1 then raise exception 'Placement pause guard changed';end if;
 next:=replace(old,anchor,'if not ctl.enabled then return jsonb_build_object(''handled'',true,''state'',''paused'',''reason'',''inventory_paused'',''vendorReads'',0,''inventoryWrites'',0);end if;');execute next;
 old:=pg_get_functiondef('public.cos_mhelp_placement_status()'::regprocedure);
 anchor:='''sheetsPublisher'',false,';
 if position('COS_MHELP_RELIABILITY_STATUS_V1' in old)>0 or position('cos_mhelp_reliability_status' in old)>0 or (length(old)-length(replace(old,anchor,'')))/length(anchor)<>1 then raise exception 'Placement status changed';end if;
 next:=replace(old,anchor,anchor||'''reliability'',public.cos_mhelp_reliability_status(),');execute next;
end$patch$;
notify pgrst,'reload schema';
commit;
