import { isTicketType, type TicketType } from './ticketTypes';

/** Parser adapters are registered only after an actual export has been inspected. */
export type MhelpParser = {
  id: string;
  version: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  parse(file: File, signal: AbortSignal): Promise<MhelpExtraction>;
};
export type ExtractedTicketField = {
  value: string;
  /** Where the value was found, not a claim that it matches a COS record. */
  sourceLabel: string;
  page?: number;
};
export type MhelpExtraction = {
  sourceTicketId?: ExtractedTicketField;
  title?: ExtractedTicketField;
  description?: ExtractedTicketField;
  customer?: ExtractedTicketField;
  site?: ExtractedTicketField;
  address?: ExtractedTicketField;
  contact?: ExtractedTicketField;
  requestedDate?: ExtractedTicketField;
  requestedTime?: ExtractedTicketField;
  jobType?: ExtractedTicketField;
  priority?: ExtractedTicketField;
  units: ExtractedTicketField[];
  additionalFields: ExtractedTicketField[];
  warnings: string[];
  lineItems?: { quantity: string; itemName: string; notes: string; page: number }[];
  /** Full extracted text remains reviewable, including fields not mapped to COS. */
  documentText?: string;
};
export type ImportSource = {
  system: 'mhelpdesk';
  sourceTicketId: string;
  sha256: string;
  filename: string;
  byteLength: number;
  mimeType: string;
  parserId: string;
  parserVersion: string;
};
export type ReviewedImportTicket = {
  source: ImportSource;
  customerId: string;
  siteId: string;
  jobType: TicketType;
  priority: 'normal' | 'high' | 'urgent';
  title: string;
  description: string;
  contactInstructions: string;
  unitIds: string[];
  /** Schedule text is retained as a request, never an automatic assignment. */
  requestedSchedule: string;
  additionalInformation: string;
  shopPrep: boolean;
  parserData: MhelpExtraction;
};

export const MHELP_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Generic drop zones are inert unless a caller supplies a verified parser. */
export const verifiedMhelpParsers: readonly MhelpParser[] = [];

export function chooseMhelpParser(file: Pick<File, 'name' | 'size' | 'type'>, parsers: readonly MhelpParser[]): MhelpParser {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('Choose a nonempty ticket file.');
  if (file.size > MHELP_IMPORT_MAX_BYTES) throw new Error('The ticket file exceeds the 10 MiB import limit.');
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  const matches = parsers.filter(parser => parser.extensions.includes(extension) && (!file.type || parser.mimeTypes.includes(file.type.toLowerCase())));
  if (matches.length !== 1) throw new Error(matches.length > 1
    ? 'This ticket format has conflicting parsers. Keep the original file and contact support.'
    : 'This ticket format has not been verified for import. Keep the original file.');
  return matches[0];
}

export async function hashTicketFile(file: File): Promise<string> {
  if (file.size <= 0 || file.size > MHELP_IMPORT_MAX_BYTES) throw new Error('Choose a nonempty ticket file under 10 MiB.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error('The complete ticket file could not be read.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export function validateImportSource(source: ImportSource): void {
  if (source.system !== 'mhelpdesk' || !hasText(source.sourceTicketId) || source.sourceTicketId !== source.sourceTicketId.trim() ||
      !/^[a-f0-9]{64}$/.test(source.sha256) || !hasText(source.filename) || !hasText(source.parserId) || !hasText(source.parserVersion) ||
      source.filename.length > 255 || !/\.pdf$/i.test(source.filename) || /[\x00-\x1f/\\]/.test(source.filename) ||
      source.sourceTicketId.length > 128 || source.mimeType !== 'application/pdf' || !Number.isSafeInteger(source.byteLength) || source.byteLength <= 0 || source.byteLength > MHELP_IMPORT_MAX_BYTES) {
    throw new Error('The original ticket identity and file provenance must be verified before saving.');
  }
}

export type ImportDirectory = {
  complete: boolean;
  customers: { id: string; active: boolean }[];
  sites: { id: string; customerId: string; active: boolean }[];
  units: { id: string; siteId: string; customerId: string; active: boolean }[];
};
/** Names/text from a file never become COS identities. Confirm real associations. */
export function validateReviewedImport(ticket: ReviewedImportTicket, directory: ImportDirectory): void {
  validateImportSource(ticket.source);
  if (!directory.complete) throw new Error('Customer, site and unit associations are unavailable. Refresh them before saving.');
  const customers = directory.customers.filter(row => row.id === ticket.customerId);
  const sites = directory.sites.filter(row => row.id === ticket.siteId);
  if (customers.length !== 1 || !customers[0].active) throw new Error('Choose one verified active COS customer.');
  if (sites.length !== 1 || !sites[0].active || sites[0].customerId !== ticket.customerId) throw new Error('Choose a verified active site belonging to this customer.');
  if (new Set(ticket.unitIds).size !== ticket.unitIds.length) throw new Error('A unit was selected more than once.');
  for (const id of ticket.unitIds) {
    const matches = directory.units.filter(row => row.id === id);
    if (matches.length !== 1 || !matches[0].active || matches[0].siteId !== ticket.siteId || matches[0].customerId !== ticket.customerId) {
      throw new Error('A selected unit does not have a verified association with this customer and site. Review its assignment separately.');
    }
  }
  if (!isTicketType(ticket.jobType) || !['normal', 'high', 'urgent'].includes(ticket.priority) || !hasText(ticket.title) || ticket.title.length > 500 ||
      [ticket.description, ticket.contactInstructions, ticket.requestedSchedule, ticket.additionalInformation].some(value => typeof value !== 'string' || value.length > 70_000 || value.includes('\u0000')) ||
    typeof ticket.shopPrep !== 'boolean' || (ticket.shopPrep && ticket.jobType !== 'SERVICE') || !ticket.parserData ||
    !Array.isArray(ticket.parserData.additionalFields) || !Array.isArray(ticket.parserData.warnings) || !Array.isArray(ticket.parserData.units) ||
    ticket.parserData.sourceTicketId?.value !== ticket.source.sourceTicketId) throw new Error('Review the ticket details before saving.');
}

export type ExistingImport = { organizationId: string; jobId: string; sourceTicketId: string; sha256: string };
/** Requires full history, including closed jobs/trash. Active board rows are insufficient. */
export function findDuplicateImport(source: ImportSource, organizationId: string, index: { complete: boolean; records: ExistingImport[] }) {
  validateImportSource(source);
  if (!hasText(organizationId) || !index.complete || index.records.some(row => !hasText(row.jobId) || row.organizationId !== organizationId ||
      !hasText(row.sourceTicketId) || !/^[a-f0-9]{64}$/.test(row.sha256))) throw new Error('The complete import history could not be verified.');
  return index.records.filter(row => row.sourceTicketId === source.sourceTicketId || row.sha256 === source.sha256);
}

/** A stable full-field readback value. No trimming/coercion can hide lost data. */
export function importTicketFingerprint(ticket: ReviewedImportTicket): string {
  return JSON.stringify([
    ticket.source.system, ticket.source.sourceTicketId, ticket.source.sha256, ticket.source.filename, ticket.source.byteLength,
    ticket.source.mimeType, ticket.source.parserId, ticket.source.parserVersion,
    ticket.customerId, ticket.siteId, ticket.jobType, ticket.priority, ticket.title, ticket.description,
    ticket.contactInstructions, [...ticket.unitIds].sort(), ticket.requestedSchedule, ticket.additionalInformation, ticket.shopPrep, stableJson(ticket.parserData),
  ]);
}

/** JSONB readback may reorder object keys; values/arrays must still match exactly. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(stableJson).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).filter(key => (value as Record<string,unknown>)[key] !== undefined).sort().map(key => JSON.stringify(key)+':'+stableJson((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value);
}
