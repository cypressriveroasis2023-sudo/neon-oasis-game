-- LOCAL REVIEW ONLY. Apply after receipt_protocol_v2.sql. Same existing service
-- principal and exact read semantics, no new public/client access. No writes.
begin;
create function public.cos_product_tcp_read_batch_v2(p_targets jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='2s' as $$
declare t jsonb; result jsonb := '[]'::jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 if jsonb_typeof(p_targets) is distinct from 'array' or octet_length(p_targets::text)>16384 then raise exception 'Invalid targets';end if;
 if jsonb_array_length(p_targets) not between 1 and 100 then raise exception 'Invalid targets';end if;
 if (select count(distinct value->>'productId') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets) then raise exception 'Duplicate targets';end if;
 for t in select value from jsonb_array_elements(p_targets) loop
  if jsonb_typeof(t) is distinct from 'object' or not(t ?& array['productId','authorityGuard'])
   or jsonb_typeof(t->'productId') is distinct from 'string' or jsonb_typeof(t->'authorityGuard') is distinct from 'string'
   or (select count(*) from jsonb_object_keys(t))<>2 or t->>'productId' !~ '^[1-9][0-9]{0,14}$'
   or t->>'authorityGuard' is null or t->>'authorityGuard' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid target';end if;
  -- Reuse the exact accepted/fresh/guard/local-config check under the same DB
  -- transaction. Its first SHARE lock persists through all members; no foreign
  -- device/config insertion can slip between subsequent local_current checks.
  result:=result||jsonb_build_array(jsonb_build_object('productId',t->>'productId','receipt',
   public.cos_product_tcp_read_v2(t->>'productId',t->>'authorityGuard')));
 end loop;
 return result;
end $$;
revoke all on function public.cos_product_tcp_read_batch_v2(jsonb) from public,anon,authenticated;
grant execute on function public.cos_product_tcp_read_batch_v2(jsonb) to service_role;
commit;
