-- REVIEW ARTIFACT: native project. Reader-compatible typed tracker extension.
-- Apply after source read-access/admin-import/native-map-identity artifacts.
-- No source admission, new credential, schema USAGE or unrelated ACL changes.
begin;
alter table app_private.cos_geocode_sources
 alter column product_id drop not null,
 add column source_system text not null default 'mhelpdesk_product_import',
 add column source_record_id text,
 add column source_provenance jsonb,
 add column source_customer_label text check(source_customer_label is null or (length(source_customer_label) between 1 and 250 and source_customer_label=btrim(source_customer_label) and source_customer_label!~'[[:cntrl:]<>@=]' and source_customer_label!~*'https?:|password|passwd|pwd|token|secret|credential|gate[[:space:]-]*code|access[[:space:]-]*code'));
alter table app_private.cos_geocode_source_events
 alter column product_id drop not null,
 add column source_system text not null default 'mhelpdesk_product_import',
 add column source_record_id text;
create function app_private.cos_tracker_source_record_id_valid(p_id text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(p_id)<=400 and p_id~'^google_sheet:[A-Za-z0-9_-]{10,128}:(0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$',false)
$$;
alter table app_private.cos_geocode_sources add constraint cos_source_typed_identity check(
 (source_system='mhelpdesk_product_import' and product_id is not null and source_record_id is null and source_provenance is null and source_customer_label is null)
 or (source_system='google_sheet_tracker' and entity_kind='tracker' and product_id is null
  and app_private.cos_tracker_source_record_id_valid(source_record_id) and source_provenance is not null and jsonb_typeof(source_provenance)='object'));
create unique index cos_source_system_record_identity on app_private.cos_geocode_sources(organization_id,source_system,coalesce(source_record_id,product_id));


create or replace function app_private.cos_source_record(p app_private.cos_geocode_sources)
returns jsonb language sql stable strict set search_path='' as $$
 select jsonb_build_object('schemaVersion',case when p.source_system='mhelpdesk_product_import' then 1 else 2 end,'organizationId',p.organization_id,'sourceSystem',p.source_system,
 'entityKind',p.entity_kind,'nativeUnitId',p.native_unit_id,
 'sourceRevision',p.source_revision,'eventId',p.event_id::text,'eligibility',p.eligibility)
 || case when p.source_system='mhelpdesk_product_import' then jsonb_build_object('productId',p.product_id) else jsonb_build_object('sourceRecordId',p.source_record_id) end
 || case when p.eligibility='FIELD' then jsonb_build_object('unitNumber',p.unit_number,'family',p.family,'variant',p.variant,
 'sourceFileSha256',p.source_file_sha256,'sourceRowSha256',p.source_row_sha256,'addressSha256',p.address_sha256,
 'nativeGuardSha256',p.native_guard_sha256,'suppliedComponents',jsonb_build_object('street',true,'city',p.city is not null,'state',true,'zip',p.zip is not null),'installation',jsonb_build_object('street',p.street,'city',p.city,'state',p.state,'zip',p.zip)) else '{}'::jsonb end
$$;

create or replace function app_private.cos_source_change_event()
returns trigger language plpgsql set search_path='' as $$
declare existing app_private.cos_geocode_sources;
begin
 -- INSERT ... ON CONFLICT runs BEFORE INSERT even on the UPDATE path.
 -- Do not publish a phantom event before the eventual no-op/conflict update.
 if tg_op='INSERT' then
  select * into existing from app_private.cos_geocode_sources where native_unit_id=new.native_unit_id;
  if found then new.source_revision:=existing.source_revision;new.event_id:=existing.event_id;return new;end if;
 end if;
 if tg_op='UPDATE' then
  if row(new.native_unit_id,new.entity_kind,new.tracker_id,new.product_id,new.source_system,new.source_record_id,new.unit_number,new.tracker_unit_number,new.family,new.variant)
   is distinct from row(old.native_unit_id,old.entity_kind,old.tracker_id,old.product_id,old.source_system,old.source_record_id,old.unit_number,old.tracker_unit_number,old.family,old.variant) then
   raise exception 'Source identity bindings are immutable.' using errcode='22023'; end if;
  if (to_jsonb(new)-'source_revision'-'event_id'-'imported_at')=(to_jsonb(old)-'source_revision'-'event_id'-'imported_at') then
   new.source_revision:=old.source_revision;new.event_id:=old.event_id;new.imported_at:=old.imported_at;return new; end if;
 end if;
 -- No global row/advisory lock: native multi-statement writers keep their
 -- existing lock graph. Late commits are recovered by the next full scan.
 new.event_id:=nextval('app_private.cos_geocode_source_event_id_seq');
 new.source_revision:=gen_random_uuid();new.imported_at:=clock_timestamp();
 insert into app_private.cos_geocode_source_events(event_id,organization_id,entity_kind,native_unit_id,product_id,source_revision,kind,source_system,source_record_id) values(new.event_id,new.organization_id,new.entity_kind,new.native_unit_id,new.product_id,new.source_revision,
  case when new.eligibility='FIELD' then 'upsert' else 'tombstone' end,new.source_system,new.source_record_id);
 return new;
end $$;

create or replace function app_private.cos_source_native_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_label text; new_label text; old_id uuid; new_id uuid;
begin
 if tg_op<>'INSERT' then old_label:=old.unit_number;old_id:=old.id;end if;
 if tg_op<>'DELETE' then new_label:=new.unit_number;new_id:=new.id;end if;
 update app_private.cos_geocode_sources s set eligibility='tombstone',active=false
 where s.active and (s.native_unit_id in (old_id,new_id) or s.tracker_id in (old_id,new_id)
  or app_private.cos_source_label(s.unit_number) in (app_private.cos_source_label(old_label),app_private.cos_source_label(new_label)))
 and (s.native_guard_sha256 is distinct from app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number)
  or (s.source_system='google_sheet_tracker' and tg_op='UPDATE' and tg_table_schema='app_private' and tg_table_name='vision_tracker_locations'
   and (to_jsonb(old)->>'customer') is distinct from (to_jsonb(new)->>'customer')));
 return null;
end $$;

create or replace function public.cos_geocode_sources_list_changes(p_organization_id uuid,p_after_event_id text,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; last_id text;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 if p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$' or p_after_event_id::numeric>9223372036854775807
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid bounded source cursor.' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',e.event_id::text,'entityKind',e.entity_kind,'nativeUnitId',e.native_unit_id,
  'sourceRevision',e.source_revision,'kind',case when e.eligibility='FIELD' then 'upsert' else 'tombstone' end)||case when e.source_system='mhelpdesk_product_import' then jsonb_build_object('productId',e.product_id) else jsonb_build_object('sourceSystem',e.source_system,'sourceRecordId',e.source_record_id) end order by e.event_id),'[]'),max(e.event_id)::text into result,last_id
 from (select * from app_private.cos_geocode_sources where organization_id=p_organization_id and event_id>p_after_event_id::bigint order by event_id limit p_limit) e;
 return jsonb_build_object('events',result,'nextEventId',coalesce(last_id,p_after_event_id));
end $$;

create or replace function public.cos_geocode_sources_read_current_batch(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i jsonb; current_source jsonb;result jsonb:='[]';
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 100 then raise exception 'Invalid source batch.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision','sourceSystem','sourceRecordId'])<>'{}'::jsonb
   or coalesce(i->>'entityKind','') not in ('equipment_unit','tracker') or not coalesce((i->>'sourceSystem'='google_sheet_tracker' and i->>'entityKind'='tracker' and not (i ? 'productId') and app_private.cos_tracker_source_record_id_valid(i->>'sourceRecordId')
    or coalesce(i->>'sourceSystem','mhelpdesk_product_import')='mhelpdesk_product_import' and not (i ? 'sourceRecordId') and coalesce(i->>'productId','')~'^[1-9][0-9]{0,18}$'),false)
   or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(i->>'sourceRevision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid source identity.' using errcode='22023';end if;
  if i->>'sourceSystem'='google_sheet_tracker' then
   select app_private.cos_source_record(s) into current_source from app_private.cos_geocode_sources s
    where s.organization_id=p_organization_id and s.entity_kind=i->>'entityKind' and s.native_unit_id=(i->>'nativeUnitId')::uuid
     and s.source_system='google_sheet_tracker' and s.source_record_id=i->>'sourceRecordId' and s.source_revision=(i->>'sourceRevision')::uuid
     and (s.eligibility='tombstone' or s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number));
   result:=result||jsonb_build_array(current_source);
  else
  result:=result||jsonb_build_array(public.cos_geocode_sources_read_current(p_organization_id,i->>'entityKind',(i->>'nativeUnitId')::uuid,i->>'productId',(i->>'sourceRevision')::uuid)->'source');
  end if;
 end loop;
 return jsonb_build_object('sources',result);
end $$;

create or replace function public.cos_geocode_sources_map_projection(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 perform public.cos_geocode_sources_read_many(p_organization_id,p_identities);
 select coalesce(jsonb_agg(app_private.cos_source_record(s)||jsonb_build_object('entityKind',s.entity_kind,'nativeUnitId',s.native_unit_id,
  'sourceRevision',s.source_revision,'eventId',s.event_id::text,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,
  'nativeGuardSha256',s.native_guard_sha256,'unitNumber',s.unit_number,'placement',s.source_placement,'siteLabel',s.site_label,
  'nativeSourceIdentity',case when s.entity_kind='equipment_unit' then jsonb_build_object('contract','COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',
   'nativeUnitId',s.native_unit_id,'productId',s.product_id,'unitNumber',s.unit_number,'trackerId',s.tracker_id,'trackerUnitNumber',s.tracker_unit_number,
   'sourceRevision',s.source_revision,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,'nativeGuardSha256',s.native_guard_sha256) else null end,
  'installation',case when s.source_placement='FIELD' then jsonb_build_object('street',s.street,'city',s.city,'state',s.state,'zip',s.zip) else null end,
  'addressSha256',case when s.source_placement='FIELD' then s.address_sha256 else null end,
  'suppliedComponents',case when s.source_placement='FIELD' then jsonb_build_object('street',true,'city',s.city is not null,'state',true,'zip',s.zip is not null) else null end)||case when s.source_system='google_sheet_tracker' then jsonb_build_object('customerLabel',s.source_customer_label) else '{}'::jsonb end order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.active
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;

create or replace function app_private.cos_tracker_sources_admin_import_reviewed(p_organization_id uuid,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; old_source app_private.cos_geocode_sources; source app_private.cos_geocode_sources;
 v_id uuid;v_tracker uuid;v_guard text;v_result jsonb:='[]';v_address text;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 250 then raise exception 'Invalid reviewed batch.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'nativeUnitId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'sourceRecordId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'trackerId' having count(*)>1) then raise exception 'Ambiguous reviewed batch.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_records) x where x->'createTracker'='true'::jsonb) then
  -- Fail fast: a native writer may already hold these tables in the opposite order.
  -- The caller rolls back the failed admission and refreshes/retries separately.
  lock table public.equipment_units,app_private.vision_tracker_locations in share row exclusive mode nowait;
 end if;
 -- Prelock the complete reviewed batch in deterministic order before mutations.
 -- Source event IDs use a sequence; native writers never acquire a global clock.
 for v_id in select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records) order by 1 loop
  if v_id is null then raise exception 'Native identity required.' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
 end loop;
 perform u.id from public.equipment_units u where u.id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by u.id for share;
 perform t.id from app_private.vision_tracker_locations t where t.id in (select (value->>'trackerId')::uuid from jsonb_array_elements(p_records)) order by t.id for share;
 perform s.native_unit_id from app_private.cos_geocode_sources s where s.native_unit_id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by s.native_unit_id for update;
 for r in select value from jsonb_array_elements(p_records) order by value->>'nativeUnitId' loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['entityKind','nativeUnitId','trackerId','sourceSystem','sourceRecordId','sourceProvenance','createTracker','unitNumber','trackerUnitNumber','family','trackerFamily','variant','sourceFileSha256','sourceRowSha256','installation','addressSha256','nativeGuardSha256','suppliedComponents','previousSourceRevision','placement','siteLabel','customerLabel'])<>'{}'::jsonb
   or r->>'entityKind' is distinct from 'tracker' or coalesce(r->>'placement','') not in ('FIELD','SHOP')
   or r->>'sourceSystem' is distinct from 'google_sheet_tracker' or not app_private.cos_tracker_source_record_id_valid(r->>'sourceRecordId')
   or (r->'createTracker' is distinct from 'true'::jsonb and coalesce(r->>'nativeGuardSha256','')!~'^[a-f0-9]{64}$') then raise exception 'Invalid reviewed source.' using errcode='22023';end if;
  v_id:=(r->>'nativeUnitId')::uuid;v_tracker:=(r->>'trackerId')::uuid;
  if v_id is distinct from v_tracker or r->>'unitNumber' is distinct from r->>'trackerUnitNumber'
   or jsonb_typeof(r->'sourceProvenance') is distinct from 'object'
   or ((r->'sourceProvenance')-array['sheetId','tabId','fullIdentity','sourceRange'])<>'{}'::jsonb
   or (select count(*) from jsonb_object_keys(r->'sourceProvenance'))<>4
   or r->>'sourceRecordId' is distinct from concat('google_sheet:',r#>>'{sourceProvenance,sheetId}',':',r#>>'{sourceProvenance,tabId}',':',r#>>'{sourceProvenance,fullIdentity}')
   or coalesce(r#>>'{sourceProvenance,sourceRange}','')!~'^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$'
   or exists(select 1 from jsonb_each(r->'sourceProvenance') x where jsonb_typeof(x.value) is distinct from 'string')
   or r->>'family' is distinct from split_part(r#>>'{sourceProvenance,fullIdentity}','|',1)
   or r->>'unitNumber' is distinct from replace(r#>>'{sourceProvenance,fullIdentity}','|',' ')
   or substring(split_part(r#>>'{sourceProvenance,sourceRange}',':',1) from '[0-9]+') is distinct from substring(split_part(r#>>'{sourceProvenance,sourceRange}',':',2) from '[0-9]+')
   then raise exception 'Invalid typed tracker provenance.' using errcode='22023';end if;
  if r ? 'createTracker' and jsonb_typeof(r->'createTracker') is distinct from 'boolean' then raise exception 'Invalid tracker creation flag.' using errcode='22023';end if;
  if r->'createTracker'='true'::jsonb then
   if coalesce(length(r->>'trackerFamily'),0) not between 1 and 160 or r->>'trackerFamily' is distinct from btrim(r->>'trackerFamily') or r->>'trackerFamily'~'[[:cntrl:]<>]' then raise exception 'Reviewed tracker display family required.' using errcode='22023';end if;
   if r->>'previousSourceRevision' is not null or r->>'nativeGuardSha256' is not null then raise exception 'New tracker must be unbound.' using errcode='22023';end if;
   if exists(select 1 from public.equipment_units u where u.id=v_id or u.organization_id=p_organization_id and app_private.cos_source_label(u.unit_number)=app_private.cos_source_label(r->>'unitNumber'))
    or exists(select 1 from app_private.vision_tracker_locations t where t.organization_id=p_organization_id and (t.id=v_tracker or app_private.cos_source_label(t.unit_number)=app_private.cos_source_label(r->>'unitNumber')))
    then raise exception 'Tracker target or full identity already exists.' using errcode='40001';end if;
   insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement,customer,site,address,source_name,imported_at)
    values(v_tracker,p_organization_id,r->>'unitNumber',r->>'trackerFamily',r->>'placement',r->>'customerLabel',r->>'siteLabel',
     case when r->>'placement'='FIELD' then concat_ws(', ',r#>>'{installation,street}',r#>>'{installation,city}',concat_ws(' ',r#>>'{installation,state}',r#>>'{installation,zip}')) end,
     'Google Sheet tracker source',clock_timestamp());
  end if;
  select * into old_source from app_private.cos_geocode_sources where native_unit_id=v_id for update;
  if found and old_source.source_revision is distinct from (r->>'previousSourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  if not found and r->>'previousSourceRevision' is not null then raise exception 'Source revision changed.' using errcode='40001';end if;
  v_guard:=app_private.cos_source_native_guard(r->>'entityKind',v_id,v_tracker,r->>'unitNumber',r->>'trackerUnitNumber');
  if v_guard is null or (r->'createTracker' is distinct from 'true'::jsonb and v_guard is distinct from r->>'nativeGuardSha256') then raise exception 'Native placement or GPS changed.' using errcode='40001';end if;
  if r->>'placement'='FIELD' then
  if jsonb_typeof(r->'installation') is distinct from 'object' or ((r->'installation')-array['street','city','state','zip'])<>'{}'::jsonb
   or coalesce(r#>>'{installation,street}','')!~'^[0-9]{1,8}[A-Za-z]? +[A-Za-z0-9 .''-]+$'
   or ((r#>>'{installation,city}') is not null and (r#>>'{installation,city}')!~'^[A-Za-z][A-Za-z .''-]*$')
   or (r#>>'{installation,street}') is distinct from btrim(r#>>'{installation,street}')
   or (r#>>'{installation,city}') is distinct from btrim(r#>>'{installation,city}')
   or (r#>>'{installation,street}')~'[0-9]{3}[ .)-]+[0-9]{3}[ .-]+[0-9]{4}'
   or (r#>>'{installation,street}')~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\M'
   or (r#>>'{installation,city}')~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\M'
   or concat_ws(' ',r#>>'{installation,street}',r#>>'{installation,city}')~*'(password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox)[[:alnum:]_-]*|(gate|access)[[:space:]-]*code[[:alnum:]_-]*'
   or (r->'installation')::text~'\\u00[0-1][0-9a-f]' then raise exception 'Unsafe installation address.' using errcode='22023';end if;
  if r ? 'suppliedComponents' and r->'suppliedComponents' is distinct from jsonb_build_object('street',true,'city',r#>>'{installation,city}' is not null,'state',true,'zip',r#>>'{installation,zip}' is not null) then raise exception 'Supplied address mask mismatch.' using errcode='22023';end if;
  v_address:=app_private.cos_source_address(r#>>'{installation,street}',r#>>'{installation,city}',r#>>'{installation,state}',r#>>'{installation,zip}');
  if r->>'addressSha256' is distinct from encode(sha256(convert_to(v_address,'UTF8')),'hex') then raise exception 'Address digest mismatch.' using errcode='22023';end if;
  elsif r->'installation' is not null and r->'installation'<>'null'::jsonb or r->>'addressSha256' is not null then raise exception 'Shop has no geocoding address.' using errcode='22023';end if;
  insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,source_system,source_record_id,source_provenance,source_customer_label,unit_number,tracker_unit_number,family,variant,
   site_label,source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id)
  values(p_organization_id,r->>'entityKind',v_id,v_tracker,null,'google_sheet_tracker',r->>'sourceRecordId',r->'sourceProvenance',r->>'customerLabel',r->>'unitNumber',r->>'trackerUnitNumber',r->>'family',r->>'variant',
   r->>'siteLabel',r->>'sourceFileSha256',r->>'sourceRowSha256',r#>>'{installation,street}',r#>>'{installation,city}',r#>>'{installation,state}',r#>>'{installation,zip}',r->>'addressSha256',v_guard,r->>'placement',true,case when r->>'placement'='FIELD' then 'FIELD' else 'tombstone' end,gen_random_uuid(),0)
  on conflict(native_unit_id) do update set entity_kind=excluded.entity_kind,tracker_id=excluded.tracker_id,product_id=excluded.product_id,source_system=excluded.source_system,source_record_id=excluded.source_record_id,source_provenance=excluded.source_provenance,source_customer_label=excluded.source_customer_label,
   unit_number=excluded.unit_number,tracker_unit_number=excluded.tracker_unit_number,family=excluded.family,variant=excluded.variant,
   site_label=excluded.site_label,source_file_sha256=excluded.source_file_sha256,source_row_sha256=excluded.source_row_sha256,street=excluded.street,city=excluded.city,state=excluded.state,zip=excluded.zip,
   address_sha256=excluded.address_sha256,native_guard_sha256=excluded.native_guard_sha256,source_placement=excluded.source_placement,active=true,eligibility=excluded.eligibility
  returning * into source;
  v_result:=v_result||jsonb_build_array(app_private.cos_source_record(source));
 end loop;
 return v_result;
end $$;

create or replace function app_private.cos_tracker_sources_admin_revoke_reviewed(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i jsonb; s app_private.cos_geocode_sources; result jsonb:='[]'; v_id uuid;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 250 then raise exception 'Invalid source revocations.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x group by x->>'nativeUnitId' having count(*)>1) then raise exception 'Duplicate source revocation.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) order by value->>'nativeUnitId' loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','sourceSystem','sourceRecordId','sourceRevision'])<>'{}'::jsonb then raise exception 'Invalid source revocation.' using errcode='22023';end if;
  v_id:=(i->>'nativeUnitId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
  select * into s from app_private.cos_geocode_sources where organization_id=p_organization_id and native_unit_id=v_id for update;
  if not found or s.entity_kind is distinct from i->>'entityKind' or s.source_system is distinct from 'google_sheet_tracker' or i->>'sourceSystem' is distinct from s.source_system or s.source_record_id is distinct from i->>'sourceRecordId'
   or s.source_revision is distinct from (i->>'sourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=v_id returning * into s;
  result:=result||jsonb_build_array(app_private.cos_source_record(s));
 end loop;
 return result;
end $$;

revoke all on function app_private.cos_tracker_source_record_id_valid(text),app_private.cos_tracker_sources_admin_import_reviewed(uuid,jsonb),app_private.cos_tracker_sources_admin_revoke_reviewed(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function app_private.cos_geocode_sources_admin_revoke_reviewed(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare i jsonb; s app_private.cos_geocode_sources; result jsonb:='[]'; v_id uuid;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 250 then raise exception 'Invalid source revocations.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_sources) x group by x->>'nativeUnitId' having count(*)>1) then raise exception 'Duplicate source revocation.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) order by value->>'nativeUnitId' loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision'])<>'{}'::jsonb then raise exception 'Invalid source revocation.' using errcode='22023';end if;
  v_id:=(i->>'nativeUnitId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
  select * into s from app_private.cos_geocode_sources where organization_id=p_organization_id and native_unit_id=v_id for update;
  if not found or s.source_system is distinct from 'mhelpdesk_product_import' or s.entity_kind is distinct from i->>'entityKind' or s.product_id is distinct from i->>'productId'
   or s.source_revision is distinct from (i->>'sourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=v_id returning * into s;
  result:=result||jsonb_build_array(app_private.cos_source_record(s));
 end loop;
 return result;
end $$;
-- Replaced functions retain their scoped existing grants. No new bridge actions.
commit;
