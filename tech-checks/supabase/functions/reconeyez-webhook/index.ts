import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function normalizeEvent(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseObservedAt(body: any) {
  const raw = firstValue(body, [
    "observed_at", "event_time", "eventTime", "timestamp", "time", "created_at",
    "event.observed_at", "event.timestamp", "data.timestamp"
  ]);
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
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
    "systemstopped"
  ]);
  const degraded = new Set(["batterylow", "tamper", "tamperalarm"]);
  const online = new Set([
    "deviceconnected", "communicationrestore", "batteryrestored",
    "routinecheck", "automatictest", "systemstarted",
    "persondetected", "vehicledetected", "movementdetected",
    "armed", "disarmed", "closingreport", "openingreport"
  ]);
  if (offline.has(e)) return { health: "offline", source: "offline" };
  if (degraded.has(e)) return { health: "degraded", source: "online" };
  if (online.has(e)) return { health: "online", source: "online" };
  return null;
}

Deno.serve(async (req: Request) => {
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
  const candidate =
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

  const eventType = String(firstValue(body, [
    "event_type", "eventType", "event_name", "eventName", "event",
    "type", "name", "sia_event", "siaEvent",
    "event.type", "event.name", "data.eventType", "data.event_type"
  ]) || "");
  const eventCode = String(firstValue(body, [
    "event_code", "eventCode", "code", "sia_code", "siaCode",
    "event.code", "data.code"
  ]) || "");
  const externalId = String(firstValue(body, [
    "device_guid", "deviceGuid", "guid", "device.guid", "device.id",
    "detector.guid", "detector.id", "source.guid", "source.deviceGuid",
    "data.device_guid", "data.deviceGuid", "data.guid"
  ]) || "");
  const observedAt = parseObservedAt(body);

  let camera: any = null;
  if (externalId) {
    const { data } = await db
      .from("camera_devices")
      .select("id,device_name,unit_key,organization,activation_state,source_status,source_metadata")
      .eq("source", "reconeyez")
      .eq("external_device_id", externalId)
      .maybeSingle();
    camera = data || null;
  }

  const mapping = healthFromEvent(eventType || eventCode);
  const { data: eventRow, error: eventInsertError } = await db
    .from("camera_integration_events")
    .insert({
      provider: "reconeyez",
      external_device_id: externalId || null,
      camera_device_id: camera?.id || null,
      event_type: eventType || null,
      event_code: eventCode || null,
      observed_at: observedAt,
      payload: body,
      processed: Boolean(camera && mapping),
      processing_note: !externalId
        ? "Stored raw payload; device identifier was not recognized yet."
        : !camera
          ? "Stored raw payload; Reconeyez device is not mapped in Camera Health yet."
          : !mapping
            ? "Event stored; it does not change camera health."
            : "Reconeyez health event applied."
    })
    .select("id")
    .maybeSingle();

  if (eventInsertError) {
    console.error("Reconeyez event log insert failed", eventInsertError);
  }

  if (!camera || !mapping) {
    return json({
      ok: true,
      event_id: eventRow?.id || null,
      matched: Boolean(camera),
      health_changed: false,
      event_type: eventType || eventCode || "unrecognized"
    }, 202);
  }

  const { data: prev } = await db
    .from("camera_health_current")
    .select("overall_status,consecutive_failures,first_failed_at")
    .eq("camera_device_id", camera.id)
    .maybeSingle();

  const previous = String(prev?.overall_status || "unknown").toLowerCase();
  const now = observedAt;
  const metadata = {
    ...(camera.source_metadata || {}),
    last_event_type: eventType || null,
    last_event_code: eventCode || null,
    last_event_at: now
  };

  const devicePatch: any = {
    source_status: mapping.source,
    source_last_seen_at: now,
    source_metadata: metadata,
    last_health_checked_at: now,
    updated_at: new Date().toISOString()
  };
  if (mapping.source === "online") {
    devicePatch.last_online_at = now;
    devicePatch.last_probe_online_at = now;
    devicePatch.last_online_source_text = "Reconeyez cloud event";
  }

  await db.from("camera_devices").update(devicePatch).eq("id", camera.id);

  const healthPatch: any = {
    camera_device_id: camera.id,
    overall_status: mapping.health,
    ip_reachable: null,
    port_status: {},
    checked_at: now,
    detail: `Reconeyez cloud event: ${eventType || eventCode || "status update"}`,
    confirmed_outage: mapping.health === "offline",
    confirmation_reason: mapping.health === "offline" ? "Reconeyez reported a connection/power outage event" : null
  };

  if (mapping.health === "offline") {
    healthPatch.consecutive_failures = Math.max(1, Number(prev?.consecutive_failures || 0) + 1);
    healthPatch.first_failed_at = prev?.first_failed_at || now;
  } else {
    healthPatch.consecutive_failures = 0;
    healthPatch.first_failed_at = null;
    healthPatch.acknowledged_at = null;
    healthPatch.acknowledged_by = null;
    if (previous === "offline") healthPatch.last_recovered_at = now;
  }

  await db.from("camera_health_current").upsert(healthPatch, { onConflict: "camera_device_id" });

  if (previous !== mapping.health || mapping.health !== "online") {
    await db.from("camera_health_history").insert({
      camera_device_id: camera.id,
      status: mapping.health,
      check_source: "reconeyez_webhook",
      detail: {
        previous_status: previous,
        event_type: eventType || null,
        event_code: eventCode || null,
        external_device_id: externalId || null
      }
    });
  }

  return json({
    ok: true,
    event_id: eventRow?.id || null,
    matched: true,
    health_changed: previous !== mapping.health,
    camera_device_id: camera.id,
    status: mapping.health
  });
});
