-- Review candidate: private read-only evidence, no source/native writes.
create or replace function cos_mhelp_placement_private.shop_address_baseline(p_base text)
returns jsonb language plpgsql stable set search_path='' as $$
declare base cos_mhelp_placement_private.upload_batches; history cos_mhelp_placement_private.upload_batches;
begin
 select * into base from cos_mhelp_placement_private.upload_batches where source_sha256=p_base;
 if not found or base.receipt->>'contract' is distinct from 'COS_MHELP_API_V1'
  or base.receipt->>'reviewed' is distinct from 'true' or base.receipt->>'complete' is distinct from 'true'
  or base.receipt->>'origin' is distinct from 'mhelpdesk_api' or base.receipt->>'portalId' is distinct from '224643'
  or (base.receipt->>'recordCount')::integer is distinct from jsonb_array_length(base.records) then return null;end if;
 -- Never search backwards past a conflicting/latest CSV to find a convenient match.
 select * into history from cos_mhelp_placement_private.upload_batches
 where admitted_at<base.admitted_at and receipt->>'contract'='COS_MHELP_UPLOAD_V1'
 order by admitted_at desc,source_sha256 desc limit 1;
 if not found or history.receipt->>'reviewed' is distinct from 'true'
  or history.receipt->>'sourceSha256' is distinct from history.source_sha256
  or (history.receipt->>'recordCount')::integer is distinct from jsonb_array_length(history.records)
  or history.payload_sha256 is distinct from encode(sha256(convert_to(
    jsonb_build_object('receipt',history.receipt,'records',history.records)::text,'UTF8')),'hex')
  or (select count(distinct r->>'productId') from jsonb_array_elements(history.records) r)<>jsonb_array_length(history.records)
 then return null;end if;
 return jsonb_build_object('contract','COS_REVIEWED_SHOP_ADDRESS_BASELINE_V1','baseSourceSha256',p_base,
  'sourceSha256',history.source_sha256,'payloadSha256',history.payload_sha256,
  'records',(select coalesce(jsonb_agg(jsonb_build_object('productId',r->>'productId','unitNumber',r->>'unitNumber',
   'category',r->>'category','customerId',r->>'customerId','customer',r->>'customer','placement',r->>'placement',
   'lifecycle',r->>'lifecycle','sourceAddress',r->'sourceAddress')),'[]'::jsonb)
   from jsonb_array_elements(history.records) r where r->>'placement'='SHOP'));
end $$;
revoke all on function cos_mhelp_placement_private.shop_address_baseline(text) from public,anon,authenticated,service_role;
