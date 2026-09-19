-- Applied to Supabase project goqrnolcvqnirjmzaeyk during release QA.
-- Hardens the existing IT solar release trigger so Helios cannot reach the
-- Service handoff unless its non-port Helios requirements are also complete.
-- No schema/data rewrite; existing fields and trigger are reused.

create or replace function public.enforce_it_solar_delivery_before_release()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status::text <> 'released' or old.status::text = 'released' then
    return new;
  end if;

  if exists(
    select 1
    from public.prep_items i
    where i.prep_ticket_id = new.id
      and i.equipment_type = 'Ranger'
      and i.purpose = 'DELIVERY'::public.prep_purpose
      and not (
        coalesce(i.solar_mppt_updated_ok,false)
        and coalesce(i.solar_mppt_tested_ok,false)
        and coalesce(i.solar_pv_charging_ok,false)
      )
  ) then
    raise exception 'Every Ranger delivery must have the MPPT updated/tested and battery charging verified before the Service handoff.';
  end if;

  if exists(
    select 1
    from public.prep_items i
    where i.prep_ticket_id = new.id
      and i.equipment_type = 'Helios'
      and i.purpose = 'DELIVERY'::public.prep_purpose
      and not (
        coalesce(i.solar_mppt_updated_ok,false)
        and coalesce(i.solar_mppt_tested_ok,false)
        and coalesce(i.solar_pv_charging_ok,false)
        and coalesce(i.solar_panels_match_ok,false)
      )
  ) then
    raise exception 'Every Helios delivery must have Cerbo/VRM verified, MPPT updated, solar charging verified, and all 3 required 1TB SD cards confirmed before the Service handoff.';
  end if;

  return new;
end;
$function$;
