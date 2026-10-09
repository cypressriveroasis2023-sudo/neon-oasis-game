-- REVIEW ONLY. Native project, after tracker V2 and source-precedence-contract.sql.
-- One explicit reviewed decision; no automatic export chronology or Owner impersonation.
begin;
alter table app_private.cos_geocode_sources add column precedence_decision_id uuid;
create table app_private.cos_source_precedence_decisions(
 decision_id uuid primary key,native_unit_id uuid not null,source_revision uuid not null unique,
 before_binding jsonb not null,decision jsonb not null,
 reviewed_by text not null check(length(btrim(reviewed_by)) between 1 and 250),
 authorization_sha256 text not null check(authorization_sha256~'^[a-f0-9]{64}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 check(decision->>'decisionId'=decision_id::text and decision->>'sourceRevision'=source_revision::text));
alter table app_private.cos_source_precedence_decisions enable row level security;
revoke all on app_private.cos_source_precedence_decisions from public,anon,authenticated,service_role;
-- Existing scoped definer readers execute as postgres; no new direct service grant.
create function app_private.cos_source_precedence_record(p app_private.cos_geocode_sources)
returns jsonb language sql stable strict set search_path='' as $$
 select coalesce((select jsonb_build_object('sourcePrecedence',d.decision) from app_private.cos_source_precedence_decisions d
 where d.decision_id=p.precedence_decision_id and d.native_unit_id=p.native_unit_id and d.source_revision=p.source_revision
  and p.active and p.eligibility='FIELD' and p.entity_kind='equipment_unit' and p.source_system='mhelpdesk_product_import'),'{}'::jsonb)
$$;
revoke all on function app_private.cos_source_precedence_record(app_private.cos_geocode_sources),app_private.cos_source_precedence_assert(jsonb) from public,anon,authenticated,service_role;

create or replace function app_private.cos_source_record(p app_private.cos_geocode_sources)
returns jsonb language sql stable strict set search_path='' as $$
 select jsonb_build_object('schemaVersion',case when p.source_system='mhelpdesk_product_import' then 1 else 2 end,'organizationId',p.organization_id,'sourceSystem',p.source_system,
 'entityKind',p.entity_kind,'nativeUnitId',p.native_unit_id,
 'sourceRevision',p.source_revision,'eventId',p.event_id::text,'eligibility',p.eligibility)
 || case when p.source_system='mhelpdesk_product_import' then jsonb_build_object('productId',p.product_id) else jsonb_build_object('sourceRecordId',p.source_record_id) end
 || case when p.eligibility='FIELD' then jsonb_build_object('unitNumber',p.unit_number,'family',p.family,'variant',p.variant,
 'sourceFileSha256',p.source_file_sha256,'sourceRowSha256',p.source_row_sha256,'addressSha256',p.address_sha256,
 'nativeGuardSha256',p.native_guard_sha256,'suppliedComponents',jsonb_build_object('street',true,'city',p.city is not null,'state',true,'zip',p.zip is not null),'installation',jsonb_build_object('street',p.street,'city',p.city,'state',p.state,'zip',p.zip)) else '{}'::jsonb end
 || app_private.cos_source_precedence_record(p)
$$;

create function app_private.cos_source_precedence_admin_review(p_expected_source jsonb,p_review jsonb,p_reviewed_by text,p_authorization_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s app_private.cos_geocode_sources; prior jsonb;decision jsonb;v_id uuid;d_id uuid;
begin
 if current_user is distinct from 'postgres' then raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if jsonb_typeof(p_expected_source) is distinct from 'object' or jsonb_typeof(p_review) is distinct from 'object'
  or p_review ? 'sourceRevision' or p_review->>'reviewedSourceRevision' is distinct from p_expected_source->>'sourceRevision'
  or p_expected_source->>'organizationId' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  or p_expected_source ? 'sourcePrecedence' then raise exception 'Exact undecided current source required.' using errcode='22023';end if;
 v_id:=(p_expected_source->>'nativeUnitId')::uuid;d_id:=(p_review->>'decisionId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,701006));
 -- Match the existing importer lock order; all actions stay in this transaction.
 perform u.id from public.equipment_units u where u.id=v_id for share;
 perform t.id from app_private.vision_tracker_locations t where t.id=(select tracker_id from app_private.cos_geocode_sources where native_unit_id=v_id) for share;
 select * into s from app_private.cos_geocode_sources where native_unit_id=v_id for update;
 if not found then raise exception 'Source unavailable.' using errcode='40001';end if;
 prior:=app_private.cos_source_record(s);
 if prior is distinct from p_expected_source or prior ? 'sourcePrecedence' or not s.active or s.eligibility<>'FIELD'
  or s.native_guard_sha256 is distinct from app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number)
  or exists(select 1 from public.equipment_units u where u.id=v_id and (u.installed_site_id is not null or u.gps_latitude is not null or u.gps_longitude is not null))
  then raise exception 'Reviewed source, placement or GPS changed.' using errcode='40001';end if;
 -- This changes the source commitment, so the existing trigger emits a NEW
 -- revision/event. Never attach different binding bytes to an old revision.
 update app_private.cos_geocode_sources set precedence_decision_id=d_id where native_unit_id=v_id returning * into s;
 decision:=p_review||jsonb_build_object('sourceRevision',s.source_revision);
 perform app_private.cos_source_precedence_assert(app_private.cos_source_record(s)||jsonb_build_object('sourcePrecedence',decision));
 insert into app_private.cos_source_precedence_decisions(decision_id,native_unit_id,source_revision,before_binding,decision,reviewed_by,authorization_sha256)
 values(d_id,v_id,s.source_revision,prior,decision,p_reviewed_by,p_authorization_sha256);
 return app_private.cos_source_record(s);
end $$;
revoke all on function app_private.cos_source_precedence_admin_review(jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
commit;
