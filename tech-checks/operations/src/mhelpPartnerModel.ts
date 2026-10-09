export type PartnerStatus = {
  contract: 'cos-mhelpdesk-partner-review-v1'; docsUrl: string; mode: 'read_only_review';
  state: 'setup_required' | 'ready_to_test' | 'preview_verified';
  portalConfigured: boolean; tokenConfigured: boolean; automaticSync: false; sheetsPublisher: false; liveAccessVerified: boolean;
  verifiedPortalId?: string;
};
export type PartnerItem = {
  equipmentId: string; portalId: string; name: string; model: string | null;
  equipmentTypeId: string | null; customerId: string | null; serviceLocationId: string | null;
  active: boolean | null; updatedAt: string | null;
  identity: {state: 'ambiguous' | 'verified_link' | 'identity_changed' | 'review_needed'; nativeUnitId: string | null; candidateUnitIds: string[]};
};
export type PartnerPreview = PartnerStatus & {state: 'preview_verified'; readAt: string; totalRows: number; partial: boolean; items: PartnerItem[]};
const obj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const numeric = (v: unknown) => typeof v === 'string' && /^[1-9][0-9]{0,14}$/.test(v) && Number.isSafeInteger(Number(v));
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const label = (v: unknown) => typeof v === 'string' && Boolean(v.trim()) && v.length <= 180 && !/[\x00-\x1f\x7f]/.test(v);
const timestamp = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const invalid = (): never => {throw new Error('The mHelpDesk review response could not be verified. Retry the check.');};
export function checkedPartnerStatus(v: unknown): PartnerStatus {
  if (!obj(v) || v.contract !== 'cos-mhelpdesk-partner-review-v1' || v.docsUrl !== 'https://www.mhelpdesk.com/partner-api/index.html' || v.mode !== 'read_only_review' || !['setup_required','ready_to_test','preview_verified'].includes(String(v.state)) || typeof v.portalConfigured !== 'boolean' || typeof v.tokenConfigured !== 'boolean' || v.automaticSync !== false || v.sheetsPublisher !== false || typeof v.liveAccessVerified !== 'boolean') return invalid();
  const configured = v.portalConfigured && v.tokenConfigured;
  if ((v.verifiedPortalId !== undefined && (!numeric(v.verifiedPortalId) || v.state !== 'preview_verified')) ||
    (v.state === 'setup_required' && configured) || (v.state === 'ready_to_test' && !configured) ||
    (v.state === 'preview_verified' && (!v.tokenConfigured || (!v.portalConfigured && !numeric(v.verifiedPortalId)))) ||
    (v.state === 'preview_verified') !== v.liveAccessVerified) return invalid();
  return v as PartnerStatus;
}
export function checkedPartnerPreview(v: unknown): PartnerPreview {
  const status = checkedPartnerStatus(v);
  if (!obj(v) || status.state !== 'preview_verified' || !timestamp(v.readAt) || !Array.isArray(v.items) || v.items.length > 50 || !Number.isSafeInteger(v.totalRows) || Number(v.totalRows) < v.items.length || v.partial !== (v.items.length < Number(v.totalRows))) return invalid();
  const seen = new Set<string>(), portals = new Set<string>();
  for (const row of v.items) {
    if (!obj(row) || !numeric(row.equipmentId) || !numeric(row.portalId) || !label(row.name) || row.model !== null && !label(row.model) || !['equipmentTypeId','customerId','serviceLocationId'].every(k => row[k] === null || numeric(row[k])) || row.active !== null && typeof row.active !== 'boolean' || row.updatedAt !== null && !timestamp(row.updatedAt) || !obj(row.identity)) return invalid();
    const identity = row.identity;
    if (!['ambiguous','verified_link','identity_changed','review_needed'].includes(String(identity.state)) || !Array.isArray(identity.candidateUnitIds) || !identity.candidateUnitIds.every(uuid) || new Set(identity.candidateUnitIds).size !== identity.candidateUnitIds.length || (identity.nativeUnitId !== null && !uuid(identity.nativeUnitId)) || (identity.state === 'verified_link') !== (identity.nativeUnitId !== null)) return invalid();
    if (seen.has(row.equipmentId as string) || (status.verifiedPortalId && row.portalId !== status.verifiedPortalId)) return invalid();
    seen.add(row.equipmentId as string); portals.add(row.portalId as string);
  }
  if (portals.size > 1) return invalid();
  return v as PartnerPreview;
}
