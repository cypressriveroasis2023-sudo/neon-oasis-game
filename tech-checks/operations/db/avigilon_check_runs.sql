-- Local candidate only. Private durable store, no public RPC, SECURITY DEFINER
-- or access grant. Production service transport needs separate privilege review.
create schema cos_avigilon_checks_private;
revoke all on schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
create table cos_avigilon_checks_private.runs(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,
 roster_revision text not null,deadline_at timestamptz not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object')
);
create index on cos_avigilon_checks_private.runs(tenant_id,id);
create table cos_avigilon_checks_private.heads(tenant_id uuid primary key,run_id uuid not null references cos_avigilon_checks_private.runs);
alter table cos_avigilon_checks_private.runs enable row level security;
alter table cos_avigilon_checks_private.heads enable row level security;
revoke all on all tables in schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
create function cos_avigilon_checks_private.assert_actor(p_actor uuid,p_tenant uuid) returns void language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Reviewed administrative transport required' using errcode='42501';end if;
 if p_tenant is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not exists(
  select 1 from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id join public.roles r on r.id=ur.role_id
  where p.user_id=p_actor and p.organization_id=p_tenant and p.active and r.organization_id=p_tenant
   and ((p.department='owner' and r.code='owner') or (p.department='it' and r.code='it_technician'))
 ) then raise exception 'Active existing Owner or IT role required' using errcode='42501';end if;
end $$;
create function cos_avigilon_checks_private.claim(p_actor uuid,p_tenant uuid,p_run jsonb) returns jsonb language plpgsql set search_path='' as $$
declare previous cos_avigilon_checks_private.runs;run_id uuid;started timestamptz;deadline timestamptz;
begin
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 if not pg_try_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0)) then raise exception 'Run claim busy; retry saved run lookup' using errcode='55P03';end if;
 run_id:=(p_run->>'id')::uuid;started:=(p_run->>'startedAt')::timestamptz;deadline:=(p_run->>'deadlineAt')::timestamptz;
 if run_id is null or p_run->>'tenantId' is distinct from p_tenant::text or p_run->>'state' is distinct from 'pending' or p_run->'completedAt' is distinct from 'null'::jsonb
  or length(coalesce(p_run->>'rosterRevision','')) not between 1 and 256 or started is null or deadline is null or started<clock_timestamp()-interval '30 seconds' or started>clock_timestamp()+interval '5 seconds'
  or deadline<=clock_timestamp() or deadline>started+interval '90 seconds' or jsonb_typeof(p_run->'rows') is distinct from 'array' or jsonb_array_length(p_run->'rows')>1000
  or exists(select 1 from jsonb_array_elements(p_run->'rows') r where coalesce(r->>'outcome','') not in('pending','unverified') or coalesce(r->>'unitId','')='' or r->'confirmedOutage' is distinct from 'false'::jsonb)
  or (select count(*)<>count(distinct r->>'unitId') from jsonb_array_elements(p_run->'rows') r) then raise exception 'Invalid new check run';end if;
 select r.* into previous from cos_avigilon_checks_private.heads h join cos_avigilon_checks_private.runs r on r.id=h.run_id where h.tenant_id=p_tenant;
 if previous.snapshot->>'state'='pending' and previous.deadline_at>clock_timestamp() and previous.roster_revision=p_run->>'rosterRevision' then return jsonb_build_object('run',previous.snapshot,'claimed',false);end if;
 insert into cos_avigilon_checks_private.runs values(run_id,p_tenant,p_actor,p_run->>'rosterRevision',deadline,p_run);
 insert into cos_avigilon_checks_private.heads values(p_tenant,run_id) on conflict(tenant_id) do update set run_id=excluded.run_id;
 return jsonb_build_object('run',p_run,'claimed',true);
end $$;
create function cos_avigilon_checks_private.read_run(p_actor uuid,p_tenant uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 select snapshot into result from cos_avigilon_checks_private.runs where id=p_id and tenant_id=p_tenant;return result;end $$;
create function cos_avigilon_checks_private.save(p_actor uuid,p_tenant uuid,p_run jsonb) returns boolean language plpgsql set search_path='' as $$
declare previous cos_avigilon_checks_private.runs;
begin
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 if not pg_try_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0)) then return false;end if;
 select r.* into previous from cos_avigilon_checks_private.heads h join cos_avigilon_checks_private.runs r on r.id=h.run_id
 where h.tenant_id=p_tenant and r.id=(p_run->>'id')::uuid for update of r;
 if not found or previous.actor_id<>p_actor or previous.snapshot->>'state'<>'pending' then return false;end if;
 if (p_run-array['rows','completedAt','state']) is distinct from (previous.snapshot-array['rows','completedAt','state'])
  or coalesce(p_run->>'state','') not in('pending','completed','partial','failed') or jsonb_typeof(p_run->'rows') is distinct from 'array'
  or jsonb_array_length(p_run->'rows')<>jsonb_array_length(previous.snapshot->'rows') then raise exception 'Run metadata changed';end if;
 if exists(select 1 from jsonb_array_elements(previous.snapshot->'rows') with ordinality old(r,n)
  join jsonb_array_elements(p_run->'rows') with ordinality fresh(r,n) using(n)
  where (old.r-array['outcome','reason','startedAt','completedAt','confirmedOutage']) is distinct from (fresh.r-array['outcome','reason','startedAt','completedAt','confirmedOutage'])
   or (old.r->>'outcome'<>'pending' and old.r is distinct from fresh.r)
   or coalesce(fresh.r->>'outcome','') not in('pending','online','nonresponse','unverified')
   or (clock_timestamp()>previous.deadline_at and old.r->>'outcome'='pending' and fresh.r->>'outcome' in('online','nonresponse'))
 ) then raise exception 'Stale or invalid run outcome';end if;
 if p_run->>'state'<>'pending' and exists(select 1 from jsonb_array_elements(p_run->'rows') r where r->>'outcome'='pending') then raise exception 'Incomplete terminal run';end if;
 update cos_avigilon_checks_private.runs set snapshot=p_run where id=previous.id;return true;
end $$;
revoke all on all functions in schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
