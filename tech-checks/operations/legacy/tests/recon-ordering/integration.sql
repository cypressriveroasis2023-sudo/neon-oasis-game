-- Synthetic fixtures only. These statements are for an isolated local test DB.
CREATE FUNCTION public.test_assert(condition boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE LOG 'PASS: %',label; END $$;
CREATE FUNCTION public.test_seed(device_id bigint) RETURNS void LANGUAGE sql AS $$
INSERT INTO public.camera_devices(id,device_serial,device_name,source,external_device_id,monitoring_profile,source_metadata,last_probe_online_at)
VALUES(device_id,'synthetic:'||device_id,'Synthetic '||device_id,'reconeyez','SYNTHETIC-'||device_id,'reconeyez','{"area":"Synthetic fixture"}','2026-10-01T00:00:00Z'); $$;
CREATE FUNCTION public.test_event(device_id bigint,kind text,at_time timestamptz,event_key text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE result bigint; BEGIN
INSERT INTO public.camera_integration_events(provider,camera_device_id,external_device_id,event_type,observed_at,received_at,payload,processing_note)
VALUES('reconeyez',device_id,'SYNTHETIC-'||device_id,kind,at_time,'2026-10-12T16:00:00Z',
jsonb_build_object('event_guid',event_key,'cos_event_order_v1',jsonb_build_object('key','guid:'||event_key)),
'Reconeyez event queued for ordered projection.') RETURNING id INTO result; RETURN result; END $$;
CREATE FUNCTION public.test_apply(event_id bigint,battery integer DEFAULT 80) RETURNS jsonb LANGUAGE sql AS $$
SELECT public.cos_apply_recon_event_v1(e.id,e.payload->'cos_event_order_v1'->>'key',jsonb_build_object('battery_percent',battery,'battery_updated_at',e.observed_at))
FROM public.camera_integration_events e WHERE e.id=event_id; $$;
INSERT INTO public.profiles VALUES('00000000-0000-0000-0000-000000000001',true,'owner');
SELECT public.test_seed(n) FROM generate_series(1,25) n;
SELECT public.test_assert(current_setting('server_version_num')='170006','PostgreSQL version matches live 17.6');
SELECT public.test_assert((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.cos_apply_recon_event_v1(bigint,text,jsonb)'::regprocedure),'RPC is SECURITY INVOKER');
SELECT public.test_assert(NOT has_function_privilege('anon','public.cos_apply_recon_event_v1(bigint,text,jsonb)','EXECUTE'),'anon has no execute');
SELECT public.test_assert(NOT has_function_privilege('authenticated','public.cos_apply_recon_event_v1(bigint,text,jsonb)','EXECUTE'),'authenticated has no execute');
SELECT public.test_assert(has_function_privilege('service_role','public.cos_apply_recon_event_v1(bigint,text,jsonb)','EXECUTE'),'service_role has execute');
DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.cos_apply_recon_event_v1(1,'guid:denied','{}'); RAISE EXCEPTION 'anon unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE; RAISE LOG 'PASS: actual anon RPC invocation denied';
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.cos_apply_recon_event_v1(1,'guid:denied','{}'); RAISE EXCEPTION 'authenticated unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE; RAISE LOG 'PASS: actual authenticated RPC invocation denied';
END $$;
SET ROLE service_role;
DO $$ DECLARE a bigint; b bigint; r jsonb; BEGIN
  a:=public.test_event(1,'BA','2026-10-12T14:07:12Z','regression-new');
  b:=public.test_event(1,'BA','2026-10-12T14:06:22Z','regression-old');
  r:=public.test_apply(a,98); PERFORM public.test_assert(r->>'outcome'='applied','first event applied under service_role with RLS');
  r:=public.test_apply(b,12); PERFORM public.test_assert(r->>'outcome'='older','actual 50-second backward ordering rejected');
  PERFORM public.test_assert((SELECT source_last_seen_at='2026-10-12T14:07:12Z' AND (source_metadata->>'battery_percent')::int=98 FROM public.camera_devices WHERE id=1),'older event cannot regress time or telemetry');
  PERFORM public.test_assert((SELECT last_probe_online_at='2026-10-01T00:00:00Z' AND last_online_at='2026-10-12T14:07:12Z' FROM public.camera_devices WHERE id=1),'cloud observation leaves independent direct-probe time unchanged');
  PERFORM public.test_assert((SELECT count(*)=2 FROM public.camera_integration_events WHERE camera_device_id=1),'both arrivals retained in audit');
  PERFORM public.test_assert((SELECT count(*)=1 FROM public.camera_health_history WHERE camera_device_id=1),'rejected old arrival creates no health history');
  PERFORM public.test_assert((SELECT observed_at='2026-10-12T14:07:12Z' FROM public.camera_health_history WHERE camera_device_id=1),'history uses provider observation time');
END $$;
DO $$ DECLARE a bigint; b bigint; BEGIN
 a:=public.test_event(2,'YC','2026-10-08T22:54:55Z','loss-new'); PERFORM public.test_apply(a);
 b:=public.test_event(2,'RP','2026-10-08T22:50:00Z','activity-old'); PERFORM public.test_apply(b);
 PERFORM public.test_assert((SELECT overall_status='offline' AND checked_at='2026-10-08T22:54:55Z' AND confirmed_outage FROM public.camera_health_current WHERE camera_device_id=2),'old activity cannot erase unresolved historical YC');
 PERFORM public.test_assert((SELECT count(*)=1 FROM public.app_notifications WHERE unit_tag='Synthetic 2'),'late activity emits no false recovery notification');
END $$;
DO $$ DECLARE a bigint; b bigint; BEGIN
 a:=public.test_event(3,'YK','2026-10-12T14:07:12Z','restore-new'); PERFORM public.test_apply(a);
 b:=public.test_event(3,'YC','2026-10-12T14:06:22Z','loss-old'); PERFORM public.test_apply(b);
 PERFORM public.test_assert((SELECT overall_status='online' AND consecutive_failures=0 FROM public.camera_health_current WHERE camera_device_id=3),'old loss cannot reopen newer restore');
 PERFORM public.test_assert((SELECT count(*)=0 FROM public.app_notifications WHERE unit_tag='Synthetic 3'),'old loss emits no false outage notification');
END $$;
DO $$ DECLARE a bigint; b bigint; r jsonb; BEGIN
 a:=public.test_event(4,'YC','2026-10-12T14:07:12Z','duplicate-loss'); PERFORM public.test_apply(a);
 b:=public.test_event(4,'YC','2026-10-12T14:07:12Z','duplicate-loss'); r:=public.test_apply(b);
 PERFORM public.test_assert(r->>'outcome'='duplicate','provider redelivery deduped before same-time conflict');
 r:=public.test_apply(a); PERFORM public.test_assert(r->>'outcome'='already_handled','retry of same audit-row projection is idempotent');
 PERFORM public.test_assert((SELECT consecutive_failures=1 FROM public.camera_health_current WHERE camera_device_id=4),'duplicate does not increment failures');
 PERFORM public.test_assert((SELECT count(*)=1 FROM public.camera_health_history WHERE camera_device_id=4),'duplicate does not duplicate history');
 PERFORM public.test_assert((SELECT count(*)=1 FROM public.app_notifications WHERE unit_tag='Synthetic 4'),'duplicate does not duplicate notifications');
END $$;
DO $$ DECLARE a bigint; b bigint; c bigint; newer bigint; r jsonb; BEGIN
 a:=public.test_event(5,'YC','2026-10-12T14:07:12Z','tie-loss'); PERFORM public.test_apply(a);
 b:=public.test_event(5,'YK','2026-10-12T14:07:12Z','tie-restore'); r:=public.test_apply(b);
 PERFORM public.test_assert(r->>'outcome'='equal_time_conflict' AND (r->>'applied')::boolean AND (r->>'health_changed')::boolean,'equal-time conflicting events explicitly invalidate certainty');
 c:=public.test_event(5,'RP','2026-10-12T14:07:12Z','tie-activity'); PERFORM public.test_apply(c);
 PERFORM public.test_assert((SELECT source_status='unknown' AND source_metadata#>>'{recon_event_order_conflict,original_source_status}'='offline' AND source_metadata#>>'{recon_event_order_conflict,original_confirmed_outage}'='true' AND source_metadata#>>'{recon_event_order_conflict,outage_report,event_type}'='YC' FROM public.camera_devices WHERE id=5),'third tied event preserves original unresolved outage evidence');
 PERFORM public.test_assert((SELECT overall_status='unknown' AND NOT confirmed_outage FROM public.camera_health_current WHERE camera_device_id=5),'conflicting current status does not claim confirmed present outage');
 newer:=public.test_event(5,'YK','2026-10-12T14:08:00Z','later-restore'); PERFORM public.test_apply(newer);
 PERFORM public.test_assert((SELECT source_status='online' AND NOT source_metadata ? 'recon_event_order_conflict' FROM public.camera_devices WHERE id=5),'strictly newer event clears current conflict');
 PERFORM public.test_assert((SELECT last_recovered_at='2026-10-12T14:08:00Z' FROM public.camera_health_current WHERE camera_device_id=5),'newer restore after ambiguous outage records recovery time');
 PERFORM public.test_assert((SELECT count(*)=1 FROM public.app_notifications WHERE unit_tag='Synthetic 5'),'existing trigger semantics retained: no unknown-state correction/recovery alert');
END $$;
DO $$ DECLARE a bigint; b bigint; r jsonb; BEGIN
 a:=public.test_event(6,'RP','2026-10-12T14:07:12Z','tie-a'); PERFORM public.test_apply(a,80);
 b:=public.test_event(6,'BA','2026-10-12T14:07:12Z','tie-b'); r:=public.test_apply(b,20);
 PERFORM public.test_assert(r->>'outcome'='equal_time','same-time compatible health report does not fabricate ordering');
 PERFORM public.test_assert((SELECT source_metadata->>'battery_percent'='80' FROM public.camera_devices WHERE id=6),'same-time telemetry ties retain first observation without overwrite');
END $$;
DO $$ DECLARE e bigint; r jsonb; BEGIN
 e:=public.test_event(7,'RP',NULL,'missing-time'); r:=public.test_apply(e);
 PERFORM public.test_assert(r->>'outcome'='unverified_timestamp' AND NOT EXISTS(SELECT 1 FROM public.camera_health_current WHERE camera_device_id=7),'missing provider time cannot become receipt-time health');
 e:=public.test_event(8,'RP','2027-01-01T00:00:00Z','future-time'); r:=public.test_apply(e);
 PERFORM public.test_assert(r->>'outcome'='unverified_timestamp','future timestamp cannot poison ordering watermark');
END $$;
DO $$ DECLARE e bigint; r jsonb; BEGIN
 UPDATE public.camera_devices SET source_last_seen_at='2026-10-12T14:06:22Z' WHERE id=9;
 INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at) VALUES(9,'online','2026-10-12T14:07:12Z');
 e:=public.test_event(9,'RP','2026-10-12T14:06:50Z','between-watermarks'); r:=public.test_apply(e);
 PERFORM public.test_assert(r->>'outcome'='older','bootstrap watermark uses newer existing health timestamp');
 e:=public.test_event(10,'RP','2026-10-12T14:07:12Z','changed-identity');
 UPDATE public.camera_devices SET external_device_id='REASSIGNED' WHERE id=10;
 r:=public.test_apply(e); PERFORM public.test_assert(r->>'outcome'='identity_changed','mapping change between archival and projection is rejected');
END $$;
RESET ROLE;
CREATE FUNCTION public.test_history_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.camera_device_id=21 THEN RAISE EXCEPTION 'injected history failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_history_failure BEFORE INSERT ON public.camera_health_history FOR EACH ROW EXECUTE FUNCTION public.test_history_failure();
SET ROLE service_role;
DO $$ DECLARE e bigint; BEGIN
 e:=public.test_event(21,'YC','2026-10-12T14:07:12Z','rollback-test');
 BEGIN PERFORM public.test_apply(e); RAISE EXCEPTION 'expected injected failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'injected history failure' THEN RAISE; END IF; END;
 PERFORM public.test_assert((SELECT source_last_seen_at IS NULL AND source_status IS NULL FROM public.camera_devices WHERE id=21),'history failure rolls back device projection');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.camera_health_current WHERE camera_device_id=21),'history failure rolls back health projection');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM public.app_notifications WHERE unit_tag='Synthetic 21'),'history failure rolls back triggered notifications');
 PERFORM public.test_assert((SELECT NOT processed AND processing_note='Reconeyez event queued for ordered projection.' FROM public.camera_integration_events WHERE id=e),'history failure retains pending audit row without false dedupe marker');
END $$;
RESET ROLE;
DROP TRIGGER test_history_failure ON public.camera_health_history;
SET ROLE service_role;
SELECT public.test_assert((SELECT public.test_apply(id)->>'outcome'='applied' FROM public.camera_integration_events WHERE camera_device_id=21),'failed projection can safely retry after transient fault');
RESET ROLE;
SELECT public.test_assert((SELECT count(*)=4 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('camera_devices','camera_health_current','camera_health_history','camera_integration_events') AND c.relrowsecurity),'all original table RLS remains enabled');

SET ROLE service_role;
DO $$ DECLARE a bigint; b bigint; r jsonb; BEGIN
 a:=public.test_event(23,'RP','2026-10-12T14:07:12Z','retry-clock-skew');
 UPDATE public.camera_integration_events SET received_at='2026-10-12T14:06:00Z' WHERE id=a;
 r:=public.test_apply(a); PERFORM public.test_assert(r->>'outcome'='unverified_timestamp','first ahead-of-receipt delivery is quarantined');
 b:=public.test_event(23,'RP','2026-10-12T14:07:12Z','retry-clock-skew');
 r:=public.test_apply(b); PERFORM public.test_assert(r->>'outcome'='applied','new later redelivery can apply a previously unverified timestamp');
 a:=public.test_event(24,'RP','2026-10-12T14:07:12Z','legacy-unapplied');
 UPDATE public.camera_integration_events SET processed=true,processing_note='Reconeyez health event applied.',payload=payload-'cos_event_order_v1' WHERE id=a;
 b:=public.test_event(24,'RP','2026-10-12T14:07:12Z','legacy-unapplied');
 r:=public.test_apply(b); PERFORM public.test_assert(r->>'outcome'='applied','legacy eager processed flag cannot suppress a missing projection');
END $$;
RESET ROLE;
