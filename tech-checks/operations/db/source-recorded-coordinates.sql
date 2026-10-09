-- Native project only. Literal source coordinates; no provider, GPS, identity or source-address writes.
-- Apply after cos-geocode-sources.sql and cos-geocode-sources-read-access.sql.
begin;
create table app_private.cos_source_recorded_coordinates (
 record_id uuid primary key default gen_random_uuid(),
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 entity_kind text not null check(entity_kind in ('tracker','equipment_unit')),
 native_unit_id uuid not null, tracker_id uuid not null,
 payload jsonb not null, active boolean not null default true,
 applied_at timestamptz not null default clock_timestamp(),
 applied_by_database_role text not null default current_user check(applied_by_database_role='postgres')
);
create unique index cos_source_recorded_coordinates_active on app_private.cos_source_recorded_coordinates(native_unit_id) where active;
create unique index cos_source_recorded_coordinates_active_product on app_private.cos_source_recorded_coordinates((payload->>'productId')) where active;
alter table app_private.cos_source_recorded_coordinates enable row level security;
revoke all on app_private.cos_source_recorded_coordinates from public,anon,authenticated,service_role;

-- Used only to reject duplicate aliases. Never an identity lookup or join.
create function app_private.cos_recorded_coordinate_concern(p_label text)
returns text language sql immutable strict set search_path='' as $$
 select case when m is null then app_private.cos_source_label(p_label) else
  app_private.cos_source_label(m[1])||'|'||(m[2]::numeric)::text||coalesce(m[3],'')||coalesce(lower(m[4]),'') end
 from (select regexp_match(upper(btrim(p_label)),'^(.+?[^0-9])([0-9]+)([.][0-9]+)?(HD4|HDC[24]S?)?$') m) x
$$;

-- Explicit source category aliases; preserve the original family text in bindings.
-- Do not strip plural suffixes or normalize an arbitrary asset identity.
create function app_private.cos_recorded_coordinate_family(p_family text)
returns text language sql immutable strict set search_path='' as $$
 select case app_private.cos_source_label(p_family)
  when 'solarstands72' then 'solarstand72'
  when 'solarpoles72' then 'solarpole72'
  when 'solarskids144' then 'solarskid144'
  else app_private.cos_source_label(p_family) end
$$;

-- Recomputed at administrator review/import and every read. Null means held.
-- A newly added, revoked or changed imported source changes this binding even
-- when its street happens to be unchanged. Native/tracker movement is also sealed.
create function app_private.cos_recorded_coordinate_binding(p_kind text,p_id uuid,p_tracker uuid,p_unit text,p_tracker_unit text,p_product text,p_family text)
returns jsonb language plpgsql stable set search_path='' as $$
declare t record;s app_private.cos_geocode_sources;guard text;address text;source_binding jsonb;concern text;
begin
 guard:=app_private.cos_source_native_guard(p_kind,p_id,p_tracker,p_unit,p_tracker_unit);
 if guard is null then return null;end if;
 select v.placement,v.address,v.family into t from app_private.vision_tracker_locations v where v.id=p_tracker;
 if t.placement is distinct from 'FIELD' or t.family is distinct from p_family or nullif(btrim(t.address),'') is null then return null;end if;
 if length(t.address)>600 or t.address~'[[:cntrl:]<>@=]' or t.address~*'https?:|password|passwd|pwd|token|secret|credential|gate|access[[:space:]-]*code|lockbox|passcode|login|phone|email' then return null;end if;
 -- Product identity is a denial constraint, never a label-derived binding.
 if exists(select 1 from app_private.cos_geocode_sources x where x.product_id=p_product and (x.native_unit_id<>p_id or x.tracker_id<>p_tracker or x.entity_kind<>p_kind))
  or exists(select 1 from app_private.cos_source_recorded_coordinates x where x.active and x.payload->>'productId'=p_product and (x.native_unit_id<>p_id or x.tracker_id<>p_tracker or x.entity_kind<>p_kind)) then return null;end if;
 concern:=app_private.cos_recorded_coordinate_concern(p_unit);
 if (select count(*) from app_private.vision_tracker_locations x where x.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  and app_private.cos_recorded_coordinate_concern(x.unit_number)=app_private.cos_recorded_coordinate_concern(p_tracker_unit))<>1
  or exists(select 1 from public.equipment_units x where x.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' and x.id<>p_id and app_private.cos_recorded_coordinate_concern(x.unit_number)=concern) then return null;end if;
 select * into s from app_private.cos_geocode_sources where native_unit_id=p_id;
 if found then
  if s.entity_kind is distinct from p_kind or s.tracker_id is distinct from p_tracker or s.product_id is distinct from p_product
   or s.unit_number is distinct from p_unit or s.tracker_unit_number is distinct from p_tracker_unit or app_private.cos_recorded_coordinate_family(s.family) is distinct from app_private.cos_recorded_coordinate_family(p_family)
   or not s.active or s.eligibility<>'FIELD' or s.source_placement<>'FIELD' or s.native_guard_sha256<>guard then return null;end if;
  address:=concat_ws(', ',s.street,s.city,concat_ws(' ',s.state,s.zip));
  source_binding:=jsonb_build_object('family',s.family,'sourceRevision',s.source_revision,'eventId',s.event_id::text,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,'addressSha256',s.address_sha256,'nativeGuardSha256',s.native_guard_sha256);
 else address:=t.address;source_binding:=null;end if;
 return jsonb_build_object('productSourceEventId',(select max(e.event_id)::text from app_private.cos_geocode_source_events e where e.product_id=p_product),'trackerFamily',t.family,'nativeGuardSha256',guard,'currentSource',source_binding,'installationAddress',address,
  'addressSha256',encode(sha256(convert_to(lower(btrim(regexp_replace(address,'\s+',' ','g'))),'UTF8')),'hex'),
  'trackerAddressSha256',encode(sha256(convert_to(lower(btrim(regexp_replace(t.address,'\s+',' ','g'))),'UTF8')),'hex'));
end $$;

-- Administrator-only CAS import; history is retained. The actor is the actual
-- postgres administrator, never a fabricated Owner or service JWT.
create function app_private.cos_source_recorded_coordinates_admin_import(p_organization_id uuid,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;b jsonb;old_record uuid;new_record uuid;v_id uuid;result jsonb:='[]';
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 250 then raise exception 'Invalid recorded coordinate batch.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'nativeUnitId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'trackerId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'productId' having count(*)>1) then raise exception 'Duplicate recorded coordinate identity.' using errcode='22023';end if;
 for v_id in select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
 end loop;
 perform id from public.equipment_units where id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by id for share;
 perform id from app_private.vision_tracker_locations where id in (select (value->>'trackerId')::uuid from jsonb_array_elements(p_records)) order by id for share;
 perform native_unit_id from app_private.cos_geocode_sources where native_unit_id in (select (value->>'nativeUnitId')::uuid from jsonb_array_elements(p_records)) order by native_unit_id for share;
 for r in select value from jsonb_array_elements(p_records) order by value->>'nativeUnitId' loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['entityKind','nativeUnitId','trackerId','productId','unitNumber','trackerUnitNumber','family','typedIdentity','sourceSpreadsheetId','sourceSheetId','coordinateCell','coordinateCellSha256','sourceFileSha256','sourceRowSha256','sourceObservedAt','sourceAddressSha256','latitude','longitude','binding','legacyEvidenceSha256','previousRecordId'])<>'{}'::jsonb
   or coalesce(r->>'entityKind','') not in ('tracker','equipment_unit') or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,18}$'
   or jsonb_typeof(r->'sourceSheetId') is distinct from 'string' or coalesce(r->>'sourceSpreadsheetId','')!~'^[A-Za-z0-9_-]{20,100}$' or coalesce(r->>'sourceSheetId','')!~'^[0-9]{1,12}$'
   or coalesce(r->>'coordinateCell','')!~'^[A-Z]{1,3}[1-9][0-9]{0,6}$'
   or coalesce(r->>'typedIdentity','')!~'^typed:[A-Z0-9]+[|][1-9][0-9]*([.][0-9]+)?([|](HD4|HDC[24]S?))?$'
   or exists(select 1 from unnest(array['coordinateCellSha256','sourceFileSha256','sourceRowSha256','sourceAddressSha256','legacyEvidenceSha256']) k where coalesce(r->>k,'')!~'^[a-f0-9]{64}$')
   or exists(select 1 from unnest(array['unitNumber','trackerUnitNumber','family']) k where nullif(btrim(r->>k),'') is null or length(r->>k)>160 or (r->>k)~'[[:cntrl:]<>]')
   or jsonb_typeof(r->'latitude') is distinct from 'number' or jsonb_typeof(r->'longitude') is distinct from 'number'
   or (r->>'latitude')::numeric not between -90 and 90 or (r->>'longitude')::numeric not between -180 and 180
   or coalesce(r->>'sourceObservedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or (r->>'sourceObservedAt')::timestamptz>clock_timestamp()
   then raise exception 'Invalid recorded coordinate provenance.' using errcode='22023';end if;
  if app_private.cos_recorded_coordinate_concern(r->>'unitNumber') is distinct from app_private.cos_recorded_coordinate_concern(r->>'trackerUnitNumber')
   or app_private.cos_recorded_coordinate_concern(r->>'unitNumber') is distinct from regexp_replace(lower(substring(r->>'typedIdentity' from 7)),'[|](hd4|hdc[24]s?)$','\1') then raise exception 'Typed coordinate identity mismatch.' using errcode='22023';end if;
  b:=app_private.cos_recorded_coordinate_binding(r->>'entityKind',(r->>'nativeUnitId')::uuid,(r->>'trackerId')::uuid,r->>'unitNumber',r->>'trackerUnitNumber',r->>'productId',r->>'family');
  if b is null or b is distinct from r->'binding' then raise exception 'Current source or native binding changed.' using errcode='40001';end if;
  if b->>'trackerAddressSha256' is distinct from r->>'sourceAddressSha256' then raise exception 'Source address changed.' using errcode='40001';end if;
  select record_id into old_record from app_private.cos_source_recorded_coordinates where native_unit_id=(r->>'nativeUnitId')::uuid order by applied_at desc,record_id desc limit 1 for update;
  if old_record is distinct from (r->>'previousRecordId')::uuid then raise exception 'Recorded coordinate revision changed.' using errcode='40001';end if;
  update app_private.cos_source_recorded_coordinates set active=false where record_id=old_record;
  insert into app_private.cos_source_recorded_coordinates(organization_id,entity_kind,native_unit_id,tracker_id,payload)
   values(p_organization_id,r->>'entityKind',(r->>'nativeUnitId')::uuid,(r->>'trackerId')::uuid,r-'previousRecordId') returning record_id into new_record;
  result:=result||jsonb_build_array(jsonb_build_object('nativeUnitId',r->>'nativeUnitId','recordId',new_record));
 end loop;
 return result;
end $$;

-- Existing authorized native backend only. No new external source bridge fields.
create function public.cos_source_recorded_coordinates_read_many(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Source service access required.' using errcode='42501';end if;
 if jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities)>250 then raise exception 'Invalid coordinate identities.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_identities) i where jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId'])<>'{}'::jsonb
  or coalesce(i->>'entityKind','') not in ('tracker','equipment_unit') or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
  or exists(select 1 from jsonb_array_elements(p_identities) i group by i->>'nativeUnitId' having count(*)>1) then raise exception 'Invalid coordinate identity.' using errcode='22023';end if;
 select coalesce(jsonb_agg(c.payload||jsonb_build_object('schemaVersion',1,'organizationId',c.organization_id,'recordId',c.record_id,
  'source','tracker_recorded_coordinates','confidence','source_recorded_unverified','verified',false,'liveGps',false,'coordinateRecordedAt',null,
  'appliedAt',c.applied_at,'appliedByDatabaseRole',c.applied_by_database_role) order by c.native_unit_id),'[]') into result
 from app_private.cos_source_recorded_coordinates c where c.organization_id=p_organization_id and c.active
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=c.entity_kind and (i->>'nativeUnitId')::uuid=c.native_unit_id)
  and c.payload->'binding'=app_private.cos_recorded_coordinate_binding(c.entity_kind,c.native_unit_id,c.tracker_id,c.payload->>'unitNumber',c.payload->>'trackerUnitNumber',c.payload->>'productId',c.payload->>'family');
 return result;
end $$;
-- Invalidation is permanent, including move-away then move-back. These triggers
-- change only the new source ledger and never alter the native writer's values.
create function app_private.cos_source_recorded_coordinates_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb;after_row jsonb;old_id uuid;new_id uuid;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old);old_id:=coalesce(before_row->>'native_unit_id',before_row->>'id')::uuid;end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new);new_id:=coalesce(after_row->>'native_unit_id',after_row->>'id')::uuid;end if;
 update app_private.cos_source_recorded_coordinates c set active=false where c.active
  and (c.native_unit_id in (old_id,new_id) or c.tracker_id in (old_id,new_id)
   or c.payload->>'productId' in (before_row->>'product_id',after_row->>'product_id')
   or app_private.cos_recorded_coordinate_concern(c.payload->>'unitNumber') in (app_private.cos_recorded_coordinate_concern(before_row->>'unit_number'),app_private.cos_recorded_coordinate_concern(after_row->>'unit_number')))
  and c.payload->'binding' is distinct from app_private.cos_recorded_coordinate_binding(c.entity_kind,c.native_unit_id,c.tracker_id,c.payload->>'unitNumber',c.payload->>'trackerUnitNumber',c.payload->>'productId',c.payload->>'family');
 return coalesce(new,old);
end $$;
create trigger cos_recorded_coordinate_native_changed after insert or update or delete on public.equipment_units for each row execute function app_private.cos_source_recorded_coordinates_changed();
create trigger cos_recorded_coordinate_tracker_changed after insert or update or delete on app_private.vision_tracker_locations for each row execute function app_private.cos_source_recorded_coordinates_changed();
create trigger cos_recorded_coordinate_source_changed after insert or update or delete on app_private.cos_geocode_sources for each row execute function app_private.cos_source_recorded_coordinates_changed();
revoke all on function app_private.cos_source_recorded_coordinates_changed() from public,anon,authenticated,service_role;

revoke all on function app_private.cos_recorded_coordinate_concern(text),app_private.cos_recorded_coordinate_family(text),app_private.cos_recorded_coordinate_binding(text,uuid,uuid,text,text,text,text),app_private.cos_source_recorded_coordinates_admin_import(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cos_source_recorded_coordinates_read_many(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_source_recorded_coordinates_read_many(uuid,jsonb) to service_role;
commit;
