-- ORIGINAL CAMERA PROJECT ONLY. Apply after compatible workers and database
-- functions pass release gates. Keep the 20-minute publisher write boundary.
-- Schedule expressed in existing GMT/UTC cron timezone; Central minute offsets
-- are identical. No renewal or camera-provider job is modified.
begin;
do $$
begin
 if (select count(*) from cron.job where active and
   ((jobname='cos-mhelp-inventory-sync' and schedule='5,20,35,50 * * * *') or
    (jobname='cos-mhelp-placement-sync' and schedule='8,23,38,53 * * * *') or
    (jobname='cos-sheets-placement-publish' and schedule='10,25,40,55 * * * *')))<>3
 then raise exception 'Expected existing mHelp schedules changed';end if;
 perform cron.alter_job((select jobid from cron.job where jobname='cos-mhelp-inventory-sync'),schedule:='5,35 * * * *');
 perform cron.alter_job((select jobid from cron.job where jobname='cos-mhelp-placement-sync'),schedule:='8,38 * * * *');
 perform cron.alter_job((select jobid from cron.job where jobname='cos-sheets-placement-publish'),schedule:='10,40 * * * *');
end$$;
commit;
