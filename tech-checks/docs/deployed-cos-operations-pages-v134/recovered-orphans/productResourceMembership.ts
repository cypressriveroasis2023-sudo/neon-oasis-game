// RECOVERED ORPHAN - not original source.
// Extracted verbatim from the deployed cos-operations-pages v134 bundle
// (productTcpRuntime.ts), which is the ONLY known copy of this file. It exists
// in no commit on any branch of this repository.
// Original path: tech-checks/supabase/functions/cos-operations-pages/productResourceMembership.ts
// This is post-esbuild output: types are stripped and some identifiers are
// renamed (value2, rows2). Treat it as evidence of what production runs, not as
// a drop-in replacement for the lost source.
var terminal2 = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
function resourceEpochsCoverIdentity(proof, resources, epochs) {
  const ids = proof.deviceIds, keys = proof.unitKeys;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some((id3) => typeof id3 !== "string" || !/^[1-9][0-9]*$/.test(id3)) || !Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some((k) => typeof k !== "string" || !k || k !== k.trim())) return false;
  const equal = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!equal(ids, resources.map((r) => String(r.id))) || !equal(keys, [...new Set(resources.map((r) => r.unit_key))])) return false;
  return keys.every((key) => {
    const current = epochs.filter((e) => e.unitKey === key), members = resources.filter((r) => r.unit_key === key).map((r) => String(r.id));
    return current.length === 1 && /^[a-f0-9]{64}$/.test(current[0].epoch) && Array.isArray(current[0].deviceIds) && equal(current[0].deviceIds, members);
  });
}
async function productResourceMembership(source, now = Date.now(), review) {
  const readAt = Date.parse(source.verifiedAt);
  if (source.complete !== true || !Number.isFinite(readAt) || readAt > now || now - readAt > 26e3) throw Error("Current complete membership source required");
  validateOwnerIdentitySnapshot(source.identitySources.ownerCrosswalk);
  const census = currentMhelpProductConnectionCensus(source.upload, now);
  if (source.tracker.expectedMhelpSourceSha256 !== census.sourceSha256) throw Error("Membership source changed");
  const identity = await verifiedHealthIdentities(source.identitySources, review);
  const projected = projectMhelpUploadPlacement(source.map, source.upload, source.identitySources.audits, identity, now).snapshot.uploadInventory;
  if (!projected || projected.sourceSha256 !== census.sourceSha256) throw Error("Membership projection changed");
  const proofs = [...identity.unitIdentities, ...identity.ownerConfirmedUnitIdentities || []], members = /* @__PURE__ */ new Map();
  const rows2 = source.identitySources.devices, byDevice = /* @__PURE__ */ new Map(), byUnit = /* @__PURE__ */ new Map(), byInventory = /* @__PURE__ */ new Map(), byProduct = new Map(projected.records.map((r) => [r.productId, r]));
  for (const [list, key, map] of [[rows2, "id", byDevice], [source.identitySources.units, "id", byUnit], [source.map.inventoryItems, "id", byInventory]]) for (const row of list) {
    const id3 = String(row[key]);
    map.set(id3, [...map.get(id3) || [], row]);
  }
  for (const raw of source.upload.records) {
    if (raw.placement !== "FIELD" || raw.lifecycle !== "UNFLAGGED" || isSupportEquipment({ id: "mhelp_product:" + raw.productId, unitNumber: raw.unitNumber, modelName: raw.category })) continue;
    const b = raw.binding, p = byProduct.get(raw.productId), linked = p?.binding, ids = linked?.unitIds;
    if (!b || b.guardCurrent !== true || !b.nativeUnitId || linked?.state !== "linked" || linked.placementHeld || linked.reason || linked.candidateUnitIds?.length || !Array.isArray(ids) || !ids.includes(b.nativeUnitId) || ids.length > 2 || new Set(ids).size !== ids.length) continue;
    if (ids.some((id3) => id3 !== b.nativeUnitId && (id3 !== b.trackerId || byUnit.has(id3) || byInventory.get(id3)?.length !== 1 || byInventory.get(id3)[0].readOnly !== true))) continue;
    if (byInventory.get(b.nativeUnitId)?.length !== 1 || byInventory.get(b.nativeUnitId)[0].readOnly === true) continue;
    const native = byUnit.get(b.nativeUnitId) || [];
    if (native.length !== 1 || typeof native[0].status !== "string" || terminal2(native[0].status) || terminal2(native[0].unit_number)) continue;
    const proof = proofs.filter((p2) => p2.unitId === b.nativeUnitId);
    if (proof.length !== 1 || identity.identityWarnings.some((w) => w.unitId === b.nativeUnitId) || !proof[0].deviceIds.length) continue;
    const resources = proof[0].deviceIds.map((id3) => byDevice.get(String(id3)));
    if (resources.some((r) => r?.length !== 1)) continue;
    const exact2 = resources.map((r) => r[0]);
    if (exact2.some((r) => r.monitoring_enabled !== true || r.activation_state !== "active" || [r.device_name, r.unit_key].some(terminal2))) continue;
    if (!resourceEpochsCoverIdentity(proof[0], exact2, source.identitySources.ownerEpochs || [])) continue;
    members.set(raw.productId, proof[0].deviceIds.map(String));
  }
  return { census: projected, members };
}
export {
  buildExactProductConnections,
  cancellableIo,
  createProductPreviewHandler,
  createProductProofHandler,
  createProtectedSourceReader,
  existingNativeProductSourceContext,
  integrateScopedConnections,
  productResourceMembership
};
