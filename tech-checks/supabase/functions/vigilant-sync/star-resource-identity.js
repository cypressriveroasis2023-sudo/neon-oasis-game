/* Pure provider observation join. Never infer identity from a display name. */
export function starResourceStatus(value) {
  if (value === 1 || value === "1") return "online";
  if (value === 0 || value === "0") return "offline";
  return "unknown";
}

const identity = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const diagnosticText = (value, limit) => typeof value === "string" ? value.slice(0, limit) : typeof value === "number" && Number.isFinite(value) ? String(value).slice(0, limit) : null;
function index(rows, key) {
  const out = new Map();
  for (const row of rows) {
    const id = identity(row[key]);
    if (id) out.set(id, [...(out.get(id) || []), row]);
  }
  return out;
}

export function resolveStarResources(resources, locals) {
  const serials = index(locals, "device_serial"), external = index(locals, "external_device_id");
  const ids = new Map();
  for (const row of locals) ids.set(String(row.id), (ids.get(String(row.id)) || 0) + 1);
  const byResource = new Map(), candidates = new Map(), conflicts = new Map(), unmatched = [], resourceStatuses = [];
  function conflict(device, reason, observations) {
    const value = conflicts.get(device.id) || { device, reasons: new Set(), resources: new Map() };
    value.reasons.add(reason);
    for (const resource of observations) {
      const key = identity(resource.deviceSerial) + "|" + starResourceStatus(resource.status);
      value.resources.set(key, {
        serial: diagnosticText(resource.deviceSerial, 200) || "",
        name: diagnosticText(resource.deviceName, 300) || "",
        status: starResourceStatus(resource.status),
        publicIp: diagnosticText(resource.publicIp, 64),
        model: diagnosticText(resource.deviceModel, 120),
        organizationId: diagnosticText(resource.organizationId ?? resource.orgId, 128),
        latestOnline: diagnosticText(resource.latestOnline, 64)
      });
    }
    conflicts.set(device.id, value);
  }
  // A partial or targeted listing is not an identity correction. Keep a known
  // durable-alias collision quarantined until the stored identities agree.
  // Same-resource status disagreements are transient and do not create a hold.
  for (const device of locals) {
    const meta = device.source_metadata;
    const physical = identity(device.device_serial), remote = identity(device.external_device_id);
    if (!physical || !remote || physical === remote || !meta || typeof meta !== "object" || Array.isArray(meta)
      || meta.identityStatus !== "conflict" || !Array.isArray(meta.identityReasons)
      || !meta.identityReasons.some(reason => ["multiple_provider_resources", "ambiguous_resource_owner"].includes(reason))) continue;
    const observations = Array.isArray(meta.conflictingResources) ? meta.conflictingResources.slice(0, 10).filter(row => row && typeof row === "object" && !Array.isArray(row)).map(row => ({
      deviceSerial: row.serial, deviceName: row.name, status: row.status === "online" ? 1 : row.status === "offline" ? 0 : null,
      publicIp: row.publicIp, deviceModel: row.model, organizationId: row.organizationId, latestOnline: row.latestOnline
    })) : [];
    for (const reason of meta.identityReasons.filter(reason => ["multiple_provider_resources", "ambiguous_resource_owner"].includes(reason))) conflict(device, reason, observations);
    conflict(device, "identity_conflict_requires_review", []);
  }
  for (const resource of resources) {
    const key = identity(resource.deviceSerial);
    if (!key) { unmatched.push(resource); continue; }
    byResource.set(key, [...(byResource.get(key) || []), resource]);
  }
  for (const [key, observations] of byResource) {
    // Preserve verbatim provider resources separately from the resolved status.
    // Even an unmapped serial must not publish whichever response arrived first.
    const statuses = new Set(observations.map(row => starResourceStatus(row.status)));
    resourceStatuses.push({ serial: key, status: statuses.size === 1 ? starResourceStatus(observations[0].status) : "unknown" });
    // Physical serial is the first exact lookup; external ID is only a fallback.
    // A different exact owner in either namespace is a conflict, never a guess.
    const physical = serials.get(key) || [], remote = external.get(key) || [];
    const owners = [...new Set([...physical, ...remote])];
    if (!owners.length) { unmatched.push(observations[0]); continue; }
    if (physical.length > 1 || remote.length > 1 || owners.length !== 1 || owners.some(row => ids.get(String(row.id)) !== 1)) {
      for (const device of owners) conflict(device, "ambiguous_resource_owner", observations);
      continue;
    }
    const device = (physical[0] || remote[0]);
    if (statuses.size !== 1) {
      conflict(device, "conflicting_resource_observations", observations);
      continue;
    }
    const claims = candidates.get(device.id) || [];
    claims.push({ device, resource: observations[0], status: starResourceStatus(observations[0].status), matchedBy: physical.length ? "device_serial" : "external_device_id" });
    candidates.set(device.id, claims);
  }
  const matches = [];
  for (const claims of candidates.values()) {
    if (claims.length !== 1) conflict(claims[0].device, "multiple_provider_resources", claims.map(row => row.resource));
    else if (conflicts.has(claims[0].device.id)) conflict(claims[0].device, "ambiguous_resource_owner", claims.map(row => row.resource));
    if (!conflicts.has(claims[0].device.id)) matches.push(claims[0]);
  }
  return {
    matches,
    unmatched,
    resourceStatuses,
    conflicts: [...conflicts.values()].map(value => ({ device: value.device, reasons: [...value.reasons].sort(), resources: [...value.resources.values()].sort((a, b) => a.serial.localeCompare(b.serial) || a.status.localeCompare(b.status)) })).sort((a, b) => String(a.device.id).localeCompare(String(b.device.id)))
  };
}
