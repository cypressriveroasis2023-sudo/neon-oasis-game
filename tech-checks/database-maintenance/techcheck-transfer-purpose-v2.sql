-- Explicit handoff purpose and one Service receipt per purpose revision.
-- Install after transfer integration v3. Original signed events, stock, placement,
-- reservations, provider settings and all delivery state are retained.
begin;

-- Fail closed if this release has already been installed or the required base is absent.
do $$begin
 if to_regprocedure('app_private.submit_techcheck_transfer_core_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is null
  or to_regprocedure('public.techcheck_transfer_context_v1()') is null
  or to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is null
  or to_regprocedure('app_private.techcheck_transfer_custody_hold_v1(text)') is null then
  raise exception 'Installed named-handoff integration v3 is required.';
 end if;
 if md5(pg_get_functiondef('app_private.submit_techcheck_transfer_core_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)) is distinct from 'd82ec0cda915424ed64b46ea4400618e'
  or md5(pg_get_functiondef('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)) is distinct from '193131adc4982540c49d4687e86e3bad'
  or md5(pg_get_functiondef('public.techcheck_transfer_context_v1()'::regprocedure)) is distinct from 'f4c442d9141615867e315c98458154e1' then
  raise exception 'Installed handoff function drift detected. Review the current functions before release.';
 end if;
 if to_regprocedure('public.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)') is not null then
  raise exception 'Handoff purpose repair is already installed. Review the installed version.';
 end if;
end$$;

alter table app_private.techcheck_transfers
 add column purpose text check(purpose in ('truck_replenishment','installation')),
 add column purpose_revision integer not null default 0 check(purpose_revision>=0),
 add constraint techcheck_transfer_purpose_revision_check check(
  (purpose is null and purpose_revision=0) or (purpose is not null and purpose_revision between 1 and revision));
alter table app_private.techcheck_transfer_events drop constraint techcheck_transfer_events_kind_check;
alter table app_private.techcheck_transfer_events add constraint techcheck_transfer_events_kind_check
 check(kind in ('checkout','receipt','return','cancel','purpose_amendment'));

create function app_private.techcheck_transfer_event_immutable_v2() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'Submitted handoff records and signed evidence are immutable.';
end$$;
revoke all on function app_private.techcheck_transfer_event_immutable_v2() from public,anon,authenticated,service_role;
create trigger techcheck_transfer_event_immutable_v2 before update or delete on app_private.techcheck_transfer_events
 for each row execute function app_private.techcheck_transfer_event_immutable_v2();

-- Display-only normalization is limited to the six approved families. Keys,
-- complete unit tags, SIM strings and unknown family values remain exact.
create function app_private.techcheck_transfer_family_v2(p_family text) returns text
language sql immutable set search_path='' as $$
 select case lower(regexp_replace(btrim(p_family),'[[:space:]]+',' ','g'))
  when 'sniper' then 'Sniper' when 'ranger' then 'Ranger' when 'spotter' then 'Spotter'
  when 'solar spotter' then 'Solar Spotter' when 'recon 2' then 'Recon 2'
  when 'helios' then 'Helios' else p_family end
$$;
revoke all on function app_private.techcheck_transfer_family_v2(text) from public,anon,authenticated,service_role;

-- Reuse the original exact-identity/SIM/parts validation without recording a
-- fictitious battery quantity for replenishment. Installation plans are explicit.
create function app_private.techcheck_transfer_manifest_v2(p_items jsonb,p_purpose text,p_empty boolean default false,p_require_plan boolean default true) returns jsonb
language plpgsql set search_path='' as $$
declare v_input jsonb;v_items jsonb;v_result jsonb:='[]';v_item jsonb;v_raw jsonb;v_config text;v_family text;v_required integer;
begin
 if p_purpose is null or p_purpose not in ('truck_replenishment','installation') then raise exception 'Choose Truck replenishment or Installation.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid equipment list.';end if;
 if p_purpose='truck_replenishment' then
  if exists(select 1 from jsonb_array_elements(p_items) i where i->'battery_count' is distinct from 'null'::jsonb
   or (i ? 'battery_configuration' and i->'battery_configuration' is distinct from 'null'::jsonb)) then
   raise exception 'Truck replenishment does not include a battery quantity or installation plan.';
  end if;
  select coalesce(jsonb_agg(i||jsonb_build_object('battery_count',0)),'[]') into v_input from jsonb_array_elements(p_items) i;
 else v_input:=p_items;end if;
 v_items:=app_private.techcheck_transfer_manifest(v_input,p_empty);
 for v_item in select value from jsonb_array_elements(v_items) loop
  if p_purpose='truck_replenishment' then
   v_result:=v_result||jsonb_build_array(v_item||jsonb_build_object('battery_count',null,'battery_configuration',null,'required_battery_count',null));
  else
   select value into strict v_raw from jsonb_array_elements(p_items) where btrim(value->>'equipment_key')=v_item->>'equipment_key';
   v_config:=btrim(v_raw->>'battery_configuration');v_family:=app_private.techcheck_transfer_family_v2(v_item->>'family');
   v_required:=case
    when v_family='Sniper' and v_config='sniper_2x_12v_35ah' then 2
    when v_family='Ranger' and v_config='lifepo4_1x' then 1
    when v_family='Spotter' and v_config='none' then 0
    when v_family='Solar Spotter' and v_config='agm_4x_12v_110ah' then 4
    when v_family='Helios' and v_config='helios_battery_box' then 1
    when v_family='Recon 2' and v_config='recon_configured' then 1 end;
   if p_require_plan and v_required is null then raise exception 'Choose the approved installation battery configuration for each equipment family.';end if;
   if not p_require_plan and v_raw ? 'battery_configuration' and v_raw->'battery_configuration' is distinct from 'null'::jsonb and (jsonb_typeof(v_raw->'battery_configuration') is distinct from 'string' or length(v_config)>100) then raise exception 'Record the actual installation battery configuration as text.';end if;
   if p_require_plan and ((v_family='Recon 2' and (v_item->>'battery_count')::integer<1)
    or (v_family<>'Recon 2' and (v_item->>'battery_count')::integer<>v_required)) then raise exception 'Installation battery quantity does not match the chosen configuration.';end if;
   if v_family='Recon 2' and p_require_plan then v_required:=(v_item->>'battery_count')::integer;end if;
   v_result:=v_result||jsonb_build_array(v_item||jsonb_build_object('battery_configuration',v_config,'required_battery_count',v_required));
  end if;
 end loop;
 return v_result;
end$$;
revoke all on function app_private.techcheck_transfer_manifest_v2(jsonb,text,boolean,boolean) from public,anon,authenticated,service_role;

create function app_private.techcheck_transfer_differences_v2(p_expected jsonb,p_actual jsonb,p_purpose text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_expected jsonb;v_item jsonb;v_field text;v_differences jsonb:='[]';
begin
 for v_expected in select value from jsonb_array_elements(p_expected) loop
  select value into v_item from jsonb_array_elements(p_actual) where value->>'equipment_key'=v_expected->>'equipment_key';
  if not found then
   v_differences:=v_differences||jsonb_build_array(jsonb_build_object('equipment_key',v_expected->>'equipment_key','field','item','expected','Present','actual','Missing'));
  else
   foreach v_field in array array['family','unit_tag','sims','parts','battery_count','battery_configuration'] loop
    if p_purpose='truck_replenishment' and v_field in ('battery_count','battery_configuration') then continue;end if;
    if v_field='family' and app_private.techcheck_transfer_family_v2(v_item->>'family') is not distinct from app_private.techcheck_transfer_family_v2(v_expected->>'family') then continue;end if;
    if v_item->v_field is distinct from v_expected->v_field then
     v_differences:=v_differences||jsonb_build_array(jsonb_build_object('equipment_key',v_expected->>'equipment_key','field',v_field,'expected',v_expected->v_field,'actual',v_item->v_field));
    end if;
   end loop;
  end if;
 end loop;
 for v_item in select value from jsonb_array_elements(p_actual) loop
  if not exists(select 1 from jsonb_array_elements(p_expected) where value->>'equipment_key'=v_item->>'equipment_key') then
   raise exception 'Unexpected equipment identity. Record a discrepancy against the assigned item.';
  end if;
 end loop;
 return v_differences;
end$$;
revoke all on function app_private.techcheck_transfer_differences_v2(jsonb,jsonb,text) from public,anon,authenticated,service_role;

-- Preserve the exact installed legacy paths for frozen-request recovery and
-- legacy return/cancel. Old pages cannot create another unclassified handoff.
alter function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) set schema app_private;
alter function app_private.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) rename to submit_techcheck_transfer_pre_purpose_v1;
revoke all on function app_private.submit_techcheck_transfer_pre_purpose_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then
  return app_private.submit_techcheck_transfer_pre_purpose_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
 end if;
 if p_kind='receipt' then raise exception 'Your receipt may already be saved. Reload the handoff; IT must confirm its purpose before a new receipt.';end if;
 if p_kind='checkout' then raise exception 'Reload the app and choose Truck replenishment or Installation.';end if;
 if exists(select 1 from app_private.techcheck_transfers where id=p_transfer_id and purpose is not null) then raise exception 'Reload the app to use the current handoff.';end if;
 return app_private.submit_techcheck_transfer_pre_purpose_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

create function app_private.submit_techcheck_transfer_v2(
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
revoke all on function app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text) to authenticated;
create function public.submit_techcheck_transfer_v2(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text,p_purpose text
) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.submit_techcheck_transfer_v2(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes,p_purpose)
$$;
revoke all on function public.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text) to authenticated;

-- Classify an unlabelled legacy transfer, under the actual Owner/original IT
-- identity. This never reuses an earlier Service signature or declares receipt.
create function app_private.classify_techcheck_transfer_purpose_v1(p_request_id uuid,p_transfer_id uuid,p_expected_revision integer,p_purpose text,p_items jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();role text:=app_private.techcheck_transfer_role();actor_name text;actor_role text;
 t app_private.techcheck_transfers%rowtype;old_t app_private.techcheck_transfers%rowtype;previous app_private.techcheck_transfer_events%rowtype;original app_private.techcheck_transfer_events%rowtype;
 request jsonb:=jsonb_build_object('kind','purpose_amendment','transfer_id',p_transfer_id,'revision',p_expected_revision,'purpose',p_purpose,'items',p_items,'reason',p_reason);
 items jsonb;item jsonb;before_item jsonb;snapshot jsonb;expected_keys text[];reserved_keys text[];field text;rules app_private.techcheck_transfer_rules%rowtype;
begin
 if actor is null or role is distinct from 'it' then raise exception 'Active Owner or original submitting IT account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 if p_request_id is null or p_transfer_id is null then raise exception 'Request and handoff IDs are required.';end if;
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into previous from app_private.techcheck_transfer_events where id=p_request_id;
 if found then
  if previous.actor_id<>actor or previous.request is distinct from request then raise exception 'Request ID already used with different details.';end if;
  return previous.snapshot||jsonb_build_object('event_id',previous.id,'replayed',true,'delivery',(select status from app_private.techcheck_transfer_outbox where event_id=previous.id));
 end if;
 select * into t from app_private.techcheck_transfers where id=p_transfer_id for update;
 select coalesce(nullif(btrim(full_name),''),username),p.role::text into actor_name,actor_role from public.profiles p where p.user_id=actor;
 if t.id is null or (t.it_actor<>actor and actor_role<>'owner') then raise exception 'Only the original IT technician or Owner can classify this handoff.' using errcode='42501';end if;
 if p_expected_revision is distinct from t.revision then raise exception 'Handoff changed. Reload before confirming its purpose.';end if;
 if t.purpose is not null then raise exception 'This handoff already has a recorded purpose. It cannot be reopened by classifying it again.';end if;
 if t.state not in ('awaiting_service','discrepancy') then raise exception 'Only an unaccepted handoff can be classified.';end if;
 if exists(select 1 from app_private.techcheck_transfer_events e where e.transfer_id=t.id and (e.kind in ('return','cancel') or e.snapshot->>'state'='accepted')) then raise exception 'A completed custody event prevents this purpose change.';end if;
 if p_reason is null or length(btrim(p_reason)) not between 5 and 2000 then raise exception 'Explain the handoff purpose in 5 to 2000 characters.';end if;
 select * into original from app_private.techcheck_transfer_events where transfer_id=t.id and kind='checkout' order by signed_at,id limit 1;
 if original.id is null or original.actor_id<>t.it_actor then raise exception 'Original signed handoff is unavailable. Owner review required.';end if;
 items:=app_private.techcheck_transfer_manifest_v2(p_items,p_purpose,false,true);
 if jsonb_array_length(items)<>jsonb_array_length(t.manifest) then raise exception 'Purpose classification cannot change equipment identities or quantities.';end if;
 for item in select value from jsonb_array_elements(items) loop
  select value into before_item from jsonb_array_elements(t.manifest) where value->>'equipment_key'=item->>'equipment_key';
  if before_item is null or item->>'unit_tag' is distinct from before_item->>'unit_tag'
   or app_private.techcheck_transfer_family_v2(item->>'family') is distinct from app_private.techcheck_transfer_family_v2(before_item->>'family')
   or item->'sims' is distinct from before_item->'sims' or item->'parts' is distinct from before_item->'parts' then
   raise exception 'Purpose classification cannot change the unit, SIMs or parts. Use the audited equipment correction workflow.';
  end if;
  if p_purpose='installation' then
   select * into rules from app_private.techcheck_transfer_rules where workflow_type=app_private.techcheck_transfer_family_v2(item->>'family');
   if not found then raise exception 'No approved installation rule mapping exists for this equipment.';end if;
   for field in select jsonb_array_elements_text(rules.bool_fields) union select unnest(case when rules.workflow_type='Helios' then array['delivery_monitoring_ok','delivery_customer_email_app_ok'] else array['delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'] end) loop
    if original.snapshot->'checks'->(item->>'equipment_key')->field is distinct from 'true'::jsonb then
     raise exception 'Original handoff lacks installation readiness checks. Cancel it and create an Installation handoff with the required checks.';
    end if;
   end loop;
  end if;
 end loop;
 select array_agg(value->>'equipment_key' order by value->>'equipment_key') into expected_keys from jsonb_array_elements(t.manifest);
 select array_agg(equipment_key order by equipment_key) into reserved_keys from app_private.techcheck_transfer_reservations where transfer_id=t.id;
 if expected_keys is distinct from reserved_keys then raise exception 'Handoff reservations changed. Owner custody review required.';end if;
 old_t:=t;
 update app_private.techcheck_transfers set purpose=p_purpose,purpose_revision=revision+1,revision=revision+1,state='awaiting_service',manifest=items,updated_at=now() where id=t.id returning * into t;
 snapshot:=jsonb_build_object('version',2,'event_id',p_request_id,'transfer_id',t.id,'kind','purpose_amendment','state',t.state,'revision',t.revision,'purpose',t.purpose,'purpose_revision',t.purpose_revision,
  'previous_purpose',old_t.purpose,'previous_state',old_t.state,'previous_revision',old_t.revision,'before',old_t.manifest,'expected',items,'actual',items,'differences','[]'::jsonb,'checks','{}'::jsonb,
  'it_name',t.it_name,'service_name',t.service_name,'original_event_id',original.id,'reason',btrim(p_reason),'notes',btrim(p_reason),
  'applied_by',jsonb_build_object('id',actor,'name',actor_name,'role',actor_role),'recorded_at',now(),
  'statement','The handoff purpose is recorded under my own account. Original signed records remain unchanged. The named Service technician must independently confirm receipt.');
 insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos) values(p_request_id,t.id,actor,actor_name,'purpose_amendment',request,snapshot,'[]');
 insert into app_private.techcheck_transfer_outbox(event_id,transfer_id) values(p_request_id,t.id);
 return snapshot||jsonb_build_object('replayed',false,'delivery','queued');
end$$;
revoke all on function app_private.classify_techcheck_transfer_purpose_v1(uuid,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.classify_techcheck_transfer_purpose_v1(uuid,uuid,integer,text,jsonb,text) to authenticated;
create function public.classify_techcheck_transfer_purpose_v1(p_request_id uuid,p_transfer_id uuid,p_expected_revision integer,p_purpose text,p_items jsonb,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select app_private.classify_techcheck_transfer_purpose_v1(p_request_id,p_transfer_id,p_expected_revision,p_purpose,p_items,p_reason)$$;
revoke all on function public.classify_techcheck_transfer_purpose_v1(uuid,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.classify_techcheck_transfer_purpose_v1(uuid,uuid,integer,text,jsonb,text) to authenticated;

alter function public.techcheck_transfer_context_v1() set schema app_private;
alter function app_private.techcheck_transfer_context_v1() rename to techcheck_transfer_context_pre_purpose_v1;
revoke all on function app_private.techcheck_transfer_context_pre_purpose_v1() from public,anon,authenticated,service_role;
create function public.techcheck_transfer_context_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;transfers jsonb;role text:=app_private.techcheck_transfer_role();actor_role text;
begin
 result:=app_private.techcheck_transfer_context_pre_purpose_v1();
 select p.role::text into actor_role from public.profiles p where p.user_id=auth.uid();
 select coalesce(jsonb_agg(t||jsonb_build_object(
  'receipt_required',t->>'purpose' is not null and t->>'state'='awaiting_service' and not exists(select 1 from app_private.techcheck_transfer_events e where e.transfer_id=(t->>'id')::uuid and e.kind='receipt' and (e.snapshot->>'revision')::integer>=(t->>'purpose_revision')::integer),
  'can_classify_purpose',role='it' and t->>'purpose' is null and t->>'state' in ('awaiting_service','discrepancy') and (t->>'it_actor'=auth.uid()::text or actor_role='owner'))),'[]') into transfers
 from jsonb_array_elements(result->'transfers') t;
 return result||jsonb_build_object('transfers',transfers,'purpose_version',2);
end$$;
revoke all on function public.techcheck_transfer_context_v1() from public,anon,service_role;
grant execute on function public.techcheck_transfer_context_v1() to authenticated;
commit;
