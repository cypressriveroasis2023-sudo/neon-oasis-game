alter table public.job_assignments
  add column if not exists scheduled_time time without time zone;

comment on column public.job_assignments.scheduled_time is
  'Optional local scheduled work time for the Tech Check assignment. Date remains in scheduled_for.';

grant select, update (scheduled_time) on public.job_assignments to authenticated;
