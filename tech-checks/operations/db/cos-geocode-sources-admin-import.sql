-- Native SQL administrator only. Separate from read-key and service API access.

-- Apply after cos-geocode-sources.sql. Existing reviewed identity/revision/lock guards are unchanged.

-- No app_private USAGE, table permissions, frontend route, or service_role EXECUTE is granted.

begin;

create function app_private.cos_geocode_sources_admin_import_reviewed(p_organization_id uuid,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; old_source app_private.cos_geocode_sources; source app_private.cos_geocode_sources;
 v_id uuid;v_tracker uuid;v_guard text;v_result jsonb:='[]';v_address text;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 250 then raise exception 'Invalid reviewed batch.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'nativeUnitId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'productId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'trackerId' having count(*)>1) then raise exception 'Ambiguous reviewed batch.' using errcode='22023';end if;
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
  if jsonb_typeof(r) is distinct from 'object' or (r-array['entityKind','nativeUnitId','trackerId','productId','unitNumber','trackerUnitNumber','family','variant','sourceFileSha256','sourceRowSha256','installation','addressSha256','nativeGuardSha256','suppliedComponents','previousSourceRevision','placement','siteLabel'])<>'{}'::jsonb
   or r->>'entityKind' not in ('equipment_unit','tracker') or coalesce(r->>'placement','') not in ('FIELD','SHOP')
   or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,18}$'
   or coalesce(r->>'nativeGuardSha256','')!~'^[a-f0-9]{64}$' then raise exception 'Invalid reviewed source.' using errcode='22023';end if;
  v_id:=(r->>'nativeUnitId')::uuid;v_tracker:=(r->>'trackerId')::uuid;
  select * into old_source from app_private.cos_geocode_sources where native_unit_id=v_id for update;
  if found and old_source.source_revision is distinct from (r->>'previousSourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  if not found and r->>'previousSourceRevision' is not null then raise exception 'Source revision changed.' using errcode='40001';end if;
  v_guard:=app_private.cos_source_native_guard(r->>'entityKind',v_id,v_tracker,r->>'unitNumber',r->>'trackerUnitNumber');
  if v_guard is null or v_guard<>r->>'nativeGuardSha256' then raise exception 'Native placement or GPS changed.' using errcode='40001';end if;
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
  insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,variant,
   site_label,source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id)
  values(p_organization_id,r->>'entityKind',v_id,v_tracker,r->>'productId',r->>'unitNumber',r->>'trackerUnitNumber',r->>'family',r->>'variant',
   r->>'siteLabel',r->>'sourceFileSha256',r->>'sourceRowSha256',r#>>'{installation,street}',r#>>'{installation,city}',r#>>'{installation,state}',r#>>'{installation,zip}',r->>'addressSha256',r->>'nativeGuardSha256',r->>'placement',true,case when r->>'placement'='FIELD' then 'FIELD' else 'tombstone' end,gen_random_uuid(),0)
  on conflict(native_unit_id) do update set entity_kind=excluded.entity_kind,tracker_id=excluded.tracker_id,product_id=excluded.product_id,
   unit_number=excluded.unit_number,tracker_unit_number=excluded.tracker_unit_number,family=excluded.family,variant=excluded.variant,
   site_label=excluded.site_label,source_file_sha256=excluded.source_file_sha256,source_row_sha256=excluded.source_row_sha256,street=excluded.street,city=excluded.city,state=excluded.state,zip=excluded.zip,
   address_sha256=excluded.address_sha256,native_guard_sha256=excluded.native_guard_sha256,source_placement=excluded.source_placement,active=true,eligibility=excluded.eligibility
  returning * into source;
  v_result:=v_result||jsonb_build_array(app_private.cos_source_record(source));
 end loop;
 return v_result;
end $$;

revoke all on function app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb) from public,anon,authenticated,service_role;

create function app_private.cos_geocode_sources_admin_revoke_reviewed(p_organization_id uuid,p_sources jsonb)
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
  if not found or s.entity_kind is distinct from i->>'entityKind' or s.product_id is distinct from i->>'productId'
   or s.source_revision is distinct from (i->>'sourceRevision')::uuid then raise exception 'Source revision changed.' using errcode='40001';end if;
  update app_private.cos_geocode_sources set active=false,eligibility='tombstone' where native_unit_id=v_id returning * into s;
  result:=result||jsonb_build_array(app_private.cos_source_record(s));
 end loop;
 return result;
end $$;

revoke all on function app_private.cos_geocode_sources_admin_revoke_reviewed(uuid,jsonb) from public,anon,authenticated,service_role;

commit;
