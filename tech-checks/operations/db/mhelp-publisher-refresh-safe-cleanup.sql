-- Restore the bounded handoff after the publisher rollback. The queue and
-- baseline extension must already exist; no Sheet baselines or source clocks change.
begin;
do $preflight$ begin
 if to_regclass('cos_sheets_placement_private.refresh_requests') is null then raise exception 'Refresh queue missing';end if;
end $preflight$;
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
 delete from cos_sheets_placement_private.refresh_requests where equipment_id=any(seen);
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
notify pgrst,'reload schema';
commit;
