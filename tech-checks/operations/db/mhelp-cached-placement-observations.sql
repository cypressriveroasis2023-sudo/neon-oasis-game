-- Preserve the current installed single-reader function, adding only resource-age
-- guards and truthful cache observation metadata. No source/identity writes.
begin;
create function cos_mhelp_placement_private.resource_observed_at(v jsonb) returns timestamptz
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then return null;end if;
 return (v#>>'{}')::timestamptz;
exception when others then return null;
end$$;
revoke all on function cos_mhelp_placement_private.resource_observed_at(jsonb) from public,anon,authenticated,service_role;
do $patch$
declare original text;next text;anchor text;addition text;
begin
 original:=pg_get_functiondef('public.cos_mhelp_placement_from_inventory()'::regprocedure);
 if position('inventory_resource_stale' in original)>0 then raise exception 'Resource observation guard already installed';end if;
 anchor:='  else null end;';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'Single-reader guard changed; review current function';end if;
 addition:=$guard$  when exists(select 1 from jsonb_array_elements(b.records) x
   cross join lateral (values ('apiCustomerObservedAt'),('apiCategoryObservedAt'),('apiAddressObservedAt')) keys(k)
   where x->'sourceDates' ? keys.k and x->'sourceDates'->keys.k<>'null'::jsonb
    and (cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k) is null
     or cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k)<clock_timestamp()-interval '3 hours'
     or cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k)>clock_timestamp()+interval '30 seconds')) then 'inventory_resource_stale'
$guard$;
 next:=replace(original,anchor,addition||anchor);
 anchor:='update cos_mhelp_placement_private.links set observed_at=ctl.last_success_at';
 if position(anchor in next)=0 then raise exception 'Single-reader observation changed; review current function';end if;
 next:=replace(next,anchor,$observe$update cos_mhelp_placement_private.links cached_link set observed_at=least(ctl.last_success_at,
   cos_mhelp_placement_private.resource_observed_at(rows_by_id->cached_link.equipment_id->'sourceDates'->'apiCustomerObservedAt'),
   cos_mhelp_placement_private.resource_observed_at(rows_by_id->cached_link.equipment_id->'sourceDates'->'apiAddressObservedAt'))$observe$);
 anchor:='''locationSource'',''mhelp_product_address_worker''';
 if position(anchor in next)=0 then raise exception 'Single-reader receipt changed; review current function';end if;
 next:=replace(next,anchor,$receipt$'resourceObservedAt',(select min(cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k))
   from jsonb_array_elements(b.records) x cross join lateral(values('apiCustomerObservedAt'),('apiAddressObservedAt'),('apiCategoryObservedAt')) keys(k)),
  'locationSource','mhelp_product_address_worker'$receipt$);
 execute next;
end$patch$;
commit;
