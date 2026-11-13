-- CANDIDATE ONLY. Not installed. Preserves all authority checks and result ordering.
-- Materialize exact wanted Product links and their statement-current guards once.
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.authoritative_product_records(p_records jsonb, p_projection boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000
  or (select count(distinct r->>'productId') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records)
 then raise exception 'Unique current Product IDs required';end if;
 with binding_membership as materialized (
  select distinct x.r->>'productId' product_id, ids.kind, ids.binding_id
  from jsonb_array_elements(p_records) x(r)
  cross join lateral (values
   ('tracker',x.r->'binding'->>'trackerId'),('native',x.r->'binding'->>'nativeUnitId')
  ) ids(kind,binding_id)
  where ids.binding_id is not null
 ), wanted as materialized (
  select r,ord from jsonb_array_elements(p_records) with ordinality x(r,ord)
  where (r->'binding' is null or r->'binding'='null'::jsonb)
   and coalesce(r->>'holdReason','') in ('','api_equipment_label_changed',
    'Product ID identity label changed; confirm before linking',
    'Prior reviewed scoped identity or assignment requires Owner installation review',
    'Source assignment or protection changed; Owner installation review required')
   and r->>'lifecycle'='UNFLAGGED' and r->'apiAssignment'->'active' is distinct from 'false'::jsonb
   and r->'apiAssignment'->'placementProof'->>'version'='1'
   and r->>'unitNumber'=btrim(r->'apiAssignment'->>'fullLabel')
   and r->>'customerId'=r->'apiAssignment'->>'customerId'
   and r->'apiAssignment'->'placementProof'->'parentIsServiceLocation'='false'::jsonb
   and r->'apiAssignment'->'placementProof'->'parentActive' is distinct from 'false'::jsonb
   and ((r->>'placement'='SHOP' and lower(btrim(r->'apiAssignment'->'placementProof'->>'parentLabel')) in ('cameras onsite','cameras onsite llc'))
     or (r->>'placement'='FIELD' and r->'apiAssignment'->'placementProof'->'serviceVerified'='true'::jsonb
       and r->'apiAssignment'->'placementProof'->'serviceActive' is distinct from 'false'::jsonb
       and nullif(r->'apiAssignment'->'placementProof'->>'siteLabel','') is not null
       and coalesce(r->'apiAssignment'->>'serviceLocationId','')~'^[1-9][0-9]{0,14}$'))
 ), candidate_links as materialized (
  select l.*,cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) current_guard,
   case when exists(select 1 from wanted w where w.r->>'productId'=l.equipment_id and w.r->>'placement'='SHOP')
    then cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id) else false end current_shop_return
  from cos_mhelp_placement_private.links l
  where exists(select 1 from wanted w where w.r->>'productId'=l.equipment_id)
 ), original_batches as materialized (
  select b.* from cos_mhelp_placement_private.upload_batches b
  where b.receipt->>'contract'='COS_MHELP_UPLOAD_V1'
   and b.receipt->>'sourceSha256'=b.source_sha256
   and b.payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',b.receipt,'records',b.records)::text,'UTF8')),'hex')
 ), history as materialized (
  select h,w.r,l.tracker_id,l.native_unit_id,l.baseline_guard,l.source_revision,
   row_number() over(partition by h->>'productId' order by b.admitted_at desc,b.source_sha256) priority
  from original_batches b cross join lateral jsonb_array_elements(b.records) h
  join wanted w on w.r->>'productId'=h->>'productId'
  join candidate_links l on l.equipment_id=h->>'productId'
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=l.tracker_id
   and ((l.native_unit_id is null and s.entity_kind='tracker') or (s.entity_kind='equipment_unit' and s.native_unit_id=l.native_unit_id))
   and s.source_system='mhelpdesk_product_import'
   and ((s.active and s.source_revision=l.source_revision) or (w.r->>'placement'='SHOP' and l.current_shop_return))
  where h->'binding'->>'matchMethod'='reviewed_product_id'
   and h->'binding'->'reviewEvidence'->>'review_state' in ('confirmed','held')
   and l.reviewed_at is not null and l.authorization_sha256~'^[a-f0-9]{64}$'
   and h->'binding'->'reviewEvidence'->>'reviewed_product_id'=l.equipment_id
   and h->'binding'->>'productId'=l.equipment_id
   and h->'binding'->>'trackerId'=l.tracker_id::text
   and h->'binding'->>'nativeUnitId' is not distinct from l.native_unit_id::text
   and h->'binding'->>'trackerLabel'=l.tracker_label
   and h->'binding'->>'nativeLabel' is not distinct from l.native_label
   and lower(regexp_replace(h->>'category','[[:space:]]','','g'))=lower(regexp_replace(w.r->>'category','[[:space:]]','','g'))
   and w.r->'apiAssignment'->'placementProof'->'model'=coalesce(to_jsonb(l.model),'null'::jsonb)
   and (l.baseline_guard=l.current_guard or (w.r->>'placement'='SHOP' and l.current_shop_return))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>l.equipment_id
      and (other.tracker_id=l.tracker_id or other.native_unit_id=l.native_unit_id))
   and not exists(select 1 from binding_membership other where other.product_id<>l.equipment_id
      and ((other.kind='tracker' and other.binding_id=l.tracker_id::text)
        or (other.kind='native' and other.binding_id=l.native_unit_id::text)))
   and not exists(select 1 from jsonb_array_elements_text(coalesce(w.r->'possibleAliasUnitIds','[]'::jsonb)) alias
      where alias is distinct from l.tracker_id::text and alias is distinct from l.native_unit_id::text)
 ), repaired as materialized (
  select r->>'productId' product_id,(r-array['binding','holdReason','placementHeld','displayUnitNumber','displayAuthorizationSha256'])
   ||jsonb_build_object('holdReason',null,'possibleAliasUnitIds','[]'::jsonb,'binding',
    ((h->'binding')-'guardCurrent')||jsonb_build_object('fullLabel',r->>'unitNumber','expectedGuard',
      cos_mhelp_placement_private.upload_binding_guard(tracker_id,native_unit_id))
      ||case when p_projection then jsonb_build_object('guardCurrent',true) else '{}'::jsonb end) row
  from history where priority=1
 )
 select coalesce(jsonb_agg(coalesce(f.row,x.r) order by x.ord),'[]'::jsonb) into result
 from jsonb_array_elements(p_records) with ordinality x(r,ord) left join repaired f on f.product_id=x.r->>'productId';
 -- Restoring two lost bindings must not attach both Products to one resource.
 if exists(select 1 from jsonb_array_elements(result) r cross join lateral
    (values(r->'binding'->>'trackerId'),(r->'binding'->>'nativeUnitId')) ids(id)
    where id is not null group by id having count(distinct r->>'productId')>1)
 then raise exception 'Competing exact Product ID bindings';end if;
 return result;
end $function$
