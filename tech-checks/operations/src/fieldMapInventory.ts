import { checkedAppAddressAuthority } from '../../supabase/functions/_shared/appUnitAddressContract';
type Row = Record<string, unknown>;
export type InactiveInventoryUnit = {
  id: string; unitNumber: string; modelName?: string | null; customer?: string | null;
  site: 'INACTIVE / DO NOT USE'; status: 'inactive'; currentLocationType: 'inactive';
};
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const decimal = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const trackerRecordId = (value: unknown) => typeof value === 'string' && value.length <= 400 && /^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(value);
const ownerPlacement = (row: Row) => row.placementSource === 'owner' && (row.placement === 'FIELD' || row.placement === 'SHOP')
  && row.currentLocationType === row.placement.toLowerCase() && decimal(row.placementAuditId) && row.placementStatus !== 'needs_identity_review';
const sourceInactive = (row: Row) => row.importedPlacement === 'INACTIVE' || object(row.importedInstallation) && row.importedInstallation.placement === 'INACTIVE';
const heldPlacement = (row: Row) => row.placement === 'UNKNOWN' && row.placementStatus === 'needs_identity_review'
  && row.latitude == null && row.longitude == null && row.coordinateSource == null && row.locationVerification === 'address_changed';
function validInactive(row: Row): boolean {
  const proof = row.importedInstallation;
  if (!object(proof) || row.importedPlacement !== 'INACTIVE' || row.currentLocationType !== 'inactive' || row.status !== 'inactive'
    || row.placement !== null || row.placementSource !== null || row.placementAuditId !== null || row.site !== 'INACTIVE / DO NOT USE' || row.address !== null
    || [row.latitude, row.longitude, row.coordinateSource, row.installedSiteId, row.activeJobNumber, row.locationHistoryId, row.locationVerifiedAt, row.placementUnitKey, row.placementUpdatedAt, row.addressSource, row.addressUpdatedAt].some(value => value != null)
    || row.hasUnitGps === true || row.locationVerification === 'owner_verified' || row.placementStatus === 'needs_identity_review'
    || row.readOnly !== true && row.readOnly !== false || proof.entityKind !== (row.readOnly ? 'tracker' : 'equipment_unit') || proof.nativeUnitId !== row.id
    || proof.placement !== 'INACTIVE' || !uuid(proof.sourceRevision) || !decimal(proof.eventId) || ![proof.nativeGuardSha256, proof.sourceFileSha256, proof.sourceRowSha256].every(sha)
    || [row.modelName, row.customer].some(value => value != null && typeof value !== 'string')) return false;
  const common = ['entityKind', 'nativeUnitId', 'sourceRevision', 'eventId', 'nativeGuardSha256', 'sourceFileSha256', 'sourceRowSha256', 'placement'];
  const sourceKeys = proof.sourceSystem === 'google_sheet_tracker' && row.readOnly === true && trackerRecordId(proof.sourceRecordId)
    ? ['sourceSystem', 'sourceRecordId'] : decimal(proof.productId) ? ['productId'] : [];
  if (proof.addressAuthority !== undefined && (row.readOnly !== true || !checkedAppAddressAuthority(proof.addressAuthority, proof.sourceRevision))) return false;
  const keys = [...common, ...sourceKeys, ...(proof.addressAuthority === undefined ? [] : ['addressAuthority'])];
  return sourceKeys.length > 0 && Object.keys(proof).length === keys.length && keys.every(key => Object.hasOwn(proof, key));
}
/** Inventory is optional on older snapshots. Inactive rows can never enter field consumers. */
export function checkedInactiveInventory(snapshot: { items: unknown[]; inventoryItems?: unknown }): InactiveInventoryUnit[] {
  if (snapshot.items.some(row => object(row) && (row.currentLocationType === 'inactive' || sourceInactive(row) && !ownerPlacement(row)))) throw new Error('Inactive inventory was returned as a field unit.');
  if (snapshot.inventoryItems === undefined) return [];
  if (!Array.isArray(snapshot.inventoryItems)) throw new Error('Field Map inventory is incomplete.');
  const fieldIds = new Set(snapshot.items.filter(object).map(row => row.id));
  const seen = new Set<string>(), result: InactiveInventoryUnit[] = [];
  for (const row of snapshot.inventoryItems) {
    if (!object(row) || !uuid(row.id) || typeof row.id !== 'string' || seen.has(row.id) || typeof row.unitNumber !== 'string' || !row.unitNumber.trim() || typeof row.status !== 'string') throw new Error('Field Map inventory has inconsistent unit records.');
    seen.add(row.id);
    if (!sourceInactive(row) || ownerPlacement(row)) continue;
    if (heldPlacement(row) && !fieldIds.has(row.id)) continue;
    if (!validInactive(row) || fieldIds.has(row.id)) throw new Error('Inactive inventory has an inconsistent placement record.');
    result.push(row as unknown as InactiveInventoryUnit);
  }
  return result;
}
/** Match the same display fields as Field Map search, without health or nearby filters. */
export function inactiveInventoryMatches(unit: InactiveInventoryUnit, search: string): boolean {
  const query = search.trim().toLowerCase();
  return !query || [unit.unitNumber, unit.modelName, unit.customer, unit.site].filter(Boolean).join(' ').toLowerCase().includes(query);
}
