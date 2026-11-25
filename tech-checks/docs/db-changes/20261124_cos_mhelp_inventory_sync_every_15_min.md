# mHelp inventory read every 15 minutes (Tech Check cron)

Changed on 2026-11-24 at about 10:30 CST, at the owner's request ("COS needs to do a staggered check to make sure it gets what it needs").

- Job `cos-mhelp-inventory-sync` in Tech Check (`goqrnolcvqnirjmzaeyk`) `cron.job`: schedule `5,35 * * * *` → `5,20,35,50 * * * *`.
- It calls `cos-mhelp-inventory-sync` in Operations. The command was not changed.
- Why: a failed read (9:36 that morning) had waited 30 minutes for the next try. In the 24 hours before the change, 45 of 48 reads succeeded and the reader showed no rate-limit backoff.
- Minute slots: :05/:35 were this job's own. :20/:50 also coincide with `service-daily-delivery-v1` (`*/5`), which already shared :05/:35 with this job.

## Rollback

```sql
select cron.alter_job(job_id := (select jobid from cron.job where jobname='cos-mhelp-inventory-sync'), schedule := '5,35 * * * *');
```
