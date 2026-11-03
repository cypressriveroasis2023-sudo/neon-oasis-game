begin;
do $$begin
if (select md5(prosrc) from pg_proc where oid=to_regprocedure('app_private.techcheck_transfer_context_core_v1()')) is distinct from '0421cc9da9b9fc034346c438900621c5' then raise exception 'Transfer function drift: techcheck_transfer_context_core_v1';end if;
if (select md5(prosrc) from pg_proc where oid=to_regprocedure('app_private.techcheck_transfer_custody_hold_v1(text)')) is distinct from '1a609bb1e04cc85e4f279e0a3c0393fd' then raise exception 'Transfer function drift: techcheck_transfer_custody_hold_v1';end if;
if (select md5(prosrc) from pg_proc where oid=to_regprocedure('app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)')) is distinct from '69578b93fe9c490b14436bfe0dcdae36' then raise exception 'Transfer function drift: submit_techcheck_transfer_v2';end if;
end$$;
revoke execute on function public.cos_admit_transfer_placement_v1(bigint,jsonb) from service_role;
create or replace function app_private.techcheck_transfer_context_core_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role text:=app_private.techcheck_transfer_role(); transfers jsonb; equipment jsonb:='[]'; team jsonb:='[]';
begin
 if (select enabled from app_private.techcheck_transfer_settings where singleton) is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 if role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'actor_name',e.actor_name,'snapshot',e.snapshot,'photos',e.photos,'signed_at',e.signed_at) order by e.signed_at),'[]') from app_private.techcheck_transfer_events e where e.transfer_id=t.id)) order by t.created_at desc),'[]') into transfers
 from (select * from app_private.techcheck_transfers where (role='it' or service_actor=auth.uid()) and (state not in ('cancelled','returned_review','returned_repair') or created_at>now()-interval '7 days') order by created_at desc limit 100) t;
 if role='it' then
  select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',coalesce(nullif(full_name,''),username)) order by full_name),'[]') into team from public.profiles p where p.role::text='service' and p.active and p.archived_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('equipment_key',e.equipment_key,'family',e.canonical_family,'unit_tag',e.unit_tag,'unit_name',e.source_label,'workflow_type',e.workflow_type,'updated_at',e.updated_at,'tracker_state',e.tracker_state,'reserved',r.equipment_key is not null,'supported',rules.workflow_type is not null) order by e.source_label),'[]') into equipment from public.equipment_master e left join app_private.techcheck_transfer_reservations r using(equipment_key) left join app_private.techcheck_transfer_rules rules on rules.workflow_type=e.workflow_type and rules.workflow_type=e.canonical_family;
 end if;
 return jsonb_build_object('version',1,'role',role,'transfers',transfers,'equipment',equipment,'technicians',team,'delivery','awaiting_delivery_adapter');
end$$;
create or replace function app_private.techcheck_transfer_custody_hold_v1(p_key text) returns text
language sql stable security definer set search_path='' as $$
 select case
 when e.tracker_state is distinct from 'shop' then 'Not recorded in Shop'
 when exists(select 1 from public.unit_registry u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.lifecycle_status is distinct from 'shop_inventory') then 'Existing equipment custody or maintenance'
 when exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.equipment_type=e.canonical_family and i.unit_tag=e.unit_tag and not coalesce(t.is_test,false)
   and t.status::text is distinct from 'closed') then 'Existing preparation or handoff'
 when exists(select 1 from public.service_truck_units u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.status is distinct from 'unassigned') then 'Assigned truck equipment'
 when exists(select 1 from public.unit_returns r where r.equipment_type=e.canonical_family and r.unit_tag=e.unit_tag and r.status is distinct from 'completed') then 'Unresolved equipment return'
 end from public.equipment_master e where e.equipment_key=p_key
$$;
create or replace function app_private.submit_techcheck_transfer_v2(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text,p_purpose text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); role text:=app_private.techcheck_transfer_role(); actor_name text; receiver_name text;
 previous app_private.techcheck_transfer_events%rowtype;t app_private.techcheck_transfers%rowtype;
 equipment public.equipment_master%rowtype;rules app_private.techcheck_transfer_rules%rowtype;
 request jsonb:=jsonb_build_object('version',2,'transfer_id',p_transfer_id,'kind',p_kind,'revision',p_expected_revision,'service_actor',p_service_actor,'items',p_items,'checks',p_checks,'signature',p_signature,'photos',p_photos,'notes',p_notes,'purpose',p_purpose);
 items jsonb;item jsonb;photo jsonb;signature jsonb;differences jsonb:='[]';snapshot jsonb;field text;next_state text;pass boolean:=true;hold text;
 source_event app_private.techcheck_transfer_events%rowtype; source_photo jsonb; original_evidence jsonb:='[]';
begin
 if actor is null or role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 if p_kind is null or p_kind not in ('checkout','receipt','return','cancel') or p_request_id is null or p_transfer_id is null then raise exception 'Invalid transfer action.';end if;
 if (p_kind='receipt' and role<>'service') or (p_kind<>'receipt' and role<>'it') then raise exception 'This action is not allowed for your role.' using errcode='42501';end if;
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into previous from app_private.techcheck_transfer_events where id=p_request_id;
 if found then
  if previous.actor_id<>actor or previous.request is distinct from request then raise exception 'Request ID already used with different details.';end if;
  return previous.snapshot||jsonb_build_object('event_id',previous.id,'replayed',true,'delivery',(select status from app_private.techcheck_transfer_outbox where event_id=previous.id));
 end if;
 if p_purpose is null or p_purpose not in ('truck_replenishment','installation') then raise exception 'Choose Truck replenishment or Installation.';end if;
 if p_kind='receipt' then perform pg_advisory_xact_lock(hashtextextended(actor::text,0));end if;
 if p_notes is null or length(p_notes)>2000 then raise exception 'Notes must be at most 2000 characters.';end if;
 if jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Checks and photos required.';end if;
 if jsonb_array_length(p_photos)>60 then raise exception 'Too many photos.';end if;
 select coalesce(nullif(btrim(full_name),''),username) into actor_name from public.profiles where user_id=actor;
 if jsonb_typeof(p_signature) is distinct from 'object' or (p_signature->'confirmed') is distinct from 'true'::jsonb
  or p_signature->>'method' is null or p_signature->>'method' not in ('typed','drawn')
  or lower(regexp_replace(btrim(p_signature->>'name'),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(actor_name),'[[:space:]]+',' ','g')) then
  raise exception 'Sign and confirm using your own technician account name.';
 end if;
 signature:=jsonb_build_object('method',p_signature->>'method','name',actor_name,'signed_by',actor,'signed_at',now(),'timezone','America/Chicago','statement_version',1,'statement','I physically checked the equipment listed in this transfer. My entries and photos accurately record what I handed over, received or returned.');
 items:=app_private.techcheck_transfer_manifest_v2(p_items,p_purpose,p_kind in ('receipt','cancel'),p_kind='checkout');
 if p_kind='checkout' then
  if p_transfer_id<>p_request_id or p_expected_revision is distinct from 0 then raise exception 'A new handoff needs a new request ID.';end if;
  select coalesce(nullif(btrim(full_name),''),username) into receiver_name from public.profiles p where p.user_id=p_service_actor and p.role::text='service' and p.active and p.archived_at is null;
  if not found then raise exception 'Choose an active Service technician.';end if;
  for item in select value from jsonb_array_elements(items) order by value->>'equipment_key' loop
   perform pg_advisory_xact_lock(hashtextextended(item->>'equipment_key',2));
   select * into equipment from public.equipment_master where equipment_key=item->>'equipment_key' for update;
   if not found or equipment.tracker_state is distinct from 'shop' then raise exception 'Equipment is not recorded in Shop. Verify placement first.';end if;
   if app_private.techcheck_transfer_family_v2(item->>'family') is distinct from equipment.canonical_family or item->>'unit_tag' is distinct from equipment.unit_tag then raise exception 'Equipment identity changed. Reload and check the exact unit.';end if;
   if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=equipment.equipment_key) then raise exception 'Equipment already has an unresolved handoff or return.';end if;
   hold:=app_private.techcheck_transfer_custody_hold_v1(equipment.equipment_key);if hold is not null then raise exception 'Equipment unavailable: %.',hold;end if;
   select * into rules from app_private.techcheck_transfer_rules where workflow_type=equipment.workflow_type and workflow_type=equipment.canonical_family;
   if not found then raise exception 'No approved check-only rule mapping exists for this equipment.';end if;
   for field in select jsonb_array_elements_text(rules.bool_fields) loop
    if p_purpose='truck_replenishment' and field in ('delivery_batteries_charged_ok','helios_battery_box_installed_ok','helios_battery_120v_charged_ok') then continue;end if;
    if p_checks->equipment.equipment_key->field is distinct from 'true'::jsonb then raise exception 'Pass every required IT equipment check.';end if;
   end loop;
   if p_purpose='installation' then
    foreach field in array array['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'] loop
     if equipment.canonical_family='Helios' and field='delivery_ticket_count_ok' then continue;end if;
     if p_checks->equipment.equipment_key->field is distinct from 'true'::jsonb then raise exception 'Complete every required installation readiness check.';end if;
    end loop;
   end if;
  end loop;
  next_state:='awaiting_service';
  insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state,purpose,purpose_revision)
   values(p_transfer_id,actor,p_service_actor,actor_name,receiver_name,items,next_state,p_purpose,1) returning * into t;
  insert into app_private.techcheck_transfer_reservations select value->>'equipment_key',t.id from jsonb_array_elements(items);
 else
  select * into t from app_private.techcheck_transfers where id=p_transfer_id for update;
  if not found or (role='service' and t.service_actor<>actor) then raise exception 'Handoff unavailable for your account.' using errcode='42501';end if;
  if p_expected_revision is distinct from t.revision then raise exception 'Handoff changed. Reload before submitting.';end if;
  if p_service_actor is distinct from t.service_actor then raise exception 'The named Service technician cannot be changed.';end if;
  if t.purpose is null then raise exception 'IT must confirm this handoff purpose before you receive it.';end if;
  if p_purpose is distinct from t.purpose then raise exception 'The saved handoff purpose cannot be changed by a receipt.';end if;
  if p_kind='receipt' then
   if t.state<>'awaiting_service' or exists(select 1 from app_private.techcheck_transfer_events e where e.transfer_id=t.id and e.kind='receipt' and (e.snapshot->>'revision')::integer>=t.purpose_revision) then
    raise exception 'Your receipt is already saved. IT or the Owner must review any differences; do not submit again.';
   end if;
   differences:=app_private.techcheck_transfer_differences_v2(t.manifest,items,t.purpose);
   next_state:=case when jsonb_array_length(differences)=0 then 'accepted' else 'discrepancy' end;
  elsif p_kind='return' then
   if t.state<>'accepted' then raise exception 'Only accepted equipment can be checked back in.';end if;
   if app_private.techcheck_transfer_differences_v2(t.manifest,items,t.purpose)<>'[]'::jsonb then raise exception 'Check in the exact equipment from this handoff. Resolve a partial return separately.';end if;
   for item in select value from jsonb_array_elements(t.manifest) loop
    foreach field in array array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'] loop
     if t.purpose='truck_replenishment' and field='batteries_ok' then continue;end if;
     if jsonb_typeof(p_checks->(item->>'equipment_key')->field) is distinct from 'boolean' then raise exception 'Answer every intake condition check.';end if;
     pass:=pass and (p_checks->(item->>'equipment_key')->>field)::boolean;
    end loop;
   end loop;
   if not pass and length(btrim(p_notes))=0 then raise exception 'Explain the failed intake check.';end if;
   next_state:=case when pass then 'returned_review' else 'returned_repair' end;
  else
   if t.state not in ('awaiting_service','discrepancy') or length(btrim(p_notes))=0 or items<>'[]'::jsonb then raise exception 'Only an unaccepted handoff can be cancelled, with a reason.';end if;
   next_state:='cancelled';delete from app_private.techcheck_transfer_reservations where transfer_id=t.id;
  end if;
  update app_private.techcheck_transfers set state=next_state,revision=revision+1,updated_at=now() where id=t.id returning * into t;
 end if;
 if exists(select 1 from jsonb_array_elements(p_photos) group by value->>'equipment_key',value->>'kind' having count(*)>1) then raise exception 'Duplicate evidence slot.';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  if coalesce(photo->>'kind','') not in ('unit','tag','signature') or (photo->>'path') is null or (photo->>'path')!~('^'||actor::text||'/'||p_request_id::text||'/[a-f0-9]{64}\.jpg$') then raise exception 'Invalid evidence identity.';end if;
  if photo->>'kind'<>'signature' and not exists(select 1 from jsonb_array_elements(items) where value->>'equipment_key'=photo->>'equipment_key') then raise exception 'Photo must belong to an item in this event.';end if;
  if not exists(select 1 from storage.objects where bucket_id='techcheck-transfer-evidence' and name=photo->>'path' and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload every evidence photo first.';end if;
 end loop;
 for item in select value from jsonb_array_elements(items) loop
  if exists(select 1 from jsonb_array_elements(p_photos) where value->>'equipment_key'=item->>'equipment_key' and value->>'kind'='unit') then continue;end if;
  if p_kind='receipt' and t.purpose='truck_replenishment' and not exists(select 1 from jsonb_array_elements(differences) d where d->>'equipment_key'=item->>'equipment_key') then
   select * into source_event from app_private.techcheck_transfer_events e where e.transfer_id=t.id and e.kind='checkout' order by e.signed_at,e.id limit 1;
   select value into source_photo from jsonb_array_elements(source_event.photos) where value->>'equipment_key'=item->>'equipment_key' and value->>'kind'='unit';
   if source_photo is null or not app_private.techcheck_transfer_file(source_photo->>'path',false)
    or not exists(select 1 from storage.objects where bucket_id='techcheck-transfer-evidence' and name=source_photo->>'path' and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880)
    or not exists(select 1 from jsonb_array_elements(source_event.snapshot->'actual') original where original->>'equipment_key'=item->>'equipment_key'
     and original->>'unit_tag'=item->>'unit_tag' and app_private.techcheck_transfer_family_v2(original->>'family')=app_private.techcheck_transfer_family_v2(item->>'family')) then
    raise exception 'The original equipment photo is unavailable or no longer matches. Add a current unit photo.';
   end if;
   original_evidence:=original_evidence||jsonb_build_array(source_photo||jsonb_build_object('source_event_id',source_event.id,'source_actor_id',source_event.actor_id,'source_actor_name',source_event.actor_name,'source_signed_at',source_event.signed_at,'provenance','Original IT checkout photo; receipt confirmed by the named Service technician.'));
  else raise exception 'Photograph each equipment item.';end if;
 end loop;
 if p_signature->>'method'='drawn' then
  if (select count(*) from jsonb_array_elements(p_photos) where value->>'kind'='signature' and value->>'path'=p_signature->>'path')<>1 then raise exception 'Upload the drawn signature.';end if;
  signature:=signature||jsonb_build_object('path',p_signature->>'path');
 elsif exists(select 1 from jsonb_array_elements(p_photos) where value->>'kind'='signature') then raise exception 'Typed sign-off cannot include a drawn signature.';end if;
 snapshot:=jsonb_build_object('version',2,'transfer_id',t.id,'state',next_state,'revision',t.revision,'purpose',t.purpose,'purpose_revision',t.purpose_revision,
  'it_name',t.it_name,'service_name',t.service_name,'expected',t.manifest,'actual',items,'checks',p_checks,'differences',differences,'signature',signature,'notes',p_notes,'original_evidence',original_evidence);
 insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos) values(p_request_id,t.id,actor,actor_name,p_kind,request,snapshot,p_photos);
 insert into app_private.techcheck_transfer_outbox(event_id,transfer_id) values(p_request_id,t.id);
 return snapshot||jsonb_build_object('event_id',p_request_id,'replayed',false,'delivery','queued');
end$$;
commit;
