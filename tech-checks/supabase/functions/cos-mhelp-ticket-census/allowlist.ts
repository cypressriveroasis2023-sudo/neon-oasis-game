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
 *   not sent. sort=-ticketId is the documented descending form and is used
 *   only for equipment-ticket pages so the newest rows are read first.
 * - Ticket Get Object has customerId and no customer name or equipmentId.
 *   Name is a separate customer GET. Equipment id is the normalized
 *   equipmentId when a payload actually has one, or the id in
 *   GET /Equipment/{id}/Tickets. priceListId is not an equipment id.
 * - PUT /Tickets/{id} replaces a whole ticket. POST, PUT, PATCH and DELETE
 *   are rejected before any network call.
 * The portal id is the configured account portal, not a caller-selected value.
 */

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
function portalOf(portalId: string): string {
  if (!ID.test(portalId)) throw new CensusRequestError('mhelp_path_rejected');
  return portalId;
}
function rowOf(rowIndex: number | null): string {
  if (rowIndex === null) return '';
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 100000) throw new CensusRequestError('mhelp_path_rejected');
  return '&rowIndex=' + String(rowIndex);
}

export function ticketStatusPath(portalId: string): string {
  return '/portal/' + portalOf(portalId) + '/ticketstatus';
}
export function ticketTypesPath(portalId: string): string {
  return '/portal/' + portalOf(portalId) + '/tickettypes';
}
export function ticketListPath(portalId: string, filter: {statusId: string} | {createStart: string; createEnd: string}, rowIndex: number | null): string {
  const params: string[] = [];
  if ('statusId' in filter) {
    if (!STATUS.test(filter.statusId)) throw new CensusRequestError('mhelp_path_rejected');
    params.push('statusId=' + filter.statusId);
  } else {
    if (!STAMP.test(filter.createStart) || !STAMP.test(filter.createEnd) || filter.createStart >= filter.createEnd) throw new CensusRequestError('mhelp_path_rejected');
    params.push('createStart=' + filter.createStart, 'createEnd=' + filter.createEnd);
  }
  params.push('pageSize=50', 'sort=ticketId');
  return '/portal/' + portalOf(portalId) + '/Tickets?' + params.join('&') + rowOf(rowIndex);
}
export function ticketDetailPath(portalId: string, ticketId: string): string {
  if (!ID.test(ticketId)) throw new CensusRequestError('mhelp_path_rejected');
  return '/portal/' + portalOf(portalId) + '/Tickets/' + ticketId;
}
export function customerNamePath(portalId: string, customerId: string): string {
  if (!ID.test(customerId)) throw new CensusRequestError('mhelp_path_rejected');
  return '/portal/' + portalOf(portalId) + '/customers/' + customerId + '?Fields=customerId,portalId,name';
}
export function equipmentTicketsPath(portalId: string, equipmentId: string, rowIndex: number | null): string {
  if (!ID.test(equipmentId)) throw new CensusRequestError('mhelp_path_rejected');
  return '/portal/' + portalOf(portalId) + '/Equipment/' + equipmentId + '/Tickets?pageSize=50&sort=-ticketId' + rowOf(rowIndex);
}

export function assertCensusPath(path: string, portalId: string): void {
  const portal = portalOf(portalId);
  if (path === ticketStatusPath(portal) || path === ticketTypesPath(portal)) return;
  const detail = new RegExp('^/portal/' + portal + '/Tickets/([1-9][0-9]{0,14})$').exec(path);
  if (detail) return;
  const customer = new RegExp('^/portal/' + portal + '/customers/([1-9][0-9]{0,14})\\?Fields=customerId,portalId,name$').exec(path);
  if (customer) return;
  const equipment = new RegExp('^/portal/' + portal + '/Equipment/([1-9][0-9]{0,14})/Tickets\\?pageSize=50&sort=-ticketId(?:&rowIndex=(\\d+))?$').exec(path);
  if (equipment) {
    if (equipment[2] && (Number(equipment[2]) > 100000 || String(Number(equipment[2])) !== equipment[2])) throw new CensusRequestError('mhelp_path_rejected');
    return;
  }
  const list = new RegExp('^/portal/' + portal + '/Tickets\\?(?:statusId=(0|[1-9][0-9]{0,14})|createStart=(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)&createEnd=(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z))&pageSize=50&sort=ticketId(?:&rowIndex=(\\d+))?$').exec(path);
  if (!list) throw new CensusRequestError('mhelp_path_rejected');
  if (list[4] && (Number(list[4]) > 100000 || String(Number(list[4])) !== list[4])) throw new CensusRequestError('mhelp_path_rejected');
  if (list[2] && list[2] >= list[3]) throw new CensusRequestError('mhelp_path_rejected');
}

export function censusUrl(path: string, portalId: string): string {
  assertCensusPath(path, portalId);
  return 'https://connect.mhelpdesk.com/api/v1.0' + path;
}
