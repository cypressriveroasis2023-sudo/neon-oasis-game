-- REVIEW CANDIDATE. Exact per-item returns preserve every outstanding reservation.
-- No shelf release, truck stock, placement or camera-health write occurs here.
begin;
alter table app_private.techcheck_transfers drop constraint techcheck_transfers_state_check;
alter table app_private.techcheck_transfers add constraint techcheck_transfers_state_check check(state in ('awaiting_service','discrepancy','accepted','partial_return','returned_review','returned_repair','cancelled'));
create table app_private.techcheck_transfer_item_returns (
 transfer_id uuid not null references app_private.techcheck_transfers(id),
 equipment_key text not null references public.equipment_master(equipment_key),
 event_id uuid not null references app_private.techcheck_transfer_events(id),
 passed boolean not null,returned_at timestamptz not null default now(),
 primary key(transfer_id,equipment_key)
);
alter table app_private.techcheck_transfer_item_returns enable row level security;
revoke all on app_private.techcheck_transfer_item_returns from public,anon,authenticated,service_role;
-- Original v1 signature, identity, evidence, idempotency and checklist validation
-- is retained below; return acceptance now validates a nonempty exact subset.
create or replace function app_private.submit_techcheck_transfer_core_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); role text:=app_private.techcheck_transfer_role(); actor_name text; receiver_name text;
 previous app_private.techcheck_transfer_events%rowtype; t app_private.techcheck_transfers%rowtype;
 equipment public.equipment_master%rowtype; rules app_private.techcheck_transfer_rules%rowtype;
 request jsonb:=jsonb_build_object('transfer_id',p_transfer_id,'kind',p_kind,'revision',p_expected_revision,'service_actor',p_service_actor,'items',p_items,'checks',p_checks,'signature',p_signature,'photos',p_photos,'notes',p_notes);
 items jsonb; item jsonb; expected jsonb; photo jsonb; signature jsonb; differences jsonb:='[]'; snapshot jsonb; field text; next_state text; pass boolean:=true;
begin
 if (select enabled from app_private.techcheck_transfer_settings where singleton) is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 if role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('checkout','receipt','return','cancel') or p_request_id is null or p_transfer_id is null then raise exception 'Invalid transfer action.';end if;
 if (p_kind='receipt' and role<>'service') or (p_kind<>'receipt' and role<>'it') then raise exception 'This action is not allowed for your role.' using errcode='42501';end if;
 -- A lost response repeats the identical request, not a second custody change.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into previous from app_private.techcheck_transfer_events where id=p_request_id;
 if found then
  if previous.actor_id<>actor or previous.request is distinct from request then raise exception 'Request ID already used with different details.';end if;
  return previous.snapshot||jsonb_build_object('event_id',previous.id,'replayed',true,'delivery',coalesce((select status from app_private.techcheck_transfer_outbox where event_id=p_request_id),'queued'));
 end if;
 if p_notes is null or length(p_notes)>2000 then raise exception 'Notes must be at most 2000 characters.';end if;
 if jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Checks and photos required.';end if;
 if jsonb_array_length(p_photos)>60 then raise exception 'Too many photos.';end if;
 select coalesce(nullif(btrim(full_name),''),username) into actor_name from public.profiles where user_id=actor;
 if jsonb_typeof(p_signature) is distinct from 'object' or (p_signature->'confirmed') is distinct from 'true'::jsonb or p_signature->>'method' is null or p_signature->>'method' not in ('typed','drawn')
 or lower(regexp_replace(btrim(p_signature->>'name'),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(actor_name),'[[:space:]]+',' ','g')) then raise exception 'Sign and confirm using your own technician account name.';end if;
 signature:=jsonb_build_object('method',p_signature->>'method','name',actor_name,'signed_by',actor,'signed_at',now(),'timezone','America/Chicago','statement_version',1,'statement','I physically checked the equipment listed in this transfer. My entries and photos accurately record what I handed over, received or returned.');
 items:=app_private.techcheck_transfer_manifest(p_items,p_kind in ('receipt','cancel'));
 if p_kind='checkout' then
  if p_transfer_id<>p_request_id or p_expected_revision is distinct from 0 then raise exception 'A new handoff needs a new request ID.';end if;
  select coalesce(nullif(btrim(full_name),''),username) into receiver_name from public.profiles p where p.user_id=p_service_actor and p.role::text='service' and p.active and p.archived_at is null;
  if not found then raise exception 'Choose an active Service technician.';end if;
  -- Sorted locks serialize intersecting equipment sets, including across different IT actors.
  for item in select value from jsonb_array_elements(items) order by value->>'equipment_key' loop
   perform pg_advisory_xact_lock(hashtextextended(item->>'equipment_key',2));
   select * into equipment from public.equipment_master where equipment_key=item->>'equipment_key' for update;
   if not found or equipment.tracker_state is distinct from 'shop' then raise exception 'Equipment is not recorded in Shop. Verify placement first.';end if;
   if item->>'family' is distinct from equipment.canonical_family or item->>'unit_tag' is distinct from equipment.unit_tag then raise exception 'Equipment identity changed. Reload and check the exact unit.';end if;
   if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=equipment.equipment_key) then raise exception 'Equipment already has an unresolved handoff or return.';end if;
   select * into rules from app_private.techcheck_transfer_rules where workflow_type=equipment.workflow_type and workflow_type=equipment.canonical_family;
   if not found then raise exception 'No approved check-only rule mapping exists for this equipment.';end if;
   for field in select jsonb_array_elements_text(rules.bool_fields) loop
    if (p_checks->equipment.equipment_key->field) is distinct from 'true'::jsonb then raise exception 'Pass every required IT equipment check.';end if;
   end loop;
   if (equipment.workflow_type='Helios' and (item->>'battery_count')::integer<>1) or (item->>'battery_count')::integer<rules.minimum_batteries then raise exception 'Unit battery requirement not met.';end if;
  end loop;
  next_state:='awaiting_service';
  insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state) values(p_transfer_id,actor,p_service_actor,actor_name,receiver_name,items,next_state) returning * into t;
  insert into app_private.techcheck_transfer_reservations select value->>'equipment_key',t.id from jsonb_array_elements(items);
 else
  select * into t from app_private.techcheck_transfers where id=p_transfer_id for update;
  if not found or (role='service' and t.service_actor<>actor) then raise exception 'Handoff unavailable for your account.' using errcode='42501';end if;
  if p_expected_revision is distinct from t.revision then raise exception 'Handoff changed. Reload before submitting.';end if;
  if p_service_actor is distinct from t.service_actor then raise exception 'The named Service technician cannot be changed.';end if;
  if p_kind='receipt' then
   if t.state not in ('awaiting_service','discrepancy') then raise exception 'This handoff cannot be accepted again.';end if;
   for expected in select value from jsonb_array_elements(t.manifest) loop
    select value into item from jsonb_array_elements(items) where value->>'equipment_key'=expected->>'equipment_key';
    if not found then differences:=differences||jsonb_build_array(jsonb_build_object('equipment_key',expected->>'equipment_key','field','item','expected','Present','actual','Missing'));
    else
     foreach field in array array['family','unit_tag','sims','battery_count','parts'] loop
      if item->field is distinct from expected->field then differences:=differences||jsonb_build_array(jsonb_build_object('equipment_key',expected->>'equipment_key','field',field,'expected',expected->field,'actual',item->field));end if;
     end loop;
    end if;
   end loop;
   for item in select value from jsonb_array_elements(items) loop
    if not exists(select 1 from jsonb_array_elements(t.manifest) where value->>'equipment_key'=item->>'equipment_key') then raise exception 'Unexpected equipment identity. Record a discrepancy against the assigned item.';end if;
   end loop;
   next_state:=case when jsonb_array_length(differences)=0 then 'accepted' else 'discrepancy' end;
  elsif p_kind='return' then
   if t.state not in ('accepted','partial_return','returned_repair') then raise exception 'Only accepted outstanding equipment or a repair-held item can be checked back in.';end if;
   for item in select value from jsonb_array_elements(items) loop
    if not exists(select 1 from jsonb_array_elements(t.manifest) original where original=item) then raise exception 'Return the exact equipment and accessories recorded in this handoff.';end if;
    if exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id and r.equipment_key=item->>'equipment_key' and r.passed) then raise exception 'This equipment item has already been returned.';end if;
    if exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id and r.equipment_key=item->>'equipment_key') and length(btrim(p_notes))<10 then raise exception 'Record the repair and physical reinspection details.';end if;
    foreach field in array array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'] loop
     if jsonb_typeof(p_checks->(item->>'equipment_key')->field) is distinct from 'boolean' then raise exception 'Answer every intake condition check.';end if;
     pass:=pass and (p_checks->(item->>'equipment_key')->>field)::boolean;
    end loop;
   end loop;
   if not pass and length(btrim(p_notes))=0 then raise exception 'Explain the failed intake check.';end if;
   next_state:=case
    when exists(select 1 from jsonb_array_elements(t.manifest) original where not exists(select 1 from jsonb_array_elements(items) returned where returned->>'equipment_key'=original->>'equipment_key') and not exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id and r.equipment_key=original->>'equipment_key')) then 'partial_return'
    when not pass or exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id and not r.passed and not exists(select 1 from jsonb_array_elements(items) checked where checked->>'equipment_key'=r.equipment_key)) then 'returned_repair'
    else 'returned_review' end;
   -- No automatic shelf availability: retain reservation until legacy inventory review is reconciled.
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
  if not exists(select 1 from jsonb_array_elements(p_photos) where value->>'equipment_key'=item->>'equipment_key' and value->>'kind'='unit') then raise exception 'Photograph each equipment item.';end if;
 end loop;
 if p_signature->>'method'='drawn' then
  if (select count(*) from jsonb_array_elements(p_photos) where value->>'kind'='signature' and value->>'path'=p_signature->>'path')<>1 then raise exception 'Upload the drawn signature.';end if;
  signature:=signature||jsonb_build_object('path',p_signature->>'path');
 elsif exists(select 1 from jsonb_array_elements(p_photos) where value->>'kind'='signature') then raise exception 'Typed sign-off cannot include a drawn signature.';end if;
 snapshot:=jsonb_build_object('transfer_id',t.id,'state',next_state,'revision',t.revision,'it_name',t.it_name,'service_name',t.service_name,'expected',t.manifest,'actual',items,'checks',p_checks,'differences',differences,'signature',signature,'notes',p_notes);
 if p_kind='return' then
  snapshot:=snapshot||jsonb_build_object(
   'previous_returns',coalesce((select jsonb_agg(jsonb_build_object('equipment_key',r.equipment_key,'event_id',r.event_id,'passed',r.passed) order by r.equipment_key) from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id),'[]'::jsonb),
   'remaining',coalesce((select jsonb_agg(original order by original->>'equipment_key') from jsonb_array_elements(t.manifest) original where not exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=t.id and r.equipment_key=original->>'equipment_key') and not exists(select 1 from jsonb_array_elements(items) returned where returned->>'equipment_key'=original->>'equipment_key')),'[]'::jsonb));
 end if;
 insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos) values(p_request_id,t.id,actor,actor_name,p_kind,request,snapshot,p_photos);
 if p_kind='return' then
  insert into app_private.techcheck_transfer_item_returns(transfer_id,equipment_key,event_id,passed)
  select t.id,row_item.value->>'equipment_key',p_request_id,(select bool_and((p_checks->(row_item.value->>'equipment_key')->>check_field.name)::boolean) from unnest(array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok']) check_field(name)) from jsonb_array_elements(items) row_item(value)
  on conflict(transfer_id,equipment_key) do update set event_id=excluded.event_id,passed=excluded.passed,returned_at=now();
 end if;
 insert into app_private.techcheck_transfer_outbox(event_id,transfer_id) values(p_request_id,t.id);
 return snapshot||jsonb_build_object('event_id',p_request_id,'replayed',false,'delivery',coalesce((select status from app_private.techcheck_transfer_outbox where event_id=p_request_id),'queued'));
end$$;

revoke all on function app_private.submit_techcheck_transfer_core_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create or replace function public.techcheck_transfer_context_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;transfers jsonb;
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 result:=app_private.techcheck_transfer_context_core_v1();
 select coalesce(jsonb_agg(t||jsonb_build_object(
  'returned_items',coalesce((select jsonb_agg(jsonb_build_object('equipment_key',r.equipment_key,'event_id',r.event_id,'passed',r.passed,'returned_at',r.returned_at) order by r.equipment_key) from app_private.techcheck_transfer_item_returns r where r.transfer_id=(t->>'id')::uuid),'[]'::jsonb),
  'remaining',coalesce((select jsonb_agg(item order by item->>'equipment_key') from jsonb_array_elements(t->'manifest') item where not exists(select 1 from app_private.techcheck_transfer_item_returns r where r.transfer_id=(t->>'id')::uuid and r.equipment_key=item->>'equipment_key')),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(e||jsonb_build_object('delivery',coalesce(o.status,'pending'))) from jsonb_array_elements(t->'events') e left join app_private.techcheck_transfer_outbox o on o.event_id=(e->>'id')::uuid),'[]'::jsonb)
 )),'[]'::jsonb) into transfers from jsonb_array_elements(result->'transfers') t;
 return result||jsonb_build_object('transfers',transfers,'delivery','event_scoped');
end$$;
commit;
