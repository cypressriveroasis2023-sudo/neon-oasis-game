-- Phase 2: separate top-level RPC transaction fails after projection writes.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.test_apply(id) FROM public.camera_integration_events WHERE camera_device_id=22;
ROLLBACK;
