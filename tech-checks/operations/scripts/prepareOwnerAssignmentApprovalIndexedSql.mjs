import {createHash} from 'node:crypto';
export const approvalSignature='public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text)';
export const approvalBaselineSha256='21cb8f20495b403c997aec9d875d2457af0b2686bca8037f652b09ea676a8e11';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Approval source anchor changed');return s.replace(a,b);};
const index=(target,array,key)=>`select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into ${target} from (
    select value->>'${key}' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(${array}) with ordinality e(value,ord)
    where value->>'${key}' is not null group by value->>'${key}'
   ) grouped;`;
/** Only request-local lookups change. Retain ordered duplicate groups, STRICT
 * prior-row checks, lazy evaluation, every validator, lock and approval guard. */
export function prepareOwnerAssignmentApprovalIndexedSql(installed){
 if(createHash('sha256').update(installed).digest('hex')!==approvalBaselineSha256)throw Error('Exact reviewed approval definition required');
 let s=once(installed,"identity_evidence jsonb; adjusted jsonb:='[]';", "items_index jsonb; prior_index jsonb; tracker_index jsonb; adjusted_rows jsonb[]:=array[]::jsonb[]; tracker_rows jsonb[]:=array[]::jsonb[];\n identity_evidence jsonb; adjusted jsonb:='[]';");
 s=once(s,"  select value into item from jsonb_array_elements(view->'items') where value->>'productId'=row_data->>'productId';",`  if items_index is null then
   ${index('items_index',"view->'items'",'productId')}
  end if;
  item:=items_index->(row_data->>'productId')->0;`);
 s=once(s,"   select value into strict old from jsonb_array_elements(prior) where value->>'productId'=row_data->>'productId';",`   if prior_index is null then
    ${index('prior_index','prior','productId')}
   end if;
   select value into strict old from jsonb_array_elements(coalesce(prior_index->(row_data->>'productId'),'[]'::jsonb));`);
 s=once(s,"  select value into item from jsonb_array_elements(view->'items') where value->>'productId'=row_data->>'matchedProductId';",`  if items_index is null then
   ${index('items_index',"view->'items'",'productId')}
  end if;
  item:=items_index->(row_data->>'matchedProductId')->0;`);
 s=once(s,"   select value into old from jsonb_array_elements(prior_receipt->'trackerRecords') where value->>'matchedProductId'=item->>'productId';",`   if tracker_index is null then
    ${index('tracker_index',"prior_receipt->'trackerRecords'",'matchedProductId')}
   end if;
   old:=tracker_index->(item->>'productId')->0;`);
 s=once(s,'  adjusted:=adjusted||jsonb_build_array(row_data);','  adjusted_rows:=array_append(adjusted_rows,row_data);');
 s=once(s,'  trackers:=trackers||jsonb_build_array(row_data);','  tracker_rows:=array_append(tracker_rows,row_data);');
 s=once(s," approval:=jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_APPROVAL_V1'", " adjusted:=to_jsonb(adjusted_rows);trackers:=to_jsonb(tracker_rows);\n approval:=jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_APPROVAL_V1'");
 return `begin;
set local lock_timeout='5s';
do $approval_guard$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='${approvalSignature}'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>'${approvalBaselineSha256}' then raise exception 'Installed assignment approval changed; fresh review required';end if;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']::text[] then raise exception 'Assignment approval permissions or configuration changed';end if;
end $approval_guard$;
${s.trim()};
commit;
`;
}
