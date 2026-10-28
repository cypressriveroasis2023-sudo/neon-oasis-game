-- Disable native/legacy extension first. Preserve all receipts and original RPCs.
begin;
revoke execute on function public.cos_product_tcp_read_batch_v2(jsonb) from service_role;
commit;
