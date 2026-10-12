-- Phase 3: fresh process and transaction verify persisted audit and rollback.
SELECT public.test_assert((SELECT count(*)=1 AND bool_and(NOT processed AND processing_note='Reconeyez event queued for ordered projection.') FROM public.camera_integration_events WHERE camera_device_id=22),'separately committed audit survives failed top-level RPC');
SELECT public.test_assert((SELECT source_status IS NULL AND source_last_seen_at IS NULL FROM public.camera_devices WHERE id=22),'failed top-level RPC leaves device unchanged');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.camera_health_current WHERE camera_device_id=22) AND NOT EXISTS(SELECT 1 FROM public.camera_health_history WHERE camera_device_id=22),'failed top-level RPC leaves health and history unchanged');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.app_notifications WHERE unit_tag='Synthetic 22'),'failed top-level RPC leaves notifications unchanged');
DROP TRIGGER test_history_failure ON public.camera_health_history;
