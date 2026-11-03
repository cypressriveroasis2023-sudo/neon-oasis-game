
// COS_TRACKER_IP_REACHABILITY_20261102 BEGIN
var CosTrackerIpReachability20261102 = (() => {
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

  // <stdin>
  var stdin_exports = {};
  __export(stdin_exports, {
    buildTrackerIpReachability: () => buildTrackerIpReachability
  });

  // src/mhelpInventoryAuthority.ts
  var record = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
  var nonnegative = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  var product = /^[1-9][0-9]{0,14}$/;
  function readMhelpInventoryAuthority(value, now = Date.now()) {
    if (!record(value) || value.contract !== "COS_MHELP_UPLOAD_INVENTORY_V1" || value.countBasis !== "mhelp_product_records_not_unique_physical_units" || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || typeof value.receivedAt !== "string" || !Number.isFinite(Date.parse(value.receivedAt)) || !Number.isFinite(now) || Date.parse(value.receivedAt) > now + 6e4 || !record(value.summary) || !Array.isArray(value.records)) return null;
    const s = value.summary, records = value.records;
    if (!nonnegative(s.totalRecords) || !nonnegative(s.fieldRecords) || !nonnegative(s.shopRecords) || !nonnegative(s.unflaggedFieldRecords) || !nonnegative(s.doNotUseRecords) || !nonnegative(s.missingRecords) || s.totalRecords !== records.length || s.totalRecords !== s.fieldRecords + s.shopRecords || s.unflaggedFieldRecords > s.fieldRecords || s.doNotUseRecords + s.missingRecords > s.totalRecords) return null;
    const seen = /* @__PURE__ */ new Set();
    let field = 0, shop = 0, fieldActive = 0, inactive = 0;
    for (const item of records) {
      if (!record(item) || typeof item.productId !== "string" || !product.test(item.productId) || seen.has(item.productId) || item.recordId !== "mhelp_product:" + item.productId || !["FIELD", "SHOP"].includes(item.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(item.uploadLifecycle)) return null;
      seen.add(item.productId);
      if (item.placement === "FIELD") {
        field++;
        if (item.uploadLifecycle === "UNFLAGGED") fieldActive++;
      } else shop++;
      if (item.uploadLifecycle !== "UNFLAGGED") inactive++;
    }
    if (field !== s.fieldRecords || shop !== s.shopRecords || fieldActive !== s.unflaggedFieldRecords || inactive !== s.doNotUseRecords + s.missingRecords) return null;
    const live = value.source === "mhelpdesk_api";
    const observedAt = live ? value.lastApiReadAt : value.receivedAt;
    if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now + 6e4) return null;
    return {
      total: records.length,
      field,
      shop,
      inactive,
      fieldActive,
      ...live ? { live: true } : {},
      sourceSha256: value.sourceSha256,
      receivedAt: observedAt,
      // The saved upload is historical evidence, not proof of a live vendor read.
      stale: now - Date.parse(observedAt) > (live ? 45 * 60 * 1e3 : 24 * 60 * 60 * 1e3)
    };
  }

  // src/cameraEvidence.ts
  var CAMERA_FRESH_MS = 20 * 60 * 1e3;
  function cameraTimestamp(value, now = Date.now()) {
    if (typeof value !== "string") return { at: null, fresh: false };
    const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
    const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
    const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
    const parsed = valid ? Date.parse(value.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
    return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS } : { at: null, fresh: false };
  }

  // ../supabase/functions/cos-operations-pages/cameraEvidence.ts
  var CAMERA_FRESH_MS2 = 20 * 60 * 1e3;
  function savedCameraConnection(ip, ports) {
    if (typeof ip !== "string") return void 0;
    const address = ip.replace(/\/32$/, "");
    const parts = address.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return void 0;
    const a = Number(parts[0]), b = Number(parts[1]), c = Number(parts[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return void 0;
    return { publicIp: address, ports: Array.isArray(ports) ? [...new Set(ports.filter((p) => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535))].sort((a2, b2) => a2 - b2) : [] };
  }

  // src/exactProductConnection.ts
  var EXACT_PRODUCT_CONNECTION_CONTRACT = "COS_EXACT_PRODUCT_CONNECTIONS_V2";
  var VERIFIED_TRACKER_IP_CONTRACT = "COS_VERIFIED_2027_PRODUCT_IPS_V1";
  var TRACKER_CONNECTION_CENSUS_V2 = "COS_VERIFIED_2027_PRODUCT_IPS_V2";
  var TRACKER_CONNECTION_HOLDS = ["placement_mismatch", "customer_mismatch", "identity_mismatch", "tracker_restriction"];
  var TRACKER_IP_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
  var ID = /^[1-9][0-9]{0,14}$/;
  var HASH = /^[a-f0-9]{64}$/;
  var SOURCE_FRESH_MS = 30 * 60 * 1e3;
  var object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
  var safeTime = (v, now, windowMs) => {
    if (typeof v !== "string") return null;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= now && now - parsed <= windowMs ? new Date(parsed).toISOString() : null;
  };
  var unknown = (productId, reason) => ({
    productId,
    status: "unknown",
    basis: "tcp_service_port",
    checkedAt: null,
    resourceId: null,
    reason
  });
  var publicIp = (value) => {
    if (typeof value !== "string" || !value || value !== value.trim()) return null;
    const saved = savedCameraConnection(value, []);
    return saved?.publicIp === value ? value : null;
  };
  var revision = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
  var validPortNonresponseError = (v) => v === void 0 || v === null || v === "timeout" || v === "Connection refused (os error 111)" || v === "Connection timed out (os error 110)";
  var completedPortOutcome = (v) => {
    if (!object(v) || typeof v.online !== "boolean" || v.attempted === false || v.attempted !== void 0 && v.attempted !== true || v.errorCode || v.error_code || v.technicalError) return false;
    const hasLatency = typeof v.latency_ms === "number" && Number.isFinite(v.latency_ms) && v.latency_ms >= 0;
    const measured = Object.hasOwn(v, "latency_ms") && (v.latency_ms === null || hasLatency);
    if (v.online) return (v.error === void 0 || v.error === null) && (v.attempted === true || hasLatency);
    return validPortNonresponseError(v.error) && (v.attempted === true || typeof v.error === "string" && measured);
  };
  var deviceId = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && ID.test(v) ? v : null;
  function completedSavedTcpCheck(device, now = Date.now()) {
    if (device.monitoringEnabled !== true || !deviceId(device.deviceId)) return null;
    const ip = publicIp(device.publicIp), rev = revision(device.connectionRevision);
    if (!ip || rev === null || !Array.isArray(device.expectedPorts) || !device.expectedPorts.length || device.expectedPorts.length > 128 || !object(device.portStatus)) return null;
    const ports = device.expectedPorts;
    if (new Set(ports).size !== ports.length || ports.some((v) => !Number.isInteger(v) || v < 1 || v > 65535)) return null;
    const proof = device.portStatus._connection;
    if (!object(proof) || proof.ip !== ip || revision(proof.revision) !== rev || !["online", "offline", "verifying"].includes(proof.status) || typeof proof.reachable !== "boolean" || proof.error || proof.errorCode || proof.error_code) return null;
    const observed = cameraTimestamp(proof.checkedAt, now);
    if (!observed.fresh || !observed.at) return null;
    const checkedAt = observed.at;
    const observedPorts = Object.keys(device.portStatus).filter((k) => /^[1-9][0-9]{0,4}$/.test(k) && Number(k) <= 65535);
    if (observedPorts.length !== ports.length || ports.some((p) => !observedPorts.includes(String(p)))) return null;
    const states = ports.map((port) => device.portStatus[String(port)]);
    if (states.some((v) => !completedPortOutcome(v))) return null;
    const responded = states.some((v) => v.online === true);
    if (responded && proof.status === "online" && proof.reachable === true) return {
      status: "online",
      basis: "tcp_service_port",
      checkedAt,
      resourceId: deviceId(device.deviceId),
      reason: "Completed saved TCP/service-port check responded. Camera video is not verified."
    };
    if (!responded && ["offline", "verifying"].includes(proof.status) && proof.reachable === false) return {
      status: "offline",
      basis: "tcp_service_port",
      checkedAt,
      resourceId: deviceId(device.deviceId),
      reason: "Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified."
    };
    return null;
  }
  function buildProductConnections(acceptedMhelp, tracker, devices, now = Date.now(), resourceMembership, reachabilityOnly = false) {
    const authority = readMhelpInventoryAuthority(acceptedMhelp, now);
    if (!authority || authority.stale || !object(tracker) || ![VERIFIED_TRACKER_IP_CONTRACT, TRACKER_CONNECTION_CENSUS_V2].includes(tracker.contract) || tracker.workbookId !== TRACKER_IP_WORKBOOK || tracker.expectedMhelpSourceSha256 !== authority.sourceSha256 || !HASH.test(tracker.expectedMhelpSourceSha256) || !safeTime(tracker.verifiedAt, now, SOURCE_FRESH_MS) || !Array.isArray(tracker.records) || tracker.records.length !== authority.total || !Array.isArray(devices) || devices.length > 1e4) return null;
    const isolated = tracker.contract === TRACKER_CONNECTION_CENSUS_V2;
    if (reachabilityOnly && !isolated) return null;
    if (isolated && (!HASH.test(tracker.trackerSourceSha256) || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(tracker.sourceExport))) return null;
    const products = acceptedMhelp.records;
    const expected = new Map(products.map((p) => [p.productId, p]));
    const byProduct = /* @__PURE__ */ new Map();
    const ipClaims = /* @__PURE__ */ new Map(), sourceRows = /* @__PURE__ */ new Set();
    for (const raw of tracker.records) {
      if (!object(raw) || typeof raw.productId !== "string" || !ID.test(raw.productId) || byProduct.has(raw.productId) || raw.recordId !== "mhelp_product:" + raw.productId || !["FIELD", "SHOP"].includes(raw.placement) || !expected.has(raw.productId) || !(raw.publicIp === null || typeof raw.publicIp === "string" && raw.publicIp.length <= 80)) return null;
      const mismatch = expected.get(raw.productId)?.placement !== raw.placement;
      if (isolated) {
        if (!Number.isSafeInteger(raw.sourceRow) || raw.sourceRow < 2 || raw.sourceRow > 12e3 || sourceRows.has(raw.sourceRow) || !Array.isArray(raw.reviewReasons) || new Set(raw.reviewReasons).size !== raw.reviewReasons.length || raw.reviewReasons.some((reason) => !TRACKER_CONNECTION_HOLDS.includes(reason)) || mismatch !== raw.reviewReasons.includes("placement_mismatch")) return null;
        sourceRows.add(raw.sourceRow);
      } else if (mismatch || raw.reviewReasons !== void 0) return null;
      const row = raw;
      byProduct.set(raw.productId, row);
      if (publicIp(row.publicIp)) ipClaims.set(row.publicIp, (ipClaims.get(row.publicIp) || 0) + 1);
    }
    if (byProduct.size !== expected.size || [...expected.keys()].some((id) => !byProduct.has(id))) return null;
    const endpoints = /* @__PURE__ */ new Map(), endpointIds = /* @__PURE__ */ new Set();
    for (const device of devices) {
      if (!object(device) || !deviceId(device.deviceId) || !Array.isArray(device.expectedPorts)) return null;
      if (reachabilityOnly && endpointIds.has(String(device.deviceId))) return null;
      endpointIds.add(String(device.deviceId));
      const ip = publicIp(device.publicIp);
      if (!ip) continue;
      const list = endpoints.get(ip) || [];
      list.push(device);
      endpoints.set(ip, list);
    }
    const items = products.filter((p) => p.placement === "FIELD").map((product2) => {
      const pid = product2.productId, row = byProduct.get(pid);
      if (row.reviewReasons?.length) return unknown(pid, "Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.");
      if (product2.uploadLifecycle !== "UNFLAGGED") return unknown(pid, "Inactive, Missing or Do Not Use source; no operational connection is claimed.");
      const binding = object(product2.binding) ? product2.binding : null;
      if (binding?.state === "held" || binding?.placementHeld === true || Array.isArray(binding?.candidateUnitIds) && binding.candidateUnitIds.length > 0)
        return unknown(pid, "Equipment identity or placement is held for review.");
      const ip = publicIp(row.publicIp);
      if (!ip) return unknown(pid, "No verified public tracker IP is available for this Product ID.");
      if (ipClaims.get(ip) !== 1) return unknown(pid, "Another Product ID claims this tracker IP; verify endpoint ownership.");
      const devicesForIp = endpoints.get(ip) || [];
      if (reachabilityOnly) {
        const active = devicesForIp.filter((d) => d.monitoringEnabled === true && (d.activationState === void 0 || d.activationState === "active"));
        if (!active.length) return unknown(pid, "No enabled service-port check configuration matches the current tracker IP.");
        const checks = active.map((d) => completedSavedTcpCheck(d, now));
        if (checks.some((c) => !c)) return unknown(pid, "No fresh, completed check covers every enabled service-port configuration at this tracker IP.");
        const completed = checks;
        const positive = completed.find((c) => c.status === "online"), result2 = positive || completed[0];
        const oldest = completed.map((c) => c.checkedAt).sort()[0];
        return {
          productId: pid,
          ...result2,
          checkedAt: oldest,
          reason: positive ? "Completed service-port checks responded at this Product ID\u2019s current tracker IP. Equipment identity, video and recording are not verified." : "Completed service-port checks had no response at this Product ID\u2019s current tracker IP. Equipment identity, video and recording are not verified."
        };
      }
      if (devicesForIp.length !== 1) return unknown(pid, devicesForIp.length ? "More than one saved endpoint claims this tracker IP; verify exact device ownership." : "No saved camera endpoint matches the current tracker IP.");
      const result = completedSavedTcpCheck(devicesForIp[0], now);
      if (!result) return unknown(pid, "No fresh, completed, exact-target TCP/service-port check is available.");
      if (!resourceMembership?.get(pid)?.includes(String(devicesForIp[0].deviceId))) return unknown(pid, "No current verified Product-to-resource membership is available for this saved endpoint.");
      return { productId: pid, ...result };
    });
    if (items.length !== authority.field) return null;
    return { contract: EXACT_PRODUCT_CONNECTION_CONTRACT, sourceSha256: authority.sourceSha256, trackerVerifiedAt: safeTime(tracker.verifiedAt, now, SOURCE_FRESH_MS), items };
  }
  function buildTrackerIpReachability(acceptedMhelp, tracker, devices, now = Date.now()) {
    return buildProductConnections(acceptedMhelp, tracker, devices, now, void 0, true);
  }
  return __toCommonJS(stdin_exports);
})();

var buildTrackerIpReachability=CosTrackerIpReachability20261102.buildTrackerIpReachability;
// COS_TRACKER_IP_REACHABILITY_20261102 END
