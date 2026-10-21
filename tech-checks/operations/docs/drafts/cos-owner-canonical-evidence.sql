-- Restore only private proof omitted by the API's public snapshot projection.
-- The historical binding must agree in every identity/evidence field. Guards
-- and assignment references belong to the current binding and are never copied.
create function cos_mhelp_placement_private.recover_identity_evidence_records(p_records jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb; b jsonb; wanted jsonb:='[]'; bindings jsonb:='{}';
 matches jsonb; matched jsonb; provenance jsonb; recovered jsonb:='[]';
begin
 if jsonb_typeof(p_records) is distinct from 'array'
  or jsonb_array_length(p_records)>10000
  or (select count(distinct x->>'productId') from jsonb_array_elements(p_records) x)<>jsonb_array_length(p_records) then
  raise exception 'Unique canonical evidence Product IDs are required' using errcode='PT409';
 end if;
 for r in select value from jsonb_array_elements(p_records) loop
  b:=r->'binding';
  if b is null or b='null'::jsonb or b->>'matchMethod'='reviewed_product_id'
   or jsonb_typeof(b->'reviewEvidence')='object' then
   bindings:=bindings||jsonb_build_object(r->>'productId',jsonb_build_object('binding',coalesce(b,'null'::jsonb),'provenance',null));
  else
   if jsonb_typeof(b) is distinct from 'object' or b ? 'reviewEvidence'
    or b->>'matchMethod' not in ('exact_family_unit','archived_alias','owner_confirmed_alias')
    or coalesce(b->>'canonicalKey','')='' or b->>'productId' is distinct from r->>'productId'
    or b->>'fullLabel' is distinct from r->>'unitNumber' then
    raise exception 'Canonical identity evidence cannot be recovered from this binding' using errcode='PT409';
   end if;
   wanted:=wanted||jsonb_build_array(r);
  end if;
 end loop;
 if jsonb_array_length(wanted)=0 then return jsonb_build_object('bindings',bindings,'provenance',recovered);end if;
 -- Verify each historical payload once per request, not once per equipment row.
 with history as materialized (
  select batch.source_sha256,batch.payload_sha256,batch.records,
   (batch.receipt->>'sourceSha256'=batch.source_sha256
    and case when coalesce(batch.receipt->>'recordCount','')~'^[1-9][0-9]{0,4}$'
     then (batch.receipt->>'recordCount')::integer=jsonb_array_length(batch.records) else false end
    and batch.payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',batch.receipt,'records',batch.records)::text,'UTF8')),'hex')
    and (select count(distinct x->>'productId') from jsonb_array_elements(batch.records) x)=jsonb_array_length(batch.records)) valid
  from cos_mhelp_placement_private.upload_batches batch
  where batch.receipt->>'contract'='COS_MHELP_UPLOAD_V1' and batch.receipt->>'reviewed'='true'
 ), candidates as (
  select w->>'productId' product_id,history.source_sha256,history.payload_sha256,history.valid,h,
   h->'binding'->'reviewEvidence' evidence
  from history,lateral jsonb_array_elements(history.records) h,jsonb_array_elements(wanted) w
  where h->>'productId'=w->>'productId' and h->>'unitNumber'=w->>'unitNumber'
   and jsonb_typeof(h->'binding'->'reviewEvidence')='object'
   and ((h->'binding')-array['reviewEvidence','expectedGuard','previousAssignment','guardCurrent'])
    =((w->'binding')-array['reviewEvidence','expectedGuard','previousAssignment','guardCurrent'])
 ), grouped as (
  select product_id,count(distinct evidence) proof_count,count(*) row_count,
   count(distinct source_sha256) source_count,bool_and(coalesce(valid,false)) valid,
   jsonb_agg(evidence order by source_sha256)->0 proof,
   jsonb_agg(jsonb_build_object('sourceSha256',source_sha256,'payloadSha256',payload_sha256,
    'recordSha256',encode(sha256(convert_to(h::text,'UTF8')),'hex'),
    'proofSha256',encode(sha256(convert_to(evidence::text,'UTF8')),'hex')) order by source_sha256) sources
  from candidates group by product_id
 )
 select coalesce(jsonb_object_agg(product_id,to_jsonb(grouped)),'{}'::jsonb) into matches from grouped;
 for r in select value from jsonb_array_elements(wanted) loop
  matched:=matches->(r->>'productId');
  if matched is null or matched->>'proof_count'<>'1' or matched->>'row_count'<>matched->>'source_count'
   or matched->>'valid' is distinct from 'true' then
   raise exception 'Unique previously reviewed canonical identity evidence is required' using errcode='PT409';
  end if;
  provenance:=jsonb_build_object('contract','COS_CANONICAL_IDENTITY_EVIDENCE_RECOVERY_V1',
   'productId',r->>'productId','sources',matched->'sources');
  bindings:=bindings||jsonb_build_object(r->>'productId',jsonb_build_object(
   'binding',r->'binding'||jsonb_build_object('reviewEvidence',matched->'proof'),'provenance',provenance));
  recovered:=recovered||jsonb_build_array(provenance);
 end loop;
 return jsonb_build_object('bindings',bindings,'provenance',recovered);
end $$;
revoke all on function cos_mhelp_placement_private.recover_identity_evidence_records(jsonb) from public,anon,authenticated,service_role;

create function cos_mhelp_placement_private.recover_identity_evidence(p_record jsonb)
returns jsonb language sql stable set search_path='' as $$
 select cos_mhelp_placement_private.recover_identity_evidence_records(jsonb_build_array(p_record))->'bindings'->(p_record->>'productId')
$$;
revoke all on function cos_mhelp_placement_private.recover_identity_evidence(jsonb) from public,anon,authenticated,service_role;
