-- NATIVE project only, after mhelp-address-automation.sql and the dynamic-count
-- census map projection pass deployment checks. No secrets appear in this job.
begin;
select cron.schedule('cos-mhelp-address-automation','* * * * *',
 $job$set statement_timeout='25s'; set lock_timeout='1s'; select cos_mhelp_placement_private.address_automation_tick_v1();$job$);
commit;
