-- LOCAL SOURCE PROPOSAL ONLY. Apply neither this file nor its proposed ACLs to a live project.
-- Requires reconeyez-inventory-sync.sql. No historical migration is modified.
BEGIN;

ALTER TABLE public.camera_integrations ADD COLUMN IF NOT EXISTS recon_config_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recon_v2_time(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_timestamp(p_time text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
DECLARE result timestamptz;
BEGIN
 IF p_time !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+]00:00)$' THEN RAISE EXCEPTION 'Invalid Recon UTC timestamp.'; END IF;
 BEGIN result:=p_time::timestamptz; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid Recon UTC timestamp.'; END;
 IF NOT isfinite(result) OR result<='1970-01-01'::timestamptz THEN RAISE EXCEPTION 'Invalid Recon UTC timestamp.'; END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_validate_diagnostics(p_diagnostics jsonb,p_observed_at text,p_inventory_count integer,p_detector_count integer) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE key text; family text; f jsonb; label jsonb;
BEGIN
 IF NOT public.recon_v2_keys(p_diagnostics,ARRAY['matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','tracker_coverage','reconciled_at'])
 OR p_diagnostics->>'reconciled_at' IS DISTINCT FROM p_observed_at
 OR jsonb_typeof(p_diagnostics->'tracker_coverage') IS DISTINCT FROM 'object'
 OR octet_length(convert_to(public.recon_v2_canonical(p_diagnostics),'UTF8'))>524288 THEN RAISE EXCEPTION 'Invalid Recon diagnostics.'; END IF;
 FOREACH key IN ARRAY ARRAY['matched_local_detectors','unmatched_provider_detectors','local_active','local_shop'] LOOP
  IF NOT public.recon_v2_integer(p_diagnostics->key,100000) THEN RAISE EXCEPTION 'Invalid Recon diagnostic count.'; END IF;
 END LOOP;
 IF (p_diagnostics->>'matched_local_detectors')::integer+(p_diagnostics->>'unmatched_provider_detectors')::integer<>p_detector_count
 OR (p_diagnostics->>'matched_local_detectors')::integer>(p_diagnostics->>'local_active')::integer+(p_diagnostics->>'local_shop')::integer
 OR (p_diagnostics->>'local_active')::integer+(p_diagnostics->>'local_shop')::integer>100000 THEN RAISE EXCEPTION 'Inconsistent Recon diagnostic counts.'; END IF;
 FOR family,f IN SELECT * FROM jsonb_each(p_diagnostics->'tracker_coverage') LOOP
  IF family NOT IN ('Recon','Recon 2') OR NOT public.recon_v2_keys(f,ARRAY['tracker_total','field_or_unknown','shop','retired','matched_local_units','missing_local_units','missing_field_units','local_unit_namespace','namespace_inventory_present'])
  OR f->>'local_unit_namespace' IS DISTINCT FROM (CASE WHEN family='Recon' THEN 'RI' ELSE 'RII' END)
  OR jsonb_typeof(f->'namespace_inventory_present') IS DISTINCT FROM 'boolean' OR jsonb_typeof(f->'missing_field_units') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid Recon diagnostic family.'; END IF;
  FOREACH key IN ARRAY ARRAY['tracker_total','field_or_unknown','shop','retired','matched_local_units','missing_local_units'] LOOP
   IF NOT public.recon_v2_integer(f->key,100000) THEN RAISE EXCEPTION 'Invalid Recon diagnostic count.'; END IF;
  END LOOP;
  IF (f->>'tracker_total')::integer<>(f->>'field_or_unknown')::integer+(f->>'shop')::integer+(f->>'retired')::integer
  OR (f->>'tracker_total')::integer<>(f->>'matched_local_units')::integer+(f->>'missing_local_units')::integer
  OR jsonb_array_length(f->'missing_field_units')>1000
  OR jsonb_array_length(f->'missing_field_units')>(f->>'field_or_unknown')::integer
  OR jsonb_array_length(f->'missing_field_units')<greatest(0,(f->>'missing_local_units')::integer-(f->>'shop')::integer-(f->>'retired')::integer)
  OR jsonb_array_length(f->'missing_field_units')>(f->>'missing_local_units')::integer THEN RAISE EXCEPTION 'Inconsistent Recon tracker diagnostics.'; END IF;
  FOR label IN SELECT value FROM jsonb_array_elements(f->'missing_field_units') LOOP
   IF jsonb_typeof(label) IS DISTINCT FROM 'string' OR length(label#>>'{}')=0 OR (label#>>'{}')~'[[:cntrl:]]'
   OR octet_length(convert_to(label#>>'{}','UTF8'))>128 THEN RAISE EXCEPTION 'Invalid Recon tracker label.'; END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_keys(p_value jsonb,p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN
  (SELECT count(*) FROM jsonb_object_keys(p_value))=cardinality(p_keys) AND p_value ?& p_keys ELSE false END
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_check_result(p_kind text,p_result jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE key text;
BEGIN
 IF p_kind IN ('inventory_connect','inventory_sync') THEN
  IF NOT public.recon_v2_keys(p_result,ARRAY['imported','active','shop','skipped_non_detectors']) THEN RAISE EXCEPTION 'Invalid Recon result.'; END IF;
  FOREACH key IN ARRAY ARRAY['imported','active','shop','skipped_non_detectors'] LOOP IF NOT public.recon_v2_integer(p_result->key,100000) THEN RAISE EXCEPTION 'Invalid Recon result count.'; END IF; END LOOP;
 ELSIF p_kind='inventory_reconcile' THEN
  IF NOT public.recon_v2_keys(p_result,ARRAY['inventory_total','detectors','matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','diagnostics_sha256']) THEN RAISE EXCEPTION 'Invalid Recon result.'; END IF;
  FOREACH key IN ARRAY ARRAY['inventory_total','detectors','matched_local_detectors','unmatched_provider_detectors','local_active','local_shop'] LOOP IF NOT public.recon_v2_integer(p_result->key,100000) THEN RAISE EXCEPTION 'Invalid Recon result count.'; END IF; END LOOP;
  IF jsonb_typeof(p_result->'diagnostics_sha256') IS DISTINCT FROM 'string' OR p_result->>'diagnostics_sha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid Recon diagnostics digest.'; END IF;
 ELSIF p_kind='receiver_test' THEN
  IF NOT public.recon_v2_keys(p_result,ARRAY['receiver_ready','ack_event_id','receiver_tested_at']) OR p_result->'receiver_ready' IS DISTINCT FROM 'true'::jsonb
  OR NOT public.recon_v2_integer(p_result->'ack_event_id') OR (p_result->>'ack_event_id')::numeric<1 OR jsonb_typeof(p_result->'receiver_tested_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid Recon receiver result.'; END IF;
  PERFORM public.recon_v2_timestamp(p_result->>'receiver_tested_at');
 ELSE RAISE EXCEPTION 'Invalid Recon result kind.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_integer(p_value jsonb,p_max numeric DEFAULT 9007199254740991) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 n:=(p_value#>>'{}')::numeric; RETURN n>=0 AND n<=p_max AND n=trunc(n);
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_canonical(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
DECLARE result text; n numeric;
BEGIN
 CASE jsonb_typeof(p_value)
 WHEN 'object' THEN
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) AS keys(key) WHERE octet_length(convert_to(key,'UTF8'))<>length(key)) THEN RAISE EXCEPTION 'Invalid Recon canonical object key.'; END IF;
  SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.recon_v2_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(p_value);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(public.recon_v2_canonical(value),',' ORDER BY ordinality),'')||']' INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY;
 WHEN 'number' THEN n:=(p_value#>>'{}')::numeric; IF n<>trunc(n) OR abs(n)>9007199254740991 THEN RAISE EXCEPTION 'Invalid Recon canonical integer.'; END IF; result:=n::bigint::text;
 ELSE result:=p_value::text;
 END CASE;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_digest(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT encode(sha256(convert_to(public.recon_v2_canonical(p_value),'UTF8')),'hex')
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_safe_error(p_reason text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 CASE p_reason
 WHEN 'provider_unavailable' THEN RETURN 'Reconeyez inventory provider is unavailable.';
 WHEN 'provider_rejected' THEN RETURN 'Reconeyez rejected the inventory request.';
 WHEN 'partial_inventory' THEN RETURN 'Reconeyez returned an incomplete inventory.';
 WHEN 'invalid_inventory' THEN RETURN 'Reconeyez complete inventory is invalid.';
 WHEN 'source_read_failed' THEN RETURN 'Reconeyez inventory sources could not be read.';
 WHEN 'save_failed' THEN RETURN 'Reconeyez inventory could not be saved.';
 WHEN 'receiver_timeout' THEN RETURN 'Reconeyez receiver test did not complete.';
 WHEN 'receiver_rejected' THEN RETURN 'Reconeyez receiver rejected the test.';
 WHEN 'internal_error' THEN RETURN 'Reconeyez operation could not be completed.';
 ELSE RAISE EXCEPTION 'Invalid Recon failure reason.';
 END CASE;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_config(p_integration jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('enabled',p_integration->'enabled','server_host',p_integration->'server_host','server_port',p_integration->'server_port',
 'username_secret_id',p_integration->'username_secret_id','password_secret_id',p_integration->'password_secret_id','webhook_secret_id',p_integration->'webhook_secret_id')
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_config_matches(p_record jsonb,p_integration jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT p_record->'expected_config_revision'=p_integration->'recon_config_revision'
 AND p_record->'expected_config'=public.recon_v2_config(p_integration)
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_reserve_terminal(p_record jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE q jsonb; t jsonb;
BEGIN
 IF p_record->>'kind' IN ('inventory_connect','inventory_sync') THEN q:=jsonb_build_object('imported',100000,'active',100000,'shop',100000,'skipped_non_detectors',100000);
 ELSIF p_record->>'kind'='inventory_reconcile' THEN q:=jsonb_build_object('inventory_total',100000,'detectors',100000,'matched_local_detectors',100000,'unmatched_provider_detectors',100000,'local_active',100000,'local_shop',100000,'diagnostics_sha256',repeat('f',64));
 ELSE q:=jsonb_build_object('receiver_ready',true,'ack_event_id',9007199254740991::bigint,'receiver_tested_at','2099-12-31T23:59:59.999999+00:00'); END IF;
 t:=jsonb_build_object('outcome','success','committed_at','2099-12-31T23:59:59.999999Z','config_revision_after',9007199254740991::bigint,'input_fingerprint',repeat('f',64),'reason_code',NULL,'result',q);
 IF octet_length(convert_to(public.recon_v2_canonical(jsonb_set(p_record,'{terminal}',t)),'UTF8'))>4096 THEN RAISE EXCEPTION 'Recon attempt terminal capacity exceeded.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_check_state(p_state jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r jsonb; c jsonb; t jsonb; k text; total_inventory integer:=0; total_receiver integer:=0;
BEGIN
 IF NOT public.recon_v2_keys(p_state,ARRAY['schema_version','next_ordinal','inventory_completed_ordinal','receiver_completed_ordinal','records'])
 OR p_state->'schema_version' IS DISTINCT FROM '2'::jsonb OR jsonb_typeof(p_state->'records') IS DISTINCT FROM 'array'
 OR NOT public.recon_v2_integer(p_state->'next_ordinal') OR (p_state->>'next_ordinal')::numeric<1
 OR NOT public.recon_v2_integer(p_state->'inventory_completed_ordinal') OR NOT public.recon_v2_integer(p_state->'receiver_completed_ordinal') THEN RAISE EXCEPTION 'Invalid Recon attempt state.'; END IF;
 IF (p_state->>'inventory_completed_ordinal')::numeric>=(p_state->>'next_ordinal')::numeric OR (p_state->>'receiver_completed_ordinal')::numeric>=(p_state->>'next_ordinal')::numeric THEN RAISE EXCEPTION 'Invalid Recon ordinal watermark.'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_state->'records') LOOP
  IF NOT public.recon_v2_keys(r,ARRAY['schema_version','request_id','attempt_id','kind','ordinal','observed_at','expires_at','retain_until','expected_config_revision','expected_config','terminal'])
  OR r->'schema_version' IS DISTINCT FROM '2'::jsonb OR jsonb_typeof(r->'request_id') IS DISTINCT FROM 'string' OR r->>'request_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR jsonb_typeof(r->'attempt_id') IS DISTINCT FROM 'string' OR r->>'attempt_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR r->>'kind' NOT IN ('inventory_connect','inventory_sync','inventory_reconcile','receiver_test')
  OR NOT public.recon_v2_integer(r->'ordinal') OR (r->>'ordinal')::numeric<1
  OR NOT public.recon_v2_integer(r->'expected_config_revision')
  OR jsonb_typeof(r->'kind') IS DISTINCT FROM 'string'
  OR jsonb_typeof(r->'observed_at') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'expires_at') IS DISTINCT FROM 'string'
  OR jsonb_typeof(r->'retain_until') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid Recon attempt record.'; END IF;
  k:=r->>'kind';
  IF (r->>'ordinal')::numeric>=(p_state->>'next_ordinal')::numeric THEN RAISE EXCEPTION 'Invalid Recon attempt ordinal.'; END IF;
  IF public.recon_v2_timestamp(r->>'expires_at')<>public.recon_v2_timestamp(r->>'observed_at')+(CASE WHEN k='receiver_test' THEN interval '60 seconds' ELSE interval '120 seconds' END)
  OR public.recon_v2_timestamp(r->>'retain_until')<>public.recon_v2_timestamp(r->>'observed_at')+interval '600 seconds' THEN RAISE EXCEPTION 'Invalid Recon attempt window.'; END IF;
  c:=r->'expected_config';
  IF NOT public.recon_v2_keys(c,ARRAY['enabled','server_host','server_port','username_secret_id','password_secret_id','webhook_secret_id'])
  OR jsonb_typeof(c->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'server_host') IS DISTINCT FROM 'string'
  OR NOT (c->'server_port'='null'::jsonb OR public.recon_v2_integer(c->'server_port',2147483647)) THEN RAISE EXCEPTION 'Invalid Recon expected configuration.'; END IF;
  FOREACH k IN ARRAY ARRAY['username_secret_id','password_secret_id','webhook_secret_id'] LOOP
   IF c->k<>'null'::jsonb AND (jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR c->>k !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'Invalid Recon configuration reference.'; END IF;
  END LOOP;
  t:=r->'terminal';
  IF t<>'null'::jsonb THEN
   IF NOT public.recon_v2_keys(t,ARRAY['outcome','committed_at','config_revision_after','input_fingerprint','reason_code','result'])
   OR t->>'outcome' NOT IN ('success','failure') OR NOT public.recon_v2_integer(t->'config_revision_after')
   OR jsonb_typeof(t->'input_fingerprint') IS DISTINCT FROM 'string' OR t->>'input_fingerprint' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid Recon terminal receipt.'; END IF;
   IF jsonb_typeof(t->'committed_at') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'outcome') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid Recon terminal receipt.'; END IF;
   PERFORM public.recon_v2_timestamp(t->>'committed_at');
   IF t->>'outcome'='failure' THEN PERFORM public.recon_v2_safe_error(t->>'reason_code'); IF t->'result'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid Recon failure result.'; END IF;
   ELSIF t->'reason_code'<>'null'::jsonb OR jsonb_typeof(t->'result') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid Recon success result.';
   ELSE PERFORM public.recon_v2_check_result(r->>'kind',t->'result'); END IF;
  END IF;
  IF octet_length(convert_to(public.recon_v2_canonical(r),'UTF8'))>4096 THEN RAISE EXCEPTION 'Recon attempt record capacity exceeded.'; END IF;
  IF r->>'kind'='receiver_test' THEN total_receiver:=total_receiver+1; ELSE total_inventory:=total_inventory+1; END IF;
 END LOOP;
 IF total_inventory>128 OR total_receiver>32 OR octet_length(convert_to(public.recon_v2_canonical(p_state),'UTF8'))>1048576 THEN RAISE EXCEPTION 'Recon attempt capacity exceeded.'; END IF;
 IF (SELECT count(DISTINCT value->>'attempt_id') FROM jsonb_array_elements(p_state->'records'))<>total_inventory+total_receiver
 OR (SELECT count(DISTINCT value->>'request_id') FROM jsonb_array_elements(p_state->'records'))<>total_inventory+total_receiver
 OR (SELECT count(DISTINCT value->>'ordinal') FROM jsonb_array_elements(p_state->'records'))<>total_inventory+total_receiver THEN RAISE EXCEPTION 'Duplicate Recon attempt identity.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_state(p_metadata jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 IF jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid Recon integration metadata.'; END IF;
 s:=coalesce(p_metadata->'recon_attempt_state_v2',jsonb_build_object('schema_version',2,'next_ordinal',1,'inventory_completed_ordinal',0,'receiver_completed_ordinal',0,'records','[]'::jsonb));
 PERFORM public.recon_v2_check_state(s); RETURN s;
END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_current(p_record jsonb,p_state jsonb,p_revision bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT p_record->'terminal'<>'null'::jsonb AND p_record->'ordinal'=p_state->CASE WHEN p_record->>'kind'='receiver_test' THEN 'receiver_completed_ordinal' ELSE 'inventory_completed_ordinal' END
 AND (p_record->'terminal'->>'config_revision_after')::numeric=p_revision
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_finish_response(p_record jsonb,p_outcome text,p_current boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('schema_version',2,'attempt_id',p_record->'attempt_id','kind',p_record->'kind','ordinal',p_record->'ordinal','observed_at',p_record->'observed_at',
 'outcome',p_outcome,'applied',p_outcome='applied','terminal_outcome',p_record->'terminal'->'outcome','current',p_current,
 'input_fingerprint',p_record->'terminal'->'input_fingerprint','reason_code',p_record->'terminal'->'reason_code','result',p_record->'terminal'->'result')
$$;
CREATE OR REPLACE FUNCTION public.recon_v2_superseded(p_record jsonb,p_reason text) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('schema_version',2,'attempt_id',p_record->'attempt_id','kind',p_record->'kind','ordinal',p_record->'ordinal','observed_at',p_record->'observed_at',
 'outcome','superseded','applied',false,'terminal_outcome',NULL,'current',false,'input_fingerprint',NULL,'reason_code',p_reason,'result',NULL)
$$;

CREATE OR REPLACE FUNCTION public.recon_owned_integration_guard_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE writer text:=current_setting('cos.recon_owned_writer_v2',true); key text; allowed boolean; changed_config boolean; stack text;
 old_state jsonb; new_state jsonb; old_record jsonb; new_record jsonb;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.provider='reconeyez' THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF; RETURN OLD; END IF;
 IF NEW.provider<>'reconeyez' AND (TG_OP='INSERT' OR OLD.provider<>'reconeyez') THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.metadata) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid Recon integration metadata.'; END IF;
 -- A context label alone grants nothing. These fixed server-rendered operation
 -- frames are an ownership guard inside the existing trusted SQL service role;
 -- they are not a new privilege boundary against that role's direct SQL/DDL.
 GET DIAGNOSTICS stack=PG_CONTEXT;
 IF coalesce(writer,'')<>'' AND (CASE writer
  WHEN 'internal' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?recon_begin_attempt_v2\\('
  WHEN 'create' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?recon_create_inventory_v2\\('
  WHEN 'inventory' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?(recon_finish_inventory_v2|recon_create_inventory_v2|recon_fail_attempt_v2)\\('
  WHEN 'reconcile' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?recon_finish_reconcile_v2\\('
  WHEN 'receiver' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?(recon_finish_receiver_ack_v2|recon_fail_attempt_v2)\\('
  WHEN 'receipt' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?recon_record_webhook_receipt_v2\\('
  WHEN 'credential' THEN stack !~ E'(?m)^PL/pgSQL function (public\\.)?save_reconeyez_credentials\\('
  ELSE true END) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 IF TG_OP='INSERT' THEN
  IF writer IS DISTINCT FROM 'create' THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
  NEW.recon_config_revision:=0; RETURN NEW;
 END IF;
 IF NEW.provider IS DISTINCT FROM OLD.provider THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 FOREACH key IN ARRAY ARRAY['identity_inventory_v1','identity_inventory_attempted_at','last_inventory_count','last_detector_count',
 'matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','tracker_coverage','reconciled_at',
 'receiver_tested_at','receiver_test_status','receiver_test_error','receiver_test_attempted_at','receiver_test_attempt_id','receiver_test_attempt_ordinal',
 'last_webhook_received_at','last_webhook_event_type','recon_attempt_state_v2','recon_receipt_state_v2'] LOOP
  IF NEW.metadata->key IS NOT DISTINCT FROM OLD.metadata->key THEN CONTINUE; END IF;
  allowed:=CASE
   WHEN key='recon_attempt_state_v2' THEN writer IN ('internal','inventory','reconcile','receiver')
   WHEN key='recon_receipt_state_v2' OR key IN ('last_webhook_received_at','last_webhook_event_type') THEN writer='receipt'
   WHEN key LIKE 'receiver_%' THEN writer='receiver'
   WHEN key IN ('matched_local_detectors','unmatched_provider_detectors','local_active','local_shop','tracker_coverage','reconciled_at') THEN writer='reconcile'
   ELSE writer IN ('inventory','reconcile') END;
  IF allowed IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 END LOOP;
 IF ROW(NEW.last_sync_at,NEW.last_sync_status,NEW.last_error) IS DISTINCT FROM ROW(OLD.last_sync_at,OLD.last_sync_status,OLD.last_error)
 AND coalesce(writer,'') NOT IN ('inventory','reconcile') THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 IF NEW.metadata->'recon_attempt_state_v2' IS DISTINCT FROM OLD.metadata->'recon_attempt_state_v2' THEN
  old_state:=public.recon_v2_state(OLD.metadata); new_state:=public.recon_v2_state(NEW.metadata);
  IF (new_state->>'next_ordinal')::bigint<(old_state->>'next_ordinal')::bigint
  OR (new_state->>'inventory_completed_ordinal')::bigint<(old_state->>'inventory_completed_ordinal')::bigint
  OR (new_state->>'receiver_completed_ordinal')::bigint<(old_state->>'receiver_completed_ordinal')::bigint THEN RAISE EXCEPTION 'Recon attempt ordering cannot regress.'; END IF;
  FOR old_record IN SELECT value FROM jsonb_array_elements(old_state->'records') LOOP
   SELECT value INTO new_record FROM jsonb_array_elements(new_state->'records') WHERE value->'attempt_id'=old_record->'attempt_id';
   IF new_record IS NULL THEN
    IF public.recon_v2_timestamp(old_record->>'retain_until')>clock_timestamp() THEN RAISE EXCEPTION 'Unexpired Recon attempt cannot be removed.'; END IF;
   ELSIF (new_record-'terminal') IS DISTINCT FROM (old_record-'terminal')
    OR (old_record->'terminal'<>'null'::jsonb AND new_record IS DISTINCT FROM old_record) THEN RAISE EXCEPTION 'Recon attempt identity and terminal evidence are immutable.'; END IF;
  END LOOP;
 END IF;
 IF (NEW.metadata->'identity_inventory_v1' IS DISTINCT FROM OLD.metadata->'identity_inventory_v1'
  OR NEW.last_sync_at IS DISTINCT FROM OLD.last_sync_at) THEN
  IF NEW.last_sync_status IS DISTINCT FROM 'ok' OR public.recon_v2_timestamp(NEW.metadata->'identity_inventory_v1'->>'observedAt') IS DISTINCT FROM NEW.last_sync_at
  OR NEW.metadata->'identity_inventory_v1'->'resourceCount' IS DISTINCT FROM NEW.metadata->'last_inventory_count' THEN RAISE EXCEPTION 'Recon inventory proof and publication are inconsistent.'; END IF;
 END IF;
 changed_config:=ROW(NEW.enabled,NEW.server_host,NEW.server_port,NEW.username_secret_id,NEW.password_secret_id,NEW.webhook_secret_id)
 IS DISTINCT FROM ROW(OLD.enabled,OLD.server_host,OLD.server_port,OLD.username_secret_id,OLD.password_secret_id,OLD.webhook_secret_id);
 NEW.recon_config_revision:=OLD.recon_config_revision+CASE WHEN changed_config OR writer='credential' THEN 1 ELSE 0 END;
 IF NEW.recon_config_revision>9007199254740991 THEN RAISE EXCEPTION 'Recon configuration revision exhausted.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reconeyez_inventory_metadata_guard_v1 ON public.camera_integrations;
DROP TRIGGER IF EXISTS recon_owned_integration_guard_v2 ON public.camera_integrations;
CREATE TRIGGER recon_owned_integration_guard_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.camera_integrations FOR EACH ROW EXECUTE FUNCTION public.recon_owned_integration_guard_v2();

CREATE OR REPLACE FUNCTION public.recon_begin_attempt_v2(p_request_id uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; t timestamptz:=clock_timestamp(); observed text; duration interval; prior text:=current_setting('cos.recon_owned_writer_v2',true);
BEGIN
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('inventory_connect','inventory_sync','inventory_reconcile','receiver_test') THEN RAISE EXCEPTION 'Invalid Recon begin request.'; END IF;
 duration:=CASE WHEN p_kind='receiver_test' THEN interval '60 seconds' ELSE interval '120 seconds' END;
 observed:=public.recon_v2_time(t);
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
 IF NOT FOUND THEN
  IF p_kind<>'inventory_connect' THEN RAISE EXCEPTION 'Reconeyez integration is unavailable.'; END IF;
  RETURN jsonb_build_object('schema_version',2,'outcome','absent','request_id',p_request_id,'kind',p_kind,'attempt_id',NULL,'ordinal',NULL,'observed_at',observed,
  'expires_at',public.recon_v2_time(t+duration),'retain_until',public.recon_v2_time(t+interval '600 seconds'),'expected_config_revision',NULL);
 END IF;
 s:=public.recon_v2_state(i.metadata);
 SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'request_id'=p_request_id::text;
 IF r IS NOT NULL THEN
  IF r->>'kind'<>p_kind THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
  RETURN jsonb_build_object('schema_version',2,'outcome','duplicate','request_id',r->'request_id','kind',r->'kind','attempt_id',r->'attempt_id','ordinal',r->'ordinal',
   'observed_at',r->'observed_at','expires_at',r->'expires_at','retain_until',r->'retain_until','expected_config_revision',r->'expected_config_revision');
 END IF;
 IF clock_timestamp()>=t+duration THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 s:=jsonb_set(s,'{records}',coalesce((SELECT jsonb_agg(value ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(s->'records') WHERE public.recon_v2_timestamp(value->>'retain_until')>t),'[]'::jsonb));
 IF (SELECT count(*) FROM jsonb_array_elements(s->'records') WHERE (value->>'kind'='receiver_test')=(p_kind='receiver_test'))>=(CASE WHEN p_kind='receiver_test' THEN 32 ELSE 128 END)
 OR (s->>'next_ordinal')::numeric>=9007199254740991 THEN RAISE EXCEPTION 'Recon attempt capacity exceeded.'; END IF;
 r:=jsonb_build_object('schema_version',2,'request_id',p_request_id,'attempt_id',gen_random_uuid(),'kind',p_kind,'ordinal',s->'next_ordinal','observed_at',observed,
  'expires_at',public.recon_v2_time(t+duration),'retain_until',public.recon_v2_time(t+interval '600 seconds'),'expected_config_revision',i.recon_config_revision,
  'expected_config',public.recon_v2_config(to_jsonb(i)),'terminal',NULL);
 PERFORM public.recon_v2_reserve_terminal(r);
 s:=jsonb_set(jsonb_set(s,'{records}',(s->'records')||jsonb_build_array(r)),'{next_ordinal}',to_jsonb((s->>'next_ordinal')::bigint+1));
 PERFORM public.recon_v2_check_state(s);
 PERFORM set_config('cos.recon_owned_writer_v2','internal',true);
 UPDATE public.camera_integrations SET metadata=metadata||jsonb_build_object('recon_attempt_state_v2',s) WHERE id=i.id;
 PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
 RETURN jsonb_build_object('schema_version',2,'outcome','begun','request_id',r->'request_id','kind',r->'kind','attempt_id',r->'attempt_id','ordinal',r->'ordinal',
  'observed_at',r->'observed_at','expires_at',r->'expires_at','retain_until',r->'retain_until','expected_config_revision',r->'expected_config_revision');
END $$;
CREATE OR REPLACE FUNCTION public.recon_attempt_result_v2(p_attempt_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; state text; terminal jsonb; is_current boolean:=false;
BEGIN
 IF p_attempt_id IS NULL THEN RAISE EXCEPTION 'Invalid Recon attempt identity.'; END IF;
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez';
 IF FOUND THEN s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'attempt_id'=p_attempt_id::text; END IF;
 IF r IS NULL THEN RETURN jsonb_build_object('schema_version',2,'attempt_id',p_attempt_id,'kind',NULL,'ordinal',NULL,'observed_at',NULL,'state','unknown','current',false,'terminal',NULL); END IF;
 IF r->'terminal'<>'null'::jsonb THEN state:=r->'terminal'->>'outcome'; is_current:=public.recon_v2_current(r,s,i.recon_config_revision); terminal:=public.recon_v2_finish_response(r,'duplicate',is_current);
 ELSIF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN state:='expired';
 ELSIF NOT public.recon_v2_config_matches(r,to_jsonb(i)) OR (r->>'ordinal')::bigint<=(s->>CASE WHEN r->>'kind'='receiver_test' THEN 'receiver_completed_ordinal' ELSE 'inventory_completed_ordinal' END)::bigint THEN state:='superseded';
 ELSE state:='pending'; END IF;
 RETURN jsonb_build_object('schema_version',2,'attempt_id',p_attempt_id,'kind',r->'kind','ordinal',r->'ordinal','observed_at',r->'observed_at','state',state,'current',is_current,'terminal',terminal);
END $$;
CREATE OR REPLACE FUNCTION public.recon_fail_attempt_v2(p_attempt_id uuid,p_reason_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; domain_key text; safe_text text; prior text:=current_setting('cos.recon_owned_writer_v2',true); patch jsonb;
BEGIN
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'attempt_id'=p_attempt_id::text;
 IF r IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 IF r->'terminal'<>'null'::jsonb THEN RETURN public.recon_v2_finish_response(r,'duplicate',public.recon_v2_current(r,s,i.recon_config_revision)); END IF;
 safe_text:=public.recon_v2_safe_error(p_reason_code);
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 IF NOT public.recon_v2_config_matches(r,to_jsonb(i)) THEN RETURN public.recon_v2_superseded(r,'configuration_changed'); END IF;
 domain_key:=CASE WHEN r->>'kind'='receiver_test' THEN 'receiver_completed_ordinal' ELSE 'inventory_completed_ordinal' END;
 IF (r->>'ordinal')::bigint<=(s->>domain_key)::bigint THEN RETURN public.recon_v2_superseded(r,'superseded'); END IF;
 r:=jsonb_set(r,'{terminal}',jsonb_build_object('outcome','failure','committed_at',public.recon_v2_time(clock_timestamp()),'config_revision_after',i.recon_config_revision,
  'input_fingerprint',public.recon_v2_digest(jsonb_build_object('kind',r->'kind','reason_code',p_reason_code)),'reason_code',p_reason_code,'result',NULL));
 s:=jsonb_set(jsonb_set(s,'{records}',(SELECT jsonb_agg(CASE WHEN value->>'attempt_id'=p_attempt_id::text THEN r ELSE value END ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(s->'records'))),ARRAY[domain_key],r->'ordinal');
 PERFORM public.recon_v2_check_state(s);
 patch:=jsonb_build_object('recon_attempt_state_v2',s);
 IF r->>'kind'='receiver_test' THEN
  patch:=patch||jsonb_build_object('receiver_test_status','error','receiver_test_error',safe_text,'receiver_test_attempted_at',r->'observed_at','receiver_test_attempt_id',r->'attempt_id','receiver_test_attempt_ordinal',r->'ordinal');
  PERFORM set_config('cos.recon_owned_writer_v2','receiver',true);
  UPDATE public.camera_integrations SET metadata=metadata||patch,updated_at=clock_timestamp() WHERE id=i.id;
 ELSE
  PERFORM set_config('cos.recon_owned_writer_v2','inventory',true);
  UPDATE public.camera_integrations SET metadata=metadata||patch,last_sync_status='error',last_error=safe_text,updated_at=clock_timestamp() WHERE id=i.id;
 END IF;
 PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
 RETURN public.recon_v2_finish_response(r,'applied',true);
END $$;

CREATE OR REPLACE FUNCTION public.recon_v2_validate_identity(p_identity_inventory jsonb,p_observed_at text,p_inventory_count integer,p_detector_count integer) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE proof_observed_at timestamptz; detector_count integer:=p_detector_count; p_skipped_non_detectors integer:=p_inventory_count-p_detector_count;
BEGIN
 IF jsonb_typeof(p_identity_inventory) IS DISTINCT FROM 'object' OR detector_count IS NULL OR detector_count<0 OR detector_count>p_inventory_count THEN RAISE EXCEPTION 'Invalid Recon identity inventory.'; END IF;
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
  IF proof_observed_at IS DISTINCT FROM public.recon_v2_timestamp(p_observed_at) OR p_identity_inventory->>'observedAt' IS DISTINCT FROM p_observed_at THEN
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

END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_validate_devices(p_devices jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; detector_count integer;
BEGIN
 IF jsonb_typeof(p_devices) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid Recon devices.'; END IF;
 detector_count:=jsonb_array_length(p_devices);
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

END $$;
CREATE OR REPLACE FUNCTION public.recon_v2_enrich_identity(p_identity_inventory jsonb,p_observed_at text,integration_metadata jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE published_inventory jsonb; group_item jsonb; group_position integer; matching_group_count bigint; previous_group jsonb; bridge_event_at timestamptz;
BEGIN
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
      IF NOT isfinite(bridge_event_at) OR bridge_event_at <= '1970-01-01'::timestamptz OR bridge_event_at > public.recon_v2_timestamp(p_observed_at) THEN
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
          AND bridge_event_at > '1970-01-01'::timestamptz AND bridge_event_at <= public.recon_v2_timestamp(p_observed_at) THEN
          -- Keep genuine context for this unchanged complete group at its original
          -- event time. Inventory receipt never becomes a bridge/camera health time.
          published_inventory := jsonb_set(published_inventory,
            ARRAY['groups',(group_position-1)::text,'bridgeLastEventAt'],previous_group->'bridgeLastEventAt');
        END IF;
      END IF;
    END IF;
  END LOOP;

 RETURN published_inventory;
END $$;

-- Replace only the existing credential body. CREATE OR REPLACE preserves its owner/ACL.
DO $$ BEGIN IF to_regprocedure('public.save_reconeyez_credentials(text,text)') IS NULL THEN RAISE EXCEPTION 'Existing Recon credential authority is required.'; END IF; END $$;
create or replace function public.save_reconeyez_credentials(
  p_username text,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  u_id uuid;
  p_id uuid;
  w_id uuid;
  w_secret text;
  integration_id bigint;
  prior_writer text := current_setting('cos.recon_owned_writer_v2',true);
begin
  if nullif(trim(p_username),'') is null or nullif(p_password,'') is null then
    raise exception 'Reconeyez username and password are required';
  end if;

  -- The CAS wrapper already owns its freshly inserted row. Direct absence is a conflict.
  select id into integration_id from public.camera_integrations where provider='reconeyez' for update;
  if integration_id is null then raise exception using errcode='PT409',message='Reconeyez inventory refresh was superseded.'; end if;
  perform set_config('cos.recon_owned_writer_v2','credential',true);

  select id into u_id from vault.secrets where name='reconeyez_username' limit 1;
  if u_id is null then
    u_id := vault.create_secret(trim(p_username), 'reconeyez_username', 'Reconeyez NA integration username');
  else
    perform vault.update_secret(u_id, trim(p_username));
  end if;

  select id into p_id from vault.secrets where name='reconeyez_password' limit 1;
  if p_id is null then
    p_id := vault.create_secret(p_password, 'reconeyez_password', 'Reconeyez NA integration password');
  else
    perform vault.update_secret(p_id, p_password);
  end if;

  select id into w_id from vault.secrets where name='reconeyez_webhook_token' limit 1;
  if w_id is null then
    w_secret := encode(extensions.gen_random_bytes(32),'hex');
    w_id := vault.create_secret(w_secret, 'reconeyez_webhook_token', 'Reconeyez inbound webhook token');
  end if;

  update public.camera_integrations set server_host='na.reconeyez.com',server_port=9028,enabled=true,
    username_secret_id=u_id,password_secret_id=p_id,webhook_secret_id=coalesce(webhook_secret_id,w_id),updated_at=now()
  where id=integration_id;
  perform set_config('cos.recon_owned_writer_v2',coalesce(prior_writer,''),true);
end;
$$;


CREATE OR REPLACE FUNCTION public.recon_finish_inventory_v2(p_attempt_id uuid,p_devices jsonb,p_identity_inventory jsonb,p_inventory_count integer,p_skipped_non_detectors integer,p_username text DEFAULT NULL,p_password text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; fp text; proof jsonb; q jsonb;
 prior text:=current_setting('cos.recon_owned_writer_v2',true);
 device public.camera_devices%rowtype; item jsonb; item_guid text; item_serial text; detector_count integer; active_count integer; shop_count integer;
BEGIN
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'attempt_id'=p_attempt_id::text;
 IF r IS NULL OR r->>'kind' NOT IN ('inventory_connect','inventory_sync') THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 fp:=public.recon_v2_digest(jsonb_build_object('devices',p_devices,'identity_inventory',p_identity_inventory,'inventory_count',p_inventory_count,'skipped_non_detectors',p_skipped_non_detectors));
 IF r->'terminal'<>'null'::jsonb THEN
  IF r->'terminal'->>'outcome'<>'success' OR r->'terminal'->>'input_fingerprint'<>fp THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
  RETURN public.recon_v2_finish_response(r,'duplicate',public.recon_v2_current(r,s,i.recon_config_revision));
 END IF;
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() OR (r->>'ordinal')::bigint<=(s->>'inventory_completed_ordinal')::bigint
 OR NOT public.recon_v2_config_matches(r,to_jsonb(i)) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 PERFORM public.recon_v2_validate_devices(p_devices); detector_count:=jsonb_array_length(p_devices);
 PERFORM public.recon_v2_validate_identity(p_identity_inventory,r->>'observed_at',p_inventory_count,detector_count);
 IF p_skipped_non_detectors IS NULL OR p_skipped_non_detectors<>p_inventory_count-detector_count THEN RAISE EXCEPTION 'Invalid Recon inventory counts.'; END IF;
 proof:=public.recon_v2_enrich_identity(p_identity_inventory,r->>'observed_at',i.metadata);
 IF r->>'kind'='inventory_connect' THEN
  IF nullif(trim(p_username),'') IS NULL OR nullif(p_password,'') IS NULL THEN RAISE EXCEPTION 'Reconeyez credentials are required.'; END IF;
 ELSIF p_username IS NOT NULL OR p_password IS NOT NULL THEN RAISE EXCEPTION 'Unexpected Recon inventory credentials.'; END IF;
 -- The expected revision is checked once before any permitted credential/config/device effects.
 PERFORM set_config('cos.recon_owned_writer_v2','inventory',true);
 IF r->>'kind'='inventory_connect' THEN PERFORM public.save_reconeyez_credentials(p_username,p_password); END IF;
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
        item->>'organization','Unknown','reconeyez',public.recon_v2_timestamp(r->>'observed_at'),true,'Recon','reconeyez','{}'::integer[],'{}'::jsonb,
        item->>'activation_state',item->>'activation_source',item->>'unit_key',item->'source_metadata',clock_timestamp());
    ELSE
      UPDATE public.camera_devices SET external_device_id=item_guid,device_name=item->>'device_name',
        device_model=item->>'device_model',device_type='Reconeyez detector',device_owner='Cameras Onsite',
        organization=coalesce(device.organization,item->>'organization'),
        activation_state=coalesce(device.activation_state,item->>'activation_state'),
        activation_source=coalesce(device.activation_source,item->>'activation_source'),
        source_imported_at=public.recon_v2_timestamp(r->>'observed_at'),unit_key=item->>'unit_key',
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


 q:=jsonb_build_object('imported',detector_count,'active',active_count,'shop',shop_count,'skipped_non_detectors',p_skipped_non_detectors);
 PERFORM public.recon_v2_check_result(r->>'kind',q);
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 UPDATE public.camera_integrations SET enabled=true,last_sync_at=public.recon_v2_timestamp(r->>'observed_at'),last_sync_status='ok',last_error=NULL,
  metadata=metadata||jsonb_build_object('identity_inventory_v1',proof,'identity_inventory_attempted_at',r->'observed_at','last_inventory_count',p_inventory_count,'last_detector_count',detector_count),updated_at=clock_timestamp()
 WHERE id=i.id RETURNING * INTO i;
 r:=jsonb_set(r,'{terminal}',jsonb_build_object('outcome','success','committed_at',public.recon_v2_time(clock_timestamp()),'config_revision_after',i.recon_config_revision,'input_fingerprint',fp,'reason_code',NULL,'result',q));
 s:=jsonb_set(jsonb_set(s,'{records}',(SELECT jsonb_agg(CASE WHEN value->>'attempt_id'=p_attempt_id::text THEN r ELSE value END ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(s->'records'))),'{inventory_completed_ordinal}',r->'ordinal');
 PERFORM public.recon_v2_check_state(s);
 UPDATE public.camera_integrations SET metadata=metadata||jsonb_build_object('recon_attempt_state_v2',s) WHERE id=i.id;
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
 RETURN public.recon_v2_finish_response(r,'applied',true);
END $$;

CREATE OR REPLACE FUNCTION public.recon_finish_reconcile_v2(p_attempt_id uuid,p_identity_inventory jsonb,p_inventory_count integer,p_detector_count integer,p_diagnostics jsonb,p_server_host text,p_server_port integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; fp text; q jsonb; proof jsonb;
 local_active integer; local_shop integer; prior text:=current_setting('cos.recon_owned_writer_v2',true);
BEGIN
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'attempt_id'=p_attempt_id::text;
 IF r IS NULL OR r->>'kind'<>'inventory_reconcile' THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 fp:=public.recon_v2_digest(jsonb_build_object('identity_inventory',p_identity_inventory,'inventory_count',p_inventory_count,'detector_count',p_detector_count,'diagnostics',p_diagnostics,'server_host',p_server_host,'server_port',p_server_port));
 IF r->'terminal'<>'null'::jsonb THEN
  IF r->'terminal'->>'outcome'<>'success' OR r->'terminal'->>'input_fingerprint'<>fp THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
  RETURN public.recon_v2_finish_response(r,'duplicate',public.recon_v2_current(r,s,i.recon_config_revision));
 END IF;
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() OR (r->>'ordinal')::bigint<=(s->>'inventory_completed_ordinal')::bigint
 OR NOT public.recon_v2_config_matches(r,to_jsonb(i)) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 IF p_server_host IS DISTINCT FROM coalesce(nullif(r->'expected_config'->>'server_host',''),'na.reconeyez.com')
 OR p_server_port IS DISTINCT FROM coalesce(nullif((r->'expected_config'->>'server_port')::integer,0),9028) THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 PERFORM public.recon_v2_validate_identity(p_identity_inventory,r->>'observed_at',p_inventory_count,p_detector_count);
 PERFORM public.recon_v2_validate_diagnostics(p_diagnostics,r->>'observed_at',p_inventory_count,p_detector_count);
 SELECT count(*) FILTER (WHERE activation_state<>'deactivated'),count(*) FILTER (WHERE activation_state='deactivated') INTO local_active,local_shop FROM public.camera_devices WHERE source='reconeyez';
 IF p_diagnostics->>'local_active' IS DISTINCT FROM local_active::text OR p_diagnostics->>'local_shop' IS DISTINCT FROM local_shop::text THEN RAISE EXCEPTION 'Recon diagnostic source counts changed.'; END IF;
 proof:=public.recon_v2_enrich_identity(p_identity_inventory,r->>'observed_at',i.metadata);
 q:=jsonb_build_object('inventory_total',p_inventory_count,'detectors',p_detector_count,'matched_local_detectors',p_diagnostics->'matched_local_detectors','unmatched_provider_detectors',p_diagnostics->'unmatched_provider_detectors','local_active',p_diagnostics->'local_active','local_shop',p_diagnostics->'local_shop','diagnostics_sha256',public.recon_v2_digest(p_diagnostics));
 PERFORM public.recon_v2_check_result(r->>'kind',q);
 PERFORM set_config('cos.recon_owned_writer_v2','reconcile',true);
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 UPDATE public.camera_integrations SET enabled=true,server_host=p_server_host,server_port=p_server_port,last_sync_at=public.recon_v2_timestamp(r->>'observed_at'),last_sync_status='ok',last_error=NULL,
  metadata=metadata||p_diagnostics||jsonb_build_object('identity_inventory_v1',proof,'identity_inventory_attempted_at',r->'observed_at','last_inventory_count',p_inventory_count,'last_detector_count',p_detector_count),updated_at=clock_timestamp()
 WHERE id=i.id RETURNING * INTO i;
 r:=jsonb_set(r,'{terminal}',jsonb_build_object('outcome','success','committed_at',public.recon_v2_time(clock_timestamp()),'config_revision_after',i.recon_config_revision,'input_fingerprint',fp,'reason_code',NULL,'result',q));
 s:=jsonb_set(jsonb_set(s,'{records}',(SELECT jsonb_agg(CASE WHEN value->>'attempt_id'=p_attempt_id::text THEN r ELSE value END ORDER BY (value->>'ordinal')::bigint) FROM jsonb_array_elements(s->'records'))),'{inventory_completed_ordinal}',r->'ordinal');
 PERFORM public.recon_v2_check_state(s);
 UPDATE public.camera_integrations SET metadata=metadata||jsonb_build_object('recon_attempt_state_v2',s) WHERE id=i.id;
 IF public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
 RETURN public.recon_v2_finish_response(r,'applied',true);
END $$;

CREATE OR REPLACE FUNCTION public.recon_create_inventory_v2(p_request_id uuid,p_observed_at text,p_expires_at text,p_retain_until text,p_devices jsonb,p_identity_inventory jsonb,p_inventory_count integer,p_skipped_non_detectors integer,p_username text,p_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb; fp text; prior text:=current_setting('cos.recon_owned_writer_v2',true); result jsonb;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid Recon creation request.'; END IF;
 PERFORM public.recon_v2_validate_devices(p_devices);
 PERFORM public.recon_v2_validate_identity(p_identity_inventory,p_observed_at,p_inventory_count,jsonb_array_length(p_devices));
 IF p_skipped_non_detectors IS NULL OR p_skipped_non_detectors<>p_inventory_count-jsonb_array_length(p_devices) THEN RAISE EXCEPTION 'Invalid Recon inventory counts.'; END IF;
 fp:=public.recon_v2_digest(jsonb_build_object('devices',p_devices,'identity_inventory',p_identity_inventory,'inventory_count',p_inventory_count,'skipped_non_detectors',p_skipped_non_detectors));
 -- The insert is the absent-row CAS. A losing creator never reaches Vault.
 PERFORM set_config('cos.recon_owned_writer_v2','create',true);
 INSERT INTO public.camera_integrations(provider,server_host,server_port,enabled,metadata)
 VALUES('reconeyez','na.reconeyez.com',9028,false,'{}'::jsonb) ON CONFLICT(provider) DO NOTHING RETURNING * INTO i;
 IF NOT FOUND THEN
  SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
  s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'attempt_id'=p_request_id::text AND value->>'request_id'=p_request_id::text;
  IF r IS NULL OR r->>'kind'<>'inventory_connect' OR r->>'observed_at' IS DISTINCT FROM p_observed_at OR r->>'expires_at' IS DISTINCT FROM p_expires_at OR r->>'retain_until' IS DISTINCT FROM p_retain_until
  OR r->'terminal'->>'outcome' IS DISTINCT FROM 'success' OR r->'terminal'->>'input_fingerprint' IS DISTINCT FROM fp THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
  PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
  RETURN public.recon_v2_finish_response(r,'duplicate',public.recon_v2_current(r,s,i.recon_config_revision));
 END IF;
 IF public.recon_v2_timestamp(p_observed_at)>clock_timestamp() OR public.recon_v2_timestamp(p_expires_at)<=clock_timestamp()
 OR public.recon_v2_timestamp(p_expires_at)<>public.recon_v2_timestamp(p_observed_at)+interval '120 seconds'
 OR public.recon_v2_timestamp(p_retain_until)<>public.recon_v2_timestamp(p_observed_at)+interval '600 seconds' THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 r:=jsonb_build_object('schema_version',2,'request_id',p_request_id,'attempt_id',p_request_id,'kind','inventory_connect','ordinal',1,'observed_at',p_observed_at,
  'expires_at',p_expires_at,'retain_until',p_retain_until,'expected_config_revision',i.recon_config_revision,'expected_config',public.recon_v2_config(to_jsonb(i)),'terminal',NULL);
 PERFORM public.recon_v2_reserve_terminal(r);
 s:=jsonb_build_object('schema_version',2,'next_ordinal',2,'inventory_completed_ordinal',0,'receiver_completed_ordinal',0,'records',jsonb_build_array(r));
 PERFORM public.recon_v2_check_state(s);
 PERFORM set_config('cos.recon_owned_writer_v2','inventory',true);
 UPDATE public.camera_integrations SET metadata=metadata||jsonb_build_object('recon_attempt_state_v2',s) WHERE id=i.id;
 result:=public.recon_finish_inventory_v2(p_request_id,p_devices,p_identity_inventory,p_inventory_count,p_skipped_non_detectors,p_username,p_password);
 PERFORM set_config('cos.recon_owned_writer_v2',coalesce(prior,''),true);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.recon_recover_begin_v2(p_request_id uuid,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.camera_integrations%rowtype; s jsonb; r jsonb;
BEGIN
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('inventory_connect','inventory_sync','inventory_reconcile','receiver_test') THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 SELECT * INTO i FROM public.camera_integrations WHERE provider='reconeyez' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 s:=public.recon_v2_state(i.metadata); SELECT value INTO r FROM jsonb_array_elements(s->'records') WHERE value->>'request_id'=p_request_id::text;
 IF r IS NULL OR r->>'kind'<>p_kind OR public.recon_v2_timestamp(r->>'expires_at')<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Reconeyez inventory refresh was superseded.'; END IF;
 RETURN jsonb_build_object('schema_version',2,'outcome','duplicate','request_id',r->'request_id','kind',r->'kind','attempt_id',r->'attempt_id','ordinal',r->'ordinal',
 'observed_at',r->'observed_at','expires_at',r->'expires_at','retain_until',r->'retain_until','expected_config_revision',r->'expected_config_revision');
END $$;

-- Proposed endpoint exposure only; never apply ACL changes without review.
REVOKE ALL ON FUNCTION public.recon_recover_begin_v2(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_recover_begin_v2(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_time(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_time(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_timestamp(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_timestamp(text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_validate_diagnostics(jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_validate_diagnostics(jsonb,text,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_keys(jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_keys(jsonb,text[]) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_check_result(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_check_result(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_integer(jsonb,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_integer(jsonb,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_canonical(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_canonical(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_digest(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_digest(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_safe_error(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_safe_error(text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_config(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_config(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_config_matches(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_config_matches(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_reserve_terminal(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_reserve_terminal(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_check_state(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_check_state(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_state(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_state(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_current(jsonb,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_current(jsonb,jsonb,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_finish_response(jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_finish_response(jsonb,text,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_superseded(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_superseded(jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_owned_integration_guard_v2() FROM PUBLIC,anon,authenticated;
-- EXECUTE is checked when the installer creates the trigger, not when service
-- DML fires it. Keep this trigger routine outside the callable service surface.
REVOKE EXECUTE ON FUNCTION public.recon_owned_integration_guard_v2() FROM service_role;
REVOKE ALL ON FUNCTION public.recon_begin_attempt_v2(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_begin_attempt_v2(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_attempt_result_v2(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_attempt_result_v2(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.recon_fail_attempt_v2(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_fail_attempt_v2(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_validate_identity(jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_validate_identity(jsonb,text,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_validate_devices(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_validate_devices(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_v2_enrich_identity(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_v2_enrich_identity(jsonb,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.recon_finish_inventory_v2(uuid,jsonb,jsonb,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_finish_inventory_v2(uuid,jsonb,jsonb,integer,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.recon_finish_reconcile_v2(uuid,jsonb,integer,integer,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_finish_reconcile_v2(uuid,jsonb,integer,integer,jsonb,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.recon_create_inventory_v2(uuid,text,text,text,jsonb,jsonb,integer,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recon_create_inventory_v2(uuid,text,text,text,jsonb,jsonb,integer,integer,text,text) TO service_role;
-- Fail closed on unknown default/inherited EXECUTE or delegation authority. Do not change
-- owners, memberships or arbitrary roles to make a failed preflight pass.
-- Owners and superusers retain administrative authority; this is not a boundary
-- against those roles. These exact objects exclude the credential authority.
DO $acl$
DECLARE
 service_oid oid;
 trigger_oid oid:='public.recon_owned_integration_guard_v2()'::regprocedure::oid;
 reviewed_oids oid[];
BEGIN
 SELECT oid INTO service_oid FROM pg_catalog.pg_roles WHERE rolname='service_role';
 reviewed_oids:=ARRAY[
  'public.recon_v2_time(timestamptz)'::regprocedure,
  'public.recon_v2_timestamp(text)'::regprocedure,
  'public.recon_v2_validate_diagnostics(jsonb,text,integer,integer)'::regprocedure,
  'public.recon_v2_keys(jsonb,text[])'::regprocedure,
  'public.recon_v2_check_result(text,jsonb)'::regprocedure,
  'public.recon_v2_integer(jsonb,numeric)'::regprocedure,
  'public.recon_v2_canonical(jsonb)'::regprocedure,
  'public.recon_v2_digest(jsonb)'::regprocedure,
  'public.recon_v2_safe_error(text)'::regprocedure,
  'public.recon_v2_config(jsonb)'::regprocedure,
  'public.recon_v2_config_matches(jsonb,jsonb)'::regprocedure,
  'public.recon_v2_reserve_terminal(jsonb)'::regprocedure,
  'public.recon_v2_check_state(jsonb)'::regprocedure,
  'public.recon_v2_state(jsonb)'::regprocedure,
  'public.recon_v2_current(jsonb,jsonb,bigint)'::regprocedure,
  'public.recon_v2_finish_response(jsonb,text,boolean)'::regprocedure,
  'public.recon_v2_superseded(jsonb,text)'::regprocedure,
  'public.recon_owned_integration_guard_v2()'::regprocedure,
  'public.recon_begin_attempt_v2(uuid,text)'::regprocedure,
  'public.recon_attempt_result_v2(uuid)'::regprocedure,
  'public.recon_fail_attempt_v2(uuid,text)'::regprocedure,
  'public.recon_v2_validate_identity(jsonb,text,integer,integer)'::regprocedure,
  'public.recon_v2_validate_devices(jsonb)'::regprocedure,
  'public.recon_v2_enrich_identity(jsonb,text,jsonb)'::regprocedure,
  'public.recon_finish_inventory_v2(uuid,jsonb,jsonb,integer,integer,text,text)'::regprocedure,
  'public.recon_finish_reconcile_v2(uuid,jsonb,integer,integer,jsonb,text,integer)'::regprocedure,
  'public.recon_create_inventory_v2(uuid,text,text,text,jsonb,jsonb,integer,integer,text,text)'::regprocedure,
  'public.recon_recover_begin_v2(uuid,text)'::regprocedure]::oid[];
 IF service_oid IS NULL OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS proc
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) AS acl
  WHERE proc.oid=ANY(reviewed_oids)
   AND acl.privilege_type='EXECUTE'
   AND acl.grantee<>proc.proowner
   AND (acl.is_grantable OR proc.oid=trigger_oid OR acl.grantee<>service_oid)
 ) OR EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid=ANY(reviewed_oids)
   AND (proc.prosecdef
    OR pg_catalog.has_function_privilege('anon',proc.oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',proc.oid,'EXECUTE')
    OR pg_catalog.has_function_privilege(service_oid,proc.oid,'EXECUTE')<>(proc.oid<>trigger_oid)
    OR (proc.proowner<>service_oid
     AND pg_catalog.has_function_privilege(service_oid,proc.oid,'EXECUTE WITH GRANT OPTION')))
 ) OR EXISTS (
  -- Raw ACLs alone miss privileges inherited from an allowed grantee. Reject
  -- unexpected effective callers instead of silently broadening this manifest.
  SELECT 1 FROM pg_catalog.pg_proc AS proc
  CROSS JOIN pg_catalog.pg_roles AS role
  WHERE proc.oid=ANY(reviewed_oids) AND NOT role.rolsuper
   AND role.oid<>proc.proowner
   AND (proc.oid=trigger_oid OR role.oid<>service_oid)
   AND pg_catalog.has_function_privilege(role.oid,proc.oid,'EXECUTE')
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Unexpected Recon function execute privileges require review.'; END IF;
END $acl$;
COMMIT;
