// durable-board/runtime.mjs
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
function forgetSavedFleetPayload() {
  completed = null;
}
var safe = (value) => typeof value === "string" && SAFE.test(value) ? value : null;
var UNKNOWN = Symbol("unknown");
var RUN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var leaseAnswer = (value) => value === null ? null : value && typeof value === "object" && typeof value.id === "string" && RUN_ID.test(value.id) ? value : UNKNOWN;
var claimAnswer = (value) => !value || typeof value !== "object" ? UNKNOWN : value.claimed === false ? false : value.claimed === true && Number.isFinite(value.leaseRemainingMs) && value.leaseRemainingMs >= 0 ? value.leaseRemainingMs : UNKNOWN;
var statusAnswer = (value) => value && typeof value === "object" && value.contract === "COS_DURABLE_FLEET_RESPONSE_V1" && (value.latest === null || value.latest === void 0 || typeof value.latest === "object") ? value : UNKNOWN;
var whole = (value) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
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
    const status = statusAnswer(await rpc("cos_fleet_board_status", {}));
    if (status === UNKNOWN) continue;
    const id = status.latest?.id;
    if (!id) {
      return JSON.stringify(status);
    }
    if (completed?.id !== id) {
      const text4 = String(await payloadText(id) ?? "").trim();
      if (!text4.startsWith("{") || !text4.endsWith("}")) continue;
      completed = { id, text: text4 };
    }
    const text3 = completed.text;
    return JSON.stringify({ ...status, latest: { ...status.latest, payload: "@@COS_SAVED_FLEET_BOARD_PAYLOAD@@" } }).replace(PAYLOAD_MARK, () => text3);
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
      const value = await work();
      diagnostics.steps.push({ step: name, ok: true, ms: whole(now() - at), ...describe ? describe(value) : {} });
      return value;
    } catch (cause) {
      diagnostics.steps.push({ step: name, ok: false, ms: whole(now() - at), ...failureDetail(cause) });
      throw cause;
    }
  };
  try {
    const values = {};
    for (const [name, path, attemptMs] of SOURCES) {
      const receipt = await step(name, () => {
        if (now() >= leaseEnd - COMMIT_RESERVE_MS) throw Object.assign(Error("source_read_failed"), { detail: { kind: "batch_deadline", attempts: 0 } });
        return read(path, { attemptMs, until: leaseEnd - COMMIT_RESERVE_MS });
      }, (value2) => ({ attempts: whole(value2?.attempts) ?? 1 }));
      values[name] = receipt?.value;
      await mark();
    }
    const capturedAt = now();
    const value = await step("project", async () => project(values.health, values.map, values.connections, null, capturedAt));
    await step("commit", async () => {
      const remaining = deadline - now();
      if (remaining < COMMIT_MIN_MS) throw Object.assign(Error("commit_unconfirmed"), { detail: { kind: "batch_deadline" } });
      let published;
      try {
        published = await rpc("cos_fleet_board_finish", { p_run: run, p_producer: producer, p_payload: value, p_diagnostics: { ...diagnostics, reached: "commit", elapsedMs: whole(now() - started) } }, timeoutSignal(Math.min(COMMIT_REQUEST_MAX_MS, remaining)));
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
var dispatchFailure = (kind, attempts) => ({ version: 1, steps: [{ step: "dispatch", ok: false, kind, attempts }], reached: "dispatch", failedStep: "dispatch" });
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
    let status = statusAnswer(await rpc("cos_fleet_board_status", {}));
    if (status === UNKNOWN) {
      await sleep(1e3);
      status = statusAnswer(await rpc("cos_fleet_board_status", {}));
    }
    if (status === UNKNOWN || status.refresh?.state !== "queued") return false;
    const recorded = Date.parse(status.refresh.startedAt);
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

// src/cameraEvidence.ts
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
  if (evidence.status === "offline" && (evidence.confirmedOutage === true || Number.isInteger(evidence.consecutiveFailures) && Number(evidence.consecutiveFailures) >= 3)) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}
function combinedState(states, empty = "verifying") {
  if (!states.length) return empty;
  return states.every((state) => state === "online") ? "online" : states.every((state) => state === "offline") ? "offline" : states.some((state) => ["online", "offline", "degraded"].includes(state)) ? "degraded" : "verifying";
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

// src/savedConnectionObservation.ts
function savedConnectionObservation(row, now = Date.now()) {
  const evidence = row.serviceEvidence || (row.evidence?.kind === "service_port" ? row.evidence : void 0);
  if (evidence?.kind !== "service_port" || !cameraTimestamp(evidence.observedAt, now).fresh) return "verifying";
  if (evidence.status === "online" && evidence.reachable === true) return "online";
  if (evidence.status === "offline" && evidence.reachable !== true && (evidence.confirmedOutage === true || Number.isInteger(evidence.consecutiveFailures) && Number(evidence.consecutiveFailures) >= 3)) return "offline";
  return evidence.status === "degraded" && evidence.reachable === true ? "degraded" : "verifying";
}

// src/healthObservationTime.ts
var connectionEvidence = (row) => row.serviceEvidence || (row.evidence?.kind === "service_port" ? row.evidence : void 0);
function healthObservationTime(rows, basis, state, now = Date.now()) {
  const candidates = rows.filter((row) => basis === "connection" ? connectionEvidence(row)?.kind === "service_port" : providerRecord(row) && typeof row.activationState === "string" && row.activationState.trim().toUpperCase() === "ACTIVE" && row.evidence?.active === true && (basis === "camera" ? cameraRecord(row) : basis === "recorder" ? resourceKind(row) === "recorders" : true));
  const supporting = state === "online" || state === "offline" ? candidates.filter((row) => (basis === "connection" ? savedConnectionObservation(row, now) : basis === "camera" ? cameraState(row, now) : providerState(row, now)) === state) : candidates;
  const dates = supporting.map((row) => basis === "connection" ? connectionEvidence(row)?.observedAt : row.evidence?.observedAt).map((value) => cameraTimestamp(value, now).at).filter((value) => Boolean(value)).sort();
  return dates.at(-1) || null;
}

// src/verifiedUnitIdentity.ts
var object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var text = (value) => typeof value === "string" && value.trim() !== "";
var resourceId = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);
var sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
var immutableEnvelopes = /* @__PURE__ */ new WeakMap();
function prepareImmutableIdentityEnvelope(value) {
  validateIdentityEnvelope(value);
  const seen = /* @__PURE__ */ new WeakSet();
  const freeze = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(value);
  immutableEnvelopes.set(value, Object.freeze([...value.unitIdentities || [], ...value.ownerConfirmedUnitIdentities || [], ...value.reconProviderUnitIdentities || []]));
  return value;
}
function validateIdentityEnvelope(value) {
  if (immutableEnvelopes.has(value)) return;
  if (value.identityVersion === void 0) {
    if (value.unitIdentities !== void 0 || value.identityWarnings !== void 0 || value.ownerConfirmedIdentityVersion !== void 0 || value.ownerConfirmedUnitIdentities !== void 0 || value.reconProviderIdentityVersion !== void 0 || value.reconProviderUnitIdentities !== void 0) throw new Error("Equipment identity contract is incomplete.");
    return;
  }
  if (value.identityVersion !== 1 || value.evidenceVersion !== 2 || !Array.isArray(value.unitIdentities) || value.unitIdentities.length > 1e3) throw new Error("Equipment identity contract is unavailable.");
  if (value.ownerConfirmedIdentityVersion === void 0 ? value.ownerConfirmedUnitIdentities !== void 0 : value.ownerConfirmedIdentityVersion !== 1 || !Array.isArray(value.ownerConfirmedUnitIdentities) || value.ownerConfirmedUnitIdentities.length > 1e3 || value.ownerConfirmedUnitIdentities.some((row) => row.kind !== "owner_confirmed_native")) throw new Error("Owner-confirmed identity contract is unavailable.");
  if (value.reconProviderIdentityVersion === void 0 ? value.reconProviderUnitIdentities !== void 0 : value.reconProviderIdentityVersion !== 1 || !Array.isArray(value.reconProviderUnitIdentities) || value.reconProviderUnitIdentities.length > 1e3 || value.reconProviderUnitIdentities.some((row) => row.kind !== "reconeyez_area")) throw new Error("Reconeyez provider-area contract is unavailable.");
  if (value.unitIdentities.some((row) => ["owner_confirmed_native", "reconeyez_area"].includes(row.kind))) throw new Error("Reviewed provider identities require their additive contract.");
  for (const row of [...value.unitIdentities, ...value.ownerConfirmedUnitIdentities || [], ...value.reconProviderUnitIdentities || []]) {
    if (!object(row) || !text(row.unitId) || !text(row.unitNumber) || !["native_provider", "owner_placement", "owner_confirmed_native", "reconeyez_area"].includes(row.kind) || !Array.isArray(row.deviceIds) || !row.deviceIds.length || row.deviceIds.length > 1e3 || !row.deviceIds.every(resourceId) || !Array.isArray(row.unitKeys) || !row.unitKeys.length || !row.unitKeys.every(text) || !/^[a-f0-9]{64}$/.test(row.proof) || row.kind === "owner_placement" && !resourceId(row.placementAuditId)) throw new Error("Equipment identity proof is malformed.");
    if (row.kind === "reconeyez_area" && (!object(row.providerArea) || !Number.isSafeInteger(row.providerArea.detectorCount) || row.providerArea.detectorCount !== row.deviceIds.length || typeof row.providerArea.inventoryObservedAt !== "string" || !(row.providerArea.bridgeLastEventAt === null || typeof row.providerArea.bridgeLastEventAt === "string"))) throw new Error("Reconeyez provider-area coverage is malformed.");
  }
  if (value.identityWarnings !== void 0 && (!Array.isArray(value.identityWarnings) || value.identityWarnings.length > 1e3 || value.identityWarnings.some((row) => !object(row) || !text(row.unitId) || !text(row.reason) || row.deviceIds !== void 0 && (!Array.isArray(row.deviceIds) || !row.deviceIds.every(resourceId)) || row.unitKeys !== void 0 && (!Array.isArray(row.unitKeys) || !row.unitKeys.every(text))))) throw new Error("Equipment identity warnings are malformed.");
}
function allVerifiedUnitIdentities(value) {
  const prepared = immutableEnvelopes.get(value);
  if (prepared) return prepared;
  validateIdentityEnvelope(value);
  return [...value.unitIdentities || [], ...value.ownerConfirmedUnitIdentities || [], ...value.reconProviderUnitIdentities || []];
}
function resolve(identity, health, now = Date.now()) {
  const fail = (reason) => ({ state: "conflict", reason });
  const identities = allVerifiedUnitIdentities(health);
  if (identities.filter((x) => x.unitId === identity.unitId).length !== 1 || new Set(identity.unitKeys).size !== identity.unitKeys.length || new Set(identity.deviceIds).size !== identity.deviceIds.length) return fail("Equipment identity has duplicate or conflicting associations.");
  if (identities.some((x) => x !== identity && x.deviceIds.some((id) => identity.deviceIds.includes(id)))) return fail("A source resource is associated with more than one equipment identity.");
  const rows = health.rows.filter((row) => identity.deviceIds.includes(String(row.id)));
  if (!sameSet(rows.map((row) => String(row.id)), identity.deviceIds) || rows.some((row) => row.trackerOnly || !identity.unitKeys.includes(row.unit))) return fail("The expected source resource set is incomplete or changed.");
  const group = health.rows.filter((row) => identity.unitKeys.includes(row.unit));
  if (!sameSet(group.map((row) => String(row.id)), identity.deviceIds)) return fail("The current source group no longer matches the complete verified resource set.");
  if (identity.kind === "native_provider" && rows.some((row) => row.evidence?.kind !== "provider" || row.evidence.source !== "Star4Live" || !providerRecord(row))) return fail("The linked provider identity changed.");
  if (identity.kind === "reconeyez_area" && (!cameraTimestamp(identity.providerArea?.inventoryObservedAt, now).fresh || rows.some((row) => row.evidence?.source !== "Reconeyez" || resourceKind(row) !== "detectors" || !providerRecord(row)))) return fail("Reconeyez provider-area proof is stale or the detector source changed.");
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

// ../it-feature-availability.js
var IT_DAILY_WORKSPACES = Object.freeze(["Fleet Dashboard", "Camera Health"]);

// src/fieldRecorderObservation.ts
var object2 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var same = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && a.every((v) => typeof v === "string" && b.includes(v));
var validGuard = (v) => object2(v) && typeof v.unitId === "string" && typeof v.unitNumber === "string" && v.unitNumber.trim() !== "" && sha(v.identityProof) && Array.isArray(v.deviceIds) && v.deviceIds.length > 0 && v.deviceIds.length <= 1e3 && new Set(v.deviceIds).size === v.deviceIds.length && v.deviceIds.every((id) => typeof id === "string" && /^[1-9]\d*$/.test(id)) && Array.isArray(v.unitKeys) && v.unitKeys.length > 0 && new Set(v.unitKeys).size === v.unitKeys.length && v.unitKeys.every((key) => typeof key === "string" && key.trim() !== "") && typeof v.checkedAt === "string" && typeof v.providerSyncAt === "string";
function fieldRecorderObservation(unit, identity, rows, health, now = Date.now()) {
  const authority = unit.fieldRecorderAuthority, binding = unit.importedInstallation, guards = health.fieldRecorderObservationGuards;
  if (identity.kind !== "native_provider" || health.fieldRecorderObservationVersion !== 1 || !Array.isArray(guards) || guards.length > 5 || guards.some((g) => !validGuard(g)) || !object2(authority) || authority.schemaVersion !== 1 || !object2(binding) || unit.readOnly !== false || unit.status !== "field" || unit.currentLocationType !== "field" || unit.importedPlacement !== "FIELD" || unit.placementSource === "owner" || unit.placementAuditId || binding.sourcePrecedence || binding.schemaVersion !== 1 || binding.sourceSystem !== "mhelpdesk_product_import" || binding.entityKind !== "equipment_unit" || binding.eligibility !== "FIELD" || binding.nativeUnitId !== unit.id || binding.unitNumber !== unit.unitNumber || identity.unitId !== unit.id || identity.unitNumber !== unit.unitNumber || !cameraTimestamp(authority.checkedAt, now).fresh) return null;
  const selected = guards.filter((g) => g.unitId === unit.id);
  if (selected.length !== 1) return null;
  const guard = selected[0], sync = cameraTimestamp(selected[0].providerSyncAt, now);
  if (!sync.fresh || !sync.at) return null;
  for (const proof of [authority, guard]) if (proof.unitId !== unit.id || proof.unitNumber !== unit.unitNumber || proof.identityProof !== identity.proof || !sha(proof.identityProof) || !same(proof.deviceIds, identity.deviceIds) || !same(proof.unitKeys, identity.unitKeys) || !cameraTimestamp(proof.checkedAt, now).fresh) return null;
  if (guards.some((g) => g !== guard && (g.deviceIds.some((v) => identity.deviceIds.includes(v)) || g.unitKeys.some((v) => identity.unitKeys.includes(v))))) return null;
  for (const key of ["sourceRevision", "sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256", "eventId", "productId"]) if (typeof authority[key] !== "string" || authority[key] !== binding[key]) return null;
  if (!["sourceFileSha256", "sourceRowSha256", "addressSha256", "nativeGuardSha256"].every((k) => sha(binding[k])) || !same(rows.map((r) => String(r.id)), identity.deviceIds) || !same([...new Set(rows.map((r) => r.unit))], identity.unitKeys) || rows.some((r) => resourceKind(r) !== "recorders" || !providerRecord(r) || r.evidence?.source !== "Star4Live" || cameraTimestamp(r.evidence?.observedAt, now).at !== sync.at)) return null;
  const states = rows.map((r) => cameraTimestamp(r.evidence?.observedAt, now).fresh && ["online", "offline"].includes(r.evidence?.status || "") ? r.evidence.status : "verifying");
  const state = combinedState(states), times = rows.map((r) => cameraTimestamp(r.evidence?.observedAt, now).at).filter((v) => Boolean(v)).sort();
  return { state, basis: "recorder", label: "RECORDER " + { online: "ONLINE", offline: "OFFLINE", degraded: "MIXED / PARTLY VERIFIED", verifying: "UNVERIFIED" }[state], checkedAt: times.at(-1) || null, providerState: state, cameraState: "mapping", serviceState: "verifying" };
}

// src/fieldCameraHealth.ts
var cameraLabels = { online: "Camera records online", offline: "Camera outage observed", unknown: "Camera status unverified" };
function validateCameraHealth(value) {
  const object5 = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!object5(value) || ["totalDevices", "online", "offline", "review", "shopRoot", "healthRows", "fieldDevices"].some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0) || !Array.isArray(value.rows) || value.rows.some((r) => !object5(r) || typeof r.id !== "string" && typeof r.id !== "number" || String(r.id).trim() === "" || typeof r.name !== "string" || typeof r.unit !== "string" || !["online", "offline", "review"].includes(r.status)) || value.online + value.offline + value.review !== value.fieldDevices || !Number.isFinite(Date.parse(value.refreshedAt))) throw new Error("Camera Health returned an incomplete summary.");
  if (new Set(value.rows.map((row) => String(row.id))).size !== value.rows.length) throw new Error("Camera Health contains duplicate resource identities.");
  if (value.evidenceVersion === 2) {
    const inventory = value.inventory;
    if (!object5(inventory) || !["allRecords", "activeFieldRecords", "activeShopRecords", "inactiveRecords", "unknownScopeRecords"].every((key) => Number.isSafeInteger(inventory[key]) && inventory[key] >= 0) || inventory.allRecords !== value.totalDevices || inventory.allRecords !== value.rows.length || inventory.activeFieldRecords !== value.fieldDevices || inventory.activeShopRecords !== value.shopRoot || inventory.allRecords !== inventory.activeFieldRecords + inventory.activeShopRecords + inventory.inactiveRecords + inventory.unknownScopeRecords) throw new Error("Camera Health inventory counts could not be reconciled.");
    for (const [scope, key] of [["field", "activeFieldRecords"], ["shop", "activeShopRecords"], ["inactive", "inactiveRecords"], ["unknown", "unknownScopeRecords"]]) if (value.rows.filter((row) => row.scope === scope).length !== inventory[key]) throw new Error("Camera Health placement counts could not be reconciled.");
    for (const row of value.rows) {
      if (typeof row.activationState !== "string" || !["field", "shop", "inactive", "unknown"].includes(row.scope)) throw new Error("Camera Health placement evidence is incomplete.");
      const battery = row.batteryEvidence;
      if (battery !== void 0 && (!object5(battery) || row.evidence?.source !== "Reconeyez" || battery.source !== "Reconeyez" || battery.percent !== null && (typeof battery.percent !== "number" || !Number.isFinite(battery.percent) || battery.percent < 0 || battery.percent > 100) || ![null, "normal", "low", "critical"].includes(battery.status) || [battery.percentObservedAt, battery.statusObservedAt].some((time) => time !== null && typeof time !== "string"))) throw new Error("Recon battery evidence is malformed.");
      for (const e of [row.evidence, row.serviceEvidence].filter(Boolean)) {
        if (!object5(e) || !["provider", "service_port", "unknown"].includes(e.kind) || typeof e.source !== "string" || !["online", "offline", "degraded", "unknown"].includes(e.status) || typeof e.active !== "boolean" || !["camera", "detector", "recorder", "service", "unknown"].includes(e.resource) || [e.observedAt, e.lastOnlineAt].some((time) => time !== null && typeof time !== "string") || e.reachable !== void 0 && e.reachable !== null && typeof e.reachable !== "boolean" || e.confirmedOutage !== void 0 && typeof e.confirmedOutage !== "boolean" || e.consecutiveFailures !== void 0 && e.consecutiveFailures !== null && (!Number.isSafeInteger(e.consecutiveFailures) || e.consecutiveFailures < 0)) throw new Error("Camera Health source evidence is malformed.");
      }
    }
  } else if (value.rows.length !== value.fieldDevices) throw new Error("Camera Health returned an incomplete legacy summary.");
  validateIdentityEnvelope(value);
  return value;
}
var plain = (value) => value.trim().replace(/\s+/g, " ").toUpperCase();
var canonicalUnitCache = /* @__PURE__ */ new Map();
function canonicalCameraUnit(value) {
  const cacheable = value.length <= 512;
  if (cacheable && canonicalUnitCache.has(value)) return canonicalUnitCache.get(value);
  const result = parseCanonicalCameraUnit(value);
  if (cacheable) {
    if (canonicalUnitCache.size >= 4096) canonicalUnitCache.clear();
    canonicalUnitCache.set(value, result);
  }
  return result;
}
function parseCanonicalCameraUnit(value) {
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
  const states = cameras.map((row) => cameraState(row, now));
  const direct = ["SNIPER", "SNIPER2", "SNIPER4", "CAMV"].includes(key.split("|")[0]);
  const connection = combinedState(safeRows.map((row) => savedConnectionObservation(row, now)));
  const operational = ["field", "unknown"].includes(classification.scope);
  const state = direct ? connection === "online" ? "online" : connection === "offline" ? "offline" : "unknown" : operational && states.includes("offline") ? "offline" : operational && states.length > 0 && states.every((s) => s === "online") ? "online" : "unknown";
  const checkedAt = healthObservationTime(direct ? safeRows : cameras, direct ? "connection" : "camera", state, now);
  const location = classification.scope === "unknown" ? " LOCATION REVIEW: saved placement is unresolved." : ["shop", "inactive"].includes(classification.scope) ? " PLACEMENT CONFLICT: camera inventory says " + (classification.scope === "shop" ? "SHOP / ROOT" : "INACTIVE") + " while this unit remains in the field tracker. Confirm its physical placement; a connection result does not move the unit." : "";
  const reason = health.evidenceVersion !== 2 ? "Source-separated observations are not available in this response." : !operational ? "Shop/root or inactive inventory is excluded from operational camera colors." : state === "offline" ? "At least one matched camera/detector has a recent provider OFFLINE observation." : state === "online" ? "Reported camera/detector records are recently ONLINE. Expected channel coverage is unknown; this does not verify every camera." : cameras.length ? "Camera/detector observations are older, missing, or unverified. Silence is not a confirmed outage." : "Camera channel status unavailable. Recorder and service observations remain separate.";
  return { state, identity: "matched", rows, unitKey: rows[0].unit, checkedAt, classification, basis: direct ? "connection" : "camera", reason: (direct ? (state === "online" ? "The saved IP / port check responded." : state === "offline" ? "The saved IP / port checks confirmed no response." : "No recent definitive IP / port result is available.") + " This is connection status; camera video is not verified. Location confidence does not change this connection result." : reason) + location };
}
function unitHealthLabel(info) {
  if (info?.state === "support") return "SUPPORT EQUIPMENT \xB7 0 CAMERAS";
  if (info?.observation) return info.observation.label;
  return info?.basis === "connection" ? { online: "IP / PORT ONLINE", offline: "IP / PORT OFFLINE", unknown: "IP / PORT UNKNOWN" }[info.state] : cameraLabels[info?.state || "unknown"];
}

// shared/gpsValidation.ts
var GpsValidationError = class extends Error {
  statusCode = 400;
  constructor(message) {
    super(message);
    this.name = "GpsValidationError";
  }
};
var decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
function numeric(value, label, allowText) {
  if (allowText && typeof value === "string" && value.trim() && decimal.test(value.trim())) value = Number(value.trim());
  if (typeof value !== "number" || !Number.isFinite(value)) throw new GpsValidationError(label + " is required and must be a finite number.");
  return value;
}
function gpsCoordinates(input, allowText = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GpsValidationError("GPS coordinates are required.");
  const body = input;
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
function hasGpsCoordinates(record2) {
  try {
    gpsCoordinates(record2, true);
    return true;
  } catch {
    return false;
  }
}

// src/gpsPersistence.ts
var uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
var object3 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var stamp = (value) => typeof value === "string" ? Date.parse(value) : NaN;
function checkedFieldMap(value) {
  if (!object3(value) || !Array.isArray(value.items) || !object3(value.summary) || !Number.isFinite(stamp(value.generatedAt))) throw new Error("Field Map returned an incomplete response.");
  if (value.placementReviews !== void 0 && (!Array.isArray(value.placementReviews) || value.placementReviews.some((row) => !object3(row) || typeof row.unitNumber !== "string" || typeof row.reason !== "string" || !(row.placementAuditId === null || typeof row.placementAuditId === "string")))) throw new Error("Field placement review list is incomplete.");
  const seen = /* @__PURE__ */ new Set();
  for (const item of value.items) {
    if (!object3(item) || !uuid(item.id) || seen.has(item.id) || typeof item.unitNumber !== "string" || typeof item.status !== "string") throw new Error("Field Map returned inconsistent unit records.");
    seen.add(item.id);
  }
  for (const key of ["fieldUnits", "mappedUnits", "unitGps", "missingGps"]) {
    if (!Number.isSafeInteger(value.summary[key]) || value.summary[key] < 0) throw new Error("Field Map summary is unavailable.");
  }
  if (value.summary.fieldUnits !== value.items.length) throw new Error("Field Map returned an incomplete unit list.");
  return value;
}

// src/fleetSnapshot.ts
function inventoryPlacement(unit) {
  if (unit.effectivePlacement?.contract === "COS_EFFECTIVE_FLEET_PLACEMENT_V1" && ["field", "shop", "unknown"].includes(unit.effectivePlacement.state)) return unit.effectivePlacement.state;
  const value = String(unit.placement || unit.currentLocationType || "").toLowerCase();
  return ["shop", "root", "warehouse", "yard"].includes(value) ? "shop" : ["field", "site"].includes(value) ? "field" : "unknown";
}
function reconcileFleetSnapshot(rawHealth, rawMap, now = Date.now()) {
  const health = validateCameraHealth(rawHealth), fieldMap = checkedFieldMap(rawMap);
  const inventory = Array.isArray(fieldMap.inventoryItems) ? fieldMap.inventoryItems : fieldMap.items;
  if (new Set(inventory.map((r) => r.id)).size !== inventory.length) throw Error("Fleet inventory contains duplicate equipment identities.");
  if (fieldMap.effectivePlacementVersion === 1) {
    if (inventory.some((r) => r.effectivePlacement?.contract !== "COS_EFFECTIVE_FLEET_PLACEMENT_V1" || !["field", "shop", "unknown"].includes(r.effectivePlacement.state))) throw Error("Fleet placement evidence is incomplete.");
    const fields = inventory.filter((r) => inventoryPlacement(r) === "field" && r.activeInventoryEligible !== false);
    if (fields.length !== fieldMap.items.length || fields.some((r) => !fieldMap.items.some((f) => f.id === r.id && f.unitNumber === r.unitNumber))) throw Error("Fleet placement population does not match its field list.");
  }
  const changes = /* @__PURE__ */ new Map();
  for (const unit of inventory) {
    const placement = unit.activeInventoryEligible === false ? "inactive" : inventoryPlacement(unit), key = canonicalCameraUnit(unit.unitNumber);
    if (placement === "unknown" || inventory.filter((r) => r.id === unit.id).length !== 1) continue;
    const association = resolveVerifiedUnitIdentity(unit, health, now);
    if (association.state === "verified") {
      const proof = association.identity, rows2 = health.rows.filter((r) => proof.unitKeys.includes(r.unit));
      if (rows2.length === proof.deviceIds.length && rows2.every((r) => proof.deviceIds.includes(String(r.id)))) {
        for (const row of rows2) if (row.scope !== "inactive") changes.set(String(row.id), placement);
      }
    }
    if (!key || inventory.filter((r) => canonicalCameraUnit(r.unitNumber) === key).length !== 1) continue;
    const placeholders = health.rows.filter((r) => r.trackerOnly && r.type === "tracker_unit" && canonicalCameraUnit(r.unit) === key);
    if (placeholders.length === 1 && placeholders[0].scope !== "inactive" && health.rows.filter((r) => canonicalCameraUnit(r.unit) === key).every((r) => r.trackerOnly)) changes.set(String(placeholders[0].id), placement);
  }
  const rows = health.rows.map((r) => changes.has(String(r.id)) ? { ...r, scope: changes.get(String(r.id)) } : r);
  const count = (scope) => rows.filter((r) => r.scope === scope).length;
  const next = health.evidenceVersion === 2 ? { ...health, rows, online: rows.filter((r) => r.scope === "field" && r.status === "online").length, offline: rows.filter((r) => r.scope === "field" && r.status === "offline").length, review: rows.filter((r) => r.scope === "field" && r.status === "review").length, fieldDevices: count("field"), shopRoot: count("shop"), inventory: { allRecords: rows.length, activeFieldRecords: count("field"), activeShopRecords: count("shop"), inactiveRecords: count("inactive"), unknownScopeRecords: count("unknown") } } : health;
  validateCameraHealth(next);
  return { health: { ...next, fleetFieldUnits: inventory }, fieldMap, readAt: new Date(now).toISOString() };
}

// ../supabase/functions/cos-operations-pages/fleetShopProjection.ts
var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function manualShopItems(value) {
  if (value?.contract !== "COS_FLEET_SHOP_OVERRIDES_V1" || !Array.isArray(value.items) || value.items.length > 1e4 || value.items.some((r) => !uuid2(r.unitId) || !uuid2(r.auditId) || typeof r.unitNumber !== "string" || !r.unitNumber.trim() || r.placement !== "SHOP" || !Number.isFinite(Date.parse(r.recordedAt))) || value.items.some((r) => r.sourceBindings !== void 0 && (!Array.isArray(r.sourceBindings) || r.sourceBindings.length > 1e4 || r.sourceBindings.some((b) => !/^(?:[1-9]\d*)$/.test(b.productId) || !/^(?:[a-f0-9]{64})$/.test(b.sourceSha256)))) || new Set(value.items.map((r) => r.unitId)).size !== value.items.length) throw Error("Manual Shop placement is unavailable.");
  return value.items;
}
function manualShopInventory(upload, receipt) {
  if (!upload?.records || !receipt) return upload;
  const moves = new Map(manualShopItems(receipt).map((r) => [r.unitId, r]));
  let count = 0;
  const records = upload.records.map((r) => {
    const m = [...moves.values()].find((m2) => (m2.sourceBindings || []).some((b) => b.productId === r.productId && (b.sourceSha256 === upload.sourceSha256 || upload.source === "mhelpdesk_api" && b.sourceUnitNumber === r.unitNumber))) || (r.binding?.state === "linked" && r.binding.unitIds?.length === 1 ? moves.get(r.binding.unitIds[0]) : null);
    if (!m || r.placement === "SHOP") return r;
    count++;
    return { ...r, placement: "SHOP", cosManualShopAuditId: m.auditId };
  });
  if (!count) return upload;
  const summary = { ...upload.summary, fieldRecords: records.filter((r) => r.placement === "FIELD").length, shopRecords: records.filter((r) => r.placement === "SHOP").length, unflaggedFieldRecords: records.filter((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED").length, unflaggedShopRecords: records.filter((r) => r.placement === "SHOP" && r.uploadLifecycle === "UNFLAGGED").length };
  return { ...upload, records, summary, cosManualShopCount: count, cosPlacementBasis: "Accepted mHelp inventory plus confirmed COS Shop moves" };
}

// src/fleetDisplayAddress.ts
function recordedAddressText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value, part = (key) => typeof address[key] === "string" && address[key].length <= 600 ? address[key].trim() : "";
  return [part("street"), part("city"), [part("state"), part("zip")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// src/fleetRecordedRoster.ts
var text2 = (value, max = 512) => typeof value === "string" && value.length <= max;
var strings = (value) => Array.isArray(value) && value.length <= 1001 && value.every((v) => text2(v, 180));
var uuid3 = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function readRecordedRoster(value, inventory) {
  if (value === void 0) return { roster: null, error: null };
  const bad = () => ({ roster: null, error: "The combined equipment roster could not be verified. Recorded equipment totals are unavailable." });
  if (!value || typeof value !== "object") return bad();
  const v = value;
  if (v.contract !== "COS_COMBINED_FLEET_ROSTER_V1" || v.countBasis !== "equipment_records_with_reviewed_cross_source_links" || v.physicalDeduplication !== "incomplete" || !Array.isArray(v.items) || v.items.length > 1e4 || !v.summary || typeof v.summary !== "object") return bad();
  const ids = /* @__PURE__ */ new Set(), unitIds = /* @__PURE__ */ new Set();
  for (const r of v.items) {
    if (!r || !text2(r.id, 180) || !r.id || ids.has(r.id) || !["unit", "source_equipment", "identity_review"].includes(r.kind) || !text2(r.unitNumber, 180) || !r.unitNumber || !["field", "shop", "unknown"].includes(r.placement) || !["active", "do_not_use", "missing", "retired", "decommissioned"].includes(r.lifecycle) || typeof r.active !== "boolean" || !["mhelpdesk_api", "owner_supplied_mhelp_export", "current_tracker", "recorded_inventory", "owner"].includes(r.source) || r.observedAt !== null && (!text2(r.observedAt, 64) || !Number.isFinite(Date.parse(r.observedAt))) || !strings(r.productIds) || !strings(r.sourceRecordIds) || !strings(r.representedUnitIds) || r.customer !== null && !text2(r.customer) || r.reviewReason !== null && !text2(r.reviewReason, 2e3) || r.family !== void 0 && !text2(r.family, 180) || r.category != null && !text2(r.category, 180) || r.displayUnitNumber !== void 0 && !text2(r.displayUnitNumber, 180)) return bad();
    if (r.active && r.lifecycle !== "active" || r.kind === "identity_review" && r.placement !== "unknown" || r.kind === "source_equipment" && r.placement === "unknown") return bad();
    if (r.kind === "unit" && (r.id !== "cos_unit:" + r.unitId || !uuid3(r.unitId) || !r.unit || r.unit.id !== r.unitId || r.unit.unitNumber !== r.unitNumber || inventoryPlacement(r.unit) !== r.placement || typeof r.unit.activeInventoryEligible === "boolean" && r.unit.activeInventoryEligible !== r.active || unitIds.has(r.unitId))) return bad();
    if (r.kind !== "unit" && (r.unitId !== null || r.unit !== null || !r.id.startsWith("mhelp_product:") && !r.id.startsWith("tracker_row:"))) return bad();
    if (r.sourceAddress !== null && (!r.sourceAddress || typeof r.sourceAddress !== "object" || Array.isArray(r.sourceAddress))) return bad();
    if (r.recordedSourcePlacement !== void 0 && (!["field", "shop", "unknown"].includes(r.recordedSourcePlacement) || r.kind !== "identity_review" || r.placement !== "unknown")) return bad();
    if (r.candidateUnitIds !== void 0 && (!Array.isArray(r.candidateUnitIds) || r.candidateUnitIds.length > 1001 || !r.candidateUnitIds.every(uuid3))) return bad();
    if (r.candidatePlacements !== void 0 && (!Array.isArray(r.candidatePlacements) || r.candidatePlacements.length > 1001 || r.candidatePlacements.some((p) => !p || !uuid3(p.unitId) || !r.candidateUnitIds?.includes(p.unitId) || !text2(p.unitNumber, 180) || !["field", "shop", "unknown"].includes(p.placement) || !text2(p.source, 180) || p.observedAt !== null && (!text2(p.observedAt, 64) || !Number.isFinite(Date.parse(p.observedAt)))))) return bad();
    ids.add(r.id);
    if (r.unitId) unitIds.add(r.unitId);
  }
  for (const key of ["totalRecords", "activeRecords", "field", "shop", "review", "excludedLifecycle", "sourceOnlyRecords", "linkedUnitRecords"]) if (!Number.isSafeInteger(v.summary[key]) || v.summary[key] < 0 || v.summary[key] > 1e4) return bad();
  if (v.summary.totalRecords !== v.items.length || v.summary.activeRecords !== v.items.filter((r) => r.active).length || v.summary.field !== v.items.filter((r) => r.active && r.placement === "field").length || v.summary.shop !== v.items.filter((r) => r.active && r.placement === "shop").length) return bad();
  if (v.summary.review !== v.items.filter((r) => r.active && r.placement === "unknown").length || v.summary.excludedLifecycle !== v.items.filter((r) => !r.active).length || v.summary.sourceOnlyRecords !== v.items.filter((r) => r.kind !== "unit").length || v.summary.linkedUnitRecords !== v.items.filter((r) => r.kind === "unit").length) return bad();
  if (inventory && (inventory.length !== unitIds.size || new Set(inventory.map((row) => row.id)).size !== inventory.length || inventory.some((row) => !v.items.some((item) => item.kind === "unit" && item.unitId === row.id && item.unitNumber === row.unitNumber && item.placement === inventoryPlacement(row) && (typeof row.activeInventoryEligible !== "boolean" || item.active === row.activeInventoryEligible))))) return bad();
  return { roster: v, error: null };
}

// ../supabase/functions/cos-operations-pages/routers.ts
var ROUTER_FRESHNESS_MS = 20 * 60 * 1e3;
function routerStatus(row, now = Date.now()) {
  const observed = row.checkedAt ? Date.parse(row.checkedAt) : NaN;
  if (!Number.isFinite(observed) || observed > now) return "unknown";
  if (now - observed > ROUTER_FRESHNESS_MS) return "stale";
  return row.probeStatus === "online" ? "reachable" : row.probeStatus === "offline" ? "unreachable" : "unknown";
}

// src/fieldLocations.ts
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
    const status = lookup.status;
    if (status === "unavailable") return "Saved address lookup results are temporarily unavailable. Refresh later; existing verified locations and camera health are unchanged.";
    if (status === "not_requested") return "This placement predates automatic address lookup. Open Camera Health, review the complete installation address and save it to create the map pin.";
    if (status === "deferred") return "The free address lookup is waiting for its safe retry window. COS will retry automatically without paid lookups.";
    if (status === "held") return "Source or placement verification is pending. No approximate point is shown until the current installation source is verified.";
    if (status === "pending") return "Installation saved. Address lookup is pending; background processing runs every 15 minutes.";
    if (status === "invalid_address") return "Add a complete installation street, city, state and ZIP in Camera Health \u2192 Edit field address.";
    if (status === "no_match") return "No single exact address matched. Correct the installation address or manually verify the installation pin.";
    if (status === "provider_error") return lookup.attempts >= 3 ? "Address lookup failed after three attempts. Correct and save the address to retry, or verify the installation pin." : "The address service is unavailable. COS will retry automatically; camera health is unchanged.";
  }
  if (isCurrentFieldPin(unit)) return unit.coordinateSource === "site" ? "An owner confirmed an address-derived pin. It is not a live GPS observation." : "An owner confirmed this pin for the recorded address. It is not live router GPS.";
  if (historicalFieldCoordinates(unit)) return "Historical coordinates are preserved for review and excluded from the current map and nearby-unit results. Confirm the actual installation location before using them.";
  return unit.address?.trim() ? "Address-based location. Coordinates pending verification." : "No installation address or coordinates are recorded.";
}

// ../supabase/functions/cos-operations-pages/vrmSafePower.ts
var rules = { battery_soc: ["%", 0, 100], battery_voltage: ["V", 0, 200], battery_current: ["A", -1e4, 1e4], battery_power: ["W", -1e6, 1e6], solar_power: ["W", 0, 1e6], load_power: ["W", -1e6, 1e6], low_voltage_alarm: ["state", 0, 2], low_soc_alarm: ["state", 0, 2], high_voltage_alarm: ["state", 0, 2] };
function safeVrmPower(value, items, now = Date.now()) {
  if (!Array.isArray(value) || value.length > 1e3) throw Error("Power evidence unavailable");
  const seen = /* @__PURE__ */ new Set();
  return value.flatMap((r) => {
    if (!r || !Number.isSafeInteger(r.installationId) || seen.has(r.installationId) || !Array.isArray(r.measurements) || r.measurements.length > 40) throw Error("Power evidence inconsistent");
    seen.add(r.installationId);
    if (items.filter((i) => i.installationId === r.installationId && i.name === r.name).length !== 1 || typeof r.name !== "string" || !/^HELIOS\s+\d{1,3}$/i.test(r.name)) return [];
    const measurements = r.measurements.map((m) => {
      const rule = rules[m?.metric], time = Date.parse(m?.observedAt);
      if (!rule || m.unit !== rule[0] || typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < rule[1] || m.value > rule[2] || !Number.isFinite(time) || time < Date.UTC(2e3, 0, 1) || time > now + 3e5 || !Number.isSafeInteger(m.instance) || m.instance < 0 || m.instance > 1e3 || !["system", "battery", "solarcharger"].includes(m.source)) throw Error("Power measurement invalid");
      return { metric: m.metric, value: m.value, unit: m.unit, observedAt: m.observedAt, instance: m.instance, source: m.source };
    });
    const error = r.errorCode;
    if (error !== null && !["access", "provider", "rate_limit", "invalid_response", "no_data"].includes(error)) throw Error("Power read state invalid");
    if (r.lastAttemptAt !== null && (typeof r.lastAttemptAt !== "string" || !Number.isFinite(Date.parse(r.lastAttemptAt)))) throw Error("Power read time invalid");
    return [{ installationId: r.installationId, name: r.name, measurements, lastAttemptAt: r.lastAttemptAt, errorCode: error }];
  });
}

// ../supabase/functions/cos-operations-pages/vrm.ts
var VRM_MAX_INSTALLATIONS = 5e3;
var vrmPortalUrl = (id) => "https://vrm.victronenergy.com/installation/" + id + "/dashboard";
var validInstallationId = (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
var validVrmName = (name) => typeof name === "string" && name.trim() === name && name.length > 0 && name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name);
var validTime = (value) => value === null || typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value));
var unconfiguredVrmSync = () => ({ state: "not_configured", lastAttemptAt: null, lastSuccessAt: null, nextSyncAt: null, error: null, scheduleActive: false, connectionConfigured: false });
function validVrmEmbed(value, id) {
  if (typeof value !== "string" || value.length > 2048 || !validInstallationId(id)) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://vrm.victronenergy.com" && !url.username && !url.password && !url.hash && new RegExp("^/installation/" + id + "/embed/[A-Za-z0-9_-]+/?$").test(url.pathname);
  } catch {
    return false;
  }
}
function readVrmFleetConfig(value) {
  const data = value;
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

// src/fleetDashboardModel.ts
var combine = (states) => states.includes("offline") ? "offline" : states.length && states.every((x) => x === "online") ? "online" : "unknown";
function fleetDashboardRows(units, health, routers, vrm, now = Date.now()) {
  const power = vrm && Array.isArray(vrm.items) && Array.isArray(vrm.power) ? safeVrmPower(vrm.power, vrm.items, now) : [];
  return units.map((unit) => {
    const key = canonicalCameraUnit(unit.unitNumber), family = key?.split("|")[0] || unit.modelName || "Other equipment", support = isSupportEquipment(unit), placement = inventoryPlacement(unit);
    const camera = fieldCameraHealth(unit, units, health, now), linkedRouters = (routers || []).filter((r) => r.match === "exact_name" && r.candidateUnit?.id === unit.id);
    const routerStates = linkedRouters.map((r) => routerStatus(r, now)).map((s) => s === "reachable" ? "online" : s === "unreachable" ? "offline" : "unknown");
    const matches = key?.startsWith("HELIOS|") ? power.filter((r) => canonicalCameraUnit(r.name) === key) : [];
    const p = matches.length === 1 && vrm.items.filter((item) => canonicalCameraUnit(item.name) === key).length === 1 && units.filter((u) => canonicalCameraUnit(u.unitNumber) === key).length === 1 ? matches[0] : null;
    const installation = p ? vrm.items.find((item) => item.installationId === p.installationId && canonicalCameraUnit(item.name) === key) : null;
    const vrmInstallation = installation ? { ...installation, embedUrl: installation.sharingEnabled !== false && installation.available !== false && validVrmEmbed(installation.embedUrl, installation.installationId) ? installation.embedUrl : null } : null;
    let batteryState = "not_available", batteryPercent = null, batteryReadings = [];
    const batteryReadIssue = key?.startsWith("HELIOS|") ? p?.errorCode || vrm?.sync?.error || vrm?.sync?.state === "error" ? "Latest Victron read unavailable" : vrm?.sync?.state === "stale" ? "Victron sync is stale" : null : null;
    if (key?.startsWith("HELIOS|")) {
      batteryState = "unknown";
      batteryReadings = (p?.measurements || []).filter((m) => m.metric === "battery_soc").map((m) => ({ source: "Victron \xB7 " + m.source + " " + m.instance, percent: m.value, observedAt: cameraTimestamp(m.observedAt, now).at, fresh: cameraTimestamp(m.observedAt, now).fresh }));
      if (p && !batteryReadIssue) {
        const recent = p.measurements.filter((m) => cameraTimestamp(m.observedAt, now).fresh), soc = recent.filter((m) => m.metric === "battery_soc");
        batteryPercent = soc.length ? Math.min(...soc.map((m) => m.value)) : null;
        batteryState = recent.some((m) => m.unit === "state" && m.value > 0) || batteryPercent !== null && batteryPercent < 20 ? "offline" : batteryPercent !== null ? "online" : "unknown";
      }
    } else if (key?.startsWith("RECON2|")) {
      const batteryRows = camera.identity === "matched" ? camera.rows.filter((r) => r.evidence?.source === "Reconeyez" && r.batteryEvidence) : [];
      const readings = batteryRows.map((r) => r.batteryEvidence).filter(Boolean);
      batteryReadings = batteryRows.filter((r) => r.batteryEvidence.percent !== null).map((r) => ({ source: "Reconeyez \xB7 " + r.name, percent: r.batteryEvidence.percent, observedAt: cameraTimestamp(r.batteryEvidence.percentObservedAt, now).at, fresh: cameraTimestamp(r.batteryEvidence.percentObservedAt, now).fresh }));
      const values = readings.filter((b) => b?.percent !== null && cameraTimestamp(b?.percentObservedAt, now).fresh).map((b) => b.percent);
      batteryPercent = values.length ? Math.min(...values) : null;
      batteryState = combine(readings.map((b) => cameraTimestamp(b?.statusObservedAt, now).fresh && b?.status ? b.status === "normal" ? "online" : "offline" : cameraTimestamp(b?.percentObservedAt, now).fresh && b?.percent !== null ? b.percent < 20 ? "offline" : "online" : "unknown"));
    }
    const locationVerified = isCurrentFieldPin(unit), locationNeedsReview = placement === "field" && !locationVerified;
    const review = [...placement === "unknown" ? ["Placement is unresolved. Check tracker and current mHelpDesk assignment."] : [], ...camera.state === "unknown" ? [camera.reason] : [], ...locationNeedsReview ? [locationExplanation(unit)] : [], ...unit.mhelpLocationReviewReason ? [String(unit.mhelpLocationReviewReason)] : []];
    const providers = [...new Set(camera.rows.map((r) => r.evidence?.source).filter(Boolean))];
    return { unit, id: unit.id, name: unit.unitNumber, displayName: unit.uploadDisplayUnitNumber || unit.unitNumber, family, provider: providers.join(" / ") || "Unmatched provider", placement, retired: unit.activeInventoryEligible === false || ["retired", "decommissioned", "deleted", "stolen"].includes(String(unit.status || "")), support, camera, cameraState: camera.state, routerState: routers ? combine(routerStates) : "unknown", batteryState, batteryPercent, batteryReadIssue, batteryReadings, routers: linkedRouters, power: p, vrmInstallation, locationVerified, locationNeedsReview, review };
  });
}

// src/mhelpInventoryAuthority.ts
var INVENTORY_FREEZE_CONTRACT = "COS_INVENTORY_FREEZE_V1";
function acceptedFreeze(value, observedAt, now) {
  const f = value.frozen;
  if (!record(f) || f.contract !== INVENTORY_FREEZE_CONTRACT || f.sourceSha256 !== value.sourceSha256 || typeof f.acceptedAt !== "string" || !Number.isFinite(Date.parse(f.acceptedAt)) || Date.parse(f.acceptedAt) > now + 6e4 || Date.parse(f.acceptedAt) < Date.parse(observedAt) || typeof f.acceptedBy !== "string" || !f.acceptedBy.trim() || f.acceptedBy.length > 120) return null;
  return { acceptedAt: f.acceptedAt, acceptedBy: f.acceptedBy.trim() };
}
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
  const frozen = acceptedFreeze(value, observedAt, now);
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
    // While automatic inventory changes are paused, an Owner-accepted freeze of
    // this exact census keeps it usable; its age is still reported by receivedAt.
    stale: frozen ? false : now - Date.parse(observedAt) > (live ? 45 * 60 * 1e3 : 24 * 60 * 60 * 1e3),
    ...frozen ? { frozen } : {}
  };
}

// src/fieldProductEvidence.ts
function fieldProductEvidence(row, state, now = Date.now(), exact = null, requiredConnectionUnavailable = false) {
  if (exact && exact.status !== "unknown" && exact.status === state && exact.resourceId && cameraTimestamp(exact.checkedAt, now).fresh) {
    return {
      gap: null,
      association: "exact_product_id_tracker_endpoint",
      basis: "connection",
      observedAt: exact.checkedAt,
      video: "not_verified",
      observations: [{ resourceId: exact.resourceId, source: "Saved TCP/service-port check", kind: "connection", observedAt: exact.checkedAt, fresh: true, reportedStatus: exact.status, currentState: exact.status }]
    };
  }
  if (exact?.status === "unknown" && state === "unverified") {
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
  const camera = row?.camera, linked = Boolean(camera?.association);
  const observations = [];
  if (linked) for (const resource of camera.rows) {
    for (const [kind, evidence] of [["provider", resource.evidence], ["connection", resource.serviceEvidence]]) {
      if (!evidence || evidence.kind === "unknown") continue;
      const stamp2 = cameraTimestamp(evidence.observedAt, now);
      observations.push({
        resourceId: String(resource.id),
        source: evidence.source,
        kind: kind === "connection" ? "connection" : evidence.resource || "unknown",
        observedAt: stamp2.at,
        fresh: stamp2.fresh,
        reportedStatus: evidence.status,
        currentState: kind === "connection" ? savedConnectionObservation(resource, now) : evidence.resource === "camera" || evidence.resource === "detector" ? cameraState(resource, now) : providerState(resource, now)
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

// ../supabase/functions/cos-operations-pages/cameraEvidence.ts
var CAMERA_FRESH_MS2 = 20 * 60 * 1e3;

// src/exactProductConnection.ts
var EXACT_PRODUCT_CONNECTION_CONTRACT = "COS_EXACT_PRODUCT_CONNECTIONS_V2";
var ID = /^[1-9][0-9]{0,14}$/;
var HASH = /^[a-f0-9]{64}$/;
var SOURCE_FRESH_MS = 30 * 60 * 1e3;
var FROZEN_SOURCE_MAX_MS = 3650 * 24 * 60 * 60 * 1e3;
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
function readExactProductConnections(value, sourceSha256, expectedFieldIds, now = Date.now()) {
  if (!object4(value) || value.contract !== EXACT_PRODUCT_CONNECTION_CONTRACT || value.sourceSha256 !== sourceSha256 || !HASH.test(sourceSha256) || !safeTime(value.trackerVerifiedAt, now, safeTime(value.inventoryFrozenAt, now, FROZEN_SOURCE_MAX_MS) ? FROZEN_SOURCE_MAX_MS : SOURCE_FRESH_MS) || !Array.isArray(value.items) || value.items.length < expectedFieldIds.length || value.items.length > 1e4) return null;
  const expected = new Set(expectedFieldIds);
  if (expected.size !== expectedFieldIds.length) return null;
  const result = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set();
  for (const raw of value.items) {
    if (!object4(raw) || !ID.test(raw.productId) || seen.has(raw.productId) || !["online", "offline", "unknown"].includes(raw.status) || raw.basis !== "tcp_service_port" || typeof raw.reason !== "string" || raw.reason.length > 300 || !(raw.resourceId === null || deviceId(raw.resourceId) === raw.resourceId)) return null;
    if (raw.status === "unknown" && (raw.resourceId !== null || raw.checkedAt !== null)) return null;
    const observed = raw.status === "unknown" ? null : cameraTimestamp(raw.checkedAt, now);
    if (raw.status !== "unknown" && (!raw.resourceId || !observed?.at)) return null;
    seen.add(raw.productId);
    if (expected.has(raw.productId)) result.set(raw.productId, observed && !observed.fresh ? unknown(raw.productId, "The saved connection check has expired; awaiting the next automatic check.") : raw);
  }
  return result.size === expected.size ? result : null;
}

// src/fieldProductFollowUp.ts
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
  const exact = knownReason(exactUnknownReason);
  if (state === "support") return exact && ["source_review", "endpoint_ownership"].includes(exact.category) ? { ...exact } : null;
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

// src/mhelpFieldHealth.ts
var PROVIDER_REPORTED = "Provider-reported, not direct-connection verified. ";
var DIRECT_SOURCE_GAP = "No direct connection check is available (the Product-ID connection source is unavailable, stale or does not match the current inventory). ";
var CURRENT_SOURCE_CONFLICT = "Current direct connection and verified provider status disagree. No outage is assigned until the sources agree. ";
var fieldHealthLabels = { online: "Online", offline: "Offline", unverified: "Health unverified", support: "Solar / support \u2014 no cameras", unlinked: "Health not linked", review: "Identity / placement review", inactive: "Do Not Use / Missing / inactive" };
function mhelpFieldHealth(value, roster, rows, now = Date.now(), exactConnectionReceipt = void 0) {
  const authority = readMhelpInventoryAuthority(value, now);
  if (!authority || !roster || !readRecordedRoster(roster).roster) return null;
  const products = value.records.filter((item) => item.placement === "FIELD");
  const counts = Object.fromEntries(Object.keys(fieldHealthLabels).map((key) => [key, 0]));
  const connections = readExactProductConnections(exactConnectionReceipt, authority.sourceSha256, products.map((product2) => product2.productId), now);
  const items = products.map((product2) => {
    const related = roster.items.filter((item) => item.productIds.includes(product2.productId));
    const record2 = related.length === 1 ? related[0] : null;
    const matches = record2?.unitId ? rows.filter((row2) => row2.id === record2.unitId) : [];
    const row = matches.length === 1 ? matches[0] : null;
    const binding = product2.binding;
    const label = typeof product2.unitNumber === "string" && product2.unitNumber.trim() ? product2.unitNumber : "Product " + product2.productId;
    const exact = connections?.get(product2.productId);
    const support = Boolean(row?.support) || isSupportEquipment({ id: product2.recordId, unitNumber: label, modelName: typeof product2.category === "string" ? product2.category : void 0 });
    const exactResourceVerified = Boolean(record2?.kind === "unit" && row?.camera.association && exact?.resourceId && row.camera.association.deviceIds.includes(String(exact.resourceId)));
    const exactAllowed = Boolean(exact && exact.status !== "unknown" && !support && related.length === 1 && record2?.kind === "unit" && row && exactResourceVerified && record2.placement === "field" && record2.active && record2.lifecycle === "active" && record2.productIds.length === 1 && record2.productIds[0] === product2.productId && row.placement === "field" && !row.retired && binding?.state === "linked" && Array.isArray(binding.unitIds) && binding.unitIds.includes(record2.unitId));
    const directSourceUnavailable = exactConnectionReceipt !== void 0 && !connections;
    const reviewedProvider = Boolean(record2?.kind === "unit" && row && row.camera.association && ["online", "offline"].includes(row.cameraState));
    let state, reason;
    if (product2.uploadLifecycle !== "UNFLAGGED") {
      state = "inactive";
      reason = product2.uploadLifecycle === "MISSING" ? "Marked Missing in the reviewed mHelpDesk source." : "Marked Do Not Use in the reviewed mHelpDesk source.";
    } else if (record2?.kind === "identity_review" || record2 && record2.placement !== "field" || binding?.state === "held" || binding?.placementHeld === true || binding?.candidateUnitIds?.length) {
      state = "review";
      reason = record2?.reviewReason || "The saved identity or physical placement needs review. Health from a possible match is not assigned to this product.";
    } else if (record2 && (!record2.active || record2.lifecycle !== "active" || row?.retired)) {
      state = "inactive";
      reason = "The associated COS inventory is inactive. A successful connection does not reactivate it.";
    } else if (record2?.kind === "unit" && (!row || matches.length !== 1 || record2.productIds.length !== 1 || binding?.state !== "linked" || !Array.isArray(binding.unitIds) || !binding.unitIds.includes(record2.unitId) || row.placement !== "field")) {
      state = "review";
      reason = "The complete, unique product-to-unit association could not be verified.";
    } else if (support) {
      state = "support";
      reason = "Solar stand or support equipment with no camera channels. Camera online/offline status does not apply.";
    } else if (exactConnectionReceipt !== void 0 && !connections || exact?.status === "unknown" && connections) {
      if (reviewedProvider) {
        state = row.cameraState === "online" ? "online" : "offline";
        reason = PROVIDER_REPORTED + (directSourceUnavailable ? DIRECT_SOURCE_GAP : "No direct connection result: " + exact.reason + " ") + unitHealthLabel(row.camera) + ". " + row.camera.reason;
      } else {
        state = "unverified";
        reason = directSourceUnavailable ? "The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown." : exact.reason;
      }
    } else if (exactAllowed && exact) {
      if (reviewedProvider && row.cameraState !== exact.status) {
        state = "unverified";
        reason = CURRENT_SOURCE_CONFLICT + "Direct: " + exact.reason + " Provider: " + unitHealthLabel(row.camera) + ".";
      } else {
        state = exact.status === "online" ? "online" : "offline";
        reason = exact.reason;
      }
    } else if (!record2) {
      state = "review";
      reason = related.length ? "Multiple COS representations claim this Product ID." : "No current COS roster representation is available for this Product ID.";
    } else if (record2.kind !== "unit") {
      state = "unlinked";
      reason = "The Field assignment is recorded, but it has no verified COS health link. It is not counted as an outage.";
    } else if (!row.camera.association) {
      state = "unlinked";
      reason = "Device link needed. The Product ID has a COS inventory association, but its complete provider-resource association is not verified. A matching device name cannot supply current product health. " + row.camera.reason;
    } else {
      state = row.cameraState === "online" ? "online" : row.cameraState === "offline" ? "offline" : "unverified";
      reason = unitHealthLabel(row.camera) + ". " + row.camera.reason;
    }
    counts[state]++;
    const useExactEvidence = Boolean(exact && (exactAllowed && state === exact.status || state === "unverified" && exact.status === "unknown"));
    const evidence = fieldProductEvidence(state === "review" || record2?.kind !== "unit" ? null : row, state, now, useExactEvidence && exact ? exact : null, exactConnectionReceipt !== void 0 && !connections);
    const followUp = fieldProductFollowUp(state, reason, exact?.status === "unknown" ? exact.reason : void 0, directSourceUnavailable);
    if (followUp) evidence.followUp = followUp;
    return { productId: product2.productId, unitNumber: label, state, reason, unitId: state !== "review" && record2?.kind === "unit" && row ? row.id : null, recordId: record2?.kind !== "unit" ? record2?.id || null : null, evidence };
  });
  return { total: authority.field, counts, items, receivedAt: authority.receivedAt, sourceSha256: authority.sourceSha256 };
}

// src/mhelpProviderFleet.ts
var providerOrder = ["star4live", "avigilon", "reconeyez", "walle", "support", "other"];
var clean = (value) => typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
function mhelpProviderFamily(category, unitNumber) {
  const key = clean(category) || clean(unitNumber);
  if (/^(SOLARSTAND|SOLARPOLE|STAND|STANDS|SKID|SOLARSKID|SOLARPOLESKID)/.test(key)) return "support";
  if (/^(SNIPER|CAMV|RSU|RADARSNIPER)/.test(key)) return "avigilon";
  if (/^RECON/.test(key)) return "reconeyez";
  if (/^WALLE/.test(key)) return "walle";
  if (/^(SOLARSPOTTER|SPOTTER|RANGER|HELIOS)/.test(key)) return "star4live";
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
  for (const product2 of products) {
    const provider = mhelpProviderFamily(product2.category, product2.unitNumber);
    const linked = healthById.get(product2.productId) || null;
    const healthStatus = provider === "support" ? "not_applicable" : usable && (linked?.state === "online" || linked?.state === "offline") ? linked.state : "unverified";
    const reason = provider === "support" ? "Support equipment has no camera-health requirement. Verify its power separately." : !usable ? "Latest Field camera health is unavailable. No offline condition is inferred." : product2.uploadLifecycle && product2.uploadLifecycle !== "UNFLAGGED" ? "Source is marked Do Not Use / Missing. Do not activate from a saved connection." : linked?.reason || "No verified Product-ID-to-camera association. Not counted as an outage.";
    const group = groupByProvider.get(provider);
    group.count++;
    group.counts[healthStatus]++;
    group.items.push({
      productId: product2.productId,
      unitNumber: product2.unitNumber || "Product " + product2.productId,
      category: product2.category || "Not classified",
      customer: product2.customer || "",
      provider,
      healthStatus,
      reason,
      linked
    });
  }
  if (groups.reduce((total, group) => total + group.count, 0) !== authority.field) throw Error("Field provider totals do not reconcile to mHelp Product IDs.");
  return { total: authority.field, healthVerified: usable, receivedAt: authority.receivedAt, stale: authority.stale, groups };
}

// src/fleetCommandCenterModel.ts
function buildFleetCommandCenter(upload, fieldHealth, healthReadSucceeded, rows, addressMap, vrm, now = Date.now(), cameraCheckedAt = null) {
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
    const address = (addressById.get(p.productId) || recordedAddressText(location) || "").trim();
    const status = group.provider === "support" ? "not_applicable" : p.healthStatus;
    return {
      ...p,
      status,
      system: group.provider,
      address,
      site: typeof source.site === "string" ? source.site : "",
      mappingIssue: Boolean(validAddresses) && !points.has(p.productId),
      lifecycle: typeof source.uploadLifecycle === "string" ? source.uploadLifecycle : "UNFLAGGED"
    };
  }));
  if (items.length !== authority.field || new Set(items.map((p) => p.productId)).size !== authority.field)
    throw Error("Field inventory violates unique Product-ID accounting.");
  const count = (status) => items.filter((p) => p.status === status).length;
  const counts = {
    online: count("online"),
    offline: count("offline"),
    unverified: count("unverified"),
    support: count("not_applicable"),
    attention: items.filter((p) => p.status === "offline" || p.status === "unverified" || p.mappingIssue).length,
    unmapped: validAddresses ? validAddresses.unlocated : 0
  };
  if (counts.online + counts.offline + counts.unverified + counts.support !== authority.field || authority.field + authority.shop !== authority.total) throw Error("Fleet accounting does not reconcile.");
  const panels = ["star4live", "avigilon", "reconeyez"].map((key) => {
    const group = provider.groups.find((g) => g.provider === key);
    return {
      key,
      title: key === "star4live" ? "Star4Live" : key === "avigilon" ? "Avigilon" : "Recon / Recon II",
      count: group.count,
      counts: group.counts,
      products: items.filter((p) => p.system === key),
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
    const unitRows = p.linked?.unitId ? rows.filter((r) => r.id === p.linked?.unitId) : [];
    const row = unitRows.length === 1 ? unitRows[0] : null;
    const power = row?.power;
    const available = config?.items.filter((i) => i.installationId === power?.installationId && i.name === power?.name) || [];
    const recent = power?.measurements.some((m) => cameraTimestamp(m.observedAt, now).fresh) === true;
    const unique = Boolean(power && available.length === 1 && !seenInstallations.has(power.installationId));
    if (unique && power) seenInstallations.add(power.installationId);
    const status = unique && recent && !power?.errorCode && config?.sync.state === "current" ? "online" : "unverified";
    vrmCounts[status]++;
    const reason = status === "online" ? "Fresh, uniquely linked Victron telemetry. A low battery is an alert, not an offline camera." : !p.linked?.unitId ? "This mHelp Product ID has no currently usable verified COS equipment association for Victron telemetry. Review the Product ID / COS link." : !power ? "The verified COS unit has no unique matching Victron installation record. Check the approved installation ID." : !unique ? "The Victron installation association is duplicated or cannot be confirmed against the current installation roster." : Boolean(power.errorCode) ? "The saved Victron power read contains an error. Recheck the provider connection." : config?.sync.state !== "current" ? "The Victron fleet sync is not current. Await a successful refresh before verifying power." : !recent ? "The saved Victron measurement is stale or missing. No current power status is inferred." : "Victron power status is not yet verified.";
    return { ...p, status, reason };
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
    counts,
    panels,
    addressCoverage: validAddresses ? { located: validAddresses.pins.length, missing: validAddresses.unlocated } : null
  };
}

// src/cameraFieldProducts.ts
function cameraFieldProducts(map, health, now, readSucceeded = true) {
  if (!map) return null;
  const inventory = map.inventoryItems || map.items || [];
  const roster = readRecordedRoster(map.fleetRoster, inventory).roster;
  const upload = manualShopInventory(map.uploadInventory, map.manualPlacementOverrides);
  const rows = fleetDashboardRows(inventory, health, null, null, now).map((row) => {
    const item = roster?.items.find((item2) => item2.unitId === row.id);
    return { ...row, retired: item ? !item.active : row.retired };
  });
  const field = mhelpFieldHealth(upload, roster, rows, now, map.productConnections);
  return buildFleetCommandCenter(upload, field, readSucceeded, rows, null, null, now, health.refreshedAt || null);
}

// durable-board/project.ts
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
export {
  COMMIT_REQUEST_MAX_MS,
  COMMIT_RESERVE_MS,
  FLEET_BATCH_BUDGET_MS,
  FLEET_LEASE_MS,
  UNCERTAIN_DELIVERY_GRACE_MS,
  acceptFleetBatch,
  claimFleetBatch,
  completedBoard,
  continueQueuedFleetBoard,
  forgetSavedFleetPayload,
  produceFleetBoard,
  runFleetBatch,
  savedFleetBoard,
  savedFleetResponse,
  startFleetBatch
};
