-- REVIEW ARTIFACT: native project, after source registry and Owner identity schema.
-- Generic presentation-only evidence. Private reviewed rows belong outside this repository.
-- No native, tracker, component, history, camera or provider record is changed.
begin;
create table app_private.cos_archived_representations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 archived_native_id uuid not null unique,
 canonical_native_id uuid not null unique,
 archived_tracker_id uuid not null unique,
 canonical_tracker_id uuid not null unique,
 reviewed_before jsonb not null,
 source_evidence jsonb not null,
 review_sha256 text not null check(review_sha256~'^[a-f0-9]{64}$'),
 evidence_sha256 text not null check(evidence_sha256~'^[a-f0-9]{64}$'),
 revision uuid not null default gen_random_uuid(),
 recorded_by_database_role text not null default current_user check(recorded_by_database_role='postgres'),
 recorded_at timestamptz not null default clock_timestamp(),
 provenance text not null default 'postgres_admin_reviewed_source_archive' check(provenance='postgres_admin_reviewed_source_archive'),
 check(archived_native_id<>canonical_native_id and archived_tracker_id<>canonical_tracker_id)
);
create table app_private.cos_archived_representation_revocations (
 representation_id uuid primary key references app_private.cos_archived_representations(id),
 revoked_at timestamptz not null default clock_timestamp(),
 reason text not null check(reason in ('native_or_source_changed','admin_revoked'))
);
alter table app_private.cos_archived_representations enable row level security;
alter table app_private.cos_archived_representation_revocations enable row level security;
revoke all on app_private.cos_archived_representations,app_private.cos_archived_representation_revocations from public,anon,authenticated,service_role;
create function app_private.cos_archive_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Archive evidence is immutable.' using errcode='42501'; end $$;
create trigger cos_archive_evidence_immutable before update or delete or truncate on app_private.cos_archived_representations for each statement execute function app_private.cos_archive_immutable();
create trigger cos_archive_revocations_immutable before update or delete or truncate on app_private.cos_archived_representation_revocations for each statement execute function app_private.cos_archive_immutable();

-- Exactly the reviewed allowlist, including update/import epochs; no notes or credentials.
create function app_private.cos_archive_native_before(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select to_jsonb(x) from (select u.id,u.organization_id,u.unit_number,u.model_id,m.name model_name,m.category model_category,u.status,u.current_location_type,u.current_location_ref,u.installed_site_id,u.updated_at,u.gps_latitude,u.gps_longitude,u.gps_accuracy_m,u.gps_source,u.gps_recorded_at,u.gps_recorded_by,u.retired_at from public.equipment_units u join public.equipment_models m on m.id=u.model_id where u.id=p_id)x
$$;
create function app_private.cos_archive_tracker_before(p_id uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select to_jsonb(x) from (select id,organization_id,unit_number,unit_key,family,placement,customer,site,address,latitude,longitude,coordinate_source,source_name,source_verified_at,imported_at,reviewed_estimate_epoch from app_private.vision_tracker_locations where id=p_id)x
$$;
create function app_private.cos_archive_before(p_old uuid,p_canonical uuid,p_old_tracker uuid,p_canonical_tracker uuid) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('oldNative',app_private.cos_archive_native_before(p_old),'canonicalNative',app_private.cos_archive_native_before(p_canonical),
 'oldTracker',app_private.cos_archive_tracker_before(p_old_tracker),'canonicalTracker',app_private.cos_archive_tracker_before(p_canonical_tracker),
 'canonicalSources',coalesce((select jsonb_agg(to_jsonb(s) order by s.native_unit_id) from app_private.cos_geocode_sources s where s.native_unit_id=p_canonical or s.tracker_id=p_canonical_tracker),'[]'::jsonb))
$$;
-- Family/base is a rejection test on already supplied exact IDs, never an identity lookup.
create function app_private.cos_archive_family_base(p_label text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(btrim(p_label)),'(hd4|hdc[24]s?)$','')
$$;
-- Explicit identity allowlist: new source/customer/observation columns do not
-- accidentally become physical identity. Source systems/record IDs bind when present.
create function app_private.cos_archive_source_identities(p_sources jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organization_id',x->'organization_id','entity_kind',x->'entity_kind','native_unit_id',x->'native_unit_id',
 'tracker_id',x->'tracker_id','product_id',x->'product_id','unit_number',x->'unit_number','tracker_unit_number',x->'tracker_unit_number','family',x->'family','variant',x->'variant',
 'source_system',x->'source_system','source_record_id',x->'source_record_id') order by x->>'native_unit_id'),'[]'::jsonb) from jsonb_array_elements(p_sources) x
$$;
create function app_private.cos_archive_valid(p app_private.cos_archived_representations) returns boolean language plpgsql stable set search_path='' as $$
declare b jsonb;u jsonb;c jsonb;t jsonb;ct jsonb;
begin
 if exists(select 1 from app_private.cos_archived_representation_revocations r where r.representation_id=p.id) then return false;end if;
 b:=app_private.cos_archive_before(p.archived_native_id,p.canonical_native_id,p.archived_tracker_id,p.canonical_tracker_id);
 -- Initial admission compares the whole before-image. Ongoing projection binds
 -- the archived record strictly and the retained record's stable identity only.
 if b->'oldNative' is distinct from p.reviewed_before->'oldNative' or b->'oldTracker' is distinct from p.reviewed_before->'oldTracker' then return false;end if;
 if exists(select 1 from unnest(array['id','organization_id','unit_number','model_id','model_name','model_category']) k where b#>array['canonicalNative',k] is distinct from p.reviewed_before#>array['canonicalNative',k])
  or exists(select 1 from unnest(array['id','organization_id','unit_number','unit_key','family']) k where b#>array['canonicalTracker',k] is distinct from p.reviewed_before#>array['canonicalTracker',k])
  or app_private.cos_archive_source_identities(b->'canonicalSources') is distinct from app_private.cos_archive_source_identities(p.reviewed_before->'canonicalSources') then return false;end if;
 u:=b->'oldNative';c:=b->'canonicalNative';t:=b->'oldTracker';ct:=b->'canonicalTracker';
 if exists(select 1 from jsonb_array_elements(jsonb_build_array(u,c,t,ct)) x where jsonb_typeof(x) is distinct from 'object' or x->>'organization_id' is distinct from p.organization_id::text)
  or u->>'model_id' is distinct from c->>'model_id' or u->>'model_category' is distinct from 'camera_system' or c->>'model_category' is distinct from 'camera_system'
  or app_private.cos_archive_family_base(u->>'unit_number') is distinct from app_private.cos_archive_family_base(c->>'unit_number')
  or u->>'unit_number' is distinct from t->>'unit_number' or c->>'unit_number' is distinct from ct->>'unit_number'
  or u->>'status' in ('retired','deleted') or c->>'status' in ('retired','deleted')
  or u->>'retired_at' is not null or c->>'retired_at' is not null
  or exists(select 1 from jsonb_each(u) e where e.key=any(array['gps_latitude','gps_longitude','gps_source','gps_recorded_at','gps_recorded_by','gps_accuracy_m','installed_site_id','current_location_ref']) and e.value<>'null'::jsonb)
  or coalesce(u->>'current_location_type','')<>''
  or exists(select 1 from jsonb_each(t) e where e.key=any(array['latitude','longitude','coordinate_source','reviewed_estimate_epoch']) and e.value<>'null'::jsonb)
  or exists(select 1 from public.vision_vigilant_unit_matches where equipment_unit_id=p.archived_native_id)
  or exists(select 1 from public.equipment_unit_location_history where equipment_unit_id=p.archived_native_id)
  or exists(select 1 from public.equipment_assignments where equipment_unit_id=p.archived_native_id and status='active')
  or exists(select 1 from public.audit_events where entity_id::text=p.archived_native_id::text and entity_type='equipment_units' and event_type is distinct from 'equipment_units.insert')
  or exists(select 1 from app_private.cos_geocode_sources where native_unit_id=p.archived_native_id or tracker_id=p.archived_tracker_id)
  or exists(select 1 from app_private.cos_owner_identity_claims where native_unit_id=p.archived_native_id) then return false;end if;
 -- Other archived mappings cannot form chains, cycles, or share either native/tracker endpoint.
 if exists(select 1 from app_private.cos_archived_representations r where r.id<>p.id and
  (r.archived_native_id in(p.archived_native_id,p.canonical_native_id) or r.canonical_native_id in(p.archived_native_id,p.canonical_native_id)
   or r.archived_tracker_id in(p.archived_tracker_id,p.canonical_tracker_id) or r.canonical_tracker_id in(p.archived_tracker_id,p.canonical_tracker_id))) then return false;end if;
 return true;
end $$;

-- Invoker-only administrative import: an actual postgres SQL review, never an Owner audit.
create function app_private.cos_archive_import_reviewed(p_organization_id uuid,p_rows jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb;e jsonb;p app_private.cos_archived_representations;result jsonb:='[]';
begin
 if current_user<>'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Postgres administrative review required.' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Invalid archive review batch.' using errcode='22023';end if;
 -- Serialize registry writers and preclude a concurrent source/native write passing an old before-image.
 lock table app_private.cos_archived_representations in share row exclusive mode;
 lock table public.equipment_units,public.equipment_models,app_private.vision_tracker_locations,public.vision_vigilant_unit_matches,public.vision_vigilant_devices,public.equipment_unit_location_history,public.equipment_assignments,public.audit_events,app_private.cos_geocode_sources,app_private.cos_owner_identity_claims in share mode;
 for r in select value from jsonb_array_elements(p_rows) loop
  e:=r->'sourceEvidence';
  if jsonb_typeof(r) is distinct from 'object' or (r-array['archivedNativeId','canonicalNativeId','archivedTrackerId','canonicalTrackerId','reviewedBefore','sourceEvidence','reviewSha256'])<>'{}'::jsonb
   or jsonb_typeof(e) is distinct from 'object' or (e-array['sourceSystem','spreadsheetId','archiveRange','activeRange','archiveRowSha256','activeRowSha256','archiveDesignation','archiveHidden','approvalReference'])<>'{}'::jsonb
   or e->>'sourceSystem' is distinct from 'owner_reviewed_tracker_duplicate_archive'
   or e->>'archiveDesignation' is distinct from 'duplicate' or e->'archiveHidden' is distinct from 'true'::jsonb
   or coalesce(e->>'spreadsheetId','')!~'^[A-Za-z0-9_-]{20,100}$'
   or coalesce(e->>'archiveRange','')!~'^''[A-Z ]+ DUPLICATE ARCHIVE''![A-Z]+[0-9]+:[A-Z]+[0-9]+$'
   or coalesce(e->>'activeRange','')!~'^''[A-Z ]+''![A-Z]+[0-9]+:[A-Z]+[0-9]+$'
   or e->>'activeRange' like '%ARCHIVE%'
   or coalesce(e->>'archiveRowSha256','')!~'^[a-f0-9]{64}$' or coalesce(e->>'activeRowSha256','')!~'^[a-f0-9]{64}$'
   or coalesce(e->>'approvalReference','')!~'^[A-Za-z0-9_:/ .-]{10,250}$' then raise exception 'Complete reviewed archive evidence required.' using errcode='22023';end if;
  insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256)
   values(p_organization_id,(r->>'archivedNativeId')::uuid,(r->>'canonicalNativeId')::uuid,(r->>'archivedTrackerId')::uuid,(r->>'canonicalTrackerId')::uuid,r->'reviewedBefore',e,r->>'reviewSha256',encode(sha256(convert_to(e::text,'UTF8')),'hex')) returning * into p;
  if app_private.cos_archive_before(p.archived_native_id,p.canonical_native_id,p.archived_tracker_id,p.canonical_tracker_id) is distinct from p.reviewed_before or not app_private.cos_archive_valid(p) then raise exception 'Archive before-image or authority changed.' using errcode='40001';end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',p.id,'archivedNativeId',p.archived_native_id,'canonicalNativeId',p.canonical_native_id,'revision',p.revision));
 end loop;
 return result;
end $$;

-- Permanent revocation on changes: reverting a value does not reactivate old evidence.
-- General source/native invalidation deliberately errs toward restoring visibility.
create function app_private.cos_archive_changed() returns trigger language plpgsql security definer set search_path='' as $$
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
end $$;
create trigger cos_archive_native_changed after insert or update or delete on public.equipment_units for each row execute function app_private.cos_archive_changed('id');
create trigger cos_archive_models_changed after update or delete on public.equipment_models for each row execute function app_private.cos_archive_changed('id');
create trigger cos_archive_tracker_changed after insert or update or delete on app_private.vision_tracker_locations for each row execute function app_private.cos_archive_changed('id');
create trigger cos_archive_provider_changed after insert or update or delete on public.vision_vigilant_unit_matches for each row execute function app_private.cos_archive_changed('equipment_unit_id');
create trigger cos_archive_provider_identity_changed after update or delete on public.vision_vigilant_devices for each row execute function app_private.cos_archive_changed('id');
create trigger cos_archive_history_changed after insert or update or delete on public.equipment_unit_location_history for each row execute function app_private.cos_archive_changed('equipment_unit_id');
create trigger cos_archive_assignment_changed after insert or update or delete on public.equipment_assignments for each row execute function app_private.cos_archive_changed('equipment_unit_id');
create trigger cos_archive_audit_changed after insert or update or delete on public.audit_events for each row execute function app_private.cos_archive_changed('entity_id');
create trigger cos_archive_source_changed after insert or update or delete on app_private.cos_geocode_sources for each row execute function app_private.cos_archive_changed('native_unit_id');
create trigger cos_archive_owner_changed after insert or update or delete on app_private.cos_owner_identity_claims for each row execute function app_private.cos_archive_changed('native_unit_id');
-- Bulk removals must never restore a projection by erasing contradictory evidence.
create trigger cos_archive_native_truncated before truncate on public.equipment_units for each statement execute function app_private.cos_archive_changed();
create trigger cos_archive_tracker_truncated before truncate on app_private.vision_tracker_locations for each statement execute function app_private.cos_archive_changed();
create trigger cos_archive_provider_truncated before truncate on public.vision_vigilant_unit_matches for each statement execute function app_private.cos_archive_changed();
create trigger cos_archive_history_truncated before truncate on public.equipment_unit_location_history for each statement execute function app_private.cos_archive_changed();
create trigger cos_archive_source_truncated before truncate on app_private.cos_geocode_sources for each statement execute function app_private.cos_archive_changed();

create function public.cos_archived_representation_projection(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Archive source service access required.' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('contract','COS_ARCHIVED_REPRESENTATION_V1','state',case when app_private.cos_archive_valid(p) then 'active' else 'conflict' end,'conflictReason',case when app_private.cos_archive_valid(p) then null else 'archived_or_canonical_identity_changed' end,'organizationId',p.organization_id,'id',p.id,'revision',p.revision,
 'archivedNativeId',p.archived_native_id,'canonicalNativeId',p.canonical_native_id,'archivedTrackerId',p.archived_tracker_id,'canonicalTrackerId',p.canonical_tracker_id,
 'archivedUnitNumber',p.reviewed_before#>>'{oldNative,unit_number}','canonicalUnitNumber',p.reviewed_before#>>'{canonicalNative,unit_number}',
 'reviewSha256',p.review_sha256,'evidenceSha256',p.evidence_sha256,'beforeSha256',encode(sha256(convert_to(p.reviewed_before::text,'UTF8')),'hex'),
 'provenance',p.provenance,'recordedByDatabaseRole',p.recorded_by_database_role) order by p.archived_native_id),'[]'::jsonb) into result
 from app_private.cos_archived_representations p where p.organization_id=p_organization_id;
 return result;
end $$;
revoke all on function app_private.cos_archive_immutable(),app_private.cos_archive_native_before(uuid),app_private.cos_archive_tracker_before(uuid),app_private.cos_archive_before(uuid,uuid,uuid,uuid),app_private.cos_archive_family_base(text),app_private.cos_archive_source_identities(jsonb),app_private.cos_archive_valid(app_private.cos_archived_representations),app_private.cos_archive_import_reviewed(uuid,jsonb),app_private.cos_archive_changed() from public,anon,authenticated,service_role;
revoke all on function public.cos_archived_representation_projection(uuid) from public,anon,authenticated;
grant execute on function public.cos_archived_representation_projection(uuid) to service_role;
-- No USAGE grant on app_private. Existing source-read RPC definitions and ACLs stay intact.
commit;
