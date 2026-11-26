-- Stops future MPPT reads. Saved readings and the fleet sync are untouched.
select cron.unschedule('cos-vrm-mppt-sync');
