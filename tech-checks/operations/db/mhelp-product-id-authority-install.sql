DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.cos_mhelp_live_inventory_session(text,jsonb)'::regprocedure))<>'f135b14b4b7ee98324b8e80e7c5105ab'
 OR md5(pg_get_functiondef('cos_mhelp_placement_private.api_base_upload_snapshot()'::regprocedure))<>'af09c60f4f1086e1dd31e10b489716f7'
 THEN RAISE EXCEPTION 'mHelp authority definition drift';END IF;
END $guard$;
-- Owner direction: mHelp supplies current labels and assignments. An already
-- reviewed exact Product ID survives label/assignment changes; names are not keys.
-- Restore only original reviewed links whose protected native graph is unchanged.
-- Owner direction: mHelp supplies current labels and assignments. An already
-- reviewed exact Product ID survives label/assignment changes; names are not keys.
-- Restore only original reviewed links whose protected native graph is unchanged.
-- Owner direction: mHelp supplies current labels and assignments. An already
-- reviewed exact Product ID survives label/assignment changes; names are not keys.
-- Restore only original reviewed links whose protected native graph is unchanged.
-- A real, recorded Shop return must not require reactivating its old Field
-- geocoding source or erasing its placement history.
create function cos_mhelp_placement_private.recorded_shop_return_current(p_product text,p_tracker uuid,p_native uuid)
returns boolean language sql stable set search_path='' as $function$
 select coalesce(exists(
  select 1 from cos_mhelp_placement_private.links l
  join public.equipment_units u on u.id=l.native_unit_id and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  join app_private.vision_tracker_locations t on t.id=l.tracker_id and t.organization_id=u.organization_id
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=t.id and s.native_unit_id=u.id
   and s.organization_id=u.organization_id and s.entity_kind='equipment_unit' and s.source_system='mhelpdesk_product_import'
  cross join lateral(select m.* from app_private.cos_fleet_shop_moves m where m.unit_id=u.id and m.organization_id=u.organization_id order by m.created_at desc,m.id desc limit 1) m
  where l.equipment_id=p_product and l.tracker_id=p_tracker and l.native_unit_id=p_native
   and l.reviewed_at is not null and l.authorization_sha256~'^[a-f0-9]{64}$'
   and u.unit_number=l.native_label and t.unit_number=l.tracker_label
   and u.current_location_type='shop' and u.status='available' and u.retired_at is null
   and u.installed_site_id is null and u.current_location_ref is null
   and u.gps_latitude is null and u.gps_longitude is null
   and not s.active and s.eligibility='tombstone'
   and m.unit_number=u.unit_number and m.model_id=u.model_id
   and exists(select 1 from jsonb_array_elements(m.source_bindings) b where b->>'productId'=p_product and b->>'sourceUnitNumber'=btrim(l.full_label))
   and exists(select 1 from app_private.cos_geocode_source_events e where e.event_id=s.event_id and e.kind='tombstone' and e.product_id=p_product and e.native_unit_id=u.id and e.source_revision=s.source_revision)
   and not exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=u.id)
   and not exists(select 1 from app_private.cos_archived_representations a where t.id in(a.archived_tracker_id,a.canonical_tracker_id) or u.id in(a.archived_native_id,a.canonical_native_id))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>p_product and (other.tracker_id=t.id or other.native_unit_id=u.id))
 ),false)
$function$;
revoke all on function cos_mhelp_placement_private.recorded_shop_return_current(text,uuid,uuid) from public,anon,authenticated,service_role;

-- Owner direction: mHelp supplies current labels and assignments. An already
-- reviewed exact Product ID survives label/assignment changes; names are not keys.
-- Restore only original reviewed links whose protected native graph is unchanged.
create function cos_mhelp_placement_private.authoritative_product_records(p_records jsonb,p_projection boolean default false)
returns jsonb language plpgsql stable set search_path='' as $function$
declare result jsonb;
begin
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000
  or (select count(distinct r->>'productId') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records)
 then raise exception 'Unique current Product IDs required';end if;
 with wanted as materialized (
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
  join cos_mhelp_placement_private.links l on l.equipment_id=h->>'productId'
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=l.tracker_id
   and ((l.native_unit_id is null and s.entity_kind='tracker') or (s.entity_kind='equipment_unit' and s.native_unit_id=l.native_unit_id))
   and s.source_system='mhelpdesk_product_import'
   and ((s.active and s.source_revision=l.source_revision) or (w.r->>'placement'='SHOP' and cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id)))
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
   and (l.baseline_guard=cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) or (w.r->>'placement'='SHOP' and cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id)))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>l.equipment_id
      and (other.tracker_id=l.tracker_id or other.native_unit_id=l.native_unit_id))
   and not exists(select 1 from jsonb_array_elements(p_records) other where other->>'productId'<>l.equipment_id
      and (other->'binding'->>'trackerId'=l.tracker_id::text or other->'binding'->>'nativeUnitId'=l.native_unit_id::text))
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
end $function$;
revoke all on function cos_mhelp_placement_private.authoritative_product_records(jsonb,boolean) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.cos_mhelp_live_inventory_session(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
declare ctl cos_mhelp_placement_private.live_inventory_control;identity_evidence jsonb;baseline jsonb;base_sha text;old_rows jsonb;
 r jsonb;old jsonb;b jsonb;prepared jsonb:='[]';missing jsonb;seen text[]:='{}';targets text[]:='{}';target text;
 sha text;payload_sha text;receipt jsonb;summary jsonb;candidate cos_mhelp_placement_private.live_inventory_candidates;
 fields integer:=0;shops integer:=0;held integer:=0;added integer:=0;renamed integer:=0;addresses integer:=0;
begin
 if p_action='status' then
  select * into strict ctl from cos_mhelp_placement_private.live_inventory_control where singleton;
  return jsonb_build_object('enabled',ctl.enabled,'lastAttemptAt',ctl.last_attempt_at,'lastSuccessAt',ctl.last_success_at,'errorCode',ctl.error_code,'sourceSha256',ctl.active_source_sha256);
 end if;
 select * into strict ctl from cos_mhelp_placement_private.live_inventory_control where singleton for update;
 if p_action='fail' then
  update cos_mhelp_placement_private.live_inventory_control set last_attempt_at=clock_timestamp(),error_code=case when p_payload->>'errorCode'='source_rate_limited' then 'source_rate_limited' else 'inventory_source_unavailable' end where singleton;
  return jsonb_build_object('recorded',true);
 end if;
 if p_action is null or p_action not in('stage','run') then raise exception 'Invalid live inventory action';end if;
 select active_sha256 into strict base_sha from cos_mhelp_placement_private.upload_control where singleton for update;
 if p_payload->>'portalId' is distinct from '224643' or p_payload->'complete' is distinct from 'true'::jsonb
  or p_payload->>'baselineSourceSha256' is distinct from base_sha
  or jsonb_typeof(p_payload->'records') is distinct from 'array' or jsonb_array_length(p_payload->'records') not between 1 and 10000
  or coalesce(p_payload->>'readAt','')!~'^\d{4}-\d\d-\d\dT'
  or (p_payload->>'readAt')::timestamptz>clock_timestamp()+interval '1 minute'
  or (p_payload->>'readAt')::timestamptz<clock_timestamp()-interval '10 minutes' then raise exception 'Complete current source required';end if;
 -- One transaction protects graph inspection and source admission from native edits.
 lock table public.equipment_units,app_private.vision_tracker_locations,public.equipment_unit_location_history,
  app_private.cos_geocode_sources,app_private.cos_archived_representations,app_private.cos_owner_identity_claims in share mode;
 baseline:=cos_mhelp_placement_private.upload_snapshot();
 identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(coalesce(baseline->'apiMissingRecords','[]'::jsonb)||(baseline->'records'));
 select jsonb_object_agg(x->>'productId',x) into old_rows from jsonb_array_elements(coalesce(baseline->'apiMissingRecords','[]'::jsonb)||(baseline->'records')) x;
 for r in select value from jsonb_array_elements(p_payload->'records') loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,14}$' or r->>'productId'=any(seen)
   or coalesce(r->>'unitNumber','')='' or length(r->>'unitNumber')>250 or coalesce(r->>'customerId','')!~'^[1-9][0-9]{0,14}$'
   or coalesce(r->>'customer','')='' or length(r->>'customer')>512 or coalesce(r->>'category','')='' or length(r->>'category')>250
   or coalesce(r->>'placement','') not in('FIELD','SHOP') or coalesce(r->>'lifecycle','') not in('UNFLAGGED','DO_NOT_USE','MISSING')
   or jsonb_typeof(r->'sourceAddress') is distinct from 'object' or not(r->'sourceAddress' ?& array['street','city','state','zip']) or jsonb_typeof(r->'apiAssignment') is distinct from 'object'
   or r->'apiAssignment'->>'customerId' is distinct from r->>'customerId'
   or exists(select 1 from jsonb_each(r->'sourceAddress') a where a.key not in('street','city','state','zip') or jsonb_typeof(a.value)<>'string' or length(a.value#>>'{}')>600)
   or ((r->>'placement'='SHOP') is distinct from exists(select 1 from jsonb_array_elements_text(baseline->'companyCustomerIds') c where c=r->>'customerId'))
   or (r-array['productId','unitNumber','category','customerId','customer','placement','lifecycle','sourceAddress','sourceRow','sourceDates','binding','holdReason','possibleAliasUnitIds','displayUnitNumber','displayAuthorizationSha256','apiAssignment','addressReview'])<>'{}'::jsonb
   then raise exception 'Invalid complete source record';end if;
  seen:=array_append(seen,r->>'productId');old:=old_rows->(r->>'productId');
  if old is null then added:=added+1;end if;
  if old is not null and old->>'unitNumber' is distinct from r->>'unitNumber' then renamed:=renamed+1;end if;
  if old->'sourceAddress' is distinct from r->'sourceAddress' then addresses:=addresses+1;end if;
  b:=null;
  if old->>'unitNumber'=r->>'unitNumber' and old->'binding'->>'guardCurrent'='true'
   and lower(regexp_replace(old->>'category','[[:space:]]','','g'))=lower(regexp_replace(r->>'category','[[:space:]]','','g'))
   and (old->'apiAssignment'->>'equipmentTypeId' is null or old->'apiAssignment'->>'equipmentTypeId'=r->'apiAssignment'->>'equipmentTypeId') then
   b:=(identity_evidence->'bindings'->(old->>'productId')->'binding')-'guardCurrent';
   b:=jsonb_set(b,'{expectedGuard}',to_jsonb(cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid)));
   foreach target in array array[b->>'trackerId',b->>'nativeUnitId'] loop
    if target is not null then if target=any(targets) then raise exception 'Competing source identity';end if;targets:=array_append(targets,target);end if;
   end loop;
  end if;
  r:=jsonb_set(r,'{binding}',coalesce(b,'null'::jsonb));
  if b is null and old->'binding' is not null and old->'binding'<>'null'::jsonb then
   r:=r||jsonb_build_object('possibleAliasUnitIds',(select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(r->'possibleAliasUnitIds','[]')||jsonb_build_array(old->'binding'->'trackerId',old->'binding'->'nativeUnitId')) x where x<>'null'::jsonb));
  end if;
  if b is null and (coalesce(jsonb_array_length(r->'possibleAliasUnitIds'),0)>0 or nullif(r->>'holdReason','') is not null) then held:=held+1;end if;
  if r->>'placement'='FIELD' then fields:=fields+1;else shops:=shops+1;end if;
  prepared:=prepared||jsonb_build_array(r);
 end loop;
 select coalesce(jsonb_agg(x order by x->>'productId'),'[]'::jsonb) into missing from (
  select distinct on(value->>'productId') value x from jsonb_array_elements((baseline->'records')||coalesce(baseline->'apiMissingRecords','[]'::jsonb))
  where not(value->>'productId'=any(seen)) order by value->>'productId'
 ) absent;
 select coalesce(jsonb_agg(jsonb_set(x,'{binding}',identity_evidence->'bindings'->(x->>'productId')->'binding')),'[]'::jsonb)
 into missing from jsonb_array_elements(missing) x;
 -- Re-seal only an already-current reviewed binding, never a changed graph.
 select coalesce(jsonb_agg(case when x->'binding'->>'guardCurrent'='true' then
  jsonb_set(x,'{binding,expectedGuard}',to_jsonb(cos_mhelp_placement_private.upload_binding_guard((x->'binding'->>'trackerId')::uuid,(x->'binding'->>'nativeUnitId')::uuid)))
  else x end),'[]'::jsonb) into missing from jsonb_array_elements(missing) x;
 prepared:=cos_mhelp_placement_private.authoritative_product_records(prepared);
 select count(*) into held from jsonb_array_elements(prepared) x where (x->'binding' is null or x->'binding'='null'::jsonb) and (coalesce(jsonb_array_length(x->'possibleAliasUnitIds'),0)>0 or nullif(x->>'holdReason','') is not null);
 -- Stable source identity; observation timestamps belong to the run ledger.
 sha:=encode(sha256(convert_to(jsonb_build_object('portalId','224643','records',prepared,'missing',missing)::text,'UTF8')),'hex');
 summary:=jsonb_build_object('total',jsonb_array_length(prepared),'field',fields,'shop',shops,'held',held,'added',added,'missing',jsonb_array_length(missing),'renamed',renamed,'addressDifferences',addresses);
 receipt:=jsonb_build_object('contract','COS_MHELP_API_V1','origin','mhelpdesk_api','portalId','224643','complete',true,'reviewed',true,'sourceSha256',sha,
  'receivedAt',p_payload->>'readAt','receivedAtPrecision','second','exportAsOf',null,'recordCount',jsonb_array_length(prepared),'liveRecordCount',jsonb_array_length(prepared),
  'companyCustomerIds',baseline->'companyCustomerIds','trackerSource',baseline->'trackerSource','trackerRecords',coalesce(baseline->'trackerRecords','[]'::jsonb),
  'apiMissingRecords',missing,'filename','mHelpDesk live API');
 payload_sha:=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',prepared)::text,'UTF8')),'hex');
 insert into cos_mhelp_placement_private.live_inventory_candidates(source_sha256,expected_source_sha256,payload_sha256,receipt,records,missing_records,summary)
  values(sha,base_sha,payload_sha,receipt,prepared,missing,summary) on conflict(source_sha256) do nothing;
 select * into strict candidate from cos_mhelp_placement_private.live_inventory_candidates where source_sha256=sha;
 update cos_mhelp_placement_private.live_inventory_control set last_attempt_at=clock_timestamp() where singleton;
 if p_action='stage' or not ctl.enabled then
  insert into cos_mhelp_placement_private.live_inventory_runs(source_sha256,state,summary) values(sha,'staged',summary);
  return jsonb_build_object('state','staged','sourceSha256',sha,'summary',summary,'inventoryWrites',0);
 end if;
 if base_sha<>sha then
  insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records)
   values(sha,candidate.payload_sha256,candidate.receipt,candidate.records) on conflict(source_sha256) do nothing;
  update cos_mhelp_placement_private.upload_control set active_sha256=sha where singleton;
 end if;
 update cos_mhelp_placement_private.live_inventory_control set last_success_at=clock_timestamp(),active_source_sha256=sha,error_code=null where singleton;
 insert into cos_mhelp_placement_private.live_inventory_runs(source_sha256,state,summary) values(sha,'current',summary);
 return jsonb_build_object('state','current','sourceSha256',sha,'summary',summary,'inventoryWrites',0,'sourceActivated',true);
end$function$

;
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.api_base_upload_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when value->>'contract'='COS_MHELP_API_V1' and value->>'origin'='mhelpdesk_api' and value->'complete'='true'::jsonb
 then jsonb_set(value,'{records}',cos_mhelp_placement_private.authoritative_product_records(value->'records',true)) else value end
 from (
with original as materialized(select cos_mhelp_placement_private.identity_binding_base_upload_snapshot() snapshot),
 current_rows as materialized(
  select b.source_sha256,r from cos_mhelp_placement_private.upload_control u
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=u.active_sha256
  cross join lateral jsonb_array_elements(cos_mhelp_placement_private.scoped_records(b.source_sha256)) r
  where u.singleton and exists(select 1 from cos_mhelp_placement_private.identity_binding_receipts i where i.source_sha256=b.source_sha256)
 ), accepted as materialized(
  select i.product_id from cos_mhelp_placement_private.identity_binding_receipts i
  join current_rows r on r.source_sha256=i.source_sha256 and r.r->>'productId'=i.product_id
  join app_private.cos_owner_identity_claims c on c.id=i.claim_id and c.native_unit_id=i.native_unit_id
  where encode(sha256(convert_to(r.r::text,'UTF8')),'hex')=i.source_row_sha256
   and r.r->'binding'->>'nativeUnitId'=i.native_unit_id::text
   and c.confirmed_by=i.actor_user_id
   and not exists(select 1 from app_private.cos_owner_identity_revocations v where v.claim_id=c.id)
   and c.source_epoch=app_private.cos_owner_identity_source_epoch(c.native_unit_id,
    coalesce((select jsonb_agg(jsonb_build_object('source',x.source,'externalId',x.external_device_id)) from app_private.cos_owner_identity_resources x where x.claim_id=c.id),'[]'::jsonb))
   and cos_mhelp_placement_private.upload_binding_guard(i.tracker_id,i.native_unit_id)=i.after_guard
 )
 select case when o.snapshot is null then null else o.snapshot||jsonb_build_object('records',(
  select jsonb_agg(case when a.product_id is null then r else jsonb_set(r,'{binding,guardCurrent}','true'::jsonb) end order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(o.snapshot->'records') r left join accepted a on a.product_id=r->>'productId'
 )) end from original o
 ) authority_base(value)
$function$;
