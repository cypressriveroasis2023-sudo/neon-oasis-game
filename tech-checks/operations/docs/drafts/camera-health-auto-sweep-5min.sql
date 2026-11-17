-- DRAFT. Do not apply, schedule, or run this statement.
-- Deploys only after the 3-miss readers and the sweep guards are live,
-- and only after James Martin says yes.
--
-- Same probe-ready set and the same 145 second cron timeout. The schedule
-- is the only change. The camera shard deadline in the sweep patch is 60
-- seconds, so two serial shard waves stay under that 145 second timeout.
-- The existing Star4Live cap is unchanged.

update cron.job
set schedule = '0,5,10,15,20,25,30,35,40,45,50,55 * * * *'
where jobname = 'camera-health-auto-sweep'
  and schedule = '0,15,30,45 * * * *'
  and active
  and command like '%/functions/v1/camera-health-sweep%'
  and command like '%timeout_milliseconds:=145000%';
