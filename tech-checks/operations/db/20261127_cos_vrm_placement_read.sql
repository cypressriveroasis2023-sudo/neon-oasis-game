-- Read-only Field/Shop for Helios units, straight from mHelp's current list.
-- Why: COS's saved equipment list only has HELIOS 001-010, so the Victron page could not place 011-020
-- and counted unpowered Shop units as "not reporting". mHelp's list knows all of them.
-- Additive: one function, nothing else changed. A unit is returned only when mHelp has exactly one
-- current record for it and that record says FIELD or SHOP. ZIP is given for Field units only (the page
-- uses it for the area weather when no map point is saved).
create or replace function public.cos_vrm_placement_read()
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object('units', coalesce((
    select jsonb_agg(jsonb_build_object('installationId', u.installation_id, 'name', u.name, 'placement', u.placement, 'zip', u.zip)
                     order by u.name, u.installation_id) from (
      select i.installation_id, i.name, min(c.placement) as placement,
        case when min(c.placement) = 'FIELD' then substring(min(c.zip) from '^[0-9]{5}') end as zip
      from cos_vrm_private.installations i
      join cos_mhelp_placement_private.census_mhelp_current_coverage c
        on upper(replace(c.unit_number, ' ', '')) = upper(replace(i.name, ' ', ''))
      where i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$'
      group by i.installation_id, i.name
      having count(*) = 1 and min(c.placement) in ('FIELD', 'SHOP')
    ) u), '[]'::jsonb));
$function$;
revoke all on function public.cos_vrm_placement_read() from public, anon, authenticated;
grant execute on function public.cos_vrm_placement_read() to service_role;
