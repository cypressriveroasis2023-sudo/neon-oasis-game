// Frozen pre-optimization differential oracle; no runtime service access.
import { placementIdentityConcernKey } from '../../../supabase/functions/cos-operations-pages/placementProjection.ts';
const contract = 'COS_EFFECTIVE_FLEET_PLACEMENT_V1';
const status = (row) => {
    const value = String(row.placement || row.currentLocationType || '').toUpperCase();
    return ['FIELD', 'SITE'].includes(value) ? 'FIELD' : ['SHOP', 'ROOT', 'YARD', 'WAREHOUSE'].includes(value) ? 'SHOP' : value === 'UNKNOWN' ? 'UNKNOWN' : null;
};
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
/** One complete display roster. Final API membership is recorded placement, never
 * proof of a fresh address, GPS observation, health state, or provider identity. */
export function projectEffectiveFleetPlacement(snapshot, audits, options = {}) {
    if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(audits))
        throw Error('Effective fleet placement is unavailable');
    const inventory = snapshot.inventoryItems, byId = new Map();
    for (const row of inventory) {
        if (!row || typeof row.id !== 'string' || typeof row.unitNumber !== 'string' || byId.has(row.id))
            throw Error('Effective fleet inventory has inconsistent identities');
        byId.set(row.id, row);
    }
    const fieldIds = new Set();
    for (const row of snapshot.items) {
        if (!row || !byId.has(row.id) || byId.get(row.id).unitNumber !== row.unitNumber || fieldIds.has(row.id))
            throw Error('Effective field membership is inconsistent');
        fieldIds.add(row.id);
    }
    const reviewed = new Set((options.confirmedPrecedenceBindings || []).map(b => JSON.stringify(b)));
    const inventoryItems = inventory.map((raw) => {
        const { effectivePlacement: _old, ...row } = raw;
        let placement = status(row), reason = row.placementReviewReason || null;
        const conflict = row.placementStatus === 'needs_identity_review' || row.representationStatus === 'conflict' || Boolean(row.placementReviewReason);
        const owner = row.placementSource === 'owner' && Boolean(row.placementAuditId);
        const binding = row.importedInstallation || row.placementPrecedenceBinding;
        const reviewedImport = binding && binding.nativeUnitId === row.id && binding.unitNumber === row.unitNumber && reviewed.has(JSON.stringify(binding));
        // This list is returned by the separate guarded upload projector. A row's
        // display metadata alone cannot supersede recorded Owner history.
        const unitUploadClaims = (options.authorizedUploadPlacements || []).filter(a => a.unitId === row.id);
        const uploadClaims = unitUploadClaims.filter(a => ['owner_supplied_mhelp_export', 'mhelpdesk_api'].includes(a.source) && a.unitNumber === row.unitNumber
            && a.placement === placement && /^[1-9][0-9]*$/.test(a.productId) && /^[a-f0-9]{64}$/.test(a.sourceSha256) && instant(a.observedAt)
            && row.placementSource === 'mhelpdesk_upload' && row.placementEvidence?.source === a.source
            && row.placementEvidence.productId === a.productId && row.placementEvidence.sourceSha256 === a.sourceSha256 && row.placementEvidence.observedAt === a.observedAt);
        const authorizedUpload = unitUploadClaims.length === 1 && uploadClaims.length === 1;
        const concern = placementIdentityConcernKey(row.unitNumber);
        const rootHistory = audits.some(a => a.action === 'MOVE_TO_ROOT' && placementIdentityConcernKey(a.unit_key) === concern);
        if (conflict)
            placement = 'UNKNOWN';
        else if ((placement === 'FIELD' || placement === null && fieldIds.has(row.id)) && rootHistory && !owner && !reviewedImport && !authorizedUpload) {
            placement = 'UNKNOWN';
            reason = 'A prior Owner ROOT move conflicts with this imported field record. Review placement precedence.';
        }
        else if (placement === null)
            placement = fieldIds.has(row.id) ? 'FIELD' : 'UNKNOWN';
        const evidence = row.placementEvidence;
        const observedAt = (owner ? instant(row.placementUpdatedAt) : null) || instant(evidence?.observedAt) || instant(row.placementUpdatedAt) || instant(row.mhelpObservedAt) || instant(row.sourceVerifiedAt) || null;
        const source = owner ? 'owner' : evidence?.source || row.placementSource || 'recorded_inventory';
        const effectivePlacement = { contract, state: placement.toLowerCase(), source, observedAt, freshness: placement === 'UNKNOWN' ? 'review' : evidence?.fresh === true ? 'current' : 'recorded', reason: reason || evidence?.reason || null };
        const activeInventoryEligible = row.activeInventoryEligible !== false && row.uploadActiveInventoryEligible !== false && !['DO_NOT_USE', 'MISSING'].includes(row.uploadLifecycle);
        return { ...row, placement, currentLocationType: placement.toLowerCase(), effectivePlacement, activeInventoryEligible,
            ...(reason ? { placementReviewReason: reason, placementStatus: 'needs_identity_review', latitude: null, longitude: null, coordinateSource: null } : {}) };
    });
    const items = inventoryItems.filter((r) => r.effectivePlacement.state === 'field' && r.activeInventoryEligible !== false);
    const count = (state) => inventoryItems.filter((r) => r.effectivePlacement.state === state && r.activeInventoryEligible !== false).length;
    return { ...snapshot, inventoryItems, items, effectivePlacementVersion: 1,
        placementSummary: { totalUnits: inventoryItems.length, fieldUnits: count('field'), shopUnits: count('shop'), reviewUnits: count('unknown'), excludedLifecycleUnits: inventoryItems.filter((r) => r.activeInventoryEligible === false).length },
        summary: { ...snapshot.summary, fieldUnits: items.length, mappedUnits: items.filter((r) => r.latitude != null && r.longitude != null).length, unitGps: items.filter((r) => r.hasUnitGps === true).length, missingGps: items.filter((r) => r.latitude == null || r.longitude == null).length, addressUnits: items.filter((r) => typeof r.address === 'string' && r.address.trim()).length } };
}
