-- OnSite Vision Phase 2: authoritative read-only job context
-- Production database gates/RLS remain authoritative.
-- SECURITY INVOKER intentionally preserves the caller's RLS visibility.

create or replace function public.get_tech_check_job_context_v1(p_ticket_no text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with input as (
  select nullif(btrim(p_ticket_no), '') as ticket_no
),
assignments as (
  select j.*
  from public.job_assignments j, input i
  where i.ticket_no is not null and j.ticket_no = i.ticket_no
),
prep_rows as (
  select p.*
  from public.prep_tickets p, input i
  where i.ticket_no is not null and p.ticket_no = i.ticket_no
),
preferred_prep_id as (
  select coalesce(
    (
      select a.prep_ticket_id
      from assignments a
      where a.prep_ticket_id is not null
      order by
        case when a.status in ('assigned','started') then 0 else 1 end,
        a.updated_at desc nulls last,
        a.assigned_at desc nulls last
      limit 1
    ),
    (
      select p.id
      from prep_rows p
      order by p.created_at desc
      limit 1
    )
  ) as id
),
primary_prep as (
  select p.*
  from prep_rows p
  where p.id = (select id from preferred_prep_id)
  limit 1
),
items as (
  select pi.*
  from public.prep_items pi
  where pi.prep_ticket_id in (select id from prep_rows)
),
effective_work as (
  select case
    when exists (select 1 from items where purpose = 'SWAP'::public.prep_purpose) then 'swap'
    when exists (select 1 from items where purpose = 'DELIVERY'::public.prep_purpose) then 'delivery'
    else coalesce(
      (select nullif(lower(p.work_type),'') from primary_prep p),
      (select nullif(lower(a.work_type),'') from assignments a order by a.updated_at desc nulls last limit 1),
      'service'
    )
  end as work_type
),
solar_checks as (
  select s.*
  from public.service_solar_checks s
  where s.prep_ticket_id in (select id from prep_rows)
     or s.assignment_id in (select id from assignments)
),
handoff_evidence_rows as (
  select e.*
  from public.handoff_evidence e
  where e.prep_ticket_id in (select id from prep_rows)
),
solar_evidence_rows as (
  select e.*
  from public.service_solar_evidence e
  where e.prep_ticket_id in (select id from prep_rows)
),
return_rows as (
  select r.*
  from public.unit_returns r, input i
  where i.ticket_no is not null and r.ticket_no = i.ticket_no
),
registry_rows as (
  select u.*
  from public.unit_registry u, input i
  where i.ticket_no is not null and u.ticket_no = i.ticket_no
),
unit_tags as (
  select distinct nullif(btrim(unit_tag),'') as unit_tag from items
  union
  select distinct nullif(btrim(unit_tag),'') from return_rows
  union
  select distinct nullif(btrim(unit_tag),'') from registry_rows
),
asset_rows as (
  select ai.*
  from public.asset_inventory ai
  where ai.unit_tag in (select unit_tag from unit_tags where unit_tag is not null)
),
asset_history_rows as (
  select h.*
  from public.asset_inventory_history h
  where h.unit_tag in (select unit_tag from unit_tags where unit_tag is not null)
),
spare_rows as (
  select s.*
  from public.truck_spare_batteries s, input i
  where (i.ticket_no is not null and s.ticket_no = i.ticket_no)
     or s.prep_ticket_id in (select id from prep_rows)
),
checkpoint_rows as (
  select w.*
  from public.workflow_checkpoints w, input i
  where i.ticket_no is not null and w.ticket_no = i.ticket_no
),
summary as (
  select
    coalesce(
      (select p.site from primary_prep p),
      (select a.site from assignments a order by a.updated_at desc nulls last limit 1),
      (select r.return_notes from return_rows r order by r.updated_at desc nulls last limit 1)
    ) as site,
    (select work_type from effective_work) as effective_work_type,
    coalesce(
      (select a.scheduled_for from assignments a where a.status in ('assigned','started') order by a.updated_at desc nulls last limit 1),
      (select a.scheduled_for from assignments a order by a.updated_at desc nulls last limit 1)
    ) as scheduled_for,
    coalesce(
      (select a.scheduled_time from assignments a where a.status in ('assigned','started') order by a.updated_at desc nulls last limit 1),
      (select a.scheduled_time from assignments a order by a.updated_at desc nulls last limit 1)
    ) as scheduled_time,
    (select p.status::text from primary_prep p) as prep_status,
    (select p.id from primary_prep p) as prep_ticket_id
)
select jsonb_build_object(
  'context_version', 'job-context-v1',
  'fetched_at', now(),
  'ticket_no', i.ticket_no,
  'found', (
    exists(select 1 from assignments)
    or exists(select 1 from prep_rows)
    or exists(select 1 from return_rows)
    or exists(select 1 from registry_rows)
  ),
  'summary', jsonb_build_object(
    'site', s.site,
    'effective_work_type', s.effective_work_type,
    'scheduled_for', s.scheduled_for,
    'scheduled_time', s.scheduled_time,
    'prep_status', s.prep_status,
    'prep_ticket_id', s.prep_ticket_id
  ),
  'assignments', coalesce((select jsonb_agg(to_jsonb(a) order by a.assigned_at, a.id) from assignments a), '[]'::jsonb),
  'prep', (select to_jsonb(p) from primary_prep p),
  'prep_tickets', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from prep_rows p), '[]'::jsonb),
  'items', coalesce((select jsonb_agg(to_jsonb(pi) order by pi.item_order, pi.id) from items pi), '[]'::jsonb),
  'service_solar_check', (
    select to_jsonb(sc)
    from solar_checks sc
    order by sc.updated_at desc nulls last, sc.id desc
    limit 1
  ),
  'service_solar_checks', coalesce((select jsonb_agg(to_jsonb(sc) order by sc.updated_at, sc.id) from solar_checks sc), '[]'::jsonb),
  'handoff_evidence', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from handoff_evidence_rows e), '[]'::jsonb),
  'service_solar_evidence', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from solar_evidence_rows e), '[]'::jsonb),
  'returns', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at, r.id) from return_rows r), '[]'::jsonb),
  'unit_registry', coalesce((select jsonb_agg(to_jsonb(u) order by u.updated_at, u.unit_key) from registry_rows u), '[]'::jsonb),
  'asset_inventory', coalesce((select jsonb_agg(to_jsonb(ai) order by ai.updated_at, ai.unit_key) from asset_rows ai), '[]'::jsonb),
  'asset_inventory_history', coalesce((select jsonb_agg(to_jsonb(ah) order by ah.created_at, ah.id) from asset_history_rows ah), '[]'::jsonb),
  'truck_spare_batteries', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.created_at, sp.id) from spare_rows sp), '[]'::jsonb),
  'workflow_checkpoints', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at, w.id) from checkpoint_rows w), '[]'::jsonb)
)
from input i
cross join summary s;
$$;

comment on function public.get_tech_check_job_context_v1(text) is
  'Read-only OnSite Vision job context. SECURITY INVOKER preserves RLS. Returns assignments, prep, items, evidence, returns, lifecycle, spares and audit context for one MHelpDesk ticket.';

revoke all on function public.get_tech_check_job_context_v1(text) from public;
revoke all on function public.get_tech_check_job_context_v1(text) from anon;
grant execute on function public.get_tech_check_job_context_v1(text) to authenticated;
