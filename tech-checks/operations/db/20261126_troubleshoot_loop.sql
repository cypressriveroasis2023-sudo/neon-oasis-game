-- Send to IT, closing the loop (Operations project, tughscoxralhofrckvxy).
--
-- James, 2026-11-26 ("proceed" on: every troubleshoot report shows Open or Fixed on the unit card, and the IT
-- sheet carries the open ones). Reports stay append-only; a report is closed by adding a row here, never by
-- changing the report.
--
--   cos_troubleshoot_open_v1(actor, org)                     open reports, and ones closed in the last 7 days
--   cos_troubleshoot_close_v1(actor, org, report_id, payload) mark one report fixed (or not needed), with a note
--
-- Both are service_role only, called by cos-unit-camera-status with the signed-in person's identity checked by
-- app_private.cos_owner_identity_assert_actor, as cos_troubleshoot_report_v1 already is.
--
-- Rollback:
--   drop function if exists public.cos_troubleshoot_close_v1(uuid, uuid, uuid, jsonb);
--   drop function if exists public.cos_troubleshoot_open_v1(uuid, uuid);
--   (keep cos_troubleshoot_private.report_closures: it is the record of who closed what)
begin;

create table if not exists cos_troubleshoot_private.report_closures (
  report_id uuid primary key references cos_troubleshoot_private.reports(id),
  organization_id uuid not null,
  outcome text not null check (outcome in ('fixed','not_needed')),
  note text not null check (length(note) between 1 and 1000),
  closed_by uuid not null,
  closed_by_name text not null,
  closed_at timestamptz not null default now()
);
revoke all on cos_troubleshoot_private.report_closures from public, anon, authenticated;

create or replace function public.cos_troubleshoot_open_v1(p_actor_user_id uuid, p_organization_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'cos_troubleshoot_private', 'app_private' as $$
begin
  perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
  return jsonb_build_object('contract','COS_TROUBLESHOOT_OPEN_V1','items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,'unitKey',r.unit_key,'unitName',r.unit_name,'result',r.result_title,'next',r.next_step,
      'managerHelp',r.manager_help,'note',r.note,'by',r.actor_name,'at',r.recorded_at,
      'closed',c.report_id is not null,'outcome',c.outcome,'closedNote',c.note,'closedBy',c.closed_by_name,'closedAt',c.closed_at)
      order by (c.report_id is not null), r.recorded_at desc)
    from cos_troubleshoot_private.reports r
    left join cos_troubleshoot_private.report_closures c on c.report_id=r.id
    where r.organization_id=p_organization_id and (c.report_id is null or c.closed_at > now() - interval '7 days')),'[]'::jsonb));
end;
$$;

create or replace function public.cos_troubleshoot_close_v1(p_actor_user_id uuid, p_organization_id uuid, p_report_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'cos_troubleshoot_private', 'app_private' as $$
declare rep cos_troubleshoot_private.reports; done cos_troubleshoot_private.report_closures;
  outcome text := coalesce(p_payload->>'outcome',''); body text := btrim(coalesce(p_payload->>'note',''));
  who text := btrim(coalesce(p_payload->>'actorName',''));
begin
  perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
  if p_report_id is null or outcome not in ('fixed','not_needed') or body='' or length(body)>1000 or who='' or length(who)>120 then
    raise exception 'Say what was done before closing it.' using errcode='PT409'; end if;
  if body ~ '([0-9]{1,3}\.){3}[0-9]{1,3}' then
    raise exception 'Notes carry last octets only, not a whole IP address' using errcode='PT409'; end if;
  select * into rep from cos_troubleshoot_private.reports where id=p_report_id and organization_id=p_organization_id;
  if not found then raise exception 'That report is not on record.' using errcode='PT409'; end if;
  select * into done from cos_troubleshoot_private.report_closures where report_id=p_report_id;
  if found then
    return jsonb_build_object('contract','COS_TROUBLESHOOT_CLOSE_RESULT_V1','id',p_report_id,'repeat',true,'closedAt',done.closed_at,'closedBy',done.closed_by_name);
  end if;
  insert into cos_troubleshoot_private.report_closures(report_id,organization_id,outcome,note,closed_by,closed_by_name)
  values (p_report_id,p_organization_id,outcome,body,p_actor_user_id,who) returning * into done;
  return jsonb_build_object('contract','COS_TROUBLESHOOT_CLOSE_RESULT_V1','id',p_report_id,'repeat',false,'closedAt',done.closed_at,'closedBy',done.closed_by_name);
end;
$$;

revoke all on function public.cos_troubleshoot_open_v1(uuid,uuid) from public, anon, authenticated;
revoke all on function public.cos_troubleshoot_close_v1(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.cos_troubleshoot_open_v1(uuid,uuid) to service_role;
grant execute on function public.cos_troubleshoot_close_v1(uuid,uuid,uuid,jsonb) to service_role;

commit;
