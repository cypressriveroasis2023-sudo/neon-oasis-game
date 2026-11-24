-- Reviewed proposal. Do not run until the owner approves.
-- Read-only report, then an exact name or exact id refile, then a rollback.
-- No serials, addresses, or guessed names are copied. Ambiguous cameras are listed and left alone.

-- BEFORE SNAPSHOT
create temp table camera_refile_before as
select d.id, d.unit_key, d.device_name, d.organization
from public.camera_devices d
where upper(btrim(coalesce(d.organization, ''))) in ('', 'ROOT', 'SHOP', 'SHOP/ROOT', 'ROOT/SHOP', 'SHOP / ROOT', 'ROOT / SHOP', 'UNASSIGNED', 'UNKNOWN')
   or upper(btrim(coalesce(d.unit_key, ''))) in ('', 'SHOP', 'UNASSIGNED', 'UNKNOWN');

-- AMBIGUOUS, for a person. This select does not write.
with field_units as (
  select id::text as unit_id, unit_number, camera_device_id, field_organization
  from public.equipment_units
  where upper(current_location_type) = 'FIELD'
), named as (
  select b.id as camera_id, u.unit_id
  from camera_refile_before b
  join public.camera_devices d on d.id = b.id
  join field_units u on upper(btrim(u.unit_number)) = upper(btrim(d.unit_key))
                      or upper(btrim(u.unit_number)) = upper(btrim(d.device_name))
), identified as (
  select b.id as camera_id, u.unit_id
  from camera_refile_before b
  join public.camera_devices d on d.id = b.id
  join field_units u on u.camera_device_id = d.id::text and u.camera_device_id <> ''
), counts as (
  select camera_id, count(distinct unit_id) as matches
  from (
    select camera_id, unit_id from named
    union all
    select camera_id, unit_id from identified
  ) hits
  group by camera_id
)
select camera_id, matches
from counts
where matches <> 1;

-- APPLY. One exact Field unit only.
with field_units as (
  select id::text as unit_id, unit_number, camera_device_id, field_organization
  from public.equipment_units
  where upper(current_location_type) = 'FIELD'
    and upper(btrim(coalesce(field_organization, ''))) not in ('', 'ROOT', 'SHOP', 'SHOP/ROOT', 'UNASSIGNED', 'UNKNOWN')
), hits as (
  select d.id as camera_id, u.unit_id, u.unit_number, u.field_organization
  from camera_refile_before b
  join public.camera_devices d on d.id = b.id
  join field_units u on u.camera_device_id = d.id::text and u.camera_device_id <> ''
  union
  select d.id, u.unit_id, u.unit_number, u.field_organization
  from camera_refile_before b
  join public.camera_devices d on d.id = b.id
  join field_units u on upper(btrim(u.unit_number)) = upper(btrim(d.unit_key))
                      or upper(btrim(u.unit_number)) = upper(btrim(d.device_name))
), single as (
  select camera_id
  from hits
  group by camera_id
  having count(distinct unit_id) = 1
)
update public.camera_devices d
set unit_key = h.unit_number,
    organization = h.field_organization
from hits h
join single s on s.camera_id = h.camera_id
where d.id = h.camera_id;

-- ROLLBACK
update public.camera_devices d
set unit_key = b.unit_key,
    organization = b.organization
from camera_refile_before b
where d.id = b.id;
