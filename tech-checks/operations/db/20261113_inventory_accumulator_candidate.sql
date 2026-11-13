CREATE OR REPLACE FUNCTION public.cos_mhelp_live_inventory_session(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
declare ctl cos_mhelp_placement_private.live_inventory_control;identity_evidence jsonb;baseline jsonb;base_sha text;old_rows jsonb;
 r jsonb;old jsonb;b jsonb;prepared jsonb:='[]';prepared_rows jsonb[]:='{}';missing jsonb;seen text[]:='{}';targets text[]:='{}';target text;
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
  prepared_rows:=array_append(prepared_rows,r);
 end loop;
 prepared:=to_jsonb(prepared_rows);
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
