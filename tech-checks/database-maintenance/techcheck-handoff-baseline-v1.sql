-- Tech Check: everything on the Service trucks on 2026-11-25 counts as handed over.
--
-- The owner's direction (2026-11-25, 00:56 CT): "count everything up to this
-- point. Tomorrow and from now on let it be this way. I don't want them to
-- have to go back and check them in."
--
-- Each unit assigned to a Service truck right now is recorded once as the
-- starting point. It counts like an accepted handoff to that tech: it is not
-- listed as a gap, and the tech can save it again or take it off and put it
-- back on. Like a handoff, it stops counting once the unit goes onto a
-- different truck. Every NEW unit from now on still needs a signed IT handoff
-- (techcheck-handoff-required-v1.sql).
--
-- Rollback: drop the baseline table and restore covering_v1 from
-- techcheck-handoff-required-v1.sql.

begin;

create table if not exists app_private.techcheck_handoff_baseline(
  id uuid primary key default gen_random_uuid(),
  service_tech_id uuid not null,
  service_tech_name text,
  equipment_type text not null,
  unit_tag text not null,
  accepted_at timestamptz not null default now(),
  accepted_by text not null,
  reason text not null,
  unique(service_tech_id, equipment_type, unit_tag)
);
revoke all on app_private.techcheck_handoff_baseline from public, anon, authenticated;

insert into app_private.techcheck_handoff_baseline(service_tech_id, service_tech_name, equipment_type, unit_tag, accepted_by, reason)
select u.service_tech_id, coalesce(p.full_name, p.username), u.equipment_type, btrim(u.unit_tag), 'James Martin (owner)',
       'On the truck when handoffs became required; owner counted it as handed over on 2026-11-25'
from public.service_truck_units u
left join public.profiles p on p.user_id = u.service_tech_id
where u.status is distinct from 'unassigned' and nullif(btrim(coalesce(u.unit_tag,'')),'') is not null
on conflict do nothing;

create or replace function app_private.techcheck_handoff_covering_v1(p_service_tech_id uuid, p_equipment_type text, p_unit_tag text)
returns uuid language sql stable security definer set search_path='' as $$
  with keys as (select e.equipment_key from public.equipment_master e where e.canonical_family = p_equipment_type and lower(btrim(e.unit_tag)) = lower(btrim(p_unit_tag))),
  handoff as (select t.id, t.service_actor, t.updated_at as at from app_private.techcheck_transfers t where t.state = 'accepted'
      and exists(select 1 from keys k, jsonb_array_elements(t.manifest) m where m->>'equipment_key' = k.equipment_key)),
  baseline as (select b.id, b.service_tech_id as service_actor, b.accepted_at as at from app_private.techcheck_handoff_baseline b
      where b.equipment_type = p_equipment_type and lower(b.unit_tag) = lower(btrim(p_unit_tag))),
  latest as (select * from (select * from handoff union all select * from baseline) x order by at desc limit 1)
  select l.id from latest l where l.service_actor = p_service_tech_id
    and not exists(select 1 from public.service_truck_inventory_audit a where a.item_kind = 'unit' and a.item_slot = p_equipment_type
        and lower(btrim(a.after_value)) = lower(btrim(p_unit_tag)) and a.service_tech_id is distinct from p_service_tech_id and a.created_at > l.at)
$$;
revoke all on function app_private.techcheck_handoff_covering_v1(uuid,text,text) from public, anon, authenticated;

commit;
