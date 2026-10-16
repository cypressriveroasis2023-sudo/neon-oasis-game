-- Require separate front/back evidence for SIM slots 1, 2 and 3.
-- Existing v1 submissions remain retryable; all new submissions use the stricter photo contract.
begin;
create function app_private.complete_service_daily_report_v2(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb)
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
 if jsonb_array_length(p_photos) not between 15 and 16 then raise exception 'Photograph the front and rear tag of all four units, the batteries, and both sides of each of the three SIM cards.';end if;
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
 if (select count(*) from jsonb_array_elements(p_photos) p where p->>'category'='Batteries' and p->>'view'='1')<>1 then raise exception 'Battery photo required.';end if;
 foreach v_type in array array['SIM Card 1','SIM Card 2','SIM Card 3'] loop
  foreach v_view in array array['front','back'] loop
   if (select count(*) from jsonb_array_elements(p_photos) p where p->>'category'=v_type and p->>'view'=v_view)<>1 then raise exception 'SIM Card 1, 2 and 3 each require a front and back photo.';end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_photos) p group by p->>'category',p->>'view' having count(*)>1) then raise exception 'Duplicate photo slot.';end if;
 for v_photo in select value from jsonb_array_elements(p_photos) loop
  if not coalesce(((v_photo->>'category') in ('Sniper','Ranger','Spotter','Solar Spotter') and (v_photo->>'view') in ('front','tag')) or ((v_photo->>'category')='Batteries' and (v_photo->>'view') in ('1','2')) or ((v_photo->>'category') in ('SIM Card 1','SIM Card 2','SIM Card 3') and (v_photo->>'view') in ('front','back')),false)
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
revoke all on function app_private.complete_service_daily_report_v2(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function app_private.complete_service_daily_report_v2(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
create function public.complete_service_daily_report_v2(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select app_private.complete_service_daily_report_v2(p_report_id,p_units,p_sims,p_stock,p_photos)
$$;
revoke all on function public.complete_service_daily_report_v2(uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.complete_service_daily_report_v2(uuid,jsonb,jsonb,jsonb,jsonb) to authenticated;
-- Preserve the old public URL for lost-response retries, while preventing new
-- submissions with the former grouped SIM-photo contract.
create or replace function public.complete_service_daily_report_v1(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select app_private.complete_service_daily_report_v2(p_report_id,p_units,p_sims,p_stock,p_photos)
$$;
revoke all on function app_private.complete_service_daily_report_v1(uuid,jsonb,jsonb,jsonb,jsonb) from authenticated;
commit;
