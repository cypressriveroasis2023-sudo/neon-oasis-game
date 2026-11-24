import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {archiveReconPayload} from '../_shared/reconEventArchive.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

function firstValue(obj: any, paths: string[]) {
  for (const path of paths) {
    let cur = obj;
    for (const part of path.split(".")) cur = cur?.[part];
    if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
  }
  return null;
}

function firstEventValue(obj: any, paths: string[]) {
  for (const path of paths) {
    let cur = obj;
    for (const part of path.split(".")) cur = cur?.[part];
    if (typeof cur === "string" && cur.trim() !== "") return cur;
  }
  return null;
}

function normalizeEvent(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseBatteryPercent(body: any) {
  const raw = firstValue(body, [
    "device_battery", "deviceBattery", "battery", "battery_level", "batteryLevel",
    "battery_percent", "batteryPercent", "battery_percentage", "batteryPercentage", "device_info.battery_percentage",
    "device.battery", "device.battery_level", "device.batteryLevel",
    "data.device_battery", "data.deviceBattery", "data.battery",
    "event.device_battery", "event.deviceBattery", "event.battery"
  ]);
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

function parseCloudUrl(body: any) {
  const raw = firstValue(body, [
    "url", "cloud_url", "cloudUrl", "event_url", "eventUrl", "secure_url", "secureUrl",
    "device_url", "deviceUrl", "link", "event.url", "event.link", "data.url",
    "data.cloud_url", "data.cloudUrl", "data.event_url", "data.eventUrl"
  ]);
  const value = String(raw || "").trim();
  return /^https:\/\//i.test(value) ? value : null;
}

function batteryStatusFromEvent(eventName: string, percent: number | null) {
  const e = normalizeEvent(eventName);
  if (e === "criticalbatteryshutdown" || e === "yt") return "critical";
  if (e === "batterylow" || e === "xt") return "low";
  if (e === "batteryrestored" || e === "xr") return "normal";
  if (percent !== null) {
    if (percent <= 10) return "critical";
    if (percent <= 25) return "low";
    return "normal";
  }
  return null;
}

function parseObservedAt(body: any) {
  const raw = firstValue(body, [
    "observed_at", "event_time", "eventTime", "timestamp", "time", "created_at", "date_time",
    "event.observed_at", "event.timestamp", "data.timestamp"
  ]);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

async function reconEventKey(body: any) {
  const providerGuid = typeof body?.event_guid === "string" ? body.event_guid.trim() : "";
  if (providerGuid && providerGuid.length <= 256) return "guid:" + providerGuid;
  // Hash the original body before archive timestamps or storage references are added.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(body)));
  return "sha256:" + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

function withOrderingKey(archivedPayload: any, originalBody: any, key: string) {
  return { ...archivedPayload, cos_event_order_v1: {
    key,
    ...(Object.hasOwn(originalBody, "cos_event_order_v1")
      ? { original_payload_value: originalBody.cos_event_order_v1 } : {})
  } };
}

async function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ad, bd] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b))
  ]);
  const av = new Uint8Array(ad), bv = new Uint8Array(bd);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

function healthFromEvent(eventName: string) {
  const e = normalizeEvent(eventName);
  const offline = new Set([
    "connectionlost", "communicationfail", "criticalbatteryshutdown",
    "systemstopped", "yc", "yt", "tz"
  ]);
  const degraded = new Set(["batterylow", "tamper", "tamperalarm", "xt", "ta"]);
  const online = new Set([
    "deviceconnected", "communicationrestore", "batteryrestored",
    "routinecheck", "automatictest", "systemstarted",
    "persondetected", "vehicledetected", "movementdetected",
    "armed", "disarmed", "closingreport", "openingreport", "yk", "xr", "rp", "tw", "ba", "cl", "op"
  ]);
  if (offline.has(e)) return { health: "offline", source: "offline" };
  if (degraded.has(e)) return { health: "degraded", source: "online" };
  if (online.has(e)) return { health: "online", source: "online" };
  return null;
}

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const terminalReasons = new Set([
  "provider_unavailable", "provider_rejected", "partial_inventory", "invalid_inventory",
  "source_read_failed", "save_failed", "receiver_timeout", "receiver_rejected", "internal_error"
]);
const safeId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

function closedObject(value: any, keys: string[]) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(value)) return false;
  const parsed = new Date(value);
  // Date.parse can normalize impossible calendar dates. Keep valid wire spelling
  // and sub-millisecond precision rather than replacing it with a JS timestamp.
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

function sameTimestamp(left: string, right: string) {
  const micros = (value: string) => BigInt(new Date(value.slice(0, 19) + "Z").getTime()) * 1000n
    + BigInt((value.match(/\.(\d{1,6})/)?.[1] || "").padEnd(6, "0"));
  return micros(left) === micros(right);
}

function receiverAttempt(body: any, eventType: string, nonDetector: boolean) {
  const token = body?.cos_receiver_test_v2;
  return !nonDetector && eventType === "IntegrationTest" && body?.eventType === "IntegrationTest"
    && body?.deviceGuid === "__camera_health_receiver_test__" && body?.source === "Camera Health self-test"
    && utcTimestamp(body?.timestamp) && closedObject(token, ["schema_version", "attempt_id"])
    && token.schema_version === 2 && typeof token.attempt_id === "string" && canonicalUuid.test(token.attempt_id)
    ? token.attempt_id : null;
}

function validReceipt(value: any, eventId: number, startedAt: string) {
  return closedObject(value, ["schema_version", "event_id", "receipt_started_at", "outcome", "applied"])
    && value.schema_version === 2 && safeId(value.event_id) && value.event_id === eventId
    && utcTimestamp(value.receipt_started_at) && sameTimestamp(value.receipt_started_at, startedAt)
    && ["applied", "duplicate", "superseded"].includes(value.outcome)
    && value.applied === (value.outcome === "applied");
}

function validReceiverAck(value: any, attemptId: string, eventId: number, startedAt: string) {
  if (!closedObject(value, ["schema_version", "attempt_id", "kind", "ordinal", "observed_at", "outcome", "applied",
    "terminal_outcome", "current", "input_fingerprint", "reason_code", "result"])
    || value.schema_version !== 2 || value.attempt_id !== attemptId || !canonicalUuid.test(value.attempt_id)
    || value.kind !== "receiver_test" || !safeId(value.ordinal) || !utcTimestamp(value.observed_at)
    || typeof value.current !== "boolean") return false;
  if (value.outcome === "superseded") {
    return value.applied === false && value.current === false && value.terminal_outcome === null
      && value.input_fingerprint === null && value.result === null
      && ["superseded", "configuration_changed"].includes(value.reason_code);
  }
  if (!["applied", "duplicate"].includes(value.outcome) || value.applied !== (value.outcome === "applied")
    || (value.outcome === "applied" && value.current !== true)
    || typeof value.input_fingerprint !== "string" || !fingerprintPattern.test(value.input_fingerprint)) return false;
  if (value.terminal_outcome === "failure") return terminalReasons.has(value.reason_code) && value.result === null;
  if (value.terminal_outcome !== "success" || value.reason_code !== null
    || !closedObject(value.result, ["receiver_ready", "ack_event_id", "receiver_tested_at"])
    || value.result.receiver_ready !== true || !safeId(value.result.ack_event_id)
    || !utcTimestamp(value.result.receiver_tested_at)) return false;
  // A replay retains the first delivery's ID/time, including historical success.
  return value.outcome === "duplicate"
    || (value.result.ack_event_id === eventId && sameTimestamp(value.result.receiver_tested_at, startedAt));
}

type MetadataResult = {outcome: string; errorCode?: string; terminalOutcome?: string | null};
async function recordMetadata(eventId: number, startedAt: string, kind: string, attemptId: string | null): Promise<MetadataResult> {
  if (!utcTimestamp(startedAt) || new Date(startedAt).getTime() <= 0) {
    return { outcome: "error", errorCode: "invalid_receipt_time" };
  }
  if (kind === "receiver_test" && !attemptId) return { outcome: "uncorrelated" };
  const controller = new AbortController();
  const deadline = performance.now() + 5000;
  // Only metadata uses this cancellation signal; archive and health retain their
  // separate clients/budgets. Timeout does not prove that a DB commit rolled back.
  const metadataDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    global: {fetch: (input: any, init: any = {}) => fetch(input, {...init, signal: AbortSignal.any([
      ...(init.signal ? [init.signal] : []), controller.signal
    ])})}
  });
  const name = kind === "receiver_test" ? "recon_finish_receiver_ack_v2" : "recon_record_webhook_receipt_v2";
  const args = kind === "receiver_test" ? {p_attempt_id: attemptId!, p_event_id: eventId} : {p_event_id: eventId};
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<{outcome: string; errorCode: string}>(resolve => {
    timer = setTimeout(() => {
      resolve({outcome: "uncertain", errorCode: "metadata_timeout"});
      controller.abort();
    }, Math.max(0, deadline - performance.now()));
  });
  const operation = (async () => {
    let failure = {outcome: "uncertain", errorCode: "invalid_metadata_response"};
    // Recover once using exactly the same audit/token. These idempotent owner
    // calls inspect their stored result; never begin a new attempt or write a
    // direct fallback after an ambiguous transport/acknowledgment.
    for (let attempt = 0; attempt < 2 && !controller.signal.aborted && performance.now() < deadline; attempt++) {
      try {
        const {data, error} = await metadataDb.rpc(name, args);
        if (controller.signal.aborted || performance.now() >= deadline) break;
        if (error) {
          const code = error.code === "PT409" || error.code === "40001" ? error.code : "rpc_error";
          failure = {outcome: code === "40001" || code === "PT409" ? "error" : "uncertain", errorCode: code};
          if (code === "PT409") return failure;
        } else {
          const valid = kind === "receiver_test" ? validReceiverAck(data, attemptId!, eventId, startedAt) : validReceipt(data, eventId, startedAt);
          if (performance.now() >= deadline) break;
          if (valid) return {outcome: data.outcome, ...(kind === "receiver_test" ? {terminalOutcome: data.terminal_outcome} : {})};
          failure = {outcome: "uncertain", errorCode: "invalid_metadata_response"};
        }
      } catch {
        failure = {outcome: "uncertain", errorCode: "metadata_transport_error"};
      }
    }
    return controller.signal.aborted || performance.now() >= deadline
      ? {outcome: "uncertain", errorCode: "metadata_timeout"} : failure;
  })();
  try { return await Promise.race([operation, timeout]); }
  finally { clearTimeout(timer!); }
}

Deno.serve(async (req: Request) => {
  const receiptStarted = new Date();
  const receiptStartedAt = Number.isFinite(receiptStarted.getTime()) ? receiptStarted.toISOString() : null;
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: secretRows, error: secretError } = await db.rpc("get_reconeyez_integration_secrets");
  if (secretError) return json({ error: "Integration security configuration unavailable" }, 503);
  const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  const expected = String(secret?.webhook_secret || "");
  if (!expected) return json({ error: "Reconeyez webhook is not configured" }, 503);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const finalPath = pathParts[pathParts.length - 1] || "";
  const authHeader = req.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const candidate =
    bearerMatch?.[1]?.trim() ||
    req.headers.get("x-reconeyez-token") ||
    url.searchParams.get("token") ||
    (finalPath !== "reconeyez-webhook" ? finalPath : "");

  if (!(await safeEqual(String(candidate || ""), expected))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") || "";
  let body: any;
  if (contentType.includes("application/json")) {
    body = await req.json().catch(() => null);
  } else {
    const raw = await req.text();
    try { body = JSON.parse(raw); }
    catch { body = { raw }; }
  }
  if (!body || typeof body !== "object") body = { raw: body };

  const eventTypePaths = [
    "event_type", "eventType", "event_name", "eventName",
    "event.type", "event.name", "event",
    "type", "name", "sia_event", "siaEvent",
    "data.eventType", "data.event_type"
  ];
  const eventCodePaths = [
    "event_code", "eventCode", "code", "sia_code", "siaCode",
    "event.code", "data.code"
  ];
  const deviceTypePaths = [
    "device_info.type", "device.type", "device_type", "deviceType",
    "data.device_info.type", "data.device.type", "data.device_type"
  ];
  const reportedEventType = String(firstEventValue(body, eventTypePaths) || "");
  const eventCode = String(firstEventValue(body, eventCodePaths) || "");
  // Check every supported alias before fallback: a detector-looking field cannot
  // override explicit bridge/siren semantics or receiver-only test evidence.
  const eventSemantics = [...eventTypePaths, ...eventCodePaths]
    .map(path => normalizeEvent(firstEventValue(body, [path])));
  const deviceSemantics = deviceTypePaths
    .map(path => normalizeEvent(firstEventValue(body, [path])));
  const nonDetector = [...deviceSemantics, ...eventSemantics]
    .some(value => /^(bridge|siren)/.test(value));
  const receiverOnly = eventSemantics.includes("integrationtest");
  const healthExcluded = nonDetector || receiverOnly;
  // SQL prefers a nonempty event_type over event_code. Use a recognized code
  // when an unknown name would hide it; code-only audit fields stay unchanged.
  // The original name remains in the archived body and its unchanged dedupe key.
  const eventType = !healthExcluded && reportedEventType
    && !healthFromEvent(reportedEventType) && healthFromEvent(eventCode)
    ? eventCode : reportedEventType;
  const receiptKind = normalizeEvent(eventType || eventCode) === "integrationtest" ? "receiver_test" : "ordinary";
  const receiverAttemptId = receiptKind === "receiver_test" ? receiverAttempt(body, eventType, nonDetector) : null;
  const externalId = String(firstValue(body, [
    "device_guid", "deviceGuid", "guid", "device_info.guid", "device.guid", "device.id",
    "detector.guid", "detector.id", "source.guid", "source.deviceGuid",
    "data.device_guid", "data.deviceGuid", "data.guid"
  ]) || "");
  const observedAt = parseObservedAt(body);
  const eventKey = await reconEventKey(body);
  const batteryPercent = parseBatteryPercent(body);
  const reconCloudUrl = parseCloudUrl(body);
  const signalStrengthDbmRaw = firstValue(body, ["signal_strength_dbm", "device_info.signal_strength_dbm"]);
  const signalStrengthDbm = signalStrengthDbmRaw === null ? null : Number(signalStrengthDbmRaw);
  const reconDeviceName = firstValue(body, ["device_info.name", "device_name", "deviceName"]);
  const reconArea = firstValue(body, ["device_info.area", "area", "site_name", "siteName"]);
  const batteryStatus = batteryStatusFromEvent(eventType || eventCode, batteryPercent);

  let camera: any = null;
  let cameraLookupFailed = false;
  if (externalId) {
    try {
      const { data, error } = await db
        .from("camera_devices")
        .select("id,device_name,unit_key,organization,activation_state,source_status,source_metadata")
        .eq("source", "reconeyez")
        .eq("external_device_id", externalId)
        .maybeSingle();
      cameraLookupFailed = Boolean(error);
      if (!cameraLookupFailed) camera = data || null;
    } catch {
      cameraLookupFailed = true;
    }
  }

  // Non-detector activity cannot project health even if a stale identity matches.
  const mapping = healthExcluded ? null : healthFromEvent(eventType || eventCode);
  // Archival must not hold up health processing during a Storage outage.
  // The complete original body is retained if the shared six-second budget expires.
  const archiveDeadline = AbortSignal.timeout(6000);
  const archiveDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    global: {fetch: (input: any, init: any = {}) => fetch(input, {...init, signal: AbortSignal.any([
      ...(init.signal ? [init.signal] : []), archiveDeadline
    ])})}
  });
  let eventRow: any = null;
  let eventInsertFailed = false;
  try {
    const {data, error} = await db
      .from("camera_integration_events")
      .insert({
        provider: "reconeyez",
        external_device_id: externalId || null,
        camera_device_id: camera?.id || null,
        event_type: eventType || null,
        event_code: eventCode || null,
        observed_at: observedAt,
        recon_receipt_started_at: receiptStartedAt,
        recon_receipt_kind: receiptKind,
        recon_receiver_attempt_id: receiverAttemptId,
        payload: withOrderingKey(await archiveReconPayload(archiveDb, body), body, eventKey),
        processed: false,
        processing_note: cameraLookupFailed
          ? "Reconeyez device lookup failed; event retained for retry."
          : !externalId
          ? "Stored raw payload; device identifier was not recognized yet."
          : !camera
            ? "Stored raw payload; Reconeyez device is not mapped in Camera Health yet."
            : !mapping
              ? "Event stored; it does not change camera health."
              : "Reconeyez event queued for ordered projection."
      })
      .select("id")
      .maybeSingle();
    eventRow = data;
    eventInsertFailed = Boolean(error);
  } catch {
    eventInsertFailed = true;
  }

  if (eventInsertFailed || !safeId(eventRow?.id)) {
    return json({ error: "Reconeyez event retention could not be confirmed; health was not changed.", health_changed: false }, 503);
  }

  let metadataResult: MetadataResult;
  try {
    metadataResult = receiptStartedAt === null
      ? {outcome: "error", errorCode: "invalid_receipt_time"}
      : await recordMetadata(eventRow.id, receiptStartedAt, receiptKind, receiverAttemptId);
  } catch {
    metadataResult = {outcome: "uncertain", errorCode: "metadata_transport_error"};
  }
  const metadataResponse = {
    metadata_outcome: metadataResult.outcome,
    ...(metadataResult.errorCode ? {metadata_error_code: metadataResult.errorCode} : {}),
    ...(metadataResult.terminalOutcome !== undefined ? {metadata_terminal_outcome: metadataResult.terminalOutcome} : {})
  };

  if (cameraLookupFailed || !camera || !mapping) {
    const incomplete = cameraLookupFailed || Boolean(metadataResult.errorCode);
    return json({
      ok: !incomplete,
      ...(incomplete ? {error: cameraLookupFailed
        ? "Reconeyez event retained; device lookup could not be completed."
        : "Reconeyez event retained; integration metadata update could not be confirmed."} : {}),
      event_id: eventRow.id,
      matched: Boolean(camera),
      applied: false,
      outcome: cameraLookupFailed ? "lookup_failed" : "not_eligible",
      health_changed: false,
      event_type: eventType || eventCode || "unrecognized",
      ...metadataResponse
    }, incomplete ? 503 : 202);
  }

  const now = observedAt;
  const metadata = {
    ...(batteryPercent !== null ? { battery_percent: batteryPercent, battery_updated_at: now } : {}),
    ...(batteryStatus ? { battery_status: batteryStatus, battery_status_updated_at: now } : {}),
    ...(Number.isFinite(signalStrengthDbm) ? { signal_strength_dbm: signalStrengthDbm, signal_updated_at: now } : {}),
    ...(reconDeviceName ? { reconeyez_device_name: String(reconDeviceName) } : {}),
    ...(reconArea ? { reconeyez_area: String(reconArea) } : {}),
    ...(reconCloudUrl ? { cloud_url: reconCloudUrl, cloud_url_updated_at: now } : {})
  };

  let projection: any = null;
  let projectionFailed = false;
  try {
    const {data, error} = await db.rpc("cos_apply_recon_event_v1", {
      p_event_id: eventRow.id,
      p_event_key: eventKey,
      p_metadata_patch: metadata
    });
    projectionFailed = Boolean(error) || !data || typeof data !== "object" || Array.isArray(data)
      || typeof data.applied !== "boolean" || typeof data.outcome !== "string" || !data.outcome.trim()
      || (data.applied && typeof data.health_changed !== "boolean")
      || (data.health_changed !== undefined && typeof data.health_changed !== "boolean");
    if (!projectionFailed) projection = data;
  } catch {
    projectionFailed = true;
  }
  const incomplete = projectionFailed || Boolean(metadataResult.errorCode);
  return json({
    ok: !incomplete,
    ...(incomplete ? {error: projectionFailed
      ? "Reconeyez event retained; ordered health update could not be confirmed."
      : "Reconeyez event retained; integration metadata update could not be confirmed."} : {}),
    event_id: eventRow.id,
    matched: true,
    applied: projectionFailed ? null : Boolean(projection?.applied),
    outcome: projection?.outcome || "unknown",
    health_changed: projectionFailed ? null : Boolean(projection?.health_changed),
    camera_device_id: camera.id,
    status: projection?.status || null,
    battery_percent: batteryPercent,
    battery_status: batteryStatus,
    cloud_url: reconCloudUrl,
    ...metadataResponse
  }, incomplete ? 503 : 200);
});
