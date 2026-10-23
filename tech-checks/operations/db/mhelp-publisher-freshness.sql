-- Install before the worker changes. No Sheet baselines, source observations,
-- credentials, operational data or permissions on existing objects are changed.
begin;
create table cos_sheets_placement_private.refresh_requests(
 equipment_id text primary key references cos_sheets_placement_private.bindings(equipment_id),
 requested_at timestamptz not null default clock_timestamp()
);
alter table cos_sheets_placement_private.refresh_requests enable row level security;
revoke all on cos_sheets_placement_private.refresh_requests from public,anon,authenticated,service_role;
-- Extend the existing leased finish transaction; retain its signature and ACL.
do $patch$
declare original text;next text;anchor text;
begin
 original:=pg_get_functiondef('public.cos_sheets_placement_finish(uuid,jsonb)'::regprocedure);
 if position('source_refresh_requested' in original)>0 then raise exception 'Refresh handoff already installed';end if;
 anchor:='''source_unverified'',''unsupported_sheet_cell''';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Publisher result guard changed';end if;
 next:=replace(original,anchor,'''source_unverified'',''source_refresh_requested'',''unsupported_sheet_cell''');
 anchor:=' insert into cos_sheets_placement_private.receipts';
 if (length(next)-length(replace(next,anchor,'')))/length(anchor)<>1 then raise exception 'Publisher finish changed';end if;
 next:=replace(next,anchor,$queue$
 if (select count(*) from jsonb_array_elements(p_results) x where x->>'reason'='source_refresh_requested')>60 then raise exception 'Refresh selection exceeds bound';end if;
 delete from cos_sheets_placement_private.refresh_requests;
 insert into cos_sheets_placement_private.refresh_requests(equipment_id)
 select target_binding.equipment_id from cos_sheets_placement_private.bindings target_binding join cos_mhelp_placement_private.links l using(equipment_id)
 join jsonb_array_elements(p_results) result on result->>'equipmentId'=target_binding.equipment_id
 where result->>'state'='held' and result->>'reason'='source_refresh_requested'
 and target_binding.pending_cells is null and l.observation->>'state'='confirmed'
 and cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id)=l.baseline_guard
 and not exists(select 1 from cos_operational_private.current_placements p where p.product_id=l.equipment_id);
$queue$||anchor);
 execute next;
end$patch$;
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
