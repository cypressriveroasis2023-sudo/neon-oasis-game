-- REVIEW ROLLBACK. First disable/remove only the new route. Preserve receipts
-- for uncertain-outcome reconciliation; never touch existing health/history.
begin;
revoke execute on function public.cos_product_tcp_stage_v2(text,text) from service_role;
revoke execute on function public.cos_product_tcp_accept_v2(text,text,text) from service_role;
revoke execute on function public.cos_product_tcp_read_v2(text,text) from service_role;
revoke execute on function public.cos_product_tcp_receipt_v2(text) from service_role;
revoke insert,update on cos_product_tcp_private.receipts from service_role;
-- Keep private tables and helper for forensic retention. Re-enabling is a new
-- reviewed activation, not automatic recreation of a schedule.
commit;
