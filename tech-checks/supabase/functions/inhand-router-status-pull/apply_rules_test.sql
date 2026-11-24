-- Run against a throwaway Postgres: psql -d <scratch db> -f apply_rules_test.sql  (expects "PASS" lines, exits non-zero on failure)
\set ON_ERROR_STOP on
do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.camera_unit_routers (id bigserial primary key, unit_key text, router_name text, router_model text, unit_ip inet, router_public_ip inet,
 reported_status text, status_source text, status_observed_at timestamptz, current_status text, last_online_at timestamptz, updated_at timestamptz, inhand_serial text, router_type text);
insert into camera_unit_routers (unit_key, router_model, unit_ip, reported_status, status_source, status_observed_at, current_status, inhand_serial, router_type) values
 ('SPOTTER 001','InHand IR300','1.2.3.4','offline','InHand live pull', now()-interval '3 days','online','RF3000001',null),
 ('SPOTTER 002','InHand IR300',null,'online','InHand portal export 2026-11-17', null,null,'rf3000002 ',null),
 ('SPOTTER 003','InHand IR300',null,'online','Held: stale InHand link, relink pending (Nov 18)', now()-interval '6 days',null,'RF3000003',null),
 ('SPOTTER 004','Mofi 4500V2',null,'online','InHand live pull', now()-interval '1 day',null,'RF3000004',null),
 ('SPOTTER 005','InHand IR300',null,'online','InHand live pull', now()+interval '30 seconds',null,'RF3000005',null),
 ('DUP A','InHand IR300',null,null,null,null,null,'RF3000006',null),
 ('DUP B','InHand IR300',null,null,null,null,null,'RF3000006',null);
\ir ../../../operations/db/20261124_inhand_router_status_pull.sql
-- rerun to prove it is safe to apply twice
\ir ../../../operations/db/20261124_inhand_router_status_pull.sql

set role service_role;
select public.cos_inhand_router_status_apply('[
 {"serial":"RF3000001","online":1},{"serial":"RF3000002","online":0},{"serial":"RF3000003","online":1},
 {"serial":"RF3000004","online":0},{"serial":"RF3000005","online":0},{"serial":"RF3000006","online":1},
 {"serial":"RF3999999","online":1},{"serial":"RF3000001x'';--","online":1},{"serial":"RF3000007","online":"2"}]'::jsonb, now()) as result \gset
reset role;
select :'result'::jsonb = '{"devices_seen":9,"updated":2,"unchanged":1,"unmatched":1,"ambiguous":1,"held_skipped":1,"brand_skipped":1,"bad_status":2}'::jsonb as counts_ok \gset
\if :counts_ok
\echo PASS counts
\else
\echo FAIL counts :result
\endif
select string_agg(unit_key||'='||coalesce(reported_status,'-')||'/'||coalesce(status_source,'-')||'/'||coalesce(current_status,'-')||'/'||coalesce(host(unit_ip),'-'), ' | ' order by id) rows from camera_unit_routers;
-- old reading never overwrites a newer one
set role service_role;
select (public.cos_inhand_router_status_apply('[{"serial":"RF3000001","online":0}]', now()-interval '5 minutes'))->>'unchanged' = '1' as older_ignored;
reset role;
-- time limits
do $$ begin perform public.cos_inhand_router_status_apply('[]', now()+interval '10 minutes'); raise exception 'future accepted'; exception when others then if sqlerrm like '%out of range%' then raise notice 'PASS future refused'; else raise; end if; end $$;
do $$ begin perform public.cos_inhand_router_status_apply('[]', now()-interval '1 hour'); raise exception 'stale accepted'; exception when others then if sqlerrm like '%out of range%' then raise notice 'PASS stale refused'; else raise; end if; end $$;
-- permissions
set role authenticated;
do $$ begin perform public.cos_inhand_oauth_get(); raise exception 'authenticated could read tokens'; exception when insufficient_privilege then raise notice 'PASS authenticated blocked'; end $$;
reset role; set role anon;
do $$ begin perform public.cos_inhand_router_status_apply('[]', now()); raise exception 'anon could write'; exception when insufficient_privilege then raise notice 'PASS anon blocked'; end $$;
do $$ begin perform 1 from inhand_private.oauth_state; raise exception 'anon read schema'; exception when insufficient_privilege then raise notice 'PASS schema private'; end $$;
reset role;
-- token cache keeps refresh token when a response omits it
set role service_role;
select public.cos_inhand_oauth_put('tok1', 3600, 'ref1'); select public.cos_inhand_oauth_put('tok2', 3600, null);
select refresh_token = 'ref1' and access_token='tok2' as refresh_kept from public.cos_inhand_oauth_get();
select public.cos_inhand_pull_failed('sign_in_rejected');
select count(*) filter (where ok) ok_runs, count(*) filter (where not ok) failed_runs from public.cos_inhand_pull_recent(10);
