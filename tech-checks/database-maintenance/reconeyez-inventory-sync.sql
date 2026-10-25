-- Source-only maintenance proposal. No credentials, schedules or live data are changed here.
-- Apply through a reviewed migration before deploying the matching inventory connector.
BEGIN;

CREATE OR REPLACE FUNCTION public.reconeyez_inventory_metadata_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  previous_metadata jsonb;
  incoming_metadata jsonb;
  inventory_key text;
  previous_attempt timestamptz;
  incoming_attempt timestamptz;
  incoming_proof_time timestamptz;
  publication boolean;
  accepted_publication boolean := false;
BEGIN
  IF OLD.provider <> 'reconeyez' OR NEW.provider <> 'reconeyez' THEN RETURN NEW; END IF;
  previous_metadata := CASE WHEN jsonb_typeof(OLD.metadata)='object' THEN OLD.metadata ELSE '{}'::jsonb END;
  incoming_metadata := CASE WHEN jsonb_typeof(NEW.metadata)='object' THEN NEW.metadata ELSE '{}'::jsonb END;
  -- The unchanged webhook sends a whole JSON snapshot. Keep keys it did not know about.
  NEW.metadata := previous_metadata || incoming_metadata;
  BEGIN
    previous_attempt := (previous_metadata->>'identity_inventory_attempted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN previous_attempt := NULL;
  END;
  BEGIN
    incoming_attempt := (incoming_metadata->>'identity_inventory_attempted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN incoming_attempt := NULL;
  END;
  BEGIN
    incoming_proof_time := (incoming_metadata->'identity_inventory_v1'->>'observedAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN incoming_proof_time := NULL;
  END;
  publication := NEW.last_sync_at IS DISTINCT FROM OLD.last_sync_at
    OR (NEW.last_sync_status IS NOT DISTINCT FROM 'ok' AND NEW.last_sync_status IS DISTINCT FROM OLD.last_sync_status);
  IF publication THEN
    -- The existing reconciler also publishes directly. It cannot commit an older
    -- success, resurrect a failed attempt or renew a proof with an unpaired time.
    accepted_publication := NEW.last_sync_at IS NOT NULL AND isfinite(NEW.last_sync_at)
      AND NEW.last_sync_at > '1970-01-01'::timestamptz
      AND (greatest(OLD.last_sync_at,previous_attempt) IS NULL
        OR NEW.last_sync_at > greatest(OLD.last_sync_at,previous_attempt))
      AND incoming_proof_time IS NOT NULL AND incoming_proof_time=NEW.last_sync_at
      AND incoming_metadata->'identity_inventory_v1'->'schemaVersion'='1'::jsonb
      AND incoming_metadata ?& ARRAY['identity_inventory_v1','last_inventory_count','last_detector_count']
      AND incoming_metadata->'last_inventory_count'=incoming_metadata->'identity_inventory_v1'->'resourceCount';
    IF accepted_publication IS NOT TRUE THEN
      NEW.enabled := OLD.enabled;
      NEW.last_sync_at := OLD.last_sync_at;
      NEW.last_sync_status := OLD.last_sync_status;
      NEW.last_error := OLD.last_error;
      NEW.metadata := NEW.metadata - 'identity_inventory_attempted_at';
      IF previous_metadata ? 'identity_inventory_attempted_at' THEN
        NEW.metadata := NEW.metadata || jsonb_build_object('identity_inventory_attempted_at',previous_metadata->'identity_inventory_attempted_at');
      END IF;
    ELSE
      NEW.metadata := NEW.metadata || jsonb_build_object('identity_inventory_attempted_at',NEW.last_sync_at);
    END IF;
  END IF;
  IF accepted_publication IS NOT TRUE THEN
    -- Only a paired publication that advances the complete attempt watermark may
    -- replace proof and counts. Metadata-only webhook writes preserve these keys.
    FOREACH inventory_key IN ARRAY ARRAY['identity_inventory_v1','last_inventory_count','last_detector_count'] LOOP
      NEW.metadata := NEW.metadata - inventory_key;
      IF previous_metadata ? inventory_key THEN
        NEW.metadata := NEW.metadata || jsonb_build_object(inventory_key,previous_metadata->inventory_key);
      END IF;
    END LOOP;
  END IF;
  -- A newer failed attempt advances this watermark without changing the proof timestamp.
  IF NOT publication AND previous_attempt IS NOT NULL AND isfinite(previous_attempt)
     AND (incoming_attempt IS NULL OR NOT isfinite(incoming_attempt) OR incoming_attempt < previous_attempt) THEN
    NEW.metadata := NEW.metadata || jsonb_build_object('identity_inventory_attempted_at',previous_metadata->'identity_inventory_attempted_at');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reconeyez_inventory_metadata_guard_v1 ON public.camera_integrations;
CREATE TRIGGER reconeyez_inventory_metadata_guard_v1
BEFORE UPDATE OF metadata,last_sync_at,last_sync_status ON public.camera_integrations
FOR EACH ROW EXECUTE FUNCTION public.reconeyez_inventory_metadata_guard_v1();

CREATE OR REPLACE FUNCTION public.sync_reconeyez_inventory_v1(
  p_devices jsonb,
  p_identity_inventory jsonb,
  p_observed_at timestamptz,
  p_inventory_count integer,
  p_skipped_non_detectors integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  integration public.camera_integrations%rowtype;
  device public.camera_devices%rowtype;
  item jsonb;
  item_guid text;
  item_serial text;
  proof_observed_at timestamptz;
  attempted_at timestamptz;
  watermark timestamptz;
  integration_metadata jsonb;
  published_inventory jsonb;
  group_item jsonb;
  previous_group jsonb;
  group_position integer;
  matching_group_count bigint;
  bridge_event_at timestamptz;
  detector_count integer;
  active_count integer;
  shop_count integer;
BEGIN
  -- The integration lock orders successes and failures before any camera mutation.
  SELECT * INTO integration FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconeyez integration is unavailable.'; END IF;
  IF p_observed_at IS NULL OR NOT isfinite(p_observed_at) OR p_observed_at <= '1970-01-01'::timestamptz THEN
    RAISE EXCEPTION 'Reconeyez inventory observation time is invalid.';
  END IF;
  integration_metadata := CASE WHEN jsonb_typeof(integration.metadata)='object' THEN integration.metadata ELSE '{}'::jsonb END;
  BEGIN
    attempted_at := (integration_metadata->>'identity_inventory_attempted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Reconeyez inventory attempt watermark is invalid.';
  END;
  watermark := greatest(integration.last_sync_at,attempted_at);
  IF attempted_at IS NOT NULL AND NOT isfinite(attempted_at) THEN
    RAISE EXCEPTION 'Reconeyez inventory attempt watermark is invalid.';
  END IF;
  IF p_observed_at <= watermark THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Reconeyez inventory refresh was superseded.';
  END IF;

  IF jsonb_typeof(p_devices) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_identity_inventory) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Reconeyez complete inventory proof is invalid.';
  END IF;
  detector_count := jsonb_array_length(p_devices);
  IF p_inventory_count IS NULL OR p_inventory_count < 1 OR p_inventory_count > 100000
     OR p_skipped_non_detectors IS NULL OR p_skipped_non_detectors < 0
     OR detector_count + p_skipped_non_detectors <> p_inventory_count
     OR p_identity_inventory->'schemaVersion' IS DISTINCT FROM '1'::jsonb
     OR p_identity_inventory->'resourceCount' IS DISTINCT FROM to_jsonb(p_inventory_count)
     OR (SELECT count(*) FROM jsonb_object_keys(p_identity_inventory)) <> 4
     OR NOT p_identity_inventory ?& ARRAY['schemaVersion','observedAt','resourceCount','groups']
     OR jsonb_typeof(p_identity_inventory->'observedAt') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_identity_inventory->'groups') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Reconeyez complete inventory proof is invalid.';
  END IF;
  BEGIN
    proof_observed_at := (p_identity_inventory->>'observedAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Reconeyez inventory proof timestamp is invalid.';
  END;
  IF proof_observed_at IS DISTINCT FROM p_observed_at THEN
    RAISE EXCEPTION 'Reconeyez inventory proof timestamp is inconsistent.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_identity_inventory->'groups') AS groups(value)
    WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(value->'areaKey') IS DISTINCT FROM 'string' OR value->>'areaKey' !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(value->'proof') IS DISTINCT FROM 'string' OR value->>'proof' !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(value->'bridgeKeys') IS DISTINCT FROM 'array'
      OR jsonb_typeof(value->'detectorKeys') IS DISTINCT FROM 'array'
      OR jsonb_typeof(value->'bridgePrefixUnique') IS DISTINCT FROM 'boolean'
      OR NOT (value ? 'bridgeLastEventAt')
      OR jsonb_typeof(value->'bridgeLastEventAt') NOT IN ('null','string')
  ) THEN RAISE EXCEPTION 'Reconeyez complete inventory groups are invalid.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_identity_inventory->'groups') AS groups(value)
    WHERE (SELECT count(*) FROM jsonb_object_keys(value)) <> 6
      OR NOT value ?& ARRAY['areaKey','proof','bridgeKeys','detectorKeys','bridgePrefixUnique','bridgeLastEventAt']
  ) THEN RAISE EXCEPTION 'Reconeyez complete inventory groups are invalid.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_identity_inventory->'groups') AS groups(value),
      LATERAL jsonb_array_elements((value->'bridgeKeys') || (value->'detectorKeys')) AS keys(value)
    WHERE jsonb_typeof(keys.value) IS DISTINCT FROM 'string' OR keys.value #>> '{}' !~ '^[a-f0-9]{64}$'
  ) OR (SELECT coalesce(sum(jsonb_array_length(value->'detectorKeys')),0)
        FROM jsonb_array_elements(p_identity_inventory->'groups') AS groups(value)) <> detector_count THEN
    RAISE EXCEPTION 'Reconeyez complete inventory resource keys are invalid.';
  END IF;

  published_inventory := p_identity_inventory;
  FOR group_item,group_position IN
    SELECT value,ordinality::integer FROM jsonb_array_elements(p_identity_inventory->'groups') WITH ORDINALITY
  LOOP
    IF group_item->'bridgeLastEventAt' <> 'null'::jsonb THEN
      IF group_item->>'bridgeLastEventAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION 'Reconeyez bridge event observation time is invalid.';
      END IF;
      BEGIN
        bridge_event_at := (group_item->>'bridgeLastEventAt')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Reconeyez bridge event observation time is invalid.';
      END;
      IF NOT isfinite(bridge_event_at) OR bridge_event_at <= '1970-01-01'::timestamptz OR bridge_event_at > p_observed_at THEN
        RAISE EXCEPTION 'Reconeyez bridge event observation time is invalid.';
      END IF;
    ELSIF integration_metadata->'identity_inventory_v1'->'schemaVersion'='1'::jsonb
      AND jsonb_typeof(integration_metadata->'identity_inventory_v1'->'groups')='array' THEN
      SELECT count(*),jsonb_agg(value)->0 INTO matching_group_count,previous_group
      FROM jsonb_array_elements(integration_metadata->'identity_inventory_v1'->'groups') AS previous(value)
      WHERE value->'areaKey'=group_item->'areaKey' AND value->'proof'=group_item->'proof'
        AND value->'bridgeKeys'=group_item->'bridgeKeys' AND value->'detectorKeys'=group_item->'detectorKeys';
      IF matching_group_count=1 AND jsonb_typeof(previous_group->'bridgeLastEventAt')='string'
        AND previous_group->>'bridgeLastEventAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        BEGIN
          bridge_event_at := (previous_group->>'bridgeLastEventAt')::timestamptz;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN bridge_event_at := NULL;
        END;
        IF bridge_event_at IS NOT NULL AND isfinite(bridge_event_at)
          AND bridge_event_at > '1970-01-01'::timestamptz AND bridge_event_at <= p_observed_at THEN
          -- Keep genuine context for this unchanged complete group at its original
          -- event time. Inventory receipt never becomes a bridge/camera health time.
          published_inventory := jsonb_set(published_inventory,
            ARRAY['groups',(group_position-1)::text,'bridgeLastEventAt'],previous_group->'bridgeLastEventAt');
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Validate every normalized detector before writes; the patch cannot contain health fields.
  FOR item IN SELECT value FROM jsonb_array_elements(p_devices) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Reconeyez inventory detector patch is invalid.';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item)) <> 8
       OR NOT item ?& ARRAY['external_device_id','device_name','device_model','organization','activation_state','activation_source','unit_key','source_metadata'] THEN
      RAISE EXCEPTION 'Reconeyez inventory detector patch is invalid.';
    END IF;
    IF jsonb_typeof(item->'external_device_id') IS DISTINCT FROM 'string' OR item->>'external_device_id' !~ '^[A-F0-9]{16}$'
       OR jsonb_typeof(item->'device_name') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'device_model') IS DISTINCT FROM 'string' OR item->>'device_model' NOT LIKE 'detector%'
       OR jsonb_typeof(item->'organization') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'activation_state') IS DISTINCT FROM 'string' OR item->>'activation_state' NOT IN ('active','deactivated')
       OR jsonb_typeof(item->'activation_source') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'unit_key') IS DISTINCT FROM 'string' OR length(item->>'unit_key')=0
       OR jsonb_typeof(item->'source_metadata') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Reconeyez inventory detector patch is invalid.';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item->'source_metadata')) <> 4
       OR NOT (item->'source_metadata') ?& ARRAY['guid','area','description','reconeyez_type']
       OR jsonb_typeof(item->'source_metadata'->'guid') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'source_metadata'->'area') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'source_metadata'->'reconeyez_type') IS DISTINCT FROM 'string'
       OR item->'source_metadata'->>'guid' IS DISTINCT FROM item->>'external_device_id'
       OR item->'source_metadata'->>'area' IS DISTINCT FROM item->>'unit_key'
       OR item->'source_metadata'->>'reconeyez_type' IS DISTINCT FROM item->>'device_model'
       OR jsonb_typeof(item->'source_metadata'->'description') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Reconeyez inventory metadata patch is invalid.';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'external_device_id') FROM jsonb_array_elements(p_devices)) <> detector_count THEN
    RAISE EXCEPTION 'Reconeyez inventory detector identities are duplicated.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_devices) ORDER BY value->>'external_device_id' LOOP
    item_guid := item->>'external_device_id';
    item_serial := 'reconeyez:' || item_guid;
    SELECT * INTO device FROM public.camera_devices WHERE device_serial=item_serial FOR UPDATE;
    IF FOUND AND (device.source <> 'reconeyez'
       OR (device.external_device_id IS NOT NULL AND device.external_device_id <> item_guid)) THEN
      RAISE EXCEPTION 'Reconeyez inventory identity conflicts with a saved resource.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.camera_devices WHERE external_device_id=item_guid AND device_serial<>item_serial) THEN
      RAISE EXCEPTION 'Reconeyez inventory identity conflicts with a saved resource.';
    END IF;
    IF device.id IS NULL THEN
      INSERT INTO public.camera_devices(device_serial,external_device_id,device_name,device_model,device_type,
        device_owner,organization,vigilant_status,source,source_imported_at,monitoring_enabled,tech_check_unit_type,
        monitoring_profile,expected_ports,port_labels,activation_state,activation_source,unit_key,source_metadata,updated_at)
      VALUES(item_serial,item_guid,item->>'device_name',item->>'device_model','Reconeyez detector','Cameras Onsite',
        item->>'organization','Unknown','reconeyez',p_observed_at,true,'Recon','reconeyez','{}'::integer[],'{}'::jsonb,
        item->>'activation_state',item->>'activation_source',item->>'unit_key',item->'source_metadata',clock_timestamp());
    ELSE
      UPDATE public.camera_devices SET external_device_id=item_guid,device_name=item->>'device_name',
        device_model=item->>'device_model',device_type='Reconeyez detector',device_owner='Cameras Onsite',
        organization=coalesce(device.organization,item->>'organization'),
        activation_state=coalesce(device.activation_state,item->>'activation_state'),
        activation_source=coalesce(device.activation_source,item->>'activation_source'),
        source_imported_at=p_observed_at,unit_key=item->>'unit_key',
        source_metadata=(CASE WHEN jsonb_typeof(source_metadata)='object' THEN source_metadata ELSE '{}'::jsonb END) || (item->'source_metadata'),
        updated_at=clock_timestamp()
      WHERE id=device.id;
      -- Monitoring settings, operator choices and all existing health times remain untouched.
    END IF;
  END LOOP;

  INSERT INTO public.camera_health_current(camera_device_id,overall_status,checked_at,detail)
  SELECT id,'unknown',NULL,'Waiting for Reconeyez cloud health event'
  FROM public.camera_devices WHERE source='reconeyez' ORDER BY id
  ON CONFLICT (camera_device_id) DO NOTHING;
  SELECT count(*) FILTER (WHERE activation_state <> 'deactivated'),count(*) FILTER (WHERE activation_state='deactivated')
  INTO active_count,shop_count FROM public.camera_devices WHERE source='reconeyez';

  UPDATE public.camera_integrations SET enabled=true,last_sync_at=p_observed_at,last_sync_status='ok',last_error=NULL,
    metadata=integration_metadata || jsonb_build_object('identity_inventory_v1',published_inventory,
      'identity_inventory_attempted_at',p_observed_at,'last_inventory_count',p_inventory_count,'last_detector_count',detector_count),
    updated_at=clock_timestamp()
  WHERE provider='reconeyez';
  RETURN jsonb_build_object('imported',detector_count,'active',active_count,'shop',shop_count,
    'skipped_non_detectors',p_skipped_non_detectors);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_reconeyez_inventory_sync_v1(p_observed_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  integration public.camera_integrations%rowtype;
  integration_metadata jsonb;
  attempted_at timestamptz;
BEGIN
  SELECT * INTO integration FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconeyez integration is unavailable.'; END IF;
  IF p_observed_at IS NULL OR NOT isfinite(p_observed_at) OR p_observed_at <= '1970-01-01'::timestamptz THEN
    RAISE EXCEPTION 'Reconeyez inventory observation time is invalid.';
  END IF;
  integration_metadata := CASE WHEN jsonb_typeof(integration.metadata)='object' THEN integration.metadata ELSE '{}'::jsonb END;
  BEGIN
    attempted_at := (integration_metadata->>'identity_inventory_attempted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Reconeyez inventory attempt watermark is invalid.';
  END;
  IF attempted_at IS NOT NULL AND NOT isfinite(attempted_at) THEN
    RAISE EXCEPTION 'Reconeyez inventory attempt watermark is invalid.';
  END IF;
  IF p_observed_at <= greatest(integration.last_sync_at,attempted_at) THEN
    RETURN jsonb_build_object('applied',false);
  END IF;
  UPDATE public.camera_integrations SET last_sync_status='error',
    last_error='Reconeyez inventory refresh failed; identity proof was not renewed.',
    metadata=integration_metadata || jsonb_build_object('identity_inventory_attempted_at',p_observed_at),updated_at=clock_timestamp()
  WHERE provider='reconeyez';
  RETURN jsonb_build_object('applied',true);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconeyez_inventory_metadata_guard_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_reconeyez_inventory_v1(jsonb,jsonb,timestamptz,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_reconeyez_inventory_sync_v1(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconeyez_inventory_metadata_guard_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_reconeyez_inventory_v1(jsonb,jsonb,timestamptz,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_reconeyez_inventory_sync_v1(timestamptz) TO service_role;
COMMIT;
