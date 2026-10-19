-- Existing server role only. This read never changes the accepted source.
begin;
create function public.cos_mhelp_inventory_baseline() returns jsonb
language sql stable security definer set search_path='' as $$
 select cos_mhelp_placement_private.upload_snapshot()
$$;
revoke all on function public.cos_mhelp_inventory_baseline() from public,anon,authenticated;
grant execute on function public.cos_mhelp_inventory_baseline() to service_role;
commit;
