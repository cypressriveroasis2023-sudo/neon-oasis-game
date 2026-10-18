-- HELD INSTALLATION CANDIDATE for native project tughscoxralhofrckvxy.
-- Local/synthetic testing is authorized. Production installation and this exact
-- EXECUTE grant require specific approval. No keys, users, tables or flags.
begin;
do $preflight$
declare d record;
begin
 if to_regprocedure('public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb)') is not null then raise exception 'Fresh attestation install required';end if;
 for d in select * from (values
  ('cos_mhelp_placement_private.guard(uuid,uuid)','d49a368db1d4b5ce936d3f3f9636d53bbec1093b3b53c53179c3bf8c3a3f7984'),
  ('cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)','6c6163ee414b04a046e4e4aca49eae9a3b4d609d46dab2de6ebfeb814ec096b7'),
  ('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)','c6f4af6579a1dccee3c33c5b66ec04fc7db02555d2d1391298f5bf9234431ad1'),
  ('cos_mhelp_placement_private.scoped_base_upload_snapshot()','41eecc31440ab1676a52b4c5ad3c4ca5ef08b22f98c3a373713cee5bc097a62d'),
  ('cos_mhelp_placement_private.identity_binding_base_upload_snapshot()','5bd5ae7a7b5bf6f6b815187d7b00dd37e71946c53c85a16070ea0bfefb02ea8f'),
  ('cos_mhelp_placement_private.upload_snapshot()','2d686fdadded70d159b1f4dbb41f01f846e338e90bde6f43cadb0b15adebe95a')
 ) x(signature,sha) loop
  if to_regprocedure(d.signature) is null or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(d.signature)),'UTF8')),'hex') is distinct from d.sha then
   raise exception 'Reviewed Shop authority dependency changed: %',d.signature;
  end if;
 end loop;
end $preflight$;

-- Denial-only equivalent of placementIdentityConcernKey. An alias is never
-- positive authority: the RPC below still requires exact reviewed labels/UUIDs.
create function cos_mhelp_placement_private.techcheck_identity_concern_v1(label text)
returns text language plpgsql immutable set search_path='' as $$
declare m text[];family text;number text;full_label text;
begin
 if label is null then return '';end if;
 full_label:='full:'||upper(regexp_replace(btrim(label),'[[:space:]]+',' ','g'));
 m:=regexp_match(btrim(label),'^(SNIPER[[:space:]]*[24]|RECON[[:space:]]*(?:2|II)|SOLAR[[:space:]]*(?:STAND[[:space:]]*72|POLE[[:space:]]*72|SKID[[:space:]]*144))(?:[[:space:]]|[-#])[[:space:]]*[-#]?[[:space:]]*([0-9]{1,6}(?:\.[0-9]+)?)(HD4|HDC[24]S?)?$','i');
 if m is null then m:=regexp_match(btrim(label),'^(HELIOS|RANGER|AXIS[[:space:]]*SOLAR[[:space:]]*SPOTTER|AXIS[[:space:]]*SPOTTER|SOLAR[[:space:]]*SPOTTER|SPOTTER|SS[[:space:]]*HYBRID|SNIPER|CAM[[:space:]]*V|RECON|RII|RI|RSU|ALPHA)[[:space:]]*[-#]?[[:space:]]*([0-9]{1,6}(?:\.[0-9]+)?)(HD4|HDC[24]S?)?$','i');end if;
 if m is null or split_part(m[2],'.',1)::integer=0 then return full_label;end if;
 family:=upper(regexp_replace(m[1],'[[:space:]]','','g'));
 family:=case when family in('RI','RII','RECONII','RECON2') then 'RECON' when family in('SPOTTER','SOLARSPOTTER','AXISSPOTTER','AXISSOLARSPOTTER') then 'SPOTTER' when family in('SNIPER2','SNIPER4') then 'SNIPER' else family end;
 number:=(split_part(m[2],'.',1)::integer)::text||case when position('.' in m[2])>0 then '.'||split_part(m[2],'.',2) else '' end;
 return 'concern:'||family||'|'||number;
end $$;
revoke all on function cos_mhelp_placement_private.techcheck_identity_concern_v1(text) from public,anon,authenticated,service_role;

-- The legacy actor is bound by the existing trusted bridge, NOT authenticated by
-- this cross-project database. The only API caller is existing service_role.
-- STABLE ensures every nested SELECT uses the calling statement's MVCC snapshot.
create function public.cos_techcheck_shop_attestation_v1(p_legacy_actor_id uuid,p_request_id uuid,p_purpose text,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare org constant uuid:='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 checked timestamptz:=statement_timestamp();valid_until timestamptz:=checked+interval '30 seconds';
 c cos_mhelp_placement_private.control;l cos_mhelp_placement_private.links;
 item jsonb;label text;concern text;g text;upload jsonb;r jsonb;b jsonb;tracker_rows jsonb;
 n integer;results jsonb:='[]';authority jsonb;
begin
 if p_legacy_actor_id is null or p_request_id is null or p_purpose is null or p_purpose not in('checkout','inventory_release')
  or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 or octet_length(p_items::text)>16000 then
  raise exception 'Exact attestation scope required' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['equipment_key','family','unit_tag']<>'{}'::jsonb
   or exists(select 1 from unnest(array['equipment_key','family','unit_tag']) k where jsonb_typeof(item->k) is distinct from 'string' or length(item->>k) not between 1 and 160 or item->>k<>btrim(item->>k) or item->>k~'[[:cntrl:]<>]') then
   raise exception 'Exact attestation scope required' using errcode='22023';end if;
 end loop;
 if (select count(distinct x->>'equipment_key') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items)
  or (select count(distinct lower(x->>'unit_tag')) from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then
  raise exception 'Duplicate attestation scope' using errcode='22023';end if;
 select * into c from cos_mhelp_placement_private.control where singleton;
 if not found or c.enabled is distinct from true or c.error_code is not null or c.last_success_at is null or c.last_success_at>checked or c.last_success_at<checked-interval '40 minutes' then
  raise exception 'Current Shop placement could not be verified';end if;
 upload:=cos_mhelp_placement_private.upload_snapshot();
 if upload->>'contract' is distinct from 'COS_MHELP_UPLOAD_V1' or upload->'reviewed' is distinct from 'true'::jsonb
  or jsonb_typeof(upload->'records') is distinct from 'array' or jsonb_array_length(upload->'records') not between 1 and 10000
  or coalesce(upload->>'sourceSha256','')!~'^[a-f0-9]{64}$' or coalesce(upload->>'payloadSha256','')!~'^[a-f0-9]{64}$'
  or coalesce(upload->>'receivedAtPrecision','') not in('minute','second') or upload->'exportAsOf' is distinct from 'null'::jsonb
  or (upload->>'receivedAt')::timestamptz is null or (upload->>'receivedAt')::timestamptz>checked then
  raise exception 'Current Shop placement could not be verified';end if;
 for item in select value from jsonb_array_elements(p_items) order by value->>'equipment_key' collate "C" loop
  label:=(item->>'family')||' '||(item->>'unit_tag');concern:=cos_mhelp_placement_private.techcheck_identity_concern_v1(label);
  select count(*) into n from cos_mhelp_placement_private.links x where cos_mhelp_placement_private.techcheck_identity_concern_v1(x.tracker_label)=concern or cos_mhelp_placement_private.techcheck_identity_concern_v1(x.native_label)=concern;
  if n<>1 then raise exception 'Current Shop placement could not be verified';end if;
  select * into l from cos_mhelp_placement_private.links x where coalesce(x.native_label,x.tracker_label)=label;
  if not found or l.tracker_label is distinct from label or l.full_label is distinct from label or (l.native_unit_id is not null and l.native_label is distinct from label)
   or l.observation->>'state' is distinct from 'confirmed' or l.observation->>'placement' is distinct from 'SHOP'
   or l.observation->>'equipmentId' is distinct from l.equipment_id
   or length(btrim(coalesce(l.observation->>'siteLabel',''))) not between 1 and 250 or (l.observation->>'siteLabel')~'[[:cntrl:]<>]'
   or length(coalesce(l.observation->>'customerLabel','')) not between 1 and 250 or (l.observation->>'customerLabel')~'[[:cntrl:]<>]'
   or l.observation->>'customerId' is distinct from l.baseline_customer_id or l.observation->>'serviceLocationId' is distinct from l.baseline_location_id
   or l.observed_at is null or l.observed_at>checked or l.observed_at<checked-interval '40 minutes' or l.observed_at>c.last_success_at
   or lower(btrim(coalesce(l.observation->>'customerLabel',''))) not in('cameras onsite','cameras onsite llc') then
   raise exception 'Current Shop placement could not be verified';end if;
  g:=cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id);
  if g is null or g is distinct from l.baseline_guard
   or (select count(*) from app_private.vision_tracker_locations t where t.organization_id=org and cos_mhelp_placement_private.techcheck_identity_concern_v1(t.unit_number)=concern)<>1
   or (select count(*) from public.equipment_units u where u.organization_id=org and cos_mhelp_placement_private.techcheck_identity_concern_v1(u.unit_number)=concern)<>(case when l.native_unit_id is null then 0 else 1 end)
   or (select count(*) from app_private.cos_geocode_sources s where s.active and (s.tracker_id=l.tracker_id or s.native_unit_id=l.native_unit_id))<>1
   or not exists(select 1 from app_private.cos_geocode_sources s where s.active and s.tracker_id=l.tracker_id and s.source_system='mhelpdesk_product_import' and s.product_id=l.equipment_id and s.source_revision=l.source_revision)
   or exists(select 1 from app_private.cos_owner_identity_claims q where q.organization_id=org and (q.native_unit_id=l.native_unit_id or cos_mhelp_placement_private.techcheck_identity_concern_v1(q.native_unit_label)=concern or cos_mhelp_placement_private.techcheck_identity_concern_v1(q.legacy_unit_key)=concern))
   or exists(select 1 from public.vision_vigilant_unit_matches a join public.vision_vigilant_unit_matches z on z.vigilant_device_id=a.vigilant_device_id and z.equipment_unit_id<>a.equipment_unit_id where a.equipment_unit_id=l.native_unit_id)
  then raise exception 'Current Shop placement could not be verified';end if;
  select count(*),jsonb_agg(x)->0 into n,r from jsonb_array_elements(upload->'records') x
   where x->>'productId'=l.equipment_id or x->'binding'->>'trackerId'=l.tracker_id::text or x->'binding'->>'nativeUnitId'=l.native_unit_id::text
    or x->'possibleAliasUnitIds' ? l.tracker_id::text or x->'possibleAliasUnitIds' ? l.native_unit_id::text
    or cos_mhelp_placement_private.techcheck_identity_concern_v1(x->>'unitNumber')=concern;
  b:=r->'binding';
  if n<>1 or r->>'productId' is distinct from l.equipment_id or r->>'unitNumber' is distinct from label or r->>'placement' is distinct from 'SHOP'
   or r->>'customerId' is distinct from l.baseline_customer_id
   or r->>'lifecycle' is distinct from 'UNFLAGGED' or nullif(r->>'holdReason','') is not null or coalesce(r->'placementHeld','false'::jsonb)<>'false'::jsonb
   or jsonb_array_length(coalesce(r->'possibleAliasUnitIds','[]'::jsonb))<>0 or r->>'inventoryOnlyReason' is not null
   or b->'guardCurrent' is distinct from 'true'::jsonb or b->>'productId' is distinct from l.equipment_id
   or b->>'trackerId' is distinct from l.tracker_id::text or b->>'nativeUnitId' is distinct from l.native_unit_id::text
   or b->>'trackerLabel' is distinct from l.tracker_label or b->>'nativeLabel' is distinct from l.native_label or b->>'fullLabel' is distinct from label
   or coalesce(b->>'matchMethod','') not in('reviewed_product_id','exact_family_unit') or coalesce(b->>'expectedGuard','')!~'^[a-f0-9]{64}$'
   or coalesce(b->>'evidenceSha256','')!~'^[a-f0-9]{64}$' or coalesce(b->>'representationEvidenceSha256','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(b->'representedUnitIds') is distinct from 'array' or jsonb_array_length(b->'representedUnitIds') not between 1 and 2
   or (select count(distinct v) from jsonb_array_elements_text(b->'representedUnitIds') v)<>jsonb_array_length(b->'representedUnitIds')
   or not(b->'representedUnitIds' ? coalesce(l.native_unit_id,l.tracker_id)::text)
   or exists(select 1 from jsonb_array_elements_text(b->'representedUnitIds') v where v not in(l.tracker_id::text,coalesce(l.native_unit_id,l.tracker_id)::text))
  then raise exception 'Current Shop placement could not be verified';end if;
  if r->'scopedAuthority' is not null and r->'scopedAuthority'<>'null'::jsonb and (
   r->'scopedAuthority'->>'contract' is distinct from 'COS_SCOPED_INVENTORY_AUTHORITY_V1' or r->'scopedAuthority'->>'evidenceKind' is distinct from 'derived_mapping'
   or coalesce(r->'scopedAuthority'->>'revisionId','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or coalesce(r->'scopedAuthority'->>'evidenceSha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(upload->'scopedRevision') is distinct from 'number' or (upload->>'scopedRevision')::bigint<1
   or (r->'scopedAuthority'->>'receivedAt')::timestamptz is null or (r->'scopedAuthority'->>'receivedAt')::timestamptz>checked
   or (r->'scopedAuthority'->>'receivedAt')::timestamptz<(upload->>'receivedAt')::timestamptz) then
   raise exception 'Current Shop placement could not be verified';end if;
  select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) into tracker_rows from jsonb_array_elements(coalesce(upload->'trackerRecords','[]'::jsonb)) x
   where x->>'matchedProductId'=l.equipment_id or x->'binding'->>'trackerId'=l.tracker_id::text or x->'binding'->>'nativeUnitId'=l.native_unit_id::text
    or x->'binding'->'unitIds' ? l.tracker_id::text or x->'binding'->'unitIds' ? l.native_unit_id::text
    or x->'binding'->'candidateUnitIds' ? l.tracker_id::text or x->'binding'->'candidateUnitIds' ? l.native_unit_id::text
    or cos_mhelp_placement_private.techcheck_identity_concern_v1(x->>'unitNumber')=concern;
  -- A related recorded tracker hold/field statement never becomes Shop authority.
  if jsonb_array_length(tracker_rows)>1 or exists(select 1 from jsonb_array_elements(tracker_rows) x where x->>'placement' is distinct from 'SHOP' or coalesce(x->>'lifecycle','') not in('ACTIVE','UNFLAGGED')
   or x->>'matchedProductId' is distinct from l.equipment_id or x->'binding'->>'state' is distinct from 'linked'
   or x->'binding'->'guardCurrent' is distinct from 'true'::jsonb or coalesce(x->'binding'->'placementHeld','false'::jsonb)<>'false'::jsonb) then
   raise exception 'Current Shop placement could not be verified';end if;
  authority:=jsonb_build_object('guard',g,'graph',cos_mhelp_placement_private.upload_binding_guard(l.tracker_id,l.native_unit_id),
   'nativeEpoch',case when l.native_unit_id is null then null else app_private.cos_owner_identity_native_epoch(l.native_unit_id) end,
   'link',to_jsonb(l),'control',to_jsonb(c),'uploadHead',upload-array['records','trackerRecords'],'source',r,'trackerRecords',tracker_rows,
   'matches',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]'::jsonb) from public.vision_vigilant_unit_matches m where m.equipment_unit_id=l.native_unit_id));
  results:=results||jsonb_build_array(jsonb_build_object('equipment_key',item->>'equipment_key','family',item->>'family','unit_tag',item->>'unit_tag',
   'representation_id',coalesce(l.native_unit_id,l.tracker_id),'representation_kind',case when l.native_unit_id is null then 'tracker' else 'native' end,
   'native_unit_id',l.native_unit_id,'tracker_id',l.tracker_id,'placement','SHOP','observed_at',l.observed_at,'source_success_at',c.last_success_at,
   'authority_sha256',encode(sha256(convert_to(authority::text,'UTF8')),'hex')));
  valid_until:=least(valid_until,l.observed_at+interval '40 minutes',c.last_success_at+interval '40 minutes');
 end loop;
 return jsonb_build_object('contract','COS_TECHCHECK_SHOP_ATTESTATION_V1','organization_id',org,'legacy_actor_id',p_legacy_actor_id,'request_id',p_request_id,
  'purpose',p_purpose,'checked_at',checked,'valid_until',valid_until,'items',results);
end $$;
revoke all on function public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cos_techcheck_shop_attestation_v1(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
