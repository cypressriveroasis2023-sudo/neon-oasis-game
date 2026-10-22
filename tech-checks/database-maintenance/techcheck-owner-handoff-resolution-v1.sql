-- Owner completion for a stuck, already-signed Service receipt.
-- Preserves every original checkout/receipt event and records the Owner as the
-- resolving actor. It never signs for IT or Service and never changes permanent
-- inventory, placement, health, or truck-spare counts.
begin;

do $$begin
 if to_regprocedure('public.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)') is null
  or to_regprocedure('public.techcheck_transfer_context_v1()') is null
  or to_regprocedure('app_private.techcheck_transfer_manifest_v2(jsonb,text,boolean,boolean)') is null
  or to_regprocedure('app_private.techcheck_transfer_differences_v2(jsonb,jsonb,text)') is null
  or to_regprocedure('app_private.techcheck_transfer_family_v2(text)') is null then
  raise exception 'Installed handoff purpose v2 release is required.';
 end if;
 if md5(pg_get_functiondef('public.techcheck_transfer_context_v1()'::regprocedure)) is distinct from '502cbb6c8ffef53607bce63aaaab2408'
  or md5(pg_get_functiondef('app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure)) is distinct from '2fe8e0f559032d2337489d17bbbd848e'
  or md5(pg_get_functiondef('app_private.techcheck_transfer_family_v2(text)'::regprocedure)) is distinct from '1b4cef8c3828fa16a547163912ffd88c'
  or md5(pg_get_functiondef('app_private.techcheck_transfer_manifest_v2(jsonb,text,boolean,boolean)'::regprocedure)) is distinct from '2b92ebb095a2e08ed2443ff294711294'
  or md5(pg_get_functiondef('app_private.techcheck_transfer_differences_v2(jsonb,jsonb,text)'::regprocedure)) is distinct from 'e0ed368ab8f2a622da72dd1e94be7c53' then
  raise exception 'Installed handoff purpose functions drifted. Review production before installing Owner resolution.';
 end if;
 if to_regprocedure('public.owner_resolve_techcheck_transfer_v1(uuid,uuid,integer,text,uuid,boolean,text)') is not null then
  raise exception 'Owner handoff resolution v1 is already installed.';
 end if;
end$$;

alter table app_private.techcheck_transfer_events drop constraint techcheck_transfer_events_kind_check;
alter table app_private.techcheck_transfer_events add constraint techcheck_transfer_events_kind_check
 check(kind in ('checkout','receipt','return','cancel','purpose_amendment','owner_resolution'));

create function app_private.owner_resolve_techcheck_transfer_v1(
 p_request_id uuid,
 p_transfer_id uuid,
 p_expected_revision integer,
 p_purpose text,
 p_receipt_event_id uuid,
 p_identity_confirmed boolean,
 p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_actor_name text;
 v_previous app_private.techcheck_transfer_events%rowtype;
 v_t app_private.techcheck_transfers%rowtype;
 v_receipt app_private.techcheck_transfer_events%rowtype;
 v_request jsonb:=jsonb_build_object(
  'version',1,'transfer_id',p_transfer_id,'revision',p_expected_revision,
  'purpose',p_purpose,'receipt_event_id',p_receipt_event_id,
  'identity_confirmed',p_identity_confirmed,'reason',p_reason);
 v_raw jsonb;
 v_input jsonb:='[]'::jsonb;
 v_items jsonb;
 v_item jsonb;
 v_equipment public.equipment_master%rowtype;
 v_before_keys text[];
 v_after_keys text[];
 v_reserved_keys text[];
 v_differences jsonb;
 v_before_manifest jsonb;
 v_next_revision integer;
 v_snapshot jsonb;
begin
 if v_actor is null or not exists(
  select 1 from public.profiles p
  where p.user_id=v_actor and p.role::text='owner' and p.active and p.archived_at is null
 ) then
  raise exception 'Active Owner account required.' using errcode='42501';
 end if;
 if p_request_id is null or p_transfer_id is null or p_receipt_event_id is null then
  raise exception 'Owner resolution request, handoff and receipt are required.';
 end if;
 if p_purpose not in ('truck_replenishment','installation') then
  raise exception 'Choose Truck replenishment or Installation.';
 end if;
 if p_identity_confirmed is distinct from true then
  raise exception 'Review the saved Service equipment photo and confirm the exact unit identity before completing this handoff.';
 end if;
 if p_reason is null or length(btrim(p_reason)) not between 5 and 2000 then
  raise exception 'Record an Owner resolution reason in 5 to 2000 characters.';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into v_previous from app_private.techcheck_transfer_events where id=p_request_id;
 if found then
  if v_previous.actor_id<>v_actor or v_previous.kind<>'owner_resolution' or v_previous.request is distinct from v_request then
   raise exception 'Request ID already used with different details.';
  end if;
  return v_previous.snapshot||jsonb_build_object('event_id',v_previous.id,'replayed',true);
 end if;

 select * into v_t from app_private.techcheck_transfers where id=p_transfer_id for update;
 if not found then raise exception 'Handoff unavailable.';end if;
 if p_expected_revision is distinct from v_t.revision then raise exception 'Handoff changed. Reload before completing it.';end if;
 if v_t.state not in ('awaiting_service','discrepancy') then raise exception 'Only an unresolved handoff can be completed by the Owner.';end if;
 if v_t.purpose is not null and v_t.purpose is distinct from p_purpose then
  raise exception 'The saved handoff purpose cannot be changed by Owner completion.';
 end if;

 select * into v_receipt from app_private.techcheck_transfer_events
 where id=p_receipt_event_id and transfer_id=v_t.id and kind='receipt';
 if not found or v_receipt.actor_id is distinct from v_t.service_actor then
  raise exception 'Choose a signed receipt from the named Service technician.';
 end if;
 if jsonb_typeof(v_receipt.snapshot->'actual') is distinct from 'array'
  or jsonb_array_length(v_receipt.snapshot->'actual')=0 then
  raise exception 'The selected Service receipt has no equipment details.';
 end if;

 if p_purpose='installation' and v_t.purpose is distinct from 'installation' then
  raise exception 'Installation completion requires an existing Installation purpose and its verified battery package.';
 end if;

 for v_raw in select value from jsonb_array_elements(v_receipt.snapshot->'actual') loop
  if p_purpose='truck_replenishment' then
   v_input:=v_input||jsonb_build_array(
    (v_raw-'battery_count'-'battery_configuration'-'required_battery_count')
    ||jsonb_build_object(
      'family',app_private.techcheck_transfer_family_v2(v_raw->>'family'),
      'battery_count',null,'battery_configuration',null,'required_battery_count',null));
  else
   v_input:=v_input||jsonb_build_array(
    v_raw||jsonb_build_object('family',app_private.techcheck_transfer_family_v2(v_raw->>'family')));
  end if;
 end loop;

 v_items:=app_private.techcheck_transfer_manifest_v2(v_input,p_purpose,false,true);
 select array_agg(value->>'equipment_key' order by value->>'equipment_key')
 into v_before_keys from jsonb_array_elements(v_t.manifest);
 select array_agg(value->>'equipment_key' order by value->>'equipment_key')
 into v_after_keys from jsonb_array_elements(v_items);
 if v_before_keys is distinct from v_after_keys then
  raise exception 'The signed receipt does not contain the exact equipment assigned in this handoff.';
 end if;

 select coalesce(array_agg(equipment_key order by equipment_key),array[]::text[])
 into v_reserved_keys
 from app_private.techcheck_transfer_reservations where transfer_id=v_t.id;
 if v_reserved_keys is distinct from v_before_keys then
  raise exception 'Handoff reservations changed. Review custody before completing it.';
 end if;

 for v_item in select value from jsonb_array_elements(v_items) loop
  perform pg_advisory_xact_lock(hashtextextended(v_item->>'equipment_key',2));
  select * into v_equipment from public.equipment_master
   where equipment_key=v_item->>'equipment_key' for update;
  if not found then raise exception 'Saved equipment identity is unavailable.';end if;
  if app_private.techcheck_transfer_family_v2(v_item->>'family') is distinct from v_equipment.canonical_family
   or v_item->>'unit_tag' is distinct from v_equipment.unit_tag then
   raise exception 'The saved Service receipt does not match the registered unit identity. Review the equipment photo and unit tag.';
  end if;
 end loop;

 v_before_manifest:=v_t.manifest;
 v_differences:=app_private.techcheck_transfer_differences_v2(v_before_manifest,v_items,p_purpose);
 if v_differences<>'[]'::jsonb then
  raise exception 'The selected Service receipt still has an equipment discrepancy. Resolve the exact unit, SIM or parts before completing it.';
 end if;

 select coalesce(nullif(btrim(full_name),''),username) into v_actor_name
 from public.profiles where user_id=v_actor;
 v_next_revision:=v_t.revision+1;
 update app_private.techcheck_transfers
 set state='accepted',
     revision=v_next_revision,
     purpose=coalesce(purpose,p_purpose),
     purpose_revision=case when purpose is null then v_next_revision else purpose_revision end,
     manifest=v_items,
     updated_at=now()
 where id=v_t.id
 returning * into v_t;

 v_snapshot:=jsonb_build_object(
  'version',1,'transfer_id',v_t.id,'state',v_t.state,'revision',v_t.revision,
  'purpose',v_t.purpose,'purpose_revision',v_t.purpose_revision,
  'it_name',v_t.it_name,'service_name',v_t.service_name,
  'expected',v_before_manifest,'actual',v_items,'differences','[]'::jsonb,
  'selected_receipt_event_id',v_receipt.id,
  'selected_receipt_signed_by',v_receipt.actor_id,
  'selected_receipt_actor_name',v_receipt.actor_name,
  'selected_receipt_signed_at',v_receipt.signed_at,
  'owner_resolution',jsonb_build_object(
    'applied_by',v_actor,'applied_by_name',v_actor_name,'applied_at',now(),
    'identity_confirmed',true,'reason',btrim(p_reason),
    'statement','Owner reviewed the saved Service receipt and equipment evidence and completed the unresolved handoff. Original IT and Service signatures remain unchanged.'),
  'notes',btrim(p_reason));

 insert into app_private.techcheck_transfer_events(
  id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos
 ) values(
  p_request_id,v_t.id,v_actor,v_actor_name,'owner_resolution',v_request,v_snapshot,'[]'::jsonb
 );

 return v_snapshot||jsonb_build_object('event_id',p_request_id,'replayed',false);
end$$;
revoke all on function app_private.owner_resolve_techcheck_transfer_v1(uuid,uuid,integer,text,uuid,boolean,text)
 from public,anon,authenticated,service_role;
grant execute on function app_private.owner_resolve_techcheck_transfer_v1(uuid,uuid,integer,text,uuid,boolean,text)
 to authenticated;

create function public.owner_resolve_techcheck_transfer_v1(
 p_request_id uuid,
 p_transfer_id uuid,
 p_expected_revision integer,
 p_purpose text,
 p_receipt_event_id uuid,
 p_identity_confirmed boolean,
 p_reason text
) returns jsonb
language sql security invoker set search_path='' as $$
 select app_private.owner_resolve_techcheck_transfer_v1(
  p_request_id,p_transfer_id,p_expected_revision,p_purpose,p_receipt_event_id,p_identity_confirmed,p_reason)
$$;
revoke all on function public.owner_resolve_techcheck_transfer_v1(uuid,uuid,integer,text,uuid,boolean,text)
 from public,anon,authenticated,service_role;
grant execute on function public.owner_resolve_techcheck_transfer_v1(uuid,uuid,integer,text,uuid,boolean,text)
 to authenticated;

commit;
