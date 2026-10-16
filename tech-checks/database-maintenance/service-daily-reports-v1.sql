-- Additive daily archive. Existing inspection and inventory writers remain intact.
begin;
create schema if not exists app_private;
grant usage on schema app_private to authenticated, service_role;
create table app_private.service_daily_reports (
  id uuid primary key,
  service_tech_id uuid not null references public.profiles(user_id),
  check_date date not null,
  submitted_at timestamptz not null default now(),
  actor_name text not null,
  request jsonb not null,
  snapshot jsonb not null,
  photos jsonb not null,
  delivery_status text not null default 'queued' check(delivery_status in ('queued','blocked','processing','retry','review','sent')),
  drive_manifest jsonb not null default '{}'::jsonb,
  email_state text not null default 'pending' check(email_state in ('pending','sending','sent','review')),
  email_id text,
  lease_token uuid,
  locked_until timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz
);
create index service_daily_reports_actor_day on app_private.service_daily_reports(service_tech_id,check_date,submitted_at desc);
create index service_daily_reports_pending on app_private.service_daily_reports(next_attempt_at) where delivery_status in ('queued','retry','blocked','processing');
alter table app_private.service_daily_reports enable row level security;
revoke all on app_private.service_daily_reports from public,anon,authenticated,service_role;

create function app_private.service_daily_actor() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where user_id=auth.uid() and role::text='service' and active and archived_at is null)
$$;
revoke all on function app_private.service_daily_actor() from public,anon;
grant execute on function app_private.service_daily_actor() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('service-daily-evidence','service-daily-evidence',false,5242880,array['image/jpeg']);
create function app_private.service_daily_can_upload(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select app_private.service_daily_actor()
  and p_name ~ ('^'||auth.uid()::text||'/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$')
  and split_part(p_name,'/',2) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  and not exists(select 1 from app_private.service_daily_reports where id::text=split_part(p_name,'/',2))
$$;
revoke all on function app_private.service_daily_can_upload(text) from public,anon;
grant execute on function app_private.service_daily_can_upload(text) to authenticated;
create policy service_daily_evidence_insert on storage.objects for insert to authenticated
 with check(bucket_id='service-daily-evidence' and app_private.service_daily_can_upload(name));
create policy service_daily_evidence_read on storage.objects for select to authenticated
 using(bucket_id='service-daily-evidence' and app_private.service_daily_actor() and split_part(name,'/',1)=auth.uid()::text);

create function app_private.complete_service_daily_report_v1(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid(); v_day date:=timezone('America/Chicago',now())::date;
 v_request jsonb:=jsonb_build_object('units',p_units,'sims',p_sims,'stock',p_stock,'photos',p_photos);
 v_existing app_private.service_daily_reports%rowtype; v_mc public.morning_checks%rowtype;
 v_type text;v_view text;v_photo jsonb;v_name text;v_ready jsonb;v_units jsonb;v_sims jsonb;v_qty integer;
begin
 if not app_private.service_daily_actor() then raise exception 'Active Service Tech required.' using errcode='42501';end if;
 if p_report_id is null then raise exception 'Report ID required.';end if;
 -- Serialize retries and each technician's stock update. A response lost in transit
 -- can be replayed without re-writing stock, creating a second report or re-sending.
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text,0));
 select * into v_existing from app_private.service_daily_reports where id=p_report_id;
 if found then
  if v_existing.service_tech_id<>v_actor or v_existing.request is distinct from v_request then raise exception 'Report ID already used. Reopen inventory for a new check.';end if;
  return jsonb_build_object('id',v_existing.id,'inventory_ready',true,'delivery_status',v_existing.delivery_status);
 end if;
 if jsonb_typeof(p_units) is distinct from 'object' or jsonb_typeof(p_sims) is distinct from 'object' or jsonb_typeof(p_stock) is distinct from 'object' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Invalid inventory or photos.';end if;
 if jsonb_array_length(p_photos) not between 10 and 12 then raise exception 'Photograph the front and rear tag of all four units, the batteries and the SIM cards.';end if;
 foreach v_type in array array['Sniper','Ranger','Spotter','Solar Spotter'] loop
  if jsonb_typeof(p_units->v_type) is distinct from 'string' or length(btrim(p_units->>v_type)) not between 1 and 100 then raise exception 'Enter every exact unit number.';end if;
  foreach v_view in array array['front','tag'] loop
   if (select count(*) from jsonb_array_elements(p_photos) p where p->>'category'=v_type and p->>'view'=v_view)<>1 then raise exception 'Each unit requires a front and rear tag photo.';end if;
  end loop;
 end loop;
 if (select count(distinct lower(btrim(value))) from jsonb_each_text(p_units))<>4 or (select count(*) from jsonb_each(p_units))<>4 then raise exception 'Use four different unit numbers.';end if;
 for v_qty in 1..3 loop
  if jsonb_typeof(p_sims->v_qty::text) is distinct from 'string' or length(btrim(p_sims->>v_qty::text)) not between 1 and 100 then raise exception 'Enter all three exact SIM numbers.';end if;
 end loop;
 if (select count(*) from jsonb_each(p_sims))<>3 or (select count(distinct lower(btrim(value))) from jsonb_each_text(p_sims))<>3 then raise exception 'Use three different SIM numbers.';end if;
 foreach v_type in array array['recon_battery_qty','agm_12v_110ah_qty','litime_12v_100ah_qty','battery_12v_35ah_qty'] loop
  if jsonb_typeof(p_stock->v_type) is distinct from 'number' or (p_stock->>v_type)!~'^[0-9]{1,6}$' then raise exception 'Enter valid whole battery counts.';end if;
 end loop;
 foreach v_type in array array['Batteries','SIM cards'] loop
  if (select count(*) from jsonb_array_elements(p_photos) p where p->>'category'=v_type and p->>'view'='1')<>1 then raise exception 'Battery and SIM photos required.';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_photos) p group by p->>'category',p->>'view' having count(*)>1) then raise exception 'Duplicate photo slot.';end if;
 for v_photo in select value from jsonb_array_elements(p_photos) loop
  if not coalesce(((v_photo->>'category') in ('Sniper','Ranger','Spotter','Solar Spotter') and (v_photo->>'view') in ('front','tag')) or ((v_photo->>'category') in ('Batteries','SIM cards') and (v_photo->>'view') in ('1','2')),false)
   or (v_photo->>'path') is null or (v_photo->>'path') !~ ('^'||v_actor::text||'/'||p_report_id::text||'/[a-f0-9]{64}\.jpg$') then raise exception 'Invalid photo identity.';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='service-daily-evidence' and o.name=v_photo->>'path' and o.metadata->>'mimetype'='image/jpeg' and (o.metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload every photo before completing.';end if;
 end loop;
 select * into v_mc from public.morning_checks where service_tech_id=v_actor and timezone('America/Chicago',submitted_at)::date=v_day order by submitted_at desc limit 1;
 if not found or v_mc.is_test is true or v_mc.taking_trailer is null then raise exception 'Complete today’s Truck / Trailer Inspection first.';end if;
 if (select count(*) from jsonb_each(v_mc.truck_checks))<>8 or exists(select 1 from jsonb_each(v_mc.truck_checks) where value<>'true'::jsonb)
  or (v_mc.taking_trailer and ((select count(*) from jsonb_each(v_mc.trailer_checks))<>7 or exists(select 1 from jsonb_each(v_mc.trailer_checks) where value<>'true'::jsonb))) then raise exception 'Pass every required safety inspection question first.';end if;
 perform public.service_save_my_truck_inventory_v3(p_units,p_sims,(p_stock->>'recon_battery_qty')::integer,(p_stock->>'agm_12v_110ah_qty')::integer,(p_stock->>'litime_12v_100ah_qty')::integer,(p_stock->>'battery_12v_35ah_qty')::integer);
 select jsonb_object_agg(key,jsonb_build_object('unit_tag',value,'confirmed',true)) into v_units from jsonb_each_text(p_units);
 select jsonb_object_agg(key,jsonb_build_object('sim_number',value,'confirmed',true)) into v_sims from jsonb_each_text(p_sims);
 v_ready:=public.submit_my_service_truck_inventory_check_v3(v_units,v_sims,(p_stock->>'recon_battery_qty')::integer,(p_stock->>'agm_12v_110ah_qty')::integer,(p_stock->>'litime_12v_100ah_qty')::integer,(p_stock->>'battery_12v_35ah_qty')::integer);
 if (v_ready->>'departure_ready')::boolean is distinct from true then raise exception 'Truck is not ready. Correct all inventory shortages before completing.';end if;
 select coalesce(full_name,username,'Service Tech') into v_name from public.profiles where user_id=v_actor;
 insert into app_private.service_daily_reports(id,service_tech_id,check_date,actor_name,request,snapshot,photos)
 values(p_report_id,v_actor,v_day,v_name,v_request,jsonb_build_object('inspection_id',v_mc.id,'inspection_submitted_at',v_mc.submitted_at,'truck_checks',v_mc.truck_checks,'taking_trailer',v_mc.taking_trailer,'trailer_checks',v_mc.trailer_checks,'inventory',v_ready),p_photos);
 return jsonb_build_object('id',p_report_id,'inventory_ready',true,'delivery_status','queued');
end $$;
revoke all on function app_private.complete_service_daily_report_v1(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function app_private.complete_service_daily_report_v1(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
create function public.complete_service_daily_report_v1(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select app_private.complete_service_daily_report_v1(p_report_id,p_units,p_sims,p_stock,p_photos)
$$;
revoke all on function public.complete_service_daily_report_v1(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.complete_service_daily_report_v1(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
create function app_private.service_daily_report_status_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.service_daily_actor() then raise exception 'Active Service Tech required.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'check_date',check_date,'submitted_at',submitted_at,'delivery_status',delivery_status) order by submitted_at desc),'[]'::jsonb) from app_private.service_daily_reports where service_tech_id=auth.uid() and check_date=timezone('America/Chicago',now())::date);
end $$;
revoke all on function app_private.service_daily_report_status_v1() from public,anon;
grant execute on function app_private.service_daily_report_status_v1() to authenticated;
create function public.service_daily_report_status_v1() returns jsonb language sql security invoker set search_path='' as $$select app_private.service_daily_report_status_v1()$$;
revoke all on function public.service_daily_report_status_v1() from public,anon;
grant execute on function public.service_daily_report_status_v1() to authenticated;
commit;
