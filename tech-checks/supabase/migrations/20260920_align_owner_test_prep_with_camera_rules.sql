-- Align Owner test-prep helper with current production camera rules.
CREATE OR REPLACE FUNCTION public.owner_create_test_prep(p_ticket_no text, p_site text, p_requirements jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prep uuid;
  v_req jsonb;
  v_qty int;
  v_order int := 0;
  v_type text;
  v_purpose public.prep_purpose;
  v_required_batt int;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if nullif(trim(p_ticket_no),'') is null then raise exception 'Test ticket number is required'; end if;
  if jsonb_typeof(p_requirements) <> 'array' or jsonb_array_length(p_requirements)=0 then raise exception 'At least one test equipment requirement is required'; end if;
  insert into public.prep_tickets(ticket_no,site,created_by,is_test)
  values(trim(p_ticket_no),nullif(trim(p_site),''),auth.uid(),true) returning id into v_prep;
  for v_req in select * from jsonb_array_elements(p_requirements)
  loop
    v_qty := greatest(1,coalesce((v_req->>'qty')::int,1));
    v_type := v_req->>'equipment_type';
    if v_type not in ('Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2','110V Stand','Solar Stand','Solar Pole','Pole') then raise exception 'Invalid equipment type'; end if;
    if (v_req->>'purpose') not in ('BACKUP','SWAP','DELIVERY') then raise exception 'Invalid purpose'; end if;
    v_purpose := (v_req->>'purpose')::public.prep_purpose;
    if v_type='110V Stand' and v_purpose<>'SWAP'::public.prep_purpose then raise exception '110V Stand is available for SWAP only'; end if;
    if v_type='Solar Stand' and v_purpose not in ('SWAP'::public.prep_purpose,'DELIVERY'::public.prep_purpose) then raise exception 'Solar Stand is available for SWAP or DELIVERY only'; end if;
    v_required_batt := case v_type when 'Sniper' then 2 when 'Ranger' then 1 when 'Solar Spotter' then 0 when 'Helios' then 1 when 'Recon 2' then greatest(1,coalesce((v_req->>'battery_qty')::int,1)) else 0 end;
    for i in 1..v_qty loop
      v_order := v_order+1;
      insert into public.prep_items(prep_ticket_id,item_order,equipment_type,purpose,required_battery_count)
      values(v_prep,v_order,v_type,v_purpose,v_required_batt);
    end loop;
  end loop;
  insert into public.reports(kind,actor_id,actor_name,ticket_no,text,is_test)
  values('TEST IT EQUIPMENT PREP CREATED',auth.uid(),public.actor_display_name(),trim(p_ticket_no),'Owner created a TEST equipment prep for app accuracy testing.',true);
  return v_prep;
end;
$function$
;

revoke execute on function public.owner_create_test_prep(text,text,jsonb) from public;
revoke execute on function public.owner_create_test_prep(text,text,jsonb) from anon;
grant execute on function public.owner_create_test_prep(text,text,jsonb) to authenticated;
