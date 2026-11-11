// tech-checks/operations/shared-snapshot-review/sharedCameraCycle.mjs
function sharedCameraCycle({ authorize, ledger, readSource, collect, project, now = Date.now, budgetMs = 12e4 }) {
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1e3 || budgetMs > 12e4) throw Error("Bounded cycle required");
  return {
    read: async (request) => {
      await authorize(request, "read");
      return ledger.read();
    },
    run: async (request) => {
      const principal = await authorize(request, "run");
      if (!principal || !["scheduled", "manual"].includes(principal.trigger) || principal.trigger === "manual" && !principal.employeeId) throw Error("Verified initiator required");
      request?.signal?.throwIfAborted();
      const first = await readSource(), start = now(), lease = await ledger.begin({ sourceRevision: first.revision, trigger: principal.trigger, initiatorId: principal.trigger === "manual" ? principal.employeeId : null, budgetMs });
      if (!lease) return { state: "already_running" };
      const signal = AbortSignal.any([AbortSignal.timeout(budgetMs), ...request?.signal ? [request.signal] : []]), deadline = start + budgetMs;
      try {
        const outcome = await collect({ signal, deadline, source: first });
        if (signal.aborted || now() >= deadline || !outcome.inventoryComplete || !Number.isSafeInteger(outcome.eligible) || outcome.eligible < 0 || outcome.completed !== outcome.eligible || outcome.deferred !== 0 || outcome.errors !== 0) throw Error("cycle_incomplete");
        const last = await readSource();
        if (last.revision !== first.revision || signal.aborted || now() >= deadline) throw Error("source_changed");
        const snapshot = await project({ source: last, outcome, lease, completedAt: now() });
        if (signal.aborted || now() >= deadline) throw Error("cycle_cancelled");
        let saved;
        try {
          saved = await ledger.finish(lease, snapshot);
        } catch {
          return { state: "commit_uncertain", runId: lease.id };
        }
        return saved ? { state: "completed", runId: lease.id } : { state: "not_published", runId: lease.id };
      } catch {
        await ledger.abort(lease, "incomplete_or_changed").catch(() => {
        });
        return { state: "not_published", runId: lease.id };
      }
    }
  };
}

// tech-checks/operations/src/cameraEvidence.ts
var CAMERA_FRESH_MS = 20 * 60 * 1e3;
var normalized = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp(value, now = Date.now()) {
  if (typeof value !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS } : { at: null, fresh: false };
}
function resourceKind(row) {
  const type = normalized(row.type).toLowerCase();
  return row.trackerOnly ? "unitInventory" : ["ipc", "camera"].includes(type) ? "cameras" : ["detector", "reconeyez detector"].includes(type) ? "detectors" : type === "nvr" ? "recorders" : /^(?:sniper(?: [24])?|camv|tracker_unit)$/.test(type) ? "unitInventory" : "other";
}
var cameraRecord = (row) => !row.trackerOnly && ["cameras", "detectors"].includes(resourceKind(row));
var providerSource = (value) => ["Star4Live", "Reconeyez"].includes(String(value));
function providerRecord(row) {
  const kind = resourceKind(row), resource = kind === "cameras" ? "camera" : kind === "detectors" ? "detector" : kind === "recorders" ? "recorder" : null;
  return !row.trackerOnly && resource !== null && row.evidence?.kind === "provider" && row.evidence.resource === resource && providerSource(row.evidence.source);
}
function currentCameraStatus(evidence, now = Date.now()) {
  return evidence?.kind === "provider" && ["camera", "detector"].includes(evidence.resource || "") && evidence.active === true && providerSource(evidence.source) && cameraTimestamp(evidence.observedAt, now).fresh && ["online", "offline"].includes(evidence.status) ? evidence.status : "review";
}
function providerState(row, now = Date.now()) {
  if (normalized(row.activationState) !== "ACTIVE" || !providerRecord(row) || row.evidence?.active !== true) return "verifying";
  return cameraTimestamp(row.evidence.observedAt, now).fresh && ["online", "offline"].includes(row.evidence.status) ? row.evidence.status : "verifying";
}
function cameraState(row, now = Date.now()) {
  if (row.trackerOnly) return "mapping";
  if (!cameraRecord(row) || !providerRecord(row) || normalized(row.activationState) !== "ACTIVE") return "verifying";
  const value = currentCameraStatus(row.evidence, now);
  return value === "review" ? "verifying" : value;
}
function serviceState(row, now = Date.now()) {
  const evidence = row.serviceEvidence || (row.evidence?.kind === "service_port" ? row.evidence : void 0);
  if (normalized(row.activationState) !== "ACTIVE" || evidence?.kind !== "service_port" || evidence.active !== true || !cameraTimestamp(evidence.observedAt, now).fresh) return "verifying";
  if (evidence.status === "online" && evidence.reachable === true) return "online";
  if (evidence.status === "offline" && evidence.reachable === false) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}
function combinedState(states2, empty = "verifying") {
  if (!states2.length) return empty;
  return states2.every((state) => state === "online") ? "online" : states2.every((state) => state === "offline") ? "offline" : states2.some((state) => ["online", "offline", "degraded"].includes(state)) ? "degraded" : "verifying";
}
function classifyCameraUnit(rows, now = Date.now()) {
  const active = rows.filter((row) => row.scope !== "inactive");
  const scopes = new Set(active.map((row) => row.scope || "unknown"));
  const scope = !active.length ? "inactive" : scopes.size === 1 ? [...scopes][0] : "unknown";
  const cameras = active.filter(cameraRecord), providers = active.filter(providerRecord);
  const provider = combinedState(providers.map((row) => providerState(row, now)));
  const camera = combinedState(cameras.map((row) => cameraState(row, now)), "mapping");
  const service = combinedState(active.map((row) => serviceState(row, now)));
  const state = scope === "inactive" ? "inactive" : scope === "shop" ? "shop" : provider !== "verifying" ? provider : service === "online" ? "service" : providers.length ? "verifying" : "mapping";
  return { scope, state, providerState: scope === "inactive" || scope === "shop" ? "verifying" : provider, cameraState: scope === "inactive" || scope === "shop" ? "mapping" : camera, serviceState: scope === "inactive" || scope === "shop" ? "verifying" : service, systemKind: providers.length && providers.every((row) => resourceKind(row) === "recorders") ? "recorder" : providers.length && providers.every((row) => resourceKind(row) === "detectors") ? "detector" : "system", recorderOffline: active.some((row) => resourceKind(row) === "recorders" && providerState(row, now) === "offline") };
}

// tech-checks/operations/src/savedConnectionObservation.ts
function savedConnectionObservation(row, now = Date.now()) {
  const evidence = row.serviceEvidence || (row.evidence?.kind === "service_port" ? row.evidence : void 0);
  if (evidence?.kind !== "service_port" || !cameraTimestamp(evidence.observedAt, now).fresh) return "verifying";
  if (evidence.status === "online" && evidence.reachable === true) return "online";
  if (evidence.status === "offline" && evidence.reachable === false) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}

// tech-checks/supabase/functions/cos-operations-pages/placementProjection.ts
var object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var fullKey = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase() : "";
var auditKey = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var idString = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
var text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function fail(message) {
  throw Object.assign(new Error(message), { status: 503 });
}
function placementMatchKey(value) {
  if (typeof value !== "string") return "";
  const m = /^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim()) || /^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim());
  if (!m) return "full:" + fullKey(value);
  const f = m[1].toUpperCase().replace(/\s/g, ""), family = { RI: "RECON", RII: "RECON2", RECONII: "RECON2" }[f] || f;
  const [whole, fraction] = m[2].split(".");
  if (Number(whole) === 0) return "full:" + fullKey(value);
  return "typed:" + family + "|" + Number(whole) + (fraction === void 0 ? "" : "." + fraction) + (m[3] ? "|" + m[3].toUpperCase() : "");
}
function currentOwnerPlacements(audits, devices) {
  if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) fail("Current placement could not be verified. Reload the unit.");
  const latest = /* @__PURE__ */ new Map(), marked = /* @__PURE__ */ new Map();
  for (const a of audits) {
    if (!object(a) || !idString(a.id) || typeof a.unit_key !== "string") fail("Placement history returned an invalid identity.");
    const key = auditKey(a.unit_key), previous = latest.get(key);
    if (!previous || BigInt(idString(a.id)) > BigInt(idString(previous.id))) latest.set(key, a);
    const previousMarked = marked.get(key);
    if (a.contract === "COS_CAMERA_PLACEMENT_V2" && (!previousMarked || BigInt(idString(a.id)) > BigInt(idString(previousMarked.id)))) marked.set(key, a);
  }
  let currentByKey;
  let aliasesByMatch;
  const overrides = [];
  for (const latestAudit of latest.values()) {
    const a = latestAudit.contract === "COS_CAMERA_PLACEMENT_V2" ? latestAudit : marked.get(auditKey(latestAudit.unit_key));
    if (!a) continue;
    let conflictReason = latestAudit !== a ? "Camera inventory changed after the last Owner move. Review this unit\u2019s identity." : null;
    const ids = Array.isArray(a.device_ids) ? a.device_ids.map(idString) : [];
    if (!currentByKey) {
      currentByKey = /* @__PURE__ */ new Map();
      devices.forEach((d) => {
        if (object(d)) {
          const key = auditKey(d.unit_key), ids2 = currentByKey.get(key) || [];
          ids2.push(idString(d.id));
          currentByKey.set(key, ids2);
        }
      });
    }
    const current = currentByKey.get(auditKey(a.unit_key)) || [];
    if (!ids.length || ids.some((id4) => !id4) || current.some((id4) => !id4) || new Set(ids).size !== ids.length || new Set(current).size !== current.length || ids.length !== current.length || ids.some((id4) => !current.includes(id4))) conflictReason = "Camera identity changed after its placement move. Review this unit before using its field location.";
    if (!["SHOP", "FIELD"].includes(a.placement) || a.action !== (a.placement === "SHOP" ? "MOVE_TO_ROOT" : "MOVE_TO_FIELD") || !Number.isFinite(stamp(a.created_at)) || !uuid(a.request_id) || !uuid(a.control_id) || a.placement === "FIELD" && (!text(a.site_label, 250) || !text(a.street_address, 600))) fail("The saved Owner placement is incomplete.");
    const matchKey = placementMatchKey(a.unit_key);
    if (!aliasesByMatch && !devices.some((d) => d == null)) {
      aliasesByMatch = /* @__PURE__ */ new Map();
      devices.forEach((d) => {
        const key = placementMatchKey(d.unit_key), aliases2 = aliasesByMatch.get(key) || /* @__PURE__ */ new Set();
        aliases2.add(auditKey(d.unit_key));
        aliasesByMatch.set(key, aliases2);
      });
    }
    const aliases = aliasesByMatch?.get(matchKey);
    if (aliasesByMatch ? aliases && (aliases.size > 1 || !aliases.has(auditKey(a.unit_key))) : devices.some((d) => placementMatchKey(d.unit_key) === matchKey && auditKey(d.unit_key) !== auditKey(a.unit_key))) conflictReason = "Camera aliases need review before this unit\u2019s placement can be shown.";
    overrides.push({ ...a, matchKey, conflictReason });
  }
  return overrides;
}
function projectCameraOwnerPlacement(devices, audits) {
  const overrides = currentOwnerPlacements(audits, devices), byUnit = new Map(overrides.map((a) => [auditKey(a.unit_key), a.conflictReason ? "UNKNOWN" : a.placement])), conflicts = new Set(overrides.filter((a) => a.conflictReason).map((a) => a.matchKey));
  return devices.map((row) => conflicts.has(placementMatchKey(row.unit_key)) ? { ...row, __ownerPlacement: "UNKNOWN" } : byUnit.has(auditKey(row.unit_key)) ? { ...row, __ownerPlacement: byUnit.get(auditKey(row.unit_key)) } : row);
}

// tech-checks/supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts
var OWNER_IDENTITY_ORG = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var OWNER_IDENTITY_CONTRACT = "COS_OWNER_CONFIRMED_IDENTITY_V1";
var record = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var text2 = (v, max = 250) => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
var id = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n ? v : null;
var revision = (v) => typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
var digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var exact = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
var normalized2 = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var sorted = (v) => [...v].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var OwnerIdentityError = class extends Error {
  status;
  constructor(message, status = 409) {
    super(message);
    this.status = status;
    this.name = "OwnerIdentityError";
  }
};
function fail2(message) {
  throw new OwnerIdentityError(message);
}
async function ownerIdentityDigest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (b) => b.toString(16).padStart(2, "0")).join("");
}
function ownerConfirmedPhysicalTuple(key, devices) {
  return [OWNER_IDENTITY_CONTRACT, OWNER_IDENTITY_ORG, key, devices.map((d) => [id(d.id), d.source, d.device_type, d.external_device_id ?? null, d.device_serial ?? null, d.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)];
}
function validateOwnerIdentitySnapshot(value) {
  if (!record(value) || !digest(value.revision) || !Array.isArray(value.claims) || value.claims.length > 1e3) fail2("Owner identity commitments are unavailable.");
  for (const c of value.claims) if (!record(c) || !uuid2(c.id) || c.organization_id !== OWNER_IDENTITY_ORG || !uuid2(c.native_unit_id) || !text2(c.native_unit_label) || !text2(c.legacy_unit_key) || !Array.isArray(c.device_ids) || !c.device_ids.length || c.device_ids.length > 1e3 || c.device_ids.some((v) => id(v) !== v) || new Set(c.device_ids).size !== c.device_ids.length || !digest(c.resource_epoch) || !digest(c.physical_digest) || c.provenance !== "owner_confirmation" || !["active", "revoked"].includes(c.status) || !revision(c.revision)) fail2("Owner identity commitments are malformed.");
  if (new Set(value.claims.map((c) => c.id)).size !== value.claims.length) fail2("Owner identity history contains duplicate records.");
}
async function currentOwnerIdentityEvidence(s, unitId, unitKey, matchKey = placementMatchKey) {
  if (![s.units, s.devices, s.matches, s.providers, s.epochs].every((rows) => Array.isArray(rows) && rows.length <= 1e5 && rows.every(record))) fail2("Identity source records are unavailable.");
  if (!uuid2(unitId) || !text2(unitKey)) fail2("Choose the exact equipment and camera group.");
  const units = s.units.filter((u) => u.id === unitId), unit = units[0];
  if (units.length !== 1 || unit.organization_id !== OWNER_IDENTITY_ORG || !text2(unit.unit_number) || typeof unit.status !== "string" || ["retired", "deleted"].includes(unit.status)) fail2("The exact native equipment identity is missing or duplicated.");
  const nativeEpochs = s.crosswalk.nativeEpochs?.filter((e) => e.unitId === unitId);
  if (!Array.isArray(nativeEpochs) || nativeEpochs.length !== 1 || !digest(nativeEpochs[0].epoch)) fail2("The native identity incarnation is unavailable.");
  const group = s.devices.filter((d) => normalized2(d.unit_key) === normalized2(unitKey));
  if (!group.length || group.length > 1e3 || group.some((d) => d.unit_key !== unitKey || !id(d.id) || !text2(d.source, 100) || !text2(d.device_type, 100) || [d.external_device_id, d.device_serial].some((v) => v !== null && v !== void 0 && !text2(v, 500)))) fail2("The complete exact camera resource group is unavailable or ambiguous.");
  const ids = sorted(group.map((d) => id(d.id)));
  if (new Set(ids).size !== ids.length || group.some((d) => s.devices.filter((other) => id(other.id) === id(d.id)).length !== 1)) fail2("Camera resource identities are duplicated.");
  if (group.some((d) => s.devices.some((other) => other !== d && other.source === d.source && (text2(d.external_device_id, 500) && other.external_device_id === d.external_device_id || text2(d.device_serial, 500) && other.device_serial === d.device_serial)))) fail2("A physical camera identifier is claimed by multiple resources.");
  const matchedProviderIds = s.matches.every((m) => typeof m.vigilant_device_id === "string") && s.providers.every((p) => typeof p.id === "string") ? new Set(s.matches.map((m) => m.vigilant_device_id)) : null;
  const providerClaimsGroup = matchedProviderIds ? s.providers.some((p) => matchedProviderIds.has(p.id) && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)) : s.matches.some((m) => s.providers.some((p) => p.id === m.vigilant_device_id && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)));
  if (providerClaimsGroup) fail2("A native provider association already claims a resource in this camera group.");
  const concern = [matchKey(unit.unit_number), matchKey(unitKey)];
  if (s.units.some((u) => u.id !== unitId && concern.includes(matchKey(u.unit_number))) || s.devices.some((d) => d.unit_key !== unitKey && concern.includes(matchKey(d.unit_key)))) fail2("A competing full family, number or suffix identity requires review.");
  const epochs = s.epochs.filter((e) => e.unitKey === unitKey), epoch = epochs[0];
  if (epochs.length !== 1 || !digest(epoch.epoch) || !Array.isArray(epoch.deviceIds) || !exact(epoch.deviceIds, ids)) fail2("The current camera identity incarnation is unavailable or changed.");
  return { nativeEpoch: nativeEpochs[0].epoch, unitId, unitNumber: unit.unit_number, unitKey, deviceIds: ids, resourceEpoch: epoch.epoch, physicalDigest: await ownerIdentityDigest(ownerConfirmedPhysicalTuple(unitKey, group)), physicalResources: group.map((d) => ({ id: id(d.id), source: d.source, type: d.device_type, externalId: d.external_device_id ?? null, serial: d.device_serial ?? null })).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) };
}
function ownerClaimRelated(c, unitId, key, ids) {
  return c.native_unit_id === unitId || normalized2(c.legacy_unit_key) === normalized2(key) || c.device_ids.some((d) => ids.includes(d));
}
async function projectOwnerConfirmedIdentities(s) {
  validateOwnerIdentitySnapshot(s.crosswalk);
  const unitIdentities = [], identityWarnings = [];
  const labelKeys = /* @__PURE__ */ new Map();
  const matchKey = (value) => {
    if (typeof value !== "string") return placementMatchKey(value);
    if (!labelKeys.has(value)) labelKeys.set(value, placementMatchKey(value));
    return labelKeys.get(value);
  };
  for (const claim of s.crosswalk.claims) {
    const binding = { unitId: claim.native_unit_id, deviceIds: [...claim.device_ids], unitKeys: [claim.legacy_unit_key] };
    let reason = "";
    try {
      if (claim.status !== "active") fail2("The Owner-confirmed identity was revoked. Its resource commitments remain reserved.");
      const evidence = await currentOwnerIdentityEvidence(s, claim.native_unit_id, claim.legacy_unit_key, matchKey);
      if (claim.native_unit_label !== evidence.unitNumber || !exact(claim.device_ids, evidence.deviceIds) || claim.resource_epoch !== evidence.resourceEpoch || claim.physical_digest !== evidence.physicalDigest) fail2("The Owner-confirmed source identity changed. A restored label cannot reactivate it.");
      if (s.crosswalk.claims.some((c) => c !== claim && ownerClaimRelated(c, claim.native_unit_id, claim.legacy_unit_key, claim.device_ids))) fail2("More than one identity commitment claims these resources.");
      if (s.matches.some((m) => m.equipment_unit_id === claim.native_unit_id)) fail2("A provider association now competes with the Owner confirmation. Review its provenance.");
      const proof = await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT, claim.id, claim.revision, claim.native_unit_id, claim.native_unit_label, claim.legacy_unit_key, sorted(claim.device_ids), claim.resource_epoch, claim.physical_digest, claim.provenance]);
      unitIdentities.push({ ...binding, unitNumber: claim.native_unit_label, kind: "owner_confirmed_native", proof });
    } catch (error) {
      reason = error instanceof Error ? error.message : "Owner identity evidence could not be verified.";
    }
    if (reason) identityWarnings.push({ ...binding, reason });
  }
  return { unitIdentities, identityWarnings };
}

// tech-checks/supabase/functions/cos-operations-pages/verifiedHealthIdentityScope.ts
var REVIEWED_NATIVE_IDENTITIES = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": "dc532cb72f2c0091810d513666813074b10a8afdfb526f00c0a9873554b1dc8e",
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": "846332d10df653b11ed142dadce45363663d3a41088b8ffdc2b0f3127a6ab693",
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": "dc1e2366233e86c34217538b771d522b6176ade5ea762d133734c14d80ae168f",
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": "c69a648f97b8e7b9035e812a3d6ab4dad64917a2f36575e71c8aeed4b382dbb3",
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": "182399e8d0f7f3ac2a05fc57d442afe934331631c8f25111b3722c6209cdbfd0",
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": "3af1a6e9acea89f412c81dd8236b5fd20f2dae3e9d4c97617031fb1c701c2614",
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": "64ff9ea9e05331f8abcd72013ff1b11004c6c307555371db7814c46b178693b6",
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": "f557e13e370f5f557565e99f3d19efeea9475fe5048fd351851f03cdc89c9553",
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": "34ffc498d15d98306dbbe22a71e50719ebbe8765fd8a0a39bbc1cd951f69cd12",
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": "f2aa273b73c89fd5c1ade8abe39fc2948d7d8054ab62c493d8c7246ff352daee",
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": "80b7465c6d14b4bf2c1cb84b73681ed36f75a2bf6386e1297a1a437eb029c629",
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": "08b42f07fa5be04ca84b00b10e611534f676510706db270f0d9fdd8a202b5226",
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": "3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a",
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": "8271ee9b3309314f50cf77b5d1b3cc777c487f1b67742aca6c05edbfc962f9b5",
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": "cf1ea7307b5e42e63a5d2d5788cabcbdc1ab73100bee0639b2928324d01825e6",
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": "28c4f4520e0717f407ad62ae8227ffbd9176473a3e9c775d45a4f9ca74fd0cfb",
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": "5447825c15fafdb87da05d16d1e5f30ab40b0780d0fb95669d47bf7d1b806663",
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": "8594d7894b960e4bd9c1786598ad8a5d9ebcab4a4f3fa0a44c7f05aae640b12a",
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": "835ae1a7bf5b17e27ab93944dac352d9a4acc5b67148e699f2beae8ee684f273",
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": "01eb424f57264fb1dffa14d673e18e018167ce8c268426a24c4e8683d8968fbc",
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": "6400e2d9d1a9f4c00ec7a6da54c6381d91d8cbb11b341c17a060ef70f72c8c8a",
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": "55736078a81914bdd4ed030260f8c2b2d2fff3270cf85510176d4a98445c0082",
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": "4050219a4964f37f79511367ff07d19e38f5696edec2418b08ce052cec39ed56",
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": "6b6e16a6b7b2bfb854b77903d04ba76b30fcc796fe5bdec537d3e24dd467a8f1",
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": "1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816",
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": "f456119070ba4bc22ea9f8dee89f5fce5ed96985b877d57b6d89cae2d6fbd664",
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": "356a98b0fdfe2669c3e9acb58ea66d442d3ff43abebd619672ff6e84b18c0271",
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": "e2af180710b75083fd45f33a38e15ac05f5a150096a4a2e641fe27a5ac1847fb",
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": "47d53becaa3a98cd3c516439b9a8a0adce6ec0417c9ffff74d8cf8bf88d681a1",
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": "c795740ea73b57450a35bb13b3ab764eb834f6bfd10019bbeccc8bd2fd0b92c9",
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": "921575d2866d5933293f19e60a668517d5f85481cb24240badc0a03df1cf6080",
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": "84a903b69564f86d3de42e64c58fc136b36da9c90a88e13b291924ec131c33ea",
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": "fead08519abd9694d9c9d61deb4effe9f81bbb2e3b23227efdbdad8557262ef0",
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": "0c828defbb69a0303b04ea14805d9440f3b5cc97614ca8c74a5023d135a42572",
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": "d1e16091d53cba63858a6367490781f9ea24ac14996a078deb793914c0f60f4d",
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": "ecc3f586260106cfe927ee6bec00b9742c1cf278d2b082d8db104442f218a09f",
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": "ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c",
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": "b96ddef9f10bb1b4b5759128bed9a2650e215f5f40077341f15c270f374492b0",
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": "1122fb128668a31e2a66030fd6a516715f87ab7ba5138e4a191a8b52fe6ac730",
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": "8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6",
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": "b61987eee1b80ad1c9857fc00b5c6790b4fd1ba6b55cd352bb7df73639a6c888",
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": "25a162368050d144b5d92ddb368412570ce24919a3ee527865a247752d0bcfa3",
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": "f66c1ebbfe141ddaac5e9a6e9c690ac8fb546448c74d8021dcc8cadec91b338e",
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": "1e7dcc1f846965bafcc4501ffb96194b17ee6afffbb70c87ae15e048a64f05d8",
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": "2a92368a1a687c5e7b2d719d89184c808ba8e53918f8bfd400b817917c388cc0",
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": "cee6e035aaf931230a3cc87ca3890b69037653c411b8d1fd4bfa727c4f7b7de9",
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": "c96ffceddc8c164d5a54f1e06e8d7a3465314e67a19aa40718874581fa6de4a0",
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": "2267afd0f19117321d7213e9ed7e28ad14209c44030276ff4cbcab79e1d74ef0",
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": "acaadda2e3ee68b484dfbe6a6c5230a2fb13c72bc992f58e2085bec2ca3ebcf2",
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": "b1f1ec74016c6e7f42b5933b6aded62e572b4b5e610f04e68e7c451b744b39da",
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": "f39f68e1a178bca02f47f310473e7a362b135b3e51fd892f416b829c85d1d076",
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": "001fbd0e38b5affc759ed9d80f1e11d69db05a4581f34f521c7bd009f9689c3a",
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": "713deadb62d2cf7279637f3e984e394a3251a49af7d566de1093d7526796dfab",
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": "56b6848bdf1f9e7fd5754c8b8b741aecc4993330e1baa706bd7b5806dd53d36e",
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": "35513bfc1c59f48a75d1871ec8643510805831f1a4a1306ea9826187837cf155",
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": "78c178dc5c8a6dd6984a462413ae81485f6d8ad79906d3a4a3938850b035e7af",
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": "584aec9773f6d0c7593779735cdf157be2f54cff185f62cb88bc4758efae1227",
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": "15221ef117692879f16269d86ef3e32e5444a2b3b11545a8cc4a98441c6893f2",
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": "410d47dc5ced6118b4cd226178d2ecf05b6ecf8c19e1997aef3e4ae63dfd0ee1",
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": "273394daf97b444ec1b45e965b5902bc0492d3e17cb9fe39fb152d27ad6d6e53",
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": "48a474cd1831bfb8c005e05bce15c06f5ff553ae9c46812e7a386314bf261485",
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": "2f173a5ef3240516bf2050e4bbaa6a298729fd47483347d57c99f5521ea2e06e",
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": "625bfac59603230adaa4ee2b4ce51bdc84c49bbac75abaa0296bf51a0419fab2",
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": "db5f2cf50dcd7080bb10026ebf969b5bc3aba086d843ff60c9c61229d47498b6",
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": "ec04fa9cac495270bc30b5dca36f10e7de3dfc2079108e26b3bad368afbc4914",
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": "22f0c7a9651d4c22d04fc7425587cfae197fa23500f785175a16196ce48c2960",
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": "1260073ea6bfac20d6d20d4e5da42e98f5304c61231ce059036c59782dea6f27",
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": "c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049",
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": "b53e0b01674c32239843d47065e9aab253cd0be05f02ee914f07c81328b3e96a",
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": "37fa91756b5063a015abe6e89cb7d13377756d043bd84abab7b0b2f2b346cc88",
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": "f4c80e614b8760e1fc75255611bd808549181ce4da349c7cef885a456797579a",
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": "bd2b41c64fa88e7a4f442bb2831f60661d86adf9d1d0ed03fc4147fd1249cace",
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": "fc7660cc98bbe9e43b185c35abd4b978e736719e2fd19a5f8bd3b8b83edd4c76",
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": "6323583a84d139bfb76dc777c5d21408692a2b6f460da5059419bc78d124906b",
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": "3ed985d8a8f0937e6a7adf8d6ae92cb1715681aa109b095f02b3949873f01d12",
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": "c89bdd2d7eb3cae4e86181573b6d201bdcf3715e2c23186fe1aa6d0031c32c2c"
});
var REVIEWED_OWNER_IDENTITIES = /* @__PURE__ */ new Set(["0493a660e8ba95ce11f383649bae5708e6db0ab8c601aa2311f8bbf01b9e0f0e"]);
var REVIEWED_NATIVE_RESOURCES = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": {
    "deviceIds": [
      "feed6068a78c6977c764c0365dfcfac2d94f6ddf1535273fc8b6c48e04eb7105",
      "46904bb929ed3ffdbedfdfb4d2c517282d10d2644ca3205a03d9fc2bd06cd987",
      "fdd3c0ca5a1c00eaaddc2c0140aef37c154e4ab6338de9c8bd43575858e2cd13",
      "664c50e58955e2ac4fa545241ed292331f9b9749510742992e0f444e2018a01e"
    ],
    "unitKeys": [
      "0de5ec7e47d0dd1758d9098f9e7accac4adadf71339f289a79541711ef8afa94"
    ]
  },
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": {
    "deviceIds": [
      "919ebe27f91e752138b6d6860ba66887320054c0401c2c0fa04edc05839eed9c",
      "c5cdd4e83a0d351b70c57129fe2d61f715eede74803d15ef5bc00855b43d7a8d",
      "c169a89d9d9d9889cf1e66e1a77975ed54653278492fbabf7e114717d2182b4f",
      "261f529ffcc8649a076e80900e60863b141ec11ba28224eaa49850e4af4e2932"
    ],
    "unitKeys": [
      "fd08cac3ffb8b8a1cc214b02437646792de0c80a8ebda897933ae1bd1b027862"
    ]
  },
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": {
    "deviceIds": [
      "7a47b4b401db7190cac9be7cbef7766866c84f3991ce50d6647510eba98159a2"
    ],
    "unitKeys": [
      "bc834b04b6ec86a0b9359357ee2d7a7b540134f0395b7ad201f702dde0189a07"
    ]
  },
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": {
    "deviceIds": [
      "8d430f32fd142626a4a2cb5b09394a4af33420cb3bf314a39cc7ebf1ae775f55"
    ],
    "unitKeys": [
      "0aa709b48aabb02c1e88f0fa5e654e451a162447a9094994b21b12b067b91134"
    ]
  },
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": {
    "deviceIds": [
      "a2b9f5c6f8c81903bb35f0c56cea4315a49b9f4b72054c56a651de3670e5cbaa",
      "c2648de9d0dfd0821f1dc06c4873cc7425848081b93ef49289d1c827de71c241",
      "86c7185dba0443000839ba2667b1dc6bc74e480e963f5a39cb84a8493c9f656c",
      "7ddce19715dcd61628ccbfaefed15566a21231aa81569a59faedb9bd967e76d7"
    ],
    "unitKeys": [
      "2ca59f6603691b189aa53a2200720883e946f7a69345ff227f2e518c26f15ce9"
    ]
  },
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": {
    "deviceIds": [
      "561618b11144e70ce14c23226b02c15794feba35bb19d887b1dc4ddb94293b51"
    ],
    "unitKeys": [
      "29ea45b1107c4c2010857890bad43671591f2e84c8d0e1e23d65b587b96b26a2"
    ]
  },
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": {
    "deviceIds": [
      "44e629d9d31d9079a1a3a979c4fe47d034956788332f70b564ccb2f11e8450f3"
    ],
    "unitKeys": [
      "00e737c29227071b5363c2b7579db53f053246d460155ca6969773673e46a4a8"
    ]
  },
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": {
    "deviceIds": [
      "46febca97d70d9cbc2c1aa3c97ce40d0b08162616217a090ac79ff502c09db47"
    ],
    "unitKeys": [
      "4fa5d146c11b6807cff48403cc164d81eb0df3a56f07f35de31d2f4ade1f4180"
    ]
  },
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": {
    "deviceIds": [
      "e36943ee7acb30e94df2ffd9ae80e30af4ac6cf94fb5ada1295d2c1d96bc06a3"
    ],
    "unitKeys": [
      "029812c1ca14a24be5ea431d2e95b3d42cd1a384d40dcfb8f7afbf31263f4b64"
    ]
  },
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": {
    "deviceIds": [
      "ecdbb50d7c3d46eeb67fed4097cfeb431516d2682d9ce7927580d3193bf826dd",
      "cddc244f1a2e99704d0fd4147b4b47cbac61ffaa244cc36e108ddc2438af1471",
      "7a3551e1050dd8098348cfc7950b8a6e8fafa0e0d92d7cfa14c56a23c82bf123",
      "4f6b55ef015bbd63c179ebcf16ae1b1184526bff7b299d97f68ec13d23b5ca51"
    ],
    "unitKeys": [
      "ccddd63080d320772c8caeb9d37412d8c592f830f1640cf4a00965bcb38ab5fd"
    ]
  },
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": {
    "deviceIds": [
      "d8e62367588995cbef0fd240b3994dc8833d7282ac524b0b1a1cb141ff50be10"
    ],
    "unitKeys": [
      "695ff1aa52b305643a6cdeab94f6580fb8e1d495d0f0f89f58840ac3fa62cd55"
    ]
  },
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": {
    "deviceIds": [
      "411a21923d2c39c5d06d53083521c7073e5fefbb5c529b540a4ef52f366a372c"
    ],
    "unitKeys": [
      "2799bf469349747571ae49dadf35ccdafcb69d9b34c22d4dfc156448d63f2db0"
    ]
  },
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": {
    "deviceIds": [
      "fa4b6ed6f766dfe2e359de37306e108750e5f1b7f09b5ae7d6d2939df501b09d"
    ],
    "unitKeys": [
      "87613f2f295da96dd7efd218ca81f63c439132c8828d56cec472b6c19b0c2ea8"
    ]
  },
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": {
    "deviceIds": [
      "854ab1e44bad32c2e48f76b577fc37a030087ce85046aba6dcc7b3962e67f5fb"
    ],
    "unitKeys": [
      "978e5302d2a43275b0be449b0dbda1b16b42e9c6fedf9a19d6ff43f3e1859639"
    ]
  },
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": {
    "deviceIds": [
      "60a044ee3f2a1d90efea2decb98efffddc6a86d910b9f73aee901ec935a20cdf"
    ],
    "unitKeys": [
      "800bfd24e83a4d9caa9a4c2f40b6eaa7582be866cabee683e8458f4cf21167a6"
    ]
  },
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": {
    "deviceIds": [
      "3745c23569c1d09ecaffccdc5671c01d8d8c9a4666cd56865e833fb4bf697514"
    ],
    "unitKeys": [
      "c3dd3e3558d267c0f334deeb8e2ec05fc646888a8836cf9e7ba84889b8cf0db7"
    ]
  },
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": {
    "deviceIds": [
      "dfb67ed44f19d97d649c4c02a3f8df7b198470fe1d2ca9328e7ca6c02a4250d2"
    ],
    "unitKeys": [
      "270fe3940ef2f83e34418bcbffe2c36733a176d9183a135bc4dc8909f5394eb1"
    ]
  },
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": {
    "deviceIds": [
      "e269db8b514596c8032bda0af97006a43e1219282e98fab2a58060452184d39d"
    ],
    "unitKeys": [
      "b1c21bd4c20ecef17cf1687dd160ea6cabaaa142f6013317b4068c4c63f9421f"
    ]
  },
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": {
    "deviceIds": [
      "d06c901c85d259dff0aa7873b4acdff1d04b501f2a7c3218adee8965f824a48f"
    ],
    "unitKeys": [
      "78b67ee77b122c1695335be231e39e4e493bb66d7764936223848a36b59dbcdf"
    ]
  },
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": {
    "deviceIds": [
      "52125961fa907295f5890fc7bf402a8a772a81f107eecabb61edc9c03a6736e8"
    ],
    "unitKeys": [
      "1c69405eb00ac0ad15247aee2572b65a69660c96034b135f2c10e8b3c831abc2"
    ]
  },
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": {
    "deviceIds": [
      "967e3070bb04d83c24e2823109e18910d5527875971ae9e70877dbc830b87ca2"
    ],
    "unitKeys": [
      "02e28ed5ae9955793b713f822b7f819bee270a81e67e73d7218ba3ca5b3aefdb"
    ]
  },
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": {
    "deviceIds": [
      "9948cea84de2b1c5574959f968716fd5226732e2ba989dd47527b14f66d9c4ad"
    ],
    "unitKeys": [
      "7b36a85e35f47b0c2d58557a253550ff7d805d1d35bfb54d8e02a9e1a706a6d7"
    ]
  },
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": {
    "deviceIds": [
      "949c1d429e4fcaab4035d83c54c90ceb142c4201f90af88a24844741b058a939"
    ],
    "unitKeys": [
      "b0b71ab820475112a0bd0928982b69706800c08bbb78332dc84a84ffad52a47a"
    ]
  },
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": {
    "deviceIds": [
      "851139cf8ce200cc166245a50e6502acac69a7c73c77c3e8ab229185e2af74af",
      "f17802b963e9a08b8c892b5d45a5bb5274cf9eed27e2512b15282bf8e011e7ee",
      "38302e2b1a869c4030abfffd8bc94054af6835c2bfc6033f94b573696d1c38ea",
      "d1b5229bcfe904b29428a317622d233e413e2d46e6e6732009abb52291db551b"
    ],
    "unitKeys": [
      "057eb3019af64388a6ac5376cbf19c3f67a09ee4188f5024ec8db11d7684b217"
    ]
  },
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": {
    "deviceIds": [
      "b87b21fc80368e2509d591db8cdabbd70d7854d425645327712ce462ec06f5c0"
    ],
    "unitKeys": [
      "e56ffe9b8f612287f76bed52bbb716acefe7e8445d2017bc1f44a805dc9b8a85"
    ]
  },
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": {
    "deviceIds": [
      "9100508c0bbd0c5fd1a8046810a7026cc4693d195535d92795bc838197cf21ac"
    ],
    "unitKeys": [
      "3a35129e37138048d906656c996e08b07ab78905eb2b99b1b83652db1afe2f67"
    ]
  },
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": {
    "deviceIds": [
      "02a09b70dcf54e860edea43adfd34cdf95d0cafc363823bcba1979e1b4320274"
    ],
    "unitKeys": [
      "8b9d04d1f19509088e4e4f3042f6a2214842efe7441019e07447bf76bb0f9f97"
    ]
  },
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": {
    "deviceIds": [
      "545607b6686a5c22a0e0c12c51718d2cd39944895bea3a6539fccd43d14a3122"
    ],
    "unitKeys": [
      "da684290b672f4af3e936ba6e46596345c50bd7481e0da006e0a97b9d4b47dc6"
    ]
  },
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": {
    "deviceIds": [
      "e117af901b93954327fa69a696e5c340c471c6911e2d18d5ea4991ffac30db0e",
      "26d3b4a57e3ef94933921608597da302c065f68e4bfdc84ada75c8aa143d8e8d",
      "144c263b131f0965030ca081b6030f944709dd19101a9dec7f2104ff3ceff9b7",
      "ad9d1fde5a8a561064da67ffee31cfdc7d48fdd55a2194aad8da7407d44b8f71"
    ],
    "unitKeys": [
      "ba3a7ded55899f92de00fbc3d2e203b06dada282d2a2aed35142e9f5a8d5a8b2"
    ]
  },
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": {
    "deviceIds": [
      "5711a37a04be887e522f5986caf0e61ac661a33c992452f6556d1195c0c26c92"
    ],
    "unitKeys": [
      "b40017d4ee8094bfa7667dfcada0139a9d1eb31aafde8f8798563a1c45cdb83a"
    ]
  },
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": {
    "deviceIds": [
      "68b231a9a3837f7d0693015a8bd9e7bd0e84a156d2ab571b91cac80fcb9d5ea8"
    ],
    "unitKeys": [
      "d0b8bfa1fccd090f14067c197e833d3de181d0f7d4092b2946fa8b7940e0acb1"
    ]
  },
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": {
    "deviceIds": [
      "b92183599540ca8daa8ebe7abbb23eea5d15eca75a5d313068867c2679b347c2"
    ],
    "unitKeys": [
      "d508b208d9be428c2d244532e6760c01c66f005710523dbdf55e19383bb77933"
    ]
  },
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": {
    "deviceIds": [
      "769c098db74b2c6f23887d7b6f9e4f091f917982e4f8eef64dfa852b7bebd20d",
      "2677ffcd354f842655b14646b30a8034aae7e166d72613b31d50781aed393913",
      "8ff41918074be8bdfa061ad3e6dc741c8e27a80183745ceb7b71604d8c76bc61",
      "2524e6fe4400ea5053f3ab528dee567e78009d4ba94b5ffdd03b1eb384e282e6"
    ],
    "unitKeys": [
      "41e2d017c3127a587a14635eee26c84242759282976a6e732f60d9dbe1bb1541"
    ]
  },
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": {
    "deviceIds": [
      "e2466f41d4534dcd5ad92f7de44d3bd30746c39c68e723978000c68108f3a87e"
    ],
    "unitKeys": [
      "45cd584e3767c49abfa2b0a23f521e5dff4f191d7930745f6618dd1b5177b436"
    ]
  },
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": {
    "deviceIds": [
      "663d8fede5c0a4bc93780a049b95153f1c44de095c325b4d1396b10467f94b8f",
      "e7a00d951123f7c8799395900063633973714fefe93ff54e3072f2cc785b9bcc",
      "9e331e820953729f8f4dccc48bd98aee74d7a9d91154070fce3dae27a56afa4c",
      "f6bfa0c8575fc85ff86914168dceaa634b22cc4bea4fd4b6e3d811fbf93fec67"
    ],
    "unitKeys": [
      "80b2b93b9f1fd57001521133c9400047fe97b6dd143d49d215ab55621fbe5737"
    ]
  },
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": {
    "deviceIds": [
      "9e5b1fcaa10ef210f5db5a1ddac61310218febddeb5b70348446a75d8af41a62"
    ],
    "unitKeys": [
      "68db47dcb1de0de46585bb7a0f0c0ac014bfe8f9f6b4fb1cf6313dc7c0e782ad"
    ]
  },
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": {
    "deviceIds": [
      "7db3c5dabc7ee60eddfbb2a66c8750c6df42d744daf74995339c807b652751e2"
    ],
    "unitKeys": [
      "057e2279e0bf4c308b653a06a73755bf02b9c3493c9119c9cc042daac9f83d9e"
    ]
  },
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": {
    "deviceIds": [
      "71ec96e3162d6992969ee812f0534391abbe85e9ba3faa6e69eca4fd9f03a76b"
    ],
    "unitKeys": [
      "d43a33243c4fab95c6c7ce1c4a18994ce501be228ec17923b93567191eeae0d5"
    ]
  },
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": {
    "deviceIds": [
      "0b0b2bb610c3eb0d2cea0ebc2310c601f847e9251416d465bfa42c1e6711ab12"
    ],
    "unitKeys": [
      "5f1b24cff106c64e260961f10ed3908e750bf3a5578e61a87f4eb2fd69c0bb79"
    ]
  },
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": {
    "deviceIds": [
      "1f13893210ea5e152e1453be8ea452d18e6d027187914600dd7be7ceb096d010"
    ],
    "unitKeys": [
      "519aa275c9e5f5c4f1bc6965e7947a9e2b54f19179c90bae2f43fdf8ceceffac"
    ]
  },
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": {
    "deviceIds": [
      "133257791b627eada6ef982a859665ee7ed4df0960bf067cdd29687168e9df9f"
    ],
    "unitKeys": [
      "730a5118e105dd69f8eb2688bc78ea025d6ba61b6737b7cebe14042be69351f3"
    ]
  },
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": {
    "deviceIds": [
      "f334a075658da1c5d7b9d22e3b9cd796a2cde0ab5fb03100cc289220fc771834"
    ],
    "unitKeys": [
      "b72a826a38092fbe9800667d4fcedc960c9cd5eb84d37fb138b4249326aa7f51"
    ]
  },
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": {
    "deviceIds": [
      "97f8c5a6c048d812e42a3c5fc2df03b6d60d6b16c19415874253f2136b54a4ae"
    ],
    "unitKeys": [
      "3b746988139e6f7d5fcc3a351d5e5ea6755001b93957ced8de8cf28d6d1c5bfe"
    ]
  },
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": {
    "deviceIds": [
      "27aacf6ad4bd87e5ef4a594af328421f8a6305aeaddcb180c91fbaa0d907773a"
    ],
    "unitKeys": [
      "51162a830e0ff17e5045c58ef748412ae80f23fd81131eaee250e7463f3e67e3"
    ]
  },
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": {
    "deviceIds": [
      "9571bc29fa8f4cc1b15d461877415f193729b147728a4d59be32e5dd127fec06"
    ],
    "unitKeys": [
      "8c7bb3623f7974ae5b5f2ba2ae7f645fe84ac7481a9865eb6675f1a2c1ab27a2"
    ]
  },
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": {
    "deviceIds": [
      "18f472d1919d696637c1ddd6460aa5e8925d7c81cfdfca0a400882b967557c56"
    ],
    "unitKeys": [
      "9b9b25a106e3a8d8f380471e12089bc52a2adee9da05fe051899199095071a98"
    ]
  },
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": {
    "deviceIds": [
      "db1564899c4eb33490d9d555f02c5c34d20a96f10c25b147d6a5eefff9ef30af"
    ],
    "unitKeys": [
      "f86a604e7c1f14a93eea27da9e0e237a6ba1d6e31512397c5071c27bc324b261"
    ]
  },
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": {
    "deviceIds": [
      "30ccdc5b03a26c40f1343a58ca79205df6b2d6ee0d406a5416f4a9bd302562a4"
    ],
    "unitKeys": [
      "d2cb0388265300a85f9665aaeddc2bc3f536e94d2430bc183e055c1e78ef38bd"
    ]
  },
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": {
    "deviceIds": [
      "c181e4acd31100669ef82b86079a0c43a6e73216ac555f11d5da0cc8bc8b18fe"
    ],
    "unitKeys": [
      "3c8c91046d79090a6bc28595b6e5429e8fbddf29c768bca0d2f8707bc1598507"
    ]
  },
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": {
    "deviceIds": [
      "25e4b184c4d44854db6c5cf39ed27884bd2c821b1a7273b1a5b946fb26090804",
      "0843a9a2a1217bc89ba440f797e544ebc11018d874ec0894e3b8cf10b80d9f54",
      "86b2cd68f9f9827194b73a08a5c57c9e7e13a918c4ae5ecf9d0a59c7e41233f2",
      "ee851aae99a7ce00e3e26f5ff55b398e2e9ba7484d93c7841007351d06b4623e"
    ],
    "unitKeys": [
      "d31754a91de0a2395386e568110a82541b5e62d0bf78c2b9594f748d8175b995"
    ]
  },
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": {
    "deviceIds": [
      "2ec4b5b5dfecc5737b5ae96eaeb3e2e58f8199ebea3df753974d3e7aaca61ad3",
      "8e5a4ef5bb984d36cceddb73dfca0fd190609ff62cb9ee3709805bc0b1e86545",
      "4ef7d97d2babe9b66583f2eae307821d2115f43c8647bcec22a510a012415a8d",
      "3870233c4638ec4aa5a1e6538fc42dced7747c9adf80de5307551c4df6822395"
    ],
    "unitKeys": [
      "c7b77f64429a74df32be495749da8c6a3cda9aea17d105785af3e2f5af3b0ed3"
    ]
  },
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": {
    "deviceIds": [
      "b7384a1097c8f9e6d5a0a934dcaedcd36801942a7d3e004c1fd325da2485703d"
    ],
    "unitKeys": [
      "a908d452f8862119b912ad3acea739f19f28a7be3dc156ee34e2b9ea022b5b52"
    ]
  },
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": {
    "deviceIds": [
      "243975837bab773aae6c0f9e97a1761aa58df4a2297c15b8038f20786d3aa1f0"
    ],
    "unitKeys": [
      "eead47260a17c1a74d31300db869d34b68c745b2aee180a4a95854e6547e8969"
    ]
  },
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": {
    "deviceIds": [
      "f89947f4b8c55055e5a0dbafdf91bf47271eee1fcd0c6d9b330ad66bd09f7348"
    ],
    "unitKeys": [
      "324af4cac4e8cc5134d8054cf8844df222bc70031674c59a5c06896c7323549e"
    ]
  },
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": {
    "deviceIds": [
      "cc80cf5c50e4f58afa3a34426e6ab2892688ee67404bf5c4648f4401f653f488"
    ],
    "unitKeys": [
      "bb48ad2e49241a2dfed735d7885dd76b09a829ae6ab4d0cc1f276a89326e2868"
    ]
  },
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": {
    "deviceIds": [
      "fa2b9d2805a9ca2b2c712ac9120619aa102bce215455dfc64ae8696be749bfdf",
      "e1c803241fff73243cf6fde3ede3f8987ac92f1311c79dc27c935ffdd7ab4f46",
      "11559481f0a6625f23350ec07651bc78652bfbd6112978a6e326b36722158614",
      "fb78f7adfc8bc42259697edcda70b71d19f349027ab4d1f1292e7a6f60891979"
    ],
    "unitKeys": [
      "f96744e42044ad54ba9833acfe7b6822a983de5bbb264ced202e46000bf96a7b"
    ]
  },
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": {
    "deviceIds": [
      "f5866e10e59982d31e61d0dbd46e455d32264cf75d2f71005308391afe73f99b"
    ],
    "unitKeys": [
      "34c3925f1c1f796c1212946151d01c69d8212c3cae675b55edc13343d121f4f7"
    ]
  },
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": {
    "deviceIds": [
      "8f416cabecb90f5e2d8de9e502dd3cfcdb634fa7ce1dbfeaebcebd54428c7459",
      "5e78181a273b1c5f1c617a4a9df5cf9023d57a0f13de1617956a29343d492472",
      "e307ac23bd53b981621a11fb2ee9ced89ad551bfbabb798003b8bc55759d89c6",
      "e39547ab2765acd6cd5d20d0f2376ac8dc0ca5e5fb9d04ceec20077866beb488"
    ],
    "unitKeys": [
      "8564fa21999e93b6f675a8ff182d4f70ada990eebdb688f8064aa38b741e6d89"
    ]
  },
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": {
    "deviceIds": [
      "f508623abf2451d8ac32b0cb53513a6a0fe9a6b886603cd06d8e29b216a2dd94"
    ],
    "unitKeys": [
      "f3a9658f6c9ecc5cb161015c0a61fd0488869437c1035743a4b21cda05db68f0"
    ]
  },
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": {
    "deviceIds": [
      "7f061dfb3a5fc99313a690e7af37f2e4e3a0d666c82404fa2b9aef82d5cb6a05"
    ],
    "unitKeys": [
      "b850d6bf0f6f77ba0e4a083f599f880b8aac6299b2f50b5fc0365d98c07bd347"
    ]
  },
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": {
    "deviceIds": [
      "4d878129c95827be209ee7a834656ada5aa09294b4edfce5af56e80a175e3b31"
    ],
    "unitKeys": [
      "f60294f9c22f3a85444df8d247bed2ea11d55afe54b54e663d3f8762685c0780"
    ]
  },
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": {
    "deviceIds": [
      "73ccc4db07140df2b560a5275433e73835906d2efa7a81159bd5a8a7e7ad8557",
      "3edc0f54c06f1f645b467586d62d3fe7a697c348068c72027c2b71b52fca3858",
      "8c7f5bc4248083fcf9a5f30388b5687f67b5b47b7875fa2a7d589c5f1c56976c",
      "99189cb4deac74063fdce09e0a7564e222239d1ad9b7748dbe4c84ecc5a25ce9"
    ],
    "unitKeys": [
      "f2a8a5797aef7c756007f920be1a981751d12d494a8c5fea841edfac4436df7d"
    ]
  },
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": {
    "deviceIds": [
      "239c17672f308fe61391965a86268bd436cb525caec68f316d4c9c09e291c970"
    ],
    "unitKeys": [
      "b0b6bafb6ffef36f95fdcf40cae3916d548d1af8e663a12009fa8f04190f002d"
    ]
  },
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": {
    "deviceIds": [
      "90a9543b234fdd747253602baebe7f939ecd5ddf75801afc0c13c954d8c2ff78",
      "f0b71e6c142353fffa5bfbeb7e43f2c992eab3a6269682f0b697ede2de729bb2",
      "f3637d99bc0af03946eb504f919a16d1921b90aa756d61bdbd3d776e87a88848",
      "6857b2b09b03bbf2836fd0a2237cc6377c1392e1e9651b8ed149569b1ade7fb1"
    ],
    "unitKeys": [
      "bb4655f03cb8ab05c0a02493e10148dd3b6f1215b264160491078465e5786463"
    ]
  },
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": {
    "deviceIds": [
      "7442f5cb4c2ed1c50ea353fcb471c79e17acc9c016ffa9b3a63ebabe7f6e6d67",
      "a038958d0c7a2fbcaa8d46bc319c939b834306dc5dd7b0f85f4e2dea7dcc06dd",
      "b402f36f5502110a00a71bfbaa49f462a9e4ec8a374b703dc7676e33599981bc",
      "2c0c439f85bd6c43aced68463661ccfe6a5b93493bf6b2003e594144f2fd9e33"
    ],
    "unitKeys": [
      "e04cd4d8920c17a87184d2b212b5875112affda1c3ee0675edb35b3204dea1f7"
    ]
  },
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": {
    "deviceIds": [
      "61abebaa85ac33ea77121f6807dff35f95ef1890498d201ca5c74e2e4e832df9"
    ],
    "unitKeys": [
      "7f13c7accc26a8869e56131e2b3a1fc336f75dc8327c13e58ec600bbc1f96716"
    ]
  },
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": {
    "deviceIds": [
      "4514f445364b1e3a64584c9ad990b21d3c1ee65a0ee66e4ec8f32418499fa851"
    ],
    "unitKeys": [
      "2d752b04aa5b70183cdd5f0eaa08192e45d49b11842cb05327d9c5d1a50e9846"
    ]
  },
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": {
    "deviceIds": [
      "2cbfbc8380f2af02c8f31ee709aad52775d2d44e6a4826adeddb8ac713a7b87c"
    ],
    "unitKeys": [
      "77336e11b6b72c7fa8f1589b957282386fc9c46f46a60acc366ea45b2e0bbd6d"
    ]
  },
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": {
    "deviceIds": [
      "cbccf698b0038b4d8634a9de743752fe17540eada1c3c75c3f4eaee8a78762d4"
    ],
    "unitKeys": [
      "81c1e6bacf91ff968f70c2ea6241ec0304e80da04ac2a07a84b8cbb2478906bc"
    ]
  },
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": {
    "deviceIds": [
      "acc1937c37227f704736e96adb2070804943e5a245390997e26ab9dbede13502"
    ],
    "unitKeys": [
      "e0b4c948c0396000fce4701b88a26ed13185d3b8af2e3a64cf73b8db7695a9e0"
    ]
  },
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": {
    "deviceIds": [
      "e20401c280d1d4c8dd23d70bbaf0c91d7f520ca3aa4c572efae94a4b7e73cb97"
    ],
    "unitKeys": [
      "ea0d97a3576af4ea79b5ed47283df93208a96b64e210a22d0abf5c9f19b1628b"
    ]
  },
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": {
    "deviceIds": [
      "7617cbe324442e5688429597dda8cd4c9ef8dbfdfa39f5983966dc2af0bb4810"
    ],
    "unitKeys": [
      "8482bf5e7ca5fcba169cdeb9af0848d3123c3a80d11d4a51b4dd9b89f2d96233"
    ]
  },
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": {
    "deviceIds": [
      "d794cbdeea8b519a4efaf43d4b4454f559aaf20f8b78c4fbd4577ca868001fed"
    ],
    "unitKeys": [
      "d01bddadc28478f5c2016f1a7e64884d36254bb99a22c16342ba7655a7fd92bf"
    ]
  },
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": {
    "deviceIds": [
      "3c27d672ea9e209b56ed6f39527e078878a6314907b45cf336d90006583f755c",
      "507f470bbfb8c4534cd1b4c9b377f256c6e8408b2768f601e50b5f37a1e8b1d2",
      "d405842295dcaa2702b85760e07a50dac4f7c02d0fee310fbebc596adcf06e15",
      "993cc3d0c035e3cdcef57e647919b57fd0ce2afbc3d9fdafc2bfca16bdf344d8"
    ],
    "unitKeys": [
      "992fd1fb72ea4524da9ccb1e9beac4509921f94420d7e6f439c1bbf79b5a43b9"
    ]
  },
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": {
    "deviceIds": [
      "05f2a4da11beb62fcf1a6e2515a397d91e9bb656613ca9194fb78ea9ecf98483"
    ],
    "unitKeys": [
      "dcb0e803e5b1057825f586ecd99b15c7a48b6363039a8c1527632171b532e213"
    ]
  },
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": {
    "deviceIds": [
      "6e43364728b6082f87140cbc12efd5339a5b172eafcd5e714369fd2bb55527c9"
    ],
    "unitKeys": [
      "73ef3d9bccc40f69a3ac2f6f9f3679642d2da9280e905f6d16c44df4fe833cfb"
    ]
  }
});
var REVIEWED_OWNER_RESOURCES = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": {
    "deviceIds": [
      "209cd92d69e5e61b5e25a037465715c7e424057286b073d3b1fcbcfbaf365305",
      "93d84717867c2e34178c78cb6632230d5ee8998afc774b4348a3dce662be2bdd",
      "5aefc4c442c59773331ad1042f63e0a9955afe71ae160daad16492783e92176b",
      "6a3bec5da662da31d7978826155e060ce59d62ba12fa75847da7661289b23e39"
    ],
    "unitKeys": [
      "3519b266ac74a658643efaaef31acb6e038c9bb1c29c1a2e0331b3b65bd49289"
    ]
  }
});
var REVIEWED_OWNER_PHYSICAL_IDENTITIES = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": "1d04c1b83dbec9d47b2a4b9718036d48c2a2627a4869fab5f98a71a49e23fb14"
});

// tech-checks/supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts
var organizationId = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var record2 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var text3 = (value) => typeof value === "string" && value.length > 0 && value === value.trim();
var uuid3 = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
var decimal = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
var sortIds = (values) => [...values].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var exactSet = (left, right) => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((value) => right.includes(value));
var index = (rows, key) => {
  const out = /* @__PURE__ */ new Map();
  for (const row of rows) out.set(row[key], [...out.get(row[key]) || [], row]);
  return out;
};
async function identityDigest(value) {
  const digest3 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest3), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
var nativeIdentityKey = (unitId) => identityDigest(["COS_HEALTH_NATIVE_UNIT_V1", unitId]);
var ownerIdentityKey = (controlId) => identityDigest(["COS_HEALTH_OWNER_CONTROL_V1", controlId]);
var healthResourceKey = (deviceId2) => identityDigest(["COS_HEALTH_RESOURCE_V1", deviceId2]);
var healthSourceUnitKey = (unitKey) => identityDigest(["COS_HEALTH_SOURCE_UNIT_V1", unitKey]);
function nativeIdentityTuple(unit, associations) {
  const mappings = associations.map(({ match, provider, device }) => [
    match.id,
    match.equipment_unit_id,
    match.vigilant_device_id,
    match.camera_key,
    match.match_method,
    match.confidence,
    provider.id,
    provider.source,
    provider.external_device_id,
    provider.device_name,
    provider.device_type,
    decimal(device.id),
    device.source,
    device.external_device_id,
    device.device_serial,
    device.unit_key,
    device.device_type
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return ["COS_HEALTH_NATIVE_ASSOCIATION_V1", organizationId, unit.id, unit.unit_number, mappings];
}
function ownerIdentityTuple(audit) {
  return ["COS_HEALTH_OWNER_ASSOCIATION_V1", organizationId, audit.control_id, audit.unit_key, decimal(audit.id), sortIds(audit.device_ids.map(decimal))];
}
function ownerPhysicalIdentityTuple(audit, devices) {
  const resources = devices.map((device) => [decimal(device.id), device.source, device.device_type, device.device_serial, device.external_device_id, device.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0);
  return ["COS_HEALTH_OWNER_RESOURCES_V1", organizationId, audit.control_id, resources];
}
var reviewed = { native: REVIEWED_NATIVE_IDENTITIES, owner: REVIEWED_OWNER_IDENTITIES, nativeResources: REVIEWED_NATIVE_RESOURCES, ownerResources: REVIEWED_OWNER_RESOURCES, ownerPhysical: REVIEWED_OWNER_PHYSICAL_IDENTITIES };
async function verifiedHealthIdentities(sources, review = reviewed) {
  const { units, matches, providers, devices, audits } = sources;
  if (![units, matches, providers, devices, audits].every((rows) => Array.isArray(rows) && rows.length <= 1e5 && rows.every(record2))) throw new Error("Health identity source records are unavailable.");
  const unitIds = index(units, "id"), matchIds = index(matches, "id"), providerIds = index(providers, "id"), externalProviders = index(providers, "external_device_id");
  const byNative = index(matches, "equipment_unit_id"), resourceOwners = index(matches, "vigilant_device_id");
  const deviceIds = index(devices.map((row) => ({ ...row, id: decimal(row.id) })), "id"), externalDevices = index(devices, "external_device_id"), serialDevices = index(devices, "device_serial");
  const presentIds = /* @__PURE__ */ new Map(), presentKeys = /* @__PURE__ */ new Map();
  for (const id4 of deviceIds.keys()) if (typeof id4 === "string") presentIds.set(await healthResourceKey(id4), id4);
  for (const key of new Set(devices.map((device) => device.unit_key))) if (text3(key)) presentKeys.set(await healthSourceUnitKey(key), key);
  const warningBindings = /* @__PURE__ */ new Map();
  const bindWarning = (unitId, resources) => {
    warningBindings.set(unitId, {
      deviceIds: sortIds([...new Set((resources?.deviceIds || []).flatMap((hash2) => presentIds.has(hash2) ? [presentIds.get(hash2)] : []))]),
      unitKeys: [...new Set((resources?.unitKeys || []).flatMap((hash2) => presentKeys.has(hash2) ? [presentKeys.get(hash2)] : []))].sort()
    });
  };
  const identities = [], warnings = /* @__PURE__ */ new Map();
  const reject = (unitId, reason) => {
    if (!warnings.has(unitId)) warnings.set(unitId, { unitId, reason, ...warningBindings.get(unitId) || { deviceIds: [], unitKeys: [] } });
  };
  const rejectUnavailable = (reviewKey, resources, reason) => {
    const unitId = "unavailable:" + reviewKey;
    bindWarning(unitId, resources);
    const binding = warningBindings.get(unitId);
    if (binding.deviceIds.length || binding.unitKeys.length) reject(unitId, reason);
  };
  const presentNativeKeys = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (!uuid3(unit.id)) continue;
    const reviewKey = await nativeIdentityKey(unit.id), expected = review.native[reviewKey], resources = review.nativeResources[reviewKey];
    if (!expected && !resources) continue;
    presentNativeKeys.add(reviewKey);
    bindWarning(unit.id, resources);
    if (!expected) {
      reject(unit.id, "The reviewed native association has been revoked and requires identity review.");
      continue;
    }
    if (unit.organization_id !== organizationId || unitIds.get(unit.id)?.length !== 1 || !text3(unit.unit_number)) {
      reject(unit.id, "Native equipment identity changed or is duplicated.");
      continue;
    }
    const links = byNative.get(unit.id) || [];
    if (!links.length) {
      reject(unit.id, "Reviewed provider-resource mappings are missing.");
      continue;
    }
    const associations = [];
    let reason = null;
    for (const match of links) {
      if (match.organization_id !== organizationId || !uuid3(match.id) || matchIds.get(match.id)?.length !== 1 || !uuid3(match.vigilant_device_id) || resourceOwners.get(match.vigilant_device_id)?.length !== 1 || !text3(match.camera_key) || !text3(match.match_method) || !text3(match.confidence)) {
        reason = "Provider-resource mapping ownership is missing, changed or duplicated.";
        break;
      }
      const candidates = providerIds.get(match.vigilant_device_id) || [], provider = candidates[0];
      if (candidates.length !== 1 || provider.organization_id !== organizationId || provider.source !== "vigilant_control_center" || !text3(provider.external_device_id) || externalProviders.get(provider.external_device_id)?.length !== 1 || !text3(provider.device_name) || !["IPC", "NVR"].includes(provider.device_type)) {
        reason = "Provider identity is missing, duplicated or has an unverified family.";
        break;
      }
      const legacy = externalDevices.get(provider.external_device_id) || [], device = legacy[0];
      if (legacy.length !== 1 || !decimal(device.id) || deviceIds.get(decimal(device.id))?.length !== 1 || device.source !== "vigilant_control_center" || !text3(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text3(device.unit_key) || device.device_type !== provider.device_type) {
        reason = "Legacy resource identity is missing, duplicated or inconsistent.";
        break;
      }
      associations.push({ match, provider, device });
    }
    if (reason) {
      reject(unit.id, reason);
      continue;
    }
    const boundIds = associations.map((row) => decimal(row.device.id)), unitKeys = [...new Set(associations.map((row) => row.device.unit_key))].sort();
    const wholeGroupIds = devices.filter((device) => unitKeys.includes(device.unit_key)).map((device) => decimal(device.id));
    if (wholeGroupIds.some((id4) => !id4) || !exactSet(boundIds, wholeGroupIds)) {
      reject(unit.id, "Reviewed mapping is partial or the current source unit has extra/duplicate resources.");
      continue;
    }
    const proof = await identityDigest(nativeIdentityTuple(unit, associations));
    if (proof !== expected) {
      reject(unit.id, "The complete reviewed native/provider association has changed.");
      continue;
    }
    identities.push({ unitId: unit.id, unitNumber: unit.unit_number, kind: "native_provider", deviceIds: sortIds(boundIds), unitKeys, proof });
  }
  for (const [key, resources] of Object.entries(review.nativeResources)) if (!presentNativeKeys.has(key)) rejectUnavailable(key, resources, "Reviewed native equipment identity is missing from the current inventory.");
  const knownOwners = /* @__PURE__ */ new Set(), presentOwnerKeys = /* @__PURE__ */ new Set();
  for (const audit of audits) {
    if (!uuid3(audit.control_id)) continue;
    const key = await ownerIdentityKey(audit.control_id), resources = review.ownerResources[key];
    if (resources) {
      knownOwners.add(audit.control_id);
      presentOwnerKeys.add(key);
      bindWarning(audit.control_id, resources);
    }
  }
  for (const [key, resources] of Object.entries(review.ownerResources)) if (!presentOwnerKeys.has(key)) rejectUnavailable(key, resources, "Reviewed Owner placement history is missing from the current inventory.");
  const currentOwners = /* @__PURE__ */ new Set();
  for (const audit of currentOwnerPlacements(audits, devices)) {
    if (!uuid3(audit.control_id)) continue;
    currentOwners.add(audit.control_id);
    if (audit.conflictReason) {
      reject(audit.control_id, "Owner placement identity needs review: " + audit.conflictReason);
      continue;
    }
    const proof = await identityDigest(ownerIdentityTuple(audit));
    if (!review.owner.has(proof)) {
      if (knownOwners.has(audit.control_id)) reject(audit.control_id, "The current Owner placement audit has not been reviewed for health identity.");
      continue;
    }
    const ownerDevices = devices.filter((device) => audit.device_ids.map(decimal).includes(decimal(device.id))), boundIds = ownerDevices.map((device) => decimal(device.id));
    if (!exactSet(boundIds, audit.device_ids.map(decimal)) || ownerDevices.some((device) => device.unit_key !== audit.unit_key || deviceIds.get(decimal(device.id))?.length !== 1) || unitIds.has(audit.control_id)) {
      reject(audit.control_id, "Owner control identity or exact resource membership is inconsistent.");
      continue;
    }
    if (ownerDevices.some((device) => device.source !== "vigilant_control_center" || device.device_type !== "IPC" || !text3(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text3(device.external_device_id) || externalDevices.get(device.external_device_id)?.length !== 1)) {
      reject(audit.control_id, "Owner physical camera identity is missing, duplicated or has an unverified provider or resource kind.");
      continue;
    }
    if (await identityDigest(ownerPhysicalIdentityTuple(audit, ownerDevices)) !== review.ownerPhysical[await ownerIdentityKey(audit.control_id)]) {
      reject(audit.control_id, "The reviewed Owner physical camera identities have changed.");
      continue;
    }
    identities.push({ unitId: audit.control_id, unitNumber: audit.unit_key, kind: "owner_placement", deviceIds: sortIds(boundIds), unitKeys: [audit.unit_key], proof, placementAuditId: decimal(audit.id) });
  }
  for (const unitId of knownOwners) if (!currentOwners.has(unitId)) reject(unitId, "The reviewed Owner placement control is no longer current.");
  if (sources.ownerCrosswalk) {
    const confirmed = await projectOwnerConfirmedIdentities({ units, devices, matches, providers, epochs: sources.ownerEpochs || [], crosswalk: sources.ownerCrosswalk });
    for (const identity of confirmed.unitIdentities) identities.push(identity);
    for (const warning of confirmed.identityWarnings) warnings.set(warning.unitId, warning);
  }
  const claims = /* @__PURE__ */ new Map();
  for (const identity of identities) for (const id4 of identity.deviceIds) claims.set(id4, /* @__PURE__ */ new Set([...claims.get(id4) || [], identity.unitId]));
  const conflicts = new Set(identities.filter((identity) => identities.filter((other) => other.unitId === identity.unitId).length !== 1 || identity.deviceIds.some((id4) => claims.get(id4).size !== 1) || [...warnings.values()].some((w) => w.unitId !== identity.unitId && (w.deviceIds.some((id4) => identity.deviceIds.includes(id4)) || w.unitKeys.some((key) => identity.unitKeys.includes(key))))).map((identity) => identity.unitId));
  for (const unitId of conflicts) reject(unitId, "Health resources have more than one equipment identity.");
  const admitted = identities.filter((identity) => !warnings.has(identity.unitId)).sort((a, b) => a.unitId.localeCompare(b.unitId));
  return { identityVersion: 1, unitIdentities: admitted.filter((identity) => identity.kind !== "owner_confirmed_native"), ...sources.ownerCrosswalk ? { ownerConfirmedIdentityVersion: 1, ownerConfirmedUnitIdentities: admitted.filter((identity) => identity.kind === "owner_confirmed_native") } : {}, identityWarnings: [...warnings.values()].sort((a, b) => a.unitId.localeCompare(b.unitId)) };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraEvidence.ts
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
var normalized3 = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp2(value, now = Date.now()) {
  if (typeof value !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS2 } : { at: null, fresh: false };
}
var sourceText = (value) => typeof value === "string" ? value : null;
var object2 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function serviceEvidence(device, health = {}, witness = false, now = Date.now()) {
  const failures = Number.isSafeInteger(health.consecutive_failures) && health.consecutive_failures >= 0 ? health.consecutive_failures : null;
  const ports = object2(health.port_status) ? health.port_status : {};
  const actualPorts = Object.entries(ports).filter(([key, value]) => /^[1-9][0-9]{0,4}$/.test(key) && Number(key) <= 65535 && object2(value) && typeof value.online === "boolean" && value.attempted !== false);
  const proof = object2(ports._connection) ? ports._connection : null;
  const saved = savedCameraConnection(device.public_ip, device.expected_ports);
  const revision3 = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? value : null;
  const actualKeys = actualPorts.map(([key]) => Number(key)).sort((a, b) => a - b);
  const completePorts = Boolean(saved?.ports.length && actualKeys.length === saved.ports.length && actualKeys.every((port, index2) => port === saved.ports[index2]));
  const bound = Boolean(proof && completePorts && saved && proof.ip === saved.publicIp && revision3(proof.revision) !== null && revision3(proof.revision) === revision3(device.connection_revision) && cameraTimestamp2(proof.checkedAt, now).at);
  const supported = witness || bound;
  const reported = witness ? health.status : bound ? proof.status : health.overall_status;
  const reachability = witness ? health.reachable : bound ? proof.reachable : health.ip_reachable;
  return { kind: "service_port", source: witness ? "Witness service-port check" : "Direct service-port check", resource: "service", active: normalized3(device.activation_state) === "ACTIVE", status: supported && ["online", "offline", "degraded"].includes(reported) ? reported : "unknown", observedAt: supported ? sourceText(bound ? proof.checkedAt : health.checked_at) : null, lastOnlineAt: !witness && supported ? sourceText(device.last_probe_online_at) : null, reachable: supported && typeof reachability === "boolean" ? reachability : null, confirmedOutage: supported && (bound ? proof.confirmedOutage === true : health.confirmed_outage === true), consecutiveFailures: supported ? bound ? Number.isSafeInteger(proof.consecutiveFailures) ? proof.consecutiveFailures : null : failures : null };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts
function reconBatteryEvidence(percent, percentAt, status, statusAt) {
  const numeric = typeof percent === "number" ? percent : typeof percent === "string" && /^\d+(?:\.\d+)?$/.test(percent.trim()) ? Number(percent) : NaN;
  return { source: "Reconeyez", percent: Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null, percentObservedAt: typeof percentAt === "string" ? percentAt : null, status: typeof status === "string" && ["normal", "low", "critical"].includes(status) ? status : null, statusObservedAt: typeof statusAt === "string" ? statusAt : null };
}
var normalized4 = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp3(value, now = Date.now()) {
  if (typeof value !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS2 } : { at: null, fresh: false };
}
var providerSource2 = (value) => ["Star4Live", "Reconeyez"].includes(String(value));
function currentCameraStatus2(evidence, now = Date.now()) {
  return evidence?.kind === "provider" && ["camera", "detector"].includes(evidence.resource || "") && evidence.active === true && providerSource2(evidence.source) && cameraTimestamp3(evidence.observedAt, now).fresh && ["online", "offline"].includes(evidence.status) ? evidence.status : "review";
}
var sourceText2 = (value) => typeof value === "string" ? value : null;
var resourceId = (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
var object3 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function cameraScope(device, tracker = []) {
  const activation = normalized4(device.activation_state), org = normalized4(device.organization), unit = normalized4(device.unit_key);
  if (device.__ownerPlacement === "FIELD" || device.__ownerPlacement === "SHOP" || device.__ownerPlacement === "UNKNOWN") return device.__ownerPlacement.toLowerCase();
  if (/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(unit) || /^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(org) || ["RETIRED", "STOLEN", "NOT IN USE"].includes(org) || /^RII?[-\s]*\d+\s*-?\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit)) return "inactive";
  if (["ROOT", "SHOP", "SHOP/ROOT", "ROOT/SHOP", "SHOP / ROOT", "ROOT / SHOP", "SHOP EQUIPMENT"].includes(org) || unit === "SHOP EQUIPMENT" || /^RII?[-\s]*\d+\s*-?\s*SHOP$/.test(unit)) return "shop";
  if (activation === "DEACTIVATED") return "inactive";
  if (activation !== "ACTIVE") return "unknown";
  const matches = tracker.filter((row) => normalized4(row.source_label) === unit);
  if (matches.length > 1 || matches.some((row) => ["shop", "retired"].includes(row.tracker_state))) return "unknown";
  if (device.__trackerOnly || !org || ["TRACKER FIELD", "TRACKER \xB7 SITE NOT LINKED", "UNKNOWN", "FIELD OR UNKNOWN"].includes(org)) return "unknown";
  return "unknown";
}
function cameraEvidence(device) {
  const type = String(device.device_type || "").trim().toLowerCase();
  const resource = ["ipc", "camera"].includes(type) ? "camera" : ["detector", "reconeyez detector"].includes(type) ? "detector" : type === "nvr" ? "recorder" : "unknown";
  const provider = device.source === "vigilant_control_center" ? "Star4Live" : device.source === "reconeyez" ? "Reconeyez" : null;
  const active = normalized4(device.activation_state) === "ACTIVE";
  return { kind: provider && resource !== "unknown" ? "provider" : "unknown", source: provider || "Unverified provider source", resource, active, status: ["online", "offline"].includes(device.source_status) ? device.source_status : "unknown", observedAt: sourceText2(device.source_last_seen_at), lastOnlineAt: sourceText2(device.last_online_at) };
}
function validateCameraSources(devices, health, tracker) {
  if (![devices, health, tracker].every(Array.isArray)) throw new Error("Camera Health source records are unavailable.");
  const textOrMissing = (value) => value == null || typeof value === "string", seen = /* @__PURE__ */ new Set(), checked = /* @__PURE__ */ new Set();
  for (const row of devices) {
    const id4 = object3(row) ? resourceId(row.id) : null;
    if (!id4 || seen.has(id4) || !["device_name", "device_type", "organization", "unit_key", "source", "source_status", "source_last_seen_at", "last_online_at", "last_probe_online_at", "activation_state"].every((key) => textOrMissing(row[key]))) throw new Error("Camera Health returned malformed or duplicate device identities.");
    seen.add(id4);
  }
  for (const row of health) {
    const id4 = object3(row) ? resourceId(row.camera_device_id) : null;
    if (!id4 || !seen.has(id4) || checked.has(id4) || !["overall_status", "checked_at"].every((key) => textOrMissing(row[key])) || row.confirmed_outage != null && typeof row.confirmed_outage !== "boolean" || row.ip_reachable != null && typeof row.ip_reachable !== "boolean" || row.consecutive_failures != null && (!Number.isSafeInteger(row.consecutive_failures) || row.consecutive_failures < 0)) throw new Error("Camera Health returned malformed or duplicate health identities.");
    checked.add(id4);
  }
  for (const row of tracker) if (!object3(row) || !["canonical_family", "unit_tag", "source_label", "tracker_state"].every((key) => typeof row[key] === "string") || !textOrMissing(row.health_provider)) throw new Error("Camera Health tracker placement records are malformed.");
}
var trackerFamilies = ["Helios", "Ranger", "Solar Spotter", "Spotter", "SS Hybrid", "CAMV", "Sniper", "Sniper 2", "Sniper 4", "Recon", "Recon 2"];
function canonicalTrackerKey(row) {
  const family = trackerFamilies.find((value) => normalized4(value) === normalized4(row.canonical_family)), tag = row.unit_tag.trim();
  if (!family || !/^\d{1,6}(?:\.\d+)?$/.test(tag) || Number(tag.split(".")[0]) === 0) return null;
  const [base, ...tail] = tag.split(".");
  return family.toLowerCase() + "|" + String(Number(base)).padStart(3, "0") + (tail.length ? "." + tail.join(".") : "");
}
function deviceTrackerKey(unit) {
  if (typeof unit !== "string") return null;
  const scoped = /^(RII?[-\s]*\d+)\s*-?\s*(?:SHOP|NOT IN USE|RETIRED|STOLEN)$/.exec(normalized4(unit));
  const stolen = /^STOLEN FROM (RII?[-\s]*\d+) ON \d{2}\/\d{2}\/\d{4}$/.exec(normalized4(unit));
  const identityLabel = scoped?.[1] || stolen?.[1] || unit.trim();
  const match = /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER(?:\s+[24])?|CAM\s*V|RECON(?:\s+(?:2|II))?|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(identityLabel);
  if (!match) return null;
  const aliases = { RI: "Recon", RII: "Recon 2", RECONII: "Recon 2", RECON2: "Recon 2" };
  const condensed = normalized4(match[1]).replace(/\s/g, "");
  const family = aliases[condensed] || trackerFamilies.find((value) => normalized4(value).replace(/\s/g, "") === condensed);
  return family ? canonicalTrackerKey({ canonical_family: family, unit_tag: match[2], source_label: "", tracker_state: "" }) : null;
}
function witnessUnits(integrations) {
  if (!Array.isArray(integrations) || integrations.some((row) => !object3(row) || row.provider !== "witness" || row.units != null && !object3(row.units))) throw new Error("Witness service observations are malformed.");
  if (integrations.length > 1) throw new Error("Witness service observations have duplicate provider identities.");
  return integrations[0]?.units || {};
}
function cameraSummary(devices, health, now = Date.now(), tracker = [], integrations = []) {
  validateCameraSources(devices, health, tracker);
  const byId = new Map(health.map((row) => [resourceId(row.camera_device_id), row])), witness = witnessUnits(integrations);
  const rows = devices.map((device) => {
    const evidence = cameraEvidence(device), service = serviceEvidence(device, byId.get(resourceId(device.id)) || {}, false, now);
    const row = { id: device.id, name: device.device_name || device.unit_key || "Resource " + device.id, unit: device.unit_key || "", type: device.device_type || "", organization: device.organization || "", activationState: device.activation_state || "", scope: cameraScope(device, tracker), status: "review", checkedAt: evidence.observedAt, evidence, serviceEvidence: service };
    const connection = savedCameraConnection(device.public_ip, device.expected_ports);
    if (connection) row.connection = connection;
    if (device.source === "reconeyez") row.batteryEvidence = reconBatteryEvidence(device.recon_battery_percent, device.recon_battery_updated_at, device.recon_battery_status, device.recon_battery_status_updated_at);
    row.status = ["field", "unknown"].includes(row.scope) ? currentCameraStatus2(evidence, now) : "review";
    return row;
  });
  const linked = new Set(devices.map((device) => deviceTrackerKey(device.unit_key)).filter(Boolean));
  for (const device of devices) for (const record3 of tracker.filter((row) => normalized4(row.source_label) === normalized4(device.unit_key))) {
    const key = canonicalTrackerKey(record3);
    if (key) linked.add(key);
  }
  const synthesized = /* @__PURE__ */ new Set();
  for (const record3 of tracker) {
    const key = canonicalTrackerKey(record3);
    if (!key || record3.tracker_state !== "field_or_unknown" || linked.has(key) || synthesized.has(key)) continue;
    synthesized.add(key);
    const peers = tracker.filter((row) => canonicalTrackerKey(row) === key);
    const exactLabel = normalized4(record3.source_label), labelKey = deviceTrackerKey(record3.source_label), identitySafe = peers.length === 1 && exactLabel !== "" && (!labelKey || labelKey === key) && tracker.filter((row) => normalized4(row.source_label) === exactLabel).length === 1;
    const observed = identitySafe && String(record3.health_provider || "").toLowerCase() === "witness" && Object.hasOwn(witness, key) && object3(witness[key]) ? witness[key] : {};
    const service = serviceEvidence({ activation_state: "active" }, observed, true, now);
    rows.push({ id: "tracker:" + key, name: record3.source_label || record3.canonical_family + " " + record3.unit_tag, unit: record3.source_label || record3.canonical_family + " " + record3.unit_tag, type: "tracker_unit", organization: "TRACKER \xB7 SITE NOT LINKED", activationState: "active", scope: "unknown", trackerOnly: true, status: "review", checkedAt: service.observedAt, serviceEvidence: service });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const fields = rows.filter((row) => row.scope === "field");
  const inventory = { allRecords: rows.length, activeFieldRecords: fields.length, activeShopRecords: rows.filter((row) => row.scope === "shop").length, inactiveRecords: rows.filter((row) => row.scope === "inactive").length, unknownScopeRecords: rows.filter((row) => row.scope === "unknown").length, sourceDeviceRecords: devices.length, trackerOnlyRecords: rows.filter((row) => row.trackerOnly).length };
  return { totalDevices: rows.length, healthRows: health.length, fieldDevices: fields.length, shopRoot: inventory.activeShopRecords, online: fields.filter((row) => row.status === "online").length, offline: fields.filter((row) => row.status === "offline").length, review: fields.filter((row) => row.status === "review").length, rows, refreshedAt: new Date(now).toISOString(), source: "Camera Health", evidenceVersion: 2, inventory, coverageNote: "Provider systems, camera/detector observations and service ports are separate. Expected camera channel coverage is not established. Field devices counts confirmed-field resources; displayed inventory also includes unresolved placement, shop/root, inactive and tracker-only resources." };
}

// tech-checks/supabase/functions/cos-operations-pages/reviewedAddressEstimates.ts
var payloadKeys = "schemaVersion organizationId trackerId unitNumber source originalAddress originalAddressSha256 matchedAddress latitude longitude provider providerAccuracy providerAccuracyType providerMatchType providerDataSource providerResultSha256 confidence verified liveGps requiresOwnerConfirmation approvalReference batchId approvedAt retrievedAt appliedAt appliedByDatabaseRole addressMatchReview binding approvalSha256 applicationSha256".split(" ");

// tech-checks/supabase/functions/cos-operations-pages/importedAddressContract.ts
var states = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" "));

// tech-checks/supabase/functions/cos-operations-pages/fieldRecorderObservation.ts
var REVIEWED_FIELD_RECORDER_PROOFS = /* @__PURE__ */ new Set([
  "c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049",
  "8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6",
  "1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816",
  "ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c",
  "3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a"
]);
var object4 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var id2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : null;
var same = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
function fieldRecorderObservationGuards(sources, identity, now = Date.now(), reviewed2 = REVIEWED_FIELD_RECORDER_PROOFS) {
  const result = { fieldRecorderObservationVersion: 1, fieldRecorderObservationGuards: [] };
  if (!Number.isFinite(now) || ![sources.units, sources.devices, sources.audits].every((v) => Array.isArray(v) && v.length <= 1e5 && v.every(object4)) || identity?.identityVersion !== 1 || !Array.isArray(identity.unitIdentities) || !Array.isArray(identity.identityWarnings)) return result;
  const { units, devices, audits } = sources;
  if (new Set(units.map((u) => u.id)).size !== units.length || new Set(devices.map((d) => id2(d.id))).size !== devices.length || devices.some((d) => !id2(d.id) || typeof d.unit_key !== "string") || audits.some((a) => !id2(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((v) => !id2(v))) || new Set(audits.map((a) => id2(a.id))).size !== audits.length) return result;
  for (const proof of identity.unitIdentities) {
    if (!object4(proof) || proof.kind !== "native_provider" || !reviewed2.has(proof.proof) || !Array.isArray(proof.deviceIds) || !proof.deviceIds.length || !Array.isArray(proof.unitKeys) || !proof.unitKeys.length) continue;
    const native = units.filter((u) => u.id === proof.unitId), rows = devices.filter((d) => proof.deviceIds.includes(String(d.id)));
    if (native.length !== 1 || native[0].unit_number !== proof.unitNumber || native[0].status !== "available" || identity.unitIdentities.filter((p) => p.unitId === proof.unitId).length !== 1 || !same(rows.map((d) => String(d.id)), proof.deviceIds) || !same([...new Set(rows.map((d) => d.unit_key))], proof.unitKeys) || !same(devices.filter((d) => proof.unitKeys.includes(d.unit_key)).map((d) => String(d.id)), proof.deviceIds) || rows.some((d) => d.source !== "vigilant_control_center" || d.device_type !== "NVR")) continue;
    const related = (p) => p.unitId === proof.unitId || p.deviceIds?.some((v) => proof.deviceIds.includes(v)) || p.unitKeys?.some((v) => proof.unitKeys.includes(v));
    if (identity.identityWarnings.some(related) || [...identity.unitIdentities || [], ...identity.ownerConfirmedUnitIdentities || []].some((p) => p !== proof && related(p))) continue;
    const labels = new Set([proof.unitNumber, ...proof.unitKeys].map(placementMatchKey));
    if (audits.some((a) => labels.has(placementMatchKey(a.unit_key)) || a.device_ids.some((v) => proof.deviceIds.includes(id2(v))))) continue;
    result.fieldRecorderObservationGuards.push({ unitId: proof.unitId, unitNumber: proof.unitNumber, identityProof: proof.proof, deviceIds: [...proof.deviceIds], unitKeys: [...proof.unitKeys], checkedAt: new Date(now).toISOString() });
  }
  return result;
}
function fieldRecorderHealthGuards(sources, identity, integrations, now = Date.now(), reviewed2 = REVIEWED_FIELD_RECORDER_PROOFS) {
  const empty = { fieldRecorderObservationVersion: 1, fieldRecorderObservationGuards: [] };
  if (!Array.isArray(integrations) || integrations.length > 1e3 || integrations.some((v) => !object4(v))) return empty;
  const matches = integrations.filter((v) => v.provider === "vigilant");
  if (matches.length !== 1) return empty;
  const integration = matches[0], sync = cameraTimestamp2(integration.last_sync_at, now);
  if (integration.enabled !== true || integration.last_sync_status !== "ok" || !sync.fresh || !sync.at) return empty;
  const guarded = fieldRecorderObservationGuards(sources, identity, now, reviewed2);
  return { ...guarded, fieldRecorderObservationGuards: guarded.fieldRecorderObservationGuards.filter((guard) => sources.devices.filter((d) => guard.deviceIds.includes(String(d.id))).every((d) => cameraTimestamp2(d.source_last_seen_at, now).at === sync.at)).map((guard) => ({ ...guard, providerSyncAt: sync.at })) };
}

// tech-checks/supabase/functions/_shared/reconProviderInventory.ts
async function reconDigest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
}
var reconResourceKey = (id4) => reconDigest(["COS_RECON_RESOURCE_V1", id4]);
var reconAreaKey = (area) => reconDigest(["COS_RECON_AREA_V1", area]);

// tech-checks/supabase/functions/cos-operations-pages/reconProviderIdentityScope.ts
var REVIEWED_RECON_PROVIDER_GROUPS = Object.freeze({
  "3ffa6bebc98ce6a18fcd19d6864cd427f436814325a402790549612ce3ed816b": {
    "trackerProof": "bd73a29c42c57f60632d424eae04c2117807786b28658c3ed989ffda45e47fc6",
    "bridgeKey": "796b80a6977dc58ab4b786250b8f61e2eb302881181e7c8de177ab5464610dc0",
    "areaKey": "c9f7590b4cca5f5f6988d722608885e877ce4013b7c938fe8615dc33cc83c8d5",
    "providerProof": "615975d6b6774fe7a3b517845fa65be415dd452c6327f28b5429e663c5558d7f",
    "physicalProof": "2003743817699f54ada3b01f724bbad00e95ffe88acd98a1c54eb068d4c73c7b",
    "resourceIds": [
      "9f42396d7b99b6aa9d060852632861a35437610e85858cbceeaebbb6db5e9627",
      "913385cec831e6cf511f6545923755727641a29e0d439f29bd3b0302ac95a5a7"
    ],
    "sourceKeys": [
      "46fa3adf60c53556808de87ae9d1bb44afd0b40fbdc6780c3a2f79f8395f9754"
    ],
    "detectorCount": 2
  },
  "666b98c5d6c3dbaa8f6aef8e5ef4966ce82fc21656f1792ef916e72d22367b36": {
    "trackerProof": "80fa7e7150f33d3d01e04a3c9ab698ffc56b6c1a12d9278b9157c151f4622310",
    "bridgeKey": "1b0dee02fbebfa0753ec4ae2f2cc62bd03f5eda8a613cd315fa51263b776dd65",
    "areaKey": "f71fba6e25c1ec21fc32c6f336d824708cd1ba61c326c77cb14124818f93890c",
    "providerProof": "f7470422ab407fe518a2bc284726ac9e751c2c22a9d0d99f1f6108dccdfad917",
    "physicalProof": "f37c6025a3aed49669d6f7b1d11f99416d49ca84b2922735e84c75fd3f323252",
    "resourceIds": [
      "34dd1ca5c07c3493dcd505dc0fa2bcbfa04838fea4a1f6435868ae4b0d03c070"
    ],
    "sourceKeys": [
      "f48d4e7432d7712aebf9c36911e1c3fdd23d6ee2b48a42087594082300b3e0e0"
    ],
    "detectorCount": 1
  },
  "a3d5e5808743bdf66ae1c5f409f1079134a2b25d704e326468b82cda7e8e478b": {
    "trackerProof": "55b453fa4c1e46103084f7d399feed6d4a973c0758cf2c7a827a85b6f9990491",
    "bridgeKey": "fcc6759136552cc9fea38380c3c6d5155a4971f583dee0224b47a9415d67d3a0",
    "areaKey": "dbbb008cf4f40c5ab04683efcbee61885593812de3ee4a06db1fbd9b0d15e614",
    "providerProof": "a6ec617912b54caa5f6758bc3ecfe3068aab2949e7052c5d6d51f39f29f25305",
    "physicalProof": "c88e733888e276a25c2a5f5fc9dd38e7751945a1a276b9abcec4aa8cde944efe",
    "resourceIds": [
      "d8732d3b3b11d85520784968ca241bc403771157ff2a6cc4aad0dbc54889a1d0",
      "cf0398adf892a53548ff2d4484335bb8a5532eef20ed81955fcbfa5fbecef817",
      "f1140778cd48ebee9585c0c888057e13b26852363441f497c9ca6b3ff427a49d"
    ],
    "sourceKeys": [
      "587a8c64416e8b0d87535f2e5733e3ee9dfd6fb3c6502ac22f2946d47a9df60c"
    ],
    "detectorCount": 3
  },
  "c80fe3061216318990677c6b3ff2ac8b5b7f0dfee527ce05a134375542279bc6": {
    "trackerProof": "da1cf7bca67db7a3b2e867408996649ba0391102845e509bc6e679f21dfeb4e6",
    "bridgeKey": "21484c99e784ecfb90282bd2360b5dfb2ab3d72a9d970f8ea254e39c57d9ba81",
    "areaKey": "ce480f1859d42cd9313e6b4a9dd0cf804b4d8e183ee1a414a38547681053727a",
    "providerProof": "a2df905aec6b7bcbc230dc222303468afc32052ea93659038cd455c3048ecae6",
    "physicalProof": "3d1f821074dc899807d9620ea74c2ad2c29333c5748b5a46cc0af34927b213ac",
    "resourceIds": [
      "9d853a1a9b74c62b4b6565548b92a7bc826005f23251d10b8a045d80e81f7190",
      "b0058f8c81f726c567896f2cf2676102dc6e2e63f8f3a8902636947f33a6a151"
    ],
    "sourceKeys": [
      "392866a4e5f84691d9a60f8c232e5371347f3837f2927bdec45c687e21b15807"
    ],
    "detectorCount": 2
  },
  "d66d9f5d658fbf61dc5bf499a5ef4c9fe0a5c2d7334640a96caa0fe0addb3a25": {
    "trackerProof": "51a1cc815678cfe564aa5ec15ea09014299053e3a157d808c38f0979504b4c65",
    "bridgeKey": "ba29fd8ac5b3448cab8b42a89253cf20a63652893c499873d3d8512ff8e1f892",
    "areaKey": "b669e0064ba7cc84a266b2a375f59d9c335f1766bb4d151618663e6dcfd63c12",
    "providerProof": "56a6e36bb539a11f8550249add7181ef68c2e452216dd9e9c741a09d55245428",
    "physicalProof": "6c8f32714fdda81e02d96784bdd2750585ac108ef5da85dcaed40c25d97dafa8",
    "resourceIds": [
      "956006c85c17539488b1f4a5a15164bcbd5dfe7f0cba61f8f27d26bd1f380e15",
      "c003b482adcd7a9dcf2f91ca6d58147e730e5433b38189613fda75020aa94b77",
      "c157e41eb11a5fecd7f2c208e0e9d17f2dec44e5289c726a1fcbd92be76c4993"
    ],
    "sourceKeys": [
      "d39a821e26efa4123866c0e5ce1a87816808412b9406cad3c4b0fc1175d1602b"
    ],
    "detectorCount": 3
  },
  "e581a6ec4853592798a8c7baa282351f5a11ccc44e2b406b42f58f09ce30215b": {
    "trackerProof": "d7dc1c89173f314789c475c528c0933e4f44839ba4ee8f6473bac374b1d49a31",
    "bridgeKey": "041fb3b42af8cce28522d2697896f75c285c70f1024e2619caaba807d8ac2a34",
    "areaKey": "84648bf77345ef400f66201f8be88c4817e7bdf0e3be33b6c19bc5e425ec56ab",
    "providerProof": "0ad2e04c51b1a1573ad61d09bbf377d2c88da637cf2808c758d5708512c99c94",
    "physicalProof": "e35b3fda65c5007e71022367a1186cd9bb16606f9fe2abc9e2161407ad7895ee",
    "resourceIds": [
      "afc64d1580581a327d2f3999dce7f73f6e4ffc4673962aea663dcf3bc662eb85",
      "d9f30f4f9117d9bb29379b0a183cb87558cf9796e76f260702ee13e26b7cd870",
      "dfcead410e3b8fe1a47cfa65d63d07137dbf2c5f3d7bbcd06dd435808d7d6037",
      "aa02f201bfe30351242c96840743d177477a06acd95af215d924e020806850fd"
    ],
    "sourceKeys": [
      "84bab840b4b20d74cdae6060433c0a4371d3f713138197bb8c68972f7a4e684e"
    ],
    "detectorCount": 4
  },
  "f3f45a899dceff116bf50a367364fa4575f6af5758075faf7485c6b4633795ff": {
    "trackerProof": "556b418e921f7b3aaa38937672a56d8d4f59e8c416328cfe6afca27f162302e8",
    "bridgeKey": "97a0e458ec54d6eaa69ded98e65d6f0d3ce4b417fca451d6565130e25c1693ef",
    "areaKey": "ea5ec2aebcc98515e42a6b5d95deb5a82301c7aae1908b16189340e084d0bbc3",
    "providerProof": "ed139a4468ec49d3bb687262b251ed91005c78eca169622afc9e1dc631261c38",
    "physicalProof": "d1fbb445ba6f957e1aa7e9645040e9d90428eaee14a034d9a63d389ac277a7b7",
    "resourceIds": [
      "3137c96a51c662d44e2f268cd9556dbd5672c05ea0919fcbb28e326f0f100f0a",
      "91fd78be7bbdacd7ee372e2c802859f4d224d120a8d14ddc98a3b849dbd5ade0",
      "3ac2e497ee8cddd52b9951f167170536b2aebfabde75d63c74107f38bdd8c480",
      "0f76483990b6be6d94cf62ccd1f93285f4db91109edd40c0f0298bbd3cfc21e7",
      "c8b37ed30a6efac5003815b91f56cee4864ff142628dab536fd450f0c368a297",
      "015bf3acb2bcc61b4f43673ca8cfbd064816a9b9ea7f33c17100c3a57c75afc1"
    ],
    "sourceKeys": [
      "ddd0c3168cbaa48b5a298ef461a343f3d19167d64e99e7878d247b2042ddd626"
    ],
    "detectorCount": 6
  }
});

// tech-checks/supabase/functions/cos-operations-pages/reconProviderIdentity.ts
var object5 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var uuid4 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
var id3 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : null;
var exact2 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
var fresh = (v, now) => typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) > 0 && Date.parse(v) <= now && now - Date.parse(v) <= 20 * 60 * 1e3;
var reconTrackerKey = (unitId) => reconDigest(["COS_RECON_TRACKER_V1", unitId]);
var reconTrackerTuple = (unit) => ["COS_RECON_TRACKER_ASSIGNMENT_V1", unit.id, unit.unitNumber, unit.modelName, unit.readOnly, unit.recordSource ?? null, unit.snapshotImportedAt ?? null, unit.sourceVerifiedAt ?? null];
var reconPhysicalTuple = (devices) => ["COS_RECON_AREA_PHYSICAL_V1", devices.map((d) => [id3(d.id), d.source, d.device_type, d.external_device_id, d.device_serial, d.unit_key]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
async function projectReconProviderIdentities(units, devices, integrations, review = REVIEWED_RECON_PROVIDER_GROUPS, now = Date.now()) {
  const identities = [], warnings = [];
  if (![units, devices, integrations].every((x) => Array.isArray(x) && x.every(object5))) throw Error("Reconeyez assignment sources are unavailable.");
  const presentIds = /* @__PURE__ */ new Map(), presentKeys = /* @__PURE__ */ new Map();
  for (const d of devices) {
    if (id3(d.id)) presentIds.set(await reconDigest(["COS_HEALTH_RESOURCE_V1", id3(d.id)]), id3(d.id));
    if (typeof d.unit_key === "string") presentKeys.set(await reconDigest(["COS_HEALTH_SOURCE_UNIT_V1", d.unit_key]), d.unit_key);
  }
  const provider = integrations.length === 1 && integrations[0].provider === "reconeyez" ? integrations[0] : null, index2 = provider?.identity_inventory;
  const validIndex = Boolean(provider?.enabled === true && provider.last_sync_status === "ok" && index2?.schemaVersion === 1 && fresh(index2.observedAt, now) && fresh(provider.last_sync_at, now) && Date.parse(provider.last_sync_at) === Date.parse(index2.observedAt) && Number.isSafeInteger(index2.resourceCount) && index2.resourceCount > 0 && Array.isArray(index2.groups) && index2.groups.every((g) => object5(g) && hash(g.areaKey) && hash(g.proof) && Array.isArray(g.bridgeKeys) && g.bridgeKeys.every(hash) && Array.isArray(g.detectorKeys) && g.detectorKeys.every(hash) && typeof g.bridgePrefixUnique === "boolean" && (g.bridgeLastEventAt === null || typeof g.bridgeLastEventAt === "string")));
  const seen = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (!uuid4(unit.id)) continue;
    const key = await reconTrackerKey(unit.id), expected = review[key];
    if (!expected) continue;
    seen.add(key);
    const resources = { deviceIds: expected.resourceIds.flatMap((k) => presentIds.has(k) ? [presentIds.get(k)] : []), unitKeys: expected.sourceKeys.flatMap((k) => presentKeys.has(k) ? [presentKeys.get(k)] : []) };
    const reject = (reason) => warnings.push({ unitId: unit.id, reason, ...resources });
    if (units.filter((x) => x.id === unit.id).length !== 1 || unit.readOnly !== true || unit.modelName !== "RECON II" || await reconDigest(reconTrackerTuple(unit)) !== expected.trackerProof) {
      reject("The reviewed Recon II tracker assignment changed.");
      continue;
    }
    if (!validIndex) {
      reject("Reconeyez inventory proof is missing, stale or its authenticated refresh failed.");
      continue;
    }
    const groups = index2.groups.filter((g) => g.areaKey === expected.areaKey || g.bridgeKeys.includes(expected.bridgeKey)), group = groups[0];
    if (groups.length !== 1 || group.proof !== expected.providerProof || !group.bridgePrefixUnique || !exact2(group.bridgeKeys, [expected.bridgeKey]) || group.detectorKeys.length !== expected.detectorCount) {
      reject("The reviewed Reconeyez provider-area bridge or detector membership changed.");
      continue;
    }
    const rows = devices.filter((d) => resources.deviceIds.includes(String(d.id)));
    if (rows.length !== expected.detectorCount || !exact2(rows.map((d) => String(d.id)), resources.deviceIds) || rows.some((d) => devices.filter((x) => String(x.id) === String(d.id)).length !== 1 || d.source !== "reconeyez" || d.device_type !== "Reconeyez detector" || typeof d.external_device_id !== "string" || d.device_serial !== "reconeyez:" + d.external_device_id || devices.filter((x) => x.external_device_id === d.external_device_id || x.device_serial === d.device_serial).length !== 1) || await reconDigest(reconPhysicalTuple(rows)) !== expected.physicalProof) {
      reject("The reviewed Reconeyez detector identities are incomplete or replaced.");
      continue;
    }
    const keys = [...new Set(rows.map((d) => d.unit_key))];
    if (keys.length !== 1 || await reconAreaKey(keys[0]) !== expected.areaKey || !exact2(devices.filter((d) => keys.includes(d.unit_key)).map((d) => String(d.id)), resources.deviceIds) || !exact2((await Promise.all(rows.map((d) => reconResourceKey(d.external_device_id)))).sort(), group.detectorKeys) || index2.groups.some((g) => g !== group && g.detectorKeys.some((k) => group.detectorKeys.includes(k)))) {
      reject("Reconeyez detector provider-area ownership is conflicting or changed.");
      continue;
    }
    const proof = await reconDigest(["COS_RECON_REVIEWED_AREA_V1", key, expected]);
    identities.push({ unitId: unit.id, unitNumber: unit.unitNumber, kind: "reconeyez_area", deviceIds: resources.deviceIds, unitKeys: keys, proof, providerArea: { detectorCount: expected.detectorCount, inventoryObservedAt: index2.observedAt, bridgeLastEventAt: group.bridgeLastEventAt } });
  }
  for (const [key, expected] of Object.entries(review)) if (!seen.has(key)) {
    const deviceIds = expected.resourceIds.flatMap((k) => presentIds.has(k) ? [presentIds.get(k)] : []), unitKeys = expected.sourceKeys.flatMap((k) => presentKeys.has(k) ? [presentKeys.get(k)] : []);
    if (deviceIds.length || unitKeys.length) warnings.push({ unitId: "unavailable:recon:" + key, reason: "The reviewed Recon II tracker assignment is missing.", deviceIds, unitKeys });
  }
  return { reconProviderIdentityVersion: 1, reconProviderUnitIdentities: identities, identityWarnings: warnings };
}
function appendReconProviderIdentities(identity, recon) {
  const all = [...identity.unitIdentities || [], ...identity.ownerConfirmedUnitIdentities || [], ...recon.reconProviderUnitIdentities], warnings = [...identity.identityWarnings || [], ...recon.identityWarnings];
  for (const claim of all) if (all.some((other) => other !== claim && (other.unitId === claim.unitId || other.deviceIds.some((id4) => claim.deviceIds.includes(id4)))) || warnings.some((w) => w.unitId !== claim.unitId && (w.deviceIds?.some((id4) => claim.deviceIds.includes(id4)) || w.unitKeys?.some((key) => claim.unitKeys.includes(key))))) warnings.push({ unitId: claim.unitId, reason: "Provider resources have conflicting reviewed equipment assignments.", deviceIds: claim.deviceIds, unitKeys: claim.unitKeys });
  const clean = (rows) => rows.filter((row) => !warnings.some((w) => w.unitId === row.unitId));
  return { ...identity, unitIdentities: clean(identity.unitIdentities || []), ...identity.ownerConfirmedUnitIdentities ? { ownerConfirmedUnitIdentities: clean(identity.ownerConfirmedUnitIdentities) } : {}, reconProviderIdentityVersion: 1, reconProviderUnitIdentities: clean(recon.reconProviderUnitIdentities), identityWarnings: [...new Map(warnings.map((w) => [w.unitId, w])).values()] };
}

// tech-checks/it-feature-availability.js
var IT_DAILY_WORKSPACES = Object.freeze(["Fleet Dashboard", "Camera Health"]);

// tech-checks/operations/src/fieldRecorderObservation.ts
var object6 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var same2 = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && a.every((v) => typeof v === "string" && b.includes(v));
var validGuard = (v) => object6(v) && typeof v.unitId === "string" && typeof v.unitNumber === "string" && v.unitNumber.trim() !== "" && sha(v.identityProof) && Array.isArray(v.deviceIds) && v.deviceIds.length > 0 && v.deviceIds.length <= 1e3 && new Set(v.deviceIds).size === v.deviceIds.length && v.deviceIds.every((id4) => typeof id4 === "string" && /^[1-9]\d*$/.test(id4)) && Array.isArray(v.unitKeys) && v.unitKeys.length > 0 && new Set(v.unitKeys).size === v.unitKeys.length && v.unitKeys.every((key) => typeof key === "string" && key.trim() !== "") && typeof v.checkedAt === "string" && typeof v.providerSyncAt === "string";
function fieldRecorderObservation(unit, identity, rows, health, now = Date.now()) {
  const authority = unit.fieldRecorderAuthority, binding = unit.importedInstallation, guards = health.fieldRecorderObservationGuards;
  if (identity.kind !== "native_provider" || health.fieldRecorderObservationVersion !== 1 || !Array.isArray(guards) || guards.length > 5 || guards.some((g) => !validGuard(g)) || !object6(authority) || authority.schemaVersion !== 1 || !object6(binding) || unit.readOnly !== false || unit.status !== "field" || unit.currentLocationType !== "field" || unit.importedPlacement !== "FIELD" || unit.placementSource === "owner" || unit.placementAuditId || binding.sourcePrecedence || binding.schemaVersion !== 1 || binding.sourceSystem !== "mhelpdesk_product_import" || binding.entityKind !== "equipment_unit" || binding.eligibility !== "FIELD" || binding.nativeUnitId !== unit.id || binding.unitNumber !== unit.unitNumber || identity.unitId !== unit.id || identity.unitNumber !== unit.unitNumber || !cameraTimestamp(authority.checkedAt, now).fresh) return null;
  const selected = guards.filter((g) => g.unitId === unit.id);
  if (selected.length !== 1) return null;
  const guard = selected[0], sync = cameraTimestamp(selected[0].providerSyncAt, now);
  if (!sync.fresh || !sync.at) return null;
  for (const proof of [authority, guard]) if (proof.unitId !== unit.id || proof.unitNumber !== unit.unitNumber || proof.identityProof !== identity.proof || !sha(proof.identityProof) || !same2(proof.deviceIds, identity.deviceIds) || !same2(proof.unitKeys, identity.unitKeys) || !cameraTimestamp(proof.checkedAt, now).fresh) return null;
  if (guards.some((g) => g !== guard && (g.deviceIds.some((v) => identity.deviceIds.includes(v)) || g.unitKeys.some((v) => identity.unitKeys.includes(v))))) return null;
  for (const key of ["sourceRevision", "sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256", "eventId", "productId"]) if (typeof authority[key] !== "string" || authority[key] !== binding[key]) return null;
  if (!["sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => sha(binding[k])) || !same2(rows.map((r) => String(r.id)), identity.deviceIds) || !same2([...new Set(rows.map((r) => r.unit))], identity.unitKeys) || rows.some((r) => resourceKind(r) !== "recorders" || !providerRecord(r) || r.evidence?.source !== "Star4Live" || cameraTimestamp(r.evidence?.observedAt, now).at !== sync.at)) return null;
  const states2 = rows.map((r) => cameraTimestamp(r.evidence?.observedAt, now).fresh && ["online", "offline"].includes(r.evidence?.status || "") ? r.evidence.status : "verifying");
  const state = combinedState(states2), times = rows.map((r) => cameraTimestamp(r.evidence?.observedAt, now).at).filter((v) => Boolean(v)).sort();
  return { state, basis: "recorder", label: "RECORDER " + { online: "ONLINE", offline: "OFFLINE", degraded: "MIXED / PARTLY VERIFIED", verifying: "UNVERIFIED" }[state], checkedAt: times.at(-1) || null, providerState: state, cameraState: "mapping", serviceState: "verifying" };
}

// tech-checks/operations/src/healthObservationTime.ts
var connectionEvidence = (row) => row.serviceEvidence || (row.evidence?.kind === "service_port" ? row.evidence : void 0);
function healthObservationTime(rows, basis, state, now = Date.now()) {
  const candidates = rows.filter((row) => basis === "connection" ? connectionEvidence(row)?.kind === "service_port" : providerRecord(row) && typeof row.activationState === "string" && row.activationState.trim().toUpperCase() === "ACTIVE" && row.evidence?.active === true && (basis === "camera" ? cameraRecord(row) : basis === "recorder" ? resourceKind(row) === "recorders" : true));
  const supporting = state === "online" || state === "offline" ? candidates.filter((row) => (basis === "connection" ? savedConnectionObservation(row, now) : basis === "camera" ? cameraState(row, now) : providerState(row, now)) === state) : candidates;
  const dates = supporting.map((row) => basis === "connection" ? connectionEvidence(row)?.observedAt : row.evidence?.observedAt).map((value) => cameraTimestamp(value, now).at).filter((value) => Boolean(value)).sort();
  return dates.at(-1) || null;
}

// tech-checks/operations/src/verifiedUnitIdentity.ts
var object7 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var text4 = (value) => typeof value === "string" && value.trim() !== "";
var resourceId2 = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);
var sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
function validateIdentityEnvelope(value) {
  if (value.identityVersion === void 0) {
    if (value.unitIdentities !== void 0 || value.identityWarnings !== void 0 || value.ownerConfirmedIdentityVersion !== void 0 || value.ownerConfirmedUnitIdentities !== void 0 || value.reconProviderIdentityVersion !== void 0 || value.reconProviderUnitIdentities !== void 0) throw new Error("Equipment identity contract is incomplete.");
    return;
  }
  if (value.identityVersion !== 1 || value.evidenceVersion !== 2 || !Array.isArray(value.unitIdentities) || value.unitIdentities.length > 1e3) throw new Error("Equipment identity contract is unavailable.");
  if (value.ownerConfirmedIdentityVersion === void 0 ? value.ownerConfirmedUnitIdentities !== void 0 : value.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(value.ownerConfirmedUnitIdentities) || value.ownerConfirmedUnitIdentities.length > 1e3 || value.ownerConfirmedUnitIdentities.some((row) => row.kind !== "owner_confirmed_native")) throw new Error("Owner-confirmed identity contract is unavailable.");
  if (value.reconProviderIdentityVersion === void 0 ? value.reconProviderUnitIdentities !== void 0 : value.reconProviderIdentityVersion !== 1 || !Array.isArray(value.reconProviderUnitIdentities) || value.reconProviderUnitIdentities.length > 1e3 || value.reconProviderUnitIdentities.some((row) => row.kind !== "reconeyez_area")) throw new Error("Reconeyez provider-area contract is unavailable.");
  if (value.unitIdentities.some((row) => ["owner_confirmed_native", "reconeyez_area"].includes(row.kind))) throw new Error("Reviewed provider identities require their additive contract.");
  for (const row of [...value.unitIdentities, ...value.ownerConfirmedUnitIdentities || [], ...value.reconProviderUnitIdentities || []]) {
    if (!object7(row) || !text4(row.unitId) || !text4(row.unitNumber) || !["native_provider", "owner_placement", "owner_confirmed_native", "reconeyez_area"].includes(row.kind) || !Array.isArray(row.deviceIds) || !row.deviceIds.length || row.deviceIds.length > 1e3 || !row.deviceIds.every(resourceId2) || !Array.isArray(row.unitKeys) || !row.unitKeys.length || !row.unitKeys.every(text4) || !/^[a-f0-9]{64}$/.test(row.proof) || row.kind === "owner_placement" && !resourceId2(row.placementAuditId)) throw new Error("Equipment identity proof is malformed.");
    if (row.kind === "reconeyez_area" && (!object7(row.providerArea) || !Number.isSafeInteger(row.providerArea.detectorCount) || row.providerArea.detectorCount !== row.deviceIds.length || typeof row.providerArea.inventoryObservedAt !== "string" || !(row.providerArea.bridgeLastEventAt === null || typeof row.providerArea.bridgeLastEventAt === "string"))) throw new Error("Reconeyez provider-area coverage is malformed.");
  }
  if (value.identityWarnings !== void 0 && (!Array.isArray(value.identityWarnings) || value.identityWarnings.length > 1e3 || value.identityWarnings.some((row) => !object7(row) || !text4(row.unitId) || !text4(row.reason) || row.deviceIds !== void 0 && (!Array.isArray(row.deviceIds) || !row.deviceIds.every(resourceId2)) || row.unitKeys !== void 0 && (!Array.isArray(row.unitKeys) || !row.unitKeys.every(text4))))) throw new Error("Equipment identity warnings are malformed.");
}
function allVerifiedUnitIdentities(value) {
  validateIdentityEnvelope(value);
  return [...value.unitIdentities || [], ...value.ownerConfirmedUnitIdentities || [], ...value.reconProviderUnitIdentities || []];
}
function resolve(identity, health, now = Date.now()) {
  const fail3 = (reason) => ({ state: "conflict", reason });
  const identities = allVerifiedUnitIdentities(health);
  if (identities.filter((x) => x.unitId === identity.unitId).length !== 1 || new Set(identity.unitKeys).size !== identity.unitKeys.length || new Set(identity.deviceIds).size !== identity.deviceIds.length) return fail3("Equipment identity has duplicate or conflicting associations.");
  if (identities.some((x) => x !== identity && x.deviceIds.some((id4) => identity.deviceIds.includes(id4)))) return fail3("A source resource is associated with more than one equipment identity.");
  const rows = health.rows.filter((row) => identity.deviceIds.includes(String(row.id)));
  if (!sameSet(rows.map((row) => String(row.id)), identity.deviceIds) || rows.some((row) => row.trackerOnly || !identity.unitKeys.includes(row.unit))) return fail3("The expected source resource set is incomplete or changed.");
  const group = health.rows.filter((row) => identity.unitKeys.includes(row.unit));
  if (!sameSet(group.map((row) => String(row.id)), identity.deviceIds)) return fail3("The current source group no longer matches the complete verified resource set.");
  if (identity.kind === "native_provider" && rows.some((row) => row.evidence?.kind !== "provider" || row.evidence.source !== "Star4Live" || !providerRecord(row))) return fail3("The linked provider identity changed.");
  if (identity.kind === "reconeyez_area" && (!cameraTimestamp(identity.providerArea?.inventoryObservedAt, now).fresh || rows.some((row) => row.evidence?.source !== "Reconeyez" || resourceKind(row) !== "detectors" || !providerRecord(row)))) return fail3("Reconeyez provider-area proof is stale or the detector source changed.");
  return { state: "verified", identity, rows };
}
function resolveVerifiedUnitIdentity(unit, health, now = Date.now()) {
  try {
    validateIdentityEnvelope(health);
  } catch {
    return { state: "conflict", reason: "Equipment identity proof could not be verified. Reload saved results." };
  }
  if (health.identityVersion !== 1) return { state: "unavailable", reason: "No durable equipment-to-resource association is available." };
  const warnings = health.identityWarnings?.filter((row) => row.unitId === unit.id) || [];
  if (warnings.length) return { state: "conflict", reason: warnings[0].reason };
  const identities = allVerifiedUnitIdentities(health).filter((row) => row.unitId === unit.id);
  if (identities.length !== 1) return { state: identities.length ? "conflict" : "unavailable", reason: identities.length ? "Equipment identity has conflicting source associations." : "No durable equipment-to-resource association is available." };
  const identity = identities[0];
  if (identity.unitNumber !== unit.unitNumber) return { state: "conflict", reason: "The saved equipment label changed after its resource association was verified." };
  if (identity.kind === "owner_placement" && (String(unit.placementAuditId || "") !== identity.placementAuditId || unit.placementUnitKey !== identity.unitNumber)) return { state: "conflict", reason: "The Owner placement changed. Reload the map and saved source evidence." };
  return resolve(identity, health, now);
}
function legacyIdentityConflict(unitId, rows, health) {
  if (health.identityVersion !== 1) return null;
  const related = (claim) => rows.some((row) => claim.deviceIds?.includes(String(row.id)) || claim.unitKeys?.includes(row.unit));
  if (allVerifiedUnitIdentities(health).some((identity) => identity.unitId !== unitId && related(identity))) return "These source resources belong to another verified equipment identity. Review this separate field record before linking it.";
  const warning = health.identityWarnings?.find(related);
  return warning?.reason || null;
}
function linkedUnitObservation(rows, now = Date.now()) {
  const providers = rows.filter((row) => ["cameras", "detectors", "recorders"].includes(resourceKind(row))), cameras = rows.filter((row) => ["cameras", "detectors"].includes(resourceKind(row)));
  const provider = providers.length ? combinedState(rows.map((row) => providerState(row, now))) : "verifying";
  const service = combinedState(rows.map((row) => savedConnectionObservation(row, now)));
  const camera = cameras.length ? combinedState(rows.map((row) => cameraState(row, now))) : "mapping";
  const basis = providers.length && provider !== "verifying" ? providers.every((row) => resourceKind(row) === "recorders") ? "recorder" : providers.every((row) => ["cameras", "detectors"].includes(resourceKind(row))) ? "camera" : "provider" : !providers.length || service !== "verifying" ? "connection" : providers.every((row) => resourceKind(row) === "recorders") ? "recorder" : "camera";
  const state = basis === "connection" ? service : provider;
  const prefix = { camera: rows.length && rows.every((row) => resourceKind(row) === "detectors") ? "DETECTOR RECORDS" : "CAMERA RECORDS", recorder: "RECORDER", provider: "PROVIDER SYSTEM", connection: "IP / PORT" }[basis];
  const checkedAt = healthObservationTime(rows, basis, state, now);
  return { state, basis, label: prefix + " " + { online: "ONLINE", offline: "OFFLINE", degraded: "MIXED / PARTLY VERIFIED", verifying: "UNVERIFIED" }[state], checkedAt, providerState: provider, cameraState: camera, serviceState: service };
}

// tech-checks/operations/src/fieldCameraHealth.ts
var plain = (value) => value.trim().replace(/\s+/g, " ").toUpperCase();
function canonicalCameraUnit(value) {
  const match = /^(SNIPER\s*[24]|RECON\s*(?:2|II))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value.trim()) || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value.trim());
  if (!match) return null;
  let family = plain(match[1]).replace(/\s/g, "");
  family = { RI: "RECON", RII: "RECON2", RECONII: "RECON2" }[family] || family;
  const [base, ...tail] = match[2].split(".");
  if (Number(base) === 0) return null;
  return family + "|" + Number(base) + (tail.length ? "." + tail.join(".") : "");
}
function scopedFieldIdentity(unit) {
  const key = canonicalCameraUnit(unit.unitNumber);
  if (!key) return null;
  const family = key.split("|")[0], model = plain(unit.modelName || "").replace(/[\s&]/g, "");
  const aliases = { HELIOS: ["HELIOS"], RANGER: ["RANGER", "RANGERS"], SOLARSPOTTER: ["SOLARSPOTTER", "SOLARSPOTTERS"], SPOTTER: ["SPOTTER", "SPOTTERS"], SSHYBRID: ["SSHYBRID", "SSHYBRIDS"], RECON: ["RECON", "RECONS"], RECON2: ["RECON2", "RECONII"], SNIPER: ["SNIPER", "SNIPERS"], SNIPER2: ["SNIPER2", "SNIPERS"], SNIPER4: ["SNIPER4", "SNIPERS"], CAMV: ["CAMV", "CAMVRSU"] };
  return aliases[family]?.includes(model) ? key : null;
}
function isSupportEquipment(unit) {
  const name = unit.unitNumber.trim().toUpperCase();
  const model = (unit.modelName || "").trim().toUpperCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  return /^(?:ST|STAND)\s*[-#]?\s*\d{1,6}$/i.test(name) || ["STAND", "STANDS"].includes(model) || /^(?:SOLAR\s*STANDS?(?:\s*72)?|SOLAR\s*POLES?|SKIDS?)(?:\s|[-#])\s*\d+$/i.test(name) || ["SOLAR STAND", "SOLAR STANDS", "SOLAR STANDS 72", "SOLAR STAND 72", "SOLAR POLES & SKIDS", "SOLAR POLE", "SOLAR POLES", "SKID", "SKIDS"].includes(model);
}
function fieldCameraHealth(unit, units, health, now = Date.now()) {
  const unknown2 = (reason2, identity = "missing", rows2 = []) => ({ state: "unknown", reason: reason2, identity, rows: rows2, unitKey: null, checkedAt: null, classification: null });
  if (isSupportEquipment(unit)) return { state: "support", reason: "Support equipment \xB7 0 cameras. Camera online/offline status does not apply. Power health is shown only when a verified power source is linked.", identity: "missing", rows: [], unitKey: null, checkedAt: null, classification: null };
  if (!health) return unknown2("Camera Health is unavailable.");
  if (units.filter((candidate) => candidate.id === unit.id).length !== 1) return unknown2("More than one field record uses this equipment identity.", "ambiguous");
  const association = resolveVerifiedUnitIdentity(unit, health, now);
  if (association.state === "conflict") return unknown2(association.reason, "ambiguous");
  if (association.state === "verified") {
    const rows2 = association.rows, fieldRecorder = fieldRecorderObservation(unit, association.identity, rows2, health, now), observation = fieldRecorder || linkedUnitObservation(rows2, now), raw = classifyCameraUnit(rows2, now);
    const complete = fieldRecorder ? { fieldRecorderVerified: true, state: fieldRecorder.state, providerState: fieldRecorder.providerState, cameraState: "mapping", serviceState: fieldRecorder.serviceState, recorderOffline: fieldRecorder.state === "offline" } : ["field", "unknown"].includes(raw.scope) ? { state: observation.providerState !== "verifying" ? observation.providerState : observation.serviceState === "online" ? "service" : raw.state === "mapping" ? "mapping" : "verifying", providerState: observation.providerState, cameraState: observation.cameraState, serviceState: observation.serviceState } : {};
    const classification2 = { ...raw, ...complete, observation };
    const state2 = observation.state === "online" ? "online" : observation.state === "offline" ? "offline" : "unknown";
    const detectorStates = rows2.map((row) => cameraState(row, now));
    const detail = association.identity.kind === "reconeyez_area" ? "Reviewed provider-area group: " + detectorStates.filter((state3) => state3 === "online").length + " of " + rows2.length + " detector records recently online; " + detectorStates.filter((state3) => state3 === "offline").length + " offline; " + detectorStates.filter((state3) => !["online", "offline"].includes(state3)).length + " unverified. Bridge contact is shown separately." : observation.basis === "recorder" ? "This observation describes the recorder. Individual camera channels and video are not verified." : observation.basis === "connection" ? "The saved IP / port observation describes service reachability. Camera video is not verified." : "Expected camera channel coverage is unknown; reported records do not verify every camera or video.";
    const freshness = state2 === "unknown" ? " Source records are mixed, stale, missing, or unverified; silence is not a confirmed outage." : "";
    const placement = fieldRecorder ? " Current Field installation and exact recorder identity are verified. Legacy provider folder/activation remains recorded separately; this observation does not move equipment." : classification2.scope === "unknown" ? " LOCATION REVIEW: saved placement is unresolved." : ["shop", "inactive"].includes(classification2.scope) ? " PLACEMENT CONFLICT: source inventory says " + classification2.scope.toUpperCase() + " while this record is in the field map. The source observation does not move equipment." : "";
    return { state: state2, reason: detail + freshness + placement, rows: rows2, unitKey: association.identity.unitKeys[0], checkedAt: observation.checkedAt, identity: "matched", classification: classification2, basis: observation.basis, observation, association: association.identity };
  }
  const key = scopedFieldIdentity(unit);
  if (!key) return unknown2("No verified equipment-to-resource association is available for this saved identifier. Review its identity; source status is not inferred from a similar name.");
  if (units.filter((candidate) => canonicalCameraUnit(candidate.unitNumber) === key).length !== 1 || units.filter((candidate) => candidate.id === unit.id).length !== 1) return unknown2("More than one field record uses this unit identity.", "ambiguous");
  const rows = health.rows.filter((row) => typeof row.unit === "string" && canonicalCameraUnit(row.unit) === key);
  if (!rows.length) return unknown2("No exact family and unit-number match in Camera Health.");
  const resourceConflict = legacyIdentityConflict(unit.id, rows, health);
  if (resourceConflict) return unknown2(resourceConflict, "ambiguous");
  if (new Set(rows.map((row) => plain(row.unit))).size !== 1 || new Set(rows.map((row) => String(row.id))).size !== rows.length || rows.some((row) => health.rows.filter((other) => String(other.id) === String(row.id)).length !== 1)) return unknown2("Camera Health has conflicting or duplicate unit identities.", "ambiguous");
  const safeRows = health.evidenceVersion === 2 ? rows : rows.map((row) => ({ ...row, scope: "unknown", activationState: "", evidence: void 0, serviceEvidence: void 0 }));
  const classification = classifyCameraUnit(safeRows, now), active = safeRows.filter((row) => row.scope !== "inactive"), cameras = active.filter(cameraRecord);
  const states2 = cameras.map((row) => cameraState(row, now));
  const direct = ["SNIPER", "SNIPER2", "SNIPER4", "CAMV"].includes(key.split("|")[0]);
  const connection = combinedState(safeRows.map((row) => savedConnectionObservation(row, now)));
  const operational = ["field", "unknown"].includes(classification.scope);
  const state = direct ? connection === "online" ? "online" : connection === "offline" ? "offline" : "unknown" : operational && states2.includes("offline") ? "offline" : operational && states2.length > 0 && states2.every((s) => s === "online") ? "online" : "unknown";
  const checkedAt = healthObservationTime(direct ? safeRows : cameras, direct ? "connection" : "camera", state, now);
  const location = classification.scope === "unknown" ? " LOCATION REVIEW: saved placement is unresolved." : ["shop", "inactive"].includes(classification.scope) ? " PLACEMENT CONFLICT: camera inventory says " + (classification.scope === "shop" ? "SHOP / ROOT" : "INACTIVE") + " while this unit remains in the field tracker. Confirm its physical placement; a connection result does not move the unit." : "";
  const reason = health.evidenceVersion !== 2 ? "Source-separated observations are not available in this response." : !operational ? "Shop/root or inactive inventory is excluded from operational camera colors." : state === "offline" ? "At least one matched camera/detector has a recent provider OFFLINE observation." : state === "online" ? "Reported camera/detector records are recently ONLINE. Expected channel coverage is unknown; this does not verify every camera." : cameras.length ? "Camera/detector observations are older, missing, or unverified. Silence is not a confirmed outage." : "Camera channel status unavailable. Recorder and service observations remain separate.";
  return { state, identity: "matched", rows, unitKey: rows[0].unit, checkedAt, classification, basis: direct ? "connection" : "camera", reason: (direct ? (state === "online" ? "The saved IP / port check responded." : state === "offline" ? "The saved IP / port checks confirmed no response." : "No recent definitive IP / port result is available.") + " This is connection status; camera video is not verified. Location confidence does not change this connection result." : reason) + location };
}

// tech-checks/operations/shared/completedCameraSnapshot.ts
var uuid5 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
var time = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
var text5 = (v) => typeof v === "string" && v.length > 0 && v.length <= 250 && !/[\u0000-\u001f\u007f]/.test(v);
function readCompletedCameraSnapshot(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value;
  if (v.contract !== "COS_COMPLETED_CAMERA_SNAPSHOT_V1" || !uuid5(v.id) || !/^[a-f0-9]{64}$/.test(v.sourceRevision) || !time(v.startedAt) || !time(v.completedAt) || Date.parse(v.startedAt) > Date.parse(v.completedAt) || Date.parse(v.completedAt) > now || !["scheduled", "manual"].includes(v.trigger) || (v.trigger === "manual" ? !uuid5(v.initiatorId) : v.initiatorId !== null) || v.reference?.id !== v.id || v.reference.kind !== "immutable_count_record" || !Array.isArray(v.items) || !v.items.length || v.items.length > 1e4) return null;
  const counts = { online: 0, offline: 0, unknown: 0, support: 0 }, ids = /* @__PURE__ */ new Set();
  for (const r of v.items) {
    if (!r || !/^[1-9][0-9]{0,14}$/.test(r.productId) || ids.has(r.productId) || r.unitId !== null && !uuid5(r.unitId) || !text5(r.unitLabel) || !text5(r.siteLabel) || !Object.hasOwn(counts, r.state) || typeof r.identityVerified !== "boolean" || !["camera", "provider", "endpoint", "none"].includes(r.evidenceKind) || r.reason !== null && !text5(r.reason)) return null;
    if (["online", "offline"].includes(r.state) && (!r.identityVerified || !["camera", "provider"].includes(r.evidenceKind) || !time(r.lastCompletedCheckAt))) return null;
    for (const t of [r.lastSuccessAt, r.lastAttemptAt, r.lastCompletedCheckAt]) if (t !== null && (!time(t) || Date.parse(t) > Date.parse(v.completedAt))) return null;
    if (r.lastCompletedCheckAt && r.lastSuccessAt && Date.parse(r.lastSuccessAt) > Date.parse(r.lastCompletedCheckAt)) return null;
    if (r.cameras !== void 0) {
      if (!Array.isArray(r.cameras) || r.cameras.length > 1e3 || new Set(r.cameras.map((c) => c.resourceId)).size !== r.cameras.length) return null;
      for (const c of r.cameras) {
        if (!c || !/^[1-9][0-9]*$/.test(c.resourceId) || !text5(c.label) || !text5(c.kind)) return null;
        for (const t of [c.lastReportedOnlineAt, c.lastSuccessfulEndpointConnectionAt, c.latestEndpointAttemptAt, c.latestEndpointCompletedAt, c.latestProviderObservationAt]) if (t !== null && (!time(t) || Date.parse(t) > Date.parse(v.completedAt))) return null;
      }
    }
    ids.add(r.productId);
    counts[r.state]++;
  }
  if (!v.counts || Object.keys(counts).some((k) => v.counts[k] !== counts[k])) return null;
  return structuredClone(v);
}
function advanceLastSuccess(previous, observation, now = Date.now()) {
  const prior = previous && time(previous) && Date.parse(previous) <= now ? previous : null;
  if (!observation.completed || observation.status !== "online" || !time(observation.checkedAt) || Date.parse(observation.checkedAt) > now) return prior;
  return !prior || Date.parse(observation.checkedAt) > Date.parse(prior) ? observation.checkedAt : prior;
}

// tech-checks/operations/shared-snapshot-review/projectSavedCameraSnapshot.ts
var canonical = (v) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
var snapshotDigest = async (v) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(v)))), (b) => b.toString(16).padStart(2, "0")).join("");
var terminal = (v) => typeof v === "string" && /(?:^|\W)(DNU|DO\s+NOT\s+USE|RETIRED|DELETED|STOLEN)(?:$|\W)/i.test(v);
async function projectSavedCameraSnapshot(source, lease, completedAt, previous = null, review) {
  const { baseline, identitySources, health: observations, tracker, integrations } = source;
  if (!baseline || baseline.origin !== "mhelpdesk_api" || baseline.apiSync?.enabled !== true || !Number.isFinite(Date.parse(baseline.apiSync.lastSuccessAt)) || completedAt - Date.parse(baseline.apiSync.lastSuccessAt) > 27e5 || Date.parse(baseline.apiSync.lastSuccessAt) > completedAt || baseline.contract !== "COS_MHELP_API_V1" || baseline.complete !== true || baseline.reviewed !== true || !Array.isArray(baseline.records) || new Set(baseline.records.map((r) => r.productId)).size !== baseline.records.length) throw Error("Complete Product baseline required");
  const identity = await verifiedHealthIdentities(identitySources, review);
  const recon = await projectReconProviderIdentities(source.trackerUnits, identitySources.devices, integrations.filter((r) => r.provider === "reconeyez"), void 0, completedAt);
  const projectedIdentity = appendReconProviderIdentities(identity, recon);
  const summary = { ...cameraSummary(projectCameraOwnerPlacement(identitySources.devices, identitySources.audits), observations, completedAt, tracker, integrations.filter((r) => r.provider === "witness")), ...projectedIdentity, ...fieldRecorderHealthGuards(identitySources, identity, integrations) };
  const records = baseline.records, rawUnits = identitySources.units;
  const units = records.filter((r) => r.binding?.nativeUnitId && r.binding.guardCurrent === true).map((r) => {
    const u = rawUnits.find((u2) => u2.id === r.binding.nativeUnitId);
    return u ? { id: u.id, unitNumber: u.unit_number, modelName: r.category, status: u.status, currentLocationType: r.placement?.toLowerCase(), placement: r.placement?.toLowerCase(), activeInventoryEligible: r.lifecycle === "UNFLAGGED" } : null;
  }).filter(Boolean);
  const items = [];
  for (const r of records.filter((r2) => r2.placement === "FIELD")) {
    const b = r.binding, unit = units.find((u) => u.id === b?.nativeUnitId), support = isSupportEquipment({ id: r.productId, unitNumber: r.unitNumber, modelName: r.category });
    const native = rawUnits.filter((u) => u.id === b?.nativeUnitId), represented = b?.representedUnitIds;
    const held = r.lifecycle !== "UNFLAGGED" || r.holdReason || r.placementHeld || r.possibleAliasUnitIds?.length || !b || !/^[a-f0-9]{64}$/.test(b.expectedGuard || "") || b.guardCurrent !== true || !b.nativeUnitId || native.length !== 1 || terminal(native[0]?.status) || terminal(r.unitNumber) || b.nativeLabel !== native[0]?.unit_number || records.filter((p) => p.binding?.nativeUnitId === b.nativeUnitId).length !== 1 || represented && (!Array.isArray(represented) || new Set(represented).size !== represented.length || !represented.includes(b.nativeUnitId) || represented.some((id4) => id4 !== b.nativeUnitId && id4 !== b.trackerId));
    let result = null;
    if (!held && unit) {
      const proofs = [...summary.unitIdentities || [], ...summary.ownerConfirmedUnitIdentities || [], ...summary.reconProviderUnitIdentities || []].filter((p) => p.unitId === unit.id);
      const resourceIds = proofs.length === 1 ? proofs[0].deviceIds : [];
      const scoped = { ...summary, rows: summary.rows.map((row) => resourceIds.includes(String(row.id)) && row.scope !== "inactive" ? { ...row, scope: "field" } : row) };
      result = fieldCameraHealth(unit, units, scoped, completedAt);
    }
    const definitive = !held && result?.association && ["online", "offline"].includes(result.state) && result.basis !== "connection";
    const state = support && r.lifecycle === "UNFLAGGED" && !r.placementHeld ? "support" : definitive ? result.state : "unknown";
    const evidenceKind = definitive ? result.basis === "camera" ? "camera" : "provider" : "none";
    const resources = result?.association ? result.rows : [];
    const times = resources.map((x) => x.evidence?.observedAt).filter((t) => typeof t === "string" && Number.isFinite(Date.parse(t)) && Date.parse(t) <= completedAt).sort();
    const checked = times.length ? times[0] : null;
    const assignmentGuard = await snapshotDigest({ productId: r.productId, binding: b, proof: result?.association || null, resources: resources.map((x) => String(x.id)).sort() });
    const prior = previous?.items?.find((i) => i.productId === r.productId && i.assignmentGuard === assignmentGuard);
    const cameras = resources.map((row) => {
      const old = prior?.cameras?.find((c) => c.resourceId === String(row.id)), endpoint2 = savedConnectionObservation(row, completedAt), service = row.serviceEvidence;
      const validDate = (value2) => typeof value2 === "string" && Number.isFinite(Date.parse(value2)) && Date.parse(value2) <= completedAt ? value2 : null;
      const observedAt = validDate(row.evidence?.observedAt), endpointAt = validDate(service?.observedAt);
      return { resourceId: String(row.id), label: String(row.name || row.unit || row.id).slice(0, 250), kind: row.evidence?.resource || "provider", lastReportedOnlineAt: advanceLastSuccess(old?.lastReportedOnlineAt || null, { completed: !!observedAt, status: row.evidence?.active === true && row.evidence?.status === "online" ? "online" : "unknown", checkedAt: observedAt || "" }, completedAt), lastSuccessfulEndpointConnectionAt: advanceLastSuccess(old?.lastSuccessfulEndpointConnectionAt || null, { completed: !!endpointAt, status: endpoint2 === "online" ? "online" : endpoint2 === "offline" ? "offline" : "unknown", checkedAt: endpointAt || "" }, completedAt), latestEndpointAttemptAt: endpointAt, latestEndpointCompletedAt: ["online", "offline"].includes(endpoint2 || "") ? endpointAt : null, latestProviderObservationAt: observedAt };
    });
    const item = { cameras, identityProof: result?.association?.proof || null, resourceIds: resources.map((r2) => String(r2.id)), category: r.category, lifecycle: r.lifecycle, productId: r.productId, unitId: held ? null : b.nativeUnitId, unitLabel: String(r.unitNumber).slice(0, 250), siteLabel: String(r.customer || "Site not recorded").slice(0, 250), state, identityVerified: !!definitive, evidenceKind, lastSuccessAt: advanceLastSuccess(prior?.lastSuccessAt || null, { completed: !!checked, status: state === "online" ? "online" : state === "offline" ? "offline" : "unknown", checkedAt: checked || "" }, completedAt), lastAttemptAt: checked, lastCompletedCheckAt: checked, reason: (support ? "Support equipment; no camera count" : held ? "Product identity or lifecycle proof is held" : result?.reason || "No verified camera membership").slice(0, 250), assignmentGuard };
    items.push(item);
  }
  const counts = { online: 0, offline: 0, unknown: 0, support: 0 };
  for (const r of items) counts[r.state]++;
  const value = { contract: "COS_COMPLETED_CAMERA_SNAPSHOT_V1", id: lease.id, sourceRevision: source.revision, inventorySourceSha256: baseline.sourceSha256, inventory: { total: records.length, field: items.length, shop: records.filter((r) => r.placement === "SHOP").length }, startedAt: lease.startedAt, completedAt: new Date(completedAt).toISOString(), trigger: lease.trigger, initiatorId: lease.initiatorId, items, counts, reference: { id: lease.id, kind: "immutable_count_record" } };
  if (!readCompletedCameraSnapshot(value, completedAt)) throw Error("Invalid completed projection");
  return value;
}

// tech-checks/operations/shared-snapshot-review/cameraSnapshotSource.mjs
function cameraSnapshotSource({ db, readNative, now = Date.now }) {
  const all = async (table, fields) => {
    const rows = [];
    for (let offset = 0; offset < 1e5; offset += 1e3) {
      const r = await db.from(table).select(fields).order(table === "camera_health_current" ? "camera_device_id" : table === "camera_integrations" ? "provider" : table === "equipment_master" ? "source_label" : "id").range(offset, offset + 999);
      if (r.error || !Array.isArray(r.data)) throw Error("Saved source unavailable");
      rows.push(...r.data);
      if (r.data.length < 1e3) return rows;
    }
    throw Error("Source truncated");
  };
  const epochs = async (keys) => {
    if (keys.length > 1e3) throw Error("Identity scope too large");
    const r = await db.rpc("cos_camera_identity_epochs_v1", { p_unit_keys: keys });
    if (r.error || !Array.isArray(r.data)) throw Error("Identity epoch unavailable");
    return r.data;
  };
  return async () => {
    const before = await readNative();
    if (before?.contract !== "COS_CAMERA_SNAPSHOT_SOURCE_V1" || !before.complete) throw Error("Native source unavailable");
    const keys = (d, n) => [.../* @__PURE__ */ new Set([...d.map((r) => r.unit_key), ...n.identitySources.ownerCrosswalk.claims.map((r) => r.legacy_unit_key)])].filter((k) => typeof k === "string" && k.length).sort();
    const deviceFields = "id,external_device_id,device_serial,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,source_status,source_last_seen_at,activation_state,monitoring_enabled,monitoring_profile";
    const seed = await all("camera_devices", deviceFields), beforeEpochs = await epochs(keys(seed, before));
    const [devices, health, tracker, integrations, auditRows] = await Promise.all([all("camera_devices", deviceFields), all("camera_health_current", "camera_device_id,port_status,overall_status,checked_at,ip_reachable,confirmed_outage,consecutive_failures"), all("equipment_master", "canonical_family,unit_tag,source_label,tracker_state,health_provider"), all("camera_integrations", "provider,enabled,last_sync_at,last_sync_status,units:metadata->units,identity_inventory:metadata->identity_inventory_v1"), all("camera_inventory_audit", "id,action,unit_key,device_ids,created_at,after_state")]);
    const [after, afterEpochs] = await Promise.all([readNative(), epochs(keys(devices, before))]);
    if (await snapshotDigest(before) !== await snapshotDigest(after) || await snapshotDigest(beforeEpochs) !== await snapshotDigest(afterEpochs) || JSON.stringify(keys(seed, before)) !== JSON.stringify(keys(devices, after))) throw Error("Source changed during read");
    const audits = auditRows.map((a) => ({ id: String(a.id), action: a.action, unit_key: a.unit_key, device_ids: a.device_ids, created_at: a.created_at, contract: a.after_state?.placement_contract, placement: a.after_state?.placement, site_label: a.after_state?.site_label, street_address: a.after_state?.street_address, request_id: a.after_state?.request_id, control_id: a.after_state?.control_id }));
    const identitySources = { ...after.identitySources, devices, audits, ownerEpochs: afterEpochs };
    const configuration = { ...after, devices: devices.map(({ source_status, source_last_seen_at, ...d }) => d), audits, ownerEpochs: afterEpochs, tracker };
    return { ...after, identitySources, health, tracker, integrations, revision: await snapshotDigest(configuration), observedAt: now() };
  };
}

// tech-checks/operations/shared-snapshot-review/scheduledSnapshotAdapter.mjs
function scheduledSnapshotAdapter({ db, readNative, authorize, collect, now = Date.now, review }) {
  const rpc = async (name, args = {}) => {
    const r = await db.rpc(name, args);
    if (r.error) throw Error("Snapshot operation unavailable");
    return r.data;
  };
  const ledger = { begin: (p) => rpc("cos_camera_snapshot_begin_v1", { p_source: p.sourceRevision, p_trigger: p.trigger, p_actor: p.initiatorId, p_budget_ms: p.budgetMs }), finish: (lease, payload) => rpc("cos_camera_snapshot_finish_v1", { p_run: lease.id, p_source: lease.sourceRevision, p_payload: payload }), abort: (l) => rpc("cos_camera_snapshot_abort_v1", { p_run: l.id }), read: () => rpc("cos_camera_snapshot_read_v1") };
  return sharedCameraCycle({ authorize, ledger, readSource: cameraSnapshotSource({ db, readNative, now }), collect, now, project: async ({ source, lease, completedAt }) => projectSavedCameraSnapshot(source, lease, completedAt, (await ledger.read())?.snapshot, review) });
}

// tech-checks/docs/deployed-camera-health-sweep-v59/source/_shared/scheduledDirectService.ts
var DIRECT_FAMILIES = ["CAMV", "Sniper", "Sniper 2", "Sniper 4"];
var object8 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var label = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase().replace(/^CAM V /, "CAMV ") : "";
var terminal2 = (v) => typeof v === "string" && /(?:^|\W)(?:RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
var revision2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" && /^(?:0|[1-9][0-9]*)$/.test(v) ? v : null;
var deviceId = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9][0-9]*$/.test(v) ? v : null;
function directPublicHost(value) {
  if (typeof value !== "string") return null;
  const host = value.replace(/\/32$/, ""), parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^(?:0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return null;
  const [a, b, c] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return null;
  return host;
}
function savedPorts(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 32 || v.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) || new Set(v).size !== v.length) return null;
  return [...v].sort((a, b) => a - b);
}
function masterKey(m) {
  if (!DIRECT_FAMILIES.includes(m.canonical_family) || typeof m.unit_tag !== "string" || !/^\d{1,6}$/.test(m.unit_tag) || Number(m.unit_tag) <= 0) return null;
  const key = label(m.canonical_family + " " + m.unit_tag);
  return label(m.source_label) === key ? key : null;
}
function directCandidates(master, devices) {
  if (!Array.isArray(master) || !Array.isArray(devices) || master.some((m) => !object8(m)) || devices.some((d) => !object8(d))) throw Error("Direct inventory is unavailable.");
  const selected = [], held = [];
  const masterCounts = /* @__PURE__ */ new Map(), deviceMatches = /* @__PURE__ */ new Map();
  for (const m of master) {
    const key = masterKey(m);
    if (key) masterCounts.set(key, (masterCounts.get(key) || 0) + 1);
  }
  for (const d of devices) {
    const key = label(d.unit_key);
    deviceMatches.set(key, [...deviceMatches.get(key) || [], d]);
  }
  for (const m of master) {
    const key = masterKey(m), matches = key ? deviceMatches.get(key) || [] : [];
    let reason = null;
    const d = matches[0];
    if (!key || masterCounts.get(key) !== 1 || matches.length !== 1) reason = "identity_unverified";
    else if (!["shop", "field_or_unknown"].includes(m.tracker_state) || [m.source_label, d.unit_key, d.device_name, d.organization, d.activation_state].some(terminal2)) reason = "retired_or_not_in_use";
    else if (d.source !== "2026_unit_tracker" || !deviceId(d.id) || !/^\d+$/.test(String(d.mhelp_product_id || "")) || d.monitoring_profile !== (m.canonical_family === "CAMV" ? "camv" : "sniper")) reason = "ownership_unverified";
    else if (d.monitoring_enabled !== true) reason = "monitoring_disabled";
    else if (!["active", "deactivated"].includes(d.activation_state)) reason = "lifecycle_unverified";
    else if (!directPublicHost(d.public_ip) || !savedPorts(d.expected_ports) || revision2(d.connection_revision) === null) reason = "saved_endpoint_unavailable";
    if (reason) {
      held.push({ family: String(m.canonical_family || ""), unit: String(m.source_label || ""), reason });
      continue;
    }
    selected.push({ master: m, device: d, host: directPublicHost(d.public_ip), ports: savedPorts(d.expected_ports), key, productId: String(d.mhelp_product_id) });
  }
  return { selected, held };
}
var DEVICE_FIELDS = "id,unit_key,device_name,source,mhelp_product_id,public_ip,expected_ports,connection_revision,monitoring_profile,monitoring_enabled,activation_state,organization,last_health_checked_at";
var SWEEP_DEADLINE_MS = 48e3;
var SWEEP_WORKERS = 12;
var IO_TIMEOUT_MS = 4e3;
var PROBE_TIMEOUT_MS = 2200;
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
function scheduledOrder(candidates, startedAt) {
  const oldest = [...candidates].sort((a, b) => {
    const time2 = (c) => Number.isFinite(Date.parse(c.device.last_health_checked_at)) ? Date.parse(c.device.last_health_checked_at) : 0;
    return time2(a) - time2(b) || Number(a.device.id) - Number(b.device.id);
  });
  if (!oldest.length) return oldest;
  const offset = Math.floor(startedAt / 9e5) * SWEEP_WORKERS % oldest.length;
  const reserved = Array.from({ length: Math.min(SWEEP_WORKERS, oldest.length) }, (_, i) => oldest[(offset + i) % oldest.length]);
  const ids = new Set(reserved.map((c) => String(c.device.id)));
  return [...reserved, ...oldest.filter((c) => !ids.has(String(c.device.id)))];
}
function sameConnection(a, b) {
  return a.key === b.key && a.master.canonical_family === b.master.canonical_family && a.master.unit_tag === b.master.unit_tag && a.master.source_label === b.master.source_label && String(a.device.id) === String(b.device.id) && a.device.unit_key === b.device.unit_key && a.device.source === b.device.source && revision2(a.device.connection_revision) === revision2(b.device.connection_revision) && a.device.public_ip === b.device.public_ip && a.device.mhelp_product_id === b.device.mhelp_product_id && a.device.monitoring_profile === b.device.monitoring_profile && JSON.stringify(a.device.expected_ports) === JSON.stringify(b.device.expected_ports);
}
function failureCount(previous, c, observedAt) {
  const ports = previous?.port_status, proof = ports?._connection;
  const checked = Date.parse(proof?.checkedAt);
  if (!proof || proof.revision !== revision2(c.device.connection_revision) || proof.ip !== c.host || !Number.isFinite(checked) || checked > observedAt || proof.reachable !== false || !["offline", "verifying"].includes(proof.status)) return 0;
  const actual = Object.keys(ports).filter((k) => k !== "_connection").sort((a, b) => Number(a) - Number(b));
  if (actual.length !== c.ports.length || actual.some((p, i) => p !== String(c.ports[i]) || typeof ports[p]?.online !== "boolean")) return 0;
  return Number.isInteger(proof.consecutiveFailures) && proof.consecutiveFailures >= 0 ? Math.min(3, proof.consecutiveFailures) : 0;
}
async function collectScheduledDirect(db, probe, options = {}) {
  const now = options.now || (() => Date.now()), startedAt = options.startedAt ?? now(), deadline = startedAt + (options.deadlineMs ?? SWEEP_DEADLINE_MS), ioTimeout = options.ioTimeoutMs ?? IO_TIMEOUT_MS;
  const request = (make) => boundedRequest(make, deadline, now, ioTimeout);
  const inventory = async (wave) => {
    const families = wave ? [...new Set(wave.map((c) => c.master.canonical_family))] : DIRECT_FAMILIES;
    const keys = wave ? [...new Set(wave.map((c) => "unit_key.ilike.%" + (c.master.canonical_family === "CAMV" ? "CAM%V" : c.master.canonical_family.replaceAll(" ", "%")) + "%" + c.master.unit_tag + "%"))] : ["unit_key.ilike.%SNIPER%", "unit_key.ilike.%CAM%"];
    const [m, d] = await Promise.all([
      request((signal) => {
        let query = db.from("equipment_master").select("canonical_family,unit_tag,source_label,tracker_state").in("canonical_family", families);
        if (wave) query = query.in("unit_tag", [...new Set(wave.map((c) => c.master.unit_tag))]);
        return query.limit(1e3).abortSignal(signal);
      }),
      request((signal) => db.from("camera_devices").select(DEVICE_FIELDS).or(keys.join(",")).limit(1e3).abortSignal(signal))
    ]);
    if (m.error || d.error || !Array.isArray(m.data) || !Array.isArray(d.data) || m.data.length >= 1e3 || d.data.length >= 1e3) throw Error("Direct inventory is unavailable or truncated");
    return directCandidates(m.data, d.data);
  };
  const evidence = options.endpointEvidence;
  try {
    const initial = await inventory(), allQueue = scheduledOrder(initial.selected, startedAt), shardCount = Number.isInteger(options.shardCount) && options.shardCount >= 1 && options.shardCount <= 32 ? options.shardCount : 1, shardIndex = Number.isInteger(options.shardIndex) && options.shardIndex >= 0 && options.shardIndex < shardCount ? options.shardIndex : 0, queue = shardCount > 1 ? allQueue.filter((c) => Number(c.device.id) % shardCount === shardIndex) : allQueue, results = [];
    const transport = /* @__PURE__ */ new Map();
    let cursor = 0;
    while (cursor < queue.length && now() + PROBE_TIMEOUT_MS + 1e3 < deadline) {
      const wave = queue.slice(cursor, cursor + SWEEP_WORKERS);
      cursor += wave.length;
      const tickets = await Promise.all(wave.map((c) => evidence ? evidence.begin(c).catch(() => null) : null));
      const observations = await Promise.all(wave.map(async (c) => {
        const key = JSON.stringify([c.host, c.ports]), cached = transport.get(key);
        if (cached) return cached;
        const pending = (async () => {
          const began = now();
          try {
            const values = await Promise.all(c.ports.map(async (p) => [String(p), await boundedRequest(() => probe(c.host, p, PROBE_TIMEOUT_MS), deadline, now, PROBE_TIMEOUT_MS + 100)]));
            const at = now();
            if (at < began || at - began > PROBE_TIMEOUT_MS + 500 || values.some(([, v]) => !object8(v) || typeof v.online !== "boolean" || v.latency_ms !== null && (!Number.isFinite(v.latency_ms) || v.latency_ms < 0) || v.error && /(auth|forbidden|permission|unauthori[sz]ed)/i.test(v.error))) return null;
            return { ports: Object.fromEntries(values), at, startedAt: began };
          } catch {
            return null;
          }
        })();
        transport.set(key, pending);
        return pending;
      }));
      let fresh2, previous;
      try {
        const [current, health] = await Promise.all([inventory(wave), request((signal) => db.from("camera_health_current").select("camera_device_id,port_status,overall_status,first_failed_at").in("camera_device_id", wave.map((c) => c.device.id)).abortSignal(signal))]);
        if (health.error || !Array.isArray(health.data)) throw Error("Previous observation unavailable");
        fresh2 = current;
        previous = health.data;
      } catch {
        tickets.forEach((t) => evidence?.finish(t, null, false));
        results.push(...wave.map((c) => ({ id: c.device.id, status: "unknown", reason: "eligibility_unverified", published: false, activated: false })));
        continue;
      }
      await Promise.all(wave.map(async (c, i) => {
        const observed = observations[i], current = fresh2.selected.find((x) => String(x.device.id) === String(c.device.id));
        const held = (reason) => {
          evidence?.finish(tickets[i], null, false);
          return results.push({ id: c.device.id, name: c.device.device_name, status: "unknown", reason, published: false, activated: false });
        };
        if (!observed) return held("probe_incomplete");
        if (evidence && !tickets[i]) return held("endpoint_authority_unverified");
        if (!current || !sameConnection(c, current)) return held("source_or_connection_changed");
        if (now() >= deadline || now() - observed.at > 6e4) return held("observation_expired");
        const prev = previous.find((h) => String(h.camera_device_id) === String(c.device.id)) || {}, reachable = Object.values(observed.ports).some((p) => p.online);
        const failures = reachable ? 0 : Math.min(3, failureCount(prev, c, observed.at) + 1), status = reachable ? "online" : "offline", checked = new Date(observed.at).toISOString();
        const health = { camera_device_id: c.device.id, port_status: observed.ports, checked_at: checked, overall_status: status, ip_reachable: reachable, consecutive_failures: failures, confirmed_outage: failures >= 3, confirmation_reason: failures >= 3 ? "3 consecutive failed checks of the saved service endpoint" : null, detail: reachable ? "Saved Avigilon service port responded; individual camera health is unverified." : "Saved Avigilon service ports did not respond; individual camera health is unverified." };
        if (!reachable && failures === 1) health.first_failed_at = checked;
        if (reachable) {
          health.first_failed_at = null;
          health.acknowledged_at = null;
          health.acknowledged_by = null;
          if (prev.overall_status && prev.overall_status !== "online") health.last_recovered_at = checked;
        }
        // Final write fence. The ticket was admitted before the probe; if
        // the authority has been refused or lost while the probe was in
        // flight, nothing is written and the previous result is kept.
        if (evidence?.current?.(tickets[i]) === false) return held("endpoint_authority_unverified");
        try {
          const saved = await request((signal) => db.rpc("publish_camera_connection_v1", { p_device_id: c.device.id, p_revision: c.device.connection_revision, p_public_ip: c.device.public_ip, p_expected_ports: c.device.expected_ports, p_monitoring_profile: c.device.monitoring_profile, p_health: health, p_source: "automatic_tcp_sweep" }).abortSignal(signal));
          if (saved.error || saved.data?.ok !== true) return held(saved.data?.reason || "publication_unverified");
          evidence?.finish(tickets[i], observed, true);
          results.push({ id: c.device.id, name: c.device.device_name, monitoring_profile: c.device.monitoring_profile, status, probe_status: reachable ? "online" : "offline", confirmed_outage: failures >= 3, published: true, activated: false, evidence: "service_port_only" });
        } catch {
          return held("publication_unverified");
        }
      }));
    }
    return { results, eligible: queue.length, held: initial.held, deferred: queue.length - cursor, deadlineReached: cursor < queue.length };
  } finally {
    await evidence?.close().catch(() => {
    });
  }
}

// tech-checks/operations/shared-snapshot-review/scheduled-entry.mjs
async function runCompletedCameraCycle({ db, request, probe, fetch: fetcher = fetch, now = Date.now, collectExisting }) {
  const started = now();
  const secret = request.headers.get("x-camera-cron-secret");
  if (!secret) throw Error("Existing cron context required");
  const readNative = async () => {
    const response = await fetcher("https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-sheets-placement-publish/camera-snapshot-source", { method: "POST", headers: { "Content-Type": "application/json", "x-camera-cron-secret": secret }, body: '{"action":"read"}', redirect: "error", cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(3e4, started + 14e4 - now()))) });
    if (!response.ok) throw Error("Native snapshot source unavailable");
    const raw = await response.text();
    if (raw.length > 6e6) throw Error("Native source too large");
    return JSON.parse(raw);
  };
  const cycle = scheduledSnapshotAdapter({ db, readNative, now, authorize: async () => ({ trigger: "scheduled" }), collect: async ({ deadline }) => {
    if (collectExisting) {
      const response = await collectExisting(), body = await response.json(), c = body.coverage;
      if (!response.ok || body.coverage_recorded !== true || !c) return { inventoryComplete: false };
      return { inventoryComplete: c.counts_known === true, eligible: c.eligible, completed: c.published, deferred: c.deferred, errors: c.unverified, held: c.held };
    }
    const at = now(), result = await collectScheduledDirect(db, probe, { startedAt: at, deadlineMs: Math.max(1, Math.min(95e3, deadline - at - 2e4)), now });
    return { inventoryComplete: true, eligible: result.eligible, completed: result.results.filter((r) => r.published).length, deferred: result.deferred, errors: result.results.filter((r) => !r.published).length, held: result.held.length };
  } });
  return cycle.run(request);
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointProducer.mjs
var HASH = /^[a-f0-9]{64}$/;
var ID = /^[1-9][0-9]{0,14}$/;
var UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
var rev = (v) => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
var canonical2 = (v) => Array.isArray(v) ? `[${v.map(canonical2)}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical2(v[k])}`).join(",")}}` : JSON.stringify(v);
var digest2 = async (v) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical2(v))))].map((b) => b.toString(16).padStart(2, "0")).join("");
function publicIPv4(ip) {
  if (typeof ip !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const a = ip.split(".").map(Number);
  if (a.some((n, i) => n > 255 || String(n) !== ip.split(".")[i])) return false;
  const [x, y, z] = a;
  return !(x === 0 || x === 10 || x === 127 || x >= 224 || x === 100 && y >= 64 && y <= 127 || x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31 || x === 192 && (y === 168 || y === 0 || y === 2) || x === 198 && (y === 18 || y === 19 || y === 51 && z === 100) || x === 203 && y === 0 && z === 113);
}
var unknown = (reason) => ({ contract: "COS_TRACKER_ENDPOINT_RESULT_PROTOTYPE_V1", status: "unknown", scope: "assigned_endpoint_only", reason, cameraHealth: "unverified" });
async function admit(source, productId, now) {
  const fail3 = () => {
    throw Error("authority_unavailable");
  };
  if (!ID.test(productId) || !source || source.contract !== "COS_TRACKER_ENDPOINT_AUTHORITY_PROTOTYPE_V1" || source.complete !== true || source.collisionSetComplete !== true || !HASH.test(source.sourceSha256) || !HASH.test(source.trackerSha256) || !rev(source.trackerRevision) || !HASH.test(source.assignmentEpoch) || !HASH.test(source.collisionEpoch) || source.expectedMhelpSourceSha256 !== source.sourceSha256 || !Number.isFinite(source.readAt) || source.readAt > now || now - source.readAt > 26e3 || !Array.isArray(source.products) || !Array.isArray(source.endpoints) || !Array.isArray(source.retainedClaims) || source.retainedClaims.length > 1e4 || source.products.length > 1e4 || source.endpoints.length > 1e4) fail3();
  if (new Set(source.products.map((p2) => p2.productId)).size !== source.products.length || new Set(source.endpoints.map((e2) => e2.id)).size !== source.endpoints.length) fail3();
  const p = source.products.find((p2) => p2.productId === productId), b = p?.binding;
  const bindingValid = !b || b.current === true && b.nativeUnitId === null && UUID.test(b.trackerId) && HASH.test(b.guard) && b.state === "linked" && b.readOnlyTracker === true && b.representedIds?.length === 1 && b.representedIds[0] === b.trackerId;
  if (!p || p.placement !== "FIELD" || p.lifecycle !== "UNFLAGGED" || p.support !== false || p.holds?.length !== 0 || p.reviewReasons?.length !== 0 || !bindingValid || !publicIPv4(p.ip)) fail3();
  const retainedClaims = source.retainedClaims.filter((v) => v.ip === p.ip);
  const unresolvedRetainedClaim = retainedClaims.some((claim) => {
    const previous = source.endpoints.find((endpoint) => endpoint.id === claim.resourceId);
    const priorProduct = previous ? source.products.find((value) => value.productId === previous.productId) : null;
    return !previous || previous.active !== false || previous.ip !== null || priorProduct?.placement !== "SHOP";
  });
  if (source.products.filter((v) => v.ip === p.ip).length !== 1 || unresolvedRetainedClaim) fail3();
  const matches = source.endpoints.filter((e2) => e2.productId === productId && e2.ip === p.ip);
  if (matches.length !== 1) fail3();
  const e = matches[0];
  if (!ID.test(e.id) || !rev(e.revision) || e.active !== true || e.enabled !== true || e.holds?.length !== 0 || !Array.isArray(e.ports) || e.ports.length < 1 || e.ports.length > 32 || new Set(e.ports).size !== e.ports.length || e.ports.some((v) => !Number.isInteger(v) || v < 1 || v > 65535)) fail3();
  const authority = { productId, trackerId: b?.trackerId ?? null, bindingGuard: b?.guard ?? null, sourceSha256: source.sourceSha256, trackerSha256: source.trackerSha256, trackerRevision: source.trackerRevision, assignmentEpoch: source.assignmentEpoch, collisionEpoch: source.collisionEpoch, endpointId: e.id, endpointRevision: e.revision, ip: e.ip, ports: [...e.ports].sort((a, b2) => a - b2) };
  return { ...authority, authorityGuard: await digest2({ authority, products: source.products, endpoints: source.endpoints, retainedClaims: source.retainedClaims }) };
}
async function produce(productId, adapters, { signal, now = Date.now, budgetMs = 5e3 } = {}) {
  const started = now(), deadline = started + Math.min(5e3, Math.max(1, budgetMs));
  const controller = new AbortController();
  let timer;
  let stop;
  const cancelled = new Promise((_, reject) => {
    stop = () => {
      controller.abort();
      reject(Error("cancelled_or_deadline"));
    };
    timer = setTimeout(stop, deadline - started);
  });
  signal?.addEventListener("abort", stop, { once: true });
  const check = () => {
    if (signal?.aborted || controller.signal.aborted || now() < started || now() >= deadline) throw Error("cancelled_or_deadline");
  };
  const call = async (fn) => {
    check();
    const r = await Promise.race([Promise.resolve().then(() => {
      check();
      return fn(controller.signal);
    }), cancelled]);
    check();
    return r;
  };
  let writing = false;
  try {
    const firstSource = await call(adapters.readAuthority);
    const before = await admit(firstSource, productId, now());
    check();
    const checkStartedAt = now();
    const outcome = await call((s) => adapters.checkEndpoint(before, s));
    if (!outcome || outcome.error || outcome.technicalError || outcome.cancelled || outcome.complete !== true || outcome.authorityGuard !== before.authorityGuard || outcome.ip !== before.ip || outcome.endpointRevision !== before.endpointRevision || !Number.isFinite(outcome.startedAt) || outcome.startedAt < checkStartedAt || !Number.isFinite(outcome.completedAt) || outcome.completedAt < outcome.startedAt || outcome.completedAt > now() || !Array.isArray(outcome.ports) || outcome.ports.length !== before.ports.length) throw Error("incomplete_check");
    const ports = new Map(outcome.ports.map((p) => [p.port, p]));
    if (ports.size !== before.ports.length || before.ports.some((p) => !ports.has(p)) || outcome.ports.some((p) => p.attempted !== true || !["responded", "refused", "network_timeout"].includes(p.outcome) || p.technicalError || p.cancelled)) throw Error("incomplete_check");
    const lastSource = await call(adapters.readAuthority);
    const after = await admit(lastSource, productId, now());
    if (firstSource.readAt > outcome.startedAt || lastSource.readAt < outcome.completedAt || before.authorityGuard !== after.authorityGuard) throw Error("authority_changed");
    const receipt = { contract: "COS_TRACKER_ENDPOINT_RECEIPT_PROTOTYPE_V1", ...before, sourceObservedAt: firstSource.readAt, sourceRecheckedAt: lastSource.readAt, startedAt: outcome.startedAt, checkedAt: outcome.completedAt, expiresAt: outcome.completedAt + 6e5, status: outcome.ports.some((p) => p.outcome === "responded") ? "responded" : "no_response", portOutcomes: outcome.ports, scope: "assigned_endpoint_only", assignmentContinuity: "observed_snapshots_only" };
    check();
    writing = true;
    const result = await call((s) => adapters.commitIfCurrent({ receipt, expected: after, deadline }, s));
    if (result?.committed !== true) return unknown("commit_not_current");
    return { contract: "COS_TRACKER_ENDPOINT_RESULT_PROTOTYPE_V1", productId, status: receipt.status, scope: receipt.scope, checkedAt: receipt.checkedAt, cameraHealth: "unverified" };
  } catch {
    return unknown(writing ? "commit_unconfirmed_no_retry" : "authority_or_check_unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointAdapters.mjs
function trackerEndpointAdapters({ rpc, checkEndpoint, verifyAuthority }) {
  const generations = /* @__PURE__ */ new Map();
  return {
    readAuthority: async (signal) => {
      const source = await rpc("cos_tracker_endpoint_source_v1", {}, signal);
      if (!source || typeof source.generation !== "string" || !/^[1-9][0-9]*$/.test(source.generation)) throw Error("Authority unpublished");
      const verified = typeof verifyAuthority === "function" ? await verifyAuthority(source, signal) : null;
      if (verified?.valid !== true || !Number.isFinite(verified.observedAt) || verified.observedAt > Date.now() || Date.now() - verified.observedAt > 26e3) throw Error("Current protected source verification required");
      generations.set(source.assignmentEpoch, source.generation);
      return { ...source, readAt: verified.observedAt };
    },
    checkEndpoint,
    commitIfCurrent: async ({ receipt, expected, deadline }, signal) => {
      if (signal.aborted || Date.now() >= deadline) return { committed: false };
      const generation = generations.get(expected.assignmentEpoch);
      if (!generation) throw Error("No observed authority generation");
      const bytes = new TextEncoder().encode(JSON.stringify(receipt));
      const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (signal.aborted || Date.now() >= deadline) return { committed: false };
      return rpc("cos_tracker_endpoint_commit_v1", { p_key: key, p_generation: generation, p_receipt: receipt, p_deadline_ms: deadline }, signal);
    }
  };
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointAuthority.mjs
function trackerEndpointAuthority(full, census, { trackerRevision, retainedClaims, retainedClaimsComplete }, now = Date.now()) {
  const bad = () => {
    throw Error("Complete admitted tracker authority required");
  };
  if (full?.complete !== true || !Number.isFinite(Date.parse(full.verifiedAt)) || Date.parse(full.verifiedAt) > now || now - Date.parse(full.verifiedAt) > 26e3 || !Array.isArray(full.upload?.records) || !Array.isArray(full.tracker?.records) || !Array.isArray(full.identitySources?.devices) || census?.sourceSha256 !== full.upload.sourceSha256 || full.tracker.expectedMhelpSourceSha256 !== full.upload.sourceSha256 || !/^[a-f0-9]{64}$/.test(full.tracker.trackerSourceSha256) || typeof trackerRevision !== "string" || !/^(0|[1-9][0-9]*)$/.test(trackerRevision) || retainedClaimsComplete !== true || !Array.isArray(retainedClaims)) bad();
  if (full.tracker.records.length !== full.upload.records.length || new Set(full.tracker.records.map((p) => p.productId)).size !== full.tracker.records.length || new Set(full.upload.records.map((p) => p.productId)).size !== full.upload.records.length) bad();
  const terminal3 = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
  const products = full.upload.records.map((raw) => {
    const t = full.tracker.records.find((p2) => p2.productId === raw.productId), p = census.records.find((p2) => p2.productId === raw.productId), b = raw.binding;
    if (!t || !p) bad();
    const units = full.map.inventoryItems.filter((u) => u.id === b?.trackerId);
    const held = !!raw.holdReason || p.binding?.placementHeld || p.binding?.reason || p.binding?.candidateUnitIds?.length || p.binding?.state !== "linked" || terminal3(raw.unitNumber) || t.placement !== raw.placement;
    return { productId: raw.productId, placement: raw.placement, lifecycle: raw.lifecycle, support: /(stand|pole|skid)/i.test(raw.category || ""), ip: t.publicIp, holds: held ? ["existing_source_hold"] : [], reviewReasons: t.reviewReasons || [], binding: b ? { current: b.guardCurrent === true, nativeUnitId: b.nativeUnitId, trackerId: b.trackerId, guard: b.expectedGuard, state: p.binding?.state, readOnlyTracker: units.length === 1 && units[0].readOnly === true, representedIds: p.binding?.unitIds } : null };
  });
  for (const claim of retainedClaims) {
    if (!claim || typeof claim.resourceId !== "string" || !/^[-A-Za-z0-9_:]{1,160}$/.test(claim.resourceId) || typeof claim.ip !== "string" || !claim.ip) bad();
  }
  const endpoints = full.identitySources.devices.map((d) => ({ id: String(d.id), revision: String(d.connection_revision), ip: d.public_ip, ports: d.expected_ports, active: d.activation_state === "active", enabled: d.monitoring_enabled === true, holds: [d.device_name, d.unit_key, d.activation_state, d.organization].some(terminal3) ? ["terminal_endpoint"] : [] }));
  return { contract: "COS_TRACKER_ENDPOINT_AUTHORITY_PROTOTYPE_V1", complete: true, collisionSetComplete: true, sourceSha256: full.upload.sourceSha256, expectedMhelpSourceSha256: full.upload.sourceSha256, trackerSha256: full.tracker.trackerSourceSha256, trackerRevision, products: products.sort((a, b) => a.productId.localeCompare(b.productId)), endpoints: endpoints.sort((a, b) => a.id.localeCompare(b.id)), retainedClaims: [...retainedClaims].sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.ip.localeCompare(b.ip)) };
}
function authorityMatchesProtectedSource(admitted, full, census, options, now = Date.now()) {
  const current = trackerEndpointAuthority(full, census, options, now);
  const canonical4 = (v) => Array.isArray(v) ? "[" + v.map(canonical4).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical4(v[k])).join(",") + "}" : JSON.stringify(v);
  return Object.keys(current).every((key) => canonical4(current[key]) === canonical4(admitted[key]));
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointPublish.mjs
async function publishObservedTrackerSource({ rpc, readProtectedSource, project, readRetainedClaims, signal, now = Date.now }) {
  const check = () => {
    if (signal?.aborted) throw Error("Cancelled");
  };
  check();
  const previous = await rpc("cos_tracker_endpoint_source_v1", {}, signal);
  check();
  const expected = previous?.generation ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(expected)) throw Error("Invalid publication generation");
  const full = await readProtectedSource(signal);
  check();
  const projected = await project(full, now());
  check();
  const retained = await readRetainedClaims(signal, full.identitySources.devices);
  check();
  const trackerRevision = previous?.trackerRevision ?? (BigInt(expected) + 1n).toString();
  const authority = trackerEndpointAuthority(full, projected.census, { trackerRevision, retainedClaims: retained.claims, retainedClaimsComplete: retained.complete }, now());
  const rechecked = await readProtectedSource(signal);
  check();
  const after = await project(rechecked, now());
  check();
  const retainedAfter = await readRetainedClaims(signal, rechecked.identitySources.devices);
  check();
  if (!authorityMatchesProtectedSource(authority, rechecked, after.census, { trackerRevision, retainedClaims: retainedAfter.claims, retainedClaimsComplete: retainedAfter.complete }, now())) throw Error("Source changed during publication");
  if (previous && authorityMatchesProtectedSource(previous, rechecked, after.census, { trackerRevision, retainedClaims: retainedAfter.claims, retainedClaimsComplete: retainedAfter.complete }, now())) return previous;
  return rpc("cos_tracker_endpoint_publish_v1", { p_expected: expected, p_source: { ...authority, trackerRevision: (BigInt(expected) + 1n).toString(), revisionKind: "admitted_snapshot", sourceObservedAt: Date.parse(rechecked.verifiedAt) } }, signal);
}
function createObservedAuthorityVerifier({ readProtectedSource, project, readRetainedClaims, now = Date.now }) {
  return async (admitted, signal) => {
    if (signal?.aborted) return { valid: false };
    const full = await readProtectedSource(signal), p = await project(full, now()), retained = await readRetainedClaims(signal, full.identitySources.devices);
    return { valid: !signal?.aborted && authorityMatchesProtectedSource(admitted, full, p.census, { trackerRevision: admitted.trackerRevision, retainedClaims: retained.claims, retainedClaimsComplete: retained.complete }, now()), observedAt: Date.parse(full.verifiedAt) };
  };
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointClaims.mjs
var canonical3 = (v) => Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v, Object.keys(v).sort());
var endpoint = (d) => ({ id: String(d.id), ip: d.public_ip, revision: String(d.connection_revision), ports: [...d.expected_ports || []].sort((a, b) => a - b), enabled: d.monitoring_enabled, active: d.activation_state, name: d.device_name ?? null, unit: d.unit_key ?? null, organization: d.organization ?? null });
async function readRetainedEndpointClaims(rpc, devices, signal, now = Date.now) {
  if (signal?.aborted) throw Error("Cancelled");
  const packet = await rpc("cos_tracker_endpoint_claims_v1", {}, signal);
  if (signal?.aborted || packet?.complete !== true || !Array.isArray(packet.devices) || !Array.isArray(packet.claims) || packet.devices.length > 1e4 || packet.claims.length > 1e4 || !Number.isFinite(packet.observedAt) || packet.observedAt > now() || now() - packet.observedAt > 26e3) throw Error("Complete historical endpoint source required");
  const configurations = (rows) => rows.map(endpoint).sort((a, b) => a.id.localeCompare(b.id)).map(canonical3);
  if (new Set(packet.devices.map((d) => String(d.id))).size !== packet.devices.length || JSON.stringify(configurations(packet.devices)) !== JSON.stringify(configurations(devices))) throw Error("Endpoint source changed during history read");
  const claims = packet.claims.map((c) => {
    if (!c || typeof c.resourceId !== "string" || !/^[-A-Za-z0-9_:]{1,160}$/.test(c.resourceId) || typeof c.ip !== "string" || !c.ip || c.productId !== void 0) throw Error("Invalid historical resource claim");
    return { resourceId: c.resourceId, ip: c.ip };
  }).sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.ip.localeCompare(b.ip));
  if (new Set(claims.map((c) => canonical3(c))).size !== claims.length) throw Error("Duplicate retained claim");
  return { complete: true, claims, observedAt: packet.observedAt };
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointScheduled.mjs
function createScheduledEndpointEvidence({ readAuthority, commitIfCurrent, signal, deadline, now = Date.now, blocked: blockedAtStart = null }) {
  const controller = new AbortController(), pending = /* @__PURE__ */ new Set();
  const diagnostic = { preparation: "pending", failure: null, started: 0, responded: 0, no_response: 0, unknown: 0, authority_reads: 0 };
  let ready = null, refreshing = null, verifying = null, closed = false;
  // Once set, no further authority read is made by this invocation.
  //  "refused":     the source declined a stale or incomplete inventory.
  //  "unavailable": two consecutive reads failed for a temporary reason, or
  //                 the caller's own preparation already failed.
  // Either way every device is held as unverified, exactly as it is today
  // when no current authority is available, and prior results are kept.
  let blocked = blockedAtStart === "refused" || blockedAtStart === "unavailable" ? blockedAtStart : null, consecutiveFailures = 0;
  if (blocked) {
    diagnostic.preparation = blocked;
    diagnostic.failure = blocked === "refused" ? "authority_refused_by_caller" : "authority_unavailable_by_caller";
  }
  const failed = (code) => {
    consecutiveFailures++;
    if (/^native_source_refused_/.test(code || "")) blocked = "refused";
    else if (consecutiveFailures >= 2 && !blocked) blocked = "unavailable";
    // A block is authoritative: the authority held so far is dropped, and
    // no read that was already in flight may put one back.
    if (blocked) ready = null;
  };
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, Math.max(1, deadline - now()));
  const refresh = () => {
    if (blocked || closed || controller.signal.aborted || now() >= deadline) return Promise.resolve(null);
    if (refreshing) return refreshing;
    diagnostic.authority_reads++;
    refreshing = Promise.resolve().then(() => readAuthority(controller.signal)).then((value) => {
      if (blocked) {
        // Another request latched a block while this read was in flight.
        ready = null;
        diagnostic.preparation = blocked;
        return null;
      }
      if (!closed && !controller.signal.aborted && Number.isFinite(value?.readAt) && value.readAt <= now() && now() - value.readAt <= 26e3) ready = value;
      else ready = null;
      if (ready) consecutiveFailures = 0;
      else failed(null);
      diagnostic.preparation = ready ? "ready" : blocked === "refused" ? "refused" : "unavailable";
      return ready;
    }, (error) => {
      ready = null;
      failed(error?.code);
      diagnostic.preparation = blocked === "refused" ? "refused" : diagnostic.preparation === "deadline" ? "deadline" : "unavailable";
      diagnostic.failure = /^(?:native_source_refused_inventory_(?:not_current|incomplete)|native_source_http_[1-5][0-9]{2}|retained_claims_incomplete|scheduled_source_changed|rpc_cos_tracker_endpoint_(?:source|claims|publish|commit)_v1_[A-Z0-9]{5}|source_validation(?:_(?:read|prior|generation|publish|verify|native_read|claims_read))?)$/.test(error?.code) ? error.code : "source_validation";
      return null;
    }).finally(() => {
      refreshing = null;
    });
    return refreshing;
  };
  const verifyAfter = (after) => {
    if (verifying && verifying.startedAt >= after) return verifying.promise;
    const next = { startedAt: now(), promise: null };
    if (next.startedAt < after || controller.signal.aborted) throw Error("Cancelled or invalid observation");
    if (blocked) throw Error("Endpoint authority blocked");
    diagnostic.authority_reads++;
    next.promise = Promise.resolve().then(() => readAuthority(controller.signal)).then((value) => {
      if (blocked) throw Error("Endpoint authority blocked");
      consecutiveFailures = 0;
      return value;
    }, (error) => {
      failed(error?.code);
      if (blocked) diagnostic.preparation = blocked;
      throw error;
    }).finally(() => {
      if (verifying === next) verifying = null;
    });
    verifying = next;
    return next.promise;
  };
  const warmup = refresh();
  return {
    warmup,
    diagnostics: () => ({ ...diagnostic, blocked }),
    // False once a block is latched: a ticket admitted earlier no longer
    // stands for a current authority.
    current: (ticket) => Boolean(ticket) && !blocked,
    async prepare(maximumMs = 4e4) {
      let prepareTimer;
      try {
        return await Promise.race([warmup.then((v) => Boolean(v)), new Promise((resolve2) => {
          prepareTimer = setTimeout(() => {
            diagnostic.preparation = "deadline";
            stop();
            resolve2(false);
          }, Math.max(0, Math.min(maximumMs, deadline - now())));
        })]);
      } finally {
        clearTimeout(prepareTimer);
      }
    },
    async begin(candidate) {
      if (blocked || closed || controller.signal.aborted || now() + 2500 >= deadline) return null;
      const first = ready;
      if (!first || now() - first.readAt > 26e3) {
        void refresh();
        return null;
      }
      if (now() - first.readAt > 1e4) void refresh();
      const products = first.products?.filter((p) => p.productId === candidate.productId) || [];
      if (products.length !== 1) return null;
      let announce, settle, reads = 0, recheckAfter = Infinity;
      const entered = new Promise((resolve2) => announce = resolve2), observation = new Promise((resolve2) => settle = resolve2);
      const adapters = { readAuthority: async (s) => {
        if (s.aborted || controller.signal.aborted) throw Error("Cancelled");
        // A ticket issued before a block cannot be completed after it.
        if (blocked) throw Error("Endpoint authority blocked");
        if (reads++ === 0) return first;
        const value = await verifyAfter(recheckAfter);
        if (blocked) throw Error("Endpoint authority blocked");
        if (!controller.signal.aborted) ready = value;
        return value;
      }, checkEndpoint: (authority) => {
        if (authority.endpointId !== String(candidate.device.id) || authority.endpointRevision !== String(candidate.device.connection_revision) || authority.ip !== candidate.host || JSON.stringify(authority.ports) !== JSON.stringify(candidate.ports)) throw Error("Scheduled target mismatch");
        announce(true);
        return observation.then((o) => {
          recheckAfter = o.completedAt;
          return { ...o, authorityGuard: authority.authorityGuard, ip: authority.ip, endpointRevision: authority.endpointRevision };
        });
      }, commitIfCurrent };
      const work = produce(products[0].productId, adapters, { signal: controller.signal, now, budgetMs: Math.min(5e3, deadline - now()) });
      diagnostic.started++;
      work.then((result) => {
        if (result.status === "responded") diagnostic.responded++;
        else if (result.status === "no_response") diagnostic.no_response++;
        else diagnostic.unknown++;
      });
      pending.add(work);
      work.finally(() => {
        pending.delete(work);
        announce(false);
      });
      if (!await entered) return null;
      return { settle, work };
    },
    finish(ticket, observation, accepted) {
      if (!ticket) return;
      if (!accepted || !observation || closed || controller.signal.aborted) {
        ticket.settle({ complete: false });
        return;
      }
      const ports = Object.entries(observation.ports).map(([port, v]) => {
        const valid = v && typeof v.online === "boolean" && !v.errorCode && !v.error_code && !v.technicalError && !v.cancelled;
        const error = v?.error;
        const outcome = valid && v.online && (error === null || error === void 0) ? "responded" : valid && !v.online && error === "timeout" ? "network_timeout" : valid && !v.online && error === "Connection refused (os error 111)" ? "refused" : valid && !v.online && error === "Connection timed out (os error 110)" ? "network_timeout" : "unknown";
        return { port: Number(port), attempted: true, outcome };
      });
      ticket.settle({ complete: true, startedAt: observation.startedAt, completedAt: observation.at, ports });
    },
    async close() {
      closed = true;
      let finishTimer;
      try {
        await Promise.race([Promise.allSettled([...pending]), new Promise((resolve2) => {
          finishTimer = setTimeout(() => {
            stop();
            resolve2();
          }, Math.max(0, deadline - now()));
        })]);
      } finally {
        clearTimeout(finishTimer);
        clearTimeout(timer);
        stop();
        signal?.removeEventListener("abort", stop);
      }
    }
  };
}
function createScheduledTrackerEndpointIntegration({ rpc, readProtectedSource, project, signal, deadline, now = Date.now }) {
  if (typeof readProtectedSource !== "function" || typeof project !== "function") throw Error("Existing protected source runtime required");
  const shared = { rpc, readProtectedSource, project, readRetainedClaims: (s, devices) => readRetainedEndpointClaims(rpc, devices, s, now), now };
  const verifyAuthority = createObservedAuthorityVerifier(shared);
  const adapters = trackerEndpointAdapters({ rpc, verifyAuthority });
  let initialized = false;
  const readAuthority = async (s) => {
    if (!initialized) {
      await publishObservedTrackerSource({ ...shared, signal: s });
      initialized = true;
    }
    return adapters.readAuthority(s);
  };
  return createScheduledEndpointEvidence({ readAuthority, commitIfCurrent: adapters.commitIfCurrent, signal, deadline, now });
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/trackerEndpointScheduledSource.mjs
var URL2 = "https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-sheets-placement-publish/endpoint-source";
var H = /^[a-f0-9]{64}$/;
var ordered = (v) => Array.isArray(v) ? "[" + v.map(ordered).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + ordered(v[k])).join(",") + "}" : JSON.stringify(v);
function createScheduledSourceBinding({ rpc, readNative, signal, deadline, now = Date.now, blocked = null }) {
  const stage = async (name, work) => {
    try {
      return await work();
    } catch (error) {
      if (typeof error?.code === "string" && /^(?:native_source_refused_inventory_(?:not_current|incomplete)|native_source_http_[1-5][0-9]{2}|retained_claims_incomplete|scheduled_source_changed|rpc_cos_tracker_endpoint_(?:source|claims|publish|commit)_v1_[A-Z0-9]{5}|source_validation_(?:read|prior|generation|publish|verify|native_read|claims_read))$/.test(error.code)) throw error;
      const safe = Error("Scheduled source stage failed");
      safe.code = "source_validation_" + name;
      throw safe;
    }
  };
  const read = async (s, trackerRevision) => stage("read", async () => {
    const [native, claims] = await Promise.all([stage("native_read", () => readNative(s)), stage("claims_read", () => rpc("cos_tracker_endpoint_claims_v1", {}, s))]);
    if (claims?.complete === false) {
      const e = Error("Historical claims incomplete");
      e.code = "retained_claims_incomplete";
      throw e;
    }
    const readAt = Math.min(native?.observedAt, claims?.observedAt);
    if (s.aborted || native?.contract !== "COS_SCHEDULED_TRACKER_ENDPOINT_SOURCE_V1" || native.complete !== true || claims?.complete !== true || !H.test(native.sourceSha256) || !H.test(native.trackerSha256) || !Number.isFinite(readAt) || readAt > now() || now() - readAt > 26e3 || !Array.isArray(native.products) || !native.products.length || native.products.length > 1e4 || new Set(native.products.map((p) => p.productId)).size !== native.products.length || !Array.isArray(claims.devices) || claims.devices.length > 1e4 || !Array.isArray(claims.claims) || claims.claims.length > 1e4) throw Error("Complete scheduled source unavailable");
    const terminal3 = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
    const endpoints = claims.devices.map((d) => ({ id: String(d.id), productId: d.product_id, revision: String(d.connection_revision), ip: d.public_ip, ports: d.expected_ports, active: d.activation_state === "active", enabled: d.monitoring_enabled === true, holds: [d.device_name, d.unit_key, d.activation_state, d.organization].some(terminal3) ? ["terminal_endpoint"] : [] })).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(endpoints.map((e) => e.id)).size !== endpoints.length || claims.claims.some((c) => typeof c.resourceId !== "string" || !/^[-A-Za-z0-9_:]{1,160}$/.test(c.resourceId) || typeof c.ip !== "string" || !c.ip || c.productId !== void 0)) throw Error("Incomplete endpoint claims");
    return { readAt, authority: { contract: "COS_TRACKER_ENDPOINT_AUTHORITY_PROTOTYPE_V1", complete: true, collisionSetComplete: true, sourceSha256: native.sourceSha256, expectedMhelpSourceSha256: native.sourceSha256, trackerSha256: native.trackerSha256, trackerRevision, products: [...native.products].sort((a, b) => a.productId.localeCompare(b.productId)), endpoints, retainedClaims: [...claims.claims].sort((a, b) => a.resourceId.localeCompare(b.resourceId) || a.ip.localeCompare(b.ip)) } };
  });
  const matches = (a, b) => Object.keys(a).every((k) => ordered(a[k]) === ordered(b[k]));
  const initialize = async (s) => {
    const prior = await stage("prior", () => rpc("cos_tracker_endpoint_source_v1", {}, s)), g = prior?.generation ?? "0";
    if (!/^(0|[1-9][0-9]*)$/.test(g)) throw Object.assign(Error("Invalid generation"), { code: "source_validation_generation" });
    const revision3 = prior?.trackerRevision ?? "1", after = await read(s, revision3);
    if (s.aborted) throw Error("Cancelled source initialization");
    if (prior && matches(after.authority, prior)) return;
    await stage("publish", () => rpc("cos_tracker_endpoint_publish_v1", { p_expected: g, p_source: { ...after.authority, trackerRevision: (BigInt(g) + 1n).toString(), revisionKind: "admitted_snapshot", sourceObservedAt: after.readAt } }, s));
  };
  const adapters = trackerEndpointAdapters({ rpc, verifyAuthority: async (a, s) => {
    const current = await read(s, a.trackerRevision);
    return { valid: matches(current.authority, a), observedAt: current.readAt };
  } });
  let initialized = false;
  return createScheduledEndpointEvidence({ signal, deadline, now, blocked, commitIfCurrent: adapters.commitIfCurrent, readAuthority: async (s) => {
    if (!initialized) {
      await initialize(s);
      initialized = true;
    }
    return stage("verify", () => adapters.readAuthority(s));
  } });
}
// Reads only the small label on a 503. The source's own freshness and
// completeness checks decide the label; nothing here re-derives them.
var SCHEDULED_SOURCE_REFUSALS = ["inventory_not_current", "inventory_incomplete"];
async function scheduledSourceRefusal(response) {
  if (response?.status !== 503) return null;
  // The label is bounded before it is read: a declared length above the
  // limit is not read at all, and the stream is abandoned at the limit.
  const declared = response.headers?.get("content-length");
  if (declared !== null && declared !== void 0 && !(/^[0-9]{1,4}$/.test(declared) && Number(declared) <= 512)) return null;
  let reader = null;
  try {
    reader = response.clone().body?.getReader() || null;
    if (!reader) return null;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 512) return null;
      text += decoder.decode(part.value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    return value && value.retryable === false && SCHEDULED_SOURCE_REFUSALS.includes(value.code) ? value.code : null;
  } catch {
    return null;
  } finally {
    void reader?.cancel().catch(() => {});
  }
}
function scheduledNativeSourceReader({ cronSecret, fetch: fetcher = fetch }) {
  if (typeof cronSecret !== "string" || !cronSecret || cronSecret.length > 1024 || /\s/.test(cronSecret)) throw Error("Existing cron authorization required");
  return async (signal) => {
    const readStarted = Date.now();
    let response;
    const fetchSource = () => fetcher(URL2, { method: "POST", headers: { "Content-Type": "application/json", "x-camera-cron-secret": cronSecret }, body: '{"action":"read"}', redirect: "error", cache: "no-store", signal });
    try {
      response = await fetchSource();
      // A labelled refusal (the accepted inventory is not current, or is
      // incomplete) cannot change until a new inventory is accepted. It is
      // never retried, here or anywhere else in this invocation. An
      // unlabelled 502/503/504 is a temporary read failure and keeps its
      // single quick retry.
      let refusal = await scheduledSourceRefusal(response);
      if (!refusal && [502, 503, 504].includes(response.status) && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!signal.aborted) {
          response = await fetchSource();
          refusal = await scheduledSourceRefusal(response);
        }
      }
      if (refusal) {
        const e = Error("Native source refused");
        e.code = "native_source_refused_" + refusal;
        throw e;
      }
    } catch (error) {
      console.warn("camera endpoint source fetch failed", error?.name, error?.message, Date.now() - readStarted, signal.aborted);
      throw error;
    }
    if (signal.aborted || !response.ok || !response.body || Number(response.headers.get("content-length")) > 8e6) {
      console.warn("camera endpoint source response invalid", response.status, response.headers.get("content-length"), Date.now() - readStarted, signal.aborted);
      const e = Error("Native source unavailable");
      e.code = "native_source_http_" + response.status;
      throw e;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, raw = "";
    try {
      for (;;) {
        if (signal.aborted) throw Error("Cancelled");
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.length;
        if (bytes > 8e6) throw Error("Source exceeds bound");
        raw += decoder.decode(r.value, { stream: true });
      }
    } catch (error) {
      console.warn("camera endpoint source body failed", error?.name, error?.message, Date.now() - readStarted, bytes, response.status, signal.aborted);
      throw error;
    } finally {
      void reader.cancel().catch(() => {});
    }
    try { return JSON.parse(raw + decoder.decode()); }
    catch (error) {
      console.warn("camera endpoint source JSON failed", error?.name, error?.message, Date.now() - readStarted, bytes);
      throw error;
    }
  };
}

// tech-checks/docs/deployed-cos-operations-pages-v134/source/productTcpRuntime.ts
var REVIEWED_NATIVE_IDENTITIES2 = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": "dc532cb72f2c0091810d513666813074b10a8afdfb526f00c0a9873554b1dc8e",
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": "846332d10df653b11ed142dadce45363663d3a41088b8ffdc2b0f3127a6ab693",
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": "dc1e2366233e86c34217538b771d522b6176ade5ea762d133734c14d80ae168f",
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": "c69a648f97b8e7b9035e812a3d6ab4dad64917a2f36575e71c8aeed4b382dbb3",
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": "182399e8d0f7f3ac2a05fc57d442afe934331631c8f25111b3722c6209cdbfd0",
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": "3af1a6e9acea89f412c81dd8236b5fd20f2dae3e9d4c97617031fb1c701c2614",
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": "64ff9ea9e05331f8abcd72013ff1b11004c6c307555371db7814c46b178693b6",
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": "f557e13e370f5f557565e99f3d19efeea9475fe5048fd351851f03cdc89c9553",
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": "34ffc498d15d98306dbbe22a71e50719ebbe8765fd8a0a39bbc1cd951f69cd12",
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": "f2aa273b73c89fd5c1ade8abe39fc2948d7d8054ab62c493d8c7246ff352daee",
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": "80b7465c6d14b4bf2c1cb84b73681ed36f75a2bf6386e1297a1a437eb029c629",
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": "08b42f07fa5be04ca84b00b10e611534f676510706db270f0d9fdd8a202b5226",
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": "3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a",
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": "8271ee9b3309314f50cf77b5d1b3cc777c487f1b67742aca6c05edbfc962f9b5",
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": "cf1ea7307b5e42e63a5d2d5788cabcbdc1ab73100bee0639b2928324d01825e6",
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": "28c4f4520e0717f407ad62ae8227ffbd9176473a3e9c775d45a4f9ca74fd0cfb",
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": "5447825c15fafdb87da05d16d1e5f30ab40b0780d0fb95669d47bf7d1b806663",
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": "8594d7894b960e4bd9c1786598ad8a5d9ebcab4a4f3fa0a44c7f05aae640b12a",
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": "835ae1a7bf5b17e27ab93944dac352d9a4acc5b67148e699f2beae8ee684f273",
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": "01eb424f57264fb1dffa14d673e18e018167ce8c268426a24c4e8683d8968fbc",
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": "6400e2d9d1a9f4c00ec7a6da54c6381d91d8cbb11b341c17a060ef70f72c8c8a",
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": "55736078a81914bdd4ed030260f8c2b2d2fff3270cf85510176d4a98445c0082",
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": "4050219a4964f37f79511367ff07d19e38f5696edec2418b08ce052cec39ed56",
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": "6b6e16a6b7b2bfb854b77903d04ba76b30fcc796fe5bdec537d3e24dd467a8f1",
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": "1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816",
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": "f456119070ba4bc22ea9f8dee89f5fce5ed96985b877d57b6d89cae2d6fbd664",
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": "356a98b0fdfe2669c3e9acb58ea66d442d3ff43abebd619672ff6e84b18c0271",
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": "e2af180710b75083fd45f33a38e15ac05f5a150096a4a2e641fe27a5ac1847fb",
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": "47d53becaa3a98cd3c516439b9a8a0adce6ec0417c9ffff74d8cf8bf88d681a1",
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": "c795740ea73b57450a35bb13b3ab764eb834f6bfd10019bbeccc8bd2fd0b92c9",
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": "921575d2866d5933293f19e60a668517d5f85481cb24240badc0a03df1cf6080",
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": "84a903b69564f86d3de42e64c58fc136b36da9c90a88e13b291924ec131c33ea",
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": "fead08519abd9694d9c9d61deb4effe9f81bbb2e3b23227efdbdad8557262ef0",
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": "0c828defbb69a0303b04ea14805d9440f3b5cc97614ca8c74a5023d135a42572",
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": "d1e16091d53cba63858a6367490781f9ea24ac14996a078deb793914c0f60f4d",
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": "ecc3f586260106cfe927ee6bec00b9742c1cf278d2b082d8db104442f218a09f",
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": "ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c",
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": "b96ddef9f10bb1b4b5759128bed9a2650e215f5f40077341f15c270f374492b0",
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": "1122fb128668a31e2a66030fd6a516715f87ab7ba5138e4a191a8b52fe6ac730",
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": "8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6",
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": "b61987eee1b80ad1c9857fc00b5c6790b4fd1ba6b55cd352bb7df73639a6c888",
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": "25a162368050d144b5d92ddb368412570ce24919a3ee527865a247752d0bcfa3",
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": "f66c1ebbfe141ddaac5e9a6e9c690ac8fb546448c74d8021dcc8cadec91b338e",
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": "1e7dcc1f846965bafcc4501ffb96194b17ee6afffbb70c87ae15e048a64f05d8",
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": "2a92368a1a687c5e7b2d719d89184c808ba8e53918f8bfd400b817917c388cc0",
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": "cee6e035aaf931230a3cc87ca3890b69037653c411b8d1fd4bfa727c4f7b7de9",
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": "c96ffceddc8c164d5a54f1e06e8d7a3465314e67a19aa40718874581fa6de4a0",
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": "2267afd0f19117321d7213e9ed7e28ad14209c44030276ff4cbcab79e1d74ef0",
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": "acaadda2e3ee68b484dfbe6a6c5230a2fb13c72bc992f58e2085bec2ca3ebcf2",
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": "b1f1ec74016c6e7f42b5933b6aded62e572b4b5e610f04e68e7c451b744b39da",
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": "f39f68e1a178bca02f47f310473e7a362b135b3e51fd892f416b829c85d1d076",
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": "001fbd0e38b5affc759ed9d80f1e11d69db05a4581f34f521c7bd009f9689c3a",
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": "713deadb62d2cf7279637f3e984e394a3251a49af7d566de1093d7526796dfab",
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": "56b6848bdf1f9e7fd5754c8b8b741aecc4993330e1baa706bd7b5806dd53d36e",
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": "35513bfc1c59f48a75d1871ec8643510805831f1a4a1306ea9826187837cf155",
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": "78c178dc5c8a6dd6984a462413ae81485f6d8ad79906d3a4a3938850b035e7af",
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": "584aec9773f6d0c7593779735cdf157be2f54cff185f62cb88bc4758efae1227",
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": "15221ef117692879f16269d86ef3e32e5444a2b3b11545a8cc4a98441c6893f2",
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": "410d47dc5ced6118b4cd226178d2ecf05b6ecf8c19e1997aef3e4ae63dfd0ee1",
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": "273394daf97b444ec1b45e965b5902bc0492d3e17cb9fe39fb152d27ad6d6e53",
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": "48a474cd1831bfb8c005e05bce15c06f5ff553ae9c46812e7a386314bf261485",
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": "2f173a5ef3240516bf2050e4bbaa6a298729fd47483347d57c99f5521ea2e06e",
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": "625bfac59603230adaa4ee2b4ce51bdc84c49bbac75abaa0296bf51a0419fab2",
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": "db5f2cf50dcd7080bb10026ebf969b5bc3aba086d843ff60c9c61229d47498b6",
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": "ec04fa9cac495270bc30b5dca36f10e7de3dfc2079108e26b3bad368afbc4914",
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": "22f0c7a9651d4c22d04fc7425587cfae197fa23500f785175a16196ce48c2960",
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": "1260073ea6bfac20d6d20d4e5da42e98f5304c61231ce059036c59782dea6f27",
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": "c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049",
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": "b53e0b01674c32239843d47065e9aab253cd0be05f02ee914f07c81328b3e96a",
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": "37fa91756b5063a015abe6e89cb7d13377756d043bd84abab7b0b2f2b346cc88",
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": "f4c80e614b8760e1fc75255611bd808549181ce4da349c7cef885a456797579a",
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": "bd2b41c64fa88e7a4f442bb2831f60661d86adf9d1d0ed03fc4147fd1249cace",
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": "fc7660cc98bbe9e43b185c35abd4b978e736719e2fd19a5f8bd3b8b83edd4c76",
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": "6323583a84d139bfb76dc777c5d21408692a2b6f460da5059419bc78d124906b",
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": "3ed985d8a8f0937e6a7adf8d6ae92cb1715681aa109b095f02b3949873f01d12",
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": "c89bdd2d7eb3cae4e86181573b6d201bdcf3715e2c23186fe1aa6d0031c32c2c"
});
var REVIEWED_NATIVE_RESOURCES2 = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": {
    "deviceIds": [
      "feed6068a78c6977c764c0365dfcfac2d94f6ddf1535273fc8b6c48e04eb7105",
      "46904bb929ed3ffdbedfdfb4d2c517282d10d2644ca3205a03d9fc2bd06cd987",
      "fdd3c0ca5a1c00eaaddc2c0140aef37c154e4ab6338de9c8bd43575858e2cd13",
      "664c50e58955e2ac4fa545241ed292331f9b9749510742992e0f444e2018a01e"
    ],
    "unitKeys": [
      "0de5ec7e47d0dd1758d9098f9e7accac4adadf71339f289a79541711ef8afa94"
    ]
  },
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": {
    "deviceIds": [
      "919ebe27f91e752138b6d6860ba66887320054c0401c2c0fa04edc05839eed9c",
      "c5cdd4e83a0d351b70c57129fe2d61f715eede74803d15ef5bc00855b43d7a8d",
      "c169a89d9d9d9889cf1e66e1a77975ed54653278492fbabf7e114717d2182b4f",
      "261f529ffcc8649a076e80900e60863b141ec11ba28224eaa49850e4af4e2932"
    ],
    "unitKeys": [
      "fd08cac3ffb8b8a1cc214b02437646792de0c80a8ebda897933ae1bd1b027862"
    ]
  },
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": {
    "deviceIds": [
      "7a47b4b401db7190cac9be7cbef7766866c84f3991ce50d6647510eba98159a2"
    ],
    "unitKeys": [
      "bc834b04b6ec86a0b9359357ee2d7a7b540134f0395b7ad201f702dde0189a07"
    ]
  },
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": {
    "deviceIds": [
      "8d430f32fd142626a4a2cb5b09394a4af33420cb3bf314a39cc7ebf1ae775f55"
    ],
    "unitKeys": [
      "0aa709b48aabb02c1e88f0fa5e654e451a162447a9094994b21b12b067b91134"
    ]
  },
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": {
    "deviceIds": [
      "a2b9f5c6f8c81903bb35f0c56cea4315a49b9f4b72054c56a651de3670e5cbaa",
      "c2648de9d0dfd0821f1dc06c4873cc7425848081b93ef49289d1c827de71c241",
      "86c7185dba0443000839ba2667b1dc6bc74e480e963f5a39cb84a8493c9f656c",
      "7ddce19715dcd61628ccbfaefed15566a21231aa81569a59faedb9bd967e76d7"
    ],
    "unitKeys": [
      "2ca59f6603691b189aa53a2200720883e946f7a69345ff227f2e518c26f15ce9"
    ]
  },
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": {
    "deviceIds": [
      "561618b11144e70ce14c23226b02c15794feba35bb19d887b1dc4ddb94293b51"
    ],
    "unitKeys": [
      "29ea45b1107c4c2010857890bad43671591f2e84c8d0e1e23d65b587b96b26a2"
    ]
  },
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": {
    "deviceIds": [
      "44e629d9d31d9079a1a3a979c4fe47d034956788332f70b564ccb2f11e8450f3"
    ],
    "unitKeys": [
      "00e737c29227071b5363c2b7579db53f053246d460155ca6969773673e46a4a8"
    ]
  },
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": {
    "deviceIds": [
      "46febca97d70d9cbc2c1aa3c97ce40d0b08162616217a090ac79ff502c09db47"
    ],
    "unitKeys": [
      "4fa5d146c11b6807cff48403cc164d81eb0df3a56f07f35de31d2f4ade1f4180"
    ]
  },
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": {
    "deviceIds": [
      "e36943ee7acb30e94df2ffd9ae80e30af4ac6cf94fb5ada1295d2c1d96bc06a3"
    ],
    "unitKeys": [
      "029812c1ca14a24be5ea431d2e95b3d42cd1a384d40dcfb8f7afbf31263f4b64"
    ]
  },
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": {
    "deviceIds": [
      "ecdbb50d7c3d46eeb67fed4097cfeb431516d2682d9ce7927580d3193bf826dd",
      "cddc244f1a2e99704d0fd4147b4b47cbac61ffaa244cc36e108ddc2438af1471",
      "7a3551e1050dd8098348cfc7950b8a6e8fafa0e0d92d7cfa14c56a23c82bf123",
      "4f6b55ef015bbd63c179ebcf16ae1b1184526bff7b299d97f68ec13d23b5ca51"
    ],
    "unitKeys": [
      "ccddd63080d320772c8caeb9d37412d8c592f830f1640cf4a00965bcb38ab5fd"
    ]
  },
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": {
    "deviceIds": [
      "d8e62367588995cbef0fd240b3994dc8833d7282ac524b0b1a1cb141ff50be10"
    ],
    "unitKeys": [
      "695ff1aa52b305643a6cdeab94f6580fb8e1d495d0f0f89f58840ac3fa62cd55"
    ]
  },
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": {
    "deviceIds": [
      "411a21923d2c39c5d06d53083521c7073e5fefbb5c529b540a4ef52f366a372c"
    ],
    "unitKeys": [
      "2799bf469349747571ae49dadf35ccdafcb69d9b34c22d4dfc156448d63f2db0"
    ]
  },
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": {
    "deviceIds": [
      "fa4b6ed6f766dfe2e359de37306e108750e5f1b7f09b5ae7d6d2939df501b09d"
    ],
    "unitKeys": [
      "87613f2f295da96dd7efd218ca81f63c439132c8828d56cec472b6c19b0c2ea8"
    ]
  },
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": {
    "deviceIds": [
      "854ab1e44bad32c2e48f76b577fc37a030087ce85046aba6dcc7b3962e67f5fb"
    ],
    "unitKeys": [
      "978e5302d2a43275b0be449b0dbda1b16b42e9c6fedf9a19d6ff43f3e1859639"
    ]
  },
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": {
    "deviceIds": [
      "60a044ee3f2a1d90efea2decb98efffddc6a86d910b9f73aee901ec935a20cdf"
    ],
    "unitKeys": [
      "800bfd24e83a4d9caa9a4c2f40b6eaa7582be866cabee683e8458f4cf21167a6"
    ]
  },
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": {
    "deviceIds": [
      "3745c23569c1d09ecaffccdc5671c01d8d8c9a4666cd56865e833fb4bf697514"
    ],
    "unitKeys": [
      "c3dd3e3558d267c0f334deeb8e2ec05fc646888a8836cf9e7ba84889b8cf0db7"
    ]
  },
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": {
    "deviceIds": [
      "dfb67ed44f19d97d649c4c02a3f8df7b198470fe1d2ca9328e7ca6c02a4250d2"
    ],
    "unitKeys": [
      "270fe3940ef2f83e34418bcbffe2c36733a176d9183a135bc4dc8909f5394eb1"
    ]
  },
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": {
    "deviceIds": [
      "e269db8b514596c8032bda0af97006a43e1219282e98fab2a58060452184d39d"
    ],
    "unitKeys": [
      "b1c21bd4c20ecef17cf1687dd160ea6cabaaa142f6013317b4068c4c63f9421f"
    ]
  },
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": {
    "deviceIds": [
      "d06c901c85d259dff0aa7873b4acdff1d04b501f2a7c3218adee8965f824a48f"
    ],
    "unitKeys": [
      "78b67ee77b122c1695335be231e39e4e493bb66d7764936223848a36b59dbcdf"
    ]
  },
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": {
    "deviceIds": [
      "52125961fa907295f5890fc7bf402a8a772a81f107eecabb61edc9c03a6736e8"
    ],
    "unitKeys": [
      "1c69405eb00ac0ad15247aee2572b65a69660c96034b135f2c10e8b3c831abc2"
    ]
  },
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": {
    "deviceIds": [
      "967e3070bb04d83c24e2823109e18910d5527875971ae9e70877dbc830b87ca2"
    ],
    "unitKeys": [
      "02e28ed5ae9955793b713f822b7f819bee270a81e67e73d7218ba3ca5b3aefdb"
    ]
  },
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": {
    "deviceIds": [
      "9948cea84de2b1c5574959f968716fd5226732e2ba989dd47527b14f66d9c4ad"
    ],
    "unitKeys": [
      "7b36a85e35f47b0c2d58557a253550ff7d805d1d35bfb54d8e02a9e1a706a6d7"
    ]
  },
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": {
    "deviceIds": [
      "949c1d429e4fcaab4035d83c54c90ceb142c4201f90af88a24844741b058a939"
    ],
    "unitKeys": [
      "b0b71ab820475112a0bd0928982b69706800c08bbb78332dc84a84ffad52a47a"
    ]
  },
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": {
    "deviceIds": [
      "851139cf8ce200cc166245a50e6502acac69a7c73c77c3e8ab229185e2af74af",
      "f17802b963e9a08b8c892b5d45a5bb5274cf9eed27e2512b15282bf8e011e7ee",
      "38302e2b1a869c4030abfffd8bc94054af6835c2bfc6033f94b573696d1c38ea",
      "d1b5229bcfe904b29428a317622d233e413e2d46e6e6732009abb52291db551b"
    ],
    "unitKeys": [
      "057eb3019af64388a6ac5376cbf19c3f67a09ee4188f5024ec8db11d7684b217"
    ]
  },
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": {
    "deviceIds": [
      "b87b21fc80368e2509d591db8cdabbd70d7854d425645327712ce462ec06f5c0"
    ],
    "unitKeys": [
      "e56ffe9b8f612287f76bed52bbb716acefe7e8445d2017bc1f44a805dc9b8a85"
    ]
  },
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": {
    "deviceIds": [
      "9100508c0bbd0c5fd1a8046810a7026cc4693d195535d92795bc838197cf21ac"
    ],
    "unitKeys": [
      "3a35129e37138048d906656c996e08b07ab78905eb2b99b1b83652db1afe2f67"
    ]
  },
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": {
    "deviceIds": [
      "02a09b70dcf54e860edea43adfd34cdf95d0cafc363823bcba1979e1b4320274"
    ],
    "unitKeys": [
      "8b9d04d1f19509088e4e4f3042f6a2214842efe7441019e07447bf76bb0f9f97"
    ]
  },
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": {
    "deviceIds": [
      "545607b6686a5c22a0e0c12c51718d2cd39944895bea3a6539fccd43d14a3122"
    ],
    "unitKeys": [
      "da684290b672f4af3e936ba6e46596345c50bd7481e0da006e0a97b9d4b47dc6"
    ]
  },
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": {
    "deviceIds": [
      "e117af901b93954327fa69a696e5c340c471c6911e2d18d5ea4991ffac30db0e",
      "26d3b4a57e3ef94933921608597da302c065f68e4bfdc84ada75c8aa143d8e8d",
      "144c263b131f0965030ca081b6030f944709dd19101a9dec7f2104ff3ceff9b7",
      "ad9d1fde5a8a561064da67ffee31cfdc7d48fdd55a2194aad8da7407d44b8f71"
    ],
    "unitKeys": [
      "ba3a7ded55899f92de00fbc3d2e203b06dada282d2a2aed35142e9f5a8d5a8b2"
    ]
  },
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": {
    "deviceIds": [
      "5711a37a04be887e522f5986caf0e61ac661a33c992452f6556d1195c0c26c92"
    ],
    "unitKeys": [
      "b40017d4ee8094bfa7667dfcada0139a9d1eb31aafde8f8798563a1c45cdb83a"
    ]
  },
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": {
    "deviceIds": [
      "68b231a9a3837f7d0693015a8bd9e7bd0e84a156d2ab571b91cac80fcb9d5ea8"
    ],
    "unitKeys": [
      "d0b8bfa1fccd090f14067c197e833d3de181d0f7d4092b2946fa8b7940e0acb1"
    ]
  },
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": {
    "deviceIds": [
      "b92183599540ca8daa8ebe7abbb23eea5d15eca75a5d313068867c2679b347c2"
    ],
    "unitKeys": [
      "d508b208d9be428c2d244532e6760c01c66f005710523dbdf55e19383bb77933"
    ]
  },
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": {
    "deviceIds": [
      "769c098db74b2c6f23887d7b6f9e4f091f917982e4f8eef64dfa852b7bebd20d",
      "2677ffcd354f842655b14646b30a8034aae7e166d72613b31d50781aed393913",
      "8ff41918074be8bdfa061ad3e6dc741c8e27a80183745ceb7b71604d8c76bc61",
      "2524e6fe4400ea5053f3ab528dee567e78009d4ba94b5ffdd03b1eb384e282e6"
    ],
    "unitKeys": [
      "41e2d017c3127a587a14635eee26c84242759282976a6e732f60d9dbe1bb1541"
    ]
  },
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": {
    "deviceIds": [
      "e2466f41d4534dcd5ad92f7de44d3bd30746c39c68e723978000c68108f3a87e"
    ],
    "unitKeys": [
      "45cd584e3767c49abfa2b0a23f521e5dff4f191d7930745f6618dd1b5177b436"
    ]
  },
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": {
    "deviceIds": [
      "663d8fede5c0a4bc93780a049b95153f1c44de095c325b4d1396b10467f94b8f",
      "e7a00d951123f7c8799395900063633973714fefe93ff54e3072f2cc785b9bcc",
      "9e331e820953729f8f4dccc48bd98aee74d7a9d91154070fce3dae27a56afa4c",
      "f6bfa0c8575fc85ff86914168dceaa634b22cc4bea4fd4b6e3d811fbf93fec67"
    ],
    "unitKeys": [
      "80b2b93b9f1fd57001521133c9400047fe97b6dd143d49d215ab55621fbe5737"
    ]
  },
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": {
    "deviceIds": [
      "9e5b1fcaa10ef210f5db5a1ddac61310218febddeb5b70348446a75d8af41a62"
    ],
    "unitKeys": [
      "68db47dcb1de0de46585bb7a0f0c0ac014bfe8f9f6b4fb1cf6313dc7c0e782ad"
    ]
  },
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": {
    "deviceIds": [
      "7db3c5dabc7ee60eddfbb2a66c8750c6df42d744daf74995339c807b652751e2"
    ],
    "unitKeys": [
      "057e2279e0bf4c308b653a06a73755bf02b9c3493c9119c9cc042daac9f83d9e"
    ]
  },
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": {
    "deviceIds": [
      "71ec96e3162d6992969ee812f0534391abbe85e9ba3faa6e69eca4fd9f03a76b"
    ],
    "unitKeys": [
      "d43a33243c4fab95c6c7ce1c4a18994ce501be228ec17923b93567191eeae0d5"
    ]
  },
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": {
    "deviceIds": [
      "0b0b2bb610c3eb0d2cea0ebc2310c601f847e9251416d465bfa42c1e6711ab12"
    ],
    "unitKeys": [
      "5f1b24cff106c64e260961f10ed3908e750bf3a5578e61a87f4eb2fd69c0bb79"
    ]
  },
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": {
    "deviceIds": [
      "1f13893210ea5e152e1453be8ea452d18e6d027187914600dd7be7ceb096d010"
    ],
    "unitKeys": [
      "519aa275c9e5f5c4f1bc6965e7947a9e2b54f19179c90bae2f43fdf8ceceffac"
    ]
  },
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": {
    "deviceIds": [
      "133257791b627eada6ef982a859665ee7ed4df0960bf067cdd29687168e9df9f"
    ],
    "unitKeys": [
      "730a5118e105dd69f8eb2688bc78ea025d6ba61b6737b7cebe14042be69351f3"
    ]
  },
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": {
    "deviceIds": [
      "f334a075658da1c5d7b9d22e3b9cd796a2cde0ab5fb03100cc289220fc771834"
    ],
    "unitKeys": [
      "b72a826a38092fbe9800667d4fcedc960c9cd5eb84d37fb138b4249326aa7f51"
    ]
  },
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": {
    "deviceIds": [
      "97f8c5a6c048d812e42a3c5fc2df03b6d60d6b16c19415874253f2136b54a4ae"
    ],
    "unitKeys": [
      "3b746988139e6f7d5fcc3a351d5e5ea6755001b93957ced8de8cf28d6d1c5bfe"
    ]
  },
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": {
    "deviceIds": [
      "27aacf6ad4bd87e5ef4a594af328421f8a6305aeaddcb180c91fbaa0d907773a"
    ],
    "unitKeys": [
      "51162a830e0ff17e5045c58ef748412ae80f23fd81131eaee250e7463f3e67e3"
    ]
  },
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": {
    "deviceIds": [
      "9571bc29fa8f4cc1b15d461877415f193729b147728a4d59be32e5dd127fec06"
    ],
    "unitKeys": [
      "8c7bb3623f7974ae5b5f2ba2ae7f645fe84ac7481a9865eb6675f1a2c1ab27a2"
    ]
  },
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": {
    "deviceIds": [
      "18f472d1919d696637c1ddd6460aa5e8925d7c81cfdfca0a400882b967557c56"
    ],
    "unitKeys": [
      "9b9b25a106e3a8d8f380471e12089bc52a2adee9da05fe051899199095071a98"
    ]
  },
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": {
    "deviceIds": [
      "db1564899c4eb33490d9d555f02c5c34d20a96f10c25b147d6a5eefff9ef30af"
    ],
    "unitKeys": [
      "f86a604e7c1f14a93eea27da9e0e237a6ba1d6e31512397c5071c27bc324b261"
    ]
  },
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": {
    "deviceIds": [
      "30ccdc5b03a26c40f1343a58ca79205df6b2d6ee0d406a5416f4a9bd302562a4"
    ],
    "unitKeys": [
      "d2cb0388265300a85f9665aaeddc2bc3f536e94d2430bc183e055c1e78ef38bd"
    ]
  },
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": {
    "deviceIds": [
      "c181e4acd31100669ef82b86079a0c43a6e73216ac555f11d5da0cc8bc8b18fe"
    ],
    "unitKeys": [
      "3c8c91046d79090a6bc28595b6e5429e8fbddf29c768bca0d2f8707bc1598507"
    ]
  },
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": {
    "deviceIds": [
      "25e4b184c4d44854db6c5cf39ed27884bd2c821b1a7273b1a5b946fb26090804",
      "0843a9a2a1217bc89ba440f797e544ebc11018d874ec0894e3b8cf10b80d9f54",
      "86b2cd68f9f9827194b73a08a5c57c9e7e13a918c4ae5ecf9d0a59c7e41233f2",
      "ee851aae99a7ce00e3e26f5ff55b398e2e9ba7484d93c7841007351d06b4623e"
    ],
    "unitKeys": [
      "d31754a91de0a2395386e568110a82541b5e62d0bf78c2b9594f748d8175b995"
    ]
  },
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": {
    "deviceIds": [
      "2ec4b5b5dfecc5737b5ae96eaeb3e2e58f8199ebea3df753974d3e7aaca61ad3",
      "8e5a4ef5bb984d36cceddb73dfca0fd190609ff62cb9ee3709805bc0b1e86545",
      "4ef7d97d2babe9b66583f2eae307821d2115f43c8647bcec22a510a012415a8d",
      "3870233c4638ec4aa5a1e6538fc42dced7747c9adf80de5307551c4df6822395"
    ],
    "unitKeys": [
      "c7b77f64429a74df32be495749da8c6a3cda9aea17d105785af3e2f5af3b0ed3"
    ]
  },
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": {
    "deviceIds": [
      "b7384a1097c8f9e6d5a0a934dcaedcd36801942a7d3e004c1fd325da2485703d"
    ],
    "unitKeys": [
      "a908d452f8862119b912ad3acea739f19f28a7be3dc156ee34e2b9ea022b5b52"
    ]
  },
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": {
    "deviceIds": [
      "243975837bab773aae6c0f9e97a1761aa58df4a2297c15b8038f20786d3aa1f0"
    ],
    "unitKeys": [
      "eead47260a17c1a74d31300db869d34b68c745b2aee180a4a95854e6547e8969"
    ]
  },
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": {
    "deviceIds": [
      "f89947f4b8c55055e5a0dbafdf91bf47271eee1fcd0c6d9b330ad66bd09f7348"
    ],
    "unitKeys": [
      "324af4cac4e8cc5134d8054cf8844df222bc70031674c59a5c06896c7323549e"
    ]
  },
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": {
    "deviceIds": [
      "cc80cf5c50e4f58afa3a34426e6ab2892688ee67404bf5c4648f4401f653f488"
    ],
    "unitKeys": [
      "bb48ad2e49241a2dfed735d7885dd76b09a829ae6ab4d0cc1f276a89326e2868"
    ]
  },
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": {
    "deviceIds": [
      "fa2b9d2805a9ca2b2c712ac9120619aa102bce215455dfc64ae8696be749bfdf",
      "e1c803241fff73243cf6fde3ede3f8987ac92f1311c79dc27c935ffdd7ab4f46",
      "11559481f0a6625f23350ec07651bc78652bfbd6112978a6e326b36722158614",
      "fb78f7adfc8bc42259697edcda70b71d19f349027ab4d1f1292e7a6f60891979"
    ],
    "unitKeys": [
      "f96744e42044ad54ba9833acfe7b6822a983de5bbb264ced202e46000bf96a7b"
    ]
  },
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": {
    "deviceIds": [
      "f5866e10e59982d31e61d0dbd46e455d32264cf75d2f71005308391afe73f99b"
    ],
    "unitKeys": [
      "34c3925f1c1f796c1212946151d01c69d8212c3cae675b55edc13343d121f4f7"
    ]
  },
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": {
    "deviceIds": [
      "8f416cabecb90f5e2d8de9e502dd3cfcdb634fa7ce1dbfeaebcebd54428c7459",
      "5e78181a273b1c5f1c617a4a9df5cf9023d57a0f13de1617956a29343d492472",
      "e307ac23bd53b981621a11fb2ee9ced89ad551bfbabb798003b8bc55759d89c6",
      "e39547ab2765acd6cd5d20d0f2376ac8dc0ca5e5fb9d04ceec20077866beb488"
    ],
    "unitKeys": [
      "8564fa21999e93b6f675a8ff182d4f70ada990eebdb688f8064aa38b741e6d89"
    ]
  },
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": {
    "deviceIds": [
      "f508623abf2451d8ac32b0cb53513a6a0fe9a6b886603cd06d8e29b216a2dd94"
    ],
    "unitKeys": [
      "f3a9658f6c9ecc5cb161015c0a61fd0488869437c1035743a4b21cda05db68f0"
    ]
  },
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": {
    "deviceIds": [
      "7f061dfb3a5fc99313a690e7af37f2e4e3a0d666c82404fa2b9aef82d5cb6a05"
    ],
    "unitKeys": [
      "b850d6bf0f6f77ba0e4a083f599f880b8aac6299b2f50b5fc0365d98c07bd347"
    ]
  },
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": {
    "deviceIds": [
      "4d878129c95827be209ee7a834656ada5aa09294b4edfce5af56e80a175e3b31"
    ],
    "unitKeys": [
      "f60294f9c22f3a85444df8d247bed2ea11d55afe54b54e663d3f8762685c0780"
    ]
  },
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": {
    "deviceIds": [
      "73ccc4db07140df2b560a5275433e73835906d2efa7a81159bd5a8a7e7ad8557",
      "3edc0f54c06f1f645b467586d62d3fe7a697c348068c72027c2b71b52fca3858",
      "8c7f5bc4248083fcf9a5f30388b5687f67b5b47b7875fa2a7d589c5f1c56976c",
      "99189cb4deac74063fdce09e0a7564e222239d1ad9b7748dbe4c84ecc5a25ce9"
    ],
    "unitKeys": [
      "f2a8a5797aef7c756007f920be1a981751d12d494a8c5fea841edfac4436df7d"
    ]
  },
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": {
    "deviceIds": [
      "239c17672f308fe61391965a86268bd436cb525caec68f316d4c9c09e291c970"
    ],
    "unitKeys": [
      "b0b6bafb6ffef36f95fdcf40cae3916d548d1af8e663a12009fa8f04190f002d"
    ]
  },
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": {
    "deviceIds": [
      "90a9543b234fdd747253602baebe7f939ecd5ddf75801afc0c13c954d8c2ff78",
      "f0b71e6c142353fffa5bfbeb7e43f2c992eab3a6269682f0b697ede2de729bb2",
      "f3637d99bc0af03946eb504f919a16d1921b90aa756d61bdbd3d776e87a88848",
      "6857b2b09b03bbf2836fd0a2237cc6377c1392e1e9651b8ed149569b1ade7fb1"
    ],
    "unitKeys": [
      "bb4655f03cb8ab05c0a02493e10148dd3b6f1215b264160491078465e5786463"
    ]
  },
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": {
    "deviceIds": [
      "7442f5cb4c2ed1c50ea353fcb471c79e17acc9c016ffa9b3a63ebabe7f6e6d67",
      "a038958d0c7a2fbcaa8d46bc319c939b834306dc5dd7b0f85f4e2dea7dcc06dd",
      "b402f36f5502110a00a71bfbaa49f462a9e4ec8a374b703dc7676e33599981bc",
      "2c0c439f85bd6c43aced68463661ccfe6a5b93493bf6b2003e594144f2fd9e33"
    ],
    "unitKeys": [
      "e04cd4d8920c17a87184d2b212b5875112affda1c3ee0675edb35b3204dea1f7"
    ]
  },
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": {
    "deviceIds": [
      "61abebaa85ac33ea77121f6807dff35f95ef1890498d201ca5c74e2e4e832df9"
    ],
    "unitKeys": [
      "7f13c7accc26a8869e56131e2b3a1fc336f75dc8327c13e58ec600bbc1f96716"
    ]
  },
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": {
    "deviceIds": [
      "4514f445364b1e3a64584c9ad990b21d3c1ee65a0ee66e4ec8f32418499fa851"
    ],
    "unitKeys": [
      "2d752b04aa5b70183cdd5f0eaa08192e45d49b11842cb05327d9c5d1a50e9846"
    ]
  },
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": {
    "deviceIds": [
      "2cbfbc8380f2af02c8f31ee709aad52775d2d44e6a4826adeddb8ac713a7b87c"
    ],
    "unitKeys": [
      "77336e11b6b72c7fa8f1589b957282386fc9c46f46a60acc366ea45b2e0bbd6d"
    ]
  },
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": {
    "deviceIds": [
      "cbccf698b0038b4d8634a9de743752fe17540eada1c3c75c3f4eaee8a78762d4"
    ],
    "unitKeys": [
      "81c1e6bacf91ff968f70c2ea6241ec0304e80da04ac2a07a84b8cbb2478906bc"
    ]
  },
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": {
    "deviceIds": [
      "acc1937c37227f704736e96adb2070804943e5a245390997e26ab9dbede13502"
    ],
    "unitKeys": [
      "e0b4c948c0396000fce4701b88a26ed13185d3b8af2e3a64cf73b8db7695a9e0"
    ]
  },
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": {
    "deviceIds": [
      "e20401c280d1d4c8dd23d70bbaf0c91d7f520ca3aa4c572efae94a4b7e73cb97"
    ],
    "unitKeys": [
      "ea0d97a3576af4ea79b5ed47283df93208a96b64e210a22d0abf5c9f19b1628b"
    ]
  },
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": {
    "deviceIds": [
      "7617cbe324442e5688429597dda8cd4c9ef8dbfdfa39f5983966dc2af0bb4810"
    ],
    "unitKeys": [
      "8482bf5e7ca5fcba169cdeb9af0848d3123c3a80d11d4a51b4dd9b89f2d96233"
    ]
  },
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": {
    "deviceIds": [
      "d794cbdeea8b519a4efaf43d4b4454f559aaf20f8b78c4fbd4577ca868001fed"
    ],
    "unitKeys": [
      "d01bddadc28478f5c2016f1a7e64884d36254bb99a22c16342ba7655a7fd92bf"
    ]
  },
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": {
    "deviceIds": [
      "3c27d672ea9e209b56ed6f39527e078878a6314907b45cf336d90006583f755c",
      "507f470bbfb8c4534cd1b4c9b377f256c6e8408b2768f601e50b5f37a1e8b1d2",
      "d405842295dcaa2702b85760e07a50dac4f7c02d0fee310fbebc596adcf06e15",
      "993cc3d0c035e3cdcef57e647919b57fd0ce2afbc3d9fdafc2bfca16bdf344d8"
    ],
    "unitKeys": [
      "992fd1fb72ea4524da9ccb1e9beac4509921f94420d7e6f439c1bbf79b5a43b9"
    ]
  },
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": {
    "deviceIds": [
      "05f2a4da11beb62fcf1a6e2515a397d91e9bb656613ca9194fb78ea9ecf98483"
    ],
    "unitKeys": [
      "dcb0e803e5b1057825f586ecd99b15c7a48b6363039a8c1527632171b532e213"
    ]
  },
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": {
    "deviceIds": [
      "6e43364728b6082f87140cbc12efd5339a5b172eafcd5e714369fd2bb55527c9"
    ],
    "unitKeys": [
      "73ef3d9bccc40f69a3ac2f6f9f3679642d2da9280e905f6d16c44df4fe833cfb"
    ]
  }
});
var REVIEWED_OWNER_RESOURCES2 = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": {
    "deviceIds": [
      "209cd92d69e5e61b5e25a037465715c7e424057286b073d3b1fcbcfbaf365305",
      "93d84717867c2e34178c78cb6632230d5ee8998afc774b4348a3dce662be2bdd",
      "5aefc4c442c59773331ad1042f63e0a9955afe71ae160daad16492783e92176b",
      "6a3bec5da662da31d7978826155e060ce59d62ba12fa75847da7661289b23e39"
    ],
    "unitKeys": [
      "3519b266ac74a658643efaaef31acb6e038c9bb1c29c1a2e0331b3b65bd49289"
    ]
  }
});
var REVIEWED_OWNER_PHYSICAL_IDENTITIES2 = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": "1d04c1b83dbec9d47b2a4b9718036d48c2a2627a4869fab5f98a71a49e23fb14"
});
var EQUIPMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
var CAMERA_FRESH_MS3 = 20 * 60 * 1e3;
var CAMERA_FRESH_MS22 = 20 * 60 * 1e3;
var SOURCE_FRESH_MS = 30 * 60 * 1e3;
var PROFILES = Object.freeze({ "Spotter": "spotter", "Solar Spotter": "solar_spotter", "Ranger": "ranger" });
var UNIT_TRACKER_CONNECTOR = Object.freeze({ enabled: false, state: "awaiting_sheets_connection" });
var TRACKER_TABS = Object.freeze([
  { id: 568394918, title: "SOLAR SPOTTERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 2017346590, title: "SPOTTERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 426115083, title: "HELIOS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 386511683, title: "RANGERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 826256700, title: "SNIPERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 651684134, title: "CAM V & RSU", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 451969219, title: "RECONS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 135363149, title: "RECON II", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 1975227208, title: "SOLAR STANDS 72", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  // Its second column is an installation date, not placement. Never infer it.
  { id: 828079282, title: "SOLAR POLES & SKIDS", columns: 1, headers: ["Unit"] }
]);
var SCOPED_READ_WINDOW_MS = 6500;
var PRODUCT_RESPONSE_CUTOFF_MS = 3e4 - SCOPED_READ_WINDOW_MS;
var IT_DAILY_WORKSPACES2 = Object.freeze(["Fleet Dashboard", "Camera Health"]);

// tech-checks/docs/deployed-camera-health-sweep-v59/source/_shared/trackerEndpointRuntime.ts
function scheduledTrackerEndpointRuntime(db, runtime, signal, deadline) {
  if (!runtime) return void 0;
  const rpc = async (name, args, s) => {
    if (s.aborted) throw Error("Cancelled");
    const result = await db.rpc(name, args).abortSignal(s);
    if (result.error || s.aborted) throw Error("Endpoint evidence RPC unavailable");
    return result.data;
  };
  return createScheduledTrackerEndpointIntegration({ rpc, ...runtime, signal, deadline });
}
function scheduledEndpointFromExistingCron(db, request, deadline, blocked = null) {
  const rpc = async (name, args, signal) => {
    const r = await db.rpc(name, args).abortSignal(signal);
    if (r.error || signal.aborted) {
      const e = Error("Endpoint RPC unavailable");
      e.code = "rpc_" + name + "_" + (/^[A-Z0-9]{5}$/.test(r.error?.code) ? r.error.code : "XXXXX");
      throw e;
    }
    return r.data;
  };
  const nativeRead = scheduledNativeSourceReader({ cronSecret: request.headers.get("x-camera-cron-secret") });
  let nativeSnapshot = null, nativeFlight = null, nativeRefusal = null, nativeFailures = 0, nativeFailure = null;
  const readNative = async (s) => {
    // A refusal is authoritative for the rest of this invocation. Neither a
    // cached snapshot nor a read already in flight may answer after it, and
    // the source is not asked again.
    if (nativeRefusal) throw nativeRefusal;
    const age = nativeSnapshot ? Date.now() - nativeSnapshot.observedAt : Infinity;
    if (nativeSnapshot && age >= 0 && age <= 20e3) return nativeSnapshot;
    if (nativeFlight) return nativeFlight;
    // After two consecutive temporary failures the source is not asked again
    // in this invocation. The saved snapshot may still answer inside its
    // unchanged 26-second window; after that the failure is reported.
    if (nativeFailures >= 2) {
      const heldAge = nativeSnapshot ? Date.now() - nativeSnapshot.observedAt : Infinity;
      if (!s.aborted && nativeSnapshot && heldAge >= 0 && heldAge <= 26e3) return nativeSnapshot;
      throw nativeFailure;
    }
    nativeFlight = nativeRead(s).then((value) => {
      if (nativeRefusal) throw nativeRefusal;
      nativeFailures = 0;
      nativeSnapshot = value;
      return value;
    }).catch((error) => {
      if (/^native_source_refused_/.test(error?.code || "")) {
        nativeRefusal = nativeRefusal || error;
        nativeSnapshot = null;
      }
      if (nativeRefusal) throw nativeRefusal;
      nativeFailures++;
      nativeFailure = error;
      const fallbackAge = nativeSnapshot ? Date.now() - nativeSnapshot.observedAt : Infinity;
      if (!s.aborted && nativeSnapshot && fallbackAge >= 0 && fallbackAge <= 26e3) return nativeSnapshot;
      throw error;
    }).finally(() => { nativeFlight = null; });
    return nativeFlight;
  };
  return createScheduledSourceBinding({ rpc, readNative, signal: request.signal, deadline, ioTimeoutMs: 30000, blocked });
}

// <stdin>
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
var json = (x, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "Content-Type": "application/json" } });
function publicHost(value) {
  if (typeof value !== "string") return null;
  const host = value.replace(/\/32$/, ""), p = host.split(".");
  if (p.length !== 4 || p.some((x) => !/^(?:0|[1-9]\d{0,2})$/.test(x) || Number(x) > 255)) return null;
  const [a, b, c] = p.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return null;
  return host;
}
async function tcp(host, port, timeout = 2200) {
  if (!publicHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return { online: false, latency_ms: null, error: "Unsupported public endpoint" };
  const t = Date.now(), controller = new AbortController();
  let c, timer;
  try {
    const connection = Deno.connect({ hostname: host, port, signal: controller.signal }).then((conn) => {
      if (controller.signal.aborted) {
        conn.close();
        throw new Error("timeout");
      }
      return conn;
    });
    c = await Promise.race([connection, new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, timeout);
    })]);
    return { online: true, latency_ms: Date.now() - t };
  } catch (e) {
    return { online: false, latency_ms: null, error: controller.signal.aborted ? "timeout" : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
    try {
      c?.close();
    } catch {
    }
  }
}
function createCameraHealthSweep({ endpointRuntime, endpointSourceEnabled = false, completedSnapshotEnabled = false, star4LiveTcpEnabled = false } = {}) {
  return async (req) => {
    const requestStarted = Date.now();
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any([
        ...init.signal ? [init.signal] : [],
        AbortSignal.timeout(Math.max(1, Math.min(3e4, requestStarted + 14e4 - Date.now())))
      ]) }) }
    });
    const { data: valid } = await db.rpc("verify_camera_health_cron_secret", { candidate: req.headers.get("x-camera-cron-secret") });
    if (valid !== true) return json({ error: "Forbidden" }, 403);
    let endpointDiagnostic = null;
    const runExistingSweep = async () => {
      const body = await req.json().catch(() => ({}));
      const requestedWorkers = Number(body.batch_size);
      const n = Number.isFinite(requestedWorkers) && requestedWorkers > 0 ? Math.min(Math.max(Math.floor(requestedWorkers), 1), 24) : 25;
      const isShardCall = Number.isInteger(body.shard_count) && body.shard_count >= 2 && body.shard_count <= 32 && Number.isInteger(body.shard_index) && body.shard_index >= 0 && body.shard_index < body.shard_count;
      if (!isShardCall && body.fanout !== false) {
        // prepare() resolves false on failure; it does not throw. When it
        // fails the shards still run, because router, provider and Star4Live
        // monitoring do not depend on it, but they are told not to read the
        // endpoint authority again in this cycle. The next scheduled cycle
        // starts clean and asks once.
        let endpointAuthorityDirective = null;
        // A shard reports a refusal it met itself. Shards that start or are
        // retried after that are told not to ask again.
        const noteShardAuthority = (result) => {
          if (result?.endpoint_authority === "refused") endpointAuthorityDirective = "refused";
        };
        if (endpointSourceEnabled) {
          const sharedAuthority = scheduledEndpointFromExistingCron(db, req, requestStarted + 95e3);
          let prepared = false;
          try {
            prepared = await sharedAuthority.prepare() === true;
          } catch {
            prepared = false;
          }
          if (!prepared) {
            endpointAuthorityDirective = sharedAuthority.diagnostics().blocked === "refused" ? "refused" : "unavailable";
            endpointDiagnostic = sharedAuthority.diagnostics();
          }
        }
        const shardCount = 4;
        const secret = req.headers.get("x-camera-cron-secret");
        if (!secret || secret.length > 1024 || /\\s/.test(secret)) return json({ error: "Existing cron authorization required" }, 403);
        const runShard = async (index) => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await fetch("https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-health-sweep", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-camera-cron-secret": secret },
                body: JSON.stringify({ batch_size: 24, shard_index: index, shard_count: shardCount, ...endpointAuthorityDirective ? { endpoint_authority: endpointAuthorityDirective } : {} }),
                redirect: "error",
                cache: "no-store",
                signal: req.signal
              });
              const result = await response.json().catch(() => ({}));
              noteShardAuthority(result);
              if (response.ok && result.shard?.index === index && result.shard?.count === shardCount) return { index, ok: true, result };
              if (attempt === 0 && [502, 503, 546].includes(response.status)) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                continue;
              }
              return { index, ok: false, status: response.status, error: result.error || "shard_failed", result };
            } catch (error) {
              if (attempt === 0 && !req.signal.aborted) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                continue;
              }
              return { index, ok: false, status: 0, error: error?.name || "shard_transport_failed" };
            }
          }
          return { index, ok: false, status: 0, error: "shard_retry_exhausted" };
        };
        const shards = [];
        for (let firstIndex = 0; firstIndex < shardCount; firstIndex += 2) {
          const wave = await Promise.all(Array.from({ length: Math.min(2, shardCount - firstIndex) }, (_, n) => runShard(firstIndex + n)));
          shards.push(...wave);
        }
        const ok = shards.filter((s) => s.ok), direct = ok.map((s) => s.result.coverage).filter(Boolean), providers = ok.map((s) => s.result.provider_coverage).filter(Boolean), routers = direct.map((c) => c.router_coverage).filter(Boolean);
        const sum = (rows, key) => rows.reduce((n, row) => n + (Number.isFinite(row?.[key]) ? row[key] : 0), 0);
        const providerEligible = providers.length ? Math.max(...providers.map((c) => c.eligible ?? 0)) : 0;
        const providerScanned = sum(providers, "scanned"), providerPublished = sum(providers, "published"), providerUnverified = sum(providers, "unverified");
        const directCoverage = {
          source: "owned_saved_service_ports",
          complete: ok.length === shardCount && direct.length === shardCount && direct.every((c) => c.deferred === 0 && c.unverified === 0),
          counts_known: direct.length === shardCount,
          eligible: sum(direct, "eligible"),
          held: direct.length ? Math.max(...direct.map((c) => c.held ?? 0)) : null,
          deferred: sum(direct, "deferred"),
          scanned: sum(direct, "scanned"),
          published: sum(direct, "published"),
          unverified: sum(direct, "unverified"),
          online: sum(direct, "online"),
          offline: sum(direct, "offline"),
          verifying: sum(direct, "verifying"),
          router_coverage: {
            counts_known: routers.length === shardCount && routers.every((c) => c.counts_known),
            total: routers.length ? Math.max(...routers.map((c) => c.total ?? 0)) : null,
            complete: routers.length === shardCount && routers.every((c) => c.complete),
            due: sum(routers, "due"),
            scanned: sum(routers, "scanned"),
            published: sum(routers, "published"),
            unverified: sum(routers, "unverified"),
            deferred: sum(routers, "deferred"),
            reconciled_at: new Date().toISOString()
          },
          reconciled_at: new Date().toISOString()
        };
        const providerCoverage = {
          source: "star4live_saved_tcp_ports",
          counts_known: providers.length === shardCount,
          eligible: providerEligible,
          held: providers.length ? Math.max(...providers.map((c) => c.held ?? 0)) : null,
          scanned: providerScanned,
          published: providerPublished,
          unverified: providerUnverified,
          deferred: sum(providers, "deferred"),
          complete: providers.length === shardCount && providerScanned === providerEligible && providerPublished === providerScanned && providerUnverified === 0 && sum(providers, "deferred") === 0
        };
        const aggregate = { ...directCoverage, provider_coverage: providerCoverage, shard_count: shardCount, successful_shards: ok.length, failed_shards: shards.filter((s) => !s.ok).map((s) => s.index) };
        let coverageRecorded = false;
        if (ok.length === shardCount) {
          try {
            const saved = await db.from("camera_integrations").update({
              last_sync_at: aggregate.reconciled_at,
              last_sync_status: aggregate.complete && providerCoverage.complete ? "ok" : "partial",
              last_error: aggregate.complete && providerCoverage.complete ? null : "Sharded sweep has held or unverified records",
              metadata: aggregate
            }).eq("provider", "avigilon").select("provider");
            coverageRecorded = !saved.error && saved.data?.length === 1;
          } catch {
          }
        }
        return json({ state: ok.length === shardCount ? "completed" : "partial", coverage: aggregate, provider_coverage: providerCoverage, coverage_recorded: coverageRecorded, shard_results: shards.map((s) => ({ index: s.index, ok: s.ok, status: s.status ?? 200, checked: s.result?.checked ?? null, eligible: s.result?.eligible ?? null, published: s.result?.coverage?.published ?? null, unverified: s.result?.coverage?.unverified ?? null })) });
      }
      const shardCount = isShardCall ? body.shard_count : 1;
      const shardIndex = isShardCall ? body.shard_index : 0;
      const endpointAuthorityBlocked = isShardCall && (body.endpoint_authority === "refused" || body.endpoint_authority === "unavailable") ? body.endpoint_authority : null;
      const endpointEvidence = endpointSourceEnabled ? scheduledEndpointFromExistingCron(db, req, requestStarted + (completedSnapshotEnabled ? 95e3 : 48e3), endpointAuthorityBlocked) : scheduledTrackerEndpointRuntime(db, endpointRuntime, req.signal, requestStarted + (completedSnapshotEnabled ? 95e3 : 48e3));
      if (endpointEvidence) await endpointEvidence.prepare();
      const star4liveRun = star4LiveTcpEnabled ? CosStar4LiveScheduledPing20261102.collectScheduledStar4Live(db, tcp, { startedAt: requestStarted, deadlineMs: 95e3, signal: req.signal, shardIndex, shardCount }).then(value => ({ value, error: null }), () => ({ value: null, error: "Star4Live saved TCP inventory unavailable" })) : Promise.resolve(null);
      const cameraRun = collectScheduledDirect(db, tcp, { startedAt: requestStarted, deadlineMs: completedSnapshotEnabled ? 95e3 : 48e3, endpointEvidence, shardIndex, shardCount }).then((value) => ({ value, error: null }), () => ({ value: null, error: "Direct inventory unavailable" }));
      const { data: routerMappings, error: routerQueryError } = await db.from("camera_unit_routers").select("id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,reported_status,reported_latency_ms,status_source,status_observed_at,current_status,last_checked_at,last_online_at,updated_at").or("router_public_ip.not.is.null,unit_ip.not.is.null");
      const routerReadError = routerQueryError || !Array.isArray(routerMappings) || routerMappings.length >= 1e3;
      const routerProbeIntervalMs = 5 * 60 * 1e3;
      const routerDueBefore = Date.now() - routerProbeIntervalMs;
      const dueRouters = [...routerReadError ? [] : routerMappings].filter((r) => !r.last_checked_at || !Number.isFinite(Date.parse(r.last_checked_at)) || Date.parse(r.last_checked_at) <= routerDueBefore).sort((a, b) => {
        const at = a.last_checked_at ? new Date(a.last_checked_at).getTime() : 0;
        const bt = b.last_checked_at ? new Date(b.last_checked_at).getTime() : 0;
        return at - bt;
      });
      const routers = shardCount > 1 ? dueRouters.filter((r, i) => i % shardCount === shardIndex) : dueRouters;
      const routerCheck = async (r) => {
        const host = String(r.router_public_ip || r.unit_ip || "").replace("/32", "");
        if (!publicHost(host)) return { id: r.id, unit: r.unit_key, status: "unknown", reason: "unsupported_public_endpoint" };
        const port = Number(r.web_port ?? 8080);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return { id: r.id, unit: r.unit_key, status: "unknown", reason: "unsupported_management_port" };
        const ports = [port];
        const probes = host ? Object.fromEntries(await Promise.all(ports.map(async (p) => [p, await tcp(host, p)]))) : {};
        if (Date.now() >= requestStarted + (completedSnapshotEnabled ? 95e3 : 48e3)) return { id: r.id, unit: r.unit_key, status: "unknown", reason: "router_deadline_reached" };
        const responding = Object.entries(probes).filter(([, v]) => v?.online);
        const directOnline = responding.length > 0;
        const status = directOnline ? "online" : "offline";
        const checked = (/* @__PURE__ */ new Date()).toISOString();
        const latencies = responding.map(([, v]) => v.latency_ms).filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
        const bestLatency = latencies.length ? Math.min(...latencies) : null;
        const previousStatus = String(r.current_status || "").toLowerCase();
        const statusChanged = previousStatus !== status;
        const previousLatency = r.reported_latency_ms == null ? null : Number(r.reported_latency_ms);
        const latencyChanged = directOnline && bestLatency !== null && (previousLatency == null || Math.abs(previousLatency - bestLatency) >= 250);
        const heartbeatDue = !r.last_checked_at || Date.now() - new Date(r.last_checked_at).getTime() >= routerProbeIntervalMs;
        if (statusChanged || latencyChanged || heartbeatDue) {
          const patch = { current_status: status, last_checked_at: checked, updated_at: checked };
          if (status === "online" && (statusChanged || !r.last_online_at)) patch.last_online_at = checked;
          if (latencyChanged) patch.reported_latency_ms = bestLatency;
          let routerSave = db.from("camera_unit_routers").update(patch).eq("id", r.id).eq("unit_key", r.unit_key).eq("updated_at", r.updated_at);
          for (const key of ["router_public_ip", "unit_ip", "web_port"]) {
            routerSave = r[key] == null ? routerSave.is(key, null) : routerSave.eq(key, r[key]);
          }
          const { data: savedRouter, error: routerError } = await routerSave.select("id");
          if (routerError) return { id: r.id, unit: r.unit_key, status: "unknown", reason: "router_publication_unverified" };
          if (!savedRouter?.length) return { id: r.id, unit: r.unit_key, status: "unknown", reason: "router_configuration_changed" };
        }
        return { id: r.id, unit: r.unit_key, name: r.router_name, model: r.router_model, status, direct_online: directOnline, reported_status: r.reported_status, ports: probes, latency_ms: bestLatency };
      };
      let routerCursor = 0;
      const routerRun = (async () => {
        const results2 = [];
        while (routerCursor < routers.length && Date.now() + 3200 < requestStarted + (completedSnapshotEnabled ? 95e3 : 48e3)) {
          const wave = routers.slice(routerCursor, routerCursor + n);
          routerCursor += wave.length;
          results2.push(...await Promise.all(wave.map(async (r) => {
            try {
              return await routerCheck(r);
            } catch {
              return { id: r.id, unit: r.unit_key, status: "unknown", reason: "router_observation_unverified" };
            }
          })));
        }
        return results2;
      })().then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
      const camera = await cameraRun;
      const star4live = await star4liveRun;
      if (star4live) { const value = star4live.value; const reasonCounts = {}, probeCauseCounts = {}; if (!star4live.error) for (const r of value.results) if (!r.published) { reasonCounts[r.reason || "unknown"] = (reasonCounts[r.reason || "unknown"] || 0) + 1; if (r.probeCause) probeCauseCounts[r.probeCause] = (probeCauseCounts[r.probeCause] || 0) + 1; } console.info("star4live_tcp_sweep", JSON.stringify(star4live.error ? { error: star4live.error } : { eligible: value.eligible, held: value.held, scanned: value.scanned, published: value.published, retryRecovered: value.retryRecovered, deferred: value.deferred, complete: value.complete, reasonCounts, probeCauseCounts })); }
      const routerOutcome = await routerRun;
      const routerResults = routerReadError || routerOutcome.error ? [{ status: "unknown", reason: "router_inventory_unavailable" }] : routerOutcome.value;
      const { results, eligible, held, deferred, deadlineReached } = camera.value || { results: [], eligible: null, held: [], deferred: null, deadlineReached: Date.now() >= requestStarted + (completedSnapshotEnabled ? 95e3 : 48e3) };
      const published = results.filter((r) => r.published).length, unverified = results.length - published;
      const reasons = [];
      if (camera.error) reasons.push("collector_unavailable");
      if (held.length) reasons.push("records_held");
      if (deferred || deadlineReached) reasons.push("deadline_reached");
      if (unverified) reasons.push("observations_unverified");
      const countReasons = (rows) => rows.reduce((counts, row) => {
        const key = row.reason || "unverified";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {});
      const heartbeat = (/* @__PURE__ */ new Date()).toISOString();
      const routerCoverage = {
        counts_known: !routerReadError && !routerOutcome.error,
        total: routerReadError ? null : routerMappings?.length ?? 0,
        complete: !routerReadError && !routerOutcome.error && routerCursor === routers.length && routerResults.every((r) => r.status !== "unknown"),
        due: routerReadError ? null : routers.length,
        scanned: routerReadError ? null : routerResults.length,
        published: routerReadError ? null : routerResults.filter((r) => r.status === "online" || r.status === "offline").length,
        unverified: routerReadError ? null : routerResults.filter((r) => r.status === "unknown").length,
        deferred: routerReadError ? null : routers.length - routerCursor,
        reconciled_at: heartbeat
      };
      const coverage = {
        source: "owned_saved_service_ports",
        complete: reasons.length === 0,
        reason: reasons[0] || null,
        reasons,
        counts_known: !camera.error,
        eligible,
        held: camera.error ? null : held.length,
        deferred,
        scanned: camera.error ? null : results.length,
        published: camera.error ? null : published,
        unverified: camera.error ? null : unverified,
        deadline_reached: deadlineReached,
        held_reasons: countReasons(held),
        unverified_reasons: countReasons(results.filter((r) => !r.published)),
        online: camera.error ? null : results.filter((r) => r.published && r.status === "online").length,
        offline: camera.error ? null : results.filter((r) => r.published && r.status === "offline").length,
        verifying: camera.error ? null : results.filter((r) => r.published && r.status === "verifying").length,
        reconciled_at: heartbeat,
        router_coverage: routerCoverage
      };
      let coverageRecorded = false;
      if (shardCount === 1 && Date.now() < requestStarted + 130e3) {
        try {
          const saved = await boundedRequest((signal) => db.from("camera_integrations").update({
            last_sync_at: heartbeat,
            last_sync_status: coverage.complete ? "ok" : "partial",
            last_error: coverage.complete ? null : "Direct service sweep coverage is incomplete: " + reasons.join(", "),
            metadata: coverage
          }).eq("provider", "avigilon").select("provider").abortSignal(signal), requestStarted + 135e3);
          coverageRecorded = !saved.error && saved.data?.length === 1;
        } catch {
        }
      }
      if (camera.error || shardCount === 1 && !coverageRecorded) return json({ error: camera.error || "Sweep coverage could not be recorded", coverage, coverage_recorded: coverageRecorded, routers_checked: routerResults.length, router_results: routerResults, endpoint_authority: endpointEvidence?.diagnostics?.()?.blocked || null }, 503);
      endpointDiagnostic = endpointEvidence?.diagnostics?.() || null;
      return json({
        endpoint_authority: endpointDiagnostic?.blocked || null,
        checked: results.length,
        eligible,
        held: held.length,
        deferred,
        deadline_reached: deadlineReached,
        evidence: "service_port_only",
        coverage,
        coverage_recorded: coverageRecorded,
        results,
        routers_checked: routerResults.length,
        router_results: routerResults,
        provider_coverage: star4live ? (star4live.error ? { eligible: null, scanned: null, published: null, held: null, deferred: null, unverified: null, complete: false, error: star4live.error } : { eligible: star4live.value.eligible, scanned: star4live.value.scanned, published: star4live.value.published, held: star4live.value.held, deferred: star4live.value.deferred, unverified: star4live.value.scanned - star4live.value.published, complete: star4live.value.complete }) : null,
        shard: shardCount > 1 ? { index: shardIndex, count: shardCount, partial: true } : null
      });
    };
    if (completedSnapshotEnabled) {
      try {
        const result = await runCompletedCameraCycle({ db, request: req, probe: tcp, collectExisting: runExistingSweep });
        return json({ ...result, endpointEvidence: endpointDiagnostic });
      } catch {
        return json({ error: "Shared cycle failed; previous completed result retained" }, 503);
      }
    }
    return runExistingSweep();
  };
}

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
    const now = options.now ?? Date.now, start = options.startedAt ?? now(), deadline = start + Math.min(95e3, options.deadlineMs ?? 95e3), workers = 24;
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
    const fullQueue = [...reserved, ...oldest.filter((c) => !ids.has(String(c.device.id)))], shardCount = Number.isInteger(options.shardCount) && options.shardCount >= 1 && options.shardCount <= 32 ? options.shardCount : 1, shardIndex = Number.isInteger(options.shardIndex) && options.shardIndex >= 0 && options.shardIndex < shardCount ? options.shardIndex : 0, queue = shardCount > 1 ? oldest.filter((c) => Number(c.device.id) % shardCount === shardIndex) : fullQueue, results = [], transport = /* @__PURE__ */ new Map();
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
            const atStart = now();
            let values = await Promise.all(ports.map(async (p) => [String(p), await call(() => probe(host, p, 2200))]));
            let retryRecovered = 0;
            for (let attempt = 0; attempt < 2; attempt++) {
              if (!values.some(([, v]) => !completed(v)) || options.signal?.aborted || now() + 3300 >= deadline) break;
              const retryPorts = values.filter(([, v]) => !completed(v)).map(([p]) => p);
              const retryValues = await Promise.all(retryPorts.map(async (p) => [p, await call(() => probe(host, Number(p), 2200))]));
              const retryMap = new Map(retryValues);
              values = values.map(([p, v]) => {
                const retry = retryMap.get(p);
                if (!completed(v) && completed(retry)) retryRecovered++;
                return [p, completed(v) ? v : retry ?? v];
              });
            }
            const at = now();
            if (options.signal?.aborted || at < atStart || at - atStart > 8500 || values.some(([, v]) => !completed(v))) return { failure: options.signal?.aborted ? "aborted" : at - atStart > 8500 ? "slow" : "invalid_probe_result" };
            return { ports: Object.fromEntries(values), at, retryRecovered };
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
        const hold = (reason, probeCause) => results.push({ id: c.device.id, published: false, reason, ...(probeCause ? { probeCause } : {}) });
        if (!observed || observed.failure) return hold("probe_incomplete", observed?.failure || "missing_observation");
        if (!fresh || fresh.fingerprint !== c.config.fingerprint) return hold("configuration_changed");
        if (options.signal?.aborted || now() >= deadline || now() - observed.at > 6e4) return hold("observation_expired");
        const reachable = Object.values(observed.ports).some((p) => p.online), checked = new Date(observed.at).toISOString();
        const patch = { camera_device_id: c.device.id, port_status: observed.ports, checked_at: checked, overall_status: reachable ? "online" : "offline", ip_reachable: reachable, consecutive_failures: reachable ? 0 : 1, confirmed_outage: false, confirmation_reason: null };
        try {
          const saved = await call((s) => db.rpc("publish_camera_connection_v1", { p_device_id: c.device.id, p_revision: c.device.connection_revision, p_public_ip: c.device.public_ip, p_expected_ports: c.device.expected_ports, p_monitoring_profile: c.device.monitoring_profile ?? null, p_health: patch, p_source: "automatic_tcp_sweep" }).abortSignal(s));
          if (saved.error || saved.data?.ok !== true) return hold(saved.data?.reason || "publication_unconfirmed");
          results.push({ id: c.device.id, published: true, status: reachable ? "online" : "offline", checkedAt: checked, retryRecovered: observed.retryRecovered || 0 });
        } catch {
          return hold("publication_unconfirmed");
        }
      }));
    }
    return { source: "star4live_saved_tcp_ports", eligible: candidates.length, held, scanned: results.length, published: results.filter((r) => r.published).length, retryRecovered: results.reduce((n, r) => n + (r.retryRecovered || 0), 0), deferred: queue.length - cursor, complete: !options.signal?.aborted && held === 0 && cursor === queue.length && results.every((r) => r.published), results };
  }
  return __toCommonJS(scheduledStar4LiveService_exports);
})();

// COS_STAR4LIVE_SCHEDULED_PING_20261102 END
Deno.serve(createCameraHealthSweep({ endpointSourceEnabled: true, completedSnapshotEnabled: false, star4LiveTcpEnabled: true }));
export {
  createCameraHealthSweep
};
