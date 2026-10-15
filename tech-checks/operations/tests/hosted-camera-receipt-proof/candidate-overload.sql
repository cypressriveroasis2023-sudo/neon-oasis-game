-- PRIVATE OFFLINE PROTOTYPE ONLY. No production authorization is implied.
-- New overload is new persistent RPC exposure despite retaining the route name.
-- Must obtain explicit ACL/exposure approval before any deployment.
begin;
set local lock_timeout='2s';
DO $guard$ BEGIN
 IF to_regprocedure('public.cos_mhelp_placement_snapshot(uuid,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'Prototype overload already exists' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure AND proowner::regrole::text='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND prosecdef AND proconfig=ARRAY['search_path=""'] AND pronargdefaults=0) THEN RAISE EXCEPTION 'Full snapshot ACL or metadata changed' USING ERRCODE='55000'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure),'UTF8')),'hex') <> '95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9' THEN RAISE EXCEPTION 'Full snapshot changed' USING ERRCODE='55000'; END IF;
END $guard$;
CREATE FUNCTION public.cos_mhelp_placement_snapshot(p_actor_user_id uuid, p_organization_id uuid, p_projection text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 if p_projection is distinct from 'camera' then raise exception 'Unsupported placement projection' using errcode='22023';end if;
 with checked_links as materialized (
  select l.*,cos_mhelp_placement_private.guard(tracker_id,native_unit_id) current_guard
  from cos_mhelp_placement_private.links l
 )
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'guardCurrent',current_guard=baseline_guard,
  'state',case when observation->>'state'='confirmed' and current_guard=baseline_guard then 'confirmed' else 'held' end,
  'reason',observation->>'reason','placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'assignmentChanged',(baseline_customer_id is not null and observation->>'customerId' is not null and observation->>'customerId'<>baseline_customer_id) or (baseline_location_id is not null and observation->>'serviceLocationId' is not null and observation->>'serviceLocationId'<>baseline_location_id),
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from checked_links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items);
end $function$
;
alter function public.cos_mhelp_placement_snapshot(uuid,uuid,text) owner to postgres;
revoke all on function public.cos_mhelp_placement_snapshot(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.cos_mhelp_placement_snapshot(uuid,uuid,text) to service_role;
DO $post$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure AND proowner::regrole::text='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND prosecdef AND proconfig=ARRAY['search_path=""'] AND pronargdefaults=0) OR encode(sha256(convert_to(pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure),'UTF8')),'hex') <> 'c14b0f888d51cbeb6f322cd80df3317caafc16357812c4ee676e4111b36660dd' THEN RAISE EXCEPTION 'Camera projection ACL or definition mismatch' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure AND proowner::regrole::text='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND prosecdef AND proconfig=ARRAY['search_path=""'] AND pronargdefaults=0) OR encode(sha256(convert_to(pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure),'UTF8')),'hex') <> '95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9' THEN RAISE EXCEPTION 'Full snapshot changed during install' USING ERRCODE='55000'; END IF;
END $post$;
commit;
