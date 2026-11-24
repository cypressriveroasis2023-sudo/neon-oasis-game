-- REVIEW ONLY. Restores exact pre-install RPC definitions; retains all audit and
-- reviewed cell baselines. Does not revert any Sheet values or source records.
begin;
set local lock_timeout='2s';
do $$declare r record;begin
 perform 1 from cos_sheets_placement_private.control where singleton for update;
 if exists(select 1 from cos_sheets_placement_private.control where enabled or lease_until>clock_timestamp())
 or exists(select 1 from cos_sheets_placement_private.bindings where pending_cells is not null)
 or exists(select 1 from cos_sheets_placement_private.field_bindings where pending is not null) then raise exception 'Quiescent disabled publisher required';end if;
 for r in select * from cos_sheets_placement_private.field_function_backup loop
  if pg_get_functiondef(r.signature::regprocedure) is distinct from r.installed_definition then raise exception 'Publisher changed since install: %',r.signature;end if;
  execute r.definition;
 end loop;
end$$;
commit;
