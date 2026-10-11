-- RECOVERED INACTIVE LOCAL PROPOSAL. Never assembled/applied by this file.
-- No old intake DDL dependency, public capability, seed configuration or grants.
begin;
do $$begin if not exists(select 1 from pg_namespace where nspname='cos_mhelp_intake') then create schema cos_mhelp_intake;revoke all on schema cos_mhelp_intake from public,anon,authenticated,service_role;end if;end$$;
create table cos_mhelp_intake.work_orders (
 id uuid primary key default gen_random_uuid(),portal_id text not null,ticket_id text not null,ticket_number text not null unique,
 prep_ticket_id uuid unique,revision bigint not null default 1 check(revision>=1),membership_revision bigint not null default 1 check(membership_revision>=1),
 source_revision text,source_scope_revision bigint not null default 1 check(source_scope_revision>=1),source_scope_snapshot jsonb,installation_scope_revision bigint not null default 1 check(installation_scope_revision>=1),installation_scope_snapshot jsonb,
 created_at timestamptz not null default now(),unique(portal_id,ticket_id)
);
create table cos_mhelp_intake.work_order_assignments (
 assignment_id uuid primary key references public.job_assignments(id),work_order_id uuid not null references cos_mhelp_intake.work_orders(id),
 department text not null check(department in ('it','service')),origin text not null default 'scheduled_source' check(origin in ('scheduled_source','counterpart_queue')),source_identity text,source_owned boolean not null default true,
 baseline jsonb not null,registered_at timestamptz not null default now(),unique(work_order_id,assignment_id)
);
create index mhelp_work_order_assignment_lookup on cos_mhelp_intake.work_order_assignments(work_order_id);
create table cos_mhelp_intake.participants (
 id uuid primary key default gen_random_uuid(),work_order_id uuid not null,assignment_id uuid not null,legacy_user_id uuid not null references public.profiles(user_id),
 department text not null check(department in ('it','service')),source_identity text,origin text not null default 'scheduled_source' check(origin in ('scheduled_source','local_department_claim')),source_revision text not null,
 check((origin='scheduled_source' and source_identity is not null) or (origin='local_department_claim' and source_identity is null)),
 state text not null default 'active' check(state in ('active','withdrawn')),joined_at timestamptz not null default now(),withdrawn_at timestamptz,
 foreign key(work_order_id,assignment_id) references cos_mhelp_intake.work_order_assignments(work_order_id,assignment_id),
 check((state='active' and withdrawn_at is null) or (state='withdrawn' and withdrawn_at is not null))
);
create unique index mhelp_active_assignment on cos_mhelp_intake.participants(assignment_id) where state='active';
create unique index mhelp_active_person on cos_mhelp_intake.participants(work_order_id,legacy_user_id,department) where state='active';
create unique index mhelp_active_source_person on cos_mhelp_intake.participants(work_order_id,source_identity) where state='active';
create index mhelp_participant_history on cos_mhelp_intake.participants(work_order_id,joined_at,id);
create table cos_mhelp_intake.membership_events(id bigint generated always as identity primary key,work_order_id uuid not null references cos_mhelp_intake.work_orders(id),revision bigint not null,source_revision text not null,observed_at timestamptz not null default now(),members jsonb not null check(octet_length(members::text)<=20000));
alter table cos_mhelp_intake.work_orders enable row level security;
alter table cos_mhelp_intake.work_order_assignments enable row level security;
alter table cos_mhelp_intake.participants enable row level security;
alter table cos_mhelp_intake.membership_events enable row level security;
revoke all on cos_mhelp_intake.work_orders,cos_mhelp_intake.work_order_assignments,cos_mhelp_intake.participants,cos_mhelp_intake.membership_events from public,anon,authenticated,service_role;
revoke all on sequence cos_mhelp_intake.membership_events_id_seq from public,anon,authenticated,service_role;
create function cos_mhelp_intake.membership_immutable_v1() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'mhelp_membership_history_immutable';end if;
 if (to_jsonb(new)-array['state','withdrawn_at']) is distinct from (to_jsonb(old)-array['state','withdrawn_at']) or old.state='withdrawn' then raise exception 'mhelp_membership_history_immutable';end if;return new;
end$$;
create trigger mhelp_membership_history before update or delete on cos_mhelp_intake.participants for each row execute function cos_mhelp_intake.membership_immutable_v1();
create function cos_mhelp_intake.assignment_registry_immutable_v1() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or (to_jsonb(new)-'baseline') is distinct from (to_jsonb(old)-'baseline') then raise exception 'mhelp_assignment_registry_immutable';end if;return new;
end$$;
create trigger mhelp_assignment_registry before update or delete on cos_mhelp_intake.work_order_assignments for each row execute function cos_mhelp_intake.assignment_registry_immutable_v1();
create function cos_mhelp_intake.work_identity_immutable_v1() returns trigger language plpgsql set search_path='' as $$begin
 if row(new.id,new.portal_id,new.ticket_id,new.ticket_number,new.created_at) is distinct from row(old.id,old.portal_id,old.ticket_id,old.ticket_number,old.created_at)
 or (old.prep_ticket_id is not null and new.prep_ticket_id is distinct from old.prep_ticket_id) then raise exception 'mhelp_work_identity_immutable';end if;return new;
end$$;
create trigger mhelp_work_identity before update on cos_mhelp_intake.work_orders for each row execute function cos_mhelp_intake.work_identity_immutable_v1();
create function cos_mhelp_intake.fence_assignments_v1() returns void language plpgsql security invoker set search_path='' as $$begin
 lock table public.job_assignments,public.prep_tickets,public.unit_returns in share row exclusive mode nowait;
end$$;
create function cos_mhelp_intake.has_source_binding_v1(p_assignment uuid,p_prep uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.job_assignments where id=p_assignment and created_from='mhelpdesk_service_intake')
 or exists(select 1 from cos_mhelp_intake.work_order_assignments where assignment_id=p_assignment)
 or exists(select 1 from cos_mhelp_intake.work_orders where prep_ticket_id=p_prep);
$$;
create function cos_mhelp_intake.team_assignment_baseline_v1(p_work uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(a.id::text,to_jsonb(a) order by a.id),'{}') from cos_mhelp_intake.work_order_assignments r join public.job_assignments a on a.id=r.assignment_id where r.work_order_id=p_work;
$$;
create function cos_mhelp_intake.assert_registered_assignments_v1(p_work uuid,p_fence boolean default true) returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;
 if p_fence then perform cos_mhelp_intake.fence_assignments_v1();end if;
 if exists(select 1 from public.job_assignments a where btrim(a.ticket_no)=w.ticket_number and not exists(select 1 from cos_mhelp_intake.work_order_assignments r where r.work_order_id=w.id and r.assignment_id=a.id))
 or exists(select 1 from cos_mhelp_intake.work_order_assignments r join public.job_assignments a on a.id=r.assignment_id where r.work_order_id=w.id and (btrim(a.ticket_no)<>w.ticket_number or a.created_from is distinct from 'mhelpdesk_service_intake' or a.assigned_role<>r.department)) then raise exception 'mhelp_untracked_assignment';end if;
end$$;
create function cos_mhelp_intake.register_assignment_v1(p_work uuid,p_assignment uuid,p_department text,p_source_identity text default null) returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;a public.job_assignments%rowtype;r cos_mhelp_intake.work_order_assignments%rowtype;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;perform cos_mhelp_intake.fence_assignments_v1();
 select * into strict a from public.job_assignments where id=p_assignment for update nowait;
 if btrim(a.ticket_no)<>w.ticket_number or a.created_from is distinct from 'mhelpdesk_service_intake' or a.assigned_role<>p_department or a.status<>'assigned' or a.started_at is not null or a.completed_at is not null or a.cancelled_at is not null or a.claimed_at is not null or a.prep_ticket_id is not null
 or (p_source_identity is null) is distinct from (a.assignee_user_id is null) or (a.assignee_user_id is null and a.assignment_scope<>'department') or (a.assignee_user_id is not null and a.assignment_scope<>'technician') then raise exception 'mhelp_assignment_registration_invalid';end if;
 select * into r from cos_mhelp_intake.work_order_assignments where assignment_id=p_assignment;
 if found then if row(r.work_order_id,r.department,r.source_identity,r.baseline) is distinct from row(p_work,p_department,p_source_identity,to_jsonb(a)) then raise exception 'mhelp_assignment_registration_conflict';end if;return;end if;
 insert into cos_mhelp_intake.work_order_assignments(work_order_id,assignment_id,department,source_identity,origin,baseline) values(p_work,p_assignment,p_department,p_source_identity,case when p_source_identity is null then 'counterpart_queue' else 'scheduled_source' end,to_jsonb(a));
end$$;
-- Complete exact roster only. Assignment inserts/cancellations are the atomic
-- writer's responsibility. Existing participant identity is never retargeted.
create function cos_mhelp_intake.reconcile_memberships_v1(p_work uuid,p_expected_revision bigint,p_source_revision text,p_members jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;m jsonb;a public.job_assignments%rowtype;r cos_mhelp_intake.work_order_assignments%rowtype;profile public.profiles%rowtype;v_changed boolean:=false;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;perform cos_mhelp_intake.assert_registered_assignments_v1(p_work);
 if w.membership_revision<>p_expected_revision then raise exception 'mhelp_membership_revision_conflict';end if;
 if exists(select 1 from cos_mhelp_intake.work_order_assignments b join public.job_assignments a on a.id=b.assignment_id where b.work_order_id=w.id and (to_jsonb(a) is distinct from b.baseline or a.started_at is not null or a.completed_at is not null or a.claimed_at is not null or a.prep_ticket_id is not null or a.status not in ('assigned','cancelled') or (a.status='assigned' and a.cancelled_at is not null))) then raise exception 'mhelp_membership_work_changed';end if;
 if p_source_revision is null or length(p_source_revision)>256 or jsonb_typeof(p_members) is distinct from 'array' or jsonb_array_length(p_members)>20 then raise exception 'mhelp_membership_roster_invalid';end if;
 if (select count(*) from jsonb_array_elements(p_members))<>(select count(distinct x->>'sourceIdentity') from jsonb_array_elements(p_members) x)
 or (select count(*) from jsonb_array_elements(p_members))<>(select count(distinct x->>'legacyUserId') from jsonb_array_elements(p_members) x) then raise exception 'mhelp_membership_roster_invalid';end if;
 for m in select value from jsonb_array_elements(p_members) loop
  if jsonb_typeof(m)<>'object' or not(m ?& array['sourceIdentity','legacyUserId','department','assignmentId','scheduledFor','scheduledTime']) or (select count(*) from jsonb_object_keys(m))<>6 then raise exception 'mhelp_membership_roster_invalid';end if;
  select * into strict r from cos_mhelp_intake.work_order_assignments where assignment_id=(m->>'assignmentId')::uuid and work_order_id=w.id;
  select * into strict a from public.job_assignments where id=r.assignment_id for update nowait;
  select * into strict profile from public.profiles where user_id=(m->>'legacyUserId')::uuid for share nowait;
  if not profile.active or profile.archived_at is not null or profile.role::text<>m->>'department' or r.department<>m->>'department' or r.source_identity is distinct from m->>'sourceIdentity' or a.assignee_user_id is distinct from profile.user_id or a.assigned_role<>r.department
   or a.status<>'assigned' or a.started_at is not null or a.completed_at is not null or a.cancelled_at is not null or a.claimed_at is not null or a.prep_ticket_id is not null
   or a.scheduled_for is distinct from (m->>'scheduledFor')::date or a.scheduled_time is distinct from (m->>'scheduledTime')::time then raise exception 'mhelp_membership_assignment_invalid';end if;
  if exists(select 1 from cos_mhelp_intake.participants x where x.assignment_id=a.id and row(x.legacy_user_id,x.department,x.source_identity) is distinct from row(profile.user_id,r.department,r.source_identity)) then raise exception 'mhelp_membership_identity_immutable';end if;
 end loop;
 if w.prep_ticket_id is not null then raise exception 'mhelp_membership_work_started';end if;
 if w.source_revision=p_source_revision then
  if exists(select 1 from cos_mhelp_intake.participants p where p.work_order_id=w.id and p.state='active' and not exists(select 1 from jsonb_array_elements(p_members) m where (m->>'assignmentId')::uuid=p.assignment_id))
  or exists(select 1 from jsonb_array_elements(p_members) m where not exists(select 1 from cos_mhelp_intake.participants p where p.work_order_id=w.id and p.state='active' and p.assignment_id=(m->>'assignmentId')::uuid)) then raise exception 'mhelp_membership_source_revision_conflict';end if;return jsonb_build_object('state','unchanged','revision',w.membership_revision);end if;
 update cos_mhelp_intake.participants p set state='withdrawn',withdrawn_at=clock_timestamp() where p.work_order_id=w.id and p.state='active' and not exists(select 1 from jsonb_array_elements(p_members) m where (m->>'assignmentId')::uuid=p.assignment_id);
 for m in select value from jsonb_array_elements(p_members) loop
  if not exists(select 1 from cos_mhelp_intake.participants p where p.assignment_id=(m->>'assignmentId')::uuid and p.state='active') then
   insert into cos_mhelp_intake.participants(work_order_id,assignment_id,legacy_user_id,department,source_identity,source_revision) values(w.id,(m->>'assignmentId')::uuid,(m->>'legacyUserId')::uuid,m->>'department',m->>'sourceIdentity',p_source_revision);end if;
 end loop;
 update cos_mhelp_intake.work_orders set source_revision=p_source_revision,membership_revision=membership_revision+1,revision=revision+1 where id=w.id returning * into w;
 insert into cos_mhelp_intake.membership_events(work_order_id,revision,source_revision,members) values(w.id,w.membership_revision,p_source_revision,p_members);
 return jsonb_build_object('state','reconciled','revision',w.membership_revision);
end$$;
-- Scope sealing is owned by the Service extension. Missing installation scope
-- must fail closed; CREATE OR REPLACE there preserves this private signature.
create function cos_mhelp_intake.assert_installation_scope_v1(p_work uuid,p_prep uuid) returns void language plpgsql security invoker set search_path='' as $$begin raise exception 'mhelp_installation_scope_unavailable';end$$;
create function cos_mhelp_intake.resolve_participant_v1(p_assignment uuid,p_actor uuid,p_prep uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;m cos_mhelp_intake.participants%rowtype;a public.job_assignments%rowtype;profile public.profiles%rowtype;prep_status text;
begin
 if p_actor is null or auth.uid() is distinct from p_actor then raise exception 'mhelp_participant_actor_required' using errcode='42501';end if;
 select o.* into strict w from cos_mhelp_intake.work_orders o join cos_mhelp_intake.work_order_assignments r on r.work_order_id=o.id where r.assignment_id=p_assignment for update of o nowait;
 perform cos_mhelp_intake.assert_registered_assignments_v1(w.id,false);
 if w.prep_ticket_id is distinct from p_prep then raise exception 'mhelp_canonical_prep_required';end if;
 select * into strict m from cos_mhelp_intake.participants where assignment_id=p_assignment and legacy_user_id=p_actor and state='active' for share nowait;
 select * into strict a from public.job_assignments where id=p_assignment for update nowait;
 select * into strict profile from public.profiles where user_id=p_actor for share nowait;
 if not profile.active or profile.archived_at is not null or profile.role::text<>m.department or a.assignee_user_id is distinct from p_actor or a.assigned_role<>m.department or not((m.origin='scheduled_source' and a.assignment_scope='technician') or (m.origin='local_department_claim' and a.assignment_scope='department' and a.claimed_at is not null and exists(select 1 from cos_mhelp_intake.work_order_assignments r where r.assignment_id=a.id and r.origin='counterpart_queue'))) or a.status='cancelled' or a.cancelled_at is not null
 or (a.prep_ticket_id is not null and a.prep_ticket_id is distinct from w.prep_ticket_id) then raise exception 'mhelp_participant_not_current' using errcode='42501';end if;
 if w.prep_ticket_id is not null then select status into strict prep_status from public.prep_tickets where id=w.prep_ticket_id for share nowait;end if;
 return jsonb_build_object('work_order_id',w.id,'membership_id',m.id,'assignment_id',a.id,'actor_id',p_actor,'department',m.department,'prep_id',w.prep_ticket_id,
 'revision',w.revision,'membership_revision',w.membership_revision,'installation_scope_revision',w.installation_scope_revision,'writable',a.status in ('assigned','started') and a.completed_at is null and (prep_status is null or prep_status in ('draft','preparing')));
end$$;
create function cos_mhelp_intake.lock_participant_v1(p_assignment uuid,p_actor uuid,p_prep uuid,p_check_scope boolean default true) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare v jsonb;a public.job_assignments%rowtype;
begin
 v:=cos_mhelp_intake.resolve_participant_v1(p_assignment,p_actor,p_prep);perform cos_mhelp_intake.assert_registered_assignments_v1((v->>'work_order_id')::uuid);select * into strict a from public.job_assignments where id=p_assignment;
 if p_check_scope then perform cos_mhelp_intake.assert_installation_scope_v1((v->>'work_order_id')::uuid,p_prep);end if;return v;
end$$;
create function cos_mhelp_intake.prepare_it_shared_prep_v1(p_ticket text,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare assignment uuid;prep uuid;v jsonb;
begin
 select p.assignment_id,w.prep_ticket_id into strict assignment,prep from cos_mhelp_intake.work_orders w join cos_mhelp_intake.participants p on p.work_order_id=w.id where w.ticket_number=p_ticket and p.legacy_user_id=p_actor and p.department='it' and p.state='active';
 v:=cos_mhelp_intake.lock_participant_v1(assignment,p_actor,prep,false);if v->'writable' is distinct from 'true'::jsonb then raise exception 'mhelp_it_prep_not_writable';end if;return v;
end$$;
create function cos_mhelp_intake.bind_prep_v1(p_work uuid,p_assignment uuid,p_actor uuid,p_prep uuid) returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;v jsonb;number text;prep_status text;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;
 perform cos_mhelp_intake.assert_registered_assignments_v1(p_work);
 if w.prep_ticket_id is not null and w.prep_ticket_id<>p_prep then raise exception 'mhelp_canonical_prep_required';end if;
 select ticket_no,status into strict number,prep_status from public.prep_tickets where id=p_prep for update nowait;
 if btrim(number)<>w.ticket_number or prep_status not in ('draft','preparing') or exists(select 1 from public.prep_tickets where btrim(ticket_no)=w.ticket_number and id<>p_prep) then raise exception 'mhelp_prep_identity_conflict';end if;
 update cos_mhelp_intake.work_orders set prep_ticket_id=p_prep,revision=revision+1 where id=w.id and prep_ticket_id is null;
 v:=cos_mhelp_intake.lock_participant_v1(p_assignment,p_actor,p_prep,false);
 if v->>'work_order_id'<>p_work::text or v->>'department'<>'it' or v->'writable' is distinct from 'true'::jsonb then raise exception 'mhelp_canonical_prep_required';end if;
end$$;
create function cos_mhelp_intake.assert_release_admission_v1(p_work uuid,p_prep uuid) returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;perform cos_mhelp_intake.assert_registered_assignments_v1(p_work);
 if p_prep is null or w.prep_ticket_id is distinct from p_prep or exists(select 1 from public.prep_tickets where btrim(ticket_no)=w.ticket_number and id<>p_prep) then raise exception 'mhelp_canonical_prep_required';end if;
 if exists(select 1 from cos_mhelp_intake.participants m join public.job_assignments a on a.id=m.assignment_id join public.profiles p on p.user_id=m.legacy_user_id where m.work_order_id=w.id and m.state='active' and (a.assignee_user_id is distinct from m.legacy_user_id or a.assigned_role<>m.department or a.cancelled_at is not null or a.status='cancelled' or not p.active or p.archived_at is not null or p.role::text<>m.department)) then raise exception 'mhelp_membership_changed';end if;
end$$;
-- Explicit local department claims only, wrapped around the unchanged legacy
-- claim primitive in ONE transaction. No scheduler/intake path calls these.
create table cos_mhelp_intake.claim_admissions(assignment_id uuid primary key references cos_mhelp_intake.work_order_assignments(assignment_id),actor_id uuid not null,transaction_id bigint not null,baseline jsonb not null);
alter table cos_mhelp_intake.claim_admissions enable row level security;
revoke all on cos_mhelp_intake.claim_admissions from public,anon,authenticated,service_role;
create function cos_mhelp_intake.prepare_department_claim_v1(p_assignment uuid,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;r cos_mhelp_intake.work_order_assignments%rowtype;a public.job_assignments%rowtype;profile public.profiles%rowtype;
begin
 if p_actor is null or auth.uid() is distinct from p_actor then raise exception 'mhelp_claim_actor_required' using errcode='42501';end if;
 select o.* into strict w from cos_mhelp_intake.work_orders o join cos_mhelp_intake.work_order_assignments b on b.work_order_id=o.id where b.assignment_id=p_assignment for update of o nowait;
 perform cos_mhelp_intake.assert_registered_assignments_v1(w.id);
 select * into strict r from cos_mhelp_intake.work_order_assignments where assignment_id=p_assignment;
 select * into strict a from public.job_assignments where id=p_assignment for update nowait;
 select * into strict profile from public.profiles where user_id=p_actor for share nowait;
 if r.origin<>'counterpart_queue' or r.source_identity is not null or a.assignment_scope<>'department' or a.assignee_user_id is not null or a.status<>'assigned' or a.started_at is not null or a.completed_at is not null or a.cancelled_at is not null or a.claimed_at is not null or to_jsonb(a) is distinct from r.baseline or not profile.active or profile.archived_at is not null or profile.role::text<>r.department then raise exception 'mhelp_claim_not_pristine';end if;
 if exists(select 1 from cos_mhelp_intake.participants where work_order_id=w.id and legacy_user_id=p_actor and state='active') then raise exception 'mhelp_claim_membership_exists';end if;
 insert into cos_mhelp_intake.claim_admissions values(p_assignment,p_actor,txid_current(),to_jsonb(a)) on conflict(assignment_id) do update set actor_id=excluded.actor_id,transaction_id=excluded.transaction_id,baseline=excluded.baseline;
 return jsonb_build_object('work_order_id',w.id,'assignment_id',a.id,'actor_id',p_actor,'department',r.department,'prep_id',w.prep_ticket_id);
end$$;
create function cos_mhelp_intake.record_department_claim_v1(p_assignment uuid,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;r cos_mhelp_intake.work_order_assignments%rowtype;a public.job_assignments%rowtype;ad cos_mhelp_intake.claim_admissions%rowtype;
begin
 select o.* into strict w from cos_mhelp_intake.work_orders o join cos_mhelp_intake.work_order_assignments b on b.work_order_id=o.id where b.assignment_id=p_assignment for update of o nowait;
 perform cos_mhelp_intake.assert_registered_assignments_v1(w.id);
 if exists(select 1 from cos_mhelp_intake.participants where assignment_id=p_assignment and legacy_user_id=p_actor and origin='local_department_claim' and state='active') then return cos_mhelp_intake.resolve_participant_v1(p_assignment,p_actor,w.prep_ticket_id);end if;
 select * into strict ad from cos_mhelp_intake.claim_admissions where assignment_id=p_assignment and actor_id=p_actor and transaction_id=txid_current() for update nowait;
 select * into strict r from cos_mhelp_intake.work_order_assignments where assignment_id=p_assignment;
 select * into strict a from public.job_assignments where id=p_assignment for update nowait;
 if auth.uid() is distinct from p_actor or r.origin<>'counterpart_queue' or a.assignee_user_id is distinct from p_actor or a.assignment_scope<>'department' or a.status<>'started' or a.started_at is distinct from transaction_timestamp() or a.claimed_at is distinct from transaction_timestamp() or a.completed_at is not null or a.cancelled_at is not null
 or (to_jsonb(a)-array['assignee_user_id','assignee_name','status','started_at','claimed_at','updated_at']) is distinct from (ad.baseline-array['assignee_user_id','assignee_name','status','started_at','claimed_at','updated_at']) then raise exception 'mhelp_claim_result_invalid';end if;
 insert into cos_mhelp_intake.participants(work_order_id,assignment_id,legacy_user_id,department,source_identity,origin,source_revision) values(w.id,p_assignment,p_actor,r.department,null,'local_department_claim',coalesce(w.source_revision,'local-claim'));
 update cos_mhelp_intake.work_orders set membership_revision=membership_revision+1,revision=revision+1 where id=w.id;
 delete from cos_mhelp_intake.claim_admissions where assignment_id=p_assignment;
 return cos_mhelp_intake.resolve_participant_v1(p_assignment,p_actor,w.prep_ticket_id);
end$$;
revoke all on function cos_mhelp_intake.membership_immutable_v1(),cos_mhelp_intake.assignment_registry_immutable_v1(),cos_mhelp_intake.work_identity_immutable_v1(),cos_mhelp_intake.fence_assignments_v1(),cos_mhelp_intake.has_source_binding_v1(uuid,uuid),cos_mhelp_intake.team_assignment_baseline_v1(uuid),cos_mhelp_intake.assert_registered_assignments_v1(uuid,boolean),cos_mhelp_intake.register_assignment_v1(uuid,uuid,text,text),cos_mhelp_intake.reconcile_memberships_v1(uuid,bigint,text,jsonb),cos_mhelp_intake.assert_installation_scope_v1(uuid,uuid),cos_mhelp_intake.resolve_participant_v1(uuid,uuid,uuid),cos_mhelp_intake.lock_participant_v1(uuid,uuid,uuid,boolean),cos_mhelp_intake.prepare_it_shared_prep_v1(text,uuid),cos_mhelp_intake.bind_prep_v1(uuid,uuid,uuid,uuid),cos_mhelp_intake.assert_release_admission_v1(uuid,uuid),cos_mhelp_intake.prepare_department_claim_v1(uuid,uuid),cos_mhelp_intake.record_department_claim_v1(uuid,uuid) from public,anon,authenticated,service_role;
create function cos_mhelp_intake.bind_counterpart_queue_v1(p_work uuid,p_assignment uuid,p_prep uuid) returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare w cos_mhelp_intake.work_orders%rowtype;a public.job_assignments%rowtype;r cos_mhelp_intake.work_order_assignments%rowtype;
begin
 select * into strict w from cos_mhelp_intake.work_orders where id=p_work for update nowait;
 perform cos_mhelp_intake.prepare_it_shared_prep_v1(w.ticket_number,auth.uid());
 if p_prep is null or w.prep_ticket_id is distinct from p_prep then raise exception 'mhelp_canonical_prep_required';end if;
 select * into strict r from cos_mhelp_intake.work_order_assignments where assignment_id=p_assignment and work_order_id=w.id;
 select * into strict a from public.job_assignments where id=p_assignment for update nowait;
 if r.origin<>'counterpart_queue' or r.department<>'service' or r.source_identity is not null or a.assignee_user_id is not null or a.assignment_scope<>'department' or a.status<>'assigned' or a.started_at is not null or a.completed_at is not null or a.cancelled_at is not null or a.claimed_at is not null or to_jsonb(a) is distinct from r.baseline or (a.prep_ticket_id is not null and a.prep_ticket_id<>p_prep) then raise exception 'mhelp_queue_binding_not_pristine';end if;
 if a.prep_ticket_id is null then update public.job_assignments set prep_ticket_id=p_prep,updated_at=now() where id=p_assignment returning * into a;end if;
 update cos_mhelp_intake.work_order_assignments set baseline=to_jsonb(a) where assignment_id=p_assignment;
end$$;
revoke all on function cos_mhelp_intake.bind_counterpart_queue_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;
