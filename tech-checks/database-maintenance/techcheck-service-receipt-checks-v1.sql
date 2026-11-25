-- Tech Check: Service answers the equipment checklist before signing a receipt.
--
-- Until now a Service receipt was saved with no checks at all (both live
-- receipts, Solar Spotter 039 and Sniper 328, have empty checks). After this
-- change, for every unit Service receives:
--   * every check IT had to pass for that unit type must be answered, Pass or
--     Problem (true/false); a blank check refuses the receipt;
--   * the battery checks IT skips for truck replenishment are skipped here too;
--   * any Problem is saved as a difference ("check:<field>"), so the handoff goes
--     to IT / Owner review instead of being accepted, and Notes must say what is
--     wrong.
-- Units Service reports as missing, or as a different unit than IT sent, are
-- already differences and are not checked here.
--
-- Applied by editing the live function text in place, guarded by its md5, so
-- nothing else in it changes. Ship tech-checks/transfers/desk.js (Pass/Problem
-- on the receipt screen) before applying this.
--
-- Rollback: re-run this file's guard in reverse, or restore the definition with
-- md5 2fe8e0f559032d2337489d17bbbd848e from techcheck-transfer-purpose-v2.sql
-- plus techcheck-owner-handoff-resolution-v1.sql.

do $migration$
declare
  sig constant regprocedure := 'app_private.submit_techcheck_transfer_v2(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure;
  def text := pg_get_functiondef(sig);
  anchor constant text := E'   differences:=app_private.techcheck_transfer_differences_v2(t.manifest,items,t.purpose);\n';
  added constant text := $add$   -- Service answers the same checklist IT passed, Pass or Problem for every line.
   for item in select value from jsonb_array_elements(items) loop
    select * into equipment from public.equipment_master where equipment_key=item->>'equipment_key';
    if not found then continue;end if;
    select * into rules from app_private.techcheck_transfer_rules where workflow_type=equipment.workflow_type and workflow_type=equipment.canonical_family;
    if not found then raise exception 'No approved check-only rule mapping exists for this equipment.';end if;
    for field in select jsonb_array_elements_text(rules.bool_fields) loop
     if t.purpose='truck_replenishment' and field in ('delivery_batteries_charged_ok','helios_battery_box_installed_ok','helios_battery_120v_charged_ok') then continue;end if;
     if jsonb_typeof(p_checks->(item->>'equipment_key')->field) is distinct from 'boolean' then
      raise exception 'Answer every check for % % (Pass or Problem) before you sign.',equipment.canonical_family,equipment.unit_tag;
     end if;
     if not (p_checks->(item->>'equipment_key')->>field)::boolean then
      differences:=differences||jsonb_build_array(jsonb_build_object('equipment_key',item->>'equipment_key','field','check:'||field,'expected',true,'actual',false));
     end if;
    end loop;
   end loop;
   if exists(select 1 from jsonb_array_elements(differences) d where d->>'field' like 'check:%') and length(btrim(p_notes))=0 then
    raise exception 'You marked a check as Problem. Write in Notes what is wrong before you sign.';
   end if;
$add$;
begin
  if position(added in def) > 0 then raise notice 'Service receipt checks already applied.'; return; end if;
  if md5(def) is distinct from '2fe8e0f559032d2337489d17bbbd848e' then
    raise exception 'submit_techcheck_transfer_v2 is not the reviewed version (md5 %). Not changed.', md5(def);
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Receipt anchor not found exactly once. Not changed.';
  end if;
  execute replace(def, anchor, anchor || added);
end
$migration$;
