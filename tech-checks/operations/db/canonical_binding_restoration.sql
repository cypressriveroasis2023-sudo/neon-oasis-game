-- DRAFT component. Install ONLY through prepareCanonicalBindingRestorationSql.
-- No production invocation, arbitrary Product IDs, raw records or actor creation.
create schema cos_binding_restoration_private;
revoke all on schema cos_binding_restoration_private from public,anon,authenticated,service_role;
create table cos_binding_restoration_private.stages(
 id uuid primary key,actor_id uuid not null,organization_id uuid not null,
 expected jsonb not null,snapshot jsonb not null,digest text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '10 minutes'
);
create table cos_binding_restoration_private.receipts(
 id uuid primary key references cos_binding_restoration_private.stages,
 actor_id uuid not null,confirmation text not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table cos_binding_restoration_private.stages enable row level security;
alter table cos_binding_restoration_private.receipts enable row level security;
revoke all on all tables in schema cos_binding_restoration_private from public,anon,authenticated,service_role;
create function cos_binding_restoration_private.immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Binding restoration evidence is append-only' using errcode='42501';end$$;
create trigger stages_immutable before update or delete or truncate on cos_binding_restoration_private.stages for each statement execute function cos_binding_restoration_private.immutable();
create trigger receipts_immutable before update or delete or truncate on cos_binding_restoration_private.receipts for each statement execute function cos_binding_restoration_private.immutable();
-- Existing repository writers append / ON CONFLICT DO NOTHING. This protects
-- admitted evidence going forward; it does not authenticate fabricated history.
create trigger canonical_history_immutable before update or delete or truncate on cos_mhelp_placement_private.upload_batches for each statement execute function cos_binding_restoration_private.immutable();

create function cos_binding_restoration_private.digest(v jsonb) returns text
language sql immutable set search_path='' as $$select encode(sha256(convert_to(v::text,'UTF8')),'hex')$$;
create function cos_binding_restoration_private.targets() returns table(product_id text,label text)
language sql immutable set search_path='' as $$values
 ('1910800','Radar Sniper 500'),('2221820','Spotter 028.1'),('2232675','Solar Spotter 010'),
 ('2232677','Solar Spotter 012'),('2274337','Spotter 145'),('2275201','Solar Spotter 039'),('2336149','Spotter 182HDC2S')$$;

create function cos_binding_restoration_private.lock_state() returns void
language plpgsql set search_path='' as $$
begin
 -- Same control order as the live importer; fail closed instead of waiting.
 perform 1 from cos_mhelp_placement_private.live_inventory_control where singleton for update nowait;
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for update nowait;
 lock table cos_mhelp_placement_private.scoped_control in share row exclusive mode nowait;
 lock table cos_mhelp_placement_private.upload_batches,cos_mhelp_placement_private.scoped_batches,
  public.equipment_units,app_private.vision_tracker_locations,public.equipment_unit_location_history,
  app_private.cos_geocode_sources,app_private.cos_archived_representations,app_private.cos_owner_identity_claims,
  cos_mhelp_placement_private.links,public.vision_vigilant_devices,public.vision_vigilant_unit_matches,
  app_private.cos_owner_identity_resources,app_private.cos_owner_identity_revocations,
  app_private.cos_owner_identity_source_events,public.user_profiles,public.user_roles,public.roles
 in share mode nowait;
 if not pg_try_advisory_xact_lock(hashtext('COS_OWNER_EQUIPMENT_V1')) then
  raise exception 'Owner equipment editor is active; retry a fresh review' using errcode='40001';end if;
 if to_regclass('cos_owner_equipment_private.settings') is not null then
  execute 'lock table cos_owner_equipment_private.settings in share mode nowait';
  if exists(select 1 from pg_catalog.pg_tables where schemaname='cos_owner_equipment_private' and tablename='settings') then
   perform cos_binding_restoration_private.assert_no_editor_override();
  end if;
 end if;
end$$;
create function cos_binding_restoration_private.assert_no_editor_override() returns void
language plpgsql set search_path='' as $$declare conflict boolean;begin
 execute 'select exists(select 1 from cos_owner_equipment_private.settings s join cos_binding_restoration_private.targets() t on t.product_id=s.product_id where s.active)' into conflict;
 if conflict then raise exception 'Active Owner equipment override requires separate coordination' using errcode='40001';end if;
end$$;

create function cos_binding_restoration_private.camera_digest() returns text
language sql stable set search_path='' as $$
 select cos_binding_restoration_private.digest(jsonb_build_object(
  'devices',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.vision_vigilant_devices x),
  'matches',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.vision_vigilant_unit_matches x),
  'resources',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_owner_identity_resources x),
  'revocations',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_owner_identity_revocations x),
  'events',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_owner_identity_source_events x)))
$$;

create function cos_binding_restoration_private.snapshot() returns jsonb
language plpgsql stable set search_path='' as $$
declare src cos_mhelp_placement_private.upload_batches;ctl cos_mhelp_placement_private.live_inventory_control;
 scoped jsonb;after_rows jsonb;head uuid;revision bigint;target record;row_data jsonb;b jsonb;h record;
 proof jsonb;provenance jsonb;items jsonb:='[]';seen text[]:='{}';entity jsonb;ident text;label text;
 original jsonb;source_count int;link jsonb;
begin
 select b.* into strict src from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton;
 select * into strict ctl from cos_mhelp_placement_private.live_inventory_control where singleton;
 if ctl.active_source_sha256 is distinct from src.source_sha256 or ctl.error_code is not null
  or ctl.last_success_at is null or ctl.last_success_at not between statement_timestamp()-interval '10 minutes' and statement_timestamp()+interval '1 minute'
  or src.receipt->>'contract' is distinct from 'COS_MHELP_API_V1' or src.receipt->>'portalId' is distinct from '224643'
  or src.receipt->'complete' is distinct from 'true'::jsonb or src.receipt->'reviewed' is distinct from 'true'::jsonb
  or src.receipt->>'sourceSha256' is distinct from src.source_sha256
  or src.payload_sha256 is distinct from cos_binding_restoration_private.digest(jsonb_build_object('receipt',src.receipt,'records',src.records))
  or jsonb_typeof(src.records) is distinct from 'array' or jsonb_array_length(src.records) not between 7 and 10000
  or src.receipt->'recordCount' is distinct from to_jsonb(jsonb_array_length(src.records))
  or (select count(distinct r->>'productId') from jsonb_array_elements(src.records) r)<>jsonb_array_length(src.records)
 then raise exception 'Fresh complete source required' using errcode='40001';end if;
 scoped:=cos_mhelp_placement_private.scoped_records(src.source_sha256);after_rows:=scoped;
 if jsonb_typeof(scoped) is distinct from 'array' or jsonb_array_length(scoped)<>jsonb_array_length(src.records)
  or (select count(distinct r->>'productId') from jsonb_array_elements(scoped)r)<>jsonb_array_length(scoped)
 then raise exception 'Unique complete scoped source required';end if;
 select c.active_id,c.revision into head,revision from cos_mhelp_placement_private.scoped_control c where c.base_sha256=src.source_sha256;
 for target in select * from cos_binding_restoration_private.targets() order by product_id loop
  select r into strict row_data from jsonb_array_elements(scoped) r where r->>'productId'=target.product_id;
  select r into strict original from jsonb_array_elements(src.records) r where r->>'productId'=target.product_id;
  if row_data is distinct from original or row_data->'binding' is distinct from 'null'::jsonb
   or row_data->>'unitNumber' is distinct from target.label or row_data->>'lifecycle' is distinct from 'UNFLAGGED'
   or row_data ?| array['scopedAuthority','sourceLabelAuthority','supersedesProductId','inventoryOnlyReason']
  then raise exception 'Exact unchanged null binding required: %',target.product_id;end if;
  proof:=null;provenance:='[]';source_count:=0;
  -- Scan ALL reviewed upload rows for the exact Product ID, not a caller subset.
  -- Conflicting or malformed bound rows poison the review; never newest-wins.
  for h in select batch.*,r from cos_mhelp_placement_private.upload_batches batch
   cross join lateral jsonb_array_elements(batch.records) r
   where batch.receipt->>'contract'='COS_MHELP_UPLOAD_V1' and r->>'productId'=target.product_id
    and r->'binding' is distinct from 'null'::jsonb order by batch.source_sha256 loop
   if h.receipt->'reviewed' is distinct from 'true'::jsonb or h.receipt->>'sourceSha256' is distinct from h.source_sha256
    or h.receipt->'recordCount' is distinct from to_jsonb(jsonb_array_length(h.records))
    or coalesce(h.receipt->>'authorizationSha256','')!~'^[a-f0-9]{64}$'
    or coalesce(h.receipt->>'libraryFileId','')!~'^libfile_[a-zA-Z0-9]+$' or coalesce(h.receipt->>'receivedMessageId','')=''
    or h.payload_sha256 is distinct from cos_binding_restoration_private.digest(jsonb_build_object('receipt',h.receipt,'records',h.records))
    or (select count(distinct x->>'productId') from jsonb_array_elements(h.records)x)<>jsonb_array_length(h.records)
    or h.r->>'unitNumber' is distinct from target.label or h.r->>'category' is distinct from row_data->>'category'
    or jsonb_typeof(h.r->'binding') is distinct from 'object' or (proof is not null and proof is distinct from h.r->'binding')
   then raise exception 'Invalid or ambiguous historical identity: %',target.product_id;end if;
   proof:=h.r->'binding';source_count:=source_count+1;
   provenance:=provenance||jsonb_build_array(jsonb_build_object('sourceSha256',h.source_sha256,'payloadSha256',h.payload_sha256,
    'recordSha256',cos_binding_restoration_private.digest(h.r),'proofSha256',cos_binding_restoration_private.digest(proof),
    'authorizationSha256',h.receipt->>'authorizationSha256'));
  end loop;
  b:=proof;
  if source_count=0 or b->>'productId' is distinct from target.product_id or b->>'fullLabel' is distinct from target.label
   or b->>'matchMethod' is distinct from 'exact_family_unit' or coalesce(b->>'canonicalKey','')=''
   or jsonb_typeof(b->'reviewEvidence') is distinct from 'object' or b->'reviewEvidence'='{}'::jsonb
   or coalesce(b->>'evidenceSha256','')!~'^[a-f0-9]{64}$' or coalesce(b->>'representationEvidenceSha256','')!~'^[a-f0-9]{64}$'
   or coalesce(b->>'expectedGuard','')!~'^[a-f0-9]{64}$'
   or not(b ?& array['trackerId','nativeUnitId','trackerLabel','nativeLabel'])
   or (b->>'trackerId' is null and b->>'nativeUnitId' is null)
   or jsonb_typeof(b->'representedUnitIds') is distinct from 'array' or jsonb_array_length(b->'representedUnitIds')=0
   or (select count(distinct x) from jsonb_array_elements(b->'representedUnitIds')x)<>jsonb_array_length(b->'representedUnitIds')
   or exists(select 1 from jsonb_array_elements(b->'representedUnitIds')x where jsonb_typeof(x) is distinct from 'string' or (x#>>'{}') not in(coalesce(b->>'trackerId',''),coalesce(b->>'nativeUnitId','')))
   or (b->>'trackerId' is not null and coalesce(b->>'trackerLabel','')='') or (b->>'nativeUnitId' is not null and coalesce(b->>'nativeLabel','')='')
  then raise exception 'Complete canonical identity proof required: %',target.product_id;end if;
  if b->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid)
  then raise exception 'Protected state changed: %',target.product_id using errcode='40001';end if;
  for ident,label in select b->>'trackerId',b->>'trackerLabel' union all select b->>'nativeUnitId',b->>'nativeLabel' loop
   if ident is null then continue;end if;
   if ident=any(seen) then raise exception 'Competing restoration target';end if;seen:=array_append(seen,ident);
   if exists(select 1 from jsonb_array_elements(scoped||src.records||coalesce(src.receipt->'apiMissingRecords','[]'))x
     where x->>'productId'<>target.product_id and (x->'binding'->>'trackerId'=ident or x->'binding'->>'nativeUnitId'=ident or x->'binding'->'representedUnitIds' ? ident or x->'possibleAliasUnitIds' ? ident))
    or exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id<>target.product_id and ident::uuid in(l.tracker_id,l.native_unit_id))
    or exists(select 1 from cos_mhelp_placement_private.upload_batches hb cross join lateral jsonb_array_elements(hb.records)x
     where hb.receipt->>'contract'='COS_MHELP_UPLOAD_V1' and x->>'productId'<>target.product_id
      and (x->'binding'->>'trackerId'=ident or x->'binding'->>'nativeUnitId'=ident or x->'binding'->'representedUnitIds' ? ident))
    or exists(select 1 from app_private.cos_geocode_sources s where s.active and s.product_id is distinct from target.product_id and ident::uuid in(s.tracker_id,s.native_unit_id))
    or exists(select 1 from jsonb_array_elements(coalesce(row_data->'possibleAliasUnitIds','[]'))x where x#>>'{}' not in(coalesce(b->>'trackerId',''),coalesce(b->>'nativeUnitId','')))
   then raise exception 'Competing identity membership';end if;
  end loop;
  if b->>'trackerId' is not null then
   select to_jsonb(t) into strict entity from app_private.vision_tracker_locations t where t.id=(b->>'trackerId')::uuid;
   if entity->>'organization_id' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' or entity->>'unit_number' is distinct from b->>'trackerLabel' then raise exception 'Tracker identity changed';end if;
  end if;
  if b->>'nativeUnitId' is not null then
   select to_jsonb(u) into strict entity from public.equipment_units u where u.id=(b->>'nativeUnitId')::uuid;
   if entity->>'organization_id' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' or entity->>'unit_number' is distinct from b->>'nativeLabel'
    or entity->>'status' in('retired','deleted') or entity->>'retired_at' is not null then raise exception 'Native identity changed';end if;
  end if;
  if exists(select 1 from app_private.cos_owner_identity_claims c where to_jsonb(c)->'product_association'->>'productId'=target.product_id and c.native_unit_id::text is distinct from b->>'nativeUnitId') then raise exception 'Competing Owner Product ID claim';end if;
  if exists(select 1 from app_private.cos_archived_representations a where (b->>'trackerId')::uuid in(a.archived_tracker_id,a.canonical_tracker_id) or (b->>'nativeUnitId')::uuid in(a.archived_native_id,a.canonical_native_id))
  then raise exception 'Archived identity needs a separate review';end if;
  if exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id=target.product_id
    and (l.tracker_id::text is distinct from b->>'trackerId' or l.native_unit_id::text is distinct from b->>'nativeUnitId' or l.full_label is distinct from target.label))
  then raise exception 'Existing link disagrees';end if;
  if b->'previousAssignment' is not null and b->'previousAssignment'<>'null'::jsonb then
   select to_jsonb(l) into strict link from cos_mhelp_placement_private.links l where l.equipment_id=target.product_id;
   if link->'observation'->>'state' is distinct from 'confirmed' or b->'previousAssignment'->>'productId' is distinct from target.product_id
    or b->'previousAssignment'->>'customerId' is distinct from link->'observation'->>'customerId'
    or b->'previousAssignment'->>'placement' is distinct from link->'observation'->>'placement'
    or b->'previousAssignment'->>'serviceLocationId' is distinct from link->'observation'->>'serviceLocationId'
    or (b->'previousAssignment'->>'observedAt')::timestamptz is distinct from (link->>'observed_at')::timestamptz
   then raise exception 'Historical assignment reference changed';end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('productId',target.product_id,'before',row_data,'binding',b,'provenance',provenance));
  select jsonb_agg(case when r->>'productId'=target.product_id then jsonb_set(r,'{binding}',b) else r end order by ord)
   into after_rows from jsonb_array_elements(after_rows) with ordinality e(r,ord);
 end loop;
 return jsonb_build_object('sourceSha256',src.source_sha256,'payloadSha256',src.payload_sha256,'scopedRevision',coalesce(revision,0),'scopedHead',head,
  'scopedSha256',cos_binding_restoration_private.digest(scoped),'beforeRecords',scoped,'afterRecords',after_rows,'items',items,
  'cameraSha256',cos_binding_restoration_private.camera_digest(),
  'linksSha256',cos_binding_restoration_private.digest((select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]') from cos_mhelp_placement_private.links l)));
end$$;

create function public.cos_owner_restore_seven_bindings_v1(p_actor uuid,p_org uuid,p_request uuid,p_action text,p_expected jsonb,p_digest text default null,p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare s cos_binding_restoration_private.stages;done cos_binding_restoration_private.receipts;v jsonb;d text;result jsonb;auth_sha text;
begin
 if p_actor is null or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or p_request is null
  or p_action is null or p_action not in('stage','commit') or jsonb_typeof(p_expected) is distinct from 'object'
  or (select array_agg(k order by k) from jsonb_object_keys(p_expected)k) is distinct from array['payloadSha256','scopedRevision','scopedSha256','sourceSha256']::text[]
 then raise exception 'Invalid restoration request' using errcode='22023';end if;
 perform cos_binding_restoration_private.lock_state();
 perform app_private.cos_owner_identity_assert_actor(p_actor,p_org,true);
 perform cos_binding_restoration_private.assert_dependencies();
 select * into done from cos_binding_restoration_private.receipts where id=p_request;
 select * into s from cos_binding_restoration_private.stages where id=p_request;
 if s.id is not null and (s.actor_id is distinct from p_actor or s.organization_id is distinct from p_org or s.expected is distinct from p_expected) then raise exception 'Request identity reused' using errcode='40001';end if;
 if done.id is not null then
  if p_action<>'commit' or p_digest is distinct from s.digest or p_confirmation is distinct from done.confirmation
   or not exists(select 1 from cos_mhelp_placement_private.upload_control u join cos_mhelp_placement_private.scoped_control c on c.base_sha256=u.active_sha256 where u.singleton and u.active_sha256=s.snapshot->>'sourceSha256' and c.active_id=p_request and c.revision=(s.snapshot->>'scopedRevision')::bigint+1)
   or cos_mhelp_placement_private.scoped_records(s.snapshot->>'sourceSha256') is distinct from s.snapshot->'afterRecords'
   or cos_binding_restoration_private.camera_digest() is distinct from s.snapshot->>'cameraSha256'
   or cos_binding_restoration_private.digest((select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]') from cos_mhelp_placement_private.links l)) is distinct from s.snapshot->>'linksSha256'
   or exists(select 1 from jsonb_array_elements(s.snapshot->'items')i where i->'binding'->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((i->'binding'->>'trackerId')::uuid,(i->'binding'->>'nativeUnitId')::uuid))
  then raise exception 'Applied restoration changed; inspect original receipt' using errcode='40001';end if;
  return done.receipt||jsonb_build_object('replayed',true);
 end if;
 v:=cos_binding_restoration_private.snapshot();
 if (v-array['scopedHead','beforeRecords','afterRecords','items','cameraSha256','linksSha256']) is distinct from p_expected then raise exception 'Source or scoped authority changed' using errcode='40001';end if;
 d:=cos_binding_restoration_private.digest(jsonb_build_object('request',p_request,'actor',p_actor,'organization',p_org,'snapshot',v));
 if p_action='stage' then
  if p_digest is not null or p_confirmation is not null then raise exception 'Unexpected stage approval';end if;
  if s.id is null then insert into cos_binding_restoration_private.stages(id,actor_id,organization_id,expected,snapshot,digest) values(p_request,p_actor,p_org,p_expected,v,d) returning * into s;
  elsif s.digest is distinct from d or s.expires_at<=clock_timestamp() then raise exception 'Stage changed or expired' using errcode='40001';end if;
  return jsonb_build_object('contract','COS_SEVEN_BINDING_STAGE_V1','requestId',p_request,'expected',p_expected,'digest',d,'expiresAt',s.expires_at,'items',v->'items','applied',false);
 end if;
 if s.id is null or s.expires_at<=clock_timestamp() or s.digest is distinct from d or p_digest is distinct from d
  or p_confirmation is null or length(btrim(p_confirmation)) not between 24 and 800 then raise exception 'Fresh exact Owner stage approval required' using errcode='40001';end if;
 auth_sha:=cos_binding_restoration_private.digest(jsonb_build_object('actor',p_actor,'organization',p_org,'requestId',p_request,'digest',d,'confirmation',p_confirmation));
 insert into cos_mhelp_placement_private.scoped_batches(id,base_sha256,previous_id,organization_id,actor_id,request,records)
  values(p_request,v->>'sourceSha256',(v->>'scopedHead')::uuid,p_org,p_actor,jsonb_build_object('contract','COS_SEVEN_BINDING_RESTORATION_V1','reviewDigest',d,'authorizationSha256',auth_sha),v->'afterRecords');
 insert into cos_mhelp_placement_private.scoped_control(base_sha256,revision,active_id) values(v->>'sourceSha256',(v->>'scopedRevision')::bigint+1,p_request)
  on conflict(base_sha256) do update set revision=excluded.revision,active_id=excluded.active_id;
 insert into cos_mhelp_placement_private.scoped_audit(base_sha256,revision,action,previous_id,active_id,actor_id,organization_id,authorization_sha256)
  values(v->>'sourceSha256',(v->>'scopedRevision')::bigint+1,'apply',(v->>'scopedHead')::uuid,p_request,p_actor,p_org,auth_sha);
 result:=jsonb_build_object('contract','COS_SEVEN_BINDING_COMMIT_V1','requestId',p_request,'actorId',p_actor,'organizationId',p_org,'reviewDigest',d,'sourceSha256',v->>'sourceSha256',
  'beforeScopedSha256',v->>'scopedSha256','afterScopedSha256',cos_binding_restoration_private.digest(v->'afterRecords'),'revision',(v->>'scopedRevision')::bigint+1,
  'items',v->'items','cameraSha256',v->>'cameraSha256','authorizationSha256',auth_sha,'applied',true,'appliedAt',clock_timestamp());
 insert into cos_binding_restoration_private.receipts(id,actor_id,confirmation,receipt) values(p_request,p_actor,p_confirmation,result);
 return result;
end$$;

-- Preserve the exact baseline projection except the seven audited binding slots.
create function cos_binding_restoration_private.project(base jsonb) returns jsonb
language sql stable set search_path='' as $$
 with recursive chain as(
  select b.id,b.previous_id,0 depth from cos_mhelp_placement_private.scoped_control c
   join cos_mhelp_placement_private.scoped_batches b on b.id=c.active_id and b.base_sha256=c.base_sha256 where c.base_sha256=base->>'sourceSha256'
  union all select b.id,b.previous_id,c.depth+1 from chain c join cos_mhelp_placement_private.scoped_batches b on b.id=c.previous_id
   where b.base_sha256=base->>'sourceSha256' and c.depth<1000
 ),active as(select s.snapshot from chain c join cos_binding_restoration_private.stages s on s.id=c.id
  join cos_binding_restoration_private.receipts r on r.id=s.id),
 rows as(select jsonb_agg(case when i is not null and r->'binding'='null'::jsonb and r->>'unitNumber'=i->'before'->>'unitNumber' then
  jsonb_set(r,'{binding}',((i->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',camera_current and i->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((i->'binding'->>'trackerId')::uuid,(i->'binding'->>'nativeUnitId')::uuid))) else r end order by ord) value
  from jsonb_array_elements(base->'records') with ordinality e(r,ord)
  left join (select distinct i,snapshot->>'cameraSha256'=cos_binding_restoration_private.camera_digest()
    and snapshot->>'linksSha256'=cos_binding_restoration_private.digest((select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]') from cos_mhelp_placement_private.links l)) camera_current
   from active cross join lateral jsonb_array_elements(snapshot->'items')i
   where exists(select 1 from jsonb_array_elements(cos_mhelp_placement_private.scoped_records(base->>'sourceSha256'))current_row
    where current_row->>'productId'=i->>'productId' and current_row->'binding'=i->'binding')) restored on i->>'productId'=r->>'productId')
 select jsonb_set(base,'{records}',coalesce(rows.value,'[]'::jsonb)) from rows
$$;
create function cos_binding_restoration_private.retain_holds(old jsonb,new_row jsonb) returns jsonb
language sql stable set search_path='' as $$
 select case when exists(select 1 from cos_binding_restoration_private.stages s join cos_binding_restoration_private.receipts r on r.id=s.id
  cross join lateral jsonb_array_elements(s.snapshot->'items')i where i->>'productId'=old->>'productId'
   and ((i->'binding')-'reviewEvidence')=((old->'binding')-array['reviewEvidence','guardCurrent']))
 then new_row||case when old->'placementHeld'='true'::jsonb then jsonb_build_object('placementHeld',true) else '{}'::jsonb end
  ||case when coalesce(new_row->>'holdReason','')='' and coalesce(old->>'holdReason','')<>'' then jsonb_build_object('holdReason',old->>'holdReason') else '{}'::jsonb end
 else new_row end
$$;
revoke all on all functions in schema cos_binding_restoration_private from public,anon,authenticated,service_role;
revoke all on function public.cos_owner_restore_seven_bindings_v1(uuid,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.cos_owner_restore_seven_bindings_v1(uuid,uuid,uuid,text,jsonb,text,text) to service_role;
