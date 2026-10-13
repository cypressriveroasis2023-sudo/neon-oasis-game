-- Synthetic fixture support: exact deployed Owner Census definitions, no production rows.
CREATE OR REPLACE FUNCTION app_private.cos_geocode_record(p app_private.cos_field_geocode_cache)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
 select jsonb_build_object('auditId',p.audit_id,'unitKey',p.unit_key,'address',p.address,'addressSha256',p.address_sha256,
  'status',p.status,'provider',p.provider,'benchmark',p.benchmark,'source','us_census_address_range_estimate',
  'confidence','address_range_interpolation','verified',false,'liveGps',false,'latitude',p.latitude,'longitude',p.longitude,
  'matchedAddress',p.matched_address,'geocodedAt',p.geocoded_at,'reason',p.reason,'attempts',p.attempts,
  'nextAttemptAt',p.next_attempt_at,'leaseUntil',p.lease_until,'createdAt',p.created_at,'updatedAt',p.updated_at)
$function$
;
CREATE OR REPLACE FUNCTION public.cos_field_geocode_claim(p_organization_id uuid, p_audit_id text, p_unit_key text, p_address text, p_address_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.cos_field_geocode_cache; v_now timestamptz;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);
 if not app_private.cos_geocode_lock_current(p_audit_id,p_unit_key,p_address) then return jsonb_build_object('claimed',false,'claimToken',null,'record',null); end if;
 -- Only trigger-enqueued or explicitly service-enqueued work may be claimed. No read backfill.
 select * into r from app_private.cos_field_geocode_cache where organization_id=p_organization_id and audit_id=p_audit_id for update;
 if not found then return jsonb_build_object('claimed',false,'claimToken',null,'record',null); end if;
 if r.unit_key is distinct from p_unit_key or r.address is distinct from p_address or r.address_sha256 is distinct from p_address_sha256 then
  raise exception 'Audit geocode binding changed.' using errcode='40001'; end if;
 v_now:=clock_timestamp();
 if r.status='pending' and r.attempts=3 and r.lease_until<=v_now then
  update app_private.cos_field_geocode_cache set status='provider_error',reason='lease_expired',lease_until=null,next_attempt_at=null,geocoded_at=v_now,updated_at=v_now
   where organization_id=p_organization_id and audit_id=p_audit_id returning * into r;
 end if;
 if r.attempts>=3 or r.status in ('success','no_match','invalid_address')
  or r.status='pending' and r.lease_until>v_now or r.status='provider_error' and r.next_attempt_at>v_now then
  return jsonb_build_object('claimed',false,'claimToken',null,'record',app_private.cos_geocode_record(r)); end if;
 update app_private.cos_field_geocode_cache set status='pending',attempts=attempts+1,claim_token=gen_random_uuid(),
  lease_until=v_now+interval '60 seconds',next_attempt_at=null,latitude=null,longitude=null,matched_address=null,geocoded_at=null,reason=null,updated_at=v_now
  where organization_id=p_organization_id and audit_id=p_audit_id returning * into r;
 return jsonb_build_object('claimed',true,'claimToken',r.claim_token,'record',app_private.cos_geocode_record(r));
end $function$
;
CREATE OR REPLACE FUNCTION public.cos_field_geocode_finish(p_organization_id uuid, p_audit_id text, p_unit_key text, p_address text, p_address_sha256 text, p_claim_token uuid, p_status text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_matched_address text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r app_private.cos_field_geocode_cache; v_now timestamptz; v_reason text;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);
 if p_claim_token is null or p_status is null or p_status not in ('success','no_match','invalid_address','provider_error') then raise exception 'Invalid geocode completion.' using errcode='22023'; end if;
 v_reason:=case when p_status in ('no_match','invalid_address') then p_status else p_reason end;
 if p_status='success' and (p_latitude is null or p_longitude is null or not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180)
   or p_matched_address is null or length(btrim(p_matched_address)) not between 1 and 600 or p_matched_address~'[[:cntrl:]]' or p_reason is not null)
  or p_status<>'success' and (p_latitude is not null or p_longitude is not null or p_matched_address is not null)
  or p_status='provider_error' and (p_reason is null or p_reason not in ('provider_timeout','provider_unavailable','invalid_response'))
  or p_status in ('no_match','invalid_address') and p_reason is not null and p_reason<>p_status then
  raise exception 'Invalid safe geocode result.' using errcode='22023'; end if;
 if not app_private.cos_geocode_lock_current(p_audit_id,p_unit_key,p_address) then return jsonb_build_object('accepted',false,'record',null); end if;
 select * into r from app_private.cos_field_geocode_cache where organization_id=p_organization_id and audit_id=p_audit_id for update;
 if not found then return jsonb_build_object('accepted',false,'record',null); end if;
 if r.unit_key is distinct from p_unit_key or r.address is distinct from p_address or r.address_sha256 is distinct from p_address_sha256 then
  raise exception 'Audit geocode binding changed.' using errcode='40001'; end if;
 v_now:=clock_timestamp();
 if r.claim_token is distinct from p_claim_token then return jsonb_build_object('accepted',false,'record',app_private.cos_geocode_record(r)); end if;
 if r.status<>'pending' then
  return jsonb_build_object('accepted',r.status=p_status and r.latitude is not distinct from p_latitude and r.longitude is not distinct from p_longitude
    and r.matched_address is not distinct from p_matched_address and r.reason is not distinct from v_reason,'record',app_private.cos_geocode_record(r));
 end if;
 if r.lease_until<=v_now then return jsonb_build_object('accepted',false,'record',app_private.cos_geocode_record(r)); end if;
 update app_private.cos_field_geocode_cache set status=p_status,latitude=p_latitude,longitude=p_longitude,matched_address=p_matched_address,
  reason=v_reason,geocoded_at=v_now,lease_until=null,updated_at=v_now,
  next_attempt_at=case when p_status='provider_error' and attempts<3 then v_now+case when attempts=1 then interval '30 seconds' else interval '120 seconds' end end
  where organization_id=p_organization_id and audit_id=p_audit_id returning * into r;
 return jsonb_build_object('accepted',true,'record',app_private.cos_geocode_record(r));
end $function$
;
CREATE OR REPLACE FUNCTION public.cos_field_geocode_list_due(p_organization_id uuid, p_limit integer DEFAULT 5, p_audit_id text DEFAULT NULL::text, p_unit_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Batch limit must be 1 through 5.' using errcode='22023'; end if;
 if (p_audit_id is null)<>(p_unit_key is null) or p_audit_id is not null and (p_audit_id!~'^[1-9][0-9]{0,18}$' or length(p_unit_key) not between 1 and 250) then
  raise exception 'Target audit and exact legacy unit must be supplied together.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(app_private.cos_geocode_record(d) order by d.created_at,d.audit_id),'[]') into v_result from (
  select c.* from app_private.cos_field_geocode_cache c join lateral app_private.cos_geocode_current_audit(c.audit_id) a on true
  where c.organization_id=p_organization_id and (p_audit_id is null or c.audit_id=p_audit_id and lower(btrim(c.unit_key))=lower(btrim(p_unit_key)))
   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)
   and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address')
   and ((c.status='pending' and (c.lease_until is null or c.lease_until<=clock_timestamp()))
     or (c.status='provider_error' and c.attempts<3 and c.next_attempt_at<=clock_timestamp()))
  order by c.created_at,c.audit_id limit p_limit
 ) d;
 return v_result;
end $function$
;
CREATE OR REPLACE FUNCTION public.cos_field_geocode_read_many(p_organization_id uuid, p_audit_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 -- No supplied actor IDs and no user-editable JWT metadata. Existing legacy Owner gate.
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501'; end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' then
  if not app_private.cos_verified_fleet_actor(auth.uid()) then
   raise exception 'Owner account required.' using errcode='42501'; end if;
 end if;
 if p_audit_ids is null or coalesce(array_ndims(p_audit_ids),1)<>1 or cardinality(p_audit_ids)>250
  or exists(select 1 from unnest(p_audit_ids) x where x is null or x!~'^[1-9][0-9]{0,18}$') then raise exception 'At most 250 audit identities required.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(app_private.cos_geocode_record(c) order by c.audit_id),'[]') into v_result
 from app_private.cos_field_geocode_cache c join lateral app_private.cos_geocode_current_audit(c.audit_id) a on true
 where c.organization_id=p_organization_id and c.audit_id=any(p_audit_ids)
  and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key) and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address');
 return v_result;
end $function$
;
