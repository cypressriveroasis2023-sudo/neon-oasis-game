// cos-unit-camera-status - built bundle, do not edit.
// Source: tech-checks/supabase/functions/cos-unit-camera-status/serve.ts
// Commit: 91d65bb5ef3c9537ab3b1628c3988782b2d83ff7
// Built with: esbuild --bundle --format=esm --target=es2022 --platform=neutral
// Serves only /api/unit-camera-status and /api/unit-camera-status/edit. Every
// other path is handed to the shared handler as one it does not serve.
// tech-checks/supabase/functions/cos-operations-pages/savedFleetBoard.mjs
var FLEET_LEASE_MS = 18e4;
var FLEET_BATCH_BUDGET_MS = 165e3;
var COMMIT_RESERVE_MS = 35e3;
var COMMIT_REQUEST_MAX_MS = 3e4;
var LEASE_MARGIN_MS = 3e3;
var COMMIT_MIN_MS = 5e3;
var PAYLOAD_MARK = '"@@COS_SAVED_FLEET_BOARD_PAYLOAD@@"';
var SAFE = /^[a-z0-9_]{1,48}$/;
var SOURCES = [
  // The map and connection endpoints both assemble the mHelp inventory.
  // Reads stay sequential so they do not compete on the same database.
  // Connections is read first: it is the source that declines stale or
  // unverifiable evidence, and when it does the batch ends without having
  // spent the map and health reads on a board that cannot be published.
  ["connections", "/api/product-connections", 45e3],
  ["map", "/api/fleet-map-source", 7e4],
  ["health", "/api/camera-health/summary-v3", 35e3]
];
var completed = null;
var safe = (value2) => typeof value2 === "string" && SAFE.test(value2) ? value2 : null;
var UNKNOWN = /* @__PURE__ */ Symbol("unknown");
var RUN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var leaseAnswer = (value2) => value2 === null ? null : value2 && typeof value2 === "object" && typeof value2.id === "string" && RUN_ID.test(value2.id) ? value2 : UNKNOWN;
var claimAnswer = (value2) => !value2 || typeof value2 !== "object" ? UNKNOWN : value2.claimed === false ? false : value2.claimed === true && Number.isFinite(value2.leaseRemainingMs) && value2.leaseRemainingMs >= 0 ? value2.leaseRemainingMs : UNKNOWN;
var statusAnswer = (value2) => value2 && typeof value2 === "object" && value2.contract === "COS_DURABLE_FLEET_RESPONSE_V1" && (value2.latest === null || value2.latest === void 0 || typeof value2.latest === "object") ? value2 : UNKNOWN;
var whole = (value2) => Number.isFinite(value2) ? Math.max(0, Math.round(value2)) : null;
function failureDetail(cause) {
  const d = cause?.detail, out = {};
  if (d && typeof d === "object") {
    if (safe(d.kind)) out.kind = d.kind;
    if (Number.isInteger(d.status) && d.status >= 100 && d.status < 600) out.status = d.status;
    if (Number.isInteger(d.attempts) && d.attempts >= 0 && d.attempts < 10) out.attempts = d.attempts;
    if (safe(d.stage)) out.stage = d.stage;
    if (safe(d.code)) out.code = d.code;
  }
  if (!out.kind) out.kind = safe(cause?.message) || "error";
  return out;
}
async function savedFleetResponse({ rpc, payloadText }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const status2 = statusAnswer(await rpc("cos_fleet_board_status", {}));
    if (status2 === UNKNOWN) continue;
    const id15 = status2.latest?.id;
    if (!id15) {
      return JSON.stringify(status2);
    }
    if (completed?.id !== id15) {
      const text42 = String(await payloadText(id15) ?? "").trim();
      if (!text42.startsWith("{") || !text42.endsWith("}")) continue;
      completed = { id: id15, text: text42 };
    }
    const text32 = completed.text;
    return JSON.stringify({ ...status2, latest: { ...status2.latest, payload: "@@COS_SAVED_FLEET_BOARD_PAYLOAD@@" } }).replace(PAYLOAD_MARK, () => text32);
  }
  throw Error("saved_board_unavailable");
}
async function produceFleetBoard({ run, producer = null, leaseEndAt, rpc, read, now = Date.now, project, abort, timeoutSignal = (ms) => AbortSignal.timeout(ms) }) {
  const started = now(), budget = Number.isFinite(leaseEndAt) ? Math.max(0, Math.min(FLEET_LEASE_MS, leaseEndAt - started)) : FLEET_BATCH_BUDGET_MS;
  const leaseEnd = started + budget, deadline = leaseEnd - LEASE_MARGIN_MS;
  const diagnostics = { version: 1, budgetMs: whole(budget), steps: [] };
  let current = "start";
  const mark = () => rpc("cos_fleet_board_progress", { p_run: run, p_producer: producer, p_diagnostics: { ...diagnostics, reached: current, elapsedMs: whole(now() - started) } }).catch(() => {
  });
  const step = async (name, work, describe) => {
    current = name;
    const at = now();
    try {
      const value2 = await work();
      diagnostics.steps.push({ step: name, ok: true, ms: whole(now() - at), ...describe ? describe(value2) : {} });
      return value2;
    } catch (cause) {
      diagnostics.steps.push({ step: name, ok: false, ms: whole(now() - at), ...failureDetail(cause) });
      throw cause;
    }
  };
  try {
    const values = {};
    for (const [name, path, attemptMs] of SOURCES) {
      const receipt2 = await step(name, () => {
        if (now() >= leaseEnd - COMMIT_RESERVE_MS) throw Object.assign(Error("source_read_failed"), { detail: { kind: "batch_deadline", attempts: 0 } });
        return read(path, { attemptMs, until: leaseEnd - COMMIT_RESERVE_MS });
      }, (value22) => ({ attempts: whole(value22?.attempts) ?? 1 }));
      values[name] = receipt2?.value;
      await mark();
    }
    const capturedAt = now();
    const value2 = await step("project", async () => project(values.health, values.map, values.connections, null, capturedAt));
    await step("commit", async () => {
      const remaining = deadline - now();
      if (remaining < COMMIT_MIN_MS) throw Object.assign(Error("commit_unconfirmed"), { detail: { kind: "batch_deadline" } });
      let published;
      try {
        published = await rpc("cos_fleet_board_finish", { p_run: run, p_producer: producer, p_payload: value2, p_diagnostics: { ...diagnostics, reached: "commit", elapsedMs: whole(now() - started) } }, timeoutSignal(Math.min(COMMIT_REQUEST_MAX_MS, remaining)));
      } catch (cause) {
        throw Object.assign(Error("commit_unconfirmed"), { detail: { kind: cause?.name === "TimeoutError" || cause?.name === "AbortError" ? "commit_timeout" : "commit_error" } });
      }
      if (published === false) throw Object.assign(Error("commit_unconfirmed"), { detail: { kind: "lease_lost" } });
      if (published !== true) throw Object.assign(Error("commit_unconfirmed"), { detail: { kind: "commit_unreadable" } });
    });
    return true;
  } catch (cause) {
    abort?.();
    const code = ["checks_incomplete", "connection_source_incomplete", "inventory_source_incomplete"].includes(cause?.message) ? cause.message : "source_read_failed";
    await rpc("cos_fleet_board_fail", { p_run: run, p_producer: producer, p_code: code, p_products: Array.isArray(cause?.products) ? cause.products.slice(0, 1e3) : [], p_diagnostics: { ...diagnostics, reached: current, failedStep: current, elapsedMs: whole(now() - started) } }).catch(() => {
    });
    return false;
  }
}
var pause = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
var newToken = () => globalThis.crypto.randomUUID();
var UNCERTAIN_DELIVERY_GRACE_MS = 4e3;
var dispatchFailure = (kind6, attempts) => ({ version: 1, steps: [{ step: "dispatch", ok: false, kind: kind6, attempts }], reached: "dispatch", failedStep: "dispatch" });
async function beginLease({ rpc, force, request, sleep }) {
  let last = Error("lease_unconfirmed");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const answer = leaseAnswer(await rpc("cos_fleet_board_begin", { p_force: force, p_request: request }));
      if (answer !== UNKNOWN) return answer;
      last = Error("lease_unconfirmed");
    } catch (cause) {
      last = cause;
    }
    if (attempt < 2) await sleep(1e3);
  }
  throw last;
}
async function claimOnce({ rpc, run, producer, now }) {
  const sentAt = now();
  let answer;
  try {
    answer = claimAnswer(await rpc("cos_fleet_board_claim", { p_run: run, p_producer: producer }));
  } catch {
    answer = UNKNOWN;
  }
  if (answer === UNKNOWN) return { claimed: null };
  if (answer === false) return { claimed: false };
  return { claimed: true, leaseEndAt: sentAt + answer };
}
async function claimFleetBatch({ rpc, run, producer, now = Date.now, sleep = pause, attempts = 4 }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const claim = await claimOnce({ rpc, run, producer, now });
    if (claim.claimed !== null) return claim;
    if (attempt < attempts - 1) await sleep(1500);
  }
  await rpc("cos_fleet_board_fail", { p_run: run, p_producer: producer, p_code: "source_read_failed", p_products: [], p_diagnostics: dispatchFailure("claim_unconfirmed", attempts) }).catch(() => {
  });
  return { claimed: null };
}
async function startFleetBatch({ run, rpc, read, now = Date.now, project, abort, targets = [], followTargets = [], inline = false, sleep = pause, token = newToken, timeoutSignal }) {
  let attempted = null, uncertain = false, attempts = 0;
  try {
    for (const target of targets) {
      if (!target) continue;
      let outcome;
      try {
        outcome = await target(run);
      } catch {
        outcome = "uncertain";
      }
      attempts++;
      if (outcome === "accepted") return "handed";
      if (outcome !== "rejected") uncertain = true;
    }
    if (uncertain) await sleep(UNCERTAIN_DELIVERY_GRACE_MS);
    attempted = token();
    const claim = await claimFleetBatch({ rpc, run, producer: attempted, now, sleep });
    if (claim.claimed === null) return "failed";
    if (!claim.claimed) return "owned_elsewhere";
    if (inline) {
      await runFleetBatch({ run, producer: attempted, leaseEndAt: claim.leaseEndAt, rpc, read, now, project, abort, followTargets, sleep, token, timeoutSignal });
      return "ran_here";
    }
    await rpc("cos_fleet_board_fail", { p_run: run, p_producer: attempted, p_code: "source_read_failed", p_products: [], p_diagnostics: dispatchFailure(uncertain ? "delivery_uncertain" : "delivery_rejected", attempts) });
    return "failed";
  } catch {
    await rpc("cos_fleet_board_fail", { p_run: run, p_producer: attempted, p_code: "source_read_failed", p_products: [], p_diagnostics: dispatchFailure("dispatch_error", attempts) }).catch(() => {
    });
    return "failed";
  }
}
async function acceptFleetBatch({ run, rpc, read, now = Date.now, project, abort, followTargets = [], waitUntil, sleep = pause, token = newToken, timeoutSignal }) {
  const producer = token();
  const work = (claim) => runFleetBatch({ run, producer, leaseEndAt: claim.leaseEndAt, rpc, read, now, project, abort, followTargets, sleep, token, timeoutSignal });
  const first = await claimOnce({ rpc, run, producer, now });
  if (first.claimed === true) {
    waitUntil(work(first));
    return "accepted";
  }
  if (first.claimed === false) return "refused";
  waitUntil((async () => {
    const claim = await claimFleetBatch({ rpc, run, producer, now, sleep });
    if (claim.claimed === true) await work(claim);
  })());
  return "unknown";
}
async function continueQueuedFleetBoard({ rpc, read, project, abort, targets = [], inline = false, startedAt, now = Date.now, sleep = pause, token = newToken, timeoutSignal }) {
  try {
    if (!inline && !targets.some(Boolean)) return false;
    let status2 = statusAnswer(await rpc("cos_fleet_board_status", {}));
    if (status2 === UNKNOWN) {
      await sleep(1e3);
      status2 = statusAnswer(await rpc("cos_fleet_board_status", {}));
    }
    if (status2 === UNKNOWN || status2.refresh?.state !== "queued") return false;
    const recorded = Date.parse(status2.refresh.startedAt);
    const since = Number.isFinite(recorded) ? recorded : startedAt ?? now();
    const wait = Math.min(61e3, 61e3 - (now() - since));
    if (wait > 0) await sleep(wait);
    const request = token();
    let lease = null;
    for (let attempt = 0; attempt < 3 && !lease?.id; attempt++) {
      if (attempt) {
        await sleep(2e3);
        const again = statusAnswer(await rpc("cos_fleet_board_status", {}));
        if (again !== UNKNOWN && again.refresh?.state !== "queued") return false;
      }
      lease = await beginLease({ rpc, force: false, request, sleep });
    }
    if (!lease?.id) return false;
    const outcome = await startFleetBatch({ run: lease.id, rpc, read, now, project, abort, targets, followTargets: targets, inline, sleep, token, timeoutSignal });
    return outcome !== "failed";
  } catch {
    return false;
  }
}
async function runFleetBatch({ run, producer = null, leaseEndAt, rpc, read, now = Date.now, project, abort, followTargets = [], sleep = pause, token = newToken, timeoutSignal }) {
  const startedAt = now();
  const ok = await produceFleetBoard({ run, producer, leaseEndAt, rpc, read, now, project, abort, timeoutSignal });
  await continueQueuedFleetBoard({ rpc, targets: followTargets, inline: false, startedAt, now, sleep, token, timeoutSignal });
  return ok;
}
async function savedFleetBoard({ rpc, payloadText, read, force = false, waitUntil, now = Date.now, project, abort, targets = [], followTargets = [], sleep = pause, token = newToken, timeoutSignal }) {
  const lease = force ? await beginLease({ rpc, force: true, request: token(), sleep }) : null;
  if (lease?.id) waitUntil(startFleetBatch({ run: lease.id, rpc, read, now, project, abort, targets, followTargets, inline: true, sleep, token, timeoutSignal }));
  else if (force) waitUntil(continueQueuedFleetBoard({ rpc, read, project, abort, targets: followTargets, inline: true, now, sleep, token, timeoutSignal }));
  return savedFleetResponse({ rpc, payloadText });
}
var CAMERA_FRESH_MS = 20 * 60 * 1e3;
var normalized = (value2) => typeof value2 === "string" ? value2.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp(value2, now = Date.now()) {
  if (typeof value2 !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value2);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value2.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS } : { at: null, fresh: false };
}
function resourceKind(row2) {
  const type = normalized(row2.type).toLowerCase();
  return row2.trackerOnly ? "unitInventory" : ["ipc", "camera"].includes(type) ? "cameras" : ["detector", "reconeyez detector"].includes(type) ? "detectors" : type === "nvr" ? "recorders" : /^(?:sniper(?: [24])?|camv|tracker_unit)$/.test(type) ? "unitInventory" : "other";
}
var cameraRecord = (row2) => !row2.trackerOnly && ["cameras", "detectors"].includes(resourceKind(row2));
var providerSource = (value2) => ["Star4Live", "Reconeyez"].includes(String(value2));
function providerRecord(row2) {
  const kind6 = resourceKind(row2), resource = kind6 === "cameras" ? "camera" : kind6 === "detectors" ? "detector" : kind6 === "recorders" ? "recorder" : null;
  return !row2.trackerOnly && resource !== null && row2.evidence?.kind === "provider" && row2.evidence.resource === resource && providerSource(row2.evidence.source);
}
function currentCameraStatus(evidence, now = Date.now()) {
  return evidence?.kind === "provider" && ["camera", "detector"].includes(evidence.resource || "") && evidence.active === true && providerSource(evidence.source) && cameraTimestamp(evidence.observedAt, now).fresh && ["online", "offline"].includes(evidence.status) ? evidence.status : "review";
}
function providerState(row2, now = Date.now()) {
  if (normalized(row2.activationState) !== "ACTIVE" || !providerRecord(row2) || row2.evidence?.active !== true) return "verifying";
  return cameraTimestamp(row2.evidence.observedAt, now).fresh && ["online", "offline"].includes(row2.evidence.status) ? row2.evidence.status : "verifying";
}
function cameraState(row2, now = Date.now()) {
  if (row2.trackerOnly) return "mapping";
  if (!cameraRecord(row2) || !providerRecord(row2) || normalized(row2.activationState) !== "ACTIVE") return "verifying";
  const value2 = currentCameraStatus(row2.evidence, now);
  return value2 === "review" ? "verifying" : value2;
}
function serviceState(row2, now = Date.now()) {
  const evidence = row2.serviceEvidence || (row2.evidence?.kind === "service_port" ? row2.evidence : void 0);
  if (normalized(row2.activationState) !== "ACTIVE" || evidence?.kind !== "service_port" || evidence.active !== true || !cameraTimestamp(evidence.observedAt, now).fresh) return "verifying";
  if (evidence.status === "online" && evidence.reachable === true) return "online";
  if (evidence.status === "offline" && (evidence.confirmedOutage === true || Number.isInteger(evidence.consecutiveFailures) && Number(evidence.consecutiveFailures) >= 3)) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}
function combinedState(states2, empty2 = "verifying") {
  if (!states2.length) return empty2;
  return states2.every((state) => state === "online") ? "online" : states2.every((state) => state === "offline") ? "offline" : states2.some((state) => ["online", "offline", "degraded"].includes(state)) ? "degraded" : "verifying";
}
function classifyCameraUnit(rows4, now = Date.now()) {
  const active = rows4.filter((row2) => row2.scope !== "inactive");
  const scopes = new Set(active.map((row2) => row2.scope || "unknown"));
  const scope = !active.length ? "inactive" : scopes.size === 1 ? [...scopes][0] : "unknown";
  const cameras = active.filter(cameraRecord), providers = active.filter(providerRecord);
  const provider = combinedState(providers.map((row2) => providerState(row2, now)));
  const camera = combinedState(cameras.map((row2) => cameraState(row2, now)), "mapping");
  const service = combinedState(active.map((row2) => serviceState(row2, now)));
  const state = scope === "inactive" ? "inactive" : scope === "shop" ? "shop" : provider !== "verifying" ? provider : service === "online" ? "service" : providers.length ? "verifying" : "mapping";
  return { scope, state, providerState: scope === "inactive" || scope === "shop" ? "verifying" : provider, cameraState: scope === "inactive" || scope === "shop" ? "mapping" : camera, serviceState: scope === "inactive" || scope === "shop" ? "verifying" : service, systemKind: providers.length && providers.every((row2) => resourceKind(row2) === "recorders") ? "recorder" : providers.length && providers.every((row2) => resourceKind(row2) === "detectors") ? "detector" : "system", recorderOffline: active.some((row2) => resourceKind(row2) === "recorders" && providerState(row2, now) === "offline") };
}
function savedConnectionObservation(row2, now = Date.now()) {
  const evidence = row2.serviceEvidence || (row2.evidence?.kind === "service_port" ? row2.evidence : void 0);
  if (evidence?.kind !== "service_port" || !cameraTimestamp(evidence.observedAt, now).fresh) return "verifying";
  if (evidence.status === "online" && evidence.reachable === true) return "online";
  if (evidence.status === "offline" && evidence.reachable !== true && (evidence.confirmedOutage === true || Number.isInteger(evidence.consecutiveFailures) && Number(evidence.consecutiveFailures) >= 3)) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}
var connectionEvidence = (row2) => row2.serviceEvidence || (row2.evidence?.kind === "service_port" ? row2.evidence : void 0);
function healthObservationTime(rows4, basis, state, now = Date.now()) {
  const candidates = rows4.filter((row2) => basis === "connection" ? connectionEvidence(row2)?.kind === "service_port" : providerRecord(row2) && typeof row2.activationState === "string" && row2.activationState.trim().toUpperCase() === "ACTIVE" && row2.evidence?.active === true && (basis === "camera" ? cameraRecord(row2) : basis === "recorder" ? resourceKind(row2) === "recorders" : true));
  const supporting = state === "online" || state === "offline" ? candidates.filter((row2) => (basis === "connection" ? savedConnectionObservation(row2, now) : basis === "camera" ? cameraState(row2, now) : providerState(row2, now)) === state) : candidates;
  const dates = supporting.map((row2) => basis === "connection" ? connectionEvidence(row2)?.observedAt : row2.evidence?.observedAt).map((value2) => cameraTimestamp(value2, now).at).filter((value2) => Boolean(value2)).sort();
  return dates.at(-1) || null;
}
var object = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
var text = (value2) => typeof value2 === "string" && value2.trim() !== "";
var resourceId = (value2) => typeof value2 === "string" && /^[1-9]\d*$/.test(value2);
var sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
var immutableEnvelopes = /* @__PURE__ */ new WeakMap();
function prepareImmutableIdentityEnvelope(value2) {
  validateIdentityEnvelope(value2);
  const seen = /* @__PURE__ */ new WeakSet();
  const freeze = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(value2);
  immutableEnvelopes.set(value2, Object.freeze([...value2.unitIdentities || [], ...value2.ownerConfirmedUnitIdentities || [], ...value2.reconProviderUnitIdentities || []]));
  return value2;
}
function validateIdentityEnvelope(value2) {
  if (immutableEnvelopes.has(value2)) return;
  if (value2.identityVersion === void 0) {
    if (value2.unitIdentities !== void 0 || value2.identityWarnings !== void 0 || value2.ownerConfirmedIdentityVersion !== void 0 || value2.ownerConfirmedUnitIdentities !== void 0 || value2.reconProviderIdentityVersion !== void 0 || value2.reconProviderUnitIdentities !== void 0) throw new Error("Equipment identity contract is incomplete.");
    return;
  }
  if (value2.identityVersion !== 1 || value2.evidenceVersion !== 2 || !Array.isArray(value2.unitIdentities) || value2.unitIdentities.length > 1e3) throw new Error("Equipment identity contract is unavailable.");
  if (value2.ownerConfirmedIdentityVersion === void 0 ? value2.ownerConfirmedUnitIdentities !== void 0 : value2.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(value2.ownerConfirmedUnitIdentities) || value2.ownerConfirmedUnitIdentities.length > 1e3 || value2.ownerConfirmedUnitIdentities.some((row2) => row2.kind !== "owner_confirmed_native")) throw new Error("Owner-confirmed identity contract is unavailable.");
  if (value2.reconProviderIdentityVersion === void 0 ? value2.reconProviderUnitIdentities !== void 0 : value2.reconProviderIdentityVersion !== 1 || !Array.isArray(value2.reconProviderUnitIdentities) || value2.reconProviderUnitIdentities.length > 1e3 || value2.reconProviderUnitIdentities.some((row2) => row2.kind !== "reconeyez_area")) throw new Error("Reconeyez provider-area contract is unavailable.");
  if (value2.unitIdentities.some((row2) => ["owner_confirmed_native", "reconeyez_area"].includes(row2.kind))) throw new Error("Reviewed provider identities require their additive contract.");
  for (const row2 of [...value2.unitIdentities, ...value2.ownerConfirmedUnitIdentities || [], ...value2.reconProviderUnitIdentities || []]) {
    if (!object(row2) || !text(row2.unitId) || !text(row2.unitNumber) || !["native_provider", "owner_placement", "owner_confirmed_native", "reconeyez_area"].includes(row2.kind) || !Array.isArray(row2.deviceIds) || !row2.deviceIds.length || row2.deviceIds.length > 1e3 || !row2.deviceIds.every(resourceId) || !Array.isArray(row2.unitKeys) || !row2.unitKeys.length || !row2.unitKeys.every(text) || !/^[a-f0-9]{64}$/.test(row2.proof) || row2.kind === "owner_placement" && !resourceId(row2.placementAuditId)) throw new Error("Equipment identity proof is malformed.");
    if (row2.kind === "reconeyez_area" && (!object(row2.providerArea) || !Number.isSafeInteger(row2.providerArea.detectorCount) || row2.providerArea.detectorCount !== row2.deviceIds.length || typeof row2.providerArea.inventoryObservedAt !== "string" || !(row2.providerArea.bridgeLastEventAt === null || typeof row2.providerArea.bridgeLastEventAt === "string"))) throw new Error("Reconeyez provider-area coverage is malformed.");
  }
  if (value2.identityWarnings !== void 0 && (!Array.isArray(value2.identityWarnings) || value2.identityWarnings.length > 1e3 || value2.identityWarnings.some((row2) => !object(row2) || !text(row2.unitId) || !text(row2.reason) || row2.deviceIds !== void 0 && (!Array.isArray(row2.deviceIds) || !row2.deviceIds.every(resourceId)) || row2.unitKeys !== void 0 && (!Array.isArray(row2.unitKeys) || !row2.unitKeys.every(text))))) throw new Error("Equipment identity warnings are malformed.");
}
function allVerifiedUnitIdentities(value2) {
  const prepared = immutableEnvelopes.get(value2);
  if (prepared) return prepared;
  validateIdentityEnvelope(value2);
  return [...value2.unitIdentities || [], ...value2.ownerConfirmedUnitIdentities || [], ...value2.reconProviderUnitIdentities || []];
}
function resolve(identity4, health, now = Date.now()) {
  const fail17 = (reason) => ({ state: "conflict", reason });
  const identities = allVerifiedUnitIdentities(health);
  if (identities.filter((x) => x.unitId === identity4.unitId).length !== 1 || new Set(identity4.unitKeys).size !== identity4.unitKeys.length || new Set(identity4.deviceIds).size !== identity4.deviceIds.length) return fail17("Equipment identity has duplicate or conflicting associations.");
  if (identities.some((x) => x !== identity4 && x.deviceIds.some((id15) => identity4.deviceIds.includes(id15)))) return fail17("A source resource is associated with more than one equipment identity.");
  const rows4 = health.rows.filter((row2) => identity4.deviceIds.includes(String(row2.id)));
  if (!sameSet(rows4.map((row2) => String(row2.id)), identity4.deviceIds) || rows4.some((row2) => row2.trackerOnly || !identity4.unitKeys.includes(row2.unit))) return fail17("The expected source resource set is incomplete or changed.");
  const group = health.rows.filter((row2) => identity4.unitKeys.includes(row2.unit));
  if (!sameSet(group.map((row2) => String(row2.id)), identity4.deviceIds)) return fail17("The current source group no longer matches the complete verified resource set.");
  if (identity4.kind === "native_provider" && rows4.some((row2) => row2.evidence?.kind !== "provider" || row2.evidence.source !== "Star4Live" || !providerRecord(row2))) return fail17("The linked provider identity changed.");
  if (identity4.kind === "reconeyez_area" && (!cameraTimestamp(identity4.providerArea?.inventoryObservedAt, now).fresh || rows4.some((row2) => row2.evidence?.source !== "Reconeyez" || resourceKind(row2) !== "detectors" || !providerRecord(row2)))) return fail17("Reconeyez provider-area proof is stale or the detector source changed.");
  return { state: "verified", identity: identity4, rows: rows4 };
}
function resolveVerifiedUnitIdentity(unit, health, now = Date.now()) {
  try {
    validateIdentityEnvelope(health);
  } catch {
    return { state: "conflict", reason: "Equipment identity proof could not be verified. Reload saved results." };
  }
  if (health.identityVersion !== 1) return { state: "unavailable", reason: "No durable equipment-to-resource association is available." };
  const warnings = health.identityWarnings?.filter((row2) => row2.unitId === unit.id) || [];
  if (warnings.length) return { state: "conflict", reason: warnings[0].reason };
  const identities = allVerifiedUnitIdentities(health).filter((row2) => row2.unitId === unit.id);
  if (identities.length !== 1) return { state: identities.length ? "conflict" : "unavailable", reason: identities.length ? "Equipment identity has conflicting source associations." : "No durable equipment-to-resource association is available." };
  const identity4 = identities[0];
  if (identity4.unitNumber !== unit.unitNumber) return { state: "conflict", reason: "The saved equipment label changed after its resource association was verified." };
  if (identity4.kind === "owner_placement" && (String(unit.placementAuditId || "") !== identity4.placementAuditId || unit.placementUnitKey !== identity4.unitNumber)) return { state: "conflict", reason: "The Owner placement changed. Reload the map and saved source evidence." };
  return resolve(identity4, health, now);
}
function legacyIdentityConflict(unitId, rows4, health) {
  if (health.identityVersion !== 1) return null;
  const related = (claim) => rows4.some((row2) => claim.deviceIds?.includes(String(row2.id)) || claim.unitKeys?.includes(row2.unit));
  if (allVerifiedUnitIdentities(health).some((identity4) => identity4.unitId !== unitId && related(identity4))) return "These source resources belong to another verified equipment identity. Review this separate field record before linking it.";
  const warning = health.identityWarnings?.find(related);
  return warning?.reason || null;
}
function linkedUnitObservation(rows4, now = Date.now()) {
  const providers = rows4.filter((row2) => ["cameras", "detectors", "recorders"].includes(resourceKind(row2))), cameras = rows4.filter((row2) => ["cameras", "detectors"].includes(resourceKind(row2)));
  const provider = providers.length ? combinedState(rows4.map((row2) => providerState(row2, now))) : "verifying";
  const service = combinedState(rows4.map((row2) => savedConnectionObservation(row2, now)));
  const camera = cameras.length ? combinedState(rows4.map((row2) => cameraState(row2, now))) : "mapping";
  const basis = providers.length && provider !== "verifying" ? providers.every((row2) => resourceKind(row2) === "recorders") ? "recorder" : providers.every((row2) => ["cameras", "detectors"].includes(resourceKind(row2))) ? "camera" : "provider" : !providers.length || service !== "verifying" ? "connection" : providers.every((row2) => resourceKind(row2) === "recorders") ? "recorder" : "camera";
  const state = basis === "connection" ? service : provider;
  const prefix = { camera: rows4.length && rows4.every((row2) => resourceKind(row2) === "detectors") ? "DETECTOR RECORDS" : "CAMERA RECORDS", recorder: "RECORDER", provider: "PROVIDER SYSTEM", connection: "IP / PORT" }[basis];
  const checkedAt = healthObservationTime(rows4, basis, state, now);
  return { state, basis, label: prefix + " " + { online: "ONLINE", offline: "OFFLINE", degraded: "MIXED / PARTLY VERIFIED", verifying: "UNVERIFIED" }[state], checkedAt, providerState: provider, cameraState: camera, serviceState: service };
}
var IT_DAILY_WORKSPACES = Object.freeze(["Fleet Dashboard", "Camera Health"]);
var object2 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var same = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && a.every((v) => typeof v === "string" && b.includes(v));
var validGuard = (v) => object2(v) && typeof v.unitId === "string" && typeof v.unitNumber === "string" && v.unitNumber.trim() !== "" && sha(v.identityProof) && Array.isArray(v.deviceIds) && v.deviceIds.length > 0 && v.deviceIds.length <= 1e3 && new Set(v.deviceIds).size === v.deviceIds.length && v.deviceIds.every((id15) => typeof id15 === "string" && /^[1-9]\d*$/.test(id15)) && Array.isArray(v.unitKeys) && v.unitKeys.length > 0 && new Set(v.unitKeys).size === v.unitKeys.length && v.unitKeys.every((key2) => typeof key2 === "string" && key2.trim() !== "") && typeof v.checkedAt === "string" && typeof v.providerSyncAt === "string";
function fieldRecorderObservation(unit, identity4, rows4, health, now = Date.now()) {
  const authority = unit.fieldRecorderAuthority, binding = unit.importedInstallation, guards = health.fieldRecorderObservationGuards;
  if (identity4.kind !== "native_provider" || health.fieldRecorderObservationVersion !== 1 || !Array.isArray(guards) || guards.length > 5 || guards.some((g) => !validGuard(g)) || !object2(authority) || authority.schemaVersion !== 1 || !object2(binding) || unit.readOnly !== false || unit.status !== "field" || unit.currentLocationType !== "field" || unit.importedPlacement !== "FIELD" || unit.placementSource === "owner" || unit.placementAuditId || binding.sourcePrecedence || binding.schemaVersion !== 1 || binding.sourceSystem !== "mhelpdesk_product_import" || binding.entityKind !== "equipment_unit" || binding.eligibility !== "FIELD" || binding.nativeUnitId !== unit.id || binding.unitNumber !== unit.unitNumber || identity4.unitId !== unit.id || identity4.unitNumber !== unit.unitNumber || !cameraTimestamp(authority.checkedAt, now).fresh) return null;
  const selected = guards.filter((g) => g.unitId === unit.id);
  if (selected.length !== 1) return null;
  const guard = selected[0], sync = cameraTimestamp(selected[0].providerSyncAt, now);
  if (!sync.fresh || !sync.at) return null;
  for (const proof of [authority, guard]) if (proof.unitId !== unit.id || proof.unitNumber !== unit.unitNumber || proof.identityProof !== identity4.proof || !sha(proof.identityProof) || !same(proof.deviceIds, identity4.deviceIds) || !same(proof.unitKeys, identity4.unitKeys) || !cameraTimestamp(proof.checkedAt, now).fresh) return null;
  if (guards.some((g) => g !== guard && (g.deviceIds.some((v) => identity4.deviceIds.includes(v)) || g.unitKeys.some((v) => identity4.unitKeys.includes(v))))) return null;
  for (const key2 of ["sourceRevision", "sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256", "eventId", "productId"]) if (typeof authority[key2] !== "string" || authority[key2] !== binding[key2]) return null;
  if (!["sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => sha(binding[k])) || !same(rows4.map((r) => String(r.id)), identity4.deviceIds) || !same([...new Set(rows4.map((r) => r.unit))], identity4.unitKeys) || rows4.some((r) => resourceKind(r) !== "recorders" || !providerRecord(r) || r.evidence?.source !== "Star4Live" || cameraTimestamp(r.evidence?.observedAt, now).at !== sync.at)) return null;
  const states2 = rows4.map((r) => cameraTimestamp(r.evidence?.observedAt, now).fresh && ["online", "offline"].includes(r.evidence?.status || "") ? r.evidence.status : "verifying");
  const state = combinedState(states2), times = rows4.map((r) => cameraTimestamp(r.evidence?.observedAt, now).at).filter((v) => Boolean(v)).sort();
  return { state, basis: "recorder", label: "RECORDER " + { online: "ONLINE", offline: "OFFLINE", degraded: "MIXED / PARTLY VERIFIED", verifying: "UNVERIFIED" }[state], checkedAt: times.at(-1) || null, providerState: state, cameraState: "mapping", serviceState: "verifying" };
}
var cameraLabels = { online: "Camera records online", offline: "Camera outage observed", unknown: "Camera status unverified" };
function validateCameraHealth(value2) {
  const object52 = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!object52(value2) || ["totalDevices", "online", "offline", "review", "shopRoot", "healthRows", "fieldDevices"].some((key2) => !Number.isSafeInteger(value2[key2]) || value2[key2] < 0) || !Array.isArray(value2.rows) || value2.rows.some((r) => !object52(r) || typeof r.id !== "string" && typeof r.id !== "number" || String(r.id).trim() === "" || typeof r.name !== "string" || typeof r.unit !== "string" || !["online", "offline", "review"].includes(r.status)) || value2.online + value2.offline + value2.review !== value2.fieldDevices || !Number.isFinite(Date.parse(value2.refreshedAt))) throw new Error("Camera Health returned an incomplete summary.");
  if (new Set(value2.rows.map((row2) => String(row2.id))).size !== value2.rows.length) throw new Error("Camera Health contains duplicate resource identities.");
  if (value2.evidenceVersion === 2) {
    const inventory = value2.inventory;
    if (!object52(inventory) || !["allRecords", "activeFieldRecords", "activeShopRecords", "inactiveRecords", "unknownScopeRecords"].every((key2) => Number.isSafeInteger(inventory[key2]) && inventory[key2] >= 0) || inventory.allRecords !== value2.totalDevices || inventory.allRecords !== value2.rows.length || inventory.activeFieldRecords !== value2.fieldDevices || inventory.activeShopRecords !== value2.shopRoot || inventory.allRecords !== inventory.activeFieldRecords + inventory.activeShopRecords + inventory.inactiveRecords + inventory.unknownScopeRecords) throw new Error("Camera Health inventory counts could not be reconciled.");
    for (const [scope, key2] of [["field", "activeFieldRecords"], ["shop", "activeShopRecords"], ["inactive", "inactiveRecords"], ["unknown", "unknownScopeRecords"]]) if (value2.rows.filter((row2) => row2.scope === scope).length !== inventory[key2]) throw new Error("Camera Health placement counts could not be reconciled.");
    for (const row2 of value2.rows) {
      if (typeof row2.activationState !== "string" || !["field", "shop", "inactive", "unknown"].includes(row2.scope)) throw new Error("Camera Health placement evidence is incomplete.");
      const battery = row2.batteryEvidence;
      if (battery !== void 0 && (!object52(battery) || row2.evidence?.source !== "Reconeyez" || battery.source !== "Reconeyez" || battery.percent !== null && (typeof battery.percent !== "number" || !Number.isFinite(battery.percent) || battery.percent < 0 || battery.percent > 100) || ![null, "normal", "low", "critical"].includes(battery.status) || [battery.percentObservedAt, battery.statusObservedAt].some((time3) => time3 !== null && typeof time3 !== "string"))) throw new Error("Recon battery evidence is malformed.");
      for (const e of [row2.evidence, row2.serviceEvidence].filter(Boolean)) {
        if (!object52(e) || !["provider", "service_port", "unknown"].includes(e.kind) || typeof e.source !== "string" || !["online", "offline", "degraded", "unknown"].includes(e.status) || typeof e.active !== "boolean" || !["camera", "detector", "recorder", "service", "unknown"].includes(e.resource) || [e.observedAt, e.lastOnlineAt].some((time3) => time3 !== null && typeof time3 !== "string") || e.reachable !== void 0 && e.reachable !== null && typeof e.reachable !== "boolean" || e.confirmedOutage !== void 0 && typeof e.confirmedOutage !== "boolean" || e.consecutiveFailures !== void 0 && e.consecutiveFailures !== null && (!Number.isSafeInteger(e.consecutiveFailures) || e.consecutiveFailures < 0)) throw new Error("Camera Health source evidence is malformed.");
      }
    }
  } else if (value2.rows.length !== value2.fieldDevices) throw new Error("Camera Health returned an incomplete legacy summary.");
  validateIdentityEnvelope(value2);
  return value2;
}
var plain = (value2) => value2.trim().replace(/\s+/g, " ").toUpperCase();
var canonicalUnitCache = /* @__PURE__ */ new Map();
function canonicalCameraUnit(value2) {
  const cacheable = value2.length <= 512;
  if (cacheable && canonicalUnitCache.has(value2)) return canonicalUnitCache.get(value2);
  const result = parseCanonicalCameraUnit(value2);
  if (cacheable) {
    if (canonicalUnitCache.size >= 4096) canonicalUnitCache.clear();
    canonicalUnitCache.set(value2, result);
  }
  return result;
}
function parseCanonicalCameraUnit(value2) {
  const match = /^(SNIPER\s*[24]|RECON\s*(?:2|II))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value2.trim()) || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(value2.trim());
  if (!match) return null;
  let family = plain(match[1]).replace(/\s/g, "");
  family = { RI: "RECON", RII: "RECON2", RECONII: "RECON2" }[family] || family;
  const [base2, ...tail] = match[2].split(".");
  if (Number(base2) === 0) return null;
  return family + "|" + Number(base2) + (tail.length ? "." + tail.join(".") : "");
}
function scopedFieldIdentity(unit) {
  const key2 = canonicalCameraUnit(unit.unitNumber);
  if (!key2) return null;
  const family = key2.split("|")[0], model = plain(unit.modelName || "").replace(/[\s&]/g, "");
  const aliases5 = { HELIOS: ["HELIOS"], RANGER: ["RANGER", "RANGERS"], SOLARSPOTTER: ["SOLARSPOTTER", "SOLARSPOTTERS"], SPOTTER: ["SPOTTER", "SPOTTERS"], SSHYBRID: ["SSHYBRID", "SSHYBRIDS"], RECON: ["RECON", "RECONS"], RECON2: ["RECON2", "RECONII"], SNIPER: ["SNIPER", "SNIPERS"], SNIPER2: ["SNIPER2", "SNIPERS"], SNIPER4: ["SNIPER4", "SNIPERS"], CAMV: ["CAMV", "CAMVRSU"] };
  return aliases5[family]?.includes(model) ? key2 : null;
}
function isSupportEquipment(unit) {
  const name = unit.unitNumber.trim().toUpperCase();
  const model = (unit.modelName || "").trim().toUpperCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  return /^(?:ST|STAND)\s*[-#]?\s*\d{1,6}$/i.test(name) || ["STAND", "STANDS"].includes(model) || /^(?:SOLAR\s*STANDS?(?:\s*72)?|SOLAR\s*POLES?|SKIDS?)(?:\s|[-#])\s*\d+$/i.test(name) || ["SOLAR STAND", "SOLAR STANDS", "SOLAR STANDS 72", "SOLAR STAND 72", "SOLAR POLES & SKIDS", "SOLAR POLE", "SOLAR POLES", "SKID", "SKIDS"].includes(model);
}
function fieldCameraHealth(unit, units, health, now = Date.now()) {
  const unknown22 = (reason2, identity4 = "missing", rows22 = []) => ({ state: "unknown", reason: reason2, identity: identity4, rows: rows22, unitKey: null, checkedAt: null, classification: null });
  if (isSupportEquipment(unit)) return { state: "support", reason: "Support equipment \xB7 0 cameras. Camera online/offline status does not apply. Power health is shown only when a verified power source is linked.", identity: "missing", rows: [], unitKey: null, checkedAt: null, classification: null };
  if (!health) return unknown22("Camera Health is unavailable.");
  if (units.filter((candidate) => candidate.id === unit.id).length !== 1) return unknown22("More than one field record uses this equipment identity.", "ambiguous");
  const association = resolveVerifiedUnitIdentity(unit, health, now);
  if (association.state === "conflict") return unknown22(association.reason, "ambiguous");
  if (association.state === "verified") {
    const rows22 = association.rows, fieldRecorder = fieldRecorderObservation(unit, association.identity, rows22, health, now), observation = fieldRecorder || linkedUnitObservation(rows22, now), raw = classifyCameraUnit(rows22, now);
    const complete = fieldRecorder ? { fieldRecorderVerified: true, state: fieldRecorder.state, providerState: fieldRecorder.providerState, cameraState: "mapping", serviceState: fieldRecorder.serviceState, recorderOffline: fieldRecorder.state === "offline" } : ["field", "unknown"].includes(raw.scope) ? { state: observation.providerState !== "verifying" ? observation.providerState : observation.serviceState === "online" ? "service" : raw.state === "mapping" ? "mapping" : "verifying", providerState: observation.providerState, cameraState: observation.cameraState, serviceState: observation.serviceState } : {};
    const classification2 = { ...raw, ...complete, observation };
    const state2 = observation.state === "online" ? "online" : observation.state === "offline" ? "offline" : "unknown";
    const detectorStates = rows22.map((row2) => cameraState(row2, now));
    const detail = association.identity.kind === "reconeyez_area" ? "Reviewed provider-area group: " + detectorStates.filter((state3) => state3 === "online").length + " of " + rows22.length + " detector records recently online; " + detectorStates.filter((state3) => state3 === "offline").length + " offline; " + detectorStates.filter((state3) => !["online", "offline"].includes(state3)).length + " unverified. Bridge contact is shown separately." : observation.basis === "recorder" ? "This observation describes the recorder. Individual camera channels and video are not verified." : observation.basis === "connection" ? "The saved IP / port observation describes service reachability. Camera video is not verified." : "Expected camera channel coverage is unknown; reported records do not verify every camera or video.";
    const freshness2 = state2 === "unknown" ? " Source records are mixed, stale, missing, or unverified; silence is not a confirmed outage." : "";
    const placement3 = fieldRecorder ? " Current Field installation and exact recorder identity are verified. Legacy provider folder/activation remains recorded separately; this observation does not move equipment." : classification2.scope === "unknown" ? " LOCATION REVIEW: saved placement is unresolved." : ["shop", "inactive"].includes(classification2.scope) ? " PLACEMENT CONFLICT: source inventory says " + classification2.scope.toUpperCase() + " while this record is in the field map. The source observation does not move equipment." : "";
    return { state: state2, reason: detail + freshness2 + placement3, rows: rows22, unitKey: association.identity.unitKeys[0], checkedAt: observation.checkedAt, identity: "matched", classification: classification2, basis: observation.basis, observation, association: association.identity };
  }
  const key2 = scopedFieldIdentity(unit);
  if (!key2) return unknown22("No verified equipment-to-resource association is available for this saved identifier. Review its identity; source status is not inferred from a similar name.");
  if (units.filter((candidate) => canonicalCameraUnit(candidate.unitNumber) === key2).length !== 1 || units.filter((candidate) => candidate.id === unit.id).length !== 1) return unknown22("More than one field record uses this unit identity.", "ambiguous");
  const rows4 = health.rows.filter((row2) => typeof row2.unit === "string" && canonicalCameraUnit(row2.unit) === key2);
  if (!rows4.length) return unknown22("No exact family and unit-number match in Camera Health.");
  const resourceConflict = legacyIdentityConflict(unit.id, rows4, health);
  if (resourceConflict) return unknown22(resourceConflict, "ambiguous");
  if (new Set(rows4.map((row2) => plain(row2.unit))).size !== 1 || new Set(rows4.map((row2) => String(row2.id))).size !== rows4.length || rows4.some((row2) => health.rows.filter((other) => String(other.id) === String(row2.id)).length !== 1)) return unknown22("Camera Health has conflicting or duplicate unit identities.", "ambiguous");
  const safeRows = health.evidenceVersion === 2 ? rows4 : rows4.map((row2) => ({ ...row2, scope: "unknown", activationState: "", evidence: void 0, serviceEvidence: void 0 }));
  const classification = classifyCameraUnit(safeRows, now), active = safeRows.filter((row2) => row2.scope !== "inactive"), cameras = active.filter(cameraRecord);
  const states2 = cameras.map((row2) => cameraState(row2, now));
  const direct = ["SNIPER", "SNIPER2", "SNIPER4", "CAMV"].includes(key2.split("|")[0]);
  const connection = combinedState(safeRows.map((row2) => savedConnectionObservation(row2, now)));
  const operational = ["field", "unknown"].includes(classification.scope);
  const state = direct ? connection === "online" ? "online" : connection === "offline" ? "offline" : "unknown" : operational && states2.includes("offline") ? "offline" : operational && states2.length > 0 && states2.every((s) => s === "online") ? "online" : "unknown";
  const checkedAt = healthObservationTime(direct ? safeRows : cameras, direct ? "connection" : "camera", state, now);
  const location = classification.scope === "unknown" ? " LOCATION REVIEW: saved placement is unresolved." : ["shop", "inactive"].includes(classification.scope) ? " PLACEMENT CONFLICT: camera inventory says " + (classification.scope === "shop" ? "SHOP / ROOT" : "INACTIVE") + " while this unit remains in the field tracker. Confirm its physical placement; a connection result does not move the unit." : "";
  const reason = health.evidenceVersion !== 2 ? "Source-separated observations are not available in this response." : !operational ? "Shop/root or inactive inventory is excluded from operational camera colors." : state === "offline" ? "At least one matched camera/detector has a recent provider OFFLINE observation." : state === "online" ? "Reported camera/detector records are recently ONLINE. Expected channel coverage is unknown; this does not verify every camera." : cameras.length ? "Camera/detector observations are older, missing, or unverified. Silence is not a confirmed outage." : "Camera channel status unavailable. Recorder and service observations remain separate.";
  return { state, identity: "matched", rows: rows4, unitKey: rows4[0].unit, checkedAt, classification, basis: direct ? "connection" : "camera", reason: (direct ? (state === "online" ? "The saved IP / port check responded." : state === "offline" ? "The saved IP / port checks confirmed no response." : "No recent definitive IP / port result is available.") + " This is connection status; camera video is not verified. Location confidence does not change this connection result." : reason) + location };
}
function unitHealthLabel(info) {
  if (info?.state === "support") return "SUPPORT EQUIPMENT \xB7 0 CAMERAS";
  if (info?.observation) return info.observation.label;
  return info?.basis === "connection" ? { online: "IP / PORT ONLINE", offline: "IP / PORT OFFLINE", unknown: "IP / PORT UNKNOWN" }[info.state] : cameraLabels[info?.state || "unknown"];
}
var GpsValidationError = class extends Error {
  statusCode = 400;
  constructor(message) {
    super(message);
    this.name = "GpsValidationError";
  }
};
var decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function numeric(value2, label3, allowText) {
  if (allowText && typeof value2 === "string" && value2.trim() && decimal.test(value2.trim())) value2 = Number(value2.trim());
  if (typeof value2 !== "number" || !Number.isFinite(value2)) throw new GpsValidationError(label3 + " is required and must be a finite number.");
  return value2;
}
function gpsCoordinates(input2, allowText = false) {
  if (!input2 || typeof input2 !== "object" || Array.isArray(input2)) throw new GpsValidationError("GPS coordinates are required.");
  const body = input2;
  const latitude = numeric(body.latitude, "Latitude", allowText);
  const longitude = numeric(body.longitude, "Longitude", allowText);
  if (latitude < -90 || latitude > 90) throw new GpsValidationError("Latitude must be between -90 and 90.");
  if (longitude < -180 || longitude > 180) throw new GpsValidationError("Longitude must be between -180 and 180.");
  const rawAccuracy = body.accuracyM;
  const absentAccuracy = rawAccuracy == null || allowText && typeof rawAccuracy === "string" && !rawAccuracy.trim();
  const accuracyM = absentAccuracy ? null : numeric(rawAccuracy, "GPS accuracy", allowText);
  if (accuracyM !== null && accuracyM < 0) throw new GpsValidationError("GPS accuracy must be zero or greater.");
  return { latitude, longitude, accuracyM };
}
function hasGpsCoordinates(record22) {
  try {
    gpsCoordinates(record22, true);
    return true;
  } catch {
    return false;
  }
}
var uuid = (value2) => typeof value2 === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value2);
var object3 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
var stamp = (value2) => typeof value2 === "string" ? Date.parse(value2) : NaN;
function checkedFieldMap(value2) {
  if (!object3(value2) || !Array.isArray(value2.items) || !object3(value2.summary) || !Number.isFinite(stamp(value2.generatedAt))) throw new Error("Field Map returned an incomplete response.");
  if (value2.placementReviews !== void 0 && (!Array.isArray(value2.placementReviews) || value2.placementReviews.some((row2) => !object3(row2) || typeof row2.unitNumber !== "string" || typeof row2.reason !== "string" || !(row2.placementAuditId === null || typeof row2.placementAuditId === "string")))) throw new Error("Field placement review list is incomplete.");
  const seen = /* @__PURE__ */ new Set();
  for (const item of value2.items) {
    if (!object3(item) || !uuid(item.id) || seen.has(item.id) || typeof item.unitNumber !== "string" || typeof item.status !== "string") throw new Error("Field Map returned inconsistent unit records.");
    seen.add(item.id);
  }
  for (const key2 of ["fieldUnits", "mappedUnits", "unitGps", "missingGps"]) {
    if (!Number.isSafeInteger(value2.summary[key2]) || value2.summary[key2] < 0) throw new Error("Field Map summary is unavailable.");
  }
  if (value2.summary.fieldUnits !== value2.items.length) throw new Error("Field Map returned an incomplete unit list.");
  return value2;
}
function inventoryPlacement(unit) {
  if (unit.effectivePlacement?.contract === "COS_EFFECTIVE_FLEET_PLACEMENT_V1" && ["field", "shop", "unknown"].includes(unit.effectivePlacement.state)) return unit.effectivePlacement.state;
  const value2 = String(unit.placement || unit.currentLocationType || "").toLowerCase();
  return ["shop", "root", "warehouse", "yard"].includes(value2) ? "shop" : ["field", "site"].includes(value2) ? "field" : "unknown";
}
function reconcileFleetSnapshot(rawHealth, rawMap, now = Date.now()) {
  const health = validateCameraHealth(rawHealth), fieldMap = checkedFieldMap(rawMap);
  const inventory = Array.isArray(fieldMap.inventoryItems) ? fieldMap.inventoryItems : fieldMap.items;
  if (new Set(inventory.map((r) => r.id)).size !== inventory.length) throw Error("Fleet inventory contains duplicate equipment identities.");
  if (fieldMap.effectivePlacementVersion === 1) {
    if (inventory.some((r) => r.effectivePlacement?.contract !== "COS_EFFECTIVE_FLEET_PLACEMENT_V1" || !["field", "shop", "unknown"].includes(r.effectivePlacement.state))) throw Error("Fleet placement evidence is incomplete.");
    const fields4 = inventory.filter((r) => inventoryPlacement(r) === "field" && r.activeInventoryEligible !== false);
    if (fields4.length !== fieldMap.items.length || fields4.some((r) => !fieldMap.items.some((f) => f.id === r.id && f.unitNumber === r.unitNumber))) throw Error("Fleet placement population does not match its field list.");
  }
  const changes = /* @__PURE__ */ new Map();
  for (const unit of inventory) {
    const placement3 = unit.activeInventoryEligible === false ? "inactive" : inventoryPlacement(unit), key2 = canonicalCameraUnit(unit.unitNumber);
    if (placement3 === "unknown" || inventory.filter((r) => r.id === unit.id).length !== 1) continue;
    const association = resolveVerifiedUnitIdentity(unit, health, now);
    if (association.state === "verified") {
      const proof = association.identity, rows22 = health.rows.filter((r) => proof.unitKeys.includes(r.unit));
      if (rows22.length === proof.deviceIds.length && rows22.every((r) => proof.deviceIds.includes(String(r.id)))) {
        for (const row2 of rows22) if (row2.scope !== "inactive") changes.set(String(row2.id), placement3);
      }
    }
    if (!key2 || inventory.filter((r) => canonicalCameraUnit(r.unitNumber) === key2).length !== 1) continue;
    const placeholders = health.rows.filter((r) => r.trackerOnly && r.type === "tracker_unit" && canonicalCameraUnit(r.unit) === key2);
    if (placeholders.length === 1 && placeholders[0].scope !== "inactive" && health.rows.filter((r) => canonicalCameraUnit(r.unit) === key2).every((r) => r.trackerOnly)) changes.set(String(placeholders[0].id), placement3);
  }
  const rows4 = health.rows.map((r) => changes.has(String(r.id)) ? { ...r, scope: changes.get(String(r.id)) } : r);
  const count6 = (scope) => rows4.filter((r) => r.scope === scope).length;
  const next = health.evidenceVersion === 2 ? { ...health, rows: rows4, online: rows4.filter((r) => r.scope === "field" && r.status === "online").length, offline: rows4.filter((r) => r.scope === "field" && r.status === "offline").length, review: rows4.filter((r) => r.scope === "field" && r.status === "review").length, fieldDevices: count6("field"), shopRoot: count6("shop"), inventory: { allRecords: rows4.length, activeFieldRecords: count6("field"), activeShopRecords: count6("shop"), inactiveRecords: count6("inactive"), unknownScopeRecords: count6("unknown") } } : health;
  validateCameraHealth(next);
  return { health: { ...next, fleetFieldUnits: inventory }, fieldMap, readAt: new Date(now).toISOString() };
}
var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function manualShopItems(value2) {
  if (value2?.contract !== "COS_FLEET_SHOP_OVERRIDES_V1" || !Array.isArray(value2.items) || value2.items.length > 1e4 || value2.items.some((r) => !uuid2(r.unitId) || !uuid2(r.auditId) || typeof r.unitNumber !== "string" || !r.unitNumber.trim() || r.placement !== "SHOP" || !Number.isFinite(Date.parse(r.recordedAt))) || value2.items.some((r) => r.sourceBindings !== void 0 && (!Array.isArray(r.sourceBindings) || r.sourceBindings.length > 1e4 || r.sourceBindings.some((b) => !/^(?:[1-9]\d*)$/.test(b.productId) || !/^(?:[a-f0-9]{64})$/.test(b.sourceSha256)))) || new Set(value2.items.map((r) => r.unitId)).size !== value2.items.length) throw Error("Manual Shop placement is unavailable.");
  return value2.items;
}
function manualShopInventory(upload, receipt2) {
  if (!upload?.records || !receipt2) return upload;
  const moves = new Map(manualShopItems(receipt2).map((r) => [r.unitId, r]));
  let count6 = 0;
  const records2 = upload.records.map((r) => {
    const m = [...moves.values()].find((m2) => (m2.sourceBindings || []).some((b) => b.productId === r.productId && (b.sourceSha256 === upload.sourceSha256 || upload.source === "mhelpdesk_api" && b.sourceUnitNumber === r.unitNumber))) || (r.binding?.state === "linked" && r.binding.unitIds?.length === 1 ? moves.get(r.binding.unitIds[0]) : null);
    if (!m || r.placement === "SHOP") return r;
    count6++;
    return { ...r, placement: "SHOP", cosManualShopAuditId: m.auditId };
  });
  if (!count6) return upload;
  const summary = { ...upload.summary, fieldRecords: records2.filter((r) => r.placement === "FIELD").length, shopRecords: records2.filter((r) => r.placement === "SHOP").length, unflaggedFieldRecords: records2.filter((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED").length, unflaggedShopRecords: records2.filter((r) => r.placement === "SHOP" && r.uploadLifecycle === "UNFLAGGED").length };
  return { ...upload, records: records2, summary, cosManualShopCount: count6, cosPlacementBasis: "Accepted mHelp inventory plus confirmed COS Shop moves" };
}
function recordedAddressText(value2) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) return "";
  const address3 = value2, part = (key2) => typeof address3[key2] === "string" && address3[key2].length <= 600 ? address3[key2].trim() : "";
  return [part("street"), part("city"), [part("state"), part("zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
var text2 = (value2, max = 512) => typeof value2 === "string" && value2.length <= max;
var strings = (value2) => Array.isArray(value2) && value2.length <= 1001 && value2.every((v) => text2(v, 180));
var uuid3 = (value2) => typeof value2 === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value2);
function readRecordedRoster(value2, inventory) {
  if (value2 === void 0) return { roster: null, error: null };
  const bad2 = () => ({ roster: null, error: "The combined equipment roster could not be verified. Recorded equipment totals are unavailable." });
  if (!value2 || typeof value2 !== "object") return bad2();
  const v = value2;
  if (v.contract !== "COS_COMBINED_FLEET_ROSTER_V1" || v.countBasis !== "equipment_records_with_reviewed_cross_source_links" || v.physicalDeduplication !== "incomplete" || !Array.isArray(v.items) || v.items.length > 1e4 || !v.summary || typeof v.summary !== "object") return bad2();
  const ids = /* @__PURE__ */ new Set(), unitIds = /* @__PURE__ */ new Set();
  for (const r of v.items) {
    if (!r || !text2(r.id, 180) || !r.id || ids.has(r.id) || !["unit", "source_equipment", "identity_review"].includes(r.kind) || !text2(r.unitNumber, 180) || !r.unitNumber || !["field", "shop", "unknown"].includes(r.placement) || !["active", "do_not_use", "missing", "retired", "decommissioned"].includes(r.lifecycle) || typeof r.active !== "boolean" || !["mhelpdesk_api", "owner_supplied_mhelp_export", "current_tracker", "recorded_inventory", "owner"].includes(r.source) || r.observedAt !== null && (!text2(r.observedAt, 64) || !Number.isFinite(Date.parse(r.observedAt))) || !strings(r.productIds) || !strings(r.sourceRecordIds) || !strings(r.representedUnitIds) || r.customer !== null && !text2(r.customer) || r.reviewReason !== null && !text2(r.reviewReason, 2e3) || r.family !== void 0 && !text2(r.family, 180) || r.category != null && !text2(r.category, 180) || r.displayUnitNumber !== void 0 && !text2(r.displayUnitNumber, 180)) return bad2();
    if (r.active && r.lifecycle !== "active" || r.kind === "identity_review" && r.placement !== "unknown" || r.kind === "source_equipment" && r.placement === "unknown") return bad2();
    if (r.kind === "unit" && (r.id !== "cos_unit:" + r.unitId || !uuid3(r.unitId) || !r.unit || r.unit.id !== r.unitId || r.unit.unitNumber !== r.unitNumber || inventoryPlacement(r.unit) !== r.placement || typeof r.unit.activeInventoryEligible === "boolean" && r.unit.activeInventoryEligible !== r.active || unitIds.has(r.unitId))) return bad2();
    if (r.kind !== "unit" && (r.unitId !== null || r.unit !== null || !r.id.startsWith("mhelp_product:") && !r.id.startsWith("tracker_row:"))) return bad2();
    if (r.sourceAddress !== null && (!r.sourceAddress || typeof r.sourceAddress !== "object" || Array.isArray(r.sourceAddress))) return bad2();
    if (r.recordedSourcePlacement !== void 0 && (!["field", "shop", "unknown"].includes(r.recordedSourcePlacement) || r.kind !== "identity_review" || r.placement !== "unknown")) return bad2();
    if (r.candidateUnitIds !== void 0 && (!Array.isArray(r.candidateUnitIds) || r.candidateUnitIds.length > 1001 || !r.candidateUnitIds.every(uuid3))) return bad2();
    if (r.candidatePlacements !== void 0 && (!Array.isArray(r.candidatePlacements) || r.candidatePlacements.length > 1001 || r.candidatePlacements.some((p) => !p || !uuid3(p.unitId) || !r.candidateUnitIds?.includes(p.unitId) || !text2(p.unitNumber, 180) || !["field", "shop", "unknown"].includes(p.placement) || !text2(p.source, 180) || p.observedAt !== null && (!text2(p.observedAt, 64) || !Number.isFinite(Date.parse(p.observedAt)))))) return bad2();
    ids.add(r.id);
    if (r.unitId) unitIds.add(r.unitId);
  }
  for (const key2 of ["totalRecords", "activeRecords", "field", "shop", "review", "excludedLifecycle", "sourceOnlyRecords", "linkedUnitRecords"]) if (!Number.isSafeInteger(v.summary[key2]) || v.summary[key2] < 0 || v.summary[key2] > 1e4) return bad2();
  if (v.summary.totalRecords !== v.items.length || v.summary.activeRecords !== v.items.filter((r) => r.active).length || v.summary.field !== v.items.filter((r) => r.active && r.placement === "field").length || v.summary.shop !== v.items.filter((r) => r.active && r.placement === "shop").length) return bad2();
  if (v.summary.review !== v.items.filter((r) => r.active && r.placement === "unknown").length || v.summary.excludedLifecycle !== v.items.filter((r) => !r.active).length || v.summary.sourceOnlyRecords !== v.items.filter((r) => r.kind !== "unit").length || v.summary.linkedUnitRecords !== v.items.filter((r) => r.kind === "unit").length) return bad2();
  if (inventory && (inventory.length !== unitIds.size || new Set(inventory.map((row2) => row2.id)).size !== inventory.length || inventory.some((row2) => !v.items.some((item) => item.kind === "unit" && item.unitId === row2.id && item.unitNumber === row2.unitNumber && item.placement === inventoryPlacement(row2) && (typeof row2.activeInventoryEligible !== "boolean" || item.active === row2.activeInventoryEligible))))) return bad2();
  return { roster: v, error: null };
}
var ROUTER_FRESHNESS_MS = 20 * 60 * 1e3;
function routerStatus(row2, now = Date.now()) {
  const observed2 = row2.checkedAt ? Date.parse(row2.checkedAt) : NaN;
  if (!Number.isFinite(observed2) || observed2 > now) return "unknown";
  if (now - observed2 > ROUTER_FRESHNESS_MS) return "stale";
  return row2.probeStatus === "online" ? "reachable" : row2.probeStatus === "offline" ? "unreachable" : "unknown";
}
function isCurrentFieldPin(unit) {
  return unit.locationVerification === "owner_verified" && Boolean(unit.address?.trim()) && hasGpsCoordinates(unit) && typeof unit.locationVerifiedAt === "string" && Number.isFinite(Date.parse(unit.locationVerifiedAt)) && unit.locationVerifiedAt === unit.gpsRecordedAt;
}
function historicalFieldCoordinates(unit) {
  if (isCurrentFieldPin(unit)) return null;
  const saved = { latitude: unit.historicalLatitude, longitude: unit.historicalLongitude };
  if (hasGpsCoordinates(saved)) return { latitude: Number(saved.latitude), longitude: Number(saved.longitude), source: unit.historicalCoordinateSource || "Stored source", recordedAt: unit.historicalRecordedAt || null };
  return !isCurrentFieldPin(unit) && hasGpsCoordinates(unit) ? { latitude: Number(unit.latitude), longitude: Number(unit.longitude), source: unit.coordinateSource || "Stored source", recordedAt: unit.gpsRecordedAt || null } : null;
}
function locationExplanation(unit) {
  if (unit.locationVerification === "address_changed") return "The recorded address changed after this pin was saved. Verify the new location before placing it on the map.";
  const lookup = unit.placementSource === "owner" ? unit.locationGeocode : unit.locationImportedGeocode || unit.locationGeocode;
  if (lookup) {
    const status2 = lookup.status;
    if (status2 === "unavailable") return "Saved address lookup results are temporarily unavailable. Refresh later; existing verified locations and camera health are unchanged.";
    if (status2 === "not_requested") return "This placement predates automatic address lookup. Open Camera Health, review the complete installation address and save it to create the map pin.";
    if (status2 === "deferred") return "The free address lookup is waiting for its safe retry window. COS will retry automatically without paid lookups.";
    if (status2 === "held") return "Source or placement verification is pending. No approximate point is shown until the current installation source is verified.";
    if (status2 === "pending") return "Installation saved. Address lookup is pending; background processing runs every 15 minutes.";
    if (status2 === "invalid_address") return "Add a complete installation street, city, state and ZIP in Camera Health \u2192 Edit field address.";
    if (status2 === "no_match") return "No single exact address matched. Correct the installation address or manually verify the installation pin.";
    if (status2 === "provider_error") return lookup.attempts >= 3 ? "Address lookup failed after three attempts. Correct and save the address to retry, or verify the installation pin." : "The address service is unavailable. COS will retry automatically; camera health is unchanged.";
  }
  if (isCurrentFieldPin(unit)) return unit.coordinateSource === "site" ? "An owner confirmed an address-derived pin. It is not a live GPS observation." : "An owner confirmed this pin for the recorded address. It is not live router GPS.";
  if (historicalFieldCoordinates(unit)) return "Historical coordinates are preserved for review and excluded from the current map and nearby-unit results. Confirm the actual installation location before using them.";
  return unit.address?.trim() ? "Address-based location. Coordinates pending verification." : "No installation address or coordinates are recorded.";
}
var rules = { battery_soc: ["%", 0, 100], battery_voltage: ["V", 0, 200], battery_current: ["A", -1e4, 1e4], battery_power: ["W", -1e6, 1e6], solar_power: ["W", 0, 1e6], load_power: ["W", -1e6, 1e6], low_voltage_alarm: ["state", 0, 2], low_soc_alarm: ["state", 0, 2], high_voltage_alarm: ["state", 0, 2] };
function safeVrmPower(value2, items, now = Date.now()) {
  if (!Array.isArray(value2) || value2.length > 1e3) throw Error("Power evidence unavailable");
  const seen = /* @__PURE__ */ new Set();
  return value2.flatMap((r) => {
    if (!r || !Number.isSafeInteger(r.installationId) || seen.has(r.installationId) || !Array.isArray(r.measurements) || r.measurements.length > 40) throw Error("Power evidence inconsistent");
    seen.add(r.installationId);
    if (items.filter((i) => i.installationId === r.installationId && i.name === r.name).length !== 1 || typeof r.name !== "string" || !/^HELIOS\s+\d{1,3}$/i.test(r.name)) return [];
    const measurements = r.measurements.map((m) => {
      const rule = rules[m?.metric], time3 = Date.parse(m?.observedAt);
      if (!rule || m.unit !== rule[0] || typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < rule[1] || m.value > rule[2] || !Number.isFinite(time3) || time3 < Date.UTC(2e3, 0, 1) || time3 > now + 3e5 || !Number.isSafeInteger(m.instance) || m.instance < 0 || m.instance > 1e3 || !["system", "battery", "solarcharger"].includes(m.source)) throw Error("Power measurement invalid");
      return { metric: m.metric, value: m.value, unit: m.unit, observedAt: m.observedAt, instance: m.instance, source: m.source };
    });
    const error = r.errorCode;
    if (error !== null && !["access", "provider", "rate_limit", "invalid_response", "no_data"].includes(error)) throw Error("Power read state invalid");
    if (r.lastAttemptAt !== null && (typeof r.lastAttemptAt !== "string" || !Number.isFinite(Date.parse(r.lastAttemptAt)))) throw Error("Power read time invalid");
    return [{ installationId: r.installationId, name: r.name, measurements, lastAttemptAt: r.lastAttemptAt, errorCode: error }];
  });
}
var VRM_MAX_INSTALLATIONS = 5e3;
var vrmPortalUrl = (id15) => "https://vrm.victronenergy.com/installation/" + id15 + "/dashboard";
var validInstallationId = (id15) => typeof id15 === "number" && Number.isSafeInteger(id15) && id15 > 0;
var validVrmName = (name) => typeof name === "string" && name.trim() === name && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
var validTime = (value2) => value2 === null || typeof value2 === "string" && value2.length <= 32 && Number.isFinite(Date.parse(value2));
var unconfiguredVrmSync = () => ({ state: "not_configured", lastAttemptAt: null, lastSuccessAt: null, nextSyncAt: null, error: null, scheduleActive: false, connectionConfigured: false });
function validVrmEmbed(value2, id15) {
  if (typeof value2 !== "string" || value2.length > 2048 || !validInstallationId(id15)) return false;
  try {
    const url = new URL(value2);
    return url.origin === "https://vrm.victronenergy.com" && !url.username && !url.password && !url.hash && new RegExp("^/installation/" + id15 + "/embed/[A-Za-z0-9_-]+/?$").test(url.pathname);
  } catch {
    return false;
  }
}
function readVrmFleetConfig(value2) {
  const data = value2;
  if (!Array.isArray(data?.items) || data.items.length > VRM_MAX_INSTALLATIONS) throw new Error("VRM returned an invalid installation list.");
  const seen = /* @__PURE__ */ new Set();
  const items = data.items.map((item) => {
    if (!item || !validInstallationId(item.installationId) || seen.has(item.installationId) || !validVrmName(item.name) || item.portalUrl !== vrmPortalUrl(item.installationId) || item.embedUrl !== null && !validVrmEmbed(item.embedUrl, item.installationId) || item.number !== void 0 && !validInstallationId(item.number) || item.available !== void 0 && typeof item.available !== "boolean" || item.sharingEnabled !== void 0 && item.sharingEnabled !== null && typeof item.sharingEnabled !== "boolean" || item.lastSeenAt !== void 0 && !validTime(item.lastSeenAt) || item.available === false && item.embedUrl !== null) throw new Error("VRM returned inconsistent installation links.");
    seen.add(item.installationId);
    return {
      installationId: item.installationId,
      name: item.name,
      portalUrl: item.portalUrl,
      embedUrl: item.embedUrl,
      ...item.sharingEnabled === void 0 ? {} : { sharingEnabled: item.sharingEnabled },
      ...item.number === void 0 ? {} : { number: item.number },
      ...item.available === void 0 ? {} : { available: item.available },
      ...item.lastSeenAt === void 0 ? {} : { lastSeenAt: item.lastSeenAt }
    };
  });
  const sync = data.sync ?? unconfiguredVrmSync();
  if (!sync || !["not_configured", "idle", "syncing", "current", "stale", "error"].includes(sync.state) || ![sync.lastAttemptAt, sync.lastSuccessAt, sync.nextSyncAt].every(validTime) || typeof sync.scheduleActive !== "boolean" || sync.connectionConfigured !== void 0 && typeof sync.connectionConfigured !== "boolean" || sync.error !== null && (typeof sync.error !== "string" || sync.error.length > 300)) throw new Error("VRM returned invalid sync status.");
  return { items, sync: {
    state: sync.state,
    lastAttemptAt: sync.lastAttemptAt,
    lastSuccessAt: sync.lastSuccessAt,
    nextSyncAt: sync.nextSyncAt,
    error: sync.error,
    scheduleActive: sync.scheduleActive,
    ...sync.connectionConfigured === void 0 ? {} : { connectionConfigured: sync.connectionConfigured }
  } };
}
var combine = (states2) => states2.includes("offline") ? "offline" : states2.length && states2.every((x) => x === "online") ? "online" : "unknown";
function fleetDashboardRows(units, health, routers, vrm, now = Date.now()) {
  const power = vrm && Array.isArray(vrm.items) && Array.isArray(vrm.power) ? safeVrmPower(vrm.power, vrm.items, now) : [];
  return units.map((unit) => {
    const key2 = canonicalCameraUnit(unit.unitNumber), family = key2?.split("|")[0] || unit.modelName || "Other equipment", support = isSupportEquipment(unit), placement3 = inventoryPlacement(unit);
    const camera = fieldCameraHealth(unit, units, health, now), linkedRouters = (routers || []).filter((r) => r.match === "exact_name" && r.candidateUnit?.id === unit.id);
    const routerStates = linkedRouters.map((r) => routerStatus(r, now)).map((s) => s === "reachable" ? "online" : s === "unreachable" ? "offline" : "unknown");
    const matches2 = key2?.startsWith("HELIOS|") ? power.filter((r) => canonicalCameraUnit(r.name) === key2) : [];
    const p = matches2.length === 1 && vrm.items.filter((item) => canonicalCameraUnit(item.name) === key2).length === 1 && units.filter((u) => canonicalCameraUnit(u.unitNumber) === key2).length === 1 ? matches2[0] : null;
    const installation2 = p ? vrm.items.find((item) => item.installationId === p.installationId && canonicalCameraUnit(item.name) === key2) : null;
    const vrmInstallation = installation2 ? { ...installation2, embedUrl: installation2.sharingEnabled !== false && installation2.available !== false && validVrmEmbed(installation2.embedUrl, installation2.installationId) ? installation2.embedUrl : null } : null;
    let batteryState = "not_available", batteryPercent = null, batteryReadings = [];
    const batteryReadIssue = key2?.startsWith("HELIOS|") ? p?.errorCode || vrm?.sync?.error || vrm?.sync?.state === "error" ? "Latest Victron read unavailable" : vrm?.sync?.state === "stale" ? "Victron sync is stale" : null : null;
    if (key2?.startsWith("HELIOS|")) {
      batteryState = "unknown";
      batteryReadings = (p?.measurements || []).filter((m) => m.metric === "battery_soc").map((m) => ({ source: "Victron \xB7 " + m.source + " " + m.instance, percent: m.value, observedAt: cameraTimestamp(m.observedAt, now).at, fresh: cameraTimestamp(m.observedAt, now).fresh }));
      if (p && !batteryReadIssue) {
        const recent = p.measurements.filter((m) => cameraTimestamp(m.observedAt, now).fresh), soc = recent.filter((m) => m.metric === "battery_soc");
        batteryPercent = soc.length ? Math.min(...soc.map((m) => m.value)) : null;
        batteryState = recent.some((m) => m.unit === "state" && m.value > 0) || batteryPercent !== null && batteryPercent < 20 ? "offline" : batteryPercent !== null ? "online" : "unknown";
      }
    } else if (key2?.startsWith("RECON2|")) {
      const batteryRows = camera.identity === "matched" ? camera.rows.filter((r) => r.evidence?.source === "Reconeyez" && r.batteryEvidence) : [];
      const readings = batteryRows.map((r) => r.batteryEvidence).filter(Boolean);
      batteryReadings = batteryRows.filter((r) => r.batteryEvidence.percent !== null).map((r) => ({ source: "Reconeyez \xB7 " + r.name, percent: r.batteryEvidence.percent, observedAt: cameraTimestamp(r.batteryEvidence.percentObservedAt, now).at, fresh: cameraTimestamp(r.batteryEvidence.percentObservedAt, now).fresh }));
      const values = readings.filter((b) => b?.percent !== null && cameraTimestamp(b?.percentObservedAt, now).fresh).map((b) => b.percent);
      batteryPercent = values.length ? Math.min(...values) : null;
      batteryState = combine(readings.map((b) => cameraTimestamp(b?.statusObservedAt, now).fresh && b?.status ? b.status === "normal" ? "online" : "offline" : cameraTimestamp(b?.percentObservedAt, now).fresh && b?.percent !== null ? b.percent < 20 ? "offline" : "online" : "unknown"));
    }
    const locationVerified = isCurrentFieldPin(unit), locationNeedsReview = placement3 === "field" && !locationVerified;
    const review = [...placement3 === "unknown" ? ["Placement is unresolved. Check tracker and current mHelpDesk assignment."] : [], ...camera.state === "unknown" ? [camera.reason] : [], ...locationNeedsReview ? [locationExplanation(unit)] : [], ...unit.mhelpLocationReviewReason ? [String(unit.mhelpLocationReviewReason)] : []];
    const providers = [...new Set(camera.rows.map((r) => r.evidence?.source).filter(Boolean))];
    return { unit, id: unit.id, name: unit.unitNumber, displayName: unit.uploadDisplayUnitNumber || unit.unitNumber, family, provider: providers.join(" / ") || "Unmatched provider", placement: placement3, retired: unit.activeInventoryEligible === false || ["retired", "decommissioned", "deleted", "stolen"].includes(String(unit.status || "")), support, camera, cameraState: camera.state, routerState: routers ? combine(routerStates) : "unknown", batteryState, batteryPercent, batteryReadIssue, batteryReadings, routers: linkedRouters, power: p, vrmInstallation, locationVerified, locationNeedsReview, review };
  });
}
var record = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var nonnegative = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var product = /^[1-9][0-9]{0,14}$/;
function readMhelpInventoryAuthority(value2, now = Date.now()) {
  if (!record(value2) || value2.contract !== "COS_MHELP_UPLOAD_INVENTORY_V1" || value2.countBasis !== "mhelp_product_records_not_unique_physical_units" || typeof value2.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value2.sourceSha256) || typeof value2.receivedAt !== "string" || !Number.isFinite(Date.parse(value2.receivedAt)) || !Number.isFinite(now) || Date.parse(value2.receivedAt) > now + 6e4 || !record(value2.summary) || !Array.isArray(value2.records)) return null;
  const s = value2.summary, records2 = value2.records;
  if (!nonnegative(s.totalRecords) || !nonnegative(s.fieldRecords) || !nonnegative(s.shopRecords) || !nonnegative(s.unflaggedFieldRecords) || !nonnegative(s.doNotUseRecords) || !nonnegative(s.missingRecords) || s.totalRecords !== records2.length || s.totalRecords !== s.fieldRecords + s.shopRecords || s.unflaggedFieldRecords > s.fieldRecords || s.doNotUseRecords + s.missingRecords > s.totalRecords) return null;
  const seen = /* @__PURE__ */ new Set();
  let field5 = 0, shop = 0, fieldActive = 0, inactive = 0;
  for (const item of records2) {
    if (!record(item) || typeof item.productId !== "string" || !product.test(item.productId) || seen.has(item.productId) || item.recordId !== "mhelp_product:" + item.productId || !["FIELD", "SHOP"].includes(item.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(item.uploadLifecycle)) return null;
    seen.add(item.productId);
    if (item.placement === "FIELD") {
      field5++;
      if (item.uploadLifecycle === "UNFLAGGED") fieldActive++;
    } else shop++;
    if (item.uploadLifecycle !== "UNFLAGGED") inactive++;
  }
  if (field5 !== s.fieldRecords || shop !== s.shopRecords || fieldActive !== s.unflaggedFieldRecords || inactive !== s.doNotUseRecords + s.missingRecords) return null;
  const live = value2.source === "mhelpdesk_api";
  const observedAt2 = live ? value2.lastApiReadAt : value2.receivedAt;
  if (typeof observedAt2 !== "string" || !Number.isFinite(Date.parse(observedAt2)) || Date.parse(observedAt2) > now + 6e4) return null;
  return {
    total: records2.length,
    field: field5,
    shop,
    inactive,
    fieldActive,
    ...live ? { live: true } : {},
    sourceSha256: value2.sourceSha256,
    receivedAt: observedAt2,
    // The saved upload is historical evidence, not proof of a live vendor read.
    stale: now - Date.parse(observedAt2) > (live ? 45 * 60 * 1e3 : 24 * 60 * 60 * 1e3)
  };
}
function fieldProductEvidence(row2, state, now = Date.now(), exact8 = null, requiredConnectionUnavailable = false) {
  if (exact8 && exact8.status !== "unknown" && exact8.status === state && exact8.resourceId && cameraTimestamp(exact8.checkedAt, now).fresh) {
    return {
      gap: null,
      association: "exact_product_id_tracker_endpoint",
      basis: "connection",
      observedAt: exact8.checkedAt,
      video: "not_verified",
      observations: [{ resourceId: exact8.resourceId, source: "Saved TCP/service-port check", kind: "connection", observedAt: exact8.checkedAt, fresh: true, reportedStatus: exact8.status, currentState: exact8.status }]
    };
  }
  if (exact8?.status === "unknown" && state === "unverified") {
    return {
      gap: "no_current_reading",
      association: "exact_product_id_tracker_endpoint",
      basis: "connection",
      observedAt: null,
      video: "not_verified",
      observations: []
    };
  }
  if (requiredConnectionUnavailable && state === "unverified") {
    return {
      gap: "no_current_reading",
      association: "product_id_connection_unavailable",
      basis: "connection",
      observedAt: null,
      video: "not_verified",
      observations: []
    };
  }
  const camera = row2?.camera, linked = Boolean(camera?.association);
  const observations = [];
  if (linked) for (const resource of camera.rows) {
    for (const [kind6, evidence] of [["provider", resource.evidence], ["connection", resource.serviceEvidence]]) {
      if (!evidence || evidence.kind === "unknown") continue;
      const stamp22 = cameraTimestamp(evidence.observedAt, now);
      observations.push({
        resourceId: String(resource.id),
        source: evidence.source,
        kind: kind6 === "connection" ? "connection" : evidence.resource || "unknown",
        observedAt: stamp22.at,
        fresh: stamp22.fresh,
        reportedStatus: evidence.status,
        currentState: kind6 === "connection" ? savedConnectionObservation(resource, now) : evidence.resource === "camera" || evidence.resource === "detector" ? cameraState(resource, now) : providerState(resource, now)
      });
    }
  }
  const basis = camera?.basis || null;
  const selected = observations.filter((o) => basis === "connection" ? o.kind === "connection" : basis === "recorder" ? o.kind === "recorder" : basis === "camera" ? ["camera", "detector"].includes(o.kind) : o.kind !== "connection");
  const gap = state === "support" ? "not_applicable" : state === "inactive" ? "inactive" : state === "review" || state === "unlinked" || !linked ? "device_link_needed" : state === "online" || state === "offline" ? null : selected.some((o) => o.fresh) ? "incomplete_check" : "no_current_reading";
  return {
    gap,
    association: linked ? camera.association.kind : null,
    basis: linked ? basis : null,
    observedAt: linked ? cameraTimestamp(camera.checkedAt, now).at : null,
    video: "not_verified",
    observations
  };
}
var CAMERA_FRESH_MS2 = 20 * 60 * 1e3;
var EXACT_PRODUCT_CONNECTION_CONTRACT = "COS_EXACT_PRODUCT_CONNECTIONS_V2";
var ID = /^[1-9][0-9]{0,14}$/;
var HASH = /^[a-f0-9]{64}$/;
var SOURCE_FRESH_MS = 30 * 60 * 1e3;
var object4 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
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
var deviceId = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && ID.test(v) ? v : null;
function readExactProductConnections(value2, sourceSha256, expectedFieldIds, now = Date.now()) {
  if (!object4(value2) || value2.contract !== EXACT_PRODUCT_CONNECTION_CONTRACT || value2.sourceSha256 !== sourceSha256 || !HASH.test(sourceSha256) || !safeTime(value2.trackerVerifiedAt, now, SOURCE_FRESH_MS) || !Array.isArray(value2.items) || value2.items.length < expectedFieldIds.length || value2.items.length > 1e4) return null;
  const expected = new Set(expectedFieldIds);
  if (expected.size !== expectedFieldIds.length) return null;
  const result = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  for (const raw of value2.items) {
    if (!object4(raw) || !ID.test(raw.productId) || seen.has(raw.productId) || !["online", "offline", "unknown"].includes(raw.status) || raw.basis !== "tcp_service_port" || typeof raw.reason !== "string" || raw.reason.length > 300 || !(raw.resourceId === null || deviceId(raw.resourceId) === raw.resourceId)) return null;
    if (raw.status === "unknown" && (raw.resourceId !== null || raw.checkedAt !== null)) return null;
    const observed2 = raw.status === "unknown" ? null : cameraTimestamp(raw.checkedAt, now);
    if (raw.status !== "unknown" && (!raw.resourceId || !observed2?.at)) return null;
    seen.add(raw.productId);
    if (expected.has(raw.productId)) result.set(raw.productId, observed2 && !observed2.fresh ? unknown(raw.productId, "The saved connection check has expired; awaiting the next automatic check.") : raw);
  }
  return result.size === expected.size ? result : null;
}
var sourceReview = {
  category: "source_review",
  label: "Source records need review",
  responsibleRole: "Owner",
  nextStep: "Compare this Product ID with the existing tracker, mHelpDesk and COS equipment records. Use the existing review process to confirm its identity and placement."
};
var ownershipReview = {
  category: "endpoint_ownership",
  label: "Endpoint ownership needs review",
  responsibleRole: "IT and Owner",
  nextStep: "IT: identify which exact Product ID owns the saved endpoint. Owner: review the conflicting records before any connection is assigned."
};
var knownReasons = {
  "Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.": sourceReview,
  "Equipment identity or placement is held for review.": sourceReview,
  "No verified public tracker IP is available for this Product ID.": {
    category: "tracker_ip",
    label: "Tracker IP not verified",
    responsibleRole: "IT",
    nextStep: "Confirm the current network assignment for this exact Product ID. Submit any tracker correction through the existing review process."
  },
  "Another Product ID claims this tracker IP; verify endpoint ownership.": ownershipReview,
  "More than one saved endpoint claims this tracker IP; verify exact device ownership.": ownershipReview,
  "No saved camera endpoint matches the current tracker IP.": {
    category: "saved_endpoint",
    label: "Saved connection needs review",
    responsibleRole: "IT",
    nextStep: "Review the saved camera connection for this exact Product ID and compare it with the current tracker record."
  },
  "No fresh, completed, exact-target TCP/service-port check is available.": {
    category: "saved_check",
    label: "Saved check needs review",
    responsibleRole: "IT",
    nextStep: "Open the existing unit or source record and review its last saved check and connection settings. A more specific cause has not been established."
  },
  "The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.": {
    category: "source_unavailable",
    label: "Connection source unavailable",
    responsibleRole: "IT",
    nextStep: "Refresh the Fleet view once. If this message remains, check whether COS can read the current tracker and saved camera checks."
  }
};
var knownReason = (reason) => typeof reason === "string" && Object.hasOwn(knownReasons, reason) ? knownReasons[reason] : void 0;
var SOURCE_UNAVAILABLE_REASON = "The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.";
function fieldProductFollowUp(state, reason, exactUnknownReason, directSourceUnavailable = false) {
  if (state === "online" || state === "offline") return directSourceUnavailable ? { ...knownReasons[SOURCE_UNAVAILABLE_REASON] } : null;
  const exact8 = knownReason(exactUnknownReason);
  if (state === "support") return exact8 && ["source_review", "endpoint_ownership"].includes(exact8.category) ? { ...exact8 } : null;
  if (state === "inactive") return {
    category: "lifecycle_review",
    label: "Inactive record needs review",
    responsibleRole: "Owner",
    nextStep: "Review the existing Missing, Do Not Use or inactive restriction before returning this equipment to operational use."
  };
  if (state === "review") return { ...sourceReview };
  if (!["unverified", "unlinked"].includes(state)) return null;
  const known = knownReason(reason);
  if (known) return { ...known };
  if (state === "unlinked") return {
    category: "device_link",
    label: "Device link needs review",
    responsibleRole: "IT and Owner",
    nextStep: "Review the exact Product ID and its existing COS equipment and device records. Confirm the association through the existing review process."
  };
  return {
    category: "evidence_review",
    label: "Saved evidence needs review",
    responsibleRole: "IT",
    nextStep: "Open the existing unit or source record and review the saved evidence for this Product ID. A more specific cause has not been established."
  };
}
var PROVIDER_REPORTED = "Provider-reported, not direct-connection verified. ";
var DIRECT_SOURCE_GAP = "No direct connection check is available (the Product-ID connection source is unavailable, stale or does not match the current inventory). ";
var CURRENT_SOURCE_CONFLICT = "Current direct connection and verified provider status disagree. No outage is assigned until the sources agree. ";
var fieldHealthLabels = { online: "Online", offline: "Offline", unverified: "Health unverified", support: "Solar / support \u2014 no cameras", unlinked: "Health not linked", review: "Identity / placement review", inactive: "Do Not Use / Missing / inactive" };
function mhelpFieldHealth(value2, roster, rows4, now = Date.now(), exactConnectionReceipt = void 0) {
  const authority = readMhelpInventoryAuthority(value2, now);
  if (!authority || !roster || !readRecordedRoster(roster).roster) return null;
  const products = value2.records.filter((item) => item.placement === "FIELD");
  const counts2 = Object.fromEntries(Object.keys(fieldHealthLabels).map((key2) => [key2, 0]));
  const connections = readExactProductConnections(exactConnectionReceipt, authority.sourceSha256, products.map((product22) => product22.productId), now);
  const items = products.map((product22) => {
    const related = roster.items.filter((item) => item.productIds.includes(product22.productId));
    const record22 = related.length === 1 ? related[0] : null;
    const matches2 = record22?.unitId ? rows4.filter((row22) => row22.id === record22.unitId) : [];
    const row2 = matches2.length === 1 ? matches2[0] : null;
    const binding = product22.binding;
    const label3 = typeof product22.unitNumber === "string" && product22.unitNumber.trim() ? product22.unitNumber : "Product " + product22.productId;
    const exact8 = connections?.get(product22.productId);
    const support = Boolean(row2?.support) || isSupportEquipment({ id: product22.recordId, unitNumber: label3, modelName: typeof product22.category === "string" ? product22.category : void 0 });
    const exactResourceVerified = Boolean(record22?.kind === "unit" && row2?.camera.association && exact8?.resourceId && row2.camera.association.deviceIds.includes(String(exact8.resourceId)));
    const exactAllowed = Boolean(exact8 && exact8.status !== "unknown" && !support && related.length === 1 && record22?.kind === "unit" && row2 && exactResourceVerified && record22.placement === "field" && record22.active && record22.lifecycle === "active" && record22.productIds.length === 1 && record22.productIds[0] === product22.productId && row2.placement === "field" && !row2.retired && binding?.state === "linked" && Array.isArray(binding.unitIds) && binding.unitIds.includes(record22.unitId));
    const directSourceUnavailable = exactConnectionReceipt !== void 0 && !connections;
    const reviewedProvider = Boolean(record22?.kind === "unit" && row2 && row2.camera.association && ["online", "offline"].includes(row2.cameraState));
    let state, reason;
    if (product22.uploadLifecycle !== "UNFLAGGED") {
      state = "inactive";
      reason = product22.uploadLifecycle === "MISSING" ? "Marked Missing in the reviewed mHelpDesk source." : "Marked Do Not Use in the reviewed mHelpDesk source.";
    } else if (record22?.kind === "identity_review" || record22 && record22.placement !== "field" || binding?.state === "held" || binding?.placementHeld === true || binding?.candidateUnitIds?.length) {
      state = "review";
      reason = record22?.reviewReason || "The saved identity or physical placement needs review. Health from a possible match is not assigned to this product.";
    } else if (record22 && (!record22.active || record22.lifecycle !== "active" || row2?.retired)) {
      state = "inactive";
      reason = "The associated COS inventory is inactive. A successful connection does not reactivate it.";
    } else if (record22?.kind === "unit" && (!row2 || matches2.length !== 1 || record22.productIds.length !== 1 || binding?.state !== "linked" || !Array.isArray(binding.unitIds) || !binding.unitIds.includes(record22.unitId) || row2.placement !== "field")) {
      state = "review";
      reason = "The complete, unique product-to-unit association could not be verified.";
    } else if (support) {
      state = "support";
      reason = "Solar stand or support equipment with no camera channels. Camera online/offline status does not apply.";
    } else if (exactConnectionReceipt !== void 0 && !connections || exact8?.status === "unknown" && connections) {
      if (reviewedProvider) {
        state = row2.cameraState === "online" ? "online" : "offline";
        reason = PROVIDER_REPORTED + (directSourceUnavailable ? DIRECT_SOURCE_GAP : "No direct connection result: " + exact8.reason + " ") + unitHealthLabel(row2.camera) + ". " + row2.camera.reason;
      } else {
        state = "unverified";
        reason = directSourceUnavailable ? "The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown." : exact8.reason;
      }
    } else if (exactAllowed && exact8) {
      if (reviewedProvider && row2.cameraState !== exact8.status) {
        state = "unverified";
        reason = CURRENT_SOURCE_CONFLICT + "Direct: " + exact8.reason + " Provider: " + unitHealthLabel(row2.camera) + ".";
      } else {
        state = exact8.status === "online" ? "online" : "offline";
        reason = exact8.reason;
      }
    } else if (!record22) {
      state = "review";
      reason = related.length ? "Multiple COS representations claim this Product ID." : "No current COS roster representation is available for this Product ID.";
    } else if (record22.kind !== "unit") {
      state = "unlinked";
      reason = "The Field assignment is recorded, but it has no verified COS health link. It is not counted as an outage.";
    } else if (!row2.camera.association) {
      state = "unlinked";
      reason = "Device link needed. The Product ID has a COS inventory association, but its complete provider-resource association is not verified. A matching device name cannot supply current product health. " + row2.camera.reason;
    } else {
      state = row2.cameraState === "online" ? "online" : row2.cameraState === "offline" ? "offline" : "unverified";
      reason = unitHealthLabel(row2.camera) + ". " + row2.camera.reason;
    }
    counts2[state]++;
    const useExactEvidence = Boolean(exact8 && (exactAllowed && state === exact8.status || state === "unverified" && exact8.status === "unknown"));
    const evidence = fieldProductEvidence(state === "review" || record22?.kind !== "unit" ? null : row2, state, now, useExactEvidence && exact8 ? exact8 : null, exactConnectionReceipt !== void 0 && !connections);
    const followUp = fieldProductFollowUp(state, reason, exact8?.status === "unknown" ? exact8.reason : void 0, directSourceUnavailable);
    if (followUp) evidence.followUp = followUp;
    return { productId: product22.productId, unitNumber: label3, state, reason, unitId: state !== "review" && record22?.kind === "unit" && row2 ? row2.id : null, recordId: record22?.kind !== "unit" ? record22?.id || null : null, evidence };
  });
  return { total: authority.field, counts: counts2, items, receivedAt: authority.receivedAt, sourceSha256: authority.sourceSha256 };
}
var providerOrder = ["star4live", "avigilon", "reconeyez", "walle", "support", "other"];
var clean = (value2) => typeof value2 === "string" ? value2.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
function mhelpProviderFamily(category, unitNumber) {
  const key2 = clean(category) || clean(unitNumber);
  if (/^(SOLARSTAND|SOLARPOLE|STAND|STANDS|SKID|SOLARSKID|SOLARPOLESKID)/.test(key2)) return "support";
  if (/^(SNIPER|CAMV|RSU|RADARSNIPER)/.test(key2)) return "avigilon";
  if (/^RECON/.test(key2)) return "reconeyez";
  if (/^WALLE/.test(key2)) return "walle";
  if (/^(SOLARSPOTTER|SPOTTER|RANGER|HELIOS)/.test(key2)) return "star4live";
  return "other";
}
function mhelpProviderFleet(upload, health, healthReadSucceeded, now = Date.now()) {
  const authority = readMhelpInventoryAuthority(upload, now);
  if (!authority) return null;
  const products = upload.records.filter((item) => item.placement === "FIELD");
  const expected = new Set(products.map((item) => item.productId));
  const usable = Boolean(healthReadSucceeded && health && health.total === authority.field && health.items.length === authority.field && new Set(health.items.map((item) => item.productId)).size === authority.field && health.items.every((item) => expected.has(item.productId)));
  const healthById = new Map((usable ? health.items : []).map((item) => [item.productId, item]));
  const groups = providerOrder.map((provider) => ({
    provider,
    count: 0,
    counts: { online: 0, offline: 0, unverified: 0, not_applicable: 0 },
    items: []
  }));
  const groupByProvider = new Map(groups.map((group) => [group.provider, group]));
  for (const product22 of products) {
    const provider = mhelpProviderFamily(product22.category, product22.unitNumber);
    const linked = healthById.get(product22.productId) || null;
    const healthStatus = provider === "support" ? "not_applicable" : usable && (linked?.state === "online" || linked?.state === "offline") ? linked.state : "unverified";
    const reason = provider === "support" ? "Support equipment has no camera-health requirement. Verify its power separately." : !usable ? "Latest Field camera health is unavailable. No offline condition is inferred." : product22.uploadLifecycle && product22.uploadLifecycle !== "UNFLAGGED" ? "Source is marked Do Not Use / Missing. Do not activate from a saved connection." : linked?.reason || "No verified Product-ID-to-camera association. Not counted as an outage.";
    const group = groupByProvider.get(provider);
    group.count++;
    group.counts[healthStatus]++;
    group.items.push({
      productId: product22.productId,
      unitNumber: product22.unitNumber || "Product " + product22.productId,
      category: product22.category || "Not classified",
      customer: product22.customer || "",
      provider,
      healthStatus,
      reason,
      linked
    });
  }
  if (groups.reduce((total, group) => total + group.count, 0) !== authority.field) throw Error("Field provider totals do not reconcile to mHelp Product IDs.");
  return { total: authority.field, healthVerified: usable, receivedAt: authority.receivedAt, stale: authority.stale, groups };
}
function buildFleetCommandCenter(upload, fieldHealth, healthReadSucceeded, rows4, addressMap, vrm, now = Date.now(), cameraCheckedAt = null) {
  const authority = readMhelpInventoryAuthority(upload, now);
  const provider = mhelpProviderFleet(upload, fieldHealth, healthReadSucceeded, now);
  if (!authority || !provider || provider.total !== authority.field) return null;
  const sourceRecords = upload.records.filter((p) => p.placement === "FIELD");
  const recordById = new Map(sourceRecords.map((p) => [String(p.productId), p]));
  const validAddresses = addressMap?.sourceSha256 === authority.sourceSha256 && addressMap.totalField === authority.field ? addressMap : null;
  const points = new Set(validAddresses?.pins.map((p) => p.productId) || []);
  const addressById = new Map([...validAddresses?.pins || [], ...validAddresses?.reviews || []].map((p) => [p.productId, p.address]));
  const items = provider.groups.flatMap((group) => group.items.map((p) => {
    const source = recordById.get(p.productId);
    if (!source) throw Error("The Field source and provider Product IDs differ.");
    const location = source.sourceAddress;
    const address3 = (addressById.get(p.productId) || recordedAddressText(location) || "").trim();
    const status2 = group.provider === "support" ? "not_applicable" : p.healthStatus;
    return {
      ...p,
      status: status2,
      system: group.provider,
      address: address3,
      site: typeof source.site === "string" ? source.site : "",
      mappingIssue: Boolean(validAddresses) && !points.has(p.productId),
      lifecycle: typeof source.uploadLifecycle === "string" ? source.uploadLifecycle : "UNFLAGGED"
    };
  }));
  if (items.length !== authority.field || new Set(items.map((p) => p.productId)).size !== authority.field)
    throw Error("Field inventory violates unique Product-ID accounting.");
  const count6 = (status2) => items.filter((p) => p.status === status2).length;
  const counts2 = {
    online: count6("online"),
    offline: count6("offline"),
    unverified: count6("unverified"),
    support: count6("not_applicable"),
    attention: items.filter((p) => p.status === "offline" || p.status === "unverified" || p.mappingIssue).length,
    unmapped: validAddresses ? validAddresses.unlocated : 0
  };
  if (counts2.online + counts2.offline + counts2.unverified + counts2.support !== authority.field || authority.field + authority.shop !== authority.total) throw Error("Fleet accounting does not reconcile.");
  const panels = ["star4live", "avigilon", "reconeyez"].map((key2) => {
    const group = provider.groups.find((g) => g.provider === key2);
    return {
      key: key2,
      title: key2 === "star4live" ? "Star4Live" : key2 === "avigilon" ? "Avigilon" : "Recon / Recon II",
      count: group.count,
      counts: group.counts,
      products: items.filter((p) => p.system === key2),
      lastCheck: provider.healthVerified ? cameraCheckedAt : null,
      note: "Equipment-family classification; saved connectivity may include recorder or service-port evidence."
    };
  });
  let config = null;
  try {
    if (vrm) config = readVrmFleetConfig(vrm);
  } catch {
  }
  const helios = items.filter((p) => canonicalCameraUnit(p.unitNumber)?.startsWith("HELIOS|"));
  const vrmCounts = { online: 0, offline: 0, unverified: 0, not_applicable: 0 };
  const seenInstallations = /* @__PURE__ */ new Set();
  const victron = helios.map((p) => {
    const unitRows = p.linked?.unitId ? rows4.filter((r) => r.id === p.linked?.unitId) : [];
    const row2 = unitRows.length === 1 ? unitRows[0] : null;
    const power = row2?.power;
    const available = config?.items.filter((i) => i.installationId === power?.installationId && i.name === power?.name) || [];
    const recent = power?.measurements.some((m) => cameraTimestamp(m.observedAt, now).fresh) === true;
    const unique2 = Boolean(power && available.length === 1 && !seenInstallations.has(power.installationId));
    if (unique2 && power) seenInstallations.add(power.installationId);
    const status2 = unique2 && recent && !power?.errorCode && config?.sync.state === "current" ? "online" : "unverified";
    vrmCounts[status2]++;
    const reason = status2 === "online" ? "Fresh, uniquely linked Victron telemetry. A low battery is an alert, not an offline camera." : !p.linked?.unitId ? "This mHelp Product ID has no currently usable verified COS equipment association for Victron telemetry. Review the Product ID / COS link." : !power ? "The verified COS unit has no unique matching Victron installation record. Check the approved installation ID." : !unique2 ? "The Victron installation association is duplicated or cannot be confirmed against the current installation roster." : Boolean(power.errorCode) ? "The saved Victron power read contains an error. Recheck the provider connection." : config?.sync.state !== "current" ? "The Victron fleet sync is not current. Await a successful refresh before verifying power." : !recent ? "The saved Victron measurement is stale or missing. No current power status is inferred." : "Victron power status is not yet verified.";
    return { ...p, status: status2, reason };
  });
  panels.push({
    key: "victron",
    title: "Victron / Helios",
    count: config ? victron.length : null,
    counts: config ? vrmCounts : null,
    products: victron,
    lastCheck: config?.sync.lastSuccessAt || null,
    note: config ? "Fresh Victron telemetry only; battery warnings are not camera outages. Helios remains counted once in inventory." : "Victron source is unavailable or not authorized; no online/offline estimate is shown."
  });
  return {
    total: authority.total,
    field: authority.field,
    shop: authority.shop,
    sourceAt: authority.receivedAt,
    sourceStale: authority.stale,
    healthVerified: provider.healthVerified,
    items,
    counts: counts2,
    panels,
    addressCoverage: validAddresses ? { located: validAddresses.pins.length, missing: validAddresses.unlocated } : null
  };
}
function cameraFieldProducts(map, health, now, readSucceeded = true) {
  if (!map) return null;
  const inventory = map.inventoryItems || map.items || [];
  const roster = readRecordedRoster(map.fleetRoster, inventory).roster;
  const upload = manualShopInventory(map.uploadInventory, map.manualPlacementOverrides);
  const rows4 = fleetDashboardRows(inventory, health, null, null, now).map((row2) => {
    const item = roster?.items.find((item2) => item2.unitId === row2.id);
    return { ...row2, retired: item ? !item.active : row2.retired };
  });
  const field5 = mhelpFieldHealth(upload, roster, rows4, now, map.productConnections);
  return buildFleetCommandCenter(upload, field5, readSucceeded, rows4, null, null, now, health.refreshedAt || null);
}
function completedBoard(health, map, connections, previous, at = Date.now()) {
  const upload = map?.uploadInventory, ids = upload?.records?.filter((r) => r.placement === "FIELD").map((r) => r.productId);
  if (!upload || !ids?.length || !readExactProductConnections(connections, upload.sourceSha256, ids, at)) throw Error("connection_source_incomplete");
  prepareImmutableIdentityEnvelope(health);
  const reconciled = reconcileFleetSnapshot(health, { ...map, productConnections: connections, productConnectionsState: "ready" }, at);
  const { fleetFieldUnits, ...storedHealth } = reconciled.health;
  const pair = { ...reconciled, health: storedHealth };
  prepareImmutableIdentityEnvelope(pair.health);
  const board = cameraFieldProducts(pair.fieldMap, pair.health, at, true);
  if (!board || !board.healthVerified) throw Error("inventory_source_incomplete");
  return { contract: "COS_SAVED_FLEET_BOARD_V1", fleet: pair, counts: board.counts, units: board.items.map((p) => ({ productId: p.productId, unitNumber: p.unitNumber, status: p.status, checkedAt: p.linked?.evidence?.observedAt || null, reason: p.linked?.evidence?.reason || p.linked?.reviewReason || null })), inventory: { total: board.total, field: board.field, shop: board.shop } };
}

// tech-checks/supabase/functions/cos-operations-pages/fleetShopProjection.ts
var uuid4 = (v) => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function manualShopItems2(value2) {
  if (value2?.contract !== "COS_FLEET_SHOP_OVERRIDES_V1" || !Array.isArray(value2.items) || value2.items.length > 1e4 || value2.items.some((r) => !uuid4(r.unitId) || !uuid4(r.auditId) || typeof r.unitNumber !== "string" || !r.unitNumber.trim() || r.placement !== "SHOP" || !Number.isFinite(Date.parse(r.recordedAt))) || value2.items.some((r) => r.sourceBindings !== void 0 && (!Array.isArray(r.sourceBindings) || r.sourceBindings.length > 1e4 || r.sourceBindings.some((b) => !/^(?:[1-9]\d*)$/.test(b.productId) || !/^(?:[a-f0-9]{64})$/.test(b.sourceSha256)))) || new Set(value2.items.map((r) => r.unitId)).size !== value2.items.length) throw Error("Manual Shop placement is unavailable.");
  return value2.items;
}
function projectManualShop(snapshot, receipt2) {
  const upload = snapshot.uploadInventory, uploaded = upload?.source !== "mhelpdesk_api" ? Date.parse(upload?.receivedAt) : NaN;
  const applied = manualShopItems2(receipt2).filter((move) => {
    const matches2 = (snapshot.inventoryItems || []).filter((r) => r.id === move.unitId && r.unitNumber === move.unitNumber);
    return matches2.length === 1 && !(Number.isFinite(uploaded) && uploaded > Date.parse(move.recordedAt)) && !(matches2[0].placementSource === "owner" && Date.parse(matches2[0].placementUpdatedAt) > Date.parse(move.recordedAt));
  });
  const byId = new Map(applied.map((r) => [r.unitId, r]));
  const productIds = new Set(applied.flatMap((m) => (m.sourceBindings || []).filter((b) => b.sourceSha256 === upload?.sourceSha256 || upload?.source === "mhelpdesk_api" && upload.records.some((r) => r.productId === b.productId && r.unitNumber === b.sourceUnitNumber)).map((b) => b.productId)));
  for (const r of upload?.records || []) if (r.binding?.state === "linked" && r.binding.unitIds?.length === 1 && byId.has(r.binding.unitIds[0])) productIds.add(r.productId);
  const isShop = (r) => byId.has(r.id) || byId.has(r.unitId) || r.kind !== "identity_review" && (r.productIds?.some((p) => productIds.has(p)) || r.productId && productIds.has(r.productId));
  const change = (row2) => {
    const move = byId.get(row2.id) || byId.get(row2.unitId);
    return isShop(row2) ? { ...row2, placement: "SHOP", currentLocationType: "shop", status: "available", effectivePlacement: { contract: "COS_EFFECTIVE_FLEET_PLACEMENT_V1", state: "shop", source: "cos_manual_shop", observedAt: move?.recordedAt || null, freshness: "recorded", reason: null }, placementSource: "cos_manual_shop", manualShopAuditId: move?.auditId || null } : row2;
  };
  const inventoryItems = (snapshot.inventoryItems || []).map(change), items = (snapshot.items || []).filter((r) => !isShop(r));
  let fleetRoster = snapshot.fleetRoster;
  if (fleetRoster?.contract && Array.isArray(fleetRoster.items)) {
    const changed = fleetRoster.items.map((r) => isShop(r) && r.kind !== "identity_review" ? { ...r, placement: "shop", ...r.unit ? { unit: change(r.unit) } : {} } : r), summary = { ...fleetRoster.summary };
    for (const field5 of ["field", "shop", "unknown"]) if (field5 in summary) summary[field5] = changed.filter((r) => r.active && r.placement === field5).length;
    summary.review = changed.filter((r) => r.active && r.placement === "unknown").length;
    fleetRoster = { ...fleetRoster, items: changed, summary };
  }
  return { ...snapshot, items, inventoryItems, ...fleetRoster ? { fleetRoster } : {}, manualPlacementOverrides: { contract: "COS_FLEET_SHOP_OVERRIDES_V1", items: applied }, summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, unitGps: items.filter((r) => r.hasUnitGps === true).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length }, ...snapshot.placementSummary ? { placementSummary: { ...snapshot.placementSummary, fieldUnits: items.length, reviewUnits: inventoryItems.filter((r) => r.activeInventoryEligible !== false && r.effectivePlacement?.state === "unknown").length, shopUnits: inventoryItems.filter((r) => r.activeInventoryEligible !== false && (r.effectivePlacement?.state === "shop" || String(r.placement).toLowerCase() === "shop")).length } } : {} };
}

// tech-checks/supabase/functions/cos-operations-pages/fleetShopPlacement.ts
var FleetShopError = class extends Error {
  constructor(message, status2 = 503) {
    super(message);
    this.status = status2;
  }
  status;
};
function fail(message, status2 = 503) {
  throw new FleetShopError(message, status2);
}
var uuid5 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var exact = (v, keys3) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...keys3].sort().join(",");
function checkedShopPlacement(v, id15) {
  if (v?.contract !== "COS_FLEET_SHOP_PLACEMENT_V1" || v.unitId !== id15 || typeof v.unitNumber !== "string" || !/\S/.test(v.unitNumber) || !/^(?:[a-f0-9]{64})$/.test(v.proof) || !(v.auditId === null || uuid5(v.auditId)) || !["SHOP", "UNKNOWN"].includes(v.placement)) fail("Saved placement could not be verified. Check placement before trying again.");
  return { contract: v.contract, unitId: id15, unitNumber: v.unitNumber, proof: v.proof, auditId: v.auditId, placement: v.placement };
}
function createFleetShopPlacement(options) {
  return async (id15, method, body) => {
    if (!uuid5(id15)) fail("Choose an existing COS equipment unit.", 400);
    const args = { ...options.actorPayload, p_unit_id: id15 };
    if (method === "GET") {
      const v = await options.rpc("cos_fleet_shop_action_v1", { ...args, p_action: "read" });
      return { ...checkedShopPlacement(v, id15), recordedAt: v.recordedAt, sourceBindings: v.sourceBindings || [] };
    }
    if (method !== "POST") fail("Use the Shop placement action.", 405);
    if (!exact(body, ["expected", "reason", "requestId"]) || !uuid5(body.requestId) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 1e3 || !exact(body.expected, ["unitId", "unitNumber", "proof", "auditId", "placement", "contract"])) fail("Review the unit and enter a move reason.", 400);
    const expected = checkedShopPlacement(body.expected, id15);
    const result = await options.rpc("cos_fleet_shop_action_v1", { ...args, p_action: "move", p_request_id: body.requestId, p_reason: body.reason.trim(), p_expected: expected });
    const value2 = checkedShopPlacement(result, id15);
    if (result.saved !== true || result.requestId !== body.requestId || value2.placement !== "SHOP" || value2.auditId !== body.requestId) fail("The move response is uncertain. Check the saved placement before trying again.");
    const after = checkedShopPlacement(await options.rpc("cos_fleet_shop_action_v1", { ...args, p_action: "read" }), id15);
    if (JSON.stringify(after) !== JSON.stringify(value2)) fail("The move may be saved. Check placement before trying again.");
    return { ...after, saved: true, recordedAt: result.recordedAt, sourceBindings: result.sourceBindings || [], requestId: body.requestId };
  };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraEvidence.ts
var CAMERA_FRESH_MS3 = 20 * 60 * 1e3;
function reconBatteryEvidence(percent, percentAt, status2, statusAt) {
  const numeric3 = typeof percent === "number" ? percent : typeof percent === "string" && /^\d+(?:\.\d+)?$/.test(percent.trim()) ? Number(percent) : NaN;
  return { source: "Reconeyez", percent: Number.isFinite(numeric3) && numeric3 >= 0 && numeric3 <= 100 ? numeric3 : null, percentObservedAt: typeof percentAt === "string" ? percentAt : null, status: typeof status2 === "string" && ["normal", "low", "critical"].includes(status2) ? status2 : null, statusObservedAt: typeof statusAt === "string" ? statusAt : null };
}
function savedCameraConnection(ip, ports) {
  if (typeof ip !== "string") return void 0;
  const address3 = ip.replace(/\/32$/, "");
  const parts3 = address3.split(".");
  if (parts3.length !== 4 || parts3.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return void 0;
  const a = Number(parts3[0]), b = Number(parts3[1]), c = Number(parts3[2]);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return void 0;
  return { publicIp: address3, ports: Array.isArray(ports) ? [...new Set(ports.filter((p) => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535))].sort((a2, b2) => a2 - b2) : [] };
}
var normalized2 = (value2) => typeof value2 === "string" ? value2.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp2(value2, now = Date.now()) {
  if (typeof value2 !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value2);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value2.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS3 } : { at: null, fresh: false };
}
var providerSource2 = (value2) => ["Star4Live", "Reconeyez"].includes(String(value2));
function currentCameraStatus2(evidence, now = Date.now()) {
  return evidence?.kind === "provider" && ["camera", "detector"].includes(evidence.resource || "") && evidence.active === true && providerSource2(evidence.source) && cameraTimestamp2(evidence.observedAt, now).fresh && ["online", "offline"].includes(evidence.status) ? evidence.status : "review";
}
var sourceText = (value2) => typeof value2 === "string" ? value2 : null;
var resourceId2 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0 ? String(value2) : typeof value2 === "string" && /^[1-9]\d*$/.test(value2) ? value2 : null;
var object5 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
function cameraScope(device, tracker = []) {
  const activation = normalized2(device.activation_state), org = normalized2(device.organization), unit = normalized2(device.unit_key);
  if (/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(unit) || /^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(org) || activation === "DEACTIVATED" || ["RETIRED", "STOLEN", "NOT IN USE"].includes(org) || /^RII?[-\s]*\d+\s*-?\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit)) return "inactive";
  if (activation !== "ACTIVE") return "unknown";
  if (["ROOT", "SHOP", "SHOP EQUIPMENT"].includes(org) || unit === "SHOP EQUIPMENT" || /^RII?[-\s]*\d+\s*-?\s*SHOP$/.test(unit)) return "shop";
  const matches2 = tracker.filter((row2) => normalized2(row2.source_label) === unit);
  if (matches2.length > 1 || matches2.some((row2) => ["shop", "retired"].includes(row2.tracker_state))) return "unknown";
  if (device.__trackerOnly || !org || ["TRACKER FIELD", "TRACKER \xB7 SITE NOT LINKED", "UNKNOWN", "FIELD OR UNKNOWN"].includes(org)) return "unknown";
  return "field";
}
function cameraEvidence(device) {
  const type = String(device.device_type || "").trim().toLowerCase();
  const resource = ["ipc", "camera"].includes(type) ? "camera" : ["detector", "reconeyez detector"].includes(type) ? "detector" : type === "nvr" ? "recorder" : "unknown";
  const provider = device.source === "vigilant_control_center" ? "Star4Live" : device.source === "reconeyez" ? "Reconeyez" : null;
  const active = normalized2(device.activation_state) === "ACTIVE";
  return { kind: provider && resource !== "unknown" ? "provider" : "unknown", source: provider || "Unverified provider source", resource, active, status: ["online", "offline"].includes(device.source_status) ? device.source_status : "unknown", observedAt: sourceText(device.source_last_seen_at), lastOnlineAt: sourceText(device.last_online_at) };
}
function serviceEvidence(device, health = {}, witness = false, now = Date.now()) {
  const failures = Number.isSafeInteger(health.consecutive_failures) && health.consecutive_failures >= 0 ? health.consecutive_failures : null;
  const ports = object5(health.port_status) ? health.port_status : {};
  const actualPorts = Object.entries(ports).filter(([key2, value2]) => /^[1-9][0-9]{0,4}$/.test(key2) && Number(key2) <= 65535 && object5(value2) && typeof value2.online === "boolean" && value2.attempted !== false);
  const proof = object5(ports._connection) ? ports._connection : null;
  const saved = savedCameraConnection(device.public_ip, device.expected_ports);
  const revision3 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 ? String(value2) : typeof value2 === "string" && /^(?:0|[1-9][0-9]*)$/.test(value2) ? value2 : null;
  const actualKeys = actualPorts.map(([key2]) => Number(key2)).sort((a, b) => a - b);
  const completePorts = Boolean(saved?.ports.length && actualKeys.length === saved.ports.length && actualKeys.every((port, index2) => port === saved.ports[index2]));
  const bound = Boolean(proof && completePorts && saved && proof.ip === saved.publicIp && revision3(proof.revision) !== null && revision3(proof.revision) === revision3(device.connection_revision) && cameraTimestamp2(proof.checkedAt, now).at);
  const supported = witness || bound;
  const reported = witness ? health.status : bound ? proof.status : health.overall_status;
  const reachability = witness ? health.reachable : bound ? proof.reachable : health.ip_reachable;
  return { kind: "service_port", source: witness ? "Witness service-port check" : "Direct service-port check", resource: "service", active: normalized2(device.activation_state) === "ACTIVE", status: supported && ["online", "offline", "degraded"].includes(reported) ? reported : "unknown", observedAt: supported ? sourceText(bound ? proof.checkedAt : health.checked_at) : null, lastOnlineAt: !witness && supported ? sourceText(device.last_probe_online_at) : null, reachable: supported && typeof reachability === "boolean" ? reachability : null, confirmedOutage: supported && (bound ? proof.confirmedOutage === true : health.confirmed_outage === true), consecutiveFailures: supported ? bound ? Number.isSafeInteger(proof.consecutiveFailures) ? proof.consecutiveFailures : null : failures : null };
}
function validateCameraSources(devices, health, tracker) {
  if (![devices, health, tracker].every(Array.isArray)) throw new Error("Camera Health source records are unavailable.");
  const textOrMissing = (value2) => value2 == null || typeof value2 === "string", seen = /* @__PURE__ */ new Set(), checked2 = /* @__PURE__ */ new Set();
  for (const row2 of devices) {
    const id15 = object5(row2) ? resourceId2(row2.id) : null;
    if (!id15 || seen.has(id15) || !["device_name", "device_type", "organization", "unit_key", "source", "source_status", "source_last_seen_at", "last_online_at", "last_probe_online_at", "activation_state"].every((key2) => textOrMissing(row2[key2]))) throw new Error("Camera Health returned malformed or duplicate device identities.");
    seen.add(id15);
  }
  for (const row2 of health) {
    const id15 = object5(row2) ? resourceId2(row2.camera_device_id) : null;
    if (!id15 || !seen.has(id15) || checked2.has(id15) || !["overall_status", "checked_at"].every((key2) => textOrMissing(row2[key2])) || row2.confirmed_outage != null && typeof row2.confirmed_outage !== "boolean" || row2.ip_reachable != null && typeof row2.ip_reachable !== "boolean" || row2.consecutive_failures != null && (!Number.isSafeInteger(row2.consecutive_failures) || row2.consecutive_failures < 0)) throw new Error("Camera Health returned malformed or duplicate health identities.");
    checked2.add(id15);
  }
  for (const row2 of tracker) if (!object5(row2) || !["canonical_family", "unit_tag", "source_label", "tracker_state"].every((key2) => typeof row2[key2] === "string") || !textOrMissing(row2.health_provider)) throw new Error("Camera Health tracker placement records are malformed.");
}
var trackerFamilies = ["Helios", "Ranger", "Solar Spotter", "Spotter", "SS Hybrid", "CAMV", "Sniper", "Sniper 2", "Sniper 4", "Recon", "Recon 2"];
function canonicalTrackerKey(row2) {
  const family = trackerFamilies.find((value2) => normalized2(value2) === normalized2(row2.canonical_family)), tag = row2.unit_tag.trim();
  if (!family || !/^\d{1,6}(?:\.\d+)?$/.test(tag) || Number(tag.split(".")[0]) === 0) return null;
  const [base2, ...tail] = tag.split(".");
  return family.toLowerCase() + "|" + String(Number(base2)).padStart(3, "0") + (tail.length ? "." + tail.join(".") : "");
}
function deviceTrackerKey(unit) {
  if (typeof unit !== "string") return null;
  const scoped = /^(RII?[-\s]*\d+)\s*-?\s*(?:SHOP|NOT IN USE|RETIRED|STOLEN)$/.exec(normalized2(unit));
  const stolen = /^STOLEN FROM (RII?[-\s]*\d+) ON \d{2}\/\d{2}\/\d{4}$/.exec(normalized2(unit));
  const identityLabel = scoped?.[1] || stolen?.[1] || unit.trim();
  const match = /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER(?:\s+[24])?|CAM\s*V|RECON(?:\s+(?:2|II))?|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(identityLabel);
  if (!match) return null;
  const aliases5 = { RI: "Recon", RII: "Recon 2", RECONII: "Recon 2", RECON2: "Recon 2" };
  const condensed = normalized2(match[1]).replace(/\s/g, "");
  const family = aliases5[condensed] || trackerFamilies.find((value2) => normalized2(value2).replace(/\s/g, "") === condensed);
  return family ? canonicalTrackerKey({ canonical_family: family, unit_tag: match[2], source_label: "", tracker_state: "" }) : null;
}
function witnessUnits(integrations) {
  if (!Array.isArray(integrations) || integrations.some((row2) => !object5(row2) || row2.provider !== "witness" || row2.units != null && !object5(row2.units))) throw new Error("Witness service observations are malformed.");
  if (integrations.length > 1) throw new Error("Witness service observations have duplicate provider identities.");
  return integrations[0]?.units || {};
}
function cameraSummary(devices, health, now = Date.now(), tracker = [], integrations = []) {
  validateCameraSources(devices, health, tracker);
  const byId = new Map(health.map((row2) => [resourceId2(row2.camera_device_id), row2])), witness = witnessUnits(integrations);
  const rows4 = devices.map((device) => {
    const evidence = cameraEvidence(device), service = serviceEvidence(device, byId.get(resourceId2(device.id)) || {}, false, now);
    const row2 = { id: device.id, name: device.device_name || device.unit_key || "Resource " + device.id, unit: device.unit_key || "", type: device.device_type || "", organization: device.organization || "", activationState: device.activation_state || "", scope: cameraScope(device, tracker), status: "review", checkedAt: evidence.observedAt, evidence, serviceEvidence: service };
    const connection = savedCameraConnection(device.public_ip, device.expected_ports);
    if (connection) row2.connection = connection;
    if (device.source === "reconeyez") row2.batteryEvidence = reconBatteryEvidence(device.recon_battery_percent, device.recon_battery_updated_at, device.recon_battery_status, device.recon_battery_status_updated_at);
    row2.status = ["field", "unknown"].includes(row2.scope) ? currentCameraStatus2(evidence, now) : "review";
    return row2;
  });
  const linked = new Set(devices.map((device) => deviceTrackerKey(device.unit_key)).filter(Boolean));
  for (const device of devices) for (const record5 of tracker.filter((row2) => normalized2(row2.source_label) === normalized2(device.unit_key))) {
    const key2 = canonicalTrackerKey(record5);
    if (key2) linked.add(key2);
  }
  const synthesized = /* @__PURE__ */ new Set();
  for (const record5 of tracker) {
    const key2 = canonicalTrackerKey(record5);
    if (!key2 || record5.tracker_state !== "field_or_unknown" || linked.has(key2) || synthesized.has(key2)) continue;
    synthesized.add(key2);
    const peers = tracker.filter((row2) => canonicalTrackerKey(row2) === key2);
    const exactLabel = normalized2(record5.source_label), labelKey = deviceTrackerKey(record5.source_label), identitySafe = peers.length === 1 && exactLabel !== "" && (!labelKey || labelKey === key2) && tracker.filter((row2) => normalized2(row2.source_label) === exactLabel).length === 1;
    const observed2 = identitySafe && String(record5.health_provider || "").toLowerCase() === "witness" && Object.hasOwn(witness, key2) && object5(witness[key2]) ? witness[key2] : {};
    const service = serviceEvidence({ activation_state: "active" }, observed2, true, now);
    rows4.push({ id: "tracker:" + key2, name: record5.source_label || record5.canonical_family + " " + record5.unit_tag, unit: record5.source_label || record5.canonical_family + " " + record5.unit_tag, type: "tracker_unit", organization: "TRACKER \xB7 SITE NOT LINKED", activationState: "active", scope: "unknown", trackerOnly: true, status: "review", checkedAt: service.observedAt, serviceEvidence: service });
  }
  rows4.sort((a, b) => a.name.localeCompare(b.name));
  const fields4 = rows4.filter((row2) => row2.scope === "field");
  const inventory = { allRecords: rows4.length, activeFieldRecords: fields4.length, activeShopRecords: rows4.filter((row2) => row2.scope === "shop").length, inactiveRecords: rows4.filter((row2) => row2.scope === "inactive").length, unknownScopeRecords: rows4.filter((row2) => row2.scope === "unknown").length, sourceDeviceRecords: devices.length, trackerOnlyRecords: rows4.filter((row2) => row2.trackerOnly).length };
  return { totalDevices: rows4.length, healthRows: health.length, fieldDevices: fields4.length, shopRoot: inventory.activeShopRecords, online: fields4.filter((row2) => row2.status === "online").length, offline: fields4.filter((row2) => row2.status === "offline").length, review: fields4.filter((row2) => row2.status === "review").length, rows: rows4, refreshedAt: new Date(now).toISOString(), source: "Camera Health", evidenceVersion: 2, inventory, coverageNote: "Provider systems, camera/detector observations and service ports are separate. Expected camera channel coverage is not established. Field devices counts confirmed-field resources; displayed inventory also includes unresolved placement, shop/root, inactive and tracker-only resources." };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraDiagnostics.ts
var CameraDiagnosticError = class extends Error {
  constructor(message, status2 = 503) {
    super(message);
    this.status = status2;
  }
  status;
};
function deny(message, status2 = 503) {
  throw new CameraDiagnosticError(message, status2);
}
async function checkSavedCamera(input2) {
  const { id: id15, body, headers, fetcher } = input2;
  if (!/^[1-9]\d{0,14}$/.test(id15) || !Number.isSafeInteger(Number(id15))) deny("Invalid camera record.", 400);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "mode,ports,publicIp,unitKey" || !["quick", "ports"].includes(body.mode) || typeof body.unitKey !== "string" || body.unitKey.length > 250 || typeof body.publicIp !== "string" || !Array.isArray(body.ports) || body.ports.length > 128 || body.ports.some((p) => !Number.isInteger(p) || Number(p) < 1 || Number(p) > 65535)) deny("Use the saved camera connection.", 400);
  const controller = new AbortController(), cancel = () => controller.abort();
  input2.signal?.addEventListener("abort", cancel, { once: true });
  if (input2.signal?.aborted) cancel();
  const timer = setTimeout(cancel, 25e3), base2 = "https://goqrnolcvqnirjmzaeyk.supabase.co";
  try {
    const saved = await fetcher(base2 + "/rest/v1/camera_devices?id=eq." + id15 + "&select=id,unit_key,public_ip,expected_ports,monitoring_enabled", { headers, signal: controller.signal });
    if (!saved.ok) deny("The saved camera connection could not be verified.", [401, 403].includes(saved.status) ? saved.status : 503);
    const rows4 = await saved.json();
    if (!Array.isArray(rows4) || rows4.length !== 1) deny("This camera record is unavailable. Refresh the unit.", 409);
    const device = rows4[0], connection = savedCameraConnection(device.public_ip, device.expected_ports);
    if (!connection || device.monitoring_enabled === false) deny("This camera has no enabled public connection to check.", 409);
    if (device.unit_key !== body.unitKey || connection.publicIp !== body.publicIp || JSON.stringify(connection.ports) !== JSON.stringify([...new Set(body.ports)].sort((a, b) => a - b))) deny("The saved connection changed. Refresh this unit before checking it.", 409);
    const response = await fetcher(base2 + "/functions/v1/camera-health-check", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ device_id: Number(id15), fast_verify: body.mode === "quick", skip_provider_sync: true }), signal: controller.signal });
    if (!response.ok) deny(response.status === 409 ? "The camera configuration changed or cannot be checked. Refresh this unit." : "The connection check could not be completed. No new result is confirmed.", [401, 403, 409].includes(response.status) ? response.status : 503);
    const value2 = await response.json();
    if (value2.device_id !== Number(id15) || value2.public_ip_used !== connection.publicIp || typeof value2.checked_at !== "string" || !Number.isFinite(Date.parse(value2.checked_at)) || !value2.ports || typeof value2.ports !== "object") deny("No valid connection result was returned.");
    const ports = Object.entries(value2.ports).map(([key2, v]) => ({ port: Number(key2), reachable: v?.online, latencyMs: typeof v?.latency_ms === "number" && Number.isFinite(v.latency_ms) && v.latency_ms >= 0 ? v.latency_ms : null }));
    if (!ports.length || ports.length > 128 || ports.some((p) => !Number.isInteger(p.port) || p.port < 1 || p.port > 65535 || typeof p.reachable !== "boolean" || connection.ports.length > 0 && !connection.ports.includes(p.port))) deny("No valid connection result was returned.");
    return { deviceId: Number(id15), unitKey: device.unit_key, publicIp: connection.publicIp, mode: body.mode, checkedAt: value2.checked_at, ports };
  } catch (error) {
    if (error instanceof CameraDiagnosticError) throw error;
    return deny("The connection check could not be completed. No new result is confirmed.");
  } finally {
    clearTimeout(timer);
    input2.signal?.removeEventListener("abort", cancel);
  }
}

// tech-checks/supabase/functions/camera-field-geocode/censusAddress.ts
var aliases = { ROAD: "RD", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", COUNTY: "CO", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", TERRACE: "TER", CIRCLE: "CIR", TRAIL: "TRL" };
var streetKey = (s) => s.toUpperCase().replace(/\./g, "").replace(/\b[A-Z]+\b/g, (w) => aliases[w] || w).replace(/\s+/g, " ").trim();
function parseAddress(value2) {
  if (typeof value2 !== "string" || value2.length > 600 || /[\r\n<>@=]|https?:|password|passwd|pwd|token|secret|credential|gate[\s-]*code|access[\s-]*code|\bpin\b/i.test(value2)) return null;
  const m = /^\s*(\d+[A-Z]?\s+[A-Za-z0-9 .'-]+),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(?:-\d{4})?\s*$/i.exec(value2);
  if (!m) return null;
  const states2 = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" ");
  if (!states2.includes(m[3].toUpperCase())) return null;
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
}
function compareAddress(a, b) {
  return streetKey(a.street) === streetKey(b.street) && a.city.toUpperCase() === b.city.toUpperCase() && a.state === b.state && a.zip === b.zip;
}
async function censusAddress(value2, requestFetch = fetch, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  const parts3 = parseAddress(value2);
  if (!parts3) return { status: "invalid_address", reason: "Enter the installation street, city, state and ZIP, for example 123 Main St, Houston, TX 77002." };
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/address");
  for (const [key2, val] of Object.entries(parts3)) url.searchParams.set(key2, val);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1e4);
  try {
    const response = await requestFetch(url.toString(), { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return { status: "provider_error", reason: response.status === 429 ? "Address service is busy. Automatic retry is scheduled." : "Address service is unavailable. Automatic retry is scheduled." };
    const reader = response.body?.getReader();
    if (!reader) throw Error("empty");
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value: value3 } = await reader.read();
      if (done) break;
      size += value3.length;
      if (size > 262144) {
        await reader.cancel();
        throw Error("large");
      }
      chunks.push(value3);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const b of chunks) {
      joined.set(b, offset);
      offset += b.length;
    }
    const payload = JSON.parse(new TextDecoder().decode(joined)), matches2 = payload?.result?.addressMatches;
    if (!Array.isArray(matches2)) throw Error("shape");
    if (matches2.length !== 1) return { status: "no_match", reason: matches2.length ? "Several addresses matched. Correct the street/city/ZIP or verify the installation pin." : "No exact address matched. Correct the street/city/ZIP or verify the installation pin." };
    const match = matches2[0], matched = parseAddress(match?.matchedAddress), latitude = match?.coordinates?.y, longitude = match?.coordinates?.x;
    if (!matched || !compareAddress(parts3, matched) || typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return { status: "no_match", reason: "The address service returned a different address. Review the installation address before mapping it." };
    return { status: "success", reason: "Approximate address-range location. Confirm the exact installation pin when available.", latitude, longitude, matchedAddress: match.matchedAddress, geocodedAt: now() };
  } catch {
    return { status: "provider_error", reason: "Address lookup could not complete. Automatic retry is scheduled." };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// tech-checks/operations/src/mhelpAddressMapPins.ts
var object6 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var text3 = (v, max = 600) => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
var hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var id = (v) => typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v);
var point = (lat, lon) => typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
var locationDate = (v, now) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now;
var formatAddress = (v) => {
  if (!object6(v) || ["street", "city", "state", "zip"].some((k) => !text3(v[k], 300))) return "";
  const street = v.street.trim(), city = v.city.trim(), state = v.state.trim(), zip = v.zip.trim();
  return [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
};
var validState = (s) => ["matched", "address_review", "no_match", "invalid_address"].includes(String(s));
function readMhelpAddressMapPins(raw, head, now = Date.now()) {
  if (raw === void 0 || raw === null) return null;
  if (!object6(raw) || !object6(head) || raw.contract !== "COS_MHELP_CENSUS_ADDRESS_MAP_V1" || !hash(raw.sourceSha256) || !hash(raw.payloadSha256) || raw.sourceSha256 !== head.sourceSha256 || raw.payloadSha256 !== head.payloadSha256 || raw.verifiedGps !== false || raw.liveGps !== false || raw.confidence !== "mhelpdesk_customer_address_reference_only" || !Array.isArray(head.records) || head.records.length < 1 || head.records.length > 1e4 || !Array.isArray(raw.items)) return null;
  if (head.records.some((r) => !object6(r) || !id(r.productId) || !["FIELD", "SHOP"].includes(String(r.placement))) || new Set(head.records.map((r) => r.productId)).size !== head.records.length) return null;
  const expected = new Set(head.records.filter((r) => object6(r) && r.placement === "FIELD").map((r) => r.productId));
  const shops = head.records.length - expected.size;
  const acceptedCount = head.recordCount === void 0 && object6(head.summary) ? head.summary.totalRecords : head.recordCount;
  if (raw.totalProducts !== head.records.length || raw.fieldProducts !== expected.size || raw.shopProducts !== shops || raw.items.length !== expected.size || acceptedCount !== head.records.length || object6(head.summary) && head.summary.totalRecords !== head.records.length) return null;
  const ids = /* @__PURE__ */ new Set(), pins = [], reviews = [];
  for (const item of raw.items) {
    if (!object6(item) || !id(item.productId) || !expected.has(item.productId) || ids.has(item.productId) || !hash(item.sourceRowSha256) || !text3(item.unitNumber, 250) || !item.unitNumber.trim() || !text3(item.customer, 512) || !text3(item.category, 250) || item.placement !== "FIELD" || !["UNFLAGGED", "DO_NOT_USE", "MISSING", "RETIRED", "DECOMMISSIONED"].includes(String(item.lifecycle)) || typeof item.placementHeld !== "boolean" || !validState(item.status) || !text3(item.reason, 600) && item.reason !== null || !text3(item.matchedAddress, 600) && item.matchedAddress !== null || item.verified !== false || item.liveGps !== false || item.confidence !== "mhelpdesk_address_census_range_unverified" || !["us_census_address_range", "geocodio", "municipal_address_point", "public_site_reference"].includes(String(item.geocodeSource)) || item.sourceAddress === null || !object6(item.sourceAddress)) return null;
    ids.add(item.productId);
    const address3 = formatAddress(item.sourceAddress), state = item.status;
    const common2 = {
      id: "mhelp_product:" + item.productId,
      productId: item.productId,
      unitNumber: item.unitNumber,
      customer: item.customer,
      category: item.category,
      address: address3,
      lifecycle: item.lifecycle,
      placementHeld: item.placementHeld
    };
    if (state === "matched" || state === "address_review") {
      if (!point(item.latitude, item.longitude) || !locationDate(item.geocodedAt, now) || !text3(item.matchedAddress, 600) || !item.matchedAddress.trim()) return null;
      const sourceParts = parseAddress(address3), matchedParts = parseAddress(item.matchedAddress), discrepancy = sourceParts && matchedParts && !compareAddress(sourceParts, matchedParts);
      pins.push({ ...common2, state: discrepancy || item.geocodeSource === "public_site_reference" ? "address_review" : state, provider: String(item.geocodeSource), geocodedAt: String(item.geocodedAt), lookupAddress: typeof item.lookupAddress === "string" ? item.lookupAddress : "", point: [item.latitude, item.longitude], matchedAddress: item.matchedAddress, verified: false, liveGps: false });
    } else {
      if (item.latitude !== null || item.longitude !== null || item.matchedAddress !== null) return null;
      reviews.push({ ...common2, state, reason: String(item.reason || (state === "no_match" ? "The Census did not locate this address." : "Service address needs correction.")) });
    }
  }
  if (ids.size !== expected.size || pins.length + reviews.length !== expected.size) return null;
  return {
    pins,
    reviews,
    sourceSha256: raw.sourceSha256,
    payloadSha256: raw.payloadSha256,
    totalField: expected.size,
    matched: pins.filter((p) => p.state === "matched").length,
    addressReview: pins.filter((p) => p.state === "address_review").length,
    unlocated: reviews.length
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpAddressMap.ts
async function withMhelpAddressMap(snapshot, upload, read, requestSignal, budgetMs = 2200) {
  const unavailable2 = () => ({ ...snapshot, mhelpAddressMapStatus: "unavailable" });
  const head = upload;
  if (!head || !Array.isArray(head.records) || head.records.length < 1 || head.records.length > 1e4 || head.recordCount !== head.records.length || !/^[a-f0-9]{64}$/.test(head.sourceSha256) || !/^[a-f0-9]{64}$/.test(head.payloadSha256)) return unavailable2();
  const controller = new AbortController();
  let timer;
  let cancel = () => {
  };
  const stopped = new Promise((resolve2) => {
    cancel = () => {
      controller.abort();
      resolve2(null);
    };
    timer = setTimeout(cancel, budgetMs);
    requestSignal?.addEventListener("abort", cancel, { once: true });
  });
  try {
    if (requestSignal?.aborted) return unavailable2();
    const raw = await Promise.race([Promise.resolve().then(() => read(controller.signal)).catch(() => null), stopped]);
    if (controller.signal.aborted || !readMhelpAddressMapPins(raw, upload)) return unavailable2();
    return { ...snapshot, mhelpAddressMap: raw };
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}

// tech-checks/supabase/functions/cos-operations-pages/censusAddress.ts
var aliases2 = { ROAD: "RD", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", COUNTY: "CO", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", TERRACE: "TER", CIRCLE: "CIR", TRAIL: "TRL" };
var normalizeAddress = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();
async function addressDigest(v) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeAddress(v)))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var streetKey2 = (s) => s.toUpperCase().replace(/\./g, "").replace(/\b[A-Z]+\b/g, (w) => aliases2[w] || w).replace(/\s+/g, " ").trim();
function parseAddress2(value2) {
  if (typeof value2 !== "string" || value2.length > 600 || /[\r\n<>@=]|https?:|password|passwd|pwd|token|secret|credential|gate[\s-]*code|access[\s-]*code|\bpin\b/i.test(value2)) return null;
  const m = /^\s*(\d+[A-Z]?\s+[A-Za-z0-9 .'-]+),\s*([A-Za-z .'-]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(?:-\d{4})?\s*$/i.exec(value2);
  if (!m) return null;
  const states2 = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" ");
  if (!states2.includes(m[3].toUpperCase())) return null;
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
}
function compareAddress2(a, b) {
  return streetKey2(a.street) === streetKey2(b.street) && a.city.toUpperCase() === b.city.toUpperCase() && a.state === b.state && a.zip === b.zip;
}

// tech-checks/supabase/functions/cos-operations-pages/placementProjection.ts
var object7 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid6 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var fullKey = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase() : "";
var auditKey = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var idString = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var stamp2 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
var text4 = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function fail2(message) {
  throw Object.assign(new Error(message), { status: 503 });
}
function placementMatchKey(value2) {
  if (typeof value2 !== "string") return "";
  const m = /^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value2.trim()) || /^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value2.trim());
  if (!m) return "full:" + fullKey(value2);
  const f = m[1].toUpperCase().replace(/\s/g, ""), family = { RI: "RECON", RII: "RECON2", RECONII: "RECON2" }[f] || f;
  const [whole2, fraction] = m[2].split(".");
  if (Number(whole2) === 0) return "full:" + fullKey(value2);
  return "typed:" + family + "|" + Number(whole2) + (fraction === void 0 ? "" : "." + fraction) + (m[3] ? "|" + m[3].toUpperCase() : "");
}
function placementIdentityConcernKey(value2) {
  const key2 = placementMatchKey(value2);
  if (!key2.startsWith("typed:")) return key2;
  const [family, number2] = key2.slice(6).split("|");
  const related = ["SPOTTER", "SOLARSPOTTER", "AXISSPOTTER", "AXISSOLARSPOTTER"].includes(family) ? "SPOTTER" : /^SNIPER[24]?$/.test(family) ? "SNIPER" : /^RECON2?$/.test(family) ? "RECON" : family;
  return "concern:" + related + "|" + number2;
}
function currentOwnerPlacements(audits, devices) {
  if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) fail2("Current placement could not be verified. Reload the unit.");
  const latest = /* @__PURE__ */ new Map(), marked = /* @__PURE__ */ new Map();
  for (const a of audits) {
    if (!object7(a) || !idString(a.id) || typeof a.unit_key !== "string") fail2("Placement history returned an invalid identity.");
    const key2 = auditKey(a.unit_key), previous = latest.get(key2);
    if (!previous || BigInt(idString(a.id)) > BigInt(idString(previous.id))) latest.set(key2, a);
    const previousMarked = marked.get(key2);
    if (a.contract === "COS_CAMERA_PLACEMENT_V2" && (!previousMarked || BigInt(idString(a.id)) > BigInt(idString(previousMarked.id)))) marked.set(key2, a);
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
        if (object7(d)) {
          const key2 = auditKey(d.unit_key), ids2 = currentByKey.get(key2) || [];
          ids2.push(idString(d.id));
          currentByKey.set(key2, ids2);
        }
      });
    }
    const current = currentByKey.get(auditKey(a.unit_key)) || [];
    if (!ids.length || ids.some((id15) => !id15) || current.some((id15) => !id15) || new Set(ids).size !== ids.length || new Set(current).size !== current.length || ids.length !== current.length || ids.some((id15) => !current.includes(id15))) conflictReason = "Camera identity changed after its placement move. Review this unit before using its field location.";
    if (!["SHOP", "FIELD"].includes(a.placement) || a.action !== (a.placement === "SHOP" ? "MOVE_TO_ROOT" : "MOVE_TO_FIELD") || !Number.isFinite(stamp2(a.created_at)) || !uuid6(a.request_id) || !uuid6(a.control_id) || a.placement === "FIELD" && (!text4(a.site_label, 250) || !text4(a.street_address, 600))) fail2("The saved Owner placement is incomplete.");
    const matchKey = placementMatchKey(a.unit_key);
    if (!aliasesByMatch && !devices.some((d) => d == null)) {
      aliasesByMatch = /* @__PURE__ */ new Map();
      devices.forEach((d) => {
        const key2 = placementMatchKey(d.unit_key), aliases6 = aliasesByMatch.get(key2) || /* @__PURE__ */ new Set();
        aliases6.add(auditKey(d.unit_key));
        aliasesByMatch.set(key2, aliases6);
      });
    }
    const aliases5 = aliasesByMatch?.get(matchKey);
    if (aliasesByMatch ? aliases5 && (aliases5.size > 1 || !aliases5.has(auditKey(a.unit_key))) : devices.some((d) => placementMatchKey(d.unit_key) === matchKey && auditKey(d.unit_key) !== auditKey(a.unit_key))) conflictReason = "Camera aliases need review before this unit\u2019s placement can be shown.";
    overrides.push({ ...a, matchKey, conflictReason });
  }
  return overrides;
}
async function addressHash(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value2.replace(/\s+/g, " ").trim().toLowerCase()))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var coordinate = (v, limit) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
async function movedRow(raw, a) {
  const { _sourceField: _source, _placementProof: proof, ...row2 } = raw;
  const address3 = a.placement === "FIELD" ? a.street_address : row2.address;
  const valid = a.placement === "FIELD" && row2.readOnly === false && row2.hasUnitGps === true && object7(proof) && proof.owner === true && uuid6(proof.historyId) && coordinate(row2.historicalLatitude, 90) && coordinate(row2.historicalLongitude, 180) && stamp2(row2.gpsRecordedAt) > stamp2(a.created_at) && typeof proof.note === "string" && proof.note.split("\n")[0] === "COS_FIELD_LOCATION_V1|address_sha256=" + await addressHash(address3) + "|confirmed=true";
  return {
    ...row2,
    placement: a.placement,
    placementSource: "owner",
    placementUnitKey: a.unit_key,
    placementAuditId: idString(a.id),
    placementUpdatedAt: a.created_at,
    currentLocationType: a.placement.toLowerCase(),
    status: a.placement === "FIELD" ? "field" : row2.status,
    installedSiteId: null,
    customer: null,
    activeJobNumber: null,
    site: a.placement === "FIELD" ? a.site_label : row2.site,
    address: address3,
    addressSource: a.placement === "FIELD" ? "Owner confirmed installation address" : row2.addressSource,
    addressUpdatedAt: a.placement === "FIELD" ? a.created_at : row2.addressUpdatedAt,
    latitude: valid ? row2.historicalLatitude : null,
    longitude: valid ? row2.historicalLongitude : null,
    coordinateSource: valid ? row2.historicalCoordinateSource : null,
    locationVerification: valid ? "owner_verified" : "address_changed",
    locationVerifiedAt: valid ? row2.gpsRecordedAt : null,
    locationHistoryId: valid ? proof.historyId : null,
    addressEstimateTrackerId: null,
    addressEstimateUnitNumber: null,
    locationNote: row2.locationNote
  };
}
var sameIds = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((id15) => b.includes(id15));
function nativePlacementAliases(inventory, audits, devices, overrides, identity4) {
  if (!object7(identity4) || identity4.identityVersion !== 1 || !Array.isArray(identity4.unitIdentities) || !Array.isArray(identity4.identityWarnings)) fail2("Reviewed placement identities are unavailable.");
  if (new Set(audits.map((a) => idString(a.id))).size !== audits.length) fail2("Placement history returned duplicate audit identities.");
  if (identity4.ownerConfirmedIdentityVersion === void 0 ? identity4.ownerConfirmedUnitIdentities !== void 0 : identity4.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(identity4.ownerConfirmedUnitIdentities) || identity4.ownerConfirmedUnitIdentities.length > 1e3 || identity4.ownerConfirmedUnitIdentities.some((p) => p.kind !== "owner_confirmed_native")) fail2("Owner-confirmed placement identity contract is unavailable.");
  if (identity4.unitIdentities.some((p) => p.kind === "owner_confirmed_native")) fail2("Owner-confirmed identities require their additive contract.");
  const proofs = [...identity4.unitIdentities, ...identity4.ownerConfirmedUnitIdentities || []], warnings = identity4.identityWarnings;
  if (proofs.some((p) => !object7(p) || !uuid6(p.unitId) || !text4(p.unitNumber, 250) || !["native_provider", "owner_placement", "owner_confirmed_native"].includes(p.kind) || !Array.isArray(p.deviceIds) || !p.deviceIds.length || p.deviceIds.some((id15) => typeof id15 !== "string" || idString(id15) !== id15) || !Array.isArray(p.unitKeys) || !p.unitKeys.length || p.unitKeys.some((key2) => !text4(key2, 250)) || !/^[a-f0-9]{64}$/.test(p.proof)) || warnings.some((w) => !object7(w) || !uuid6(w.unitId) && !/^unavailable:[a-f0-9]{64}$/.test(w.unitId) || !text4(w.reason, 1e3) || !Array.isArray(w.deviceIds) || w.deviceIds.some((id15) => typeof id15 !== "string" || idString(id15) !== id15) || new Set(w.deviceIds).size !== w.deviceIds.length || !Array.isArray(w.unitKeys) || w.unitKeys.some((key2) => !text4(key2, 250)) || new Set(w.unitKeys).size !== w.unitKeys.length)) fail2("Reviewed placement identities are malformed.");
  const normalizedKeys = /* @__PURE__ */ new Map(), matchedKeys = /* @__PURE__ */ new Map();
  const keyOf = (value2) => {
    if (typeof value2 !== "string") return auditKey(value2);
    let key2 = normalizedKeys.get(value2);
    if (key2 === void 0) {
      key2 = auditKey(value2);
      normalizedKeys.set(value2, key2);
    }
    return key2;
  };
  const match = (value2) => {
    if (typeof value2 !== "string") return placementMatchKey(value2);
    let key2 = matchedKeys.get(value2);
    if (key2 === void 0) {
      key2 = placementMatchKey(value2);
      matchedKeys.set(value2, key2);
    }
    return key2;
  };
  const related = (claim, key2, ids) => claim.unitKeys.some((k) => keyOf(k) === keyOf(key2)) || claim.deviceIds.some((id15) => ids.includes(id15));
  const index2 = (rows4, keys3) => {
    const map = /* @__PURE__ */ new Map();
    rows4.forEach((r, i) => {
      for (const key2 of new Set(keys3(r))) {
        const group = map.get(key2) || [];
        group.push(i);
        map.set(key2, group);
      }
    });
    return map;
  };
  const union = (lookups) => {
    const found = /* @__PURE__ */ new Set();
    for (const [map, keys3] of lookups) for (const key2 of keys3) for (const i of map.get(key2) || []) found.add(i);
    return [...found].sort((a, b) => a - b);
  };
  const proofUnits = index2(proofs, (p) => [p.unitId]), proofKeys = index2(proofs, (p) => p.unitKeys.map(keyOf)), proofDevices = index2(proofs, (p) => p.deviceIds);
  const warningUnits = index2(warnings, (p) => [p.unitId]), warningKeys = index2(warnings, (p) => p.unitKeys.map(keyOf)), warningDevices = index2(warnings, (p) => p.deviceIds);
  const inventoryIds = index2(inventory, (r) => [r.id]), inventoryMatches = index2(inventory, (r) => [match(r.unitNumber)]);
  const auditKeys = index2(audits, (a) => [keyOf(a.unit_key)]), auditMatches = index2(audits, (a) => [match(a.unit_key)]), auditDevices = index2(audits, (a) => Array.isArray(a.device_ids) ? a.device_ids.map(idString).filter((v) => v !== null) : []), auditControls = index2(audits, (a) => [a.control_id]);
  const overrideKeys = index2(overrides, (a) => [keyOf(a.unit_key)]);
  let deviceKeys, deviceMatches;
  const ensureDevices = () => {
    if (!deviceKeys) {
      deviceKeys = index2(devices, (d) => [keyOf(d.unit_key)]);
      deviceMatches = index2(devices, (d) => [match(d.unit_key)]);
    }
  };
  const targets = [], blocked = /* @__PURE__ */ new Map();
  const block = (key2, ids) => blocked.set(keyOf(key2), /* @__PURE__ */ new Set([...blocked.get(keyOf(key2)) || [], ...ids]));
  for (const warning of warnings) {
    for (const key2 of warning.unitKeys) block(key2, [warning.unitId]);
    for (const a of overrides) if (related(warning, a.unit_key, a.device_ids.map(idString))) block(a.unit_key, [warning.unitId]);
  }
  for (const proof of proofs.filter((p) => ["native_provider", "owner_confirmed_native"].includes(p.kind))) {
    const keys3 = proof.unitKeys, rawKey = keys3[0], rawMatch = match(rawKey), nativeMatch = match(proof.unitNumber);
    ensureDevices();
    const rows4 = (inventoryIds.get(proof.unitId) || []).map((i) => inventory[i]), group = (deviceKeys.get(keyOf(rawKey)) || []).map((i) => devices[i]);
    const ids = group.map((d) => idString(d.id)), latest = (auditKeys.get(keyOf(rawKey)) || []).map((i) => audits[i]).sort((a, b) => BigInt(idString(a.id)) > BigInt(idString(b.id)) ? -1 : 1)[0];
    const current = overrides[(overrideKeys.get(keyOf(rawKey)) || [])[0]];
    const relatedProofs = union([[proofUnits, [proof.unitId]], [proofKeys, keys3.map(keyOf)], [proofDevices, proof.deviceIds]]);
    const competingRows = union([[inventoryMatches, [rawMatch, nativeMatch]]]).map((i) => inventory[i]).filter((row2) => row2.id !== proof.unitId);
    const auditConflict = union([[auditMatches, [rawMatch, nativeMatch]], [auditDevices, proof.deviceIds], [auditControls, current ? [current.control_id] : []]]).some((i) => keyOf(audits[i].unit_key) !== keyOf(rawKey));
    const valid = keys3.length === 1 && rawKey === rawKey.trim() && rows4.length === 1 && rows4[0].readOnly === false && rows4[0].unitNumber === proof.unitNumber && group.length > 0 && group.every((d) => d.unit_key === rawKey) && sameIds(proof.deviceIds, ids) && relatedProofs.length === 1 && !competingRows.length && !union([[warningUnits, [proof.unitId]], [warningKeys, [keyOf(rawKey)]], [warningDevices, proof.deviceIds]]).length && !union([[deviceMatches, [rawMatch, nativeMatch]]]).some((i) => devices[i].unit_key !== rawKey) && !auditConflict && (!current || !current.conflictReason && current.unit_key === rawKey && sameIds(current.device_ids.map(idString), proof.deviceIds) && latest && idString(latest.id) === idString(current.id) && !inventory.some((row2) => row2.id === current.control_id)) && (!latest || latest.unit_key === rawKey);
    if (!valid) {
      for (const key2 of keys3) block(key2, [proof.unitId, ...competingRows.map((r) => r.id)]);
      continue;
    }
    targets.push({
      contract: "COS_NATIVE_PLACEMENT_ALIAS_V1",
      writerContract: "COS_CAMERA_PLACEMENT_V2",
      unitId: proof.unitId,
      unitNumber: proof.unitNumber,
      unitKey: rawKey,
      deviceIds: [...proof.deviceIds].sort(),
      proof: proof.proof,
      auditId: latest ? idString(latest.id) : null
    });
  }
  for (const a of overrides) if (overrides.some((other) => other !== a && other.control_id === a.control_id)) block(a.unit_key, proofs.filter((p) => related(p, a.unit_key, a.device_ids.map(idString))).map((p) => p.unitId));
  for (const a of overrides) {
    const rows4 = inventory.filter((row2) => match(row2.unitNumber) === a.matchKey);
    for (const row2 of rows4) if (proofs.some((p) => ["native_provider", "owner_confirmed_native"].includes(p.kind) && p.unitId === row2.id && !related(p, a.unit_key, a.device_ids.map(idString))) || warnings.some((w) => w.unitId === row2.id)) block(a.unit_key, [row2.id]);
  }
  return { targets: targets.filter((t) => !blocked.has(keyOf(t.unitKey))), blocked };
}
async function projectOwnerPlacement(snapshot, audits, devices, identity4, nativeUnits) {
  if (!object7(snapshot) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !object7(snapshot.summary)) fail2("Field placement is unavailable. Reload the Field Map.");
  if (identity4) {
    if (!Array.isArray(nativeUnits) || nativeUnits.length > 1e5 || nativeUnits.some((row2) => !object7(row2) || !uuid6(row2.id) || !text4(row2.unit_number, 250)) || new Set(nativeUnits.map((row2) => row2.id)).size !== nativeUnits.length) fail2("Native inventory identity membership is unavailable or duplicated.");
    const byNativeId = new Map(nativeUnits.map((row2) => [row2.id, row2]));
    if (snapshot.inventoryItems.some((row2) => row2?.readOnly === false && (!byNativeId.has(row2.id) || byNativeId.get(row2.id).unit_number !== row2.unitNumber))) fail2("Native inventory changed while Field Map was loading. Reload before using its placement.");
  }
  const overrides = currentOwnerPlacements(audits, devices), byKey = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  for (const row2 of snapshot.inventoryItems) {
    if (!object7(row2) || !uuid6(row2.id) || seen.has(row2.id) || typeof row2.unitNumber !== "string" || typeof row2._sourceField !== "boolean") fail2("Field inventory returned inconsistent identities.");
    seen.add(row2.id);
    const key2 = placementMatchKey(row2.unitNumber);
    byKey.set(key2, [...byKey.get(key2) || [], row2]);
  }
  const aliases5 = identity4 ? nativePlacementAliases(snapshot.inventoryItems, audits, devices, overrides, identity4) : null;
  const replacements = /* @__PURE__ */ new Map(), extra = [], placementReviews = [];
  const hold = (a, matches2, reason) => {
    placementReviews.push({ unitNumber: a.unit_key, reason, placementAuditId: idString(a.id) });
    for (const raw of matches2) {
      const { _sourceField: _source, _placementProof: _proof, ...row2 } = raw;
      replacements.set(row2.id, { ...row2, placement: "UNKNOWN", placementStatus: "needs_identity_review", placementReviewReason: reason, latitude: null, longitude: null, coordinateSource: null, locationVerification: "address_changed", locationVerifiedAt: null, locationHistoryId: null, addressEstimateTrackerId: null, addressEstimateUnitNumber: null });
    }
  };
  if (identity4) for (const warning of identity4.identityWarnings) {
    const rows4 = snapshot.inventoryItems.filter((row2) => row2.id === warning.unitId);
    if (rows4.length) hold({ unit_key: rows4[0].unitNumber, id: null }, rows4, warning.reason || "The reviewed native identity is unavailable. Review this unit before using its location.");
  }
  for (const a of overrides) {
    const target = aliases5?.targets.find((t) => t.unitKey === a.unit_key), blocked = aliases5?.blocked.get(auditKey(a.unit_key));
    const matches2 = target ? snapshot.inventoryItems.filter((row2) => row2.id === target.unitId) : byKey.get(a.matchKey) || [];
    if (blocked) {
      hold(a, [.../* @__PURE__ */ new Set([...matches2, ...snapshot.inventoryItems.filter((row2) => blocked.has(row2.id))])], "The reviewed native placement association changed or is ambiguous. Review this unit\u2019s identity.");
      continue;
    }
    if (a.conflictReason || matches2.length > 1) {
      hold(a, matches2, a.conflictReason || "The moved camera matches more than one field record. Review its identity.");
      continue;
    }
    if (matches2.length === 1) replacements.set(matches2[0].id, await movedRow(matches2[0], a));
    else if (a.placement === "FIELD") {
      const possible = snapshot.inventoryItems.filter((row2) => row2.readOnly === false && placementIdentityConcernKey(row2.unitNumber) === placementIdentityConcernKey(a.unit_key));
      if (possible.length) {
        hold(a, possible, "A possible existing equipment model or suffix needs explicit Owner identity review before creating a separate camera placement.");
        continue;
      }
      if (seen.has(a.control_id) || extra.some((r) => r.id === a.control_id)) {
        hold(a, matches2, "The camera placement identity conflicts with an existing map record. Review its identity.");
        continue;
      }
      extra.push({
        id: a.control_id,
        unitNumber: a.unit_key,
        modelName: "Camera unit",
        status: "field",
        currentLocationType: "field",
        site: a.site_label,
        address: a.street_address,
        addressSource: "Owner confirmed installation address",
        readOnly: true,
        recordSource: "Owner camera placement",
        hasUnitGps: false,
        latitude: null,
        longitude: null,
        coordinateSource: null,
        locationVerification: "address_only",
        locationNote: "Camera unit is not linked to registered equipment. Verify its identity before saving a map pin.",
        placement: "FIELD",
        placementSource: "owner",
        placementUnitKey: a.unit_key,
        placementAuditId: idString(a.id),
        placementUpdatedAt: a.created_at
      });
    }
  }
  const inventory = snapshot.inventoryItems.map((raw) => {
    const { _sourceField: _source, _placementProof: _proof, ...row2 } = raw;
    return replacements.get(raw.id) || row2;
  });
  const items = snapshot.inventoryItems.filter((row2) => replacements.has(row2.id) ? replacements.get(row2.id).placement === "FIELD" : row2._sourceField === true).map((raw) => {
    const { _sourceField: _source, _placementProof: _proof, ...row2 } = raw;
    return replacements.get(raw.id) || row2;
  }).concat(extra);
  return { ...snapshot, items, inventoryItems: inventory.concat(extra), placementReviews, ...aliases5 ? { placementProjectionVersion: 2, nativePlacementAliases: aliases5.targets } : {}, summary: {
    ...snapshot.summary,
    fieldUnits: items.length,
    mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length,
    unitGps: items.filter((r) => r.hasUnitGps === true).length,
    missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length,
    addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length
  } };
}
function projectCameraOwnerPlacement(devices, audits) {
  const overrides = currentOwnerPlacements(audits, devices), byUnit = new Map(overrides.map((a) => [auditKey(a.unit_key), a.conflictReason ? "UNKNOWN" : a.placement])), conflicts = new Set(overrides.filter((a) => a.conflictReason).map((a) => a.matchKey));
  return devices.map((row2) => conflicts.has(placementMatchKey(row2.unit_key)) ? { ...row2, __ownerPlacement: "UNKNOWN" } : byUnit.has(auditKey(row2.unit_key)) ? { ...row2, __ownerPlacement: byUnit.get(auditKey(row2.unit_key)) } : row2);
}

// tech-checks/supabase/functions/cos-operations-pages/importedAddressContract.ts
var states = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split(" "));
var unsafe = /[\r\n<>@=]|https?:|password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox|gate[\s-]*code|access[\s-]*code|\bpin\b|\b(?:apt|apartment|suite|ste|unit|floor|bldg|building|contact|call|customer|phone|telephone|tel|email|login|username|password|passwd|pwd|token|secret|credential|code|note|notes)\b|\d{3}[-.]\d{3}[-.]\d{4}/i;
function validInstallation(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const p = v;
  return typeof p.street === "string" && p.street.length <= 300 && /^\d+[A-Z]?\s+[A-Za-z0-9 .'-]+$/i.test(p.street) && p.street === p.street.trim() && typeof p.state === "string" && states.has(p.state) && (typeof p.city === "string" && p.city.length <= 100 && /^[A-Za-z .'-]+$/.test(p.city) && p.city === p.city.trim() && p.city.length > 0 || p.city === null) && (typeof p.zip === "string" && /^\d{5}(?:-\d{4})?$/.test(p.zip) || p.zip === null) && (p.city !== null || p.zip !== null) && ![p.street, p.city, p.state, p.zip].filter((v2) => v2 !== null).some((v2) => unsafe.test(v2));
}
var installationAddress = (p) => [p.street, p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
var suppliedComponents = (p) => ({ street: true, city: p.city !== null, state: true, zip: p.zip !== null });
function fullMatchedParts(value2) {
  const p = parseAddress2(value2);
  if (!p || typeof value2 !== "string" || unsafe.test(value2)) return null;
  const zip = /(\d{5}(?:-\d{4})?)\s*$/.exec(value2)?.[1];
  return zip ? { ...p, zip } : null;
}
function usPostalCode(value2) {
  if (typeof value2 === "number") return Number.isInteger(value2) && value2 >= 1e4 && value2 <= 99999 ? String(value2) : null;
  return typeof value2 === "string" && /^\d{5}(?:-\d{4})?$/.test(value2) ? value2 : null;
}
function sameUsPostalCode(left, right) {
  const a = usPostalCode(left), b = usPostalCode(right);
  return a !== null && b !== null && a.slice(0, 5) === b.slice(0, 5) && (a.length === 5 || b.length === 5 || a === b);
}
var geocodeRejectionReasons = ["provider_empty", "ambiguous_results", "provider_warning", "invalid_components", "component_mismatch", "formatted_address_mismatch", "unsupported_method", "low_accuracy", "invalid_coordinates", "provider_rejected"];
function safeGeocodeRejectionReason(value2) {
  return geocodeRejectionReasons.find((reason) => reason === value2) ?? null;
}
function matchesInstallation(expected, matchedAddress) {
  if (!validInstallation(expected)) return false;
  const actual = fullMatchedParts(matchedAddress);
  if (!actual) return false;
  if (expected.zip !== null && !sameUsPostalCode(expected.zip, actual.zip)) return false;
  return compareAddress2({ street: expected.street, city: expected.city ?? actual.city, state: expected.state, zip: actual.zip }, actual);
}

// tech-checks/supabase/functions/_shared/trackerNativeSource.ts
var trackerRecordId = (v) => typeof v === "string" && v.length <= 400 && /^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
function validNativeTrackerLabel(value2) {
  if (!trackerRecordId(value2.sourceRecordId)) return false;
  const [family, number2] = value2.sourceRecordId.slice(value2.sourceRecordId.lastIndexOf(":") + 1).split("|");
  return value2.unitNumber === family + " " + number2 && value2.family === family && value2.variant === null;
}

// tech-checks/supabase/functions/cos-operations-pages/archivedRepresentationProjection.ts
var ORG = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var object8 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid7 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var sha2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var base = (v) => placementMatchKey(v).replace(/\|(?:HD4|HDC[24]S?)$/, "");
var id2 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var array = (v) => Array.isArray(v) && v.length <= 1e5 && v.every(object8);
var protectedRow = (r) => r.hasUnitGps === true || r.installedSiteId != null || r.placementSource === "owner" || r.placementAuditId != null || r.locationVerification === "owner_verified" || r.locationHistoryId != null || r.placementStatus === "needs_identity_review" || r.placement === "UNKNOWN";
function checkedArchivedRepresentations(inventory, proofs, audits, devices, context) {
  if (!context || !array(inventory) || !array(proofs) || proofs.length > 50 || !array(audits) || !array(devices) || !array(context.nativeUnits)) return [];
  const units = context.nativeUnits, identity4 = context.identity;
  if (!object8(identity4) || identity4.identityVersion !== 1 || !array(identity4.unitIdentities) || !array(identity4.identityWarnings) || (identity4.ownerConfirmedIdentityVersion === void 0 ? identity4.ownerConfirmedUnitIdentities !== void 0 : identity4.ownerConfirmedIdentityVersion !== 1 || !array(identity4.ownerConfirmedUnitIdentities))) return [];
  const native = inventory.filter((r) => r.readOnly === false), nativeIds = new Set(native.map((r) => r.id));
  if (new Set(inventory.map((r) => r.id)).size !== inventory.length || nativeIds.size !== units.length || new Set(units.map((u) => u.id)).size !== units.length || units.some((u) => !uuid7(u.id) || u.organization_id !== ORG || typeof u.unit_number !== "string" || !nativeIds.has(u.id) || native.find((r) => r.id === u.id)?.unitNumber !== u.unit_number) || audits.some((a) => !id2(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((v) => !id2(v))) || devices.some((d) => !id2(d.id) || typeof d.unit_key !== "string") || new Set(devices.map((d) => id2(d.id))).size !== devices.length || new Set(audits.map((a) => id2(a.id))).size !== audits.length) return [];
  const claims = [...identity4.unitIdentities, ...identity4.ownerConfirmedUnitIdentities || []];
  if (claims.some((p) => !uuid7(p.unitId) || typeof p.unitNumber !== "string" || !["native_provider", "owner_placement", "owner_confirmed_native"].includes(p.kind) || !sha2(p.proof) || !Array.isArray(p.unitKeys) || !p.unitKeys.length || p.unitKeys.some((k) => typeof k !== "string") || !Array.isArray(p.deviceIds) || !p.deviceIds.length || p.deviceIds.some((v) => typeof v !== "string" || !id2(v))) || identity4.identityWarnings.some((w) => typeof w.unitId !== "string" || !Array.isArray(w.unitKeys) || w.unitKeys.some((k) => typeof k !== "string") || !Array.isArray(w.deviceIds) || w.deviceIds.some((v) => typeof v !== "string" || !id2(v)))) return [];
  const endpoints = proofs.flatMap((p) => [p.archivedNativeId, p.canonicalNativeId, p.archivedTrackerId, p.canonicalTrackerId]);
  if (new Set(endpoints).size !== endpoints.length) return [];
  const previous = context.previousArchivedRepresentations;
  if (previous !== void 0 && !array(previous)) return [];
  return proofs.filter((p) => {
    if (p.state !== "active" || p.contract !== "COS_ARCHIVED_REPRESENTATION_V1" || p.organizationId !== ORG || p.provenance !== "postgres_admin_reviewed_source_archive" || p.recordedByDatabaseRole !== "postgres" || !["id", "revision", "archivedNativeId", "canonicalNativeId", "archivedTrackerId", "canonicalTrackerId"].every((k) => uuid7(p[k])) || !["reviewSha256", "evidenceSha256", "beforeSha256"].every((k) => sha2(p[k])) || typeof p.archivedUnitNumber !== "string" || typeof p.canonicalUnitNumber !== "string") return false;
    if (previous !== void 0 && !previous.some((v) => JSON.stringify(v) === JSON.stringify(p))) return false;
    const old = native.find((r) => r.id === p.archivedNativeId), canonical2 = native.find((r) => r.id === p.canonicalNativeId), key2 = base(p.archivedUnitNumber);
    if (!old || !canonical2 || old.unitNumber !== p.archivedUnitNumber || canonical2.unitNumber !== p.canonicalUnitNumber || !key2.startsWith("typed:") || key2 !== base(p.canonicalUnitNumber) || protectedRow(old) || ["retired", "deleted"].includes(old.status) || ["retired", "deleted"].includes(canonical2.status)) return false;
    if (inventory.some((r) => r.id === p.archivedTrackerId && (r.readOnly !== true || r.unitNumber !== p.archivedUnitNumber || protectedRow(r)) || r.id === p.canonicalTrackerId && (r.readOnly !== true || r.unitNumber !== p.canonicalUnitNumber))) return false;
    const group = devices.filter((d) => base(d.unit_key) === key2), ids = new Set(group.map((d) => id2(d.id)));
    if (group.some((d) => placementMatchKey(d.unit_key) === placementMatchKey(p.archivedUnitNumber))) return false;
    const related = (v) => v.unitId === p.archivedNativeId || v.unitId === p.canonicalNativeId || v.unitKeys.some((k) => base(k) === key2) || v.deviceIds.some((v2) => ids.has(id2(v2)));
    if (identity4.identityWarnings.some(related)) return false;
    const canonicalClaims = claims.filter((c) => c.unitId === p.canonicalNativeId && c.unitNumber === p.canonicalUnitNumber && ["native_provider", "owner_confirmed_native"].includes(c.kind));
    if (claims.some((c) => related(c) && !canonicalClaims.includes(c))) return false;
    if (audits.some((a) => (base(a.unit_key) === key2 || a.device_ids.some((v) => ids.has(id2(v)))) && (placementMatchKey(a.unit_key) === placementMatchKey(p.archivedUnitNumber) || !canonicalClaims.some((c) => c.unitKeys.includes(a.unit_key) && a.device_ids.length > 0 && a.device_ids.every((v) => c.deviceIds.includes(id2(v))))))) return false;
    return true;
  });
}
var evidenceEnvelope = (p) => p.contract === "COS_ARCHIVED_REPRESENTATION_V1" && p.organizationId === ORG && ["active", "conflict"].includes(p.state) && p.provenance === "postgres_admin_reviewed_source_archive" && p.recordedByDatabaseRole === "postgres" && ["id", "revision", "archivedNativeId", "canonicalNativeId", "archivedTrackerId", "canonicalTrackerId"].every((k) => uuid7(p[k])) && ["reviewSha256", "evidenceSha256", "beforeSha256"].every((k) => sha2(p[k]));
function decisions(inventory, proofs, audits, devices, context) {
  const accepted = checkedArchivedRepresentations(inventory, proofs, audits, devices, context);
  const prior = array(context?.previousArchivedRepresentations) ? context.previousArchivedRepresentations : [];
  const candidates = [...array(proofs) ? proofs : [], ...prior].filter(evidenceEnvelope);
  const conflictMap = /* @__PURE__ */ new Map();
  for (const p of candidates) if (!accepted.some((a) => a.id === p.id)) conflictMap.set(p.id, p);
  return { accepted, conflicts: [...conflictMap.values()] };
}
var conflictRow = (r) => {
  const { locationImportedGeocode: _estimate, ...row2 } = r;
  return { ...row2, representationStatus: "conflict", representationReason: "The archived and retained records have conflicting identity evidence. Review their association.", placement: "UNKNOWN", placementStatus: "needs_identity_review", latitude: null, longitude: null, coordinateSource: null, currentLocationType: "unknown", _sourceField: false };
};
var metadata = (accepted, conflicts) => ({ contract: "COS_ARCHIVED_REPRESENTATION_V1", suppressed: accepted.map((p) => ({ id: p.id, revision: p.revision, archivedNativeId: p.archivedNativeId, canonicalNativeId: p.canonicalNativeId })), conflicts: conflicts.map((p) => ({ id: p.id, archivedNativeId: p.archivedNativeId, canonicalNativeId: p.canonicalNativeId, reason: p.conflictReason || "current_authority_conflict" })) });
function projectArchivedRepresentations(snapshot, proofs, audits, devices, context) {
  const { accepted, conflicts } = decisions(snapshot.inventoryItems, proofs, audits, devices, context);
  if (!accepted.length && !conflicts.length) return snapshot;
  const hidden = new Set(accepted.flatMap((p) => [p.archivedNativeId, p.archivedTrackerId]));
  const held = new Set(conflicts.flatMap((p) => [p.archivedNativeId, p.archivedTrackerId, p.canonicalNativeId, p.canonicalTrackerId]));
  const inventoryItems = snapshot.inventoryItems.filter((r) => !hidden.has(r.id)).map((r) => held.has(r.id) ? conflictRow(r) : r);
  const items = snapshot.items.filter((r) => !hidden.has(r.id) && !held.has(r.id));
  return {
    ...snapshot,
    items,
    inventoryItems,
    placementReviews: [...Array.isArray(snapshot.placementReviews) ? snapshot.placementReviews : [], ...conflicts.map((p) => ({ unitNumber: p.canonicalUnitNumber || p.archivedUnitNumber, reason: "The archived and retained records have conflicting identity evidence. Their map pins are held for review.", placementAuditId: null }))],
    representationProjection: metadata(accepted, conflicts),
    summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, unitGps: items.filter((r) => r.hasUnitGps === true).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length }
  };
}
function projectArchivedEquipmentRegistry(snapshot, proofs, audits, devices, context) {
  if (!array(snapshot.items) || !array(snapshot.trackerUnits)) return snapshot;
  const inventory = [...snapshot.items.map((r) => ({ ...r, readOnly: false })), ...snapshot.trackerUnits];
  const { accepted, conflicts } = decisions(inventory, proofs, audits, devices, context);
  if (!accepted.length && !conflicts.length) return snapshot;
  const hidden = new Set(accepted.flatMap((p) => [p.archivedNativeId, p.archivedTrackerId]));
  const held = new Set(conflicts.flatMap((p) => [p.archivedNativeId, p.archivedTrackerId, p.canonicalNativeId, p.canonicalTrackerId]));
  const apply = (rows4) => rows4.filter((r) => !hidden.has(r.id)).map((r) => held.has(r.id) ? { ...r, representationStatus: "conflict", representationReason: "The archived and retained records have conflicting identity evidence. Review their association." } : r);
  return { ...snapshot, items: apply(snapshot.items), trackerUnits: apply(snapshot.trackerUnits), representationProjection: metadata(accepted, conflicts) };
}

// tech-checks/supabase/functions/_shared/sourcePrecedence.ts
var object9 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid8 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var sha3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var id3 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
var text5 = (v) => typeof v === "string" && v === v.trim() && v.length > 0 && v.length <= 250 && !/[\x00-\x1f\x7f]/.test(v);
var keys = ["contract", "decisionId", "reviewedSourceRevision", "sourceRevision", "unitKey", "deviceIds", "legacyAuditId", "legacyAuditSha256", "legacyAuditRowSha256", "reviewedAt", "reviewKind"];
function checkedSourcePrecedence(source) {
  if (!object9(source) || !Object.hasOwn(source, "sourcePrecedence")) return null;
  const p = source.sourcePrecedence;
  if (source.schemaVersion !== 1 || source.sourceSystem !== "mhelpdesk_product_import" || source.entityKind !== "equipment_unit" || source.eligibility !== "FIELD" || !object9(p) || Object.keys(p).length !== keys.length || !keys.every((k) => Object.hasOwn(p, k)) || p.contract !== "COS_REVIEWED_SOURCE_PRECEDENCE_V1" || p.reviewKind !== "administrator_import_review" || !uuid8(p.decisionId) || !uuid8(p.reviewedSourceRevision) || !uuid8(p.sourceRevision) || p.sourceRevision !== source.sourceRevision || p.reviewedSourceRevision === p.sourceRevision || !text5(p.unitKey) || !id3(p.legacyAuditId) || !sha3(p.legacyAuditSha256) || !sha3(p.legacyAuditRowSha256) || typeof p.reviewedAt !== "string" || !Number.isFinite(Date.parse(p.reviewedAt)) || !Array.isArray(p.deviceIds) || !p.deviceIds.length || p.deviceIds.length > 1e3 || p.deviceIds.some((v) => !id3(v)) || new Set(p.deviceIds).size !== p.deviceIds.length) return null;
  return { contract: p.contract, decisionId: p.decisionId, reviewedSourceRevision: p.reviewedSourceRevision, sourceRevision: p.sourceRevision, unitKey: p.unitKey, deviceIds: [...p.deviceIds], legacyAuditId: p.legacyAuditId, legacyAuditSha256: p.legacyAuditSha256, legacyAuditRowSha256: p.legacyAuditRowSha256, reviewedAt: p.reviewedAt, reviewKind: p.reviewKind };
}
async function sourcePrecedenceAuditSha256(a) {
  const auditId = String(a.id), ids = Array.isArray(a.device_ids) ? a.device_ids.map(String) : [];
  const stamp6 = typeof a.created_at === "string" ? Date.parse(a.created_at) : NaN;
  if (!id3(auditId) || !text5(a.unit_key) || !text5(a.action) || !Number.isFinite(stamp6) || !ids.length || ids.some((v) => !id3(v)) || new Set(ids).size !== ids.length) return null;
  const fraction = /\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/.exec(a.created_at)?.[1] || "";
  const micros = String(BigInt(stamp6) * 1000n + BigInt((fraction + "000000").slice(3, 6)));
  const values = [auditId, a.unit_key, a.action, a.contract ?? null, a.placement ?? null, a.control_id ?? null, a.request_id ?? null, a.site_label ?? null, a.street_address ?? null, micros, ids.sort((a2, b) => BigInt(a2) < BigInt(b) ? -1 : 1).join(",")];
  if (values.some((v) => v !== null && typeof v !== "string")) return null;
  const encoder = new TextEncoder(), canonical2 = values.map((v) => v === null ? "-1:" : encoder.encode(v).length + ":" + v).join("");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical2))), (x) => x.toString(16).padStart(2, "0")).join("");
}

// tech-checks/supabase/functions/cos-operations-pages/reviewedAddressEstimates.ts
var reviewedEstimatePrefix = "COS_ADDRESS_ESTIMATE_V2|";
var reviewedEstimateSource = "geocodio_reviewed_property_estimate";
var object10 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var text6 = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
var uuid9 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var exactKeys = (v, keys3) => Object.keys(v).length === keys3.length && keys3.every((k) => Object.prototype.hasOwnProperty.call(v, k));
var payloadKeys = "schemaVersion organizationId trackerId unitNumber source originalAddress originalAddressSha256 matchedAddress latitude longitude provider providerAccuracy providerAccuracyType providerMatchType providerDataSource providerResultSha256 confidence verified liveGps requiresOwnerConfirmation approvalReference batchId approvedAt retrievedAt appliedAt appliedByDatabaseRole addressMatchReview binding approvalSha256 applicationSha256".split(" ");
var sha4 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var coordinate2 = (v, limit) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
var date = (v, now) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(v) || !Number.isFinite(Date.parse(v)) || Date.parse(v) > now) return false;
  return new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
};
async function reviewedEstimateSha256(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value2))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var approvedReviewDigests = /* @__PURE__ */ new Set([
  "cd11a546a2fd9ddb49beb7f21121f0a6446945d52aad569a9d22a5bbad2849b0",
  "6b7cd74a1ab7318d3fb6c7a3e4e417b123d98b1be790e530553a0d31252e7a5d",
  "cc0f22f00b2774d987bd2106f4dfe60fbc921befd1172fd537f522e2bdcb0e59",
  "e4f38f1db4d0994f137316e710c122d8ddd6061509a45ed14ef6d93ca952a7cb",
  "7e9ac92896828482ffc92d61d8f20ab4121e69127890071d77eb75fa5b03c052",
  "8bad9553255d9b38fe5680aed6afaf04a903d0477266aed7ba7ca38f15e6d673",
  "8377d48ad723fa00f1d0e823086434e0754b4501f8caadc0f965d3865a5e016a",
  "b086108e5dfaccec990fdacc6ddb70ea1205a7a2efb4830b188e4b41b2a71a98",
  "700ce176acf196bb8d7c5ab998a1c7cb25514b3367df3845bd6d10b323e1b211",
  "91e83bc904d563a1b69c0154c8e44f6f0c6aac99c51b2f9e2ec92dfa59f24c46",
  "618bc3919ba4401ec41aa4022c797548e8396371a77fac77bb7b7fe4b43bdd1d",
  "f34b60b81736ef05adb82d913b108ac99cf73269263a50d921ee3bc248c17a1c",
  "fd4df74c6fa4e2c63345ed5109319a45dc1e09b3f56c3e0c7f90b3560d1186d9",
  "8b9d97ea1f60705e42f63ed1dd67541755f2d018b4aa238024ea8d3756cf7d7d"
]);
var approvedApplicationDigests = /* @__PURE__ */ new Set([
  "39fe5d15f8b6e475fbb77db70f425660527bb3c44e11a0dbd589c8b461a0913d",
  "ba8e1fa4788946ce245bed8beb659aafcdcf194ed1fa29414907f61d6c6277b8",
  "287e49c83d16a12898676c8adb1e907714ce069d06cac9c18a366129208c7363",
  "14dc47e75f830540edbddbd4adf2538471f486b4437dd98e2cd95895987342ab",
  "b3370ae2e93a3c62cf5458337c62099da3f73284c7ce09a7d97384e2b2976cb8",
  "693759f814cf4fce261bfa99d01cd4cf81b102ac51401fa453c0820c2b40f205",
  "3e0f137d802a42ef1e0f0b3f118a91387d7248ee12ec2b4904cc5c7d1b2b1dad",
  "5e8a033c48879a35ae06ef910d777f3ed4943a1cc3d37fa9963163e08fcb1db6",
  "2a6886e790b45575d75d2ed2eb35e4d1d2bf6f69056b6f3691f33587af6e8f89",
  "5490ee615a7653f914c0164d4bff6bc4b5ef352513b1b1cba3dce6d87432c700",
  "30a6afaac7efa13a23b96564c27c1ceec8430dfdd43953411c5bfa7d8e682cd4",
  "802898cec1c8d1d0f1580f9d075d2dc992408974a8be2010215a8257f7571b35",
  "519c083868cbf472121126cce38502517aedd7584e2c54ff5c57f9808e6655bf",
  "234a2c95d96c80d9e582a59de195eeff01c8303c87416bf716d83887774f95ea"
]);
async function reviewedApplicationDigest(p) {
  return reviewedEstimateSha256(JSON.stringify([p.approvalSha256, p.binding?.trackerSourceEpoch, p.binding?.nativeId, p.binding?.nativeUnitNumber, p.binding?.nativeAuditIdsSha256, p.binding?.legacyEvidenceSha256]));
}
async function reviewedApprovalDigest(p) {
  return reviewedEstimateSha256(JSON.stringify([
    "COS_ADDRESS_ESTIMATE_REVIEW_V2",
    p.organizationId,
    p.trackerId,
    p.unitNumber,
    p.binding?.nativeId,
    p.binding?.nativeUnitNumber,
    p.originalAddressSha256,
    p.originalAddress,
    p.matchedAddress,
    p.latitude,
    p.longitude,
    p.source,
    p.provider,
    p.providerAccuracy,
    p.providerAccuracyType,
    p.providerMatchType,
    p.providerDataSource,
    p.confidence,
    p.providerResultSha256,
    p.approvalReference,
    p.batchId,
    p.approvedAt,
    p.retrievedAt,
    p.addressMatchReview?.kind
  ]));
}
var aliases3 = { COUNTY: "CO", ROAD: "RD", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", CIRCLE: "CIR", TRAIL: "TRL", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
function parts(value2) {
  const m = /^(.+),\s*([^,]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(-\d{4})?\s*$/i.exec(value2);
  if (!m || !/^\d+[A-Z]?\s/i.test(m[1])) return null;
  const street = m[1].toUpperCase().replace(/\./g, "").replace(/\b[A-Z]+\b/g, (w) => aliases3[w] || w).replace(/\s+/g, " ").trim();
  return { street, city: m[2].trim().replace(/\s+/g, " ").toUpperCase(), state: m[3].toUpperCase(), zip: m[4] + (m[5] || "") };
}
function reviewedAddressPairMatches(original, matched, kind6) {
  const a = parts(original), b = parts(matched);
  if (!a || !b || a.state !== b.state || a.zip !== b.zip) return false;
  if (kind6 === "approved_city_label_equivalence") return a.street === b.street && a.city !== b.city;
  if (a.city !== b.city) return false;
  if (kind6 === "approved_missing_street_suffix") return !/\b(?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|HWY|TER|CIR|TRL)$/.test(a.street) && new RegExp("^" + a.street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " (?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|TER|CIR|TRL)$").test(b.street);
  if (kind6 === "approved_state_route_alias") {
    const x = /^(\d+[A-Z]?) HWY (\d+)$/.exec(a.street), y = new RegExp("^(\\d+[A-Z]?) " + a.state + "-(\\d+)$").exec(b.street);
    return Boolean(x && y && x[1] === y[1] && x[2] === y[2]);
  }
  return false;
}
function readReviewedEstimate(note) {
  if (typeof note !== "string") return null;
  const first = note.split("\n", 1)[0];
  if (!first.startsWith(reviewedEstimatePrefix) || first.length > 8192) return null;
  try {
    const p = JSON.parse(first.slice(reviewedEstimatePrefix.length));
    return object10(p) ? p : null;
  } catch {
    return null;
  }
}
async function checkedReviewedAddressEstimate(row2, now = Date.now(), approvals = approvedReviewDigests, applications = approvedApplicationDigests) {
  try {
    const p = readReviewedEstimate(row2.locationNote);
    if (!p || !object10(p.binding) || !object10(p.addressMatchReview) || !exactKeys(p, payloadKeys) || !exactKeys(p.binding, ["trackerSourceEpoch", "nativeId", "nativeUnitNumber", "nativeAuditIdsSha256", "legacyEvidenceSha256"]) || !exactKeys(p.addressMatchReview, ["kind", "originalAddress", "matchedAddress", "approvedDifferencesOnly"]) || p.schemaVersion !== 2 || p.source !== reviewedEstimateSource || p.provider !== "geocodio" || p.confidence !== "approximate_property_location" || p.verified !== false || p.liveGps !== false || p.requiresOwnerConfirmation !== true || p.providerAccuracy !== 1 || p.providerAccuracyType !== "rooftop" || !(p.providerMatchType === null || text6(p.providerMatchType, 100)) || !text6(p.providerDataSource, 300) || !uuid9(p.organizationId) || p.organizationId !== row2.addressEstimateOrganizationId || !uuid9(p.trackerId) || !text6(p.unitNumber, 160) || !text6(p.originalAddress, 600) || p.originalAddress !== row2.address || !text6(p.matchedAddress, 600) || !sha4(p.originalAddressSha256) || !sha4(p.providerResultSha256) || !sha4(p.approvalSha256) || !sha4(p.applicationSha256) || !text6(p.batchId, 100) || !text6(p.approvalReference, 200) || !text6(p.appliedByDatabaseRole, 100) || !date(p.retrievedAt, now) || !date(p.approvedAt, now) || !date(p.appliedAt, now) || Date.parse(p.retrievedAt) > Date.parse(p.approvedAt) || Date.parse(p.approvedAt) > Date.parse(p.appliedAt) || !coordinate2(p.latitude, 90) || !coordinate2(p.longitude, 180) || p.addressMatchReview.approvedDifferencesOnly !== true || p.addressMatchReview.originalAddress !== p.originalAddress || p.addressMatchReview.matchedAddress !== p.matchedAddress || !reviewedAddressPairMatches(p.originalAddress, p.matchedAddress, p.addressMatchReview.kind)) return null;
    if (row2.status !== "field" || row2.hasUnitGps === true || row2.installedSiteId != null || row2.locationVerification === "owner_verified" || row2.locationVerification === "address_changed" || row2.placementSource === "owner" || row2.placementAuditId != null || row2.placementStatus === "needs_identity_review" || row2.placement === "UNKNOWN" || row2.locationGeocode != null) return null;
    const trackerOnly = row2.readOnly === true;
    if (trackerOnly ? row2.currentLocationType !== "field" || row2.id !== p.trackerId || row2.unitNumber !== p.unitNumber || p.binding.nativeId !== null || p.binding.nativeUnitNumber !== null || !sha4(row2.addressEstimateNativeRevision) : row2.readOnly !== false || !["field", null, void 0, ""].includes(row2.currentLocationType) || !uuid9(p.binding.nativeId) || row2.id !== p.binding.nativeId || row2.unitNumber !== p.binding.nativeUnitNumber || row2.addressEstimateTrackerId !== p.trackerId || row2.addressEstimateUnitNumber !== p.unitNumber || !sha4(row2.addressEstimateNativeRevision)) return null;
    if (!uuid9(p.binding.trackerSourceEpoch) || p.binding.trackerSourceEpoch !== row2.addressEstimateReviewEpoch || p.binding.nativeAuditIdsSha256 !== row2.addressEstimateNativeRevision || !sha4(p.binding.legacyEvidenceSha256) || p.binding.legacyEvidenceSha256 !== row2.addressEstimateLegacyEvidenceSha256) return null;
    const historical = row2.historicalCoordinateSource === reviewedEstimateSource;
    const latitude = historical ? row2.historicalLatitude : row2.latitude, longitude = historical ? row2.historicalLongitude : row2.longitude;
    if (!historical && row2.coordinateSource !== reviewedEstimateSource || !coordinate2(latitude, 90) || !coordinate2(longitude, 180) || latitude !== p.latitude || longitude !== p.longitude) return null;
    if (await reviewedEstimateSha256(row2.address.replace(/\s+/g, " ").trim().toLowerCase()) !== p.originalAddressSha256 || await reviewedApprovalDigest(p) !== p.approvalSha256 || !approvals.has(p.approvalSha256) || await reviewedApplicationDigest(p) !== p.applicationSha256 || !applications.has(p.applicationSha256)) return null;
    return {
      latitude: p.latitude,
      longitude: p.longitude,
      matchedAddress: p.matchedAddress,
      originalAddress: p.originalAddress,
      retrievedAt: p.retrievedAt,
      confidence: "approximate_property_location",
      source: reviewedEstimateSource,
      provider: "geocodio",
      providerAccuracy: p.providerAccuracy,
      providerAccuracyType: "rooftop",
      providerMatchType: p.providerMatchType,
      providerDataSource: p.providerDataSource,
      approvedDifference: p.addressMatchReview.kind
    };
  } catch {
    return null;
  }
}
var id4 = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var numericOrder = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
function reviewedLegacyConcernKey(value2, matchKey) {
  const key2 = matchKey(value2);
  return key2.startsWith("typed:") ? key2.replace(/\|(?:HD4|HDC[24]S?)$/, "") : key2;
}
async function reviewedLegacyEvidenceSha256(unitNumber, audits, devices, matchKey) {
  try {
    if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) return null;
    const key2 = matchKey(unitNumber), concernKey = reviewedLegacyConcernKey(unitNumber, matchKey);
    if (!key2) return null;
    if (devices.some((d) => !object10(d) || !id4(d.id) || !text6(d.unit_key, 160)) || audits.some((a) => !object10(a) || !id4(a.id) || !text6(a.unit_key, 160))) return null;
    const roster = devices.filter((d) => reviewedLegacyConcernKey(d.unit_key, matchKey) === concernKey);
    const exactRoster = roster.filter((d) => matchKey(d.unit_key) === key2);
    if (new Set(roster.map((d) => id4(d.id))).size !== roster.length || new Set(exactRoster.map((d) => d.unit_key.trim().toUpperCase())).size > 1) return null;
    const deviceIds = new Set(roster.map((d) => id4(d.id)));
    const related = audits.filter((a) => reviewedLegacyConcernKey(a.unit_key, matchKey) === concernKey || Array.isArray(a.device_ids) && a.device_ids.some((v) => deviceIds.has(id4(v))));
    if (new Set(related.map((a) => id4(a.id))).size !== related.length || related.some((a) => !text6(a.action, 100) || !(a.contract === null || text6(a.contract, 100)) || !Array.isArray(a.device_ids) || a.device_ids.some((v) => !id4(v)) || new Set(a.device_ids.map(id4)).size !== a.device_ids.length)) return null;
    if (related.some((a) => reviewedLegacyConcernKey(a.unit_key, matchKey) !== concernKey)) return null;
    const auditTuples = related.map((a) => [id4(a.id), a.unit_key, a.action, a.contract, [...a.device_ids.map(id4)].sort(numericOrder)]).sort((a, b) => numericOrder(a[0], b[0]));
    const rosterTuples = roster.map((d) => [id4(d.id), d.unit_key]).sort((a, b) => numericOrder(a[0], b[0]));
    return reviewedEstimateSha256(JSON.stringify(["COS_REVIEWED_ESTIMATE_LEGACY_V2", key2, auditTuples, rosterTuples]));
  } catch {
    return null;
  }
}
async function projectReviewedAddressEstimates(snapshot, audits, devices, matchKey, now = Date.now(), approvals = approvedReviewDigests, applications = approvedApplicationDigests) {
  const apply = async (row2) => {
    if (!row2.locationNote?.startsWith?.(reviewedEstimatePrefix) && row2.coordinateSource !== reviewedEstimateSource && row2.historicalCoordinateSource !== reviewedEstimateSource) return row2;
    const evidence = await reviewedLegacyEvidenceSha256(row2.unitNumber, audits, devices, matchKey);
    const candidate = { ...row2, addressEstimateLegacyEvidenceSha256: evidence };
    if (evidence && await checkedReviewedAddressEstimate(candidate, now, approvals, applications)) return candidate;
    return {
      ...row2,
      addressEstimateLegacyEvidenceSha256: null,
      ...row2.coordinateSource === reviewedEstimateSource ? { latitude: null, longitude: null, coordinateSource: null } : {},
      ...row2.historicalCoordinateSource === reviewedEstimateSource ? { historicalLatitude: null, historicalLongitude: null, historicalCoordinateSource: null } : {}
    };
  };
  return { ...snapshot, items: await Promise.all(snapshot.items.map(apply)), inventoryItems: await Promise.all(snapshot.inventoryItems.map(apply)) };
}

// tech-checks/supabase/functions/cos-operations-pages/importedSourceProjection.ts
var ORG2 = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var object11 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid10 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var sha5 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var decimal2 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
function labelKeys() {
  const matches2 = /* @__PURE__ */ new Map(), concerns = /* @__PURE__ */ new Map();
  const match = (value2) => {
    if (typeof value2 !== "string") return placementMatchKey(value2);
    let key2 = matches2.get(value2);
    if (key2 === void 0) {
      key2 = placementMatchKey(value2);
      matches2.set(value2, key2);
    }
    return key2;
  };
  const concern3 = (value2) => {
    if (typeof value2 !== "string") return match(value2).replace(/\|(?:HD4|HDC[24]S?)$/, "");
    let key2 = concerns.get(value2);
    if (key2 === void 0) {
      key2 = match(value2).replace(/\|(?:HD4|HDC[24]S?)$/, "");
      concerns.set(value2, key2);
    }
    return key2;
  };
  return { match, concern: concern3 };
}
var validSourceType = (v) => v.schemaVersion === 1 && v.sourceSystem === "mhelpdesk_product_import" && decimal2(v.productId) && !Object.hasOwn(v, "sourceRecordId") || v.schemaVersion === 2 && v.sourceSystem === "google_sheet_tracker" && v.entityKind === "tracker" && trackerRecordId(v.sourceRecordId) && !Object.hasOwn(v, "productId") || v.schemaVersion === 3 && v.sourceSystem === "google_sheet_tracker" && v.entityKind === "equipment_unit" && trackerRecordId(v.sourceRecordId) && !Object.hasOwn(v, "productId");
var sourceIdentity = (v) => v.sourceSystem === "google_sheet_tracker" ? { sourceSystem: "google_sheet_tracker", sourceRecordId: v.sourceRecordId } : { productId: v.productId };
async function checkedImportedBinding(v) {
  if (!object11(v) || !validSourceType(v) || v.schemaVersion === 3 && !validNativeTrackerLabel(v) || v.organizationId !== ORG2 || !["equipment_unit", "tracker"].includes(v.entityKind) || !uuid10(v.nativeUnitId) || !uuid10(v.sourceRevision) || !decimal2(v.eventId) || typeof v.unitNumber !== "string" || !v.unitNumber.trim() || v.unitNumber.length > 250 || !["sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => sha5(v[k])) || v.eligibility !== "FIELD" || !validInstallation(v.installation) || !object11(v.suppliedComponents)) return null;
  const precedence = checkedSourcePrecedence(v);
  if (Object.hasOwn(v, "sourcePrecedence") && !precedence) return null;
  const supplied = suppliedComponents(v.installation);
  if (Object.keys(v.suppliedComponents).length !== 4 || Object.entries(supplied).some(([k, value2]) => v.suppliedComponents[k] !== value2) || await addressDigest(installationAddress(v.installation)) !== v.addressSha256) return null;
  if (!(v.family === null || typeof v.family === "string" && v.family.length <= 160) || !(v.variant === null || typeof v.variant === "string" && v.variant.length <= 160)) return null;
  return {
    schemaVersion: v.schemaVersion,
    organizationId: ORG2,
    sourceSystem: v.sourceSystem,
    entityKind: v.entityKind,
    nativeUnitId: v.nativeUnitId,
    ...sourceIdentity(v),
    unitNumber: v.unitNumber,
    family: v.family,
    variant: v.variant,
    sourceRevision: v.sourceRevision,
    sourceFileSha256: v.sourceFileSha256,
    sourceRowSha256: v.sourceRowSha256,
    addressSha256: v.addressSha256,
    nativeGuardSha256: v.nativeGuardSha256,
    installation: { street: v.installation.street, city: v.installation.city, state: v.installation.state, zip: v.installation.zip },
    suppliedComponents: supplied,
    eligibility: "FIELD",
    eventId: v.eventId,
    ...precedence ? { sourcePrecedence: precedence } : {}
  };
}
function legacyConcernReader(audits, devices) {
  if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) return () => true;
  if (audits.some((a) => !object11(a) || !Array.isArray(a.device_ids))) return () => true;
  const { match, concern: concern3 } = labelKeys(), groups = /* @__PURE__ */ new Map(), groupData = /* @__PURE__ */ new Map();
  for (const d of devices) {
    if (!object11(d)) continue;
    const key2 = concern3(d.unit_key), group = groups.get(key2);
    if (group) group.push(d);
    else groups.set(key2, [d]);
  }
  const history = audits.map((a) => ({ row: a, key: concern3(a.unit_key) })), results = /* @__PURE__ */ new Map();
  return (unitNumber) => {
    const saved = results.get(unitNumber);
    if (saved !== void 0) return saved;
    const key2 = concern3(unitNumber);
    if (!key2) return true;
    let group = groupData.get(key2);
    if (!group) {
      const rows4 = groups.get(key2) || [];
      group = { ids: new Set(rows4.map((d) => String(d.id))), labels: new Set(rows4.map((d) => match(d.unit_key))) };
      groupData.set(key2, group);
    }
    const mismatch = group.labels.size > 1 || group.labels.size === 1 && !group.labels.has(match(unitNumber));
    const result = mismatch || history.some(({ row: a, key: auditKey2 }) => (auditKey2 === key2 || a.device_ids.some((id15) => group.ids.has(String(id15)))) && (a.contract === "COS_CAMERA_PLACEMENT_V2" || ["MOVE_TO_FIELD", "MOVE_TO_ROOT"].includes(a.action) || auditKey2 !== key2));
    results.set(unitNumber, result);
    return result;
  };
}
function importedLegacyConcern(unitNumber, audits, devices) {
  return legacyConcernReader(audits, devices)(unitNumber);
}

// tech-checks/supabase/functions/cos-operations-pages/sourceRecordedCoordinates.ts
var ORG3 = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var object12 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid11 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var sha6 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var text7 = (v, max = 160) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f<>]/.test(v);
var coordinate3 = (v, limit) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
var date2 = (v, now) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v)) || Date.parse(v) > now) return false;
  const calendar = Date.parse(v.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(calendar) && new Date(calendar).toISOString().slice(0, 10) === v.slice(0, 10);
};
var identity = (r) => (r.readOnly === true ? "tracker" : "equipment_unit") + "|" + r.id;
function recordedCoordinateFamilyKey(family) {
  const raw = family.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return { SOLARSTANDS72: "SOLARSTAND72", SOLARPOLES72: "SOLARPOLE72", SOLARSKIDS144: "SOLARSKID144" }[raw] || raw;
}
async function checkedRecordedProvenance(row2, now = Date.now()) {
  try {
    const r = row2.locationSourceRecorded, b = r?.binding;
    if (!object12(r) || !object12(b) || r.schemaVersion !== 1 || r.organizationId !== ORG3 || r.source !== "tracker_recorded_coordinates" || r.confidence !== "source_recorded_unverified" || r.verified !== false || r.liveGps !== false || r.coordinateRecordedAt !== null || r.appliedByDatabaseRole !== "postgres" || !uuid11(r.recordId) || !uuid11(r.nativeUnitId) || !uuid11(r.trackerId) || r.entityKind !== (row2.readOnly === true ? "tracker" : "equipment_unit") || r.nativeUnitId !== row2.id || r.unitNumber !== row2.unitNumber || r.entityKind === "tracker" && r.trackerId !== row2.id || !text7(r.unitNumber) || !text7(r.trackerUnitNumber) || !text7(r.family) || !text7(r.productId, 19) || !/^[1-9]\d*$/.test(r.productId) || r.typedIdentity !== placementMatchKey(row2.unitNumber) || r.typedIdentity !== placementMatchKey(r.trackerUnitNumber) || !r.typedIdentity.startsWith("typed:") || r.typedIdentity.split("|")[0].slice(6) !== recordedCoordinateFamilyKey(r.family) || b.trackerFamily !== r.family || typeof r.sourceSpreadsheetId !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(r.sourceSpreadsheetId) || typeof r.sourceSheetId !== "string" || !/^\d{1,12}$/.test(r.sourceSheetId) || typeof r.coordinateCell !== "string" || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(r.coordinateCell) || !["coordinateCellSha256", "sourceFileSha256", "sourceRowSha256", "sourceAddressSha256", "legacyEvidenceSha256"].every((k) => sha6(r[k])) || !["nativeGuardSha256", "addressSha256", "trackerAddressSha256"].every((k) => sha6(b[k])) || r.sourceAddressSha256 !== b.trackerAddressSha256 || !(b.productSourceEventId === null || typeof b.productSourceEventId === "string" && /^[1-9]\d*$/.test(b.productSourceEventId)) || !date2(r.sourceObservedAt, now) || !date2(r.appliedAt, now) || Date.parse(r.sourceObservedAt) > Date.parse(r.appliedAt) || !coordinate3(r.latitude, 90) || !coordinate3(r.longitude, 180) || !text7(b.installationAddress, 600) || row2.address !== b.installationAddress || await addressDigest(row2.address) !== b.addressSha256) return null;
    if (row2.placementSource === "owner" || row2.placementAuditId != null || row2.placement === "SHOP" || row2.placement === "UNKNOWN" || row2.placementStatus === "needs_identity_review" || row2.locationVerification === "owner_verified" || row2.locationVerification === "address_changed" || row2.hasUnitGps === true || row2.installedSiteId != null || row2.currentLocationType !== "field" || !["field", "assigned", "installed", "returning", "in_transit"].includes(row2.status) || row2.importedPlacement != null && row2.importedPlacement !== "FIELD") return null;
    if (row2.locationNote?.startsWith?.(reviewedEstimatePrefix) || row2.coordinateSource === reviewedEstimateSource || row2.historicalCoordinateSource === reviewedEstimateSource) return null;
    const current = b.currentSource;
    if (current === null) {
      if (row2.importedInstallation != null || row2.importedPlacement != null) return null;
    } else {
      const s = row2.importedInstallation;
      if (!object12(current) || !object12(s) || !uuid11(current.sourceRevision) || typeof current.eventId !== "string" || !/^[1-9]\d*$/.test(current.eventId) || s.nativeUnitId !== row2.id || s.entityKind !== r.entityKind || s.productId !== r.productId || s.unitNumber !== r.unitNumber || s.eligibility !== "FIELD" || !["family", "sourceRevision", "eventId", "sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => current[k] === s[k]) || current.eventId !== b.productSourceEventId || current.nativeGuardSha256 !== b.nativeGuardSha256 || current.addressSha256 !== b.addressSha256) return null;
    }
    return {
      latitude: r.latitude,
      longitude: r.longitude,
      matchedAddress: b.installationAddress,
      confidence: "source_recorded_unverified",
      source: "tracker_recorded_coordinates",
      sourceObservedAt: r.sourceObservedAt,
      coordinateRecordedAt: null,
      sourceSpreadsheetId: r.sourceSpreadsheetId,
      sourceSheetId: r.sourceSheetId,
      coordinateCell: r.coordinateCell,
      coordinateCellSha256: r.coordinateCellSha256
    };
  } catch {
    return null;
  }
}
var CONFLICT_DISTANCE_KM = 20;
function distanceKm(a, b) {
  const rad = (v) => v * Math.PI / 180, lat = rad(b.latitude - a.latitude), lon = rad(b.longitude - a.longitude);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
async function acceptedCurrentAddressPoint(row2, now) {
  const r = row2.locationImportedGeocode, s = await checkedImportedBinding(row2.importedInstallation);
  if (!s || !object12(r) || r.status !== "success" || r.jobKind !== "native_import" || r.verified !== false || r.liveGps !== false || !sha6(r.legacyGuardSha256) || !coordinate3(r.latitude, 90) || !coordinate3(r.longitude, 180) || r.latitude === 0 && r.longitude === 0 || !date2(r.geocodedAt, now) || !matchesInstallation(s.installation, r.matchedAddress)) return null;
  const returned = await checkedImportedBinding(r.binding);
  if (!returned || JSON.stringify(s) !== JSON.stringify(returned)) return null;
  if (r.provider === "us_census_address_range" && r.benchmark === "Public_AR_Current") return r;
  if (r.provider !== "geocodio" || !["rooftop", "range_interpolation"].includes(r.accuracyType) || typeof r.accuracy !== "number" || !Number.isFinite(r.accuracy) || r.accuracy < 0.9 || r.accuracy > 1 || ![null, "building_centroid", "parcel_centroid"].includes(r.matchType ?? null) || r.accuracyType === "range_interpolation" && r.matchType != null) return null;
  return r;
}
function conflict(record5, kind6, km) {
  return {
    kind: kind6,
    recordId: record5.recordId,
    recordedLatitude: record5.latitude,
    recordedLongitude: record5.longitude,
    distanceKm: Math.round(km * 1e3) / 1e3,
    source: "tracker_recorded_coordinates",
    verified: false,
    liveGps: false,
    coordinateCell: record5.coordinateCell,
    sourceObservedAt: record5.sourceObservedAt,
    coordinateRecordedAt: null
  };
}
async function checkedSourceRecordedCoordinates(row2, now = Date.now()) {
  const point2 = await checkedRecordedProvenance(row2, now);
  if (!point2) return null;
  const estimate = await acceptedCurrentAddressPoint(row2, now);
  return estimate && distanceKm(point2, estimate) > CONFLICT_DISTANCE_KM ? null : point2;
}
async function projectSourceRecordedCoordinates(snapshot, records2, audits, devices, now = Date.now()) {
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems)) throw Error("Field Map snapshot unavailable.");
  const clear = (row2) => {
    const { locationSourceRecorded: _stale, locationSourceRecordedConflict: _oldConflict, ...clean2 } = row2;
    return clean2;
  };
  const withoutSource = () => ({ ...snapshot, items: snapshot.items.map(clear), inventoryItems: snapshot.inventoryItems.map(clear) });
  if (!Array.isArray(records2)) return withoutSource();
  try {
    const byId = /* @__PURE__ */ new Map();
    for (const r of records2) {
      if (!object12(r) || !uuid11(r.nativeUnitId) || !["tracker", "equipment_unit"].includes(r.entityKind)) return withoutSource();
      const key2 = r.entityKind + "|" + r.nativeUnitId;
      if (byId.has(key2)) return withoutSource();
      byId.set(key2, r);
    }
    const concerns = /* @__PURE__ */ new Map();
    for (const row2 of snapshot.inventoryItems) {
      const key2 = placementIdentityConcernKey(row2.unitNumber);
      concerns.set(key2, (concerns.get(key2) || 0) + 1);
    }
    const apply = async (raw) => {
      const { locationSourceRecorded: _stale, locationSourceRecordedConflict: _oldConflict, ...row2 } = raw, r = byId.get(identity(raw));
      if (!r || concerns.get(placementIdentityConcernKey(row2.unitNumber)) !== 1 || importedLegacyConcern(row2.unitNumber, audits, devices)) return row2;
      const evidence = await reviewedLegacyEvidenceSha256(row2.unitNumber, audits, devices, placementMatchKey);
      if (!evidence || evidence !== r.legacyEvidenceSha256) return row2;
      const candidate = { ...row2, locationSourceRecorded: r };
      return await checkedRecordedProvenance(candidate, now) ? candidate : row2;
    };
    const [inventory, items] = await Promise.all([Promise.all(snapshot.inventoryItems.map(apply)), Promise.all(snapshot.items.map(apply))]), conflicts = /* @__PURE__ */ new Map();
    const candidates = inventory.filter((row2) => row2.locationSourceRecorded);
    await Promise.all(candidates.map(async (row2) => {
      const estimate = await acceptedCurrentAddressPoint(row2, now), r = row2.locationSourceRecorded;
      if (estimate) {
        const km = distanceKm(r, estimate);
        if (km > CONFLICT_DISTANCE_KM) conflicts.set(identity(row2), conflict(r, "current_address_disagreement", km));
      }
    }));
    const installations = /* @__PURE__ */ new Map();
    for (const row2 of candidates) {
      if (!text7(row2.customer, 600) || !text7(row2.site, 600)) continue;
      const key2 = JSON.stringify([row2.locationSourceRecorded.binding.addressSha256, row2.customer, row2.site]), group = installations.get(key2);
      if (group) group.push(row2);
      else installations.set(key2, [row2]);
    }
    for (const group of installations.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j], ar = a.locationSourceRecorded, br = b.locationSourceRecorded;
      if (identity(a) === identity(b) || ar.recordId === br.recordId) continue;
      const km = distanceKm(ar, br);
      if (km > CONFLICT_DISTANCE_KM) {
        if (!conflicts.has(identity(a))) conflicts.set(identity(a), conflict(ar, "same_installation_disagreement", km));
        if (!conflicts.has(identity(b))) conflicts.set(identity(b), conflict(br, "same_installation_disagreement", km));
      }
    }
    const withhold = (row2) => {
      const issue = conflicts.get(identity(row2));
      if (!row2.locationSourceRecorded || !issue || issue.recordId !== row2.locationSourceRecorded.recordId) return row2;
      const { locationSourceRecorded: _point, ...rest } = row2;
      return { ...rest, locationSourceRecordedConflict: issue };
    };
    return { ...snapshot, items: items.map(withhold), inventoryItems: inventory.map(withhold) };
  } catch {
    return withoutSource();
  }
}
async function readSourceRecordedCoordinates(inventory, nativeRpc) {
  try {
    if (!Array.isArray(inventory)) return [];
    const identities = inventory.map((row2) => ({ entityKind: row2.readOnly === true ? "tracker" : "equipment_unit", nativeUnitId: row2.id }));
    if (identities.some((row2) => !uuid11(row2.nativeUnitId)) || new Set(identities.map((row2) => row2.nativeUnitId)).size !== identities.length) return [];
    const records2 = [], seen = /* @__PURE__ */ new Set(), requested = new Set(identities.map((r) => r.entityKind + "|" + r.nativeUnitId));
    for (let offset = 0; offset < identities.length; offset += 250) {
      const page2 = await nativeRpc("cos_source_recorded_coordinates_read_many", { p_organization_id: ORG3, p_identities: identities.slice(offset, offset + 250) });
      if (!Array.isArray(page2)) return [];
      for (const r of page2) {
        if (!object12(r) || !uuid11(r.nativeUnitId) || !["tracker", "equipment_unit"].includes(r.entityKind)) return [];
        const key2 = r.entityKind + "|" + r.nativeUnitId;
        if (!requested.has(key2) || seen.has(key2)) return [];
        seen.add(key2);
        records2.push(r);
      }
    }
    return records2;
  } catch {
    return [];
  }
}

// tech-checks/supabase/functions/_shared/ownerInstallationAddress.ts
function parseOwnerInstallationAddress(value2, parseFullAddress) {
  if (typeof value2 !== "string" || value2.length > 600 || /[\x00-\x1f\x7f]/.test(value2)) return null;
  const plain7 = parseFullAddress(value2);
  if (plain7) return { originalAddress: value2, installation: plain7, secondaryUnit: null };
  const m = /^\s*([^,]+),\s*((?:ste\.?|suite)\s*#?\s*(\d{1,6}[A-Z]?))\s*,\s*([^,]+),\s*([A-Z]{2}(?:\s*,\s*|\s+)\d{5}(?:-\d{4})?)\s*$/i.exec(value2);
  if (!m) return null;
  const installation2 = parseFullAddress(`${m[1].trim()}, ${m[4].trim()}, ${m[5].trim()}`);
  if (!installation2 || /\b(?:OR|AND|TO|THROUGH)\b/i.test(installation2.street + " " + installation2.city)) return null;
  return { originalAddress: value2, installation: installation2, secondaryUnit: { kind: "suite", identifier: m[3], sourceText: m[2] } };
}

// tech-checks/operations/shared/reviewedAddressEstimates.ts
var reviewedEstimatePrefix2 = "COS_ADDRESS_ESTIMATE_V2|";
var reviewedEstimateSource2 = "geocodio_reviewed_property_estimate";
var object13 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var text8 = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
var uuid12 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var exactKeys2 = (v, keys3) => Object.keys(v).length === keys3.length && keys3.every((k) => Object.prototype.hasOwnProperty.call(v, k));
var payloadKeys2 = "schemaVersion organizationId trackerId unitNumber source originalAddress originalAddressSha256 matchedAddress latitude longitude provider providerAccuracy providerAccuracyType providerMatchType providerDataSource providerResultSha256 confidence verified liveGps requiresOwnerConfirmation approvalReference batchId approvedAt retrievedAt appliedAt appliedByDatabaseRole addressMatchReview binding approvalSha256 applicationSha256".split(" ");
var sha7 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var coordinate4 = (v, limit) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
var date3 = (v, now) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(v) || !Number.isFinite(Date.parse(v)) || Date.parse(v) > now) return false;
  return new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
};
async function reviewedEstimateSha2562(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value2))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var approvedReviewDigests2 = /* @__PURE__ */ new Set([
  "cd11a546a2fd9ddb49beb7f21121f0a6446945d52aad569a9d22a5bbad2849b0",
  "6b7cd74a1ab7318d3fb6c7a3e4e417b123d98b1be790e530553a0d31252e7a5d",
  "cc0f22f00b2774d987bd2106f4dfe60fbc921befd1172fd537f522e2bdcb0e59",
  "e4f38f1db4d0994f137316e710c122d8ddd6061509a45ed14ef6d93ca952a7cb",
  "7e9ac92896828482ffc92d61d8f20ab4121e69127890071d77eb75fa5b03c052",
  "8bad9553255d9b38fe5680aed6afaf04a903d0477266aed7ba7ca38f15e6d673",
  "8377d48ad723fa00f1d0e823086434e0754b4501f8caadc0f965d3865a5e016a",
  "b086108e5dfaccec990fdacc6ddb70ea1205a7a2efb4830b188e4b41b2a71a98",
  "700ce176acf196bb8d7c5ab998a1c7cb25514b3367df3845bd6d10b323e1b211",
  "91e83bc904d563a1b69c0154c8e44f6f0c6aac99c51b2f9e2ec92dfa59f24c46",
  "618bc3919ba4401ec41aa4022c797548e8396371a77fac77bb7b7fe4b43bdd1d",
  "f34b60b81736ef05adb82d913b108ac99cf73269263a50d921ee3bc248c17a1c",
  "fd4df74c6fa4e2c63345ed5109319a45dc1e09b3f56c3e0c7f90b3560d1186d9",
  "8b9d97ea1f60705e42f63ed1dd67541755f2d018b4aa238024ea8d3756cf7d7d"
]);
var approvedApplicationDigests2 = /* @__PURE__ */ new Set([
  "39fe5d15f8b6e475fbb77db70f425660527bb3c44e11a0dbd589c8b461a0913d",
  "ba8e1fa4788946ce245bed8beb659aafcdcf194ed1fa29414907f61d6c6277b8",
  "287e49c83d16a12898676c8adb1e907714ce069d06cac9c18a366129208c7363",
  "14dc47e75f830540edbddbd4adf2538471f486b4437dd98e2cd95895987342ab",
  "b3370ae2e93a3c62cf5458337c62099da3f73284c7ce09a7d97384e2b2976cb8",
  "693759f814cf4fce261bfa99d01cd4cf81b102ac51401fa453c0820c2b40f205",
  "3e0f137d802a42ef1e0f0b3f118a91387d7248ee12ec2b4904cc5c7d1b2b1dad",
  "5e8a033c48879a35ae06ef910d777f3ed4943a1cc3d37fa9963163e08fcb1db6",
  "2a6886e790b45575d75d2ed2eb35e4d1d2bf6f69056b6f3691f33587af6e8f89",
  "5490ee615a7653f914c0164d4bff6bc4b5ef352513b1b1cba3dce6d87432c700",
  "30a6afaac7efa13a23b96564c27c1ceec8430dfdd43953411c5bfa7d8e682cd4",
  "802898cec1c8d1d0f1580f9d075d2dc992408974a8be2010215a8257f7571b35",
  "519c083868cbf472121126cce38502517aedd7584e2c54ff5c57f9808e6655bf",
  "234a2c95d96c80d9e582a59de195eeff01c8303c87416bf716d83887774f95ea"
]);
async function reviewedApplicationDigest2(p) {
  return reviewedEstimateSha2562(JSON.stringify([p.approvalSha256, p.binding?.trackerSourceEpoch, p.binding?.nativeId, p.binding?.nativeUnitNumber, p.binding?.nativeAuditIdsSha256, p.binding?.legacyEvidenceSha256]));
}
async function reviewedApprovalDigest2(p) {
  return reviewedEstimateSha2562(JSON.stringify([
    "COS_ADDRESS_ESTIMATE_REVIEW_V2",
    p.organizationId,
    p.trackerId,
    p.unitNumber,
    p.binding?.nativeId,
    p.binding?.nativeUnitNumber,
    p.originalAddressSha256,
    p.originalAddress,
    p.matchedAddress,
    p.latitude,
    p.longitude,
    p.source,
    p.provider,
    p.providerAccuracy,
    p.providerAccuracyType,
    p.providerMatchType,
    p.providerDataSource,
    p.confidence,
    p.providerResultSha256,
    p.approvalReference,
    p.batchId,
    p.approvedAt,
    p.retrievedAt,
    p.addressMatchReview?.kind
  ]));
}
var aliases4 = { COUNTY: "CO", ROAD: "RD", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", CIRCLE: "CIR", TRAIL: "TRL", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
function parts2(value2) {
  const m = /^(.+),\s*([^,]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(-\d{4})?\s*$/i.exec(value2);
  if (!m || !/^\d+[A-Z]?\s/i.test(m[1])) return null;
  const street = m[1].toUpperCase().replace(/\./g, "").replace(/\b[A-Z]+\b/g, (w) => aliases4[w] || w).replace(/\s+/g, " ").trim();
  return { street, city: m[2].trim().replace(/\s+/g, " ").toUpperCase(), state: m[3].toUpperCase(), zip: m[4] + (m[5] || "") };
}
function reviewedAddressPairMatches2(original, matched, kind6) {
  const a = parts2(original), b = parts2(matched);
  if (!a || !b || a.state !== b.state || a.zip !== b.zip) return false;
  if (kind6 === "approved_city_label_equivalence") return a.street === b.street && a.city !== b.city;
  if (a.city !== b.city) return false;
  if (kind6 === "approved_missing_street_suffix") return !/\b(?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|HWY|TER|CIR|TRL)$/.test(a.street) && new RegExp("^" + a.street.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " (?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|TER|CIR|TRL)$").test(b.street);
  if (kind6 === "approved_state_route_alias") {
    const x = /^(\d+[A-Z]?) HWY (\d+)$/.exec(a.street), y = new RegExp("^(\\d+[A-Z]?) " + a.state + "-(\\d+)$").exec(b.street);
    return Boolean(x && y && x[1] === y[1] && x[2] === y[2]);
  }
  return false;
}
function readReviewedEstimate2(note) {
  if (typeof note !== "string") return null;
  const first = note.split("\n", 1)[0];
  if (!first.startsWith(reviewedEstimatePrefix2) || first.length > 8192) return null;
  try {
    const p = JSON.parse(first.slice(reviewedEstimatePrefix2.length));
    return object13(p) ? p : null;
  } catch {
    return null;
  }
}
async function checkedReviewedAddressEstimate2(row2, now = Date.now(), approvals = approvedReviewDigests2, applications = approvedApplicationDigests2) {
  try {
    const p = readReviewedEstimate2(row2.locationNote);
    if (!p || !object13(p.binding) || !object13(p.addressMatchReview) || !exactKeys2(p, payloadKeys2) || !exactKeys2(p.binding, ["trackerSourceEpoch", "nativeId", "nativeUnitNumber", "nativeAuditIdsSha256", "legacyEvidenceSha256"]) || !exactKeys2(p.addressMatchReview, ["kind", "originalAddress", "matchedAddress", "approvedDifferencesOnly"]) || p.schemaVersion !== 2 || p.source !== reviewedEstimateSource2 || p.provider !== "geocodio" || p.confidence !== "approximate_property_location" || p.verified !== false || p.liveGps !== false || p.requiresOwnerConfirmation !== true || p.providerAccuracy !== 1 || p.providerAccuracyType !== "rooftop" || !(p.providerMatchType === null || text8(p.providerMatchType, 100)) || !text8(p.providerDataSource, 300) || !uuid12(p.organizationId) || p.organizationId !== row2.addressEstimateOrganizationId || !uuid12(p.trackerId) || !text8(p.unitNumber, 160) || !text8(p.originalAddress, 600) || p.originalAddress !== row2.address || !text8(p.matchedAddress, 600) || !sha7(p.originalAddressSha256) || !sha7(p.providerResultSha256) || !sha7(p.approvalSha256) || !sha7(p.applicationSha256) || !text8(p.batchId, 100) || !text8(p.approvalReference, 200) || !text8(p.appliedByDatabaseRole, 100) || !date3(p.retrievedAt, now) || !date3(p.approvedAt, now) || !date3(p.appliedAt, now) || Date.parse(p.retrievedAt) > Date.parse(p.approvedAt) || Date.parse(p.approvedAt) > Date.parse(p.appliedAt) || !coordinate4(p.latitude, 90) || !coordinate4(p.longitude, 180) || p.addressMatchReview.approvedDifferencesOnly !== true || p.addressMatchReview.originalAddress !== p.originalAddress || p.addressMatchReview.matchedAddress !== p.matchedAddress || !reviewedAddressPairMatches2(p.originalAddress, p.matchedAddress, p.addressMatchReview.kind)) return null;
    if (row2.status !== "field" || row2.hasUnitGps === true || row2.installedSiteId != null || row2.locationVerification === "owner_verified" || row2.locationVerification === "address_changed" || row2.placementSource === "owner" || row2.placementAuditId != null || row2.placementStatus === "needs_identity_review" || row2.placement === "UNKNOWN" || row2.locationGeocode != null) return null;
    const trackerOnly = row2.readOnly === true;
    if (trackerOnly ? row2.currentLocationType !== "field" || row2.id !== p.trackerId || row2.unitNumber !== p.unitNumber || p.binding.nativeId !== null || p.binding.nativeUnitNumber !== null || !sha7(row2.addressEstimateNativeRevision) : row2.readOnly !== false || !["field", null, void 0, ""].includes(row2.currentLocationType) || !uuid12(p.binding.nativeId) || row2.id !== p.binding.nativeId || row2.unitNumber !== p.binding.nativeUnitNumber || row2.addressEstimateTrackerId !== p.trackerId || row2.addressEstimateUnitNumber !== p.unitNumber || !sha7(row2.addressEstimateNativeRevision)) return null;
    if (!uuid12(p.binding.trackerSourceEpoch) || p.binding.trackerSourceEpoch !== row2.addressEstimateReviewEpoch || p.binding.nativeAuditIdsSha256 !== row2.addressEstimateNativeRevision || !sha7(p.binding.legacyEvidenceSha256) || p.binding.legacyEvidenceSha256 !== row2.addressEstimateLegacyEvidenceSha256) return null;
    const historical = row2.historicalCoordinateSource === reviewedEstimateSource2;
    const latitude = historical ? row2.historicalLatitude : row2.latitude, longitude = historical ? row2.historicalLongitude : row2.longitude;
    if (!historical && row2.coordinateSource !== reviewedEstimateSource2 || !coordinate4(latitude, 90) || !coordinate4(longitude, 180) || latitude !== p.latitude || longitude !== p.longitude) return null;
    if (await reviewedEstimateSha2562(row2.address.replace(/\s+/g, " ").trim().toLowerCase()) !== p.originalAddressSha256 || await reviewedApprovalDigest2(p) !== p.approvalSha256 || !approvals.has(p.approvalSha256) || await reviewedApplicationDigest2(p) !== p.applicationSha256 || !applications.has(p.applicationSha256)) return null;
    return {
      latitude: p.latitude,
      longitude: p.longitude,
      matchedAddress: p.matchedAddress,
      originalAddress: p.originalAddress,
      retrievedAt: p.retrievedAt,
      confidence: "approximate_property_location",
      source: reviewedEstimateSource2,
      provider: "geocodio",
      providerAccuracy: p.providerAccuracy,
      providerAccuracyType: "rooftop",
      providerMatchType: p.providerMatchType,
      providerDataSource: p.providerDataSource,
      approvedDifference: p.addressMatchReview.kind
    };
  } catch {
    return null;
  }
}

// tech-checks/operations/shared/gpsValidation.ts
var GpsValidationError2 = class extends Error {
  statusCode = 400;
  constructor(message) {
    super(message);
    this.name = "GpsValidationError";
  }
};
var decimal3 = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function numeric2(value2, label3, allowText) {
  if (allowText && typeof value2 === "string" && value2.trim() && decimal3.test(value2.trim())) value2 = Number(value2.trim());
  if (typeof value2 !== "number" || !Number.isFinite(value2)) throw new GpsValidationError2(label3 + " is required and must be a finite number.");
  return value2;
}
function gpsCoordinates2(input2, allowText = false) {
  if (!input2 || typeof input2 !== "object" || Array.isArray(input2)) throw new GpsValidationError2("GPS coordinates are required.");
  const body = input2;
  const latitude = numeric2(body.latitude, "Latitude", allowText);
  const longitude = numeric2(body.longitude, "Longitude", allowText);
  if (latitude < -90 || latitude > 90) throw new GpsValidationError2("Latitude must be between -90 and 90.");
  if (longitude < -180 || longitude > 180) throw new GpsValidationError2("Longitude must be between -180 and 180.");
  const rawAccuracy = body.accuracyM;
  const absentAccuracy = rawAccuracy == null || allowText && typeof rawAccuracy === "string" && !rawAccuracy.trim();
  const accuracyM = absentAccuracy ? null : numeric2(rawAccuracy, "GPS accuracy", allowText);
  if (accuracyM !== null && accuracyM < 0) throw new GpsValidationError2("GPS accuracy must be zero or greater.");
  return { latitude, longitude, accuracyM };
}
function hasGpsCoordinates2(record5) {
  try {
    gpsCoordinates2(record5, true);
    return true;
  } catch {
    return false;
  }
}

// tech-checks/supabase/functions/cos-operations-pages/routers.ts
var ROUTER_FRESHNESS_MS2 = 20 * 60 * 1e3;
var text9 = (value2) => typeof value2 === "string" ? value2.trim() : "";
var stamp3 = (value2) => typeof value2 === "string" && Number.isFinite(Date.parse(value2)) ? value2 : null;
var number = (value2) => typeof value2 === "number" && Number.isFinite(value2) ? value2 : null;
var exactUnitName = (value2) => text9(value2).replace(/\s+/g, " ").toLowerCase();
function routerSnapshot(routers, units, now = /* @__PURE__ */ new Date()) {
  if (!Array.isArray(routers) || !Array.isArray(units)) throw new Error("Router source returned an incomplete collection.");
  const unitGroups = /* @__PURE__ */ new Map(), routerCounts = /* @__PURE__ */ new Map();
  for (const unit of units) {
    if (typeof unit.id !== "string" || !text9(unit.unit_number)) throw new Error("COS unit list is incomplete.");
    const key2 = exactUnitName(unit.unit_number);
    unitGroups.set(key2, [...unitGroups.get(key2) || [], unit]);
  }
  for (const router of routers) {
    const key2 = exactUnitName(router.unit_key);
    routerCounts.set(key2, (routerCounts.get(key2) || 0) + 1);
  }
  const seen = /* @__PURE__ */ new Set();
  const items = routers.map((row2) => {
    if (!row2 || typeof row2.id !== "string" && typeof row2.id !== "number" || !text9(row2.unit_key)) throw new Error("Router inventory contains an incomplete row.");
    const id15 = String(row2.id);
    if (!id15 || seen.has(id15)) throw new Error("Router inventory contains duplicate identities.");
    seen.add(id15);
    const key2 = exactUnitName(row2.unit_key), candidates = unitGroups.get(key2) || [];
    const ambiguous = candidates.length > 1 || (routerCounts.get(key2) || 0) > 1;
    const match = ambiguous ? "ambiguous" : candidates.length === 1 ? "exact_name" : "unmatched";
    const candidateUnit = match === "exact_name" ? { id: String(candidates[0].id), unitNumber: String(candidates[0].unit_number) } : null;
    const port = number(row2.web_port);
    return {
      id: id15,
      unitKey: text9(row2.unit_key),
      name: text9(row2.router_name) || text9(row2.unit_key),
      model: text9(row2.router_model),
      publicIp: text9(row2.router_public_ip) || null,
      unitIp: text9(row2.unit_ip) || null,
      port: port !== null && Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
      protocol: ["http", "https"].includes(text9(row2.web_protocol).toLowerCase()) ? text9(row2.web_protocol).toLowerCase() : null,
      probeStatus: ["online", "offline"].includes(text9(row2.current_status).toLowerCase()) ? text9(row2.current_status).toLowerCase() : "unknown",
      checkedAt: stamp3(row2.last_checked_at),
      lastRecoveredAt: stamp3(row2.last_online_at),
      reportedStatus: text9(row2.reported_status) || "Unknown",
      reportedAt: stamp3(row2.status_observed_at),
      reportedSource: text9(row2.status_source) || "Unspecified import",
      savedLatencyMs: number(row2.reported_latency_ms) !== null && Number(row2.reported_latency_ms) >= 0 ? Number(row2.reported_latency_ms) : null,
      match,
      candidateUnit,
      gps: null
    };
  }).sort((a, b) => a.unitKey.localeCompare(b.unitKey, void 0, { numeric: true }));
  return { items, generatedAt: now.toISOString(), source: "camera_health", gpsAvailable: false };
}

// tech-checks/operations/src/fieldLocations.ts
function isCurrentFieldPin2(unit) {
  return unit.locationVerification === "owner_verified" && Boolean(unit.address?.trim()) && hasGpsCoordinates2(unit) && typeof unit.locationVerifiedAt === "string" && Number.isFinite(Date.parse(unit.locationVerifiedAt)) && unit.locationVerifiedAt === unit.gpsRecordedAt;
}
var normalizeLocationAddress = (value2) => value2.replace(/\s+/g, " ").trim().toLowerCase();

// tech-checks/operations/src/fieldAddressEstimates.ts
var addressEstimateSource = "us_census_address_range_estimate";
var addressEstimatePrefix = "COS_ADDRESS_ESTIMATE_V1|";
var object14 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
var text10 = (value2, max) => typeof value2 === "string" && value2.trim().length > 0 && value2.length <= max;
var date4 = (value2, now) => {
  if (typeof value2 !== "string") return false;
  const parts3 = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value2);
  if (!parts3 || !Number.isFinite(Date.parse(value2)) || Date.parse(value2) > now) return false;
  const calendar = new Date(Date.UTC(Number(parts3[1]), Number(parts3[2]) - 1, Number(parts3[3])));
  return calendar.getUTCFullYear() === Number(parts3[1]) && calendar.getUTCMonth() + 1 === Number(parts3[2]) && calendar.getUTCDate() === Number(parts3[3]);
};
function historicalOwnerGpsOnly(unit, geocodedAt, now) {
  const stamp6 = (value2) => typeof value2 === "string" && /^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value2) && date4(value2.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"), now);
  if (unit.readOnly !== false || unit.placementSource !== "owner" || unit.placement !== "FIELD" || unit.status !== "field" || unit.currentLocationType !== "field" || unit.placementStatus === "needs_identity_review" || typeof unit.placementAuditId !== "string" || !/^[1-9]\d*$/.test(unit.placementAuditId) || !text10(unit.placementUnitKey, 250) || unit.addressSource !== "Owner confirmed installation address" || unit.hasUnitGps !== true || unit.locationVerification !== "address_changed" || unit.latitude !== null || unit.longitude !== null || unit.coordinateSource !== null || unit.locationVerifiedAt !== null || unit.locationHistoryId !== null || !["manual", "site"].includes(unit.historicalCoordinateSource || "") || typeof unit.historicalLatitude !== "number" || typeof unit.historicalLongitude !== "number" || !hasGpsCoordinates2({ latitude: unit.historicalLatitude, longitude: unit.historicalLongitude }) || !stamp6(unit.gpsRecordedAt) || unit.gpsRecordedAt !== unit.historicalRecordedAt || !stamp6(unit.placementUpdatedAt) || unit.placementUpdatedAt !== unit.addressUpdatedAt || !stamp6(geocodedAt)) return false;
  return Date.parse(unit.gpsRecordedAt) < Date.parse(unit.placementUpdatedAt) && Date.parse(unit.placementUpdatedAt) <= Date.parse(geocodedAt);
}
function addressParts(value2) {
  const m = /^(.+),\s*([^,]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(?:-\d{4})?\s*$/i.exec(value2.trim());
  if (!m || !/^\d+[A-Z]?\s/i.test(m[1])) return null;
  const aliases5 = { COUNTY: "CO", ROAD: "RD", STREET: "ST", AVENUE: "AVE", BOULEVARD: "BLVD", DRIVE: "DR", LANE: "LN", COURT: "CT", PLACE: "PL", PARKWAY: "PKWY", HIGHWAY: "HWY", TERRACE: "TER", CIRCLE: "CIR", TRAIL: "TRL", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
  const street = m[1].toUpperCase().replace(/\./g, "").replace(/\b[A-Z]+\b/g, (word) => aliases5[word] || word).replace(/\s+/g, " ").trim();
  return { street, city: m[2].trim().toUpperCase(), state: m[3].toUpperCase(), zip: m[4] };
}
async function checkedAddressEstimate(unit, now = Date.now()) {
  const mhelp = unit.mhelpLocation;
  if (unit.locationGeocode?.censusOnly !== true && mhelp?.contract === "COS_MHELP_FLEET_LOCATIONS_V1" && mhelp.unitId === unit.id && mhelp.unitNumber === unit.unitNumber && mhelp.placement === "FIELD" && mhelp.verified === false && mhelp.address === unit.address && unit.currentLocationType === "field" && !isCurrentFieldPin2(unit) && !unit.hasUnitGps && date4(mhelp.observedAt, now) && now - Date.parse(mhelp.observedAt) <= 40 * 60 * 1e3 && Array.isArray(mhelp.point) && mhelp.point.length === 2 && hasGpsCoordinates2({ latitude: mhelp.point[0], longitude: mhelp.point[1] }) && ["mHelpDesk service location", "Census address estimate"].includes(mhelp.coordinateSource)) return { latitude: mhelp.point[0], longitude: mhelp.point[1], matchedAddress: mhelp.address, sourceObservedAt: mhelp.observedAt, confidence: "mhelp_service_unverified", coordinateSource: mhelp.coordinateSource };
  if (unit.locationNote?.startsWith(reviewedEstimatePrefix2) || unit.coordinateSource === reviewedEstimateSource2 || unit.historicalCoordinateSource === reviewedEstimateSource2) {
    if (unit.placementSource !== "owner" && (unit.importedInstallation != null || unit.importedPlacement != null)) {
      const binding = await checkedImportedBinding(unit.importedInstallation);
      if (!binding || unit.id !== binding.nativeUnitId || unit.unitNumber !== binding.unitNumber || (unit.readOnly === true ? "tracker" : "equipment_unit") !== binding.entityKind || unit.currentLocationType !== "field" || unit.importedPlacement != null && unit.importedPlacement !== "FIELD" || !unit.address) return null;
      const digest3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeLocationAddress(unit.address)))), (x) => x.toString(16).padStart(2, "0")).join("");
      if (digest3 !== binding.addressSha256) return null;
    }
    const reviewed2 = await checkedReviewedAddressEstimate2(unit, now);
    if (reviewed2) return reviewed2;
  }
  const recorded = await checkedSourceRecordedCoordinates(unit, now);
  if (recorded) return recorded;
  if (unit.importedInstallation && unit.placementSource !== "owner") {
    const binding = await checkedImportedBinding(unit.importedInstallation), r = unit.locationImportedGeocode;
    if (!binding || !r || r.status !== "success" || r.jobKind !== "native_import" || r.verified !== false || r.liveGps !== false || !/^[a-f0-9]{64}$/.test(r.legacyGuardSha256) || unit.id !== binding.nativeUnitId || unit.unitNumber !== binding.unitNumber || (unit.readOnly === true ? "tracker" : "equipment_unit") !== binding.entityKind || unit.hasUnitGps === true || unit.locationVerification === "owner_verified" || isCurrentFieldPin2(unit) || unit.currentLocationType !== "field" || unit.placement === "SHOP" || unit.placement === "UNKNOWN" || unit.placementStatus === "needs_identity_review" || unit.placementAuditId != null || !unit.address) return null;
    const returned = await checkedImportedBinding(r.binding);
    if (!returned || JSON.stringify(binding) !== JSON.stringify(returned) || !matchesInstallation(binding.installation, r.matchedAddress) || !date4(r.geocodedAt, now) || !hasGpsCoordinates2(r) || typeof r.latitude !== "number" || typeof r.longitude !== "number") return null;
    const digest3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeLocationAddress(unit.address)))), (x) => x.toString(16).padStart(2, "0")).join("");
    if (digest3 !== binding.addressSha256) return null;
    const inferredComponents = [...binding.suppliedComponents.city ? [] : ["city"], ...binding.suppliedComponents.zip ? [] : ["ZIP"]];
    const common2 = { latitude: r.latitude, longitude: r.longitude, matchedAddress: r.matchedAddress, geocodedAt: r.geocodedAt, inferredComponents, originalAddress: unit.address };
    if (r.provider === "us_census_address_range" && r.benchmark === "Public_AR_Current") return { ...common2, confidence: "address_range_interpolation", source: addressEstimateSource, providerMatchQuality: "Exact" };
    if (r.provider !== "geocodio" || !["rooftop", "range_interpolation"].includes(r.accuracyType) || typeof r.accuracy !== "number" || !Number.isFinite(r.accuracy) || r.accuracy < 0.9 || r.accuracy > 1 || ![null, "building_centroid", "parcel_centroid"].includes(r.matchType ?? null) || r.accuracyType === "range_interpolation" && r.matchType != null) return null;
    return { ...common2, confidence: "automatic_address_estimate", source: "geocodio_automatic_address_estimate", provider: "geocodio", accuracyType: r.accuracyType, accuracy: r.accuracy, matchType: r.matchType ?? null };
  }
  const automatic = unit.locationGeocode;
  if (automatic?.status === "success" && automatic.provider === "geocodio") {
    if (isCurrentFieldPin2(unit) || unit.locationVerification === "owner_verified" || unit.placement !== "FIELD" || unit.placementSource !== "owner" || unit.placementStatus === "needs_identity_review" || unit.status !== "field" || unit.currentLocationType !== "field" || !unit.address?.trim() || automatic.auditId !== unit.placementAuditId || automatic.unitKey !== unit.placementUnitKey || automatic.source !== "geocodio_automatic_address_estimate" || automatic.confidence !== "estimate" || automatic.verified !== false || automatic.liveGps !== false || !["rooftop", "range_interpolation"].includes(automatic.accuracyType) || typeof automatic.accuracy !== "number" || !Number.isFinite(automatic.accuracy) || automatic.accuracy < 0.9 || automatic.accuracy > 1 || ![null, "building_centroid", "parcel_centroid"].includes(automatic.matchType ?? null) || automatic.accuracyType === "range_interpolation" && automatic.matchType != null || !text10(automatic.matchedAddress, 600) || !date4(automatic.geocodedAt, now) || !hasGpsCoordinates2(automatic) || typeof automatic.latitude !== "number" || typeof automatic.longitude !== "number") return null;
    const parsedOwner = parseOwnerInstallationAddress(unit.address, fullMatchedParts);
    if (!parsedOwner || !matchesInstallation(parsedOwner.installation, automatic.matchedAddress)) return null;
    const digest3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeLocationAddress(unit.address)))), (x) => x.toString(16).padStart(2, "0")).join("");
    if (digest3 !== automatic.addressSha256) return null;
    return { ...parsedOwner.secondaryUnit ? { originalAddress: parsedOwner.originalAddress, secondaryUnit: parsedOwner.secondaryUnit, secondaryUnitVerified: false } : {}, latitude: automatic.latitude, longitude: automatic.longitude, matchedAddress: automatic.matchedAddress, geocodedAt: automatic.geocodedAt, confidence: "automatic_address_estimate", source: "geocodio_automatic_address_estimate", provider: "geocodio", accuracyType: automatic.accuracyType, accuracy: automatic.accuracy, matchType: automatic.matchType ?? null };
  }
  if (automatic?.status === "success" && !isCurrentFieldPin2(unit) && unit.status === "field" && unit.currentLocationType === "field" && unit.address?.trim()) {
    if (automatic.auditId !== unit.placementAuditId || automatic.unitKey !== unit.placementUnitKey || automatic.provider !== "us_census_address_range" || automatic.benchmark !== "Public_AR_Current" || !text10(automatic.matchedAddress, 300) || !date4(automatic.geocodedAt, now) || !hasGpsCoordinates2(automatic) || typeof automatic.latitude !== "number" || typeof automatic.longitude !== "number") return null;
    const parsedOwner = parseOwnerInstallationAddress(unit.address, fullMatchedParts);
    if (!parsedOwner && /\b(?:suite|ste)\b/i.test(unit.address)) return null;
    if (parsedOwner?.secondaryUnit) {
      if (unit.placementSource !== "owner" || unit.placement !== "FIELD" || unit.placementStatus === "needs_identity_review" || unit.locationVerification === "owner_verified" || unit.hasUnitGps === true && !historicalOwnerGpsOnly(unit, automatic.geocodedAt, now) || !matchesInstallation(parsedOwner.installation, automatic.matchedAddress)) return null;
    } else {
      const original = addressParts(unit.address), matched = addressParts(automatic.matchedAddress);
      if (!original || !matched || JSON.stringify(original) !== JSON.stringify(matched)) return null;
    }
    const digest3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeLocationAddress(unit.address)))), (x) => x.toString(16).padStart(2, "0")).join("");
    if (digest3 !== automatic.addressSha256) return null;
    return { ...parsedOwner?.secondaryUnit ? { originalAddress: parsedOwner.originalAddress, secondaryUnit: parsedOwner.secondaryUnit, secondaryUnitVerified: false } : {}, latitude: automatic.latitude, longitude: automatic.longitude, matchedAddress: automatic.matchedAddress, geocodedAt: automatic.geocodedAt, confidence: "address_range_interpolation", source: addressEstimateSource, providerMatchQuality: "Exact" };
  }
  if (isCurrentFieldPin2(unit) || unit.hasUnitGps === true || unit.status !== "field" || !unit.address?.trim() || unit.locationVerification === "address_changed") return null;
  const trackerOnly = unit.readOnly === true;
  const trackerId = trackerOnly ? unit.id : unit.addressEstimateTrackerId;
  const trackerUnitNumber = trackerOnly ? unit.unitNumber : unit.addressEstimateUnitNumber;
  if (trackerOnly ? unit.currentLocationType !== "field" : unit.readOnly !== false || !text10(trackerId, 100) || !text10(trackerUnitNumber, 160) || ![null, void 0, "", "field"].includes(unit.currentLocationType)) return null;
  const historical = unit.historicalCoordinateSource === addressEstimateSource;
  const saved = historical ? { latitude: unit.historicalLatitude, longitude: unit.historicalLongitude } : { latitude: unit.latitude, longitude: unit.longitude };
  if (!historical && unit.coordinateSource !== addressEstimateSource || !hasGpsCoordinates2(saved)) return null;
  const first = unit.locationNote?.split("\n", 1)[0];
  if (!first?.startsWith(addressEstimatePrefix) || first.length > 4096) return null;
  let note;
  try {
    note = JSON.parse(first.slice(addressEstimatePrefix.length));
  } catch {
    return null;
  }
  if (!object14(note) || note.schemaVersion !== 1 || note.trackerId !== trackerId || note.unitNumber !== trackerUnitNumber || note.verified !== false || note.liveGps !== false || note.requiresOwnerConfirmation !== true || note.provider !== "us_census_address_range" || note.benchmark !== "Public_AR_Current" || !["Exact", "Non_Exact"].includes(String(note.providerMatchQuality)) || note.confidence !== "address_range_interpolation" || !text10(note.batchId, 100) || !text10(note.approvalReference, 200) || !text10(note.appliedByDatabaseRole, 100) || !text10(note.matchedAddress, 300) || !date4(note.geocodedAt, now) || !date4(note.appliedAt, now) || Date.parse(note.appliedAt) < Date.parse(note.geocodedAt) || typeof note.addressSha256 !== "string" || !/^[a-f0-9]{64}$/.test(note.addressSha256) || typeof note.latitude !== "number" || typeof note.longitude !== "number" || !hasGpsCoordinates2(note) || note.latitude !== Number(saved.latitude) || note.longitude !== Number(saved.longitude)) return null;
  const sourceAddress = addressParts(unit.address), matchedAddress = addressParts(note.matchedAddress);
  if (!sourceAddress || !matchedAddress || JSON.stringify(sourceAddress) !== JSON.stringify(matchedAddress)) return null;
  if (note.providerMatchQuality === "Non_Exact" && (!/\b\d{5}-\d{4}\s*$/.test(unit.address) || !/\b\d{5}\s*$/.test(note.matchedAddress))) return null;
  try {
    const bytes = new TextEncoder().encode(normalizeLocationAddress(unit.address));
    const hash7 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
    if (hash7 !== note.addressSha256) return null;
  } catch {
    return null;
  }
  return { latitude: note.latitude, longitude: note.longitude, matchedAddress: note.matchedAddress, geocodedAt: note.geocodedAt, confidence: "address_range_interpolation", source: addressEstimateSource, providerMatchQuality: note.providerMatchQuality };
}

// tech-checks/supabase/functions/cos-operations-pages/validatedLocationProofs.ts
var fields = ["address", "addressSource", "addressUpdatedAt", "latitude", "longitude", "coordinateSource", "gpsRecordedAt", "gpsAccuracyM", "hasUnitGps", "installedSiteId", "locationVerification", "locationVerifiedAt", "locationHistoryId", "locationNote", "locationGeocode", "locationImportedGeocode", "locationSourceRecorded", "locationSourceRecordedConflict", "importedInstallation", "importedPlacement", "placementPrecedenceBinding", "addressEstimateOrganizationId", "addressEstimateReviewEpoch", "addressEstimateNativeRevision", "addressEstimateLegacyEvidenceSha256", "addressEstimateTrackerId", "addressEstimateUnitNumber", "historicalLatitude", "historicalLongitude", "historicalCoordinateSource", "historicalRecordedAt"];
async function validatedLocationProofs(snapshot, now = Date.now(), options = {}) {
  const proofs = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Set();
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems)) throw Error("Location proof inventory unavailable");
  const fieldsInView = new Set(snapshot.items.map((r) => r.id));
  const originals = /* @__PURE__ */ new Map();
  for (const row2 of options.originalInventory || []) {
    if (originals.has(row2.id)) throw Error("Duplicate original location identity");
    originals.set(row2.id, row2);
  }
  for (const row2 of snapshot.inventoryItems) {
    if (ids.has(row2.id)) throw Error("Duplicate location proof identity");
    ids.add(row2.id);
    if (!fieldsInView.has(row2.id) || row2.placement === "SHOP" || row2.placement === "UNKNOWN" || row2.placementStatus === "needs_identity_review" || row2.placementReviewReason || row2.representationStatus === "conflict" || typeof row2.address !== "string" || !row2.address.trim()) continue;
    const verified = isCurrentFieldPin2(row2) && Number.isFinite(Date.parse(row2.locationVerifiedAt)) && Date.parse(row2.locationVerifiedAt) <= now;
    const estimate = verified ? null : await checkedAddressEstimate(row2, now);
    if (!verified && !estimate) continue;
    if (estimate?.confidence === "mhelp_service_unverified") continue;
    const locationFields = Object.fromEntries(fields.filter((k) => Object.hasOwn(row2, k)).map((k) => [k, structuredClone(row2[k])]));
    const ownerPlacementFields = row2.placementSource === "owner" ? { ...Object.fromEntries(["placementSource", "placementAuditId", "placementUnitKey", "placementUpdatedAt", "placementStatus"].filter((k) => Object.hasOwn(row2, k)).map((k) => [k, row2[k]])), placementEvidence: row2.placementEvidence ?? null } : null;
    const original = originals.get(row2.id), normalize4 = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "";
    const originalAssignment = original && original.unitNumber === row2.unitNumber && normalize4(original.address) === normalize4(row2.address) ? { unitId: row2.id, unitNumber: row2.unitNumber, customer: typeof original.customer === "string" ? original.customer : null, site: typeof original.site === "string" ? original.site : null } : null;
    proofs.set(row2.id, { originalAssignment, contract: "COS_VALIDATED_LOCATION_PROOF_V1", unitId: row2.id, unitNumber: row2.unitNumber, kind: verified ? "owner_verified" : "address_estimate", productId: row2.importedInstallation?.productId || row2.locationSourceRecorded?.productId || null, address: row2.address, customer: typeof row2.customer === "string" ? row2.customer : null, site: typeof row2.site === "string" ? row2.site : null, locationFields, ownerPlacementFields });
  }
  return proofs;
}
function exactLocationProof(proofs, row2) {
  const proof = proofs?.get(row2.id);
  return proof?.contract === "COS_VALIDATED_LOCATION_PROOF_V1" && proof.unitId === row2.id && proof.unitNumber === row2.unitNumber && ["owner_verified", "address_estimate"].includes(proof.kind) && proof.address === row2.address && proof.locationFields?.address === proof.address ? proof : null;
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpFleetLocationProjection.ts
var uuid13 = (v) => typeof v === "string" && /^[a-f0-9-]{36}$/i.test(v);
var safe2 = (v, max = 600) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
function projectMhelpFleetLocations(snapshot, receipt2, now = Date.now()) {
  if (!receipt2 || receipt2.contract !== "COS_MHELP_FLEET_LOCATIONS_V1" || !Array.isArray(receipt2.items) || receipt2.items.length > 2e3) return snapshot;
  const byId = /* @__PURE__ */ new Map();
  for (const r of receipt2.items) {
    if (!uuid13(r.unitId) || !safe2(r.unitNumber, 160) || byId.has(r.unitId) || !["confirmed", "held"].includes(r.state)) throw Error("Invalid location inventory");
    byId.set(r.unitId, r);
  }
  const inventory = (snapshot.inventoryItems || snapshot.items).map((unit) => {
    const r = byId.get(unit.id);
    if (!r || r.unitNumber !== unit.unitNumber) return unit;
    const time3 = Date.parse(r.observedAt), current = r.guardCurrent === true && Number.isFinite(time3) && time3 <= now && now - time3 <= 40 * 60 * 1e3 && (receipt2.errorCode == null || time3 >= Date.parse(receipt2.lastAttemptAt));
    if (!current || r.state !== "confirmed") return { ...unit, mhelpLocationReviewReason: !current ? "Current mHelpDesk location evidence is unavailable" : String(r.reason || "mHelpDesk equipment identity needs review").replaceAll("_", " ") };
    if (!["FIELD", "SHOP"].includes(r.placement) || !safe2(r.customer, 250) || !safe2(r.site, 250) || r.address !== null && !safe2(r.address)) throw Error("Invalid service location");
    if (r.point !== null && (!Array.isArray(r.point) || r.point.length !== 2 || r.point.some((n) => typeof n !== "number" || !Number.isFinite(n)) || Math.abs(r.point[0]) > 90 || Math.abs(r.point[1]) > 180)) throw Error("Invalid service point");
    const assignmentAt = Date.parse(unit.mhelpObservedAt);
    if (unit.placementSource === "mhelpdesk" && Number.isFinite(assignmentAt) && assignmentAt > time3 && (unit.placement !== r.placement || unit.customer !== r.customer || unit.site !== r.site))
      return { ...unit, mhelpLocationReviewReason: "A newer mHelpDesk assignment supersedes this saved service location. Refresh its address evidence." };
    const evidence = { contract: receipt2.contract, placement: r.placement, customer: r.customer, site: r.site, unitId: unit.id, unitNumber: unit.unitNumber, address: r.address, point: r.point, coordinateSource: r.coordinateSource, observedAt: r.observedAt, verified: false };
    if (unit.placementSource === "owner" || unit.hasUnitGps || unit.installedSiteId || unit.placementAuditId || unit.placementStatus === "needs_identity_review") return { ...unit, mhelpLocation: evidence, mhelpCurrentPlacement: r.placement, mhelpLocationReviewReason: r.address && unit.address !== r.address ? "mHelpDesk service address differs from the protected saved installation" : null };
    const changed = unit.address !== r.address;
    return {
      ...unit,
      placement: r.placement,
      placementSource: "mhelpdesk",
      currentLocationType: r.placement.toLowerCase(),
      status: r.placement === "FIELD" ? "field" : unit.status,
      customer: r.customer,
      site: r.site,
      address: r.address,
      addressSource: "mHelpDesk service location",
      mhelpObservedAt: r.observedAt,
      mhelpLocation: evidence,
      mhelpLocationReviewReason: r.reason || null,
      mhelpLocationReview: !r.address,
      ...changed || r.placement === "SHOP" ? { historicalLatitude: unit.latitude ?? unit.historicalLatitude, historicalLongitude: unit.longitude ?? unit.historicalLongitude, latitude: null, longitude: null, coordinateSource: null, importedInstallation: null, addressEstimateTrackerId: null, addressEstimateUnitNumber: null, locationVerification: "address_only" } : {}
    };
  });
  const fieldIds = new Set(snapshot.items.map((r) => r.id));
  const items = inventory.filter((r) => r.placementSource === "mhelpdesk" ? r.placement === "FIELD" : fieldIds.has(r.id));
  return { ...snapshot, inventoryItems: inventory, items, mhelpLocationSync: { readAt: receipt2.lastSuccessAt, review: inventory.filter((r) => r.mhelpLocationReviewReason).length }, summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length } };
}

// tech-checks/supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts
var contract = "COS_EFFECTIVE_FLEET_PLACEMENT_V1";
var status = (row2) => {
  const value2 = String(row2.placement || row2.currentLocationType || "").toUpperCase();
  return ["FIELD", "SITE"].includes(value2) ? "FIELD" : ["SHOP", "ROOT", "YARD", "WAREHOUSE"].includes(value2) ? "SHOP" : value2 === "UNKNOWN" ? "UNKNOWN" : null;
};
var instant = (value2) => typeof value2 === "string" && Number.isFinite(Date.parse(value2)) ? value2 : null;
function projectEffectiveFleetPlacement(snapshot, audits, options = {}) {
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(audits)) throw Error("Effective fleet placement is unavailable");
  const concernKeys = /* @__PURE__ */ new Map();
  const concernKey = (value2) => {
    let key2 = concernKeys.get(value2);
    if (key2 === void 0) {
      key2 = placementIdentityConcernKey(value2);
      concernKeys.set(value2, key2);
    }
    return key2;
  };
  const inventory = snapshot.inventoryItems, byId = /* @__PURE__ */ new Map();
  for (const row2 of inventory) {
    if (!row2 || typeof row2.id !== "string" || typeof row2.unitNumber !== "string" || byId.has(row2.id)) throw Error("Effective fleet inventory has inconsistent identities");
    byId.set(row2.id, row2);
  }
  const fieldIds = /* @__PURE__ */ new Set();
  for (const row2 of snapshot.items) {
    if (!row2 || !byId.has(row2.id) || byId.get(row2.id).unitNumber !== row2.unitNumber || fieldIds.has(row2.id)) throw Error("Effective field membership is inconsistent");
    fieldIds.add(row2.id);
  }
  const reviewed2 = new Set((options.confirmedPrecedenceBindings || []).map((b) => JSON.stringify(b)));
  const inventoryItems = inventory.map((raw) => {
    const { effectivePlacement: _old, ...row2 } = raw;
    let placement3 = status(row2), reason = row2.placementReviewReason || null;
    const conflict3 = row2.placementStatus === "needs_identity_review" || row2.representationStatus === "conflict" || Boolean(row2.placementReviewReason);
    const owner = row2.placementSource === "owner" && Boolean(row2.placementAuditId);
    const binding = row2.importedInstallation || row2.placementPrecedenceBinding;
    const reviewedImport = binding && binding.nativeUnitId === row2.id && binding.unitNumber === row2.unitNumber && reviewed2.has(JSON.stringify(binding));
    const unitUploadClaims = (options.authorizedUploadPlacements || []).filter((a) => a.unitId === row2.id);
    const uploadClaims = unitUploadClaims.filter((a) => ["owner_supplied_mhelp_export", "mhelpdesk_api"].includes(a.source) && a.unitNumber === row2.unitNumber && a.placement === placement3 && /^[1-9][0-9]*$/.test(a.productId) && /^[a-f0-9]{64}$/.test(a.sourceSha256) && instant(a.observedAt) && row2.placementSource === "mhelpdesk_upload" && row2.placementEvidence?.source === a.source && row2.placementEvidence.productId === a.productId && row2.placementEvidence.sourceSha256 === a.sourceSha256 && row2.placementEvidence.observedAt === a.observedAt);
    const authorizedUpload = unitUploadClaims.length === 1 && uploadClaims.length === 1;
    const concern3 = concernKey(row2.unitNumber);
    const rootHistory = audits.some((a) => a.action === "MOVE_TO_ROOT" && concernKey(a.unit_key) === concern3);
    if (conflict3) placement3 = "UNKNOWN";
    else if ((placement3 === "FIELD" || placement3 === null && fieldIds.has(row2.id)) && rootHistory && !owner && !reviewedImport && !authorizedUpload) {
      placement3 = "UNKNOWN";
      reason = "A prior Owner ROOT move conflicts with this imported field record. Review placement precedence.";
    } else if (placement3 === null) placement3 = fieldIds.has(row2.id) ? "FIELD" : "UNKNOWN";
    const evidence = row2.placementEvidence;
    const observedAt2 = (owner ? instant(row2.placementUpdatedAt) : null) || instant(evidence?.observedAt) || instant(row2.placementUpdatedAt) || instant(row2.mhelpObservedAt) || instant(row2.sourceVerifiedAt) || null;
    const source = owner ? "owner" : evidence?.source || row2.placementSource || "recorded_inventory";
    const effectivePlacement = { contract, state: placement3.toLowerCase(), source, observedAt: observedAt2, freshness: placement3 === "UNKNOWN" ? "review" : evidence?.fresh === true ? "current" : "recorded", reason: reason || evidence?.reason || null };
    const activeInventoryEligible = row2.activeInventoryEligible !== false && row2.uploadActiveInventoryEligible !== false && !["DO_NOT_USE", "MISSING"].includes(row2.uploadLifecycle);
    return {
      ...row2,
      placement: placement3,
      currentLocationType: placement3.toLowerCase(),
      effectivePlacement,
      activeInventoryEligible,
      ...reason ? { placementReviewReason: reason, placementStatus: "needs_identity_review", latitude: null, longitude: null, coordinateSource: null } : {}
    };
  });
  const items = inventoryItems.filter((r) => r.effectivePlacement.state === "field" && r.activeInventoryEligible !== false);
  const count6 = (state) => inventoryItems.filter((r) => r.effectivePlacement.state === state && r.activeInventoryEligible !== false).length;
  return {
    ...snapshot,
    inventoryItems,
    items,
    effectivePlacementVersion: 1,
    placementSummary: { totalUnits: inventoryItems.length, fieldUnits: count6("field"), shopUnits: count6("shop"), reviewUnits: count6("unknown"), excludedLifecycleUnits: inventoryItems.filter((r) => r.activeInventoryEligible === false).length },
    summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, unitGps: items.filter((r) => r.hasUnitGps === true).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts
var object15 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var hash2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var uuid14 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
var id5 = (v) => typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v);
var safe3 = (v, max = 600) => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
var stamp4 = (v) => typeof v === "string" && /(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(v) ? Date.parse(v.replace(/([+-]\d\d)$/, "$1:00")) : NaN;
function checked(receipt2, now) {
  if (receipt2 == null) return null;
  if (!object15(receipt2) || !["COS_MHELP_UPLOAD_V1", "COS_MHELP_API_V1"].includes(receipt2.contract) || receipt2.reviewed !== true || !hash2(receipt2.sourceSha256) || !hash2(receipt2.payloadSha256) || !Number.isFinite(stamp4(receipt2.receivedAt)) || stamp4(receipt2.receivedAt) > now || !["minute", "second"].includes(receipt2.receivedAtPrecision) || receipt2.exportAsOf !== null || !Array.isArray(receipt2.records) || !receipt2.records.length || receipt2.records.length > 1e4) throw Error("Invalid reviewed mHelp upload receipt");
  if (receipt2.contract === "COS_MHELP_API_V1" && (receipt2.origin !== "mhelpdesk_api" || receipt2.portalId !== "224643" || receipt2.complete !== true || receipt2.recordCount !== receipt2.records.length || !Array.isArray(receipt2.apiMissingRecords))) throw Error("Invalid complete live mHelp source");
  const seen = /* @__PURE__ */ new Set(), targets = /* @__PURE__ */ new Set();
  for (const r of receipt2.records) {
    if (!object15(r) || !id5(r.productId) || seen.has(r.productId) || !safe3(r.unitNumber, 250) || !r.unitNumber || !safe3(r.category, 250) || !id5(r.customerId) || !safe3(r.customer, 250) || !r.customer || !["FIELD", "SHOP"].includes(r.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(r.lifecycle) || !object15(r.sourceAddress) || Object.values(r.sourceAddress).some((v) => typeof v !== "string" || v.length > 600 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v)) || !Number.isInteger(r.sourceRow) || r.sourceRow < 2) throw Error("Invalid mHelp upload source record");
    if (r.scopedAuthority != null) {
      const a = r.scopedAuthority;
      if (!object15(a) || a.contract !== "COS_SCOPED_INVENTORY_AUTHORITY_V1" || !uuid14(a.revisionId) || a.evidenceKind !== "derived_mapping" || !hash2(a.evidenceSha256) || !Number.isSafeInteger(receipt2.scopedRevision) || receipt2.scopedRevision < 1 || !Number.isFinite(stamp4(a.receivedAt)) || stamp4(a.receivedAt) < stamp4(receipt2.receivedAt) || stamp4(a.receivedAt) > now) throw Error("Invalid scoped inventory authority");
    }
    seen.add(r.productId);
    if (r.inventoryOnlyReason !== void 0 && (r.inventoryOnlyReason !== "no_sim" || r.placement !== "SHOP" || r.binding !== null || r.placementHeld !== true)) throw Error("Invalid inventory-only connection restriction");
    if (r.displayUnitNumber != null && (!safe3(r.displayUnitNumber, 250) || !r.displayUnitNumber || !hash2(r.displayAuthorizationSha256))) throw Error("Invalid approved display alias");
    if (r.binding != null) {
      const b = r.binding;
      if (!object15(b) || b.productId !== r.productId || !["reviewed_product_id", "exact_family_unit", "archived_alias", "owner_confirmed_alias"].includes(b.matchMethod) || !hash2(b.evidenceSha256) || !hash2(b.expectedGuard) || !(b.trackerId === null || uuid14(b.trackerId)) || !(b.trackerLabel === null || safe3(b.trackerLabel, 250)) || !(b.nativeUnitId === null || uuid14(b.nativeUnitId)) || !b.trackerId && !b.nativeUnitId || !(b.nativeLabel === null || safe3(b.nativeLabel, 250)) || typeof b.guardCurrent !== "boolean" || b.fullLabel !== r.unitNumber) throw Error("Invalid mHelp upload identity binding");
      for (const target of [b.trackerId, b.nativeUnitId].filter(Boolean)) {
        if (targets.has(target)) throw Error("Conflicting mHelp upload identities");
        targets.add(target);
      }
    }
  }
  return receipt2;
}
var historicalOnly = (row2) => ({
  historicalLatitude: row2.latitude ?? row2.historicalLatitude ?? null,
  historicalLongitude: row2.longitude ?? row2.historicalLongitude ?? null,
  historicalCoordinateSource: row2.coordinateSource ?? row2.historicalCoordinateSource ?? null,
  historicalHasUnitGps: row2.hasUnitGps ?? row2.historicalHasUnitGps ?? false,
  hasUnitGps: false,
  latitude: null,
  longitude: null,
  coordinateSource: null,
  locationVerification: "coordinates_unverified",
  locationVerifiedAt: null,
  locationHistoryId: null,
  importedInstallation: null,
  locationImportedGeocode: null,
  locationSourceRecorded: null,
  addressEstimateTrackerId: null,
  addressEstimateUnitNumber: null
});
function blockingReason(row2, b, audits, identity4, cutoff, groupRows, concernKey = placementIdentityConcernKey) {
  if (row2.placementReviewReason || row2.placementStatus === "needs_identity_review" || row2.representationStatus === "conflict" || (identity4?.identityWarnings || []).some((w) => w.unitId === row2.id)) return "identity_conflict";
  const proofs = [...identity4?.unitIdentities || [], ...identity4?.ownerConfirmedUnitIdentities || []].filter((p) => p.unitId === row2.id);
  const concerns = [row2.unitNumber, b.trackerLabel, b.nativeLabel, ...proofs.flatMap((p) => p.unitKeys || [])].filter(Boolean).map(concernKey);
  const devices = proofs.flatMap((p) => p.deviceIds || []);
  const related = audits.filter((a) => [row2.id, b.trackerId, b.nativeUnitId].filter(Boolean).includes(a.control_id) || concerns.includes(concernKey(a.unit_key)) || Array.isArray(a.device_ids) && a.device_ids.some((v) => devices.includes(String(v))));
  const confirmed = row2.mhelpConfirmedAssignment, sourceTime = stamp4(confirmed?.observedAt);
  const protectedTimes = [...related.map((a) => stamp4(a.created_at)), ...groupRows.flatMap((member) => [...member.placementSource === "owner" ? [stamp4(member.placementUpdatedAt)] : [], ...member.hasUnitGps === true ? [stamp4(member.gpsRecordedAt)] : [], ...member.installedSiteId ? [stamp4(member.placementUpdatedAt)] : []])];
  const protectedAfterSource = protectedTimes.some((t) => !Number.isFinite(t) || t >= cutoff && (!Number.isFinite(sourceTime) || t >= sourceTime));
  if (confirmed?.contract === "COS_MHELP_CONFIRMED_ASSIGNMENT_V1" && confirmed.unitId === row2.id && confirmed.unitNumber === row2.unitNumber && (!Number.isFinite(sourceTime) || sourceTime >= cutoff) && !protectedAfterSource) {
    const corroborated = groupRows.every((member) => {
      const current = member.mhelpConfirmedAssignment;
      return current?.contract === "COS_MHELP_CONFIRMED_ASSIGNMENT_V1" && current.unitId === member.id && current.unitNumber === member.unitNumber && Number.isFinite(stamp4(current.observedAt)) && stamp4(current.observedAt) >= cutoff && current.assignmentChanged === false && ["FIELD", "SHOP"].includes(current.placement) && current.placement === member.placement;
    }) && new Set(groupRows.map((member) => member.placement)).size === 1;
    return corroborated ? "newer_source_assignment" : "newer_or_undated_source_assignment";
  }
  if (related.some((a) => !Number.isFinite(stamp4(a.created_at)) || stamp4(a.created_at) >= cutoff)) return "newer_or_undated_owner_history";
  if (row2.placementSource === "owner" && (!Number.isFinite(stamp4(row2.placementUpdatedAt)) || stamp4(row2.placementUpdatedAt) >= cutoff)) return "newer_or_undated_owner_placement";
  const evidence = row2.placementEvidence;
  if (["mhelpdesk", "mhelpdesk_upload"].includes(row2.placementSource) && ["FIELD", "SHOP"].includes(row2.placement) && evidence?.state !== "review" && Math.max(stamp4(row2.mhelpObservedAt) || 0, stamp4(evidence?.observedAt) || 0) >= cutoff) return "newer_source_assignment";
  if (row2.hasUnitGps === true && (!Number.isFinite(stamp4(row2.gpsRecordedAt)) || stamp4(row2.gpsRecordedAt) >= cutoff) || row2.installedSiteId && (!Number.isFinite(stamp4(row2.placementUpdatedAt)) || stamp4(row2.placementUpdatedAt) >= cutoff)) return "newer_or_undated_verified_native_location";
  return null;
}
function retainedLocation(row2, r, b, proof, customerIds) {
  if (!proof || proof.contract !== "COS_VALIDATED_LOCATION_PROOF_V1" || proof.unitId !== row2.id || proof.unitNumber !== row2.unitNumber || !["owner_verified", "address_estimate"].includes(proof.kind) || !object15(proof.locationFields) || typeof proof.address !== "string" || !proof.address.trim() || r.placement !== "FIELD") return null;
  if (proof.productId !== null && proof.productId !== r.productId) return null;
  const change = row2.mhelpAssignmentChange;
  if (change?.contract === "COS_MHELP_ASSIGNMENT_CHANGE_V1" && change.unitId === row2.id && change.unitNumber === row2.unitNumber && ["customer_or_service_location_changed", "assignment_change_status_unavailable"].includes(change.reason)) {
    const observed2 = stamp4(change.observedAt), installed = proof.kind === "owner_verified" ? Math.max(stamp4(proof.locationFields.locationVerifiedAt) || 0, stamp4(proof.locationFields.gpsRecordedAt) || 0) : stamp4(proof.ownerPlacementFields?.placementUpdatedAt);
    if (!Number.isFinite(observed2) || !Number.isFinite(installed) || installed <= observed2) return null;
  }
  const prior = b.previousAssignment;
  if (prior && (prior.productId !== r.productId || prior.placement !== "FIELD" || prior.customerId !== r.customerId)) return null;
  const priorSame = prior?.productId === r.productId && prior?.placement === "FIELD" && prior?.customerId === r.customerId;
  const normalized7 = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "";
  const original = proof.originalAssignment;
  const assignment2 = original?.unitId === row2.id && original?.unitNumber === row2.unitNumber ? original : proof;
  const proofCustomer = normalized7(assignment2.customer), currentCustomer = normalized7(r.customer), proofSite = normalized7(assignment2.site);
  const composite = proofCustomer && proofSite ? proofCustomer + ": " + proofSite : "";
  const customerCandidates = [proofCustomer, composite].filter(Boolean);
  const sameCustomerIdentity = customerCandidates.some((label3) => {
    const ids = customerIds.get(label3);
    return label3 === currentCustomer && ids?.size === 1 && ids.has(r.customerId);
  });
  const delimiterNormalized = (label3) => label3.replace(/\s*:\s*/g, ": ");
  if (composite && delimiterNormalized(currentCustomer).startsWith(delimiterNormalized(proofCustomer) + ": ") && delimiterNormalized(currentCustomer) !== delimiterNormalized(composite)) return null;
  if (!priorSame && proofCustomer && !customerCandidates.includes(currentCustomer)) return null;
  const exactOwnerIdentity = proof.ownerPlacementFields?.placementSource === "owner" && proof.ownerPlacementFields?.placementAuditId != null;
  if (proof.kind === "address_estimate" && !priorSame && !((proof.productId === r.productId || exactOwnerIdentity) && sameCustomerIdentity)) return null;
  if (row2.locationVerification === "address_changed" && (proof.locationFields.locationVerification !== "address_changed" || typeof row2.address !== "string" || normalized7(row2.address) !== normalized7(proof.address)) || typeof row2.address === "string" && row2.address.trim() && normalized7(row2.address) !== normalized7(proof.address)) return null;
  const service = row2.mhelpLocation;
  if (service?.contract === "COS_MHELP_FLEET_LOCATIONS_V1" && service.unitId === row2.id && service.unitNumber === row2.unitNumber && typeof service.address === "string" && service.address.trim() && normalized7(service.address) !== normalized7(proof.address)) return null;
  return proof;
}
function projectMhelpUploadPlacement(snapshot, value2, audits, identity4, now = Date.now(), options = {}) {
  const receipt2 = checked(value2, now);
  if (!receipt2) return { snapshot, authorities: [] };
  const live = receipt2.contract === "COS_MHELP_API_V1", source = live ? "mhelpdesk_api" : "owner_supplied_mhelp_export";
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(audits)) throw Error("Invalid upload placement inputs");
  const byId = /* @__PURE__ */ new Map();
  for (const row2 of snapshot.inventoryItems) {
    if (!object15(row2) || !uuid14(row2.id) || byId.has(row2.id)) throw Error("Invalid upload target inventory");
    byId.set(row2.id, row2);
  }
  const concernKeys = /* @__PURE__ */ new Map();
  const concernKey = (value3) => {
    let key2 = concernKeys.get(value3);
    if (key2 === void 0) {
      key2 = placementIdentityConcernKey(value3);
      concernKeys.set(value3, key2);
    }
    return key2;
  };
  const changes = /* @__PURE__ */ new Map(), authorities = [], customerIds = /* @__PURE__ */ new Map();
  for (const r of receipt2.records) {
    const key2 = r.customer.trim().replace(/\s+/g, " ").toLowerCase();
    customerIds.set(key2, /* @__PURE__ */ new Set([...customerIds.get(key2) || [], r.customerId]));
  }
  const records2 = receipt2.records.map((r) => {
    const observedAt2 = r.scopedAuthority?.receivedAt || receipt2.receivedAt, cutoff = stamp4(observedAt2), evidenceSha256 = r.scopedAuthority?.evidenceSha256 || receipt2.sourceSha256;
    const b = r.binding;
    let state = !b && r.possibleAliasUnitIds?.length ? "held" : "unlinked", reason = r.holdReason || "no_reviewed_inventory_binding", applied = false;
    const unitIds = [];
    if (b) {
      const expected = [{ id: b.trackerId, label: b.trackerLabel }, { id: b.nativeUnitId, label: b.nativeLabel }].filter((t) => t.id);
      const targets = expected.filter((t) => byId.has(t.id));
      const represented = Array.isArray(b.representedUnitIds) ? b.representedUnitIds : expected.map((t) => t.id);
      const membershipMatches = represented.length > 0 && new Set(represented).size === represented.length && represented.every((id15) => expected.some((t) => t.id === id15)) && represented.length === targets.length && targets.every((t) => represented.includes(t.id));
      if (!b.guardCurrent) {
        state = "held";
        reason = "identity_guard_changed";
      } else if (!targets.length || !membershipMatches || targets.some((t) => byId.get(t.id).unitNumber !== t.label)) {
        state = "held";
        reason = "bound_inventory_unavailable_or_renamed";
      } else {
        state = "linked";
        reason = null;
        unitIds.push(...targets.map((t) => t.id));
        const groupRows = targets.map((t) => byId.get(t.id));
        const groupBlock = groupRows.map((row2) => blockingReason(row2, b, audits, identity4, cutoff, groupRows, concernKey)).find(Boolean);
        if (groupBlock) {
          reason = groupBlock;
          if (groupBlock === "identity_conflict") state = "held";
        }
        for (const target of groupBlock ? [] : targets) {
          const row2 = byId.get(target.id), preserved = retainedLocation(row2, r, b, options.validatedLocationProofs?.get(row2.id), customerIds);
          const evidence = { source, ...r.scopedAuthority ? { evidenceKind: "derived_mapping", scopedRevisionId: r.scopedAuthority.revisionId } : {}, productId: r.productId, sourceSha256: evidenceSha256, observedAt: observedAt2, timestampKind: live ? "api_snapshot_received" : r.scopedAuthority ? "scoped_source_received" : "upload_received", timestampPrecision: r.scopedAuthority ? "second" : receipt2.receivedAtPrecision, state: "recorded", fresh: false, reason: live ? "saved_complete_api_snapshot" : "owner_supplied_export_not_live_api" };
          changes.set(row2.id, {
            ...row2,
            ...preserved ? preserved.locationFields : historicalOnly(row2),
            placement: r.placement,
            currentLocationType: r.placement.toLowerCase(),
            placementSource: "mhelpdesk_upload",
            customer: r.customer,
            site: r.placement === "SHOP" ? "SHOP" : preserved?.site || null,
            address: preserved?.address || null,
            addressSource: preserved ? preserved.locationFields.addressSource || row2.addressSource : "Uploaded customer address is source-only; verify installation",
            uploadLifecycle: r.lifecycle,
            uploadActiveInventoryEligible: r.lifecycle === "UNFLAGGED",
            uploadProductId: r.productId,
            uploadSourceAddress: r.sourceAddress,
            ...r.displayUnitNumber ? { uploadDisplayUnitNumber: r.displayUnitNumber } : {},
            placementEvidence: preserved?.ownerPlacementFields ? preserved.ownerPlacementFields.placementEvidence || { source: "owner", state: "recorded", observedAt: preserved.ownerPlacementFields.placementUpdatedAt || row2.placementUpdatedAt || null, fresh: false } : evidence,
            uploadPlacementEvidence: evidence,
            mhelpPlacementReview: null,
            mhelpLocationReview: !preserved,
            ...preserved?.ownerPlacementFields || {}
          });
          if (!preserved?.ownerPlacementFields) authorities.push({ unitId: row2.id, unitNumber: row2.unitNumber, productId: r.productId, placement: r.placement, sourceSha256: evidenceSha256, observedAt: observedAt2, source });
          applied = true;
        }
      }
    }
    return {
      recordId: "mhelp_product:" + r.productId,
      productId: r.productId,
      unitNumber: r.displayUnitNumber || r.unitNumber,
      sourceUnitNumber: r.unitNumber,
      observedAt: observedAt2,
      category: r.category,
      placement: r.placement,
      uploadLifecycle: r.lifecycle,
      ...r.inventoryOnlyReason ? { inventoryOnlyReason: r.inventoryOnlyReason } : {},
      customer: r.customer,
      sourceAddress: r.sourceAddress,
      binding: { state, unitIds, candidateUnitIds: [.../* @__PURE__ */ new Set([...r.possibleAliasUnitIds || [], ...state === "held" && b ? [b.trackerId, b.nativeUnitId].filter(Boolean) : []])], placementHeld: r.placementHeld === true || reason === "newer_or_undated_source_assignment", matchMethod: b?.matchMethod || null, reason },
      overlayApplied: applied
    };
  });
  if (live) for (const removed of receipt2.apiMissingRecords) {
    if (!object15(removed) || !id5(removed.productId) || receipt2.records.some((r) => r.productId === removed.productId)) throw Error("Invalid absent Product-ID receipt");
    const b = removed.binding;
    if (!b || b.guardCurrent !== true) continue;
    const targets = [{ id: b.nativeUnitId, label: b.nativeLabel }, { id: b.trackerId, label: b.trackerLabel }].filter((t) => t.id);
    const rows4 = targets.map((t) => byId.get(t.id));
    if (rows4.some((r, i) => !r || r.unitNumber !== targets[i].label) || rows4.some((r) => blockingReason(r, b, audits, identity4, stamp4(receipt2.receivedAt), rows4, concernKey))) continue;
    for (const row2 of rows4) if (!changes.has(row2.id)) changes.set(row2.id, { ...row2, uploadLifecycle: "MISSING", uploadActiveInventoryEligible: false, mhelpInventoryReview: "Not returned by the complete mHelpDesk inventory. Saved equipment and history are retained." });
  }
  const inventoryItems = snapshot.inventoryItems.map((r) => changes.get(r.id) || r), priorField = new Set(snapshot.items.map((r) => r.id));
  const items = inventoryItems.filter((r) => changes.has(r.id) ? r.placement === "FIELD" && r.uploadActiveInventoryEligible !== false : priorField.has(r.id));
  const count6 = (fn) => records2.filter(fn).length;
  const uploadInventory = {
    contract: "COS_MHELP_UPLOAD_INVENTORY_V1",
    source,
    sourceSha256: receipt2.sourceSha256,
    receivedAt: receipt2.receivedAt,
    receivedAtPrecision: receipt2.receivedAtPrecision,
    ...live ? { lastApiReadAt: receipt2.apiSync?.lastSuccessAt || receipt2.receivedAt, missingProductIds: receipt2.apiMissingRecords.map((r) => r.productId) } : {},
    exportAsOf: null,
    trackerRecords: receipt2.trackerRecords || [],
    trackerSource: receipt2.trackerSource || null,
    countBasis: "mhelp_product_records_not_unique_physical_units",
    physicalDeduplication: "incomplete",
    summary: { totalRecords: records2.length, fieldRecords: count6((r) => r.placement === "FIELD"), shopRecords: count6((r) => r.placement === "SHOP"), unflaggedFieldRecords: count6((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED"), unflaggedShopRecords: count6((r) => r.placement === "SHOP" && r.uploadLifecycle === "UNFLAGGED"), doNotUseRecords: count6((r) => r.uploadLifecycle === "DO_NOT_USE"), missingRecords: count6((r) => r.uploadLifecycle === "MISSING"), linkedRecords: count6((r) => r.binding.state === "linked"), unlinkedRecords: count6((r) => r.binding.state === "unlinked"), heldRecords: count6((r) => r.binding.state === "held"), appliedRecords: count6((r) => r.overlayApplied) },
    records: records2
  };
  const apiSync = receipt2.apiSync;
  return { snapshot: { ...snapshot, inventoryItems, items, uploadInventory, ...apiSync?.enabled === true ? { mhelpPlacementSync: { ...snapshot.mhelpPlacementSync || {}, contract: "COS_MHELP_PLACEMENT_V1", inventoryEnabled: true, lastInventorySuccessAt: apiSync.lastSuccessAt || null, errorCode: apiSync.errorCode || snapshot.mhelpPlacementSync?.errorCode || null } } : {} }, authorities };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpShopAddressEvidence.ts
var fields2 = ["productId", "unitNumber", "category", "customerId", "customer", "placement", "lifecycle"];
var address = ["street", "city", "state", "zip"];
var hash3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function reviewedShopAddressEnrichment(previous, old, row2) {
  const proof = previous?.shopAddressBaseline;
  if (previous?.contract !== "COS_MHELP_API_V1" || previous.reviewed !== true || previous.complete !== true || previous.origin !== "mhelpdesk_api" || previous.portalId !== "224643" || !hash3(previous.sourceSha256) || !hash3(previous.payloadSha256) || previous.recordCount !== previous.records?.length || !Array.isArray(previous.apiMissingRecords) || old?.placement !== "SHOP" || row2.placement !== "SHOP" || fields2.some((k) => old[k] !== row2[k]) || !address.every((k) => old.sourceAddress?.[k] === "") || old.apiAssignment?.placementProof?.version !== 1 || old.apiAssignment.placementProof.serviceVerified !== false || old.apiAssignment.placementProof.siteLabel !== "" || old.addressReview != null || proof?.contract !== "COS_REVIEWED_SHOP_ADDRESS_BASELINE_V1" || proof.baseSourceSha256 !== previous.sourceSha256 || !hash3(proof.sourceSha256) || !hash3(proof.payloadSha256) || !Array.isArray(proof.records)) return false;
  const matches2 = proof.records.filter((r) => r.productId === row2.productId);
  if (matches2.length) return matches2.length === 1 && fields2.every((k) => matches2[0][k] === row2[k]) && address.every((k) => typeof row2.sourceAddress[k] === "string" && matches2[0].sourceAddress?.[k] === row2.sourceAddress[k]);
  const company = proof.records.filter((r) => r.placement === "SHOP" && r.customerId === row2.customerId && r.customer === row2.customer);
  return company.length > 0 && company.every((r) => address.every((k) => typeof row2.sourceAddress[k] === "string" && r.sourceAddress?.[k] === row2.sourceAddress[k]));
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts
var EQUIPMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
var ID2 = /^[1-9][0-9]{0,14}$/;
var SHA256 = /^[0-9a-f]{64}$/;
var REQUIRED = ["ProductId", "ProductModel", "CustomerId", "CustomerName", "Category", "Address", "City", "State", "Zip"];
function reject(message) {
  throw new Error(`Invalid mHelpDesk equipment CSV: ${message}`);
}
function value(v, max = 600) {
  if (typeof v !== "string" || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v)) reject("a cell has unsupported content");
  return v.trim();
}
function normalize(v) {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}
function equipmentCustomerPlacement(name) {
  const n = normalize(value(name, 250)).replace(/[.]/g, "");
  return /^(?:cameras\s+on\s*site)(?:\s+llc|\s*-\s*test\s+units)?$/.test(n) ? "SHOP" : "FIELD";
}
function parseEquipmentCsv(text19) {
  if (typeof text19 !== "string" || !text19) reject("the file is empty");
  const s = text19.charCodeAt(0) === 65279 ? text19.slice(1) : text19;
  const records2 = [];
  let row2 = [], field5 = "", quoted = false, closed = false, atStart = true;
  const addField = () => {
    if (field5.length > 8e3) reject("a cell is too long");
    row2.push(field5);
    field5 = "";
    closed = false;
    atStart = true;
    if (row2.length > 80) reject("too many columns");
  };
  const addRow = () => {
    addField();
    if (row2.length === 1 && !row2[0].trim()) {
      row2 = [];
      return;
    }
    records2.push(row2);
    row2 = [];
    if (records2.length > 10002) reject("too many records");
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field5 += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field5 += ch;
    } else if (ch === '"' && atStart && !closed) {
      quoted = true;
      atStart = false;
    } else if (ch === ",") {
      addField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      addRow();
    } else {
      if (ch === '"' || closed) reject("invalid CSV quoting");
      field5 += ch;
      atStart = false;
    }
  }
  if (quoted) reject("an unterminated quoted cell");
  if (field5.length || row2.length || closed) addRow();
  if (records2.length < 2) reject("header or equipment rows missing");
  const header = records2.shift().map((k) => value(k, 120));
  if (new Set(header).size !== header.length) reject("duplicate column headers");
  for (const k of REQUIRED) if (!header.includes(k)) reject(`missing column ${k}`);
  const col2 = (r, key2) => value(r[header.indexOf(key2)]);
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const r of records2) {
    if (r.length !== header.length) reject("inconsistent column count");
    const productId = col2(r, "ProductId"), unitNumber = col2(r, "ProductModel"), customerId = col2(r, "CustomerId"), customer = col2(r, "CustomerName");
    if (!ID2.test(productId) || !ID2.test(customerId) || !unitNumber || !customer || seen.has(productId)) reject("missing, repeated or invalid Product ID/customer/unit");
    seen.add(productId);
    const category = col2(r, "Category");
    if (!category) reject("equipment category missing");
    const lifecycle = /\bDO\s*NOT\s*USE\b/i.test(unitNumber) ? "DO_NOT_USE" : /\bMISSING\b/i.test(unitNumber) ? "MISSING" : "UNFLAGGED";
    output.push({
      productId,
      unitNumber,
      customerId,
      customer,
      category,
      placement: equipmentCustomerPlacement(customer),
      lifecycle,
      sourceRow: output.length + 2,
      sourceAddress: { street: col2(r, "Address"), city: col2(r, "City"), state: col2(r, "State"), zip: col2(r, "Zip") }
    });
  }
  if (output.length > 1e4) reject("too many equipment rows");
  return output;
}
function sameAddress(a, b) {
  return ["street", "city", "state", "zip"].every((k) => normalize(a[k]) === normalize(b[k]));
}
function validPrior(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) reject("reviewed previous upload missing");
  const prior = v;
  if (prior.contract !== "COS_MHELP_UPLOAD_V1" && prior.contract !== "COS_MHELP_API_V1" || prior.reviewed !== true || typeof prior.sourceSha256 !== "string" || !SHA256.test(prior.sourceSha256) || !Array.isArray(prior.records) || prior.records.length < 1 || prior.records.length > 1e4) reject("reviewed previous upload unavailable");
  if (prior.contract === "COS_MHELP_API_V1" && (prior.origin !== "mhelpdesk_api" || prior.portalId !== "224643" || prior.complete !== true || prior.recordCount !== prior.records.length || !Array.isArray(prior.apiMissingRecords) || typeof prior.payloadSha256 !== "string" || !SHA256.test(prior.payloadSha256))) reject("complete reviewed previous API source unavailable");
  const seen = /* @__PURE__ */ new Set();
  for (const row2 of prior.records) {
    if (!row2 || typeof row2 !== "object" || !ID2.test(row2.productId) || seen.has(row2.productId) || !["FIELD", "SHOP"].includes(row2.placement) || !row2.sourceAddress || typeof row2.sourceAddress !== "object") reject("previous source identities invalid");
    seen.add(row2.productId);
  }
  return prior;
}
function compareMhelpEquipmentRows(rows4, previous, sourceSha256) {
  if (!SHA256.test(sourceSha256)) reject("source checksum invalid");
  const old = validPrior(previous);
  const prior = new Map(old.records.map((r) => [r.productId, r]));
  const current = /* @__PURE__ */ new Map(), samples = [];
  const counts2 = { unchanged: 0, added: 0, absent: 0, placement: 0, customer: 0, address: 0, lifecycle: 0, details: 0, identityReview: 0 };
  for (const row2 of rows4) {
    if (current.has(row2.productId)) reject("duplicate Product ID");
    current.set(row2.productId, row2);
  }
  const addedRows = rows4.filter((r) => !prior.has(r.productId));
  const absentRows = old.records.filter((r) => !current.has(r.productId));
  const disappeared = /* @__PURE__ */ new Map();
  for (const r of absentRows) {
    const key2 = `${normalize(r.category)}|${normalize(r.unitNumber)}`;
    disappeared.set(key2, [...disappeared.get(key2) || [], r]);
  }
  const push = (kind6, r, prev, next, reason) => {
    if (samples.length < 40) samples.push({ kind: kind6, productId: r.productId, unitNumber: r.unitNumber, previousPlacement: prev, proposedPlacement: next, reason });
  };
  for (const row2 of rows4) {
    const earlier = prior.get(row2.productId);
    if (!earlier) {
      counts2.added++;
      const key2 = `${normalize(row2.category)}|${normalize(row2.unitNumber)}`;
      if (disappeared.has(key2)) {
        counts2.identityReview++;
        push("identity_review", row2, null, row2.placement, "Product ID changed for similarly labeled equipment; prohibit automatic identity merge");
      } else push("added", row2, null, row2.placement, "New mHelpDesk Product ID; identity binding requires review");
      continue;
    }
    let changed = false;
    if (earlier.placement !== row2.placement) {
      counts2.placement++;
      changed = true;
      push("placement", row2, earlier.placement, row2.placement, "Current authority/identity guards required");
    }
    if (earlier.customerId !== row2.customerId || normalize(earlier.customer) !== normalize(row2.customer)) {
      counts2.customer++;
      changed = true;
      push("customer", row2, earlier.placement, row2.placement, "Assignment changed; validate installation and owner history");
    }
    if (!sameAddress(earlier.sourceAddress, row2.sourceAddress)) {
      counts2.address++;
      changed = true;
      push("address", row2, earlier.placement, row2.placement, reviewedShopAddressEnrichment(previous, earlier, row2) ? "Reviewed Shop source-address enrichment; current association guards still required" : "Source address changed; not verified installation GPS");
    }
    if (earlier.lifecycle !== row2.lifecycle) {
      counts2.lifecycle++;
      changed = true;
      push("lifecycle", row2, earlier.placement, row2.placement, "Lifecycle change requires review");
    }
    if (normalize(earlier.unitNumber) !== normalize(row2.unitNumber) || normalize(earlier.category) !== normalize(row2.category)) {
      counts2.details++;
      changed = true;
      push("details", row2, earlier.placement, row2.placement, "Unit identity/category changed; hold association");
    }
    if (!changed) counts2.unchanged++;
  }
  for (const r of absentRows) {
    counts2.absent++;
    push("absent", r, r.placement, null, "Missing from latest complete source; preserve historical records and current protected assignments");
  }
  return {
    contract: "COS_MHELP_EQUIPMENT_CSV_PREVIEW_V1",
    previewOnly: true,
    readyToCommit: false,
    sourceSha256,
    priorSourceSha256: old.sourceSha256,
    inventory: { total: rows4.length, field: rows4.filter((r) => r.placement === "FIELD").length, shop: rows4.filter((r) => r.placement === "SHOP").length, inactive: rows4.filter((r) => r.lifecycle !== "UNFLAGGED").length },
    changes: counts2,
    samples,
    guardNotice: "Preview only. No inventory, placement, camera, GPS, IP or history was changed. A separately reviewed, Owner-authenticated current-guarded admission is mandatory."
  };
}
async function previewMhelpEquipmentCsv(body, prior) {
  if (!body || typeof body !== "object" || Array.isArray(body)) reject("invalid request");
  const data = body;
  if (Object.keys(data).some((k) => !["bytesBase64", "expectedSha256", "sourceFilename"].includes(k)) || typeof data.bytesBase64 !== "string" || data.bytesBase64.length > Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 4 || data.bytesBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.bytesBase64)) reject("invalid CSV bytes");
  if (data.sourceFilename !== void 0 && (typeof data.sourceFilename !== "string" || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(data.sourceFilename))) reject("invalid mHelp source filename");
  const decoded = atob(data.bytesBase64);
  if (decoded.length > EQUIPMENT_CSV_MAX_BYTES || decoded.length === 0 || btoa(decoded) !== data.bytesBase64) reject("non-canonical CSV bytes");
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  const sha10 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
  if (data.expectedSha256 !== void 0 && (typeof data.expectedSha256 !== "string" || !SHA256.test(data.expectedSha256) || data.expectedSha256 !== sha10)) reject("SHA-256 mismatch");
  let csv;
  try {
    csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    reject("file is not UTF-8 CSV");
  }
  const rows4 = parseEquipmentCsv(csv);
  return compareMhelpEquipmentRows(rows4, prior, sha10);
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpEquipmentAdmissionPlan.ts
var SHA = /^[a-f0-9]{64}$/;
var ID3 = /^[1-9][0-9]{0,14}$/;
var normalize2 = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
var sourceFields = ["street", "city", "state", "zip"];
function bad(message) {
  throw new Error("Equipment admission plan rejected: " + message);
}
function identicalAddress(a, b) {
  return sourceFields.every((k) => normalize2(a[k]) === normalize2(b[k]));
}
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function prepareMhelpEquipmentAdmission(rows4, previous, guards) {
  if (isRecord(previous) && previous.contract === "COS_MHELP_API_V1") validPrior(previous);
  if (!Array.isArray(rows4) || !rows4.length || rows4.length > 1e4 || !isRecord(previous) || previous.contract !== "COS_MHELP_UPLOAD_V1" && previous.contract !== "COS_MHELP_API_V1" || previous.reviewed !== true || !Array.isArray(previous.records) || previous.records.length > 1e4 || !SHA.test(guards.sourceSha256) || !SHA.test(guards.expectedActiveSourceSha256) || previous.sourceSha256 !== guards.expectedActiveSourceSha256) bad("complete source and current reviewed source guard required");
  const productIds = /* @__PURE__ */ new Set();
  for (const r of rows4) {
    if (!r || !ID3.test(r.productId) || productIds.has(r.productId) || !["FIELD", "SHOP"].includes(r.placement) || !["UNFLAGGED", "MISSING", "DO_NOT_USE"].includes(r.lifecycle) || !r.unitNumber || !r.customerId || !r.customer || !r.category || !r.sourceAddress) bad("invalid or duplicate source equipment");
    productIds.add(r.productId);
  }
  const oldRecords = previous.records, prior = /* @__PURE__ */ new Map(), missing = /* @__PURE__ */ new Map();
  for (const r of oldRecords) {
    if (!r || !ID3.test(r.productId) || prior.has(r.productId) || !["FIELD", "SHOP"].includes(r.placement) || !r.unitNumber || !r.category || !r.sourceAddress) bad("invalid previous authoritative source");
    prior.set(r.productId, r);
    if (!productIds.has(r.productId)) {
      const key2 = normalize2(r.category) + "|" + normalize2(r.unitNumber);
      missing.set(key2, [...missing.get(key2) || [], r]);
    }
  }
  const decisions2 = [], counts2 = { unchanged: 0, assignment_change: 0, lifecycle_change: 0, identity_change: 0, new_source_only: 0, product_id_collision: 0, absent_from_source: 0, held_existing_guard: 0 };
  const record5 = (row2, old, disposition, hold, reason) => {
    counts2[disposition]++;
    decisions2.push({ productId: row2.productId, unitNumber: row2.unitNumber, placement: row2 === old ? null : row2.placement, previousPlacement: old?.placement ?? null, disposition, hold, reason });
  };
  for (const row2 of rows4) {
    const p = prior.get(row2.productId);
    if (!p) {
      const candidate = missing.get(normalize2(row2.category) + "|" + normalize2(row2.unitNumber));
      if (candidate?.length) record5(row2, null, "product_id_collision", true, "A different Product ID had this label; no automatic equipment or camera identity merge");
      else record5(row2, null, "new_source_only", true, "New Product ID; needs reviewed source-only admission and association");
      continue;
    }
    const b = p.binding;
    if (p.placementHeld === true || b && (!isRecord(b) || b.guardCurrent !== true)) {
      record5(row2, p, "held_existing_guard", true, "Previous source association is held or its identity guard is stale");
      continue;
    }
    if (normalize2(p.category) !== normalize2(row2.category) || normalize2(p.unitNumber) !== normalize2(row2.unitNumber)) {
      record5(row2, p, "identity_change", true, "Unit/category identity changed; require exact Product ID evidence");
      continue;
    }
    if (p.lifecycle !== row2.lifecycle) {
      record5(row2, p, "lifecycle_change", true, "Lifecycle change requires source and owner review");
      continue;
    }
    if (p.placement !== row2.placement || p.customerId !== row2.customerId || normalize2(p.customer) !== normalize2(row2.customer) || !identicalAddress(p.sourceAddress, row2.sourceAddress) && !reviewedShopAddressEnrichment(previous, p, row2)) {
      record5(row2, p, "assignment_change", true, "Installation/customer movement: retain old GPS and owner records; verify current location and actor guards");
      continue;
    }
    record5(row2, p, "unchanged", false, "Same Product ID and source assignment; do not rewrite camera, IP or GPS");
  }
  for (const p of oldRecords) {
    if (!productIds.has(p.productId)) record5(p, p, "absent_from_source", true, "Remove from current source membership only; preserve historical equipment and audit");
  }
  const tracker = guards.tracker;
  let trackerVerified = false;
  if (tracker) {
    if (tracker.contract !== "COS_VERIFIED_2027_PRODUCT_CENSUS_V1" || !SHA.test(tracker.sourceSha256) || !Number.isFinite(Date.parse(tracker.observedAt)) || tracker.verifiedBy !== "cos_sheets_service" || !Array.isArray(tracker.productIds) || tracker.productIds.some((id15) => !ID3.test(id15))) bad("unverified 2027 tracker source");
    const set = new Set(tracker.productIds);
    trackerVerified = set.size === productIds.size && set.size === tracker.productIds.length && [...productIds].every((id15) => set.has(id15));
  }
  const holds = decisions2.filter((d) => d.hold);
  const blockers = [];
  if (!trackerVerified) blockers.push("CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED");
  if (guards.currentNativeGuardsVerified !== true) blockers.push("CURRENT_OWNER_NATIVE_GPS_GUARDS_NOT_VERIFIED");
  if (holds.length) blockers.push("HELD_IDENTITIES_REQUIRE_REVIEW");
  blockers.push("TRANSACTIONAL_OWNER_SOURCE_ADMISSION_NOT_INSTALLED");
  return {
    contract: "COS_MHELP_EQUIPMENT_ADMISSION_PLAN_V1",
    mode: "PREPARE_ONLY",
    sourceSha256: guards.sourceSha256,
    expectedActiveSourceSha256: guards.expectedActiveSourceSha256,
    inventory: { total: rows4.length, field: rows4.filter((r) => r.placement === "FIELD").length, shop: rows4.filter((r) => r.placement === "SHOP").length, inactive: rows4.filter((r) => r.lifecycle !== "UNFLAGGED").length },
    counts: counts2,
    changes: decisions2,
    holds,
    gates: { productIdsVerified: true, current2027CensusVerified: trackerVerified, currentNativeGuardsVerified: guards.currentNativeGuardsVerified === true, identityHoldsClear: holds.length === 0, canCommit: false },
    blockers,
    note: "Read-only planning only. Production commit needs an independently authenticated Owner and a fresh transactional source/identity/GPS guard recheck. No raw CSV, customer addresses, IPs or GPS are emitted."
  };
}
function summarizeMhelpAdmission(plan) {
  return {
    contract: plan.contract,
    mode: plan.mode,
    sourceSha256: plan.sourceSha256,
    inventory: plan.inventory,
    counts: plan.counts,
    gates: plan.gates,
    blockers: plan.blockers,
    heldSample: plan.holds.slice(0, 30).map(({ productId, unitNumber, disposition, reason }) => ({ productId, unitNumber, disposition, reason })),
    totalHeld: plan.holds.length,
    readyToCommit: false,
    note: plan.note
  };
}

// tech-checks/supabase/functions/cos-operations-pages/unitTracker.ts
var UNIT_TRACKER_CONTRACT = "COS_UNIT_TRACKER_OUTBOX_V1";
var UNIT_TRACKER_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
var UNIT_TRACKER_CONNECTOR = Object.freeze({ enabled: false, state: "awaiting_sheets_connection" });
var object16 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid15 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var fields3 = ["placement", "street", "city", "state", "zip", "siteLabel", "customerLabel"];
var limits = { street: 300, city: 120, state: 2, zip: 10, siteLabel: 250, customerLabel: 250 };
var unsafe2 = /[\x00-\x1f\x7f<>@=]|^[+\-]|https?:|password|passwd|passcode|lockbox|\bpwd\b|\bpin\b|token|secret|credential|\b(?:call|phone|mobile|email|contact|tel)\b|gate[\s-]*code|access[\s-]*code|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b/i;
var safeText = (v, max) => typeof v === "string" && v === v.trim() && v.length > 0 && v.length <= max && !unsafe2.test(v);
var UnitTrackerError = class extends Error {
  constructor(message, status2 = 400) {
    super(message);
    this.status = status2;
    this.name = "UnitTrackerError";
  }
  status;
};
function fail3(message, status2 = 400) {
  throw new UnitTrackerError(message, status2);
}
function exact2(v, keys3, required = keys3) {
  return object16(v) && Object.keys(v).every((k) => keys3.includes(k)) && required.every((k) => Object.hasOwn(v, k));
}
function checkedTrackerChanges(value2, full2 = false) {
  if (!exact2(value2, fields3, full2 ? fields3 : []) || !full2 && Object.keys(value2).length === 0) fail3("Choose at least one supported tracker field.");
  for (const [key2, v] of Object.entries(value2)) {
    if (key2 === "placement") {
      if (!["FIELD", "SHOP", "INACTIVE"].includes(v)) fail3("Choose a valid placement.");
      continue;
    }
    if (v === null) continue;
    if (!safeText(v, limits[key2]) || key2 === "state" && !/^[A-Z]{2}$/.test(v) || key2 === "zip" && !/^\d{5}(?:-\d{4})?$/.test(v)) fail3("Use plain non-secret tracker fields; formulas, links, IPs and credentials are not accepted.");
  }
  return { ...value2 };
}
function checkedTrackerProposal(value2, isNew = false) {
  const fields4 = checkedTrackerChanges(value2, true);
  if (fields4.placement === "FIELD" && (!fields4.street || !fields4.state || !fields4.city && !fields4.zip)) fail3("A field unit needs a street, state, and city or ZIP.");
  if (isNew && fields4.placement !== "FIELD" && ["street", "city", "state", "zip"].some((key2) => fields4[key2] !== null)) fail3("New Shop or Inactive units must not include a field installation address.");
  return fields4;
}
function checkedIdentity(v, source = false) {
  const keys3 = source ? ["unitId", "family", "fullVariant", "unitLabel", "sourceRecordId"] : ["family", "fullVariant", "unitLabel"];
  if (!exact2(v, keys3) || !safeText(v.family, 160) || !safeText(v.fullVariant, 160) || !/[A-Za-z]/.test(v.fullVariant) || !/^[A-Za-z][A-Za-z0-9 ._&/-]{0,159}$/.test(v.family) || !/^[A-Za-z][A-Za-z0-9 ._-]{0,159}$/.test(v.fullVariant) || !safeText(v.unitLabel, 40) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(v.unitLabel)) fail3("Choose the exact family, full variant and unit label.");
  if (source && !(v.unitId === null && v.sourceRecordId === null || uuid15(v.unitId) && typeof v.sourceRecordId === "string" && v.sourceRecordId.split(":").length === 4 && v.sourceRecordId.split(":")[0] === "google_sheet" && v.sourceRecordId.split(":")[1] === UNIT_TRACKER_WORKBOOK && /^(0|[1-9][0-9]{0,18})$/.test(v.sourceRecordId.split(":")[2]) && v.sourceRecordId.split(":")[3] === v.fullVariant + "|" + v.unitLabel)) fail3("The tracker source identity could not be verified.", 503);
  return { ...v };
}
function checkedTrackerRequest(body) {
  if (!object16(body) || !uuid15(body.requestId) || !["add", "update"].includes(body.kind)) fail3("A unique tracker request identifier and request type are required.");
  const changes = checkedTrackerChanges(body.changes);
  if (body.kind === "add") {
    if (!exact2(body, ["requestId", "kind", "identity", "changes"])) fail3("The add request contains unsupported fields.");
    const identity4 = checkedIdentity(body.identity);
    if (!Object.hasOwn(changes, "placement") || changes.placement === "FIELD" && (!changes.street || !changes.state || !changes.city && !changes.zip)) fail3("A new field unit needs a street, state, and city or ZIP.");
    return { requestId: body.requestId.toLowerCase(), kind: "add", identity: identity4, changes };
  }
  if (!exact2(body, ["requestId", "kind", "unitId", "expectedSourceRevision", "changes"]) || !uuid15(body.unitId) || !uuid15(body.expectedSourceRevision)) fail3("An exact source unit and current revision are required.");
  return { requestId: body.requestId.toLowerCase(), kind: "update", unitId: body.unitId.toLowerCase(), expectedSourceRevision: body.expectedSourceRevision.toLowerCase(), changes };
}
function connector(v) {
  if (!exact2(v, ["enabled", "state"]) || v.enabled !== false || v.state !== "awaiting_sheets_connection") fail3("The Sheets connector state is not safe.", 503);
  return { ...UNIT_TRACKER_CONNECTOR };
}
function checkedTrackerSource(v) {
  if (!object16(v) || !uuid15(v.unitId) || !uuid15(v.sourceRevision) || !(v.pendingRequestId === null || uuid15(v.pendingRequestId)) || !exact2(v.sourceIdentity, ["sourceSystem", "sourceRecordId"]) || v.sourceIdentity.sourceSystem !== "google_sheet_tracker") fail3("The tracker source is incomplete.", 503);
  const identity4 = checkedIdentity({ unitId: v.unitId, family: v.family, fullVariant: v.fullVariant, unitLabel: v.unitLabel, sourceRecordId: v.sourceIdentity.sourceRecordId }, true);
  return { unitId: identity4.unitId, sourceRevision: v.sourceRevision, sourceIdentity: { ...v.sourceIdentity }, family: identity4.family, fullVariant: identity4.fullVariant, unitLabel: identity4.unitLabel, fields: checkedTrackerChanges(v.fields, true), pendingRequestId: v.pendingRequestId };
}
function checkedReceipt(v) {
  if (!object16(v) || !uuid15(v.requestId) || !["add", "update"].includes(v.kind) || v.status !== "awaiting_sheets_connection" || typeof v.createdAt !== "string" || !Number.isFinite(Date.parse(v.createdAt)) || !(v.kind === "add" && v.expectedSourceRevision === null || v.kind === "update" && uuid15(v.expectedSourceRevision))) fail3("The persisted tracker request could not be verified.", 503);
  const identity4 = checkedIdentity(v.identity, true), changes = checkedTrackerChanges(v.changes), before = v.kind === "add" ? null : checkedTrackerChanges(v.before, true);
  if (v.kind === "add" && (identity4.unitId !== null || identity4.sourceRecordId !== null || v.before !== null) || v.kind === "update" && identity4.unitId === null) fail3("The persisted tracker binding could not be verified.", 503);
  const proposed = checkedTrackerProposal(v.proposed, v.kind === "add");
  for (const k of fields3) {
    if (proposed[k] !== (Object.hasOwn(changes, k) ? changes[k] : before?.[k] ?? null)) fail3("The persisted tracker changes do not match the receipt.", 503);
  }
  return { requestId: v.requestId, kind: v.kind, status: v.status, createdAt: v.createdAt, identity: identity4, expectedSourceRevision: v.expectedSourceRevision, changes, before, proposed };
}
function checkedTrackerSnapshot(v) {
  if (!object16(v) || v.contract !== UNIT_TRACKER_CONTRACT || v.workbookId !== UNIT_TRACKER_WORKBOOK || typeof v.queueEnabled !== "boolean" || !Array.isArray(v.sources) || v.sources.length > 2e3 || !Array.isArray(v.requests) || v.requests.length > 100 || typeof v.sourcesTruncated !== "boolean" || typeof v.requestsTruncated !== "boolean" || !Number.isInteger(v.sourcesHeld) || v.sourcesHeld < 0) fail3("The tracker queue is unavailable. No request has been saved.", 503);
  const sources = v.sources.map(checkedTrackerSource), requests = v.requests.map(checkedReceipt);
  if (new Set(sources.map((s) => s.unitId)).size !== sources.length || new Set(requests.map((r) => r.requestId)).size !== requests.length) fail3("The tracker snapshot contains conflicting identifiers.", 503);
  return {
    contract: UNIT_TRACKER_CONTRACT,
    workbookId: UNIT_TRACKER_WORKBOOK,
    connector: connector(v.connector),
    queueEnabled: v.queueEnabled,
    availability: "available",
    sources,
    requests,
    sourcesTruncated: v.sourcesTruncated,
    requestsTruncated: v.requestsTruncated,
    sourcesHeld: v.sourcesHeld
  };
}
function createUnitTracker(options) {
  return async (path, method, body) => {
    const requestRead = /^\/api\/unit-tracker\/requests\/([a-f0-9-]+)$/i.exec(path);
    if (method === "GET" && requestRead) {
      if (!uuid15(requestRead[1])) fail3("An exact tracker request identifier is required.");
      const value2 = await options.rpc("cos_unit_tracker_request_read", { ...options.actorPayload, p_request_id: requestRead[1] });
      if (!object16(value2) || typeof value2.ownedByCurrentActor !== "boolean") fail3("The exact request status is unavailable.", 503);
      const request = value2.request === null ? null : checkedReceipt(value2.request);
      if (request && request.requestId !== requestRead[1].toLowerCase() || !request && value2.ownedByCurrentActor !== false) fail3("The exact request status could not be verified.", 503);
      return { request, ownedByCurrentActor: value2.ownedByCurrentActor, connector: connector(value2.connector) };
    }
    const read = /^\/api\/unit-tracker\/([a-f0-9-]+)$/i.exec(path);
    if (method === "GET" && path === "/api/unit-tracker") {
      let result;
      try {
        result = await options.rpc("cos_unit_tracker_snapshot", options.actorPayload);
      } catch (error) {
        if ([401, 403].includes(error?.status)) throw error;
        return {
          contract: UNIT_TRACKER_CONTRACT,
          workbookId: UNIT_TRACKER_WORKBOOK,
          connector: { ...UNIT_TRACKER_CONNECTOR },
          queueEnabled: false,
          availability: "unavailable",
          reason: "Pending tracker requests are not enabled on this backend. Sheets connection required.",
          sources: [],
          requests: [],
          sourcesTruncated: false,
          requestsTruncated: false,
          sourcesHeld: 0
        };
      }
      return checkedTrackerSnapshot(result);
    }
    if (method === "GET" && read) {
      if (!uuid15(read[1])) fail3("A stable unit identifier is required.");
      const v = await options.rpc("cos_unit_tracker_read", { ...options.actorPayload, p_native_unit_id: read[1] });
      if (!object16(v) || v.contract !== UNIT_TRACKER_CONTRACT || v.workbookId !== UNIT_TRACKER_WORKBOOK || typeof v.queueEnabled !== "boolean") fail3("The current tracker record is unavailable.", 503);
      const source = checkedTrackerSource(v);
      if (source.unitId !== read[1].toLowerCase()) fail3("The tracker source changed. Reload before editing.", 409);
      const pendingRequest = v.pendingRequest === null ? null : checkedReceipt(v.pendingRequest);
      if (source.pendingRequestId !== (pendingRequest?.requestId ?? null) || pendingRequest && (pendingRequest.kind !== "update" || pendingRequest.identity.unitId !== source.unitId)) fail3("The selected pending request could not be verified. Reload before editing.", 503);
      return { ...source, contract: UNIT_TRACKER_CONTRACT, workbookId: UNIT_TRACKER_WORKBOOK, queueEnabled: v.queueEnabled, connector: connector(v.connector), pendingRequest };
    }
    if (method === "POST" && path === "/api/unit-tracker/requests") {
      const payload = checkedTrackerRequest(body);
      const result = await options.rpc("cos_unit_tracker_enqueue", { ...options.actorPayload, p_request: payload });
      if (!object16(result) || typeof result.created !== "boolean" || result.ownedByCurrentActor !== true) fail3("The save response was incomplete. Retry with the same request identifier.", 503);
      const request = checkedReceipt(result.request);
      if (request.requestId !== payload.requestId || request.kind !== payload.kind || Object.keys(request.changes).length !== Object.keys(payload.changes).length || Object.keys(payload.changes).some((k) => request.changes[k] !== payload.changes[k])) fail3("The saved request could not be matched. Retry with the same request identifier.", 503);
      if (payload.kind === "update" && (request.identity.unitId !== payload.unitId || request.expectedSourceRevision !== payload.expectedSourceRevision) || payload.kind === "add" && ["family", "fullVariant", "unitLabel"].some((k) => request.identity[k] !== payload.identity[k])) fail3("The saved request identity could not be matched.", 503);
      return { created: result.created, request, ownedByCurrentActor: true, connector: connector(result.connector) };
    }
    fail3("Unit Tracker endpoint not found.", 404);
  };
}

// tech-checks/supabase/functions/cos-operations-pages/googleSheets.ts
var SHEETS_CONNECTION_CONTRACT = "cos-google-sheets-connection-v1";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
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
var object17 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var SheetsConnectionError = class extends Error {
  constructor(message, status2 = 503) {
    super(message);
    this.status = status2;
    this.name = "SheetsConnectionError";
  }
  status;
};
var fail4 = (message, status2 = 503) => {
  throw new SheetsConnectionError(message, status2);
};
function account(raw) {
  if (raw === void 0 || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 32768) return fail4("The Google service-account secret needs correction in Supabase.");
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return fail4("The Google service-account secret must be the complete JSON key file.");
  }
  if (!object17(v) || v.type !== "service_account" || typeof v.client_email !== "string" || v.client_email.length > 254 || !/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(v.client_email) || v.token_uri !== TOKEN_URL || typeof v.private_key_id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(v.private_key_id) || typeof v.private_key !== "string" || v.private_key.length > 16384 || !/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(v.private_key))
    fail4("Use a Google service-account JSON key, not a password, API key, or mHelpDesk token.");
  return { client_email: v.client_email, private_key: v.private_key, private_key_id: v.private_key_id };
}
async function boundedJson(response, limit, signal) {
  if (signal.aborted) fail4("The Sheets connection check timed out. Retry the check.");
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    fail4("Google returned an oversized connection response.");
  }
  const reader = response.body?.getReader();
  if (!reader) return fail4("Google returned an incomplete connection response.");
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { value: value2, done } = await reader.read();
      if (signal.aborted) fail4("The Sheets connection check timed out. Retry the check.");
      if (done) break;
      size += value2.byteLength;
      if (size > limit) fail4("Google returned an oversized connection response.");
      chunks.push(value2);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    let v;
    try {
      v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail4("Google returned an unreadable connection response.");
    }
    if (!object17(v)) fail4("Google returned an incomplete connection response.");
    return v;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {
    });
  }
}
function cellText(v) {
  if (!object17(v)) return "";
  if (typeof v.formattedValue === "string") return v.formattedValue;
  return typeof v.effectiveValue?.stringValue === "string" ? v.effectiveValue.stringValue : "";
}
function projectWorkbook(v, expectedRows) {
  if (v.spreadsheetId !== UNIT_TRACKER_WORKBOOK || v.properties?.title !== "2027 UNIT TRACKER" || !Array.isArray(v.sheets)) fail4("Google returned a different tracker. No connection was verified.");
  const tabs = [];
  const seen = /* @__PURE__ */ new Set();
  let rows4 = 0, duplicates = 0, formulaRows = 0, placementReviewRows = 0;
  for (const expected of TRACKER_TABS) {
    const matches2 = v.sheets.filter((s) => s?.properties?.sheetId === expected.id);
    if (matches2.length !== 1) fail4("An expected 2027 equipment tab is missing or duplicated.");
    const sheet = matches2[0], p = sheet.properties;
    if (p.title !== expected.title || p.sheetType !== "GRID" || p.hidden === true || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount !== expectedRows.get(expected.id)) fail4("An equipment tab changed during the read. Retry its connection check.");
    const grids = sheet.data;
    if (!Array.isArray(grids) || grids.length !== 1) fail4("Google did not return the complete equipment identity range.");
    const grid = grids[0];
    if ((grid.startRow ?? 0) !== 0 || (grid.startColumn ?? 0) !== 0 || !Array.isArray(grid.rowData) || grid.rowData.length > p.gridProperties.rowCount) fail4("Google returned an unexpected equipment range.");
    const header = grid.rowData[0]?.values;
    if (!Array.isArray(header) || header.length !== expected.columns || expected.headers.some((h, i) => cellText(header[i]) !== h || header[i]?.userEnteredValue?.formulaValue)) fail4("The equipment identity or placement headers changed. Review the tracker.");
    let count6 = 0, tabFormulaRows = 0, tabPlacementReview = 0;
    for (const row2 of grid.rowData.slice(1)) {
      if (!object17(row2) || row2.values !== void 0 && !Array.isArray(row2.values)) fail4("Google returned malformed equipment cells.");
      const cells = row2.values ?? [];
      if (cells.length > expected.columns) fail4("Google returned cells outside the allowed identity range.");
      const label3 = cellText(cells[0]);
      if (!label3.trim()) continue;
      if (label3.length > 240 || /[\x00-\x1f\x7f]/.test(label3)) fail4("An equipment identity is invalid. Review the tracker.");
      count6++;
      if (seen.has(label3)) duplicates++;
      seen.add(label3);
      if (cells.some((c) => typeof c?.userEnteredValue?.formulaValue === "string")) tabFormulaRows++;
      if (expected.columns === 2 && !["FIELD", "SHOP", "INACTIVE"].includes(cellText(cells[1]))) tabPlacementReview++;
    }
    rows4 += count6;
    formulaRows += tabFormulaRows;
    placementReviewRows += tabPlacementReview;
    tabs.push({ tabId: expected.id, title: expected.title, equipmentRows: count6, formulaRows: tabFormulaRows, placementReviewRows: tabPlacementReview });
  }
  return { tabs, equipmentRows: rows4, duplicateLabelRows: duplicates, formulaRows, placementReviewRows };
}
function createSheetsConnection(options) {
  const requestFetch = options.fetch ?? fetch, now = options.now ?? Date.now;
  let cached = null;
  let busy = false;
  const state = (a) => ({
    contract: SHEETS_CONNECTION_CONTRACT,
    workbookId: UNIT_TRACKER_WORKBOOK,
    state: a ? "ready_to_test" : "setup_required",
    credentialConfigured: Boolean(a),
    serviceAccountEmail: a?.client_email ?? null,
    readAccessVerified: false,
    checkedAt: null,
    mode: "read_only",
    sheetsPublisher: false,
    automaticSync: false,
    equipmentRows: 0,
    duplicateLabelRows: 0,
    formulaRows: 0,
    placementReviewRows: 0,
    tabs: []
  });
  return async (path, method, body) => {
    if (!["/api/unit-tracker/sheets/status", "/api/unit-tracker/sheets/check"].includes(path)) fail4("Sheets endpoint not found.", 404);
    if (method !== (path.endsWith("/status") ? "GET" : "POST")) fail4("Method not supported.", 405);
    if (body !== null && body !== void 0 && (!object17(body) || Object.keys(body).length)) fail4("The Sheets connection check does not accept credentials, ranges, or workbook IDs.", 400);
    if (busy) fail4("A Sheets check is already running. Wait for it to finish.", 409);
    let raw;
    try {
      raw = options.getServiceAccountJson();
    } catch {
      fail4("The Google credential configuration is unavailable.");
    }
    const a = account(raw), status2 = state(a);
    if (method === "GET" || !a) return status2;
    busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e4);
    try {
      const config = String(raw);
      let token = cached?.config === config && cached.until > now() + 6e4 ? cached.token : null;
      if (!token) {
        const issuedAt = Math.floor(now() / 1e3);
        let assertion;
        try {
          if (!options.signAssertion) return fail4("The Google signing service is unavailable.");
          assertion = await options.signAssertion(
            a.private_key,
            { alg: "RS256", typ: "JWT", kid: a.private_key_id },
            { iss: a.client_email, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600, scope: SCOPE }
          );
          if (typeof assertion !== "string" || assertion.length > 16384 || !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion)) fail4("Invalid Google assertion.");
        } catch {
          return fail4("The Google private key could not be used. Check the protected JSON secret.");
        }
        let response;
        try {
          response = await requestFetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(), signal: controller.signal, redirect: "error", cache: "no-store" });
        } catch {
          return fail4("Google authorization is unavailable. Retry the connection check.");
        }
        if (!response.ok) {
          await response.body?.cancel();
          cached = null;
          fail4(response.status === 429 ? "Google limited authorization requests. Wait and retry." : "Google rejected the service-account authorization. Check its JSON key and account.", response.status === 429 ? 429 : 503);
        }
        const data = await boundedJson(response, 32768, controller.signal);
        if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 16384 || /\s/.test(data.access_token) || data.token_type !== "Bearer" || !Number.isSafeInteger(data.expires_in) || data.expires_in < 60 || data.expires_in > 3600) fail4("Google returned incomplete authorization.");
        token = data.access_token;
        cached = { config, token, until: now() + data.expires_in * 1e3 };
      }
      const base2 = "https://sheets.googleapis.com/v4/spreadsheets/" + UNIT_TRACKER_WORKBOOK;
      const read = async (url) => {
        let response;
        try {
          response = await requestFetch(url, { method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: controller.signal, redirect: "error", cache: "no-store" });
        } catch {
          return fail4("The Google Sheets read failed. Retry the connection check.");
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) cached = null;
          fail4(response.status === 403 || response.status === 404 ? "Enable the Google Sheets API and share the 2027 tracker with the service-account email shown here." : response.status === 429 ? "Google limited Sheets requests. Wait and retry." : "The Google Sheets connection could not be verified.", response.status === 429 ? 429 : 503);
        }
        return boundedJson(response, 2 * 1024 * 1024, controller.signal);
      };
      const metadata2 = await read(base2 + "?fields=" + encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))"));
      if (metadata2.spreadsheetId !== UNIT_TRACKER_WORKBOOK || metadata2.properties?.title !== "2027 UNIT TRACKER" || !Array.isArray(metadata2.sheets)) fail4("The current 2027 workbook could not be verified.");
      const query = new URLSearchParams(), expectedRows = /* @__PURE__ */ new Map();
      query.set("fields", "spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount)),data(startRow,startColumn,rowData(values(formattedValue,effectiveValue,userEnteredValue))))");
      for (const expected of TRACKER_TABS) {
        const matches2 = metadata2.sheets.filter((s) => s?.properties?.sheetId === expected.id), p = matches2[0]?.properties;
        if (matches2.length !== 1 || p.title !== expected.title || p.sheetType !== "GRID" || p.hidden === true || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount < 2 || p.gridProperties.rowCount > 1e4 || p.gridProperties.columnCount < expected.columns) fail4("The equipment tab layout changed. Review the connection before continuing.");
        query.append("ranges", "'" + expected.title.replaceAll("'", "''") + "'!A1:" + (expected.columns === 1 ? "A" : "B") + p.gridProperties.rowCount);
        expectedRows.set(expected.id, p.gridProperties.rowCount);
      }
      const projection = projectWorkbook(await read(base2 + "?" + query), expectedRows);
      return { ...status2, ...projection, state: "read_access_verified", readAccessVerified: true, checkedAt: new Date(now()).toISOString() };
    } finally {
      clearTimeout(timer);
      controller.abort();
      busy = false;
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelp2027ProductCensus.ts
var ID4 = /^[1-9][0-9]{0,14}$/;
var HASH2 = /^[a-f0-9]{64}$/;
var OVERVIEW = { id: 1132540236, title: "UNIT OVERVIEW" };
var INDEX = { id: 1900169011, title: "MHELP MATCH INDEX" };
var TOKEN_URL2 = "https://oauth2.googleapis.com/token";
var SCOPE2 = "https://www.googleapis.com/auth/spreadsheets.readonly";
var object18 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var normalized3 = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
var SAFE_CENSUS_REASONS = {
  "mHelp source lookup is incomplete or stale": "The tracker source-export evidence is incomplete or cites a different export. Reconcile the current source explicitly; preserve historical evidence.",
  "current placement or customer assignment disagrees with mHelp": "Current tracker placement or customer assignment differs from the uploaded mHelp source.",
  "mHelp source and indexed identity/customer disagree": "The indexed mHelp unit identity or customer differs from the uploaded source.",
  "2027 workbook does not match the uploaded mHelp Product IDs": "The complete tracker Product ID census differs from the uploaded source.",
  "the 2027 family-qualified unit identity is inconsistent with the index": "The tracker family-qualified unit identity differs from its index.",
  "Google Viewer configuration is invalid": "The protected Google Viewer configuration is unavailable.",
  "the protected Google Viewer connection is unavailable": "The protected Google Viewer connection is unavailable."
};
var CensusVerificationError = class extends Error {
};
function safeCensusFailureReason(error) {
  if (error instanceof CensusVerificationError) {
    const detail = error.message.slice("Current 2027 workbook verification failed: ".length);
    return SAFE_CENSUS_REASONS[detail] ?? "The protected current 2027 workbook verification failed. No equipment writes are permitted.";
  }
  return "The protected current 2027 workbook verification is unavailable. No equipment writes are permitted.";
}
function fail5(msg) {
  throw new CensusVerificationError("Current 2027 workbook verification failed: " + msg);
}
function exactIds(cells, name) {
  const ids = [];
  for (const value2 of cells) {
    if (typeof value2 !== "string" || !ID4.test(value2)) fail5(name + " contains invalid Product ID");
    ids.push(value2);
  }
  if (new Set(ids).size !== ids.length) fail5(name + " contains duplicate Product IDs");
  return ids;
}
function rows(v, range) {
  const spec = (x) => {
    const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/.exec(x);
    return m ? { sheet: m[1] || m[2], a: m[3], from: Number(m[4]), b: m[5], to: Number(m[6]) } : null;
  };
  if (!object18(v)) fail5("an expected range was unavailable");
  const response = v, expected = spec(range), got = typeof response.range === "string" ? spec(response.range) : null;
  if (!expected || !got || got.sheet !== expected.sheet || got.a !== expected.a || got.b !== expected.b || got.from !== expected.from || got.to > expected.to || got.to < got.from || response.majorDimension !== "ROWS" || !Array.isArray(response.values)) fail5("an expected range was unavailable");
  return response.values.map((r) => {
    if (!Array.isArray(r) || r.some((x) => x !== null && (typeof x !== "string" || x.length > 600))) fail5("an equipment row is invalid");
    return r.map((x) => x === null ? "" : x);
  });
}
async function verify2027CensusRanges(valueRanges, rangeNames, candidate, sourceFilename, at) {
  if (!Array.isArray(valueRanges) || valueRanges.length !== 6 || rangeNames.length !== 6 || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(sourceFilename) || !Number.isFinite(Date.parse(at))) fail5("source evidence is incomplete");
  const [info, productColumn, placements, indexProducts, indexNames, indexExports] = valueRanges.map((r, i) => rows(r, rangeNames[i]));
  if (info[0]?.[0] !== "EQUIPMENT TYPE" || info[0]?.[1] !== "UNIT #" || info[0]?.[2] !== "PLACEMENT" || info[0]?.[4] !== "CUSTOMER" || productColumn[0]?.[0] !== "MHELP EQUIPMENT ID" || placements[0]?.[0] !== "TRACKER PLACEMENT" || placements[0]?.[1] !== "MHELP PLACEMENT" || indexProducts[0]?.[0] !== "TRACKER MATCH KEY" || indexProducts[0]?.[1] !== "MHELP EQUIPMENT ID" || indexNames[0]?.[0] !== "MHELP EQUIPMENT NAME" || indexNames[0]?.[1] !== "MHELP CUSTOMER / SITE" || indexExports[0]?.[0] !== "MHELP SOURCE EXPORT") fail5("equipment identity and placement headers differ from 2027 authority");
  const size = Math.max(info.length, productColumn.length, placements.length);
  const list = [], ids = [], placed = [];
  for (let i = 1; i < size; i++) {
    const a = info[i] || [], b = productColumn[i] || [], c = placements[i] || [];
    if (![...a, ...b, ...c].some((v) => v.trim())) continue;
    if (!a[0] || !a[1] || !a[2] || !a[4] || !b[0] || !c[0]) fail5("the 2027 overview has a missing or shifted source row");
    list.push(a);
    ids.push(b);
    placed.push(c);
  }
  const indexedSize = Math.max(indexProducts.length, indexNames.length, indexExports.length);
  const indexIds = [], details = [], exportRows = [];
  for (let i = 1; i < indexedSize; i++) {
    const a = indexProducts[i] || [], b = indexNames[i] || [], c = indexExports[i] || [];
    if (![...a, ...b, ...c].some((v) => v.trim())) continue;
    if (!a[0] || !a[1] || !b[0] || !b[1] || !c[0]) fail5("the mHelp index has a missing or shifted source row");
    indexIds.push(a);
    details.push(b);
    exportRows.push(c);
  }
  if (!list.length || list.length > 1e4 || ids.length !== list.length || placed.length !== list.length || indexIds.length !== list.length || details.length !== list.length || candidate.length !== list.length) fail5("equipment rows are incomplete or the current source has changed");
  const overviewProducts = exactIds(ids.map((r) => r[0]), "2027 overview");
  const lookupProducts = exactIds(indexIds.map((r) => r[1]), "mHelp index");
  const set = new Set(overviewProducts);
  if (lookupProducts.some((x) => !set.has(x))) fail5("the mHelp index is inconsistent with the current overview");
  const candidates = /* @__PURE__ */ new Map();
  for (const r of candidate) {
    if (!ID4.test(r.productId) || candidates.has(r.productId)) fail5("source Product IDs are invalid");
    candidates.set(r.productId, r);
  }
  if (candidates.size !== overviewProducts.length || overviewProducts.some((id15) => !candidates.has(id15))) fail5("2027 workbook does not match the uploaded mHelp Product IDs");
  let field5 = 0, shop = 0;
  const canonical2 = [], productRows = [];
  for (let i = 0; i < list.length; i++) {
    const [family, label3, placement3, , customer] = list[i];
    const [trackerPlacement, mhelpPlacement] = placed[i];
    const product4 = overviewProducts[i], source = candidates.get(product4);
    const protectedTracker = ["DECOMMISSIONED", "RETIRED", "MISSING", "DO_NOT_USE"].includes(trackerPlacement) && source.lifecycle !== "UNFLAGGED";
    if (!family || !label3 || !customer || !["FIELD", "SHOP"].includes(placement3) || trackerPlacement !== placement3 && !protectedTracker || Boolean(mhelpPlacement) && mhelpPlacement !== placement3 || placement3 !== source.placement || normalized3(customer) !== normalized3(source.customer) || equipmentCustomerPlacement(customer) !== placement3) fail5("current placement or customer assignment disagrees with mHelp");
    if (placement3 === "FIELD") field5++;
    else shop++;
    productRows.push({ productId: product4, family, unitLabel: label3, placement: placement3, customer });
    canonical2.push(product4 + "|" + family + "|" + label3 + "|" + placement3 + "|" + normalized3(customer) + "|" + trackerPlacement + "|" + (mhelpPlacement || ""));
  }
  const detailsById = /* @__PURE__ */ new Map();
  for (let i = 0; i < indexIds.length; i++) {
    const pid = lookupProducts[i], model = details[i][0], customer = details[i][1], exportName = exportRows[i][0];
    if (exportName !== sourceFilename || detailsById.has(pid)) fail5("mHelp source lookup is incomplete or stale");
    detailsById.set(pid, { key: indexIds[i][0], model, customer });
  }
  for (const [pid, item] of detailsById) {
    const source = candidates.get(pid);
    if (normalized3(source.customer) !== normalized3(item.customer) || normalized3(source.unitNumber) !== normalized3(item.model)) fail5("mHelp source and indexed identity/customer disagree");
  }
  for (let i = 0; i < list.length; i++) {
    const x = detailsById.get(overviewProducts[i]);
    if (!x || x.key !== list[i][0] + "|" + list[i][1]) fail5("the 2027 family-qualified unit identity is inconsistent with the index");
  }
  const data = canonical2.sort().join("\n") + "\n" + sourceFilename;
  const bytes = new TextEncoder().encode(data);
  const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (!HASH2.test(sourceSha256)) fail5("source checksum was unavailable");
  return { contract: "COS_VERIFIED_2027_PRODUCT_CENSUS_V1", sourceSha256, observedAt: at, verifiedBy: "cos_sheets_service", productIds: overviewProducts, total: list.length, field: field5, shop, sourceExport: sourceFilename, productRows };
}
async function read2027CensusFromGoogle(options) {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  let account2;
  try {
    account2 = account(options.getServiceAccountJson());
  } catch {
    fail5("Google Viewer configuration is invalid");
  }
  const signAssertion = options.signAssertion;
  if (!account2 || !signAssertion) return fail5("the protected Google Viewer connection is unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2e4);
  try {
    const issuedAt = Math.floor(now() / 1e3);
    let assertion;
    try {
      assertion = await signAssertion(account2.private_key, { alg: "RS256", typ: "JWT", kid: account2.private_key_id }, { iss: account2.client_email, aud: TOKEN_URL2, iat: issuedAt, exp: issuedAt + 3600, scope: SCOPE2 });
    } catch {
      fail5("Google Viewer authorization is unavailable");
    }
    if (typeof assertion !== "string" || assertion.length > 16384 || !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion)) fail5("Google Viewer assertion was invalid");
    const auth = await requestFetch(TOKEN_URL2, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(), signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!auth.ok) fail5("Google Viewer could not authenticate");
    const token = await boundedJson(auth, 32768, controller.signal);
    if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 16384 || /\s/.test(token.access_token) || token.token_type !== "Bearer") fail5("Google Viewer did not supply usable authorization");
    const base2 = "https://sheets.googleapis.com/v4/spreadsheets/" + UNIT_TRACKER_WORKBOOK;
    const read = async (uri, limit = 14e5) => {
      const result = await requestFetch(uri, { method: "GET", headers: { Authorization: "Bearer " + token.access_token, Accept: "application/json" }, signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!result.ok) fail5("current 2027 workbook could not be read");
      return boundedJson(result, limit, controller.signal);
    };
    const metadata2 = await read(base2 + "?fields=" + encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))"), 25e4);
    if (metadata2.spreadsheetId !== UNIT_TRACKER_WORKBOOK || metadata2.properties?.title !== "2027 UNIT TRACKER" || !Array.isArray(metadata2.sheets)) fail5("unexpected workbook");
    const sheetRows = /* @__PURE__ */ new Map();
    for (const s of [OVERVIEW, INDEX]) {
      const matches2 = metadata2.sheets.filter((v) => v?.properties?.sheetId === s.id);
      const p = matches2[0]?.properties;
      if (matches2.length !== 1 || p.title !== s.title || p.hidden === true || p.sheetType !== "GRID" || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount < 1002 || p.gridProperties.rowCount > 12e3 || p.gridProperties.columnCount < (s === INDEX ? 9 : 18)) fail5("the authoritative equipment tabs changed");
      sheetRows.set(s.title, p.gridProperties.rowCount);
    }
    const n = sheetRows.get(OVERVIEW.title), m = sheetRows.get(INDEX.title);
    const names = [`'UNIT OVERVIEW'!A1:E${n}`, `'UNIT OVERVIEW'!O1:O${n}`, `'UNIT OVERVIEW'!Q1:R${n}`, `'MHELP MATCH INDEX'!A1:B${m}`, `'MHELP MATCH INDEX'!D1:E${m}`, `'MHELP MATCH INDEX'!H1:H${m}`];
    const params = new URLSearchParams();
    for (const range of names) params.append("ranges", range);
    params.set("valueRenderOption", "FORMATTED_VALUE");
    const fetched = await read(base2 + "/values:batchGet?" + params.toString());
    return verify2027CensusRanges(fetched.valueRanges, names, options.candidate, options.sourceFilename, new Date(now()).toISOString());
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Current 2027 workbook verification failed:")) throw e;
    return fail5("current 2027 workbook verification is unavailable");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpEquipmentOwnerReview.ts
async function ownerEquipmentCsvReview(args) {
  const preview = await previewMhelpEquipmentCsv(args.body, args.previous);
  const request = args.body;
  const bytes = Uint8Array.from(atob(request.bytesBase64), (x) => x.charCodeAt(0));
  const rows4 = parseEquipmentCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const filename = request.sourceFilename;
  let census, censusFailureReason;
  if (filename) {
    try {
      census = await (args.verifyCensus ?? read2027CensusFromGoogle)({
        ...args.google,
        sourceFilename: filename,
        candidate: rows4
      });
    } catch (error) {
      censusFailureReason = safeCensusFailureReason(error);
    }
  }
  const previous = args.previous;
  const plan = prepareMhelpEquipmentAdmission(rows4, args.previous, {
    sourceSha256: preview.sourceSha256,
    expectedActiveSourceSha256: previous.sourceSha256,
    ...census ? { tracker: census } : {},
    currentNativeGuardsVerified: false
  });
  return {
    ...preview,
    admission: summarizeMhelpAdmission(plan),
    censusStatus: census ? "verified" : "unavailable",
    ...!census && censusFailureReason ? { censusFailureReason } : {}
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpEquipmentWriteBridge.ts
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HASH3 = /^[0-9a-f]{64}$/;
function invalid(message) {
  throw new Error("Protected COS equipment admission: " + message);
}
function input(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("source file is required");
  const b = body;
  if (Object.keys(b).some((key2) => !["bytesBase64", "sourceFilename", "expectedSha256"].includes(key2))) invalid("unexpected source request field");
  if (b.expectedSha256 !== void 0 && (typeof b.expectedSha256 !== "string" || !HASH3.test(b.expectedSha256))) invalid("invalid expected original SHA-256");
  if (typeof b.bytesBase64 !== "string" || typeof b.sourceFilename !== "string" || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(b.sourceFilename)) invalid("original mHelp CSV required");
  return {
    bytesBase64: b.bytesBase64,
    sourceFilename: b.sourceFilename,
    ...typeof b.expectedSha256 === "string" ? { expectedSha256: b.expectedSha256 } : {}
  };
}
async function currentSource(o) {
  if (!UUID.test(o.actorId) || !UUID.test(o.organizationId)) invalid("authenticated actor required");
  const source = input(o.body), preview = await previewMhelpEquipmentCsv(source, o.previous);
  const bytes = Uint8Array.from(atob(source.bytesBase64), (v) => v.charCodeAt(0));
  const rows4 = parseEquipmentCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  let census;
  try {
    census = await (o.verifyCensus || read2027CensusFromGoogle)({ ...o.google, sourceFilename: source.sourceFilename, candidate: rows4 });
  } catch (error) {
    invalid("CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED: " + safeCensusFailureReason(error));
  }
  if (!census || census.verifiedBy !== "cos_sheets_service" || !HASH3.test(census.sourceSha256) || census.total !== rows4.length || census.productRows?.length !== rows4.length || census.field !== preview.inventory.field || census.shop !== preview.inventory.shop) invalid("current 2027 Product ID membership failed");
  const previous = o.previous;
  if (!previous || typeof previous.sourceSha256 !== "string" || !HASH3.test(previous.sourceSha256)) invalid("last reviewed source guard unavailable");
  return { source, preview, rows: rows4, census, expected: previous.sourceSha256 };
}
function stageReceipt(value2, source, expectedCount) {
  const v = value2;
  if (!v || typeof v !== "object" || v.contract !== "COS_OWNER_EQUIPMENT_STAGE_V1" || v.sourceSha256 !== source || v.productIdsMatched !== expectedCount || v.previewOnly !== true || v.readyToCommit !== false || !UUID.test(String(v.stageId || ""))) invalid("transactional stage receipt not accepted");
  return {
    contract: v.contract,
    stageId: v.stageId,
    sourceSha256: v.sourceSha256,
    productIdsMatched: v.productIdsMatched,
    recordedField: v.recordedField,
    recordedShop: v.recordedShop,
    expiresInMinutes: v.expiresInMinutes,
    previewOnly: true,
    readyToCommit: false
  };
}
async function stageOwnerEquipmentCsv(o) {
  if (!UUID.test(o.requestId)) invalid("stable unique staging request required");
  const { source, preview, rows: rows4, census, expected } = await currentSource(o);
  const result = await o.rpc("cos_owner_mhelp_equipment_stage_v1", {
    p_actor_user_id: o.actorId,
    p_organization_id: o.organizationId,
    p_request_id: o.requestId,
    p_filename: source.sourceFilename,
    p_source_sha256: preview.sourceSha256,
    p_expected_active_sha256: expected,
    p_current_2027_sha256: census.sourceSha256,
    p_current_2027_rows: census.productRows,
    p_original_bytes_base64: source.bytesBase64,
    p_records: rows4
  });
  const receipt2 = stageReceipt(result, preview.sourceSha256, rows4.length);
  if (receipt2.recordedField !== rows4.filter((r) => r.placement === "FIELD").length || receipt2.recordedShop !== rows4.filter((r) => r.placement === "SHOP").length) invalid("stage Field/Shop count disagrees with complete source");
  return receipt2;
}
async function commitOwnerEquipmentCsv(o) {
  if (!UUID.test(o.stageId) || typeof o.confirmationText !== "string" || o.confirmationText.trim().length < 24 || o.confirmationText.length > 800) invalid("explicit Owner stage approval required");
  const { preview, census, expected, rows: rows4 } = await currentSource(o);
  const result = await o.rpc("cos_owner_mhelp_equipment_commit_v1", {
    p_actor_user_id: o.actorId,
    p_organization_id: o.organizationId,
    p_stage_id: o.stageId,
    p_expected_previous_source_sha256: expected,
    p_current_2027_sha256: census.sourceSha256,
    p_confirmation_text: o.confirmationText
  });
  const v = result;
  if (!v || v.contract !== "COS_OWNER_EQUIPMENT_COMMIT_V1" || v.sourceSha256 !== preview.sourceSha256 || v.applied !== true || v.sourceReceiptsApplied !== true || v.records !== rows4.length || v.recordedField !== census.field || v.recordedShop !== census.shop) invalid("COS production did not return a complete verified commit receipt");
  return {
    contract: v.contract,
    stageId: o.stageId,
    sourceSha256: v.sourceSha256,
    records: v.records,
    field: v.recordedField,
    shop: v.recordedShop,
    applied: true,
    sourceReceiptsApplied: true
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts
var ID5 = /^[1-9][0-9]{0,14}$/;
var UUID2 = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
var HASH4 = /^[a-f0-9]{64}$/;
var invalid2 = () => {
  throw Error("Protected COS equipment admission: current explicit assignment review required");
};
var object19 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : invalid2();
var text11 = (v, max = 4e3) => typeof v === "string" && v.length <= max ? v : invalid2();
var nullableText = (v) => v === null ? null : text11(v);
var bool = (v) => typeof v === "boolean" ? v : invalid2();
var id6 = (v) => typeof v === "string" && ID5.test(v) ? v : invalid2();
var uuid16 = (v) => v === null ? null : typeof v === "string" && UUID2.test(v) ? v : invalid2();
var placement = (v) => v === "FIELD" || v === "SHOP" ? v : invalid2();
function observedAt(v) {
  if (typeof v !== "string" || v.length > 64) return invalid2();
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-]([0-9]{2})(?::([0-9]{2}))?)$/.exec(v);
  if (!match || match[0] !== v) return invalid2();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, zoneHour, zoneMinute] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59 || zone !== "Z" && (Number(zoneHour) > 15 || Number(zoneMinute || 0) > 59) || !Number.isFinite(Date.parse(v))) invalid2();
  return v;
}
function assignment(v) {
  const a = object19(v), address3 = object19(a.address);
  return { placement: placement(a.placement), customer: text11(a.customer), customerId: id6(a.customerId), address: { street: text11(address3.street), city: text11(address3.city), state: text11(address3.state), zip: text11(address3.zip) } };
}
function reference(v, productId) {
  const r = object19(v);
  if (r.productId !== productId) invalid2();
  return { productId, customerId: id6(r.customerId), placement: placement(r.placement), serviceLocationId: r.serviceLocationId === null ? null : text11(r.serviceLocationId, 250), observedAt: observedAt(r.observedAt) };
}
function reviewItem(value2) {
  const r = object19(value2), productId = id6(r.productId), before = assignment(r.before), after = assignment(r.after), identity4 = object19(r.identity), current = object19(r.current);
  const nativeUnitId = uuid16(identity4.nativeUnitId), trackerId = uuid16(identity4.trackerId);
  if (!nativeUnitId && !trackerId) invalid2();
  const out = {
    productId,
    unitNumber: text11(r.unitNumber, 250),
    before,
    after,
    identity: { nativeUnitId, nativeLabel: nullableText(identity4.nativeLabel), trackerId, trackerLabel: nullableText(identity4.trackerLabel) },
    current: { nativePlacement: nullableText(current.nativePlacement), nativeStatus: nullableText(current.nativeStatus), internalTrackerPlacement: nullableText(current.internalTrackerPlacement), internalTrackerCustomer: nullableText(current.internalTrackerCustomer), internalTrackerSite: nullableText(current.internalTrackerSite), gpsPresent: bool(current.gpsPresent), shopReceiptId: uuid16(current.shopReceiptId), shopRecordedAt: current.shopRecordedAt === null ? null : observedAt(current.shopRecordedAt) },
    guardChanged: bool(r.guardChanged),
    eligible: bool(r.eligible),
    blocker: nullableText(r.blocker),
    sourceAssignmentChanged: r.sourceAssignmentChanged === void 0 ? before.placement !== after.placement || before.customerId !== after.customerId || before.customer !== after.customer : bool(r.sourceAssignmentChanged)
  };
  if (!out.unitNumber || nativeUnitId && !out.identity.nativeLabel || trackerId && !out.identity.trackerLabel || !out.eligible && !out.blocker) invalid2();
  if (r.continuity === null) out.continuity = null;
  else if (r.continuity !== void 0) {
    const c = object19(r.continuity), previousAssignment = reference(c.previousAssignment, productId), currentAssignment = reference(c.currentAssignment, productId);
    const kind6 = c.kind === "timestamp_only" || c.kind === "assignment_difference" ? c.kind : invalid2();
    const same4 = previousAssignment.customerId === currentAssignment.customerId && previousAssignment.placement === currentAssignment.placement && previousAssignment.serviceLocationId === currentAssignment.serviceLocationId;
    if (kind6 === "timestamp_only" && (!same4 || previousAssignment.observedAt === currentAssignment.observedAt) || kind6 === "assignment_difference" && same4) invalid2();
    out.continuity = { kind: kind6, previousAssignment, currentAssignment };
  }
  return out;
}
async function reviewOwnerEquipmentAssignments(o) {
  if (!UUID2.test(o.stageId) || !["read", "approve"].includes(o.action)) invalid2();
  if (o.action === "approve" && (!HASH4.test(o.reviewDigest || "") || typeof o.confirmationText !== "string" || o.confirmationText.trim().length < 24 || o.confirmationText.length > 800)) invalid2();
  const { preview, census, rows: rows4 } = await currentSource(o);
  const result = object19(await o.rpc("cos_owner_mhelp_assignment_review_v1", { p_actor_user_id: o.actorId, p_organization_id: o.organizationId, p_stage_id: o.stageId, p_source_sha256: preview.sourceSha256, p_current_2027_sha256: census.sourceSha256, p_action: o.action, p_expected_digest: o.reviewDigest ?? null, p_confirmation: o.confirmationText ?? null }));
  if (result.contract !== "COS_OWNER_ASSIGNMENT_REVIEW_V1" || result.stageId !== o.stageId || result.sourceSha256 !== preview.sourceSha256 || result.censusSha256 !== census.sourceSha256 || typeof result.reviewDigest !== "string" || !HASH4.test(result.reviewDigest) || !Array.isArray(result.items) || result.items.length > rows4.length || typeof result.approved !== "boolean" || o.action === "approve" && !result.approved) invalid2();
  const items = result.items.map(reviewItem), seen = /* @__PURE__ */ new Set(), sourceIds = new Set(rows4.map((r) => r.productId));
  for (const item of items) {
    if (seen.has(item.productId) || !sourceIds.has(item.productId)) invalid2();
    seen.add(item.productId);
  }
  return { contract: "COS_OWNER_ASSIGNMENT_REVIEW_V1", stageId: o.stageId, sourceSha256: preview.sourceSha256, censusSha256: census.sourceSha256, reviewDigest: result.reviewDigest, approved: result.approved, items };
}

// tech-checks/supabase/functions/cos-operations-pages/combinedFleetRoster.ts
var object20 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var uuid17 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
var hash4 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var time = (v) => typeof v === "string" && /(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(v) ? Date.parse(v.replace(/([+-]\d\d)$/, "$1:00")) : NaN;
var placement2 = (v) => ["FIELD", "SITE"].includes(String(v).toUpperCase()) ? "field" : ["SHOP", "ROOT", "YARD", "WAREHOUSE"].includes(String(v).toUpperCase()) ? "shop" : "unknown";
var life = (v) => ({ UNFLAGGED: "active", ACTIVE: "active", DO_NOT_USE: "do_not_use", MISSING: "missing", RETIRED: "retired", DECOMMISSIONED: "decommissioned" })[String(v).toUpperCase()] || "active";
var newerPrimary = (row2, cutoff) => ["mhelpdesk", "mhelpdesk_upload"].includes(row2.placementSource) && placement2(row2.placement || row2.currentLocationType) !== "unknown" && row2.placementEvidence?.state !== "review" && Math.max(time(row2.mhelpObservedAt) || 0, time(row2.placementEvidence?.observedAt) || 0) > cutoff;
var confirmedAssignment = (row2) => {
  const c = row2.mhelpConfirmedAssignment;
  return c?.contract === "COS_MHELP_CONFIRMED_ASSIGNMENT_V1" && c.unitId === row2.id && c.unitNumber === row2.unitNumber && ["FIELD", "SHOP"].includes(c.placement) && Number.isFinite(time(c.observedAt)) && time(c.observedAt) <= Date.now() ? c : null;
};
var currentSourceMarker = (row2, cutoff) => {
  const c = confirmedAssignment(row2);
  return c && time(c.observedAt) >= cutoff ? c : null;
};
function unseenSourceConflict(row2, cutoff, audits, identity4) {
  const c = currentSourceMarker(row2, cutoff);
  if (!c) return false;
  const observed2 = time(c.observedAt);
  if (placement2(c.placement) === placement2(row2.placement || row2.currentLocationType) && c.assignmentChanged === false) return false;
  if (row2.placementSource === "owner" && (!Number.isFinite(time(row2.placementUpdatedAt)) || time(row2.placementUpdatedAt) > observed2) || protectedHistory(row2, audits, observed2 + 1, identity4)) return false;
  if (["mhelpdesk", "mhelpdesk_upload"].includes(row2.placementSource) && Math.max(time(row2.mhelpObservedAt) || 0, time(row2.placementEvidence?.observedAt) || 0) >= observed2) return false;
  if (time(row2.uploadPlacementEvidence?.observedAt) > observed2 || row2.hasUnitGps === true && Math.max(time(row2.gpsRecordedAt) || 0, time(row2.locationVerifiedAt) || 0) > observed2) return false;
  return true;
}
var rowLife = (r) => life(r.uploadLifecycle || r.inventoryLifecycle || (r.activeInventoryEligible === false ? "RETIRED" : "ACTIVE"));
function withoutPoint(row2) {
  return { ...row2, historicalLatitude: row2.latitude ?? row2.historicalLatitude ?? null, historicalLongitude: row2.longitude ?? row2.historicalLongitude ?? null, historicalCoordinateSource: row2.coordinateSource ?? row2.historicalCoordinateSource ?? null, latitude: null, longitude: null, coordinateSource: null, hasUnitGps: false, importedInstallation: null, locationImportedGeocode: null, locationSourceRecorded: null, addressEstimateTrackerId: null, addressEstimateUnitNumber: null, locationVerification: "coordinates_unverified", locationVerifiedAt: null, locationHistoryId: null };
}
function checkedTracker(upload) {
  const s = upload.trackerSource, records2 = upload.trackerRecords;
  if (s == null && (!Array.isArray(records2) || records2.length === 0)) return null;
  if (!object20(s) || s.contract !== "COS_CURRENT_TRACKER_CENSUS_V1" || s.complete !== true || !hash4(s.sourceSha256) || !Number.isFinite(time(s.observedAt)) || !Array.isArray(records2) || s.totalSourceRecords !== records2.length || records2.length > 1e4) throw Error("Incomplete current tracker census");
  const seen = /* @__PURE__ */ new Set(), claimed = /* @__PURE__ */ new Map();
  for (const r of records2) {
    if (!object20(r) || typeof r.recordId !== "string" || !r.recordId || seen.has(r.recordId) || typeof r.unitNumber !== "string" || !r.unitNumber || !["FIELD", "SHOP", "UNKNOWN"].includes(r.placement) || !["ACTIVE", "UNFLAGGED", "UNKNOWN", "DECOMMISSIONED", "RETIRED", "MISSING", "DO_NOT_USE"].includes(r.lifecycle) || !(r.matchedProductId === null || typeof r.matchedProductId === "string" && /^[1-9][0-9]*$/.test(r.matchedProductId))) throw Error("Invalid current tracker record");
    seen.add(r.recordId);
    const b = r.binding;
    if (!object20(b) || !["linked", "bound", "owner_confirmed_alias", "unlinked", "unbound", "held"].includes(b.state) || !Array.isArray(b.unitIds) || b.unitIds.some((id15) => !uuid17(id15)) || new Set(b.unitIds).size !== b.unitIds.length || !object20(b.unitLabels) || !(typeof b.guardCurrent === "boolean" || b.guardCurrent === null)) throw Error("Invalid tracker registry binding");
    for (const id15 of b.unitIds) {
      if (typeof b.unitLabels[id15] !== "string" || claimed.has(id15)) throw Error("Conflicting tracker registry bindings");
      claimed.set(id15, r.recordId);
    }
  }
  return { source: s, records: records2 };
}
function protectedHistory(row2, audits, cutoff, identity4) {
  const proofs = [...identity4?.unitIdentities || [], ...identity4?.ownerConfirmedUnitIdentities || []].filter((p) => p.unitId === row2.id);
  const keys3 = [row2.unitNumber, ...proofs.flatMap((p) => p.unitKeys || [])].map(placementIdentityConcernKey), devices = proofs.flatMap((p) => p.deviceIds || []);
  return audits.some((a) => (a.control_id === row2.id || keys3.includes(placementIdentityConcernKey(a.unit_key)) || Array.isArray(a.device_ids) && a.device_ids.some((v) => devices.includes(String(v)))) && (!Number.isFinite(time(a.created_at)) || time(a.created_at) >= cutoff));
}
function trackerTargets(r, byId) {
  const b = r.binding;
  if (!["linked", "bound", "owner_confirmed_alias"].includes(b.state) || b.guardCurrent !== true) return [];
  const ids = b.representedUnitIds || b.unitIds;
  if (!Array.isArray(ids) || ids.some((id15) => !b.unitIds.includes(id15)) || new Set(ids).size !== ids.length) throw Error("Invalid tracker represented inventory");
  const present = b.unitIds.filter((id15) => byId.has(id15));
  if (ids.length !== present.length || ids.some((id15) => !present.includes(id15)) || present.some((id15) => byId.get(id15).unitNumber !== b.unitLabels[id15])) return [];
  return present.map((id15) => byId.get(id15));
}
function projectCurrentTrackerPlacement(snapshot, audits, identity4, options = {}) {
  const upload = snapshot.uploadInventory;
  if (!upload) return snapshot;
  const tracker = checkedTracker(upload);
  if (!tracker) return snapshot;
  const byId = new Map(snapshot.inventoryItems.map((r) => [r.id, r])), changes = /* @__PURE__ */ new Map();
  for (const r of tracker.records) {
    if (r.matchedProductId !== null) continue;
    const targets = trackerTargets(r, byId);
    if (!targets.length || targets.some((row2) => row2.placementSource === "owner" || row2.placementReviewReason || row2.placementStatus === "needs_identity_review" || row2.representationStatus === "conflict" || row2.hasUnitGps === true || row2.installedSiteId || newerPrimary(row2, time(tracker.source.observedAt)) || currentSourceMarker(row2, time(tracker.source.observedAt)) || protectedHistory(row2, audits, 0, identity4))) continue;
    for (const row2 of targets) {
      const lifecycle = life(r.lifecycle), proof = exactLocationProof(options.validatedLocationProofs, row2);
      const normalize4 = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "";
      const sameAssignment = proof && r.placement === "FIELD" && normalize4(r.customer) && normalize4(r.customer) === normalize4(proof.customer) && normalize4(r.site) === normalize4(proof.site);
      changes.set(row2.id, { ...sameAssignment ? row2 : withoutPoint(row2), placement: r.placement, currentLocationType: r.placement.toLowerCase(), placementSource: "current_tracker", currentTrackerRecordId: r.recordId, inventoryLifecycle: r.lifecycle, activeInventoryEligible: lifecycle === "active", customer: r.customer || null, site: r.site || null, address: sameAssignment ? row2.address : null, placementEvidence: { source: "current_tracker", observedAt: tracker.source.observedAt, timestampKind: "tracker_read", state: "recorded", fresh: false, reason: "current_tracker_assignment_location_unverified" } });
    }
  }
  const inventoryItems = snapshot.inventoryItems.map((r) => changes.get(r.id) || r), prior = new Set(snapshot.items.map((r) => r.id));
  return { ...snapshot, inventoryItems, items: inventoryItems.filter((r) => changes.has(r.id) ? r.placement === "FIELD" && r.activeInventoryEligible !== false : prior.has(r.id)) };
}
function preferred(rows4) {
  if (!rows4.length) return null;
  const owners = rows4.filter((r) => r.placementSource === "owner");
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) {
    const ordered = owners.sort((a, b) => time(b.placementUpdatedAt) - time(a.placementUpdatedAt));
    if (Number.isFinite(time(ordered[0].placementUpdatedAt)) && time(ordered[0].placementUpdatedAt) > time(ordered[1].placementUpdatedAt)) return ordered[0];
    return null;
  }
  const native = rows4.filter((r) => r.readOnly !== true);
  if (native.length === 1) return native[0];
  return rows4.length === 1 ? rows4[0] : null;
}
function projectCombinedFleetRoster(snapshot, audits, identity4) {
  const upload = snapshot.uploadInventory;
  if (!upload) return snapshot;
  if (upload.contract !== "COS_MHELP_UPLOAD_INVENTORY_V1" || !Array.isArray(upload.records) || !Number.isFinite(time(upload.receivedAt))) throw Error("Invalid combined roster source");
  const mhelpSource = upload.source === "mhelpdesk_api" ? "mhelpdesk_api" : "owner_supplied_mhelp_export";
  const tracker = checkedTracker(upload), byId = /* @__PURE__ */ new Map();
  const trackerOnlyIds = new Set(tracker?.records.filter((r) => r.matchedProductId === null).flatMap((r) => r.binding.unitIds) || []);
  const rowCutoffs = /* @__PURE__ */ new Map();
  for (const r of upload.records) {
    if (r.observedAt !== void 0 && !Number.isFinite(time(r.observedAt))) throw Error("Invalid source record timestamp");
    for (const id15 of r.binding?.unitIds || []) rowCutoffs.set(id15, time(r.observedAt || upload.receivedAt));
  }
  const inventory = snapshot.inventoryItems.map((row2) => {
    const cutoff2 = tracker && trackerOnlyIds.has(row2.id) ? time(tracker.source.observedAt) : rowCutoffs.get(row2.id) ?? time(upload.receivedAt);
    if (!unseenSourceConflict(row2, cutoff2, audits, identity4)) return row2;
    const reason = "A newer confirmed primary-source assignment conflicts with protected saved placement; review the current assignment.";
    return { ...withoutPoint(row2), placement: "UNKNOWN", currentLocationType: "unknown", placementReviewReason: reason, effectivePlacement: { ...row2.effectivePlacement, state: "unknown", freshness: "review", reason } };
  });
  for (const row2 of inventory) {
    if (!uuid17(row2.id) || byId.has(row2.id) || !row2.effectivePlacement) throw Error("Invalid combined registry inventory");
    byId.set(row2.id, row2);
  }
  const used = /* @__PURE__ */ new Map(), records2 = [], products = /* @__PURE__ */ new Set();
  const currentMembership = new Set(tracker?.records.flatMap((r) => [...r.binding.unitIds, ...r.binding.candidateUnitIds || []]) || []);
  const cutoff = time(upload.receivedAt);
  const strongerCurrent = (row2, cutoff2 = time(upload.receivedAt)) => row2.placementSource === "owner" && (!Number.isFinite(time(row2.placementUpdatedAt)) || time(row2.placementUpdatedAt) >= cutoff2) || protectedHistory(row2, audits, cutoff2, identity4) || row2.hasUnitGps === true || Boolean(row2.installedSiteId) || newerPrimary(row2, cutoff2) || Boolean(currentSourceMarker(row2, cutoff2));
  const claim = (ids, recordId2) => {
    for (const id15 of ids) {
      if (used.has(id15) && used.get(id15) !== recordId2) throw Error("Conflicting combined source identities");
      used.set(id15, recordId2);
    }
  };
  const common2 = (r) => ({ unitNumber: r.unitNumber, category: r.category || null, customer: r.customer || null, sourceAddress: r.sourceAddress || null, reviewReason: null });
  const sourceItem = (r, source, observedAt2, lifecycle, p, ids = [], reason = null) => ({ ...common2(r), id: source === "current_tracker" && !r.recordId.startsWith("tracker_row:") ? "tracker_row:" + r.recordId.replace(/^tracker:/, "") : r.recordId, kind: p === "unknown" ? "identity_review" : "source_equipment", unitId: null, unit: null, placement: p, lifecycle, active: lifecycle === "active", source, observedAt: observedAt2, productIds: r.productId ? [r.productId] : [], sourceRecordIds: [r.recordId], representedUnitIds: ids, reviewReason: reason });
  const unitItem = (row2, r, source, observedAt2, lifecycle, ids) => ({ ...common2(r), id: "cos_unit:" + row2.id, kind: "unit", unitId: row2.id, unit: row2, unitNumber: row2.unitNumber, ...row2.uploadDisplayUnitNumber ? { displayUnitNumber: row2.uploadDisplayUnitNumber } : {}, placement: row2.effectivePlacement.state, lifecycle, active: lifecycle === "active" && row2.activeInventoryEligible !== false, source: row2.placementSource === "owner" ? "owner" : row2.placementSource === "mhelpdesk_upload" ? mhelpSource : row2.placementSource === "current_tracker" ? "current_tracker" : "recorded_inventory", observedAt: row2.effectivePlacement.observedAt || observedAt2, productIds: r.productId ? [r.productId] : [], sourceRecordIds: r.recordId ? [r.recordId] : [], representedUnitIds: ids, reviewReason: row2.effectivePlacement.reason || null });
  for (const r of upload.records) {
    if (!object20(r) || typeof r.productId !== "string" || products.has(r.productId) || r.recordId !== "mhelp_product:" + r.productId || !object20(r.binding) || !Array.isArray(r.binding.unitIds) || !Array.isArray(r.binding.candidateUnitIds)) throw Error("Invalid combined product record");
    products.add(r.productId);
    const supplemental = tracker?.records.filter((t) => t.matchedProductId === r.productId) || [];
    const trackerIds = supplemental.flatMap((t) => trackerTargets(t, byId).map((row2) => row2.id));
    const exactIds2 = new Set(r.binding.state === "linked" ? r.binding.unitIds : []);
    const proposed = [.../* @__PURE__ */ new Set([...r.binding.unitIds, ...r.binding.candidateUnitIds, ...trackerIds])].filter((id15) => byId.has(id15));
    const protectedCandidates = proposed.filter((id15) => !exactIds2.has(id15) && strongerCurrent(byId.get(id15), time(r.observedAt || upload.receivedAt)));
    const ids = proposed.filter((id15) => !protectedCandidates.includes(id15));
    claim(ids, r.recordId);
    const exactRows = r.binding.state === "linked" ? r.binding.unitIds.map((id15) => byId.get(id15)).filter(Boolean) : [];
    const chosen = preferred(exactRows), lifecycle = life(r.uploadLifecycle);
    const associationHeld = !chosen && exactRows.length > 0 || r.binding.placementHeld === true || r.binding.candidateUnitIds.length > 0 || r.binding.state === "held" && r.binding.unitIds.length > 0;
    if (chosen && !associationHeld && protectedCandidates.length === 0) {
      const chosenLife = r.overlayApplied ? lifecycle : rowLife(chosen);
      records2.push(unitItem(chosen, r, mhelpSource, r.observedAt || upload.receivedAt, chosenLife, ids));
    } else records2.push({ ...sourceItem(r, mhelpSource, r.observedAt || upload.receivedAt, lifecycle, associationHeld || protectedCandidates.length ? "unknown" : placement2(r.placement), ids, protectedCandidates.length ? "A possible registry association has newer primary-source, Owner or verified-location evidence; resolve identity before counting this source assignment." : associationHeld ? r.binding.reason || "Source identity needs review" : null), ...associationHeld || protectedCandidates.length ? { recordedSourcePlacement: placement2(r.placement), candidateUnitIds: proposed, candidatePlacements: proposed.map((id15) => ({ unitId: id15, unitNumber: byId.get(id15).unitNumber, placement: byId.get(id15).effectivePlacement.state, source: byId.get(id15).effectivePlacement.source, observedAt: byId.get(id15).effectivePlacement.observedAt })), identityAssociation: "unresolved" } : {} });
  }
  if (tracker) for (const r of tracker.records) {
    if (r.matchedProductId !== null) {
      if (!products.has(r.matchedProductId)) {
        if (mhelpSource === "mhelpdesk_api") continue;
        throw Error("Tracker refers to unavailable primary product");
      }
      continue;
    }
    const targets = trackerTargets(r, byId), ids = targets.map((row2) => row2.id);
    claim(ids, r.recordId);
    const chosen = preferred(targets), lifecycle = life(r.lifecycle);
    if (chosen) records2.push(unitItem(chosen, r, "current_tracker", tracker.source.observedAt, chosen.currentTrackerRecordId === r.recordId ? lifecycle : rowLife(chosen), ids));
    else records2.push(sourceItem(r, "current_tracker", tracker.source.observedAt, lifecycle, r.binding.placementHeld === true ? "unknown" : placement2(r.placement), ids, r.binding.placementHeld === true ? "Tracker identity needs review" : null));
  }
  for (const raw of inventory) {
    if (used.has(raw.id)) continue;
    let row2 = raw;
    const ownerCurrent = strongerCurrent(row2);
    if (tracker && !ownerCurrent) {
      const reason = currentMembership.has(row2.id) ? "Current tracker association needs identity revalidation" : "Saved inventory, missing from current sources";
      row2 = { ...withoutPoint(row2), placement: "UNKNOWN", currentLocationType: "unknown", effectivePlacement: { ...row2.effectivePlacement, state: "unknown", freshness: "review", reason }, placementReviewReason: reason };
    }
    records2.push(unitItem(row2, { unitNumber: row2.unitNumber, category: row2.category, customer: row2.customer }, row2.placementSource === "owner" ? "owner" : "recorded_inventory", row2.effectivePlacement.observedAt || null, rowLife(row2), [row2.id]));
  }
  const seen = /* @__PURE__ */ new Set();
  for (const r of records2) {
    if (seen.has(r.id)) throw Error("Duplicate combined roster record");
    seen.add(r.id);
  }
  const inventoryItems = records2.filter((r) => r.kind === "unit").map((r) => ({ ...r.unit, activeInventoryEligible: r.active }));
  for (const r of records2) if (r.kind === "unit") r.unit = inventoryItems.find((u) => u.id === r.unitId);
  const items = inventoryItems.filter((r) => r.effectivePlacement.state === "field" && r.activeInventoryEligible !== false), count6 = (fn) => records2.filter(fn).length;
  const summary = { totalRecords: records2.length, activeRecords: count6((r) => r.active), field: count6((r) => r.active && r.placement === "field"), shop: count6((r) => r.active && r.placement === "shop"), review: count6((r) => r.active && r.placement === "unknown"), excludedLifecycle: count6((r) => !r.active), sourceOnlyRecords: count6((r) => r.kind !== "unit"), linkedUnitRecords: count6((r) => r.kind === "unit") };
  return { ...snapshot, inventoryItems, items, fleetRoster: { contract: "COS_COMBINED_FLEET_ROSTER_V1", items: records2, summary, countBasis: "equipment_records_with_reviewed_cross_source_links", physicalDeduplication: "incomplete" }, placementSummary: { totalUnits: inventoryItems.length, fieldUnits: items.length, shopUnits: inventoryItems.filter((r) => r.activeInventoryEligible !== false && r.effectivePlacement.state === "shop").length, reviewUnits: inventoryItems.filter((r) => r.activeInventoryEligible !== false && r.effectivePlacement.state === "unknown").length, excludedLifecycleUnits: inventoryItems.filter((r) => r.activeInventoryEligible === false).length }, summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, unitGps: items.filter((r) => r.hasUnitGps === true).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length } };
}

// tech-checks/supabase/functions/cos-operations-pages/sourceEquipmentAddressEstimates.ts
var canonical = (v) => JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map((x) => JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(canonical(v[k]))])) : v);
var object21 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var hash5 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var uuid18 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
var product2 = (v) => typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v);
var safe4 = (v, max = 600) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
var empty = (v) => Array.isArray(v) && v.length === 0;
var addressKeys = ["street", "city", "state", "zip"];
function address2(v) {
  if (!object21(v) || Object.keys(v).length !== 4 || addressKeys.some((k) => typeof v[k] !== "string" || v[k].length > 600)) return null;
  return Object.fromEntries(addressKeys.map((k) => [k, v[k]]));
}
var sameAddress2 = (a, b) => address2(a) !== null && address2(b) !== null && JSON.stringify(address2(a)) === JSON.stringify(address2(b));
function installation(v) {
  const a = address2(v);
  if (!a) return null;
  const p = { street: a.street.trim().replace(/\s+/g, " "), city: a.city.trim().replace(/\s+/g, " "), state: a.state.trim().toUpperCase(), zip: a.zip.trim() };
  return p.city && p.zip && validInstallation(p) ? p : null;
}
async function digest(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value2))), (x) => x.toString(16).padStart(2, "0")).join("");
}
var normalize3 = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
function currentRecord(r) {
  return object21(r) && r.kind === "source_equipment" && ["owner_supplied_mhelp_export", "mhelpdesk_api"].includes(r.source) && r.placement === "field" && r.lifecycle === "active" && r.active === true && r.unitId === null && r.unit === null && empty(r.representedUnitIds) && (!r.candidateUnitIds || empty(r.candidateUnitIds)) && r.reviewReason === null && Array.isArray(r.productIds) && r.productIds.length === 1 && product2(r.productIds[0]) && r.id === "mhelp_product:" + r.productIds[0] && Array.isArray(r.sourceRecordIds) && r.sourceRecordIds.length === 1 && r.sourceRecordIds[0] === r.id && safe4(r.unitNumber, 250) && safe4(r.customer, 512) && installation(r.sourceAddress) !== null;
}
function receipt(v) {
  return object21(v) && hash5(v.sourceSha256) && hash5(v.payloadSha256);
}
function observed(value2, now) {
  if (typeof value2 !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value2) || !Number.isFinite(Date.parse(value2)) || Date.parse(value2) > now) return false;
  const m = /^(\d{4})-(\d\d)-(\d\d)T/.exec(value2);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3];
}
function validPoint(r, p, now) {
  if (r.status !== void 0 && r.status !== "success" || r.verified !== false || r.liveGps !== false || typeof r.latitude !== "number" || typeof r.longitude !== "number" || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude) || Math.abs(r.latitude) > 90 || Math.abs(r.longitude) > 180 || r.latitude === 0 && r.longitude === 0 || !safe4(r.matchedAddress) || !matchesInstallation(p, r.matchedAddress) || !observed(r.geocodedAt, now)) return false;
  if (r.provider === "us_census_address_range") return r.benchmark === "Public_AR_Current" && r.accuracyType === "range_interpolation";
  return r.provider === "geocodio" && ["rooftop", "range_interpolation"].includes(r.accuracyType) && typeof r.accuracy === "number" && Number.isFinite(r.accuracy) && r.accuracy >= 0.9 && r.accuracy <= 1 && [null, "building_centroid", "parcel_centroid"].includes(r.matchType ?? null) && (r.accuracyType !== "range_interpolation" || r.matchType == null);
}
async function sourceEquipmentAddressCandidates(snapshot, upload) {
  if (!object21(upload) || !["COS_MHELP_UPLOAD_V1", "COS_MHELP_API_V1"].includes(upload.contract) || upload.reviewed !== true || !receipt(upload) || !Array.isArray(upload.records) || !object21(snapshot.uploadInventory) || snapshot.uploadInventory.sourceSha256 !== upload.sourceSha256 || !Array.isArray(snapshot.fleetRoster?.items)) return [];
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of snapshot.fleetRoster.items) {
    if (!object21(r) || !currentRecord(r)) continue;
    if (seen.has(r.id)) return [];
    seen.add(r.id);
    const rows4 = upload.records.filter((u2) => u2.productId === r.productIds[0]);
    if (rows4.length !== 1) continue;
    const u = rows4[0];
    if (u.placement !== "FIELD" || u.lifecycle !== "UNFLAGGED" || u.binding !== null || u.placementHeld === true || u.unitNumber !== r.unitNumber || u.customer !== r.customer || !sameAddress2(u.sourceAddress, r.sourceAddress)) continue;
    const p = installation(r.sourceAddress), full2 = installationAddress(p);
    candidates.push({ record: r, uploadRecord: u, address: normalize3(full2), addressSha256: await digest(normalize3(full2)), installation: p });
  }
  return candidates;
}
async function projectSourceEquipmentAddressEstimates(snapshot, upload, cacheRows, activeHead, now = Date.now()) {
  if (!receipt(upload) || !receipt(activeHead) || upload.sourceSha256 !== activeHead.sourceSha256 || upload.payloadSha256 !== activeHead.payloadSha256 || !Array.isArray(cacheRows) || cacheRows.length > 1001) return snapshot;
  const candidates = await sourceEquipmentAddressCandidates(snapshot, upload);
  const items = [];
  for (const c of candidates) {
    const hits = cacheRows.filter((r) => object21(r) && r.productId === c.record.productIds[0] && r.sourceSha256 === upload.sourceSha256 && r.payloadSha256 === upload.payloadSha256 && hash5(r.uploadRecordSha256) && hash5(r.linkageGraphSha256) && uuid18(r.receiptId) && object21(r.uploadRecord) && canonical(r.uploadRecord) === canonical(c.uploadRecord) && r.address === c.address && r.addressSha256 === c.addressSha256);
    if (hits.length !== 1) continue;
    const geo = hits[0];
    if (geo.contract !== "COS_SAVED_ADDRESS_CACHE_V1" || geo.status !== "success" || !validPoint(geo, c.installation, now)) continue;
    items.push({ contract: "COS_SOURCE_EQUIPMENT_ADDRESS_ESTIMATE_V1", recordId: c.record.id, productId: c.record.productIds[0], unitNumber: c.record.unitNumber, customer: c.record.customer, sourceSha256: upload.sourceSha256, payloadSha256: upload.payloadSha256, sourceAddress: address2(c.record.sourceAddress), uploadRecordSha256: geo.uploadRecordSha256, receiptId: geo.receiptId, address: installationAddress(c.installation), addressSha256: c.addressSha256, latitude: geo.latitude, longitude: geo.longitude, matchedAddress: geo.matchedAddress, geocodedAt: geo.geocodedAt, provider: geo.provider, confidence: geo.provider === "geocodio" ? "automatic_address_estimate" : "address_range_interpolation", accuracyType: geo.accuracyType, accuracy: geo.accuracy ?? null, matchType: geo.matchType ?? null, benchmark: geo.benchmark ?? null, verified: false, liveGps: false });
  }
  return { ...snapshot, uploadInventory: { ...snapshot.uploadInventory, payloadSha256: upload.payloadSha256 }, sourceEquipmentEstimates: { contract: "COS_SOURCE_EQUIPMENT_ESTIMATES_V1", sourceSha256: upload.sourceSha256, payloadSha256: upload.payloadSha256, items } };
}

// tech-checks/supabase/functions/cos-operations-pages/tv-board-settings/index.ts
var TV_SECTIONS = [
  { key: "today", label: "Today\u2019s jobs" },
  { key: "pickup", label: "Pending pickups" },
  { key: "swap", label: "Pending swaps" },
  { key: "delivery", label: "Pending deliveries" },
  { key: "service", label: "Pending service calls" },
  { key: "shop", label: "Shop updates" },
  { key: "readiness", label: "Team readiness" },
  { key: "camera", label: "Camera Health" },
  { key: "map", label: "Field Map" }
];
function checkedTvSections(value2) {
  if (!Array.isArray(value2) || value2.length > TV_SECTIONS.length || value2.some((key2) => !TV_SECTIONS.some((section) => section.key === key2)) || new Set(value2).size !== value2.length) throw new Error("Choose valid TV board sections.");
  return TV_SECTIONS.map((section) => section.key).filter((key2) => value2.includes(key2));
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpIntakeReview.ts
var IntakeReviewError = class extends Error {
  constructor() {
    super("Saved intake status could not be verified");
  }
};
var row = (value2) => {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw new IntakeReviewError();
  return value2;
};
var exact3 = (value2, keys3) => {
  if (Object.keys(value2).length !== keys3.length || Object.keys(value2).some((key2) => !keys3.includes(key2))) throw new IntakeReviewError();
};
var utc = (value2) => {
  if (typeof value2 !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value2) || !Number.isFinite(Date.parse(value2)) || new Date(value2).toISOString() !== value2) throw new IntakeReviewError();
  return value2;
};
var REVIEW_CONTRACT = "cos-mhelp-intake-review-v1";
var reasonCodesAllowed = /* @__PURE__ */ new Set(["assignment_identity_unverified", "configuration_reviewer_inactive", "existing_ticket_requires_reconciliation", "source_changed_review_required", "source_identity_changed_review_required", "source_creation_in_future", "source_schema_unverified", "source_scope_or_route_invalid", "source_status_incomplete_or_deleted", "source_status_review_required", "source_status_reviewer_inactive", "source_status_terminal", "source_status_unreviewed", "ticket_lead_inactive_or_unverified", "ticket_lead_unverified", "ticket_lead_policy_conflict", "type_mapping_reviewer_inactive", "type_mapping_unverified"]);
var errorCodes = ["SOURCE_UNAVAILABLE", "SOURCE_INVALID", "BATCH_LIMIT", "WRITE_UNAVAILABLE", "RECEIPT_INVALID", "DEADLINE", "CONFIGURATION", "INTERNAL"];
function projectIntakeReview(value2) {
  const v = row(value2);
  exact3(v, ["contract", "enabled", "activationAt", "pendingReviewCount", "createdCount", "lastAttemptAt", "lastSuccessAt", "failureCount", "retryAfter", "lastErrorCode", "held", "heldTruncated"]);
  const bad2 = () => {
    throw new IntakeReviewError();
  };
  if (v.contract !== REVIEW_CONTRACT || typeof v.enabled !== "boolean" || typeof v.heldTruncated !== "boolean" || !Array.isArray(v.held) || v.held.length > 25) bad2();
  const count6 = (x, max = 1e8) => {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0 || x > max) bad2();
    return x;
  };
  const time3 = (x) => x === null ? null : utc(x);
  if (v.lastErrorCode !== null && (typeof v.lastErrorCode !== "string" || !errorCodes.includes(v.lastErrorCode))) bad2();
  const held = v.held.map((x) => {
    const item = row(x);
    exact3(item, ["ticketNumber", "reasonCodes"]);
    if (typeof item.ticketNumber !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/.test(item.ticketNumber) || !Array.isArray(item.reasonCodes) || item.reasonCodes.length > 40) bad2();
    const reasonCodes = item.reasonCodes.map((code) => {
      if (typeof code !== "string" || !reasonCodesAllowed.has(code)) bad2();
      return code;
    });
    return { ticketNumber: item.ticketNumber, reasonCodes };
  });
  const pendingReviewCount = count6(v.pendingReviewCount);
  if (held.length > pendingReviewCount || v.heldTruncated !== pendingReviewCount > held.length) bad2();
  return { contract: REVIEW_CONTRACT, enabled: v.enabled, activationAt: time3(v.activationAt), pendingReviewCount, createdCount: count6(v.createdCount), lastAttemptAt: time3(v.lastAttemptAt), lastSuccessAt: time3(v.lastSuccessAt), failureCount: count6(v.failureCount, 16), retryAfter: time3(v.retryAfter), lastErrorCode: v.lastErrorCode, held, heldTruncated: v.heldTruncated };
}
var PENDING_SCHEDULE_CAPABILITY = "pending_schedule_v1";
var PENDING_STATUS_CONTRACT = "cos-mhelp-pending-status-v1";
var EXTENDED_REVIEW_CONTRACT = "cos-mhelp-intake-status-pending-v1";
var pendingStates = ["created", "existing", "review_needed", "deferred"];
var pendingCodes = ["SOURCE_UNAVAILABLE", "SOURCE_INVALID", "DEADLINE", "CONFIGURATION", "INTERNAL"];
function projectPendingScheduleStatus(value2) {
  const v = row(value2);
  exact3(v, ["contract", "waitingCount", "dueCount", "oldestWaitingCreatedAt", "lastRefreshAt", "lastRefreshState", "lastRefreshCode"]);
  const bad2 = () => {
    throw new IntakeReviewError();
  };
  const count6 = (x) => {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0 || x > 1e8) bad2();
    return x;
  };
  const time3 = (x) => x === null ? null : utc(x);
  if (v.contract !== PENDING_STATUS_CONTRACT || v.lastRefreshState !== null && !pendingStates.includes(v.lastRefreshState) || v.lastRefreshCode !== null && !pendingCodes.includes(v.lastRefreshCode)) bad2();
  const waitingCount = count6(v.waitingCount), dueCount = count6(v.dueCount), oldestWaitingCreatedAt = time3(v.oldestWaitingCreatedAt);
  if (dueCount > waitingCount || waitingCount === 0 !== (oldestWaitingCreatedAt === null)) bad2();
  return { contract: PENDING_STATUS_CONTRACT, waitingCount, dueCount, oldestWaitingCreatedAt, lastRefreshAt: time3(v.lastRefreshAt), lastRefreshState: v.lastRefreshState, lastRefreshCode: v.lastRefreshCode };
}
function projectIntakeStatus(value2, capability) {
  if (capability !== void 0 && capability !== PENDING_SCHEDULE_CAPABILITY) throw new IntakeReviewError();
  const v = row(value2);
  if (capability === void 0 || v.contract === REVIEW_CONTRACT) return projectIntakeReview(v);
  exact3(v, ["contract", "review", "pendingSchedule"]);
  if (v.contract !== EXTENDED_REVIEW_CONTRACT) throw new IntakeReviewError();
  return { contract: EXTENDED_REVIEW_CONTRACT, review: projectIntakeReview(v.review), pendingSchedule: v.pendingSchedule === null ? null : projectPendingScheduleStatus(v.pendingSchedule) };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpIntakeReviewBridge.ts
var LEGACY = "https://goqrnolcvqnirjmzaeyk.supabase.co";
var PUBLISHABLE = "sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw";
var MhelpIntakeReviewError = class extends Error {
  status;
  constructor(status2 = 503) {
    super(status2 === 403 ? "Your Owner session could not be verified." : "The saved mHelp intake status could not be verified.");
    this.status = status2;
  }
};
function createMhelpIntakeReviewBridge(fetcher) {
  return async (authorization, requestSignal, capability) => {
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) throw new MhelpIntakeReviewError(403);
    if (capability !== void 0 && capability !== PENDING_SCHEDULE_CAPABILITY) throw new MhelpIntakeReviewError();
    const signal = AbortSignal.any([AbortSignal.timeout(12e3), ...requestSignal ? [requestSignal] : []]);
    const withinDeadline = (start) => new Promise((resolve2, reject2) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject2(new MhelpIntakeReviewError());
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      let pending;
      try {
        pending = start();
      } catch (error) {
        signal.removeEventListener("abort", abort);
        reject2(error);
        return;
      }
      pending.then(resolve2, reject2).finally(() => signal.removeEventListener("abort", abort));
    });
    const cancel = (stream) => {
      try {
        void stream?.cancel().catch(() => {
        });
      } catch {
      }
    };
    let response;
    try {
      response = await withinDeadline(async () => {
        const result = await fetcher(LEGACY + "/functions/v1/camera-mhelp-ticket-intake", { method: "POST", headers: { Authorization: authorization, apikey: PUBLISHABLE, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action: "review_status", ...capability ? { evidenceCapability: capability } : {} }), redirect: "error", cache: "no-store", signal });
        if (signal.aborted) {
          cancel(result.body);
          throw new MhelpIntakeReviewError();
        }
        return result;
      });
    } catch {
      throw new MhelpIntakeReviewError();
    }
    if (!response.ok) {
      cancel(response.body);
      throw new MhelpIntakeReviewError([401, 403].includes(response.status) ? 403 : 503);
    }
    if (!response.body || Number(response.headers.get("Content-Length")) > 65536) {
      cancel(response.body);
      throw new MhelpIntakeReviewError();
    }
    let reader;
    try {
      reader = response.body.getReader();
    } catch {
      throw new MhelpIntakeReviewError();
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, raw = "";
    try {
      while (true) {
        if (signal.aborted) throw Error();
        const { value: value2, done } = await withinDeadline(() => reader.read());
        if (done) break;
        size += value2.byteLength;
        if (size > 65536) throw Error();
        raw += decoder.decode(value2, { stream: true });
      }
      raw += decoder.decode();
      if (signal.aborted) throw Error();
      return projectIntakeStatus(JSON.parse(raw), capability);
    } catch {
      throw new MhelpIntakeReviewError();
    } finally {
      cancel(reader);
      try {
        reader.releaseLock();
      } catch {
      }
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpReliabilityStatus.ts
var object22 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var stamp5 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
function checkedMhelpReliabilityStatus(value2) {
  if (!object22(value2) || value2.contract !== "COS_MHELP_RELIABILITY_STATUS_V1" || !object22(value2.auth) || !object22(value2.inventory)) return null;
  const a = value2.auth, i = value2.inventory;
  if (!["verified", "reconnect_required", "not_yet_verified"].includes(a.state) || typeof i.paused !== "boolean" || typeof i.updating !== "boolean" || typeof i.failed !== "boolean") return null;
  return { contract: "COS_MHELP_RELIABILITY_STATUS_V1", auth: { state: a.state, verifiedAt: stamp5(a.verifiedAt), renewalCheckFailed: a.renewalCheckFailed === true, renewalFailedAt: stamp5(a.renewalFailedAt) }, inventory: {
    paused: i.paused,
    updating: i.updating,
    failed: i.failed,
    lastAttemptAt: stamp5(i.lastAttemptAt),
    lastSuccessAt: stamp5(i.lastSuccessAt),
    nextEligibleAt: stamp5(i.nextEligibleAt)
  } };
}
function attachMhelpReliabilityStatus(snapshot, receipt2) {
  const status2 = checkedMhelpReliabilityStatus(object22(receipt2) ? receipt2.reliability : null);
  if (!object22(snapshot.mhelpPlacementSync)) return snapshot;
  const { reliability: _prior, ...sync } = snapshot.mhelpPlacementSync;
  return { ...snapshot, mhelpPlacementSync: { ...sync, ...status2 ? { reliability: status2 } : {} } };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts
var object23 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var uuid19 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var safe5 = (v) => typeof v === "string" && v.length > 0 && v.length <= 250 && !/[\x00-\x1f\x7f<>]/.test(v);
var concern = (v) => typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
function checkedMhelpPlacements(value2, now = Date.now()) {
  if (!object23(value2) || value2.contract !== "COS_MHELP_PLACEMENT_V1" || !Array.isArray(value2.items) || value2.items.length > 1e3) throw Error("Invalid placement receipt");
  const seen = /* @__PURE__ */ new Set();
  for (const r of value2.items) {
    if (!object23(r) || !uuid19(r.trackerId) || !(r.nativeUnitId === null || uuid19(r.nativeUnitId)) || !safe5(r.trackerLabel) || !(r.nativeLabel === null || safe5(r.nativeLabel)) || !["confirmed", "held"].includes(r.state) || seen.has(r.trackerId)) throw Error("Invalid placement identity");
    seen.add(r.trackerId);
    if (r.assignmentChanged !== void 0 && typeof r.assignmentChanged !== "boolean") throw Error("Invalid assignment change evidence");
    if (r.state === "confirmed" && (!["FIELD", "SHOP"].includes(r.placement) || !safe5(r.customerLabel) || !safe5(r.siteLabel) || typeof r.locationReview !== "boolean" || typeof r.observedAt !== "string" || !Number.isFinite(Date.parse(r.observedAt)))) throw Error("Invalid placement observation");
  }
  const native = value2.items.filter((r) => r.nativeUnitId !== null).map((r) => r.nativeUnitId);
  if (new Set(native).size !== native.length) throw Error("Duplicate placement identity");
  if (value2.enabled === false) return [];
  return value2.items.filter((r) => r.state === "confirmed" && r.guardCurrent === true && Date.parse(r.observedAt) <= now && now - Date.parse(r.observedAt) <= 40 * 60 * 1e3);
}
var unavailableLocationReasons = /* @__PURE__ */ new Set(["service_location_unverified", "mhelp_location_read_unavailable", "service_location_read_timeout", "service_location_refresh_unavailable"]);
var recordedPlacement = (row2, fieldIds) => {
  const value2 = String(row2.placement || row2.currentLocationType || "").toUpperCase();
  if (["SHOP", "ROOT", "WAREHOUSE", "YARD"].includes(value2)) return "SHOP";
  if (value2 === "UNKNOWN" || row2.placementStatus === "needs_identity_review" || row2.placementReviewReason || row2.representationStatus === "conflict") return null;
  return ["FIELD", "SITE"].includes(value2) || fieldIds.has(row2.id) ? "FIELD" : null;
};
function durablePlacementLinks(receipt2, now, fresh2) {
  return receipt2.enabled === false ? [] : receipt2.items.filter((r) => fresh2.includes(r) || r.state === "confirmed" && r.guardCurrent === true && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= now);
}
var clearUnverifiedPoint = (row2) => ({
  // Placement precedence is independently rechecked by the finalizer. Retaining
  // this binding never makes it an eligible address/geocode lookup again.
  placementPrecedenceBinding: row2.importedInstallation?.sourcePrecedence ? row2.importedInstallation : row2.placementPrecedenceBinding,
  historicalLatitude: row2.latitude ?? row2.historicalLatitude,
  historicalLongitude: row2.longitude ?? row2.historicalLongitude,
  historicalCoordinateSource: row2.coordinateSource ?? row2.historicalCoordinateSource,
  latitude: null,
  longitude: null,
  coordinateSource: null,
  importedInstallation: null,
  locationImportedGeocode: null,
  locationSourceRecorded: null,
  addressEstimateTrackerId: null,
  addressEstimateUnitNumber: null,
  locationVerification: "coordinates_unverified",
  locationVerifiedAt: null,
  locationHistoryId: null
});
function protectedByHistory(r, audits, identity4) {
  const proof = [...identity4?.unitIdentities || [], ...identity4?.ownerConfirmedUnitIdentities || []].filter((p) => p.unitId === r.nativeUnitId);
  const labels = [r.nativeLabel, r.trackerLabel, ...proof.flatMap((p) => p.unitKeys || [])].filter(Boolean).map(concern);
  const devices = proof.flatMap((p) => p.deviceIds || []);
  return audits.some((a) => labels.includes(concern(a.unit_key)) || uuid19(a.control_id) && (a.control_id === r.nativeUnitId || a.control_id === r.trackerId) || Array.isArray(a.device_ids) && a.device_ids.some((id15) => devices.includes(String(id15))));
}
function projectMhelpFieldPlacement(snapshot, receipt2, audits, identity4, now = Date.now(), options = {}) {
  const freshLinks = checkedMhelpPlacements(receipt2, now), links = durablePlacementLinks(receipt2, now, freshLinks);
  if (!Array.isArray(snapshot.inventoryItems) || !Array.isArray(snapshot.items) || !object23(snapshot.summary) || !Array.isArray(audits)) throw Error("Invalid placement inputs");
  const byId = /* @__PURE__ */ new Map(), assignmentChanges = /* @__PURE__ */ new Map(), confirmedAssignments = /* @__PURE__ */ new Map();
  for (const link of links) {
    if (link.guardCurrent === true) {
      confirmedAssignments.set(link.trackerId, link);
      if (link.nativeUnitId) confirmedAssignments.set(link.nativeUnitId, link);
    }
  }
  for (const link of links) {
    if (link.guardCurrent === true && (link.assignmentChanged === true || link.locationReview === true && link.assignmentChanged === void 0)) {
      assignmentChanges.set(link.trackerId, link);
      if (link.nativeUnitId) assignmentChanges.set(link.nativeUnitId, link);
    }
  }
  for (const link of links) {
    if (protectedByHistory(link, audits, identity4)) continue;
    byId.set(link.trackerId, link);
    if (link.nativeUnitId) byId.set(link.nativeUnitId, link);
  }
  if (receipt2.enabled !== false) for (const r of receipt2.items) {
    if (links.includes(r) || protectedByHistory(r, audits, identity4)) continue;
    const held = { ...r, uncertain: true, retainRecorded: r.guardCurrent === true && r.state === "held" && unavailableLocationReasons.has(r.reason) && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= now };
    byId.set(r.trackerId, held);
    if (r.nativeUnitId) byId.set(r.nativeUnitId, held);
  }
  const fieldIds = new Set(snapshot.items.map((r) => r.id));
  const inventoryItems = snapshot.inventoryItems.map((raw) => {
    const { mhelpConfirmedAssignment: _priorConfirmedAssignment, ...initial } = raw;
    let row2 = initial;
    const link = byId.get(row2.id), label3 = link && (row2.id === link.nativeUnitId ? link.nativeLabel : link.trackerLabel);
    const confirmed = confirmedAssignments.get(row2.id), confirmedLabel = confirmed && (row2.id === confirmed.nativeUnitId ? confirmed.nativeLabel : confirmed.trackerLabel);
    if (confirmed && row2.unitNumber === confirmedLabel) row2 = { ...row2, mhelpConfirmedAssignment: { contract: "COS_MHELP_CONFIRMED_ASSIGNMENT_V1", unitId: row2.id, unitNumber: row2.unitNumber, observedAt: confirmed.observedAt, placement: confirmed.placement, assignmentChanged: typeof confirmed.assignmentChanged === "boolean" ? confirmed.assignmentChanged : null } };
    const change = assignmentChanges.get(row2.id), changeLabel = change && (row2.id === change.nativeUnitId ? change.nativeLabel : change.trackerLabel);
    if (change && row2.unitNumber === changeLabel) row2 = { ...row2, mhelpAssignmentChange: { contract: "COS_MHELP_ASSIGNMENT_CHANGE_V1", unitId: row2.id, unitNumber: row2.unitNumber, observedAt: change.observedAt, reason: change.assignmentChanged === true ? "customer_or_service_location_changed" : "assignment_change_status_unavailable" } };
    if (!link || row2.unitNumber !== label3 || row2.placementSource === "owner" || row2.placementReviewReason || row2.hasUnitGps || row2.installedSiteId) return row2;
    if (row2.placementSource === "mhelpdesk" && Number.isFinite(Date.parse(row2.mhelpObservedAt)) && Date.parse(row2.mhelpObservedAt) > Date.parse(link.observedAt)) return row2;
    if (link.uncertain) {
      const prior = link.retainRecorded ? recordedPlacement(row2, fieldIds) : null;
      const keepLocation2 = prior === "FIELD" && exactLocationProof(options.validatedLocationProofs, row2);
      return {
        ...row2,
        ...keepLocation2 ? {} : clearUnverifiedPoint(row2),
        placement: prior || "UNKNOWN",
        placementSource: prior ? row2.placementSource || "recorded_inventory" : "mhelpdesk",
        currentLocationType: prior ? prior.toLowerCase() : "unknown",
        mhelpPlacementReview: prior ? "Recorded placement retained; current service location could not be read." : "Current mHelpDesk assignment or identity is unavailable; verify placement",
        placementEvidence: { source: prior ? "recorded_inventory" : "mhelpdesk", state: prior ? "recorded" : "review", observedAt: prior ? row2.mhelpObservedAt || row2.placementUpdatedAt || row2.sourceVerifiedAt || null : link.observedAt ?? null, latestAttemptAt: link.observedAt ?? null, reason: link.reason || "placement_reason_unavailable", fresh: false }
      };
    }
    const fresh2 = freshLinks.includes(link) && (!receipt2.errorCode || Date.parse(link.observedAt) >= Date.parse(receipt2.lastAttemptAt));
    const locationReview = link.locationReview, assignmentReview = locationReview && link.assignmentChanged !== false;
    const keepLocation = link.placement === "FIELD" && link.guardCurrent === true && !assignmentReview && exactLocationProof(options.validatedLocationProofs, row2);
    return {
      ...row2,
      placement: link.placement,
      placementSource: "mhelpdesk",
      currentLocationType: link.placement.toLowerCase(),
      site: link.siteLabel,
      customer: link.customerLabel,
      mhelpObservedAt: link.observedAt,
      mhelpLocationReview: locationReview,
      placementEvidence: { source: "mhelpdesk", state: fresh2 ? "current" : "recorded", observedAt: link.observedAt, fresh: fresh2, reason: fresh2 ? null : "placement_refresh_unavailable" },
      ...!fresh2 ? { ...keepLocation ? {} : clearUnverifiedPoint(row2), mhelpPlacementReview: "Last confirmed placement retained; the source refresh is delayed. Location needs current verification." } : {},
      _sourceField: link.placement === "FIELD",
      ...assignmentReview ? { address: null, addressSource: "mHelpDesk assignment changed; verify installation address", latitude: null, longitude: null, coordinateSource: null, locationVerification: "address_changed", locationVerifiedAt: null, locationHistoryId: null, importedInstallation: null, addressEstimateTrackerId: null, addressEstimateUnitNumber: null } : {},
      ...link.placement === "SHOP" ? { latitude: null, longitude: null, coordinateSource: null } : {}
    };
  });
  const items = inventoryItems.filter((r) => r.placementSource === "mhelpdesk" ? r.placement === "FIELD" : fieldIds.has(r.id)).map((r) => {
    const { _sourceField, _placementProof, ...item } = r;
    return item;
  });
  return attachMhelpReliabilityStatus({
    ...snapshot,
    inventoryItems,
    items,
    mhelpPlacementSync: { contract: "COS_MHELP_PLACEMENT_V1", confirmedLinks: freshLinks.length, recordedConfirmedLinks: links.length, lastSuccessAt: receipt2.lastSuccessAt, lastAttemptAt: receipt2.lastAttemptAt, errorCode: receipt2.errorCode, nextReadAt: receipt2.readBackoff?.retryAt || null, sheetsPublisher: false },
    summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length }
  }, receipt2);
}
function projectMhelpCameraPlacement(devices, receipt2, audits, identity4, now = Date.now()) {
  const links = checkedMhelpPlacements(receipt2, now), changes = /* @__PURE__ */ new Map();
  const proofs = [...identity4.unitIdentities || [], ...identity4.ownerConfirmedUnitIdentities || []];
  for (const link of links) {
    if (!link.nativeUnitId || protectedByHistory(link, audits, identity4) || (identity4.identityWarnings || []).some((w) => w.unitId === link.nativeUnitId)) continue;
    const matches2 = proofs.filter((p) => p.unitId === link.nativeUnitId && p.unitNumber === link.nativeLabel && ["native_provider", "owner_confirmed_native"].includes(p.kind));
    if (matches2.length !== 1) continue;
    const proof = matches2[0], ids = proof.deviceIds;
    if (!Array.isArray(ids) || !ids.length || !Array.isArray(proof.unitKeys) || proofs.some((p) => p !== proof && p.deviceIds.some((id15) => ids.includes(id15)))) continue;
    const group = devices.filter((d) => proof.unitKeys.includes(d.unit_key));
    if (group.length !== ids.length || new Set(group.map((d) => String(d.id))).size !== ids.length || group.some((d) => !ids.includes(String(d.id)))) continue;
    for (const d of group) if (d.activation_state === "active" && !/^(?:RETIRED|STOLEN|NOT IN USE)$/i.test(d.organization || "")) changes.set(String(d.id), link);
  }
  return devices.map((d) => {
    const link = changes.get(String(d.id));
    return link ? { ...d, organization: link.placement === "SHOP" ? "ROOT" : "mHelpDesk Field \xB7 " + link.siteLabel, __ownerPlacement: link.placement } : d;
  });
}

// tech-checks/supabase/functions/cos-operations-pages/legacyInstallEvidence.ts
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var LEGACY_INSTALL_CONTRACT = "cos.legacy-install-evidence.v1";
var LEGACY_INSTALL_LIMIT = 10;
var HELIOS_FIELD_CHECKS = [
  ["helios_field_box_mounted_ok", "Box mounted"],
  ["helios_field_pv_connected_ok", "PV connected"],
  ["helios_field_ptz_secured_ok", "PTZ secured"],
  ["helios_field_switch_pv_ok", "Switch on PV"],
  ["helios_field_unit_battery_on_ok", "Unit and battery on"],
  ["helios_field_it_online_verified_ok", "IT verified online"],
  ["helios_field_cameras_aimed_ok", "Cameras aimed and focused"],
  ["helios_field_recording_ok", "Recording verified"],
  ["helios_field_tower_20ft_ok", "Tower height checked"],
  ["helios_field_mast_lock_bolt_ok", "Mast locking bolt secured"],
  ["helios_field_panel_45deg_ok", "Panel angle checked"],
  ["helios_field_panel_bolt_ok", "Panel bolt secured"],
  ["helios_field_4_sandbags_ok", "Four sandbags"]
];
var LegacyInstallEvidenceError = class extends Error {
  constructor(status2 = 503) {
    super(status2 === 403 ? "Your Owner evidence access could not be verified." : "Legacy installation evidence could not be verified. Refresh to try again.");
    this.status = status2;
  }
  status;
};
var fail6 = () => {
  throw new LegacyInstallEvidenceError();
};
var object24 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
function rows2(value2, max) {
  if (!Array.isArray(value2) || value2.length > max || Array.from(value2).some((row2) => !object24(row2))) fail6();
  return value2;
}
function id7(value2) {
  if (typeof value2 !== "string" || !UUID3.test(value2)) fail6();
  return value2;
}
function timestamp(value2) {
  return typeof value2 === "string" && /^\d{4}-\d\d-\d\dT/.test(value2) && Number.isFinite(Date.parse(value2)) ? new Date(value2).toISOString() : null;
}
function label(value2, max = 120) {
  if (typeof value2 !== "string") return "";
  const text19 = value2.trim();
  return text19.length <= max && !/[\x00-\x1f<>]|https?:|www\.|@|bearer\s|(?:password|token|secret|api[_ -]?key)\s*[:=]/i.test(text19) ? text19 : "";
}
function ticket(value2) {
  if (typeof value2 !== "string" || !/^\d{1,24}$/.test(value2.trim())) fail6();
  return value2.trim();
}
var selectPrep = "id,ticket_no,site,status,created_at,released_at,closed_at,is_test,work_type";
var selectSolar = "id,prep_ticket_id,handoff_accepted_at,helios_field_completed_at,helios_owner_verified_at,updated_at," + HELIOS_FIELD_CHECKS.map(([key2]) => key2).join(",");
var selectItem = "id,prep_ticket_id,equipment_type,purpose,unit_tag,verified_at,service_unit_confirmed,service_verified_at,power_ok,functions_ok,safe_ok,swap_outcome,swap_outcome_at,spare_outcome,ranger_field_victron_updated_ok,ranger_field_victron_updated_at";
var membership = (values) => "in.(" + values.map((value2) => '"' + value2 + '"').join(",") + ")";
var count = (value2) => Number.isSafeInteger(value2) && Number(value2) >= 0 && Number(value2) <= 1e5 ? Number(value2) : fail6();
function unique(records2, key2 = "id") {
  const seen = /* @__PURE__ */ new Set();
  for (const row2 of records2) {
    const value2 = id7(row2[key2]);
    if (seen.has(value2)) fail6();
    seen.add(value2);
  }
  return records2;
}
function evidenceCount(records2, stage) {
  const selected = records2.filter((row2) => row2.stage === stage || row2.category === stage);
  return {
    stage,
    photos: selected.filter((row2) => row2.kind === "photo").length,
    signatures: selected.filter((row2) => row2.kind === "signature").length,
    signedAt: selected.filter((row2) => row2.kind === "signature").map((row2) => timestamp(row2.created_at)).filter(Boolean).sort().at(-1) || null
  };
}
function projectLegacyInstallRecord(input2, now) {
  const { prep, summary } = input2, prepId = id7(prep.id), ticketNumber = ticket(prep.ticket_no);
  if (prep.is_test !== false || !["closed", "released"].includes(prep.status) || summary.found !== true || summary.ticket_no !== ticketNumber || !object24(summary.counts)) fail6();
  const items = unique(rows2(input2.items, 100)), solar = unique(rows2(input2.solar, 1)), handoff = unique(rows2(input2.handoff, 300)), field5 = unique(rows2(input2.field, 300));
  for (const row2 of [...items, ...solar, ...handoff, ...field5]) if (row2.prep_ticket_id !== prepId) fail6();
  const recordedBefore = (value2, before = now) => {
    const time3 = timestamp(value2);
    return time3 && Date.parse(time3) <= Date.parse(before) ? time3 : null;
  };
  const check = solar[0] || {}, submittedAt = timestamp(check.helios_field_completed_at), completedAt = recordedBefore(check.helios_field_completed_at);
  const handoffAt = completedAt ? recordedBefore(check.handoff_accepted_at, completedAt) : null;
  const ownerTime = recordedBefore(check.helios_owner_verified_at), ownerVerifiedAt = ownerTime && completedAt && Date.parse(ownerTime) >= Date.parse(completedAt) ? ownerTime : null;
  const fieldEvidence2 = evidenceCount(field5, "helios_install");
  const heliosInstalled = items.filter((row2) => row2.equipment_type === "Helios" && (row2.purpose === "DELIVERY" || row2.purpose === "SWAP" && row2.swap_outcome === "installed"));
  const fieldChecks = HELIOS_FIELD_CHECKS.map(([key2, name]) => ({ name, passed: check[key2] === true }));
  const identities = items.map((row2) => JSON.stringify([label(row2.equipment_type), label(row2.unit_tag)]));
  const duplicateIdentity = identities.some((key2, index2) => identities.indexOf(key2) !== index2);
  const signatureAt = timestamp(fieldEvidence2.signedAt);
  const completedProof = Boolean(completedAt && handoffAt && heliosInstalled.length > 0 && fieldChecks.every((row2) => row2.passed) && fieldEvidence2.photos >= heliosInstalled.length && signatureAt && Date.parse(signatureAt) <= Date.parse(completedAt) && field5.every((row2) => {
    const time3 = timestamp(row2.created_at);
    return time3 && Date.parse(time3) >= Date.parse(handoffAt) && Date.parse(time3) <= Date.parse(completedAt);
  }) && !items.some((row2) => row2.equipment_type === "Helios" && row2.purpose === "SWAP" && !["installed", "returned_unused"].includes(row2.swap_outcome)));
  const counts2 = summary.counts;
  const blockers = [];
  if (input2.newerPrep) blockers.push("A newer preparation exists for this ticket. This is historical evidence.");
  if (summary.review_status === "correction_requested") blockers.push("The Owner requested corrections. Review the current Tech Check before closeout.");
  if (duplicateIdentity) blockers.push("Duplicate family and unit tags need identity review.");
  if (count(counts2.active_assignments)) blockers.push("IT or Service assignments remain open.");
  if (count(counts2.open_returns)) blockers.push("Equipment returns still require intake.");
  if (count(counts2.open_offline_unit_escalations)) blockers.push("Offline-unit escalations remain open.");
  if (count(counts2.pending_swap_outcomes)) blockers.push("SWAP results remain undecided.");
  if (count(counts2.missing_required_swap_returns)) blockers.push("Required SWAP returns are missing.");
  if (count(counts2.pending_swap_site_registrations)) blockers.push("Installed SWAP equipment still needs IT site registration.");
  if (submittedAt && !completedProof) blockers.push("The saved Helios submission has incomplete or inconsistent field evidence.");
  if (check.helios_owner_verified_at && !ownerVerifiedAt) blockers.push("The Owner verification timestamp needs review.");
  const units = items.map((row2) => {
    const family = label(row2.equipment_type, 60), unitTag = label(row2.unit_tag, 80), purpose = ["DELIVERY", "SWAP", "BACKUP"].includes(row2.purpose) ? row2.purpose : "UNKNOWN";
    let disposition = "handoff_only";
    if (purpose === "BACKUP") disposition = "truck_spare";
    else if (purpose === "SWAP" && row2.swap_outcome === "returned_unused") disposition = "unused_replacement";
    else if (!family || !unitTag || duplicateIdentity || purpose === "UNKNOWN" || purpose === "SWAP" && row2.swap_outcome !== "installed") disposition = "review_needed";
    else if (family === "Helios" && completedProof) disposition = "installation_recorded";
    else if (purpose === "SWAP" && row2.swap_outcome === "installed") disposition = "swap_installation_recorded";
    return {
      itemId: id7(row2.id),
      family: family || "Equipment family needs review",
      unitTag: unitTag || "Unit tag needs review",
      purpose,
      disposition,
      itVerifiedAt: recordedBefore(row2.verified_at),
      serviceReceiptAt: row2.service_unit_confirmed === true ? recordedBefore(row2.service_verified_at) : null,
      itChecks: [{ name: "Power", passed: row2.power_ok === true }, { name: "Functions", passed: row2.functions_ok === true }, { name: "Safety", passed: row2.safe_ok === true }],
      rangerFieldUpdateAt: family === "Ranger" && row2.ranger_field_victron_updated_ok === true ? recordedBefore(row2.ranger_field_victron_updated_at) : null
    };
  });
  return {
    prepId,
    ticketNumber,
    siteLabel: label(prep.site, 180) || "Site needs review",
    prepStatus: prep.status,
    recordedAt: [completedAt, recordedBefore(prep.closed_at)].filter(Boolean).sort().at(-1) || null,
    fieldCompletedAt: completedProof ? completedAt : null,
    ownerVerifiedAt: completedProof ? ownerVerifiedAt : null,
    historical: input2.newerPrep,
    reviewStatus: ["ready", "not_ready", "correction_requested", "closed"].includes(summary.review_status) ? summary.review_status : "review_needed",
    readyForOwnerReview: summary.ready_for_owner_review === true && summary.review_status === "ready" && prep.status === "closed" && blockers.length === 0,
    units,
    heliosChecks: submittedAt ? fieldChecks : [],
    evidence: [evidenceCount(handoff, "it"), evidenceCount(handoff, "service"), fieldEvidence2].map((e) => ({ ...e, signedAt: recordedBefore(e.signedAt) })),
    blockers,
    fieldMapStatus: "pending_exact_link",
    fieldMapNote: "Native equipment and site linkage is unverified. This evidence does not move or place a Field Map unit."
  };
}
function createLegacyInstallEvidenceReader(read, now = () => /* @__PURE__ */ new Date()) {
  return async () => {
    const generatedAt = now().toISOString(), windowStart = new Date(Date.parse(generatedAt) - 30 * 864e5).toISOString();
    const [closed, submitted] = await Promise.all([
      read("prep_tickets?select=" + selectPrep + "&is_test=eq.false&status=eq.closed&closed_at=gte." + windowStart + "&order=closed_at.desc,id.asc&limit=11").then((v) => unique(rows2(v, 11))),
      read("service_solar_checks?select=prep_ticket_id,helios_field_completed_at&helios_field_completed_at=gte." + windowStart + "&order=helios_field_completed_at.desc,prep_ticket_id.asc&limit=11").then((v) => unique(rows2(v, 11), "prep_ticket_id"))
    ]);
    for (const row2 of closed) if (row2.is_test !== false || row2.status !== "closed" || !timestamp(row2.closed_at) || Date.parse(row2.closed_at) < Date.parse(windowStart) || Date.parse(row2.closed_at) > Date.parse(generatedAt)) fail6();
    for (const row2 of submitted) if (!timestamp(row2.helios_field_completed_at) || Date.parse(row2.helios_field_completed_at) < Date.parse(windowStart) || Date.parse(row2.helios_field_completed_at) > Date.parse(generatedAt)) fail6();
    const ids = [.../* @__PURE__ */ new Set([...closed.map((row2) => id7(row2.id)), ...submitted.map((row2) => id7(row2.prep_ticket_id))])];
    const empty2 = { contract: LEGACY_INSTALL_CONTRACT, readOnly: true, generatedAt, windowStart, limit: LEGACY_INSTALL_LIMIT, hasMore: false, items: [] };
    if (!ids.length) return empty2;
    const current = unique(rows2(await read("prep_tickets?select=" + selectPrep + "&id=" + membership(ids) + "&order=id.asc&limit=23"), 22));
    if (current.length !== ids.length || current.some((row2) => !ids.includes(row2.id))) fail6();
    const candidates = current.filter((row2) => row2.is_test === false && ["released", "closed"].includes(row2.status)).map((prep) => {
      const completion = submitted.find((row2) => row2.prep_ticket_id === prep.id)?.helios_field_completed_at;
      return { prep, time: [timestamp(completion), timestamp(prep.closed_at)].filter(Boolean).sort().at(-1) || null };
    }).filter((row2) => row2.time && Date.parse(row2.time) >= Date.parse(windowStart) && Date.parse(row2.time) <= Date.parse(generatedAt)).sort((a, b) => String(b.time).localeCompare(String(a.time)) || a.prep.id.localeCompare(b.prep.id));
    const selected = candidates.slice(0, LEGACY_INSTALL_LIMIT), hasMore = closed.length === 11 || submitted.length === 11 || candidates.length > LEGACY_INSTALL_LIMIT;
    const projected = [];
    for (let offset = 0; offset < selected.length; offset += 2) {
      projected.push(...await Promise.all(selected.slice(offset, offset + 2).map(async ({ prep }) => {
        const prepId = id7(prep.id), ticketNumber = ticket(prep.ticket_no), filter = "&prep_ticket_id=eq." + prepId;
        const [items, solar, handoff, field5, summary, later] = await Promise.all([
          read("prep_items?select=" + selectItem + filter + "&order=item_order.asc,id.asc&limit=101"),
          read("service_solar_checks?select=" + selectSolar + filter + "&limit=2"),
          read("handoff_evidence?select=id,prep_ticket_id,stage,kind,created_at" + filter + "&order=created_at.asc,id.asc&limit=301"),
          read("service_solar_evidence?select=id,prep_ticket_id,category,kind,created_at" + filter + "&category=eq.helios_install&order=created_at.asc,id.asc&limit=301"),
          read("rpc/owner_job_closeout_summary_v1", { p_ticket_no: ticketNumber }),
          // The authoritative legacy summary uses btrim(ticket_no). A bounded literal
          // numeric substring scan also detects whitespace variants without guessing a join.
          read("prep_tickets?select=id,ticket_no,created_at&ticket_no=like.*" + ticketNumber + "*&created_at=gte." + encodeURIComponent(prep.created_at) + "&order=created_at.desc,id.asc&limit=101")
        ]);
        if (!object24(summary)) fail6();
        const matching = unique(rows2(later, 100)).filter((row2) => typeof row2.ticket_no === "string" && row2.ticket_no.trim() === ticketNumber);
        if (!matching.some((row2) => row2.id === prepId) || matching.some((row2) => !timestamp(row2.created_at))) fail6();
        return projectLegacyInstallRecord({ prep, items: rows2(items, 100), solar: rows2(solar, 1), handoff: rows2(handoff, 300), field: rows2(field5, 300), summary, newerPrep: matching.some((row2) => row2.id !== prepId) }, generatedAt);
      })));
    }
    return { ...empty2, hasMore, items: projected };
  };
}
function legacyEvidenceTransport(fetcher, baseUrl, headers, requestSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(15e3), ...requestSignal ? [requestSignal] : []]);
  const deadline = (start) => new Promise((resolve2, reject2) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject2(new LegacyInstallEvidenceError());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(start).then(resolve2, reject2).finally(() => signal.removeEventListener("abort", abort));
  });
  return async (path, body) => {
    let reader;
    try {
      const response = await deadline(() => fetcher(baseUrl + "/rest/v1/" + path, { method: body ? "POST" : "GET", headers: { ...headers, "Content-Type": "application/json" }, ...body ? { body: JSON.stringify(body) } : {}, signal, cache: "no-store", redirect: "error" }));
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {
        });
        throw new LegacyInstallEvidenceError([401, 403].includes(response.status) ? 403 : 503);
      }
      if (!response.body || Number(response.headers.get("Content-Length")) > 262144) {
        void response.body?.cancel().catch(() => {
        });
        fail6();
      }
      reader = response.body.getReader();
      let size = 0, text19 = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const next = await deadline(() => reader.read());
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 262144) fail6();
        text19 += decoder.decode(next.value, { stream: true });
      }
      text19 += decoder.decode();
      if (signal.aborted) fail6();
      return JSON.parse(text19);
    } catch (cause) {
      throw cause instanceof LegacyInstallEvidenceError ? cause : new LegacyInstallEvidenceError();
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {
        });
        try {
          reader.releaseLock();
        } catch {
        }
      }
    }
  };
}

// tech-checks/operations/src/trackerSourceLabel.ts
function isTrackerSourceLabel(value2) {
  if (typeof value2 !== "string" || value2 !== value2.trim()) return false;
  if (/^ServiceItem_List_[0-9]{14}\.csv$/.test(value2)) return true;
  const m = /^MHelpDesk pull accepted (20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):([0-5][0-9]) CT$/.exec(value2);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// tech-checks/operations/src/mhelpInventoryAuthority.ts
var record2 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var nonnegative2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var product3 = /^[1-9][0-9]{0,14}$/;
function readMhelpInventoryAuthority2(value2, now = Date.now()) {
  if (!record2(value2) || value2.contract !== "COS_MHELP_UPLOAD_INVENTORY_V1" || value2.countBasis !== "mhelp_product_records_not_unique_physical_units" || typeof value2.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value2.sourceSha256) || typeof value2.receivedAt !== "string" || !Number.isFinite(Date.parse(value2.receivedAt)) || !Number.isFinite(now) || Date.parse(value2.receivedAt) > now + 6e4 || !record2(value2.summary) || !Array.isArray(value2.records)) return null;
  const s = value2.summary, records2 = value2.records;
  if (!nonnegative2(s.totalRecords) || !nonnegative2(s.fieldRecords) || !nonnegative2(s.shopRecords) || !nonnegative2(s.unflaggedFieldRecords) || !nonnegative2(s.doNotUseRecords) || !nonnegative2(s.missingRecords) || s.totalRecords !== records2.length || s.totalRecords !== s.fieldRecords + s.shopRecords || s.unflaggedFieldRecords > s.fieldRecords || s.doNotUseRecords + s.missingRecords > s.totalRecords) return null;
  const seen = /* @__PURE__ */ new Set();
  let field5 = 0, shop = 0, fieldActive = 0, inactive = 0;
  for (const item of records2) {
    if (!record2(item) || typeof item.productId !== "string" || !product3.test(item.productId) || seen.has(item.productId) || item.recordId !== "mhelp_product:" + item.productId || !["FIELD", "SHOP"].includes(item.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(item.uploadLifecycle)) return null;
    seen.add(item.productId);
    if (item.placement === "FIELD") {
      field5++;
      if (item.uploadLifecycle === "UNFLAGGED") fieldActive++;
    } else shop++;
    if (item.uploadLifecycle !== "UNFLAGGED") inactive++;
  }
  if (field5 !== s.fieldRecords || shop !== s.shopRecords || fieldActive !== s.unflaggedFieldRecords || inactive !== s.doNotUseRecords + s.missingRecords) return null;
  const live = value2.source === "mhelpdesk_api";
  const observedAt2 = live ? value2.lastApiReadAt : value2.receivedAt;
  if (typeof observedAt2 !== "string" || !Number.isFinite(Date.parse(observedAt2)) || Date.parse(observedAt2) > now + 6e4) return null;
  return {
    total: records2.length,
    field: field5,
    shop,
    inactive,
    fieldActive,
    ...live ? { live: true } : {},
    sourceSha256: value2.sourceSha256,
    receivedAt: observedAt2,
    // The saved upload is historical evidence, not proof of a live vendor read.
    stale: now - Date.parse(observedAt2) > (live ? 45 * 60 * 1e3 : 24 * 60 * 60 * 1e3)
  };
}

// tech-checks/operations/src/cameraEvidence.ts
var CAMERA_FRESH_MS4 = 20 * 60 * 1e3;
function cameraTimestamp3(value2, now = Date.now()) {
  if (typeof value2 !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value2);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value2.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS4 } : { at: null, fresh: false };
}

// tech-checks/operations/src/exactProductConnection.ts
var EXACT_PRODUCT_CONNECTION_CONTRACT2 = "COS_EXACT_PRODUCT_CONNECTIONS_V2";
var VERIFIED_TRACKER_IP_CONTRACT = "COS_VERIFIED_2027_PRODUCT_IPS_V1";
var TRACKER_CONNECTION_CENSUS_V2 = "COS_VERIFIED_2027_PRODUCT_IPS_V2";
var TRACKER_CONNECTION_HOLDS = ["placement_mismatch", "customer_mismatch", "identity_mismatch", "tracker_restriction"];
var TRACKER_IP_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
var ID6 = /^[1-9][0-9]{0,14}$/;
var HASH5 = /^[a-f0-9]{64}$/;
var SOURCE_FRESH_MS2 = 30 * 60 * 1e3;
var object25 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var safeTime2 = (v, now, windowMs) => {
  if (typeof v !== "string") return null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now && now - parsed <= windowMs ? new Date(parsed).toISOString() : null;
};
var unknown2 = (productId, reason) => ({
  productId,
  status: "unknown",
  basis: "tcp_service_port",
  checkedAt: null,
  resourceId: null,
  reason
});
var publicIp = (value2) => {
  if (typeof value2 !== "string" || !value2 || value2 !== value2.trim()) return null;
  const saved = savedCameraConnection(value2, []);
  return saved?.publicIp === value2 ? value2 : null;
};
var revision = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 ? String(value2) : typeof value2 === "string" && /^(0|[1-9][0-9]*)$/.test(value2) ? value2 : null;
var validPortNonresponseError = (v) => v === void 0 || v === null || v === "timeout" || v === "Connection refused (os error 111)" || v === "Connection timed out (os error 110)";
var completedPortOutcome = (v) => {
  if (!object25(v) || typeof v.online !== "boolean" || v.attempted === false || v.attempted !== void 0 && v.attempted !== true || v.errorCode || v.error_code || v.technicalError) return false;
  const hasLatency = typeof v.latency_ms === "number" && Number.isFinite(v.latency_ms) && v.latency_ms >= 0;
  const measured = Object.hasOwn(v, "latency_ms") && (v.latency_ms === null || hasLatency);
  if (v.online) return (v.error === void 0 || v.error === null) && (v.attempted === true || hasLatency);
  return validPortNonresponseError(v.error) && (v.attempted === true || typeof v.error === "string" && measured);
};
var deviceId2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && ID6.test(v) ? v : null;
function completedSavedTcpCheck(device, now = Date.now()) {
  if (device.monitoringEnabled !== true || !deviceId2(device.deviceId)) return null;
  const ip = publicIp(device.publicIp), rev = revision(device.connectionRevision);
  if (!ip || rev === null || !Array.isArray(device.expectedPorts) || !device.expectedPorts.length || device.expectedPorts.length > 128 || !object25(device.portStatus)) return null;
  const ports = device.expectedPorts;
  if (new Set(ports).size !== ports.length || ports.some((v) => !Number.isInteger(v) || v < 1 || v > 65535)) return null;
  const proof = device.portStatus._connection;
  if (!object25(proof) || proof.ip !== ip || revision(proof.revision) !== rev || !["online", "offline", "verifying"].includes(proof.status) || typeof proof.reachable !== "boolean" || proof.error || proof.errorCode || proof.error_code) return null;
  const observed2 = cameraTimestamp3(proof.checkedAt, now);
  if (!observed2.fresh || !observed2.at) return null;
  const checkedAt = observed2.at;
  const observedPorts = Object.keys(device.portStatus).filter((k) => /^[1-9][0-9]{0,4}$/.test(k) && Number(k) <= 65535);
  if (observedPorts.length !== ports.length || ports.some((p) => !observedPorts.includes(String(p)))) return null;
  const states2 = ports.map((port) => device.portStatus[String(port)]);
  if (states2.some((v) => !completedPortOutcome(v))) return null;
  const responded = states2.some((v) => v.online === true);
  if (responded && proof.status === "online" && proof.reachable === true) return {
    status: "online",
    basis: "tcp_service_port",
    checkedAt,
    resourceId: deviceId2(device.deviceId),
    reason: "Completed saved TCP/service-port check responded. Camera video is not verified."
  };
  if (!responded && ["offline", "verifying"].includes(proof.status) && proof.reachable === false) return {
    status: "offline",
    basis: "tcp_service_port",
    checkedAt,
    resourceId: deviceId2(device.deviceId),
    reason: "Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified."
  };
  return null;
}
function buildExactProductConnections(acceptedMhelp, tracker, devices, now = Date.now(), resourceMembership, reachabilityOnly = false) {
  const authority = readMhelpInventoryAuthority2(acceptedMhelp, now);
  if (!authority || authority.stale || !object25(tracker) || ![VERIFIED_TRACKER_IP_CONTRACT, TRACKER_CONNECTION_CENSUS_V2].includes(tracker.contract) || tracker.workbookId !== TRACKER_IP_WORKBOOK || tracker.expectedMhelpSourceSha256 !== authority.sourceSha256 || !HASH5.test(tracker.expectedMhelpSourceSha256) || !safeTime2(tracker.verifiedAt, now, SOURCE_FRESH_MS2) || !Array.isArray(tracker.records) || tracker.records.length !== authority.total || !Array.isArray(devices) || devices.length > 1e4) return null;
  const isolated = tracker.contract === TRACKER_CONNECTION_CENSUS_V2;
  if (reachabilityOnly && !isolated) return null;
  if (isolated && (!HASH5.test(tracker.trackerSourceSha256) || !isTrackerSourceLabel(tracker.sourceExport))) return null;
  const products = acceptedMhelp.records;
  const expected = new Map(products.map((p) => [p.productId, p]));
  const byProduct = /* @__PURE__ */ new Map();
  const ipClaims = /* @__PURE__ */ new Map(), sourceRows = /* @__PURE__ */ new Set();
  for (const raw of tracker.records) {
    if (!object25(raw) || typeof raw.productId !== "string" || !ID6.test(raw.productId) || byProduct.has(raw.productId) || raw.recordId !== "mhelp_product:" + raw.productId || !["FIELD", "SHOP"].includes(raw.placement) || !expected.has(raw.productId) || !(raw.publicIp === null || typeof raw.publicIp === "string" && raw.publicIp.length <= 80)) return null;
    const mismatch = expected.get(raw.productId)?.placement !== raw.placement;
    if (isolated) {
      if (!Number.isSafeInteger(raw.sourceRow) || raw.sourceRow < 2 || raw.sourceRow > 12e3 || sourceRows.has(raw.sourceRow) || !Array.isArray(raw.reviewReasons) || new Set(raw.reviewReasons).size !== raw.reviewReasons.length || raw.reviewReasons.some((reason) => !TRACKER_CONNECTION_HOLDS.includes(reason)) || mismatch !== raw.reviewReasons.includes("placement_mismatch")) return null;
      sourceRows.add(raw.sourceRow);
    } else if (mismatch || raw.reviewReasons !== void 0) return null;
    const row2 = raw;
    byProduct.set(raw.productId, row2);
    if (publicIp(row2.publicIp)) ipClaims.set(row2.publicIp, (ipClaims.get(row2.publicIp) || 0) + 1);
  }
  if (byProduct.size !== expected.size || [...expected.keys()].some((id15) => !byProduct.has(id15))) return null;
  const endpoints = /* @__PURE__ */ new Map(), endpointIds = /* @__PURE__ */ new Set();
  for (const device of devices) {
    if (!object25(device) || !deviceId2(device.deviceId) || !Array.isArray(device.expectedPorts)) return null;
    if (reachabilityOnly && endpointIds.has(String(device.deviceId))) return null;
    endpointIds.add(String(device.deviceId));
    const ip = publicIp(device.publicIp);
    if (!ip) continue;
    const list = endpoints.get(ip) || [];
    list.push(device);
    endpoints.set(ip, list);
  }
  const items = products.filter((p) => p.placement === "FIELD").map((product4) => {
    const pid = product4.productId, row2 = byProduct.get(pid);
    if (row2.reviewReasons?.length) return unknown2(pid, "Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.");
    if (product4.uploadLifecycle !== "UNFLAGGED") return unknown2(pid, "Inactive, Missing or Do Not Use source; no operational connection is claimed.");
    const binding = object25(product4.binding) ? product4.binding : null;
    if (binding?.state === "held" || binding?.placementHeld === true || Array.isArray(binding?.candidateUnitIds) && binding.candidateUnitIds.length > 0)
      return unknown2(pid, "Equipment identity or placement is held for review.");
    const ip = publicIp(row2.publicIp);
    if (!ip) return unknown2(pid, "No verified public tracker IP is available for this Product ID.");
    if (ipClaims.get(ip) !== 1) return unknown2(pid, "Another Product ID claims this tracker IP; verify endpoint ownership.");
    const devicesForIp = endpoints.get(ip) || [];
    if (reachabilityOnly) {
      const active = devicesForIp.filter((d) => d.monitoringEnabled === true && (d.activationState === void 0 || d.activationState === "active"));
      if (!active.length) return unknown2(pid, "No enabled service-port check configuration matches the current tracker IP.");
      const checks = active.map((d) => completedSavedTcpCheck(d, now));
      if (checks.some((c) => !c)) return unknown2(pid, "No fresh, completed check covers every enabled service-port configuration at this tracker IP.");
      const completed2 = checks, positive2 = completed2.find((c) => c.status === "online"), result2 = positive2 || completed2[0];
      return { productId: pid, ...result2, checkedAt: completed2.map((c) => c.checkedAt).sort()[0], reason: positive2 ? "Completed service-port checks responded at this Product ID\u2019s current tracker IP. Equipment identity, video and recording are not verified." : "Completed service-port checks had no response at this Product ID\u2019s current tracker IP. Equipment identity, video and recording are not verified." };
    }
    if (devicesForIp.length !== 1) return unknown2(pid, devicesForIp.length ? "More than one saved endpoint claims this tracker IP; verify exact device ownership." : "No saved camera endpoint matches the current tracker IP.");
    const result = completedSavedTcpCheck(devicesForIp[0], now);
    if (!result) return unknown2(pid, "No fresh, completed, exact-target TCP/service-port check is available.");
    if (!resourceMembership?.get(pid)?.includes(String(devicesForIp[0].deviceId))) return unknown2(pid, "No current verified Product-to-resource membership is available for this saved endpoint.");
    return { productId: pid, ...result };
  });
  if (items.length !== authority.field) return null;
  return { contract: EXACT_PRODUCT_CONNECTION_CONTRACT2, sourceSha256: authority.sourceSha256, trackerVerifiedAt: safeTime2(tracker.verifiedAt, now, SOURCE_FRESH_MS2), items };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts
var ID7 = /^[1-9][0-9]{0,14}$/;
var HASH6 = /^[a-f0-9]{64}$/;
var object26 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var normalized4 = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
var fail7 = () => {
  throw Error("Protected 2027 Product-ID/IP evidence is unavailable or changed.");
};
var rangeSpec = (v) => {
  if (typeof v !== "string") return null;
  const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/.exec(v);
  return m ? { sheet: m[1] || m[2], fromCol: m[3], fromRow: Number(m[4]), toCol: m[5], toRow: Number(m[6]) } : null;
};
var col = (v) => [...v].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function rows3(value2, expectedRange) {
  const expected = rangeSpec(expectedRange), actual = object26(value2) ? rangeSpec(value2.range) : null;
  if (!expected || !actual || !object26(value2) || actual.sheet !== expected.sheet || actual.fromCol !== expected.fromCol || actual.toCol !== expected.toCol || actual.fromRow !== expected.fromRow || actual.toRow > expected.toRow || actual.toRow < actual.fromRow || value2.majorDimension !== "ROWS" || !Array.isArray(value2.values) || value2.values.length > actual.toRow - actual.fromRow + 1) return fail7();
  const width = col(expected.toCol) - col(expected.fromCol) + 1;
  return value2.values.map((row2) => {
    if (!Array.isArray(row2) || row2.length > width || row2.some((v) => v !== null && (typeof v !== "string" || v.length > 600))) return fail7();
    return row2.map((v) => v === null ? "" : v);
  });
}
async function verify2027ConnectionCensus(valueRanges, rangeNames, candidate, expectedMhelpSourceSha256, verifiedAt) {
  if (!Array.isArray(valueRanges) || valueRanges.length !== 7 || rangeNames.length !== 7 || !HASH6.test(expectedMhelpSourceSha256) || !Number.isFinite(Date.parse(verifiedAt)) || !Array.isArray(candidate) || !candidate.length || candidate.length > 1e4) return fail7();
  const boundaries = [
    ["UNIT OVERVIEW", "A", "E"],
    ["UNIT OVERVIEW", "O", "O"],
    ["UNIT OVERVIEW", "Q", "R"],
    ["MHELP MATCH INDEX", "A", "B"],
    ["MHELP MATCH INDEX", "D", "E"],
    ["MHELP MATCH INDEX", "H", "H"],
    ["UNIT OVERVIEW", "H", "H"]
  ];
  rangeNames.forEach((name, i) => {
    const s = rangeSpec(name), b = boundaries[i];
    if (!s || s.sheet !== b[0] || s.fromCol !== b[1] || s.toCol !== b[2] || s.fromRow !== 1 || s.toRow > 12e3) return fail7();
  });
  const [info, ids, placement3, indexIds, indexDetails, exports, ips] = valueRanges.map((v, i) => rows3(v, rangeNames[i]));
  if (info[0]?.[0] !== "EQUIPMENT TYPE" || info[0]?.[1] !== "UNIT #" || info[0]?.[2] !== "PLACEMENT" || info[0]?.[4] !== "CUSTOMER" || ids[0]?.[0] !== "MHELP EQUIPMENT ID" || placement3[0]?.[0] !== "TRACKER PLACEMENT" || placement3[0]?.[1] !== "MHELP PLACEMENT" || indexIds[0]?.[0] !== "TRACKER MATCH KEY" || indexIds[0]?.[1] !== "MHELP EQUIPMENT ID" || indexDetails[0]?.[0] !== "MHELP EQUIPMENT NAME" || indexDetails[0]?.[1] !== "MHELP CUSTOMER / SITE" || exports[0]?.[0] !== "MHELP SOURCE EXPORT" || ips[0]?.[0] !== "IP" || ips.length > ids.length) return fail7();
  const expected = /* @__PURE__ */ new Map();
  for (const r of candidate) {
    if (!object26(r) || !ID7.test(r.productId) || expected.has(r.productId) || !["FIELD", "SHOP"].includes(r.placement) || typeof r.customer !== "string" || !r.customer.trim() || typeof r.unitNumber !== "string" || !r.unitNumber.trim()) return fail7();
    expected.set(r.productId, r);
  }
  const indexed = /* @__PURE__ */ new Map();
  let sourceExport = null;
  for (let i = 1; i < Math.max(indexIds.length, indexDetails.length, exports.length); i++) {
    const a = indexIds[i] || [], d = indexDetails[i] || [], e = exports[i] || [];
    if (![...a, ...d, ...e].some((v) => v.trim())) continue;
    if (!a[0] || !ID7.test(a[1]) || indexed.has(a[1]) || !d[0] || !d[1] || !isTrackerSourceLabel(e[0])) return fail7();
    if (sourceExport !== null && sourceExport !== e[0]) return fail7();
    sourceExport = e[0];
    indexed.set(a[1], { key: a[0], model: d[0], customer: d[1] });
  }
  const records2 = [], seen = /* @__PURE__ */ new Set();
  for (let i = 1; i < Math.max(info.length, ids.length, placement3.length, ips.length); i++) {
    const a = info[i] || [], id15 = ids[i]?.[0] || "", p = placement3[i] || [], ip = ips[i]?.[0] || "";
    if (![...a, id15, ...p, ip].some((v) => v.trim())) continue;
    const [family, label3, currentPlacement, , customer] = a;
    if (!family || !label3 || !customer || !ID7.test(id15) || seen.has(id15) || !expected.has(id15) || !indexed.has(id15) || !["FIELD", "SHOP"].includes(currentPlacement) || !p[0] || ip.length > 80) return fail7();
    seen.add(id15);
    const source = expected.get(id15), index2 = indexed.get(id15);
    if (index2.key !== family + "|" + label3) return fail7();
    const reviewReasons = [];
    if (currentPlacement !== source.placement) reviewReasons.push("placement_mismatch");
    if (normalized4(customer) !== normalized4(source.customer) || normalized4(index2.customer) !== normalized4(source.customer) || equipmentCustomerPlacement(customer) !== currentPlacement) reviewReasons.push("customer_mismatch");
    if (normalized4(index2.model) !== normalized4(source.unitNumber)) reviewReasons.push("identity_mismatch");
    if (p[0] !== currentPlacement || Boolean(p[1]) && p[1] !== currentPlacement) reviewReasons.push("tracker_restriction");
    records2.push({
      productId: id15,
      recordId: "mhelp_product:" + id15,
      placement: currentPlacement,
      publicIp: ip.trim() || null,
      reviewReasons,
      sourceRow: i + 1
    });
  }
  if (!sourceExport || records2.length !== expected.size || indexed.size !== expected.size || [...expected.keys()].some((id15) => !seen.has(id15) || !indexed.has(id15))) return fail7();
  const bytes = new TextEncoder().encode(JSON.stringify({ rangeNames, sourceExport, records: records2 }));
  const trackerSourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    contract: TRACKER_CONNECTION_CENSUS_V2,
    workbookId: TRACKER_IP_WORKBOOK,
    expectedMhelpSourceSha256,
    verifiedAt,
    trackerSourceSha256,
    sourceExport,
    records: records2
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelp2027ProductIpReader.ts
var TOKEN_URL3 = "https://oauth2.googleapis.com/token";
var SCOPE3 = "https://www.googleapis.com/auth/spreadsheets.readonly";
var OVERVIEW2 = { id: 1132540236, title: "UNIT OVERVIEW" };
var INDEX2 = { id: 1900169011, title: "MHELP MATCH INDEX" };
var failure = () => {
  throw Error("Protected 2027 Product-ID/IP evidence is unavailable or changed.");
};
async function read2027ProductIpsFromGoogle(options) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedMhelpSourceSha256) || !Array.isArray(options.candidate) || !options.candidate.length || options.candidate.length > 1e4) return failure();
  const at = options.now ?? Date.now, requestFetch = options.fetch ?? fetch;
  let account2;
  try {
    account2 = account(options.getServiceAccountJson());
  } catch {
    return failure();
  }
  if (!account2 || !options.signAssertion) return failure();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e4);
  try {
    const issuedAt = Math.floor(at() / 1e3);
    let assertion;
    try {
      assertion = await options.signAssertion(
        account2.private_key,
        { alg: "RS256", typ: "JWT", kid: account2.private_key_id },
        { iss: account2.client_email, aud: TOKEN_URL3, iat: issuedAt, exp: issuedAt + 3600, scope: SCOPE3 }
      );
    } catch {
      return failure();
    }
    if (typeof assertion !== "string" || assertion.length > 16384 || !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion)) return failure();
    const read = async (uri, limit, token) => {
      const response = await requestFetch(uri, { method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok) return failure();
      return boundedJson(response, limit, controller.signal);
    };
    const authorization = await requestFetch(TOKEN_URL3, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store"
    });
    if (!authorization.ok) return failure();
    const signed = await boundedJson(authorization, 32768, controller.signal);
    if (typeof signed.access_token !== "string" || !signed.access_token || signed.access_token.length > 16384 || /\s/.test(signed.access_token) || signed.token_type !== "Bearer") return failure();
    const base2 = "https://sheets.googleapis.com/v4/spreadsheets/" + UNIT_TRACKER_WORKBOOK;
    const metadata2 = await read(base2 + "?fields=" + encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))"), 25e4, signed.access_token);
    if (metadata2.spreadsheetId !== UNIT_TRACKER_WORKBOOK || metadata2.properties?.title !== "2027 UNIT TRACKER" || !Array.isArray(metadata2.sheets)) return failure();
    const count6 = /* @__PURE__ */ new Map();
    for (const expected of [OVERVIEW2, INDEX2]) {
      const matches2 = metadata2.sheets.filter((s) => s?.properties?.sheetId === expected.id), p = matches2[0]?.properties;
      if (matches2.length !== 1 || p.title !== expected.title || p.hidden === true || p.sheetType !== "GRID" || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount < options.candidate.length + 1 || p.gridProperties.rowCount > 12e3 || p.gridProperties.columnCount < (expected.id === INDEX2.id ? 9 : 19)) return failure();
      count6.set(expected.title, p.gridProperties.rowCount);
    }
    const n = count6.get(OVERVIEW2.title), m = count6.get(INDEX2.title);
    const names = [
      `'UNIT OVERVIEW'!A1:E${n}`,
      `'UNIT OVERVIEW'!O1:O${n}`,
      `'UNIT OVERVIEW'!Q1:R${n}`,
      `'MHELP MATCH INDEX'!A1:B${m}`,
      `'MHELP MATCH INDEX'!D1:E${m}`,
      `'MHELP MATCH INDEX'!H1:H${m}`,
      `'UNIT OVERVIEW'!H1:H${n}`
    ];
    const query = new URLSearchParams();
    for (const name of names) query.append("ranges", name);
    query.set("valueRenderOption", "FORMATTED_VALUE");
    const result = await read(base2 + "/values:batchGet?" + query, 22e5, signed.access_token);
    if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== 7) return failure();
    return verify2027ConnectionCensus(result.valueRanges, names, options.candidate, options.expectedMhelpSourceSha256, new Date(at()).toISOString());
  } catch {
    return failure();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpProductConnectionSource.ts
function currentMhelpProductConnectionCensus(value2, now = Date.now()) {
  const prior = validPrior(value2);
  const original = value2;
  const rows4 = prior.records.map((row2) => {
    const r = row2, b = r.binding;
    return {
      productId: r.productId,
      recordId: "mhelp_product:" + r.productId,
      placement: r.placement,
      uploadLifecycle: r.lifecycle,
      binding: {
        state: r.placementHeld === true || r.possibleAliasUnitIds?.length || b?.guardCurrent === false ? "held" : b ? "linked" : "unlinked",
        placementHeld: r.placementHeld === true || b?.guardCurrent === false,
        candidateUnitIds: r.possibleAliasUnitIds || []
      }
    };
  });
  const summary = {
    totalRecords: rows4.length,
    fieldRecords: rows4.filter((r) => r.placement === "FIELD").length,
    shopRecords: rows4.filter((r) => r.placement === "SHOP").length,
    unflaggedFieldRecords: rows4.filter((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED").length,
    doNotUseRecords: rows4.filter((r) => r.uploadLifecycle === "DO_NOT_USE").length,
    missingRecords: rows4.filter((r) => r.uploadLifecycle === "MISSING").length
  };
  const census = {
    contract: "COS_MHELP_UPLOAD_INVENTORY_V1",
    countBasis: "mhelp_product_records_not_unique_physical_units",
    sourceSha256: prior.sourceSha256,
    source: original.origin === "mhelpdesk_api" ? "mhelpdesk_api" : "owner_supplied_mhelp_export",
    receivedAt: original.receivedAt,
    lastApiReadAt: original.apiSync?.lastSuccessAt || original.receivedAt,
    summary,
    records: rows4
  };
  if (!readMhelpInventoryAuthority2(census, now)) throw Error("Current mHelp product receipt is unavailable.");
  return { census, candidate: prior.records, sourceSha256: prior.sourceSha256 };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpAccessRetry.ts
var MhelpPortalChangedError = class extends Error {
  constructor() {
    super("The renewed mHelpDesk account does not match the saved portal.");
  }
};
async function currentMhelpConfigOrRenew(current, getCurrent, renew) {
  const valid = (v) => typeof v === "string" && v.length > 0 && v.length <= 16384 && !/\s/.test(v);
  const latest = await getCurrent();
  if (!valid(latest?.accessToken)) throw Error("Current mHelpDesk access is unavailable");
  if (current.portalId && latest.portalId && latest.portalId !== current.portalId) throw new MhelpPortalChangedError();
  const candidate = latest.accessToken !== current.accessToken ? latest : await renew();
  if (!valid(candidate?.accessToken)) throw Error("Current mHelpDesk access is unavailable");
  if (current.portalId && candidate.portalId && candidate.portalId !== current.portalId) throw new MhelpPortalChangedError();
  return candidate;
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpPartner.ts
var MHELP_PARTNER_CONTRACT = "cos-mhelpdesk-partner-review-v1";
var MHELP_PARTNER_DOCS = "https://www.mhelpdesk.com/partner-api/index.html";
var API = "https://connect.mhelpdesk.com/api/v1.0";
var CURRENT_USER_API = API + "/users/me";
var FIELDS = "equipmentId,portalId,equipmentTypeId,name,model,customerId,serviceLocationId,IsActive,lastUpdateUTC";
var MhelpPartnerError = class extends Error {
  constructor(message, status2 = 503, provider) {
    super(message);
    this.status = status2;
    this.provider = provider;
  }
  status;
  provider;
};
var MhelpPartnerReadDeadlineError = class extends MhelpPartnerError {
  constructor() {
    super("The mHelpDesk read timed out. Retry the preview.");
  }
};
var fail8 = (message, status2 = 503) => {
  throw new MhelpPartnerError(message, status2);
};
function object27(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail8("mHelpDesk returned an unsupported record.");
  return v;
}
function numericId(v, optional = false) {
  if (optional && (v == null || v === 0 || v === "0")) return null;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v) && Number.isSafeInteger(Number(v))) return v;
  return fail8("mHelpDesk returned an invalid equipment identity.");
}
function label2(v, optional = false) {
  if (optional && (v == null || v === "")) return null;
  if (typeof v !== "string" || !v.trim() || v.length > 180 || /[\x00-\x1f\x7f]/.test(v)) fail8("mHelpDesk returned an invalid equipment label.");
  return v;
}
function projectPartnerEquipment(value2, portalId) {
  const row2 = object27(value2);
  if (numericId(row2.portalId) !== portalId) fail8("mHelpDesk returned equipment from a different portal.");
  const updatedAt = row2.lastUpdateUTC == null || row2.lastUpdateUTC === "" ? null : row2.lastUpdateUTC;
  if (updatedAt !== null && (typeof updatedAt !== "string" || updatedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))) fail8("mHelpDesk returned an invalid update time.");
  if (row2.IsActive != null && typeof row2.IsActive !== "boolean") fail8("mHelpDesk returned an invalid equipment status.");
  return {
    equipmentId: numericId(row2.equipmentId),
    portalId,
    name: label2(row2.name),
    model: label2(row2.model, true),
    equipmentTypeId: numericId(row2.equipmentTypeId, true),
    customerId: numericId(row2.customerId, true),
    serviceLocationId: numericId(row2.serviceLocationId, true),
    active: row2.IsActive == null ? null : row2.IsActive,
    updatedAt
  };
}
function reviewPartnerIdentity(equipment, nativeUnits) {
  const units = nativeUnits.map(object27);
  if (units.some((row2) => typeof row2.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row2.id) || typeof row2.unit_number !== "string")) fail8("COS returned an invalid equipment identity.");
  const candidates = units.filter((row2) => row2.unit_number === equipment.name).map((row2) => String(row2.id));
  const bindings = units.filter((row2) => {
    const metadata2 = row2.metadata;
    const binding = metadata2?.mhelpdeskPartner;
    return binding?.portalId === equipment.portalId && binding?.equipmentId === equipment.equipmentId;
  });
  const exact8 = bindings.length === 1 && candidates.length <= 1 && bindings[0].metadata.mhelpdeskPartner.fullLabel === equipment.name && bindings[0].metadata.mhelpdeskPartner.model === equipment.model && bindings[0].unit_number === equipment.name;
  return {
    state: bindings.length > 1 || candidates.length > 1 ? "ambiguous" : exact8 ? "verified_link" : bindings.length ? "identity_changed" : "review_needed",
    nativeUnitId: exact8 && bindings.length === 1 && candidates.length <= 1 ? String(bindings[0].id) : null,
    candidateUnitIds: candidates
  };
}
async function boundedJson2(response, signal, maxBytes = 1048576) {
  if (!response.body || Number(response.headers.get("Content-Length")) > maxBytes) return fail8("mHelpDesk returned an oversized response.");
  const reader = response.body.getReader();
  let size = 0, raw = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      if (signal.aborted) throw new MhelpPartnerReadDeadlineError();
      const { done, value: value2 } = await reader.read();
      if (done) break;
      size += value2.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        fail8("mHelpDesk returned an oversized response.");
      }
      raw += decoder.decode(value2, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw);
  } catch (cause) {
    if (cause instanceof MhelpPartnerError) throw cause;
    if (signal.aborted) throw new MhelpPartnerReadDeadlineError();
    return fail8("mHelpDesk returned an incomplete response. Retry the preview.");
  } finally {
    reader.releaseLock();
  }
}
function createMhelpPartnerHandler(options) {
  let busy = false;
  return async (path, method, body) => {
    if (!["/api/mhelpdesk/partner/status", "/api/mhelpdesk/partner/preview"].includes(path)) fail8("mHelpDesk connector endpoint not found.", 404);
    if (method !== (path.endsWith("/status") ? "GET" : "POST")) fail8("Method not supported.", 405);
    const payload = body == null ? {} : object27(body);
    if (Object.keys(payload).some((key2) => !path.endsWith("/preview") || key2 !== "name")) fail8("The connector request contains unsupported fields.", 400);
    if (payload.name !== void 0 && (typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 180 || /[\x00-\x1f\x7f]/.test(payload.name))) fail8("Enter a full equipment label.", 400);
    let config = await options.getConfig();
    const portalConfigured = typeof config.portalId === "string" && /^[1-9][0-9]{0,14}$/.test(config.portalId) && Number.isSafeInteger(Number(config.portalId));
    const tokenConfigured = typeof config.accessToken === "string" && !!config.accessToken && config.accessToken.length <= 16384 && !/\s/.test(config.accessToken);
    const status2 = {
      contract: MHELP_PARTNER_CONTRACT,
      docsUrl: MHELP_PARTNER_DOCS,
      mode: "read_only_review",
      state: portalConfigured && tokenConfigured ? "ready_to_test" : "setup_required",
      portalConfigured,
      tokenConfigured,
      automaticSync: false,
      sheetsPublisher: false,
      liveAccessVerified: false
    };
    if (path.endsWith("/status")) return status2;
    if (!tokenConfigured) fail8("mHelpDesk needs a server-held access token before previewing equipment.", 503);
    if (config.portalId && !portalConfigured) fail8("The saved mHelpDesk portal ID must be a numeric company ID. Correct or remove that setting before previewing equipment.", 503);
    if (busy) fail8("A mHelpDesk preview is already running. Wait for it to finish.", 409);
    busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.fullEquipmentReview ? 4e4 : 2e4);
    try {
      let renewed = false;
      const read = async (url2, maxBytes) => {
        let response;
        try {
          response = await options.fetch(url2, { method: "GET", headers: { Authorization: "Bearer " + config.accessToken, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal });
        } catch {
          if (controller.signal.aborted) throw new MhelpPartnerReadDeadlineError();
          return fail8("mHelpDesk could not be reached. Retry the preview.");
        }
        if (response.status === 401 && url2 === CURRENT_USER_API && options.renewAccess && !renewed) {
          renewed = true;
          await response.body?.cancel().catch(() => {
          });
          try {
            config = await currentMhelpConfigOrRenew(config, options.getConfig, options.renewAccess);
          } catch {
            return fail8("mHelpDesk could not renew its server token. Check the protected refresh-token and API client settings.");
          }
          if (!config || typeof config.accessToken !== "string" || !config.accessToken || config.accessToken.length > 16384 || /\s/.test(config.accessToken)) fail8("mHelpDesk secure token renewal is unavailable.");
          return read(url2, maxBytes);
        }
        const provider = { operation: url2 === CURRENT_USER_API ? "account_read" : "equipment_read", httpStatus: response.status };
        if (response.status === 401 || response.status === 403) throw new MhelpPartnerError("mHelpDesk denied API access. Verify the token, portal, and Partner API approval.", 503, provider);
        if (response.status === 429) throw new MhelpPartnerError("mHelpDesk is limiting requests. Wait before retrying.", 429, provider);
        if (!response.ok) throw new MhelpPartnerError("mHelpDesk could not complete the account or equipment read. Retry later.", 503, provider);
        return object27(await boundedJson2(response, controller.signal, maxBytes));
      };
      const account2 = await read(CURRENT_USER_API, 16384);
      let verifiedPortalId;
      try {
        verifiedPortalId = numericId(account2.portalId);
      } catch {
        return fail8("mHelpDesk did not return a valid company portal ID. Contact mHelpDesk Partner API support.");
      }
      if (portalConfigured && config.portalId !== verifiedPortalId) fail8("The saved portal ID does not match the mHelpDesk account for this token. Correct the server setting before previewing equipment.");
      const url = new URL(API + "/portal/" + verifiedPortalId + "/equipment");
      const pageSize = options.fullEquipmentReview ? 200 : 50;
      url.searchParams.set("Fields", FIELDS);
      if (payload.name) url.searchParams.set("Name", payload.name);
      if (options.fullEquipmentReview) {
        if (payload.name) fail8("Full equipment maintenance does not accept filters.", 400);
        url.searchParams.set("pageSize", String(pageSize));
      }
      const data = await read(url.href);
      if (!Array.isArray(data.results) || data.results.length > pageSize || !Number.isSafeInteger(data.totalRows) || Number(data.totalRows) < data.results.length || Number(data.totalRows) < 0) fail8("mHelpDesk returned an unsupported equipment page.");
      const rows4 = data.results.map((row2) => projectPartnerEquipment(row2, verifiedPortalId));
      if (new Set(rows4.map((row2) => row2.equipmentId)).size !== rows4.length) fail8("mHelpDesk returned duplicate equipment identities.");
      if (options.fullEquipmentReview) {
        const total = Number(data.totalRows), seen = new Set(rows4.map((row2) => row2.equipmentId));
        if (total > 1e4) fail8("The mHelpDesk equipment list exceeds the maintenance limit.");
        const ordered = (page2) => page2.every((row2, i) => i === 0 || Number(row2.equipmentId) > Number(page2[i - 1].equipmentId));
        if (!ordered(rows4)) fail8("mHelpDesk did not return equipment in stable identity order.");
        let indexBase = 0, boundaryChecked = false;
        while (rows4.length < total) {
          if (!rows4.length || rows4.length % pageSize !== 0) fail8("mHelpDesk returned an incomplete equipment page.");
          const offsets = [rows4.length + indexBase];
          if (boundaryChecked && rows4.length + pageSize < total) offsets.push(rows4.length + pageSize + indexBase);
          const pending = offsets.map((offset) => {
            const pageUrl = new URL(url);
            pageUrl.searchParams.set("rowIndex", String(offset));
            return read(pageUrl.href);
          });
          const results = await Promise.allSettled(pending);
          const pageOf = (value2) => {
            if (!Array.isArray(value2.results) || value2.results.length > pageSize || value2.totalRows !== total) fail8("mHelpDesk equipment changed during the read. Retry the review.");
            return value2.results.map((row2) => projectPartnerEquipment(row2, verifiedPortalId));
          };
          for (const result of results) {
            if (result.status === "rejected") throw result.reason;
            let page2 = pageOf(result.value);
            if (!boundaryChecked && page2.length && page2[0].equipmentId === rows4[rows4.length - 1].equipmentId) {
              indexBase = 1;
              url.searchParams.set("rowIndex", String(rows4.length + indexBase));
              page2 = pageOf(await read(url.href));
            }
            boundaryChecked = true;
            if (!page2.length || page2.length !== Math.min(pageSize, total - rows4.length) || !ordered(page2) || Number(page2[0].equipmentId) <= Number(rows4[rows4.length - 1].equipmentId) || page2.some((row2) => seen.has(row2.equipmentId)) || rows4.length + page2.length > total) fail8("mHelpDesk returned overlapping or incomplete equipment pages.");
            for (const row2 of page2) {
              seen.add(row2.equipmentId);
              rows4.push(row2);
            }
          }
        }
      }
      const nativeUnits = await options.readNativeUnits();
      if (!Array.isArray(nativeUnits) || nativeUnits.length > 1e4) fail8("COS equipment could not be verified. Retry the preview.");
      return {
        ...status2,
        state: "preview_verified",
        liveAccessVerified: true,
        verifiedPortalId,
        readAt: (/* @__PURE__ */ new Date()).toISOString(),
        totalRows: data.totalRows,
        partial: rows4.length < Number(data.totalRows),
        items: rows4.map((row2) => ({ ...row2, identity: reviewPartnerIdentity(row2, nativeUnits) }))
      };
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };
}

// tech-checks/operations/shared/mhelpUnitIdentity.ts
function mhelpUnitIdentity(value2) {
  if (typeof value2 !== "string" || value2.length > 160 || /[\x00-\x1f\x7f<>]/.test(value2)) return null;
  const name = value2.trim(), match = /^(SNIPER\s*[24]|RECON\s*(?:II|2))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?|HD)?$/i.exec(name) || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RSU|RECON|RII|RI|SOLAR\s*POLE|SOLAR\s*STAND|ST)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?|HD)?$/i.exec(name);
  if (!match || Number(match[2].split(".")[0]) === 0) return null;
  const raw = match[1].toUpperCase().replace(/\s/g, ""), family = { RECONII: "RECON2", RII: "RECON2", RI: "RECON", RSU: "CAMV", SOLARSTAND: "SOLARPOLE", ST: "SOLARPOLE" }[raw] || raw;
  const [base2, ...tail] = match[2].split("."), tag = Number(base2) + (tail.length ? "." + tail.join(".") : ""), variant = (match[3] || "").toUpperCase();
  return { key: family + "|" + tag + "|" + variant, family, label: name };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpUnitLocation.ts
var API2 = "https://connect.mhelpdesk.com/api/v1.0";
var fail9 = (message, status2 = 503) => {
  throw new MhelpPartnerError(message, status2);
};
var object28 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : fail9("mHelpDesk returned an unsupported location record.");
var id8 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d{0,14}$/.test(v) ? v : fail9("mHelpDesk returned an invalid record identity.");
var text12 = (v, max = 160) => typeof v === "string" && v.trim() && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v) ? v.trim() : fail9("mHelpDesk returned an incomplete location label.");
function page(v, max = 200) {
  const p = object28(v), hasData = Object.hasOwn(p, "data"), hasResults = Object.hasOwn(p, "results");
  if (hasData === hasResults || !Number.isSafeInteger(p.totalRows) || Number(p.totalRows) > max) fail9("The mHelpDesk location lookup is incomplete. Narrow the lookup in COS.");
  const rows4 = hasData ? p.data : p.results;
  if (!Array.isArray(rows4) || rows4.length !== p.totalRows) fail9("mHelpDesk returned an incomplete location page.");
  return rows4.map(object28);
}
function projectServiceLocation(row2, portal, serviceId, parentCustomerId) {
  const correctIdentity = row2.serviceLocationId != null ? id8(row2.serviceLocationId) === serviceId && parentCustomerId != null && id8(row2.customerId) === parentCustomerId : id8(row2.customerId) === serviceId;
  if (!correctIdentity || id8(row2.portalId) !== portal || row2.isActive === false || row2.countryId != null && !["US", "USA"].includes(String(row2.countryId))) fail9("The service location identity or availability changed.");
  const states2 = Object.fromEntries("AL:ALABAMA|AK:ALASKA|AZ:ARIZONA|AR:ARKANSAS|CA:CALIFORNIA|CO:COLORADO|CT:CONNECTICUT|DE:DELAWARE|DC:DISTRICT OF COLUMBIA|FL:FLORIDA|GA:GEORGIA|HI:HAWAII|ID:IDAHO|IL:ILLINOIS|IN:INDIANA|IA:IOWA|KS:KANSAS|KY:KENTUCKY|LA:LOUISIANA|ME:MAINE|MD:MARYLAND|MA:MASSACHUSETTS|MI:MICHIGAN|MN:MINNESOTA|MS:MISSISSIPPI|MO:MISSOURI|MT:MONTANA|NE:NEBRASKA|NV:NEVADA|NH:NEW HAMPSHIRE|NJ:NEW JERSEY|NM:NEW MEXICO|NY:NEW YORK|NC:NORTH CAROLINA|ND:NORTH DAKOTA|OH:OHIO|OK:OKLAHOMA|OR:OREGON|PA:PENNSYLVANIA|RI:RHODE ISLAND|SC:SOUTH CAROLINA|SD:SOUTH DAKOTA|TN:TENNESSEE|TX:TEXAS|UT:UTAH|VT:VERMONT|VA:VIRGINIA|WA:WASHINGTON|WV:WEST VIRGINIA|WI:WISCONSIN|WY:WYOMING".split("|").map((v) => {
    const [code, name] = v.split(":");
    return [name, code];
  }));
  if ([row2.address1, row2.address2, row2.city, row2.name].some((v) => typeof v === "string" && /\b(?:password|passwd|token|secret|credentials?|gate[ -]*code|access[ -]*code|pin)\b\s*[:=]/i.test(v))) fail9("This service location needs address review before it can be displayed.");
  const street = text12(row2.address1, 200), city = text12(row2.city, 100), givenState = text12(row2.state, 40).toUpperCase(), state = states2[givenState] || givenState, zip = typeof row2.zip === "number" && Number.isSafeInteger(row2.zip) && row2.zip > 0 ? String(row2.zip).padStart(5, "0") : String(row2.zip ?? "");
  if (!/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip)) fail9("This service location needs address review before a map pin can be imported.");
  const latitude = row2.latitude, longitude = row2.longitude, point2 = typeof latitude === "number" && Number.isFinite(latitude) && latitude !== 0 && Math.abs(latitude) <= 90 && typeof longitude === "number" && Number.isFinite(longitude) && longitude !== 0 && Math.abs(longitude) <= 180 ? [latitude, longitude] : null;
  const suite = row2.address2 != null && String(row2.address2).trim() ? text12(row2.address2, 120) : "";
  return { site: text12(row2.name), address: street + (suite ? " " + suite : "") + ", " + city + ", " + state + " " + zip, point: point2 };
}
function createMhelpUnitLocationReader(options) {
  return async (input2) => {
    const request = object28(input2);
    if (Object.keys(request).some((k) => !["unitName", "ticketNumber"].includes(k)) || mhelpUnitIdentity(request.unitName) === null || request.ticketNumber != null && (typeof request.ticketNumber !== "string" || !/^\d{1,15}$/.test(request.ticketNumber))) fail9("Enter a numbered unit and optional mHelpDesk job number.", 400);
    const deadline = AbortSignal.timeout(24e3), boundedFetch = (target, init = {}) => options.fetch(target, { ...init, signal: AbortSignal.any([deadline, ...init.signal ? [init.signal] : []]) });
    const requestedIdentity = mhelpUnitIdentity(request.unitName), now = options.now || (() => (/* @__PURE__ */ new Date()).toISOString());
    let config = await options.getConfig(), renewed = false;
    if (!config.accessToken || config.accessToken.length > 16384 || /\s/.test(config.accessToken)) fail9("The existing mHelpDesk connection is unavailable.");
    const read = async (path, max = 262144) => {
      const response = await boundedFetch(API2 + path, { method: "GET", headers: { Authorization: "Bearer " + config.accessToken, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12e3) });
      if (response.status === 401 && path === "/users/me" && !renewed && options.renewAccess) {
        void response.body?.cancel();
        renewed = true;
        config = await currentMhelpConfigOrRenew(config, options.getConfig, options.renewAccess);
        if (!config.accessToken || config.accessToken.length > 16384 || /\s/.test(config.accessToken)) fail9("mHelpDesk token renewal is unavailable.");
        return read(path, max);
      }
      if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > max) {
        void response.body?.cancel();
        fail9(response.status === 429 ? "mHelpDesk is limiting requests. Retry later." : "mHelpDesk could not read the service location.");
      }
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let raw = "", bytes = 0;
      try {
        for (; ; ) {
          const r = await reader.read();
          if (r.done) break;
          bytes += r.value.byteLength;
          if (bytes > max) fail9("mHelpDesk returned an oversized location response.");
          raw += decoder.decode(r.value, { stream: true });
        }
        return JSON.parse(raw + decoder.decode());
      } finally {
        void reader.cancel().catch(() => {
        });
      }
    };
    const account2 = object28(await read("/users/me", 16384)), portal = id8(account2.portalId);
    if (portal !== "224643" || config.portalId && config.portalId !== portal) fail9("The mHelpDesk connection belongs to a different company.");
    const prefix = "/portal/" + portal;
    const readPages = async (path, max = 5e3) => {
      const all = [];
      let total = null;
      for (let index2 = 0; index2 < Math.ceil(max / 200); index2++) {
        const value2 = object28(await read(path + "&pageSize=200&rowIndex=" + index2 * 200)), rows4 = value2.data ?? value2.results;
        if (!Array.isArray(rows4) || !Number.isSafeInteger(value2.totalRows) || Number(value2.totalRows) > max || Number(value2.totalRows) < 0 || total !== null && total !== value2.totalRows) return fail9("The mHelpDesk location lookup is incomplete.");
        total = Number(value2.totalRows);
        if (rows4.length !== Math.min(200, total - all.length)) fail9("mHelpDesk returned an incomplete location page.");
        all.push(...rows4.map(object28));
        if (all.length === total) return all;
      }
      return fail9("The mHelpDesk location lookup is incomplete.");
    };
    const family = { CAMV: "CAM V", SOLARPOLE: "Solar Pole", SOLARSPOTTER: "Solar Spotter", SSHYBRID: "SS Hybrid" }[requestedIdentity.family] || requestedIdentity.family.replace(/2$|4$/, "");
    const inventory = await readPages(prefix + "/equipment?Name=" + encodeURIComponent(family) + "&Fields=equipmentId,portalId,name,model,equipmentTypeId,customerId,serviceLocationId,IsActive,lastUpdateUTC");
    if (new Set(inventory.map((r) => String(r.equipmentId))).size !== inventory.length) fail9("Duplicate equipment identities were returned.");
    const candidates = inventory.map((r) => projectPartnerEquipment(r, portal)).filter((r) => mhelpUnitIdentity(r.name)?.key === requestedIdentity.key && r.active !== false);
    if (candidates.length !== 1) fail9(candidates.length ? "More than one mHelpDesk unit matches. Resolve its identity before importing." : "No active mHelpDesk equipment record matches this unit.", 409);
    const equipment = candidates[0];
    let customerId = equipment.customerId, locationId = equipment.serviceLocationId, ticketNumber = null, ticketId = null;
    if (request.ticketNumber) {
      const tickets = page(await read(prefix + "/Equipment/" + equipment.equipmentId + "/Tickets?pageSize=200&rowIndex=0&Fields=ticketId,ticketNumber,portalId,customerId,serviceLocationId,deleted"), 200);
      const matches2 = tickets.filter((t) => String(t.ticketNumber) === request.ticketNumber && t.deleted === false);
      if (matches2.length !== 1) fail9("That job could not be uniquely confirmed for this equipment. Use the assigned unit location or review the job in mHelpDesk.", 409);
      const ticket2 = matches2[0];
      if (id8(ticket2.portalId) !== portal) fail9("The ticket belongs to a different portal.");
      ticketNumber = id8(ticket2.ticketNumber);
      ticketId = id8(ticket2.ticketId);
      customerId = id8(ticket2.customerId);
      locationId = id8(ticket2.serviceLocationId);
    }
    if (!customerId) return fail9("This mHelpDesk unit has no verified customer assignment.", 409);
    const customer = object28(await read(prefix + "/customers/" + customerId + "?Fields=customerId,portalId,name,isServiceLocation"));
    if (id8(customer.customerId) !== customerId || id8(customer.portalId) !== portal) fail9("The assigned customer identity changed.");
    const customerName = text12(customer.name), shop = ["cameras onsite", "cameras onsite llc"].includes(customerName.toLowerCase());
    let location = { site: "Shop / ROOT", address: "", point: null }, coordinateSource = null;
    if (!shop) {
      if (!locationId) return fail9("This assignment has no service location. A billing address will not be used.", 409);
      let service;
      if (customer.isServiceLocation === true && customerId === locationId) service = object28(await read(prefix + "/customers/" + locationId + "?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,address2,city,state,zip,countryId,latitude,longitude"));
      else {
        const services = (await readPages(prefix + "/customers/" + customerId + "/servicelocations?Fields=serviceLocationId,customerId,portalId,name,isActive,address1,address2,city,state,zip,countryId,latitude,longitude")).filter((s) => String(s.serviceLocationId ?? s.customerId) === locationId && (s.serviceLocationId == null || String(s.customerId) === customerId));
        if (services.length === 1) service = services[0];
      }
      if (!service) return fail9("The job or equipment service location was not confirmed under its customer.", 409);
      location = projectServiceLocation(service, portal, locationId, customerId);
      coordinateSource = location.point ? "mHelpDesk service location" : null;
      if (!location.point) {
        const geo = await censusAddress(location.address, boundedFetch, now);
        if (geo.status === "success") {
          location.point = [geo.latitude, geo.longitude];
          coordinateSource = "Census address estimate";
        }
      }
    }
    const fresh2 = projectPartnerEquipment(await read(prefix + "/equipment/" + equipment.equipmentId + "?Fields=equipmentId,portalId,name,model,equipmentTypeId,customerId,serviceLocationId,IsActive,lastUpdateUTC"), portal);
    if (fresh2.name !== equipment.name || fresh2.model !== equipment.model || fresh2.customerId !== equipment.customerId || fresh2.serviceLocationId !== equipment.serviceLocationId || fresh2.active === false) fail9("The unit assignment changed during lookup. Refresh before importing.", 409);
    if (ticketId) {
      const freshTicket = object28(await read(prefix + "/Tickets/" + ticketId + "?Fields=ticketId,ticketNumber,portalId,customerId,serviceLocationId,deleted"));
      if (id8(freshTicket.ticketId) !== ticketId || id8(freshTicket.ticketNumber) !== ticketNumber || id8(freshTicket.portalId) !== portal || id8(freshTicket.customerId) !== customerId || id8(freshTicket.serviceLocationId) !== locationId || freshTicket.deleted !== false) fail9("The job service location changed during lookup. Refresh before importing.", 409);
    }
    return { contract: "COS_MHELP_UNIT_LOCATION_V1", unitName: String(request.unitName).trim(), equipmentId: equipment.equipmentId, equipmentLabel: equipment.name, ticketNumber, placement: shop ? "SHOP" : "FIELD", customer: customerName, ...location, coordinateSource, locationVerified: false, readAt: now(), reviewRequired: true };
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTokenSession.ts
var RENEWAL_STAGES = ["token_request", "token_response"];
var RENEWAL_REASONS = ["transport_failed", "deadline", "http_error", "response_missing", "response_too_large", "response_invalid"];
var OAUTH_ERRORS = ["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope"];
function projectMhelpTokenRenewalDiagnostic(value2) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) return;
  const row2 = value2;
  if (!RENEWAL_STAGES.includes(row2.stage) || !RENEWAL_REASONS.includes(row2.reason)) return;
  return {
    stage: row2.stage,
    reason: row2.reason,
    httpStatus: typeof row2.httpStatus === "number" && Number.isInteger(row2.httpStatus) && row2.httpStatus >= 100 && row2.httpStatus <= 599 ? row2.httpStatus : null,
    oauthError: OAUTH_ERRORS.includes(row2.oauthError) ? row2.oauthError : null
  };
}
var MhelpTokenRenewalError = class extends Error {
  diagnostic;
  constructor(stage, reason, httpStatus = null, oauthError = null) {
    super("mHelpDesk secure token renewal is unavailable");
    this.diagnostic = Object.freeze(projectMhelpTokenRenewalDiagnostic({ stage, reason, httpStatus, oauthError }));
  }
};

// tech-checks/supabase/functions/cos-operations-pages/mhelpTicketDay.ts
function localMidnight(now, dayOffset = 0) {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid current time is required.");
  const format6 = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts3 = (at) => Object.fromEntries(format6.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const today = parts3(now), target = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
  const local = target.getTime();
  let candidate = local;
  for (let i = 0; i < 3; i++) {
    const p = parts3(new Date(candidate));
    const delta = local - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    candidate += delta;
    if (delta === 0) break;
  }
  const check = parts3(new Date(candidate));
  if (check.year !== target.getUTCFullYear() || check.month !== target.getUTCMonth() + 1 || check.day !== target.getUTCDate() || check.hour !== 0 || check.minute !== 0 || check.second !== 0) throw new Error("The local ticket window is not available.");
  return candidate;
}
function mhelpTodayPreviewWindow(now = /* @__PURE__ */ new Date()) {
  const start = localMidnight(now);
  if (start >= now.getTime()) throw new Error("Today\u2019s ticket window is not available yet.");
  return { createdAfter: new Date(start).toISOString(), createdBefore: now.toISOString() };
}
function mhelpPreviousDayPreviewWindow(now = /* @__PURE__ */ new Date()) {
  return { createdAfter: new Date(localMidnight(now, -1)).toISOString(), createdBefore: new Date(localMidnight(now)).toISOString() };
}
function mhelpAppointmentPreviewWindow(createdAfter) {
  const start = new Date(createdAfter);
  if (!Number.isFinite(start.getTime()) || localMidnight(start) !== start.getTime()) throw new Error("The appointment schedule window is not available.");
  return { startDateUtc: start.toISOString(), endDateUtc: new Date(localMidnight(start, 7)).toISOString(), timeZone: "America/Chicago", calendarDays: 7 };
}
function mhelpPrivateAppointmentDay(appointmentDay, now = /* @__PURE__ */ new Date()) {
  if (typeof appointmentDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDay) || !Number.isFinite(now.getTime())) throw new Error("Provide a valid appointment day within 31 Chicago calendar days.");
  const [year, month, day] = appointmentDay.split("-").map(Number), target = Date.UTC(year, month - 1, day);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || new Date(target).toISOString().slice(0, 10) !== appointmentDay) throw new Error("Provide a valid appointment day within 31 Chicago calendar days.");
  const parts3 = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  const offset = (target - Date.UTC(parts3.year, parts3.month - 1, parts3.day)) / 864e5;
  if (!Number.isInteger(offset) || Math.abs(offset) > 31) throw new Error("Provide a valid appointment day within 31 Chicago calendar days.");
  return { startDateUtc: new Date(localMidnight(now, offset)).toISOString(), endDateUtc: new Date(localMidnight(now, offset + 1)).toISOString(), timeZone: "America/Chicago", calendarDays: 1 };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpAppointments.ts
var MHELP_APPOINTMENT_EVIDENCE = "appointment_structure_v1";
var MHELP_APPOINTMENT_PAGE_LIMIT = 500;
var MHELP_APPOINTMENT_FIELDS = ["ID", "TicketId", "PortalId", "UserId", "StartUTC", "EndUTC", "TeamId", "RecurrenceRule", "RecurrenceParentID", "RecurrenceStartUTC", "RecurrenceEndUTC", "TimeZone", "AppointmentTimeZone", "IsAllDay", "LastUpdate", "IsDeleted", "IsHidden"];
var CONTRACT = "cos-mhelpdesk-appointment-evidence-v1";
var SCOPE4 = "single_ticket_seven_day_schedule_window";
var KINDS = ["absent", "null", "boolean", "integer", "number", "string", "array", "object", "other"];
var FORMATS = ["numeric", "iso_with_zone", "iso_without_zone", "dotnet", "other"];
var REVIEW_KEYS = ["deleted", "hidden", "team", "recurrence", "missingFlags", "missingUser", "invalidTime", "invalidIdentity"];
var ENVELOPE_KEYS = ["rootKind", "totalRowsKind", "resultsKind", "alternateTotalRowsKind", "alternateTotalResultsKind", "alternateDataKind"];
var plain2 = (value2) => !!value2 && typeof value2 === "object" && !Array.isArray(value2);
var own = (row2, key2) => plain2(row2) && Object.hasOwn(row2, key2) ? row2[key2] : void 0;
function kind(value2) {
  if (value2 === void 0) return "absent";
  if (value2 === null) return "null";
  if (Array.isArray(value2)) return "array";
  if (typeof value2 === "number") return Number.isSafeInteger(value2) ? "integer" : "number";
  return ["boolean", "string", "object"].includes(typeof value2) ? typeof value2 : "other";
}
function format(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value2)) return "iso_with_zone";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value2)) return "iso_without_zone";
  if (/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value2)) return "dotnet";
  return "other";
}
function distribution(values, classify) {
  const result = {};
  for (const value2 of values) {
    const key2 = classify(value2);
    result[key2] = (result[key2] || 0) + 1;
  }
  return result;
}
function field(values) {
  const strings2 = values.filter((value2) => typeof value2 === "string"), emptyStrings = strings2.filter((value2) => !value2.trim()).length;
  return { kinds: distribution(values, kind), formats: distribution(strings2, (value2) => format(value2)), emptyStrings, nonemptyStrings: strings2.length - emptyStrings };
}
var positiveId = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0;
var absentRelation = (value2) => value2 === null || value2 === 0 || value2 === "";
function timestamp2(value2) {
  if (typeof value2 !== "string" || value2.length > 40 || format(value2) !== "iso_with_zone" || !Number.isFinite(Date.parse(value2))) return null;
  const [year, month, day] = value2.slice(0, 10).split("-").map(Number), [hour, minute, second] = value2.slice(11, 19).split(":").map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return Date.parse(value2);
}
function linkage(completeness, exactMatches, unknown3, review) {
  if (completeness !== "complete" || unknown3 > 0) return "unverified";
  if (exactMatches === 0) return "no_match_in_window";
  if (exactMatches > 1) return "ambiguous_matches";
  return Object.values(review).some((n) => n > 0) ? "review_required" : "single_structural_match";
}
function unavailableMhelpAppointments(totalTickets, createdAfter) {
  return projectMhelpAppointmentEvidence({ contract: CONTRACT, scope: SCOPE4, window: mhelpAppointmentPreviewWindow(createdAfter), state: "selection_unavailable", reason: totalTickets === 0 ? "empty_window" : "ambiguous_window" }, totalTickets, createdAfter);
}
function describeMhelpAppointments(value2, selected, createdAfter) {
  const window = mhelpAppointmentPreviewWindow(createdAfter), rawRows = own(value2, "results");
  if (Array.isArray(rawRows) && rawRows.length > MHELP_APPOINTMENT_PAGE_LIMIT) throw Error("mHelpDesk returned an oversized appointment page.");
  const rows4 = Array.isArray(rawRows) ? rawRows : [], rawTotal = own(value2, "TotalRows");
  const reportedTotal = typeof rawTotal === "number" && Number.isSafeInteger(rawTotal) && rawTotal >= 0 && rawTotal <= 1e6 ? rawTotal : null;
  const envelope = { rootKind: kind(value2), totalRowsKind: kind(rawTotal), resultsKind: kind(rawRows), alternateTotalRowsKind: kind(own(value2, "totalRows")), alternateTotalResultsKind: kind(own(value2, "totalResults")), alternateDataKind: kind(own(value2, "data")) };
  const validEnvelope = plain2(value2) && Array.isArray(rawRows) && reportedTotal !== null && reportedTotal >= rows4.length && ["totalRows", "totalResults", "data"].every((key2) => !Object.hasOwn(value2, key2));
  const completeness = !validEnvelope ? "unverified" : reportedTotal === rows4.length ? "complete" : "incomplete";
  const fields4 = Object.fromEntries(MHELP_APPOINTMENT_FIELDS.map((key2) => [key2, field(rows4.map((row2) => own(row2, key2)))]));
  const reviewCounts = Object.fromEntries(REVIEW_KEYS.map((key2) => [key2, 0]));
  let exactMatchCount = 0, unverifiedLinkageCount = 0;
  for (const row2 of rows4) {
    const ticket2 = own(row2, "TicketId"), portal = own(row2, "PortalId");
    if (!plain2(row2) || !positiveId(portal) || portal !== Number(selected.portalId) || !(ticket2 === null || ticket2 === 0) && !positiveId(ticket2)) {
      unverifiedLinkageCount++;
      continue;
    }
    if (ticket2 !== Number(selected.ticketId)) continue;
    exactMatchCount++;
    if (selected.deleted || own(row2, "IsDeleted") === true) reviewCounts.deleted++;
    if (own(row2, "IsHidden") === true) reviewCounts.hidden++;
    if (typeof own(row2, "IsDeleted") !== "boolean" || typeof own(row2, "IsHidden") !== "boolean") reviewCounts.missingFlags++;
    if (!absentRelation(own(row2, "TeamId"))) reviewCounts.team++;
    if (["RecurrenceRule", "RecurrenceParentID", "RecurrenceStartUTC", "RecurrenceEndUTC"].some((key2) => !absentRelation(own(row2, key2)))) reviewCounts.recurrence++;
    const user = own(row2, "UserId");
    if (typeof user !== "string" || !user.trim() || user.length > 500 || /[\x00-\x1f\x7f]/.test(user)) reviewCounts.missingUser++;
    const start = timestamp2(own(row2, "StartUTC")), end = timestamp2(own(row2, "EndUTC"));
    if (start === null || end === null || end <= start || start < Date.parse(window.startDateUtc) || start >= Date.parse(window.endDateUtc) || own(row2, "IsAllDay") !== false) reviewCounts.invalidTime++;
    if (!positiveId(own(row2, "ID"))) reviewCounts.invalidIdentity++;
  }
  return projectMhelpAppointmentEvidence({
    contract: CONTRACT,
    scope: SCOPE4,
    window,
    state: "window_reviewed",
    pageLimit: MHELP_APPOINTMENT_PAGE_LIMIT,
    sampledAppointments: rows4.length,
    reportedTotal,
    completeness,
    envelope,
    fields: fields4,
    exactMatchCount,
    unverifiedLinkageCount,
    linkage: linkage(completeness, exactMatchCount, unverifiedLinkageCount, reviewCounts),
    reviewCounts,
    technician: "unresolved_no_staff_read",
    schedule: "unverified_candidate_contract"
  }, 1, createdAfter);
}
function projectMhelpAppointmentEvidence(value2, totalTickets, createdAfter) {
  const invalid5 = () => {
    throw Error("Unsupported mHelpDesk appointment evidence.");
  };
  const exact8 = (value3, keys3) => {
    if (!plain2(value3) || Object.keys(value3).length !== keys3.length || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    return value3;
  };
  const integer = (value3, max = MHELP_APPOINTMENT_PAGE_LIMIT) => {
    if (typeof value3 !== "number" || !Number.isSafeInteger(value3) || value3 < 0 || value3 > max) invalid5();
    return value3;
  };
  const counters = (value3, keys3, size) => {
    if (!plain2(value3) || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    const source = value3, result2 = {};
    for (const key2 of keys3) if (Object.hasOwn(source, key2)) {
      const n = integer(source[key2], size);
      if (n === 0) invalid5();
      result2[key2] = n;
    }
    if (Object.values(result2).reduce((sum, n) => sum + Number(n), 0) !== size) invalid5();
    return result2;
  };
  integer(totalTickets);
  if (!plain2(value2)) invalid5();
  const row2 = value2;
  if (row2.contract !== CONTRACT || row2.scope !== SCOPE4) invalid5();
  const window = mhelpAppointmentPreviewWindow(createdAfter), inputWindow = exact8(row2.window, Object.keys(window));
  for (const key2 of Object.keys(window)) if (inputWindow[key2] !== window[key2]) invalid5();
  const base2 = { contract: CONTRACT, scope: SCOPE4, window };
  if (row2.state === "selection_unavailable") {
    exact8(row2, ["contract", "scope", "window", "state", "reason"]);
    if (totalTickets === 1 || row2.reason !== (totalTickets === 0 ? "empty_window" : "ambiguous_window")) invalid5();
    return { ...base2, state: "selection_unavailable", reason: row2.reason };
  }
  exact8(row2, ["contract", "scope", "window", "state", "pageLimit", "sampledAppointments", "reportedTotal", "completeness", "envelope", "fields", "exactMatchCount", "unverifiedLinkageCount", "linkage", "reviewCounts", "technician", "schedule"]);
  if (row2.state !== "window_reviewed" || totalTickets !== 1 || row2.pageLimit !== MHELP_APPOINTMENT_PAGE_LIMIT || row2.technician !== "unresolved_no_staff_read" || row2.schedule !== "unverified_candidate_contract") invalid5();
  const sampledAppointments = integer(row2.sampledAppointments), reportedTotal = row2.reportedTotal === null ? null : integer(row2.reportedTotal, 1e6);
  const inputEnvelope = exact8(row2.envelope, ENVELOPE_KEYS), envelope = Object.fromEntries(ENVELOPE_KEYS.map((key2) => {
    if (!KINDS.includes(inputEnvelope[key2])) invalid5();
    return [key2, inputEnvelope[key2]];
  }));
  const validEnvelope = envelope.rootKind === "object" && envelope.resultsKind === "array" && envelope.totalRowsKind === "integer" && reportedTotal !== null && reportedTotal >= sampledAppointments && ["alternateTotalRowsKind", "alternateTotalResultsKind", "alternateDataKind"].every((key2) => inputEnvelope[key2] === "absent");
  const completeness = !validEnvelope ? "unverified" : reportedTotal === sampledAppointments ? "complete" : "incomplete";
  if (row2.completeness !== completeness || envelope.resultsKind !== "array" && sampledAppointments !== 0 || reportedTotal !== null && envelope.totalRowsKind !== "integer") invalid5();
  const inputFields = exact8(row2.fields, MHELP_APPOINTMENT_FIELDS), fields4 = Object.fromEntries(MHELP_APPOINTMENT_FIELDS.map((key2) => {
    const source = exact8(inputFields[key2], ["kinds", "formats", "emptyStrings", "nonemptyStrings"]), kinds = counters(source.kinds, KINDS, sampledAppointments), formats = counters(source.formats, FORMATS, kinds.string || 0);
    const emptyStrings = integer(source.emptyStrings, sampledAppointments), nonemptyStrings = integer(source.nonemptyStrings, sampledAppointments);
    if (emptyStrings + nonemptyStrings !== (kinds.string || 0)) invalid5();
    return [key2, { kinds, formats, emptyStrings, nonemptyStrings }];
  }));
  const exactMatchCount = integer(row2.exactMatchCount, sampledAppointments), unverifiedLinkageCount = integer(row2.unverifiedLinkageCount, sampledAppointments);
  if (exactMatchCount + unverifiedLinkageCount > sampledAppointments || exactMatchCount > (fields4.TicketId.kinds.integer || 0) || exactMatchCount > (fields4.PortalId.kinds.integer || 0)) invalid5();
  const inputReview = exact8(row2.reviewCounts, REVIEW_KEYS), reviewCounts = Object.fromEntries(REVIEW_KEYS.map((key2) => [key2, integer(inputReview[key2], exactMatchCount)]));
  const resolvedLinkage = linkage(completeness, exactMatchCount, unverifiedLinkageCount, reviewCounts);
  if (row2.linkage !== resolvedLinkage) invalid5();
  const result = { ...base2, state: "window_reviewed", pageLimit: 500, sampledAppointments, reportedTotal, completeness, envelope, fields: fields4, exactMatchCount, unverifiedLinkageCount, linkage: resolvedLinkage, reviewCounts, technician: "unresolved_no_staff_read", schedule: "unverified_candidate_contract" };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 16e3) invalid5();
  return result;
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpAppointmentVariants.ts
var MHELP_APPOINTMENT_VARIANTS = "appointment_variants_v1";
var MHELP_APPOINTMENT_VARIANT_CONTRACT = "cos-mhelpdesk-appointment-evidence-v2";
var MHELP_APPOINTMENT_VARIANT_FIELDS = [
  "Id",
  "id",
  "TicketID",
  "ticketId",
  "ticketID",
  "PortalID",
  "portalId",
  "portalID",
  "UserID",
  "userId",
  "userID",
  "StartUtc",
  "startUTC",
  "startUtc",
  "EndUtc",
  "endUTC",
  "endUtc",
  "TeamID",
  "teamId",
  "teamID",
  "recurrenceRule",
  "RecurrenceParentId",
  "recurrenceParentID",
  "recurrenceParentId",
  "RecurrenceStartUtc",
  "recurrenceStartUTC",
  "recurrenceStartUtc",
  "RecurrenceEndUtc",
  "recurrenceEndUTC",
  "recurrenceEndUtc",
  "timeZone",
  "appointmentTimeZone",
  "isAllDay",
  "lastUpdate",
  "isDeleted",
  "isHidden"
];
var MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS = [...MHELP_APPOINTMENT_FIELDS, ...MHELP_APPOINTMENT_VARIANT_FIELDS];
var MHELP_APPOINTMENT_COUNTER_KEYS = ["TotalRows", "totalRows", "TotalResults", "totalResults"];
var MHELP_APPOINTMENT_COLLECTION_KEYS = ["results", "Results", "data", "Data"];
var MHELP_APPOINTMENT_ENVELOPE_KEYS = [...MHELP_APPOINTMENT_COUNTER_KEYS, ...MHELP_APPOINTMENT_COLLECTION_KEYS];
var MHELP_APPOINTMENT_TICKET_KEYS = ["TicketId", "TicketID", "ticketId", "ticketID"];
var MHELP_APPOINTMENT_PORTAL_KEYS = ["PortalId", "PortalID", "portalId", "portalID"];
var MHELP_APPOINTMENT_PAIRS = MHELP_APPOINTMENT_TICKET_KEYS.flatMap((ticket2) => MHELP_APPOINTMENT_PORTAL_KEYS.map((portal) => [ticket2, portal]));
var MHELP_APPOINTMENT_USER_FIELDS = ["UserId", "UserID", "userId", "userID"];
var MHELP_APPOINTMENT_USER_FORMATS = ["numeric", "uuid_like", "email_like", "other"];
var KINDS2 = ["absent", "null", "boolean", "integer", "number", "string", "array", "object", "other"];
var FORMATS2 = ["numeric", "iso_with_zone", "iso_without_zone", "dotnet", "other"];
var plain3 = (value2) => !!value2 && typeof value2 === "object" && !Array.isArray(value2);
var own2 = (value2, key2) => plain3(value2) && Object.hasOwn(value2, key2) ? value2[key2] : void 0;
var invalid3 = () => {
  throw Error("Unsupported mHelpDesk appointment evidence.");
};
var exact4 = (value2, keys3) => {
  if (!plain3(value2) || Object.keys(value2).length !== keys3.length || Object.keys(value2).some((key2) => !keys3.includes(key2))) invalid3();
  return value2;
};
function kind2(value2) {
  if (value2 === void 0) return "absent";
  if (value2 === null) return "null";
  if (Array.isArray(value2)) return "array";
  if (typeof value2 === "number") return Number.isSafeInteger(value2) ? "integer" : "number";
  return ["boolean", "string", "object"].includes(typeof value2) ? typeof value2 : "other";
}
function format2(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value2)) return "iso_with_zone";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value2)) return "iso_without_zone";
  if (/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value2)) return "dotnet";
  return "other";
}
function userFormat(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value2)) return "uuid_like";
  if (value2.length <= 320 && /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value2)) return "email_like";
  return "other";
}
var boundedCount = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 && value2 <= 1e6;
function count2(value2, max = 500) {
  if (!boundedCount(value2) || value2 > max) invalid3();
  return value2;
}
var positiveId2 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0;
function aliasConflict(row2, keys3) {
  const present = keys3.map((key2) => own2(row2, key2)).filter((value2) => value2 !== void 0);
  return present.length > 1 && present.slice(1).some((value2) => !Object.is(value2, present[0]));
}
function distribution2(values, classify) {
  const result = {};
  for (const value2 of values) {
    const key2 = classify(value2);
    result[key2] = (result[key2] || 0) + 1;
  }
  return result;
}
function counts(value2, keys3, size) {
  if (!plain3(value2) || Object.keys(value2).some((key2) => !keys3.includes(key2))) invalid3();
  const source = value2, result = {};
  for (const key2 of keys3) if (Object.hasOwn(source, key2)) {
    const n = count2(source[key2], size);
    if (n === 0) invalid3();
    result[key2] = n;
  }
  if (Object.values(result).reduce((n, next) => n + Number(next), 0) !== size) invalid3();
  return result;
}
function field2(values) {
  const strings2 = values.filter((value2) => typeof value2 === "string"), emptyStrings = strings2.filter((value2) => !value2.trim()).length;
  return { kinds: distribution2(values, kind2), formats: distribution2(strings2, (value2) => format2(value2)), emptyStrings, nonemptyStrings: strings2.length - emptyStrings };
}
function legacyStates(row2) {
  const e = plain3(row2.envelope) ? row2.envelope : {}, review = plain3(row2.reviewCounts) ? row2.reviewCounts : {};
  const valid = e.rootKind === "object" && e.resultsKind === "array" && e.totalRowsKind === "integer" && boundedCount(row2.reportedTotal) && typeof row2.sampledAppointments === "number" && row2.reportedTotal >= row2.sampledAppointments && ["alternateTotalRowsKind", "alternateTotalResultsKind", "alternateDataKind"].every((key2) => e[key2] === "absent");
  const completeness = !valid ? "unverified" : row2.reportedTotal === row2.sampledAppointments ? "complete" : "incomplete";
  const linkage2 = completeness !== "complete" || Number(row2.unverifiedLinkageCount) > 0 ? "unverified" : row2.exactMatchCount === 0 ? "no_match_in_window" : Number(row2.exactMatchCount) > 1 ? "ambiguous_matches" : Object.values(review).some((n) => Number(n) > 0) ? "review_required" : "single_structural_match";
  return { completeness, linkage: linkage2 };
}
function unavailableMhelpAppointmentVariants(totalTickets, createdAfter) {
  return projectMhelpAppointmentVariants({ ...unavailableMhelpAppointments(totalTickets, createdAfter), contract: MHELP_APPOINTMENT_VARIANT_CONTRACT }, totalTickets, createdAfter);
}
function describeMhelpAppointmentVariants(value2, selected, createdAfter) {
  const base2 = describeMhelpAppointments(value2, selected, createdAfter);
  if (base2.state !== "window_reviewed") return invalid3();
  const rawRows = own2(value2, "results"), rows4 = Array.isArray(rawRows) ? rawRows : [];
  for (const collection3 of [value2, ...MHELP_APPOINTMENT_COLLECTION_KEYS.map((key2) => own2(value2, key2))]) if (Array.isArray(collection3) && collection3.length > 500) throw Error("mHelpDesk returned an oversized appointment page.");
  const envelope = Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map((key2) => {
    const candidate = own2(value2, key2), counter = MHELP_APPOINTMENT_COUNTER_KEYS.includes(key2);
    return [key2, { kind: kind2(candidate), integerCount: counter && boundedCount(candidate) ? candidate : null, arrayEntries: !counter && Array.isArray(candidate) ? candidate.length : null }];
  }));
  const candidatePairs = { comparable: MHELP_APPOINTMENT_PAIRS.map(([ticket2, portal]) => rows4.filter((row2) => positiveId2(own2(row2, ticket2)) && positiveId2(own2(row2, portal))).length), matching: MHELP_APPOINTMENT_PAIRS.map(([ticket2, portal]) => rows4.filter((row2) => positiveId2(own2(row2, ticket2)) && positiveId2(own2(row2, portal)) && own2(row2, ticket2) === Number(selected.ticketId) && own2(row2, portal) === Number(selected.portalId)).length), ticketAliasConflicts: rows4.filter((row2) => aliasConflict(row2, MHELP_APPOINTMENT_TICKET_KEYS)).length, portalAliasConflicts: rows4.filter((row2) => aliasConflict(row2, MHELP_APPOINTMENT_PORTAL_KEYS)).length };
  const diagnostics = {
    contractState: "unresolved",
    envelope,
    candidatePairs,
    fields: Object.fromEntries(MHELP_APPOINTMENT_VARIANT_FIELDS.map((key2) => [key2, field2(rows4.map((row2) => own2(row2, key2)))])),
    rootArrayEntries: Array.isArray(value2) ? value2.length : null,
    rowKinds: distribution2(rows4, kind2),
    emptyObjectRows: rows4.filter((row2) => plain3(row2) && Object.keys(row2).length === 0).length,
    userReferenceFormats: Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map((key2) => [key2, distribution2(rows4.map((row2) => own2(row2, key2)).filter((v) => typeof v === "string"), (value3) => userFormat(value3))])),
    suppressedEnvelopeKeys: plain3(value2) ? Object.keys(value2).filter((key2) => !MHELP_APPOINTMENT_ENVELOPE_KEYS.includes(key2)).length : 0,
    suppressedRowKeys: rows4.reduce((n, row2) => n + (plain3(row2) ? Object.keys(row2).filter((key2) => !MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS.includes(key2)).length : 0), 0)
  };
  return projectMhelpAppointmentVariants({ ...base2, contract: MHELP_APPOINTMENT_VARIANT_CONTRACT, completeness: "unverified", linkage: "unverified", diagnostics }, 1, createdAfter);
}
function projectMhelpAppointmentVariants(value2, totalTickets, createdAfter) {
  if (!plain3(value2)) invalid3();
  const row2 = value2;
  if (row2.contract !== MHELP_APPOINTMENT_VARIANT_CONTRACT) invalid3();
  try {
    if (new TextEncoder().encode(JSON.stringify(value2)).length > 16e3) invalid3();
  } catch {
    invalid3();
  }
  if (row2.state === "selection_unavailable") {
    const base3 = projectMhelpAppointmentEvidence({ ...row2, contract: "cos-mhelpdesk-appointment-evidence-v1" }, totalTickets, createdAfter);
    if (base3.state !== "selection_unavailable") invalid3();
    return { ...base3, contract: MHELP_APPOINTMENT_VARIANT_CONTRACT };
  }
  if (row2.completeness !== "unverified" || row2.linkage !== "unverified") invalid3();
  const { diagnostics: rawDiagnostics, ...core } = row2;
  const base2 = projectMhelpAppointmentEvidence({ ...core, contract: "cos-mhelpdesk-appointment-evidence-v1", ...legacyStates(core) }, totalTickets, createdAfter);
  if (base2.state !== "window_reviewed") return invalid3();
  const d = exact4(rawDiagnostics, ["contractState", "candidatePairs", "fields", "envelope", "rootArrayEntries", "rowKinds", "suppressedEnvelopeKeys", "suppressedRowKeys", "emptyObjectRows", "userReferenceFormats"]);
  if (d.contractState !== "unresolved") invalid3();
  const sourceEnvelope = exact4(d.envelope, MHELP_APPOINTMENT_ENVELOPE_KEYS);
  const envelope = Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map((key2) => {
    const source = exact4(sourceEnvelope[key2], ["kind", "integerCount", "arrayEntries"]);
    if (!KINDS2.includes(source.kind)) invalid3();
    const counter = MHELP_APPOINTMENT_COUNTER_KEYS.includes(key2);
    const integerCount = source.integerCount === null ? null : count2(source.integerCount, 1e6), arrayEntries = source.arrayEntries === null ? null : count2(source.arrayEntries, 500);
    if (counter ? arrayEntries !== null || integerCount !== null && source.kind !== "integer" : integerCount !== null || source.kind === "array" !== (arrayEntries !== null)) invalid3();
    return [key2, { kind: source.kind, integerCount, arrayEntries }];
  }));
  const correspondence = { TotalRows: "totalRowsKind", totalRows: "alternateTotalRowsKind", totalResults: "alternateTotalResultsKind", results: "resultsKind", data: "alternateDataKind" };
  for (const [source, target] of Object.entries(correspondence)) if (envelope[source].kind !== base2.envelope[target]) invalid3();
  if (envelope.TotalRows.integerCount !== base2.reportedTotal || (envelope.results.arrayEntries ?? 0) !== base2.sampledAppointments) invalid3();
  const rootArrayEntries = d.rootArrayEntries === null ? null : count2(d.rootArrayEntries, 500);
  if (base2.envelope.rootKind === "array" !== (rootArrayEntries !== null)) invalid3();
  if (base2.envelope.rootKind !== "object" && MHELP_APPOINTMENT_ENVELOPE_KEYS.some((key2) => envelope[key2].kind !== "absent")) invalid3();
  const rowKinds = counts(d.rowKinds, KINDS2, base2.sampledAppointments), objectRows = rowKinds.object || 0;
  const emptyObjectRows = count2(d.emptyObjectRows, objectRows);
  const sourceFields3 = exact4(d.fields, MHELP_APPOINTMENT_VARIANT_FIELDS), fields4 = Object.fromEntries(MHELP_APPOINTMENT_VARIANT_FIELDS.map((key2) => {
    const source = exact4(sourceFields3[key2], ["kinds", "formats", "emptyStrings", "nonemptyStrings"]), kinds = counts(source.kinds, KINDS2, base2.sampledAppointments), formats = counts(source.formats, FORMATS2, kinds.string || 0);
    const emptyStrings = count2(source.emptyStrings, base2.sampledAppointments), nonemptyStrings = count2(source.nonemptyStrings, base2.sampledAppointments);
    if (emptyStrings + nonemptyStrings !== (kinds.string || 0)) invalid3();
    return [key2, { kinds, formats, emptyStrings, nonemptyStrings }];
  }));
  for (const f of [...Object.values(base2.fields), ...Object.values(fields4)]) if (base2.sampledAppointments - (f.kinds.absent || 0) > objectRows - emptyObjectRows) invalid3();
  const sourcePairs = exact4(d.candidatePairs, ["comparable", "matching", "ticketAliasConflicts", "portalAliasConflicts"]);
  const pairCounts = (value3) => {
    if (!Array.isArray(value3) || value3.length !== 16 || Object.keys(value3).length !== 16 || MHELP_APPOINTMENT_PAIRS.some((_, i) => !Object.hasOwn(value3, i))) invalid3();
    return value3.map((n) => count2(n, objectRows - emptyObjectRows));
  };
  const comparable = pairCounts(sourcePairs.comparable), matching = pairCounts(sourcePairs.matching);
  const fieldFor = (key2) => key2 in base2.fields ? base2.fields[key2] : fields4[key2];
  MHELP_APPOINTMENT_PAIRS.forEach(([ticket2, portal], i) => {
    if (matching[i] > comparable[i] || comparable[i] > Math.min(fieldFor(ticket2).kinds.integer || 0, fieldFor(portal).kinds.integer || 0)) invalid3();
  });
  if (matching[0] !== base2.exactMatchCount) invalid3();
  const candidatePairs = { comparable, matching, ticketAliasConflicts: count2(sourcePairs.ticketAliasConflicts, objectRows - emptyObjectRows), portalAliasConflicts: count2(sourcePairs.portalAliasConflicts, objectRows - emptyObjectRows) };
  for (const [keys3, n] of [[MHELP_APPOINTMENT_TICKET_KEYS, candidatePairs.ticketAliasConflicts], [MHELP_APPOINTMENT_PORTAL_KEYS, candidatePairs.portalAliasConflicts]]) if (n > Math.floor(keys3.reduce((sum, key2) => sum + base2.sampledAppointments - (fieldFor(key2).kinds.absent || 0), 0) / 2)) invalid3();
  const sourceUsers = exact4(d.userReferenceFormats, MHELP_APPOINTMENT_USER_FIELDS), userReferenceFormats = Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map((key2) => [key2, counts(sourceUsers[key2], MHELP_APPOINTMENT_USER_FORMATS, (key2 === "UserId" ? base2.fields.UserId : fields4[key2]).kinds.string || 0)]));
  const suppressedEnvelopeKeys = count2(d.suppressedEnvelopeKeys, 1e6), suppressedRowKeys = count2(d.suppressedRowKeys, 1e6);
  if (base2.envelope.rootKind !== "object" && suppressedEnvelopeKeys !== 0 || objectRows === emptyObjectRows && suppressedRowKeys !== 0) invalid3();
  return { ...base2, contract: MHELP_APPOINTMENT_VARIANT_CONTRACT, completeness: "unverified", linkage: "unverified", diagnostics: { contractState: "unresolved", candidatePairs, fields: fields4, envelope, rootArrayEntries, rowKinds, suppressedEnvelopeKeys, suppressedRowKeys, emptyObjectRows, userReferenceFormats } };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTicketPrivateSample.ts
var MHELP_TICKET_PRIVATE_SAMPLE = "ticket_private_sample_v1";
var MHELP_PRIVATE_SAMPLE_MAX_BYTES = 262144;
var MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT = "cos-mhelpdesk-ticket-private-sample-v1";
var MHELP_PRIVATE_APPOINTMENT_FIELDS = [...MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS, "Subject", "subject", "Description", "description"];
var MHELP_PRIVATE_ITEM_FIELDS = ["name", "Name", "description", "Description", "notes", "Notes", "quantity", "Quantity", "durationSeconds", "DurationSeconds"];
var MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS = ["ID", "Id", "id", ...MHELP_APPOINTMENT_TICKET_KEYS, ...MHELP_APPOINTMENT_PORTAL_KEYS, "UserId", "UserID", "userId", "userID", "StartUTC", "StartUtc", "startUTC", "startUtc", "EndUTC", "EndUtc", "endUTC", "endUtc", "Subject", "subject", "Description", "description"];
var KINDS3 = ["absent", "null", "boolean", "integer", "number", "string", "array", "object", "other"];
var FORMATS3 = ["numeric", "iso_with_zone", "iso_without_zone", "dotnet", "other"];
var plain4 = (value2) => !!value2 && typeof value2 === "object" && !Array.isArray(value2);
var own3 = (value2, key2) => plain4(value2) && Object.hasOwn(value2, key2) ? value2[key2] : void 0;
function invalid4() {
  throw Error("Unsupported mHelpDesk private ticket sample.");
}
function exact5(value2, keys3) {
  if (!plain4(value2) || Object.keys(value2).length !== keys3.length || Object.keys(value2).some((key2) => !keys3.includes(key2))) invalid4();
  return value2;
}
var positive = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0;
function id9(value2) {
  if (typeof value2 !== "string" || !/^[1-9]\d{0,14}$/.test(value2) || !Number.isSafeInteger(Number(value2))) invalid4();
  return value2;
}
function count3(value2, max = 500) {
  if (typeof value2 !== "number" || !Number.isSafeInteger(value2) || value2 < 0 || value2 > max) invalid4();
  return value2;
}
function validateMhelpPrivateSampleRequest(value2, now = /* @__PURE__ */ new Date()) {
  const row2 = exact5(value2, ["ticketNumber", "appointmentDay"]);
  id9(row2.ticketNumber);
  const window = mhelpPrivateAppointmentDay(row2.appointmentDay, now);
  return { request: { ticketNumber: row2.ticketNumber, appointmentDay: row2.appointmentDay }, window };
}
function common(input2, readAt) {
  return { contract: MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT, scope: "single_ticket_appointment_day", schema: "unverified", identityMapping: "unverified", sourceToCosMapping: "unverified", automaticSync: false, ticketWrites: false, readAt, request: input2.request, window: input2.window };
}
function unavailableMhelpPrivateSample(input2, reason, selection, readAt = (/* @__PURE__ */ new Date()).toISOString()) {
  return { ...common(input2, readAt), state: "selection_unavailable", reason, selection };
}
function secretLooking(value2) {
  if ((value2.match(/[A-Za-z0-9_+/=-]{40,}/g) || []).some((token) => /[A-Za-z]/.test(token) && /\d/.test(token))) return true;
  return /(?:\b(?:access[ _-]?token|refresh[ _-]?token|api[ _-]?key|client[ _-]?secret|password|passwd|authorization|bearer|session[ _-]?(?:key|token)|secret[ _-]?key)\b|\b(?:token|secret|key|passphrase|credential|cookie|session)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:sk[-_](?:live[-_]|test[-_])?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b|https?:\/\/[^\s/]+:[^\s/]+@|[?&](?:token|key|secret|signature|sig|password|auth)=)/i.test(value2);
}
function cell(value2, type) {
  if (value2 === void 0) return { state: "absent" };
  if (value2 === null) return { state: "null" };
  if (type === "identity") return positive(value2) ? { state: "value", value: value2 } : { state: "unsupported" };
  if (typeof value2 === "number") return Number.isFinite(value2) && (type === "recorded" ? Math.abs(value2) <= 1e9 : type === "user" ? positive(value2) : type === "time" && Number.isSafeInteger(value2)) ? { state: "value", value: value2 } : { state: "unsupported" };
  if (typeof value2 !== "string") return { state: "unsupported" };
  const limit = type === "text" ? 4e3 : type === "user" ? 500 : type === "time" ? 80 : 64;
  if (value2.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value2) || type !== "text" && /[\r\n\t]/.test(value2)) return { state: "unsupported" };
  if (secretLooking(value2)) return { state: "suppressed" };
  if (type === "recorded" && !/^[+-]?(?:\d{1,10}(?:\.\d{1,10})?|\.\d{1,10})$/.test(value2)) return { state: "unsupported" };
  return { state: "value", value: value2 };
}
var itemType = (key2) => ["quantity", "Quantity", "durationSeconds", "DurationSeconds"].includes(key2) ? "recorded" : "text";
var appointmentType = (key2) => ["Subject", "subject", "Description", "description"].includes(key2) ? "text" : /^[Uu]ser/.test(key2) ? "user" : /^[Ss]tart|^[Ee]nd/.test(key2) ? "time" : "identity";
function kind3(value2) {
  if (value2 === void 0) return "absent";
  if (value2 === null) return "null";
  if (Array.isArray(value2)) return "array";
  if (typeof value2 === "number") return Number.isSafeInteger(value2) ? "integer" : "number";
  return ["boolean", "string", "object"].includes(typeof value2) ? typeof value2 : "other";
}
function format3(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value2)) return "iso_with_zone";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value2)) return "iso_without_zone";
  if (/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value2)) return "dotnet";
  return "other";
}
function field3(values) {
  const kinds = {}, formats = {};
  for (const value2 of values) {
    const k = kind3(value2);
    kinds[k] = (kinds[k] || 0) + 1;
    if (typeof value2 === "string") {
      const f = format3(value2);
      formats[f] = (formats[f] || 0) + 1;
    }
  }
  const strings2 = values.filter((v) => typeof v === "string"), emptyStrings = strings2.filter((v) => !v.trim()).length;
  return { kinds, formats, emptyStrings, nonemptyStrings: strings2.length - emptyStrings };
}
function conflict2(row2, keys3) {
  if (!plain4(row2)) return false;
  const values = keys3.filter((key2) => Object.hasOwn(row2, key2)).map((key2) => row2[key2]);
  return values.length > 1 && values.slice(1).some((value2) => !Object.is(value2, values[0]));
}
function structure(value2, rows4, selected, createdAfter) {
  const variant = describeMhelpAppointmentVariants(value2, { ...selected, deleted: false }, createdAfter);
  if (variant.state !== "window_reviewed") invalid4();
  const d = variant.diagnostics;
  return {
    rootKind: kind3(value2),
    envelope: d.envelope,
    rowKinds: d.rowKinds,
    emptyObjectRows: d.emptyObjectRows,
    rootArrayEntries: d.rootArrayEntries,
    suppressedEnvelopeKeys: d.suppressedEnvelopeKeys,
    userReferenceFormats: d.userReferenceFormats,
    candidatePairs: d.candidatePairs,
    aliasConflicts: { identity: rows4.filter((row2) => conflict2(row2, aliasGroups[0])).length, user: rows4.filter((row2) => conflict2(row2, aliasGroups[3])).length, start: rows4.filter((row2) => conflict2(row2, aliasGroups[4])).length, end: rows4.filter((row2) => conflict2(row2, aliasGroups[5])).length },
    fields: Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_FIELDS.map((key2) => [key2, field3(rows4.map((row2) => own3(row2, key2)))])),
    suppressedRowKeys: rows4.reduce((n, row2) => n + (plain4(row2) ? Object.keys(row2).filter((key2) => !MHELP_PRIVATE_APPOINTMENT_FIELDS.includes(key2)).length : 0), 0)
  };
}
var aliasGroups = [["ID", "Id", "id"], MHELP_APPOINTMENT_TICKET_KEYS, MHELP_APPOINTMENT_PORTAL_KEYS, ["UserId", "UserID", "userId", "userID"], ["StartUTC", "StartUtc", "startUTC", "startUtc"], ["EndUTC", "EndUtc", "endUTC", "endUtc"]];
function matches(row2, selected) {
  if (!plain4(row2)) return false;
  if (aliasGroups.some((keys3) => {
    const values = keys3.filter((key2) => Object.hasOwn(row2, key2)).map((key2) => row2[key2]);
    return values.length > 1 && values.slice(1).some((value2) => !Object.is(value2, values[0]));
  })) return false;
  return [[MHELP_APPOINTMENT_TICKET_KEYS, selected.ticketId], [MHELP_APPOINTMENT_PORTAL_KEYS, selected.portalId]].every(([keys3, expected]) => {
    const values = keys3.filter((key2) => Object.hasOwn(row2, key2)).map((key2) => row2[key2]);
    return values.length > 0 && values.every((value2) => positive(value2) && value2 === Number(expected));
  });
}
function describeMhelpPrivateSample(input2, selected, detail, appointments, readAt = (/* @__PURE__ */ new Date()).toISOString(), credentialValues = []) {
  const safeCell = (value2, type) => typeof value2 === "string" && credentialValues.some((secret) => secret.length > 0 && value2.includes(secret)) ? { state: "suppressed" } : cell(value2, type);
  const rawItems = own3(detail, "items"), itemRows = Array.isArray(rawItems) ? rawItems : [];
  const items = { state: rawItems === void 0 ? "absent" : rawItems === null ? "null" : Array.isArray(rawItems) ? "reviewed" : "unsupported", totalEntries: Array.isArray(rawItems) ? rawItems.length : null, truncated: itemRows.length > 50, rows: itemRows.slice(0, 50).map((row2, index2) => {
    const belongs = plain4(row2) && [["ticketId", selected.ticketId], ["portalId", selected.portalId]].every(([key2, expected]) => {
      const v = own3(row2, key2);
      return v === void 0 || v === null || v === 0 || positive(v) && v === Number(expected);
    });
    return { index: index2, fields: Object.fromEntries(MHELP_PRIVATE_ITEM_FIELDS.map((key2) => [key2, belongs ? safeCell(own3(row2, key2), itemType(key2)) : { state: "unsupported" }])) };
  }) };
  for (const collection3 of [appointments, ...MHELP_APPOINTMENT_ENVELOPE_KEYS.map((key2) => own3(appointments, key2))]) if (Array.isArray(collection3) && collection3.length > 500) throw Error("mHelpDesk returned an oversized appointment page.");
  const rawRows = own3(appointments, "results"), rows4 = Array.isArray(rawRows) ? rawRows : [], total = own3(appointments, "TotalRows");
  const supported = plain4(appointments) && Array.isArray(rawRows) && typeof total === "number" && Number.isSafeInteger(total) && total >= rows4.length && total <= 1e6 && MHELP_APPOINTMENT_ENVELOPE_KEYS.every((key2) => key2 === "results" || key2 === "TotalRows" || !Object.hasOwn(appointments, key2));
  const completeness = !supported ? "unverified" : total === rows4.length ? "complete" : "incomplete";
  const matching = rows4.map((row2, index2) => ({ row: row2, index: index2 })).filter(({ row: row2 }) => matches(row2, selected)), visible = matching.slice(0, 50);
  return {
    ...common(input2, readAt),
    state: "sample_reviewed",
    selected: { portalId: selected.portalId, ticketId: selected.ticketId, ticketNumber: selected.ticketNumber },
    items,
    appointments: { state: "window_reviewed", completeness, sampledAppointments: rows4.length, matchingAppointments: matching.length, suppressedAppointments: rows4.length - visible.length, truncated: matching.length > 50, rows: visible.map(({ row: row2, index: index2 }) => ({ index: index2, fields: Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS.map((key2) => [key2, safeCell(own3(row2, key2), appointmentType(key2))])) })), structure: structure(appointments, rows4, selected, input2.window.startDateUtc) }
  };
}
function denseRows(value2, max = 50) {
  return Array.isArray(value2) && value2.length <= max && Object.keys(value2).length === value2.length && Array.from({ length: value2.length }, (_, i) => Object.hasOwn(value2, i)).every(Boolean);
}
function projectCell(value2, type) {
  if (!plain4(value2)) invalid4();
  if (value2.state === "value") {
    exact5(value2, ["state", "value"]);
    const safe6 = cell(value2.value, type);
    if (safe6.state !== "value") invalid4();
    return safe6;
  }
  exact5(value2, ["state"]);
  if (!["absent", "null", "unsupported", "suppressed"].includes(String(value2.state))) invalid4();
  return { state: value2.state };
}
function projectCounts(value2, keys3, size) {
  if (!plain4(value2) || Object.keys(value2).some((key2) => !keys3.includes(key2))) invalid4();
  const counts2 = {};
  for (const key2 of keys3) if (Object.hasOwn(value2, key2)) {
    const n = count3(value2[key2], size);
    if (!n) invalid4();
    counts2[key2] = n;
  }
  if (Object.values(counts2).reduce((n, v) => n + Number(v), 0) !== size) invalid4();
  return counts2;
}
function projectStructure(value2, size) {
  const row2 = exact5(value2, ["rootKind", "envelope", "fields", "suppressedRowKeys", "rowKinds", "emptyObjectRows", "rootArrayEntries", "suppressedEnvelopeKeys", "userReferenceFormats", "candidatePairs", "aliasConflicts"]);
  if (!KINDS3.includes(row2.rootKind)) invalid4();
  const rawEnvelope = exact5(row2.envelope, MHELP_APPOINTMENT_ENVELOPE_KEYS), envelope = Object.fromEntries(MHELP_APPOINTMENT_ENVELOPE_KEYS.map((key2) => {
    const d = exact5(rawEnvelope[key2], ["kind", "integerCount", "arrayEntries"]);
    if (!KINDS3.includes(d.kind)) invalid4();
    const counter = !["results", "Results", "data", "Data"].includes(key2), integerCount = d.integerCount === null ? null : count3(d.integerCount, 1e6), arrayEntries = d.arrayEntries === null ? null : count3(d.arrayEntries);
    if (counter ? arrayEntries !== null || integerCount !== null && d.kind !== "integer" : integerCount !== null || d.kind === "array" !== (arrayEntries !== null)) invalid4();
    return [key2, { kind: d.kind, integerCount, arrayEntries }];
  }));
  if ((envelope.results.arrayEntries ?? 0) !== size) invalid4();
  const rawFields = exact5(row2.fields, MHELP_PRIVATE_APPOINTMENT_FIELDS), fields4 = Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_FIELDS.map((key2) => {
    const d = exact5(rawFields[key2], ["kinds", "formats", "emptyStrings", "nonemptyStrings"]);
    if (!plain4(d.kinds) || Object.keys(d.kinds).some((k) => !KINDS3.includes(k))) invalid4();
    const kinds = {};
    for (const k of KINDS3) if (Object.hasOwn(d.kinds, k)) {
      const n = count3(d.kinds[k], size);
      if (!n) invalid4();
      kinds[k] = n;
    }
    if (Object.values(kinds).reduce((n, v) => n + v, 0) !== size) invalid4();
    const emptyStrings = count3(d.emptyStrings, size), nonemptyStrings = count3(d.nonemptyStrings, size);
    if (emptyStrings + nonemptyStrings !== (kinds.string || 0)) invalid4();
    const formats = projectCounts(d.formats, FORMATS3, kinds.string || 0);
    return [key2, { kinds, formats, emptyStrings, nonemptyStrings }];
  }));
  const rowKinds = projectCounts(row2.rowKinds, KINDS3, size), objectRows = rowKinds.object || 0, emptyObjectRows = count3(row2.emptyObjectRows, objectRows), rootArrayEntries = row2.rootArrayEntries === null ? null : count3(row2.rootArrayEntries);
  if (row2.rootKind === "array" !== (rootArrayEntries !== null) || row2.rootKind !== "object" && MHELP_APPOINTMENT_ENVELOPE_KEYS.some((key2) => envelope[key2].kind !== "absent")) invalid4();
  const rawUsers = exact5(row2.userReferenceFormats, MHELP_APPOINTMENT_USER_FIELDS), userReferenceFormats = Object.fromEntries(MHELP_APPOINTMENT_USER_FIELDS.map((key2) => [key2, projectCounts(rawUsers[key2], MHELP_APPOINTMENT_USER_FORMATS, fields4[key2].kinds.string || 0)]));
  const rawPairs = exact5(row2.candidatePairs, ["comparable", "matching", "ticketAliasConflicts", "portalAliasConflicts"]);
  const pairCounts = (v) => {
    if (!Array.isArray(v) || v.length !== 16 || Object.keys(v).length !== 16 || MHELP_APPOINTMENT_PAIRS.some((_, i) => !Object.hasOwn(v, i))) invalid4();
    return v.map((n) => count3(n, objectRows - emptyObjectRows));
  };
  const comparable = pairCounts(rawPairs.comparable), matching = pairCounts(rawPairs.matching);
  MHELP_APPOINTMENT_PAIRS.forEach(([ticket2, portal], i) => {
    if (matching[i] > comparable[i] || comparable[i] > Math.min(fields4[ticket2].kinds.integer || 0, fields4[portal].kinds.integer || 0)) invalid4();
  });
  const candidatePairs = { comparable, matching, ticketAliasConflicts: count3(rawPairs.ticketAliasConflicts, objectRows - emptyObjectRows), portalAliasConflicts: count3(rawPairs.portalAliasConflicts, objectRows - emptyObjectRows) };
  const rawConflicts = exact5(row2.aliasConflicts, ["identity", "user", "start", "end"]), aliasConflicts = { identity: count3(rawConflicts.identity, objectRows - emptyObjectRows), user: count3(rawConflicts.user, objectRows - emptyObjectRows), start: count3(rawConflicts.start, objectRows - emptyObjectRows), end: count3(rawConflicts.end, objectRows - emptyObjectRows) };
  for (const f of Object.values(fields4)) if (size - (f.kinds.absent || 0) > objectRows - emptyObjectRows) invalid4();
  const suppressedEnvelopeKeys = count3(row2.suppressedEnvelopeKeys, 1e6), suppressedRowKeys = count3(row2.suppressedRowKeys, 1e6);
  if (row2.rootKind !== "object" && suppressedEnvelopeKeys !== 0 || objectRows === emptyObjectRows && suppressedRowKeys !== 0) invalid4();
  return { rootKind: row2.rootKind, envelope, fields: fields4, suppressedRowKeys, rowKinds, emptyObjectRows, rootArrayEntries, suppressedEnvelopeKeys, userReferenceFormats, candidatePairs, aliasConflicts };
}
function userFormat2(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value2)) return "uuid_like";
  if (value2.length <= 320 && /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value2)) return "email_like";
  return "other";
}
function checkVisibleConsistency(rows4, structure2, matching) {
  const nonempty = (structure2.rowKinds.object || 0) - structure2.emptyObjectRows;
  const conflicts = Math.max(structure2.candidatePairs.ticketAliasConflicts, structure2.candidatePairs.portalAliasConflicts, ...Object.values(structure2.aliasConflicts));
  if (matching > nonempty - conflicts || matching > structure2.candidatePairs.matching.reduce((n, v) => n + v, 0)) invalid4();
  for (const key2 of MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS) {
    const cells = rows4.map((row2) => row2.fields[key2]), observed2 = {}, formats = {};
    let empty2 = 0, nonemptyStrings = 0;
    for (const c of cells) {
      if (c.state === "value") {
        const k = kind3(c.value);
        observed2[k] = (observed2[k] || 0) + 1;
        if (typeof c.value === "string") {
          const f = format3(c.value);
          formats[f] = (formats[f] || 0) + 1;
          if (c.value.trim()) nonemptyStrings++;
          else empty2++;
        }
      } else if (c.state === "absent" || c.state === "null") observed2[c.state] = (observed2[c.state] || 0) + 1;
      else if (c.state === "suppressed") observed2.string = (observed2.string || 0) + 1;
    }
    const field5 = structure2.fields[key2];
    if (Object.entries(observed2).some(([k, n]) => n > (field5.kinds[k] || 0)) || Object.entries(formats).some(([f, n]) => n > (field5.formats[f] || 0)) || empty2 > field5.emptyStrings || nonemptyStrings > field5.nonemptyStrings || cells.filter((c) => c.state !== "absent").length > Object.values(field5.kinds).reduce((n, v) => n + v, 0) - (field5.kinds.absent || 0)) invalid4();
  }
  for (const key2 of MHELP_APPOINTMENT_USER_FIELDS) {
    const counts2 = {};
    for (const row2 of rows4) {
      const c = row2.fields[key2];
      if (c.state === "value" && typeof c.value === "string") {
        const format6 = userFormat2(c.value);
        counts2[format6] = (counts2[format6] || 0) + 1;
      }
    }
    if (MHELP_APPOINTMENT_USER_FORMATS.some((format6) => (counts2[format6] || 0) > (structure2.userReferenceFormats[key2][format6] || 0))) invalid4();
  }
  MHELP_APPOINTMENT_PAIRS.forEach(([ticket2, portal], i) => {
    const visible = rows4.filter((row2) => row2.fields[ticket2].state === "value" && row2.fields[portal].state === "value").length;
    if (visible > structure2.candidatePairs.comparable[i] || visible > structure2.candidatePairs.matching[i]) invalid4();
  });
}
function projectMhelpPrivateSample(value2) {
  if (!plain4(value2) || new TextEncoder().encode(JSON.stringify(value2)).length > MHELP_PRIVATE_SAMPLE_MAX_BYTES) invalid4();
  const commonKeys = ["contract", "scope", "schema", "identityMapping", "sourceToCosMapping", "automaticSync", "ticketWrites", "readAt", "request", "window", "state"];
  if (value2.contract !== MHELP_TICKET_PRIVATE_SAMPLE_CONTRACT || value2.scope !== "single_ticket_appointment_day" || value2.schema !== "unverified" || value2.identityMapping !== "unverified" || value2.sourceToCosMapping !== "unverified" || value2.automaticSync !== false || value2.ticketWrites !== false || typeof value2.readAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value2.readAt) || !Number.isFinite(Date.parse(value2.readAt))) invalid4();
  const input2 = validateMhelpPrivateSampleRequest(value2.request, new Date(value2.readAt)), window = exact5(value2.window, Object.keys(input2.window));
  for (const key2 of Object.keys(input2.window)) if (window[key2] !== input2.window[key2]) invalid4();
  if (value2.state === "selection_unavailable") {
    exact5(value2, [...commonKeys, "reason", "selection"]);
    if (!["ticket_not_found", "ambiguous_ticket_number", "incomplete_ticket_page"].includes(String(value2.reason))) invalid4();
    const selection2 = exact5(value2.selection, ["pageLimit", "sampledTickets", "reportedTotal", "matchingTickets"]), sampledTickets = count3(selection2.sampledTickets), reportedTotal = count3(selection2.reportedTotal, 1e6), matchingTickets = count3(selection2.matchingTickets, sampledTickets);
    if (selection2.pageLimit !== 500 || reportedTotal < sampledTickets || (value2.reason === "incomplete_ticket_page" ? reportedTotal === sampledTickets : reportedTotal !== sampledTickets) || value2.reason === "ticket_not_found" && matchingTickets !== 0 || value2.reason === "ambiguous_ticket_number" && matchingTickets < 2) invalid4();
    return unavailableMhelpPrivateSample(input2, value2.reason, { pageLimit: 500, sampledTickets, reportedTotal, matchingTickets }, value2.readAt);
  }
  exact5(value2, [...commonKeys, "selected", "items", "appointments"]);
  if (value2.state !== "sample_reviewed") invalid4();
  const selection = exact5(value2.selected, ["portalId", "ticketId", "ticketNumber"]), selected = { portalId: id9(selection.portalId), ticketId: id9(selection.ticketId), ticketNumber: id9(selection.ticketNumber) };
  if (selected.ticketNumber !== input2.request.ticketNumber) invalid4();
  const sourceItems = exact5(value2.items, ["state", "totalEntries", "truncated", "rows"]);
  if (!["reviewed", "absent", "null", "unsupported"].includes(String(sourceItems.state)) || !denseRows(sourceItems.rows)) invalid4();
  const totalEntries = sourceItems.totalEntries === null ? null : count3(sourceItems.totalEntries, 1e6);
  if (sourceItems.state === "reviewed" ? totalEntries === null || sourceItems.rows.length !== Math.min(totalEntries, 50) || sourceItems.truncated !== totalEntries > 50 : totalEntries !== null || sourceItems.rows.length !== 0 || sourceItems.truncated !== false) invalid4();
  const itemRows = sourceItems.rows.map((v, i) => {
    const row2 = exact5(v, ["index", "fields"]);
    if (row2.index !== i) invalid4();
    const fields4 = exact5(row2.fields, MHELP_PRIVATE_ITEM_FIELDS);
    return { index: i, fields: Object.fromEntries(MHELP_PRIVATE_ITEM_FIELDS.map((key2) => [key2, projectCell(fields4[key2], itemType(key2))])) };
  });
  const a = exact5(value2.appointments, ["state", "completeness", "sampledAppointments", "matchingAppointments", "suppressedAppointments", "truncated", "rows", "structure"]);
  if (a.state !== "window_reviewed" || !["complete", "incomplete", "unverified"].includes(String(a.completeness)) || !denseRows(a.rows)) invalid4();
  const sampledAppointments = count3(a.sampledAppointments), matchingAppointments = count3(a.matchingAppointments, sampledAppointments), struct = projectStructure(a.structure, sampledAppointments), suppressedAppointments = count3(a.suppressedAppointments, sampledAppointments);
  const env = struct.envelope, supported = struct.rootKind === "object" && env.results.kind === "array" && env.TotalRows.integerCount !== null && env.TotalRows.integerCount >= sampledAppointments && MHELP_APPOINTMENT_ENVELOPE_KEYS.every((key2) => key2 === "results" || key2 === "TotalRows" || env[key2].kind === "absent");
  const completeness = !supported ? "unverified" : env.TotalRows.integerCount === sampledAppointments ? "complete" : "incomplete";
  if (a.completeness !== completeness || a.rows.length !== Math.min(matchingAppointments, 50) || suppressedAppointments !== sampledAppointments - a.rows.length || a.truncated !== matchingAppointments > 50) invalid4();
  let previous = -1;
  const appointmentRows = a.rows.map((v) => {
    const row2 = exact5(v, ["index", "fields"]), index2 = count3(row2.index, sampledAppointments - 1);
    if (index2 <= previous) invalid4();
    previous = index2;
    const source = exact5(row2.fields, MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS), fields4 = Object.fromEntries(MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS.map((key2) => [key2, projectCell(source[key2], appointmentType(key2))]));
    const literal = {};
    for (const key2 of MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS) {
      const c = fields4[key2];
      if (c.state === "value") literal[key2] = c.value;
      else if (c.state !== "absent") literal[key2] = null;
    }
    if (!matches(literal, selected)) invalid4();
    return { index: index2, fields: fields4 };
  });
  checkVisibleConsistency(appointmentRows, struct, matchingAppointments);
  return { ...common(input2, value2.readAt), state: "sample_reviewed", selected, items: { state: sourceItems.state, totalEntries, truncated: sourceItems.truncated, rows: itemRows }, appointments: { state: "window_reviewed", completeness, sampledAppointments, matchingAppointments, suppressedAppointments, truncated: a.truncated, rows: appointmentRows, structure: struct } };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTicketDetail.ts
var MHELP_TICKET_DETAIL_EVIDENCE = "ticket_detail_structure_v1";
var CONTRACT2 = "cos-mhelpdesk-ticket-detail-evidence-v1";
var SCOPE5 = "single_server_selected_ticket";
var KINDS4 = ["absent", "null", "boolean", "integer", "number", "string", "array", "object", "other"];
var FORMATS4 = ["numeric", "iso_with_zone", "iso_without_zone", "dotnet", "other"];
var FIELDS2 = ["subject", "summary", "comment", "customerId", "serviceLocationId", "categoryId", "priority", "typeId", "typeName", "statusId", "customStatusId", "ticketStatus", "assignedTo", "deleted", "creationDate", "lastModDate", "scheduledDate", "neededBy", "appointmentCount", "estimatedTime", "lastCalledDate", "nextCallDate", "parentTicketId", "originalTicketId", "recurringRuleId", "generatedByRecurring", "businessUnitId"];
var NESTED_FIELDS = {
  items: ["ticketItemId", "ticketId", "portalId", "priceListId", "priceListTypeId", "name", "description", "quantity", "currentStatus", "notes", "startTime", "dateEntry", "durationSeconds", "groupId", "lastUpdateUTC", "sortNumber"],
  customFields: ["id", "customFieldId", "fieldValue", "fieldLabel", "sortOrder", "isRequired"],
  // Only POST/PUT document equipment: array[number]. Presence in a GET, even
  // numeric entries, cannot prove its schema, asset identity, or workflow meaning.
  equipment: []
};
var LIMIT = 50;
var MAX_BYTES = 16e3;
var plain5 = (value2) => !!value2 && typeof value2 === "object" && !Array.isArray(value2);
var own4 = (row2, key2) => plain5(row2) && Object.hasOwn(row2, key2) ? row2[key2] : void 0;
function kind4(value2) {
  if (value2 === void 0) return "absent";
  if (value2 === null) return "null";
  if (Array.isArray(value2)) return "array";
  if (typeof value2 === "number") return Number.isSafeInteger(value2) ? "integer" : "number";
  return ["boolean", "string", "object"].includes(typeof value2) ? typeof value2 : "other";
}
function format4(value2) {
  if (/^\d{1,16}$/.test(value2)) return "numeric";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value2)) return "iso_with_zone";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(value2)) return "iso_without_zone";
  if (/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(value2)) return "dotnet";
  return "other";
}
function distribution3(values, classify) {
  const result = {};
  for (const value2 of values) {
    const key2 = classify(value2);
    result[key2] = (result[key2] || 0) + 1;
  }
  return result;
}
function field4(values) {
  const strings2 = values.filter((value2) => typeof value2 === "string"), emptyStrings = strings2.filter((value2) => !value2.trim()).length;
  return { kinds: distribution3(values, kind4), formats: distribution3(strings2, (value2) => format4(value2)), emptyStrings, nonemptyStrings: strings2.length - emptyStrings };
}
function collection(row2, key2) {
  const value2 = own4(row2, key2), entries = Array.isArray(value2) ? value2.slice(0, LIMIT) : [];
  return {
    kinds: distribution3([value2], kind4),
    emptyArrays: Number(Array.isArray(value2) && value2.length === 0),
    nonemptyArrays: Number(Array.isArray(value2) && value2.length > 0),
    totalEntries: Array.isArray(value2) ? value2.length : 0,
    sampledEntries: entries.length,
    entryKinds: distribution3(entries, kind4),
    fields: Object.fromEntries(NESTED_FIELDS[key2].map((key3) => [key3, field4(entries.map((entry) => own4(entry, key3)))]))
  };
}
function availability(fields4) {
  return {
    description: ["subject", "summary", "comment"].some((key2) => fields4[key2].nonemptyStrings > 0) ? "nonempty_text_present" : "nonempty_text_absent",
    site: "unresolved_no_join",
    equipment: "unverified_write_model_candidate",
    schedule: "unverified_deprecated_get_fields",
    items: "unmapped_structures_only",
    customFields: "unmapped_structures_only"
  };
}
function unavailableMhelpTicketDetail(totalTickets) {
  return projectMhelpTicketDetailEvidence({ contract: CONTRACT2, scope: SCOPE5, state: "selection_unavailable", reason: totalTickets === 0 ? "empty_window" : "ambiguous_window", sampledTickets: 0 }, totalTickets);
}
function describeMhelpTicketDetail(value2) {
  const fields4 = Object.fromEntries(FIELDS2.map((key2) => [key2, field4([own4(value2, key2)])]));
  return projectMhelpTicketDetailEvidence({
    contract: CONTRACT2,
    scope: SCOPE5,
    state: "detail_verified",
    sampledTickets: 1,
    nestedSampleLimit: LIMIT,
    fields: fields4,
    collections: Object.fromEntries(Object.keys(NESTED_FIELDS).map((key2) => [key2, collection(value2, key2)])),
    availability: availability(fields4)
  }, 1);
}
function projectMhelpTicketDetailEvidence(value2, totalTickets) {
  const invalid5 = () => {
    throw Error("Unsupported mHelpDesk ticket detail evidence.");
  };
  const exact8 = (value3, keys3) => {
    if (!plain5(value3) || Object.keys(value3).length !== keys3.length || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    return value3;
  };
  const integer = (value3, max = LIMIT) => {
    if (typeof value3 !== "number" || !Number.isSafeInteger(value3) || value3 < 0 || value3 > max) invalid5();
    return value3;
  };
  const counters = (value3, keys3, size) => {
    if (!plain5(value3) || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    const source = value3, result2 = {};
    for (const key2 of keys3) if (Object.hasOwn(source, key2)) {
      const n = integer(source[key2], size);
      if (n === 0) invalid5();
      result2[key2] = n;
    }
    if (Object.values(result2).reduce((sum, n) => sum + Number(n), 0) !== size) invalid5();
    return result2;
  };
  const descriptor = (value3, size) => {
    const row3 = exact8(value3, ["kinds", "formats", "emptyStrings", "nonemptyStrings"]), kinds = counters(row3.kinds, KINDS4, size), formats = counters(row3.formats, FORMATS4, kinds.string || 0);
    const emptyStrings = integer(row3.emptyStrings, size), nonemptyStrings = integer(row3.nonemptyStrings, size);
    if (emptyStrings + nonemptyStrings !== (kinds.string || 0)) invalid5();
    return { kinds, formats, emptyStrings, nonemptyStrings };
  };
  integer(totalTickets, 500);
  if (!plain5(value2)) invalid5();
  const row2 = value2;
  if (row2.contract !== CONTRACT2 || row2.scope !== SCOPE5) invalid5();
  if (row2.state === "selection_unavailable") {
    exact8(row2, ["contract", "scope", "state", "reason", "sampledTickets"]);
    if (totalTickets === 1 || row2.sampledTickets !== 0 || row2.reason !== (totalTickets === 0 ? "empty_window" : "ambiguous_window")) invalid5();
    return { contract: CONTRACT2, scope: SCOPE5, state: "selection_unavailable", reason: row2.reason, sampledTickets: 0 };
  }
  exact8(row2, ["contract", "scope", "state", "sampledTickets", "nestedSampleLimit", "fields", "collections", "availability"]);
  if (row2.state !== "detail_verified" || totalTickets !== 1 || row2.sampledTickets !== 1 || row2.nestedSampleLimit !== LIMIT) invalid5();
  const inputFields = exact8(row2.fields, FIELDS2), fields4 = Object.fromEntries(FIELDS2.map((key2) => [key2, descriptor(inputFields[key2], 1)]));
  const inputCollections = exact8(row2.collections, Object.keys(NESTED_FIELDS));
  const collections = Object.fromEntries(Object.keys(NESTED_FIELDS).map((key2) => {
    const source = exact8(inputCollections[key2], ["kinds", "emptyArrays", "nonemptyArrays", "totalEntries", "sampledEntries", "entryKinds", "fields"]);
    const kinds = counters(source.kinds, KINDS4, 1), emptyArrays = integer(source.emptyArrays, 1), nonemptyArrays = integer(source.nonemptyArrays, 1), totalEntries = integer(source.totalEntries, 1e6);
    const sampledEntries = integer(source.sampledEntries), entryKinds = counters(source.entryKinds, KINDS4, sampledEntries);
    if (emptyArrays + nonemptyArrays !== (kinds.array || 0) || totalEntries < nonemptyArrays || totalEntries === 0 !== (nonemptyArrays === 0) || sampledEntries !== Math.min(totalEntries, LIMIT)) invalid5();
    const input2 = exact8(source.fields, NESTED_FIELDS[key2]);
    const fields5 = Object.fromEntries(NESTED_FIELDS[key2].map((field5) => [field5, descriptor(input2[field5], sampledEntries)]));
    if (Object.values(fields5).some((field5) => (field5.kinds.absent || 0) < sampledEntries - (entryKinds.object || 0))) invalid5();
    return [key2, { kinds, emptyArrays, nonemptyArrays, totalEntries, sampledEntries, entryKinds, fields: fields5 }];
  }));
  const available = availability(fields4), inputAvailability = exact8(row2.availability, Object.keys(available));
  for (const key2 of Object.keys(available)) if (inputAvailability[key2] !== available[key2]) invalid5();
  const result = { contract: CONTRACT2, scope: SCOPE5, state: "detail_verified", sampledTickets: 1, nestedSampleLimit: LIMIT, fields: fields4, collections, availability: available };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) invalid5();
  return result;
}
var CORE_FIELDS = ["portalId", "ticketId", "ticketNumber", "creationDate", "lastModDate", "deleted", "statusId", "assignedTo"];
function describeMhelpTicketDetailFailure(value2) {
  return Object.fromEntries(["root", "data", "results"].map((key2) => {
    const row2 = key2 === "root" ? value2 : own4(value2, key2);
    return [key2, { kind: kind4(row2), fields: Object.fromEntries(CORE_FIELDS.map((field5) => [field5, kind4(own4(row2, field5))])) }];
  }));
}
function projectMhelpTicketDetailFailure(value2) {
  const safeKind = (value3) => KINDS4.includes(value3) ? value3 : "other";
  return Object.fromEntries(["root", "data", "results"].map((key2) => {
    const row2 = own4(value2, key2), fields4 = own4(row2, "fields");
    return [key2, { kind: safeKind(own4(row2, "kind")), fields: Object.fromEntries(CORE_FIELDS.map((field5) => [field5, safeKind(own4(fields4, field5))])) }];
  }));
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTicketSchema.ts
var FIELDS3 = {
  ticketTypes: ["typeId", "portalId", "typeName", "isActive"],
  ticketStatuses: ["statusId", "statusText", "displayText", "parentId", "canBeParent"],
  tickets: ["ticketId", "ticketNumber", "portalId", "typeId", "typeName", "statusId", "customStatusId", "deleted", "creationDate", "lastModDate", "customerId", "serviceLocationId", "assignedTo"]
};
var KINDS5 = ["absent", "null", "boolean", "integer", "number", "string", "array", "object", "other"];
var FORMATS5 = ["numeric", "iso_with_zone", "iso_without_zone", "dotnet", "other"];
var plain6 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function kind5(v) {
  if (v === void 0) return "absent";
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isSafeInteger(v) ? "integer" : "number";
  return ["boolean", "string", "object"].includes(typeof v) ? typeof v : "other";
}
function format5(v) {
  if (/^\d{1,16}$/.test(v)) return "numeric";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(v)) return "iso_with_zone";
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?$/.test(v)) return "iso_without_zone";
  if (/^\/Date\(-?\d{1,16}(?:[+-]\d{4})?\)\/$/.test(v)) return "dotnet";
  return "other";
}
var count4 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e6 ? v : null;
function collection2(value2, section) {
  const rows4 = Array.isArray(value2) ? value2.slice(0, 50) : [];
  return {
    kind: kind5(value2),
    length: Array.isArray(value2) ? count4(value2.length) : null,
    sampled: rows4.length,
    fields: Object.fromEntries((rows4.length ? FIELDS3[section] : []).map((field5) => {
      const kinds = Object.fromEntries(KINDS5.map((k) => [k, 0]));
      const formats = Object.fromEntries(FORMATS5.map((k) => [k, 0]));
      for (const row2 of rows4) {
        const v = plain6(row2) ? row2[field5] : void 0;
        kinds[kind5(v)]++;
        if (typeof v === "string") formats[format5(v)]++;
      }
      return [field5, { kinds: Object.fromEntries(Object.entries(kinds).filter(([, n]) => n > 0)), formats: Object.fromEntries(Object.entries(formats).filter(([, n]) => n > 0)) }];
    }))
  };
}
function describeMhelpTicketSchema(value2, section) {
  const row2 = plain6(value2) ? value2 : {};
  return {
    kind: kind5(value2),
    totalRowsKind: kind5(row2.totalRows),
    totalRows: count4(row2.totalRows),
    topLevel: collection2(value2, section),
    data: collection2(row2.data, section),
    results: collection2(row2.results, section)
  };
}
function projectMhelpTicketSchema(value2) {
  if (!plain6(value2)) return null;
  const safeKind = (v) => KINDS5.includes(v) ? v : "other";
  const result = {};
  for (const section of Object.keys(FIELDS3)) {
    const row2 = value2[section];
    if (!plain6(row2)) continue;
    const output = { kind: safeKind(row2.kind), totalRowsKind: safeKind(row2.totalRowsKind), totalRows: count4(row2.totalRows) };
    for (const key2 of ["topLevel", "data", "results"]) {
      const source = row2[key2];
      if (!plain6(source)) continue;
      const fields4 = plain6(source.fields) ? source.fields : {};
      output[key2] = {
        kind: safeKind(source.kind),
        length: count4(source.length),
        sampled: typeof source.sampled === "number" && source.sampled <= 50 ? count4(source.sampled) : null,
        fields: Object.fromEntries((typeof source.sampled === "number" && source.sampled > 0 && source.sampled <= 50 ? FIELDS3[section] : []).map((field5) => {
          const f = plain6(fields4[field5]) ? fields4[field5] : {};
          const kinds = plain6(f.kinds) ? f.kinds : {}, formats = plain6(f.formats) ? f.formats : {};
          const bounded = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 50 ? n : 0;
          return [field5, { kinds: Object.fromEntries(KINDS5.filter((k) => bounded(kinds[k]) > 0).map((k) => [k, bounded(kinds[k])])), formats: Object.fromEntries(FORMATS5.filter((k) => bounded(formats[k]) > 0).map((k) => [k, bounded(formats[k])])) }];
        }))
      };
    }
    result[section] = output;
  }
  if (!Object.keys(result).length) return null;
  if (new TextEncoder().encode(JSON.stringify(result)).length > 6e3) {
    for (const section of Object.keys(result)) {
      const row2 = result[section];
      for (const key2 of ["topLevel", "data", "results"]) if (plain6(row2[key2])) {
        const source = row2[key2];
        row2[key2] = { kind: source.kind, length: source.length, sampled: source.sampled };
      }
    }
    result.truncated = true;
  }
  return result;
}
var MHELP_OPERATIONAL_EVIDENCE = "operational_structure_v1";
var OPERATIONAL_FIELDS = ["subject", "summary", "comment", "scheduledDate", "neededBy", "serviceLocationId"];
var NESTED_FIELDS2 = {
  items: ["ticketItemId", "priceListId", "priceListTypeId", "name", "description", "quantity"],
  customFields: ["customFieldId", "fieldValue", "fieldLabel"]
};
var SAMPLE_LIMIT = 50;
var MAX_EVIDENCE_BYTES = 12e3;
var own5 = (row2, key2) => plain6(row2) && Object.hasOwn(row2, key2) ? row2[key2] : void 0;
function distribution4(values, classify) {
  const result = {};
  for (const value2 of values) {
    const key2 = classify(value2);
    result[key2] = (result[key2] || 0) + 1;
  }
  return result;
}
function fieldEvidence(values) {
  const strings2 = values.filter((value2) => typeof value2 === "string");
  const emptyStrings = strings2.filter((value2) => !value2.trim()).length;
  return { kinds: distribution4(values, kind5), formats: distribution4(strings2, (value2) => format5(value2)), emptyStrings, nonemptyStrings: strings2.length - emptyStrings };
}
function operationalCollection(rows4, key2) {
  const values = rows4.map((row2) => own5(row2, key2)), arrays = values.filter(Array.isArray), entries = [];
  let totalEntries = 0;
  for (const array2 of arrays) {
    totalEntries += array2.length;
    entries.push(...array2.slice(0, SAMPLE_LIMIT - entries.length));
  }
  return {
    kinds: distribution4(values, kind5),
    emptyArrays: arrays.filter((array2) => array2.length === 0).length,
    nonemptyArrays: arrays.filter((array2) => array2.length > 0).length,
    totalEntries,
    sampledEntries: entries.length,
    entryKinds: distribution4(entries, kind5),
    fields: Object.fromEntries(NESTED_FIELDS2[key2].map((field5) => [field5, fieldEvidence(entries.map((row2) => own5(row2, field5)))]))
  };
}
function describeMhelpOperationalEvidence(firstPage, totalTickets) {
  const rows4 = firstPage.slice(0, SAMPLE_LIMIT);
  const result = {
    contract: "cos-mhelpdesk-operational-evidence-v1",
    scope: "first_ticket_page",
    ticketSampleLimit: SAMPLE_LIMIT,
    nestedSampleLimit: SAMPLE_LIMIT,
    sampledTickets: rows4.length,
    siteIdTickets: rows4.filter((row2) => {
      const value2 = own5(row2, "serviceLocationId");
      return typeof value2 === "number" ? Number.isSafeInteger(value2) && value2 > 0 : typeof value2 === "string" && /^[1-9]\d{0,14}$/.test(value2) && Number.isSafeInteger(Number(value2));
    }).length,
    fields: Object.fromEntries(OPERATIONAL_FIELDS.map((field5) => [field5, fieldEvidence(rows4.map((row2) => own5(row2, field5)))])),
    collections: { items: operationalCollection(rows4, "items"), customFields: operationalCollection(rows4, "customFields") }
  };
  return projectMhelpOperationalEvidence(result, totalTickets);
}
function projectMhelpOperationalEvidence(value2, totalTickets) {
  const invalid5 = () => {
    throw Error("Unsupported mHelpDesk operational evidence.");
  };
  const exact8 = (value3, keys3) => {
    if (!plain6(value3) || Object.keys(value3).length !== keys3.length || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    return value3;
  };
  const integer = (value3, max = SAMPLE_LIMIT) => {
    if (typeof value3 !== "number" || !Number.isSafeInteger(value3) || value3 < 0 || value3 > max) invalid5();
    return value3;
  };
  const counters = (value3, keys3, size) => {
    if (!plain6(value3) || Object.keys(value3).some((key2) => !keys3.includes(key2))) invalid5();
    const source = value3, result2 = {};
    for (const key2 of keys3) if (Object.hasOwn(source, key2)) {
      const n = integer(source[key2], size);
      if (n === 0) invalid5();
      result2[key2] = n;
    }
    if (Object.values(result2).reduce((sum, n) => sum + Number(n), 0) !== size) invalid5();
    return result2;
  };
  const descriptor = (value3, size) => {
    const row3 = exact8(value3, ["kinds", "formats", "emptyStrings", "nonemptyStrings"]), kinds = counters(row3.kinds, KINDS5, size), formats = counters(row3.formats, FORMATS5, kinds.string || 0);
    const emptyStrings = integer(row3.emptyStrings, size), nonemptyStrings = integer(row3.nonemptyStrings, size);
    if (emptyStrings + nonemptyStrings !== (kinds.string || 0)) invalid5();
    return { kinds, formats, emptyStrings, nonemptyStrings };
  };
  const row2 = exact8(value2, ["contract", "scope", "ticketSampleLimit", "nestedSampleLimit", "sampledTickets", "siteIdTickets", "fields", "collections"]);
  if (row2.contract !== "cos-mhelpdesk-operational-evidence-v1" || row2.scope !== "first_ticket_page" || row2.ticketSampleLimit !== SAMPLE_LIMIT || row2.nestedSampleLimit !== SAMPLE_LIMIT) invalid5();
  const sampledTickets = integer(row2.sampledTickets), siteIdTickets = integer(row2.siteIdTickets, sampledTickets);
  if (sampledTickets !== Math.min(integer(totalTickets, 500), SAMPLE_LIMIT)) invalid5();
  const inputFields = exact8(row2.fields, OPERATIONAL_FIELDS);
  const fields4 = Object.fromEntries(OPERATIONAL_FIELDS.map((field5) => [field5, descriptor(inputFields[field5], sampledTickets)]));
  if (siteIdTickets > (fields4.serviceLocationId.kinds.integer || 0) + (fields4.serviceLocationId.kinds.string || 0)) invalid5();
  const inputCollections = exact8(row2.collections, ["items", "customFields"]);
  const collections = Object.fromEntries(["items", "customFields"].map((key2) => {
    const source = exact8(inputCollections[key2], ["kinds", "emptyArrays", "nonemptyArrays", "totalEntries", "sampledEntries", "entryKinds", "fields"]);
    const kinds = counters(source.kinds, KINDS5, sampledTickets), emptyArrays = integer(source.emptyArrays, sampledTickets), nonemptyArrays = integer(source.nonemptyArrays, sampledTickets);
    const totalEntries = integer(source.totalEntries, 1e6), sampledEntries = integer(source.sampledEntries), entryKinds = counters(source.entryKinds, KINDS5, sampledEntries);
    if (emptyArrays + nonemptyArrays !== (kinds.array || 0) || totalEntries < nonemptyArrays || totalEntries === 0 !== (nonemptyArrays === 0) || sampledEntries !== Math.min(totalEntries, SAMPLE_LIMIT)) invalid5();
    const input2 = exact8(source.fields, NESTED_FIELDS2[key2]);
    return [key2, { kinds, emptyArrays, nonemptyArrays, totalEntries, sampledEntries, entryKinds, fields: Object.fromEntries(NESTED_FIELDS2[key2].map((field5) => [field5, descriptor(input2[field5], sampledEntries)])) }];
  }));
  const result = { contract: "cos-mhelpdesk-operational-evidence-v1", scope: "first_ticket_page", ticketSampleLimit: SAMPLE_LIMIT, nestedSampleLimit: SAMPLE_LIMIT, sampledTickets, siteIdTickets, fields: fields4, collections };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_EVIDENCE_BYTES) invalid5();
  return result;
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTickets.ts
var MHELP_TICKET_CONTRACT = "cos-mhelpdesk-ticket-preview-v1";
var API3 = "https://connect.mhelpdesk.com/api/v1.0";
var CURRENT_USER = API3 + "/users/me";
var PAGE_SIZE = 50;
var MAX_TICKETS = 500;
var MAX_DICTIONARY_ROWS = 500;
var MAX_WINDOW_MS = 31 * 864e5;
var MhelpTicketError = class extends Error {
  constructor(message, status2 = 503, provider) {
    super(message);
    this.status = status2;
    this.provider = provider;
  }
  status;
  provider;
  renewal;
  schema;
  detailSchema;
};
function fail10(message, status2 = 503) {
  throw new MhelpTicketError(message, status2);
}
var object29 = (value2) => {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) fail10("mHelpDesk returned an unsupported ticket record.");
  return value2;
};
function identity2(value2, allowZero = false) {
  if (typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= (allowZero ? 0 : 1)) return String(value2);
  if (typeof value2 === "string" && /^(0|[1-9]\d{0,14})$/.test(value2) && Number.isSafeInteger(Number(value2)) && (allowZero || value2 !== "0")) return value2;
  return fail10("mHelpDesk returned an invalid ticket identity.");
}
var optionalId = (value2) => value2 == null || value2 === 0 || value2 === "0" ? null : identity2(value2);
function text13(value2, optional = false) {
  if (optional && (value2 == null || value2 === "")) return null;
  if (typeof value2 !== "string" || !value2.trim() || value2.length > 500 || /[\x00-\x1f\x7f]/.test(value2)) fail10("mHelpDesk returned an unsupported ticket label.");
  return value2;
}
function timestamp3(value2) {
  if (typeof value2 !== "string" || value2.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value2) || !Number.isFinite(Date.parse(value2))) fail10("mHelpDesk returned an invalid timezone-bearing ticket timestamp.");
  const [year, month, day] = value2.slice(0, 10).split("-").map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) fail10("mHelpDesk returned an invalid ticket timestamp.");
  return new Date(value2).toISOString();
}
var KNOWN_TICKET_FIELDS = new Set("ticketId assignedBy assignedTo categoryId statusId isPublic creationDate lastModDate priority summary neededBy scheduledDate moduleId submitterUsername subject estimatedTime customerId comment fromEmail newReplyFromEndUser newReplyFromStaff typeId customStatusId hasInvoice parentTicketId dataGroupId businessUnitId deleted submitterRole lastOpenedBy lastOpenedTime lastOpenedLocation originalTicketId recurringRuleId generatedByRecurring previousOrgId appointmentCount lastCalledDate nextCallDate portalId contactId poNumber ticketNumber serviceLocationId subTotal totalAmount totalTax totalProfitMargin totalROI totalProfit customFields items ticketStatus typeName".split(" "));
function projectPartnerTicket(value2, portalId) {
  const row2 = object29(value2);
  if (identity2(row2.portalId) !== portalId) fail10("mHelpDesk returned a ticket from a different portal.");
  if (typeof row2.deleted !== "boolean") fail10("mHelpDesk returned an unsupported ticket deletion state.");
  const creationDate = timestamp3(row2.creationDate), lastModDate = timestamp3(row2.lastModDate);
  if (Date.parse(lastModDate) < Date.parse(creationDate)) fail10("mHelpDesk returned inconsistent ticket timestamps.");
  const assignedTo = text13(row2.assignedTo, true), assignmentKnown = Object.hasOwn(row2, "assignedTo") && row2.assignedTo !== void 0;
  return {
    portalId,
    ticketId: identity2(row2.ticketId),
    ticketNumber: identity2(row2.ticketNumber),
    typeId: optionalId(row2.typeId),
    typeName: text13(row2.typeName, true),
    statusId: identity2(row2.statusId, true),
    customStatusId: optionalId(row2.customStatusId),
    deleted: row2.deleted,
    creationDate,
    lastModDate,
    customerId: optionalId(row2.customerId),
    serviceLocationId: optionalId(row2.serviceLocationId),
    assignedTo,
    assignmentState: !assignmentKnown ? "unknown" : assignedTo === null ? "unassigned" : "assigned",
    unknownFieldCount: Object.keys(row2).filter((key2) => !KNOWN_TICKET_FIELDS.has(key2)).length
  };
}
function collectionRows(page2) {
  const hasData = Object.hasOwn(page2, "data"), hasResults = Object.hasOwn(page2, "results");
  if (hasData === hasResults) return null;
  const rows4 = hasData ? page2.data : page2.results;
  return Array.isArray(rows4) ? rows4 : null;
}
function types(value2, portalId) {
  const page2 = object29(value2), rows4 = collectionRows(page2);
  if (!Number.isSafeInteger(page2.totalRows) || !rows4 || page2.totalRows !== rows4.length || rows4.length > MAX_DICTIONARY_ROWS) fail10("mHelpDesk returned an incomplete ticket type dictionary.");
  const result = rows4.map((value3) => {
    const row2 = object29(value3);
    if (identity2(row2.portalId) !== portalId || typeof row2.isActive !== "boolean") fail10("mHelpDesk returned an invalid ticket type dictionary.");
    return { typeId: identity2(row2.typeId), portalId, typeName: text13(row2.typeName), isActive: row2.isActive };
  });
  if (new Set(result.map((row2) => row2.typeId)).size !== result.length) fail10("mHelpDesk returned duplicate ticket type identities.");
  return result;
}
function statuses(value2) {
  if (!Array.isArray(value2) || value2.length > MAX_DICTIONARY_ROWS) fail10("mHelpDesk returned an unsupported ticket status dictionary.");
  const result = value2.map((value3) => {
    const row2 = object29(value3);
    if (typeof row2.canBeParent !== "boolean") fail10("mHelpDesk returned an invalid ticket status dictionary.");
    return { statusId: identity2(row2.statusId), statusText: text13(row2.statusText), displayText: text13(row2.displayText), parentId: optionalId(row2.parentId), canBeParent: row2.canBeParent };
  });
  const ids = new Set(result.map((row2) => row2.statusId));
  if (ids.size !== result.length || result.some((row2) => row2.parentId !== null && (!ids.has(row2.parentId) || row2.parentId === row2.statusId))) fail10("mHelpDesk returned inconsistent ticket status identities.");
  return result;
}
function windowOf(value2) {
  let row2;
  try {
    row2 = object29(value2);
  } catch {
    return fail10("Provide a bounded ticket creation window.", 400);
  }
  if (Object.keys(row2).some((key2) => !["createdAfter", "createdBefore", "maxTickets"].includes(key2))) fail10("The ticket preview request contains unsupported fields.", 400);
  let createdAfter, createdBefore;
  try {
    createdAfter = timestamp3(row2.createdAfter);
    createdBefore = timestamp3(row2.createdBefore);
  } catch {
    return fail10("Provide timezone-bearing ticket creation dates.", 400);
  }
  const duration = Date.parse(createdBefore) - Date.parse(createdAfter), maxTickets = row2.maxTickets === void 0 ? MAX_TICKETS : row2.maxTickets;
  if (duration <= 0 || duration > MAX_WINDOW_MS || typeof maxTickets !== "number" || !Number.isSafeInteger(maxTickets) || maxTickets < 1 || maxTickets > MAX_TICKETS) fail10("Use a ticket window of at most 31 days and a limit from 1 to 500.", 400);
  return { createdAfter, createdBefore, maxTickets };
}
var METRICS = ["deletedTickets", "assignedTickets", "missingAssignmentFields", "missingTypeIds", "unknownTypeIds", "unknownStatusIds", "unknownCustomStatusIds", "missingCustomerIds", "missingServiceLocationIds", "ticketsWithUnknownFields", "unknownFieldOccurrences", "typeLabelMismatches", "duplicateTypeNames"];
function projectMhelpTicketPreview(value2, evidence) {
  if (evidence !== void 0 && evidence !== MHELP_OPERATIONAL_EVIDENCE && evidence !== MHELP_TICKET_DETAIL_EVIDENCE && evidence !== MHELP_APPOINTMENT_EVIDENCE && evidence !== MHELP_APPOINTMENT_VARIANTS) fail10("Unsupported mHelpDesk ticket preview.");
  const row2 = object29(value2);
  if (row2.contract !== MHELP_TICKET_CONTRACT || row2.state !== "preview_verified" || row2.liveAccessVerified !== true || row2.automaticSync !== false || row2.ticketWrites !== false || row2.partial !== false) fail10("Unsupported mHelpDesk ticket preview.");
  const portalId = identity2(row2.verifiedPortalId), window = windowOf(row2.window);
  const count6 = (value3, max = MAX_TICKETS) => {
    if (typeof value3 !== "number" || !Number.isSafeInteger(value3) || value3 < 0 || value3 > max) fail10("Unsupported mHelpDesk ticket preview count.");
    return value3;
  };
  const totalRows = count6(row2.totalRows);
  if (count6(row2.previewCount) !== totalRows) fail10("Incomplete mHelpDesk ticket preview.");
  if (!Array.isArray(row2.types) || !Array.isArray(row2.statuses)) fail10("Unsupported mHelpDesk ticket preview dictionaries.");
  const typeRows = types({ totalRows: row2.types.length, data: row2.types }, portalId).map((type, i) => ({ ...type, count: count6(object29(row2.types[i]).count, totalRows) }));
  const statusRows = statuses(row2.statuses).map((status2, i) => {
    const item = object29(row2.statuses[i]);
    return { ...status2, statusCount: count6(item.statusCount, totalRows), customStatusCount: count6(item.customStatusCount, totalRows) };
  });
  if (typeRows.reduce((sum, row3) => sum + row3.count, 0) > totalRows || statusRows.reduce((sum, row3) => sum + row3.statusCount, 0) > totalRows || statusRows.reduce((sum, row3) => sum + row3.customStatusCount, 0) > totalRows) fail10("Inconsistent mHelpDesk ticket preview counts.");
  const inputMetrics = object29(row2.metrics), metrics2 = {};
  for (const key2 of METRICS) metrics2[key2] = count6(inputMetrics[key2], key2 === "unknownFieldOccurrences" ? 1e6 : key2 === "duplicateTypeNames" ? typeRows.length : totalRows);
  return {
    contract: MHELP_TICKET_CONTRACT,
    state: "preview_verified",
    liveAccessVerified: true,
    automaticSync: false,
    ticketWrites: false,
    verifiedPortalId: portalId,
    readAt: timestamp3(row2.readAt),
    window: { createdAfter: window.createdAfter, createdBefore: window.createdBefore },
    totalRows,
    previewCount: totalRows,
    partial: false,
    types: typeRows,
    statuses: statusRows,
    metrics: metrics2,
    ...evidence !== void 0 ? { operationalEvidence: projectMhelpOperationalEvidence(row2.operationalEvidence, totalRows) } : {},
    ...evidence === MHELP_TICKET_DETAIL_EVIDENCE || (evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS) ? { detailEvidence: projectDetailEvidence(row2.detailEvidence, totalRows) } : {},
    ...evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS ? { appointmentEvidence: projectAppointmentEvidence(row2.appointmentEvidence, totalRows, window.createdAfter, evidence === MHELP_APPOINTMENT_VARIANTS) } : {}
  };
}
function projectDetailEvidence(value2, totalTickets) {
  try {
    return projectMhelpTicketDetailEvidence(value2, totalTickets);
  } catch {
    return fail10("Unsupported mHelpDesk ticket detail evidence.");
  }
}
function projectAppointmentEvidence(value2, totalTickets, createdAfter, variants = false) {
  try {
    return (variants ? projectMhelpAppointmentVariants : projectMhelpAppointmentEvidence)(value2, totalTickets, createdAfter);
  } catch {
    return fail10("Unsupported mHelpDesk appointment evidence.");
  }
}
function verifiedDetail(rawDetail, selected, portalId) {
  if (!rawDetail || typeof rawDetail !== "object" || Array.isArray(rawDetail) || ["portalId", "ticketId", "ticketNumber"].some((key2) => !Object.hasOwn(rawDetail, key2))) fail10("mHelpDesk returned an unsupported flat ticket detail.");
  const raw = rawDetail;
  try {
    if (identity2(raw.portalId) !== selected.portalId || identity2(raw.ticketId) !== selected.ticketId || identity2(raw.ticketNumber) !== selected.ticketNumber) fail10("mHelpDesk detail does not match the selected ticket.");
  } catch {
    fail10("mHelpDesk detail does not match the selected ticket.");
  }
  let detail;
  try {
    detail = projectPartnerTicket(rawDetail, portalId);
  } catch {
    fail10("mHelpDesk returned an unsupported flat ticket detail.");
  }
  const keys3 = ["creationDate", "lastModDate", "typeId", "typeName", "statusId", "customStatusId", "deleted", "customerId", "serviceLocationId", "assignedTo", "assignmentState"];
  if (keys3.some((key2) => detail[key2] !== selected[key2])) fail10("mHelpDesk ticket changed during the detail preview.");
  return detail;
}
function createMhelpTicketReader(options) {
  let busy = false;
  const run = async (value2, evidence, privateInput, signal) => {
    const window = privateInput ? { createdAfter: privateInput.window.startDateUtc, createdBefore: privateInput.window.endDateUtc, maxTickets: 500 } : windowOf(value2);
    if (evidence !== void 0 && evidence !== MHELP_OPERATIONAL_EVIDENCE && evidence !== MHELP_TICKET_DETAIL_EVIDENCE && evidence !== MHELP_APPOINTMENT_EVIDENCE && evidence !== MHELP_APPOINTMENT_VARIANTS) fail10("The ticket preview request contains unsupported fields.", 400);
    if (evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS) try {
      mhelpAppointmentPreviewWindow(window.createdAfter);
    } catch {
      fail10("The appointment schedule window is not available.", 400);
    }
    if (busy) fail10("A mHelpDesk ticket preview is already running.", 409);
    busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e4);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    let budget = 3 * 1048576;
    const schema = {};
    let detailSchema;
    try {
      let config;
      try {
        config = await options.getConfig();
      } catch {
        return fail10("mHelpDesk ticket configuration is unavailable.");
      }
      const validConfig = () => {
        if (!config || typeof config.accessToken !== "string" || !config.accessToken || config.accessToken.length > 16384 || /\s/.test(config.accessToken)) fail10("mHelpDesk needs its existing server-held access token.");
        if (config.portalId !== void 0) try {
          if (identity2(config.portalId) !== config.portalId) fail10("Invalid portal");
        } catch {
          fail10("The saved mHelpDesk portal ID is invalid.");
        }
      };
      validConfig();
      const configuredPortalId = config.portalId, credentialValues = [config.accessToken];
      let renewed = false;
      const withinDeadline = (start) => new Promise((resolve2, reject2) => {
        const abort2 = () => reject2(new MhelpTicketError("The mHelpDesk ticket preview timed out."));
        if (controller.signal.aborted) {
          abort2();
          return;
        }
        controller.signal.addEventListener("abort", abort2, { once: true });
        let pending;
        try {
          pending = start();
        } catch (error) {
          controller.signal.removeEventListener("abort", abort2);
          reject2(error);
          return;
        }
        pending.then(resolve2, reject2).finally(() => controller.signal.removeEventListener("abort", abort2));
      });
      const cancel = (stream) => {
        try {
          void stream?.cancel().catch(() => {
          });
        } catch {
        }
      };
      const read = async (url2, operation, maxBytes = 1048576) => {
        if (controller.signal.aborted) fail10("The mHelpDesk ticket preview timed out.");
        let response;
        try {
          response = await withinDeadline(async () => {
            const result = await options.fetch(url2, { method: "GET", headers: { Authorization: "Bearer " + config.accessToken, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal });
            if (controller.signal.aborted) {
              cancel(result.body);
              fail10("The mHelpDesk ticket preview timed out.");
            }
            return result;
          });
        } catch (error) {
          if (error instanceof MhelpTicketError) throw error;
          return fail10("mHelpDesk could not complete the ticket preview.");
        }
        if (response.status === 401 && operation === "account_read" && options.renewAccess && !renewed) {
          renewed = true;
          cancel(response.body);
          try {
            config = await currentMhelpConfigOrRenew(config, options.getConfig, options.renewAccess);
          } catch (cause) {
            if (cause instanceof MhelpPortalChangedError) fail10("The renewed mHelpDesk account does not match the saved portal.");
            const failure2 = new MhelpTicketError("mHelpDesk could not renew its existing server token.");
            if (cause instanceof MhelpTokenRenewalError) failure2.renewal = projectMhelpTokenRenewalDiagnostic(cause.diagnostic);
            throw failure2;
          }
          validConfig();
          credentialValues.push(config.accessToken);
          if (configuredPortalId && config.portalId && config.portalId !== configuredPortalId) fail10("The renewed mHelpDesk account does not match the saved portal.");
          return read(url2, operation, maxBytes);
        }
        if (!response.ok) {
          cancel(response.body);
          throw new MhelpTicketError(response.status === 429 ? "mHelpDesk is limiting ticket reads. Retry later." : "mHelpDesk denied or could not complete the ticket read.", response.status === 429 ? 429 : 503, { operation, httpStatus: response.status });
        }
        if (!response.body || Number(response.headers.get("Content-Length")) > maxBytes) {
          cancel(response.body);
          return fail10("mHelpDesk returned an oversized ticket response.");
        }
        const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0, raw = "";
        try {
          while (true) {
            if (controller.signal.aborted) fail10("The mHelpDesk ticket preview timed out.");
            const { value: value3, done } = await withinDeadline(() => reader.read());
            if (done) break;
            size += value3.byteLength;
            budget -= value3.byteLength;
            if (size > maxBytes || budget < 0) fail10("mHelpDesk returned an oversized ticket response.");
            raw += decoder.decode(value3, { stream: true });
          }
          raw += decoder.decode();
          return JSON.parse(raw);
        } catch (error) {
          if (error instanceof MhelpTicketError) throw error;
          return fail10("mHelpDesk returned an incomplete ticket response.");
        } finally {
          cancel(reader);
          try {
            reader.releaseLock();
          } catch {
          }
        }
      };
      const account2 = object29(await read(CURRENT_USER, "account_read", 16384)), portalId = identity2(account2.portalId);
      if (configuredPortalId && configuredPortalId !== portalId || config.portalId && config.portalId !== portalId) fail10("The mHelpDesk account does not match the saved portal.");
      const prefix = API3 + "/portal/" + portalId;
      if (privateInput) {
        const listUrl = new URL(prefix + "/Tickets");
        listUrl.searchParams.set("appointmentStart", privateInput.window.startDateUtc);
        listUrl.searchParams.set("appointmentEnd", privateInput.window.endDateUtc);
        listUrl.searchParams.set("pageSize", "500");
        listUrl.searchParams.set("sort", "ticketId");
        const rawList = await read(listUrl.href, "ticket_read"), page3 = object29(rawList), rows4 = collectionRows(page3);
        if (!Number.isSafeInteger(page3.totalRows) || Number(page3.totalRows) < 0 || !rows4 || rows4.length > 500 || rows4.length > Number(page3.totalRows)) fail10("mHelpDesk returned an unsupported ticket page.");
        if (["TotalRows", "TotalResults", "totalResults", "Data", "Results"].some((key2) => Object.hasOwn(page3, key2))) fail10("mHelpDesk returned an unsupported ticket page.");
        const tickets2 = rows4.map((row2) => projectPartnerTicket(row2, portalId));
        if (tickets2.some((row2, i) => i > 0 && Number(row2.ticketId) <= Number(tickets2[i - 1].ticketId))) fail10("mHelpDesk did not return tickets in stable identity order.");
        const candidates = tickets2.filter((row2) => row2.ticketNumber === privateInput.request.ticketNumber);
        const selection = { pageLimit: 500, sampledTickets: tickets2.length, reportedTotal: Number(page3.totalRows), matchingTickets: candidates.length };
        if (page3.totalRows !== rows4.length) return projectMhelpPrivateSample(unavailableMhelpPrivateSample(privateInput, "incomplete_ticket_page", selection, privateInput.readAt));
        if (candidates.length !== 1) return projectMhelpPrivateSample(unavailableMhelpPrivateSample(privateInput, candidates.length ? "ambiguous_ticket_number" : "ticket_not_found", selection, privateInput.readAt));
        const selected = candidates[0], rawDetail = await read(prefix + "/Tickets/" + selected.ticketId, "ticket_detail_read");
        const detail = verifiedDetail(rawDetail, selected, portalId);
        const appointmentUrl = new URL(prefix + "/Appointments");
        appointmentUrl.searchParams.set("startDateUtc", privateInput.window.startDateUtc);
        appointmentUrl.searchParams.set("endDateUtc", privateInput.window.endDateUtc);
        appointmentUrl.searchParams.set("pageSize", String(MHELP_APPOINTMENT_PAGE_LIMIT));
        appointmentUrl.searchParams.set("sort", "StartUtc");
        appointmentUrl.searchParams.set("fields", MHELP_PRIVATE_APPOINTMENT_FIELDS.join(","));
        const rawAppointments = await read(appointmentUrl.href, "appointment_read");
        try {
          return projectMhelpPrivateSample(describeMhelpPrivateSample(privateInput, detail, rawDetail, rawAppointments, privateInput.readAt, credentialValues));
        } catch (error) {
          if (error instanceof Error && error.message === "mHelpDesk returned an oversized appointment page.") fail10(error.message);
          fail10("Unsupported mHelpDesk ticket preview.");
        }
      }
      const url = new URL(prefix + "/Tickets");
      url.searchParams.set("createStart", window.createdAfter);
      url.searchParams.set("createEnd", window.createdBefore);
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      url.searchParams.set("sort", "ticketId");
      const rawTypes = await read(prefix + "/tickettypes", "ticket_types_read");
      schema.ticketTypes = describeMhelpTicketSchema(rawTypes, "ticketTypes");
      const rawStatuses = await read(prefix + "/ticketstatus", "ticket_statuses_read");
      schema.ticketStatuses = describeMhelpTicketSchema(rawStatuses, "ticketStatuses");
      const rawTickets = await read(url.href, "ticket_read");
      schema.tickets = describeMhelpTicketSchema(rawTickets, "tickets");
      const typeRows = types(rawTypes, portalId), statusRows = statuses(rawStatuses);
      let total, indexBase = 0, boundaryChecked = false;
      const tickets = [], seen = /* @__PURE__ */ new Set();
      const pageOf = (value3) => {
        const page3 = object29(value3), collection3 = collectionRows(page3);
        if (!Number.isSafeInteger(page3.totalRows) || Number(page3.totalRows) < 0 || !collection3 || collection3.length > PAGE_SIZE || collection3.length > Number(page3.totalRows)) fail10("mHelpDesk returned an unsupported ticket page.");
        if (Number(page3.totalRows) > window.maxTickets) fail10("The ticket preview exceeds its maximum count. Use a smaller creation window.");
        if (total !== void 0 && page3.totalRows !== total) fail10("mHelpDesk ticket totals changed during the preview. Retry.");
        total = Number(page3.totalRows);
        const rows4 = collection3.map((row2) => projectPartnerTicket(row2, portalId));
        if (rows4.some((row2) => Date.parse(row2.creationDate) <= Date.parse(window.createdAfter) || Date.parse(row2.creationDate) >= Date.parse(window.createdBefore))) fail10("mHelpDesk returned tickets outside the requested creation window.");
        if (rows4.some((row2, i) => i > 0 && Number(row2.ticketId) <= Number(rows4[i - 1].ticketId))) fail10("mHelpDesk did not return tickets in stable identity order.");
        return rows4;
      };
      let page2 = pageOf(rawTickets);
      while (true) {
        if (tickets.length && (!page2.length || Number(page2[0].ticketId) <= Number(tickets[tickets.length - 1].ticketId))) fail10("mHelpDesk returned overlapping or incomplete ticket pages.");
        if (page2.some((row2) => seen.has(row2.ticketId)) || tickets.length + page2.length > total) fail10("mHelpDesk returned duplicate ticket identities.");
        for (const row2 of page2) {
          seen.add(row2.ticketId);
          tickets.push(row2);
        }
        if (tickets.length === total) break;
        if (!page2.length || page2.length !== PAGE_SIZE) fail10("mHelpDesk returned an incomplete ticket page.");
        url.searchParams.set("rowIndex", String(tickets.length + indexBase));
        page2 = pageOf(await read(url.href, "ticket_read"));
        if (!boundaryChecked && page2.length && page2[0].ticketId === tickets[tickets.length - 1].ticketId) {
          indexBase = 1;
          url.searchParams.set("rowIndex", String(tickets.length + indexBase));
          page2 = pageOf(await read(url.href, "ticket_read"));
        }
        boundaryChecked = true;
      }
      let detailEvidence, appointmentEvidence;
      if ((evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS) && total !== 1) appointmentEvidence = (evidence === MHELP_APPOINTMENT_VARIANTS ? unavailableMhelpAppointmentVariants : unavailableMhelpAppointments)(total, window.createdAfter);
      if (evidence === MHELP_TICKET_DETAIL_EVIDENCE || (evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS)) {
        detailEvidence = total === 1 ? void 0 : unavailableMhelpTicketDetail(total);
        if (total === 1) {
          const selected = tickets[0], rawDetail = await read(prefix + "/Tickets/" + selected.ticketId, "ticket_detail_read");
          detailSchema = describeMhelpTicketDetailFailure(rawDetail);
          if (!rawDetail || typeof rawDetail !== "object" || Array.isArray(rawDetail) || ["portalId", "ticketId", "ticketNumber"].some((key2) => !Object.hasOwn(rawDetail, key2))) fail10("mHelpDesk returned an unsupported flat ticket detail.");
          const detailObject = rawDetail;
          let detailPortal, detailId, detailNumber;
          try {
            detailPortal = identity2(detailObject.portalId);
            detailId = identity2(detailObject.ticketId);
            detailNumber = identity2(detailObject.ticketNumber);
          } catch {
            fail10("mHelpDesk detail does not match the selected ticket.");
          }
          if (detailPortal !== selected.portalId || detailId !== selected.ticketId || detailNumber !== selected.ticketNumber) fail10("mHelpDesk detail does not match the selected ticket.");
          let detail;
          try {
            detail = projectPartnerTicket(rawDetail, portalId);
          } catch {
            fail10("mHelpDesk returned an unsupported flat ticket detail.");
          }
          if (detail.portalId !== selected.portalId || detail.ticketId !== selected.ticketId || detail.ticketNumber !== selected.ticketNumber) fail10("mHelpDesk detail does not match the selected ticket.");
          if (Date.parse(detail.creationDate) <= Date.parse(window.createdAfter) || Date.parse(detail.creationDate) >= Date.parse(window.createdBefore)) fail10("mHelpDesk detail is outside the verified creation window.");
          const snapshotKeys = ["creationDate", "lastModDate", "typeId", "typeName", "statusId", "customStatusId", "deleted", "customerId", "serviceLocationId", "assignedTo", "assignmentState"];
          if (snapshotKeys.some((key2) => detail[key2] !== selected[key2])) fail10("mHelpDesk ticket changed during the detail preview.");
          try {
            detailEvidence = describeMhelpTicketDetail(rawDetail);
          } catch {
            fail10("Unsupported mHelpDesk ticket detail evidence.");
          }
          if (evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS) {
            const schedule2 = mhelpAppointmentPreviewWindow(window.createdAfter), appointmentUrl = new URL(prefix + "/Appointments");
            appointmentUrl.searchParams.set("startDateUtc", schedule2.startDateUtc);
            appointmentUrl.searchParams.set("endDateUtc", schedule2.endDateUtc);
            appointmentUrl.searchParams.set("pageSize", String(MHELP_APPOINTMENT_PAGE_LIMIT));
            appointmentUrl.searchParams.set("sort", "StartUtc");
            appointmentUrl.searchParams.set("fields", (evidence === MHELP_APPOINTMENT_VARIANTS ? MHELP_APPOINTMENT_DIAGNOSTIC_FIELDS : MHELP_APPOINTMENT_FIELDS).join(","));
            const rawAppointments = await read(appointmentUrl.href, "appointment_read");
            try {
              appointmentEvidence = (evidence === MHELP_APPOINTMENT_VARIANTS ? describeMhelpAppointmentVariants : describeMhelpAppointments)(rawAppointments, detail, window.createdAfter);
            } catch (error) {
              if (error instanceof Error && error.message === "mHelpDesk returned an oversized appointment page.") fail10(error.message);
              fail10("Unsupported mHelpDesk appointment evidence.");
            }
          }
        }
      }
      const typeIds = new Set(typeRows.map((row2) => row2.typeId)), statusIds = new Set(statusRows.map((row2) => row2.statusId));
      return {
        contract: MHELP_TICKET_CONTRACT,
        state: "preview_verified",
        liveAccessVerified: true,
        automaticSync: false,
        ticketWrites: false,
        verifiedPortalId: portalId,
        readAt: (/* @__PURE__ */ new Date()).toISOString(),
        window: { createdAfter: window.createdAfter, createdBefore: window.createdBefore },
        totalRows: total,
        previewCount: tickets.length,
        partial: false,
        ...evidence !== void 0 ? { operationalEvidence: describeMhelpOperationalEvidence(collectionRows(object29(rawTickets)), total) } : {},
        ...evidence === MHELP_TICKET_DETAIL_EVIDENCE || (evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS) ? { detailEvidence } : {},
        ...evidence === MHELP_APPOINTMENT_EVIDENCE || evidence === MHELP_APPOINTMENT_VARIANTS ? { appointmentEvidence } : {},
        types: typeRows.map((row2) => ({ ...row2, count: tickets.filter((ticket2) => ticket2.typeId === row2.typeId).length })),
        statuses: statusRows.map((row2) => ({ ...row2, statusCount: tickets.filter((ticket2) => ticket2.statusId === row2.statusId).length, customStatusCount: tickets.filter((ticket2) => ticket2.customStatusId === row2.statusId).length })),
        metrics: {
          deletedTickets: tickets.filter((row2) => row2.deleted).length,
          assignedTickets: tickets.filter((row2) => row2.assignmentState === "assigned").length,
          missingAssignmentFields: tickets.filter((row2) => row2.assignmentState === "unknown").length,
          missingTypeIds: tickets.filter((row2) => row2.typeId === null).length,
          unknownTypeIds: tickets.filter((row2) => row2.typeId !== null && !typeIds.has(row2.typeId)).length,
          unknownStatusIds: tickets.filter((row2) => !statusIds.has(row2.statusId)).length,
          unknownCustomStatusIds: tickets.filter((row2) => row2.customStatusId !== null && !statusIds.has(row2.customStatusId)).length,
          missingCustomerIds: tickets.filter((row2) => row2.customerId === null).length,
          missingServiceLocationIds: tickets.filter((row2) => row2.serviceLocationId === null).length,
          ticketsWithUnknownFields: tickets.filter((row2) => row2.unknownFieldCount > 0).length,
          unknownFieldOccurrences: tickets.reduce((n, row2) => n + row2.unknownFieldCount, 0),
          typeLabelMismatches: tickets.filter((row2) => row2.typeName !== null && typeRows.some((type) => type.typeId === row2.typeId && type.typeName !== row2.typeName)).length,
          duplicateTypeNames: typeRows.length - new Set(typeRows.map((row2) => row2.typeName)).size
        }
      };
    } catch (error) {
      if (error instanceof MhelpTicketError) {
        if (Object.keys(schema).length) error.schema = schema;
        if (detailSchema) error.detailSchema = detailSchema;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
      busy = false;
    }
  };
  return {
    preview: (value2, evidence) => run(value2, evidence),
    sample: (value2, now = /* @__PURE__ */ new Date(), signal) => {
      let input2;
      try {
        input2 = validateMhelpPrivateSampleRequest(value2, now);
      } catch {
        return Promise.reject(new MhelpTicketError("The ticket preview request contains unsupported fields.", 400));
      }
      return run(value2, void 0, { ...input2, readAt: now.toISOString() }, signal);
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts
var REASONS = Object.freeze({
  "Unsupported mHelpDesk appointment evidence.": "APPOINTMENT_PROJECTION_INVALID",
  "mHelpDesk returned an oversized appointment page.": "APPOINTMENT_COUNT_LIMIT",
  "The appointment schedule window is not available.": "APPOINTMENT_WINDOW_INVALID",
  "mHelpDesk detail does not match the selected ticket.": "DETAIL_IDENTITY_MISMATCH",
  "mHelpDesk ticket changed during the detail preview.": "DETAIL_CHANGED",
  "mHelpDesk detail is outside the verified creation window.": "DETAIL_WINDOW_MISMATCH",
  "mHelpDesk returned an unsupported flat ticket detail.": "DETAIL_SCHEMA",
  "Unsupported mHelpDesk ticket detail evidence.": "DETAIL_PROJECTION_INVALID",
  "A mHelpDesk ticket preview is already running.": "BUSY",
  "mHelpDesk ticket configuration is unavailable.": "CONFIG_UNAVAILABLE",
  "mHelpDesk needs its existing server-held access token.": "TOKEN_UNAVAILABLE",
  "The saved mHelpDesk portal ID is invalid.": "PORTAL_CONFIGURATION",
  "The mHelpDesk account does not match the saved portal.": "PORTAL_MISMATCH",
  "The renewed mHelpDesk account does not match the saved portal.": "PORTAL_MISMATCH",
  "mHelpDesk returned a ticket from a different portal.": "PORTAL_MISMATCH",
  "mHelpDesk could not renew its existing server token.": "RENEWAL_FAILED",
  "mHelpDesk could not complete the ticket preview.": "TRANSPORT_FAILED",
  "The mHelpDesk ticket preview timed out.": "DEADLINE",
  "mHelpDesk returned an oversized ticket response.": "RESPONSE_TOO_LARGE",
  "mHelpDesk returned an incomplete ticket response.": "RESPONSE_INCOMPLETE",
  "mHelpDesk returned an unsupported ticket record.": "RECORD_SHAPE",
  "mHelpDesk returned an invalid ticket identity.": "IDENTITY_FORMAT",
  "mHelpDesk returned an unsupported ticket label.": "LABEL_FORMAT",
  "mHelpDesk returned an invalid timezone-bearing ticket timestamp.": "TIMESTAMP_TIMEZONE",
  "mHelpDesk returned an invalid ticket timestamp.": "TIMESTAMP_FORMAT",
  "mHelpDesk returned inconsistent ticket timestamps.": "TIMESTAMP_ORDER",
  "mHelpDesk returned an unsupported ticket deletion state.": "DELETION_STATE",
  "mHelpDesk returned an incomplete ticket type dictionary.": "TYPE_DICTIONARY_INCOMPLETE",
  "mHelpDesk returned an invalid ticket type dictionary.": "TYPE_DICTIONARY_INVALID",
  "mHelpDesk returned duplicate ticket type identities.": "TYPE_DICTIONARY_DUPLICATE",
  "mHelpDesk returned an unsupported ticket status dictionary.": "STATUS_DICTIONARY_SHAPE",
  "mHelpDesk returned an invalid ticket status dictionary.": "STATUS_DICTIONARY_INVALID",
  "mHelpDesk returned inconsistent ticket status identities.": "STATUS_DICTIONARY_IDENTITIES",
  "mHelpDesk returned an unsupported ticket page.": "PAGE_SHAPE",
  "The ticket preview exceeds its maximum count. Use a smaller creation window.": "COUNT_LIMIT",
  "mHelpDesk ticket totals changed during the preview. Retry.": "TOTAL_CHANGED",
  "mHelpDesk returned tickets outside the requested creation window.": "WINDOW_MISMATCH",
  "mHelpDesk did not return tickets in stable identity order.": "IDENTITY_ORDER",
  "mHelpDesk returned overlapping or incomplete ticket pages.": "PAGE_OVERLAP",
  "mHelpDesk returned duplicate ticket identities.": "IDENTITY_DUPLICATE",
  "mHelpDesk returned an incomplete ticket page.": "PAGE_INCOMPLETE",
  "Unsupported mHelpDesk ticket preview.": "PROJECTION_INVALID",
  "Unsupported mHelpDesk ticket preview count.": "PROJECTION_INVALID",
  "Incomplete mHelpDesk ticket preview.": "PROJECTION_INVALID",
  "Unsupported mHelpDesk ticket preview dictionaries.": "PROJECTION_INVALID",
  "Inconsistent mHelpDesk ticket preview counts.": "PROJECTION_INVALID",
  "Provide a bounded ticket creation window.": "WINDOW_INVALID",
  "Provide timezone-bearing ticket creation dates.": "WINDOW_INVALID",
  "Use a ticket window of at most 31 days and a limit from 1 to 500.": "WINDOW_INVALID",
  "The ticket preview request contains unsupported fields.": "WINDOW_INVALID"
});
var OPERATIONS = ["appointment_read", "ticket_detail_read", "account_read", "ticket_read", "ticket_types_read", "ticket_statuses_read"];
var MHELP_PREVIEW_DIAGNOSTIC_CODES = Object.freeze([.../* @__PURE__ */ new Set([
  ...Object.values(REASONS),
  "PROVIDER_HTTP",
  "RATE_LIMIT",
  "INTERNAL_FAILURE"
])]);
function mhelpTicketDiagnostic(cause) {
  let code = "INTERNAL_FAILURE", httpStatus = 503;
  let operation = null, providerHttpStatus = null;
  if (cause instanceof MhelpTicketError) {
    if ([400, 409, 429, 503].includes(cause.status)) httpStatus = cause.status;
    if (Object.hasOwn(REASONS, cause.message)) code = REASONS[cause.message];
    if (cause.message === "mHelpDesk is limiting ticket reads. Retry later.") code = "RATE_LIMIT";
    if (cause.message === "mHelpDesk denied or could not complete the ticket read.") code = "PROVIDER_HTTP";
    if (cause.provider && OPERATIONS.includes(cause.provider.operation) && Number.isInteger(cause.provider.httpStatus) && cause.provider.httpStatus >= 100 && cause.provider.httpStatus <= 599) {
      operation = cause.provider.operation;
      providerHttpStatus = cause.provider.httpStatus;
    }
  }
  const renewal = code === "RENEWAL_FAILED" && cause instanceof MhelpTicketError ? projectMhelpTokenRenewalDiagnostic(cause.renewal) : void 0;
  return {
    error: "MHELP_PREVIEW_" + code,
    httpStatus,
    log: {
      event: "mhelp_ticket_preview_failed",
      code,
      httpStatus,
      operation,
      providerHttpStatus,
      ...renewal ? { renewal } : {},
      ...cause instanceof MhelpTicketError && cause.schema ? { schema: projectMhelpTicketSchema(cause.schema) } : {},
      ...cause instanceof MhelpTicketError && cause.detailSchema ? { detailSchema: projectMhelpTicketDetailFailure(cause.detailSchema) } : {}
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpReconnect.ts
var MhelpReconnectError = class extends Error {
  status;
  constructor(status2 = 503, revisionChanged = false) {
    super(status2 === 403 ? "The active COS Owner authorization changed. Reopen reconnect after signing in." : status2 === 400 ? "Enter a fresh matching token pair and reopen the reconnect form if its connection revision changed." : status2 === 409 ? revisionChanged ? "The mHelp connection changed. Reopen reconnect before trying again." : "A token update is already running. Check the reconnect result before trying again." : "Reconnect could not be confirmed. Check the reconnect result before trying again.");
    this.status = status2;
  }
};

// tech-checks/supabase/functions/cos-operations-pages/fallbackGeocodeProjection.ts
var object30 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var statuses2 = /* @__PURE__ */ new Set(["pending", "deferred", "success", "no_match", "provider_error"]);
var reasons = /* @__PURE__ */ new Set([null, ...geocodeRejectionReasons, "no_match", "provider_timeout", "provider_unavailable", "invalid_response", "provider_forbidden", "provider_rate_limited", "configuration_unavailable", "budget_exhausted", "duplicate_inflight", "attempts_exhausted", "daily_attempt_limit", "invalid_address", "lease_expired", "reset_guard"]);
var coord = (v, max) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
async function projectFallbackGeocodes(snapshot, records2) {
  if (!Array.isArray(records2)) throw Error("Address fallback unavailable");
  const byAudit = /* @__PURE__ */ new Map();
  for (const r of records2) {
    if (!object30(r) || typeof r.auditId !== "string" || byAudit.has(r.auditId)) throw Error("Address fallback identity invalid");
    byAudit.set(r.auditId, r);
  }
  const apply = async (row2) => {
    if (row2.placement !== "FIELD" || row2.placementSource !== "owner" || row2.placementStatus === "needs_identity_review" || typeof row2.placementAuditId !== "string" || typeof row2.placementUnitKey !== "string" || typeof row2.address !== "string" || row2.locationVerification === "owner_verified" || row2.locationGeocode?.status === "success" || row2.locationGeocode?.censusOnly === true) return row2;
    const r = byAudit.get(row2.placementAuditId);
    if (!r || r.unitKey !== row2.placementUnitKey || r.addressSha256 !== await addressDigest(row2.address) || !statuses2.has(r.status) || r.provider !== "geocodio" || r.verified !== false || r.liveGps !== false || r.confidence !== "estimate") return row2;
    if (r.status === "success") {
      const original = parseOwnerInstallationAddress(row2.address, fullMatchedParts)?.installation;
      if (!original || !matchesInstallation(original, r.matchedAddress) || !coord(r.latitude, 90) || !coord(r.longitude, 180) || typeof r.geocodedAt !== "string" || !Number.isFinite(Date.parse(r.geocodedAt)) || Date.parse(r.geocodedAt) > Date.now() || !["rooftop", "range_interpolation"].includes(r.accuracyType) || typeof r.accuracy !== "number" || !Number.isFinite(r.accuracy) || r.accuracy < 0.9 || r.accuracy > 1 || ![null, "building_centroid", "parcel_centroid"].includes(r.matchType ?? null) || r.accuracyType === "range_interpolation" && r.matchType != null) return row2;
    }
    return { ...row2, locationGeocode: {
      status: r.status,
      auditId: r.auditId,
      unitKey: r.unitKey,
      addressSha256: r.addressSha256,
      provider: "geocodio",
      source: "geocodio_automatic_address_estimate",
      confidence: "estimate",
      verified: false,
      liveGps: false,
      reason: reasons.has(r.reason) ? r.reason : null,
      attempts: Number.isInteger(r.attempts) && r.attempts >= 0 ? r.attempts : 0,
      nextAttemptAt: typeof r.nextAttemptAt === "string" && Number.isFinite(Date.parse(r.nextAttemptAt)) ? r.nextAttemptAt : null,
      ...r.status === "success" ? { latitude: r.latitude, longitude: r.longitude, matchedAddress: r.matchedAddress, geocodedAt: r.geocodedAt, accuracyType: r.accuracyType, accuracy: r.accuracy, matchType: r.matchType ?? null } : {}
    } };
  };
  return { ...snapshot, items: await Promise.all(snapshot.items.map(apply)), inventoryItems: await Promise.all(snapshot.inventoryItems.map(apply)) };
}

// tech-checks/supabase/functions/cos-operations-pages/importedSourceProjectionV2.ts
var ORG4 = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var object31 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid20 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var sha8 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var decimal4 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
var coord2 = (v, limit) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
var identity3 = (r) => (r.readOnly === true ? "tracker" : "equipment_unit") + "|" + r.id;
function labelKeys2() {
  const matches2 = /* @__PURE__ */ new Map(), concerns = /* @__PURE__ */ new Map();
  const match = (value2) => {
    if (typeof value2 !== "string") return placementMatchKey(value2);
    let key2 = matches2.get(value2);
    if (key2 === void 0) {
      key2 = placementMatchKey(value2);
      matches2.set(value2, key2);
    }
    return key2;
  };
  const concern3 = (value2) => {
    if (typeof value2 !== "string") return match(value2).replace(/\|(?:HD4|HDC[24]S?)$/, "");
    let key2 = concerns.get(value2);
    if (key2 === void 0) {
      key2 = match(value2).replace(/\|(?:HD4|HDC[24]S?)$/, "");
      concerns.set(value2, key2);
    }
    return key2;
  };
  return { match, concern: concern3 };
}
var deviceId3 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : decimal4(v) ? String(v) : null;
var sameSet2 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
function currentNativeSourceIdentity(source) {
  const p = source.nativeSourceIdentity;
  return Boolean(source.schemaVersion === 1 && source.organizationId === ORG4 && source.sourceSystem === "mhelpdesk_product_import" && source.entityKind === "equipment_unit" && uuid20(source.nativeUnitId) && decimal4(source.productId) && uuid20(source.sourceRevision) && decimal4(source.eventId) && ["sourceFileSha256", "sourceRowSha256", "nativeGuardSha256"].every((k) => sha8(source[k])) && ["FIELD", "SHOP"].includes(source.placement) && source.eligibility === (source.placement === "FIELD" ? "FIELD" : "tombstone") && object31(p) && p.contract === "COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1" && uuid20(p.trackerId) && typeof p.trackerUnitNumber === "string" && ["nativeUnitId", "productId", "unitNumber", "sourceRevision", "sourceFileSha256", "sourceRowSha256", "nativeGuardSha256"].every((k) => p[k] === source[k]) && placementMatchKey(p.trackerUnitNumber) === placementMatchKey(source.unitNumber));
}
function sourceOnlyOverlayIds(inventory, sources, audits, devices, context) {
  const allowed = /* @__PURE__ */ new Set();
  if (!context) return allowed;
  const { match, concern: concern3 } = labelKeys2();
  const units = context.nativeUnits, identity4 = context.identity;
  if (![inventory, sources, audits, devices, units].every((rows5) => Array.isArray(rows5) && rows5.length <= 1e5 && rows5.every(object31)) || !object31(identity4) || identity4.identityVersion !== 1 || !Array.isArray(identity4.unitIdentities) || !Array.isArray(identity4.identityWarnings) || (identity4.ownerConfirmedIdentityVersion === void 0 ? identity4.ownerConfirmedUnitIdentities !== void 0 : identity4.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(identity4.ownerConfirmedUnitIdentities))) return allowed;
  const rows4 = inventory, native = units, sourceRows = sources, history = audits, cameras = devices;
  const nativeRows = rows4.filter((r) => r.readOnly === false), nativeIds = new Set(native.map((u) => u.id));
  if (native.some((u) => !uuid20(u.id) || u.organization_id !== ORG4 || typeof u.unit_number !== "string") || nativeIds.size !== native.length || !sameSet2(nativeRows.map((r) => r.id), native.map((u) => u.id)) || nativeRows.some((r) => native.find((u) => u.id === r.id)?.unit_number !== r.unitNumber) || new Set(rows4.map((r) => r.id)).size !== rows4.length || new Set(sourceRows.map((s) => s.entityKind + "|" + s.nativeUnitId)).size !== sourceRows.length || cameras.some((d) => !deviceId3(d.id) || typeof d.unit_key !== "string") || new Set(cameras.map((d) => deviceId3(d.id))).size !== cameras.length || history.some((a) => !deviceId3(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((id15) => !deviceId3(id15))) || new Set(history.map((a) => deviceId3(a.id))).size !== history.length) return allowed;
  const nativeById = new Map(nativeRows.map((r) => [r.id, r]));
  const archives = checkedArchivedRepresentations(rows4, context.archivedRepresentations, history, cameras, context);
  const inventoryById = new Map(rows4.map((r) => [r.id, r]));
  const archivedNativeCounts = /* @__PURE__ */ new Map(), archivedInventoryCounts = /* @__PURE__ */ new Map();
  for (const proof of archives) {
    const base2 = concern3(proof.canonicalUnitNumber);
    for (const archivedId of [proof.archivedNativeId, proof.archivedTrackerId]) {
      const nativeRow = nativeById.get(archivedId), inventoryRow = inventoryById.get(archivedId);
      if (nativeRow && concern3(nativeRow.unitNumber) === base2) archivedNativeCounts.set(proof.canonicalNativeId, (archivedNativeCounts.get(proof.canonicalNativeId) || 0) + 1);
      if (inventoryRow && concern3(inventoryRow.unitNumber) === base2) archivedInventoryCounts.set(proof.canonicalNativeId, (archivedInventoryCounts.get(proof.canonicalNativeId) || 0) + 1);
    }
  }
  const nativeConcerns = /* @__PURE__ */ new Map(), inventoryConcerns = /* @__PURE__ */ new Map(), cameraGroups = /* @__PURE__ */ new Map();
  for (const u of native) {
    const key2 = concern3(u.unit_number);
    nativeConcerns.set(key2, (nativeConcerns.get(key2) || 0) + 1);
  }
  for (const r of rows4) {
    const key2 = concern3(r.unitNumber);
    inventoryConcerns.set(key2, (inventoryConcerns.get(key2) || 0) + 1);
  }
  for (const d of cameras) {
    const key2 = concern3(d.unit_key), group = cameraGroups.get(key2);
    if (group) group.push(d);
    else cameraGroups.set(key2, [d]);
  }
  const proofs = [...identity4.unitIdentities, ...identity4.ownerConfirmedUnitIdentities || []], warnings = identity4.identityWarnings;
  if (proofs.some((p) => !object31(p) || !uuid20(p.unitId) || typeof p.unitNumber !== "string" || !["native_provider", "owner_placement", "owner_confirmed_native"].includes(p.kind) || !sha8(p.proof) || !Array.isArray(p.deviceIds) || !p.deviceIds.length || p.deviceIds.some((id15) => typeof id15 !== "string" || !deviceId3(id15)) || !Array.isArray(p.unitKeys) || !p.unitKeys.length || p.unitKeys.some((k) => typeof k !== "string")) || warnings.some((w) => !object31(w) || typeof w.unitId !== "string" || !Array.isArray(w.deviceIds) || !Array.isArray(w.unitKeys) || w.deviceIds.some((id15) => typeof id15 !== "string" || !deviceId3(id15)) || w.unitKeys.some((k) => typeof k !== "string"))) return allowed;
  for (const source of sourceRows) {
    if (!currentNativeSourceIdentity(source)) continue;
    const row2 = nativeById.get(source.nativeUnitId), key2 = match(source.unitNumber), base2 = concern3(source.unitNumber);
    if (!row2 || row2.unitNumber !== source.unitNumber || !key2.startsWith("typed:") || !/\|(?:HD4|HDC[24]S?)$/.test(key2) || (nativeConcerns.get(base2) || 0) > 1 + (archivedNativeCounts.get(row2.id) || 0) || (inventoryConcerns.get(base2) || 0) > 1 + (archivedInventoryCounts.get(row2.id) || 0)) continue;
    const group = cameraGroups.get(base2) || [], labels = [...new Set(group.map((d) => d.unit_key))], ids = group.map((d) => deviceId3(d.id));
    if (labels.length !== 1 || match(labels[0]) !== base2) continue;
    if (history.some((a) => concern3(a.unit_key) === base2 || a.device_ids.some((id15) => ids.includes(deviceId3(id15))))) continue;
    const related = (p) => p.unitKeys.some((k) => concern3(k) === base2) || p.deviceIds.some((id15) => ids.includes(id15));
    if (warnings.some((w) => w.unitId === row2.id || related(w))) continue;
    const claims = proofs.filter((p) => p.unitId === row2.id || related(p));
    if (claims.length && (claims.length !== 1 || claims[0].kind !== "native_provider" || claims[0].unitId !== row2.id || claims[0].unitNumber !== row2.unitNumber || !sameSet2(claims[0].unitKeys, labels) || !sameSet2(claims[0].deviceIds, ids))) continue;
    allowed.add(row2.id);
  }
  return allowed;
}
var trackerRecordId2 = (v) => typeof v === "string" && v.length <= 400 && /^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
var validSourceType2 = (v) => v.schemaVersion === 1 && v.sourceSystem === "mhelpdesk_product_import" && decimal4(v.productId) && !Object.hasOwn(v, "sourceRecordId") || v.schemaVersion === 2 && v.sourceSystem === "google_sheet_tracker" && v.entityKind === "tracker" && trackerRecordId2(v.sourceRecordId) && !Object.hasOwn(v, "productId");
var sourceIdentity2 = (v) => v.sourceSystem === "google_sheet_tracker" ? { sourceSystem: "google_sheet_tracker", sourceRecordId: v.sourceRecordId } : { productId: v.productId };
async function checkedImportedBinding2(v, digest3 = addressDigest) {
  if (typeof digest3 !== "function") digest3 = addressDigest;
  if (!object31(v) || !validSourceType2(v) || v.organizationId !== ORG4 || !["equipment_unit", "tracker"].includes(v.entityKind) || !uuid20(v.nativeUnitId) || !uuid20(v.sourceRevision) || !decimal4(v.eventId) || typeof v.unitNumber !== "string" || !v.unitNumber.trim() || v.unitNumber.length > 250 || !["sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => sha8(v[k])) || v.eligibility !== "FIELD" || !validInstallation(v.installation) || !object31(v.suppliedComponents)) return null;
  const precedence = checkedSourcePrecedence(v);
  if (Object.hasOwn(v, "sourcePrecedence") && !precedence) return null;
  const supplied = suppliedComponents(v.installation);
  if (Object.keys(v.suppliedComponents).length !== 4 || Object.entries(supplied).some(([k, value2]) => v.suppliedComponents[k] !== value2) || await digest3(installationAddress(v.installation)) !== v.addressSha256) return null;
  if (!(v.family === null || typeof v.family === "string" && v.family.length <= 160) || !(v.variant === null || typeof v.variant === "string" && v.variant.length <= 160)) return null;
  return {
    schemaVersion: v.schemaVersion,
    organizationId: ORG4,
    sourceSystem: v.sourceSystem,
    entityKind: v.entityKind,
    nativeUnitId: v.nativeUnitId,
    ...sourceIdentity2(v),
    unitNumber: v.unitNumber,
    family: v.family,
    variant: v.variant,
    sourceRevision: v.sourceRevision,
    sourceFileSha256: v.sourceFileSha256,
    sourceRowSha256: v.sourceRowSha256,
    addressSha256: v.addressSha256,
    nativeGuardSha256: v.nativeGuardSha256,
    installation: { street: v.installation.street, city: v.installation.city, state: v.installation.state, zip: v.installation.zip },
    suppliedComponents: supplied,
    eligibility: "FIELD",
    eventId: v.eventId,
    ...precedence ? { sourcePrecedence: precedence } : {}
  };
}
function legacyConcernReader2(audits, devices) {
  if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) return () => true;
  if (audits.some((a) => !object31(a) || !Array.isArray(a.device_ids))) return () => true;
  const { match, concern: concern3 } = labelKeys2(), groups = /* @__PURE__ */ new Map(), groupData = /* @__PURE__ */ new Map();
  for (const d of devices) {
    if (!object31(d)) continue;
    const key2 = concern3(d.unit_key), group = groups.get(key2);
    if (group) group.push(d);
    else groups.set(key2, [d]);
  }
  const history = audits.map((a) => ({ row: a, key: concern3(a.unit_key) })), results = /* @__PURE__ */ new Map();
  return (unitNumber) => {
    const saved = results.get(unitNumber);
    if (saved !== void 0) return saved;
    const key2 = concern3(unitNumber);
    if (!key2) return true;
    let group = groupData.get(key2);
    if (!group) {
      const rows4 = groups.get(key2) || [];
      group = { ids: new Set(rows4.map((d) => String(d.id))), labels: new Set(rows4.map((d) => match(d.unit_key))) };
      groupData.set(key2, group);
    }
    const mismatch = group.labels.size > 1 || group.labels.size === 1 && !group.labels.has(match(unitNumber));
    const result = mismatch || history.some(({ row: a, key: auditKey2 }) => (auditKey2 === key2 || a.device_ids.some((id15) => group.ids.has(String(id15)))) && (a.contract === "COS_CAMERA_PLACEMENT_V2" || ["MOVE_TO_FIELD", "MOVE_TO_ROOT"].includes(a.action) || auditKey2 !== key2));
    results.set(unitNumber, result);
    return result;
  };
}
function agreeingShopSourceIds(inventory, sources, audits, devices, context) {
  const allowed = /* @__PURE__ */ new Set();
  if (!context || ![inventory, sources, audits, devices, context.nativeUnits, context.currentSources].every((v) => Array.isArray(v) && v.length <= 1e5 && v.every(object31))) return allowed;
  const rows4 = inventory, sourceRows = sources, history = audits, cameras = devices, native = context.nativeUnits, current = context.currentSources, proof = context.identity;
  if (!object31(proof) || proof.identityVersion !== 1 || !Array.isArray(proof.unitIdentities) || !Array.isArray(proof.identityWarnings) || (proof.ownerConfirmedIdentityVersion === void 0 ? proof.ownerConfirmedUnitIdentities !== void 0 : proof.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(proof.ownerConfirmedUnitIdentities))) return allowed;
  const { match, concern: concern3 } = labelKeys2(), rowById = new Map(rows4.map((r) => [r.id, r])), nativeById = new Map(native.map((r) => [r.id, r]));
  const sourceKey = (s) => s.entityKind + "|" + s.nativeUnitId, currentById = new Map(current.map((s) => [sourceKey(s), s]));
  if (rows4.some((r) => !uuid20(r.id) || typeof r.unitNumber !== "string" || typeof r.readOnly !== "boolean") || rowById.size !== rows4.length || nativeById.size !== native.length || native.some((r) => !uuid20(r.id) || r.organization_id !== ORG4 || typeof r.unit_number !== "string") || rows4.filter((r) => r.readOnly === false).length !== native.length || rows4.some((r) => r.readOnly === false && nativeById.get(r.id)?.unit_number !== r.unitNumber) || currentById.size !== current.length || new Set(sourceRows.map(sourceKey)).size !== sourceRows.length || [...sourceRows, ...current].some((s) => !["equipment_unit", "tracker"].includes(s.entityKind) || !uuid20(s.nativeUnitId)) || cameras.some((d) => !deviceId3(d.id) || typeof d.unit_key !== "string") || new Set(cameras.map((d) => deviceId3(d.id))).size !== cameras.length || history.some((a) => !deviceId3(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((id15) => !deviceId3(id15))) || new Set(history.map((a) => deviceId3(a.id))).size !== history.length) return allowed;
  const claims = [...proof.unitIdentities, ...proof.ownerConfirmedUnitIdentities || []], warnings = proof.identityWarnings;
  const validResources = (p) => Array.isArray(p.deviceIds) && p.deviceIds.length <= 1e5 && p.deviceIds.every((id15) => typeof id15 === "string" && deviceId3(id15)) && new Set(p.deviceIds).size === p.deviceIds.length && Array.isArray(p.unitKeys) && p.unitKeys.length <= 1e5 && p.unitKeys.every((k) => typeof k === "string" && k.trim()) && new Set(p.unitKeys).size === p.unitKeys.length;
  if (claims.length > 1e5 || warnings.length > 1e5 || claims.some((p) => !object31(p) || !uuid20(p.unitId) || typeof p.unitNumber !== "string" || !["native_provider", "owner_placement", "owner_confirmed_native"].includes(p.kind) || !sha8(p.proof) || !validResources(p) || !p.deviceIds.length || !p.unitKeys.length) || warnings.some((p) => !object31(p) || typeof p.unitId !== "string" || !validResources(p))) return allowed;
  const counts2 = /* @__PURE__ */ new Map(), products = /* @__PURE__ */ new Map(), groups = /* @__PURE__ */ new Map(), groupsByMatch = /* @__PURE__ */ new Map();
  const byConcern = /* @__PURE__ */ new Map(), byDevice = /* @__PURE__ */ new Map(), claimsByUnit = /* @__PURE__ */ new Map(), claimsByConcern = /* @__PURE__ */ new Map(), claimsByDevice = /* @__PURE__ */ new Map(), warningsByUnit = /* @__PURE__ */ new Map(), warningsByConcern = /* @__PURE__ */ new Map(), warningsByDevice = /* @__PURE__ */ new Map();
  const add = (index2, key2, row2) => {
    let group = index2.get(key2);
    if (!group) {
      group = /* @__PURE__ */ new Set();
      index2.set(key2, group);
    }
    group.add(row2);
  };
  for (const row2 of rows4) {
    const key2 = concern3(row2.unitNumber);
    counts2.set(key2, (counts2.get(key2) || 0) + 1);
  }
  for (const s of current) if (s.sourceSystem === "mhelpdesk_product_import") {
    products.set(s.productId, (products.get(s.productId) || 0) + 1);
  }
  for (const d of cameras) {
    let group = groups.get(d.unit_key);
    if (!group) {
      group = [];
      groups.set(d.unit_key, group);
    }
    group.push(d);
    const key2 = match(d.unit_key), labels = groupsByMatch.get(key2) || /* @__PURE__ */ new Set();
    labels.add(d.unit_key);
    groupsByMatch.set(key2, labels);
  }
  for (const a of history) {
    add(byConcern, concern3(a.unit_key), a);
    for (const id15 of a.device_ids) add(byDevice, deviceId3(id15), a);
  }
  const indexClaims = (records2, units, labels, ids) => {
    for (const p of records2) {
      add(units, p.unitId, p);
      for (const k of p.unitKeys) add(labels, concern3(k), p);
      for (const id15 of p.deviceIds) add(ids, id15, p);
    }
  };
  indexClaims(claims, claimsByUnit, claimsByConcern, claimsByDevice);
  indexClaims(warnings, warningsByUnit, warningsByConcern, warningsByDevice);
  const cameraConcerns = /* @__PURE__ */ new Map();
  for (const key2 of groups.keys()) {
    const base2 = concern3(key2), labels = cameraConcerns.get(base2) || /* @__PURE__ */ new Set();
    labels.add(key2);
    cameraConcerns.set(base2, labels);
  }
  const related = (units, labels, resources, row2, base2, ids) => {
    const found = /* @__PURE__ */ new Set([...units.get(row2.id) || [], ...labels.get(base2) || []]);
    for (const id15 of ids) for (const item of resources.get(id15) || []) found.add(item);
    return found;
  };
  const rosterAgrees = (values, ids) => values.length === ids.size && new Set(values.map(deviceId3)).size === values.length && values.every((v) => ids.has(deviceId3(v)));
  const validShop = (s) => s.schemaVersion === 1 && s.organizationId === ORG4 && s.sourceSystem === "mhelpdesk_product_import" && decimal4(s.productId) && uuid20(s.sourceRevision) && decimal4(s.eventId) && s.placement === "SHOP" && s.eligibility === "tombstone" && s.installation === null && s.addressSha256 === null && s.suppliedComponents === null && ["sourceFileSha256", "sourceRowSha256", "nativeGuardSha256"].every((k) => sha8(s[k])) && !Object.hasOwn(s, "sourcePrecedence") && !Object.hasOwn(s, "sourceRecordId");
  const sourceFields3 = ["schemaVersion", "organizationId", "sourceSystem", "entityKind", "nativeUnitId", "productId", "unitNumber", "sourceRevision", "eventId", "sourceFileSha256", "sourceRowSha256", "nativeGuardSha256", "placement", "eligibility", "siteLabel"];
  for (const source of sourceRows) {
    const fresh2 = currentById.get(sourceKey(source)), row2 = rowById.get(source.nativeUnitId);
    if (!row2 || row2._sourceField !== true || !fresh2 || !validShop(source) || !validShop(fresh2) || sourceFields3.some((k) => source[k] !== fresh2[k]) || products.get(source.productId) !== 1 || sourceKey(source) !== identity3(row2) || row2.unitNumber !== source.unitNumber || !match(row2.unitNumber).startsWith("typed:") || row2.placementAuditId != null) continue;
    const base2 = concern3(row2.unitNumber);
    if (counts2.get(base2) !== 1) continue;
    let key2;
    if (row2.readOnly === false) {
      const own6 = [...claimsByUnit.get(row2.id) || []];
      if (!currentNativeSourceIdentity(source) || !currentNativeSourceIdentity(fresh2) || source.nativeSourceIdentity.trackerId !== fresh2.nativeSourceIdentity.trackerId || source.nativeSourceIdentity.trackerUnitNumber !== fresh2.nativeSourceIdentity.trackerUnitNumber || own6.length !== 1 || own6[0].kind !== "native_provider" || own6[0].unitNumber !== row2.unitNumber || own6[0].unitKeys.length !== 1) continue;
      key2 = own6[0].unitKeys[0];
    } else {
      if (source.nativeSourceIdentity != null || fresh2.nativeSourceIdentity != null) continue;
      const labels = groupsByMatch.get(match(row2.unitNumber));
      if (labels?.size !== 1) continue;
      key2 = [...labels][0];
    }
    if (concern3(key2) !== base2 || cameraConcerns.get(base2)?.size !== 1) continue;
    const group = groups.get(key2) || [], ids = group.map((d) => deviceId3(d.id)), idSet = new Set(ids);
    if (!group.length || group.some((d) => d.organization !== "root" || d.activation_state !== "deactivated")) continue;
    const associations = related(claimsByUnit, claimsByConcern, claimsByDevice, row2, base2, ids);
    if (related(warningsByUnit, warningsByConcern, warningsByDevice, row2, base2, ids).size || (row2.readOnly ? associations.size !== 0 : associations.size !== 1 || ![...associations].every((p) => p.unitId === row2.id && p.kind === "native_provider" && p.unitNumber === row2.unitNumber && p.unitKeys.length === 1 && p.unitKeys[0] === key2 && rosterAgrees(p.deviceIds, idSet)))) continue;
    const relatedHistory = new Set(byConcern.get(base2) || []);
    for (const id15 of ids) for (const a of byDevice.get(id15) || []) relatedHistory.add(a);
    let latest, invalid5 = false;
    for (const a of relatedHistory) {
      if (a.unit_key !== key2 || !["MOVE_TO_ROOT", "MOVE_TO_FIELD"].includes(a.action) || ["contract", "control_id", "request_id", "placement", "site_label", "street_address"].some((k) => a[k] != null) || !rosterAgrees(a.device_ids, idSet) || typeof a.created_at !== "string" || !Number.isFinite(Date.parse(a.created_at))) {
        invalid5 = true;
        break;
      }
      if (!latest || BigInt(deviceId3(a.id)) > BigInt(deviceId3(latest.id))) latest = a;
    }
    if (invalid5 || !latest || latest.action !== "MOVE_TO_ROOT" || [...relatedHistory].some((a) => Date.parse(a.created_at) > Date.parse(latest.created_at))) continue;
    allowed.add(row2.id);
  }
  return allowed;
}
async function reviewedSourcePrecedenceIds(inventory, sources, audits, devices, context) {
  const allowed = /* @__PURE__ */ new Set();
  if (!Array.isArray(sources) || !sources.some((s) => object31(s) && Object.hasOwn(s, "sourcePrecedence"))) return allowed;
  if (!context || ![inventory, audits, devices, context.nativeUnits].every((v) => Array.isArray(v) && v.length <= 1e5 && v.every(object31))) return allowed;
  const rows4 = inventory, history = audits, cameras = devices, native = context.nativeUnits, proof = context.identity;
  if (!object31(proof) || proof.identityVersion !== 1 || !Array.isArray(proof.unitIdentities) || !Array.isArray(proof.identityWarnings) || (proof.ownerConfirmedIdentityVersion === void 0 ? proof.ownerConfirmedUnitIdentities !== void 0 : proof.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(proof.ownerConfirmedUnitIdentities))) return allowed;
  const { match, concern: concern3 } = labelKeys2(), rowById = new Map(rows4.map((r) => [r.id, r])), nativeById = new Map(native.map((r) => [r.id, r]));
  if (rowById.size !== rows4.length || nativeById.size !== native.length || native.some((r) => !uuid20(r.id) || r.organization_id !== ORG4 || typeof r.unit_number !== "string") || rows4.filter((r) => r.readOnly === false).length !== native.length || rows4.some((r) => r.readOnly === false && nativeById.get(r.id)?.unit_number !== r.unitNumber) || cameras.some((d) => !deviceId3(d.id) || typeof d.unit_key !== "string") || new Set(cameras.map((d) => deviceId3(d.id))).size !== cameras.length || history.some((a) => !deviceId3(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((id15) => !deviceId3(id15))) || new Set(history.map((a) => deviceId3(a.id))).size !== history.length) return allowed;
  const counts2 = /* @__PURE__ */ new Map(), groups = /* @__PURE__ */ new Map(), auditsByConcern = /* @__PURE__ */ new Map(), auditsByDevice = /* @__PURE__ */ new Map();
  for (const r of rows4) {
    const key2 = concern3(r.unitNumber);
    counts2.set(key2, (counts2.get(key2) || 0) + 1);
  }
  for (const d of cameras) {
    const key2 = concern3(d.unit_key), group = groups.get(key2) || [];
    group.push(d);
    groups.set(key2, group);
  }
  for (const a of history) {
    const key2 = concern3(a.unit_key), group = auditsByConcern.get(key2) || /* @__PURE__ */ new Set();
    group.add(a);
    auditsByConcern.set(key2, group);
    for (const id15 of a.device_ids) {
      const key3 = deviceId3(id15), group2 = auditsByDevice.get(key3) || /* @__PURE__ */ new Set();
      group2.add(a);
      auditsByDevice.set(key3, group2);
    }
  }
  const confirmed = new Set(Array.isArray(context.confirmedPrecedenceBindings) ? context.confirmedPrecedenceBindings.filter(object31).map((b) => JSON.stringify(b)) : []);
  const claims = [...proof.unitIdentities, ...proof.ownerConfirmedUnitIdentities || []];
  if ([...claims, ...proof.identityWarnings].some((p) => !object31(p) || !Array.isArray(p.unitKeys) || !Array.isArray(p.deviceIds))) return allowed;
  for (const source of sources) {
    const p = checkedSourcePrecedence(source);
    if (!p || !currentNativeSourceIdentity(source)) continue;
    const binding = await checkedImportedBinding2(source);
    if (!binding || !confirmed.has(JSON.stringify(binding))) continue;
    const row2 = rowById.get(source.nativeUnitId), base2 = concern3(source.unitNumber), group = groups.get(base2) || [], ids = group.map((d) => deviceId3(d.id));
    if (!row2 || row2.readOnly !== false || row2.unitNumber !== source.unitNumber || !nativeById.has(row2.id) || counts2.get(base2) !== 1 || match(source.unitNumber) !== match(p.unitKey) || group.some((d) => d.unit_key !== p.unitKey) || !sameSet2(ids, p.deviceIds)) continue;
    const related = new Set(auditsByConcern.get(base2) || []);
    for (const id15 of ids) for (const a2 of auditsByDevice.get(id15) || []) related.add(a2);
    if (related.size !== 1) continue;
    const a = [...related][0];
    if (deviceId3(a.id) !== p.legacyAuditId || a.unit_key !== p.unitKey || a.action !== "MOVE_TO_ROOT" || a.contract != null || a.control_id != null || a.request_id != null || a.placement != null || a.site_label != null || a.street_address != null || !sameSet2(a.device_ids.map(deviceId3), p.deviceIds) || !(Date.parse(a.created_at) < Date.parse(p.reviewedAt)) || await sourcePrecedenceAuditSha256(a) !== p.legacyAuditSha256) continue;
    const relatedClaim = (v) => v.unitId === row2.id || v.unitKeys.some((k) => concern3(k) === base2) || v.deviceIds.some((id15) => ids.includes(id15));
    if (proof.identityWarnings.some(relatedClaim)) continue;
    const associations = claims.filter(relatedClaim);
    if (associations.length && (associations.length !== 1 || !["native_provider", "owner_confirmed_native"].includes(associations[0].kind) || associations[0].unitId !== row2.id || associations[0].unitNumber !== row2.unitNumber || !sha8(associations[0].proof) || !sameSet2(associations[0].unitKeys, [p.unitKey]) || !sameSet2(associations[0].deviceIds, ids))) continue;
    allowed.add(row2.id);
  }
  return allowed;
}
async function projectImportedSourceAddresses(snapshot, sources, audits, devices, previousSources = [], context) {
  if (!Array.isArray(sources) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(snapshot.items) || !object31(snapshot.summary)) throw Error("Imported source projection unavailable");
  const byId = /* @__PURE__ */ new Map();
  for (const s of sources) {
    if (!object31(s) || !["equipment_unit", "tracker"].includes(s.entityKind) || !uuid20(s.nativeUnitId) || byId.has(s.entityKind + "|" + s.nativeUnitId)) throw Error("Imported source identity invalid");
    byId.set(s.entityKind + "|" + s.nativeUnitId, s);
  }
  const previouslyImported = new Set(previousSources.map((s) => s.entityKind + "|" + s.nativeUnitId));
  const sourceOnly = sourceOnlyOverlayIds(snapshot.inventoryItems, sources, audits, devices, context);
  const agreeingShop = agreeingShopSourceIds(snapshot.inventoryItems, sources, audits, devices, context);
  const reviewed2 = await reviewedSourcePrecedenceIds(snapshot.inventoryItems, sources, audits, devices, context);
  const legacyConcernForUnit = legacyConcernReader2(audits, devices);
  const inventoryItems = await Promise.all(snapshot.inventoryItems.map(async (raw) => {
    const s = byId.get(identity3(raw));
    if (!s && previouslyImported.has(identity3(raw)) && raw.locationVerification !== "owner_verified" && raw.hasUnitGps !== true && raw.placementSource !== "owner") return { ...raw, _sourceField: false, currentLocationType: "unknown", importedSourceState: "source_changed", importedInstallation: null, latitude: null, longitude: null, coordinateSource: null };
    if (!s || Object.hasOwn(s, "sourcePrecedence") && !reviewed2.has(raw.id) || s.unitNumber !== raw.unitNumber || raw.placementSource === "owner" || raw.placementStatus === "needs_identity_review" || raw.placement === "UNKNOWN" || raw.hasUnitGps === true || raw.locationVerification === "owner_verified" || raw.installedSiteId != null || legacyConcernForUnit(raw.unitNumber) && !sourceOnly.has(raw.id) && !reviewed2.has(raw.id) && !agreeingShop.has(raw.id)) return raw;
    const sourceLabel = typeof s.siteLabel === "string" && s.siteLabel.trim() && s.siteLabel.length <= 250 ? s.siteLabel : null;
    const customerLabel = s.sourceSystem === "google_sheet_tracker" ? typeof s.customerLabel === "string" && s.customerLabel.trim() && s.customerLabel.length <= 250 ? s.customerLabel : null : sourceLabel;
    if (s.placement === "SHOP") {
      if (!uuid20(s.sourceRevision) || !(validSourceType2(s) || s.schemaVersion === void 0 && s.sourceSystem === void 0 && !Object.hasOwn(s, "sourceRecordId") && decimal4(s.productId)) || !decimal4(s.eventId) || !sha8(s.nativeGuardSha256) || !sha8(s.sourceFileSha256) || !sha8(s.sourceRowSha256)) return raw;
      return { ...raw, customer: customerLabel, site: "SHOP / ROOT", address: null, addressSource: null, addressUpdatedAt: null, _sourceField: false, status: "readiness_unverified", currentLocationType: "shop", placement: null, placementSource: null, placementUnitKey: null, placementAuditId: null, placementUpdatedAt: null, importedPlacement: "SHOP", importedInstallation: { entityKind: s.entityKind, nativeUnitId: s.nativeUnitId, ...sourceIdentity2(s), sourceRevision: s.sourceRevision, eventId: s.eventId, nativeGuardSha256: s.nativeGuardSha256, sourceFileSha256: s.sourceFileSha256, sourceRowSha256: s.sourceRowSha256, placement: "SHOP" }, latitude: null, longitude: null, coordinateSource: null };
    }
    const binding = await checkedImportedBinding2(s);
    if (s.placement !== "FIELD" || !binding) return raw;
    const reviewedCandidate = (raw.locationNote?.startsWith?.(reviewedEstimatePrefix) || raw.coordinateSource === reviewedEstimateSource || raw.historicalCoordinateSource === reviewedEstimateSource) && typeof raw.address === "string" && await addressDigest(raw.address) === binding.addressSha256 ? { ...raw, addressEstimateLegacyEvidenceSha256: await reviewedLegacyEvidenceSha256(raw.unitNumber, audits, devices, placementMatchKey) } : null;
    const preserveReviewed = reviewedCandidate && await checkedReviewedAddressEstimate(reviewedCandidate);
    const reviewedDirect = preserveReviewed && raw.historicalCoordinateSource !== reviewedEstimateSource && raw.coordinateSource === reviewedEstimateSource;
    const coordinates = preserveReviewed ? {
      address: raw.address,
      latitude: reviewedDirect ? raw.latitude : null,
      longitude: reviewedDirect ? raw.longitude : null,
      coordinateSource: reviewedDirect ? raw.coordinateSource : null,
      locationVerification: raw.locationVerification,
      locationVerifiedAt: raw.locationVerifiedAt,
      locationHistoryId: raw.locationHistoryId,
      addressEstimateLegacyEvidenceSha256: reviewedCandidate.addressEstimateLegacyEvidenceSha256
    } : {
      latitude: null,
      longitude: null,
      coordinateSource: null,
      locationVerification: "address_only",
      locationVerifiedAt: null,
      locationHistoryId: null,
      ...raw.historicalCoordinateSource === reviewedEstimateSource ? { historicalLatitude: null, historicalLongitude: null, historicalCoordinateSource: null } : {}
    };
    return {
      ...raw,
      customer: customerLabel,
      site: sourceLabel ?? "Installation site",
      _sourceField: true,
      placement: null,
      placementSource: null,
      placementUnitKey: null,
      placementAuditId: null,
      placementUpdatedAt: null,
      importedPlacement: "FIELD",
      status: ["assigned", "in_transit", "installed", "returning"].includes(raw.status) ? raw.status : "field",
      currentLocationType: "field",
      address: installationAddress(binding.installation),
      addressSource: binding.sourceSystem === "google_sheet_tracker" ? "Tracker imported installation address" : "mHelpDesk imported installation address",
      recordSource: binding.sourceSystem === "google_sheet_tracker" ? "Tracker imported installation address" : "mHelpDesk imported installation address",
      importedInstallation: binding,
      ...coordinates
    };
  }));
  const items = inventoryItems.filter((r) => r._sourceField === true);
  return { ...snapshot, items, inventoryItems, summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === "string" && r.address.trim()).length } };
}
async function projectImportedGeocodes(snapshot, records2, audits, devices, context) {
  const addressDigests = /* @__PURE__ */ new Map();
  const digest3 = (value2) => {
    if (typeof value2 !== "string") return addressDigest(value2);
    if (!addressDigests.has(value2)) addressDigests.set(value2, addressDigest(value2));
    return addressDigests.get(value2);
  };
  if (!Array.isArray(records2)) throw Error("Imported address estimates unavailable");
  const byId = /* @__PURE__ */ new Map();
  for (const r of records2) {
    if (!object31(r) || !object31(r.binding)) throw Error("Imported estimate identity invalid");
    const key2 = r.binding.entityKind + "|" + r.binding.nativeUnitId;
    if (byId.has(key2)) throw Error("Duplicate imported estimate");
    byId.set(key2, r);
  }
  const sourceOnly = sourceOnlyOverlayIds(snapshot.inventoryItems, context?.currentSources, audits, devices, context);
  const currentSources = Array.isArray(context?.currentSources) ? context.currentSources : [];
  const reviewed2 = await reviewedSourcePrecedenceIds(snapshot.inventoryItems, currentSources, audits, devices, context);
  const legacyConcernForUnit = legacyConcernReader2(audits, devices);
  const apply = async (raw) => {
    const { locationImportedGeocode: _previousImportedGeocode, ...row2 } = raw;
    const legacyConcern = legacyConcernForUnit(row2.unitNumber);
    if (object31(row2.importedInstallation) && Object.hasOwn(row2.importedInstallation, "sourcePrecedence") && !reviewed2.has(row2.id) || row2.placementSource === "owner" || row2.placementAuditId != null || row2.placement === "SHOP" || row2.placement === "UNKNOWN" || row2.placementStatus === "needs_identity_review" || row2.locationVerification === "owner_verified" || row2.hasUnitGps === true || row2.installedSiteId != null || row2.currentLocationType !== "field" || legacyConcern && !sourceOnly.has(row2.id) && !reviewed2.has(row2.id)) return row2;
    const binding = await checkedImportedBinding2(row2.importedInstallation, digest3), r = byId.get(identity3(row2));
    if (!binding || !r || row2.id !== binding.nativeUnitId || row2.unitNumber !== binding.unitNumber || typeof row2.address !== "string" || await digest3(row2.address) !== binding.addressSha256) return row2;
    if (legacyConcern || binding.sourcePrecedence) {
      const current = await checkedImportedBinding2(currentSources.find((s) => object31(s) && s.entityKind === binding.entityKind && s.nativeUnitId === binding.nativeUnitId), digest3);
      if (!current || JSON.stringify(current) !== JSON.stringify(binding)) return row2;
    }
    const returned = await checkedImportedBinding2(r.binding, digest3);
    if (!returned || JSON.stringify(returned) !== JSON.stringify(binding) || r.jobKind !== "native_import" || r.verified !== false || r.liveGps !== false || !sha8(r.legacyGuardSha256) || !["pending", "deferred", "success", "no_match", "provider_error", "held"].includes(r.status)) return row2;
    const geocode = { jobKind: "native_import", binding, legacyGuardSha256: r.legacyGuardSha256, status: r.status, verified: false, liveGps: false };
    if (r.status !== "success") geocode.reason = safeGeocodeRejectionReason(r.reason);
    if (r.status === "success") {
      if (!coord2(r.latitude, 90) || !coord2(r.longitude, 180) || !matchesInstallation(binding.installation, r.matchedAddress) || typeof r.geocodedAt !== "string" || !Number.isFinite(Date.parse(r.geocodedAt)) || Date.parse(r.geocodedAt) > Date.now()) return row2;
      if (r.provider === "geocodio") {
        if (!["rooftop", "range_interpolation"].includes(r.accuracyType) || typeof r.accuracy !== "number" || !Number.isFinite(r.accuracy) || r.accuracy < 0.9 || r.accuracy > 1 || ![null, "building_centroid", "parcel_centroid"].includes(r.matchType ?? null) || r.accuracyType === "range_interpolation" && r.matchType != null) return row2;
      } else if (r.provider !== "us_census_address_range" || r.benchmark !== "Public_AR_Current") return row2;
      Object.assign(geocode, { provider: r.provider, benchmark: r.benchmark ?? null, latitude: r.latitude, longitude: r.longitude, matchedAddress: r.matchedAddress, geocodedAt: r.geocodedAt, accuracyType: r.provider === "geocodio" ? r.accuracyType : "range_interpolation", accuracy: r.provider === "geocodio" ? r.accuracy : null, matchType: r.provider === "geocodio" ? r.matchType ?? null : null, inferredComponents: [...binding.suppliedComponents.city ? [] : ["city"], ...binding.suppliedComponents.zip ? [] : ["zip"]] });
    }
    return { ...row2, locationImportedGeocode: geocode };
  };
  return { ...snapshot, items: await Promise.all(snapshot.items.map(apply)), inventoryItems: await Promise.all(snapshot.inventoryItems.map(apply)) };
}

// tech-checks/supabase/functions/cos-operations-pages/fleetAccess.ts
function verifiedItFleet(context) {
  return context?.department === "it" && context?.legacyOwner === false && (context.legacyId === "4f7044b5-86b6-411f-8898-39bb64b4ddbc" && context.actorId === "d0757b64-9623-4adc-afff-21cc7853e88a" || context.legacyId === "b7cc3cbf-d11e-4d4a-9742-c07701857911" && context.actorId === "3caf7c00-627f-445f-bce4-ddeae574ee5c" || context.legacyId === "05bf20fe-19f7-4db7-ac05-5b2a5f681fdf" && context.actorId === "c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7");
}
function fleetRouteAllowed(method, path) {
  return method === "GET" && /^\/api\/fleet-saved-board\/history\/[a-f0-9-]{36}$/i.test(path) || method === "GET" && (path === "/api/unit-tracker" || /^\/api\/unit-tracker\/(?:requests\/)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path)) || method === "POST" && (path === "/api/fleet-saved-board/refresh" || path === "/api/fleet-saved-board/produce" || path === "/api/unit-tracker/requests" || path === "/api/mhelpdesk/partner/unit-location") || method === "GET" && (/* @__PURE__ */ new Set([
    "/api/fleet-map-source",
    "/api/fleet-saved-board",
    "/api/session",
    "/api/field-map",
    "/api/camera-health/summary",
    "/api/camera-health/summary-v2",
    "/api/camera-health/summary-v3",
    "/api/product-connections",
    "/api/routers",
    // Read-only unit camera status from the Star4Live feed. No write, no placement change.
    "/api/unit-camera-status",
    // Saved, read-only installations only. /refresh and all discovery/sharing writes stay Owner-only.
    "/api/vrm-fleet"
  ])).has(path);
}
function fleetFeatures() {
  return {
    durableFleetBoard: false,
    unitTracker: true,
    fleetAccess: true,
    vrmRead: true,
    fleetPlacementEdit: true,
    fleetConnectionEdit: true,
    cameraHealthV2: true,
    fieldLocationVerification: false,
    mhelpTicketImport: false,
    deliveryGoBack: false
  };
}

// tech-checks/supabase/functions/cos-operations-pages/ownerCensusProof.ts
var { OWNER_CENSUS_PROOF_CONTRACT, OWNER_CENSUS_SOURCE_CONTRACT, OWNER_CENSUS_NATIVE_FIELDS, OWNER_CENSUS_SITE_FIELDS, readOwnerCensusJson, ownerCensusProof, ownerCensusSourceReceipt, readOwnerCensusPreparation, preflightOwnerCensusBinding, readOwnerCensusEvidence, readOwnerCensusProofs, matchesOwnerCensusReceipt, matchesOwnerCensusProof } = /* @__PURE__ */ (() => {
  const OWNER_CENSUS_PROOF_CONTRACT2 = "COS_OWNER_ONE_CENSUS_NATIVE_V1";
  const OWNER_CENSUS_SOURCE_CONTRACT2 = "COS_OWNER_ONE_CENSUS_SOURCE_V1";
  const OWNER_CENSUS_NATIVE_FIELDS2 = ["id", "organization_id", "model_id", "unit_number", "serial_number", "status", "current_location_type", "current_location_ref", "installed_site_id", "retired_at", "updated_at", "gps_latitude", "gps_longitude", "gps_accuracy_m", "gps_source", "gps_recorded_at", "gps_recorded_by"];
  const OWNER_CENSUS_SITE_FIELDS2 = ["id", "organization_id", "name", "address_line1", "address_line2", "city", "state_region", "postal_code", "latitude", "longitude", "updated_at"];
  const ORG6 = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
  const object37 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const uuid27 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
  const sha10 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const decimal7 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
  const text19 = (v, max = 600) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
  const date5 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const sameSet3 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
  const fields4 = (row2, keys3) => keys3.map((k) => {
    if (!Object.hasOwn(row2, k)) throw Error("Incomplete native source");
    return row2[k];
  });
  const coordinate5 = (v, max) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
  function stable(v) {
    if (v === void 0) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  const sorted2 = (rows4) => rows4.map(stable).sort();
  async function digest3(value2) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value2)))), (x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function readOwnerCensusJson2(response, maxBytes = 2097152) {
    if (!response.ok || Number(response.headers.get("content-length") || 0) > maxBytes) {
      await response.body?.cancel();
      throw Error("Owner source unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("Owner source unavailable");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "", size = 0;
    try {
      for (; ; ) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw Error("Owner source unavailable");
        body += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(body + decoder.decode());
    } finally {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
  function targetTuple(value2, unitId, auditAt) {
    const native = value2.native;
    if (!object37(native) || native.id !== unitId || native.organization_id !== ORG6 || !uuid27(native.model_id) || !text19(native.unit_number, 250) || native.retired_at !== null || !date5(native.updated_at)) throw Error("Native placement authority changed");
    const nativeTuple = fields4(native, OWNER_CENSUS_NATIVE_FIELDS2);
    const unassigned = native.status === "available" && native.installed_site_id === null && native.current_location_ref === null && [null, ""].includes(native.current_location_type);
    let siteTuple = null;
    if (unassigned) {
      if (value2.site !== null) throw Error("Unexpected native site");
    } else {
      const site = value2.site;
      if (native.status !== "installed" || native.current_location_type !== "site" || !uuid27(native.installed_site_id) || native.current_location_ref !== native.installed_site_id || Date.parse(native.updated_at) >= Date.parse(auditAt) || native.gps_source !== "site" || !object37(site) || site.id !== native.installed_site_id || site.organization_id !== ORG6 || !date5(site.updated_at) || Date.parse(site.updated_at) >= Date.parse(auditAt) || !(site.latitude === null && site.longitude === null || coordinate5(site.latitude, 90) && coordinate5(site.longitude, 180) && site.latitude === native.gps_latitude && site.longitude === native.gps_longitude)) throw Error("Native site authority is not proved historical");
      siteTuple = fields4(site, OWNER_CENSUS_SITE_FIELDS2);
    }
    const history = value2.history;
    if (!object37(history) || !Array.isArray(history.items) || history.items.length > 1e4) throw Error("Complete history unavailable");
    const seen = /* @__PURE__ */ new Set();
    const rows4 = history.items.map((h) => {
      if (!object37(h) || !uuid27(h.id) || seen.has(h.id) || !coordinate5(h.latitude, 90) || !coordinate5(h.longitude, 180) || !date5(h.recordedAt) || Date.parse(h.recordedAt) >= Date.parse(auditAt) || !(h.accuracyM === null || typeof h.accuracyM === "number" && Number.isFinite(h.accuracyM) && h.accuracyM >= 0) || !text19(h.source, 100) || !(h.note === null || typeof h.note === "string" && h.note.length <= 1e4) || !(h.recordedBy === null || typeof h.recordedBy === "string" && h.recordedBy.length <= 250)) throw Error("History is malformed or newer than Owner placement");
      seen.add(h.id);
      return fields4(h, ["id", "latitude", "longitude", "accuracyM", "source", "note", "recordedAt", "recordedBy"]);
    });
    const gpsKeys = ["gps_latitude", "gps_longitude", "gps_accuracy_m", "gps_source", "gps_recorded_at", "gps_recorded_by"];
    if (gpsKeys.some((k) => native[k] !== null)) {
      if (!coordinate5(native.gps_latitude, 90) || !coordinate5(native.gps_longitude, 180) || !date5(native.gps_recorded_at) || Date.parse(native.gps_recorded_at) >= Date.parse(auditAt) || !text19(native.gps_source, 100) || !uuid27(native.gps_recorded_by) || !(native.gps_accuracy_m === null || typeof native.gps_accuracy_m === "number" && Number.isFinite(native.gps_accuracy_m) && native.gps_accuracy_m >= 0)) throw Error("Partial or current GPS authority");
      const atTime = history.items.filter((h) => h.recordedAt === native.gps_recorded_at), matched = atTime.filter((h) => h.latitude === native.gps_latitude && h.longitude === native.gps_longitude && h.source === native.gps_source && h.accuracyM === native.gps_accuracy_m);
      if (matched.length !== 1 || atTime.length !== 1) throw Error("GPS history binding unavailable");
    }
    return { native: nativeTuple, history: sorted2(rows4), site: siteTuple };
  }
  async function computeOwnerCensusProof(input2) {
    try {
      const { actorId, binding: r, rawSnapshot, snapshot, bundle, mhelpReceipt, target } = input2;
      if (!uuid27(actorId) || !decimal7(r.auditId) || !text19(r.unitKey, 250) || !sha10(r.addressSha256) || !uuid27(r.nativeUnitId) || snapshot.placementProjectionVersion !== 2 || !Array.isArray(snapshot.nativePlacementAliases) || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(rawSnapshot.inventoryItems)) return null;
      const id15 = r.nativeUnitId, aliases5 = snapshot.nativePlacementAliases.filter((a) => a.unitId === id15), rows4 = snapshot.inventoryItems.filter((a) => a.id === id15), raw = rawSnapshot.inventoryItems.filter((a) => a.id === id15);
      if (aliases5.length !== 1 || rows4.length !== 1 || raw.length !== 1 || snapshot.items.filter((a) => a.id === id15).length !== 1) return null;
      const alias = aliases5[0], row2 = rows4[0];
      if (alias.contract !== "COS_NATIVE_PLACEMENT_ALIAS_V1" || alias.writerContract !== "COS_CAMERA_PLACEMENT_V2" || alias.auditId !== r.auditId || alias.unitKey !== r.unitKey || !sha10(alias.proof) || !Array.isArray(alias.deviceIds) || !alias.deviceIds.length || alias.deviceIds.some((v) => !decimal7(v)) || new Set(alias.deviceIds).size !== alias.deviceIds.length || row2.readOnly !== false || row2.placementSource !== "owner" || row2.placement !== "FIELD" || row2.placementAuditId !== r.auditId || row2.placementUnitKey !== r.unitKey || row2.unitNumber !== alias.unitNumber || row2.locationVerification === "owner_verified" || row2.placementStatus === "needs_identity_review" || row2.placementReviewReason || !text19(row2.address) || !parseOwnerInstallationAddress(row2.address, fullMatchedParts) || await addressDigest(row2.address) !== r.addressSha256) return null;
      const { sources: s, identity: identity4 } = bundle;
      if (!object37(s) || !object37(identity4) || ![s.units, s.devices, s.matches, s.providers, s.audits].every((v) => Array.isArray(v) && v.length <= 1e5 && v.every(object37)) || !object37(s.ownerCrosswalk) || !sha10(s.ownerCrosswalk.revision) || !Array.isArray(s.ownerCrosswalk.nativeEpochs) || !Array.isArray(s.ownerEpochs)) return null;
      const proofs = [...identity4.unitIdentities || [], ...identity4.ownerConfirmedUnitIdentities || []], proof = proofs.filter((p) => p.unitId === id15);
      if (proof.length !== 1 || !["native_provider", "owner_confirmed_native"].includes(proof[0].kind) || proof[0].proof !== alias.proof || !sameSet3(proof[0].deviceIds, alias.deviceIds) || !sameSet3(proof[0].unitKeys, [r.unitKey]) || !Array.isArray(identity4.identityWarnings) || identity4.identityWarnings.some((w) => w.unitId === id15 || w.deviceIds?.some((d) => alias.deviceIds.includes(d)) || w.unitKeys?.includes(r.unitKey))) return null;
      const audit = currentOwnerPlacements(s.audits, s.devices).filter((a) => a.unit_key === r.unitKey && String(a.id) === r.auditId);
      if (audit.length !== 1 || audit[0].conflictReason || audit[0].placement !== "FIELD" || audit[0].street_address !== row2.address || !sameSet3(audit[0].device_ids.map(String), alias.deviceIds)) return null;
      const targetData = targetTuple(target, id15, audit[0].created_at), native = target.native;
      if (!Array.isArray(target.epochs) || target.epochs.length !== 1 || !object37(target.epochs[0]) || target.epochs[0].unitKey !== r.unitKey || !sha10(target.epochs[0].epoch) || !Array.isArray(target.epochs[0].deviceIds) || !sameSet3(target.epochs[0].deviceIds, alias.deviceIds)) return null;
      const nativeMembership = s.units.filter((u) => u.id === id15), epochs = s.ownerCrosswalk.nativeEpochs.filter((e) => e.unitId === id15);
      if (nativeMembership.length !== 1 || nativeMembership[0].status !== native.status || nativeMembership[0].unit_number !== native.unit_number || native.unit_number !== row2.unitNumber || epochs.length !== 1 || !sha10(epochs[0].epoch)) return null;
      if (raw[0].gpsRecordedAt !== native.gps_recorded_at || raw[0].gpsAccuracyM !== native.gps_accuracy_m || raw[0].installedSiteId !== native.installed_site_id || raw[0].currentLocationType !== native.current_location_type || raw[0].activeJobNumber !== null) return null;
      if (native.gps_latitude !== null && (raw[0].hasUnitGps !== true || raw[0].historicalLatitude !== native.gps_latitude || raw[0].historicalLongitude !== native.gps_longitude || raw[0].historicalCoordinateSource !== native.gps_source)) return null;
      if (!object37(raw[0]._placementProof) || typeof raw[0]._placementProof.owner !== "boolean") return null;
      if (!object37(mhelpReceipt) || mhelpReceipt.contract !== "COS_MHELP_PLACEMENT_V1" || typeof mhelpReceipt.enabled !== "boolean" || !Array.isArray(mhelpReceipt.items) || mhelpReceipt.items.length > 1e3) return null;
      checkedMhelpPlacements(mhelpReceipt);
      const concerns = new Set([row2.unitNumber, r.unitKey].map(placementMatchKey));
      const relatedMhelp = mhelpReceipt.items.filter((m) => !object37(m) || m.nativeUnitId === id15 || concerns.has(placementMatchKey(m.nativeLabel)) || concerns.has(placementMatchKey(m.trackerLabel)));
      if (relatedMhelp.length) return null;
      const concernKeys = new Set([row2.unitNumber, r.unitKey].map(placementIdentityConcernKey)), relatedLabel = (v) => concernKeys.has(placementIdentityConcernKey(v));
      const targetDevices = s.devices.filter((d) => alias.deviceIds.includes(String(d.id)));
      const devices = s.devices.filter((d) => alias.deviceIds.includes(String(d.id)) || relatedLabel(d.unit_key) || targetDevices.some((t) => t.external_device_id && t.external_device_id === d.external_device_id || t.device_serial && t.device_serial === d.device_serial));
      const deviceIds = new Set(devices.map((d) => String(d.id))), unitIds = new Set(s.units.filter((u) => u.id === id15 || relatedLabel(u.unit_number)).map((u) => u.id));
      const providers = s.providers.filter((p) => devices.some((d) => d.external_device_id && d.external_device_id === p.external_device_id));
      const providerIds = new Set(providers.map((p) => p.id));
      const nativeEdges = /* @__PURE__ */ new Map(), providerEdges = /* @__PURE__ */ new Map();
      for (const m of s.matches) {
        nativeEdges.set(m.equipment_unit_id, [...nativeEdges.get(m.equipment_unit_id) || [], m.vigilant_device_id]);
        providerEdges.set(m.vigilant_device_id, [...providerEdges.get(m.vigilant_device_id) || [], m.equipment_unit_id]);
      }
      const pending = [...unitIds].map((v) => ["native", v]).concat([...providerIds].map((v) => ["provider", v]));
      for (let i = 0; i < pending.length; i++) {
        const [kind6, key2] = pending[i], edges = kind6 === "native" ? nativeEdges : providerEdges, seen = kind6 === "native" ? providerIds : unitIds;
        for (const next of edges.get(key2) || []) if (!seen.has(next)) {
          seen.add(next);
          pending.push([kind6 === "native" ? "provider" : "native", next]);
        }
      }
      const claims = s.ownerCrosswalk.claims.filter((c) => unitIds.has(c.native_unit_id) || relatedLabel(c.legacy_unit_key) || c.device_ids.some((d) => deviceIds.has(d)));
      const sourceIdentity3 = {
        nativeEpoch: epochs[0].epoch,
        ownerClaims: sorted2(claims),
        nativeRoster: sorted2(s.units.filter((u) => unitIds.has(u.id)).map((u) => fields4(u, ["id", "organization_id", "unit_number", "status"]))),
        devices: sorted2(devices.map((d) => [String(d.id), d.unit_key, d.source, d.device_type, d.external_device_id ?? null, d.device_serial ?? null])),
        matches: sorted2(s.matches.filter((m) => unitIds.has(m.equipment_unit_id) || providerIds.has(m.vigilant_device_id)).map((m) => fields4(m, ["id", "organization_id", "equipment_unit_id", "vigilant_device_id", "camera_key", "match_method", "confidence"]))),
        providers: sorted2(s.providers.filter((p) => providerIds.has(p.id)).map((p) => fields4(p, ["id", "organization_id", "external_device_id", "device_name", "device_type", "source"]))),
        audits: sorted2(s.audits.filter((a) => relatedLabel(a.unit_key) || unitIds.has(a.control_id) || a.control_id === audit[0].control_id || a.device_ids?.some((d) => deviceIds.has(String(d)))).map((a) => [String(a.id), a.unit_key, a.contract, a.control_id, a.request_id, a.action, a.placement, a.site_label, a.street_address, a.created_at, a.device_ids])),
        admittedIdentity: proof[0],
        alias,
        rawProof: raw[0]._placementProof,
        target: targetData,
        targetEpoch: target.epochs[0],
        mhelp: { enabled: mhelpReceipt.enabled, relevant: relatedMhelp }
      };
      const binding = { nativeUnitId: id15, auditId: r.auditId, unitKey: r.unitKey, addressSha256: r.addressSha256, complete: true };
      return {
        proof: { ...binding, contract: OWNER_CENSUS_PROOF_CONTRACT2, nativeGuardSha256: await digest3([OWNER_CENSUS_PROOF_CONTRACT2, ORG6, actorId, r.auditId, r.unitKey, r.addressSha256, sourceIdentity3]) },
        receipt: { ...binding, contract: OWNER_CENSUS_SOURCE_CONTRACT2, nativeSourceSha256: await digest3([OWNER_CENSUS_SOURCE_CONTRACT2, ORG6, r.auditId, r.unitKey, r.addressSha256, sourceIdentity3]) }
      };
    } catch {
      return null;
    }
  }
  async function ownerCensusEvidence(input2) {
    const r = input2.record;
    if (!object37(r) || r.censusOnly !== true || !["draining", "ready", "consumed"].includes(r.censusOnlyState) || !object37(r.censusOnlyGuard) || !sha10(r.censusOnlyGuard.nativeGuardSha256)) return null;
    return computeOwnerCensusProof({ ...input2, binding: { nativeUnitId: r.censusOnlyGuard.nativeUnitId, auditId: r.auditId, unitKey: r.unitKey, addressSha256: r.addressSha256 } });
  }
  async function ownerCensusProof2(input2) {
    return (await ownerCensusEvidence(input2))?.proof ?? null;
  }
  async function ownerCensusSourceReceipt2(input2) {
    return (await ownerCensusEvidence(input2))?.receipt ?? null;
  }
  async function readOwnerCensusPreparation2(input2) {
    try {
      if (!uuid27(input2.actorId) || !uuid27(input2.binding.nativeUnitId) || !decimal7(input2.binding.auditId) || !text19(input2.binding.unitKey, 250) || !sha10(input2.binding.addressSha256)) return null;
      const a = await computeOwnerCensusProof({ ...input2, target: await input2.readTarget(input2.binding.nativeUnitId) });
      if (!a) return null;
      const b = await computeOwnerCensusProof({ ...input2, target: await input2.readTarget(input2.binding.nativeUnitId) });
      return b && stable(a) === stable(b) ? { eligible: true, nativeGuardSha256: b.proof.nativeGuardSha256, nativeSourceSha256: b.receipt.nativeSourceSha256 } : null;
    } catch {
      return null;
    }
  }
  async function preflightOwnerCensusBinding2(input2, now) {
    const a = input2.authorization;
    if (!Number.isFinite(now) || !object37(a) || a.contract !== "COS_CURRENT_OWNER_READ_AUTHORIZATION_V1" || a.actorId !== input2.actorId || a.organizationId !== ORG6 || a.role !== "owner" || a.active !== true || a.equipmentView !== true || !date5(a.verifiedAt) || Date.parse(a.verifiedAt) > now || now - Date.parse(a.verifiedAt) > 6e4 || !object37(a.history) || a.history.actorId !== input2.actorId || a.history.nativeUnitId !== input2.binding.nativeUnitId || a.history.authorized !== true || a.history.complete !== true) return { eligible: false, reason: "current_owner_authorization_unavailable" };
    try {
      const audits = currentOwnerPlacements(input2.bundle.sources.audits, input2.bundle.sources.devices).filter((a2) => a2.unit_key === input2.binding.unitKey && String(a2.id) === input2.binding.auditId);
      if (audits.length !== 1) return { eligible: false, reason: "owner_placement_unavailable" };
      targetTuple(input2.target, input2.binding.nativeUnitId, audits[0].created_at);
    } catch (error) {
      const reasons2 = { "Incomplete native source": "native_fields_incomplete", "Native placement authority changed": "native_authority_changed", "Unexpected native site": "site_scope_mismatch", "Native site authority is not proved historical": "historical_site_unproven", "Complete history unavailable": "history_unavailable", "History is malformed or newer than Owner placement": "history_newer_or_malformed", "Partial or current GPS authority": "gps_partial_or_current", "GPS history binding unavailable": "gps_history_unbound" };
      return { eligible: false, reason: reasons2[error instanceof Error ? error.message : ""] || "complete_current_source_unavailable" };
    }
    const proof = await computeOwnerCensusProof(input2);
    return proof ? { eligible: true, nativeGuardSha256: proof.proof.nativeGuardSha256, nativeSourceSha256: proof.receipt.nativeSourceSha256, identity: "complete", history: "historical_only", placement: "owner_field" } : { eligible: false, reason: "complete_current_source_unavailable" };
  }
  async function readOwnerCensusEvidence2(input2, allowExecutionProofs) {
    const candidates = input2.records.filter((r) => r?.censusOnly === true), result = { proofs: [], receipts: [] };
    if (candidates.length > 1e3 || new Set(candidates.map((r) => r.censusOnlyGuard?.nativeUnitId)).size !== candidates.length) return result;
    for (const record5 of candidates) {
      try {
        const id15 = record5.censusOnlyGuard?.nativeUnitId;
        if (!uuid27(id15)) continue;
        const first = await input2.readTarget(id15), a = await ownerCensusEvidence({ ...input2, record: record5, target: first });
        if (!a) continue;
        const second = await input2.readTarget(id15), b = await ownerCensusEvidence({ ...input2, record: record5, target: second });
        if (b && stable(a) === stable(b)) {
          result.receipts.push(b.receipt);
          if (allowExecutionProofs) result.proofs.push(b.proof);
        }
      } catch {
      }
    }
    return result;
  }
  async function readOwnerCensusProofs2(input2) {
    return (await readOwnerCensusEvidence2(input2, true)).proofs;
  }
  function matchesOwnerCensusReceipt2(receipt2, record5, id15) {
    return !!receipt2 && receipt2.contract === OWNER_CENSUS_SOURCE_CONTRACT2 && receipt2.complete === true && Object.keys(receipt2).length === 7 && sha10(receipt2.nativeSourceSha256) && record5.censusOnly === true && receipt2.nativeUnitId === id15 && record5.censusOnlyGuard?.nativeUnitId === id15 && receipt2.auditId === record5.auditId && receipt2.unitKey === record5.unitKey && receipt2.addressSha256 === record5.addressSha256 && sha10(record5.censusOnlySourceSha256) && receipt2.nativeSourceSha256 === record5.censusOnlySourceSha256;
  }
  function matchesOwnerCensusProof2(proof, record5, id15) {
    return !!proof && proof.contract === OWNER_CENSUS_PROOF_CONTRACT2 && proof.complete === true && Object.keys(proof).length === 7 && sha10(proof.nativeGuardSha256) && record5.censusOnly === true && proof.nativeUnitId === id15 && proof.auditId === record5.auditId && proof.unitKey === record5.unitKey && proof.addressSha256 === record5.addressSha256 && proof.nativeGuardSha256 === record5.censusOnlyGuard?.nativeGuardSha256 && record5.censusOnlyGuard?.nativeUnitId === id15;
  }
  return { OWNER_CENSUS_PROOF_CONTRACT: OWNER_CENSUS_PROOF_CONTRACT2, OWNER_CENSUS_SOURCE_CONTRACT: OWNER_CENSUS_SOURCE_CONTRACT2, OWNER_CENSUS_NATIVE_FIELDS: OWNER_CENSUS_NATIVE_FIELDS2, OWNER_CENSUS_SITE_FIELDS: OWNER_CENSUS_SITE_FIELDS2, readOwnerCensusJson: readOwnerCensusJson2, ownerCensusProof: ownerCensusProof2, ownerCensusSourceReceipt: ownerCensusSourceReceipt2, readOwnerCensusPreparation: readOwnerCensusPreparation2, preflightOwnerCensusBinding: preflightOwnerCensusBinding2, readOwnerCensusEvidence: readOwnerCensusEvidence2, readOwnerCensusProofs: readOwnerCensusProofs2, matchesOwnerCensusReceipt: matchesOwnerCensusReceipt2, matchesOwnerCensusProof: matchesOwnerCensusProof2 };
})();

// tech-checks/supabase/functions/cos-operations-pages/fieldGeocodeProjection.ts
var safeStatus = /* @__PURE__ */ new Set(["pending", "success", "invalid_address", "no_match", "provider_error"]);
async function projectFieldGeocodes(snapshot, records2, unavailable2 = false, sourceReceipts = [], allowPreparation = false) {
  if (!Array.isArray(records2)) throw Error("Address lookup results unavailable");
  const byAudit = /* @__PURE__ */ new Map();
  for (const r of records2) {
    if (!r || typeof r !== "object" || typeof r.auditId !== "string" || byAudit.has(r.auditId)) throw Error("Address lookup identity invalid");
    byAudit.set(r.auditId, r);
  }
  const apply = async (row2) => {
    if (row2.placement !== "FIELD" || row2.placementSource !== "owner" || !row2.placementAuditId || typeof row2.address !== "string" || row2.locationVerification === "owner_verified") return row2;
    const r = byAudit.get(row2.placementAuditId);
    if (!r && unavailable2) return { ...row2, locationGeocode: { status: "unavailable", reason: "Saved address lookup results are temporarily unavailable. Existing verified locations are unchanged." } };
    if (!r) return { ...row2, locationGeocode: { status: "not_requested", reason: "This placement predates automatic address lookup. Review and save its complete installation address to locate it." } };
    let executionMatched = false;
    if (r.censusOnly === true) {
      const proofs = Array.isArray(snapshot.ownerCensusProofs) ? snapshot.ownerCensusProofs.filter((p) => p.nativeUnitId === row2.id) : [];
      executionMatched = proofs.length === 1 && matchesOwnerCensusProof(proofs[0], r, row2.id);
      const receipts = Array.isArray(sourceReceipts) ? sourceReceipts.filter((p) => p?.nativeUnitId === row2.id) : [];
      const admitted = r.censusOnlyState === "consumed" && r.status === "success" ? receipts.length === 1 && matchesOwnerCensusReceipt(receipts[0], r, row2.id) : executionMatched;
      if (!admitted) return { ...row2, locationGeocode: { status: "held", auditId: r.auditId, censusOnly: true, censusOnlyState: ["draining", "ready", "consumed"].includes(r.censusOnlyState) ? r.censusOnlyState : "unknown", reason: "Current native source proof is unavailable. The one-Census hold remains in place." } };
    }
    if (r.unitKey.trim().toUpperCase() !== row2.unitNumber.trim().toUpperCase() && r.unitKey !== row2.placementUnitKey) return row2;
    if (r.addressSha256 !== await addressDigest(row2.address) || !safeStatus.has(r.status)) return row2;
    const marker = r.censusPreparation;
    const preparation = allowPreparation && r.status === "invalid_address" && r.censusOnly !== true && !Object.hasOwn(r, "censusOnlyGuard") && !Object.hasOwn(r, "censusOnlyState") && marker && typeof marker === "object" && !Array.isArray(marker) && Object.keys(marker).length === 1 && marker.nativeUnitId === row2.id && r.unitKey === row2.placementUnitKey;
    const geocode = { status: r.status, auditId: r.auditId, unitKey: r.unitKey, addressSha256: r.addressSha256, provider: "us_census_address_range", benchmark: "Public_AR_Current", reason: r.reason, attempts: r.attempts, latitude: r.latitude, longitude: r.longitude, matchedAddress: r.matchedAddress, geocodedAt: r.geocodedAt, nextAttemptAt: r.nextAttemptAt, ...preparation ? { censusPreparation: { nativeUnitId: row2.id } } : {} };
    return { ...row2, locationGeocode: { ...geocode, ...r.censusOnly === true ? { censusOnly: true, censusOnlyState: r.censusOnlyState, ...executionMatched ? { censusOnlyGuard: { nativeUnitId: r.censusOnlyGuard.nativeUnitId, nativeGuardSha256: r.censusOnlyGuard.nativeGuardSha256 } } : {}, ...typeof r.censusOnlyNotBefore === "string" && Number.isFinite(Date.parse(r.censusOnlyNotBefore)) ? { censusOnlyNotBefore: r.censusOnlyNotBefore } : {} } : {} } };
  };
  return { ...snapshot, items: await Promise.all(snapshot.items.map(apply)), inventoryItems: await Promise.all(snapshot.inventoryItems.map(apply)) };
}

// tech-checks/supabase/functions/cos-operations-pages/deliveryGoBack.ts
var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function withDeliveryGoBacks(snapshot, goBacks) {
  if (!Array.isArray(snapshot?.items) || !Array.isArray(goBacks?.items)) throw new Error("Invalid delivery follow-up snapshot");
  const byJob = /* @__PURE__ */ new Map();
  for (const item of goBacks.items) {
    if (!item || !UUID4.test(item.jobId) || !UUID4.test(item.visitId) || !UUID4.test(item.previousVisitId) || !UUID4.test(item.requestId) || item.visitId === item.previousVisitId || typeof item.required !== "boolean" || typeof item.status !== "string" || typeof item.completionVerified !== "boolean" || item.required === item.completionVerified || item.completionVerified && item.status !== "completed" || byJob.has(item.jobId) || ["reason", "remainingWork", "partsNeeded", "returnNotes"].some((field5) => item[field5] != null && typeof item[field5] !== "string")) throw new Error("Invalid delivery follow-up snapshot");
    byJob.set(item.jobId, {
      visitId: item.visitId,
      previousVisitId: item.previousVisitId,
      requestId: item.requestId,
      required: item.required,
      status: item.status,
      completionVerified: item.completionVerified,
      reason: item.reason || "",
      remainingWork: item.remainingWork || "",
      partsNeeded: item.partsNeeded || "",
      returnNotes: item.returnNotes || "",
      completedAt: item.completedAt || null
    });
  }
  return { ...snapshot, items: snapshot.items.map((item) => ({ ...item, goBackAvailable: true, goBack: byJob.get(item.id) || null })) };
}

// tech-checks/supabase/functions/cos-operations-pages/mhelpImport.ts
var MhelpImportError = class extends Error {
  status;
  constructor(message, status2 = 400) {
    super(message);
    this.status = status2;
  }
};
var MHELP_MAX_BYTES = 10 * 1024 * 1024;
var MHELP_JSON_LIMIT = Math.ceil(MHELP_MAX_BYTES / 3) * 4 + 524288;
var UUID5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var fail11 = (message, status2 = 400) => {
  throw new MhelpImportError(message, status2);
};
function object32(value2, label3) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) fail11(label3 + " must be an object.");
  return value2;
}
function keys2(value2, fields4, label3) {
  if (Object.keys(value2).some((key2) => !fields4.includes(key2))) fail11(label3 + " contains unsupported fields.");
}
function text14(value2, label3, max, required = false) {
  if (typeof value2 !== "string" || value2.length > max || value2.includes("\0") || required && !value2.trim()) fail11("Invalid " + label3 + ".");
  return value2;
}
function id10(value2, label3) {
  if (typeof value2 !== "string" || !UUID5.test(value2)) fail11(label3 + " must be a valid identifier.");
  return value2.toLowerCase();
}
function validateMhelpSource(value2) {
  const source = object32(value2, "Source");
  keys2(source, ["system", "sourceTicketId", "sha256", "filename", "byteLength", "mimeType", "parserId", "parserVersion"], "Source");
  if (source.system !== "mhelpdesk" || source.mimeType !== "application/pdf") fail11("Only a verified mHelpDesk PDF is supported.");
  text14(source.sourceTicketId, "source ticket ID", 128, true);
  if (source.sourceTicketId !== source.sourceTicketId.trim()) fail11("Source ticket ID must not have surrounding whitespace.");
  text14(source.filename, "filename", 255, true);
  if (!/\.pdf$/i.test(source.filename) || /[\x00-\x1f/\\]/.test(source.filename)) fail11("Use the PDF filename without a path.");
  if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) fail11("Invalid SHA-256.");
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength <= 0 || source.byteLength > MHELP_MAX_BYTES) fail11("Choose a nonempty PDF no larger than 10 MiB.");
  text14(source.parserId, "parser ID", 100, true);
  text14(source.parserVersion, "parser version", 100, true);
  return structuredClone(source);
}
function validateMhelpTicket(value2) {
  const ticket2 = object32(value2, "Ticket");
  keys2(ticket2, ["source", "customerId", "siteId", "jobType", "priority", "title", "description", "contactInstructions", "unitIds", "requestedSchedule", "additionalInformation", "shopPrep", "parserData"], "Ticket");
  validateMhelpSource(ticket2.source);
  id10(ticket2.customerId, "Customer");
  id10(ticket2.siteId, "Site");
  if (!["DELIVERY", "SERVICE", "SWAP", "PICKUP"].includes(ticket2.jobType) || !["normal", "high", "urgent"].includes(ticket2.priority)) fail11("Review the job type and priority.");
  text14(ticket2.title, "title", 500, true);
  for (const key2 of ["description", "contactInstructions", "requestedSchedule", "additionalInformation"]) text14(ticket2[key2], key2, 7e4);
  if (!Array.isArray(ticket2.unitIds) || ticket2.unitIds.length !== 0) fail11("Physical unit assignment must be completed separately in the native workflow.");
  if (typeof ticket2.shopPrep !== "boolean" || ticket2.shopPrep && ticket2.jobType !== "SERVICE") fail11("Shop preparation is only available for Service imports.");
  const parser = object32(ticket2.parserData, "Parser data");
  text14(parser.documentText, "full extracted document text", 25e4, true);
  if (object32(parser.sourceTicketId, "Printed source reference").value !== ticket2.source.sourceTicketId) fail11("The printed source reference must match the original ticket ID.");
  if (!Array.isArray(parser.units) || !Array.isArray(parser.additionalFields) || !Array.isArray(parser.warnings)) fail11("Complete parser provenance is required.");
  if (new TextEncoder().encode(JSON.stringify(ticket2)).byteLength > 512e3) fail11("The reviewed ticket data is too large.");
  return structuredClone(ticket2);
}
async function readMhelpAwareJsonWithSize(request, max = 65536, admitLargeBody) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) fail11("Use an application/json request body.", 415);
  if (Number(request.headers.get("Content-Length")) > max) fail11("Request body is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) fail11("A JSON body is required.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "", count6 = 0, admitted = false;
  try {
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      count6 += value2.byteLength;
      if (count6 > max) {
        await reader.cancel();
        fail11("Request body is too large.", 413);
      }
      if (count6 > 65536 && !admitted) {
        admitLargeBody?.();
        admitted = true;
      }
      raw += decoder.decode(value2, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
    }
    if (error instanceof MhelpImportError || error instanceof Error && "status" in error) throw error;
    fail11("A valid UTF-8 JSON body is required.");
  } finally {
    reader.releaseLock();
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail11("A valid JSON body is required.");
  }
  return { body: object32(body, "Request"), byteLength: count6 };
}
async function readMhelpAwareJson(request, max = 65536, admitLargeBody) {
  return (await readMhelpAwareJsonWithSize(request, max, admitLargeBody)).body;
}
function createMhelpImportHandler(options) {
  return async (path, method, body, actorId) => {
    if (!path.startsWith("/api/mhelpdesk/imports")) return void 0;
    const payload = body == null ? {} : object32(body, "Request");
    const call = (action, value2 = {}) => options.rpc("appdeploy_mhelp_import", {
      p_actor_user_id: actorId,
      p_organization_id: options.organizationId,
      p_action: action,
      p_payload: value2
    });
    if (method === "GET") {
      keys2(payload, [], "Request");
      if (path === "/api/mhelpdesk/imports") return call("history");
      const route = /^\/api\/mhelpdesk\/imports\/(attempt|jobs|attachments)\/([^/]+)(\/download)?$/.exec(path);
      if (!route || route[3] && route[1] !== "attachments") fail11("Import endpoint not found.", 404);
      const identifier = id10(route[2], "Import record");
      return call(route[3] ? "download" : { attempt: "attempt", jobs: "readback", attachments: "attachment" }[route[1]], { id: identifier });
    }
    if (method !== "POST") fail11("Method not supported.", 405);
    if (path === "/api/mhelpdesk/imports/stage") {
      keys2(payload, ["attemptId", "source", "bytesBase64"], "Stage request");
      const attemptId = id10(payload.attemptId, "Import attempt");
      const source = validateMhelpSource(payload.source);
      const base642 = text14(payload.bytesBase64, "PDF bytes", Math.ceil(MHELP_MAX_BYTES / 3) * 4, true);
      if (base642.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base642)) fail11("PDF bytes must be canonical base64.");
      let binary = "";
      try {
        binary = atob(base642);
      } catch {
        fail11("PDF bytes are invalid.");
      }
      if (btoa(binary) !== base642) fail11("PDF bytes must be canonical base64.");
      if (binary.length !== source.byteLength || !binary.startsWith("%PDF-")) fail11("PDF bytes do not match the source metadata.");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const digest3 = await crypto.subtle.digest("SHA-256", bytes);
      const sha10 = Array.from(new Uint8Array(digest3), (v) => v.toString(16).padStart(2, "0")).join("");
      if (sha10 !== source.sha256) fail11("PDF hash does not match the source metadata.");
      return call("stage", { attemptId, source, bytesBase64: base642 });
    }
    if (path === "/api/mhelpdesk/imports/commit") {
      keys2(payload, ["attachmentId", "ticket"], "Commit request");
      return call("commit", { attachmentId: id10(payload.attachmentId, "Attachment"), ticket: validateMhelpTicket(payload.ticket) });
    }
    const move = /^\/api\/mhelpdesk\/imports\/attachments\/([^/]+)\/(trash|restore)$/.exec(path);
    if (!move) fail11("Import endpoint not found.", 404);
    const attachmentId = id10(move[1], "Attachment");
    if (move[2] === "restore") {
      keys2(payload, [], "Restore request");
      return call("restore", { attachmentId });
    }
    keys2(payload, ["verifiedJobId", "ticket"], "Trash request");
    return call("trash", { attachmentId, verifiedJobId: id10(payload.verifiedJobId, "Verified job"), ticket: validateMhelpTicket(payload.ticket) });
  };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts
function reconBatteryEvidence2(percent, percentAt, status2, statusAt) {
  const numeric3 = typeof percent === "number" ? percent : typeof percent === "string" && /^\d+(?:\.\d+)?$/.test(percent.trim()) ? Number(percent) : NaN;
  return { source: "Reconeyez", percent: Number.isFinite(numeric3) && numeric3 >= 0 && numeric3 <= 100 ? numeric3 : null, percentObservedAt: typeof percentAt === "string" ? percentAt : null, status: typeof status2 === "string" && ["normal", "low", "critical"].includes(status2) ? status2 : null, statusObservedAt: typeof statusAt === "string" ? statusAt : null };
}
var normalized5 = (value2) => typeof value2 === "string" ? value2.trim().replace(/\s+/g, " ").toUpperCase() : "";
function cameraTimestamp4(value2, now = Date.now()) {
  if (typeof value2 !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value2);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value2.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS3 } : { at: null, fresh: false };
}
var providerSource3 = (value2) => ["Star4Live", "Reconeyez"].includes(String(value2));
function currentCameraStatus3(evidence, now = Date.now()) {
  return evidence?.kind === "provider" && ["camera", "detector"].includes(evidence.resource || "") && evidence.active === true && providerSource3(evidence.source) && cameraTimestamp4(evidence.observedAt, now).fresh && ["online", "offline"].includes(evidence.status) ? evidence.status : "review";
}
var sourceText2 = (value2) => typeof value2 === "string" ? value2 : null;
var resourceId3 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0 ? String(value2) : typeof value2 === "string" && /^[1-9]\d*$/.test(value2) ? value2 : null;
var object33 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
function cameraScope2(device, tracker = []) {
  const activation = normalized5(device.activation_state), org = normalized5(device.organization), unit = normalized5(device.unit_key);
  if (device.__ownerPlacement === "FIELD" || device.__ownerPlacement === "SHOP" || device.__ownerPlacement === "UNKNOWN") return device.__ownerPlacement.toLowerCase();
  if (/^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(unit) || /^STOLEN FROM RII?[-\s]*\d+ ON \d{2}\/\d{2}\/\d{4}$/.test(org) || ["RETIRED", "STOLEN", "NOT IN USE"].includes(org) || /^RII?[-\s]*\d+\s*-?\s*(?:NOT IN USE|RETIRED|STOLEN)$/.test(unit)) return "inactive";
  if (["ROOT", "SHOP", "SHOP/ROOT", "ROOT/SHOP", "SHOP / ROOT", "ROOT / SHOP", "SHOP EQUIPMENT"].includes(org) || unit === "SHOP EQUIPMENT" || /^RII?[-\s]*\d+\s*-?\s*SHOP$/.test(unit)) return "shop";
  if (activation === "DEACTIVATED") return "inactive";
  if (activation !== "ACTIVE") return "unknown";
  const matches2 = tracker.filter((row2) => normalized5(row2.source_label) === unit);
  if (matches2.length > 1 || matches2.some((row2) => ["shop", "retired"].includes(row2.tracker_state))) return "unknown";
  if (device.__trackerOnly || !org || ["TRACKER FIELD", "TRACKER \xB7 SITE NOT LINKED", "UNKNOWN", "FIELD OR UNKNOWN"].includes(org)) return "unknown";
  return "unknown";
}
function cameraEvidence2(device) {
  const type = String(device.device_type || "").trim().toLowerCase();
  const resource = ["ipc", "camera"].includes(type) ? "camera" : ["detector", "reconeyez detector"].includes(type) ? "detector" : type === "nvr" ? "recorder" : "unknown";
  const provider = device.source === "vigilant_control_center" ? "Star4Live" : device.source === "reconeyez" ? "Reconeyez" : null;
  const active = normalized5(device.activation_state) === "ACTIVE";
  return { kind: provider && resource !== "unknown" ? "provider" : "unknown", source: provider || "Unverified provider source", resource, active, status: ["online", "offline"].includes(device.source_status) ? device.source_status : "unknown", observedAt: sourceText2(device.source_last_seen_at), lastOnlineAt: sourceText2(device.last_online_at) };
}
function validateCameraSources2(devices, health, tracker) {
  if (![devices, health, tracker].every(Array.isArray)) throw new Error("Camera Health source records are unavailable.");
  const textOrMissing = (value2) => value2 == null || typeof value2 === "string", seen = /* @__PURE__ */ new Set(), checked2 = /* @__PURE__ */ new Set();
  for (const row2 of devices) {
    const id15 = object33(row2) ? resourceId3(row2.id) : null;
    if (!id15 || seen.has(id15) || !["device_name", "device_type", "organization", "unit_key", "source", "source_status", "source_last_seen_at", "last_online_at", "last_probe_online_at", "activation_state"].every((key2) => textOrMissing(row2[key2]))) throw new Error("Camera Health returned malformed or duplicate device identities.");
    seen.add(id15);
  }
  for (const row2 of health) {
    const id15 = object33(row2) ? resourceId3(row2.camera_device_id) : null;
    if (!id15 || !seen.has(id15) || checked2.has(id15) || !["overall_status", "checked_at"].every((key2) => textOrMissing(row2[key2])) || row2.confirmed_outage != null && typeof row2.confirmed_outage !== "boolean" || row2.ip_reachable != null && typeof row2.ip_reachable !== "boolean" || row2.consecutive_failures != null && (!Number.isSafeInteger(row2.consecutive_failures) || row2.consecutive_failures < 0)) throw new Error("Camera Health returned malformed or duplicate health identities.");
    checked2.add(id15);
  }
  for (const row2 of tracker) if (!object33(row2) || !["canonical_family", "unit_tag", "source_label", "tracker_state"].every((key2) => typeof row2[key2] === "string") || !textOrMissing(row2.health_provider)) throw new Error("Camera Health tracker placement records are malformed.");
}
var trackerFamilies2 = ["Helios", "Ranger", "Solar Spotter", "Spotter", "SS Hybrid", "CAMV", "Sniper", "Sniper 2", "Sniper 4", "Recon", "Recon 2"];
function canonicalTrackerKey2(row2) {
  const family = trackerFamilies2.find((value2) => normalized5(value2) === normalized5(row2.canonical_family)), tag = row2.unit_tag.trim();
  if (!family || !/^\d{1,6}(?:\.\d+)?$/.test(tag) || Number(tag.split(".")[0]) === 0) return null;
  const [base2, ...tail] = tag.split(".");
  return family.toLowerCase() + "|" + String(Number(base2)).padStart(3, "0") + (tail.length ? "." + tail.join(".") : "");
}
function deviceTrackerKey2(unit) {
  if (typeof unit !== "string") return null;
  const scoped = /^(RII?[-\s]*\d+)\s*-?\s*(?:SHOP|NOT IN USE|RETIRED|STOLEN)$/.exec(normalized5(unit));
  const stolen = /^STOLEN FROM (RII?[-\s]*\d+) ON \d{2}\/\d{2}\/\d{4}$/.exec(normalized5(unit));
  const identityLabel = scoped?.[1] || stolen?.[1] || unit.trim();
  const match = /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER(?:\s+[24])?|CAM\s*V|RECON(?:\s+(?:2|II))?|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(identityLabel);
  if (!match) return null;
  const aliases5 = { RI: "Recon", RII: "Recon 2", RECONII: "Recon 2", RECON2: "Recon 2" };
  const condensed = normalized5(match[1]).replace(/\s/g, "");
  const family = aliases5[condensed] || trackerFamilies2.find((value2) => normalized5(value2).replace(/\s/g, "") === condensed);
  return family ? canonicalTrackerKey2({ canonical_family: family, unit_tag: match[2], source_label: "", tracker_state: "" }) : null;
}
function witnessUnits2(integrations) {
  if (!Array.isArray(integrations) || integrations.some((row2) => !object33(row2) || row2.provider !== "witness" || row2.units != null && !object33(row2.units))) throw new Error("Witness service observations are malformed.");
  if (integrations.length > 1) throw new Error("Witness service observations have duplicate provider identities.");
  return integrations[0]?.units || {};
}
function cameraSummary2(devices, health, now = Date.now(), tracker = [], integrations = []) {
  validateCameraSources2(devices, health, tracker);
  const byId = new Map(health.map((row2) => [resourceId3(row2.camera_device_id), row2])), witness = witnessUnits2(integrations);
  const rows4 = devices.map((device) => {
    const evidence = cameraEvidence2(device), service = serviceEvidence(device, byId.get(resourceId3(device.id)) || {}, false, now);
    const row2 = { id: device.id, name: device.device_name || device.unit_key || "Resource " + device.id, unit: device.unit_key || "", type: device.device_type || "", organization: device.organization || "", activationState: device.activation_state || "", scope: cameraScope2(device, tracker), status: "review", checkedAt: evidence.observedAt, evidence, serviceEvidence: service };
    const connection = savedCameraConnection(device.public_ip, device.expected_ports);
    if (connection) row2.connection = connection;
    if (device.source === "reconeyez") row2.batteryEvidence = reconBatteryEvidence2(device.recon_battery_percent, device.recon_battery_updated_at, device.recon_battery_status, device.recon_battery_status_updated_at);
    row2.status = ["field", "unknown"].includes(row2.scope) ? currentCameraStatus3(evidence, now) : "review";
    return row2;
  });
  const linked = new Set(devices.map((device) => deviceTrackerKey2(device.unit_key)).filter(Boolean));
  for (const device of devices) for (const record5 of tracker.filter((row2) => normalized5(row2.source_label) === normalized5(device.unit_key))) {
    const key2 = canonicalTrackerKey2(record5);
    if (key2) linked.add(key2);
  }
  const synthesized = /* @__PURE__ */ new Set();
  for (const record5 of tracker) {
    const key2 = canonicalTrackerKey2(record5);
    if (!key2 || record5.tracker_state !== "field_or_unknown" || linked.has(key2) || synthesized.has(key2)) continue;
    synthesized.add(key2);
    const peers = tracker.filter((row2) => canonicalTrackerKey2(row2) === key2);
    const exactLabel = normalized5(record5.source_label), labelKey = deviceTrackerKey2(record5.source_label), identitySafe = peers.length === 1 && exactLabel !== "" && (!labelKey || labelKey === key2) && tracker.filter((row2) => normalized5(row2.source_label) === exactLabel).length === 1;
    const observed2 = identitySafe && String(record5.health_provider || "").toLowerCase() === "witness" && Object.hasOwn(witness, key2) && object33(witness[key2]) ? witness[key2] : {};
    const service = serviceEvidence({ activation_state: "active" }, observed2, true, now);
    rows4.push({ id: "tracker:" + key2, name: record5.source_label || record5.canonical_family + " " + record5.unit_tag, unit: record5.source_label || record5.canonical_family + " " + record5.unit_tag, type: "tracker_unit", organization: "TRACKER \xB7 SITE NOT LINKED", activationState: "active", scope: "unknown", trackerOnly: true, status: "review", checkedAt: service.observedAt, serviceEvidence: service });
  }
  rows4.sort((a, b) => a.name.localeCompare(b.name));
  const fields4 = rows4.filter((row2) => row2.scope === "field");
  const inventory = { allRecords: rows4.length, activeFieldRecords: fields4.length, activeShopRecords: rows4.filter((row2) => row2.scope === "shop").length, inactiveRecords: rows4.filter((row2) => row2.scope === "inactive").length, unknownScopeRecords: rows4.filter((row2) => row2.scope === "unknown").length, sourceDeviceRecords: devices.length, trackerOnlyRecords: rows4.filter((row2) => row2.trackerOnly).length };
  return { totalDevices: rows4.length, healthRows: health.length, fieldDevices: fields4.length, shopRoot: inventory.activeShopRecords, online: fields4.filter((row2) => row2.status === "online").length, offline: fields4.filter((row2) => row2.status === "offline").length, review: fields4.filter((row2) => row2.status === "review").length, rows: rows4, refreshedAt: new Date(now).toISOString(), source: "Camera Health", evidenceVersion: 2, inventory, coverageNote: "Provider systems, camera/detector observations and service ports are separate. Expected camera channel coverage is not established. Field devices counts confirmed-field resources; displayed inventory also includes unresolved placement, shop/root, inactive and tracker-only resources." };
}

// tech-checks/supabase/functions/cos-operations-pages/cameraTrackerShopScope.ts
var ORG5 = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var object34 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid21 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var sha9 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var decimal5 = (v) => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
var recordId = (v) => decimal5(v) ? String(v) : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var full = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase() : "";
var key = (v) => placementMatchKey(v);
var concern2 = (v) => placementIdentityConcernKey(v);
var id11 = (r) => (r.readOnly === true ? "tracker" : "equipment_unit") + "|" + r.id;
var sourceId = (s) => s.entityKind + "|" + s.nativeUnitId;
var MAX_ROWS = 5e3;
var MAX_WORK = 2e6;
var validArray = (v) => Array.isArray(v) && v.length <= MAX_ROWS && v.every(object34);
var same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var sourceFields2 = ["schemaVersion", "organizationId", "sourceSystem", "entityKind", "nativeUnitId", "productId", "unitNumber", "sourceRevision", "eventId", "sourceFileSha256", "sourceRowSha256", "nativeGuardSha256", "placement", "eligibility"];
var sourceProof = (s) => sourceFields2.map((k) => s[k]);
var inventoryProof = (r) => ["id", "unitNumber", "readOnly", "placementSource", "placementAuditId", "placement", "placementStatus", "hasUnitGps", "locationVerification", "installedSiteId"].map((k) => r[k]);
function nativeProof(s) {
  const p = s.nativeSourceIdentity;
  return object34(p) && p.contract === "COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1" && uuid21(p.trackerId) && typeof p.trackerUnitNumber === "string" && ["nativeUnitId", "productId", "unitNumber", "sourceRevision", "sourceFileSha256", "sourceRowSha256", "nativeGuardSha256"].every((k) => p[k] === s[k]) && key(p.trackerUnitNumber) === key(s.unitNumber);
}
function validSource(s) {
  return s.schemaVersion === 1 && s.organizationId === ORG5 && s.sourceSystem === "mhelpdesk_product_import" && ["equipment_unit", "tracker"].includes(s.entityKind) && uuid21(s.nativeUnitId) && uuid21(s.sourceRevision) && decimal5(s.productId) && decimal5(s.eventId) && typeof s.unitNumber === "string" && key(s.unitNumber).startsWith("typed:") && ["sourceFileSha256", "sourceRowSha256", "nativeGuardSha256"].every((k) => sha9(s[k])) && s.placement === "SHOP" && s.eligibility === "tombstone" && s.installation === null && s.addressSha256 === null && s.suppliedComponents === null && !Object.hasOwn(s, "sourcePrecedence") && !Object.hasOwn(s, "sourceRecordId") && (s.entityKind === "equipment_unit" ? nativeProof(s) : s.nativeSourceIdentity === null);
}
var MHELP_FRESH_MS = 40 * 60 * 1e3;
var receiptFields = ["trackerId", "nativeUnitId", "trackerLabel", "nativeLabel", "guardCurrent", "state", "placement", "observedAt", "locationReview"];
var receiptLabel = (v) => typeof v === "string" && v.length > 0 && v.length <= 250 && !/[\x00-\x1f\x7f<>]/.test(v);
function validMhelpReceipt(value2) {
  if (value2 == null) return true;
  if (!object34(value2) || value2.contract !== "COS_MHELP_PLACEMENT_V1" || typeof value2.enabled !== "boolean" || !Array.isArray(value2.items) || value2.items.length > 1e3) return false;
  const rows4 = value2.items;
  return rows4.every((r) => object34(r) && uuid21(r.trackerId) && (r.nativeUnitId === null || uuid21(r.nativeUnitId)) && receiptLabel(r.trackerLabel) && (r.nativeLabel === null || receiptLabel(r.nativeLabel)) && ["confirmed", "held"].includes(r.state)) && new Set(rows4.map((r) => r.trackerId)).size === rows4.length && new Set(rows4.filter((r) => r.nativeUnitId !== null).map((r) => r.nativeUnitId)).size === rows4.filter((r) => r.nativeUnitId !== null).length;
}
function receiptCovers(s, r) {
  const ids = [s.nativeUnitId, ...s.entityKind === "equipment_unit" ? [s.nativeSourceIdentity.trackerId] : []], base2 = concern2(s.unitNumber);
  return ids.includes(r.trackerId) || ids.includes(r.nativeUnitId) || concern2(r.trackerLabel) === base2 || concern2(r.nativeLabel) === base2;
}
function mhelpAgrees(s, before, after) {
  const receipts = [before.mhelpReceipt, after.mhelpReceipt];
  const modes = receipts.map((r) => r == null ? "absent" : r.enabled ? "enabled" : "disabled");
  if (modes[0] !== modes[1]) return false;
  if (modes[0] !== "enabled") return true;
  const covered = receipts.map((r) => r.items.filter((v) => receiptCovers(s, v)));
  if (covered.some((rows4) => rows4.length !== 1)) return false;
  const [old, current] = covered.map((rows4) => rows4[0]), now = Date.now();
  const fresh2 = (value2) => {
    const at = cameraTimestamp4(value2, now).at;
    return at !== null && now - Date.parse(at) <= MHELP_FRESH_MS;
  };
  for (let n = 0; n < 2; n++) {
    const r = covered[n][0], receipt2 = receipts[n];
    if (r.guardCurrent !== true || r.state !== "confirmed" || r.placement !== "SHOP" || typeof r.locationReview !== "boolean" || !fresh2(r.observedAt) || !fresh2(receipt2.lastSuccessAt) || Date.parse(receipt2.lastSuccessAt) < Date.parse(r.observedAt)) return false;
    if (s.entityKind === "equipment_unit") {
      if (r.nativeUnitId !== s.nativeUnitId || r.nativeLabel !== s.unitNumber || r.trackerId !== s.nativeSourceIdentity.trackerId || r.trackerLabel !== s.nativeSourceIdentity.trackerUnitNumber) return false;
    } else if (r.trackerId !== s.nativeUnitId || r.trackerLabel !== s.unitNumber || r.nativeUnitId !== null || r.nativeLabel !== null) return false;
  }
  return same2(receiptFields.map((k) => old[k]), receiptFields.map((k) => current[k])) && before.mhelpReceipt.lastSuccessAt === after.mhelpReceipt.lastSuccessAt;
}
function validRead(r) {
  if (!object34(r) || ![r.inventory, r.sources, r.nativeUnits, r.devices, r.audits, r.matches, r.ownerClaims].every(validArray) || !object34(r.identity) || !validMhelpReceipt(r.mhelpReceipt)) return false;
  if (r.inventory.some((v) => !uuid21(v.id) || typeof v.unitNumber !== "string" || typeof v.readOnly !== "boolean") || new Set(r.inventory.map(id11)).size !== r.inventory.length || r.sources.some((v) => !["equipment_unit", "tracker"].includes(v.entityKind) || !uuid21(v.nativeUnitId) || typeof v.unitNumber !== "string") || new Set(r.sources.map(sourceId)).size !== r.sources.length || r.nativeUnits.some((v) => !uuid21(v.id) || v.organization_id !== ORG5 || typeof v.unit_number !== "string") || new Set(r.nativeUnits.map((v) => v.id)).size !== r.nativeUnits.length || r.devices.some((v) => !recordId(v.id) || typeof v.unit_key !== "string") || new Set(r.devices.map((v) => recordId(v.id))).size !== r.devices.length || r.audits.some((v) => !recordId(v.id) || typeof v.unit_key !== "string" || !Array.isArray(v.device_ids) || v.device_ids.some((d) => !recordId(d)) || new Set(v.device_ids.map(recordId)).size !== v.device_ids.length) || new Set(r.audits.map((v) => recordId(v.id))).size !== r.audits.length || r.matches.some((v) => !uuid21(v.id) || !uuid21(v.equipment_unit_id)) || new Set(r.matches.map((v) => v.id)).size !== r.matches.length || r.ownerClaims.some((v) => !uuid21(v.id) || !uuid21(v.native_unit_id) || typeof v.legacy_unit_key !== "string") || new Set(r.ownerClaims.map((v) => v.id)).size !== r.ownerClaims.length) return false;
  const native = r.inventory.filter((v) => !v.readOnly);
  const nativeById = new Map(r.nativeUnits.map((n) => [n.id, n]));
  if (native.length !== r.nativeUnits.length || native.some((v) => nativeById.get(v.id)?.unit_number !== v.unitNumber)) return false;
  const i = r.identity;
  return i.identityVersion === 1 && validArray(i.unitIdentities) && validArray(i.identityWarnings) && (i.ownerConfirmedIdentityVersion === void 0 ? i.ownerConfirmedUnitIdentities === void 0 : i.ownerConfirmedIdentityVersion === 1 && validArray(i.ownerConfirmedUnitIdentities)) && [...i.unitIdentities, ...i.ownerConfirmedUnitIdentities || [], ...i.identityWarnings].every((p) => typeof p.unitId === "string" && Array.isArray(p.unitKeys) && p.unitKeys.every((k) => typeof k === "string") && Array.isArray(p.deviceIds));
}
function eligible(s, r) {
  if (!validSource(s)) return false;
  const rows4 = r.inventory.filter((v) => id11(v) === sourceId(s));
  if (rows4.length !== 1) return false;
  const row2 = rows4[0], base2 = concern2(s.unitNumber);
  if (row2.unitNumber !== s.unitNumber || r.inventory.filter((v) => concern2(v.unitNumber) === base2).length !== 1 || r.sources.filter((v) => concern2(v.unitNumber) === base2).length !== 1 || r.sources.filter((v) => v.sourceSystem === s.sourceSystem && v.productId === s.productId).length !== 1 || row2.placementSource === "owner" || row2.placementAuditId != null || row2.placement === "UNKNOWN" || row2.placementStatus === "needs_identity_review" || row2.hasUnitGps === true || row2.locationVerification === "owner_verified" || row2.installedSiteId != null) return false;
  if (s.entityKind === "equipment_unit" && r.nativeUnits.filter((v) => v.id === s.nativeUnitId && v.unit_number === s.unitNumber).length !== 1) return false;
  if (r.devices.some((d) => concern2(d.unit_key) === base2) || r.audits.some((a) => concern2(a.unit_key) === base2)) return false;
  if (r.matches.some((m) => m.equipment_unit_id === s.nativeUnitId) || r.ownerClaims.some((c) => c.native_unit_id === s.nativeUnitId || concern2(c.legacy_unit_key) === base2)) return false;
  const i = r.identity;
  if ([...i.unitIdentities, ...i.ownerConfirmedUnitIdentities || [], ...i.identityWarnings].some((p) => p.unitId === s.nativeUnitId || p.unitKeys.some((k) => concern2(k) === base2))) return false;
  return true;
}
async function currentTrackerShopScope(summary, tracker, initial, reader, timeoutMs = 1e4) {
  let reported = false;
  const fallback = (reason) => {
    if (reported) return;
    reported = true;
    try {
      reader.onFallback?.(reason);
    } catch {
    }
  };
  if (!summary?.rows?.some((r) => r.trackerOnly === true && r.scope === "unknown" && String(r.id).startsWith("tracker:"))) return summary;
  if (!validArray(initial?.inventory) || !initial.inventory.length) {
    fallback("projection-invalid");
    return summary;
  }
  const controller = new AbortController(), deadline = Date.now() + timeoutMs;
  let timer, stage = "source-read";
  const bounded = new Promise((resolve2) => {
    timer = setTimeout(() => {
      controller.abort();
      fallback("timeout");
      resolve2(summary);
    }, timeoutMs);
  });
  const operation = (async () => {
    const before = { ...initial, sources: await reader.readSources(initial.inventory, controller.signal) };
    controller.signal.throwIfAborted();
    stage = "current-read";
    const current = await reader.readCurrent(controller.signal);
    controller.signal.throwIfAborted();
    stage = "source-read";
    const after = { ...current, sources: await reader.readSources(current.inventory, controller.signal) };
    controller.signal.throwIfAborted();
    stage = "projection-invalid";
    const result = projectTrackerShopScope(summary, tracker, before, after, deadline);
    if (result === summary) fallback(Date.now() >= deadline ? "timeout" : "projection-invalid");
    return result;
  })().catch(() => {
    fallback(controller.signal.aborted || Date.now() >= deadline ? "timeout" : stage);
    return summary;
  });
  try {
    return await Promise.race([operation, bounded]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
function projectTrackerShopScope(summary, tracker, before, after, deadline = Infinity) {
  if (!object34(summary) || summary.evidenceVersion !== 2 || !validArray(summary.rows) || !object34(summary.inventory) || !validArray(tracker) || !validRead(before) || !validRead(after)) return summary;
  const candidates = summary.rows.filter((r) => r.trackerOnly === true && r.scope === "unknown" && String(r.id).startsWith("tracker:")).length;
  const scanSize = summary.rows.length + tracker.length + [before, after].reduce((n, r) => n + r.inventory.length + r.sources.length + r.nativeUnits.length + r.devices.length + r.audits.length + r.matches.length + r.ownerClaims.length + r.identity.unitIdentities.length + r.identity.identityWarnings.length + (r.identity.ownerConfirmedUnitIdentities?.length || 0) + (r.mhelpReceipt?.items.length || 0), 0);
  if (candidates * scanSize > MAX_WORK || Date.now() >= deadline) return summary;
  if (tracker.some((t) => ["canonical_family", "unit_tag", "source_label", "tracker_state"].some((k) => typeof t[k] !== "string"))) return summary;
  const inventory = summary.inventory;
  const counts2 = ["allRecords", "activeFieldRecords", "activeShopRecords", "inactiveRecords", "unknownScopeRecords"];
  if (counts2.some((k) => !Number.isSafeInteger(inventory[k]) || inventory[k] < 0) || inventory.allRecords !== summary.rows.length || summary.totalDevices !== inventory.allRecords || inventory.allRecords !== inventory.activeFieldRecords + inventory.activeShopRecords + inventory.inactiveRecords + inventory.unknownScopeRecords || summary.shopRoot !== inventory.activeShopRecords || summary.fieldDevices !== inventory.activeFieldRecords || new Set(summary.rows.map((r) => String(r.id))).size !== summary.rows.length) return summary;
  for (const [scope, count6] of [["field", "activeFieldRecords"], ["shop", "activeShopRecords"], ["inactive", "inactiveRecords"], ["unknown", "unknownScopeRecords"]]) if (summary.rows.filter((r) => r.scope === scope).length !== inventory[count6]) return summary;
  const moved = /* @__PURE__ */ new Set();
  for (const row2 of summary.rows) {
    if (Date.now() >= deadline) return summary;
    if (row2.trackerOnly !== true || row2.type !== "tracker_unit" || row2.scope !== "unknown" || row2.status !== "review" || typeof row2.id !== "string" || !row2.id.startsWith("tracker:")) continue;
    const records2 = tracker.filter((t) => t.tracker_state === "field_or_unknown" && "tracker:" + canonicalTrackerKey2(t) === row2.id);
    if (records2.length !== 1 || tracker.filter((t) => "tracker:" + canonicalTrackerKey2(t) === row2.id).length !== 1 || full(records2[0].source_label) !== full(row2.unit) || !key(row2.unit).startsWith("typed:") || key(records2[0].canonical_family + " " + records2[0].unit_tag) !== key(row2.unit)) continue;
    const fullKey2 = key(row2.unit), base2 = concern2(row2.unit);
    if (tracker.filter((t) => concern2(t.source_label) === base2).length !== 1 || summary.rows.filter((r) => concern2(r.unit) === base2).length !== 1) continue;
    const sources = before.sources.filter((s) => key(s.unitNumber) === fullKey2);
    if (sources.length !== 1) continue;
    const source = sources[0], fresh2 = after.sources.filter((s) => sourceId(s) === sourceId(source));
    if (fresh2.length !== 1 || !eligible(source, before) || !eligible(fresh2[0], after) || !same2(sourceProof(source), sourceProof(fresh2[0])) || !mhelpAgrees(source, before, after)) continue;
    if (source.entityKind === "equipment_unit" && !same2(source.nativeSourceIdentity, fresh2[0].nativeSourceIdentity)) continue;
    const oldRow = before.inventory.find((r) => id11(r) === sourceId(source)), newRow = after.inventory.find((r) => id11(r) === sourceId(source));
    if (!same2(inventoryProof(oldRow), inventoryProof(newRow))) continue;
    if (source.entityKind === "equipment_unit" && !same2(before.nativeUnits.find((r) => r.id === source.nativeUnitId), after.nativeUnits.find((r) => r.id === source.nativeUnitId))) continue;
    moved.add(row2.id);
  }
  if (!moved.size || Date.now() >= deadline) return summary;
  return {
    ...summary,
    rows: summary.rows.map((r) => moved.has(r.id) ? { ...r, scope: "shop" } : r),
    shopRoot: summary.shopRoot + moved.size,
    inventory: { ...inventory, activeShopRecords: inventory.activeShopRecords + moved.size, unknownScopeRecords: inventory.unknownScopeRecords - moved.size }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts
var OWNER_IDENTITY_ORG = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var OWNER_IDENTITY_CONTRACT = "COS_OWNER_CONFIRMED_IDENTITY_V1";
var record3 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid22 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var text15 = (v, max = 250) => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
var id12 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n ? v : null;
var revision2 = (v) => typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
var digest2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var exact6 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
var normalized6 = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var sorted = (v) => [...v].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var OwnerIdentityError = class extends Error {
  status;
  constructor(message, status2 = 409) {
    super(message);
    this.status = status2;
    this.name = "OwnerIdentityError";
  }
};
function fail12(message) {
  throw new OwnerIdentityError(message);
}
async function ownerIdentityDigest(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value2)))), (b) => b.toString(16).padStart(2, "0")).join("");
}
function ownerConfirmedPhysicalTuple(key2, devices) {
  return [OWNER_IDENTITY_CONTRACT, OWNER_IDENTITY_ORG, key2, devices.map((d) => [id12(d.id), d.source, d.device_type, d.external_device_id ?? null, d.device_serial ?? null, d.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)];
}
function validateOwnerIdentitySnapshot(value2) {
  if (!record3(value2) || !digest2(value2.revision) || !Array.isArray(value2.claims) || value2.claims.length > 1e3) fail12("Owner identity commitments are unavailable.");
  for (const c of value2.claims) if (!record3(c) || !uuid22(c.id) || c.organization_id !== OWNER_IDENTITY_ORG || !uuid22(c.native_unit_id) || !text15(c.native_unit_label) || !text15(c.legacy_unit_key) || !Array.isArray(c.device_ids) || !c.device_ids.length || c.device_ids.length > 1e3 || c.device_ids.some((v) => id12(v) !== v) || new Set(c.device_ids).size !== c.device_ids.length || !digest2(c.resource_epoch) || !digest2(c.physical_digest) || c.provenance !== "owner_confirmation" || !["active", "revoked"].includes(c.status) || !revision2(c.revision)) fail12("Owner identity commitments are malformed.");
  if (new Set(value2.claims.map((c) => c.id)).size !== value2.claims.length) fail12("Owner identity history contains duplicate records.");
}
async function currentOwnerIdentityEvidence(s, unitId, unitKey, matchKey = placementMatchKey) {
  if (![s.units, s.devices, s.matches, s.providers, s.epochs].every((rows4) => Array.isArray(rows4) && rows4.length <= 1e5 && rows4.every(record3))) fail12("Identity source records are unavailable.");
  if (!uuid22(unitId) || !text15(unitKey)) fail12("Choose the exact equipment and camera group.");
  const units = s.units.filter((u) => u.id === unitId), unit = units[0];
  if (units.length !== 1 || unit.organization_id !== OWNER_IDENTITY_ORG || !text15(unit.unit_number) || typeof unit.status !== "string" || ["retired", "deleted"].includes(unit.status)) fail12("The exact native equipment identity is missing or duplicated.");
  const nativeEpochs = s.crosswalk.nativeEpochs?.filter((e) => e.unitId === unitId);
  if (!Array.isArray(nativeEpochs) || nativeEpochs.length !== 1 || !digest2(nativeEpochs[0].epoch)) fail12("The native identity incarnation is unavailable.");
  const group = s.devices.filter((d) => normalized6(d.unit_key) === normalized6(unitKey));
  if (!group.length || group.length > 1e3 || group.some((d) => d.unit_key !== unitKey || !id12(d.id) || !text15(d.source, 100) || !text15(d.device_type, 100) || [d.external_device_id, d.device_serial].some((v) => v !== null && v !== void 0 && !text15(v, 500)))) fail12("The complete exact camera resource group is unavailable or ambiguous.");
  const ids = sorted(group.map((d) => id12(d.id)));
  if (new Set(ids).size !== ids.length || group.some((d) => s.devices.filter((other) => id12(other.id) === id12(d.id)).length !== 1)) fail12("Camera resource identities are duplicated.");
  if (group.some((d) => s.devices.some((other) => other !== d && other.source === d.source && (text15(d.external_device_id, 500) && other.external_device_id === d.external_device_id || text15(d.device_serial, 500) && other.device_serial === d.device_serial)))) fail12("A physical camera identifier is claimed by multiple resources.");
  const matchedProviderIds = s.matches.every((m) => typeof m.vigilant_device_id === "string") && s.providers.every((p) => typeof p.id === "string") ? new Set(s.matches.map((m) => m.vigilant_device_id)) : null;
  const providerClaimsGroup = matchedProviderIds ? s.providers.some((p) => matchedProviderIds.has(p.id) && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)) : s.matches.some((m) => s.providers.some((p) => p.id === m.vigilant_device_id && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)));
  if (providerClaimsGroup) fail12("A native provider association already claims a resource in this camera group.");
  const concern3 = [matchKey(unit.unit_number), matchKey(unitKey)];
  if (s.units.some((u) => u.id !== unitId && concern3.includes(matchKey(u.unit_number))) || s.devices.some((d) => d.unit_key !== unitKey && concern3.includes(matchKey(d.unit_key)))) fail12("A competing full family, number or suffix identity requires review.");
  const epochs = s.epochs.filter((e) => e.unitKey === unitKey), epoch = epochs[0];
  if (epochs.length !== 1 || !digest2(epoch.epoch) || !Array.isArray(epoch.deviceIds) || !exact6(epoch.deviceIds, ids)) fail12("The current camera identity incarnation is unavailable or changed.");
  return { nativeEpoch: nativeEpochs[0].epoch, unitId, unitNumber: unit.unit_number, unitKey, deviceIds: ids, resourceEpoch: epoch.epoch, physicalDigest: await ownerIdentityDigest(ownerConfirmedPhysicalTuple(unitKey, group)), physicalResources: group.map((d) => ({ id: id12(d.id), source: d.source, type: d.device_type, externalId: d.external_device_id ?? null, serial: d.device_serial ?? null })).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) };
}
function ownerClaimRelated(c, unitId, key2, ids) {
  return c.native_unit_id === unitId || normalized6(c.legacy_unit_key) === normalized6(key2) || c.device_ids.some((d) => ids.includes(d));
}
async function projectOwnerConfirmedIdentities(s) {
  validateOwnerIdentitySnapshot(s.crosswalk);
  const unitIdentities = [], identityWarnings = [];
  const labelKeys3 = /* @__PURE__ */ new Map();
  const matchKey = (value2) => {
    if (typeof value2 !== "string") return placementMatchKey(value2);
    if (!labelKeys3.has(value2)) labelKeys3.set(value2, placementMatchKey(value2));
    return labelKeys3.get(value2);
  };
  for (const claim of s.crosswalk.claims) {
    const binding = { unitId: claim.native_unit_id, deviceIds: [...claim.device_ids], unitKeys: [claim.legacy_unit_key] };
    let reason = "";
    try {
      if (claim.status !== "active") fail12("The Owner-confirmed identity was revoked. Its resource commitments remain reserved.");
      const evidence = await currentOwnerIdentityEvidence(s, claim.native_unit_id, claim.legacy_unit_key, matchKey);
      if (claim.native_unit_label !== evidence.unitNumber || !exact6(claim.device_ids, evidence.deviceIds) || claim.resource_epoch !== evidence.resourceEpoch || claim.physical_digest !== evidence.physicalDigest) fail12("The Owner-confirmed source identity changed. A restored label cannot reactivate it.");
      if (s.crosswalk.claims.some((c) => c !== claim && ownerClaimRelated(c, claim.native_unit_id, claim.legacy_unit_key, claim.device_ids))) fail12("More than one identity commitment claims these resources.");
      if (s.matches.some((m) => m.equipment_unit_id === claim.native_unit_id)) fail12("A provider association now competes with the Owner confirmation. Review its provenance.");
      const proof = await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT, claim.id, claim.revision, claim.native_unit_id, claim.native_unit_label, claim.legacy_unit_key, sorted(claim.device_ids), claim.resource_epoch, claim.physical_digest, claim.provenance]);
      unitIdentities.push({ ...binding, unitNumber: claim.native_unit_label, kind: "owner_confirmed_native", proof });
    } catch (error) {
      reason = error instanceof Error ? error.message : "Owner identity evidence could not be verified.";
    }
    if (reason) identityWarnings.push({ ...binding, reason });
  }
  return { unitIdentities, identityWarnings };
}
async function prepareOwnerIdentityReview(s, unitId, unitKey, existing) {
  validateOwnerIdentitySnapshot(s.crosswalk);
  const evidence = await currentOwnerIdentityEvidence(s, unitId, unitKey);
  if (s.crosswalk.claims.some((c) => ownerClaimRelated(c, unitId, unitKey, evidence.deviceIds))) fail12("This identity already has a confirmation or permanent revoked commitment.");
  if (s.matches.some((m) => m.equipment_unit_id === unitId) || [...existing.unitIdentities, ...existing.identityWarnings].some((c) => c.unitId === unitId || c.deviceIds?.some((d) => evidence.deviceIds.includes(d)) || c.unitKeys?.some((k) => normalized6(k) === normalized6(unitKey)))) fail12("This is not an unlinked identity. Review the existing association first.");
  const token = await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT, s.crosswalk.revision, evidence]);
  return { ...evidence, revision: s.crosswalk.revision, reviewToken: token };
}

// tech-checks/supabase/functions/cos-operations-pages/ownerIdentityReview.ts
var uuid23 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var text16 = (v, max) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
function fail13(message, status2 = 409) {
  throw new OwnerIdentityError(message, status2);
}
function createOwnerIdentityReview(deps) {
  const payload = { p_actor_user_id: deps.actorId, p_organization_id: deps.organizationId };
  return async (path, method, body) => {
    if (path === "/api/owner-identity/review" && method === "GET") {
      const { sources: sources2, identity: identity5 } = await deps.read();
      validateOwnerIdentitySnapshot(sources2.crosswalk);
      const reservedUnits = new Set(sources2.crosswalk.claims.map((c) => c.native_unit_id));
      const nativeUnits = sources2.units.filter((u) => !reservedUnits.has(u.id) && !["retired", "deleted"].includes(u.status) && !sources2.matches.some((m) => m.equipment_unit_id === u.id) && !identity5.unitIdentities.some((p) => p.unitId === u.id) && !identity5.identityWarnings.some((p) => p.unitId === u.id)).map((u) => ({ id: u.id, unitNumber: u.unit_number }));
      const rawKeys = [...new Set(sources2.devices.map((d) => d.unit_key))].filter((k) => text16(k, 250) && !sources2.crosswalk.claims.some((c) => c.legacy_unit_key === k) && ![...identity5.unitIdentities, ...identity5.identityWarnings].some((p) => p.unitKeys.includes(k)));
      if (nativeUnits.length > 1e3 || rawKeys.length > 1e3) fail13("Identity review inventory exceeds the safe review limit.", 503);
      return { contract: OWNER_IDENTITY_CONTRACT, nativeUnits, rawKeys, confirmations: sources2.crosswalk.claims.map((c) => ({ id: c.id, unitId: c.native_unit_id, unitNumber: c.native_unit_label, unitKey: c.legacy_unit_key, status: c.status, revision: c.revision, provenance: c.provenance })) };
    }
    if (!["/api/owner-identity/preview", "/api/owner-identity/confirm", "/api/owner-identity/revoke"].includes(path)) fail13("Identity review endpoint not found.", 404);
    if (method !== "POST" || !body || typeof body !== "object" || Array.isArray(body)) fail13("Identity review requires an explicit request.", 400);
    const b = body;
    const allowed = path === "/api/owner-identity/preview" ? ["unitId", "unitKey"] : path === "/api/owner-identity/confirm" ? ["unitId", "unitKey", "reviewToken", "requestId", "confirmationText"] : path === "/api/owner-identity/revoke" ? ["claimId", "expectedRevision", "requestId", "reason"] : [];
    if (!allowed.length || Object.keys(b).some((k) => !allowed.includes(k))) fail13("Unsupported identity review fields.", 400);
    if (path === "/api/owner-identity/revoke") {
      if (!uuid23(b.claimId) || !uuid23(b.requestId) || b.expectedRevision !== "1" || !text16(b.reason, 4e3)) fail13("Current confirmation and revocation reason required.", 400);
      const receipt3 = await deps.rpc("cos_owner_identity_revoke", { ...payload, p_claim_id: b.claimId, p_expected_revision: b.expectedRevision, p_request_id: b.requestId, p_reason: b.reason });
      const { sources: sources2 } = await deps.read();
      if (receipt3.claimId !== b.claimId || receipt3.revision !== "2" || !sources2.crosswalk.claims.some((c) => c.id === b.claimId && c.status === "revoked")) fail13("Revocation receipt is uncertain. Reload; do not replay automatically.", 503);
      return receipt3;
    }
    if (!uuid23(b.unitId) || !text16(b.unitKey, 250)) fail13("Choose an exact native unit and source group.", 400);
    const { sources, identity: identity4 } = await deps.read(b.unitKey);
    const evidence = await prepareOwnerIdentityReview(sources, b.unitId, b.unitKey, identity4);
    if (path === "/api/owner-identity/preview") return { contract: OWNER_IDENTITY_CONTRACT, unitId: evidence.unitId, unitNumber: evidence.unitNumber, unitKey: evidence.unitKey, deviceIds: evidence.deviceIds, reviewToken: evidence.reviewToken, provenance: "owner_confirmation" };
    if (!uuid23(b.requestId) || !text16(b.confirmationText, 4e3) || b.reviewToken !== evidence.reviewToken) fail13("The reviewed identity changed or confirmation is missing. Preview it again.");
    const receipt2 = await deps.rpc("cos_owner_identity_confirm", { ...payload, p_expected_revision: evidence.revision, p_request_id: b.requestId, p_claim: { unitId: evidence.unitId, unitNumber: evidence.unitNumber, unitKey: evidence.unitKey, deviceIds: evidence.deviceIds, resourceEpoch: evidence.resourceEpoch, nativeEpoch: evidence.nativeEpoch, physicalDigest: evidence.physicalDigest, physicalResources: evidence.physicalResources, provenance: "owner_confirmation", confirmationText: b.confirmationText, evidenceRef: "owner-ui:" + b.requestId } });
    const fresh2 = await deps.read();
    if (!uuid23(receipt2.claimId) || receipt2.revision !== "1" || !fresh2.sources.crosswalk.claims.some((c) => c.id === receipt2.claimId && c.status === "active") || !fresh2.identity.ownerConfirmedUnitIdentities?.some((p) => p.unitId === b.unitId && p.kind === "owner_confirmed_native" && p.unitKeys.length === 1 && p.unitKeys[0] === b.unitKey)) fail13("Confirmation saved but its current source readback is uncertain. Reload; do not replay automatically.", 503);
    return { ...receipt2, provenance: "owner_confirmation" };
  };
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
var record4 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
var text17 = (value2) => typeof value2 === "string" && value2.length > 0 && value2 === value2.trim();
var uuid24 = (value2) => typeof value2 === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value2);
var decimal6 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0 ? String(value2) : typeof value2 === "string" && /^[1-9][0-9]*$/.test(value2) ? value2 : null;
var sortIds = (values) => [...values].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var exactSet = (left, right) => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((value2) => right.includes(value2));
var index = (rows4, key2) => {
  const out = /* @__PURE__ */ new Map();
  for (const row2 of rows4) out.set(row2[key2], [...out.get(row2[key2]) || [], row2]);
  return out;
};
async function identityDigest(value2) {
  const digest3 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value2)));
  return Array.from(new Uint8Array(digest3), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
var nativeIdentityKey = (unitId) => identityDigest(["COS_HEALTH_NATIVE_UNIT_V1", unitId]);
var ownerIdentityKey = (controlId) => identityDigest(["COS_HEALTH_OWNER_CONTROL_V1", controlId]);
var healthResourceKey = (deviceId4) => identityDigest(["COS_HEALTH_RESOURCE_V1", deviceId4]);
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
    decimal6(device.id),
    device.source,
    device.external_device_id,
    device.device_serial,
    device.unit_key,
    device.device_type
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return ["COS_HEALTH_NATIVE_ASSOCIATION_V1", organizationId, unit.id, unit.unit_number, mappings];
}
function ownerIdentityTuple(audit) {
  return ["COS_HEALTH_OWNER_ASSOCIATION_V1", organizationId, audit.control_id, audit.unit_key, decimal6(audit.id), sortIds(audit.device_ids.map(decimal6))];
}
function ownerPhysicalIdentityTuple(audit, devices) {
  const resources = devices.map((device) => [decimal6(device.id), device.source, device.device_type, device.device_serial, device.external_device_id, device.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0);
  return ["COS_HEALTH_OWNER_RESOURCES_V1", organizationId, audit.control_id, resources];
}
var reviewed = { native: REVIEWED_NATIVE_IDENTITIES, owner: REVIEWED_OWNER_IDENTITIES, nativeResources: REVIEWED_NATIVE_RESOURCES, ownerResources: REVIEWED_OWNER_RESOURCES, ownerPhysical: REVIEWED_OWNER_PHYSICAL_IDENTITIES };
async function verifiedHealthIdentities(sources, review = reviewed) {
  const { units, matches: matches2, providers, devices, audits } = sources;
  if (![units, matches2, providers, devices, audits].every((rows4) => Array.isArray(rows4) && rows4.length <= 1e5 && rows4.every(record4))) throw new Error("Health identity source records are unavailable.");
  const unitIds = index(units, "id"), matchIds = index(matches2, "id"), providerIds = index(providers, "id"), externalProviders = index(providers, "external_device_id");
  const byNative = index(matches2, "equipment_unit_id"), resourceOwners = index(matches2, "vigilant_device_id");
  const deviceIds = index(devices.map((row2) => ({ ...row2, id: decimal6(row2.id) })), "id"), externalDevices = index(devices, "external_device_id"), serialDevices = index(devices, "device_serial");
  const presentIds = /* @__PURE__ */ new Map(), presentKeys = /* @__PURE__ */ new Map();
  for (const id15 of deviceIds.keys()) if (typeof id15 === "string") presentIds.set(await healthResourceKey(id15), id15);
  for (const key2 of new Set(devices.map((device) => device.unit_key))) if (text17(key2)) presentKeys.set(await healthSourceUnitKey(key2), key2);
  const warningBindings = /* @__PURE__ */ new Map();
  const bindWarning = (unitId, resources) => {
    warningBindings.set(unitId, {
      deviceIds: sortIds([...new Set((resources?.deviceIds || []).flatMap((hash7) => presentIds.has(hash7) ? [presentIds.get(hash7)] : []))]),
      unitKeys: [...new Set((resources?.unitKeys || []).flatMap((hash7) => presentKeys.has(hash7) ? [presentKeys.get(hash7)] : []))].sort()
    });
  };
  const identities = [], warnings = /* @__PURE__ */ new Map();
  const reject2 = (unitId, reason) => {
    if (!warnings.has(unitId)) warnings.set(unitId, { unitId, reason, ...warningBindings.get(unitId) || { deviceIds: [], unitKeys: [] } });
  };
  const rejectUnavailable = (reviewKey, resources, reason) => {
    const unitId = "unavailable:" + reviewKey;
    bindWarning(unitId, resources);
    const binding = warningBindings.get(unitId);
    if (binding.deviceIds.length || binding.unitKeys.length) reject2(unitId, reason);
  };
  const presentNativeKeys = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (!uuid24(unit.id)) continue;
    const reviewKey = await nativeIdentityKey(unit.id), expected = review.native[reviewKey], resources = review.nativeResources[reviewKey];
    if (!expected && !resources) continue;
    presentNativeKeys.add(reviewKey);
    bindWarning(unit.id, resources);
    if (!expected) {
      reject2(unit.id, "The reviewed native association has been revoked and requires identity review.");
      continue;
    }
    if (unit.organization_id !== organizationId || unitIds.get(unit.id)?.length !== 1 || !text17(unit.unit_number)) {
      reject2(unit.id, "Native equipment identity changed or is duplicated.");
      continue;
    }
    const links = byNative.get(unit.id) || [];
    if (!links.length) {
      reject2(unit.id, "Reviewed provider-resource mappings are missing.");
      continue;
    }
    const associations = [];
    let reason = null;
    for (const match of links) {
      if (match.organization_id !== organizationId || !uuid24(match.id) || matchIds.get(match.id)?.length !== 1 || !uuid24(match.vigilant_device_id) || resourceOwners.get(match.vigilant_device_id)?.length !== 1 || !text17(match.camera_key) || !text17(match.match_method) || !text17(match.confidence)) {
        reason = "Provider-resource mapping ownership is missing, changed or duplicated.";
        break;
      }
      const candidates = providerIds.get(match.vigilant_device_id) || [], provider = candidates[0];
      if (candidates.length !== 1 || provider.organization_id !== organizationId || provider.source !== "vigilant_control_center" || !text17(provider.external_device_id) || externalProviders.get(provider.external_device_id)?.length !== 1 || !text17(provider.device_name) || !["IPC", "NVR"].includes(provider.device_type)) {
        reason = "Provider identity is missing, duplicated or has an unverified family.";
        break;
      }
      const legacy = externalDevices.get(provider.external_device_id) || [], device = legacy[0];
      if (legacy.length !== 1 || !decimal6(device.id) || deviceIds.get(decimal6(device.id))?.length !== 1 || device.source !== "vigilant_control_center" || !text17(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text17(device.unit_key) || device.device_type !== provider.device_type) {
        reason = "Legacy resource identity is missing, duplicated or inconsistent.";
        break;
      }
      associations.push({ match, provider, device });
    }
    if (reason) {
      reject2(unit.id, reason);
      continue;
    }
    const boundIds = associations.map((row2) => decimal6(row2.device.id)), unitKeys = [...new Set(associations.map((row2) => row2.device.unit_key))].sort();
    const wholeGroupIds = devices.filter((device) => unitKeys.includes(device.unit_key)).map((device) => decimal6(device.id));
    if (wholeGroupIds.some((id15) => !id15) || !exactSet(boundIds, wholeGroupIds)) {
      reject2(unit.id, "Reviewed mapping is partial or the current source unit has extra/duplicate resources.");
      continue;
    }
    const proof = await identityDigest(nativeIdentityTuple(unit, associations));
    if (proof !== expected) {
      reject2(unit.id, "The complete reviewed native/provider association has changed.");
      continue;
    }
    identities.push({ unitId: unit.id, unitNumber: unit.unit_number, kind: "native_provider", deviceIds: sortIds(boundIds), unitKeys, proof });
  }
  for (const [key2, resources] of Object.entries(review.nativeResources)) if (!presentNativeKeys.has(key2)) rejectUnavailable(key2, resources, "Reviewed native equipment identity is missing from the current inventory.");
  const knownOwners = /* @__PURE__ */ new Set(), presentOwnerKeys = /* @__PURE__ */ new Set();
  for (const audit of audits) {
    if (!uuid24(audit.control_id)) continue;
    const key2 = await ownerIdentityKey(audit.control_id), resources = review.ownerResources[key2];
    if (resources) {
      knownOwners.add(audit.control_id);
      presentOwnerKeys.add(key2);
      bindWarning(audit.control_id, resources);
    }
  }
  for (const [key2, resources] of Object.entries(review.ownerResources)) if (!presentOwnerKeys.has(key2)) rejectUnavailable(key2, resources, "Reviewed Owner placement history is missing from the current inventory.");
  const currentOwners = /* @__PURE__ */ new Set();
  for (const audit of currentOwnerPlacements(audits, devices)) {
    if (!uuid24(audit.control_id)) continue;
    currentOwners.add(audit.control_id);
    if (audit.conflictReason) {
      reject2(audit.control_id, "Owner placement identity needs review: " + audit.conflictReason);
      continue;
    }
    const proof = await identityDigest(ownerIdentityTuple(audit));
    if (!review.owner.has(proof)) {
      if (knownOwners.has(audit.control_id)) reject2(audit.control_id, "The current Owner placement audit has not been reviewed for health identity.");
      continue;
    }
    const ownerDevices = devices.filter((device) => audit.device_ids.map(decimal6).includes(decimal6(device.id))), boundIds = ownerDevices.map((device) => decimal6(device.id));
    if (!exactSet(boundIds, audit.device_ids.map(decimal6)) || ownerDevices.some((device) => device.unit_key !== audit.unit_key || deviceIds.get(decimal6(device.id))?.length !== 1) || unitIds.has(audit.control_id)) {
      reject2(audit.control_id, "Owner control identity or exact resource membership is inconsistent.");
      continue;
    }
    if (ownerDevices.some((device) => device.source !== "vigilant_control_center" || device.device_type !== "IPC" || !text17(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text17(device.external_device_id) || externalDevices.get(device.external_device_id)?.length !== 1)) {
      reject2(audit.control_id, "Owner physical camera identity is missing, duplicated or has an unverified provider or resource kind.");
      continue;
    }
    if (await identityDigest(ownerPhysicalIdentityTuple(audit, ownerDevices)) !== review.ownerPhysical[await ownerIdentityKey(audit.control_id)]) {
      reject2(audit.control_id, "The reviewed Owner physical camera identities have changed.");
      continue;
    }
    identities.push({ unitId: audit.control_id, unitNumber: audit.unit_key, kind: "owner_placement", deviceIds: sortIds(boundIds), unitKeys: [audit.unit_key], proof, placementAuditId: decimal6(audit.id) });
  }
  for (const unitId of knownOwners) if (!currentOwners.has(unitId)) reject2(unitId, "The reviewed Owner placement control is no longer current.");
  if (sources.ownerCrosswalk) {
    const confirmed = await projectOwnerConfirmedIdentities({ units, devices, matches: matches2, providers, epochs: sources.ownerEpochs || [], crosswalk: sources.ownerCrosswalk });
    for (const identity4 of confirmed.unitIdentities) identities.push(identity4);
    for (const warning of confirmed.identityWarnings) warnings.set(warning.unitId, warning);
  }
  const claims = /* @__PURE__ */ new Map();
  for (const identity4 of identities) for (const id15 of identity4.deviceIds) claims.set(id15, /* @__PURE__ */ new Set([...claims.get(id15) || [], identity4.unitId]));
  const conflicts = new Set(identities.filter((identity4) => identities.filter((other) => other.unitId === identity4.unitId).length !== 1 || identity4.deviceIds.some((id15) => claims.get(id15).size !== 1) || [...warnings.values()].some((w) => w.unitId !== identity4.unitId && (w.deviceIds.some((id15) => identity4.deviceIds.includes(id15)) || w.unitKeys.some((key2) => identity4.unitKeys.includes(key2))))).map((identity4) => identity4.unitId));
  for (const unitId of conflicts) reject2(unitId, "Health resources have more than one equipment identity.");
  const admitted = identities.filter((identity4) => !warnings.has(identity4.unitId)).sort((a, b) => a.unitId.localeCompare(b.unitId));
  return { identityVersion: 1, unitIdentities: admitted.filter((identity4) => identity4.kind !== "owner_confirmed_native"), ...sources.ownerCrosswalk ? { ownerConfirmedIdentityVersion: 1, ownerConfirmedUnitIdentities: admitted.filter((identity4) => identity4.kind === "owner_confirmed_native") } : {}, identityWarnings: [...warnings.values()].sort((a, b) => a.unitId.localeCompare(b.unitId)) };
}

// tech-checks/operations/shared/cameraSweepCoverage.ts
var sweepHoldLabels = { identity_unverified: "Identity unverified", monitoring_disabled: "Monitoring disabled", ownership_unverified: "Ownership unverified", retired_or_not_in_use: "Retired / not in use", saved_endpoint_unavailable: "Saved endpoint unavailable", lifecycle_unverified: "Lifecycle unverified" };
var count5 = (v) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 1e4;
function projectCameraSweepCoverage(rows4) {
  const matches2 = rows4.filter((r2) => r2.provider === "avigilon");
  if (matches2.length !== 1) return null;
  const r = matches2[0], m = r.sweep ?? { source: r.sweep_source, complete: r.sweep_complete, counts_known: r.sweep_counts_known, eligible: r.sweep_eligible, scanned: r.sweep_scanned, published: r.sweep_published, held: r.sweep_held, reconciled_at: r.sweep_reconciled_at, held_reasons: r.sweep_held_reasons };
  if (r.enabled !== true || !["ok", "partial"].includes(r.last_sync_status) || !m || m.source !== "owned_saved_service_ports" || m.counts_known !== true || typeof m.complete !== "boolean" || ["eligible", "scanned", "published", "held"].some((k) => !count5(m[k])) || m.published > m.scanned || m.scanned > m.eligible || typeof r.last_sync_at !== "string" || !Number.isFinite(Date.parse(r.last_sync_at)) || typeof m.reconciled_at !== "string" || Date.parse(m.reconciled_at) !== Date.parse(r.last_sync_at) || !m.held_reasons || typeof m.held_reasons !== "object" || Array.isArray(m.held_reasons)) return null;
  const heldReasons = [];
  for (const [reason, value2] of Object.entries(m.held_reasons)) {
    if (!Object.hasOwn(sweepHoldLabels, reason) || !count5(value2)) return null;
    heldReasons.push({ reason, count: value2 });
  }
  if (heldReasons.reduce((n, r2) => n + r2.count, 0) !== m.held) return null;
  const complete = m.complete && r.last_sync_status === "ok" && m.held === 0 && m.published === m.eligible;
  return { contract: "COS_CAMERA_SWEEP_COVERAGE_V1", source: "owned_saved_service_ports", observedAt: new Date(r.last_sync_at).toISOString(), complete, eligible: m.eligible, scanned: m.scanned, published: m.published, held: m.held, heldReasons };
}

// tech-checks/operations/shared/starUnitStatus.ts
var STAR_UNIT_STATUS_CONTRACT = "COS_STAR_UNIT_STATUS_V1";
var SHOP_NAMES = /* @__PURE__ */ new Set(["", "root", "shop"]);
var PENDING_SITE = /^Star4Live site #\d+ \(name pending\)$/;
var STAR_FEED_FRESH_MS = 45 * 60 * 1e3;
var text18 = (value2) => typeof value2 === "string" ? value2.trim() : "";
function cameraStatus(row2) {
  const value2 = text18(row2?.vigilant_status).toLowerCase();
  return value2 === "online" ? "online" : value2 === "offline" ? "offline" : "unknown";
}
function cameraPlacement(row2) {
  return SHOP_NAMES.has(text18(row2?.organization).toLowerCase()) ? "SHOP" : "FIELD";
}
function unitLabel(row2) {
  return text18(row2?.unit_key) || text18(row2?.device_name);
}
function unitState(online, offline, unknown3) {
  if (online > 0 && offline === 0 && unknown3 === 0) return "GREEN";
  if (online === 0 && offline === 0) return "UNKNOWN";
  if (online === 0 && unknown3 === 0) return "RED";
  return "YELLOW";
}
function projectUnitCameraStatus(rows4) {
  const groups = /* @__PURE__ */ new Map();
  for (const row2 of Array.isArray(rows4) ? rows4 : []) {
    if (text18(row2?.activation_state).toLowerCase() === "deactivated") continue;
    const unit = unitLabel(row2);
    if (!unit) continue;
    const key2 = unit.toUpperCase();
    (groups.get(key2) || groups.set(key2, []).get(key2)).push(row2);
  }
  const units = [];
  for (const members of groups.values()) {
    const named = members.map((row2) => ({ row: row2, status: cameraStatus(row2), name: text18(row2.device_name) || unitLabel(row2) }));
    const online = named.filter((c) => c.status === "online").length;
    const offline = named.filter((c) => c.status === "offline").length;
    const unknown3 = named.length - online - offline;
    const field5 = members.filter((row2) => cameraPlacement(row2) === "FIELD");
    const placement3 = field5.length ? "FIELD" : "SHOP";
    const siteRow = field5.find((row2) => cameraStatus(row2) === "online") || field5[0];
    const site = placement3 === "FIELD" ? text18(siteRow?.organization) : null;
    const observed2 = members.map((row2) => text18(row2.source_last_seen_at)).filter(Boolean).sort();
    units.push({
      unit: unitLabel(members[0]),
      placement: placement3,
      site: site || null,
      siteNamePending: Boolean(site && PENDING_SITE.test(site)),
      state: unitState(online, offline, unknown3),
      cameras: named.length,
      online,
      offline,
      unknown: unknown3,
      down: named.filter((c) => c.status !== "online").map((c) => ({ name: c.name, status: c.status })),
      onlineInShop: placement3 === "SHOP" && online > 0,
      publicIp: text18(members.find((row2) => text18(row2.public_ip))?.public_ip) || null,
      observedAt: observed2.length ? observed2[observed2.length - 1] : null
    });
  }
  units.sort((a, b) => a.unit.localeCompare(b.unit, "en", { numeric: true }));
  const fieldUnits = units.filter((u) => u.placement === "FIELD"), shopUnits = units.filter((u) => u.placement === "SHOP");
  return {
    contract: STAR_UNIT_STATUS_CONTRACT,
    units,
    counts: {
      units: units.length,
      cameras: units.reduce((total, u) => total + u.cameras, 0),
      field: {
        units: fieldUnits.length,
        green: fieldUnits.filter((u) => u.state === "GREEN").length,
        yellow: fieldUnits.filter((u) => u.state === "YELLOW").length,
        red: fieldUnits.filter((u) => u.state === "RED").length,
        unknown: fieldUnits.filter((u) => u.state === "UNKNOWN").length,
        camerasDown: fieldUnits.reduce((total, u) => total + u.offline, 0)
      },
      shop: { units: shopUnits.length, onlineInShop: shopUnits.filter((u) => u.onlineInShop).length }
    }
  };
}
function applyFeedFreshness(report, feed, now = Date.now(), maxAgeMs = STAR_FEED_FRESH_MS) {
  const syncedAt = text18(feed?.syncedAt) || null;
  const at = syncedAt ? Date.parse(syncedAt) : NaN;
  const ageMs = Number.isFinite(at) ? now - at : null;
  const status2 = text18(feed?.status) || null;
  const enabled = feed?.enabled !== false;
  const fresh2 = enabled && status2 === "ok" && ageMs !== null && ageMs >= -6e4 && ageMs <= maxAgeMs;
  const stamped = { provider: "star4live", syncedAt, status: status2, enabled, fresh: fresh2, ageMs };
  if (fresh2) return { ...report, feed: stamped };
  const units = report.units.map((unit) => ({
    ...unit,
    state: "UNKNOWN",
    online: 0,
    offline: 0,
    unknown: unit.cameras,
    down: unit.down.map((camera) => ({ ...camera, status: "unknown" })),
    onlineInShop: false
  }));
  const field5 = units.filter((unit) => unit.placement === "FIELD");
  return {
    ...report,
    feed: stamped,
    units,
    counts: {
      ...report.counts,
      field: { units: field5.length, green: 0, yellow: 0, red: 0, unknown: field5.length, camerasDown: 0 },
      shop: { units: units.length - field5.length, onlineInShop: 0 }
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/fieldRecorderObservation.ts
var REVIEWED_FIELD_RECORDER_PROOFS = /* @__PURE__ */ new Set([
  "c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049",
  "8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6",
  "1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816",
  "ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c",
  "3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a"
]);
var object35 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var id13 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : null;
var same3 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
function fieldRecorderObservationGuards(sources, identity4, now = Date.now(), reviewed2 = REVIEWED_FIELD_RECORDER_PROOFS) {
  const result = { fieldRecorderObservationVersion: 1, fieldRecorderObservationGuards: [] };
  if (!Number.isFinite(now) || ![sources.units, sources.devices, sources.audits].every((v) => Array.isArray(v) && v.length <= 1e5 && v.every(object35)) || identity4?.identityVersion !== 1 || !Array.isArray(identity4.unitIdentities) || !Array.isArray(identity4.identityWarnings)) return result;
  const { units, devices, audits } = sources;
  if (new Set(units.map((u) => u.id)).size !== units.length || new Set(devices.map((d) => id13(d.id))).size !== devices.length || devices.some((d) => !id13(d.id) || typeof d.unit_key !== "string") || audits.some((a) => !id13(a.id) || typeof a.unit_key !== "string" || !Array.isArray(a.device_ids) || a.device_ids.some((v) => !id13(v))) || new Set(audits.map((a) => id13(a.id))).size !== audits.length) return result;
  for (const proof of identity4.unitIdentities) {
    if (!object35(proof) || proof.kind !== "native_provider" || !reviewed2.has(proof.proof) || !Array.isArray(proof.deviceIds) || !proof.deviceIds.length || !Array.isArray(proof.unitKeys) || !proof.unitKeys.length) continue;
    const native = units.filter((u) => u.id === proof.unitId), rows4 = devices.filter((d) => proof.deviceIds.includes(String(d.id)));
    if (native.length !== 1 || native[0].unit_number !== proof.unitNumber || native[0].status !== "available" || identity4.unitIdentities.filter((p) => p.unitId === proof.unitId).length !== 1 || !same3(rows4.map((d) => String(d.id)), proof.deviceIds) || !same3([...new Set(rows4.map((d) => d.unit_key))], proof.unitKeys) || !same3(devices.filter((d) => proof.unitKeys.includes(d.unit_key)).map((d) => String(d.id)), proof.deviceIds) || rows4.some((d) => d.source !== "vigilant_control_center" || d.device_type !== "NVR")) continue;
    const related = (p) => p.unitId === proof.unitId || p.deviceIds?.some((v) => proof.deviceIds.includes(v)) || p.unitKeys?.some((v) => proof.unitKeys.includes(v));
    if (identity4.identityWarnings.some(related) || [...identity4.unitIdentities || [], ...identity4.ownerConfirmedUnitIdentities || []].some((p) => p !== proof && related(p))) continue;
    const labels = new Set([proof.unitNumber, ...proof.unitKeys].map(placementMatchKey));
    if (audits.some((a) => labels.has(placementMatchKey(a.unit_key)) || a.device_ids.some((v) => proof.deviceIds.includes(id13(v))))) continue;
    result.fieldRecorderObservationGuards.push({ unitId: proof.unitId, unitNumber: proof.unitNumber, identityProof: proof.proof, deviceIds: [...proof.deviceIds], unitKeys: [...proof.unitKeys], checkedAt: new Date(now).toISOString() });
  }
  return result;
}
function fieldRecorderHealthGuards(sources, identity4, integrations, now = Date.now(), reviewed2 = REVIEWED_FIELD_RECORDER_PROOFS) {
  const empty2 = { fieldRecorderObservationVersion: 1, fieldRecorderObservationGuards: [] };
  if (!Array.isArray(integrations) || integrations.length > 1e3 || integrations.some((v) => !object35(v))) return empty2;
  const matches2 = integrations.filter((v) => v.provider === "vigilant");
  if (matches2.length !== 1) return empty2;
  const integration = matches2[0], sync = cameraTimestamp2(integration.last_sync_at, now);
  if (integration.enabled !== true || integration.last_sync_status !== "ok" || !sync.fresh || !sync.at) return empty2;
  const guarded = fieldRecorderObservationGuards(sources, identity4, now, reviewed2);
  return { ...guarded, fieldRecorderObservationGuards: guarded.fieldRecorderObservationGuards.filter((guard) => sources.devices.filter((d) => guard.deviceIds.includes(String(d.id))).every((d) => cameraTimestamp2(d.source_last_seen_at, now).at === sync.at)).map((guard) => ({ ...guard, providerSyncAt: sync.at })) };
}
async function projectFieldRecorderAuthority(snapshot, sources, identity4, now = Date.now(), reviewed2 = REVIEWED_FIELD_RECORDER_PROOFS) {
  const guards = fieldRecorderObservationGuards(sources, identity4, now, reviewed2).fieldRecorderObservationGuards;
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems)) return snapshot;
  const counts2 = /* @__PURE__ */ new Map();
  for (const row2 of snapshot.inventoryItems) counts2.set(row2.id, (counts2.get(row2.id) || 0) + 1);
  const authorities = /* @__PURE__ */ new Map();
  for (const row2 of snapshot.items) {
    const guard = guards.find((g) => g.unitId === row2.id);
    if (!guard || counts2.get(row2.id) !== 1 || snapshot.items.filter((r) => r.id === row2.id).length !== 1) continue;
    const binding = await checkedImportedBinding(row2.importedInstallation);
    if (row2.readOnly !== false || row2.unitNumber !== guard.unitNumber || row2.status !== "field" || row2.currentLocationType !== "field" || row2.importedPlacement !== "FIELD" || row2.placementSource === "owner" || row2.placementAuditId || !binding || binding.sourceSystem !== "mhelpdesk_product_import" || binding.entityKind !== "equipment_unit" || binding.nativeUnitId !== row2.id || binding.unitNumber !== row2.unitNumber || binding.sourcePrecedence) continue;
    const { sourceRevision, sourceFileSha256, sourceRowSha256, addressSha256, nativeGuardSha256, eventId, productId } = binding;
    authorities.set(row2.id, { schemaVersion: 1, ...guard, sourceRevision, sourceFileSha256, sourceRowSha256, addressSha256, nativeGuardSha256, eventId, productId });
  }
  const project = (row2) => {
    const { fieldRecorderAuthority: discard, ...clean2 } = row2;
    return authorities.has(row2.id) ? { ...clean2, fieldRecorderAuthority: authorities.get(row2.id) } : clean2;
  };
  return { ...snapshot, items: snapshot.items.map(project), inventoryItems: snapshot.inventoryItems.map(project) };
}

// tech-checks/supabase/functions/_shared/reconProviderInventory.ts
async function reconDigest(value2) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value2)));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
}
var reconResourceKey = (id15) => reconDigest(["COS_RECON_RESOURCE_V1", id15]);
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
var object36 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var hash6 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var uuid25 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
var id14 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : null;
var exact7 = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((v) => b.includes(v));
var fresh = (v, now) => typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) > 0 && Date.parse(v) <= now && now - Date.parse(v) <= 20 * 60 * 1e3;
var reconTrackerKey = (unitId) => reconDigest(["COS_RECON_TRACKER_V1", unitId]);
var reconTrackerTuple = (unit) => ["COS_RECON_TRACKER_ASSIGNMENT_V1", unit.id, unit.unitNumber, unit.modelName, unit.readOnly, unit.recordSource ?? null, unit.snapshotImportedAt ?? null, unit.sourceVerifiedAt ?? null];
var reconPhysicalTuple = (devices) => ["COS_RECON_AREA_PHYSICAL_V1", devices.map((d) => [id14(d.id), d.source, d.device_type, d.external_device_id, d.device_serial, d.unit_key]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
async function projectReconProviderIdentities(units, devices, integrations, review = REVIEWED_RECON_PROVIDER_GROUPS, now = Date.now()) {
  const identities = [], warnings = [];
  if (![units, devices, integrations].every((x) => Array.isArray(x) && x.every(object36))) throw Error("Reconeyez assignment sources are unavailable.");
  const presentIds = /* @__PURE__ */ new Map(), presentKeys = /* @__PURE__ */ new Map();
  for (const d of devices) {
    if (id14(d.id)) presentIds.set(await reconDigest(["COS_HEALTH_RESOURCE_V1", id14(d.id)]), id14(d.id));
    if (typeof d.unit_key === "string") presentKeys.set(await reconDigest(["COS_HEALTH_SOURCE_UNIT_V1", d.unit_key]), d.unit_key);
  }
  const provider = integrations.length === 1 && integrations[0].provider === "reconeyez" ? integrations[0] : null, index2 = provider?.identity_inventory;
  const validIndex = Boolean(provider?.enabled === true && provider.last_sync_status === "ok" && index2?.schemaVersion === 1 && fresh(index2.observedAt, now) && fresh(provider.last_sync_at, now) && Date.parse(provider.last_sync_at) === Date.parse(index2.observedAt) && Number.isSafeInteger(index2.resourceCount) && index2.resourceCount > 0 && Array.isArray(index2.groups) && index2.groups.every((g) => object36(g) && hash6(g.areaKey) && hash6(g.proof) && Array.isArray(g.bridgeKeys) && g.bridgeKeys.every(hash6) && Array.isArray(g.detectorKeys) && g.detectorKeys.every(hash6) && typeof g.bridgePrefixUnique === "boolean" && (g.bridgeLastEventAt === null || typeof g.bridgeLastEventAt === "string")));
  const seen = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (!uuid25(unit.id)) continue;
    const key2 = await reconTrackerKey(unit.id), expected = review[key2];
    if (!expected) continue;
    seen.add(key2);
    const resources = { deviceIds: expected.resourceIds.flatMap((k) => presentIds.has(k) ? [presentIds.get(k)] : []), unitKeys: expected.sourceKeys.flatMap((k) => presentKeys.has(k) ? [presentKeys.get(k)] : []) };
    const reject2 = (reason) => warnings.push({ unitId: unit.id, reason, ...resources });
    if (units.filter((x) => x.id === unit.id).length !== 1 || unit.readOnly !== true || unit.modelName !== "RECON II" || await reconDigest(reconTrackerTuple(unit)) !== expected.trackerProof) {
      reject2("The reviewed Recon II tracker assignment changed.");
      continue;
    }
    if (!validIndex) {
      reject2("Reconeyez inventory proof is missing, stale or its authenticated refresh failed.");
      continue;
    }
    const groups = index2.groups.filter((g) => g.areaKey === expected.areaKey || g.bridgeKeys.includes(expected.bridgeKey)), group = groups[0];
    if (groups.length !== 1 || group.proof !== expected.providerProof || !group.bridgePrefixUnique || !exact7(group.bridgeKeys, [expected.bridgeKey]) || group.detectorKeys.length !== expected.detectorCount) {
      reject2("The reviewed Reconeyez provider-area bridge or detector membership changed.");
      continue;
    }
    const rows4 = devices.filter((d) => resources.deviceIds.includes(String(d.id)));
    if (rows4.length !== expected.detectorCount || !exact7(rows4.map((d) => String(d.id)), resources.deviceIds) || rows4.some((d) => devices.filter((x) => String(x.id) === String(d.id)).length !== 1 || d.source !== "reconeyez" || d.device_type !== "Reconeyez detector" || typeof d.external_device_id !== "string" || d.device_serial !== "reconeyez:" + d.external_device_id || devices.filter((x) => x.external_device_id === d.external_device_id || x.device_serial === d.device_serial).length !== 1) || await reconDigest(reconPhysicalTuple(rows4)) !== expected.physicalProof) {
      reject2("The reviewed Reconeyez detector identities are incomplete or replaced.");
      continue;
    }
    const keys3 = [...new Set(rows4.map((d) => d.unit_key))];
    if (keys3.length !== 1 || await reconAreaKey(keys3[0]) !== expected.areaKey || !exact7(devices.filter((d) => keys3.includes(d.unit_key)).map((d) => String(d.id)), resources.deviceIds) || !exact7((await Promise.all(rows4.map((d) => reconResourceKey(d.external_device_id)))).sort(), group.detectorKeys) || index2.groups.some((g) => g !== group && g.detectorKeys.some((k) => group.detectorKeys.includes(k)))) {
      reject2("Reconeyez detector provider-area ownership is conflicting or changed.");
      continue;
    }
    const proof = await reconDigest(["COS_RECON_REVIEWED_AREA_V1", key2, expected]);
    identities.push({ unitId: unit.id, unitNumber: unit.unitNumber, kind: "reconeyez_area", deviceIds: resources.deviceIds, unitKeys: keys3, proof, providerArea: { detectorCount: expected.detectorCount, inventoryObservedAt: index2.observedAt, bridgeLastEventAt: group.bridgeLastEventAt } });
  }
  for (const [key2, expected] of Object.entries(review)) if (!seen.has(key2)) {
    const deviceIds = expected.resourceIds.flatMap((k) => presentIds.has(k) ? [presentIds.get(k)] : []), unitKeys = expected.sourceKeys.flatMap((k) => presentKeys.has(k) ? [presentKeys.get(k)] : []);
    if (deviceIds.length || unitKeys.length) warnings.push({ unitId: "unavailable:recon:" + key2, reason: "The reviewed Recon II tracker assignment is missing.", deviceIds, unitKeys });
  }
  return { reconProviderIdentityVersion: 1, reconProviderUnitIdentities: identities, identityWarnings: warnings };
}
function appendReconProviderIdentities(identity4, recon) {
  const all = [...identity4.unitIdentities || [], ...identity4.ownerConfirmedUnitIdentities || [], ...recon.reconProviderUnitIdentities], warnings = [...identity4.identityWarnings || [], ...recon.identityWarnings];
  for (const claim of all) if (all.some((other) => other !== claim && (other.unitId === claim.unitId || other.deviceIds.some((id15) => claim.deviceIds.includes(id15)))) || warnings.some((w) => w.unitId !== claim.unitId && (w.deviceIds?.some((id15) => claim.deviceIds.includes(id15)) || w.unitKeys?.some((key2) => claim.unitKeys.includes(key2))))) warnings.push({ unitId: claim.unitId, reason: "Provider resources have conflicting reviewed equipment assignments.", deviceIds: claim.deviceIds, unitKeys: claim.unitKeys });
  const clean2 = (rows4) => rows4.filter((row2) => !warnings.some((w) => w.unitId === row2.unitId));
  return { ...identity4, unitIdentities: clean2(identity4.unitIdentities || []), ...identity4.ownerConfirmedUnitIdentities ? { ownerConfirmedUnitIdentities: clean2(identity4.ownerConfirmedUnitIdentities) } : {}, reconProviderIdentityVersion: 1, reconProviderUnitIdentities: clean2(recon.reconProviderUnitIdentities), identityWarnings: [...new Map(warnings.map((w) => [w.unitId, w])).values()] };
}

// tech-checks/supabase/functions/cos-operations-pages/inhandPilot.ts
var INHAND_PILOT = Object.freeze({
  origin: "https://iot.inhandnetworks.com",
  organizationId: "6606d46b1aed8800012d1840",
  deviceId: "693b0ed130c49e0001afb16f",
  serialNumber: "RF3152533024049",
  accountId: "68de7fd03cdea20001c73077",
  accountEmail: "jmartin@camerasonsite.com",
  observedRoleName: "DeviceSense"
});
var LOCATION_FRESHNESS_MS = 10 * 60 * 1e3;
var MIN_STAMP_MS = Date.UTC(2e3, 0, 1);
var TIMEOUT_MS = 5e3;
var MAX_BODY_BYTES = 128 * 1024;
var ERROR_MESSAGES = {
  disabled: "The InHand pilot is disabled.",
  review_required: "The InHand pilot identity, role, and response contract still require verification.",
  already_attempted: "This pilot instance has already attempted its controlled read.",
  not_configured: "The InHand pilot credential is not configured.",
  claim_denied: "The one-use InHand pilot is not armed, has expired, or has already been attempted.",
  claim_unavailable: "The one-use InHand pilot claim could not be verified. No provider request was made.",
  provider_auth: "InHand authorization was rejected. The pilot did not refresh or retry.",
  provider_unavailable: "InHand could not be read. The pilot did not retry.",
  provider_response: "InHand returned an unsupported response. No telemetry was accepted.",
  identity_mismatch: "The InHand account or organization did not match the reviewed pilot.",
  role_mismatch: "The InHand role did not match the reviewed pilot.",
  device_mismatch: "The InHand device identity did not match the reviewed pilot."
};
var InhandPilotError = class extends Error {
  code;
  status;
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = "InhandPilotError";
    this.code = code;
    this.status = ["disabled", "review_required", "not_configured", "already_attempted", "claim_denied", "claim_unavailable"].includes(code) ? 503 : 502;
  }
};
var fail14 = (code) => {
  throw new InhandPilotError(code);
};
var isRow = (value2) => Boolean(value2) && typeof value2 === "object" && !Array.isArray(value2);
var cleanText = (value2, max) => typeof value2 === "string" && value2.trim().length > 0 && value2.length <= max && !/[\u0000-\u001f\u007f]/.test(value2) ? value2.trim() : null;
function unwrapInhandResponse(value2) {
  if (!isRow(value2)) return fail14("provider_response");
  if (Object.hasOwn(value2, "result")) {
    if (Object.keys(value2).length !== 1 || !isRow(value2.result)) return fail14("provider_response");
    return value2.result;
  }
  return value2;
}
function readUnixSeconds(value2, now) {
  if (typeof value2 !== "number" || !Number.isSafeInteger(value2)) return null;
  const ms = value2 * 1e3;
  if (!Number.isSafeInteger(ms) || ms < MIN_STAMP_MS || ms > now) return null;
  return new Date(ms).toISOString();
}
function readUtcTimestamp(value2, now) {
  if (typeof value2 !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value2)) return null;
  const ms = Date.parse(value2);
  if (!Number.isFinite(ms) || ms < MIN_STAMP_MS || ms > now) return null;
  const canonical2 = new Date(ms).toISOString();
  const normalized7 = value2.includes(".") ? value2.replace(/\.(\d{1,3})Z$/, (_, digits) => "." + digits.padEnd(3, "0") + "Z") : value2.replace("Z", ".000Z");
  return canonical2 === normalized7 ? canonical2 : null;
}
function ipv4(value2) {
  if (typeof value2 !== "string" || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value2)) return null;
  return value2.split(".").every((part) => Number(part) <= 255) ? value2 : null;
}
function freshness(observedAt2, now) {
  if (!observedAt2) return "unknown";
  const ms = Date.parse(observedAt2);
  if (!Number.isFinite(ms) || ms > now) return "unknown";
  return now - ms <= LOCATION_FRESHNESS_MS ? "fresh" : "stale";
}
function verifyInhandIdentity(value2) {
  const account2 = unwrapInhandResponse(value2);
  if (account2._id !== INHAND_PILOT.accountId || account2.oid !== INHAND_PILOT.organizationId || account2.email !== INHAND_PILOT.accountEmail) fail14("identity_mismatch");
  if (account2.roleName !== INHAND_PILOT.observedRoleName || account2.isRoot !== false) fail14("role_mismatch");
}
function inhandPilotSnapshot(value2, now = /* @__PURE__ */ new Date()) {
  if (!Number.isFinite(now.getTime())) fail14("provider_response");
  const device = unwrapInhandResponse(value2);
  if (device._id !== INHAND_PILOT.deviceId || device.serialNumber !== INHAND_PILOT.serialNumber || device.oid !== INHAND_PILOT.organizationId) fail14("device_mismatch");
  const info = isRow(device.info) ? device.info : {};
  const wan = isRow(info.wan) ? info.wan : {};
  const infoUpdatedAt = readUnixSeconds(info.updatedAt, +now);
  let location = null;
  let locationUnavailableReason = "missing";
  if (isRow(device.location)) {
    const { latitude, longitude, source, time: time3 } = device.location;
    const observedAt2 = readUtcTimestamp(time3, +now);
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) locationUnavailableReason = "invalid_coordinates";
    else if (source !== "cellTower") locationUnavailableReason = "unverified_source";
    else if (!observedAt2) locationUnavailableReason = "invalid_timestamp";
    else {
      location = { latitude, longitude, source, observedAt: observedAt2, freshness: freshness(observedAt2, +now), accuracyM: null, address: cleanText(device.address, 512) };
      locationUnavailableReason = null;
    }
  }
  return {
    source: "inhand",
    version: 1,
    fetchedAt: now.toISOString(),
    identity: { deviceId: device._id, serialNumber: device.serialNumber, name: cleanText(device.name, 160) },
    connection: { reportedStatus: device.online === 1 ? "online" : device.online === 0 ? "offline" : "unknown", statusObservedAt: null, freshness: "unknown", independentlyProbed: false },
    network: { publicIp: ipv4(device.pubIp), wanIp: ipv4(wan.ip), infoUpdatedAt },
    location,
    locationUnavailableReason,
    providerTimes: { infoUpdatedAt, profileUpdatedAt: readUnixSeconds(device.updateTime, +now), logtime: readUtcTimestamp(device.logtime, +now) },
    mapping: { status: "not_mapped", cosUnitId: null }
  };
}
function createInhandPilotReader(options = {}) {
  const requestFetch = options.fetch || fetch;
  let attempted = false;
  return async (verifiedOwnerId) => {
    if (options.enabled !== true) fail14("disabled");
    if (options.contractReviewed !== true) fail14("review_required");
    if (attempted) fail14("already_attempted");
    attempted = true;
    const claimAttempt = options.claimAttempt;
    if (!claimAttempt) return fail14("claim_unavailable");
    let claimed = false;
    try {
      claimed = await claimAttempt(verifiedOwnerId);
    } catch {
      fail14("claim_unavailable");
    }
    if (claimed !== true) {
      attempted = false;
      fail14("claim_denied");
    }
    let token;
    try {
      token = options.getAccessToken?.();
    } catch {
      fail14("not_configured");
    }
    if (!token || token.length < 16 || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) fail14("not_configured");
    const accessToken = token;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const read = async (path) => {
      let response;
      try {
        response = await requestFetch(INHAND_PILOT.origin + path, {
          method: "GET",
          headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          signal: controller.signal
        });
      } catch {
        return fail14("provider_unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => {
        });
        return fail14("provider_auth");
      }
      if (response.status !== 200 || response.redirected || response.url && response.url !== INHAND_PILOT.origin + path) {
        void response.body?.cancel().catch(() => {
        });
        return fail14("provider_unavailable");
      }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("Content-Type") || "") || Number(response.headers.get("Content-Length")) > MAX_BODY_BYTES || !response.body) {
        void response.body?.cancel().catch(() => {
        });
        return fail14("provider_response");
      }
      const reader = response.body.getReader();
      let size = 0, body = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BODY_BYTES) {
            void reader.cancel().catch(() => {
            });
            return fail14("provider_response");
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } catch {
        return fail14("provider_response");
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(body);
      } catch {
        return fail14("provider_response");
      }
    };
    try {
      verifyInhandIdentity(await read("/api/users/this?verbose=100"));
      const snapshot = inhandPilotSnapshot(await read(`/api/devices/${INHAND_PILOT.deviceId}?verbose=100`), options.now?.() || /* @__PURE__ */ new Date());
      const containsCredential = (value2) => typeof value2 === "string" ? value2.includes(accessToken) : isRow(value2) ? Object.values(value2).some(containsCredential) : false;
      if (containsCredential(snapshot)) fail14("provider_response");
      return snapshot;
    } catch (error) {
      if (error instanceof InhandPilotError) throw error;
      return fail14("provider_unavailable");
    } finally {
      clearTimeout(timeout);
      controller.abort();
      token = void 0;
    }
  };
}
async function readPilotClaimBoolean(response, signal) {
  const length = response.headers.get("Content-Length");
  if (response.status !== 200 || response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get("Content-Type") || "") || !response.body || length !== null && (!/^\d+$/.test(length) || Number(length) > 16)) {
    void response.body?.cancel().catch(() => {
    });
    return fail14("claim_unavailable");
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  let result = "", size = 0;
  try {
    while (true) {
      if (signal.aborted) return fail14("claim_unavailable");
      const chunk = await reader.read();
      if (signal.aborted) return fail14("claim_unavailable");
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16) {
        void reader.cancel().catch(() => {
        });
        return fail14("claim_unavailable");
      }
      result += new TextDecoder("utf-8", { fatal: true }).decode(chunk.value);
    }
    if (!["true", "false"].includes(result.trim())) return fail14("claim_unavailable");
    return result.trim() === "true";
  } catch {
    return fail14("claim_unavailable");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

// tech-checks/supabase/functions/cos-operations-pages/vrm.ts
var heliosVrmUnits = [
  { number: 1, name: "HELIOS 001", installationId: 1022969 },
  { number: 2, name: "HELIOS 002", installationId: 1022961 },
  { number: 3, name: "HELIOS 003", installationId: 1018314 },
  { number: 4, name: "HELIOS 004", installationId: 1022780 },
  { number: 5, name: "HELIOS 005", installationId: 1023504 },
  { number: 6, name: "HELIOS 006", installationId: 1026733 },
  { number: 7, name: "HELIOS 007", installationId: 1027440 },
  { number: 8, name: "HELIOS 008", installationId: 1039531 },
  { number: 9, name: "HELIOS 009", installationId: 1039500 }
];
var VRM_MAX_INSTALLATIONS2 = 5e3;
var vrmPortalUrl2 = (id15) => "https://vrm.victronenergy.com/installation/" + id15 + "/dashboard";
var validInstallationId2 = (id15) => typeof id15 === "number" && Number.isSafeInteger(id15) && id15 > 0;
var validVrmName2 = (name) => typeof name === "string" && name.trim() === name && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
var validTime2 = (value2) => value2 === null || typeof value2 === "string" && value2.length <= 32 && Number.isFinite(Date.parse(value2));
var unconfiguredVrmSync2 = () => ({ state: "not_configured", lastAttemptAt: null, lastSuccessAt: null, nextSyncAt: null, error: null, scheduleActive: false, connectionConfigured: false });
function validVrmEmbed2(value2, id15) {
  if (typeof value2 !== "string" || value2.length > 2048 || !validInstallationId2(id15)) return false;
  try {
    const url = new URL(value2);
    return url.origin === "https://vrm.victronenergy.com" && !url.username && !url.password && !url.hash && new RegExp("^/installation/" + id15 + "/embed/[A-Za-z0-9_-]+/?$").test(url.pathname);
  } catch {
    return false;
  }
}
function vrmPortalConfig(raw, installations = heliosVrmUnits, sync = unconfiguredVrmSync2()) {
  const config = raw ? JSON.parse(raw) : {};
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("VRM dashboard configuration is unavailable.");
  const links = config;
  for (const [key2, link] of Object.entries(links)) {
    const id15 = Number(key2);
    if (!validInstallationId2(id15) || String(id15) !== key2 || link !== null && !validVrmEmbed2(link, id15)) throw new Error("VRM dashboard configuration is unavailable.");
  }
  const items = installations.map((unit) => ({
    ...unit,
    portalUrl: vrmPortalUrl2(unit.installationId),
    embedUrl: unit.available === false || unit.sharingEnabled === false ? null : typeof links[String(unit.installationId)] === "string" ? links[String(unit.installationId)] : null
  }));
  return readVrmFleetConfig2({ items, sync });
}
function readVrmFleetConfig2(value2) {
  const data = value2;
  if (!Array.isArray(data?.items) || data.items.length > VRM_MAX_INSTALLATIONS2) throw new Error("VRM returned an invalid installation list.");
  const seen = /* @__PURE__ */ new Set();
  const items = data.items.map((item) => {
    if (!item || !validInstallationId2(item.installationId) || seen.has(item.installationId) || !validVrmName2(item.name) || item.portalUrl !== vrmPortalUrl2(item.installationId) || item.embedUrl !== null && !validVrmEmbed2(item.embedUrl, item.installationId) || item.number !== void 0 && !validInstallationId2(item.number) || item.available !== void 0 && typeof item.available !== "boolean" || item.sharingEnabled !== void 0 && item.sharingEnabled !== null && typeof item.sharingEnabled !== "boolean" || item.lastSeenAt !== void 0 && !validTime2(item.lastSeenAt) || item.available === false && item.embedUrl !== null) throw new Error("VRM returned inconsistent installation links.");
    seen.add(item.installationId);
    return {
      installationId: item.installationId,
      name: item.name,
      portalUrl: item.portalUrl,
      embedUrl: item.embedUrl,
      ...item.sharingEnabled === void 0 ? {} : { sharingEnabled: item.sharingEnabled },
      ...item.number === void 0 ? {} : { number: item.number },
      ...item.available === void 0 ? {} : { available: item.available },
      ...item.lastSeenAt === void 0 ? {} : { lastSeenAt: item.lastSeenAt }
    };
  });
  const sync = data.sync ?? unconfiguredVrmSync2();
  if (!sync || !["not_configured", "idle", "syncing", "current", "stale", "error"].includes(sync.state) || ![sync.lastAttemptAt, sync.lastSuccessAt, sync.nextSyncAt].every(validTime2) || typeof sync.scheduleActive !== "boolean" || sync.connectionConfigured !== void 0 && typeof sync.connectionConfigured !== "boolean" || sync.error !== null && (typeof sync.error !== "string" || sync.error.length > 300)) throw new Error("VRM returned invalid sync status.");
  return { items, sync: {
    state: sync.state,
    lastAttemptAt: sync.lastAttemptAt,
    lastSuccessAt: sync.lastSuccessAt,
    nextSyncAt: sync.nextSyncAt,
    error: sync.error,
    scheduleActive: sync.scheduleActive,
    ...sync.connectionConfigured === void 0 ? {} : { connectionConfigured: sync.connectionConfigured }
  } };
}

// tech-checks/supabase/functions/cos-operations-pages/vrmSafePower.ts
var rules2 = { battery_soc: ["%", 0, 100], battery_voltage: ["V", 0, 200], battery_current: ["A", -1e4, 1e4], battery_power: ["W", -1e6, 1e6], solar_power: ["W", 0, 1e6], load_power: ["W", -1e6, 1e6], low_voltage_alarm: ["state", 0, 2], low_soc_alarm: ["state", 0, 2], high_voltage_alarm: ["state", 0, 2] };
function safeVrmPower2(value2, items, now = Date.now()) {
  if (!Array.isArray(value2) || value2.length > 1e3) throw Error("Power evidence unavailable");
  const seen = /* @__PURE__ */ new Set();
  return value2.flatMap((r) => {
    if (!r || !Number.isSafeInteger(r.installationId) || seen.has(r.installationId) || !Array.isArray(r.measurements) || r.measurements.length > 40) throw Error("Power evidence inconsistent");
    seen.add(r.installationId);
    if (items.filter((i) => i.installationId === r.installationId && i.name === r.name).length !== 1 || typeof r.name !== "string" || !/^HELIOS\s+\d{1,3}$/i.test(r.name)) return [];
    const measurements = r.measurements.map((m) => {
      const rule = rules2[m?.metric], time3 = Date.parse(m?.observedAt);
      if (!rule || m.unit !== rule[0] || typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < rule[1] || m.value > rule[2] || !Number.isFinite(time3) || time3 < Date.UTC(2e3, 0, 1) || time3 > now + 3e5 || !Number.isSafeInteger(m.instance) || m.instance < 0 || m.instance > 1e3 || !["system", "battery", "solarcharger"].includes(m.source)) throw Error("Power measurement invalid");
      return { metric: m.metric, value: m.value, unit: m.unit, observedAt: m.observedAt, instance: m.instance, source: m.source };
    });
    const error = r.errorCode;
    if (error !== null && !["access", "provider", "rate_limit", "invalid_response", "no_data"].includes(error)) throw Error("Power read state invalid");
    if (r.lastAttemptAt !== null && (typeof r.lastAttemptAt !== "string" || !Number.isFinite(Date.parse(r.lastAttemptAt)))) throw Error("Power read time invalid");
    return [{ installationId: r.installationId, name: r.name, measurements, lastAttemptAt: r.lastAttemptAt, errorCode: error }];
  });
}

// tech-checks/supabase/functions/cos-operations-pages/vrmPower.ts
var API4 = "https://vrmapi.victronenergy.com/v2";
var MAX_BYTES2 = 2 * 1024 * 1024;
var PAGE_SIZE2 = 500;
var MAX_PAGES = 4;
var metrics = {
  "/Dc/Battery/Soc": { metric: "battery_soc", unit: "%", min: 0, max: 100 },
  "/Soc": { metric: "battery_soc", unit: "%", min: 0, max: 100 },
  "/Dc/Battery/Voltage": { metric: "battery_voltage", unit: "V", min: 0, max: 200 },
  "/Dc/0/Voltage": { metric: "battery_voltage", unit: "V", min: 0, max: 200 },
  "/Dc/Battery/Current": { metric: "battery_current", unit: "A", min: -1e4, max: 1e4 },
  "/Dc/0/Current": { metric: "battery_current", unit: "A", min: -1e4, max: 1e4 },
  "/Dc/Battery/Power": { metric: "battery_power", unit: "W", min: -1e6, max: 1e6 },
  "/Dc/0/Power": { metric: "battery_power", unit: "W", min: -1e6, max: 1e6 },
  "/Dc/Pv/Power": { metric: "solar_power", unit: "W", min: 0, max: 1e6 },
  "/Yield/Power": { metric: "solar_power", unit: "W", min: 0, max: 1e6 },
  "/Dc/System/Power": { metric: "load_power", unit: "W", min: -1e6, max: 1e6 },
  "/Alarms/LowVoltage": { metric: "low_voltage_alarm", unit: "state", min: 0, max: 2 },
  "/Alarms/LowSoc": { metric: "low_soc_alarm", unit: "state", min: 0, max: 2 },
  "/Alarms/HighVoltage": { metric: "high_voltage_alarm", unit: "state", min: 0, max: 2 }
};
function parsePowerRecords(records2, installationId, now = Date.now()) {
  if (!Array.isArray(records2) || records2.length > PAGE_SIZE2 * MAX_PAGES) throw Error("invalid_response");
  const found = /* @__PURE__ */ new Map();
  for (const candidate of records2) {
    if (!candidate || typeof candidate !== "object") continue;
    const r = candidate;
    if (r.idSite !== installationId || !Number.isSafeInteger(r.instance) || Number(r.instance) < 0 || Number(r.instance) > 1e3) continue;
    const source = r.dbusServiceType;
    if (!["system", "battery", "solarcharger"].includes(String(source))) continue;
    const path = typeof r.dbusPath === "string" ? r.dbusPath : "", m = metrics[path];
    if (!m) continue;
    if (source === "system" && (!path.startsWith("/Dc/") && !path.startsWith("/Alarms/")) || source === "battery" && !(path === "/Soc" || path.startsWith("/Dc/0/") || path.startsWith("/Alarms/")) || source === "solarcharger" && path !== "/Yield/Power") continue;
    if (typeof r.rawValue !== "number" && typeof r.rawValue !== "string" || r.rawValue === "" || typeof r.rawValue === "string" && !/^-?\d+(?:\.\d+)?$/.test(r.rawValue)) continue;
    const value2 = Number(r.rawValue), stamp6 = Number(r.timestamp) * 1e3;
    if (!Number.isFinite(value2) || value2 < m.min || value2 > m.max || !Number.isFinite(stamp6) || stamp6 < Date.UTC(2e3, 0, 1) || stamp6 > now + 3e5) continue;
    const o = { metric: m.metric, value: value2, unit: m.unit, observedAt: new Date(stamp6).toISOString(), instance: Number(r.instance), source };
    const key2 = o.metric + "|" + o.source + "|" + o.instance, prior = found.get(key2);
    if (!prior || Date.parse(prior.observedAt) < stamp6) found.set(key2, o);
  }
  return [...found.values()].sort((a, b) => (a.metric + "|" + a.source + "|" + a.instance).localeCompare(b.metric + "|" + b.source + "|" + b.instance)).slice(0, 40);
}
async function diagnosticPage(id15, page2, token, fetcher) {
  const response = await fetcher(API4 + "/installations/" + id15 + "/diagnostics?count=" + PAGE_SIZE2 + "&page=" + page2, { method: "GET", headers: { "X-Authorization": "Token " + token, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8500) });
  if (response.status === 401 || response.status === 403) throw Error("access");
  if (response.status === 429) throw Error("rate_limit");
  if (!response.ok) throw Error("provider");
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES2) throw Error("invalid_response");
  const reader = response.body.getReader(), parts3 = [];
  let bytes = 0;
  try {
    for (; ; ) {
      const c = await reader.read();
      if (c.done) break;
      bytes += c.value.byteLength;
      if (bytes > MAX_BYTES2) {
        await reader.cancel();
        throw Error("invalid_response");
      }
      parts3.push(c.value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let pos = 0;
  for (const p of parts3) {
    buffer.set(p, pos);
    pos += p.byteLength;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw Error("invalid_response");
  }
  if (!data || data.success !== true) throw Error("invalid_response");
  const records2 = Array.isArray(data.records) ? data.records : data.records && typeof data.records === "object" && "idSite" in data.records ? [data.records] : null;
  if (!records2 || records2.length > PAGE_SIZE2 || !Number.isSafeInteger(data.num_records) || Number(data.num_records) < 0 || Number(data.num_records) > PAGE_SIZE2 * MAX_PAGES) throw Error("invalid_response");
  return { records: records2, total: Number(data.num_records) };
}
async function collectInstallationPower(id15, token, fetcher = fetch, now = Date.now()) {
  const checkedAt = new Date(now).toISOString();
  try {
    if (!Number.isSafeInteger(id15) || id15 < 1 || !token || token.length > 8192 || /[\r\n]/.test(token)) throw Error("access");
    const all = [];
    let total = 0;
    for (let page2 = 1; page2 <= MAX_PAGES; page2++) {
      const data = await diagnosticPage(id15, page2, token, fetcher);
      if (page2 === 1) total = data.total;
      else if (data.total !== total) throw Error("invalid_response");
      all.push(...data.records);
      if (all.length >= total) break;
      if (!data.records.length) throw Error("invalid_response");
    }
    if (all.length < total) throw Error("invalid_response");
    const observations = parsePowerRecords(all, id15, now);
    return { checkedAt, observations, errorCode: observations.length ? null : "no_data" };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return { checkedAt, observations: [], errorCode: ["access", "rate_limit", "invalid_response"].includes(code) ? code : "provider" };
  }
}
async function collectHeliosPower(items, token, fetcher = fetch, now = Date.now()) {
  const result = [], start = Date.now();
  let stop = false;
  if (items.filter((x) => /^HELIOS\s+\d{1,3}$/i.test(x.name)).length > 100) return items;
  for (const item of items) {
    if (!/^HELIOS\s+\d{1,3}$/i.test(item.name) || stop || Date.now() - start > 2e4) {
      result.push(item);
      continue;
    }
    const power = await collectInstallationPower(item.installationId, token, fetcher, now);
    result.push({ ...item, power });
    if (power.errorCode === "access" || power.errorCode === "rate_limit" || power.errorCode === "provider") stop = true;
    else if (items.indexOf(item) < items.length - 1) await new Promise((resolve2) => setTimeout(resolve2, 350));
  }
  return result;
}

// tech-checks/supabase/functions/cos-operations-pages/vrmDiscovery.ts
var API5 = "https://vrmapi.victronenergy.com/v2";
var RESPONSE_LIMIT = 2 * 1024 * 1024;
var VRM_SYNC_INTERVAL_MS = 15 * 60 * 1e3;
var messages = {
  access: "Victron access could not be verified. Check the saved API connection and account permissions.",
  rate_limit: "Victron is limiting requests. The last known fleet is retained until a later retry.",
  provider: "Victron could not be reached. The last known fleet is retained.",
  invalid_response: "Victron returned an incomplete installation list. The last known fleet is retained.",
  account_changed: "The API connection belongs to a different Victron account. Review the connection before syncing.",
  storage: "COS could not save the fleet refresh. The last known fleet is retained."
};
var VrmDiscoveryError = class extends Error {
  constructor(code, retryAfterSeconds = 60) {
    super(messages[code]);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  code;
  retryAfterSeconds;
};
var time2 = (v) => v === null || typeof v === "string" && Number.isFinite(Date.parse(v));
function readSnapshot(value2) {
  const s = value2;
  if (!s || !Array.isArray(s.items) || s.items.length > VRM_MAX_INSTALLATIONS2 || ![s.lastAttemptAt, s.lastSuccessAt, s.retryAfterAt].every(time2) || typeof s.syncing !== "boolean" || typeof s.scheduleActive !== "boolean" || s.errorCode !== null && !Object.hasOwn(messages, s.errorCode)) throw new VrmDiscoveryError("storage");
  vrmPortalConfig(void 0, s.items);
  return s;
}
async function providerJson(fetcher, path, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetcher(API5 + path, {
      method: "GET",
      headers: { "X-Authorization": "Token " + token, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) throw new VrmDiscoveryError("access");
    if (response.status === 429) {
      const delay = Number(response.headers.get("retry-after"));
      throw new VrmDiscoveryError("rate_limit", Number.isFinite(delay) && delay > 0 ? Math.max(30, Math.min(86400, Math.ceil(delay))) : 900);
    }
    if (!response.ok) throw new VrmDiscoveryError("provider");
    if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT || !response.body) throw new VrmDiscoveryError("invalid_response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text19 = "";
    let size = 0;
    try {
      for (; ; ) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > RESPONSE_LIMIT) {
          await reader.cancel();
          throw new VrmDiscoveryError("invalid_response");
        }
        text19 += decoder.decode(chunk.value, { stream: true });
      }
      text19 += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    let result;
    try {
      result = JSON.parse(text19);
    } catch {
      throw new VrmDiscoveryError("invalid_response");
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new VrmDiscoveryError("invalid_response");
    const data = result;
    if (data.success !== true) throw new VrmDiscoveryError(data.success === false ? "provider" : "invalid_response");
    if (["next", "nextPage", "next_page", "nextCursor", "next_cursor", "pagination", "hasMore", "has_more", "links"].some((key2) => data[key2] !== void 0 && data[key2] !== null && data[key2] !== false)) throw new VrmDiscoveryError("invalid_response");
    return data;
  } catch (error) {
    if (error instanceof VrmDiscoveryError) throw error;
    throw new VrmDiscoveryError("provider");
  } finally {
    clearTimeout(timer);
  }
}
async function discoverVrmInstallations(token, fetcher = fetch) {
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) throw new VrmDiscoveryError("access");
  const account2 = await providerJson(fetcher, "/users/me", token);
  const user = account2.user;
  if (!validInstallationId2(user?.id)) throw new VrmDiscoveryError("invalid_response");
  const result = await providerJson(fetcher, "/users/" + user.id + "/installations", token);
  if (!Array.isArray(result.records) || result.records.length > VRM_MAX_INSTALLATIONS2) throw new VrmDiscoveryError("invalid_response");
  if (result.total !== void 0 && result.total !== result.records.length || result.count !== void 0 && result.count !== result.records.length) throw new VrmDiscoveryError("invalid_response");
  const seen = /* @__PURE__ */ new Set();
  const items = result.records.map((row2) => {
    if (!row2 || !validInstallationId2(row2.idSite) || seen.has(row2.idSite) || !validVrmName2(row2.name)) throw new VrmDiscoveryError("invalid_response");
    seen.add(row2.idSite);
    return { installationId: row2.idSite, name: row2.name, ...typeof row2.shared === "boolean" ? { sharingEnabled: row2.shared } : {} };
  });
  return { userId: user.id, items };
}
function createVrmFleetReader(options) {
  const now = options.now || Date.now;
  const read = async () => readSnapshot(await options.rpc("cos_vrm_fleet_snapshot", {}));
  const present = async (snapshot, configured) => {
    const old = !snapshot.lastSuccessAt || now() - Date.parse(snapshot.lastSuccessAt) > 2 * VRM_SYNC_INTERVAL_MS;
    const sync = {
      state: !configured ? "not_configured" : snapshot.syncing ? "syncing" : snapshot.errorCode ? snapshot.lastSuccessAt ? "stale" : "error" : old ? snapshot.lastSuccessAt ? "stale" : "idle" : "current",
      lastAttemptAt: snapshot.lastAttemptAt,
      lastSuccessAt: snapshot.lastSuccessAt,
      error: snapshot.errorCode ? messages[snapshot.errorCode] : null,
      nextSyncAt: snapshot.scheduleActive && configured ? new Date(Math.ceil(Math.max(now() + 1, snapshot.retryAfterAt ? Date.parse(snapshot.retryAfterAt) : 0) / VRM_SYNC_INTERVAL_MS) * VRM_SYNC_INTERVAL_MS).toISOString() : null,
      scheduleActive: snapshot.scheduleActive,
      connectionConfigured: configured
    };
    const base2 = vrmPortalConfig(options.embeds, !snapshot.lastSuccessAt && !snapshot.items.length ? heliosVrmUnits : snapshot.items, sync);
    let fleet = base2;
    if (options.readDashboardEmbeds) {
      try {
        const approvals = await options.readDashboardEmbeds();
        if (!approvals || typeof approvals !== "object" || Array.isArray(approvals)) throw new Error("Invalid private dashboard approvals");
        const checked2 = vrmPortalConfig(JSON.stringify(approvals), base2.items, sync);
        const byId = new Map(checked2.items.filter((item) => item.embedUrl !== null).map((item) => [item.installationId, item.embedUrl]));
        fleet = readVrmFleetConfig2({ items: base2.items.map((item) => ({
          ...item,
          embedUrl: item.available === false || item.sharingEnabled === false ? null : byId.get(item.installationId) ?? item.embedUrl
        })), sync: base2.sync });
      } catch {
      }
    }
    return { ...fleet, ...snapshot.power === void 0 ? {} : { power: safeVrmPower2(snapshot.power, snapshot.items, now()) } };
  };
  return async (refresh = false) => {
    const token = options.getAccessToken();
    const configured = typeof token === "string" && token.trim().length > 0;
    if (!refresh || !configured) return present(await read(), configured);
    const lease = await options.rpc("cos_vrm_fleet_begin", {});
    if (lease?.leaseId === null) return present(await read(), configured);
    if (!lease || typeof lease.leaseId !== "string" || !/^[0-9a-f-]{36}$/i.test(lease.leaseId)) throw new VrmDiscoveryError("storage");
    try {
      const result = await discoverVrmInstallations(token, options.fetch);
      const saved = await options.rpc("cos_vrm_fleet_finish", { p_lease_id: lease.leaseId, p_user_id: result.userId, p_items: options.collectPower ? await collectHeliosPower(result.items, token, options.fetch, now()) : result.items });
      if (saved !== true) throw new VrmDiscoveryError(saved === "account_changed" ? "account_changed" : "storage");
    } catch (error) {
      const safe6 = error instanceof VrmDiscoveryError ? error : new VrmDiscoveryError("storage");
      await options.rpc("cos_vrm_fleet_fail", { p_lease_id: lease.leaseId, p_error_code: safe6.code, p_retry_seconds: safe6.retryAfterSeconds });
    }
    return present(await read(), configured);
  };
}

// tech-checks/supabase/functions/cos-operations-pages/privateEvidence.ts
var UUID6 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var MAX_EVIDENCE_BYTES2 = 4 * 1024 * 1024;
var RASTER = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
var PrivateEvidenceError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = "PrivateEvidenceError";
  }
  statusCode;
};
var fail15 = (message, status2) => {
  throw new PrivateEvidenceError(message, status2);
};
var unavailable = () => fail15("Evidence preview is unavailable. Please retry.", 503);
var notFound = () => fail15("Evidence file is unavailable for this account. The record is preserved.", 404);
function uuid26(value2) {
  if (typeof value2 !== "string" || !UUID6.test(value2.toLowerCase())) notFound();
  return value2.toLowerCase();
}
function records(value2) {
  if (!Array.isArray(value2) || value2.some((row2) => !row2 || typeof row2 !== "object" || Array.isArray(row2))) unavailable();
  return value2;
}
function single(value2) {
  const rows4 = records(value2);
  if (rows4.length !== 1) notFound();
  return rows4[0];
}
function mime(value2) {
  return typeof value2 === "string" ? value2.split(";")[0].trim().toLowerCase() : "";
}
function imageType(bytes) {
  const starts = (prefix) => prefix.every((byte, index2) => bytes[index2] === byte);
  if (bytes.length >= 8 && starts([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (bytes.length >= 3 && starts([255, 216, 255])) return "image/jpeg";
  if (bytes.length >= 12 && starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((byte, index2) => bytes[index2 + 8] === byte)) return "image/webp";
  if (bytes.length >= 6 && (starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]))) return "image/gif";
  return "";
}
async function limitedBytes(response, signal) {
  const header = response.headers.get("content-length");
  if (header !== null && (!/^\d+$/.test(header) || Number(header) > MAX_EVIDENCE_BYTES2)) {
    await response.body?.cancel();
    fail15("This file is too large for the private preview (4 MiB maximum). The record is preserved.", 413);
  }
  if (!response.body) unavailable();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => void 0);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) unavailable();
      const result = await reader.read();
      if (signal.aborted) unavailable();
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_EVIDENCE_BYTES2) {
        await reader.cancel();
        fail15("This file is too large for the private preview (4 MiB maximum). The record is preserved.", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (!size || header !== null && Number(header) !== size) unavailable();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
function createPrivateEvidenceReader(options) {
  const organizationId2 = uuid26(options.organizationId);
  return async (verifiedOwnerId, evidenceId) => {
    const actorId = uuid26(verifiedOwnerId), id15 = uuid26(evidenceId);
    try {
      const profile = single(await options.read("user_profiles?select=user_id,organization_id,active,department&user_id=eq." + actorId + "&organization_id=eq." + organizationId2 + "&limit=2"));
      if (profile.user_id !== actorId || profile.organization_id !== organizationId2 || profile.active !== true || profile.department !== "owner") {
        fail15("Your existing Owner access is no longer active.", 403);
      }
      const role = single(await options.read("roles?select=id,organization_id,code&organization_id=eq." + organizationId2 + "&code=eq.owner&limit=2"));
      const roleId = uuid26(role.id);
      if (role.organization_id !== organizationId2 || role.code !== "owner") fail15("Owner access is required.", 403);
      const link = single(await options.read("user_roles?select=user_id,role_id&user_id=eq." + actorId + "&role_id=eq." + roleId + "&limit=2"));
      if (link.user_id !== actorId || link.role_id !== roleId) fail15("Owner access is required.", 403);
      const permission = single(await options.read("role_permissions?select=role_id,permission_code&role_id=eq." + roleId + "&permission_code=eq.job.view_all&limit=2"));
      if (permission.role_id !== roleId || permission.permission_code !== "job.view_all") fail15("Job viewing permission is required.", 403);
      const document = single(await options.read("documents?select=id,organization_id,job_id,document_type,storage_bucket,storage_path,content_type&id=eq." + id15 + "&organization_id=eq." + organizationId2 + "&limit=2"));
      if (document.id !== id15 || document.organization_id !== organizationId2) notFound();
      const jobId = uuid26(document.job_id);
      const job = single(await options.read("jobs?select=id,organization_id&id=eq." + jobId + "&organization_id=eq." + organizationId2 + "&limit=2"));
      if (job.id !== jobId || job.organization_id !== organizationId2) notFound();
      const isPhoto = document.document_type === "workflow_photo";
      const isSignature = ["technician_signature", "customer_signature"].includes(String(document.document_type));
      const bucket = isPhoto ? "job-photos" : isSignature ? "signatures" : "";
      if (!bucket || document.storage_bucket !== bucket) notFound();
      const path = document.storage_path;
      if (typeof path !== "string" || path.length > 1024 || !/^[a-zA-Z0-9._/-]+$/.test(path)) notFound();
      const parts3 = path.split("/");
      if (parts3.length < 3 || parts3.some((part) => !part || part === "." || part === "..") || parts3[0] !== organizationId2 || parts3[1] !== jobId) notFound();
      const contentType = mime(document.content_type);
      if (!RASTER.has(contentType) || isSignature && contentType === "image/gif") {
        fail15("This file format is not supported by the private image preview. The record is preserved.", 415);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15e3);
      try {
        const response = await options.readObject(bucket, path, controller.signal);
        if ([400, 404].includes(response.status)) {
          await response.body?.cancel();
          notFound();
        }
        if (response.status !== 200 || response.redirected) {
          await response.body?.cancel();
          unavailable();
        }
        if (mime(response.headers.get("content-type")) !== contentType) {
          await response.body?.cancel();
          fail15("The stored file type could not be verified. The record is preserved.", 415);
        }
        const bytes = await limitedBytes(response, controller.signal);
        if (imageType(bytes) !== contentType) fail15("The stored file type could not be verified. The record is preserved.", 415);
        return { documentId: id15, contentType, content: base64(bytes), byteLength: bytes.length };
      } finally {
        clearTimeout(timeout);
      }
    } catch (cause) {
      if (cause instanceof PrivateEvidenceError) throw cause;
      return unavailable();
    }
  };
}

// tech-checks/supabase/functions/cos-operations-pages/index.ts
var LEGACY_URL = "https://goqrnolcvqnirjmzaeyk.supabase.co";
var LEGACY_PUBLISHABLE_KEY = "sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw";
var ORGANIZATION_ID = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var OWNER_LINKS = Object.freeze({
  "e4abc521-1ef3-45a6-9829-b87faff78210": "3f073784-96e7-43d8-b9e0-33ab31c3c8b1"
});
var TECHNICIAN_LINKS = Object.freeze({
  "4f7044b5-86b6-411f-8898-39bb64b4ddbc": { actorId: "d0757b64-9623-4adc-afff-21cc7853e88a", name: "Teddy Hopper", department: "it", roleCode: "it_technician" },
  "b7cc3cbf-d11e-4d4a-9742-c07701857911": { actorId: "3caf7c00-627f-445f-bce4-ddeae574ee5c", name: "Victor Garcia", department: "it", roleCode: "it_technician" },
  "05bf20fe-19f7-4db7-ac05-5b2a5f681fdf": { actorId: "c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7", name: "Test IT", department: "it", roleCode: "it_technician" },
  "78e54fbd-c2db-4d18-8e3d-a9740adcf285": { actorId: "7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8", name: "Abel Cervantes", department: "service", roleCode: "service_technician" },
  "49dce28e-099a-40bb-a8d8-b39f9ffbabee": { actorId: "1a7d3523-8a3c-488a-9216-4e37f4f7ecb9", name: "Josh Mireles", department: "service", roleCode: "service_technician" }
});
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://cypressriveroasis2023-sudo.github.io",
  "https://cos-vision-integration-preview.pages.dev"
]);
var UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HttpError = class extends Error {
  constructor(message, status2 = 400) {
    super(message);
    this.status = status2;
  }
};
var fail16 = (message, status2 = 400) => {
  throw new HttpError(message, status2);
};
function textValue(value2, label3, required = false, max = 4e3) {
  if (value2 == null && !required) return null;
  if (typeof value2 !== "string") fail16(label3 + " must be text.");
  const result = value2.trim();
  if (required && !result) fail16(label3 + " is required.");
  if (result.length > max) fail16(label3 + " is too long.");
  return result || null;
}
function allowedFields(body, fields4, label3 = "Request") {
  const allowed = new Set(fields4);
  if (Object.keys(body).some((key2) => !allowed.has(key2))) fail16(label3 + " contains unsupported fields.");
}
function enumValue(value2, label3, allowed, fallback) {
  const result = textValue(value2, label3) || fallback;
  if (!allowed.includes(result)) fail16("Choose a valid " + label3.toLowerCase() + ".");
  return result;
}
function idValue(value2, label3, required = true) {
  if (!required && (value2 == null || value2 === "")) return null;
  if (typeof value2 !== "string" || !UUID7.test(value2)) fail16(label3 + " must be a valid identifier.");
  return value2.toLowerCase();
}
function localTime(value2) {
  if (typeof value2 !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value2.trim());
  if (!match) return null;
  const [, yy, mm, dd, hh, mi] = match;
  const y = Number(yy), m = Number(mm), d = Number(dd), h = Number(hh), i = Number(mi);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || i > 59) return null;
  return yy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
}
function schedule(body, optional = false) {
  const absent = (v) => v == null || typeof v === "string" && !v.trim();
  if (optional && absent(body.start) && absent(body.end)) return { start: null, end: null };
  const start = localTime(body.start), end = localTime(body.end);
  if (!start || !end) fail16("Enter valid start and end dates in YYYY-MM-DD HH:MM format.");
  if (end <= start) fail16("End time must be after start time.");
  return { start, end };
}
async function requestBody(request) {
  return readMhelpAwareJson(request, 65536);
}
function gps(body) {
  const allowed = /* @__PURE__ */ new Set(["latitude", "longitude", "accuracyM", "source", "note"]);
  if (Object.keys(body).some((k) => !allowed.has(k))) fail16("GPS request contains unsupported fields.");
  const finite = (v, label3) => {
    if (typeof v !== "number" || !Number.isFinite(v)) fail16(label3 + " is required and must be a finite number.");
    return v;
  };
  const latitude = finite(body.latitude, "Latitude"), longitude = finite(body.longitude, "Longitude");
  if (latitude < -90 || latitude > 90) fail16("Latitude must be between -90 and 90.");
  if (longitude < -180 || longitude > 180) fail16("Longitude must be between -180 and 180.");
  const accuracyM = body.accuracyM == null ? null : finite(body.accuracyM, "GPS accuracy");
  if (accuracyM !== null && accuracyM < 0) fail16("GPS accuracy must be zero or greater.");
  const source = (textValue(body.source, "GPS source") || "manual").toLowerCase();
  if (!["manual", "device_gps", "phone_gps", "site", "router", "import"].includes(source)) fail16("Unsupported GPS source.");
  return { latitude, longitude, accuracyM, source, note: textValue(body.note, "GPS note") };
}
function createOperationsHandler(options) {
  const requestFetch = options.fetch || fetch;
  const serviceKey = options.serviceKey;
  const platformUrl = options.platformUrl;
  const readJson = async (url, init, fallback) => {
    let response;
    try {
      response = await requestFetch(url, init);
    } catch {
      fail16(fallback, 503);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      if (/\/rest\/v1\/rpc\/cos_unit_tracker_/.test(url)) {
        if (data.code === "42501") fail16("An active COS Owner or verified IT account is required.", 403);
        if (["55000", "PGRST202", "42883"].includes(data.code)) fail16("Pending tracker requests are not enabled on this backend. Sheets connection required.", 503);
        if (data.code === "23505") fail16("This exact unit already has a pending tracker request. Refresh to review it.", 409);
        if (["55P03", "40001", "40P01"].includes(data.code)) fail16(typeof data.message === "string" ? data.message : "A tracker request or source changed. Reload before saving.", 409);
        if (data.code === "22023") fail16(typeof data.message === "string" ? data.message : "Invalid tracker request.", 400);
      }
      if (url.endsWith("/rest/v1/rpc/appdeploy_request_delivery_go_back") && ["55P03", "40001", "40P01"].includes(data.code)) fail16("This delivery is being updated. Refresh the job before trying again.", 409);
      if (url.endsWith("/rest/v1/rpc/appdeploy_mhelp_import") && data.code === "40001") fail16(typeof data.message === "string" ? data.message : "Another mHelpDesk import is in progress. Review import history before retrying.", 409);
      if (response.status >= 500) fail16(fallback, 503);
      const message = typeof data.message === "string" ? data.message : fallback;
      fail16(message, response.status === 401 || response.status === 403 ? response.status : 409);
    }
    return data;
  };
  const platformHeaders = () => ({
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
    "Content-Type": "application/json"
  });
  const platformRead = (path, signal = void 0) => readJson(platformUrl + "/rest/v1/" + path, {
    headers: platformHeaders(),
    ...signal ? { signal } : {}
  }, "COS production data is unavailable. Please retry.");
  const readPrivateOwnerEvidence = createPrivateEvidenceReader({
    organizationId: ORGANIZATION_ID,
    read: platformRead,
    readObject: (bucket, path, signal) => requestFetch(platformUrl + "/storage/v1/object/authenticated/" + bucket + "/" + path.split("/").map(encodeURIComponent).join("/"), {
      headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
      redirect: "error",
      cache: "no-store",
      signal
    })
  });
  const platformAll = async (path, signal = void 0) => {
    const items = [];
    for (let offset = 0; offset < 1e5; offset += 1e3) {
      const page2 = await platformRead(path + "&limit=1000&offset=" + offset, signal);
      if (!Array.isArray(page2)) fail16("COS production returned an invalid collection.", 503);
      items.push(...page2);
      if (page2.length < 1e3) return items;
    }
    fail16("COS production collection exceeds the supported page limit.", 503);
  };
  const rpc = (name, payload, signal = void 0) => readJson(platformUrl + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: platformHeaders(),
    body: JSON.stringify(payload),
    ...signal ? { signal } : {}
  }, "COS workflow could not be completed. Please retry.");
  const readMhelpPlacements = async (actorPayload, signal = void 0) => {
    if (options.mhelpPlacementEnabled !== true) return null;
    const receipt2 = await rpc("cos_mhelp_placement_snapshot", actorPayload, signal);
    try {
      return { ...receipt2, fleetLocations: await rpc("cos_mhelp_location_snapshot", actorPayload, signal) };
    } catch {
      return receipt2;
    }
  };
  const readMhelpCameraPlacements = async (actorPayload, signal = void 0) => {
    if (options.mhelpPlacementEnabled !== true) return null;
    const receipt2 = await rpc("cos_mhelp_placement_snapshot", { ...actorPayload, p_projection: "camera" }, signal);
    if (!receipt2 || typeof receipt2 !== "object" || Array.isArray(receipt2)) throw Error("Invalid placement receipt");
    return receipt2;
  };
  const readVrmFleet = options.vrm ? createVrmFleetReader({ fetch: requestFetch, rpc, embeds: options.vrmEmbeds, getAccessToken: options.vrm.getAccessToken, readDashboardEmbeds: () => rpc("cos_vrm_dashboard_embeds", {}) }) : null;
  const mhelpImport = createMhelpImportHandler({ rpc, organizationId: ORGANIZATION_ID });
  const sheetsConnection = createSheetsConnection({ fetch: requestFetch, getServiceAccountJson: options.googleSheets?.getServiceAccountJson || (() => void 0), signAssertion: options.googleSheets?.signAssertion });
  const mhelpPartner = createMhelpPartnerHandler({
    fetch: requestFetch,
    getConfig: options.mhelpPartner?.getConfig || (() => ({})),
    renewAccess: options.mhelpPartner?.renewAccess,
    readNativeUnits: () => platformAll("equipment_units?select=id,unit_number,metadata&organization_id=eq." + ORGANIZATION_ID + "&order=id.asc")
  });
  const readMhelpIntakeReview = createMhelpIntakeReviewBridge(requestFetch);
  const mhelpTickets = createMhelpTicketReader({ fetch: requestFetch, getConfig: options.mhelpPartner?.getConfig || (() => ({})), renewAccess: options.mhelpPartner?.renewAccess });
  const mhelpUnitLocation = createMhelpUnitLocationReader({ fetch: requestFetch, getConfig: options.mhelpPartner?.getConfig || (() => ({})), renewAccess: options.mhelpPartner?.renewAccess });
  const readInhandPilot = createInhandPilotReader({
    ...options.inhandPilot,
    fetch: requestFetch,
    claimAttempt: async (actorId) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5e3);
      const attemptId = crypto.randomUUID();
      const payload = { p_actor_user_id: actorId, p_attempt_id: attemptId };
      const control = async (name) => readPilotClaimBoolean(await requestFetch(platformUrl + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { ...platformHeaders(), Prefer: "tx=commit" },
        body: JSON.stringify(payload),
        redirect: "error",
        cache: "no-store",
        signal: controller.signal
      }), controller.signal);
      try {
        if (!await control("cos_claim_inhand_pilot")) return false;
        if (!await control("cos_verify_inhand_pilot_claim")) throw new Error("Pilot claim not durable.");
        return true;
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }
  });
  const authenticate = async (request) => {
    const authorization = request.headers.get("Authorization") || "";
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) fail16("Sign in to Tech Check to continue.", 401);
    const headers = { apikey: LEGACY_PUBLISHABLE_KEY, Authorization: authorization, Accept: "application/json" };
    let user;
    try {
      user = await readJson(LEGACY_URL + "/auth/v1/user", { headers }, "Your sign-in could not be verified.");
    } catch (cause) {
      if (cause.status === 503) throw cause;
      fail16("Your sign-in has expired. Sign in again.", 401);
    }
    if (!user || typeof user.id !== "string" || !UUID7.test(user.id)) fail16("A verified Tech Check account is required.", 401);
    const profiles = await readJson(LEGACY_URL + "/rest/v1/profiles?select=user_id,full_name,role,active,archived_at&user_id=eq." + user.id + "&limit=1", { headers }, "Tech Check account access could not be verified.");
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || profile.user_id !== user.id || !["owner", "it", "service"].includes(profile.role) || profile.active !== true || profile.archived_at) fail16("An active COS account is required.", 403);
    const technicianLink = TECHNICIAN_LINKS[user.id.toLowerCase()];
    const legacyOwner = profile.role === "owner";
    const link = legacyOwner ? null : technicianLink;
    const actorId = legacyOwner ? OWNER_LINKS[user.id.toLowerCase()] : link?.actorId;
    const context = { legacyId: user.id, name: profile.full_name || (legacyOwner ? "Owner" : "Technician"), department: profile.role, legacyOwner, authorization, headers, actorId };
    if (!actorId) return context;
    if (link && (profile.role !== link.department || String(profile.full_name || "").trim().toLowerCase() !== link.name.toLowerCase())) fail16("Your linked technician identity details have changed. Ask an Owner to review the link.", 403);
    if (!serviceKey || !platformUrl) fail16("The COS production connection is not configured.", 503);
    const actors = await platformRead("user_profiles?select=user_id,display_name,active,department&organization_id=eq." + ORGANIZATION_ID + "&user_id=eq." + actorId + "&limit=1");
    const actor = Array.isArray(actors) ? actors[0] : null;
    const expectedDepartment = legacyOwner ? "owner" : link.department;
    if (!actor || actor.user_id !== actorId || actor.active !== true || actor.department !== expectedDepartment) fail16("Your linked COS production account is inactive or has a different department.", 403);
    if (link && String(actor.display_name || "").trim().toLowerCase() !== link.name.toLowerCase()) fail16("Your linked production technician identity details have changed.", 403);
    const roleCode = legacyOwner ? "owner" : link.roleCode;
    const roles = await platformRead("user_roles?select=role_id,roles!inner(code,organization_id)&user_id=eq." + actorId + "&roles.organization_id=eq." + ORGANIZATION_ID + "&roles.code=eq." + roleCode + "&limit=1");
    if (!Array.isArray(roles) || !roles.some((row2) => row2.roles?.code === roleCode && row2.roles?.organization_id === ORGANIZATION_ID)) fail16("Your linked COS production role is not active.", 403);
    return { ...context, ownerRoleId: legacyOwner ? roles.find((row2) => row2.roles?.code === "owner" && row2.roles?.organization_id === ORGANIZATION_ID)?.role_id : null };
  };
  const fleetPlacementAudits = async (context, signal = void 0) => {
    const rows4 = [];
    let cursor = null;
    for (let page2 = 0; page2 < 200; page2++) {
      const result = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_fleet_placement_evidence_v1", {
        method: "POST",
        headers: { ...context.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ p_before_id: cursor, p_limit: 500 }),
        ...signal ? { signal } : {}
      }, "Fleet placement evidence is unavailable.");
      if (!Array.isArray(result) || result.length > 500) fail16("Fleet placement page is invalid.", 503);
      let previous = cursor;
      for (const row2 of result) {
        const id15 = String(row2?.id || "");
        if (!/^[1-9][0-9]{0,18}$/.test(id15) || BigInt(id15) > 9223372036854775807n || previous !== null && BigInt(id15) >= BigInt(previous)) fail16("Fleet placement page order is invalid.", 503);
        previous = id15;
      }
      rows4.push(...result);
      if (result.length < 500) return rows4;
      cursor = previous;
    }
    fail16("Fleet placement evidence exceeds the safe page limit.", 503);
  };
  const assertRecord = async (table, id15, fields4 = "id") => {
    const records2 = await platformRead(table + "?select=" + fields4 + "&organization_id=eq." + ORGANIZATION_ID + "&id=eq." + id15 + "&limit=1");
    if (!Array.isArray(records2) || !records2.length) fail16("COS record not found.", 404);
    return records2[0];
  };
  const legacyAll = async (path, headers, signal = void 0) => {
    const items = [];
    for (let offset = 0; offset < 1e5; offset += 1e3) {
      const rows4 = await readJson(LEGACY_URL + "/rest/v1/" + path + "&limit=1000&offset=" + offset, { headers, ...signal ? { signal } : {} }, "Camera Health could not be loaded.");
      if (!Array.isArray(rows4)) fail16("Camera Health returned an invalid collection.", 503);
      items.push(...rows4);
      if (rows4.length < 1e3) return items;
    }
    fail16("Camera Health collection exceeds the supported page limit.", 503);
  };
  const readIdentitySources = async (context, reviewKey = null, signal = void 0) => {
    const actorPayload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
    const crosswalk = await rpc("cos_owner_identity_snapshot", actorPayload, signal);
    validateOwnerIdentitySnapshot(crosswalk);
    const keys3 = [.../* @__PURE__ */ new Set([...crosswalk.claims.map((c) => c.legacy_unit_key), ...reviewKey ? [reviewKey] : []])].sort();
    const readEpochs = async () => {
      if (!keys3.length) return [];
      return readJson(LEGACY_URL + "/rest/v1/rpc/cos_camera_identity_epochs_v1", {
        method: "POST",
        headers: { ...context.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ p_unit_keys: keys3 }),
        ...signal ? { signal } : {}
      }, "Camera identity incarnations are unavailable.");
    };
    const before = await readEpochs();
    const [devices, units, matches2, providers, audits] = await Promise.all([
      legacyAll("camera_devices?select=id,external_device_id,device_serial,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,source_status,source_last_seen_at,last_online_at,last_probe_online_at,activation_state,recon_battery_percent:source_metadata->battery_percent,recon_battery_updated_at:source_metadata->>battery_updated_at,recon_battery_status:source_metadata->>battery_status,recon_battery_status_updated_at:source_metadata->>battery_status_updated_at&order=id.asc", context.headers, signal),
      platformAll("equipment_units?select=id,organization_id,unit_number,status&organization_id=eq." + ORGANIZATION_ID + "&order=id.asc", signal),
      platformAll("vision_vigilant_unit_matches?select=id,organization_id,equipment_unit_id,vigilant_device_id,camera_key,match_method,confidence&organization_id=eq." + ORGANIZATION_ID + "&order=id.asc", signal),
      platformAll("vision_vigilant_devices?select=id,organization_id,external_device_id,device_name,device_type,source&organization_id=eq." + ORGANIZATION_ID + "&order=id.asc", signal),
      fleetPlacementAudits(context, signal)
    ]);
    const [after, current] = await Promise.all([readEpochs(), rpc("cos_owner_identity_snapshot", actorPayload, signal)]);
    validateOwnerIdentitySnapshot(current);
    if (crosswalk.revision !== current.revision) fail16("Owner identity commitments changed while loading. Reload.", 409);
    const epochs = JSON.stringify(before) === JSON.stringify(after) ? after : [];
    const sources = { units, matches: matches2, providers, devices, audits, ownerCrosswalk: crosswalk, ownerEpochs: epochs };
    return { sources, identity: await verifiedHealthIdentities(sources), reviewSources: { units, matches: matches2, providers, devices, epochs, crosswalk } };
  };
  const readOwnerCensusTarget = async (context, key2, id15, signal = void 0) => {
    const bounded = async (url, init) => readOwnerCensusJson(await requestFetch(url, { ...init, redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1e4)]) : AbortSignal.timeout(1e4) }));
    const history = await bounded(platformUrl + "/rest/v1/rpc/appdeploy_unit_location_history", {
      method: "POST",
      headers: platformHeaders(),
      body: JSON.stringify({ p_actor_user_id: context.actorId, p_unit_id: id15 })
    });
    const native = await bounded(platformUrl + "/rest/v1/equipment_units?select=" + OWNER_CENSUS_NATIVE_FIELDS.join(",") + "&organization_id=eq." + ORGANIZATION_ID + "&id=eq." + id15 + "&limit=2", { headers: platformHeaders() });
    if (!Array.isArray(native) || native.length !== 1) throw Error("Exact native authority unavailable");
    let site = null;
    if (native[0].installed_site_id !== null) {
      const siteId = idValue(native[0].installed_site_id, "Installed site");
      const sites = await bounded(platformUrl + "/rest/v1/sites?select=" + OWNER_CENSUS_SITE_FIELDS.join(",") + "&organization_id=eq." + ORGANIZATION_ID + "&id=eq." + siteId + "&limit=2", { headers: platformHeaders() });
      if (!Array.isArray(sites) || sites.length !== 1) throw Error("Exact native site unavailable");
      site = sites[0];
    }
    if (typeof key2 !== "string") throw Error("Exact camera epoch unavailable");
    const epochs = await bounded(LEGACY_URL + "/rest/v1/rpc/cos_camera_identity_epochs_v1", {
      method: "POST",
      headers: { ...context.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_unit_keys: [key2] })
    });
    return { native: native[0], history, epochs, site };
  };
  const readOwnerCensusEnvelope = async (context, nativeId, binding, requestSignal, prepare, deadlineMs) => {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) fail16("Current Owner source proof deadline elapsed.", 503);
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(remaining)]);
    const checkDeadline = () => {
      if (signal.aborted || Date.now() >= deadlineMs) fail16("Current Owner source proof deadline elapsed.", 503);
    };
    const actorPayload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
    const readArchives = async () => {
      const rows4 = await rpc("cos_archived_representation_projection", { p_organization_id: ORGANIZATION_ID }, signal);
      if (!Array.isArray(rows4) || rows4.length > 50) fail16("Current archive evidence is unavailable.", 503);
      return rows4;
    };
    const readSources = async (snapshot, archives2) => {
      const ids = /* @__PURE__ */ new Set([nativeId, ...archives2.flatMap((a) => [a.archivedNativeId, a.canonicalNativeId, a.archivedTrackerId, a.canonicalTrackerId])]);
      const identities = snapshot.inventoryItems.filter((r) => ids.has(r.id)).map((r) => ({ entityKind: r.readOnly === true ? "tracker" : "equipment_unit", nativeUnitId: r.id }));
      const rows4 = [];
      for (let offset = 0; offset < identities.length; offset += 250) {
        const batch = identities.slice(offset, offset + 250), page2 = await rpc("cos_geocode_sources_map_projection", { p_organization_id: ORGANIZATION_ID, p_identities: batch }, signal);
        if (!Array.isArray(page2) || page2.length > batch.length) fail16("Current target source evidence is unavailable.", 503);
        rows4.push(...page2);
      }
      return rows4;
    };
    const readPrecedence = async (sources2) => {
      const bindings = (await Promise.all(sources2.filter((s) => s?.sourcePrecedence !== void 0).map(checkedImportedBinding2))).filter(Boolean);
      if (!bindings.length) return [];
      const confirmed = [];
      for (let offset = 0; offset < bindings.length; offset += 250) {
        const batch = bindings.slice(offset, offset + 250), rows4 = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_imported_precedence_read_current", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_bindings: batch }), signal }, "Reviewed source precedence is unavailable.");
        if (!Array.isArray(rows4) || rows4.length > batch.length) fail16("Reviewed source precedence is unavailable.", 503);
        confirmed.push(...(await Promise.all(rows4.map(checkedImportedBinding2))).filter(Boolean));
      }
      return confirmed;
    };
    const [initialSnapshot, initialBundle, initialArchives, records2] = await Promise.all([
      rpc("appdeploy_field_map_snapshot", actorPayload, signal),
      readIdentitySources(context, null, signal),
      readArchives(),
      readJson(LEGACY_URL + "/rest/v1/rpc/cos_field_geocode_read_many", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_audit_ids: [binding.auditId] }), signal }, "Saved target lookup is unavailable.")
    ]);
    checkDeadline();
    if (!Array.isArray(records2) || records2.length !== 1) fail16("The enrolled Owner lookup is unavailable.", 409);
    const record5 = records2[0];
    if (record5?.auditId !== binding.auditId || record5.unitKey !== binding.unitKey || record5.addressSha256 !== binding.addressSha256) fail16("The exact Owner lookup binding changed.", 409);
    if (prepare) {
      const marker = record5.censusPreparation;
      if (record5.status !== "invalid_address" || record5.censusOnly === true || Object.hasOwn(record5, "censusOnlyGuard") || Object.hasOwn(record5, "censusOnlyState") || !marker || typeof marker !== "object" || Array.isArray(marker) || Object.keys(marker).length !== 1 || marker.nativeUnitId !== nativeId) fail16("Current Owner preparation authorization is unavailable.", 409);
    } else if (record5.censusOnly !== true || !["draining", "ready", "consumed"].includes(record5.censusOnlyState) || record5.censusOnlyGuard?.nativeUnitId !== nativeId || record5.censusOnlyGuard?.nativeGuardSha256 !== binding.nativeGuardSha256) fail16("The enrolled Owner lookup binding changed.", 409);
    const initialSources = await readSources(initialSnapshot, initialArchives);
    const initialContext = { nativeUnits: initialBundle.sources.units, identity: initialBundle.identity, archivedRepresentations: initialArchives, confirmedPrecedenceBindings: await readPrecedence(initialSources) };
    const initial = await projectOwnerPlacement(await projectImportedSourceAddresses(initialSnapshot, initialSources, initialBundle.sources.audits, initialBundle.sources.devices, [], initialContext), initialBundle.sources.audits, initialBundle.sources.devices, initialBundle.identity, initialBundle.sources.units);
    if (!initial.items.some((r) => r.id === nativeId && r.placementSource === "owner" && r.placementAuditId === binding.auditId)) fail16("Current Owner placement is unavailable.", 409);
    const [rawSnapshot, bundle, archives, mhelpReceipt] = await Promise.all([rpc("appdeploy_field_map_snapshot", actorPayload, signal), readIdentitySources(context, null, signal), readArchives(), readMhelpPlacements(actorPayload, signal)]);
    const sources = await readSources(rawSnapshot, [...initialArchives, ...archives]);
    const archiveContext = { nativeUnits: bundle.sources.units, identity: bundle.identity, archivedRepresentations: archives, previousArchivedRepresentations: initialArchives };
    const sourceContext = { ...archiveContext, currentSources: sources, confirmedPrecedenceBindings: await readPrecedence(sources) };
    const base2 = await projectOwnerPlacement(await projectImportedSourceAddresses(rawSnapshot, sources, bundle.sources.audits, bundle.sources.devices, initialSources, sourceContext), bundle.sources.audits, bundle.sources.devices, bundle.identity, bundle.sources.units);
    const inputs = { actorId: context.actorId, rawSnapshot, snapshot: base2, bundle, mhelpReceipt, readTarget: (id15) => readOwnerCensusTarget(context, binding.unitKey, id15, signal) };
    const preparation = prepare ? await readOwnerCensusPreparation({ ...inputs, binding: { nativeUnitId: nativeId, auditId: binding.auditId, unitKey: binding.unitKey, addressSha256: binding.addressSha256 } }) : null;
    const evidence = prepare ? null : await readOwnerCensusEvidence({ ...inputs, records: records2 }, true);
    const final = projectMhelpFieldPlacement(projectArchivedRepresentations(base2, archives, bundle.sources.audits, bundle.sources.devices, archiveContext), mhelpReceipt, bundle.sources.audits, bundle.identity);
    checkDeadline();
    const aliases5 = final.nativePlacementAliases.filter((a) => a.unitId === nativeId), items = final.items.filter((r) => r.id === nativeId), inventory = final.inventoryItems.filter((r) => r.id === nativeId);
    if (signal.aborted || aliases5.length !== 1 || items.length !== 1 || inventory.length !== 1 || [items[0], inventory[0]].some((r) => r.placementSource !== "owner" || r.placement !== "FIELD" || r.status !== "field" || r.currentLocationType !== "field" || r.placementStatus === "needs_identity_review" || r.locationVerification === "owner_verified")) fail16("Current complete Owner source proof is unavailable.", 409);
    if (prepare) {
      if (!preparation) fail16("Current complete Owner preparation proof is unavailable.", 409);
      const latest = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_field_geocode_read_many", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_audit_ids: [binding.auditId] }), signal }, "Current preparation authorization is unavailable.");
      checkDeadline();
      if (!Array.isArray(latest) || latest.length !== 1 || JSON.stringify(latest[0]) !== JSON.stringify(record5)) fail16("Owner preparation authorization changed.", 409);
      return { preparation: { ...preparation, preparedAt: (/* @__PURE__ */ new Date()).toISOString() } };
    }
    const proofs = evidence.proofs.filter((p) => p.nativeUnitId === nativeId);
    if (proofs.length !== 1 || !matchesOwnerCensusProof(proofs[0], record5, nativeId)) fail16("Current complete Owner source proof is unavailable.", 409);
    const safeRow = (r) => Object.fromEntries(["id", "unitNumber", "readOnly", "placementSource", "placement", "status", "currentLocationType", "placementAuditId", "placementUnitKey", "address", "locationVerification"].map((k) => [k, r[k]]));
    checkDeadline();
    return { record: record5, map: { placementProjectionVersion: 2, ownerCensusProofs: proofs, nativePlacementAliases: aliases5, items: items.map(safeRow), inventoryItems: inventory.map(safeRow) } };
  };
  let activeLargeBodies = 0;
  return async function handle(request) {
    const ownerProofDeadlineMs = Date.now() + 75e3;
    let ownsLargeBodyPermit = false;
    let keepPermitForResponse = false, responseOwnsPermit = false;
    const releaseLargeBody = () => {
      if (ownsLargeBodyPermit) {
        activeLargeBodies -= 1;
        ownsLargeBodyPermit = false;
      }
    };
    const admitLargeBody = () => {
      if (ownsLargeBodyPermit) return;
      if (activeLargeBodies >= 1) fail16("Another large file transfer is in progress. Wait for it to finish before retrying.", 429);
      activeLargeBodies += 1;
      ownsLargeBodyPermit = true;
    };
    const origin = request.headers.get("Origin");
    const allowedOrigin = !origin || ALLOWED_ORIGINS.has(origin);
    const cors = {
      ...allowedOrigin ? { "Access-Control-Allow-Origin": origin || "https://cypressriveroasis2023-sudo.github.io" } : {},
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff"
    };
    const json = (body, status2 = 200) => {
      const response = new Response(JSON.stringify(body), { status: status2, headers: cors });
      if (!keepPermitForResponse || !ownsLargeBodyPermit || !response.body) return response;
      const reader = response.body.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        reader.releaseLock();
        releaseLargeBody();
      };
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              finish();
              controller.close();
            } else controller.enqueue(chunk.value);
          } catch (error) {
            finish();
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            finish();
          }
        }
      }, { highWaterMark: 0 });
      const guarded = new Response(stream, { status: status2, headers: response.headers });
      responseOwnsPermit = true;
      return guarded;
    };
    if (!allowedOrigin) return json({ error: "This origin is not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (!["GET", "POST"].includes(request.method)) fail16("Method not supported.", 405);
      let path = new URL(request.url).pathname.replace(/^.*\/cos-(?:operations-(?:pages|bridge)|fleet-board-producer)(?=\/|$)/, "").replace(/\/$/, "");
      let method = request.method, body = null;
      const context = await authenticate(request);
      if (!path && request.method === "POST") {
        const { body: envelope, byteLength: envelopeBytes } = await readMhelpAwareJsonWithSize(request, context.legacyOwner && context.actorId ? MHELP_JSON_LIMIT : 65536, admitLargeBody);
        const envelopeLimit = ["/api/mhelpdesk/equipment/preview", "/api/mhelpdesk/equipment/stage", "/api/mhelpdesk/equipment/commit", "/api/mhelpdesk/equipment/assignments"].includes(envelope.path) ? Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 16384 : envelope.path === "/api/mhelpdesk/imports/stage" ? MHELP_JSON_LIMIT : String(envelope.path || "").startsWith("/api/mhelpdesk/imports/") ? 524288 : 65536;
        if (envelopeBytes > envelopeLimit) fail16("Request body is too large.", 413);
        if (Object.keys(envelope).some((k) => !["path", "method", "body"].includes(k))) fail16("Unsupported transport fields.");
        if (typeof envelope.path !== "string" || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(envelope.path) && !(envelope.method === "GET" && envelope.path === "/api/mhelpdesk/intake/status?capability=pending_schedule_v1")) fail16("COS endpoint not found.", 404);
        if (!["GET", "POST"].includes(envelope.method)) fail16("Method not supported.", 405);
        path = envelope.path.replace(/\/$/, "");
        method = envelope.method;
        body = envelope.body == null ? {} : envelope.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) fail16("A JSON object is required.");
        if (method === "GET" && Object.keys(body).length) fail16("GET endpoints do not accept a request body.");
      }
      if (!path.startsWith("/api/")) fail16("COS endpoint not found.", 404);
      if (path.startsWith("/api/tech/")) {
        if (context.legacyOwner || !["it", "service"].includes(context.department)) fail16("A signed-in technician account is required for the production queue.", 403);
        const claimRoute = /^\/api\/tech\/it-queue\/([^/]+)\/claim$/.exec(path);
        if (method !== "GET" && !(method === "POST" && claimRoute && context.department === "it")) fail16("This technician action is not supported.", 405);
        if (path === "/api/tech/session") return json({
          authorized: Boolean(context.actorId),
          legacyTechnician: true,
          role: context.department === "it" ? "IT" : "Service",
          name: context.name,
          department: context.department,
          productionTechnicianUserId: context.actorId || null,
          reason: context.actorId ? null : "This technician account is not linked to its own COS production identity. Your existing Tech Check remains available."
        });
        if (!context.actorId) fail16("This technician account is not linked to COS production.", 403);
        const payload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
        const visibleVisitIds = async (ids) => {
          if (!ids.length) return /* @__PURE__ */ new Set();
          const visible = await rpc("cos_technician_visible_visits", { ...payload, p_visit_ids: ids });
          if (!Array.isArray(visible) || visible.some((id15) => !UUID7.test(String(id15 || "")) || !ids.includes(id15))) fail16("Current technician visit access could not be verified.", 503);
          return new Set(visible);
        };
        if (path === "/api/tech/it-queue") {
          if (context.department !== "it") fail16("An active IT account is required for the shared queue.", 403);
          const snapshot = await rpc("cos_it_queue_snapshot", payload);
          if (!snapshot || snapshot.actorId !== context.actorId || !Array.isArray(snapshot.items) || snapshot.items.some((row2) => !UUID7.test(String(row2.visitId || "")) || !UUID7.test(String(row2.jobId || "")) || !["ready", "claimed"].includes(row2.queueStatus) || typeof row2.claimable !== "boolean" || typeof row2.setupNeeded !== "boolean" || typeof row2.readinessNote !== "string" || typeof row2.nativeDispatchStatus !== "string" || (row2.queueStatus === "ready" ? row2.claimOwnerId != null : !UUID7.test(String(row2.claimOwnerId || ""))))) fail16("Shared IT queue could not be verified.", 503);
          return json(snapshot);
        }
        if (claimRoute) {
          if (method !== "POST" || context.department !== "it") fail16("A shared IT claim requires an IT technician POST.", 405);
          const claimBody = body || await requestBody(request);
          allowedFields(claimBody, [], "Shared IT claim");
          const id15 = idValue(claimRoute[1], "Visit");
          await assertRecord("job_visits", id15);
          const claimed = await rpc("cos_claim_shared_it_visit", { p_actor_user_id: context.actorId, p_visit_id: id15 });
          if (!claimed || claimed.visit_id !== id15 || claimed.claimed_by !== context.actorId || claimed.status !== "accepted" || typeof claimed.already_claimed !== "boolean") fail16("Claim response could not be verified. Refresh the IT queue.", 503);
          return json(claimed);
        }
        if (path === "/api/tech/my-day") return json(await rpc("appdeploy_technician_my_day", payload));
        if (path === "/api/tech/tasks") return json(await rpc("appdeploy_technician_tasks_snapshot", payload));
        if (path === "/api/tech/assignments") {
          const rows4 = await platformAll("visit_assignments?select=user_id,visit_id,status,assigned_at,job_visits!inner(id,job_id,visit_number,visit_type,department,status,dispatch_status,scheduled_start,scheduled_end,instructions,jobs(job_number,title,job_type,priority,customers(name),sites(name)))&user_id=eq." + context.actorId + "&assignment_role=eq.technician&status=in.(assigned,accepted)&job_visits.organization_id=eq." + ORGANIZATION_ID + "&job_visits.status=not.in.(completed,cancelled)&order=assigned_at.asc");
          if (rows4.some((row2) => row2.user_id !== context.actorId || !row2.job_visits || row2.job_visits.id !== row2.visit_id || row2.job_visits.department?.toLowerCase() !== context.department)) fail16("COS returned an inconsistent technician assignment collection.", 503);
          const visible = await visibleVisitIds(rows4.map((row2) => row2.visit_id));
          return json({ profile: { display_name: context.name, department: context.department }, visits: rows4.filter((row2) => visible.has(row2.visit_id)).map((row2) => {
            const v = row2.job_visits, j = v?.jobs;
            return { visit_id: row2.visit_id, visit_number: v?.visit_number, visit_type: v?.visit_type, department: v?.department, status: v?.status, dispatch_status: v?.dispatch_status, scheduled_start: v?.scheduled_start, scheduled_end: v?.scheduled_end, instructions: v?.instructions, assignment_status: row2.status, job_id: v?.job_id, job_number: j?.job_number, job_title: j?.title, job_type: j?.job_type, priority: j?.priority, customer_name: j?.customers?.name, site_name: j?.sites?.name };
          }) });
        }
        const visitRoute = /^\/api\/tech\/visits\/([^/]+)$/.exec(path);
        if (visitRoute) {
          const id15 = idValue(visitRoute[1], "Visit");
          await assertRecord("job_visits", id15);
          if (!(await visibleVisitIds([id15])).has(id15)) fail16("This visit is no longer available to your technician account.", 404);
          const assigned = await platformRead("visit_assignments?select=visit_id,user_id,assignment_role,status&visit_id=eq." + id15 + "&user_id=eq." + context.actorId + "&assignment_role=eq.technician&status=in.(assigned,accepted)&limit=1");
          if (!Array.isArray(assigned) || !assigned.some((row2) => row2.visit_id === id15 && row2.user_id === context.actorId && row2.assignment_role === "technician" && ["assigned", "accepted"].includes(row2.status))) fail16("This visit is not assigned to your technician account.", 404);
          const detail = await rpc("appdeploy_technician_visit_snapshot", { ...payload, p_visit_id: id15 });
          if (!detail?.visit) {
            if (!detail || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).length) fail16("The assigned visit workflow could not be verified.", 503);
            const executions = await platformRead("workflow_executions?select=id&visit_id=eq." + id15 + "&organization_id=eq." + ORGANIZATION_ID + "&status=neq.cancelled&limit=1");
            if (!Array.isArray(executions) || executions.length) fail16("The assigned visit workflow could not be verified. Refresh your assignments.", 503);
            const rows4 = await platformRead("visit_assignments?select=visit_id,user_id,assignment_role,status,job_visits!inner(id,organization_id,job_id,visit_number,visit_type,department,status,dispatch_status,scheduled_start,scheduled_end,instructions,jobs!inner(id,organization_id,job_number,title,job_type,description,priority,customer_id,site_id,operational_status,customers!inner(id,organization_id,name),sites!inner(id,organization_id,customer_id,name,address_line1,address_line2,city,state_region,postal_code)))&visit_id=eq." + id15 + "&user_id=eq." + context.actorId + "&assignment_role=eq.technician&status=in.(assigned,accepted)&job_visits.organization_id=eq." + ORGANIZATION_ID + "&job_visits.department=eq." + context.department + "&job_visits.status=not.in.(completed,cancelled,closed)&limit=2");
            if (!Array.isArray(rows4) || rows4.length !== 1) fail16("This visit is no longer assigned to your technician account. Refresh your assignments.", 404);
            const assignment2 = rows4[0], visit = assignment2.job_visits, job2 = visit?.jobs, site = job2?.sites, customer = job2?.customers;
            if (assignment2.visit_id !== id15 || assignment2.user_id !== context.actorId || assignment2.assignment_role !== "technician" || !["assigned", "accepted"].includes(assignment2.status) || visit?.id !== id15 || visit.organization_id !== ORGANIZATION_ID || visit.department !== context.department || ["completed", "cancelled", "canceled", "closed"].includes(visit.status) || !UUID7.test(String(visit.job_id || "")) || job2?.id !== visit.job_id || job2.organization_id !== ORGANIZATION_ID || ["closed", "cancelled", "canceled"].includes(job2.operational_status) || !UUID7.test(String(job2.site_id || "")) || site?.id !== job2.site_id || site.organization_id !== ORGANIZATION_ID || site.customer_id !== job2.customer_id || !UUID7.test(String(job2.customer_id || "")) || customer?.id !== job2.customer_id || customer.organization_id !== ORGANIZATION_ID) fail16("The assigned visit records do not match your active assignment.", 503);
            return json({
              execution: null,
              current_step: null,
              pendingWorkflow: true,
              visit: { id: id15, visit_number: visit.visit_number, visit_type: visit.visit_type, department: visit.department, status: visit.status, dispatch_status: visit.dispatch_status, scheduled_start: visit.scheduled_start, scheduled_end: visit.scheduled_end, instructions: visit.instructions },
              job: { id: job2.id, job_number: job2.job_number, title: job2.title, job_type: job2.job_type, description: job2.description, priority: job2.priority, customer_name: customer.name },
              site: { name: site.name, address_line1: site.address_line1, address_line2: site.address_line2, city: site.city, state_region: site.state_region, postal_code: site.postal_code }
            });
          }
          if (detail.visit.id !== id15) fail16("The assigned visit workflow could not be verified.", 503);
          const step = detail.current_step;
          return json({ execution: detail.execution, visit: detail.visit, job: detail.job, site: detail.site, current_step: step ? { id: step.id, step_key: step.step_key, sequence_number: step.sequence_number, title: step.title, instruction: step.instruction, step_type: step.step_type, required: step.required } : null });
        }
        fail16("COS technician endpoint not found.", 404);
      }
      const verifiedFleetIt = verifiedItFleet(context);
      const shopPlacement = /^\/api\/fleet\/units\/([a-f0-9-]+)\/shop-placement$/i.exec(path);
      if (shopPlacement) {
        if (!(context.legacyOwner && context.actorId) && !verifiedFleetIt) fail16("An active COS Owner or verified IT account is required.", 403);
        try {
          return json(await createFleetShopPlacement({ rpc, actorPayload: { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID } })(shopPlacement[1], method, body));
        } catch (error) {
          if (error instanceof FleetShopError) return json({ error: error.message }, error.status);
          throw error;
        }
      }
      if (/^\/api\/camera-health\/devices\/[^/]+\/check$/.test(path)) {
        if (!(context.legacyOwner && context.actorId) && !verifiedFleetIt) fail16("An active COS Owner or verified IT account is required.", 403);
        if (method !== "POST") fail16("Use POST for a connection check.", 405);
        try {
          return json(await checkSavedCamera({ id: path.split("/")[4], body, headers: context.headers, fetcher: requestFetch, signal: request.signal }));
        } catch (error) {
          if (error instanceof CameraDiagnosticError) return json({ error: error.message }, error.status);
          throw error;
        }
      }
      if (!context.legacyOwner && !(verifiedFleetIt && fleetRouteAllowed(method, path))) fail16("An active COS Owner account is required.", 403);
      if (method === "GET" && path === "/api/session" && verifiedFleetIt) return json({
        authorized: true,
        legacyOwner: false,
        role: "IT",
        name: context.name,
        productionTechnicianUserId: context.actorId,
        features: fleetFeatures(),
        productionOwnerUserId: null,
        provisioningNeeded: null,
        reason: null
      });
      if (method === "GET" && path === "/api/session") return json({
        authorized: Boolean(context.actorId),
        legacyOwner: true,
        role: "Owner",
        name: context.name,
        features: { durableFleetBoard: false, unitTracker: Boolean(context.actorId), fleetAccess: Boolean(context.actorId), vrmRead: Boolean(context.actorId), fleetPlacementEdit: Boolean(context.actorId), fleetConnectionEdit: Boolean(context.actorId), cameraHealthV2: Boolean(context.actorId), fieldLocationVerification: Boolean(context.actorId), ownerIdentityReview: Boolean(context.actorId), mhelpTicketImport: Boolean(context.actorId), ownerEquipmentImportEnabled: Boolean(context.actorId) && options.ownerEquipmentImportEnabled === true, deliveryGoBack: Boolean(context.actorId), legacyInstallEvidence: Boolean(context.actorId) },
        productionOwnerUserId: context.actorId || null,
        provisioningNeeded: context.actorId ? null : "same_person_platform_auth_identity_and_owner_role",
        reason: context.actorId ? null : "This Owner has no linked same-person COS production account. An Owner must provision that identity and its existing Owner role before linking it. Existing Tech Check tools remain available."
      });
      if (!context.actorId) fail16("This Owner account is not linked to COS production. Use the existing Tech Check tools.", 403);
      const actorPayload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
      const commonFleetMapRead = method === "GET" && path === "/api/fleet-map-source";
      if (commonFleetMapRead) path = "/api/field-map";
      const savedHistoryMatch = /^\/api\/fleet-saved-board\/history\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(path);
      if (method === "GET" && savedHistoryMatch) return json(await rpc("cos_fleet_board_history", { p_run: savedHistoryMatch[1] }));
      if (path === "/api/fleet-saved-board" || path === "/api/fleet-saved-board/refresh" || path === "/api/fleet-saved-board/produce") {
        const force = path.endsWith("/refresh"), produce = path.endsWith("/produce");
        if (method !== (force || produce ? "POST" : "GET")) return json({ error: "Unsupported saved board action" }, 405);
        if (produce) {
          if (!body || Object.keys(body).length !== 1 || typeof body.run !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.run)) return json({ error: "Exact saved board batch required" }, 400);
        } else if (body && Object.keys(body).length) return json({ error: "Empty saved board request required" }, 400);
        const origin2 = request.headers.get("Origin"), batchController = new AbortController();
        const internal = (slug, payload, signal, extra = {}) => fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/" + slug, {
          method: "POST",
          headers: { Authorization: context.authorization, "Content-Type": "application/json", ...origin2 ? { Origin: origin2 } : {}, ...extra },
          body: JSON.stringify(payload),
          cache: "no-store",
          redirect: "error",
          signal
        });
        const read = async (source, { attemptMs, until }) => {
          let last = { kind: "batch_deadline", attempts: 0 };
          for (let attempt = 1; attempt <= 3; attempt++) {
            let remaining = until - Date.now();
            if (remaining < 2e3) break;
            if (attempt > 1) {
              await new Promise((resolve2) => setTimeout(resolve2, Math.min(1500, remaining - 1e3)));
              remaining = until - Date.now();
            }
            let response;
            try {
              response = await internal("cos-operations-pages", { path: source, method: "GET", body: null }, AbortSignal.any([batchController.signal, AbortSignal.timeout(Math.max(1, Math.min(attemptMs, remaining)))]), { "X-COS-Fleet-Batch": "1" });
              if (response.ok) return { value: await response.json(), attempts: attempt };
            } catch (cause) {
              last = { kind: batchController.signal.aborted ? "cancelled" : cause?.name === "TimeoutError" ? "timeout" : response ? "incomplete_response" : "network", attempts: attempt };
              if (batchController.signal.aborted) break;
              continue;
            }
            let diagnostic = null;
            try {
              diagnostic = (await response.json())?.diagnostic;
            } catch {
            }
            last = { kind: "http", status: response.status, attempts: attempt, stage: diagnostic?.stage, code: diagnostic?.code };
            if (response.status < 500) break;
            if (diagnostic?.retryable === false) break;
          }
          throw Object.assign(Error("source_read_failed"), { detail: last });
        };
        const dispatchTo = (slug) => async (run) => {
          let response;
          try {
            response = await internal(slug, { path: "/api/fleet-saved-board/produce", method: "POST", body: { run } }, AbortSignal.timeout(8e3));
          } catch {
            return "uncertain";
          }
          await response.body?.cancel().catch(() => {
          });
          return response.status === 202 ? "accepted" : response.status >= 400 && response.status < 500 ? "rejected" : "uncertain";
        };
        const targets = [dispatchTo("cos-fleet-board-producer")];
        const followTargets = [...targets, dispatchTo("cos-operations-pages")];
        if (produce) {
          const outcome = await acceptFleetBatch({ run: body.run, rpc, read, project: completedBoard, followTargets, abort: () => batchController.abort(), waitUntil: (task) => EdgeRuntime.waitUntil(task) });
          if (outcome === "accepted") return json({ accepted: true }, 202);
          if (outcome === "refused") return json({ error: "Saved board batch is not available" }, 409);
          return json({ error: "Saved board batch claim is unconfirmed" }, 503);
        }
        const payloadText = async (id15) => {
          const response = await requestFetch(platformUrl + "/rest/v1/rpc/cos_fleet_board_payload", { method: "POST", headers: platformHeaders(), body: JSON.stringify({ p_run: id15 }) });
          if (!response.ok) {
            await response.body?.cancel();
            throw Error("saved_board_unavailable");
          }
          return response.text();
        };
        const saved = await savedFleetBoard({ rpc, payloadText, read, force, targets, followTargets, abort: () => batchController.abort(), project: completedBoard, waitUntil: (task) => EdgeRuntime.waitUntil(task) });
        return new Response(saved, { status: 200, headers: cors });
      }
      if (path === "/api/product-connections") {
        if (method !== "GET") fail16("Use GET for saved connection evidence.", 405);
        const receipt2 = await rpc("cos_mhelp_placement_snapshot", actorPayload, request.signal);
        if (!receipt2?.upload) fail16("Reviewed mHelp Product-ID census is unavailable.", 503);
        let source;
        try {
          source = currentMhelpProductConnectionCensus(receipt2.upload);
        } catch {
          fail16("Reviewed mHelp Product-ID census could not be verified.", 503);
        }
        const [tracker, deviceRows, checks] = await Promise.all([
          read2027ProductIpsFromGoogle({
            getServiceAccountJson: options.googleSheets?.getServiceAccountJson || (() => void 0),
            signAssertion: options.googleSheets?.signAssertion,
            fetch: requestFetch,
            candidate: source.candidate,
            expectedMhelpSourceSha256: source.sourceSha256
          }),
          legacyAll("camera_devices?select=id,public_ip,expected_ports,connection_revision,monitoring_enabled&order=id.asc", context.headers, request.signal),
          legacyAll("camera_health_current?select=camera_device_id,port_status&order=camera_device_id.asc", context.headers, request.signal)
        ]);
        const byId = new Map(checks.map((row2) => [String(row2.camera_device_id), row2]));
        if (byId.size !== checks.length) fail16("Saved endpoint checks have conflicting identities.", 503);
        const endpoints = deviceRows.map((device) => ({
          deviceId: device.id,
          publicIp: device.public_ip,
          expectedPorts: device.expected_ports,
          connectionRevision: device.connection_revision,
          monitoringEnabled: device.monitoring_enabled,
          portStatus: byId.get(String(device.id))?.port_status || null
        }));
        const evaluated = buildExactProductConnections(source.census, tracker, endpoints);
        if (!evaluated) fail16("Current exact Product-ID/endpoint evidence could not be verified.", 503);
        return json(evaluated);
      }
      const censusOnce = /^\/api\/field-map\/([^/]+)\/(owner-census-once|owner-census-proof|owner-census-prepare)$/.exec(path);
      if (censusOnce) {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method !== "POST") fail16("An explicit Owner request is required.", 405);
        if (new URL(request.url).search) fail16("Query parameters are unsupported.");
        const nativeId = idValue(censusOnce[1], "Unit");
        if (body === null) body = await requestBody(request);
        const prepare = censusOnce[2] === "owner-census-prepare";
        allowedFields(body, prepare ? ["auditId", "unitKey", "addressSha256"] : ["auditId", "unitKey", "addressSha256", "nativeGuardSha256"]);
        if (typeof body.auditId !== "string" || !/^[1-9]\d{0,18}$/.test(body.auditId) || BigInt(body.auditId) > 9223372036854775807n || typeof body.unitKey !== "string" || !body.unitKey.trim() || body.unitKey !== body.unitKey.trim() || body.unitKey.length > 250 || !(prepare ? ["addressSha256"] : ["addressSha256", "nativeGuardSha256"]).every((k) => typeof body[k] === "string" && /^[a-f0-9]{64}$/.test(body[k]))) fail16("Exact reviewed lookup binding is required.");
        let fresh2;
        try {
          fresh2 = await readOwnerCensusEnvelope(context, nativeId, body, request.signal, prepare, ownerProofDeadlineMs);
        } catch (cause) {
          if (!request.signal.aborted && Date.now() >= ownerProofDeadlineMs && !(cause instanceof HttpError && [401, 403, 409].includes(cause.status))) fail16("Current Owner source proof deadline elapsed.", 504);
          throw cause;
        }
        if (Date.now() >= ownerProofDeadlineMs) fail16("Current Owner source proof deadline elapsed.", 504);
        if (prepare) return json(fresh2.preparation);
        if (censusOnce[2] === "owner-census-proof") return json(fresh2.map);
        if (fresh2.record.censusOnlyState !== "ready") fail16("The enrolled Owner lookup changed or its allowance is unavailable.", 409);
        let upstream;
        const forwardingDeadlineMs = Date.now() + 315e3, forwardingSignal = AbortSignal.timeout(315e3);
        try {
          upstream = await requestFetch(LEGACY_URL + "/functions/v1/camera-field-geocode", {
            method: "POST",
            headers: { Authorization: context.authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ auditId: body.auditId, unitKey: body.unitKey }),
            redirect: "error",
            cache: "no-store",
            signal: forwardingSignal
          });
        } catch {
          return json({ error: "The lookup outcome is uncertain. Refresh to inspect its saved hold; do not repeat the request.", censusOnly: true, allowance: "unknown" }, 503);
        }
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return json({ error: "The Census-only lookup could not finish. Refresh to check its hold.", censusOnly: true, allowance: "unknown" }, upstream.status >= 500 ? 503 : 409);
        }
        let result;
        try {
          result = await readOwnerCensusJson(upstream, 32768);
        } catch {
          fail16("The lookup outcome is uncertain. Refresh before taking further action.", 503);
        }
        if (forwardingSignal.aborted || Date.now() >= forwardingDeadlineMs) fail16("The lookup outcome is uncertain. Refresh to inspect the saved result.", 503);
        if (result?.ok !== true || result.censusOnly !== true || !["unknown", "available", "consumed"].includes(result.allowance) || !Array.isArray(result.results) || result.results.length > 1 || !Array.isArray(result.fallbackResults) || result.fallbackResults.length || result.importedResults !== null || result.results.some((r) => r?.auditId !== body.auditId || r.censusOnly !== true || !["pending", "success", "no_match", "invalid_address", "provider_error", "held", "superseded", "draining"].includes(r.status) || !["unknown", "available", "consumed"].includes(r.allowance) || r.censusOnlyNotBefore !== void 0 && (typeof r.censusOnlyNotBefore !== "string" || !Number.isFinite(Date.parse(r.censusOnlyNotBefore))))) fail16("The lookup outcome is uncertain. Refresh to inspect the saved result.", 503);
        return json({ ok: true, results: result.results.map((r) => ({ auditId: r.auditId, status: r.status, censusOnly: true, allowance: r.allowance, ...r.censusOnlyNotBefore ? { censusOnlyNotBefore: r.censusOnlyNotBefore } : {} })), fallbackResults: [], importedResults: null, censusOnly: true, allowance: result.allowance });
      }
      if (path === "/api/owner-review/legacy-evidence") {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method !== "GET") fail16("Method not supported.", 405);
        if (new URL(request.url).search) fail16("Evidence query parameters are unsupported.");
        allowedFields(body || {}, [], "Legacy evidence request");
        try {
          const roleId = idValue(context.ownerRoleId, "Owner role");
          const permission = await legacyEvidenceTransport(requestFetch, platformUrl, platformHeaders(), request.signal)("role_permissions?select=role_id,permission_code&role_id=eq." + roleId + "&permission_code=eq.job.view_all&limit=2");
          if (!Array.isArray(permission) || permission.length !== 1 || permission[0]?.role_id !== roleId || permission[0]?.permission_code !== "job.view_all") throw new LegacyInstallEvidenceError(403);
          return json(await createLegacyInstallEvidenceReader(legacyEvidenceTransport(requestFetch, LEGACY_URL, context.headers, request.signal))());
        } catch (cause) {
          const error = cause instanceof LegacyInstallEvidenceError ? cause : new LegacyInstallEvidenceError();
          return json({ error: error.message }, error.status);
        }
      }
      if (path === "/api/mhelpdesk/intake/status" || path === "/api/mhelpdesk/intake/status?capability=pending_schedule_v1") {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method !== "GET") fail16("Method not supported.", 405);
        allowedFields(body || {}, [], "Intake status request");
        const query = new URL(request.url).search, transportOptIn = path === "/api/mhelpdesk/intake/status?capability=pending_schedule_v1";
        if (query !== "" && (query !== "?capability=pending_schedule_v1" || transportOptIn)) fail16("Intake status query parameters are unsupported.");
        const capability = transportOptIn || query === "?capability=pending_schedule_v1" ? "pending_schedule_v1" : void 0;
        try {
          return json(await readMhelpIntakeReview(context.authorization, request.signal, capability));
        } catch (cause) {
          const failure2 = cause instanceof MhelpIntakeReviewError ? cause : new MhelpIntakeReviewError();
          return json({ error: failure2.message }, failure2.status);
        }
      }
      if (path === "/api/mhelpdesk/partner/reconnect" || path === "/api/mhelpdesk/partner/reconnect/status") {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method !== "POST" || request.method !== "POST") fail16("Reconnect requires an explicit POST.", 405);
        if (!ALLOWED_ORIGINS.has(origin)) fail16("Open reconnect from the production COS Owner workspace.", 403);
        if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("Content-Type") || "")) fail16("Reconnect requires a JSON request.", 415);
        if (new URL(request.url).search) fail16("Reconnect query parameters are unsupported.");
        if (!options.mhelpReconnect) fail16("Secure reconnect is not available.", 503);
        if (body === null) body = await readMhelpAwareJson(request, 36e3);
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 36e3) fail16("Request body is too large.", 413);
        const reauthorize = async () => {
          try {
            const fresh2 = await authenticate(request);
            if (!fresh2.legacyOwner || !fresh2.actorId || fresh2.legacyId !== context.legacyId || fresh2.actorId !== context.actorId || fresh2.ownerRoleId !== context.ownerRoleId) throw new MhelpReconnectError(403);
          } catch {
            throw new MhelpReconnectError(403);
          }
        };
        try {
          return json(await (path.endsWith("/status") ? options.mhelpReconnect.status(body) : options.mhelpReconnect.reconnect(body, reauthorize)));
        } catch (cause) {
          const error = cause instanceof MhelpReconnectError ? cause : new MhelpReconnectError();
          return json({ error: error.message }, error.status);
        }
      }
      if (path.startsWith("/api/mhelpdesk/partner/")) {
        if (!context.legacyOwner && !(path === "/api/mhelpdesk/partner/unit-location" && verifiedFleetIt)) fail16("An active COS Owner account is required.", 403);
        if (method === "POST" && body === null) body = await requestBody(request);
        if (path === "/api/mhelpdesk/partner/unit-location") {
          if (method !== "POST") fail16("Method not supported.", 405);
          if (body?.unitId === void 0) return json(await mhelpUnitLocation(body));
          allowedFields(body, ["unitId", "unitName"], "Unit location refresh");
          const unitId = idValue(body.unitId, "Unit");
          const target = await rpc("cos_mhelp_location_target", { ...actorPayload, p_unit_id: unitId });
          if (target.unitNumber !== body.unitName || target.inactive) fail16("The current unit identity must be reviewed before refreshing its service location.", 409);
          const preview = await mhelpUnitLocation({ unitName: target.unitNumber });
          await rpc("cos_mhelp_location_record", { ...actorPayload, p_unit_id: unitId, p_guard: target.guard, p_observation: { state: "confirmed", equipmentId: preview.equipmentId, placement: preview.placement, customer: preview.customer, site: preview.site, address: preview.address || null, point: preview.point, coordinateSource: preview.coordinateSource } });
          return json({ ...preview, locationEvidenceUpdated: true });
        }
        if (path === "/api/mhelpdesk/partner/tickets/preview") {
          if (method !== "POST") fail16("Method not supported.", 405);
          if (body?.evidence === MHELP_TICKET_PRIVATE_SAMPLE) {
            allowedFields(body, ["evidence", "ticketNumber", "appointmentDay"], "Private ticket sample request");
            const now = options.now ? options.now() : /* @__PURE__ */ new Date(), sample = { ticketNumber: body.ticketNumber, appointmentDay: body.appointmentDay };
            try {
              validateMhelpPrivateSampleRequest(sample, now);
            } catch {
              fail16("Enter a ticket number and an appointment day within 31 Chicago calendar days.");
            }
            try {
              return json(projectMhelpPrivateSample(await mhelpTickets.sample(sample, now, request.signal)));
            } catch (cause) {
              const diagnostic = mhelpTicketDiagnostic(cause);
              try {
                (options.reportTicketPreviewFailure || ((entry) => console.warn(JSON.stringify(entry))))(diagnostic.log);
              } catch {
              }
              return json({ error: diagnostic.error }, diagnostic.httpStatus);
            }
          }
          allowedFields(body || {}, ["day", "evidence"], "Ticket preview request");
          if (body?.day !== void 0 && body.day !== "previous") fail16("Ticket preview day is unsupported.");
          if (body?.evidence !== void 0 && body.evidence !== "operational_structure_v1" && body.evidence !== "ticket_detail_structure_v1" && body.evidence !== "appointment_structure_v1" && body.evidence !== "appointment_variants_v1") fail16("Ticket preview evidence capability is unsupported.");
          try {
            const now = options.now ? options.now() : /* @__PURE__ */ new Date();
            const window = body?.day === "previous" ? mhelpPreviousDayPreviewWindow(now) : mhelpTodayPreviewWindow(now);
            const evidence = body?.evidence === "appointment_variants_v1" ? "appointment_variants_v1" : body?.evidence === "appointment_structure_v1" ? "appointment_structure_v1" : body?.evidence === "ticket_detail_structure_v1" ? "ticket_detail_structure_v1" : body?.evidence === "operational_structure_v1" ? "operational_structure_v1" : void 0;
            return json(projectMhelpTicketPreview(await mhelpTickets.preview(window, evidence), evidence));
          } catch (cause) {
            const diagnostic = mhelpTicketDiagnostic(cause);
            try {
              (options.reportTicketPreviewFailure || ((entry) => console.warn(JSON.stringify(entry))))(diagnostic.log);
            } catch {
            }
            return json({ error: diagnostic.error }, diagnostic.httpStatus);
          }
        }
        return json(await mhelpPartner(path, method, body));
      }
      if (path.startsWith("/api/unit-tracker/sheets/")) {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method === "POST" && body === null) body = await requestBody(request);
        return json(await sheetsConnection(path, method, body));
      }
      if (path === "/api/unit-tracker" || path.startsWith("/api/unit-tracker/")) {
        if (method === "POST" && body === null) body = await requestBody(request);
        return json(await createUnitTracker({ rpc, actorPayload })(path, method, body));
      }
      if (path.startsWith("/api/owner-identity/")) {
        if (!context.legacyOwner) fail16("An active COS Owner account is required.", 403);
        if (method === "POST" && body === null) body = await requestBody(request);
        return json(await createOwnerIdentityReview({
          actorId: context.actorId,
          organizationId: ORGANIZATION_ID,
          rpc,
          read: async (key2) => {
            const result = await readIdentitySources(context, key2);
            return { sources: result.reviewSources, identity: result.identity };
          }
        })(path, method, body));
      }
      if (path === "/api/mhelpdesk/equipment/preview") {
        if (!context.legacyOwner || !context.actorId) fail16("An active COS Owner account is required.", 403);
        if (method !== "POST") fail16("Method not supported.", 405);
        if (body === null) body = await readMhelpAwareJson(request, Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 8192, admitLargeBody);
        const current = await readMhelpPlacements(actorPayload);
        if (!current?.upload) fail16("The previous reviewed mHelp equipment source is unavailable. No records were changed.", 503);
        try {
          return json(await ownerEquipmentCsvReview({ body, previous: current.upload, google: { getServiceAccountJson: options.googleSheets?.getServiceAccountJson || (() => void 0), signAssertion: options.googleSheets?.signAssertion, fetch: requestFetch } }));
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Invalid mHelpDesk equipment CSV:")) fail16(e.message, 422);
          fail16("The equipment comparison is unavailable. No records were changed.", 503);
        }
      }
      if (path === "/api/mhelpdesk/equipment/stage" || path === "/api/mhelpdesk/equipment/commit" || path === "/api/mhelpdesk/equipment/assignments") {
        if (!context.legacyOwner || !context.actorId) fail16("An active COS Owner account is required.", 403);
        if (method !== "POST") fail16("Method not supported.", 405);
        if (options.ownerEquipmentImportEnabled !== true) fail16("Protected equipment admission is not enabled. Preview remains available.", 503);
        if (body === null) body = await readMhelpAwareJson(request, Math.ceil(EQUIPMENT_CSV_MAX_BYTES / 3) * 4 + 16384, admitLargeBody);
        const allowed = path.endsWith("/assignments") ? ["bytesBase64", "sourceFilename", "expectedSha256", "stageId", "action", "reviewDigest", "confirmationText"] : path.endsWith("/stage") ? ["bytesBase64", "sourceFilename", "expectedSha256", "requestId"] : ["bytesBase64", "sourceFilename", "expectedSha256", "stageId", "confirmationText"];
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !allowed.includes(k))) fail16("Invalid equipment submission.", 400);
        const original = { bytesBase64: body.bytesBase64, sourceFilename: body.sourceFilename, ...body.expectedSha256 === void 0 ? {} : { expectedSha256: body.expectedSha256 } };
        const current = await readMhelpPlacements(actorPayload);
        if (!current?.upload) fail16("The last reviewed mHelpDesk equipment source is unavailable. No records were changed.", 503);
        const common2 = {
          body: original,
          previous: current.upload,
          actorId: context.actorId,
          organizationId: ORGANIZATION_ID,
          google: { getServiceAccountJson: options.googleSheets?.getServiceAccountJson || (() => void 0), signAssertion: options.googleSheets?.signAssertion, fetch: requestFetch },
          rpc
        };
        try {
          return json(path.endsWith("/assignments") ? await reviewOwnerEquipmentAssignments({ ...common2, stageId: body.stageId, action: body.action, reviewDigest: body.reviewDigest, confirmationText: body.confirmationText }) : path.endsWith("/stage") ? await stageOwnerEquipmentCsv({ ...common2, requestId: body.requestId }) : await commitOwnerEquipmentCsv({ ...common2, stageId: body.stageId, confirmationText: body.confirmationText }));
        } catch (e) {
          if (e instanceof HttpError && e.status === 409) fail16("The equipment source or assignment evidence changed. Refresh the Owner review before continuing.", 409);
          if (e instanceof Error && e.message.startsWith("Invalid mHelpDesk equipment CSV:")) fail16(e.message, 422);
          if (e instanceof Error && e.message.startsWith("Protected COS equipment admission:")) fail16(e.message, 409);
          fail16("Current Owner equipment guards could not be verified. No source update was authorized.", 503);
        }
      }
      if (path.startsWith("/api/mhelpdesk/imports")) {
        if (method === "GET" && /^\/api\/mhelpdesk\/imports\/attachments\/[^/]+\/download$/.test(path)) {
          idValue(path.split("/")[5], "Import record");
          admitLargeBody();
          keepPermitForResponse = true;
        }
        if (method === "POST" && body === null) body = await readMhelpAwareJson(request, path.endsWith("/stage") ? MHELP_JSON_LIMIT : 524288, admitLargeBody);
        return json(await mhelpImport(path, method, body, context.actorId));
      }
      if (path === "/api/inhand-pilot/run") {
        if (method !== "POST") fail16("The one-use pilot requires an explicit POST.", 405);
        if (new URL(request.url).search) fail16("The one-use pilot does not accept query parameters.");
        const pilotBody = body || await requestBody(request);
        allowedFields(pilotBody, []);
        return json(await readInhandPilot(context.actorId));
      }
      if (method === "GET" && /^\/api\/evidence\/[^/]+$/.test(path)) {
        const documentId = idValue(path.split("/").pop(), "Evidence");
        admitLargeBody();
        keepPermitForResponse = true;
        return json(await readPrivateOwnerEvidence(context.actorId, documentId));
      }
      if (method === "GET") {
        const contactRoute = /^\/api\/customers\/([^/]+)\/contacts$/.exec(path);
        if (contactRoute) {
          const customerId = idValue(contactRoute[1], "Customer");
          const directory = await rpc("appdeploy_customers_snapshot", actorPayload);
          if (!Array.isArray(directory?.items) || directory.items.some((row2) => !row2 || typeof row2 !== "object" || Array.isArray(row2) || !UUID7.test(String(row2.id || "")) || !["active", "inactive", "archived"].includes(row2.status))) fail16("Customer access could not be verified.", 503);
          const matches2 = directory.items.filter((row2) => row2.id === customerId);
          if (matches2.length !== 1) fail16("Customer contacts are not available for this customer.", 404);
          if (matches2[0].status !== "active") fail16("Contacts are unavailable for inactive or archived customers.", 409);
          const rows4 = await platformAll("customer_contacts?select=id,customer_id,name,email,phone,title,is_primary,billing_contact,customers!inner(organization_id,status)&customer_id=eq." + customerId + "&customers.organization_id=eq." + ORGANIZATION_ID + "&customers.status=eq.active&order=is_primary.desc,name.asc,id.asc");
          const seen = /* @__PURE__ */ new Set();
          for (const row2 of rows4) {
            if (!row2 || !UUID7.test(String(row2.id || "")) || seen.has(row2.id) || row2.customer_id !== customerId || row2.customers?.organization_id !== ORGANIZATION_ID || row2.customers?.status !== "active" || !["name", "email", "phone", "title"].every((key2) => row2[key2] == null || typeof row2[key2] === "string")) fail16("Customer contact records could not be verified.", 503);
            seen.add(row2.id);
          }
          return json({ customerId, items: rows4.map((row2) => ({ id: row2.id, customerId, name: row2.name || "", email: row2.email || "", phone: row2.phone || "", title: row2.title || "", isPrimary: row2.is_primary === true, billingContact: row2.billing_contact === true })) });
        }
        if (path === "/api/vrm-portal") {
          try {
            return json({ items: vrmPortalConfig(options.vrmEmbeds).items });
          } catch {
            fail16("VRM dashboard configuration is unavailable.", 503);
          }
        }
        if (path === "/api/vrm-fleet" || path === "/api/vrm-fleet/refresh") {
          try {
            return json(readVrmFleet ? await readVrmFleet(path.endsWith("/refresh")) : vrmPortalConfig(options.vrmEmbeds));
          } catch {
            fail16("VRM dashboard configuration is unavailable.", 503);
          }
        }
        if (path === "/api/tv-board/settings") return json(await rpc("cos_tv_board_settings_snapshot", actorPayload));
        const snapshots = {
          "/api/handoffs": "appdeploy_handoffs_snapshot",
          "/api/customers": "appdeploy_customers_snapshot",
          "/api/equipment": "appdeploy_equipment_registry_snapshot",
          "/api/work-requests": "appdeploy_work_requests_snapshot",
          "/api/team": "appdeploy_team_snapshot",
          "/api/daily-board": "cos_daily_board_snapshot",
          "/api/field-map": "appdeploy_field_map_snapshot",
          "/api/owner-tasks": "appdeploy_owner_tasks_snapshot",
          "/api/ar": "appdeploy_invoices_snapshot",
          "/api/purchasing": "appdeploy_purchasing_snapshot",
          "/api/financial-summary": "appdeploy_financial_summary",
          "/api/sites": "appdeploy_sites_snapshot",
          "/api/owner-review": "appdeploy_owner_review_snapshot",
          "/api/owner-review/signatures": "appdeploy_owner_review_signatures_snapshot"
        };
        if (path === "/api/daily-board") {
          const board = await rpc(snapshots[path], actorPayload);
          const jobs = withDeliveryGoBacks({ items: board.jobs }, await rpc("appdeploy_delivery_go_back_snapshot", actorPayload)).items;
          return json({ ...board, jobs });
        }
        if (path === "/api/owner-review") return json(withDeliveryGoBacks(await rpc(snapshots[path], actorPayload), await rpc("appdeploy_delivery_go_back_snapshot", actorPayload)));
        const readArchivedRepresentations = async () => {
          try {
            const rows4 = await rpc("cos_archived_representation_projection", { p_organization_id: ORGANIZATION_ID });
            return Array.isArray(rows4) ? rows4 : [];
          } catch {
            return [];
          }
        };
        if (path === "/api/equipment") {
          const previousArchivedRepresentations = await readArchivedRepresentations();
          if (!previousArchivedRepresentations.length) return json(await rpc(snapshots[path], actorPayload));
          const [snapshot, bundle] = await Promise.all([rpc(snapshots[path], actorPayload), readIdentitySources(context)]);
          const archivedRepresentations = await readArchivedRepresentations();
          return json(projectArchivedEquipmentRegistry(snapshot, archivedRepresentations, bundle.sources.audits, bundle.sources.devices, { nativeUnits: bundle.sources.units, identity: bundle.identity, previousArchivedRepresentations }));
        }
        if (path === "/api/field-map") {
          const [snapshot, bundle] = await Promise.all([rpc(snapshots[path], actorPayload), readIdentitySources(context)]);
          const { audits, devices, units } = bundle.sources, identity4 = bundle.identity;
          const readSourceProjections = async (inventory = snapshot.inventoryItems) => {
            const sourceIdentities = inventory.map((row2) => ({ entityKind: row2.readOnly === true ? "tracker" : "equipment_unit", nativeUnitId: row2.id })), rows4 = [];
            for (let offset = 0; offset < sourceIdentities.length; offset += 250) {
              const page2 = await rpc("cos_geocode_sources_map_projection", { p_organization_id: ORGANIZATION_ID, p_identities: sourceIdentities.slice(offset, offset + 250) });
              if (!Array.isArray(page2)) fail16("Current imported installation sources are unavailable.", 503);
              rows4.push(...page2);
            }
            return rows4;
          };
          const readPrecedenceBindings = async (sources) => {
            const bindings = (await Promise.all(sources.filter((s) => s?.sourcePrecedence !== void 0).map(checkedImportedBinding2))).filter(Boolean);
            const confirmed = [];
            for (let offset = 0; offset < bindings.length; offset += 250) {
              try {
                const page2 = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_imported_precedence_read_current", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_bindings: bindings.slice(offset, offset + 250) }) }, "Reviewed source precedence is unavailable.");
                if (!Array.isArray(page2) || page2.length > Math.min(250, bindings.length - offset)) return [];
                confirmed.push(...(await Promise.all(page2.map(checkedImportedBinding2))).filter(Boolean));
              } catch {
                return [];
              }
            }
            return confirmed;
          };
          const [importedSources, archivedRepresentations] = await Promise.all([readSourceProjections(), readArchivedRepresentations()]);
          const confirmedPrecedenceBindings = await readPrecedenceBindings(importedSources);
          const initial = await projectOwnerPlacement(await projectImportedSourceAddresses(snapshot, importedSources, audits, devices, [], { nativeUnits: units, identity: identity4, archivedRepresentations, confirmedPrecedenceBindings }), audits, devices, identity4, units);
          const importedBindings = (await Promise.all(initial.items.filter((row2) => row2.placementSource !== "owner").map((row2) => checkedImportedBinding2(row2.importedInstallation)))).filter(Boolean);
          const importedGeocodes = [];
          for (let offset = 0; offset < importedBindings.length; offset += 250) {
            try {
              const bindings = importedBindings.slice(offset, offset + 250);
              const page2 = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_imported_geocode_read_many", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_bindings: bindings }) }, "Imported address lookup results are unavailable.");
              if (!Array.isArray(page2) || page2.length > bindings.length) throw Error("Invalid imported lookup page");
              const expected = new Set(bindings.map((binding) => JSON.stringify(binding))), seen = /* @__PURE__ */ new Set();
              for (const row2 of page2) {
                const binding = await checkedImportedBinding2(row2?.binding), key2 = binding && JSON.stringify(binding);
                if (!key2 || !expected.has(key2) || seen.has(key2) || row2.jobKind !== "native_import" || row2.verified !== false || row2.liveGps !== false || typeof row2.legacyGuardSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row2.legacyGuardSha256) || !["pending", "deferred", "success", "no_match", "invalid_address", "provider_error", "held"].includes(row2.status)) throw Error("Invalid imported lookup record");
                seen.add(key2);
              }
              importedGeocodes.push(...page2);
            } catch {
              fail16("Imported address lookup results are unavailable. The map could not be refreshed.", 503);
            }
          }
          const ids = [...new Set(initial.items.filter((row2) => row2.placementSource === "owner" && row2.placementAuditId).map((row2) => row2.placementAuditId))];
          const geocodes = [], fallbackGeocodes = [];
          let censusUnavailable = false;
          try {
            for (let offset = 0; offset < ids.length; offset += 250) {
              const page2 = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_field_geocode_read_many", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_audit_ids: ids.slice(offset, offset + 250) }) }, "Saved address lookup results are unavailable.");
              if (!Array.isArray(page2)) fail16("Address lookup returned invalid results.", 503);
              geocodes.push(...page2);
              try {
                const fallback = await readJson(LEGACY_URL + "/rest/v1/rpc/cos_field_geocode_fallback_read_many", { method: "POST", headers: { ...context.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_organization_id: ORGANIZATION_ID, p_audit_ids: ids.slice(offset, offset + 250) }) }, "Saved address fallback results are unavailable.");
                if (Array.isArray(fallback)) fallbackGeocodes.push(...fallback);
              } catch {
              }
            }
          } catch {
            censusUnavailable = true;
            geocodes.length = 0;
            fallbackGeocodes.length = 0;
          }
          const [freshSnapshot, freshBundle, mhelpReceipt] = await Promise.all([rpc(snapshots[path], actorPayload), readIdentitySources(context), readMhelpPlacements(actorPayload)]);
          const { audits: freshAudits, devices: freshDevices, units: freshUnits } = freshBundle.sources;
          const [freshSources, freshArchivedRepresentations, sourceRecorded] = await Promise.all([readSourceProjections(freshSnapshot.inventoryItems), readArchivedRepresentations(), readSourceRecordedCoordinates(freshSnapshot.inventoryItems, rpc)]);
          const archiveContext = { nativeUnits: freshUnits, identity: freshBundle.identity, archivedRepresentations: freshArchivedRepresentations, previousArchivedRepresentations: archivedRepresentations };
          const freshSourceContext = { ...archiveContext, currentSources: freshSources, confirmedPrecedenceBindings: await readPrecedenceBindings(freshSources) };
          const base2 = await projectOwnerPlacement(await projectImportedSourceAddresses(freshSnapshot, freshSources, freshAudits, freshDevices, importedSources, freshSourceContext), freshAudits, freshDevices, freshBundle.identity, freshUnits);
          const ownerCensusEvidence = await readOwnerCensusEvidence({
            actorId: context.actorId,
            records: context.legacyOwner && !commonFleetMapRead ? geocodes : geocodes.filter((r) => r.censusOnlyState === "consumed" && r.status === "success"),
            rawSnapshot: freshSnapshot,
            snapshot: base2,
            bundle: freshBundle,
            mhelpReceipt,
            readTarget: (id15) => readOwnerCensusTarget(context, geocodes.find((r) => r.censusOnlyGuard?.nativeUnitId === id15)?.unitKey, id15)
          }, context.legacyOwner && !commonFleetMapRead);
          let projected = await projectFieldGeocodes({ ...base2, ownerCensusProofs: ownerCensusEvidence.proofs }, geocodes, censusUnavailable, ownerCensusEvidence.receipts, context.legacyOwner && !commonFleetMapRead);
          try {
            projected = await projectFallbackGeocodes(projected, fallbackGeocodes);
          } catch {
          }
          try {
            projected = await projectImportedGeocodes(projected, importedGeocodes, freshAudits, freshDevices, freshSourceContext);
          } catch {
            fail16("Imported address lookup results are unavailable. The map could not be refreshed.", 503);
          }
          projected = await projectReviewedAddressEstimates(projected, freshAudits, freshDevices, placementMatchKey);
          projected = await projectSourceRecordedCoordinates(projected, sourceRecorded, freshAudits, freshDevices);
          projected = await projectFieldRecorderAuthority(projectArchivedRepresentations(projected, freshArchivedRepresentations, freshAudits, freshDevices, archiveContext), freshBundle.sources, freshBundle.identity);
          const locationProofs = await validatedLocationProofs(projected, Date.now(), { originalInventory: freshSnapshot.inventoryItems });
          const savedPlacement = projectMhelpFleetLocations(mhelpReceipt ? projectMhelpFieldPlacement(projected, mhelpReceipt, freshAudits, freshBundle.identity, Date.now(), { validatedLocationProofs: locationProofs }) : projected, mhelpReceipt?.fleetLocations);
          const uploaded = projectMhelpUploadPlacement(savedPlacement, mhelpReceipt?.upload, freshAudits, freshBundle.identity, Date.now(), { validatedLocationProofs: locationProofs });
          const currentTracker = projectCurrentTrackerPlacement(uploaded.snapshot, freshAudits, freshBundle.identity, { validatedLocationProofs: locationProofs });
          const effective = projectEffectiveFleetPlacement(currentTracker, freshAudits, { confirmedPrecedenceBindings: freshSourceContext.confirmedPrecedenceBindings, authorizedUploadPlacements: uploaded.authorities });
          const combined = projectCombinedFleetRoster(effective, freshAudits, freshBundle.identity);
          const addressMap = await withMhelpAddressMap(combined, mhelpReceipt?.upload, (signal) => rpc("cos_mhelp_census_map_snapshot", actorPayload, signal), request.signal);
          const withMhelpAddress = await projectManualShop(addressMap, await rpc("cos_fleet_shop_snapshot_v1", actorPayload, request.signal));
          try {
            const candidates = await sourceEquipmentAddressCandidates(withMhelpAddress, mhelpReceipt?.upload);
            if (!candidates.length) return json({ ...withMhelpAddress, sharedFleetView: commonFleetMapRead });
            const controller = new AbortController(), deadline = Date.now() + 2e3;
            const unavailable2 = () => ({ ...withMhelpAddress, sourceEquipmentEstimates: void 0, sourceEquipmentEstimatesStatus: "unavailable" });
            let cancel = () => {
            };
            let timer;
            const stopped = new Promise((resolve2) => {
              cancel = () => {
                controller.abort();
                resolve2(unavailable2());
              };
              timer = setTimeout(cancel, 2e3);
              request.signal.addEventListener("abort", cancel, { once: true });
            });
            try {
              if (request.signal.aborted) cancel();
              const operation = (async () => {
                if (controller.signal.aborted) return unavailable2();
                const reviewed2 = await rpc("cos_source_equipment_estimates_snapshot", actorPayload, controller.signal);
                if (controller.signal.aborted || Date.now() >= deadline) return unavailable2();
                const projected2 = await projectSourceEquipmentAddressEstimates(withMhelpAddress, mhelpReceipt.upload, reviewed2?.records, reviewed2);
                return controller.signal.aborted || Date.now() >= deadline ? unavailable2() : projected2;
              })().catch(() => unavailable2());
              const result = await Promise.race([operation, stopped]);
              return json({ ...controller.signal.aborted || Date.now() >= deadline ? unavailable2() : result, sharedFleetView: commonFleetMapRead });
            } finally {
              clearTimeout(timer);
              request.signal.removeEventListener("abort", cancel);
              controller.abort();
            }
          } catch {
            return json({ ...{ ...withMhelpAddress, sourceEquipmentEstimatesStatus: "unavailable" }, sharedFleetView: commonFleetMapRead });
          }
        }
        if (snapshots[path]) return json(await rpc(snapshots[path], actorPayload));
        if (path === "/api/jobs") {
          const snapshot = withDeliveryGoBacks(await rpc("appdeploy_owner_jobs_snapshot", actorPayload), await rpc("appdeploy_delivery_go_back_snapshot", actorPayload));
          const visits = [...new Set((snapshot.items || []).map((item) => item.visitId).filter((id15) => typeof id15 === "string" && UUID7.test(id15)))];
          const assignments = visits.length ? await platformAll("visit_assignments?select=visit_id,user_id,assigned_at,job_visits!inner(organization_id)&assignment_role=eq.technician&status=in.(assigned,accepted)&visit_id=in.(" + visits.join(",") + ")&job_visits.organization_id=eq." + ORGANIZATION_ID + "&order=assigned_at.desc") : [];
          const byVisit = /* @__PURE__ */ new Map();
          for (const assignment2 of assignments) if (!byVisit.has(assignment2.visit_id)) byVisit.set(assignment2.visit_id, assignment2.user_id);
          const queue = await rpc("cos_it_queue_owner_snapshot", actorPayload);
          if (!Array.isArray(queue?.items) || queue.items.some((row2) => !UUID7.test(String(row2.visitId || "")) || row2.assignmentMode !== "it_queue" || !["scheduled", "ready", "claimed"].includes(row2.queueStatus) || (row2.queueStatus === "claimed" ? !UUID7.test(String(row2.claimOwnerId || "")) : row2.claimOwnerId != null))) fail16("Shared IT scheduling state could not be verified.", 503);
          const queueByVisit = new Map(queue.items.map((row2) => [row2.visitId, row2]));
          return json({ ...snapshot, items: (snapshot.items || []).map((item) => {
            const shared = queueByVisit.get(item.visitId);
            return { ...item, technicianUserId: byVisit.get(item.visitId) || null, assignmentMode: shared ? "it_queue" : "technician", queueStatus: shared?.queueStatus || null, claimOwnerId: shared?.claimOwnerId || null };
          }) });
        }
        const detailRoute = /^\/api\/(quotes|ar|purchasing)\/([^/]+)$/.exec(path);
        if (detailRoute) {
          const contracts = { quotes: ["quotes", "appdeploy_quote_detail", "p_quote_id"], ar: ["invoices", "appdeploy_invoice_detail", "p_invoice_id"], purchasing: ["purchase_orders", "appdeploy_purchase_order_detail", "p_purchase_order_id"] };
          const [table, name, parameter] = contracts[detailRoute[1]], id15 = idValue(detailRoute[2], "Record");
          await assertRecord(table, id15);
          return json(await rpc(name, { p_actor_user_id: context.actorId, [parameter]: id15 }));
        }
        if (path === "/api/team-production") {
          const members = await platformRead("user_profiles?select=user_id,display_name,department,active&organization_id=eq." + ORGANIZATION_ID + "&active=eq.true&department=in.(it,service)&order=display_name.asc");
          return json({ items: members.map((m) => ({ userId: m.user_id, displayName: m.display_name, department: m.department, active: m.active, linked: true })) });
        }
        if (path === "/api/owner/control-data") {
          const [sites, truckChecks, team] = await Promise.all([
            platformAll("sites?select=id,name,customer_id,customers(name)&organization_id=eq." + ORGANIZATION_ID + "&status=eq.active&order=name.asc"),
            rpc("appdeploy_owner_truck_checks_snapshot", actorPayload),
            platformRead("user_profiles?select=display_name,department&organization_id=eq." + ORGANIZATION_ID + "&active=eq.true&department=in.(it,service)&order=display_name.asc")
          ]);
          return json({ sites, truckChecks: truckChecks.items || [], serviceTechnicians: team.filter((t) => t.department === "service").map((t) => t.display_name), itTechnicians: team.filter((t) => t.department === "it").map((t) => t.display_name) });
        }
        if (path === "/api/quotes") {
          const rows4 = await platformAll("quotes?select=id,quote_number,current_version,status,issue_date,valid_until,created_at,customers(name),sites(name),quote_versions(version_number,status,total,notes,title,scope,discount_total,tax_total),jobs(job_number)&organization_id=eq." + ORGANIZATION_ID + "&order=quote_number.asc");
          const statuses3 = { draft: "Draft", review: "Pending Owner Approval", approved: "Owner Approved", sent: "Sent", accepted: "Customer Accepted", declined: "Customer Declined", changes_requested: "Customer Changes Requested", returned: "Returned by Owner" };
          return json({ items: rows4.map((r) => {
            const v = (r.quote_versions || []).find((q) => Number(q.version_number) === Number(r.current_version)) || r.quote_versions?.[0];
            const job2 = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
            return { id: r.id, quoteNumber: r.quote_number, customer: r.customers?.name || "", site: r.sites?.name || "", title: v?.title || "", description: v?.scope || v?.notes || "", amount: Number(v?.total || 0), discountTotal: Number(v?.discount_total || 0), taxTotal: Number(v?.tax_total || 0), issueDate: r.issue_date, validUntil: r.valid_until, status: statuses3[r.status] || r.status, locked: r.status !== "draft", revision: Number(r.current_version) || 1, jobNumber: job2?.job_number, activity: ["Production record \xB7 Supabase system of record"] };
          }) });
        }
        if (path === "/api/routers") {
          const [routers, units] = await Promise.all([
            legacyAll("camera_unit_routers?select=id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,current_status,last_checked_at,last_online_at,reported_status,reported_latency_ms,status_source,status_observed_at&order=id.asc", context.headers),
            platformAll("equipment_units?select=id,unit_number&organization_id=eq." + ORGANIZATION_ID + "&order=id.asc")
          ]);
          return json(routerSnapshot(routers, units));
        }
        if (path === "/api/camera-health/summary-v2") {
          const [devices, health, tracker, witnessIntegrations] = await Promise.all([
            legacyAll("camera_devices?select=id,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,source_status,source_last_seen_at,last_online_at,last_probe_online_at,activation_state,recon_battery_percent:source_metadata->battery_percent,recon_battery_updated_at:source_metadata->>battery_updated_at,recon_battery_status:source_metadata->>battery_status,recon_battery_status_updated_at:source_metadata->>battery_status_updated_at&order=id.asc", context.headers),
            legacyAll("camera_health_current?select=camera_device_id,port_status,overall_status,checked_at,ip_reachable,confirmed_outage,consecutive_failures&order=camera_device_id.asc", context.headers),
            legacyAll("equipment_master?select=canonical_family,unit_tag,source_label,tracker_state,health_provider&canonical_family=in.(Helios,Ranger,Solar Spotter,Spotter,SS Hybrid,CAMV,Sniper,Sniper 2,Sniper 4,Recon,Recon 2)&order=canonical_family.asc,unit_tag.asc,source_label.asc", context.headers),
            legacyAll("camera_integrations?select=provider,units:metadata->units&provider=eq.witness&order=provider.asc", context.headers)
          ]);
          return json(cameraSummary(devices, health, Date.now(), tracker, witnessIntegrations));
        }
        if (path === "/api/camera-health/summary-v3") {
          const readReconSources = async () => {
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5e3);
            try {
              const [integrations, snapshot] = await Promise.all([
                readJson(LEGACY_URL + "/rest/v1/camera_integrations?select=provider,enabled,last_sync_at,last_sync_status,identity_inventory:metadata->identity_inventory_v1&provider=eq.reconeyez&order=provider.asc&limit=2", { headers: context.headers, signal: controller.signal }, "Reconeyez inventory is unavailable."),
                readJson(platformUrl + "/rest/v1/rpc/appdeploy_field_map_snapshot", { method: "POST", headers: platformHeaders(), body: JSON.stringify(actorPayload), signal: controller.signal }, "Recon II tracker proof is unavailable.")
              ]);
              return { integrations: Array.isArray(integrations) ? integrations : [], units: snapshot?.inventoryItems || snapshot?.items || [] };
            } catch {
              return { integrations: [], units: [] };
            } finally {
              clearTimeout(timer);
              controller.abort();
            }
          };
          const [bundle, health, tracker, providerIntegrations, reconSources] = await Promise.all([
            readIdentitySources(context),
            legacyAll("camera_health_current?select=camera_device_id,port_status,overall_status,checked_at,ip_reachable,confirmed_outage,consecutive_failures&order=camera_device_id.asc", context.headers),
            legacyAll("equipment_master?select=canonical_family,unit_tag,source_label,tracker_state,health_provider&canonical_family=in.(Helios,Ranger,Solar Spotter,Spotter,SS Hybrid,CAMV,Sniper,Sniper 2,Sniper 4,Recon,Recon 2)&order=canonical_family.asc,unit_tag.asc,source_label.asc", context.headers),
            legacyAll("camera_integrations?select=provider,enabled,last_sync_at,last_sync_status,units:metadata->units,sweep_source:metadata->>source,sweep_complete:metadata->complete,sweep_counts_known:metadata->counts_known,sweep_eligible:metadata->eligible,sweep_scanned:metadata->scanned,sweep_published:metadata->published,sweep_held:metadata->held,sweep_reconciled_at:metadata->>reconciled_at,sweep_held_reasons:metadata->held_reasons&provider=in.(witness,vigilant,avigilon)&order=provider.asc", context.headers),
            readReconSources()
          ]);
          const { devices, audits: placementAudits } = bundle.sources, identity4 = bundle.identity;
          const witnessIntegrations = providerIntegrations.filter((row2) => row2.provider === "witness");
          const recon = await projectReconProviderIdentities(reconSources.units, devices, reconSources.integrations).catch(() => projectReconProviderIdentities([], devices, []));
          const mhelpReceipt = await readMhelpCameraPlacements(actorPayload);
          const placedDevices = mhelpReceipt ? projectMhelpCameraPlacement(devices, mhelpReceipt, placementAudits, identity4) : devices;
          const summary = { ...cameraSummary2(projectCameraOwnerPlacement(placedDevices, placementAudits), health, Date.now(), tracker, witnessIntegrations), sweepCoverage: projectCameraSweepCoverage(providerIntegrations), ...appendReconProviderIdentities(identity4, recon), ...fieldRecorderHealthGuards(bundle.sources, identity4, providerIntegrations), ...mhelpReceipt ? { mhelpPlacementSync: { lastSuccessAt: mhelpReceipt.lastSuccessAt, sheetsPublisher: false } } : {} };
          const shopRead = (inventory, current, mhelpReceipt2) => ({ inventory, mhelpReceipt: mhelpReceipt2 ?? (options.mhelpPlacementEnabled === true ? {} : null), nativeUnits: current.sources.units, devices: current.sources.devices, audits: current.sources.audits, identity: current.identity, matches: current.sources.matches, ownerClaims: current.sources.ownerCrosswalk.claims });
          return json(await currentTrackerShopScope(summary, tracker, shopRead(reconSources.units, bundle, mhelpReceipt), {
            onFallback: (reason) => console.warn("camera_shop_scope_fallback", reason),
            readSources: async (inventory, signal) => {
              const identities = inventory.map((row2) => ({ entityKind: row2.readOnly === true ? "tracker" : "equipment_unit", nativeUnitId: row2.id })), seen = /* @__PURE__ */ new Set();
              if (identities.length > 1e5 || identities.some((row2) => !UUID7.test(String(row2.nativeUnitId || ""))) || new Set(identities.map((row2) => row2.entityKind + "|" + row2.nativeUnitId)).size !== identities.length) throw Error("SHOP inventory identities are invalid.");
              const pages = new Array(Math.ceil(identities.length / 250));
              let next = 0;
              const worker = async () => {
                for (; ; ) {
                  signal.throwIfAborted();
                  const pageIndex = next++;
                  if (pageIndex >= pages.length) return;
                  const pageIds = identities.slice(pageIndex * 250, (pageIndex + 1) * 250), expected = new Set(pageIds.map((row2) => row2.entityKind + "|" + row2.nativeUnitId));
                  const page2 = await rpc("cos_geocode_sources_map_projection", { p_organization_id: ORGANIZATION_ID, p_identities: pageIds }, signal);
                  if (!Array.isArray(page2) || page2.length > pageIds.length) throw Error("SHOP source page is unavailable.");
                  for (const row2 of page2) {
                    const key2 = row2?.entityKind + "|" + row2?.nativeUnitId;
                    if (!expected.has(key2) || seen.has(key2)) throw Error("SHOP source identity changed.");
                    seen.add(key2);
                  }
                  pages[pageIndex] = page2;
                }
              };
              await Promise.all(Array.from({ length: Math.min(4, pages.length) }, worker));
              signal.throwIfAborted();
              return pages.flat();
            },
            readCurrent: async (signal) => {
              const [snapshot, current, mhelpReceipt2] = await Promise.all([rpc("appdeploy_field_map_snapshot", actorPayload, signal), readIdentitySources(context, null, signal), readMhelpCameraPlacements(actorPayload, signal)]);
              if (!Array.isArray(snapshot?.inventoryItems)) throw Error("Current SHOP inventory is unavailable.");
              return shopRead(snapshot.inventoryItems, current, mhelpReceipt2);
            }
          }));
        }
        if (path === "/api/camera-health/summary") {
          const [devices, health] = await Promise.all([
            legacyAll("camera_devices?select=id,device_name,device_type,organization,unit_key,source_status,source_last_seen_at,last_health_checked_at,activation_state&order=id.asc", context.headers),
            legacyAll("camera_health_current?select=camera_device_id,port_status,overall_status,confirmed_outage&order=camera_device_id.asc", context.headers)
          ]);
          const shopIds = new Set(devices.filter((d) => ["root", "shop"].includes(String(d.organization || "").trim().toLowerCase())).map((d) => d.id));
          const byId = new Map(health.map((h) => [h.camera_device_id, h]));
          const rows4 = devices.filter((d) => !shopIds.has(d.id)).map((d) => {
            const h = byId.get(d.id) || {}, raw = String(h.overall_status || d.source_status || "unknown").toLowerCase();
            const status2 = h.confirmed_outage === true || raw === "offline" ? "offline" : raw === "online" ? "online" : "review";
            return { id: d.id, name: d.device_name || d.unit_key || "Camera " + d.id, unit: d.unit_key || "", type: d.device_type || "", organization: d.organization || "", status: status2, checkedAt: d.source_last_seen_at || d.last_health_checked_at || null };
          }).sort((a, b) => a.name.localeCompare(b.name));
          return json({ totalDevices: devices.length, healthRows: health.length, fieldDevices: rows4.length, shopRoot: shopIds.size, online: rows4.filter((r) => r.status === "online").length, offline: rows4.filter((r) => r.status === "offline").length, review: rows4.filter((r) => r.status === "review").length, rows: rows4, refreshedAt: (/* @__PURE__ */ new Date()).toISOString(), source: "Camera Health" });
        }
        if (path === "/api/unit-camera-status") {
          if (method !== "GET") fail16("Use GET for unit camera status.", 405);
          const [cameras, integrations] = await Promise.all([
            legacyAll("camera_devices?select=id,device_name,unit_key,organization,vigilant_status,activation_state,source_last_seen_at,public_ip,star_organization_id:source_metadata->>organizationId&source=eq.vigilant_control_center&order=id.asc", context.headers),
            // A missing or unreadable sync row leaves the feed unproven, which
            // reads as Unknown rather than stopping the page.
            legacyAll("camera_integrations?select=provider,enabled,last_sync_at,last_sync_status&provider=eq.vigilant&order=provider.asc", context.headers).catch(() => [])
          ]);
          const feed = (Array.isArray(integrations) ? integrations : []).find((row2) => row2?.provider === "vigilant") || null;
          const report = applyFeedFreshness(projectUnitCameraStatus(cameras), feed && { syncedAt: feed.last_sync_at, status: feed.last_sync_status, enabled: feed.enabled }, Date.now());
          return json({ ...report, refreshedAt: (/* @__PURE__ */ new Date()).toISOString(), source: "Star4Live" });
        }
        const history = /^\/api\/field-map\/([^/]+)\/history$/.exec(path);
        if (history) {
          const id15 = idValue(history[1], "Unit");
          await assertRecord("equipment_units", id15);
          return json(await rpc("appdeploy_unit_location_history", { p_actor_user_id: context.actorId, p_unit_id: id15 }));
        }
        fail16("COS endpoint not found.", 404);
      }
      if (!body) body = await requestBody(request);
      if (["p_actor_user_id", "actorId", "organizationId", "p_organization_id"].some((k) => k in body)) fail16("Caller identity and organization are determined by sign-in.");
      const directoryRoute = /^\/api\/(customers|sites|equipment)(?:\/([^/]+))?$/.exec(path);
      if (directoryRoute) {
        const kind6 = directoryRoute[1], id15 = directoryRoute[2] ? idValue(directoryRoute[2], "Record") : null;
        const table = kind6 === "equipment" ? "equipment_units" : kind6;
        if (id15) await assertRecord(table, id15);
        let payload, name, parameter;
        if (kind6 === "customers") {
          allowedFields(body, ["name", "legalName", "notes", "status"], "Customer request");
          payload = { name: textValue(body.name, "Customer name", true, 250), legalName: textValue(body.legalName, "Legal name", false, 250), notes: textValue(body.notes, "Customer notes", false, 12e3), status: enumValue(body.status, "Status", ["active", "inactive"], "active") };
          name = "appdeploy_save_customer";
          parameter = "p_customer_id";
        } else if (kind6 === "sites") {
          const fields4 = ["customerId", "name", "addressLine1", "addressLine2", "city", "stateRegion", "postalCode", "country", "accessInstructions", "parkingInstructions", "safetyNotes", "operationalNotes", "status"];
          allowedFields(body, fields4, "Site request");
          const customerId = idValue(body.customerId, "Customer");
          await assertRecord("customers", customerId);
          payload = { customerId, name: textValue(body.name, "Site name", true, 250), status: enumValue(body.status, "Status", ["active", "inactive"], "active") };
          for (const field5 of fields4.filter((field6) => !["customerId", "name", "status"].includes(field6))) payload[field5] = textValue(body[field5], field5, false, field5.endsWith("Instructions") || field5.endsWith("Notes") ? 12e3 : 250);
          payload.country = (payload.country || "US").toUpperCase();
          if (!/^[A-Z]{2}$/.test(payload.country)) fail16("Country must use a two-letter country code.");
          name = "appdeploy_save_site";
          parameter = "p_site_id";
        } else {
          allowedFields(body, ["modelId", "unitNumber", "serialNumber", "status", "currentLocationType"], "Equipment request");
          const modelId = idValue(body.modelId, "Equipment model");
          await assertRecord("equipment_models", modelId);
          payload = { modelId, unitNumber: textValue(body.unitNumber, "Unit number", true, 160), serialNumber: textValue(body.serialNumber, "Serial number", false, 160), status: enumValue(body.status, "Equipment status", ["new", "available", "prep", "ready", "assigned", "in_transit", "installed", "returning", "intake", "repair", "quarantine", "retired"], "available"), currentLocationType: textValue(body.currentLocationType, "Location type", false, 160) };
          name = "appdeploy_save_equipment_unit";
          parameter = "p_unit_id";
        }
        return json(await rpc(name, { ...actorPayload, [parameter]: id15, p_payload: payload }), id15 ? 200 : 201);
      }
      const quoteAction = /^\/api\/quotes\/([^/]+)\/action$/.exec(path);
      if (quoteAction) {
        allowedFields(body, ["action", "reason"], "Quote review request");
        const action = enumValue(body.action, "Quote action", ["approve", "return"], null);
        const reason = textValue(body.reason, "Return reason", action === "return");
        const id15 = idValue(quoteAction[1], "Quote");
        await assertRecord("quotes", id15);
        return json(await rpc("appdeploy_review_quote_owner_approval", { p_actor_user_id: context.actorId, p_quote_id: id15, p_action: action, p_notes: reason }));
      }
      const invoiceAction = /^\/api\/ar\/([^/]+)\/action$/.exec(path);
      if (invoiceAction) {
        allowedFields(body, ["action"], "Invoice request");
        const action = enumValue(body.action, "Invoice action", ["approve", "issue"], null), id15 = idValue(invoiceAction[1], "Invoice");
        await assertRecord("invoices", id15);
        return json(await rpc(action === "approve" ? "appdeploy_approve_invoice" : "appdeploy_issue_invoice", { p_actor_user_id: context.actorId, p_invoice_id: id15 }));
      }
      const purchasingAction = /^\/api\/purchasing\/([^/]+)\/(po-review|approve|return)$/.exec(path);
      if (purchasingAction) {
        const id15 = idValue(purchasingAction[1], "Purchase order"), payload = { p_actor_user_id: context.actorId, p_purchase_order_id: id15 };
        await assertRecord("purchase_orders", id15);
        if (purchasingAction[2] === "po-review") {
          allowedFields(body, ["action", "reason"], "Purchase request review");
          const action = enumValue(body.action, "PO action", ["approve", "return"], null);
          return json(await rpc("appdeploy_review_purchase_order", { ...payload, p_action: action, p_reason: textValue(body.reason, "Return reason", action === "return") }));
        }
        allowedFields(body, [], "AP review request");
        return json(await rpc(purchasingAction[2] === "approve" ? "appdeploy_approve_purchase_for_payment" : "appdeploy_return_purchase_for_review", payload));
      }
      const gpsRoute = /^\/api\/field-map\/([^/]+)\/gps$/.exec(path);
      if (gpsRoute) {
        const id15 = idValue(gpsRoute[1], "Unit"), input2 = gps(body);
        await assertRecord("equipment_units", id15);
        return json(await rpc("appdeploy_set_unit_gps", { p_actor_user_id: context.actorId, p_unit_id: id15, p_latitude: input2.latitude, p_longitude: input2.longitude, p_accuracy_m: input2.accuracyM, p_source: input2.source, p_note: input2.note }));
      }
      if (path === "/api/owner-tasks") {
        const allowed = /* @__PURE__ */ new Set(["id", "title", "instructions", "priority", "assignedUserId", "assignedDepartment", "relatedJobId", "relatedSiteId", "dueAt", "ownerNotes"]);
        if (Object.keys(body).some((k) => !allowed.has(k))) fail16("Task request contains unsupported fields.");
        const id15 = idValue(body.id, "Task", false);
        const priority = textValue(body.priority, "Priority") || "medium";
        if (!["high", "medium", "low"].includes(priority)) fail16("Priority must be high, medium or low.");
        const dueAt = textValue(body.dueAt, "Due date", false, 100);
        if (dueAt && (!/^\d{4}-\d{2}-\d{2}T/.test(dueAt) || !Number.isFinite(Date.parse(dueAt)))) fail16("Due date must be a valid ISO timestamp.");
        if (id15) await assertRecord("owner_tasks", id15);
        const payload = { title: textValue(body.title, "Task title", true, 180), instructions: textValue(body.instructions, "Task instructions", false, 12e3), priority, assignedUserId: idValue(body.assignedUserId, "Technician", false), assignedDepartment: textValue(body.assignedDepartment, "Department"), relatedJobId: idValue(body.relatedJobId, "Job", false), relatedSiteId: idValue(body.relatedSiteId, "Site", false), dueAt, ownerNotes: textValue(body.ownerNotes, "Owner notes", false, 12e3) };
        return json(await rpc("appdeploy_save_owner_task", { ...actorPayload, p_task_id: id15, p_payload: payload }), id15 ? 200 : 201);
      }
      if (path === "/api/owner/jobs/manual") {
        allowedFields(body, ["siteId", "jobType", "title", "description", "priority", "shopPrep"], "Manual job request");
        const id15 = idValue(body.siteId, "Site");
        await assertRecord("sites", id15);
        const jobType = (textValue(body.jobType, "Job type", true) || "").toUpperCase();
        if (!["DELIVERY", "SWAP", "PICKUP", "SERVICE"].includes(jobType)) fail16("Choose Delivery, Swap, Pickup or Service.");
        const priority = textValue(body.priority, "Priority") || "normal";
        if (!["low", "normal", "high", "urgent"].includes(priority)) fail16("Choose a valid priority.");
        if (body.shopPrep != null && typeof body.shopPrep !== "boolean") fail16("Shop prep must be true or false.");
        return json(await rpc("appdeploy_owner_create_manual_job", { p_actor_user_id: context.actorId, p_site_id: id15, p_job_type: jobType, p_title: textValue(body.title, "Title", true, 250), p_description: textValue(body.description, "Description", false, 12e3), p_priority: priority, p_requires_shop_prep: body.shopPrep === true }), 201);
      }
      if (path === "/api/tv-board/settings") {
        allowedFields(body, ["sections", "expectedRevision"], "TV settings");
        let sections;
        try {
          sections = checkedTvSections(body.sections);
        } catch {
          fail16("Choose valid TV board sections.");
        }
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail16("Refresh TV settings before saving.");
        return json(await rpc("cos_tv_board_settings_save", { ...actorPayload, p_sections: sections, p_expected_revision: body.expectedRevision }));
      }
      const truck = /^\/api\/owner\/truck-checks\/([^/]+)\/approve$/.exec(path);
      if (truck) {
        allowedFields(body, ["note"], "Truck approval request");
        const id15 = idValue(truck[1], "Truck check");
        await assertRecord("truck_checks", id15);
        return json(await rpc("appdeploy_owner_approve_truck_stock", { p_actor_user_id: context.actorId, p_check_id: id15, p_note: textValue(body.note, "Owner note") }));
      }
      const advance = /^\/api\/owner\/jobs\/([^/]+)\/advance-it$/.exec(path);
      if (advance) {
        allowedFields(body, ["note", "unitNumber", "serviceTechnician", "start", "end"], "IT-to-Service request");
        const id15 = idValue(advance[1], "Job"), s = schedule(body, true);
        await assertRecord("jobs", id15);
        return json(await rpc("appdeploy_owner_advance_it_to_service", { p_actor_user_id: context.actorId, p_job_id: id15, p_note: textValue(body.note, "Owner note"), p_unit_number: textValue(body.unitNumber, "Unit number"), p_service_technician_name: textValue(body.serviceTechnician, "Technician"), p_start_local: s.start, p_end_local: s.end }));
      }
      const goBack = /^\/api\/jobs\/([^/]+)\/go-back$/.exec(path);
      if (goBack) {
        allowedFields(body, ["requestId", "reason", "remainingWork", "partsNeeded", "returnNotes"], "Go-back request");
        const id15 = idValue(goBack[1], "Job"), requestId = idValue(body.requestId, "Request");
        const reason = textValue(body.reason, "Reason"), remainingWork = textValue(body.remainingWork, "Remaining work");
        const partsNeeded = textValue(body.partsNeeded, "Parts needed"), returnNotes = textValue(body.returnNotes, "Return visit notes");
        if (!reason && !remainingWork) fail16("Add a reason or remaining work before saving a go-back.");
        await assertRecord("jobs", id15);
        return json(await rpc("appdeploy_request_delivery_go_back", {
          ...actorPayload,
          p_job_id: id15,
          p_request_id: requestId,
          p_reason: reason,
          p_remaining_work: remainingWork,
          p_parts_needed: partsNeeded,
          p_return_notes: returnNotes
        }));
      }
      const job = /^\/api\/jobs\/([^/]+)\/(schedule|assign|release-it|dispatch|close|remove|owner-review)$/.exec(path);
      if (job) {
        const fields4 = { schedule: ["start", "end", "technician", "assignmentMode"], assign: ["technician"], "release-it": [], dispatch: [], close: ["reason"], remove: ["confirmation"], "owner-review": ["action", "reason"] };
        allowedFields(body, fields4[job[2]], "Job request");
        const id15 = idValue(job[1], "Job"), payload = { p_actor_user_id: context.actorId, p_job_id: id15 };
        const record5 = await assertRecord("jobs", id15, job[2] === "remove" ? "id,job_number" : "id");
        if (job[2] === "schedule") {
          const s = schedule(body);
          const mode = enumValue(body.assignmentMode, "Assignment mode", ["technician", "it_queue"], "technician");
          if (mode === "it_queue") {
            if (body.technician != null && body.technician !== "") fail16("Choose the shared IT queue or one technician.");
            return json(await rpc("cos_schedule_shared_it_visit", { ...payload, p_start_local: s.start, p_end_local: s.end }));
          }
          return json(await rpc(body.assignmentMode === "technician" ? "cos_schedule_named_visit" : "appdeploy_schedule_current_visit", { ...payload, p_start_local: s.start, p_end_local: s.end, p_technician_name: textValue(body.technician, "Technician", true, 160) }));
        }
        if (job[2] === "assign") return json(await rpc("appdeploy_assign_current_visit", { ...payload, p_technician_name: textValue(body.technician, "Technician", true, 160) }));
        if (job[2] === "release-it") return json(await rpc("cos_release_shared_it_visit", payload));
        if (job[2] === "dispatch") return json(await rpc("cos_dispatch_shared_it_visit", payload));
        if (job[2] === "remove") {
          const confirmation = textValue(body.confirmation, "Removal confirmation", true, 160);
          if (confirmation !== "DELETE " + record5.job_number) fail16("Type DELETE followed by the exact COS Job number.");
          return json(await rpc("appdeploy_owner_delete_job", { ...payload, p_confirmation: confirmation }));
        }
        if (job[2] === "close") return json(await rpc("appdeploy_owner_close_job", { ...payload, p_reason: textValue(body.reason, "Reason") }));
        if (body.action === "approve") return json(await rpc("appdeploy_owner_approve_job_for_billing", { ...payload, p_notes: null }));
        if (body.action === "return") return json(await rpc("appdeploy_owner_return_job_for_correction", { ...payload, p_reason: textValue(body.reason, "Return reason", true) }));
        fail16("Owner Review action must be approve or return.");
      }
      fail16("COS endpoint not found.", 404);
    } catch (cause) {
      const status2 = cause instanceof PrivateEvidenceError ? cause.statusCode : cause instanceof SheetsConnectionError || cause instanceof UnitTrackerError || cause instanceof OwnerIdentityError || cause instanceof HttpError || cause instanceof InhandPilotError || cause instanceof MhelpImportError || cause instanceof MhelpPartnerError || cause instanceof MhelpTicketError ? cause.status : 503;
      return json({ error: cause instanceof PrivateEvidenceError || cause instanceof SheetsConnectionError || cause instanceof UnitTrackerError || cause instanceof OwnerIdentityError || cause instanceof HttpError || cause instanceof InhandPilotError || cause instanceof MhelpImportError || cause instanceof MhelpPartnerError || cause instanceof MhelpTicketError ? cause.message : "COS Operations is unavailable. Please retry." }, status2);
    } finally {
      if (!responseOwnsPermit) releaseLargeBody();
    }
  };
}

// tech-checks/supabase/functions/cos-unit-camera-status/servedPath.ts
var UNIT_CAMERA_STATUS_PATHS = ["/api/unit-camera-status", "/api/unit-camera-status/edit"];
var NOT_SERVED_HERE = "/api/not-served-by-this-function";
function servedEnvelopeBody(text19) {
  let envelope;
  try {
    envelope = JSON.parse(text19);
  } catch {
    return text19;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return text19;
  const record5 = envelope;
  if (typeof record5.path !== "string") return text19;
  const path = record5.path.replace(/\/$/, "");
  if (UNIT_CAMERA_STATUS_PATHS.includes(path)) return JSON.stringify({ ...record5, path });
  return JSON.stringify({ ...record5, path: NOT_SERVED_HERE });
}
function handlerUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/cos-unit-camera-status(?=\/|$)/, "/cos-operations-pages");
  return parsed.toString();
}

// tech-checks/supabase/functions/cos-unit-camera-status/serve.ts
var handler = createOperationsHandler({
  platformUrl: Deno.env.get("SUPABASE_URL"),
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
});
Deno.serve(async (request) => {
  if (request.method !== "POST") return handler(request);
  const text19 = await request.text();
  return handler(new Request(handlerUrl(request.url), { method: "POST", headers: request.headers, body: servedEnvelopeBody(text19) }));
});
