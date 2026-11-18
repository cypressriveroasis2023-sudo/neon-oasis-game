/** GET-only paths for the private ticket census.
 *
 * Confirmed from the Partner API pages fetched for this change
 * (docsVersion 1.0.0, updated 2020-06-15) and from the existing readers:
 * - GET /portal/{id}/Tickets accepts statusId, createStart, createEnd, pageSize,
 *   rowIndex and sort. createStart is strictly greater than creationDate.
 *   createEnd requires createStart and is strictly less than creationDate.
 * - Request Formats: pageSize defaults to 50; rowIndex is the starting row.
 *   Its example is 1-based (pageSize 500, second page rowIndex 501).
 *   The equipment and ticket readers do not trust that example alone. They
 *   detect one overlapping boundary row. This census does the same.
 * - The ticket list example is totalRows + data. The general guide's
 *   totalResults + results is a different list shape. This reader accepts
 *   exactly one of data or results, plus totalRows.
 * - Ticket docs do not list a fields parameter. /Tickets is not shaped.
 * - lastModDate is documented, but the comparison direction is not. It is
 *   not sent. sort=-lastModDate is not used either: paging here requires
 *   ascending ticketId, which is the sort this repo already verifies.
 * - Ticket Get Object has customerId and no customer name or equipmentId.
 *   Name is a separate customer GET. Equipment id is the normalized
 *   equipmentId when a payload actually has one, or the id in
 *   GET /Equipment/{id}/Tickets. priceListId is not an equipment id.
 * - PUT /Tickets/{id} replaces a whole ticket. POST, PUT, PATCH and DELETE
 *   are rejected before any network call.
 */

const PORTAL = '224643';
const BLOCKED = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ID = /^[1-9][0-9]{0,14}$/;
const STATUS = /^(0|[1-9][0-9]{0,14})$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class CensusRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'CensusRequestError'; }
}

export function assertCensusMethod(method: string): void {
  if (BLOCKED.has(method.toUpperCase()) || method.toUpperCase() !== 'GET') throw new CensusRequestError('mhelp_write_blocked');
}

export function ticketStatusPath(): string {
  return '/portal/' + PORTAL + '/ticketstatus';
}
export function ticketTypesPath(): string {
  return '/portal/' + PORTAL + '/tickettypes';
}
export function ticketListPath(filter: {statusId: string} | {createStart: string; createEnd: string}, rowIndex: number | null): string {
  const params: string[] = [];
  if ('statusId' in filter) {
    if (!STATUS.test(filter.statusId)) throw new CensusRequestError('mhelp_path_rejected');
    params.push('statusId=' + filter.statusId);
  } else {
    if (!STAMP.test(filter.createStart) || !STAMP.test(filter.createEnd) || filter.createStart >= filter.createEnd) throw new CensusRequestError('mhelp_path_rejected');
    params.push('createStart=' + filter.createStart, 'createEnd=' + filter.createEnd);
  }
  params.push('pageSize=50', 'sort=ticketId');
  if (rowIndex !== null) {
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 100000) throw new CensusRequestError('mhelp_path_rejected');
    params.push('rowIndex=' + String(rowIndex));
  }
  return '/portal/' + PORTAL + '/Tickets?' + params.join('&');
}
export function customerNamePath(customerId: string): string {
  if (!ID.test(customerId)) throw new CensusRequestError('mhelp_path_rejected');
  return '/portal/' + PORTAL + '/customers/' + customerId + '?Fields=customerId,portalId,name';
}
export function equipmentTicketsPath(equipmentId: string): string {
  if (!ID.test(equipmentId)) throw new CensusRequestError('mhelp_path_rejected');
  return '/portal/' + PORTAL + '/Equipment/' + equipmentId + '/Tickets?pageSize=50&sort=ticketId';
}

const LIST = /^\/portal\/224643\/Tickets\?(?:statusId=(0|[1-9][0-9]{0,14})|createStart=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)&createEnd=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z))&pageSize=50&sort=ticketId(?:&rowIndex=(\d+))?$/;

export function assertCensusPath(path: string): void {
  if (path === ticketStatusPath() || path === ticketTypesPath()) return;
  const customer = /^\/portal\/224643\/customers\/([1-9][0-9]{0,14})\?Fields=customerId,portalId,name$/.exec(path);
  if (customer) return;
  const equipment = /^\/portal\/224643\/Equipment\/([1-9][0-9]{0,14})\/Tickets\?pageSize=50&sort=ticketId$/.exec(path);
  if (equipment) return;
  const list = LIST.exec(path);
  if (!list) throw new CensusRequestError('mhelp_path_rejected');
  if (list[4] && (Number(list[4]) > 100000 || String(Number(list[4])) !== list[4])) throw new CensusRequestError('mhelp_path_rejected');
  if (list[2] && list[2] >= list[3]) throw new CensusRequestError('mhelp_path_rejected');
}

export function censusUrl(path: string): string {
  assertCensusPath(path);
  return 'https://connect.mhelpdesk.com/api/v1.0' + path;
}
