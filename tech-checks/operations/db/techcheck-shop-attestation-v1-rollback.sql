-- HELD rollback for native project tughscoxralhofrckvxy. Specific production
-- approval is required. No data, actors, existing RPCs, keys or holds change.
begin;
revoke execute on function public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb) from service_role;
notify pgrst,'reload schema';
commit;
