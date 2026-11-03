
// COS_STAR4LIVE_SCHEDULED_PING_20261102 BEGIN
var CosStar4LiveScheduledPing20261102 = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../supabase/functions/_shared/scheduledStar4LiveService.ts
  var scheduledStar4LiveService_exports = {};
  __export(scheduledStar4LiveService_exports, {
    collectScheduledStar4Live: () => collectScheduledStar4Live
  });

  // ../supabase/functions/_shared/scheduledDirectService.ts
  function directPublicHost(value) {
    if (typeof value !== "string") return null;
    const host = value.replace(/\/32$/, ""), parts = host.split(".");
    if (parts.length !== 4 || parts.some((p) => !/^(?:0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return null;
    const [a, b, c] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return null;
    return host;
  }
  var IO_TIMEOUT_MS = 4e3;
  async function boundedRequest(make, deadline, now = () => Date.now(), timeout = IO_TIMEOUT_MS) {
    const remaining = Math.min(timeout, deadline - now());
    if (remaining <= 0) throw Error("Sweep deadline reached");
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([Promise.resolve(make(controller.signal)), new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("Sweep request timed out"));
        }, remaining);
      })]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  // ../supabase/functions/_shared/scheduledStar4LiveService.ts
  var FIELDS = "id,source,unit_key,device_name,organization,activation_state,monitoring_enabled,public_ip,expected_ports,connection_revision,monitoring_profile";
  var terminal = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
  var id = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v) ? v : null;
  var revision = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? v : null;
  function configuration(d) {
    if (!d || typeof d !== "object" || !id(d.id) || d.source !== "vigilant_control_center" || d.monitoring_enabled !== true || d.activation_state !== "active" || [d.unit_key, d.device_name, d.organization, d.activation_state].some(terminal) || ![null, void 0, "nvr", "solar_spotter", "ranger", "helios"].includes(d.monitoring_profile)) return null;
    const host = directPublicHost(d.public_ip), ports = d.expected_ports;
    if (!host || revision(d.connection_revision) === null || !Array.isArray(ports) || !ports.length || ports.length > 32 || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) || new Set(ports).size !== ports.length) return null;
    return { host, ports: [...ports].sort((a, b) => a - b), fingerprint: JSON.stringify(FIELDS.split(",").map((k) => d[k] ?? null)) };
  }
  function completed(v) {
    if (!v || typeof v !== "object") return false;
    const p = v;
    if (typeof p.online !== "boolean" || !(p.latency_ms === null || typeof p.latency_ms === "number" && Number.isFinite(p.latency_ms) && p.latency_ms >= 0)) return false;
    return p.online ? p.latency_ms !== null && !p.error : typeof p.error === "string" && ["timeout", "Connection refused (os error 111)", "Connection timed out (os error 110)"].includes(p.error);
  }
  async function collectScheduledStar4Live(db, probe, options = {}) {
    const now = options.now ?? Date.now, start = options.startedAt ?? now(), deadline = start + Math.min(95e3, options.deadlineMs ?? 95e3), workers = 15;
    const call = (fn) => boundedRequest((s) => fn(options.signal ? AbortSignal.any([s, options.signal]) : s), deadline, now, options.ioTimeoutMs ?? 4e3);
    const seed = [];
    for (let offset2 = 0; offset2 < 1e4; offset2 += 1e3) {
      options.signal?.throwIfAborted();
      const r = await call((s) => db.from("camera_devices").select(FIELDS).eq("source", "vigilant_control_center").order("id").range(offset2, offset2 + 999).abortSignal(s));
      if (r.error || !Array.isArray(r.data) || r.data.length > 1e3) throw Error("Star4Live saved inventory unavailable");
      seed.push(...r.data);
      if (r.data.length < 1e3) break;
      if (offset2 === 9e3) throw Error("Star4Live inventory truncated");
    }
    if (new Set(seed.map((d) => id(d.id))).size !== seed.length || seed.some((d) => !id(d.id))) throw Error("Star4Live duplicate resource ID");
    const active = seed.filter((d) => d.source === "vigilant_control_center" && d.monitoring_enabled === true && d.activation_state === "active");
    const candidates = active.map((d) => ({ device: d, config: configuration(d) })).filter((c) => c.config !== null);
    const held = active.length - candidates.length;
    const health = candidates.length ? await call((s) => db.from("camera_health_current").select("camera_device_id,port_status").in("camera_device_id", candidates.map((c) => c.device.id)).abortSignal(s)) : { data: [] };
    if (health.error || !Array.isArray(health.data) || new Set(health.data.map((h) => String(h.camera_device_id))).size !== health.data.length) throw Error("Star4Live prior checks unavailable");
    const times = new Map(health.data.map((h) => [String(h.camera_device_id), Date.parse(h.port_status?._connection?.checkedAt) || 0]));
    const oldest = [...candidates].sort((a, b) => Number(times.get(String(a.device.id)) ?? 0) - Number(times.get(String(b.device.id)) ?? 0) || Number(a.device.id) - Number(b.device.id));
    const offset = oldest.length ? Math.floor(start / 9e5) * workers % oldest.length : 0;
    const reserved = oldest.length ? Array.from({ length: Math.min(workers, oldest.length) }, (_, i) => oldest[(offset + i) % oldest.length]) : [], ids = new Set(reserved.map((c) => String(c.device.id)));
    const queue = [...reserved, ...oldest.filter((c) => !ids.has(String(c.device.id)))], results = [], transport = /* @__PURE__ */ new Map();
    let cursor = 0;
    while (cursor < queue.length && !options.signal?.aborted && now() + 3300 < deadline) {
      const wave = queue.slice(cursor, cursor + workers);
      cursor += wave.length;
      const observations = await Promise.all(wave.map((c) => {
        const { host, ports } = c.config, key = JSON.stringify([host, ports]), cached = transport.get(key);
        if (cached && now() - cached.startedAt >= 0 && now() - cached.startedAt < 3e4) return cached.observation;
        const startedAt = now();
        const observation = (async () => {
          try {
            const atStart = now(), values = await Promise.all(ports.map(async (p) => [String(p), await call(() => probe(host, p, 2200))])), at = now();
            if (options.signal?.aborted || at < atStart || at - atStart > 2700 || values.some(([, v]) => !completed(v))) return null;
            return { ports: Object.fromEntries(values), at };
          } catch {
            return null;
          }
        })();
        transport.set(key, { startedAt, observation });
        return observation;
      }));
      let current;
      try {
        const r = await call((s) => db.from("camera_devices").select(FIELDS).eq("source", "vigilant_control_center").in("id", wave.map((c) => c.device.id)).abortSignal(s));
        if (r.error || !Array.isArray(r.data) || new Set(r.data.map((d) => id(d.id))).size !== r.data.length) throw Error("Changed");
        current = r.data;
      } catch {
        results.push(...wave.map((c) => ({ id: c.device.id, published: false, reason: "configuration_unavailable" })));
        continue;
      }
      await Promise.all(wave.map(async (c, i) => {
        const observed = observations[i], matches = current.filter((d) => String(d.id) === String(c.device.id)), fresh = matches.length === 1 ? configuration(matches[0]) : null;
        const hold = (reason) => results.push({ id: c.device.id, published: false, reason });
        if (!observed) return hold("probe_incomplete");
        if (!fresh || fresh.fingerprint !== c.config.fingerprint) return hold("configuration_changed");
        if (options.signal?.aborted || now() >= deadline || now() - observed.at > 6e4) return hold("observation_expired");
        const reachable = Object.values(observed.ports).some((p) => p.online), checked = new Date(observed.at).toISOString();
        const patch = { camera_device_id: c.device.id, port_status: observed.ports, checked_at: checked, overall_status: reachable ? "online" : "offline", ip_reachable: reachable, consecutive_failures: reachable ? 0 : 1, confirmed_outage: false, confirmation_reason: null };
        try {
          const saved = await call((s) => db.rpc("publish_camera_connection_v1", { p_device_id: c.device.id, p_revision: c.device.connection_revision, p_public_ip: c.device.public_ip, p_expected_ports: c.device.expected_ports, p_monitoring_profile: c.device.monitoring_profile ?? null, p_health: patch, p_source: "automatic_tcp_sweep" }).abortSignal(s));
          if (saved.error || saved.data?.ok !== true) return hold(saved.data?.reason || "publication_unconfirmed");
          results.push({ id: c.device.id, published: true, status: reachable ? "online" : "offline", checkedAt: checked });
        } catch {
          return hold("publication_unconfirmed");
        }
      }));
    }
    return { source: "star4live_saved_tcp_ports", eligible: candidates.length, held, scanned: results.length, published: results.filter((r) => r.published).length, deferred: queue.length - cursor, complete: !options.signal?.aborted && held === 0 && cursor === queue.length && results.every((r) => r.published), results };
  }
  return __toCommonJS(scheduledStar4LiveService_exports);
})();

// COS_STAR4LIVE_SCHEDULED_PING_20261102 END
