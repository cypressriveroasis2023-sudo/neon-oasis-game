begin;
create or replace function public.cos_fleet_shop_action_v1(p_actor_user_id uuid,p_organization_id uuid,p_unit_id uuid,p_action text default 'read',p_request_id uuid default null,p_reason text default null,p_expected jsonb default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare u public.equipment_units; prior app_private.cos_fleet_shop_moves; latest app_private.cos_fleet_shop_moves; result jsonb; proof text; bindings jsonb:='[]'::jsonb; fresh_bindings jsonb:='[]'::jsonb;
begin
 perform app_private.cos_fleet_shop_actor(p_actor_user_id,p_organization_id);
 if p_action not in ('read','move') then raise exception 'Invalid placement operation' using errcode='22023';end if;
 if p_action='move' then
  if p_request_id is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'Reviewed placement and reason required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20261020));
  select * into prior from app_private.cos_fleet_shop_moves where id=p_request_id;
  if found then
   if prior.actor_id<>p_actor_user_id or prior.unit_id<>p_unit_id or prior.organization_id<>p_organization_id or prior.reason<>btrim(p_reason) or prior.expected is distinct from p_expected then raise exception 'Move request was reused with different details' using errcode='40001';end if;
  end if;
 end if;
 if p_action='move' then select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id for update;
 else select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id;end if;
 if not found then raise exception 'Equipment unit unavailable' using errcode='P0002';end if;
 if u.status in ('retired','deleted') then raise exception 'Retired equipment requires review' using errcode='22023';end if;
 select * into latest from app_private.cos_fleet_shop_moves where unit_id=u.id and organization_id=p_organization_id order by created_at desc,id desc limit 1;
 proof:=encode(sha256(convert_to(jsonb_build_array(u.id,u.organization_id,u.unit_number,u.model_id,u.status,u.current_location_type)::text,'UTF8')),'hex');
 result:=jsonb_build_object('contract','COS_FLEET_SHOP_PLACEMENT_V1','unitId',u.id,'unitNumber',u.unit_number,'proof',proof,
  'auditId',latest.id::text,'recordedAt',latest.created_at,'sourceBindings',latest.source_bindings,'placement',case when latest.id is not null and latest.unit_number=u.unit_number and latest.model_id=u.model_id and u.current_location_type='shop' and u.status='available' then 'SHOP' else 'UNKNOWN' end);
 if p_action='read' then return result;end if;
 if prior.id is not null then
  if latest.id<>prior.id or result->>'placement'<>'SHOP' then raise exception 'Placement changed after this move' using errcode='40001';end if;
  return result||jsonb_build_object('saved',true,'requestId',prior.id,'recordedAt',prior.created_at,'sourceBindings',prior.source_bindings,'replayed',true);
 end if;
 if p_expected is distinct from (result-'recordedAt'-'sourceBindings') then raise exception 'Equipment identity or placement changed. Reload placement.' using errcode='40001';end if;
 -- Capture only the currently verified accepted Product-ID binding before a
 -- physical edit changes its broad native guard. This does not relink cameras.
 bindings:=coalesce(latest.source_bindings,'[]'::jsonb);
 begin
  select coalesce(jsonb_agg(jsonb_build_object('productId',r->>'productId','sourceSha256',b.source_sha256,'sourceUnitNumber',r->>'unitNumber')),'[]'::jsonb) into fresh_bindings
  from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  cross join lateral jsonb_array_elements(b.records) r
  where c.singleton and r->'binding'->>'nativeUnitId'=u.id::text and r->'binding'->>'nativeLabel'=u.unit_number
   and r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,u.id);
  if jsonb_array_length(fresh_bindings)>0 then bindings:=fresh_bindings;end if;
 exception when others then null;end;
 insert into app_private.cos_fleet_shop_moves(id,organization_id,unit_id,unit_number,model_id,actor_id,reason,expected,before_status,before_location_type,source_bindings)
 values(p_request_id,p_organization_id,u.id,u.unit_number,u.model_id,p_actor_user_id,btrim(p_reason),p_expected,u.status,u.current_location_type,bindings) returning * into latest;
 -- Physical placement only. Existing trigger records the native before/after.
 -- Keep installed-site references, GPS, serial/SIM fields, associations and jobs.
 update public.equipment_units set status='available',current_location_type='shop',updated_at=now() where id=u.id and organization_id=p_organization_id;
 select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id;
 proof:=encode(sha256(convert_to(jsonb_build_array(u.id,u.organization_id,u.unit_number,u.model_id,u.status,u.current_location_type)::text,'UTF8')),'hex');
 return jsonb_build_object('contract','COS_FLEET_SHOP_PLACEMENT_V1','unitId',u.id,'unitNumber',u.unit_number,'proof',proof,'auditId',latest.id::text,'placement','SHOP','saved',true,'requestId',latest.id,'recordedAt',latest.created_at,'sourceBindings',latest.source_bindings,'replayed',false);
end $$;
commit;
