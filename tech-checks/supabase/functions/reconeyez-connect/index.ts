import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

type ReconDevice = {
  guid?: string;
  name?: string;
  area?: string;
  description?: string;
  type?: string;
};

function isShopArea(area: string) {
  return /(^|\b)(shop|shop equipment|warehouse|stock)(\b|$)/i.test(area || "");
}

function normalizeUnitKey(d: ReconDevice) {
  const area = String(d.area || "").trim();
  if (area) return area;
  const description = String(d.description || "").trim();
  if (description) return description;
  return String(d.name || d.guid || "Reconeyez");
}

async function getProfile(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userDb = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userDb.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await userDb
    .from("profiles")
    .select("user_id,role,active")
    .eq("user_id", user.id)
    .maybeSingle();
  return { user, profile };
}

async function fetchReconInventory(host: string, port: number, username: string, password: string) {
  const endpoint = `https://${host}:${port}/control/v1/get_device_list`;
  const auth = "Basic " + btoa(`${username}:${password}`);
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": auth,
      "Accept": "application/json",
      "User-Agent": "CamerasOnsite-CameraHealth/1.0"
    }
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.trim();
    if (res.status === 401) detail = "Reconeyez rejected the username/password or reverse-control permission is not enabled for this user.";
    if (res.status === 429) detail = "Reconeyez rate limit reached. Try again in a moment.";
    throw new Error(`Reconeyez ${res.status}: ${detail || res.statusText}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Reconeyez returned a response Camera Health could not read."); }
  if (!Array.isArray(parsed)) throw new Error("Reconeyez device-list response was not an array.");
  return parsed as ReconDevice[];
}

async function syncInventory(db: ReturnType<typeof createClient>, list: ReconDevice[]) {
  const detectors = list.filter((d) => {
    const t = String(d?.type || "").toLowerCase();
    return t.startsWith("detector");
  });

  const now = new Date().toISOString();
  const rows = detectors
    .filter((d) => String(d.guid || "").trim())
    .map((d) => {
      const guid = String(d.guid).trim();
      const area = String(d.area || "").trim();
      const name = String(d.name || `Reconeyez ${guid.slice(-4)}`).trim();
      const shop = isShopArea(area);
      return {
        device_serial: `reconeyez:${guid}`,
        external_device_id: guid,
        device_name: name,
        device_model: String(d.type || "Reconeyez detector"),
        device_type: "Reconeyez detector",
        device_owner: "Cameras Onsite",
        organization: area || "Reconeyez",
        vigilant_status: "Unknown",
        source: "reconeyez",
        source_imported_at: now,
        monitoring_enabled: true,
        tech_check_unit_type: "Recon",
        monitoring_profile: "reconeyez",
        expected_ports: [],
        port_labels: {},
        activation_state: shop ? "deactivated" : "active",
        activation_source: shop ? "reconeyez_shop_area" : "reconeyez_area",
        unit_key: normalizeUnitKey(d),
        source_metadata: {
          guid,
          area,
          description: String(d.description || ""),
          reconeyez_type: String(d.type || "")
        },
        updated_at: now
      };
    });

  for (let i = 0; i < rows.length; i += 80) {
    const { error } = await db
      .from("camera_devices")
      .upsert(rows.slice(i, i + 80), { onConflict: "device_serial" });
    if (error) throw new Error(`Camera inventory save failed: ${error.message}`);
  }

  const { data: imported, error: readError } = await db
    .from("camera_devices")
    .select("id,external_device_id,activation_state")
    .eq("source", "reconeyez");
  if (readError) throw new Error(`Could not reload Reconeyez devices: ${readError.message}`);

  const healthRows = (imported || []).map((d: any) => ({
    camera_device_id: d.id,
    overall_status: "unknown",
    detail: "Waiting for Reconeyez cloud health event"
  }));

  for (let i = 0; i < healthRows.length; i += 100) {
    const { error } = await db
      .from("camera_health_current")
      .upsert(healthRows.slice(i, i + 100), {
        onConflict: "camera_device_id",
        ignoreDuplicates: true
      });
    if (error) throw new Error(`Could not initialize Reconeyez health rows: ${error.message}`);
  }

  return {
    imported: rows.length,
    active: (imported || []).filter((d: any) => d.activation_state !== "deactivated").length,
    shop: (imported || []).filter((d: any) => d.activation_state === "deactivated").length,
    skipped_non_detectors: Math.max(0, list.length - detectors.length)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const { user, profile } = await getProfile(authHeader);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (!profile?.active || !["owner", "it"].includes(String(profile.role))) {
    return json({ error: "Camera Health is limited to active Owner / IT accounts." }, 403);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "status").toLowerCase();

  const { data: integration } = await db
    .from("camera_integrations")
    .select("provider,server_host,server_port,enabled,username_secret_id,password_secret_id,webhook_secret_id,last_sync_at,last_sync_status,last_error,metadata")
    .eq("provider", "reconeyez")
    .maybeSingle();

  if (action === "status") {
    return json({
      provider: "reconeyez",
      server: integration?.server_host || "na.reconeyez.com",
      port: integration?.server_port || 9028,
      configured: Boolean(integration?.username_secret_id && integration?.password_secret_id),
      enabled: Boolean(integration?.enabled),
      webhook_ready: Boolean(integration?.webhook_secret_id),
      last_sync_at: integration?.last_sync_at || null,
      last_sync_status: integration?.last_sync_status || null,
      last_error: integration?.last_error || null,
      receiver_tested_at: integration?.metadata?.receiver_tested_at || null,
      last_webhook_received_at: integration?.metadata?.last_webhook_received_at || null,
      live_event_type: integration?.metadata?.last_webhook_event_type || null
    });
  }

  if (action === "webhook_setup" || action === "test_webhook") {
    if (String(profile.role) !== "owner") return json({ error: "Owner access is required for Reconeyez live-feed setup." }, 403);

    const { data: secretRows, error: secretError } = await db.rpc("get_reconeyez_integration_secrets");
    if (secretError) return json({ error: `Could not read Reconeyez integration security configuration: ${secretError.message}` }, 500);
    const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const webhookSecret = String(secret?.webhook_secret || "");
    if (!webhookSecret) return json({ error: "Reconeyez webhook receiver is not configured." }, 409);

    const base = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const endpoint = `${base}/functions/v1/reconeyez-webhook?token=${encodeURIComponent(webhookSecret)}`;
    const endpointPath = `/functions/v1/reconeyez-webhook?token=${encodeURIComponent(webhookSecret)}`;

    if (action === "test_webhook") {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "IntegrationTest",
            deviceGuid: "__camera_health_receiver_test__",
            timestamp: new Date().toISOString(),
            source: "Camera Health self-test"
          })
        });
        const resultText = await response.text();
        if (!response.ok && response.status !== 202) {
          throw new Error(`Receiver returned ${response.status}: ${resultText || response.statusText}`);
        }
        const existing = integration?.metadata && typeof integration.metadata === "object" ? integration.metadata : {};
        await db.from("camera_integrations").update({
          metadata: {
            ...existing,
            receiver_tested_at: new Date().toISOString(),
            receiver_test_status: "ok"
          },
          updated_at: new Date().toISOString()
        }).eq("provider", "reconeyez");
        return json({ ok: true, receiver_ready: true });
      } catch (e) {
        const message = String((e as Error)?.message || e);
        const existing = integration?.metadata && typeof integration.metadata === "object" ? integration.metadata : {};
        await db.from("camera_integrations").update({
          metadata: {
            ...existing,
            receiver_test_status: "error",
            receiver_test_error: message
          },
          updated_at: new Date().toISOString()
        }).eq("provider", "reconeyez");
        return json({ error: message }, 502);
      }
    }

    const supportRequest = [
      "To: support@reconeyez.com",
      "Subject: JSON Webhook integration setup — Cameras Onsite, LLC (North America)",
      "",
      "Hello Reconeyez Support,",
      "",
      "Please configure a JSON Webhook integration for our Cameras Onsite, LLC workspace on na.reconeyez.com.",
      "",
      `Receiving server: ${new URL(base).host}`,
      "Port: 443",
      "Protocol: JSON Webhook over HTTPS POST",
      `HTTP endpoint path: ${endpointPath}`,
      "Default site identification: 1027",
      "Reconeyez device area: Cameras Onsite Deployed (including its Houston and San Antonio child areas)",
      "Please exclude Shop Equipment / Shop areas from forwarded live alarms and health events.",
      "",
      "We need the supported health/status events forwarded, including ConnectionLost, DeviceConnected, BatteryLow, BatteryRestored, CriticalBatteryShutdown, RoutineCheck, Tamper, Armed and Disarmed.",
      "",
      "Our receiving endpoint is already live and tested. Please let us know when the backend integration has been enabled.",
      "",
      "Thank you,",
      "Cameras Onsite, LLC"
    ].join("\n");

    return json({
      ok: true,
      server: new URL(base).host,
      port: 443,
      endpoint_path: endpointPath,
      support_email: "support@reconeyez.com",
      support_request: supportRequest
    });
  }

  let username = "";
  let password = "";
  let host = "na.reconeyez.com";
  let port = 9028;

  if (action === "connect") {
    if (String(profile.role) !== "owner") return json({ error: "Owner access is required to save Reconeyez credentials." }, 403);
    username = String(body?.username || "").trim();
    password = String(body?.password || "");
    if (!username || !password) return json({ error: "Reconeyez username and password are required." }, 400);
    host = "na.reconeyez.com";
    port = 9028;

    try {
      const list = await fetchReconInventory(host, port, username, password);
      const { error: saveError } = await db.rpc("save_reconeyez_credentials", {
        p_username: username,
        p_password: password
      });
      if (saveError) throw new Error(`Could not store credentials securely: ${saveError.message}`);
      const result = await syncInventory(db, list);
      await db.from("camera_integrations").update({
        enabled: true,
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_error: null,
        metadata: { last_inventory_count: list.length, last_detector_count: result.imported },
        updated_at: new Date().toISOString()
      }).eq("provider", "reconeyez");
      return json({ ok: true, connected: true, ...result });
    } catch (e) {
      const message = String((e as Error)?.message || e);
      await db.from("camera_integrations").update({
        last_sync_status: "error",
        last_error: message,
        updated_at: new Date().toISOString()
      }).eq("provider", "reconeyez");
      return json({ error: message }, 502);
    }
  }

  if (action === "sync") {
    const { data: secretRows, error: secretError } = await db.rpc("get_reconeyez_integration_secrets");
    if (secretError) return json({ error: `Could not read Reconeyez integration credentials: ${secretError.message}` }, 500);
    const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    username = String(secret?.username || "");
    password = String(secret?.password || "");
    host = String(secret?.server_host || "na.reconeyez.com");
    port = Number(secret?.server_port || 9028);
    if (!username || !password) return json({ error: "Reconeyez has not been connected yet. Owner must connect it once." }, 409);

    try {
      const list = await fetchReconInventory(host, port, username, password);
      const result = await syncInventory(db, list);
      await db.from("camera_integrations").update({
        enabled: true,
        last_sync_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_error: null,
        metadata: { last_inventory_count: list.length, last_detector_count: result.imported },
        updated_at: new Date().toISOString()
      }).eq("provider", "reconeyez");
      return json({ ok: true, ...result });
    } catch (e) {
      const message = String((e as Error)?.message || e);
      await db.from("camera_integrations").update({
        last_sync_status: "error",
        last_error: message,
        updated_at: new Date().toISOString()
      }).eq("provider", "reconeyez");
      return json({ error: message }, 502);
    }
  }

  return json({ error: "Unknown action" }, 400);
});
