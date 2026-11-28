-- Read-only Field/Shop for Helios units, straight from the ACTIVE mHelp upload.
-- Why it exists: COS's saved equipment list only has HELIOS 001-010, so the Victron page could not place
-- 011-020 and counted unpowered Shop units as "not reporting". mHelp's list knows all of them.
-- Why it reads the upload and not the census view: the first version (2026-11-27 morning) read
-- cos_mhelp_placement_private.census_mhelp_current_coverage. That view only has rows once the address job has
-- processed the active upload, so it is EMPTY for a while after every new mHelp upload (seen 15:21 CST the same
-- day; still empty 10 minutes later). During that gap the page lost Field/Shop for HELIOS 011-020. The active
-- upload's own records carry unit number, placement and address, with no gap.
-- Additive: one function, nothing else changed. A unit is returned only when the active upload has exactly one
-- record for it and that record says FIELD or SHOP. ZIP is given for Field units only (the page uses it for
-- the area weather when no map point is saved).
create or replace function public.cos_vrm_placement_read()
returns jsonb language sql stable security definer set search_path to '' as $function$
  with active as (
    select b.records
    from cos_mhelp_placement_private.upload_control c
    join cos_mhelp_placement_private.upload_batches b on b.source_sha256 = c.active_sha256
    where c.singleton
    order by b.admitted_at desc
    limit 1),
  rec as (
    select upper(replace(r->>'unitNumber', ' ', '')) as key, r->>'placement' as placement,
           substring(r->'sourceAddress'->>'zip' from '^[0-9]{5}') as zip
    from active a, jsonb_array_elements(case when jsonb_typeof(a.records) = 'array' then a.records else '[]'::jsonb end) r
    where r->>'unitNumber' ~* '^helios[[:space:]]*[0-9]{1,3}$')
  select jsonb_build_object('units', coalesce((
    select jsonb_agg(jsonb_build_object('installationId', u.installation_id, 'name', u.name, 'placement', u.placement, 'zip', u.zip)
                     order by u.name, u.installation_id) from (
      select i.installation_id, i.name, min(rec.placement) as placement,
        case when min(rec.placement) = 'FIELD' then min(rec.zip) end as zip
      from cos_vrm_private.installations i
      join rec on rec.key = upper(replace(i.name, ' ', ''))
      where i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$'
      group by i.installation_id, i.name
      having count(*) = 1 and min(rec.placement) in ('FIELD', 'SHOP')
    ) u), '[]'::jsonb));
$function$;
revoke all on function public.cos_vrm_placement_read() from public, anon, authenticated;
grant execute on function public.cos_vrm_placement_read() to service_role;
