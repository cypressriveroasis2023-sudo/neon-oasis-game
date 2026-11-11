class ManualEquipmentError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}
function fail(message, status = 503) {
  throw new ManualEquipmentError(message, status);
}
const uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const MANUAL_EQUIPMENT_FIELDS = { displayName: 120, placement: 5, customer: 200, siteName: 200, address: 400, deviceLink: 200, note: 1e3 };
const FIELDS = Object.keys(MANUAL_EQUIPMENT_FIELDS);
const productId = (v) => typeof v === "string" && /^[1-9][0-9]{0,17}$/.test(v);
function checkedRecord(v) {
  if (!exact(v, FIELDS) || FIELDS.some((k) => !(v[k] === null || typeof v[k] === "string" && v[k].length > 0 && v[k].length <= MANUAL_EQUIPMENT_FIELDS[k])) || !(v.placement === null || v.placement === "FIELD" || v.placement === "SHOP")) fail("Saved manual record could not be verified. Reload it before trying again.");
  return Object.fromEntries(FIELDS.map((k) => [k, v[k]]));
}
function checkedManualEquipment(v, id) {
  const unsaved = v?.revision === 0;
  if (v?.contract !== "COS_MANUAL_EQUIPMENT_V1" || v.productId !== id || !Number.isInteger(v.revision) || v.revision < 0 || v.revision > 1e6 || typeof v.proof !== "string" || !/^[a-f0-9]{64}$/.test(v.proof) || (unsaved ? !(v.auditId === null && v.recordedAt == null && v.recordedBy == null) : !(uuid(v.auditId) && uuid(v.recordedBy) && typeof v.recordedAt === "string" && Number.isFinite(Date.parse(v.recordedAt))))) fail("Saved manual record could not be verified. Reload it before trying again.");
  return { contract: v.contract, productId: id, revision: v.revision, auditId: v.auditId ?? null, recordedAt: v.recordedAt ?? null, recordedBy: v.recordedBy ?? null, record: checkedRecord(v.record), proof: v.proof };
}
function checkedManualChanges(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("Choose at least one field to change.", 400);
  const keys = Object.keys(v);
  if (!keys.length || keys.some((k) => !FIELDS.includes(k))) fail("Choose at least one field to change.", 400);
  for (const k of keys) {
    const value = v[k];
    if (value === null) continue;
    if (typeof value !== "string" || value.length > MANUAL_EQUIPMENT_FIELDS[k] * 4) fail("Enter text for " + k + ".", 400);
    if (k === "placement" && value.trim() && !["FIELD", "SHOP"].includes(value.trim())) fail("Placement must be Field or Shop.", 400);
    if (k !== "placement" && value.trim().length > MANUAL_EQUIPMENT_FIELDS[k]) fail(k + " is too long.", 400);
  }
  return Object.fromEntries(keys.map((k) => [k, v[k]]));
}
function createManualEquipmentRpc(options) {
  const unavailable = "Manual equipment record is unavailable. Try again.";
  return async (name, payload) => {
    let response;
    try {
      response = await options.fetch(options.url + "/rest/v1/rpc/" + name, { method: "POST", headers: options.headers(), body: JSON.stringify(payload) });
    } catch {
      fail(unavailable);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (response.ok) return data;
    const message = typeof data?.message === "string" && data.message.length <= 300 ? data.message : "";
    if (response.status === 409 || data?.code === "PT409") fail(message || "This record was changed by someone else. Reload it and try again.", 409);
    if (data?.code === "42501") fail("An active COS Owner or verified IT account is required.", 403);
    if (data?.code === "22023") fail(message || "Review the record and try again.", 400);
    fail(unavailable);
  };
}
const conflict = (error) => error?.code === "PT409" || error?.status === 409;
function createManualEquipment(options) {
  const call = async (body) => {
    try {
      return await options.rpc("cos_manual_equipment_v1", { ...options.actorPayload, ...body });
    } catch (error) {
      if (conflict(error)) fail(error?.message || "This record was changed by someone else. Reload it and try again.", 409);
      throw error;
    }
  };
  return async (id, method, body, view = "record") => {
    if (!productId(id)) fail("Choose an mHelp Product ID.", 400);
    if (view === "history") {
      if (method !== "GET") fail("History can only be read.", 405);
      const v = await call({ p_product_id: id, p_action: "history" });
      if (v?.contract !== "COS_MANUAL_EQUIPMENT_HISTORY_V1" || v.productId !== id || !Array.isArray(v.items) || v.items.length > 200 || v.items.some((r) => !uuid(r.auditId) || !uuid(r.actorId) || !Number.isInteger(r.revision) || !Number.isFinite(Date.parse(r.recordedAt)) || typeof r.reason !== "string")) fail("Saved history could not be verified.");
      return { contract: v.contract, productId: id, items: v.items.map((r) => ({ auditId: r.auditId, revision: r.revision, actorId: r.actorId, recordedAt: r.recordedAt, reason: r.reason, changes: r.changes, before: checkedRecord(r.before), after: checkedRecord(r.after) })) };
    }
    if (method === "GET") return checkedManualEquipment(await call({ p_product_id: id, p_action: "read" }), id);
    if (method !== "POST") fail("Use the manual equipment record action.", 405);
    if (!exact(body, ["expected", "reason", "requestId", "changes"]) || !uuid(body.requestId) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 1e3 || !exact(body.expected, ["productId", "revision", "auditId", "proof"])) fail("Review the record, choose a change and enter a reason.", 400);
    if (body.expected.productId !== id || !Number.isInteger(body.expected.revision) || !(body.expected.auditId === null || uuid(body.expected.auditId)) || !/^[a-f0-9]{64}$/.test(String(body.expected.proof))) fail("Review the record, choose a change and enter a reason.", 400);
    const changes = checkedManualChanges(body.changes);
    const result = await call({ p_product_id: id, p_action: "save", p_request_id: body.requestId, p_reason: body.reason.trim(), p_expected: body.expected, p_changes: changes });
    const value = checkedManualEquipment(result, id);
    if (result.saved !== true || result.requestId !== body.requestId || value.auditId !== body.requestId) fail("The save response is uncertain. Reload the record before trying again.");
    const after = checkedManualEquipment(await call({ p_product_id: id, p_action: "read" }), id);
    if (result.current !== false && JSON.stringify(after) !== JSON.stringify(value)) fail("The save may have been recorded. Reload the record before trying again.");
    return { ...value, saved: true, requestId: body.requestId, replayed: result.replayed === true, current: result.current !== false };
  };
}
export {
  MANUAL_EQUIPMENT_FIELDS,
  ManualEquipmentError,
  checkedManualChanges,
  checkedManualEquipment,
  createManualEquipment,
  createManualEquipmentRpc
};
