-- SOURCE-ONLY coordinated v2 proposal. Do not apply independently of the
-- reviewed common attempt contract and matching webhook/connector consumers.
-- No data backfill, role creation, table grants, SECURITY DEFINER authority,
-- credential access, schedule, deployment or live migration is performed here.
-- Apply AFTER reconeyez-owned-metadata-v2.sql in an authorized review fixture.
-- PROPOSED NARROW CONTRACT AMENDMENT: ordinary receipt finalization locks the
-- integration, then the requested retained audit row. This is NOT compliance
-- with the previous integration-only lock contract. Acceptance and real-lock
-- certification remain separate gates. Receiver ACK locking is unchanged.
BEGIN;

ALTER TABLE public.camera_integration_events
  ADD COLUMN IF NOT EXISTS recon_receipt_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS recon_receipt_kind text,
  ADD COLUMN IF NOT EXISTS recon_receiver_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS recon_receipt_metadata_applied boolean;

-- NULL is unmarked; only the ordinary receipt finalizer can first set TRUE.
-- This is one fixed-size fact on the already-retained audit, not a metadata
-- history, another delivery row, a clock, or the 600-second attempt ledger.
-- No audit purge policy exists in the checked source. Proof lasts only for the
-- retained audit row; missing evidence fails closed and is never reconstructed.

-- Historical rows intentionally retain NULL evidence. New Recon deliveries
-- fail closed after the coordinated caller cutover; there is no time backfill.
CREATE OR REPLACE FUNCTION public.recon_v2_audit_evidence_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  label text;
  correlation jsonb;
  stack text;
  archive_ref jsonb;
  compact boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Prevent ordinary DELETE/reinsert from clearing an applied event identity.
    -- A future authorized retention policy requires its own coordinated review.
    IF OLD.provider = 'reconeyez' AND OLD.recon_receipt_metadata_applied IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence is immutable.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    GET DIAGNOSTICS stack = PG_CONTEXT;
    IF NEW.recon_receipt_metadata_applied IS DISTINCT FROM OLD.recon_receipt_metadata_applied THEN
      IF OLD.recon_receipt_metadata_applied IS NOT NULL
         OR NEW.recon_receipt_metadata_applied IS DISTINCT FROM TRUE
         OR OLD.provider <> 'reconeyez' OR OLD.recon_receipt_kind IS DISTINCT FROM 'ordinary'
         OR current_setting('cos.recon_owned_writer_v2', true) IS DISTINCT FROM 'receipt'
         OR stack !~ E'(?m)^PL/pgSQL function (public\\.)?recon_record_webhook_receipt_v2\\('
         OR (to_jsonb(NEW) - 'recon_receipt_metadata_applied') IS DISTINCT FROM
            (to_jsonb(OLD) - 'recon_receipt_metadata_applied') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence is immutable.';
      END IF;
    END IF;
    IF OLD.provider = 'reconeyez' OR NEW.provider = 'reconeyez' THEN
      IF (NEW.id, NEW.provider, NEW.external_device_id, NEW.event_type, NEW.event_code,
          NEW.observed_at, NEW.received_at,
          NEW.recon_receipt_started_at, NEW.recon_receipt_kind,
          NEW.recon_receiver_attempt_id)
         IS DISTINCT FROM
         (OLD.id, OLD.provider, OLD.external_device_id, OLD.event_type, OLD.event_code,
          OLD.observed_at, OLD.received_at,
          OLD.recon_receipt_started_at, OLD.recon_receipt_kind,
          OLD.recon_receiver_attempt_id) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit evidence is immutable.';
      END IF;
      IF NEW.payload IS DISTINCT FROM OLD.payload THEN
        -- Preserve the exact existing binary compactor's writer path. Its own
        -- function verifies the private object/size and compares the original
        -- payload. Here only that fixed frame and binary -> archive-reference
        -- delta are allowed; all other provider evidence/dedupe keys are equal.
        archive_ref := NEW.payload->'cos_private_archive';
        compact := stack ~ E'(?m)^PL/pgSQL function (public\\.)?cos_archive_camera_event_v1\\('
          AND jsonb_typeof(OLD.payload) = 'object'
          AND jsonb_typeof(OLD.payload->'binary') = 'array'
          AND NOT (OLD.payload ? 'cos_private_archive') AND NOT (NEW.payload ? 'binary')
          AND jsonb_typeof(archive_ref) = 'object'
          AND archive_ref->'version' = '1'::jsonb
          AND archive_ref->>'bucket' = 'camera-event-archives'
          AND archive_ref->>'sha256' ~ '^[a-f0-9]{64}$'
          AND archive_ref->>'path' = 'reconeyez/'||(archive_ref->>'sha256')||'.json.gz'
          AND archive_ref->'archivedFields' = '["binary"]'::jsonb
          AND coalesce(archive_ref->>'jsonBytes', '') ~ '^[1-9][0-9]{0,7}$'
          AND coalesce(archive_ref->>'storedBytes', '') ~ '^[1-9][0-9]{0,7}$'
          AND (NEW.payload - 'cos_private_archive') IS NOT DISTINCT FROM (OLD.payload - 'binary');
        IF compact IS NOT TRUE THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit evidence is immutable.';
        END IF;
        IF (archive_ref->>'jsonBytes')::bigint > 8388608 OR (archive_ref->>'storedBytes')::bigint > 8388608 THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit evidence is immutable.';
        END IF;
      END IF;
    END IF;
    -- The ordered projector may still update processed/processing_note. Keep
    -- existing camera_device_id foreign-key SET NULL behavior unchanged.
    RETURN NEW;
  END IF;

  IF NEW.recon_receipt_metadata_applied IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence cannot be inserted.';
  END IF;
  IF NEW.provider <> 'reconeyez' THEN
    IF NEW.recon_receipt_started_at IS NOT NULL OR NEW.recon_receipt_kind IS NOT NULL
       OR NEW.recon_receiver_attempt_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit evidence has the wrong provider.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.recon_receipt_started_at IS NULL OR NEW.recon_receipt_kind IS NULL
     OR NEW.recon_receipt_kind NOT IN ('ordinary', 'receiver_test') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit receipt evidence is required.';
  END IF;
  label := regexp_replace(lower(coalesce(nullif(NEW.event_type, ''), NEW.event_code, '')), '[^a-z0-9]', '', 'g');
  IF (NEW.recon_receipt_kind = 'receiver_test') IS DISTINCT FROM (label = 'integrationtest') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon audit receipt classification is invalid.';
  END IF;
  IF NEW.recon_receipt_kind = 'ordinary' AND NEW.recon_receiver_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ordinary Recon receipts cannot complete receiver tests.';
  END IF;
  IF NEW.recon_receiver_attempt_id IS NOT NULL THEN
    correlation := NEW.payload->'cos_receiver_test_v2';
    IF jsonb_typeof(correlation) IS DISTINCT FROM 'object'
       OR correlation IS DISTINCT FROM jsonb_build_object('schema_version', 2, 'attempt_id', NEW.recon_receiver_attempt_id::text)
       OR coalesce(nullif(NEW.event_type, ''), NEW.event_code, '') <> 'IntegrationTest' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receiver correlation is invalid.';
    END IF;
  END IF;
  -- Clock anomalies are retained as audit evidence. Metadata finalizers reject
  -- them, while the eligible ordered health path remains independent.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS recon_v2_audit_evidence_guard ON public.camera_integration_events;
CREATE TRIGGER recon_v2_audit_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.camera_integration_events
FOR EACH ROW EXECUTE FUNCTION public.recon_v2_audit_evidence_guard();

CREATE OR REPLACE FUNCTION public.recon_record_webhook_receipt_v2(p_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  audit public.camera_integration_events%rowtype;
  integration public.camera_integrations%rowtype;
  metadata jsonb;
  previous jsonb;
  previous_time timestamptz;
  previous_id bigint;
  entry_time text;
  prior_writer text;
  receipt_patch jsonb;
  stored_metadata jsonb;
  applied_marker boolean;
BEGIN
  IF p_event_id IS NULL OR p_event_id < 1 OR p_event_id > 9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt event identity is invalid.';
  END IF;
  -- Proposed amendment: integration -> requested audit, never the reverse.
  -- Read the audit freshly under integration serialization, not before waiting.
  -- Do not lock a device/health row or the projector's other audit deliveries.
  SELECT * INTO integration FROM public.camera_integrations WHERE provider = 'reconeyez' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon integration is unavailable.';
  END IF;
  SELECT * INTO audit FROM public.camera_integration_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR audit.provider <> 'reconeyez' OR audit.recon_receipt_kind IS DISTINCT FROM 'ordinary'
     OR audit.recon_receiver_attempt_id IS NOT NULL
     OR audit.recon_receipt_started_at IS NULL OR NOT isfinite(audit.recon_receipt_started_at)
     OR audit.recon_receipt_started_at <= '1970-01-01'::timestamptz
     OR NOT isfinite(audit.received_at)
     OR audit.recon_receipt_started_at > audit.received_at
     OR audit.received_at - audit.recon_receipt_started_at > interval '120 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt audit evidence is invalid.';
  END IF;
  entry_time := public.recon_v2_time(audit.recon_receipt_started_at);
  -- Durable retained-audit evidence takes precedence over the latest tuple:
  -- A applied -> B applied -> retry A is duplicate, never a renewed receipt.
  IF audit.recon_receipt_metadata_applied IS TRUE THEN
    RETURN jsonb_build_object('schema_version', 2, 'event_id', p_event_id,
      'receipt_started_at', entry_time, 'outcome', 'duplicate', 'applied', false);
  ELSIF audit.recon_receipt_metadata_applied IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence is invalid.';
  END IF;
  metadata := integration.metadata;
  -- Never-applied older deliveries remain superseded. No metadata ID registry
  -- or receipt-time backfill is created. An unmarked current tuple is an
  -- inconsistent pre-amendment state, not proof to silently mark or replay.
  previous := metadata->'recon_receipt_state_v2';
  IF previous IS NOT NULL THEN
    IF jsonb_typeof(previous) IS DISTINCT FROM 'object'
       OR previous->'schema_version' IS DISTINCT FROM '2'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(previous)) <> 3
       OR jsonb_typeof(previous->'event_id') IS DISTINCT FROM 'number'
       OR (previous->>'event_id') !~ '^[1-9][0-9]*$'
       OR (previous->>'event_id')::numeric > 9007199254740991
       OR jsonb_typeof(previous->'receipt_started_at') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt ordering state is invalid.';
    END IF;
    BEGIN
      previous_time := (previous->>'receipt_started_at')::timestamptz;
      previous_id := (previous->>'event_id')::bigint;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt ordering state is invalid.';
    END;
    IF NOT isfinite(previous_time) OR previous_time <= '1970-01-01'::timestamptz THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt ordering state is invalid.';
    END IF;
    IF previous_id = p_event_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence is missing.';
    END IF;
    IF (audit.recon_receipt_started_at, p_event_id) < (previous_time, previous_id) THEN
      RETURN jsonb_build_object('schema_version', 2, 'event_id', p_event_id,
        'receipt_started_at', entry_time, 'outcome', 'superseded', 'applied', false);
    END IF;
  END IF;

  prior_writer := current_setting('cos.recon_owned_writer_v2', true);
  PERFORM set_config('cos.recon_owned_writer_v2', 'receipt', true);
  receipt_patch := jsonb_build_object(
    'last_webhook_received_at', entry_time,
    'last_webhook_event_type', coalesce(nullif(audit.event_type, ''), nullif(audit.event_code, ''), 'unrecognized'),
    'recon_receipt_state_v2', jsonb_build_object('schema_version', 2, 'event_id', p_event_id, 'receipt_started_at', entry_time)
  );
  UPDATE public.camera_integrations AS ci SET metadata = ci.metadata || receipt_patch,
    updated_at = clock_timestamp() WHERE id = integration.id RETURNING ci.metadata INTO stored_metadata;
  IF NOT FOUND OR stored_metadata IS DISTINCT FROM (integration.metadata || receipt_patch) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt metadata was not applied.';
  END IF;
  -- Both writes are one atomic RPC transaction; any trigger/statement failure
  -- or silently suppressed write rolls back both. No timestamp is minted here.
  UPDATE public.camera_integration_events SET recon_receipt_metadata_applied = TRUE
    WHERE id = audit.id RETURNING recon_receipt_metadata_applied INTO applied_marker;
  IF NOT FOUND OR applied_marker IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence was not recorded.';
  END IF;
  -- RETURNING precedes any separate UPDATE performed by an AFTER trigger.
  -- Read both already-locked rows freshly after both writes, without taking
  -- another lock or trusting a pre-trigger returned value as committed proof.
  SELECT ci.metadata INTO stored_metadata FROM public.camera_integrations AS ci WHERE ci.id = integration.id;
  IF NOT FOUND OR stored_metadata IS DISTINCT FROM (integration.metadata || receipt_patch) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt metadata was not applied.';
  END IF;
  SELECT e.recon_receipt_metadata_applied INTO applied_marker FROM public.camera_integration_events AS e WHERE e.id = audit.id;
  IF NOT FOUND OR applied_marker IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receipt application evidence was not recorded.';
  END IF;
  PERFORM set_config('cos.recon_owned_writer_v2', coalesce(prior_writer, ''), true);
  RETURN jsonb_build_object('schema_version', 2, 'event_id', p_event_id,
    'receipt_started_at', entry_time, 'outcome', 'applied', 'applied', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recon_finish_receiver_ack_v2(p_attempt_id uuid, p_event_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  audit public.camera_integration_events%rowtype;
  integration public.camera_integrations%rowtype;
  state jsonb;
  attempt jsonb;
  terminal jsonb;
  logical_body jsonb;
  input_fingerprint text;
  tested_at text;
  record_index integer;
  ordinal bigint;
  completed bigint;
  is_current boolean;
  prior_writer text;
BEGIN
  IF p_attempt_id IS NULL OR p_event_id IS NULL OR p_event_id < 1 OR p_event_id > 9007199254740991 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receiver acknowledgement identity is invalid.';
  END IF;
  -- No FOR UPDATE here: the event projector uses device -> audit -> health,
  -- while inventory uses integration -> device -> health. Only integration is
  -- locked by this finalizer; audit processing flags are never touched.
  SELECT * INTO audit FROM public.camera_integration_events WHERE id = p_event_id;
  IF NOT FOUND OR audit.provider <> 'reconeyez'
     OR audit.recon_receipt_kind IS DISTINCT FROM 'receiver_test'
     OR audit.recon_receiver_attempt_id IS DISTINCT FROM p_attempt_id
     OR coalesce(nullif(audit.event_type, ''), audit.event_code, '') <> 'IntegrationTest'
     OR audit.recon_receipt_started_at IS NULL OR NOT isfinite(audit.recon_receipt_started_at)
     OR audit.recon_receipt_started_at <= '1970-01-01'::timestamptz
     OR NOT isfinite(audit.received_at)
     OR audit.recon_receipt_started_at > audit.received_at
     OR audit.received_at - audit.recon_receipt_started_at > interval '120 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receiver acknowledgement evidence is invalid.';
  END IF;
  SELECT * INTO integration FROM public.camera_integrations WHERE provider = 'reconeyez' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
  END IF;
  state := public.recon_v2_state(integration.metadata);
  SELECT value, (ordinality - 1)::integer INTO attempt, record_index
    FROM jsonb_array_elements(state->'records') WITH ORDINALITY
    WHERE value->>'attempt_id' = p_attempt_id::text;
  IF NOT FOUND OR attempt->>'kind' <> 'receiver_test' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
  END IF;
  logical_body := jsonb_build_object(
    'eventType', 'IntegrationTest', 'deviceGuid', '__camera_health_receiver_test__',
    'timestamp', attempt->>'observed_at', 'source', 'Camera Health self-test',
    'cos_receiver_test_v2', jsonb_build_object('schema_version', 2, 'attempt_id', p_attempt_id::text)
  );
  -- The wrapper is service-owned and holds the original health dedupe key.
  -- No other body extension can turn a noncanonical test into an Owner ack.
  IF audit.payload - 'cos_event_order_v1' IS DISTINCT FROM logical_body THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
  END IF;
  input_fingerprint := public.recon_v2_digest(jsonb_build_object('attempt_id', p_attempt_id::text, 'body', logical_body));
  ordinal := (attempt->>'ordinal')::bigint;
  completed := (state->>'receiver_completed_ordinal')::bigint;
  terminal := attempt->'terminal';
  IF terminal IS NULL OR jsonb_typeof(terminal) NOT IN ('null', 'object') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Recon receiver attempt state is invalid.';
  END IF;
  IF terminal IS DISTINCT FROM 'null'::jsonb THEN
    IF terminal->>'outcome' IS DISTINCT FROM 'success' OR terminal->>'input_fingerprint' IS DISTINCT FROM input_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
    END IF;
    is_current := ordinal = completed
      AND (terminal->>'config_revision_after')::bigint = integration.recon_config_revision;
    RETURN public.recon_v2_finish_response(attempt, 'duplicate', is_current);
  END IF;

  IF clock_timestamp() > (attempt->>'expires_at')::timestamptz
     OR audit.recon_receipt_started_at < (attempt->>'observed_at')::timestamptz
     OR audit.recon_receipt_started_at > (attempt->>'expires_at')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
  END IF;
  IF NOT public.recon_v2_config_matches(attempt, to_jsonb(integration)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Reconeyez receiver test was superseded.';
  END IF;
  IF ordinal <= completed THEN
    RETURN jsonb_build_object('schema_version', 2, 'attempt_id', p_attempt_id,
      'kind', attempt->>'kind', 'ordinal', ordinal, 'observed_at', attempt->>'observed_at',
      'outcome', 'superseded', 'applied', false, 'terminal_outcome', NULL, 'current', false,
      'input_fingerprint', NULL, 'reason_code', 'superseded', 'result', NULL);
  END IF;

  tested_at := public.recon_v2_time(audit.recon_receipt_started_at);
  terminal := jsonb_build_object('outcome', 'success', 'committed_at', public.recon_v2_time(clock_timestamp()),
    'config_revision_after', integration.recon_config_revision, 'input_fingerprint', input_fingerprint,
    'reason_code', NULL, 'result', jsonb_build_object('receiver_ready', true,
      'ack_event_id', p_event_id, 'receiver_tested_at', tested_at));
  attempt := jsonb_set(attempt, '{terminal}', terminal);
  state := jsonb_set(state, ARRAY['records', record_index::text], attempt);
  state := jsonb_set(state, '{receiver_completed_ordinal}', to_jsonb(ordinal));
  PERFORM public.recon_v2_check_state(state);
  prior_writer := current_setting('cos.recon_owned_writer_v2', true);
  PERFORM set_config('cos.recon_owned_writer_v2', 'receiver', true);
  UPDATE public.camera_integrations AS ci SET metadata = ci.metadata || jsonb_build_object(
    'recon_attempt_state_v2', state, 'receiver_tested_at', tested_at,
    'receiver_test_status', 'ok', 'receiver_test_error', NULL,
    'receiver_test_attempted_at', attempt->>'observed_at', 'receiver_test_attempt_id', p_attempt_id::text,
    'receiver_test_attempt_ordinal', ordinal
  ), updated_at = clock_timestamp() WHERE id = integration.id;
  PERFORM set_config('cos.recon_owned_writer_v2', coalesce(prior_writer, ''), true);
  RETURN public.recon_v2_finish_response(attempt, 'applied', true);
END;
$function$;

-- Exact exposure proposal only. No table-access expansion and no new roles.
-- Existing function owners/default privileges must be captured before any
-- separately authorized installation. SECURITY INVOKER is explicit above.
REVOKE ALL ON FUNCTION public.recon_v2_audit_evidence_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recon_v2_audit_evidence_guard() FROM service_role;
REVOKE ALL ON FUNCTION public.recon_record_webhook_receipt_v2(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recon_finish_receiver_ack_v2(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recon_record_webhook_receipt_v2(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.recon_finish_receiver_ack_v2(uuid, bigint) TO service_role;

-- Fail closed on default/owner/inherited effective privilege discrepancies.
-- No owner, membership, arbitrary grantee or credential authority is repaired.
-- Owners and superusers retain their existing administrative authority.
DO $acl_preflight$
DECLARE
  service_oid oid;
  trigger_oid oid := 'public.recon_v2_audit_evidence_guard()'::regprocedure::oid;
  reviewed_oids oid[];
BEGIN
  SELECT oid INTO service_oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role';
  reviewed_oids := ARRAY[
    'public.recon_v2_audit_evidence_guard()'::regprocedure::oid,
    'public.recon_record_webhook_receipt_v2(bigint)'::regprocedure::oid,
    'public.recon_finish_receiver_ack_v2(uuid,bigint)'::regprocedure::oid
  ];
  IF service_oid IS NULL OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
    WHERE p.oid = ANY (reviewed_oids)
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee <> p.proowner
      AND (p.oid = trigger_oid OR a.grantee <> service_oid OR a.is_grantable)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    WHERE p.oid = ANY (reviewed_oids)
      AND (p.prosecdef
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(service_oid, p.oid, 'EXECUTE') <> (p.oid <> trigger_oid)
        OR (p.proowner <> service_oid AND pg_catalog.has_function_privilege(service_oid, p.oid, 'EXECUTE WITH GRANT OPTION')))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p CROSS JOIN pg_catalog.pg_roles AS role
    WHERE p.oid = ANY (reviewed_oids) AND NOT role.rolsuper
      AND role.oid <> p.proowner
      AND (p.oid = trigger_oid OR role.oid <> service_oid)
      AND pg_catalog.has_function_privilege(role.oid, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Unexpected Recon v2 receipt function execute privileges.';
  END IF;
END;
$acl_preflight$;

COMMIT;
