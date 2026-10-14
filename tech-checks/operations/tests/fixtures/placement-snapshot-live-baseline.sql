-- Exact read-adapter baseline: function code only; no customer/source rows.
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.continuity_current(t uuid, n uuid, original text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce((select x.after_guard
  from cos_mhelp_placement_private.source_continuity x
  join cos_mhelp_placement_private.upload_control c on c.singleton and c.active_sha256=x.source_sha256
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 and b.payload_sha256=x.payload_sha256
  where x.tracker_id is not distinct from t and x.native_id is not distinct from n and x.original_guard=original order by x.id desc limit 1),original)=cos_mhelp_placement_private.upload_binding_guard(t,n)
$function$;

CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.guard(p_tracker uuid, p_native uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t app_private.vision_tracker_locations;u public.equipment_units;s app_private.cos_geocode_sources;data jsonb;
begin
 select * into t from app_private.vision_tracker_locations where id=p_tracker and organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 if not found or (select count(*) from app_private.vision_tracker_locations x where x.organization_id=t.organization_id and x.unit_key=t.unit_key)<>1 then return null;end if;
 select * into s from app_private.cos_geocode_sources where tracker_id=p_tracker and active and source_system='mhelpdesk_product_import';
 if not found or s.tracker_unit_number<>t.unit_number or (p_native is null and s.entity_kind<>'tracker') or (p_native is not null and (s.entity_kind<>'equipment_unit' or s.native_unit_id<>p_native)) then return null;end if;
 if exists(select 1 from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)) then return null;end if;
 data:=jsonb_build_object('tracker',to_jsonb(t),'sourceIdentity',jsonb_build_array(s.product_id,s.source_revision,s.unit_number,s.tracker_unit_number));
 if p_native is not null then
  select * into u from public.equipment_units where id=p_native and organization_id=t.organization_id;
  if not found or u.unit_number<>s.unit_number or u.retired_at is not null or u.status<>'available' or u.installed_site_id is not null or u.current_location_ref is not null or nullif(u.current_location_type,'') is not null
   or u.gps_latitude is not null or u.gps_longitude is not null or u.gps_recorded_at is not null
   or (select count(*) from public.equipment_units x where x.organization_id=t.organization_id and app_private.cos_source_label(x.unit_number)=app_private.cos_source_label(u.unit_number))<>1
   or exists(select 1 from public.equipment_unit_location_history h where h.equipment_unit_id=p_native)
   or exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native)
  then return null;end if;
  data:=data||jsonb_build_object('native',to_jsonb(u));
 end if;
 return encode(sha256(convert_to(data::text,'UTF8')),'hex');
end $function$;

CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_binding_guard(p_tracker uuid, p_native uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select encode(sha256(convert_to(jsonb_build_object(
  'tracker',(select to_jsonb(t) from app_private.vision_tracker_locations t where t.id=p_tracker),
  'native',(select to_jsonb(u) from public.equipment_units u where u.id=p_native),
  'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]'::jsonb) from app_private.cos_geocode_sources s where s.tracker_id=p_tracker or s.native_unit_id=p_native),
  'archives',(select coalesce(jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text),'[]'::jsonb) from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)),
  'nativeHistory',(select coalesce(jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text),'[]'::jsonb) from public.equipment_unit_location_history h where h.equipment_unit_id=p_native),
  'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native)
 )::text,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select (b.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object('trackerRecords',cos_mhelp_placement_private.upload_tracker_snapshot(b.receipt->'trackerRecords'),'reviewed',true,'payloadSha256',b.payload_sha256,'records',(
  select jsonb_agg((r-'binding')||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
    ((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',cos_mhelp_placement_private.continuity_current((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard')) end) order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(b.records) r))
 from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton
$function$;

CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_tracker_snapshot(p_records jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg((r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object('binding',((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',
  coalesce(r->'binding'->>'state'='linked' and cos_mhelp_placement_private.continuity_current((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard'),false))) order by r->>'recordId'),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_records,'[]'::jsonb)) r
$function$;

CREATE OR REPLACE FUNCTION public.cos_mhelp_placement_snapshot(p_actor_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'guardCurrent',cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard,
  'state',case when observation->>'state'='confirmed' and cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard then 'confirmed' else 'held' end,
  'reason',observation->>'reason','placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'assignmentChanged',(baseline_customer_id is not null and observation->>'customerId' is not null and observation->>'customerId'<>baseline_customer_id) or (baseline_location_id is not null and observation->>'serviceLocationId' is not null and observation->>'serviceLocationId'<>baseline_location_id),
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from cos_mhelp_placement_private.links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items,'upload',cos_mhelp_placement_private.upload_snapshot());
end $function$;
