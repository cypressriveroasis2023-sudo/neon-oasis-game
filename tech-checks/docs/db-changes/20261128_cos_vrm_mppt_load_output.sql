-- Operations (tughscoxralhofrckvxy), 2026-11-28, James's go ("Go track it").
-- Save the solar charger's load output (on/off, current, mode, off reason) with the other charger readings,
-- to learn whether the GAGO DD3's switchable load output feeds the cameras before any remote restart is built.
-- Read-only at Victron. Anchored edit of public.cos_vrm_mppt_save: only its list of kept paths grows.
-- Rollback: run the same block with the two arrays swapped (remove the four added paths).
do $$
declare d text := pg_get_functiondef('public.cos_vrm_mppt_save(jsonb,jsonb)'::regprocedure);
        anchor text := $a$'/History/Daily/0/Yield','/History/Daily/0/MaxPower','/History/Daily/1/Yield','/History/Daily/1/MaxPower','/Yield/User'];$a$;
begin
  if position('/Load/I' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_vrm_mppt_save is not as expected'; end if;
  execute replace(d, anchor, $r$'/History/Daily/0/Yield','/History/Daily/0/MaxPower','/History/Daily/1/Yield','/History/Daily/1/MaxPower','/Yield/User',
    '/Load/State','/Load/I','/Mode','/DeviceOffReason'];$r$);
end $$;
