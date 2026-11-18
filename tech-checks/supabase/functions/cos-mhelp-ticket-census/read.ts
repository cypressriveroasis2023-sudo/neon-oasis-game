import {TICKET_RUN_CAP, censusBackoffMs} from './budget.ts';
import {CensusRequestError, assertCensusMethod, assertCensusPath, censusUrl, customerNamePath, equipmentTicketsPath, ticketListPath, ticketStatusPath, ticketTypesPath} from './allowlist.ts';
import {projectCensusTicket, projectCustomerName, projectStatusLabels, projectTypeLabels, ticketPage, type CensusRow} from './project.ts';

export class CensusStop extends Error {
  constructor(readonly reason: 'mhelp_ticket_access_denied' | 'mhelp_rate_limited' | 'daily_budget' | 'provider_wait' | 'run_cap') {
    super(reason); this.name = 'CensusStop';
  }
}
export type CensusCursor = {
  statusOrdinal: number;
  statusSeen: number;
  statusBase: 0 | 1;
  statusBoundaryChecked: boolean;
  statusLastTicketId: string | null;
  recentSeen: number;
  recentBase: 0 | 1;
  recentBoundaryChecked: boolean;
  recentLastTicketId: string | null;
  equipmentOrdinal: number;
};
export function emptyCursor(): CensusCursor {
  return {statusOrdinal: 0, statusSeen: 0, statusBase: 0, statusBoundaryChecked: false, statusLastTicketId: null, recentSeen: 0, recentBase: 0, recentBoundaryChecked: false, recentLastTicketId: null, equipmentOrdinal: 0};
}
type Walk = {seen: number; base: 0 | 1; boundaryChecked: boolean; lastTicketId: string | null};
const RECENT_MS = 48 * 60 * 60 * 1000;
const MAX_JSON = 1048576;

async function cancel(response: Response) { await response.body?.cancel().catch(() => undefined); }
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_JSON) { await cancel(response); throw new CensusRequestError('oversized_ticket_response'); }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let size = 0, raw = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_JSON) throw new CensusRequestError('oversized_ticket_response');
      raw += decoder.decode(chunk.value, {stream: true});
    }
    return JSON.parse(raw + decoder.decode());
  } catch (cause) {
    if (cause instanceof CensusRequestError) throw cause;
    throw new CensusRequestError('incomplete_ticket_page');
  } finally { await reader.cancel().catch(() => undefined); }
}

export async function readTicketCensus(options: {
  fetch: typeof fetch;
  accessToken: string;
  cursor?: CensusCursor;
  equipmentIds?: string[];
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<{state: 'completed' | 'stopped'; reason: string | null; vendorReads: number; rows: CensusRow[]; cursor: CensusCursor; recentTruncated: boolean}> {
  if (!options.accessToken || options.accessToken.length > 16384 || /\s/.test(options.accessToken)) throw new CensusRequestError('setup_source');
  const now = options.now || Date.now;
  const wait = options.wait || (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const cursor: CensusCursor = {...emptyCursor(), ...options.cursor};
  const rows: CensusRow[] = [];
  const customers = new Map<string, string | null>();
  let reads = 0;
  const get = async (path: string): Promise<unknown> => {
    assertCensusMethod('GET');
    assertCensusPath(path);
    if (reads >= TICKET_RUN_CAP) throw new CensusStop('run_cap');
    let attempt = 0;
    while (true) {
      if (options.signal?.aborted) throw new CensusRequestError('canceled');
      if (reads >= TICKET_RUN_CAP) throw new CensusStop('run_cap');
      reads += 1;
      const response = await options.fetch(censusUrl(path), {method: 'GET', headers: {Accept: 'application/json', Authorization: 'Bearer ' + options.accessToken}, redirect: 'error', cache: 'no-store', signal: options.signal});
      if (response.status === 401 || response.status === 403) { await cancel(response); throw new CensusStop('mhelp_ticket_access_denied'); }
      if (response.status === 429) {
        const budget = response.headers.get('X-COS-Mhelp-Budget') === '1';
        const deferred = response.headers.get('X-COS-Mhelp-Deferred') === '1';
        const retryAfter = response.headers.get('Retry-After');
        await cancel(response);
        if (budget || deferred || attempt >= 2) throw new CensusStop(budget ? 'daily_budget' : deferred ? 'provider_wait' : 'mhelp_rate_limited');
        await wait(censusBackoffMs(attempt, retryAfter, now()));
        attempt += 1;
        continue;
      }
      if (!response.ok) { await cancel(response); throw new CensusRequestError('mhelp_http_' + response.status); }
      return boundedJson(response);
    }
  };
  const finish = (state: 'completed' | 'stopped', reason: string | null, recentTruncated: boolean) => ({state, reason, vendorReads: reads, rows, cursor, recentTruncated});
  try {
    const statuses = projectStatusLabels(await get(ticketStatusPath()));
    const types = projectTypeLabels(await get(ticketTypesPath()));
    const labels = {status: new Map(statuses.map(row => [row.statusId, row.label])), type: new Map(types.map(row => [row.typeId, row.label]))};
    const open = statuses.filter(row => row.open);
    if (cursor.statusOrdinal >= open.length) resetWalk(cursor, 'status');
    if (open.length) await walk(get, cursor, 'status', ticketRow => ticketListPath({statusId: open[cursor.statusOrdinal].statusId}, ticketRow), 8, null, labels, rows, customers, (row, raw) => normalizeStatus(raw) === open[cursor.statusOrdinal].statusId && accept(row));
    const end = new Date(now()).toISOString(), start = new Date(now() - RECENT_MS).toISOString();
    const recent = await walk(get, cursor, 'recent', ticketRow => ticketListPath({createStart: start, createEnd: end}, ticketRow), 4, null, labels, rows, customers, (row) => Date.parse(row.createdAt) > Date.parse(start) && Date.parse(row.createdAt) < Date.parse(end));
    for (const equipmentId of (options.equipmentIds || []).filter(id => /^[1-9][0-9]{0,14}$/.test(id)).slice(0, 2)) {
      const page = ticketPage(await get(equipmentTicketsPath(equipmentId)));
      take(page, null, labels, rows, customers, equipmentId, () => true);
      cursor.equipmentOrdinal += 1;
    }
    const merged = dedupe(rows);
    rows.length = 0;
    rows.push(...merged);
    for (const [customerId] of [...customers.entries()].filter(([, name]) => name === null).slice(0, 8)) {
      let name: string;
      try { name = projectCustomerName(await get(customerNamePath(customerId)), customerId); }
      catch (cause) {
        if (cause instanceof CensusStop) throw cause;
        if (cause instanceof Error && cause.message === 'customer_name_unavailable') continue;
        throw cause;
      }
      customers.set(customerId, name);
      for (const row of rows) if (customerIdOf(row) === customerId) row.customerName = name;
    }
    return finish('completed', reads >= TICKET_RUN_CAP ? 'run_cap' : null, recent === 'partial');
  } catch (cause) {
    if (cause instanceof CensusStop) return finish('stopped', cause.reason, false);
    throw cause;
  }
}
const owners = new WeakMap<CensusRow, string | null>();
function customerIdOf(row: CensusRow): string | null { return owners.get(row) ?? null; }
function normalizeStatus(raw: Record<string, unknown>): string | null {
  return typeof raw.statusId === 'number' && Number.isSafeInteger(raw.statusId) && raw.statusId >= 0 ? String(raw.statusId) : typeof raw.statusId === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(raw.statusId) ? raw.statusId : null;
}
function resetWalk(cursor: CensusCursor, kind: 'status' | 'recent') {
  if (kind === 'status') { cursor.statusOrdinal = 0; cursor.statusSeen = 0; cursor.statusBase = 0; cursor.statusBoundaryChecked = false; cursor.statusLastTicketId = null; }
  else { cursor.recentSeen = 0; cursor.recentBase = 0; cursor.recentBoundaryChecked = false; cursor.recentLastTicketId = null; }
}
function walkOf(cursor: CensusCursor, kind: 'status' | 'recent'): Walk {
  return kind === 'status'
    ? {seen: cursor.statusSeen, base: cursor.statusBase, boundaryChecked: cursor.statusBoundaryChecked, lastTicketId: cursor.statusLastTicketId}
    : {seen: cursor.recentSeen, base: cursor.recentBase, boundaryChecked: cursor.recentBoundaryChecked, lastTicketId: cursor.recentLastTicketId};
}
function saveWalk(cursor: CensusCursor, kind: 'status' | 'recent', walk: Walk) {
  if (kind === 'status') { cursor.statusSeen = walk.seen; cursor.statusBase = walk.base; cursor.statusBoundaryChecked = walk.boundaryChecked; cursor.statusLastTicketId = walk.lastTicketId; }
  else { cursor.recentSeen = walk.seen; cursor.recentBase = walk.base; cursor.recentBoundaryChecked = walk.boundaryChecked; cursor.recentLastTicketId = walk.lastTicketId; }
}
function accept(row: CensusRow): boolean { return !!row.ticketId; }
function take(page: {total: number; rows: Record<string, unknown>[]}, walk: Walk | null, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, equipmentId: string | null, keep: (row: CensusRow, raw: Record<string, unknown>) => boolean) {
  if (page.rows.some((row, index) => index > 0 && Number(row.ticketId) <= Number(page.rows[index - 1].ticketId))) throw new CensusRequestError('incomplete_ticket_page');
  for (const raw of page.rows) {
    const projected = projectCensusTicket(raw, labels, equipmentId);
    if (!projected || !keep(projected.row, raw)) throw new CensusRequestError('incomplete_ticket_page');
    owners.set(projected.row, projected.customerId);
    if (projected.customerId && !customers.has(projected.customerId)) customers.set(projected.customerId, null);
    rows.push(projected.row);
    if (walk) { walk.seen += 1; walk.lastTicketId = projected.row.ticketId; }
  }
}
async function walk(get: (path: string) => Promise<unknown>, cursor: CensusCursor, kind: 'status' | 'recent', pathFor: (rowIndex: number | null) => string, maxPages: number, equipmentId: string | null, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, keep: (row: CensusRow, raw: Record<string, unknown>) => boolean): Promise<'done' | 'partial'> {
  const walkState = walkOf(cursor, kind);
  let pages = 0;
  while (pages < maxPages) {
    const rowIndex = walkState.seen === 0 ? null : walkState.seen + walkState.base;
    let page = ticketPage(await get(pathFor(rowIndex)));
    pages += 1;
    if (walkState.seen > 0 && !walkState.boundaryChecked && page.rows.length && String(page.rows[0].ticketId) === walkState.lastTicketId) {
      walkState.base = 1;
      walkState.boundaryChecked = true;
      if (pages >= maxPages) { saveWalk(cursor, kind, walkState); return 'partial'; }
      page = ticketPage(await get(pathFor(walkState.seen + walkState.base)));
      pages += 1;
    } else if (walkState.seen > 0) walkState.boundaryChecked = true;
    if (walkState.seen && page.rows.length && Number(page.rows[0].ticketId) <= Number(walkState.lastTicketId)) throw new CensusRequestError('incomplete_ticket_page');
    const before = walkState.seen;
    take(page, walkState, labels, rows, customers, equipmentId, keep);
    if (walkState.seen - before !== page.rows.length || walkState.seen > page.total) throw new CensusRequestError('incomplete_ticket_page');
    saveWalk(cursor, kind, walkState);
    if (walkState.seen === page.total) {
      if (kind === 'status') { cursor.statusOrdinal += 1; resetFields(cursor); }
      else resetWalk(cursor, 'recent');
      return 'done';
    }
    if (page.rows.length !== 50) throw new CensusRequestError('incomplete_ticket_page');
  }
  return 'partial';
}
function resetFields(cursor: CensusCursor) {
  cursor.statusSeen = 0; cursor.statusBase = 0; cursor.statusBoundaryChecked = false; cursor.statusLastTicketId = null;
}
function dedupe(rows: CensusRow[]): CensusRow[] {
  const map = new Map<string, CensusRow>();
  for (const row of rows) {
    const prior = map.get(row.ticketId);
    if (!prior) { map.set(row.ticketId, row); continue; }
    const merged = {...row, customerName: row.customerName || prior.customerName, equipmentId: row.equipmentId || prior.equipmentId, status: row.status || prior.status, type: row.type || prior.type, scheduledAt: row.scheduledAt || prior.scheduledAt};
    owners.set(merged, customerIdOf(row) || customerIdOf(prior));
    map.set(row.ticketId, merged);
  }
  return [...map.values()];
}
