-- READ-ONLY precheck for 20261111_router_reference_corrections.sql (camera project).
-- Writes nothing. Returns one JSON value. It covers schema compatibility and, per
-- candidate, only these guards: record identity, unchanged old address, no unit IP,
-- and new address not held elsewhere. It does NOT cover observation age, serial
-- uniqueness, payload completeness, replay or reversal rules; the functions enforce those. The candidate list is what was under
-- review on 2026-11-11; "wouldPass" is the guards' answer right now, not approval.
set statement_timeout='8s';
with want(c,t) as (values('id','bigint'),('unit_key','text'),('unit_ip','inet'),('router_public_ip','inet'),('reported_status','text'),
  ('reported_latency_ms','integer'),('status_source','text'),('status_observed_at','timestamp with time zone'),('current_status','text'),
  ('last_checked_at','timestamp with time zone'),('last_online_at','timestamp with time zone'),('updated_at','timestamp with time zone')),
have as (select a.attname c,format_type(a.atttypid,a.atttypmod) t from pg_attribute a
  where a.attrelid=to_regclass('public.camera_unit_routers') and a.attnum>0 and not a.attisdropped),
cand(router_id,unit_key,old_ip,new_ip) as (values
  (182::bigint,'SOLARSPOTTER 053','166.168.147.21'::inet,'38.246.194.11'::inet),
  (79,'SPOTTER 185','166.203.205.83','38.246.195.93'),
  (150,'SOLAR SPOTTER 019','166.203.204.28','166.203.205.83'),
  (14,'RANGER 024','166.203.204.120','38.246.195.69'))
select jsonb_build_object(
 'missingOrChangedColumns',coalesce((select jsonb_agg(w.c order by w.c) from want w left join have h on h.c=w.c and h.t=w.t where h.c is null),'[]'::jsonb),
 'rolesExist',(select count(*)=3 from pg_roles where rolname in('anon','authenticated','service_role')),
 'nothingToCreateAlreadyExists',to_regclass('public.camera_unit_router_corrections') is null
   and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in('camera_unit_router_correct_v1','camera_unit_router_revert_v1','camera_unit_router_corrections_immutable')),
 'routerTableTriggers',(select count(*) from pg_trigger where tgrelid=to_regclass('public.camera_unit_routers') and not tgisinternal),
 'currentStatusAllowsUnknown',exists(select 1 from pg_constraint where conrelid=to_regclass('public.camera_unit_routers')
   and conname='camera_unit_routers_current_status_check' and pg_get_constraintdef(oid) like '%unknown%'),
 'candidates',(select jsonb_agg(jsonb_build_object('routerId',c.router_id,'unitKey',c.unit_key,
   'recordIsTheOneReviewed',r.id is not null and r.unit_key=c.unit_key,
   'oldAddressUnchanged',r.router_public_ip is not distinct from c.old_ip,
   'noUnitIp',r.id is not null and r.unit_ip is null,
   'newAddressHeldBy',(select jsonb_agg(o.unit_key order by o.id) from public.camera_unit_routers o where o.id<>c.router_id and (o.router_public_ip=c.new_ip or o.unit_ip=c.new_ip)),
   'wouldPass',r.id is not null and r.unit_key=c.unit_key and r.router_public_ip is not distinct from c.old_ip and r.unit_ip is null
     and not exists(select 1 from public.camera_unit_routers o where o.id<>c.router_id and (o.router_public_ip=c.new_ip or o.unit_ip=c.new_ip))) order by c.router_id)
   from cand c left join public.camera_unit_routers r on r.id=c.router_id));
