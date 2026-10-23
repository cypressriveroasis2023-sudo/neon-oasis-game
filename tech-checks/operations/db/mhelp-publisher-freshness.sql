-- Install before the worker changes. No Sheet baselines, source observations,
-- credentials, operational data or permissions on existing objects are changed.
begin;
create table cos_sheets_placement_private.refresh_requests(
 equipment_id text primary key references cos_sheets_placement_private.bindings(equipment_id),
 requested_at timestamptz not null default clock_timestamp()
);
alter table cos_sheets_placement_private.refresh_requests enable row level security;
revoke all on cos_sheets_placement_private.refresh_requests from public,anon,authenticated,service_role;
create function public.cos_sheets_placement_request_refresh(p_lease_id uuid,p_equipment_ids jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare ctl cos_sheets_placement_private.control;ids text[];
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 select * into strict ctl from cos_sheets_placement_private.control where singleton for update;
 if not ctl.enabled or ctl.lease_id is distinct from p_lease_id or p_lease_id is null or ctl.lease_until<=clock_timestamp() then return jsonb_build_object('accepted',false);end if;
 if jsonb_typeof(p_equipment_ids) is distinct from 'array' or jsonb_array_length(p_equipment_ids)>60
 or exists(select 1 from jsonb_array_elements(p_equipment_ids) x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~'^[1-9][0-9]{0,14}$') then raise exception 'Invalid refresh selection';end if;
 select coalesce(array_agg(x),'{}'::text[]) into ids from jsonb_array_elements_text(p_equipment_ids) x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate refresh selection';end if;
 -- Replace only this single publisher's advisory queue. It grants no write right.
 delete from cos_sheets_placement_private.refresh_requests;
 insert into cos_sheets_placement_private.refresh_requests(equipment_id)
 select b.equipment_id from cos_sheets_placement_private.bindings b join cos_mhelp_placement_private.links l using(equipment_id)
 where b.equipment_id=any(ids) and b.pending_cells is null and l.observation->>'state'='confirmed'
 and cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id)=l.baseline_guard
 and not exists(select 1 from cos_operational_private.current_placements p where p.product_id=l.equipment_id);
 return jsonb_build_object('accepted',true);
end$$;
revoke all on function public.cos_sheets_placement_request_refresh(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_sheets_placement_request_refresh(uuid,jsonb) to service_role;
create or replace function public.cos_mhelp_inventory_baseline()
returns jsonb language sql stable security definer set search_path='' as $$
 select cos_mhelp_placement_private.upload_snapshot()||jsonb_build_object('publisherRefreshEquipmentIds',(
 select coalesce(jsonb_agg(equipment_id),'[]'::jsonb) from (
 select q.equipment_id from cos_sheets_placement_private.refresh_requests q
 join cos_sheets_placement_private.bindings b using(equipment_id)
 join cos_mhelp_placement_private.links l using(equipment_id)
 where q.requested_at>clock_timestamp()-interval '2 hours' and b.pending_cells is null
 and l.observation->>'state'='confirmed'
 and cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id)=l.baseline_guard
 and not exists(select 1 from cos_operational_private.current_placements p where p.product_id=l.equipment_id)
 order by l.observed_at nulls first,q.equipment_id limit 6
 ) selected));
$$;
notify pgrst,'reload schema';
commit;
