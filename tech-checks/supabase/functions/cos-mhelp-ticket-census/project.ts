/** Existing equipment identity: a positive safe integer with no leading zero.
 * mHelpPartner.numericId and the placement equipment_id check use this form.
 * Operators call that id the A#. A letter prefix is not a second normalization.
 */
const ID = /^[1-9][0-9]{0,14}$/;
const CLOSED = /\b(closed|complete|completed|cancelled|canceled|invoiced|void|voided)\b/i;

export function normalizeMhelpId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && ID.test(value) && Number.isSafeInteger(Number(value))) return value;
  return null;
}
export function normalizeStatusId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(value) && Number.isSafeInteger(Number(value))) return value;
  return null;
}
export function censusLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 250 || /[\x00-\x1f\x7f<>]/.test(text)) return null;
  return text;
}
/** Closed words are an assumption about dictionary labels, not a vendor enum. */
export function closedStatusLabel(value: string): boolean {
  return CLOSED.test(value);
}
function zoned(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return new Date(parsed).toISOString();
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export type CensusRow = {
  ticketId: string;
  ticketNumber: string;
  customerName: string | null;
  status: string | null;
  type: string | null;
  createdAt: string;
  scheduledAt: string | null;
  equipmentId: string | null;
};
export type StatusLabel = {statusId: string; label: string; open: boolean};
export type TypeLabel = {typeId: string; label: string};

export function projectCustomerName(value: unknown, customerId: string, portalId: string): string {
  if (!plain(value) || normalizeMhelpId(value.customerId) !== customerId || normalizeMhelpId(value.portalId) !== portalId) throw new Error('customer_name_unavailable');
  const name = censusLabel(value.name);
  if (!name) throw new Error('customer_name_unavailable');
  return name;
}
export function projectStatusLabels(value: unknown): StatusLabel[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('incomplete_dictionary');
  const rows = value.map(item => {
    if (!plain(item)) throw new Error('incomplete_dictionary');
    const statusId = normalizeStatusId(item.statusId);
    const label = censusLabel(item.displayText) || censusLabel(item.statusText);
    if (!statusId || !label) throw new Error('incomplete_dictionary');
    const statusText = censusLabel(item.statusText) || '';
    return {statusId, label, open: !closedStatusLabel(label) && !closedStatusLabel(statusText)};
  });
  if (new Set(rows.map(row => row.statusId)).size !== rows.length) throw new Error('incomplete_dictionary');
  return rows.sort((a, b) => Number(a.statusId) - Number(b.statusId));
}
export function projectTypeLabels(value: unknown, portalId: string): TypeLabel[] {
  if (!plain(value)) throw new Error('incomplete_dictionary');
  const hasData = Object.hasOwn(value, 'data'), hasResults = Object.hasOwn(value, 'results');
  if (hasData === hasResults || !Number.isSafeInteger(value.totalRows)) throw new Error('incomplete_dictionary');
  const collection = hasData ? value.data : value.results;
  if (!Array.isArray(collection) || collection.length > 500 || value.totalRows !== collection.length) throw new Error('incomplete_dictionary');
  const rows = collection.map(item => {
    if (!plain(item) || normalizeMhelpId(item.portalId) !== portalId) throw new Error('incomplete_dictionary');
    const typeId = normalizeMhelpId(item.typeId), label = censusLabel(item.typeName);
    if (!typeId || !label) throw new Error('incomplete_dictionary');
    return {typeId, label};
  });
  if (new Set(rows.map(row => row.typeId)).size !== rows.length) throw new Error('incomplete_dictionary');
  return rows;
}
export function ticketPage(value: unknown): {total: number; rows: Record<string, unknown>[]} {
  if (!plain(value) || !Number.isSafeInteger(value.totalRows) || Number(value.totalRows) < 0 || Number(value.totalRows) > 100000) throw new Error('incomplete_ticket_page');
  const hasData = Object.hasOwn(value, 'data'), hasResults = Object.hasOwn(value, 'results');
  if (hasData === hasResults) throw new Error('incomplete_ticket_page');
  const collection = hasData ? value.data : value.results;
  if (!Array.isArray(collection) || collection.length > 50 || collection.length > Number(value.totalRows)) throw new Error('incomplete_ticket_page');
  if (collection.some(row => !plain(row))) throw new Error('incomplete_ticket_page');
  return {total: Number(value.totalRows), rows: collection as Record<string, unknown>[]};
}
/** Copies only the census columns. Descriptions, notes, contacts, staff,
 * addresses, items and custom fields are never returned.
 */
export function projectCensusTicket(value: Record<string, unknown>, labels: {status: Map<string, string>; type: Map<string, string>}, equipmentFromPath: string | null, portalId: string): {row: CensusRow; customerId: string | null} | null {
  if (normalizeMhelpId(value.portalId) !== portalId) throw new Error('incomplete_ticket_page');
  const ticketId = normalizeMhelpId(value.ticketId), ticketNumber = normalizeMhelpId(value.ticketNumber);
  const createdAt = zoned(value.creationDate);
  if (!ticketId || !ticketNumber || !createdAt) return null;
  const statusId = normalizeStatusId(value.statusId);
  const typeId = normalizeMhelpId(value.typeId);
  const fromBody = Object.hasOwn(value, 'equipmentId') ? normalizeMhelpId(value.equipmentId) : null;
  const equipmentId = equipmentFromPath && fromBody && equipmentFromPath !== fromBody ? null : equipmentFromPath || fromBody;
  return {customerId: normalizeMhelpId(value.customerId), row: {
    ticketId, ticketNumber, customerName: null,
    status: (statusId && labels.status.get(statusId)) || censusLabel(value.ticketStatus),
    type: (typeId && labels.type.get(typeId)) || censusLabel(value.typeName),
    createdAt, scheduledAt: zoned(value.scheduledDate), equipmentId,
  }};
}
