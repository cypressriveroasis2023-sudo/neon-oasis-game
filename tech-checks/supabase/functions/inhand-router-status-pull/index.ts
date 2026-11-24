import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { exchangeCode, PullError, pullInhand, type PullDeps, type Token } from "./pull.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const deps: PullDeps = {
    fetch,
    env: (name) => Deno.env.get(name),
    now: () => new Date(),
    loadSession: async () => {
      const { data, error } = await db.rpc("cos_inhand_oauth_get");
      if (error) return null;
      return Array.isArray(data) && data[0] ? data[0] : null;
    },
    saveSession: async (token: Token) => {
      const { error } = await db.rpc("cos_inhand_oauth_put", {
        p_access_token: token.access_token,
        p_expires_in_seconds: token.expires_in ?? 3600,
        p_refresh_token: token.refresh_token ?? null,
      });
      if (error) throw new PullError("apply_failed", "session not saved");
    },
    clearSession: async () => { await db.rpc("cos_inhand_oauth_clear"); },
  };

  // One-time connect: InHand's own sign-in page sends the browser back here with ?code=&state=.
  // The state must be an unused, unexpired value COS issued; anything else is refused.
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/callback")) {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) return text("This InHand connect link is not valid.", 400);
    const { data: taken } = await db.rpc("cos_inhand_connect_take", { p_state: state });
    if (taken !== true) return text("This InHand connect link has expired or was already used. Ask for a new one.", 400);
    try {
      const callback = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "") + "/functions/v1/inhand-router-status-pull/callback";
      await exchangeCode(deps, code, callback);
      return text("InHand is connected to COS. You can close this page.");
    } catch (error) {
      const detail = error instanceof PullError ? error.code + (error.detail ? " (" + error.detail + ")" : "") : "unexpected";
      await db.rpc("cos_inhand_pull_failed", { p_error_code: "connect " + detail });
      return text("InHand did not accept the connection (" + detail + "). Nothing was changed.", 502);
    }
  }

  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  // Same scheduler secret as the camera health sweep.
  const { data: valid } = await db.rpc("verify_camera_health_cron_secret", { candidate: req.headers.get("x-camera-cron-secret") });
  if (valid !== true) return json({ error: "Forbidden" }, 403);

  try {
    const pulled = await pullInhand(deps);
    const { data, error } = await db.rpc("cos_inhand_router_status_apply", {
      p_readings: pulled.readings,
      p_observed_at: pulled.observedAt,
    });
    if (error) throw new PullError("apply_failed");
    return json({ ok: true, observed_at: pulled.observedAt, ...data });
  } catch (error) {
    const code = error instanceof PullError ? error.code : "unexpected";
    const detail = error instanceof PullError && error.detail ? " (" + error.detail + ")" : "";
    await db.rpc("cos_inhand_pull_failed", { p_error_code: code + detail });
    return json({ ok: false, error: code }, code === "not_configured" ? 503 : 502);
  }
});
