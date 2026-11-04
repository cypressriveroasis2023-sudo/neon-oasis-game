// src/ownerEquipmentCore.ts
var OWNER_CONTRACT = "COS_OWNER_EQUIPMENT_V1";
var fields = ["placement", "customer", "site", "address", "publicIp", "ports", "monitoringEnabled", "latitude", "longitude"];
function publicIp(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(value)) return false;
  const p = value.split("."), [a, b, c] = p.map(Number);
  if (p.some((v) => String(Number(v)) !== v || Number(v) > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
function validateSettings(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join("|") !== [...fields].sort().join("|")) throw Error("Unsupported equipment settings.");
  if (!["FIELD", "SHOP"].includes(v.placement)) throw Error("Choose Field or Shop.");
  for (const key2 of ["customer", "site", "address", "publicIp"]) if (typeof v[key2] !== "string" || v[key2] !== v[key2].trim() || v[key2].length > (key2 === "address" ? 600 : 250) || /[\x00-\x1f\x7f<>]/.test(v[key2])) throw Error("Use plain text for " + key2 + ".");
  if (v.placement === "FIELD" && (!v.customer || !v.address)) throw Error("Field equipment needs a customer and service address. GPS is optional.");
  if (v.publicIp && !publicIp(v.publicIp)) throw Error("Enter a public IPv4 address, without a URL or port.");
  if (!Array.isArray(v.ports) || v.ports.length > 32 || v.ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) || new Set(v.ports).size !== v.ports.length) throw Error("Use distinct service ports between 1 and 65535.");
  if (typeof v.monitoringEnabled !== "boolean" || v.monitoringEnabled && (!v.publicIp || !v.ports.length)) throw Error("Monitoring needs a saved public IP and at least one service port.");
  if (v.latitude === null !== (v.longitude === null) || v.latitude !== null && (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude) || Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180)) throw Error("Enter both latitude and longitude, or leave both blank.");
  return { ...v, ports: [...v.ports].sort((a, b) => a - b) };
}
function checkedControl(c, pid) {
  if (!c || c.contract !== OWNER_CONTRACT || !/^[1-9][0-9]{0,14}$/.test(c.productId) || pid && c.productId !== pid || !Number.isSafeInteger(c.revision) || c.revision < 1 || !Number.isSafeInteger(c.connectionRevision) || c.connectionRevision < 1 || typeof c.active !== "boolean" || !Number.isFinite(Date.parse(c.updatedAt))) return null;
  try {
    validateSettings(c.settings);
    return c;
  } catch {
    return null;
  }
}
function ownerConnection(c, now = Date.now()) {
  const value = checkedControl(c);
  if (!value?.active) return null;
  const s = value.settings, check = value.lastCompleted;
  const reason = !s.monitoringEnabled ? "Monitoring is disabled. Save settings with monitoring enabled to check this unit." : !s.publicIp || !s.ports.length ? "Connection setup is incomplete. Save an IP and service ports." : !check ? "No completed check has been saved for this configuration." : check.connectionRevision !== value.connectionRevision ? "The IP or port setup changed. Run a new connection check." : !Number.isFinite(Date.parse(check.checkedAt)) || Date.parse(check.checkedAt) > now || now - Date.parse(check.checkedAt) > 20 * 60 * 1e3 ? "Last completed reading is stale; the saved setup has not been erased." : null;
  if (reason) return { status: "unknown", reason, checkedAt: null, lastCompleted: check || null };
  if (!["online", "offline"].includes(check.status) || check.publicIp !== s.publicIp || JSON.stringify(check.ports) !== JSON.stringify(s.ports) || !Array.isArray(check.outcomes) || check.outcomes.length !== s.ports.length || new Set(check.outcomes.map((x) => x.port)).size !== s.ports.length || check.outcomes.some((x) => !s.ports.includes(x.port) || !["responded", "no_response"].includes(x.outcome)) || check.status === "online" !== check.outcomes.some((x) => x.outcome === "responded")) return { status: "unknown", reason: "Saved connection evidence is incomplete.", checkedAt: null, lastCompleted: check };
  return { status: check.status, checkedAt: check.checkedAt, lastCompleted: check, reason: "Owner-configured Product-ID target: " + (check.status === "online" ? "a service port responded." : "all configured service ports completed without a response.") + " This is connection status, not video or recording verification." };
}
function recount(roster) {
  const a = roster.items;
  return { ...roster, summary: { ...roster.summary, totalRecords: a.length, activeRecords: a.filter((r) => r.active).length, field: a.filter((r) => r.active && r.placement === "field").length, shop: a.filter((r) => r.active && r.placement === "shop").length, review: a.filter((r) => r.active && r.placement === "unknown").length, excludedLifecycle: a.filter((r) => !r.active).length, sourceOnlyRecords: a.filter((r) => r.kind !== "unit").length, linkedUnitRecords: a.filter((r) => r.kind === "unit").length } };
}
function projectOwnerMap(input, controls) {
  if (!input?.uploadInventory?.records || !Array.isArray(input.fleetRoster?.items) || !Array.isArray(input.inventoryItems)) return input;
  const admitted = /* @__PURE__ */ new Map();
  for (const c of controls) {
    if (!checkedControl(c) || !c.active) continue;
    const found = input.uploadInventory.records.filter((p) => p.productId === c.productId);
    if (found.length === 1 && found[0].uploadLifecycle === "UNFLAGGED") admitted.set(c.productId, c);
  }
  if (!admitted.size) return input;
  const map = structuredClone(input), original = map.uploadInventory;
  original.ownerAddressSourceInventory = original.ownerAddressSourceInventory || { sourceSha256: original.sourceSha256, payloadSha256: original.payloadSha256, summary: { totalRecords: original.records.length }, records: original.records.map((p) => ({ productId: p.productId, placement: p.placement })) };
  const units = new Map(map.inventoryItems.map((u) => [u.id, u]));
  for (const p of original.records) {
    const c = admitted.get(p.productId);
    if (!c) continue;
    const s = c.settings;
    p.sourceAssignment = p.sourceAssignment || { placement: p.placement, customer: p.customer, sourceAddress: p.sourceAddress };
    p.placement = s.placement;
    p.customer = s.customer;
    p.site = s.site;
    p.sourceAddress = { street: s.address, city: "", state: "", zip: "" };
    p.ownerControl = c;
    const related = map.fleetRoster.items.filter((r2) => r2.productIds?.includes(p.productId));
    if (related.length !== 1 || related[0].productIds.length !== 1) {
      p.ownerControl = { ...c, projectionHold: "Multiple inventory representations need a specific identity correction." };
      continue;
    }
    const r = related[0];
    r.source = "owner";
    r.observedAt = c.updatedAt;
    r.customer = s.customer || null;
    r.sourceAddress = p.sourceAddress;
    r.placement = s.placement.toLowerCase();
    r.reviewReason = "Owner settings saved in COS. mHelp and the 2027 tracker are unchanged.";
    r.ownerControl = c;
    delete r.recordedSourcePlacement;
    if (r.kind !== "unit") {
      r.kind = "source_equipment";
      p.binding = { ...p.binding, state: "unlinked", placementHeld: false, candidateUnitIds: [], reason: null };
    } else {
      const u = units.get(r.unitId);
      if (u) {
        u.ownerControl = c;
        u.placement = s.placement;
        u.currentLocationType = s.placement.toLowerCase();
        u.status = s.placement === "FIELD" ? "field" : "available";
        u.customer = s.customer;
        u.site = s.site;
        u.address = s.address;
        u.addressSource = "owner";
        u.addressUpdatedAt = c.updatedAt;
        u.placementSource = "owner_product";
        u.effectivePlacement = { contract: "COS_EFFECTIVE_FLEET_PLACEMENT_V1", state: s.placement.toLowerCase(), source: "owner_product", freshness: "recorded", observedAt: c.updatedAt };
        if (s.latitude !== null) {
          u.latitude = s.latitude;
          u.longitude = s.longitude;
          u.coordinateSource = "owner_manual";
          u.hasUnitGps = false;
          u.locationVerification = "owner_verified";
          u.gpsRecordedAt = c.updatedAt;
          u.locationVerifiedAt = c.updatedAt;
        } else if (s.address !== [p.sourceAssignment.sourceAddress?.street, p.sourceAssignment.sourceAddress?.city, p.sourceAssignment.sourceAddress?.state, p.sourceAssignment.sourceAddress?.zip].filter(Boolean).join(", ")) {
          u.latitude = null;
          u.longitude = null;
          u.locationVerification = "address_changed";
          u.hasUnitGps = false;
        }
        r.unit = u;
      }
    }
  }
  const rec = original.records;
  original.ownerOverrides = [...admitted.values()];
  original.mhelpSourceSummary = original.mhelpSourceSummary || { ...original.summary };
  original.summary = { ...original.summary, fieldRecords: rec.filter((p) => p.placement === "FIELD").length, shopRecords: rec.filter((p) => p.placement === "SHOP").length, unflaggedFieldRecords: rec.filter((p) => p.placement === "FIELD" && p.uploadLifecycle === "UNFLAGGED").length, unflaggedShopRecords: rec.filter((p) => p.placement === "SHOP" && p.uploadLifecycle === "UNFLAGGED").length };
  map.items = map.inventoryItems.filter((u) => (u.effectivePlacement?.state || String(u.placement || u.currentLocationType).toLowerCase()) === "field" && u.activeInventoryEligible !== false);
  map.summary = { ...map.summary, fieldUnits: map.items.length, mappedUnits: map.items.filter((u) => u.latitude != null && u.longitude != null).length, unitGps: map.items.filter((u) => u.hasUnitGps).length, missingGps: map.items.filter((u) => u.latitude == null || u.longitude == null).length };
  map.fleetRoster = recount(map.fleetRoster);
  map.ownerOverrides = [...admitted.values()];
  if (map.manualPlacementOverrides?.items) map.manualPlacementOverrides.items = map.manualPlacementOverrides.items.filter((m) => !m.sourceBindings?.some((b) => admitted.has(b.productId)) && !map.inventoryItems.some((u) => u.id === m.unitId && u.ownerControl?.active));
  return map;
}
function projectOwnerConnections(receipt, controls) {
  if (receipt?.contract !== "COS_EXACT_PRODUCT_CONNECTIONS_V2" || !Array.isArray(receipt.items)) return receipt;
  const result = structuredClone(receipt);
  result.ownerOverrides = controls.filter((c) => checkedControl(c) && c.active && c.currentSourcePresent !== false);
  for (const c of controls) {
    if (!checkedControl(c) || !c.active || c.currentSourcePresent === false || (c.currentSourceLifecycle ?? c.sourceLifecycle) !== "UNFLAGGED") continue;
    if (c.settings.placement === "FIELD" && !c.settings.publicIp && !c.settings.ports.length && !c.settings.monitoringEnabled && result.items.some((p) => p.productId === c.productId)) continue;
    result.items = result.items.filter((p) => p.productId !== c.productId);
    if (c.settings.placement === "FIELD") result.items.push({ productId: c.productId, status: "unknown", basis: "tcp_service_port", resourceId: null, checkedAt: null, reason: "Owner-managed target. Its independently saved connection result is displayed on the equipment record." });
  }
  return result;
}

// ../supabase/functions/cos-owner-equipment/runtime.ts
var platform = "https://tughscoxralhofrckvxy.supabase.co";
var legacy = platform + "/functions/v1/cos-operations-pages";
var origins = /* @__PURE__ */ new Set(["https://cypressriveroasis2023-sudo.github.io", "https://cos-vision-integration-preview.pages.dev"]);
var proxyPaths = /* @__PURE__ */ new Set(["/api/field-map", "/api/fleet-map-source", "/api/product-connections"]);
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
var text = (v) => typeof v === "string" && v.trim() === v;
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
function assertTarget(productId, ip, controls, tracker2) {
  if (!publicIp(ip) || !tracker2 || !Array.isArray(tracker2.rows) || !Number.isFinite(Date.parse(tracker2.observedAt))) fail("Current target ownership cannot be checked.", 503);
  const overrides = new Map(controls.filter((c) => checkedControl(c) && c.active && c.settings.publicIp).map((c) => [c.productId, c.settings.publicIp]));
  const other = tracker2.rows.filter((r) => r.productId !== productId && (r.productId && overrides.has(r.productId) ? overrides.get(r.productId) : r.ip) === ip);
  if (other.length || controls.some((c) => checkedControl(c) && c.active && c.productId !== productId && c.settings.publicIp === ip)) fail("Another equipment record claims this IP. Correct its assignment before checking this target.", 409);
}
function createOwnerHandler(d) {
  const now = d.now || Date.now;
  const upstream = async (auth, path, method, body, signal) => d.fetch(legacy, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ path, method, body: body ?? null }), signal, redirect: "error", cache: "no-store" });
  const authenticate = async (auth, signal, write = true) => {
    if (!/^Bearer [-A-Za-z0-9_.]+$/.test(auth) || auth.length > 16e3) fail("Sign in to your existing COS Owner account.", 401);
    const response = await upstream(auth, "/api/session", "GET", null, signal);
    if (!response.ok) fail(response.status === 401 ? "Your COS sign-in expired." : "Existing Owner authorization could not be confirmed.", response.status === 401 ? 401 : 403);
    const s = await response.json();
    if (!write && s.authorized === true && s.legacyOwner === false && s.role === "IT" && s.features?.fleetAccess === true) return null;
    if (s.authorized !== true || s.legacyOwner !== true || s.role !== "Owner" || !uuid(s.productionOwnerUserId)) fail("An active linked COS Owner account is required.", 403);
    return s.productionOwnerUserId;
  };
  const check = async (pid, signal) => {
    const start = await d.rpc("cos_owner_equipment_check_v1", { p_product: pid, p_action: "begin" }, signal);
    if (start.state === "already_running") return start;
    if (start.state !== "ready" || !uuid(start.ticket)) fail("A saved checking lease could not be established.", 503);
    const settings = validateSettings(start.settings);
    let result;
    try {
      const [controls, before] = await Promise.all([d.rpc("cos_owner_equipment_list_v1", {}, signal), d.tracker(signal)]);
      assertTarget(pid, settings.publicIp, controls, before);
      const outcomes = [];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(8, settings.ports.length) }, async () => {
        for (; ; ) {
          const port = settings.ports[cursor++];
          if (port === void 0) return;
          signal.throwIfAborted();
          const r = await d.probe(settings.publicIp, port, signal);
          outcomes.push({ port, ...r });
        }
      }));
      if (outcomes.length !== settings.ports.length || outcomes.some((r) => !["responded", "no_response"].includes(r.outcome))) fail("A technical error interrupted the check. The last completed result is retained.", 503);
      const [current, after] = await Promise.all([d.rpc("cos_owner_equipment_list_v1", {}, signal), d.tracker(signal)]);
      assertTarget(pid, settings.publicIp, current, after);
      result = { status: outcomes.some((r) => r.outcome === "responded") ? "online" : "offline", publicIp: settings.publicIp, ports: settings.ports, outcomes: outcomes.sort((a, b) => a.port - b.port), checkedAt: new Date(now()).toISOString(), sourceReadAt: before.observedAt, sourceRecheckedAt: after.observedAt };
    } catch (e) {
      result = { status: "unknown", reason: signal.aborted ? "Check cancelled or timed out; last completed reading retained." : e instanceof Error ? e.message.slice(0, 500) : "The check could not complete." };
    }
    return d.rpc("cos_owner_equipment_check_v1", { p_product: pid, p_action: "finish", p_ticket: start.ticket, p_revision: start.connectionRevision, p_result: result }, AbortSignal.timeout(8e3));
  };
  return async (req) => {
    const origin = req.headers.get("origin"), headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
    if (origin && origins.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "authorization,content-type";
      headers["Access-Control-Allow-Methods"] = "POST,OPTIONS";
    }
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !origins.has(origin)) return json({ error: "Origin is not allowed." }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return json({ error: "POST required." }, 405);
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(11e4)]);
    try {
      const cron = req.headers.get("x-cos-owner-cron");
      if (cron) {
        if (cron.length !== 64 || !await d.rpc("cos_owner_equipment_cron_authorized_v1", { p_secret: cron }, signal)) fail("Forbidden.", 403);
        const controls = await d.rpc("cos_owner_equipment_list_v1", {}, signal);
        const queue = controls.filter((c) => checkedControl(c) && c.active && c.settings.monitoringEnabled && c.currentSourceEligible === true).sort((a, b) => (Date.parse(a.lastAttempt?.at) || 0) - (Date.parse(b.lastAttempt?.at) || 0));
        const results = [];
        let cursor = 0;
        const began = now();
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
          while (now() - began < 75e3 && !signal.aborted) {
            const c = queue[cursor++];
            if (!c) return;
            try {
              const r = await check(c.productId, signal);
              results.push({ productId: c.productId, checkSaved: r.checkSaved === true, state: r.lastAttempt?.state || r.state });
            } catch {
              results.push({ productId: c.productId, checkSaved: false, state: "failed" });
            }
          }
        }));
        return json({ contract: "COS_OWNER_EQUIPMENT_SWEEP_V1", attempted: results.length, deferred: Math.max(0, queue.length - results.length), completed: results.filter((r) => r.checkSaved).length, results });
      }
      const auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ") || auth.length > 16e3) fail("Sign in to your existing COS account.", 401);
      if (Number(req.headers.get("content-length")) > 2e4) fail("Request too large.", 413);
      const raw = await req.text();
      if (raw.length > 2e4) fail("Request too large.", 413);
      let packet;
      try {
        packet = JSON.parse(raw);
      } catch {
        fail("Invalid request body.");
      }
      if (!packet || !text(packet.path) || !["GET", "POST"].includes(packet.method) || Object.keys(packet).some((k) => !["path", "method", "body"].includes(k))) fail("Unsupported request.");
      const { path, method, body } = packet;
      if (path === "/api/product-connections/verify" && method === "POST") {
        await authenticate(auth, signal, false);
        if (!body || Object.keys(body).join(",") !== "productIds" || !Array.isArray(body.productIds) || !body.productIds.length || body.productIds.length > 16 || new Set(body.productIds).size !== body.productIds.length || body.productIds.some((id) => typeof id !== "string" || !/^[1-9][0-9]{0,14}$/.test(id))) fail("Select 1 to 16 distinct equipment Product IDs.");
        const controls = await d.rpc("cos_owner_equipment_list_v1", {}, signal), owned = body.productIds.filter((id) => controls.some((c) => c.productId === id && c.active && (c.settings.publicIp || c.settings.ports.length || c.settings.monitoringEnabled)));
        if (!owned.length) {
          const r = await upstream(auth, path, method, body, signal);
          return json(await r.json(), r.status);
        }
        const other = body.productIds.filter((id) => !owned.includes(id));
        let receipt = null;
        const verdicts = [];
        const existing = other.length ? (async () => {
          const r = await upstream(auth, path, method, { productIds: other }, signal);
          const v = await r.json();
          if (r.ok && v.contract === "COS_VERIFY_PRODUCTS_NOW_V1") {
            receipt = v.connections;
            verdicts.push(...v.items);
          } else verdicts.push(...other.map((id) => ({ productId: id, status: "unknown", checkedAt: null, reason: "The existing camera checker could not complete. Previously saved results were retained." })));
        })().catch(() => {
          verdicts.push(...other.filter((id) => !verdicts.some((v) => v.productId === id)).map((id) => ({ productId: id, status: "unknown", checkedAt: null, reason: "The existing camera checker could not complete. Previous saved readings were retained." })));
        }) : Promise.resolve();
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, owned.length) }, async () => {
          for (; ; ) {
            const id = owned[cursor++];
            if (!id) return;
            try {
              const result = await check(id, signal), c = ownerConnection(result, now());
              verdicts.push({ productId: id, status: result.checkSaved && c ? c.status : "unknown", checkedAt: result.checkSaved && c?.status !== "unknown" ? c?.checkedAt : null, reason: result.checkSaved ? c?.reason : result.lastAttempt?.reason || "A new Owner-configured check is not confirmed." });
            } catch (e) {
              verdicts.push({ productId: id, status: "unknown", checkedAt: null, reason: e instanceof Error ? e.message : "Check not confirmed." });
            }
          }
        }));
        await existing;
        if (!receipt) {
          try {
            const r = await upstream(auth, "/api/product-connections", "GET", null, signal);
            if (r.ok) receipt = await r.json();
          } catch {
          }
        }
        const latest = await d.rpc("cos_owner_equipment_list_v1", {}, signal);
        return json({ contract: "COS_VERIFY_PRODUCTS_NOW_V1", items: body.productIds.map((id) => verdicts.find((v) => v.productId === id)), connections: projectOwnerConnections(receipt, latest) });
      }
      if (proxyPaths.has(path)) {
        if (method !== "GET") fail("This route only reads saved data.", 405);
        const response = await upstream(auth, path, method, null, signal);
        const value = await response.json();
        if (!response.ok) return json(value, response.status);
        const controls = await d.rpc("cos_owner_equipment_list_v1", {}, signal);
        return json(path === "/api/product-connections" ? projectOwnerConnections(value, controls) : projectOwnerMap(value, controls));
      }
      const m = /^\/api\/owner-equipment\/([1-9][0-9]{0,14})(?:\/(check|tracker))?$/.exec(path);
      if (!m) fail("Unsupported Owner equipment route.", 404);
      const actor = await authenticate(auth, signal), pid = m[1];
      if (m[2] === "tracker" && method === "GET") {
        await d.rpc("cos_owner_equipment_record_v1", { p_product_id: pid }, signal);
        const tracker2 = await d.tracker(signal), matches = tracker2.rows.filter((r) => r.productId === pid);
        if (matches.length !== 1) fail("The 2027 tracker has no unique row for this exact Product ID.", 409);
        return json({ productId: pid, publicIp: matches[0].ip, observedAt: tracker2.observedAt, source: "2027 UNIT TRACKER", ports: null });
      }
      if (m[2] === "check" && method === "POST") return json(await check(pid, signal));
      if (m[2]) fail("Unsupported method.", 405);
      if (method === "GET") return json(await d.rpc("cos_owner_equipment_record_v1", { p_product_id: pid }, signal));
      if (!body || Object.keys(body).sort().join("|") !== "action|endpointConfirmed|expectedRevision|reason|requestId|settings" || !uuid(body.requestId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !["save", "release"].includes(body.action) || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 1e3 || typeof body.endpointConfirmed !== "boolean") fail("Reload settings and provide a correction reason.");
      let settings = {};
      try {
        if (body.action === "save") settings = validateSettings(body.settings);
      } catch (e) {
        fail(e instanceof Error ? e.message : "Invalid settings.", 400);
      }
      if (body.action === "save" && settings.publicIp && !body.endpointConfirmed) fail("Confirm that this IP belongs to the selected equipment Product ID.");
      return json(await d.rpc("cos_owner_equipment_save_v1", { p_actor: actor, p_product_id: pid, p_expected: body.expectedRevision, p_request: body.requestId, p_action: body.action, p_settings: settings, p_reason: body.reason.trim() }, signal));
    } catch (e) {
      const code = e?.code, status = e?.status || (["40001", "23505"].includes(code) ? 409 : code === "42501" ? 403 : code === "P0002" ? 404 : code === "22023" ? 400 : 503);
      const message = typeof e?.message === "string" && (e.status || ["40001", "23505", "42501", "P0002", "22023", "55000"].includes(code)) ? e.message : "Owner equipment operation could not complete. Saved settings and previous readings were retained. Reload before retrying.";
      return json({ error: message }, status);
    }
  };
}

// ../supabase/functions/cos-owner-equipment/index.ts
var base = Deno.env.get("SUPABASE_URL");
var key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var rpc = async (name, args, signal) => {
  const r = await fetch(base + "/rest/v1/rpc/" + name, { method: "POST", headers: { Authorization: "Bearer " + key, apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(args), signal, redirect: "error", cache: "no-store" });
  const v = await r.json();
  if (!r.ok) throw Object.assign(Error(v.message || "Database operation failed."), { code: v.code });
  return v;
};
var b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
var token = null;
async function sheetToken(signal) {
  if (token && token.until > Date.now() + 6e4) return token.value;
  let account;
  try {
    account = JSON.parse(Deno.env.get("COS_GOOGLE_SERVICE_ACCOUNT_JSON") || "");
  } catch {
    throw Error("2027 tracker credentials are unavailable.");
  }
  if (!account.client_email || !account.private_key) throw Error("2027 tracker credentials are incomplete.");
  const encode = (v2) => b64(new TextEncoder().encode(JSON.stringify(v2))), iat = Math.floor(Date.now() / 1e3);
  const data = encode({ alg: "RS256", typ: "JWT", kid: account.private_key_id }) + "." + encode({ iss: account.client_email, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600, scope: "https://www.googleapis.com/auth/spreadsheets.readonly" });
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const signing = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signing, new TextEncoder().encode(data)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: data + "." + b64(signature) }), signal, redirect: "error" });
  const v = await r.json();
  if (!r.ok || typeof v.access_token !== "string" || v.token_type !== "Bearer") throw Error("2027 tracker authorization failed.");
  token = { value: v.access_token, until: Date.now() + Math.min(Number(v.expires_in) || 0, 3300) * 1e3 };
  return token.value;
}
async function tracker(parent) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(2e4)]), access = await sheetToken(signal);
  const base2 = "https://sheets.googleapis.com/v4/spreadsheets/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
  const get = async (url, max = 22e5) => {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + access }, signal, redirect: "error", cache: "no-store" });
    if (!r.ok || Number(r.headers.get("content-length")) > max) throw Error("2027 tracker read failed.");
    const text2 = await r.text();
    if (text2.length > max) throw Error("2027 tracker exceeds its complete-read limit.");
    return JSON.parse(text2);
  };
  const meta = await get(base2 + "?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))", 25e4);
  const sheets = meta.sheets?.filter((s2) => s2.properties?.sheetId === 1132540236), s = sheets?.[0]?.properties;
  if (meta.properties?.title !== "2027 UNIT TRACKER" || sheets?.length !== 1 || s.title !== "UNIT OVERVIEW" || !Number.isSafeInteger(s.gridProperties?.rowCount) || s.gridProperties.rowCount > 12e3 || s.gridProperties.rowCount < 2 || s.gridProperties.columnCount < 19) throw Error("The complete 2027 tracker structure could not be verified.");
  const result = await get(base2 + "/values/" + encodeURIComponent("'UNIT OVERVIEW'!A1:S" + s.gridProperties.rowCount) + "?valueRenderOption=FORMATTED_VALUE");
  const a = result.values;
  if (!Array.isArray(a) || a[0]?.[0] !== "EQUIPMENT TYPE" || !/^IP(?: ADDRESS)?$/i.test(a[0]?.[7] || "") || a[0]?.[14] !== "MHELP EQUIPMENT ID") throw Error("2027 Product ID and IP columns need review.");
  const rows = a.slice(1).filter((r) => r.some((v) => String(v).trim() !== "")).map((r) => ({ productId: /^[1-9][0-9]{0,14}$/.test(String(r[14] || "")) ? String(r[14]) : null, ip: String(r[7] || "").trim() || null }));
  const ids = rows.flatMap((r) => r.productId ? [r.productId] : []);
  if (new Set(ids).size !== ids.length) throw Error("Duplicate Product IDs prevent a safe endpoint check.");
  return { rows, observedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
async function probe(host, port, signal) {
  if (!publicIp(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error("Unsupported target.");
  const started = Date.now(), abort = new AbortController(), timer = setTimeout(() => abort.abort(), 2200);
  let conn;
  try {
    conn = await Deno.connect({ hostname: host, port, signal: AbortSignal.any([signal, abort.signal]) });
    return { outcome: "responded", latencyMs: Date.now() - started };
  } catch (e) {
    if (signal.aborted) throw e;
    const message = e instanceof Error ? e.message : "";
    if (abort.signal.aborted || /Connection refused \(os error 111\)|Connection timed out \(os error 110\)/.test(message)) return { outcome: "no_response", latencyMs: null };
    throw Error("The network check failed technically; no Offline reading was created.");
  } finally {
    clearTimeout(timer);
    try {
      conn?.close();
    } catch {
    }
  }
}
Deno.serve(createOwnerHandler({ rpc, fetch, tracker, probe }));
