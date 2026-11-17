/** Pure sweep decisions. No addresses, credentials, or device identifiers. */

export const CELLULAR_PROBE_TIMEOUT_MS = 5000;
export const SWEEP_SHARD_DEADLINE_MS = 60000;
export const SWEEP_CRON_TIMEOUT_MS = 145000;
/** One wall clock for the whole run, under the 145s cron limit. */
export const SWEEP_RUN_DEADLINE_MS = 140000;
/** A small fleet can have a few real outages. Inconclusive only above this count AND 10%. */
export const MASS_FAILURE_FLOOR = 8;
export const HOST_ANSWERED_ERROR = "Connection refused (os error 111)";
export const PENDING_DETAIL = "Pending sweep verdict. Not a confirmed outage.";

/** Idle cellular radios often need more than 2.2s to leave sleep and finish a
 * TCP handshake. Five seconds covers that wakeup plus one retransmit. Ports
 * on a unit run together, and one retry makes the worst unit ten seconds.
 * Twelve workers and four shards fit that budget inside a 60s shard deadline,
 * and two shard waves stay inside the 145s cron timeout.
 */
export function sweepLockBusy(status, startedAt, now, timeoutMs = SWEEP_CRON_TIMEOUT_MS) {
  const started = Date.parse(startedAt);
  return status === "running" && Number.isFinite(started) && started <= now && now - started < timeoutMs;
}

/** One dedicated lock row. Missing means overlap protection is off, so the sweep must not start. */
export function sweepLockAdmission(rowCount) {
  return rowCount === 1 ? "present" : "missing";
}

export function addressBlockKey(host) {
  const parts = String(host || "").split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  const block = parts[0] + "." + parts[1];
  let hash = 5381;
  for (let i = 0; i < block.length; i++) hash = Math.imul(hash, 33) ^ block.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

export function probeClass(ports) {
  const values = Object.values(ports || {});
  if (values.some((port) => port && port.online === true)) return "online";
  if (values.some((port) => port && port.online !== true && port.error === HOST_ANSWERED_ERROR)) return "refused";
  return "miss";
}

/** A refusal is not a miss. A miss is recorded as Verifying until the sweep
 * verdict says the miss may count. */
export function publicationForProbe(klass, priorFailures) {
  const prior = Number.isInteger(priorFailures) && priorFailures >= 0 ? Math.min(3, priorFailures) : 0;
  if (klass === "online") return { status: "online", failures: 0, pending: false, confirmed: false };
  if (klass === "refused") return { status: "unknown", failures: prior, pending: false, confirmed: false };
  return { status: "verifying", failures: prior, pending: true, confirmed: false };
}

export function finalizePending(priorFailures, inconclusive) {
  const prior = Number.isInteger(priorFailures) && priorFailures >= 0 ? Math.min(3, priorFailures) : 0;
  if (inconclusive) return { status: "unknown", failures: prior, confirmed: false };
  const failures = Math.min(3, prior + 1);
  return { status: failures >= 3 ? "offline" : "verifying", failures, confirmed: failures >= 3 };
}

export function blockTallies(units) {
  const map = new Map();
  for (const unit of units) {
    if (!unit || unit.klass === "online" || !unit.blockKey) continue;
    const id = unit.klass + ":" + unit.blockKey;
    map.set(id, (map.get(id) || 0) + 1);
  }
  return [...map.entries()].map(([id, count]) => ({ klass: id.slice(0, id.indexOf(":")), key: id.slice(id.indexOf(":") + 1), count }));
}

export function mergeSweepVerdict(parts) {
  const probed = parts.reduce((sum, part) => sum + (Number.isFinite(part?.probed) ? part.probed : 0), 0);
  const failed = parts.reduce((sum, part) => sum + (Number.isFinite(part?.failed) ? part.failed : 0), 0);
  const map = new Map();
  for (const part of parts) for (const tally of part?.tallies || []) {
    if (!tally || typeof tally.klass !== "string" || typeof tally.key !== "string" || !Number.isFinite(tally.count)) continue;
    const id = tally.klass + ":" + tally.key;
    map.set(id, (map.get(id) || 0) + tally.count);
  }
  const byKlass = new Map();
  for (const [id, count] of map) {
    const klass = id.slice(0, id.indexOf(":"));
    const counts = byKlass.get(klass) || [];
    counts.push(count);
    byKlass.set(klass, counts);
  }
  let pattern = false;
  for (const counts of byKlass.values()) {
    counts.sort((a, b) => b - a);
    if (counts.length >= 3 && counts[0] >= 15 && counts[1] >= 7 && counts[2] >= 4) pattern = true;
  }
  const rate = probed > 0 && failed > MASS_FAILURE_FLOOR && failed / probed > 0.10;
  return { probed, failed, pattern, inconclusive: probed === 0 || rate || pattern };
}

/** Cleanup may touch only units this run probed. A run that checked nobody is inconclusive. */
export function cleanupTargets(checkedIds, pendingRows) {
  const checked = new Set((Array.isArray(checkedIds) ? checkedIds : []).map((id) => String(id)));
  return (Array.isArray(pendingRows) ? pendingRows : []).filter((row) => checked.has(String(row?.camera_device_id)));
}

export function zeroUnitRun(eligible) {
  return !Number.isInteger(eligible) || eligible <= 0;
}

export function phaseAllowed(now, deadline) {
  return Number.isFinite(now) && Number.isFinite(deadline) && now < deadline;
}

export function sweepGuard(units) {
  const rows = Array.isArray(units) ? units : [];
  const failed = rows.filter((unit) => unit && unit.klass !== "online").length;
  return { probed: rows.length, failed, tallies: blockTallies(rows), ...mergeSweepVerdict([{ probed: rows.length, failed, tallies: blockTallies(rows) }]) };
}
