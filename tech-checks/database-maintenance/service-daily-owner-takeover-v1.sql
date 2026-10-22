-- Owner daily closeout is an administrative exception, never a Service signature.
-- No original morning_check or truck inventory check is altered or forged.
-- A distinct Owner-authorized departure can be revoked automatically when stock,
-- SIMs, assignments or the safety inspection change.
begin;

do $guard$
begin
 if to_regclass('app_private.service_daily_reports') is null
    or to_regprocedure('public.service_departure_readiness_v1(uuid)') is null
    or to_regprocedure('public.owner_tech_command_board_v2(date)') is null then
  raise exception 'The existing Service daily report and command board are required.';
 end if;
 if md5(pg_get_functiondef('public.service_departure_readiness_v1(uuid)'::regprocedure)) <> 'b5fa0267c401b93339883eb1eba6ef3c'
    or md5(pg_get_functiondef('public.owner_tech_command_board_v2(date)'::regprocedure)) <> 'f3ec2026f5fa79c1fd0a6674909a5a1c' then
  raise exception 'Readiness functions changed: review live functions before installing Owner takeover.';
 end if;
 if to_regclass('app_private.service_daily_owner_takeovers_v1') is not null then
  raise exception 'Owner takeover v1 is already installed.';
 end if;
end $guard$;

create table app_private.service_daily_owner_takeovers_v1 (
 report_id uuid primary key references app_private.service_daily_reports(id),
 service_tech_id uuid not null references public.profiles(user_id),
 check_date date not null,
 owner_id uuid not null references public.profiles(user_id),
 owner_name text not null,
 reason text not null check(length(btrim(reason)) between 12 and 2000),
 departure_authorized boolean not null default false,
 inventory_fingerprint jsonb not null,
 inspection_id uuid,
 created_at timestamptz not null default now(),
 unique(service_tech_id,check_date)
);
alter table app_private.service_daily_owner_takeovers_v1 enable row level security;
revoke all on app_private.service_daily_owner_takeovers_v1 from public,anon,authenticated;

create function app_private.service_daily_inventory_fingerprint_v1(p_tech uuid)
 returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'units',coalesce((select jsonb_object_agg(u.equipment_type,
    coalesce(u.status,'')||'|'||coalesce(u.unit_tag,''))
   from public.service_truck_units u where u.service_tech_id=p_tech),'{}'::jsonb),
  'sims',coalesce((select jsonb_object_agg(s.slot_no::text,
    coalesce(s.status,'')||'|'||coalesce(s.sim_number,''))
   from public.service_truck_sims s where s.service_tech_id=p_tech),'{}'::jsonb),
  'stock',coalesce((select to_jsonb(s)-'service_tech_id'-'updated_by'-'updated_by_name'
   from public.service_truck_stock s where s.service_tech_id=p_tech),'{}'::jsonb)
 )
 $$;
revoke all on function app_private.service_daily_inventory_fingerprint_v1(uuid) from public,anon,authenticated;

create function app_private.service_daily_owner_departure_valid_v1(p_tech uuid)
 returns boolean language plpgsql stable security definer set search_path='' as $$
declare
 v_row app_private.service_daily_owner_takeovers_v1%rowtype;
 v_mc public.morning_checks%rowtype;
begin
 select * into v_row from app_private.service_daily_owner_takeovers_v1 o
 where o.service_tech_id=p_tech and o.check_date=timezone('America/Chicago',now())::date
   and o.departure_authorized;
 if not found then return false; end if;
 if v_row.inventory_fingerprint is distinct from app_private.service_daily_inventory_fingerprint_v1(p_tech)
   or exists(select 1 from public.service_truck_restock_requests r
             where r.service_tech_id=p_tech and r.status not in ('issued','cancelled')) then
  return false;
 end if;
 select * into v_mc from public.morning_checks m
 where m.service_tech_id=p_tech and timezone('America/Chicago',m.submitted_at)::date=v_row.check_date
 order by m.submitted_at desc limit 1;
 if not found or v_mc.is_test or v_mc.id is distinct from v_row.inspection_id then return false;end if;
 return coalesce(jsonb_typeof(v_mc.truck_checks)='object',false)
   and (select count(*) from jsonb_each(v_mc.truck_checks))=8
   and not exists(select 1 from jsonb_each(v_mc.truck_checks) x where x.value<>'true'::jsonb)
   and v_mc.taking_trailer is not null
   and (not v_mc.taking_trailer or (
    jsonb_typeof(v_mc.trailer_checks)='object'
    and (select count(*) from jsonb_each(v_mc.trailer_checks))=7
    and not exists(select 1 from jsonb_each(v_mc.trailer_checks) x where x.value<>'true'::jsonb)
   ));
end $$;
revoke all on function app_private.service_daily_owner_departure_valid_v1(uuid) from public,anon,authenticated;

create function app_private.owner_takeover_service_daily_v1(
 p_report_id uuid,p_service_tech_id uuid,p_check_date date,p_reason text,
 p_authorize_departure boolean,p_owner_acknowledged boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();
 v_today date:=timezone('America/Chicago',now())::date;
 v_owner public.profiles%rowtype;
 v_tech public.profiles%rowtype;
 v_mc public.morning_checks%rowtype;
 v_existing app_private.service_daily_reports%rowtype;
 v_ready jsonb;
 v_snapshot jsonb;
 v_request jsonb:=jsonb_build_object('version',1,'service_tech_id',p_service_tech_id,
  'check_date',p_check_date,'reason',btrim(p_reason),'authorize_departure',p_authorize_departure,
  'owner_acknowledged',p_owner_acknowledged);
 v_fingerprint jsonb;
 v_authorized boolean:=coalesce(p_authorize_departure,false);
 v_units jsonb;
 v_sims jsonb;
 v_stock jsonb;
 v_name text;
begin
 select * into v_owner from public.profiles p where p.user_id=v_actor
  and p.role::text='owner' and p.active and p.archived_at is null;
 if not found then raise exception 'Active Owner account required.' using errcode='42501';end if;
 if p_report_id is null or p_service_tech_id is null or p_check_date is null then raise exception 'Report, technician and date are required.';end if;
 if p_check_date is distinct from v_today then raise exception 'Owner daily takeover is available for today only.';end if;
 if p_owner_acknowledged is distinct from true then
  raise exception 'Acknowledge that the technician did not verify the inventory and is not being signed for.';
 end if;
 if p_reason is null or length(btrim(p_reason)) not between 12 and 2000 then
  raise exception 'Enter an Owner reason (12 to 2000 characters).';
 end if;
 select * into v_tech from public.profiles p where p.user_id=p_service_tech_id
  and p.role::text='service' and p.active and p.archived_at is null;
 if not found then raise exception 'An active Service technician is required.';end if;
 v_name:=coalesce(nullif(btrim(v_tech.full_name),''),v_tech.username,'Service Technician');

 -- Same technician lock as ordinary Service completion; concurrent submissions serialize.
 perform pg_advisory_xact_lock(hashtextextended(p_service_tech_id::text,0));
 select * into v_existing from app_private.service_daily_reports where id=p_report_id;
 if found then
  if v_existing.service_tech_id is distinct from p_service_tech_id
     or v_existing.check_date is distinct from p_check_date
     or v_existing.request is distinct from v_request
     or v_existing.snapshot->'owner_takeover'->>'owner_id' is distinct from v_actor::text then
   raise exception 'Report ID belongs to a different completion.';
  end if;
  return jsonb_build_object('id',p_report_id,'replayed',true,'delivery_status',v_existing.delivery_status,
   'owner_authorized',coalesce((v_existing.snapshot#>>'{owner_takeover,departure_authorized}')::boolean,false));
 end if;
 if exists(select 1 from app_private.service_daily_reports r
           where r.service_tech_id=p_service_tech_id and r.check_date=p_check_date) then
  raise exception 'A signed or Owner-resolved daily package already exists for this technician and date.';
 end if;
 select * into v_mc from public.morning_checks m
 where m.service_tech_id=p_service_tech_id
  and timezone('America/Chicago',m.submitted_at)::date=v_today
  and m.is_test is false
 order by m.submitted_at desc limit 1;
 v_ready:=public.service_departure_readiness_v1(p_service_tech_id);
 v_units:=coalesce(v_ready->'units','[]'::jsonb);
 v_sims:=coalesce(v_ready->'sims','[]'::jsonb);
 v_stock:=coalesce(v_ready->'stock','{}'::jsonb);
 if v_authorized then
  if v_mc.id is null or coalesce((v_ready->>'inspection_ready')::boolean,false) is not true then
   raise exception 'Owner departure authorization requires a passed, saved truck and trailer inspection.';
  end if;
  if public.service_truck_stock_complete_v1(p_service_tech_id) is not true
   or jsonb_array_length(v_units)<>4
   or exists(select 1 from jsonb_array_elements(v_units) x
     where x->>'status'<>'assigned' or nullif(btrim(coalesce(x->>'unit_tag','')),'') is null)
   or jsonb_array_length(v_sims)<>3
   or exists(select 1 from jsonb_array_elements(v_sims) x
     where x->>'status'<>'assigned' or nullif(btrim(coalesce(x->>'sim_number','')),'') is null)
   or jsonb_array_length(coalesce(v_ready->'restock_requests','[]'::jsonb))<>0 then
   raise exception 'Known truck inventory shortage or unresolved restock prevents departure authorization.';
  end if;
 end if;
 v_fingerprint:=app_private.service_daily_inventory_fingerprint_v1(p_service_tech_id);
 v_snapshot:=jsonb_build_object(
  'version',1,'inspection_id',v_mc.id,'inspection_submitted_at',v_mc.submitted_at,
  'truck_checks',coalesce(v_mc.truck_checks,'{}'::jsonb),
  'taking_trailer',v_mc.taking_trailer,
  'trailer_checks',coalesce(v_mc.trailer_checks,'{}'::jsonb),
  'inventory',v_ready||jsonb_build_object('inventory_ready',
     coalesce((v_ready->>'inventory_ready')::boolean,false)),
  'signature',jsonb_build_object('method','owner_administrative','name',
     coalesce(nullif(btrim(v_owner.full_name),''),v_owner.username,'Owner'),
     'username',v_owner.username,'signed_by',v_actor,'signed_at',now(),
     'statement','OWNER ADMINISTRATIVE CLOSEOUT. This is not the Service technician signature or physical daily inventory verification.'),
  'owner_takeover',jsonb_build_object('owner_id',v_actor,
     'owner_name',coalesce(nullif(btrim(v_owner.full_name),''),v_owner.username,'Owner'),
     'reason',btrim(p_reason),'completed_at',now(),
     'departure_authorized',v_authorized,'inventory_physically_verified',false,
     'inventory_source','Most recently recorded COS assignments and counts; NOT same-day physical verification',
     'inspection_recorded',v_mc.id is not null)
 );
 insert into app_private.service_daily_reports(
  id,service_tech_id,check_date,actor_name,request,snapshot,photos
 ) values(p_report_id,p_service_tech_id,p_check_date,v_name,v_request,v_snapshot,'[]'::jsonb);
 insert into app_private.service_daily_owner_takeovers_v1(
  report_id,service_tech_id,check_date,owner_id,owner_name,reason,
  departure_authorized,inventory_fingerprint,inspection_id
 ) values(p_report_id,p_service_tech_id,p_check_date,v_actor,
   v_snapshot#>>'{owner_takeover,owner_name}',btrim(p_reason),v_authorized,v_fingerprint,v_mc.id);
 return jsonb_build_object('id',p_report_id,'replayed',false,'delivery_status','queued',
  'owner_authorized',v_authorized,'inventory_ready',false,'service_signed',false,
  'check_date',v_today);
end $$;
revoke all on function app_private.owner_takeover_service_daily_v1(uuid,uuid,date,text,boolean,boolean)
 from public,anon,authenticated,service_role;
grant execute on function app_private.owner_takeover_service_daily_v1(uuid,uuid,date,text,boolean,boolean) to authenticated;

create function public.owner_takeover_service_daily_v1(
 p_report_id uuid,p_service_tech_id uuid,p_check_date date,p_reason text,
 p_authorize_departure boolean,p_owner_acknowledged boolean
) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.owner_takeover_service_daily_v1(
  p_report_id,p_service_tech_id,p_check_date,p_reason,p_authorize_departure,p_owner_acknowledged)
 $$;
revoke all on function public.owner_takeover_service_daily_v1(uuid,uuid,date,text,boolean,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.owner_takeover_service_daily_v1(uuid,uuid,date,text,boolean,boolean)
 to authenticated;

-- Keep the existing readiness RPC contract. No physical verification row is written.
-- "departure_ready" means the Owner may release a truck with an explicitly marked exception.
-- "inventory_ready" remains FALSE until Service actually verifies.
do $patch_readiness$
declare v_src text;v_replaced text;
begin
 v_src:=pg_get_functiondef('public.service_departure_readiness_v1(uuid)'::regprocedure);
 v_replaced:=replace(v_src,'  v_active_restock integer := 0;',
  '  v_active_restock integer := 0;'||E'\n'||'  v_owner_authorized boolean := false;');
 if v_replaced=v_src then raise exception 'Readiness declaration changed.';end if;
 v_src:=v_replaced;
 v_replaced:=replace(v_src,'  return jsonb_build_object(',
   '  v_owner_authorized:=app_private.service_daily_owner_departure_valid_v1(p_service_tech_id);'||E'\n'||'  return jsonb_build_object(');
 if v_replaced=v_src then raise exception 'Readiness return shape changed.';end if;
 v_src:=v_replaced;
 v_replaced:=replace(v_src,
  '''departure_ready'',coalesce(v_inspection_ready,false) and coalesce(v_inventory_ready,false),',
  '''departure_ready'',coalesce(v_inspection_ready,false) and (coalesce(v_inventory_ready,false) or v_owner_authorized),'||E'\n'||
  '    ''owner_departure_authorized'',v_owner_authorized,'||E'\n'||
  '    ''owner_inventory_unverified'',v_owner_authorized and not coalesce(v_inventory_ready,false),');
 if v_replaced=v_src then raise exception 'Readiness departure expression changed.';end if;
 execute v_replaced;
end $patch_readiness$;

-- Team board still shows inventory NOT verified. Owner authorization is not a normal READY.
do $patch_board$
declare v_src text;v_replaced text;
begin
 v_src:=pg_get_functiondef('public.owner_tech_command_board_v2(date)'::regprocedure);
 v_replaced:=replace(v_src,
   '''truck_ready'',coalesce((t->>''truck_ready'')::boolean,false) and sc and vc,',
   '''truck_ready'',(coalesce((t->>''truck_ready'')::boolean,false) and sc and vc)'||
    ' or coalesce((d->>''owner_departure_authorized'')::boolean,false),'||E'\n'||
   '    ''owner_authorized'',coalesce((d->>''owner_departure_authorized'')::boolean,false),');
 if v_replaced=v_src then raise exception 'Owner team board readiness expression changed.';end if;
 execute v_replaced;
end $patch_board$;

commit;
