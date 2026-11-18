import {CENSUS_WAIT_CAP_MS, TICKET_DAILY_CAP, TICKET_RUN_CAP, TICKET_RUNS_PER_DAY, censusBackoffMs, censusWaitAllowed} from './budget.ts';
import {CensusRequestError, assertCensusMethod, assertCensusPath, censusUrl, customerNamePath, equipmentTicketsPath, ticketDetailPath, ticketListPath, ticketStatusPath, ticketTypesPath} from './allowlist.ts';
import {projectCensusTicket, projectCustomerName, projectStatusLabels, projectTypeLabels, ticketPage, type CensusRow} from './project.ts';

export type {CensusRow} from './project.ts';
export type BudgetClaim = {allowed: boolean; runs: number; reads: number};
export class CensusStop extends Error {
  constructor(readonly reason: 'mhelp_ticket_access_denied' | 'mhelp_rate_limited' | 'daily_budget' | 'provider_wait' | 'run_cap') {
    super(reason); this.name = 'CensusStop';
  }
}
export type CensusCursor = {
  budgetDay: string | null;
  runsToday: number;
  readsToday: number;
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
  equipmentSeen: number;
  equipmentBase: 0 | 1;
  equipmentBoundaryChecked: boolean;
  equipmentLastTicketId: string | null;
  equipmentTruncated: boolean;
  equipmentSweepCount: number;
};
export function emptyCursor(): CensusCursor {
  return {budgetDay: null, runsToday: 0, readsToday: 0, statusOrdinal: 0, statusSeen: 0, statusBase: 0, statusBoundaryChecked: false, statusLastTicketId: null, recentSeen: 0, recentBase: 0, recentBoundaryChecked: false, recentLastTicketId: null, equipmentOrdinal: 0, equipmentSeen: 0, equipmentBase: 0, equipmentBoundaryChecked: false, equipmentLastTicketId: null, equipmentTruncated: false, equipmentSweepCount: 0};
}
type Walk = {seen: number; base: 0 | 1; boundaryChecked: boolean; lastTicketId: string | null};
type Direction = 'asc' | 'desc';
const RECENT_MS = 48 * 60 * 60 * 1000;
const MAX_JSON = 1048576;
const EQUIPMENT_PAGE = 2;
const EQUIPMENT_PAGES = 4;
const REFRESH_LIMIT = 4;
const NAME_LIMIT = 8;

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
const owners = new WeakMap<CensusRow, string | null>();
function customerIdOf(row: CensusRow): string | null { return owners.get(row) ?? null; }
function normalizeStatus(raw: Record<string, unknown>): string | null {
  return typeof raw.statusId === 'number' && Number.isSafeInteger(raw.statusId) && raw.statusId >= 0 ? String(raw.statusId) : typeof raw.statusId === 'string' && /^(0|[1-9][0-9]{0,14})$/.test(raw.statusId) ? raw.statusId : null;
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function readTicketCensus(options: {
  fetch: typeof fetch;
  accessToken: string;
  portalId: string;
  cursor?: Partial<CensusCursor>;
  equipmentIds?: string[];
  refreshTicketIds?: string[];
  onProgress?: (rows: CensusRow[], cursor: CensusCursor) => Promise<void>;
  claimRun?: (day: string) => Promise<BudgetClaim>;
  claimReads?: (day: string, count: number) => Promise<BudgetClaim>;
  onMissingTicket?: (ticketId: string) => Promise<void>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<{state: 'completed' | 'stopped'; reason: string | null; vendorReads: number; rows: CensusRow[]; cursor: CensusCursor; recentTruncated: boolean; equipmentTruncated: boolean; equipmentSortUnverified: boolean; flushed: boolean}> {
  if (!/^[1-9][0-9]{0,14}$/.test(options.portalId)) throw new CensusRequestError('mhelp_path_rejected');
  if (!options.accessToken || options.accessToken.length > 16384 || /\s/.test(options.accessToken)) throw new CensusRequestError('setup_source');
  const portal = options.portalId;
  const now = options.now || Date.now;
  const wait = options.wait || (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const cursor: CensusCursor = {...emptyCursor(), ...options.cursor};
  const rows: CensusRow[] = [];
  const customers = new Map<string, string | null>();
  let reads = 0, recentTruncated = false, equipmentSortUnverified = false;
  const names = {used: 0};
  const day = new Date(now()).toISOString().slice(0, 10);
  const finish = (state: 'completed' | 'stopped', reason: string | null) => ({state, reason, vendorReads: reads, rows, cursor, recentTruncated, equipmentTruncated: cursor.equipmentTruncated, equipmentSortUnverified, flushed: !!options.onProgress});
    const flush = async (pageRows: CensusRow[]) => {
      if (!options.onProgress) return;
      if (!pageRows.length) { await options.onProgress([], {...cursor}); return; }
      for (let index = 0; index < pageRows.length; index += 200) await options.onProgress(pageRows.slice(index, index + 200), {...cursor});
    };
  if (options.claimRun) {
    const claimed = checkedClaim(await options.claimRun(day));
    cursor.budgetDay = day; cursor.runsToday = claimed.runs; cursor.readsToday = claimed.reads;
    if (!claimed.allowed) { await flush([]); return finish('stopped', 'daily_budget'); }
  } else {
    if (cursor.budgetDay !== day) { cursor.budgetDay = day; cursor.runsToday = 0; cursor.readsToday = 0; }
    if (cursor.runsToday >= TICKET_RUNS_PER_DAY || cursor.readsToday >= TICKET_DAILY_CAP) { await flush([]); return finish('stopped', 'daily_budget'); }
    cursor.runsToday += 1;
  }
  await flush([]);
  const get = async (path: string): Promise<{status: number; body: unknown}> => {
    assertCensusMethod('GET');
    assertCensusPath(path, portal);
    if (reads >= TICKET_RUN_CAP || cursor.readsToday >= TICKET_DAILY_CAP) throw new CensusStop(cursor.readsToday >= TICKET_DAILY_CAP ? 'daily_budget' : 'run_cap');
    let attempt = 0;
    while (true) {
      if (options.signal?.aborted) throw new CensusRequestError('canceled');
      if (reads >= TICKET_RUN_CAP) throw new CensusStop('run_cap');
      if (options.claimReads) {
        const claimed = checkedClaim(await options.claimReads(day, 1));
        cursor.runsToday = claimed.runs; cursor.readsToday = claimed.reads;
        if (!claimed.allowed) throw new CensusStop('daily_budget');
      } else if (cursor.readsToday >= TICKET_DAILY_CAP) throw new CensusStop('daily_budget');
      else cursor.readsToday += 1;
      reads += 1;
      const response = await options.fetch(censusUrl(path, portal), {method: 'GET', headers: {Accept: 'application/json', Authorization: 'Bearer ' + options.accessToken}, redirect: 'error', cache: 'no-store', signal: options.signal});
      if (response.status === 401 || response.status === 403) { await cancel(response); throw new CensusStop('mhelp_ticket_access_denied'); }
      if (response.status === 429) {
        const budget = response.headers.get('X-COS-Mhelp-Budget') === '1';
        const deferred = response.headers.get('X-COS-Mhelp-Deferred') === '1';
        const retryAfter = response.headers.get('Retry-After');
        await cancel(response);
        if (budget || deferred || attempt >= 2) throw new CensusStop(budget ? 'daily_budget' : deferred ? 'provider_wait' : 'mhelp_rate_limited');
        const delay = censusBackoffMs(attempt, retryAfter, now());
        if (!censusWaitAllowed(delay) || delay > CENSUS_WAIT_CAP_MS) throw new CensusStop('mhelp_rate_limited');
        await wait(delay);
        attempt += 1;
        continue;
      }
      if (response.status === 404) { await cancel(response); return {status: 404, body: null}; }
      if (!response.ok) { await cancel(response); throw new CensusRequestError('mhelp_http_' + response.status); }
      return {status: response.status, body: await boundedJson(response)};
    }
  };
  try {
    const statuses = projectStatusLabels((await get(ticketStatusPath(portal))).body);
    const types = projectTypeLabels((await get(ticketTypesPath(portal))).body, portal);
    const labels = {status: new Map(statuses.map(row => [row.statusId, row.label])), type: new Map(types.map(row => [row.typeId, row.label]))};
    const open = statuses.filter(row => row.open);
    if (cursor.statusOrdinal >= open.length) resetStatus(cursor);
    if (open.length) {
      await walk(get, cursor, 'status', 'asc', ticketRow => ticketListPath(portal, {statusId: open[cursor.statusOrdinal].statusId}, ticketRow), 8, null, labels, rows, customers, portal, (row, raw) => normalizeStatus(raw) === open[cursor.statusOrdinal].statusId, flush);
    }
    const end = new Date(now()).toISOString(), start = new Date(now() - RECENT_MS).toISOString();
    const recent = await walk(get, cursor, 'recent', 'asc', ticketRow => ticketListPath(portal, {createStart: start, createEnd: end}, ticketRow), 4, null, labels, rows, customers, portal, (row) => Date.parse(row.createdAt) > Date.parse(start) && Date.parse(row.createdAt) < Date.parse(end), flush);
    recentTruncated = recent === 'partial';
    equipmentSortUnverified = await readEquipment(options.equipmentIds || [], get, cursor, labels, rows, customers, portal, flush);
    await refreshOpen(options.refreshTicketIds || [], get, labels, rows, customers, portal, flush, options.onMissingTicket);
    await flush(await namePass(rows, customers, portal, get, names));
    return finish(cursor.readsToday >= TICKET_DAILY_CAP || reads >= TICKET_RUN_CAP ? 'stopped' : 'completed', cursor.readsToday >= TICKET_DAILY_CAP ? 'daily_budget' : reads >= TICKET_RUN_CAP ? 'run_cap' : null);
  } catch (cause) {
    if (cause instanceof CensusStop) { await flush([]); return finish('stopped', cause.reason); }
    throw cause;
  }
}
async function namePass(pageRows: CensusRow[], known: Map<string, string | null>, portalId: string, read: (path: string) => Promise<{status: number; body: unknown}>, names: {used: number}): Promise<CensusRow[]> {
  const pending = [...new Set(pageRows.map(customerIdOf).filter((id): id is string => !!id && known.get(id) == null))].slice(0, NAME_LIMIT - names.used);
  const named: CensusRow[] = [];
  for (const customerId of pending) {
    names.used += 1;
    let name: string;
    try { name = projectCustomerName((await read(customerNamePath(portalId, customerId))).body, customerId, portalId); }
    catch (cause) {
      if (cause instanceof CensusStop) throw cause;
      if (cause instanceof Error && cause.message === 'customer_name_unavailable') continue;
      throw cause;
    }
    known.set(customerId, name);
    for (const row of pageRows) if (customerIdOf(row) === customerId) { row.customerName = name; named.push(row); }
  }
  return named;
}

function resetStatus(cursor: CensusCursor) {
  cursor.statusOrdinal = 0; cursor.statusSeen = 0; cursor.statusBase = 0; cursor.statusBoundaryChecked = false; cursor.statusLastTicketId = null;
}
function resetEquipment(cursor: CensusCursor) {
  cursor.equipmentSeen = 0; cursor.equipmentBase = 0; cursor.equipmentBoundaryChecked = false; cursor.equipmentLastTicketId = null;
}
function walkOf(cursor: CensusCursor, kind: 'status' | 'recent' | 'equipment'): Walk {
  if (kind === 'status') return {seen: cursor.statusSeen, base: cursor.statusBase, boundaryChecked: cursor.statusBoundaryChecked, lastTicketId: cursor.statusLastTicketId};
  if (kind === 'recent') return {seen: cursor.recentSeen, base: cursor.recentBase, boundaryChecked: cursor.recentBoundaryChecked, lastTicketId: cursor.recentLastTicketId};
  return {seen: cursor.equipmentSeen, base: cursor.equipmentBase, boundaryChecked: cursor.equipmentBoundaryChecked, lastTicketId: cursor.equipmentLastTicketId};
}
function saveWalk(cursor: CensusCursor, kind: 'status' | 'recent' | 'equipment', walk: Walk) {
  if (kind === 'status') { cursor.statusSeen = walk.seen; cursor.statusBase = walk.base; cursor.statusBoundaryChecked = walk.boundaryChecked; cursor.statusLastTicketId = walk.lastTicketId; }
  else if (kind === 'recent') { cursor.recentSeen = walk.seen; cursor.recentBase = walk.base; cursor.recentBoundaryChecked = walk.boundaryChecked; cursor.recentLastTicketId = walk.lastTicketId; }
  else { cursor.equipmentSeen = walk.seen; cursor.equipmentBase = walk.base; cursor.equipmentBoundaryChecked = walk.boundaryChecked; cursor.equipmentLastTicketId = walk.lastTicketId; }
}
function after(direction: Direction, nextId: number, lastId: number): boolean {
  return direction === 'asc' ? nextId > lastId : nextId < lastId;
}
function checkedClaim(value: BudgetClaim): BudgetClaim {
  if (!value || (value.allowed !== true && value.allowed !== false) || !Number.isSafeInteger(value.runs) || value.runs < 0 || !Number.isSafeInteger(value.reads) || value.reads < 0) throw new CensusRequestError('budget_unavailable');
  return value;
}
function inOrder(rows: Record<string, unknown>[], direction: Direction): boolean {
  return rows.every((row, index) => index === 0 || after(direction, Number(row.ticketId), Number(rows[index - 1].ticketId)));
}
function take(page: {total: number; rows: Record<string, unknown>[]}, walk: Walk | null, direction: Direction, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, equipmentId: string | null, portalId: string, keep: (row: CensusRow, raw: Record<string, unknown>) => boolean): CensusRow[] {
  if (page.rows.some((row, index) => index > 0 && !after(direction, Number(row.ticketId), Number(page.rows[index - 1].ticketId)))) throw new CensusRequestError('incomplete_ticket_page');
  const added: CensusRow[] = [];
  for (const raw of page.rows) {
    const projected = projectCensusTicket(raw, labels, equipmentId, portalId);
    if (!projected || !keep(projected.row, raw)) throw new CensusRequestError('incomplete_ticket_page');
    owners.set(projected.row, projected.customerId);
    if (projected.customerId && !customers.has(projected.customerId)) customers.set(projected.customerId, null);
    rows.push(projected.row);
    added.push(projected.row);
    if (walk) { walk.seen += 1; walk.lastTicketId = projected.row.ticketId; }
  }
  return added;
}
async function walk(get: (path: string) => Promise<{status: number; body: unknown}>, cursor: CensusCursor, kind: 'status' | 'recent' | 'equipment', direction: Direction, pathFor: (rowIndex: number | null) => string, maxPages: number, equipmentId: string | null, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, portalId: string, keep: (row: CensusRow, raw: Record<string, unknown>) => boolean, flush: (rows: CensusRow[]) => Promise<void>): Promise<'done' | 'partial' | 'unordered'> {
  const walkState = walkOf(cursor, kind);
  let pages = 0;
  while (pages < maxPages) {
    const rowIndex = walkState.seen === 0 ? null : walkState.seen + walkState.base;
    let page = ticketPage((await get(pathFor(rowIndex))).body);
    pages += 1;
    if (walkState.seen > 0 && !walkState.boundaryChecked && page.rows.length && String(page.rows[0].ticketId) === walkState.lastTicketId) {
      walkState.base = 1;
      walkState.boundaryChecked = true;
      saveWalk(cursor, kind, walkState);
      if (pages >= maxPages) { await flush([]); return 'partial'; }
      page = ticketPage((await get(pathFor(walkState.seen + walkState.base))).body);
      pages += 1;
    } else if (walkState.seen > 0) walkState.boundaryChecked = true;
    if (kind === 'equipment' && !inOrder(page.rows, direction)) return 'unordered';
    if (walkState.seen && page.rows.length && !after(direction, Number(page.rows[0].ticketId), Number(walkState.lastTicketId))) {
      if (kind === 'equipment') return 'unordered';
      throw new CensusRequestError('incomplete_ticket_page');
    }
    const before = walkState.seen;
    const added = take(page, walkState, direction, labels, rows, customers, equipmentId, portalId, keep);
    if (walkState.seen - before !== page.rows.length || walkState.seen > page.total) throw new CensusRequestError('incomplete_ticket_page');
    saveWalk(cursor, kind, walkState);
    if (walkState.seen === page.total) {
      if (kind === 'status') { cursor.statusOrdinal += 1; cursor.statusSeen = 0; cursor.statusBase = 0; cursor.statusBoundaryChecked = false; cursor.statusLastTicketId = null; }
      else if (kind === 'recent') { cursor.recentSeen = 0; cursor.recentBase = 0; cursor.recentBoundaryChecked = false; cursor.recentLastTicketId = null; }
      await flush(added);
      return 'done';
    }
    if (page.rows.length !== 50) throw new CensusRequestError('incomplete_ticket_page');
    await flush(added);
  }
  return 'partial';
}
async function readEquipment(ids: string[], get: (path: string) => Promise<{status: number; body: unknown}>, cursor: CensusCursor, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, portalId: string, flush: (rows: CensusRow[]) => Promise<void>): Promise<boolean> {
  let unverified = false;
  const usable = ids.filter(id => /^[1-9][0-9]{0,14}$/.test(id)).slice(0, EQUIPMENT_PAGE);
  if (!usable.length) {
    cursor.equipmentOrdinal = 0;
    cursor.equipmentSweepCount += 1;
    cursor.equipmentTruncated = false;
    resetEquipment(cursor);
    await flush([]);
    return unverified;
  }
  for (const equipmentId of usable) {
    const outcome = await walk(get, cursor, 'equipment', 'desc', ticketRow => equipmentTicketsPath(portalId, equipmentId, ticketRow), EQUIPMENT_PAGES, equipmentId, labels, rows, customers, portalId, () => true, flush);
    if (outcome === 'unordered') { unverified = true; cursor.equipmentOrdinal += 1; cursor.equipmentTruncated = false; resetEquipment(cursor); await flush([]); continue; }
    if (outcome === 'partial') { cursor.equipmentTruncated = true; await flush([]); return unverified; }
    cursor.equipmentOrdinal += 1;
    cursor.equipmentTruncated = false;
    resetEquipment(cursor);
  }
  if (usable.length < EQUIPMENT_PAGE) {
    cursor.equipmentOrdinal = 0;
    cursor.equipmentSweepCount += 1;
    await flush([]);
  }
  return unverified;
}
async function refreshOpen(ids: string[], get: (path: string) => Promise<{status: number; body: unknown}>, labels: {status: Map<string, string>; type: Map<string, string>}, rows: CensusRow[], customers: Map<string, string | null>, portalId: string, flush: (rows: CensusRow[]) => Promise<void>, onMissing?: (ticketId: string) => Promise<void>) {
  for (const ticketId of ids.filter(id => /^[1-9][0-9]{0,14}$/.test(id)).slice(0, REFRESH_LIMIT)) {
    const response = await get(ticketDetailPath(portalId, ticketId));
    if (response.status === 404) { if (onMissing) await onMissing(ticketId); continue; }
    if (!plain(response.body)) throw new CensusRequestError('incomplete_ticket_page');
    const projected = projectCensusTicket(response.body, labels, null, portalId);
    if (!projected) throw new CensusRequestError('incomplete_ticket_page');
    owners.set(projected.row, projected.customerId);
    if (projected.customerId && !customers.has(projected.customerId)) customers.set(projected.customerId, null);
    rows.push(projected.row);
    await flush([projected.row]);
  }
}
