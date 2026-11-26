-- Step 2, only after cos-vrm-mppt-sync is deployed and one manual run has saved readings.
-- Seven minutes after each fleet sync (which runs at :00, :15, :30, :45), so the two never overlap.
select cron.schedule('cos-vrm-mppt-sync', '7,22,37,52 * * * *', 'select cos_vrm_private.enqueue_mppt_sync();');
