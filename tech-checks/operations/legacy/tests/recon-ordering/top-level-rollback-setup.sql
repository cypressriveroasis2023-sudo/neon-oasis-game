-- Phase 1: independent process/transaction commits only the audit row.
BEGIN;
SELECT public.test_event(22,'YC','2026-10-12T14:07:12Z','top-level-rollback');
COMMIT;
CREATE OR REPLACE FUNCTION public.test_history_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.camera_device_id=22 THEN RAISE EXCEPTION 'injected top-level history failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_history_failure BEFORE INSERT ON public.camera_health_history FOR EACH ROW EXECUTE FUNCTION public.test_history_failure();
