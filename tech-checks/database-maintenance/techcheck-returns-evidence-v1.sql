-- Tech Check returns (Service -> IT): photos required, and stuck returns shown to the owner.
--
-- 1. app_private.techcheck_ticketfree_photos_v1 is the one photo check used by all four
--    return steps (Service: swap / pickup / unused return, linked or unlinked; IT: check-in).
--    It now needs at least one photo. Before, a return could be sent and checked in with none
--    (2 of the 3 real returns had none).
-- 2. public.techcheck_handoff_gaps_v1 (the owner's Manager tab "Handoff check") also lists
--    returns still waiting for IT check-in after the same 4 hours.
--
-- Guarded by the md5 of each current definition; re-running is a no-op.
-- Rollback: the old definitions are saved in app_private.techcheck_returns_evidence_backup_v1.

do $migration$
declare
  ph constant regprocedure := 'app_private.techcheck_ticketfree_photos_v1(uuid,text[])'::regprocedure;
  gp constant regprocedure := 'public.techcheck_handoff_gaps_v1(timestamptz)'::regprocedure;
  ph_def text := pg_get_functiondef(ph);
  gp_def text := pg_get_functiondef(gp);
  ph_old constant text := $t$ if p_paths is null or cardinality(p_paths)>8 then raise exception 'Use no more than eight photos.';end if;$t$;
  ph_new constant text := $t$ if p_paths is null or cardinality(p_paths)>8 then raise exception 'Use no more than eight photos.';end if;
 if cardinality(p_paths)<1 then raise exception 'Take at least one photo of the equipment.';end if;$t$;
  gp_anchor constant text := $t$    'handoffs_not_finished', coalesce(($t$;
  gp_added constant text := $t$    'returns_not_checked_in', coalesce((
      select jsonb_agg(jsonb_build_object('unit', concat_ws(' ', coalesce(r.family, r.used_family), coalesce(r.unit_tag, r.used_tag)), 'from', r.service_tech_name, 'state', r.state,
               'sent_at', r.submitted_at, 'hours_waiting', round(extract(epoch from now() - r.submitted_at)/3600.0, 1)) order by r.submitted_at)
      from app_private.techcheck_ticketfree_returns_v1 r
      where r.state in ('waiting_it','identity_review') and r.submitted_at < now() - make_interval(hours => v_hours)), '[]'::jsonb),
$t$;
begin
  create table if not exists app_private.techcheck_returns_evidence_backup_v1(fn text primary key, definition text not null, saved_at timestamptz not null default now());
  revoke all on app_private.techcheck_returns_evidence_backup_v1 from public, anon, authenticated;

  if position('Take at least one photo of the equipment' in ph_def) = 0 then
    if (length(ph_def)-length(replace(ph_def,ph_old,'')))/length(ph_old) <> 1 then raise exception 'Photo rule anchor not found exactly once. Not changed.'; end if;
    insert into app_private.techcheck_returns_evidence_backup_v1(fn, definition) values('techcheck_ticketfree_photos_v1', ph_def) on conflict do nothing;
    execute replace(ph_def, ph_old, ph_new);
  end if;

  if position('returns_not_checked_in' in gp_def) = 0 then
    if (length(gp_def)-length(replace(gp_def,gp_anchor,'')))/length(gp_anchor) <> 1 then raise exception 'Gaps anchor not found exactly once. Not changed.'; end if;
    insert into app_private.techcheck_returns_evidence_backup_v1(fn, definition) values('techcheck_handoff_gaps_v1', gp_def) on conflict do nothing;
    execute replace(gp_def, gp_anchor, gp_added || gp_anchor);
  end if;
end
$migration$;
