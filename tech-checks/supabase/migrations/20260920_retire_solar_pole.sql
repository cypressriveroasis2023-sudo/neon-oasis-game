-- Retire Solar Pole from Tech Check.
-- There were no active, historical prep-item, or unit-registry Solar Pole records at retirement time.

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and p.proname in (
        'add_it_prep_item','configure_it_prep_item','owner_create_test_prep',
        'release_prep','save_it_prep_item_draft','enforce_support_safe_before_release',
        'service_solar_context','service_solar_context_v2','save_my_service_solar_check_v2'
      )
      and pg_get_functiondef(p.oid) like '%Solar Pole%'
  loop
    v_def:=pg_get_functiondef(r.oid);
    v_def:=replace(v_def,',''Solar Pole''','');
    v_def:=replace(v_def,E'    when ''Solar Pole'' then 0\n','');
    v_def:=replace(v_def,'Solar Stand / Solar Pole','Solar Stand');
    execute v_def;
  end loop;
end $$;

create or replace function public.reject_retired_solar_pole_item_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if lower(trim(coalesce(new.equipment_type,'')))='solar pole' then
    raise exception 'Solar Pole has been retired from Tech Check.';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_retired_solar_pole_item_v1_trigger on public.prep_items;
create trigger reject_retired_solar_pole_item_v1_trigger
before insert or update of equipment_type on public.prep_items
for each row execute function public.reject_retired_solar_pole_item_v1();

create or replace function public.reject_retired_solar_pole_manifest_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists(
    select 1
    from jsonb_array_elements(coalesce(to_jsonb(new)->'equipment_manifest','[]'::jsonb)) m
    where lower(trim(coalesce(m->>'label','')))='solar pole'
  ) then
    raise exception 'Solar Pole has been retired from Tech Check.';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_retired_solar_pole_job_manifest_v1_trigger on public.job_assignments;
create trigger reject_retired_solar_pole_job_manifest_v1_trigger
before insert or update of equipment_manifest on public.job_assignments
for each row execute function public.reject_retired_solar_pole_manifest_v1();

drop trigger if exists reject_retired_solar_pole_prep_manifest_v1_trigger on public.prep_tickets;
create trigger reject_retired_solar_pole_prep_manifest_v1_trigger
before insert or update of equipment_manifest on public.prep_tickets
for each row execute function public.reject_retired_solar_pole_manifest_v1();

revoke execute on function public.reject_retired_solar_pole_item_v1() from public, anon, authenticated;
revoke execute on function public.reject_retired_solar_pole_manifest_v1() from public, anon, authenticated;
