export type FinanceKind = 'quotes' | 'invoices' | 'purchasing';
export type FinanceRecord = Record<string, any>;
export type FinanceApi = { get(path: string): Promise<{ data: unknown }>; post(path: string, body?: unknown): Promise<{ data: unknown }> };
export type FinanceDecision = 'approve_quote' | 'return_quote' | 'approve_invoice' | 'issue_invoice' | 'approve_po' | 'return_po' | 'approve_ap' | 'return_ap';
export function financeDecisionRequest(_kind: FinanceKind, _row: FinanceRecord, _decision: FinanceDecision, _reason = ''): never {
  throw new Error('Quotes, invoices and purchasing are not available in COS.');
}
export const financeStatus = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_', ' ');
export const validFinanceId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is FinanceRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function checkedFinanceList(value: unknown): FinanceRecord[] {
  if (!object(value) || !Array.isArray(value.items)) throw new Error('Financial records returned an incomplete response.');
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!object(row) || !validFinanceId(row.id) || ids.has(row.id) || typeof row.status !== 'string' || !row.status.trim()) throw new Error('Financial records returned inconsistent records.');
    ids.add(row.id);
  }
  return value.items;
}
export function checkedFinanceDetail(value: unknown, id: string): FinanceRecord {
  if (!object(value) || value.id !== id || !validFinanceId(value.id) || typeof value.status !== 'string' || !value.status.trim()) throw new Error('The financial record could not be verified.');
  for (const key of ['lines', 'activity', 'payments', 'documents']) if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error('Financial record details returned an incomplete response.');
  for (const key of ['lines', 'payments', 'documents']) if (Array.isArray(value[key]) && value[key].some((row: unknown) => !object(row))) throw new Error('Financial record details returned invalid line records.');
  return value;
}
export function financeDetailStatus(kind: FinanceKind, detail: FinanceRecord): string {
  const value = financeStatus(detail.status);
  if (kind === 'quotes') return ({ review: 'pending owner approval', approved: 'owner approved', returned: 'returned by owner' } as Record<string, string>)[value] || value;
  return value;
}
/** Prevent decisions when a newer detail no longer matches the reviewed list record. */
export function financeDetailMatchesRow(kind: FinanceKind, row: FinanceRecord, detail: FinanceRecord): boolean {
  return row.id === detail.id && financeStatus(row.status) === financeDetailStatus(kind, detail) &&
    (kind !== 'quotes' || Number.isSafeInteger(Number(row.revision)) && Number(row.revision) >= 1 && Number(row.revision) === Number(detail.revision));
}
export function financeMoney(value: unknown): string {
  if (typeof value === 'string') value = value.trim().replace(/^\$/, '').replaceAll(',', '');
  if (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}
export function availableFinanceDecisions(kind: FinanceKind, row: FinanceRecord): FinanceDecision[] {
  const status = financeStatus(row.status);
  if (kind === 'quotes') return status === 'pending owner approval' ? ['approve_quote', 'return_quote'] : [];
  if (kind === 'invoices') return status === 'pending owner approval' ? ['approve_invoice'] : status === 'approved' ? ['issue_invoice'] : [];
  const decisions: FinanceDecision[] = [];
  if (status === 'pending owner po approval' && row.poApproved !== true && row.paid !== true) decisions.push('approve_po', 'return_po');
  if (financeStatus(row.match) === 'matched' && row.paid !== true && row.poApproved === true) {
    if (row.approved !== true && status === 'ready for ap approval') decisions.push('approve_ap');
    decisions.push('return_ap');
  }
  return decisions;
}
export const financeDecisionLabels: Record<FinanceDecision, string> = {
  approve_quote: 'Owner Approve', return_quote: 'Return to Sales',
  approve_invoice: 'Approve Invoice', issue_invoice: 'Issue Invoice',
  approve_po: 'Owner Approve PO', return_po: 'Return Request',
  approve_ap: 'Approve for Payment', return_ap: 'Return for Review',
};
export function hasConfirmedFinanceDecision(rows: FinanceRecord[], baseline: FinanceRecord, decision: FinanceDecision): boolean {
  const matches = rows.filter(row => row.id === baseline.id);
  if (matches.length !== 1) return false;
  const row = matches[0], status = financeStatus(row.status);
  if (decision === 'approve_quote') return status === 'owner approved' && row.locked === true && Number(row.revision) === Number(baseline.revision);
  if (decision === 'return_quote') return status === 'draft' && row.locked === false && Number.isSafeInteger(Number(baseline.revision)) && Number(baseline.revision) >= 1 && Number(row.revision) === Number(baseline.revision) + 1;
  if (decision === 'approve_invoice') return status === 'approved';
  if (decision === 'issue_invoice') return status === 'issued';
  if (decision === 'approve_po') return row.poApproved === true && status === 'open po';
  if (decision === 'return_po') return status === 'purchase request returned' && row.poApproved === false;
  if (decision === 'approve_ap') return row.approved === true && financeStatus(row.match) === 'matched' && status === 'approved for payment';
  return row.approved === false && status === 'needs review' && financeStatus(row.match) === 'exception';
}
export type FinanceSaveResult = { status: 'busy' | 'refresh_required' } | { status: 'unconfirmed' | 'accepted_unverified'; message: string } | { status: 'confirmed'; rows: FinanceRecord[]; detail: FinanceRecord };
/** A decision is written once, then confirmed from both list and detail reads.
 * Any uncertain outcome blocks another write until a successful manual refresh. */
export function createFinanceDecisionSaver(api: FinanceApi) {
  let running = false, refreshRequired = false;
  return {
    get busy() { return running; },
    get needsRefresh() { return refreshRequired; },
    acknowledgeRefresh(value: unknown) { checkedFinanceList(value); if (!running) refreshRequired = false; },
    async save(kind: FinanceKind, baseline: FinanceRecord, decision: FinanceDecision, reason = ''): Promise<FinanceSaveResult> {
      if (running) return { status: 'busy' };
      if (refreshRequired) return { status: 'refresh_required' };
      financeDecisionRequest(kind, baseline, decision, reason);
    },
  };
}
