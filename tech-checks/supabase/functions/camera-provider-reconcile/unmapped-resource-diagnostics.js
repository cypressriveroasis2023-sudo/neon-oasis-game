// Additive diagnostics for an already-fetched Star4Live resource. This function
// makes no I/O calls and does not classify, activate, map or insert a device.
// Keep source keys and values verbatim: field presence is evidence, not a claim
// about the provider's undocumented type/channel/timestamp semantics.
const SCALAR_KEYS = Object.freeze([
  "resourceId", "resourceID", "deviceId", "deviceID",
  "deviceSerial", "deviceName", "deviceType", "resourceType", "type",
  "deviceModel", "model", "organizationId", "orgId",
  "organizationName", "orgName", "organization", "parentOrganizationName",
  "status", "latestOnline", "providerObservedAt", "observedAt",
  "channelId", "channelID", "channelNo", "channelNumber", "channelCount", "totalChannel",
]);
const PATH_KEYS = Object.freeze(["organizationPath", "orgPath"]);
const MAX_TEXT_LENGTH = 2048;
const MAX_PATH_PARTS = 32;

function isScalar(value) {
  return value === null || typeof value === "boolean" ||
    (typeof value === "string" && value.length <= MAX_TEXT_LENGTH) ||
    (typeof value === "number" && Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value)));
}

export function unmappedResourceDiagnostics(resource, capturedAt) {
  const providerResource = {};
  const rejectedFields = [];
  const input = resource && typeof resource === "object" && !Array.isArray(resource)
    ? resource : {};
  for (const key of SCALAR_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    if (isScalar(input[key])) providerResource[key] = input[key];
    else rejectedFields.push(key);
  }
  for (const key of PATH_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (isScalar(value)) providerResource[key] = value;
    else if (Array.isArray(value) && value.length <= MAX_PATH_PARTS && value.every(isScalar)) {
      providerResource[key] = value.slice();
    } else rejectedFields.push(key);
  }
  return {
    diagnostic_schema_version: 1,
    // Local reconciliation time. Never substitute it for providerObservedAt,
    // latestOnline, a camera channel observation, or a verified placement date.
    diagnostic_captured_at: typeof capturedAt === "string" ? capturedAt : null,
    provider_resource: providerResource,
    ...(rejectedFields.length ? { diagnostic_rejected_fields: rejectedFields } : {}),
  };
}
