-- Tech Check: catch notes that contradict the checks, and stop false SIM differences.
--
-- 1. A note that says something is still needed ("Need semitry sim", "missing
--    battery", "not working") while every check passed is refused, on IT's
--    checkout and on a Service receipt with no differences, unless the signer
--    confirms the note is only information: p_checks._note_ready = true.
--    Example from the records: Solar Spotter 039 went out with "Need semitry sim"
--    and SIM OK ticked.
-- 2. SIM lists are compared after cleaning: upper case, spaces and dashes
--    dropped, "NA" / "N/A" / "NONE" ignored, order ignored. "N/A" against "NA",
--    or the same two SIMs in a different order, is no longer a difference.
--
-- Edits app_private.submit_techcheck_transfer_v2 in place, guarded by its md5
-- after techcheck-service-receipt-checks-v1.sql (48e6000eaea32a059fb1b446d51121e6),
-- and replaces app_private.techcheck_transfer_differences_v2 (guarded by md5
-- 5f0b... of its current definition, checked below). Re-running is a no-op.
--
-- Rollback: restore both functions from the definitions saved in
-- app_private.techcheck_clean_checks_backup_v1.

do $migration$
declare
  sub constant regprocedure := 'app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure;
  dif constant regprocedure := 'app_private.techcheck_transfer_differences_v2(jsonb,jsonb,text)'::regprocedure;
  sub_def text := pg_get_functiondef(sub);
  dif_def text := pg_get_functiondef(dif);
  checkout_anchor constant text := E'  next_state:=''awaiting_service'';\n';
  receipt_anchor constant text := E'   next_state:=case when jsonb_array_length(differences)=0 then ''accepted'' else ''discrepancy'' end;\n';
  checkout_added constant text := $a$  -- A note that says something is still needed must not go out with every check passed.
  if app_private.techcheck_note_says_needed_v1(p_notes) and (p_checks->'_note_ready') is distinct from 'true'::jsonb then
   raise exception 'Your note says something is still needed: "%". Fix it before handing over, or tick "This note is only information — the equipment is ready".',left(btrim(p_notes),120);
  end if;
$a$;
  receipt_added constant text := $a$   -- The same for a receipt that records no problem at all.
   if jsonb_array_length(differences)=0 and app_private.techcheck_note_says_needed_v1(p_notes) and (p_checks->'_note_ready') is distinct from 'true'::jsonb then
    raise exception 'Your note says something is wrong or missing: "%". Mark that check as Problem, or tick "This note is only information — the equipment is ready".',left(btrim(p_notes),120);
   end if;
$a$;
  sims_old constant text := E'    if v_item->v_field is distinct from v_expected->v_field then\n';
  sims_new constant text := E'    if v_field=''sims'' and app_private.techcheck_sims_clean_v1(v_item->''sims'') is not distinct from app_private.techcheck_sims_clean_v1(v_expected->''sims'') then continue;end if;\n    if v_item->v_field is distinct from v_expected->v_field then\n';
begin
  -- helpers
  execute $f$create or replace function app_private.techcheck_note_says_needed_v1(p text) returns boolean language sql immutable set search_path='' as $b$
    select coalesce(lower(btrim(p)),'') !~ '^(n/?a|none|no notes?|-|\.)?$'
       and lower(p) ~ '(\m(need|needs|needed|missing|broken|bad|replace|replaced|waiting|pending|without|lost|cracked|dead|damaged)\M|not (working|installed|charged|programmed|online|recording)|no (sim|sd|battery|batteries|power|video|signal))'
  $b$$f$;
  execute $f$create or replace function app_private.techcheck_sims_clean_v1(p jsonb) returns jsonb language sql immutable set search_path='' as $b$
    select coalesce(jsonb_agg(distinct v order by v),'[]'::jsonb) from (
      select upper(regexp_replace(value,'[^0-9A-Za-z]','','g')) v from jsonb_array_elements_text(case when jsonb_typeof(p)='array' then p else '[]'::jsonb end)
    ) s where v <> '' and v not in ('NA','NONE','N')
  $b$$f$;

  create table if not exists app_private.techcheck_clean_checks_backup_v1(fn text primary key, definition text not null, saved_at timestamptz not null default now());
  revoke all on app_private.techcheck_clean_checks_backup_v1 from public, anon, authenticated;

  -- submit: two small additions
  if position('techcheck_note_says_needed_v1' in sub_def) = 0 then
    if md5(sub_def) is distinct from '48e6000eaea32a059fb1b446d51121e6' then
      raise exception 'submit_techcheck_transfer_v2 is not the reviewed version (md5 %). Not changed.', md5(sub_def);
    end if;
    if (length(sub_def)-length(replace(sub_def,checkout_anchor,'')))/length(checkout_anchor) <> 1
       or (length(sub_def)-length(replace(sub_def,receipt_anchor,'')))/length(receipt_anchor) <> 1 then
      raise exception 'Anchors not found exactly once. Not changed.';
    end if;
    insert into app_private.techcheck_clean_checks_backup_v1(fn, definition) values('submit_techcheck_transfer_v2', sub_def) on conflict do nothing;
    execute replace(replace(sub_def, checkout_anchor, checkout_added || checkout_anchor), receipt_anchor, receipt_added || receipt_anchor);
  end if;

  -- differences: SIM lists compared cleaned
  if position('techcheck_sims_clean_v1' in dif_def) = 0 then
    if (length(dif_def)-length(replace(dif_def,sims_old,'')))/length(sims_old) <> 1 then
      raise exception 'Differences anchor not found exactly once. Not changed.';
    end if;
    insert into app_private.techcheck_clean_checks_backup_v1(fn, definition) values('techcheck_transfer_differences_v2', dif_def) on conflict do nothing;
    execute replace(dif_def, sims_old, sims_new);
  end if;
end
$migration$;
