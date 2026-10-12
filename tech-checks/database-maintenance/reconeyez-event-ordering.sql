-- Approved scoped maintenance SQL; apply only through a named Supabase migration.
-- The historical supabase/migrations directory and its CI immutability guard remain unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.cos_apply_recon_event_v1(
  p_event_id bigint,
  p_event_key text,
  p_metadata_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  e public.camera_integration_events%rowtype;
  d public.camera_devices%rowtype;
  h public.camera_health_current%rowtype;
  event_name text;
  next_health text;
  next_source text;
  previous_health text;
  watermark timestamptz;
  provider_guid text;
  next_metadata jsonb;
  metadata_patch jsonb;
  changed boolean;
  conflict_evidence jsonb;
BEGIN
  -- The audit row is committed separately, before this atomic projection call.
  SELECT * INTO e FROM public.camera_integration_events WHERE id=p_event_id;
  IF NOT FOUND OR e.provider <> 'reconeyez' OR e.camera_device_id IS NULL THEN
    RETURN jsonb_build_object('applied',false,'outcome','unmapped');
  END IF;

  -- All callers take the same camera lock before inspecting projection/dedupe state.
  SELECT * INTO d FROM public.camera_devices WHERE id=e.camera_device_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'outcome','unmapped'); END IF;
  SELECT * INTO e FROM public.camera_integration_events WHERE id=p_event_id FOR UPDATE;
  IF e.provider <> 'reconeyez' OR e.camera_device_id IS DISTINCT FROM d.id
     OR d.source <> 'reconeyez' OR e.external_device_id IS DISTINCT FROM d.external_device_id THEN
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:identity_changed' WHERE id=e.id;
    RETURN jsonb_build_object('applied',false,'outcome','identity_changed');
  END IF;
  IF e.processing_note IN ('recon_order_v1:applied','recon_order_v1:duplicate','recon_order_v1:older','recon_order_v1:equal_time','recon_order_v1:equal_time_conflict') THEN
    RETURN jsonb_build_object('applied',false,'outcome','already_handled');
  END IF;
  IF p_event_key IS NULL OR length(p_event_key)>600
     OR p_event_key IS DISTINCT FROM e.payload->'cos_event_order_v1'->>'key' THEN
    RAISE EXCEPTION 'Recon event ordering key is missing or inconsistent';
  END IF;

  SELECT * INTO h FROM public.camera_health_current WHERE camera_device_id=d.id FOR UPDATE;
  previous_health := lower(coalesce(h.overall_status,'unknown'));
  watermark := greatest(d.source_last_seen_at,h.checked_at);
  provider_guid := nullif(e.payload->>'event_guid','');

  -- Duplicate detection precedes equal-time conflict handling. Keep every delivery
  -- in the audit log; suppress repeated projection/history/notification effects.
  IF EXISTS (
    SELECT 1 FROM public.camera_integration_events prior
    WHERE prior.camera_device_id=d.id AND prior.provider='reconeyez' AND prior.id<>e.id
      AND prior.external_device_id IS NOT DISTINCT FROM e.external_device_id
      AND prior.observed_at IS NOT DISTINCT FROM e.observed_at
      AND prior.event_type IS NOT DISTINCT FROM e.event_type
      AND prior.event_code IS NOT DISTINCT FROM e.event_code
      AND (prior.payload->'cos_event_order_v1'->>'key'=p_event_key
        OR (provider_guid IS NOT NULL AND prior.payload->>'event_guid'=provider_guid))
      AND (prior.processing_note IN ('recon_order_v1:applied','recon_order_v1:duplicate','recon_order_v1:older','recon_order_v1:equal_time','recon_order_v1:equal_time_conflict')
        OR (prior.processed AND prior.processing_note='Reconeyez health event applied.'
          AND prior.observed_at<=watermark))
  ) THEN
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:duplicate' WHERE id=e.id;
    RETURN jsonb_build_object('applied',false,'outcome','duplicate','status',previous_health);
  END IF;
  IF e.observed_at IS NULL OR NOT isfinite(e.observed_at) OR e.observed_at>e.received_at THEN
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:unverified_timestamp' WHERE id=e.id;
    RETURN jsonb_build_object('applied',false,'outcome','unverified_timestamp');
  END IF;

  -- Preserve the deployed v23 event mappings in this ordering-only change.
  event_name := regexp_replace(lower(coalesce(nullif(e.event_type,''),e.event_code,'')),'[^a-z0-9]','','g');
  IF event_name=ANY(ARRAY['connectionlost','communicationfail','criticalbatteryshutdown','systemstopped','yc','yt','tz']) THEN
    next_health:='offline'; next_source:='offline';
  ELSIF event_name=ANY(ARRAY['batterylow','tamper','tamperalarm','xt','ta']) THEN
    next_health:='degraded'; next_source:='online';
  ELSIF event_name=ANY(ARRAY['deviceconnected','communicationrestore','batteryrestored','routinecheck','automatictest','systemstarted','persondetected','vehicledetected','movementdetected','armed','disarmed','closingreport','openingreport','yk','xr','rp','tw','ba','cl','op']) THEN
    next_health:='online'; next_source:='online';
  ELSE
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:unrecognized' WHERE id=e.id;
    RETURN jsonb_build_object('applied',false,'outcome','unrecognized');
  END IF;
  IF e.observed_at<watermark THEN
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:older' WHERE id=e.id;
    RETURN jsonb_build_object('applied',false,'outcome','older','status',previous_health);
  END IF;
  IF e.observed_at=watermark THEN
    IF next_health=previous_health AND next_source IS NOT DISTINCT FROM d.source_status
       AND NOT d.source_metadata ? 'recon_event_order_conflict' THEN
      UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:equal_time' WHERE id=e.id;
      RETURN jsonb_build_object('applied',false,'outcome','equal_time','status',previous_health);
    END IF;
    -- Different events at one provider timestamp have no verified order. Preserve
    -- the original event facts and unresolved failure evidence, but remove a
    -- falsely definitive current status. A strictly newer event resolves this.
    conflict_evidence := coalesce(d.source_metadata->'recon_event_order_conflict',jsonb_build_object(
      'observed_at',e.observed_at,'original_event_type',d.source_metadata->'last_event_type',
      'original_source_status',d.source_status,'original_health_status',previous_health,
      'original_confirmed_outage',coalesce(h.confirmed_outage,false)))||jsonb_build_object(
        'incoming_event_type',e.event_type,'incoming_source_status',next_source,'incoming_event_id',e.id);
    IF NOT conflict_evidence ? 'outage_report' AND (previous_health='offline' OR next_health='offline') THEN
      conflict_evidence := conflict_evidence||jsonb_build_object('outage_report',jsonb_build_object(
        'observed_at',e.observed_at,'event_type',CASE WHEN previous_health='offline' THEN d.source_metadata->>'last_event_type' ELSE e.event_type END,
        'event_id',CASE WHEN previous_health='offline' THEN d.source_metadata->'last_event_id' ELSE to_jsonb(e.id) END));
    END IF;
    UPDATE public.camera_devices SET source_status='unknown',
      source_metadata=source_metadata||jsonb_build_object('recon_event_order_conflict',conflict_evidence),
      updated_at=clock_timestamp()
    WHERE id=d.id;
    INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at,confirmed_outage,detail)
    VALUES(d.id,'unknown',watermark,false,'Reconeyez events conflict at the same observation time; original event reports are retained.')
    ON CONFLICT(camera_device_id) DO UPDATE SET overall_status='unknown',confirmed_outage=false,
      detail=excluded.detail;
    INSERT INTO public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
    VALUES(d.id,'unknown','reconeyez_webhook_conflict',e.observed_at,jsonb_build_object(
      'event_id',e.id,'event_key',p_event_key,'previous_status',previous_health,
      'incoming_status',next_health,'previous_confirmed_outage',coalesce(h.confirmed_outage,false),
      'event_type',e.event_type,'event_code',e.event_code));
    UPDATE public.camera_integration_events SET processed=false,processing_note='recon_order_v1:equal_time_conflict' WHERE id=e.id;
    RETURN jsonb_build_object('applied',true,'outcome','equal_time_conflict','health_changed',previous_health<>'unknown','status','unknown');
  END IF;

  IF p_metadata_patch IS NULL OR jsonb_typeof(p_metadata_patch)<>'object' THEN
    RAISE EXCEPTION 'Recon event metadata patch must be an object';
  END IF;
  SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO metadata_patch
  FROM jsonb_each(p_metadata_patch)
  WHERE key=ANY(ARRAY['battery_percent','battery_updated_at','battery_status','battery_status_updated_at',
    'signal_strength_dbm','signal_updated_at','reconeyez_device_name','reconeyez_area','cloud_url','cloud_url_updated_at']);
  next_metadata := (d.source_metadata-'recon_event_order_conflict')||metadata_patch||jsonb_build_object(
    'last_event_type',e.event_type,'last_event_code',e.event_code,'last_event_at',e.observed_at,
    'last_event_key',p_event_key,'last_event_id',e.id);
  changed := previous_health<>next_health;
  UPDATE public.camera_devices SET source_status=next_source,source_last_seen_at=e.observed_at,
    source_metadata=next_metadata,last_health_checked_at=e.observed_at,updated_at=clock_timestamp(),
    last_online_at=CASE WHEN next_source='online' THEN e.observed_at ELSE last_online_at END,
    last_online_source_text=CASE WHEN next_source='online' THEN 'Reconeyez cloud event' ELSE last_online_source_text END
    -- last_probe_online_at remains independent; the existing endpoint-proof
    -- guard already rejects the v23 webhook's unsupported writes to that field.
  WHERE id=d.id;
  INSERT INTO public.camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,
    checked_at,consecutive_failures,detail,first_failed_at,last_recovered_at,acknowledged_at,
    acknowledged_by,confirmed_outage,confirmation_reason)
  VALUES(d.id,next_health,NULL,'{}',e.observed_at,
    CASE WHEN next_health='offline' THEN greatest(1,coalesce(h.consecutive_failures,0)+1) ELSE 0 END,
    'Reconeyez cloud event: '||coalesce(nullif(e.event_type,''),e.event_code,'status update'),
    CASE WHEN next_health='offline' THEN coalesce(h.first_failed_at,e.observed_at) ELSE NULL END,
    CASE WHEN next_health<>'offline' AND (previous_health='offline' OR d.source_metadata->'recon_event_order_conflict' ? 'outage_report') THEN e.observed_at ELSE h.last_recovered_at END,
    CASE WHEN next_health='offline' THEN h.acknowledged_at ELSE NULL END,
    CASE WHEN next_health='offline' THEN h.acknowledged_by ELSE NULL END,
    next_health='offline',CASE WHEN next_health='offline' THEN 'Reconeyez reported a connection/power outage event' ELSE NULL END)
  ON CONFLICT(camera_device_id) DO UPDATE SET overall_status=excluded.overall_status,
    ip_reachable=excluded.ip_reachable,port_status=excluded.port_status,checked_at=excluded.checked_at,
    consecutive_failures=excluded.consecutive_failures,detail=excluded.detail,first_failed_at=excluded.first_failed_at,
    last_recovered_at=excluded.last_recovered_at,acknowledged_at=excluded.acknowledged_at,
    acknowledged_by=excluded.acknowledged_by,confirmed_outage=excluded.confirmed_outage,
    confirmation_reason=excluded.confirmation_reason;
  IF changed OR next_health<>'online' THEN
    INSERT INTO public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
    VALUES(d.id,next_health,'reconeyez_webhook',e.observed_at,jsonb_build_object(
      'previous_status',previous_health,'event_id',e.id,'event_key',p_event_key,
      'event_type',e.event_type,'event_code',e.event_code,'external_device_id',e.external_device_id,
      'battery_percent',metadata_patch->'battery_percent','battery_status',metadata_patch->'battery_status',
      'cloud_url',metadata_patch->'cloud_url'));
  END IF;
  UPDATE public.camera_integration_events SET processed=true,processing_note='recon_order_v1:applied' WHERE id=e.id;
  RETURN jsonb_build_object('applied',true,'outcome','applied','health_changed',changed,
    'camera_device_id',d.id,'status',next_health);
END;
$function$;
REVOKE ALL ON FUNCTION public.cos_apply_recon_event_v1(bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cos_apply_recon_event_v1(bigint,text,jsonb) TO service_role;
COMMIT;
