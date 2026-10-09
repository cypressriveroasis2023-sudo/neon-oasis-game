import { validInstallation } from '../../supabase/functions/cos-operations-pages/importedAddressContract';

type Row = Record<string, unknown>;
export type ImportedPlacement = 'FIELD' | 'SHOP' | 'INACTIVE';
export type ImportedInstallation = { street: string | null; city: string | null; state: string | null; zip: string | null };
export type ImportedAddressRecord = {
  contract: 'COS_APP_UNIT_ADDRESS_V1'; unitId: string; unitNumber: string;
  sourceIdentity: { sourceSystem: string; productId?: string; sourceRecordId?: string };
  sourceRevision: string; revision: string | null; placementRevision: string;
  placement: ImportedPlacement; installation: ImportedInstallation | null; siteLabel: string | null;
  sourceConflict: boolean; history: Row[]; editable: true;
};
export type ImportedAddressDraft = { placement: ImportedPlacement; street: string; city: string; state: string; zip: string; siteLabel: string };
export const addressUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max: number): value is string | null => value === null || typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const placement = (value: unknown): value is ImportedPlacement => ['FIELD', 'SHOP', 'INACTIVE'].includes(String(value));
const partialInstallation = (value: unknown): boolean => value === null || object(value) && Object.keys(value).length === 4 && text(value.street, 300) && text(value.city, 100) && text(value.state, 100) && text(value.zip, 20);
const historyEntry = (value: unknown): boolean => object(value) && addressUuid(value.revision) && addressUuid(value.actorUserId) && ['owner','it'].includes(String(value.actorRole))
  && typeof value.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value.savedAt) && Number.isFinite(Date.parse(value.savedAt))
  && placement(value.placement) && partialInstallation(value.installation) && (value.placement === 'FIELD' || value.installation === null);

/** No map display strings or unit labels are accepted as editable identity/address data. */
export function checkedImportedAddress(value: unknown, unitId: string): ImportedAddressRecord {
  if (!addressUuid(unitId) || !object(value) || value.contract !== 'COS_APP_UNIT_ADDRESS_V1' || value.unitId !== unitId
    || typeof value.unitNumber !== 'string' || !value.unitNumber.trim() || value.unitNumber.length > 200
    || !addressUuid(value.sourceRevision) || value.revision !== null && !addressUuid(value.revision)
    || typeof value.placementRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.placementRevision)
    || !placement(value.placement) || !text(value.siteLabel, 250) || typeof value.sourceConflict !== 'boolean'
    || value.editable !== true || !Array.isArray(value.history) || value.history.length > 20 || value.history.some(row => !historyEntry(row))) {
    throw new Error('The current unit address could not be verified. Refresh the address before editing.');
  }
  const identity = value.sourceIdentity;
  if (!object(identity) || Object.keys(identity).length !== 2 || !(identity.sourceSystem === 'mhelpdesk_product_import' && typeof identity.productId === 'string' && /^[1-9]\d{0,18}$/.test(identity.productId) && identity.sourceRecordId === undefined
    || identity.sourceSystem === 'google_sheet_tracker' && typeof identity.sourceRecordId === 'string' && /^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(identity.sourceRecordId) && identity.productId === undefined)) {
    throw new Error('The imported unit identity could not be verified. Refresh the address before editing.');
  }
  const installation = value.installation;
  // Valid source records may be partial. Show their exact components so they can be repaired.
  if (!partialInstallation(installation)
    || value.placement !== 'FIELD' && installation !== null) throw new Error('The current address components are incomplete or inconsistent. Refresh before editing.');
  return value as ImportedAddressRecord;
}

export function importedAddressDraft(record: ImportedAddressRecord): ImportedAddressDraft {
  return { placement: record.placement, street: record.installation?.street ?? '', city: record.installation?.city ?? '', state: record.installation?.state ?? '', zip: record.installation?.zip ?? '', siteLabel: record.siteLabel ?? '' };
}
const clean = (value: string) => value.trim().replace(/ +/g, ' ');
export function importedAddressValues(draft: ImportedAddressDraft) {
  return { placement: draft.placement, installation: draft.placement === 'FIELD' ? { street: clean(draft.street) || null, city: clean(draft.city) || null, state: clean(draft.state).toUpperCase() || null, zip: clean(draft.zip) || null } : null, siteLabel: clean(draft.siteLabel) || null };
}
export function importedAddressChanged(record: ImportedAddressRecord, draft: ImportedAddressDraft): boolean {
  const comparison = (value: ImportedAddressDraft) => {
    const result = importedAddressValues(value);
    return { ...result, installation: result.installation ? Object.fromEntries(Object.entries(result.installation).map(([key, part]) => [key, part?.toLowerCase() ?? null])) : null };
  };
  return JSON.stringify(comparison(importedAddressDraft(record))) !== JSON.stringify(comparison(draft));
}
export function importedAddressProblem(draft: ImportedAddressDraft): string {
  const values = importedAddressValues(draft);
  if (!placement(values.placement)) return 'Choose Field, Shop, or Inactive.';
  if (values.siteLabel && (values.siteLabel.length > 250 || /[\u0000-\u001f\u007f<>@=]|https?:|password|passwd|passcode|token|secret|credential|lockbox|gate[ -]*code|access[ -]*code/i.test(values.siteLabel))) return 'Use a short site label without contact details, access codes, or private notes.';
  if (values.placement === 'FIELD' && !validInstallation(values.installation)) return 'Enter a safe US street address, two-letter state, and city or ZIP. Keep contact details, access codes, and unit or suite notes out of the address.';
  return '';
}
export function importedAddressPayload(record: ImportedAddressRecord, draft: ImportedAddressDraft, requestId: string, confirmed: boolean) {
  if (!confirmed || !addressUuid(requestId)) throw new Error('Confirm the address correction before saving.');
  const problem = importedAddressProblem(draft);
  if (problem) throw new Error(problem);
  if (!importedAddressChanged(record, draft)) return null;
  return { requestId, expectedSourceRevision: record.sourceRevision, expectedRevision: record.revision, expectedPlacementRevision: record.placementRevision, ...importedAddressValues(draft), confirmed: true as const };
}
export function importedAddressMatches(record: ImportedAddressRecord, draft: ImportedAddressDraft): boolean {
  return !importedAddressChanged(record, draft);
}
export function importedAddressCapability(session: unknown): boolean {
  return object(session) && session.authorized === true && ['Owner', 'IT'].includes(String(session.role)) && object(session.features) && session.features.importedUnitAddressEdit === true;
}
/** Inventory admission supplies a choice only; the editor independently verifies GET identity. */
export function importedAddressInventory(value: unknown): { id: string; unitNumber: string; status: string; readOnly: true; [key: string]: unknown }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is { id: string; unitNumber: string; status: string; readOnly: true } => object(row) && row.readOnly === true && addressUuid(row.id) && typeof row.unitNumber === 'string' && Boolean(row.unitNumber.trim()) && typeof row.status === 'string');
}
