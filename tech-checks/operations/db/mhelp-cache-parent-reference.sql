-- Change only the owned cache row validator. No table, data or ACL changes.
-- Parent references must contain ONLY their original serviceLocationId/portalId.
do $migration$
declare
 definition text:=pg_get_functiondef('public.cos_mhelp_inventory_cache(text,text,jsonb,timestamptz)'::regprocedure);
 old_predicate text:=$old$(kind='services' and item->'serviceLocationId' is not null and item->'serviceLocationId'<>'null'::jsonb and item->>'customerId' is distinct from owner_id)$old$;
 new_predicate text:=$new$(kind='services' and item->'serviceLocationId' is not null and item->'serviceLocationId'<>'null'::jsonb
     and ((item->>'serviceLocationId'=owner_id and item-array['serviceLocationId','portalId']<>'{}'::jsonb)
      or (item->>'serviceLocationId' is distinct from owner_id and item->>'customerId' is distinct from owner_id)))$new$;
begin
 if md5(definition)<>'9147de2d58b413a3c4fc490640a12604' then raise exception 'Unexpected inventory cache definition; inspect newer changes';end if;
 if (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate)<>1 then raise exception 'Inventory cache predicate anchor mismatch';end if;
 execute replace(definition,old_predicate,new_predicate);
end$migration$;

