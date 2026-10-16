-- REVIEW-ONLY candidate, after avigilon_check_runs.sql. No production grants.
-- Native authority is CLOSED by default. Every source writer must fence before
-- changing any remote endpoint/identity/placement/restriction, then admit after
-- verified readback. A crashed writer leaves it closed. This is NOT a cross-DB TX.
begin;
create table cos_avigilon_checks_private.authority(
 tenant_id uuid primary key, generation bigint not null check(generation>0),
 admitted boolean not null default false, roster_revision text, units jsonb
);
create table cos_avigilon_checks_private.managed_devices(
 tenant_id uuid not null, device_id text not null, primary key(tenant_id,device_id)
);
alter table cos_avigilon_checks_private.managed_devices enable row level security;
revoke all on cos_avigilon_checks_private.managed_devices from public,anon,authenticated,service_role;
create table cos_avigilon_checks_private.publications(
 receipt_id bigint generated always as identity primary key,
 tenant_id uuid not null, run_id uuid not null references cos_avigilon_checks_private.runs,
 unit_id text not null, generation bigint not null, device_id text not null,
 request jsonb not null, row_result jsonb not null, health jsonb not null,
 committed_at timestamptz not null default clock_timestamp(),
 replica_ack_at timestamptz, unique(run_id,unit_id)
);
create index publications_endpoint_latest on cos_avigilon_checks_private.publications(tenant_id,generation,device_id,receipt_id desc);
alter table cos_avigilon_checks_private.authority enable row level security;
alter table cos_avigilon_checks_private.publications enable row level security;
revoke all on cos_avigilon_checks_private.authority,cos_avigilon_checks_private.publications from public,anon,authenticated,service_role;
revoke all on all sequences in schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
-- This function must precede source mutations, not follow an asynchronous mirror.
create function cos_avigilon_checks_private.fence(p_actor uuid,p_tenant uuid) returns bigint language plpgsql set search_path='' as $$
declare epoch bigint;
begin
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 perform pg_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0));
 insert into cos_avigilon_checks_private.authority(tenant_id,generation) values(p_tenant,1)
 on conflict(tenant_id) do update set generation=cos_avigilon_checks_private.authority.generation+1,admitted=false
 where cos_avigilon_checks_private.authority.admitted
 returning generation into epoch;
 if not found then raise exception 'Another authority mutation is fenced; explicit recovery required';end if;
 delete from cos_avigilon_checks_private.heads where tenant_id=p_tenant;
 return epoch;
end $$;
create function cos_avigilon_checks_private.admit(p_actor uuid,p_tenant uuid,p_generation bigint,p_roster jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 perform pg_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0));
 if p_roster->>'tenantId' is distinct from p_tenant::text or length(coalesce(p_roster->>'revision','')) not between 1 and 256
 or jsonb_typeof(p_roster->'units') is distinct from 'array' or jsonb_array_length(p_roster->'units')>10000
 or exists(select 1 from jsonb_array_elements(p_roster->'units') u where coalesce(u->>'id','')='' or coalesce(u->>'placement','') not in ('FIELD','SHOP','UNKNOWN')
  or jsonb_typeof(u->'restricted') is distinct from 'boolean' or jsonb_typeof(u->'identityVerified') is distinct from 'boolean')
 or (select count(*)<>count(distinct u->>'id') from jsonb_array_elements(p_roster->'units') u)
 then raise exception 'Invalid authority roster';end if;
 update cos_avigilon_checks_private.authority set admitted=true,roster_revision=p_roster->>'revision',units=p_roster->'units'
 where tenant_id=p_tenant and generation=p_generation and not admitted;
 if not found then raise exception 'Authority fence changed';end if;
 -- Retain device tombstones across removals; a removed mapping must not expose
 -- an older legacy observation as current again.
 insert into cos_avigilon_checks_private.managed_devices(tenant_id,device_id)
 select distinct p_tenant,u->'endpoint'->>'deviceId' from jsonb_array_elements(p_roster->'units') u
 where u->'endpoint'->>'deviceId' is not null and u->>'family' in ('Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V')
 on conflict do nothing;
end $$;
alter table cos_avigilon_checks_private.runs add column authority_generation bigint;
create function cos_avigilon_checks_private.bind_authority() returns trigger language plpgsql set search_path='' as $$
begin
 select generation into new.authority_generation from cos_avigilon_checks_private.authority
 where tenant_id=new.tenant_id and admitted and roster_revision=new.roster_revision;
 if not found then raise exception 'Admitted authority required for lease';end if;
 return new;
end $$;
create trigger bind_authority before insert on cos_avigilon_checks_private.runs for each row execute function cos_avigilon_checks_private.bind_authority();
create function cos_avigilon_checks_private.commit_result(p_actor uuid,p_tenant uuid,p_result jsonb) returns jsonb language plpgsql set search_path='' as $$
declare run cos_avigilon_checks_private.runs; authority cos_avigilon_checks_private.authority;
 prior cos_avigilon_checks_private.publications; unit jsonb; endpoint jsonb; proposal jsonb; h jsonb;
 old_row jsonb; new_row jsonb; position integer; receipt bigint; observed timestamptz; started timestamptz;
 responded boolean; failures integer; prior_health jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0));
 -- Hold authorization rows through commit; concurrent revocation waits, and is
 -- ordered before/after this transaction instead of racing its final write.
 perform 1 from public.user_profiles where user_id=p_actor for share;
 perform 1 from public.user_roles where user_id=p_actor for share;
 perform 1 from public.roles where id in(select role_id from public.user_roles where user_id=p_actor) for share;
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 select r.* into run from cos_avigilon_checks_private.heads heads join cos_avigilon_checks_private.runs r on r.id=heads.run_id
 where heads.tenant_id=p_tenant and r.id=(p_result->>'runId')::uuid for update of r;
 if not found or run.actor_id<>p_actor or run.deadline_at<=clock_timestamp() then raise exception 'Current lease required';end if;
 select * into authority from cos_avigilon_checks_private.authority where tenant_id=p_tenant for update;
 if not found or not authority.admitted or authority.roster_revision<>run.roster_revision or run.authority_generation is distinct from authority.generation then raise exception 'Current authority required';end if;
 select u into unit from jsonb_array_elements(authority.units) u where u->>'id'=p_result->>'unitId';
 endpoint:=unit->'endpoint';proposal:=p_result->'publication';h:=proposal->'p_health';
 if unit is null or unit->>'placement' is distinct from 'FIELD' or unit->'restricted' is distinct from 'false'::jsonb
 or unit->'identityVerified' is distinct from 'true'::jsonb or coalesce(unit->>'family','') not in ('Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V')
 or coalesce(endpoint->>'profile','') not in ('sniper','camv')
 or endpoint->>'deviceId' is null or endpoint->>'revision' is null
 or (select count(*) from jsonb_array_elements(authority.units) u where u->'endpoint'->>'deviceId'=endpoint->>'deviceId')<>1
 or proposal->>'p_device_id' is distinct from endpoint->>'deviceId' or proposal->>'p_revision' is distinct from endpoint->>'revision'
 or proposal->>'p_public_ip' is distinct from endpoint->>'ip' or proposal->'p_expected_ports' is distinct from endpoint->'ports'
 or proposal->>'p_monitoring_profile' is distinct from endpoint->>'profile' or proposal->>'p_source' is distinct from 'manual_tcp_check'
 then raise exception 'Current Field endpoint required';end if;
 select * into prior from cos_avigilon_checks_private.publications where run_id=run.id and unit_id=p_result->>'unitId';
 if found then
  if prior.request is distinct from p_result then raise exception 'Publication replay changed';end if;
  return prior.row_result;
 end if;
 if run.snapshot->>'state'<>'pending' then raise exception 'Pending lease required';end if;
 select r,n-1 into old_row,position from jsonb_array_elements(run.snapshot->'rows') with ordinality rows(r,n) where r->>'unitId'=p_result->>'unitId';
 observed:=(h->>'checked_at')::timestamptz;started:=(p_result->>'startedAt')::timestamptz;
 if old_row is null or old_row->>'outcome'<>'pending' or old_row->>'endpointRevision' is distinct from endpoint->>'revision'
 or observed is null or started is null or started<(run.snapshot->>'startedAt')::timestamptz or observed<started or observed>clock_timestamp() or observed>run.deadline_at
 or jsonb_typeof(h->'port_status') is distinct from 'object' or jsonb_typeof(endpoint->'ports') is distinct from 'array' or jsonb_array_length(endpoint->'ports') not between 1 and 32
 then raise exception 'Invalid publication observation';end if;
 if (select count(*) from jsonb_object_keys(h->'port_status'))<>jsonb_array_length(endpoint->'ports')
 or exists(select 1 from jsonb_array_elements_text(endpoint->'ports') port where (port::integer not between 1 and 65535) or jsonb_typeof(h->'port_status'->port->'online') is distinct from 'boolean')
 then raise exception 'Incomplete port observation';end if;
 select bool_or((value->>'online')::boolean) into responded from jsonb_each(h->'port_status');
 if h->'ip_reachable' is distinct from to_jsonb(responded) or h->>'overall_status' is distinct from (case when responded then 'online' else 'offline' end) then raise exception 'Inconsistent observation';end if;
 -- Count only committed outcomes for this admitted endpoint generation. Never
 -- accept a legacy/client failure counter or cross an endpoint change/reset.
 select health into prior_health from cos_avigilon_checks_private.publications
 where tenant_id=p_tenant and generation=authority.generation and device_id=endpoint->>'deviceId' order by receipt_id desc limit 1;
 if prior_health is not null and observed<=(prior_health->>'checked_at')::timestamptz then raise exception 'Observation is not newer';end if;
 failures:=case when responded then 0 else least(3,coalesce((prior_health->>'consecutive_failures')::integer,0)+1) end;
 h:=jsonb_build_object('checked_at',h->'checked_at','port_status',h->'port_status','ip_reachable',responded,
 'overall_status',case when responded then 'online' else 'offline' end,'consecutive_failures',failures,'confirmed_outage',failures>=3);
 receipt:=nextval('cos_avigilon_checks_private.publications_receipt_id_seq'::regclass);
 new_row:=old_row||jsonb_build_object('outcome',case when responded then 'online' else 'nonresponse' end,'reason',null,'startedAt',p_result->'startedAt','completedAt',h->'checked_at','confirmedOutage',failures>=3,'publicationReceipt',receipt::text);
 insert into cos_avigilon_checks_private.publications(receipt_id,tenant_id,run_id,unit_id,generation,device_id,request,row_result,health)
 overriding system value values(receipt,p_tenant,run.id,unit->>'id',authority.generation,endpoint->>'deviceId',p_result,new_row,h);
 update cos_avigilon_checks_private.runs set snapshot=jsonb_set(snapshot,array['rows',position::text],new_row) where id=run.id;
 return new_row;
end $$;
-- Complete current-generation projection. A pending/failed/new run suppresses
-- older success. Closed authority keeps managed device identities but no health.
create function cos_avigilon_checks_private.read_health(p_actor uuid,p_tenant uuid) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 if not exists(select 1 from cos_avigilon_checks_private.authority where tenant_id=p_tenant and units is not null) then raise exception 'Authority not installed';end if;
 select jsonb_build_object('contract','COS_AVIGILON_PUBLICATIONS_V1','tenantId',p_tenant,
 'authority',jsonb_build_object('contract','COS_AVIGILON_AUTHORITY_V1','tenantId',p_tenant,'generation',a.generation::text,'rosterRevision',a.roster_revision,'admitted',a.admitted),
 'roster',jsonb_build_object('tenantId',p_tenant,'revision',a.roster_revision,'units',a.units),
 'items',coalesce((select jsonb_agg(jsonb_build_object(
 'deviceId',m.device_id,'endpoint',u->'endpoint','placement',u->>'placement','restricted',u->'restricted',
 'receipt',case when a.admitted and r.roster_revision=a.roster_revision and r.authority_generation=a.generation and u->>'placement'='FIELD' and u->'restricted'='false'::jsonb and u->'identityVerified'='true'::jsonb then p.row_result else null end,
 'health',case when a.admitted and r.roster_revision=a.roster_revision and r.authority_generation=a.generation and u->>'placement'='FIELD' and u->'restricted'='false'::jsonb and u->'identityVerified'='true'::jsonb then p.health else null end
 )) from cos_avigilon_checks_private.managed_devices m
 left join lateral jsonb_array_elements(a.units) u on u->'endpoint'->>'deviceId'=m.device_id
 left join cos_avigilon_checks_private.heads heads on heads.tenant_id=a.tenant_id
 left join cos_avigilon_checks_private.runs r on r.id=heads.run_id
 left join cos_avigilon_checks_private.publications p on p.run_id=r.id and p.unit_id=u->>'id' and p.generation=a.generation
 where m.tenant_id=a.tenant_id),'[]'::jsonb)) into result
 from cos_avigilon_checks_private.authority a where a.tenant_id=p_tenant;
 return result;
end $$;
revoke all on all functions in schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
commit;
