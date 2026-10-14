-- Synthetic test fixture only: exact generic deployed source/side-effect functions.
-- Do not execute this baseline against a production database.

CREATE OR REPLACE FUNCTION app_private.cos_archive_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare oldrow jsonb;newrow jsonb;p app_private.cos_archived_representations;old_id text;new_id text;is_old boolean;is_canonical boolean;changed boolean;tracked text[];
begin
 if tg_op='TRUNCATE' then
  insert into app_private.cos_archived_representation_revocations(representation_id,reason) select id,'native_or_source_changed' from app_private.cos_archived_representations on conflict do nothing;return null;
 end if;
 if tg_op<>'INSERT' then oldrow:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then newrow:=to_jsonb(new);end if;
 if oldrow is not distinct from newrow then return null;end if;
 old_id:=oldrow->>tg_argv[0];new_id:=newrow->>tg_argv[0];
 for p in select * from app_private.cos_archived_representations loop
  is_old:=coalesce(old_id in(p.archived_native_id::text,p.archived_tracker_id::text) or new_id in(p.archived_native_id::text,p.archived_tracker_id::text),false);
  is_canonical:=coalesce(old_id in(p.canonical_native_id::text,p.canonical_tracker_id::text) or new_id in(p.canonical_native_id::text,p.canonical_tracker_id::text),false);
  tracked:=null;changed:=false;
  if tg_table_name='equipment_models' then
   is_old:=coalesce(old_id=p.reviewed_before#>>'{oldNative,model_id}' or new_id=p.reviewed_before#>>'{oldNative,model_id}',false);
   is_canonical:=false;tracked:=array['id','name','category'];
  elsif tg_table_name='equipment_units' then
   tracked:=case when is_old then array['id','organization_id','unit_number','model_id','status','current_location_type','current_location_ref','installed_site_id','updated_at','gps_latitude','gps_longitude','gps_accuracy_m','gps_source','gps_recorded_at','gps_recorded_by','retired_at'] else array['id','organization_id','unit_number','model_id'] end;
   changed:=is_canonical and (newrow->>'status' in('retired','deleted') or newrow->>'retired_at' is not null);
  elsif tg_table_name='vision_tracker_locations' then
   tracked:=case when is_old then array['id','organization_id','unit_number','unit_key','family','placement','customer','site','address','latitude','longitude','coordinate_source','source_name','source_verified_at','imported_at','reviewed_estimate_epoch'] else array['id','organization_id','unit_number','unit_key','family'] end;
  elsif tg_table_name='cos_geocode_sources' then
   is_old:=is_old or coalesce(oldrow->>'tracker_id'=p.archived_tracker_id::text or newrow->>'tracker_id'=p.archived_tracker_id::text,false);
   is_canonical:=is_canonical or coalesce(oldrow->>'tracker_id'=p.canonical_tracker_id::text or newrow->>'tracker_id'=p.canonical_tracker_id::text,false);
   if not is_old then tracked:=array['organization_id','entity_kind','native_unit_id','tracker_id','product_id','unit_number','tracker_unit_number','family','variant','source_system','source_record_id'];end if;
  elsif tg_table_name='vision_vigilant_unit_matches' then
   tracked:=array['id','organization_id','equipment_unit_id','vigilant_device_id','camera_key'];
  elsif tg_table_name='vision_vigilant_devices' then
   is_old:=exists(select 1 from public.vision_vigilant_unit_matches m where m.equipment_unit_id=p.archived_native_id and m.vigilant_device_id::text in(old_id,new_id));
   is_canonical:=exists(select 1 from public.vision_vigilant_unit_matches m where m.equipment_unit_id=p.canonical_native_id and m.vigilant_device_id::text in(old_id,new_id));
   tracked:=array['id','organization_id','external_device_id','source','device_type'];
  elsif tg_table_name=any(array['equipment_unit_location_history','equipment_assignments','cos_owner_identity_claims','audit_events']) then
   -- Authorized retained-record operations do not alter its physical identity.
   is_canonical:=false;
   if tg_table_name='audit_events' and oldrow->>'entity_type' is distinct from 'equipment_units' and newrow->>'entity_type' is distinct from 'equipment_units' then is_old:=false;end if;
  end if;
  if not (is_old or is_canonical) then continue;end if;
  if tracked is null then changed:=true;
  else changed:=changed or tg_op in('INSERT','DELETE') or exists(select 1 from unnest(tracked) k where oldrow->k is distinct from newrow->k);end if;
  if changed then insert into app_private.cos_archived_representation_revocations(representation_id,reason) values(p.id,'native_or_source_changed') on conflict do nothing;end if;
 end loop;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION app_private.cos_recorded_coordinate_binding(p_kind text, p_id uuid, p_tracker uuid, p_unit text, p_tracker_unit text, p_product text, p_family text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.cos_recorded_coordinate_concern(p_label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
 select case when m is null then app_private.cos_source_label(p_label) else
  app_private.cos_source_label(m[1])||'|'||(m[2]::numeric)::text||coalesce(m[3],'')||coalesce(lower(m[4]),'') end
 from (select regexp_match(upper(btrim(p_label)),'^(.+?[^0-9])([0-9]+)([.][0-9]+)?(HD4|HDC[24]S?)?$') m) x
$function$;

CREATE OR REPLACE FUNCTION app_private.cos_source_change_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.cos_source_native_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.cos_source_recorded_coordinates_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;
