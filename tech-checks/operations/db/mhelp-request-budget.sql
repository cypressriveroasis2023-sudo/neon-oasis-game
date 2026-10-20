-- Shared admission for ALL COS mHelp requests. This does not change schedules,
-- credentials, source timestamps, equipment or the existing provider backoff.
-- Install only with the coordinated worker rollout; do not resume paused scans
-- until request cost, cadence and source-age behavior are verified together.
begin;
create table cos_mhelp_placement_private.request_budget_config (
 singleton boolean primary key default true check(singleton),
 daily_limit integer not null default 4800 check(daily_limit between 1 and 5000),
 essential_reserve integer not null default 200 check(essential_reserve between 0 and daily_limit),
 spacing_ms integer not null default 400 check(spacing_ms between 400 and 60000),
 -- Prior usage is unknown on first installation: wait for a real UTC reset.
 initial_hold_until timestamptz
);
insert into cos_mhelp_placement_private.request_budget_config(singleton,initial_hold_until)
 values(true, date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' + interval '1 day');
create table cos_mhelp_placement_private.request_budget_day (
 utc_day date primary key,
 admitted integer not null default 0 check(admitted>=0),
 essential_admitted integer not null default 0 check(essential_admitted between 0 and admitted)
);
create table cos_mhelp_placement_private.request_budget_pace (
 singleton boolean primary key default true check(singleton),next_start_at timestamptz
);
insert into cos_mhelp_placement_private.request_budget_pace(singleton) values(true);
alter table cos_mhelp_placement_private.request_budget_config enable row level security;
alter table cos_mhelp_placement_private.request_budget_day enable row level security;
alter table cos_mhelp_placement_private.request_budget_pace enable row level security;
revoke all on cos_mhelp_placement_private.request_budget_config,cos_mhelp_placement_private.request_budget_day,cos_mhelp_placement_private.request_budget_pace from public,anon,authenticated,service_role;

-- The private clock argument exists for deterministic SQL tests. Only the public
-- service-only wrapper is callable remotely, and always supplies database time.
create function cos_mhelp_placement_private.admit_request_budget(p_essential boolean,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare cfg cos_mhelp_placement_private.request_budget_config;
 d cos_mhelp_placement_private.request_budget_day;pace timestamptz;hold_until timestamptz;
 day_key date;reset_at timestamptz;cap integer;
begin
 if p_essential is null or p_now is null then raise exception 'Invalid budget operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('cos-mhelp-request-budget-v1',0));
 select * into strict cfg from cos_mhelp_placement_private.request_budget_config where singleton;
 day_key:=(p_now at time zone 'UTC')::date;
 reset_at:=(day_key+1)::timestamp at time zone 'UTC';
 if cfg.initial_hold_until>p_now then return jsonb_build_object('allowed',false,'reason','usage_not_yet_measured','retryAt',cfg.initial_hold_until);end if;
 -- Preserve genuine provider holds. No alternate credential, token endpoint,
 -- reserve class or UTC reset may override Retry-After.
 select greatest(blocked_until,probe_until) into hold_until from cos_mhelp_placement_private.read_backoff where singleton;
 if hold_until>p_now then return jsonb_build_object('allowed',false,'reason','provider_wait','retryAt',hold_until);end if;
 insert into cos_mhelp_placement_private.request_budget_day(utc_day) values(day_key) on conflict do nothing;
 select * into strict d from cos_mhelp_placement_private.request_budget_day where utc_day=day_key for update;
 cap:=case when p_essential then cfg.daily_limit else cfg.daily_limit-cfg.essential_reserve end;
 if d.admitted>=cap then return jsonb_build_object('allowed',false,'reason','daily_budget','retryAt',reset_at);end if;
 select next_start_at into strict pace from cos_mhelp_placement_private.request_budget_pace where singleton for update;
 if pace>p_now then return jsonb_build_object('allowed',false,'reason','pacing','retryAt',pace);end if;
 -- Count before network I/O, including retries and canceled reservations. This
 -- is deliberately a conservative admission count, not claimed vendor usage.
 update cos_mhelp_placement_private.request_budget_day set admitted=admitted+1,
  essential_admitted=essential_admitted+case when p_essential then 1 else 0 end where utc_day=day_key;
 update cos_mhelp_placement_private.request_budget_pace set next_start_at=p_now+cfg.spacing_ms*interval '1 millisecond' where singleton;
 return jsonb_build_object('allowed',true,'reason',null,'retryAt',null);
end$$;
revoke all on function cos_mhelp_placement_private.admit_request_budget(boolean,timestamptz) from public,anon,authenticated,service_role;
create function public.cos_mhelp_request_budget(p_essential boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 return cos_mhelp_placement_private.admit_request_budget(p_essential,clock_timestamp());
end$$;
revoke all on function public.cos_mhelp_request_budget(boolean) from public,anon,authenticated;
grant execute on function public.cos_mhelp_request_budget(boolean) to service_role;
notify pgrst,'reload schema';
commit;
