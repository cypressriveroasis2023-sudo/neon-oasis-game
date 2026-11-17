-- Overlap lock for camera-health-sweep. This pull request does not apply it.
-- The row is not a camera provider. enabled stays false. Re-running does
-- not reset a lock a sweep has already taken.

insert into public.camera_integrations (
  provider,
  server_host,
  enabled,
  last_sync_status,
  last_sync_at,
  metadata
)
values (
  'camera_sweep_lock',
  'lock.invalid',
  false,
  'idle',
  '1970-01-01T00:00:00Z',
  '{"purpose":"camera sweep overlap lock"}'::jsonb
)
on conflict (provider) do nothing;
