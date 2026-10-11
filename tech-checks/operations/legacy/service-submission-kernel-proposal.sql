-- INACTIVE LOCAL foundation for recorded team submission. No public grant or writer.
begin;
create table cos_service_field.job_submissions (
 id uuid primary key default gen_random_uuid(),work_order_id uuid not null references cos_mhelp_intake.work_orders(id),
 installation_scope_revision bigint not null check(installation_scope_revision>0),prep_ticket_id uuid,
 membership_id uuid not null references cos_mhelp_intake.participants(id),assignment_id uuid not null references public.job_assignments(id),
 actor_id uuid not null references public.profiles(user_id),departure_start_id uuid not null references cos_service_field.departure_starts(id),
 request_id uuid not null,request_snapshot jsonb not null,completion_kind text not null check(completion_kind in ('installation','return_only','service_notes')),
 current_scope_snapshot jsonb not null,unit_event_ids uuid[] not null default '{}',helios_proof_snapshot jsonb,return_proof_snapshot jsonb,
 submitted_at timestamptz not null default now(),unique(work_order_id,installation_scope_revision),unique(actor_id,request_id)
);
alter table cos_service_field.job_submissions enable row level security;
revoke all on cos_service_field.job_submissions from public,anon,authenticated,service_role;
create trigger immutable_team_submission before update or delete on cos_service_field.job_submissions for each row execute function cos_service_field.immutable_departure_v1();
create function cos_service_field.shared_submission_recorded_v1(p_work uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from cos_service_field.job_submissions s join cos_mhelp_intake.work_orders w on w.id=s.work_order_id
  where w.id=p_work and s.installation_scope_revision=w.installation_scope_revision);
$$;
revoke all on function cos_service_field.shared_submission_recorded_v1(uuid) from public,anon,authenticated,service_role;
commit;
