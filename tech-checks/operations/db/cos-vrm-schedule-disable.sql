-- Reversible operational rollback: stop discovery and retain every last-known installation.
-- Existing embeds and authenticated portal links continue to work.
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cos-vrm-fleet-discovery';
  end if;
end $$;
