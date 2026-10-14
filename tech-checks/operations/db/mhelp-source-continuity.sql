-- PRIVATE OFFLINE CANDIDATE. Not approved for production execution.
-- Existing importer, upload_binding_guard and immutable upload_batches are unchanged.
create table cos_mhelp_placement_private.source_admissions(
 request_id uuid primary key,source_sha256 text not null,payload_sha256 text not null,
 input_sha256 text not null,authorization_sha256 text not null,records jsonb not null,
 before_guards jsonb not null,after_sources jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table cos_mhelp_placement_private.source_continuity(
 id bigint generated always as identity primary key,request_id uuid not null references cos_mhelp_placement_private.source_admissions,
 action text not null check(action in('admit','rollback')),source_sha256 text not null,payload_sha256 text not null,
 tracker_id uuid,native_id uuid,original_guard text not null,before_guard text not null,after_guard text not null,
 before_graph jsonb not null,after_graph jsonb not null,authorization_sha256 text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table cos_mhelp_placement_private.source_rollbacks(
 request_id uuid primary key references cos_mhelp_placement_private.source_admissions,
 after_sources jsonb not null,authorization_sha256 text not null,created_at timestamptz not null default clock_timestamp()
);
alter table cos_mhelp_placement_private.source_admissions enable row level security;
alter table cos_mhelp_placement_private.source_continuity enable row level security;
alter table cos_mhelp_placement_private.source_rollbacks enable row level security;
revoke all on cos_mhelp_placement_private.source_admissions,cos_mhelp_placement_private.source_continuity,cos_mhelp_placement_private.source_rollbacks from public,anon,authenticated,service_role;
revoke all on sequence cos_mhelp_placement_private.source_continuity_id_seq from public,anon,authenticated,service_role;

create function cos_mhelp_placement_private.continuity_append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Continuity history is append-only';end$$;
create trigger admission_immutable before update or delete on cos_mhelp_placement_private.source_admissions for each row execute function cos_mhelp_placement_private.continuity_append_only();
create trigger continuity_immutable before update or delete on cos_mhelp_placement_private.source_continuity for each row execute function cos_mhelp_placement_private.continuity_append_only();
create trigger rollback_immutable before update or delete on cos_mhelp_placement_private.source_rollbacks for each row execute function cos_mhelp_placement_private.continuity_append_only();
create trigger admission_no_truncate before truncate on cos_mhelp_placement_private.source_admissions execute function cos_mhelp_placement_private.continuity_append_only();
create trigger continuity_no_truncate before truncate on cos_mhelp_placement_private.source_continuity execute function cos_mhelp_placement_private.continuity_append_only();
create trigger rollback_no_truncate before truncate on cos_mhelp_placement_private.source_rollbacks execute function cos_mhelp_placement_private.continuity_append_only();

-- Same complete graph as upload_binding_guard; no field is ignored for acceptance.
create function cos_mhelp_placement_private.continuity_graph(t uuid,n uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'tracker',(select to_jsonb(x) from app_private.vision_tracker_locations x where x.id=t),
 'native',(select to_jsonb(x) from public.equipment_units x where x.id=n),
 'sources',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_geocode_sources x where x.tracker_id=t or x.native_unit_id=n),
 'archives',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_archived_representations x where t in(x.archived_tracker_id,x.canonical_tracker_id) or n in(x.archived_native_id,x.canonical_native_id)),
 'nativeHistory',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.equipment_unit_location_history x where x.equipment_unit_id=n),
 'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_owner_identity_claims x where x.native_unit_id=n))
$$;
create function cos_mhelp_placement_private.continuity_unchanged(excluded uuid[]) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'tracker',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.vision_tracker_locations x),
 'native',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.equipment_units x),
 'sources',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_geocode_sources x where not(x.native_unit_id=any(excluded))),
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_geocode_source_events x where not(x.native_unit_id=any(excluded))),
 'archives',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_archived_representations x),
 'nativeHistory',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.equipment_unit_location_history x),
 'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_owner_identity_claims x),
 'batches',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from cos_mhelp_placement_private.upload_batches x),
 'control',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from cos_mhelp_placement_private.upload_control x),
 'archiveRevocations',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_archived_representation_revocations x),
 'recordedCoordinates',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_source_recorded_coordinates x),
 'links',(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from cos_mhelp_placement_private.links x))
$$;
create function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text) returns boolean language sql stable set search_path='' as $$
 select coalesce((select x.after_guard
  from cos_mhelp_placement_private.source_continuity x
  join cos_mhelp_placement_private.upload_control c on c.singleton and c.active_sha256=x.source_sha256
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 and b.payload_sha256=x.payload_sha256
  where x.tracker_id is not distinct from t and x.native_id is not distinct from n and x.original_guard=original order by x.id desc limit 1),original)=cos_mhelp_placement_private.upload_binding_guard(t,n)
$$;
-- Derive ALL affected immutable memberships, never accept a caller-supplied subset.
create function cos_mhelp_placement_private.continuity_bindings(records jsonb) returns jsonb language sql stable set search_path='' as $$
 with active as(select b.* from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton),
 bindings as(
 select 'mhelp' kind,r->>'productId' record_id,r->'binding' b from active,jsonb_array_elements(active.records) r where jsonb_typeof(r->'binding')='object'
 union all select 'tracker',r->>'recordId',r->'binding' from active,jsonb_array_elements(active.receipt->'trackerRecords') r where r->'binding'->>'state'='linked')
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'recordId',record_id,'trackerId',b->'trackerId','nativeUnitId',b->'nativeUnitId','expectedGuard',b->>'expectedGuard',
 'currentGuard',cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid)) order by kind,record_id),'[]') from bindings
 where exists(select 1 from jsonb_array_elements(records) r where r->>'trackerId' in(b->>'trackerId',b->>'nativeUnitId') or r->>'nativeUnitId' in(b->>'trackerId',b->>'nativeUnitId'))
$$;
create function cos_mhelp_placement_private.continuity_events_match(before_events jsonb,post_sources jsonb,event_kind text) returns boolean language sql stable set search_path='' as $$
 select (select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from app_private.cos_geocode_source_events x)
 is not distinct from (select coalesce(jsonb_agg(x order by x::text),'[]') from (
 select value x from jsonb_array_elements(before_events)
 union all select jsonb_build_object('event_id',(value->>'event_id')::bigint,'organization_id',value->'organization_id','entity_kind',value->'entity_kind','native_unit_id',value->'native_unit_id','product_id',value->'product_id','source_revision',value->'source_revision','kind',event_kind,'source_system','mhelpdesk_product_import','source_record_id',null) from jsonb_array_elements(post_sources)) q)
$$;
create function cos_mhelp_placement_private.continuity_lock(records jsonb) returns void language plpgsql set search_path='' as $$
declare id uuid;begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed transaction required';end if;
 perform set_config('lock_timeout','2000ms',true);
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for update;
 for id in select (value->>'nativeUnitId')::uuid from jsonb_array_elements(records) order by 1 loop if not pg_try_advisory_xact_lock(hashtextextended(id::text,701006)) then raise exception 'Source writer busy' using errcode='55P03';end if;end loop;
 -- Blocks external INSERT/UPDATE/DELETE including phantom graph rows; this transaction may write its reviewed sources.
 lock table app_private.cos_geocode_sources,app_private.cos_geocode_source_events in share row exclusive mode nowait;
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_archived_representations,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,cos_mhelp_placement_private.upload_batches,cos_mhelp_placement_private.links,app_private.cos_archived_representation_revocations,app_private.cos_source_recorded_coordinates in share mode nowait;
end$$;

create function cos_mhelp_placement_private.admit_sources_continuity(request uuid,org uuid,source_sha text,payload_sha text,records jsonb,expected_guards jsonb,authorization_sha text) returns jsonb language plpgsql set search_path='' as $$
declare batch cos_mhelp_placement_private.upload_batches; previous cos_mhelp_placement_private.source_admissions;
 r jsonb;u jsonb;b jsonb;g jsonb;graph jsonb;before_graphs jsonb:='[]';derived jsonb;unchanged jsonb;after_sources jsonb;ids uuid[];input_sha text;new_guard text;events_before jsonb;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if request is null or org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or coalesce(authorization_sha,'')!~'^[a-f0-9]{64}$' or jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) not between 1 and 8 then raise exception 'Invalid bounded admission';end if;
 perform cos_mhelp_placement_private.continuity_lock(records);
 select x.* into batch from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches x on x.source_sha256=c.active_sha256 where c.singleton;
 if batch.source_sha256 is distinct from source_sha or batch.payload_sha256 is distinct from payload_sha then raise exception 'Active upload changed' using errcode='40001';end if;
 input_sha:=encode(sha256(convert_to(jsonb_build_object('records',records,'expectedGuards',expected_guards)::text,'UTF8')),'hex');
 select * into previous from cos_mhelp_placement_private.source_admissions a where a.request_id=request;
 if found then
  if previous.source_sha256<>source_sha or previous.payload_sha256<>payload_sha or previous.input_sha256<>input_sha or exists(select 1 from cos_mhelp_placement_private.source_rollbacks x where x.request_id=request) then raise exception 'Admission request changed or rolled back';end if;
  if previous.after_sources is distinct from (select jsonb_agg(to_jsonb(x) order by x.native_unit_id) from app_private.cos_geocode_sources x where x.native_unit_id in(select (value->>'nativeUnitId')::uuid from jsonb_array_elements(records))) then raise exception 'Admission source head changed';end if;
  for g in select value from jsonb_array_elements(expected_guards) loop if cos_mhelp_placement_private.continuity_current((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid,g->>'expectedGuard') is not true then raise exception 'Admission graph head changed';end if;end loop;
  return jsonb_build_object('applied',true,'idempotent',true,'requestId',request);
 end if;
 derived:=cos_mhelp_placement_private.continuity_bindings(records);
 if jsonb_array_length(derived)=0 or derived is distinct from expected_guards then raise exception 'Expected membership or graph changed' using errcode='40001';end if;
 for g in select value from jsonb_array_elements(derived) loop
  if cos_mhelp_placement_private.continuity_current((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid,g->>'expectedGuard') is not true then raise exception 'Held upload binding cannot be refreshed';end if;
  before_graphs:=before_graphs||jsonb_build_array(g||jsonb_build_object('graph',cos_mhelp_placement_private.continuity_graph((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid)));
 end loop;
 select array_agg((value->>'nativeUnitId')::uuid) into ids from jsonb_array_elements(records);
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or exists(select 1 from app_private.cos_geocode_sources x,jsonb_array_elements(records) rr where x.native_unit_id=any(ids) or x.tracker_id=(rr->>'trackerId')::uuid or x.product_id=rr->>'productId') then raise exception 'Only new unique source targets are allowed';end if;
 if exists(select 1 from cos_mhelp_placement_private.links l,jsonb_array_elements(records) rr where l.tracker_id=(rr->>'trackerId')::uuid or l.native_unit_id=(rr->>'nativeUnitId')::uuid or l.equipment_id=rr->>'productId') then raise exception 'Existing API placement link would change';end if;
 for r in select value from jsonb_array_elements(records) loop
  select x into u from jsonb_array_elements(batch.records) x where x->>'productId'=r->>'productId';b:=u->'binding';
  if u is null or jsonb_typeof(b) is distinct from 'object' or u->>'placement'<>'FIELD' or u->>'lifecycle'<>'UNFLAGGED' or u->>'placementHeld'='true' or b->>'placementHeld'='true' or b->>'state' in('held','unlinked','unbound')
   or b->>'trackerId' is null or r->>'trackerId' is distinct from b->>'trackerId' or r->>'nativeUnitId' is distinct from coalesce(b->>'nativeUnitId',b->>'trackerId')
   or r->>'entityKind' is distinct from (case when b->>'nativeUnitId' is null then 'tracker' else 'equipment_unit' end)
   or r->>'unitNumber' is distinct from coalesce(b->>'nativeLabel',b->>'trackerLabel') or r->>'trackerUnitNumber' is distinct from b->>'trackerLabel'
   or r->>'family' is distinct from split_part(b->>'canonicalKey',':',1) or r->>'variant' is not null or r->>'siteLabel' is distinct from u->>'customer'
   or r->>'sourceFileSha256' is distinct from source_sha or r->>'sourceRowSha256' is distinct from encode(sha256(convert_to((u-'binding')::text,'UTF8')),'hex')
   or r->>'placement'<>'FIELD' or r->>'previousSourceRevision' is not null then raise exception 'Source is not the exact eligible uploaded identity';end if;
  if r->'installation' is distinct from jsonb_build_object('street',btrim(regexp_replace(u#>>'{sourceAddress,street}','[[:space:]]+',' ','g')),'city',nullif(btrim(u#>>'{sourceAddress,city}'),''),'state',upper(btrim(u#>>'{sourceAddress,state}')),'zip',nullif(btrim(u#>>'{sourceAddress,zip}'),'')) then raise exception 'Source address differs from uploaded file';end if;
 end loop;
 unchanged:=cos_mhelp_placement_private.continuity_unchanged(ids);
 select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') into events_before from app_private.cos_geocode_source_events x;
 perform app_private.cos_geocode_sources_admin_import_reviewed(org,records);
 if unchanged is distinct from cos_mhelp_placement_private.continuity_unchanged(ids) then raise exception 'Unapproved graph or source delta';end if;
 select jsonb_agg(to_jsonb(x) order by x.native_unit_id) into after_sources from app_private.cos_geocode_sources x where x.native_unit_id=any(ids);
 if not cos_mhelp_placement_private.continuity_events_match(events_before,after_sources,'upsert') then raise exception 'Unapproved affected event delta';end if;
 if jsonb_array_length(after_sources)<>jsonb_array_length(records) then raise exception 'Incomplete source admission';end if;
 for r in select value from jsonb_array_elements(records) loop
  select x into u from jsonb_array_elements(after_sources) x where x->>'native_unit_id'=r->>'nativeUnitId';
  if (u-array['source_revision','event_id','imported_at']) is distinct from jsonb_build_object(
   'organization_id',org,'entity_kind',r->>'entityKind','native_unit_id',r->>'nativeUnitId','tracker_id',r->>'trackerId','product_id',r->>'productId',
   'unit_number',r->>'unitNumber','tracker_unit_number',r->>'trackerUnitNumber','family',r->>'family','variant',r->>'variant','site_label',r->>'siteLabel',
   'source_file_sha256',r->>'sourceFileSha256','source_row_sha256',r->>'sourceRowSha256','street',r#>>'{installation,street}','city',r#>>'{installation,city}',
   'state',r#>>'{installation,state}','zip',r#>>'{installation,zip}','address_sha256',r->>'addressSha256','native_guard_sha256',r->>'nativeGuardSha256',
   'source_placement','FIELD','active',true,'eligibility','FIELD','source_system','mhelpdesk_product_import','source_record_id',null,'source_provenance',null,'source_customer_label',null,'precedence_decision_id',null) then raise exception 'Unexpected admitted source postimage';end if;
 end loop;
 insert into cos_mhelp_placement_private.source_admissions values(request,source_sha,payload_sha,input_sha,authorization_sha,records,derived,after_sources,clock_timestamp());
 -- JSON form keeps nullable native IDs and exact shared representation membership.
 for g in select distinct jsonb_build_object('trackerId',value->'trackerId','nativeUnitId',value->'nativeUnitId','expectedGuard',value->'expectedGuard','currentGuard',value->'currentGuard','graph',value->'graph') from jsonb_array_elements(before_graphs) loop
  graph:=cos_mhelp_placement_private.continuity_graph((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid);
  if (graph-'sources') is distinct from ((g->'graph')-'sources') then raise exception 'Non-source graph changed';end if;
  new_guard:=cos_mhelp_placement_private.upload_binding_guard((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid);
  insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256)
  values(request,'admit',source_sha,payload_sha,(g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid,g->>'expectedGuard',g->>'currentGuard',new_guard,g->'graph',graph,authorization_sha);
 end loop;
 return jsonb_build_object('applied',true,'idempotent',false,'requestId',request,'sources',jsonb_array_length(records),'memberships',jsonb_array_length(derived));
end$$;

create function cos_mhelp_placement_private.rollback_sources_continuity(request uuid,source_sha text,payload_sha text,authorization_sha text) returns jsonb language plpgsql set search_path='' as $$
declare a cos_mhelp_placement_private.source_admissions;back cos_mhelp_placement_private.source_rollbacks;head cos_mhelp_placement_private.source_continuity;
 g jsonb;post jsonb;ids uuid[];unchanged jsonb;graph jsonb;before_graphs jsonb:='[]';sources jsonb;events_before jsonb;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if coalesce(authorization_sha,'')!~'^[a-f0-9]{64}$' then raise exception 'Rollback authorization missing';end if;
 select * into strict a from cos_mhelp_placement_private.source_admissions x where x.request_id=request;
 perform cos_mhelp_placement_private.continuity_lock(a.records);
 if a.source_sha256<>source_sha or a.payload_sha256<>payload_sha or not exists(select 1 from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton and b.source_sha256=source_sha and b.payload_sha256=payload_sha) then raise exception 'Active upload changed';end if;
 select array_agg((value->>'nativeUnitId')::uuid) into ids from jsonb_array_elements(a.records);
 select jsonb_agg(to_jsonb(x) order by x.native_unit_id) into sources from app_private.cos_geocode_sources x where x.native_unit_id=any(ids);
 select * into back from cos_mhelp_placement_private.source_rollbacks x where x.request_id=request;
 if sources is distinct from (case when back.request_id is null then a.after_sources else back.after_sources end) then raise exception 'Rollback source head changed';end if;
 for g in select distinct jsonb_build_object('trackerId',value->'trackerId','nativeUnitId',value->'nativeUnitId','expectedGuard',value->'expectedGuard') from jsonb_array_elements(a.before_guards) loop
  select * into head from cos_mhelp_placement_private.source_continuity x where x.source_sha256=source_sha and x.payload_sha256=payload_sha and x.tracker_id is not distinct from (g->>'trackerId')::uuid and x.native_id is not distinct from (g->>'nativeUnitId')::uuid and x.original_guard=g->>'expectedGuard' order by x.id desc limit 1;
  if head.request_id is distinct from request or head.action is distinct from (case when back.request_id is null then 'admit' else 'rollback' end) or head.after_guard is distinct from cos_mhelp_placement_private.upload_binding_guard(head.tracker_id,head.native_id) then raise exception 'Rollback graph head changed';end if;
  before_graphs:=before_graphs||jsonb_build_array(g||jsonb_build_object('currentGuard',head.after_guard,'graph',head.after_graph));
 end loop;
 if back.request_id is not null then return jsonb_build_object('rolledBack',true,'idempotent',true,'requestId',request);end if;
 unchanged:=cos_mhelp_placement_private.continuity_unchanged(ids);
 select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') into events_before from app_private.cos_geocode_source_events x;
 -- Keep created rows and source events. The existing trigger emits tombstones.
 update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=any(ids);
 if unchanged is distinct from cos_mhelp_placement_private.continuity_unchanged(ids) then raise exception 'Unapproved rollback graph delta';end if;
 select jsonb_agg(to_jsonb(x) order by x.native_unit_id) into post from app_private.cos_geocode_sources x where x.native_unit_id=any(ids);
 if not cos_mhelp_placement_private.continuity_events_match(events_before,post,'tombstone') then raise exception 'Unapproved rollback event delta';end if;
 for g in select value from jsonb_array_elements(post) loop
  if not exists(select 1 from jsonb_array_elements(sources) x where x->>'native_unit_id'=g->>'native_unit_id' and (x-array['active','eligibility','source_revision','event_id','imported_at'])=(g-array['active','eligibility','source_revision','event_id','imported_at'])) or g->>'active'<>'false' or g->>'eligibility'<>'tombstone' then raise exception 'Unexpected rollback source postimage';end if;
 end loop;
 insert into cos_mhelp_placement_private.source_rollbacks values(request,post,authorization_sha,clock_timestamp());
 for g in select value from jsonb_array_elements(before_graphs) loop
  graph:=cos_mhelp_placement_private.continuity_graph((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid);
  insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256)
  values(request,'rollback',source_sha,payload_sha,(g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid,g->>'expectedGuard',g->>'currentGuard',cos_mhelp_placement_private.upload_binding_guard((g->>'trackerId')::uuid,(g->>'nativeUnitId')::uuid),g->'graph',graph,authorization_sha);
 end loop;
 return jsonb_build_object('rolledBack',true,'idempotent',false,'requestId',request,'retainedSourceRows',jsonb_array_length(post));
end$$;

-- Read adapters retain the original output contract and ACL.
create or replace function cos_mhelp_placement_private.upload_tracker_snapshot(p_records jsonb) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg((r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object('binding',((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',
  coalesce(r->'binding'->>'state'='linked' and cos_mhelp_placement_private.continuity_current((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard'),false))) order by r->>'recordId'),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_records,'[]'::jsonb)) r
$$;

create or replace function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql stable set search_path='' as $$
 select (b.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object('trackerRecords',cos_mhelp_placement_private.upload_tracker_snapshot(b.receipt->'trackerRecords'),'reviewed',true,'payloadSha256',b.payload_sha256,'records',(
  select jsonb_agg((r-'binding')||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
    ((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',cos_mhelp_placement_private.continuity_current((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard')) end) order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(b.records) r))
 from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton
$$;

do $$declare x record;begin for x in select p.oid::regprocedure f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='cos_mhelp_placement_private' and (p.proname like 'continuity_%' or p.proname in('admit_sources_continuity','rollback_sources_continuity')) loop execute 'revoke all on function '||x.f||' from public,anon,authenticated,service_role';end loop;end$$;
