-- Troubleshoot reports from the COS unit card (Operations project, tughscoxralhofrckvxy).
--
-- James, 2026-11-25: "Send to IT" — a tech finishes Troubleshoot on a unit card and
-- the result goes onto the next daily IT sheet, with Manager help YES flagged,
-- instead of being copied by hand.
--
-- This is a record of what a tech found, not a job: nothing here schedules a
-- visit (IT never books visits; the manager arranges them), and nothing here
-- changes the unit, its cameras, mHelp, Star4Live or InHand.
--
-- Append-only. The request id is the primary key, so the same send twice is the
-- same report. Readable only through service_role (the daily IT sheet run).
begin;

create schema if not exists cos_troubleshoot_private;

create table if not exists cos_troubleshoot_private.reports(
 id uuid primary key,
 seq bigint generated always as identity unique,
 organization_id uuid not null,
 unit_key text not null check(btrim(unit_key)<>'' and length(unit_key)<=120),
 unit_name text not null check(btrim(unit_name)<>'' and length(unit_name)<=160),
 result_title text not null check(btrim(result_title)<>'' and length(result_title)<=160),
 next_step text check(next_step is null or length(next_step)<=200),
 manager_help boolean not null,
 note text not null check(btrim(note)<>'' and length(note)<=4000),
 actor uuid not null,
 actor_name text not null check(btrim(actor_name)<>'' and length(actor_name)<=120),
 actor_role text not null check(actor_role in('owner','it')),
 recorded_at timestamptz not null default clock_timestamp(),
 -- Notes carry last octets only; a whole IPv4 address is refused.
 check(note !~ '([0-9]{1,3}\.){3}[0-9]{1,3}')
);
comment on table cos_troubleshoot_private.reports is
 'Append-only Troubleshoot results sent to IT from the COS unit card. Read by the daily IT sheet run. Never updated or deleted.';
create index if not exists reports_recent_idx on cos_troubleshoot_private.reports(organization_id,recorded_at desc);

create or replace function cos_troubleshoot_private.reports_append_only()
returns trigger language plpgsql as $$
begin raise exception 'Troubleshoot reports are append-only' using errcode='PT409'; end;
$$;
drop trigger if exists reports_no_change on cos_troubleshoot_private.reports;
create trigger reports_no_change before update or delete on cos_troubleshoot_private.reports
 for each row execute function cos_troubleshoot_private.reports_append_only();

create or replace function public.cos_troubleshoot_report_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,cos_troubleshoot_private,app_private as $$
declare unit text; nm text; title text; nxt text; helped boolean; body text; who text; role_name text; seen cos_troubleshoot_private.reports;
begin
 -- Owner or verified IT, the same people who may make hand fixes on the card.
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'managerHelp') is distinct from 'boolean' then
  raise exception 'Troubleshoot report is incomplete' using errcode='PT409'; end if;
 unit:=btrim(coalesce(p_payload->>'unitKey',''));
 nm:=btrim(coalesce(p_payload->>'unitName',''));
 title:=btrim(coalesce(p_payload->>'result',''));
 nxt:=nullif(btrim(coalesce(p_payload->>'next','')),'');
 helped:=(p_payload->>'managerHelp')::boolean;
 body:=btrim(coalesce(p_payload->>'note',''));
 who:=btrim(coalesce(p_payload->>'actorName',''));
 role_name:=coalesce(p_payload->>'actorRole','');
 if unit='' or length(unit)>120 or nm='' or length(nm)>160 or title='' or length(title)>160 or (nxt is not null and length(nxt)>200)
  or body='' or length(body)>4000 or who='' or length(who)>120 or role_name not in('owner','it') then
  raise exception 'Troubleshoot report is incomplete' using errcode='PT409'; end if;
 if body ~ '([0-9]{1,3}\.){3}[0-9]{1,3}' then
  raise exception 'Notes carry last octets only, not a whole IP address' using errcode='PT409'; end if;
 select * into seen from cos_troubleshoot_private.reports where id=p_request_id;
 if found then
  if seen.organization_id=p_organization_id and seen.actor=p_actor_user_id and seen.unit_key=unit and seen.note=body then
   return jsonb_build_object('contract','COS_TROUBLESHOOT_REPORT_RESULT_V1','id',seen.id,'repeat',true,'recordedAt',seen.recorded_at);
  end if;
  raise exception 'Request id was already used for a different report' using errcode='PT409';
 end if;
 insert into cos_troubleshoot_private.reports(id,organization_id,unit_key,unit_name,result_title,next_step,manager_help,note,actor,actor_name,actor_role)
 values(p_request_id,p_organization_id,unit,nm,title,nxt,helped,body,p_actor_user_id,who,role_name)
 returning * into seen;
 return jsonb_build_object('contract','COS_TROUBLESHOOT_REPORT_RESULT_V1','id',seen.id,'repeat',false,'recordedAt',seen.recorded_at);
end;
$$;

revoke all on schema cos_troubleshoot_private from anon,authenticated;
revoke all on cos_troubleshoot_private.reports from anon,authenticated,service_role;
revoke all on function public.cos_troubleshoot_report_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant usage on schema cos_troubleshoot_private to service_role;
grant select on cos_troubleshoot_private.reports to service_role;
grant execute on function public.cos_troubleshoot_report_v1(uuid,uuid,uuid,jsonb) to service_role;

commit;
