import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PullError, pullInhand, type Token } from "./pull.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Same scheduler secret as the camera health sweep.
  const { data: valid } = await db.rpc("verify_camera_health_cron_secret", { candidate: req.headers.get("x-camera-cron-secret") });
  if (valid !== true) return json({ error: "Forbidden" }, 403);

  try {
    const pulled = await pullInhand({
      fetch,
      env: (name) => Deno.env.get(name),
      now: () => new Date(),
      loadSession: async () => {
        const { data, error } = await db.rpc("cos_inhand_oauth_get");
        if (error) return null;
        return Array.isArray(data) && data[0] ? data[0] : null;
      },
      saveSession: async (token: Token) => {
        await db.rpc("cos_inhand_oauth_put", {
          p_access_token: token.access_token,
          p_expires_in_seconds: token.expires_in ?? 3600,
          p_refresh_token: token.refresh_token ?? null,
        });
      },
      clearSession: async () => { await db.rpc("cos_inhand_oauth_clear"); },
    });
    const { data, error } = await db.rpc("cos_inhand_router_status_apply", {
      p_readings: pulled.readings,
      p_observed_at: pulled.observedAt,
    });
    if (error) throw new PullError("apply_failed");
    return json({ ok: true, observed_at: pulled.observedAt, ...data });
  } catch (error) {
    const code = error instanceof PullError ? error.code : "unexpected";
    await db.rpc("cos_inhand_pull_failed", { p_error_code: code });
    return json({ ok: false, error: code }, code === "not_configured" ? 503 : 502);
  }
});
