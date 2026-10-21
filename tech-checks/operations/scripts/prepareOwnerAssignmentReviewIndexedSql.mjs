import {createHash} from 'node:crypto';

export const assignmentReviewSignature='cos_mhelp_placement_private.assignment_review(uuid)';
export const reviewedAssignmentReviewSha256='dd6e404d28c23fc4afdb20335f4b60bd8f7c44f26084c1e2a2342f0083339f9b';
const hash=value=>createHash('sha256').update(value).digest('hex');
const once=(source,anchor,replacement)=>{
 if(source.split(anchor).length!==2)throw Error('Reviewed assignment review anchor changed');
 return source.replace(anchor,replacement);
};

/** Index immutable-in-this-call JSON arrays without caching current evidence.
 * Keep ordered row groups, including duplicate rows, so first-match selection
 * and the exact continuity uniqueness check retain their previous semantics. */
export function prepareOwnerAssignmentReviewIndexedSql(installed){
 if(typeof installed!=='string'||hash(installed)!==reviewedAssignmentReviewSha256)
  throw Error('Exact reviewed assignment review definition required');
 let changed=once(installed,'snapshot jsonb; items jsonb:=\'[]\'; item jsonb; why text; digest text; revision bigint; scoped jsonb;',
  `snapshot jsonb; items jsonb:='[]'; item jsonb; why text; digest text; revision bigint; scoped jsonb;
 scoped_index jsonb; continuity_index jsonb; tracker_products jsonb; native_products jsonb;`);
 changed=once(changed,' for r in select value from jsonb_array_elements(s.records) order by value->>\'productId\' loop\n  select value into old from jsonb_array_elements(scoped) where value->>\'productId\'=r->>\'productId\';',
  ` for r in select value from jsonb_array_elements(s.records) order by value->>'productId' loop
  -- Request-local indexes retain all rows; no source guard or identity is refreshed.
  if scoped_index is null then
   select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into scoped_index from (
    select value->>'productId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(scoped) with ordinality e(value,ord)
    where value->>'productId' is not null group by value->>'productId'
   ) grouped;
  end if;
  old:=scoped_index->(r->>'productId')->0;`);
 changed=once(changed,`  select value into snapshot from jsonb_array_elements(coalesce(s.receipt->'assignmentContinuity'->'items','[]'::jsonb))
   where value->>'productId'=r->>'productId';`,
  `  if continuity_index is null then
   select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into continuity_index from (
    select value->>'productId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(coalesce(s.receipt->'assignmentContinuity'->'items','[]'::jsonb)) with ordinality e(value,ord)
    where value->>'productId' is not null group by value->>'productId'
   ) grouped;
  end if;
  snapshot:=continuity_index->(r->>'productId')->0;`);
 changed=once(changed,`(select count(*) from jsonb_array_elements(s.receipt->'assignmentContinuity'->'items') x where x->>'productId'=r->>'productId')<>1`,
  `coalesce(jsonb_array_length(continuity_index->(r->>'productId')),0)<>1`);
 changed=once(changed,`  guard:=snapshot->>'protectedStateSha256';`,
  `  guard:=snapshot->>'protectedStateSha256';
  if tracker_products is null and jsonb_typeof(original)='array' then
   select coalesce(jsonb_object_agg(k,products),'{}'::jsonb) into tracker_products from (
    select x->'binding'->>'trackerId' k,jsonb_agg(x->>'productId') products
    from jsonb_array_elements(original) x
    where x->>'productId' is not null and x->'binding'->>'trackerId' is not null
    group by x->'binding'->>'trackerId'
   ) grouped;
   select coalesce(jsonb_object_agg(k,products),'{}'::jsonb) into native_products from (
    select x->'binding'->>'nativeUnitId' k,jsonb_agg(x->>'productId') products
    from jsonb_array_elements(original) x
    where x->>'productId' is not null and x->'binding'->>'nativeUnitId' is not null
    group by x->'binding'->>'nativeUnitId'
   ) grouped;
  end if;`);
 changed=once(changed,`   or exists(select 1 from jsonb_array_elements(original) x where x->>'productId'<>r->>'productId' and
      ((b->>'trackerId' is not null and x->'binding'->>'trackerId'=b->>'trackerId') or (b->>'nativeUnitId' is not null and x->'binding'->>'nativeUnitId'=b->>'nativeUnitId')))`,
  `   or (case when jsonb_typeof(original)='array' then
      exists(select 1 from jsonb_array_elements_text(coalesce(tracker_products->(b->>'trackerId'),'[]'::jsonb)) x where x.value<>r->>'productId')
      or exists(select 1 from jsonb_array_elements_text(coalesce(native_products->(b->>'nativeUnitId'),'[]'::jsonb)) x where x.value<>r->>'productId')
     else exists(select 1 from jsonb_array_elements(original) x where x->>'productId'<>r->>'productId' and
      ((b->>'trackerId' is not null and x->'binding'->>'trackerId'=b->>'trackerId') or (b->>'nativeUnitId' is not null and x->'binding'->>'nativeUnitId'=b->>'nativeUnitId')))
     end)`);
 return `begin;
set local lock_timeout='5s';
do $cos_assignment_index_guard$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='${assignmentReviewSignature}'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>'${reviewedAssignmentReviewSha256}' then
  raise exception 'Installed assignment review changed; fresh review required';
 end if;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] then
  raise exception 'Installed assignment review permissions or configuration changed';
 end if;
end $cos_assignment_index_guard$;
${changed.trim().replace(/;?$/,';')}
commit;
`;
}
