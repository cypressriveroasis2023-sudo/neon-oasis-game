-- Tech Check: SIMs must come from the SIM drawer (step 4 of James's handoff plan, 25 Nov 2026).
--
-- When app_private.sim_drawer_settings.require_listed is on, an IT handoff (checkout) is refused if a
-- unit carries a SIM that is not in the drawer, or that the drawer shows somewhere else. The refusal
-- names the SIM and says the next step. Nothing is refused while the switch is off (as it is today),
-- so this can go in before the drawer holds every card on hand.
--   * app_private.sim_drawer_require_check_v1(): BEFORE INSERT trigger on techcheck_transfer_events.
--     A repeat of the same handoff (same transfer) is never refused for its own SIMs.
--   * public.sim_drawer_require_v1(on boolean): the Owner turns the rule on or off; every change is
--     kept in sim_drawer_history (event 'marked', sim_number 'SETTING').
--
-- Rollback:
--   drop trigger if exists sim_drawer_require_v1 on app_private.techcheck_transfer_events;
--   update app_private.sim_drawer_settings set require_listed=false where singleton;

begin;

create or replace function app_private.sim_drawer_require_check_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare item jsonb; s text; v text; c app_private.sim_drawer%rowtype; unit text;
begin
  if new.kind <> 'checkout' or not coalesce((select require_listed from app_private.sim_drawer_settings where singleton), false) then
    return new;
  end if;
  for item in select value from jsonb_array_elements(coalesce(new.snapshot->'actual', '[]'::jsonb)) loop
    unit := btrim(concat(item->>'family', ' ', item->>'unit_tag'));
    for s in select jsonb_array_elements_text(coalesce(item->'sims', '[]'::jsonb)) loop
      v := app_private.sim_clean_v1(s);
      if v is null or v in ('NA','NONE','N') then continue; end if;
      select * into c from app_private.sim_drawer where sim_number = v;
      if not found then
        raise exception using errcode = 'P0001',
          message = 'SIM ' || v || ' in ' || unit || ' is not in the SIM drawer, so this handoff was not saved. NEXT STEP: check the number on the card. If it is right, add it in the SIM drawer (Manager tab, or ask James), then send the handoff again. If it is wrong, fix the number and send again.';
      end if;
      if c.status = 'in_drawer' or (c.status = 'in_unit' and c.transfer_id = new.transfer_id) then continue; end if;
      raise exception using errcode = 'P0001',
        message = 'SIM ' || v || ' in ' || unit || ' is not free: the SIM drawer shows it as '
          || case c.status when 'in_unit' then 'already in a unit' when 'on_truck' then 'on a Service truck' when 'bad' then 'bad'
                           when 'deactivated' then 'deactivated' when 'removed' then 'removed' else c.status end
          || coalesce(' (' || nullif(c.location, '') || ')', '') || ', so this handoff was not saved. NEXT STEP: use a SIM that is in the drawer. If this card really is in your hand and good, put it back in the drawer first (SIM drawer, Back in drawer), then send the handoff again.';
    end loop;
  end loop;
  return new;
end $$;
revoke all on function app_private.sim_drawer_require_check_v1() from public, anon, authenticated;

drop trigger if exists sim_drawer_require_v1 on app_private.techcheck_transfer_events;
create trigger sim_drawer_require_v1 before insert on app_private.techcheck_transfer_events
  for each row execute function app_private.sim_drawer_require_check_v1();

create or replace function public.sim_drawer_require_v1(p_on boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if p_on is null then raise exception 'Say on or off.'; end if;
  select * into a from app_private.sim_actor_v1();
  update app_private.sim_drawer_settings set require_listed = p_on, updated_at = now() where singleton;
  insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
    values('SETTING', 'marked', null, case when p_on then 'SIMs must come from the drawer: on' else 'SIMs must come from the drawer: off' end, a.id, a.name);
  return jsonb_build_object('require_listed', p_on);
end $$;
revoke all on function public.sim_drawer_require_v1(boolean) from public, anon;
grant execute on function public.sim_drawer_require_v1(boolean) to authenticated;

commit;
