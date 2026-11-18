import {emptyCursor, type CensusCursor, type CensusRow} from './read.ts';
import {CensusRequestError} from './allowlist.ts';

type RunResult = {state: 'completed' | 'stopped'; reason: string | null; vendorReads: number; rows: CensusRow[]; cursor: CensusCursor; recentTruncated: boolean; equipmentTruncated: boolean; flushed?: boolean};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
export const UPSERT_LIMIT = 200;

/** Save at most 200 rows per upsert, and save the cursor after each chunk. */
export async function persistCensusChunk(rows: CensusRow[], cursor: CensusCursor, saveRows: (rows: CensusRow[]) => Promise<unknown>, saveCursor: (cursor: CensusCursor) => Promise<unknown>) {
  if (rows.length > UPSERT_LIMIT) {
    for (let index = 0; index < rows.length; index += UPSERT_LIMIT) {
      await saveRows(rows.slice(index, index + UPSERT_LIMIT));
      await saveCursor(cursor);
    }
    return;
  }
  if (rows.length) await saveRows(rows);
  await saveCursor(cursor);
}

export function createTicketCensusHandler(options: {
  authenticate: (req: Request) => Promise<boolean>;
  run: (persist: (rows: CensusRow[], cursor: CensusCursor) => Promise<void>) => Promise<RunResult>;
  saveRows: (rows: CensusRow[]) => Promise<unknown>;
  saveCursor: (cursor: CensusCursor) => Promise<unknown>;
  status: () => Promise<unknown>;
}) {
  return async (req: Request) => {
    if (req.method !== 'POST' || new URL(req.url).search || req.headers.has('origin')) return reply({error: 'Scheduled request required', mhelpWrites: 0}, 405);
    try { if (!await options.authenticate(req)) return reply({error: 'Forbidden', mhelpWrites: 0}, 403); }
    catch { return reply({error: 'Forbidden', mhelpWrites: 0}, 403); }
    let action: string;
    try {
      if (!/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')) throw new Error('invalid');
      const raw = await req.text();
      if (raw.length > 64) throw new Error('invalid');
      const body = JSON.parse(raw);
      if (!object(body) || Object.keys(body).length !== 1 || (body.action !== 'run' && body.action !== 'status')) throw new Error('invalid');
      action = body.action;
    } catch { return reply({error: 'Invalid request', mhelpWrites: 0}, 400); }
    try {
      if (action === 'status') {
        const status = await options.status();
        if (!object(status)) throw new CensusRequestError('cursor_unavailable');
        return reply({state: 'idle', censusRows: count(status.censusRows), cursor: status.cursor ?? emptyCursor(), mhelpWrites: 0, jobCreates: 0, jobEdits: 0});
      }
      const persist = (rows: CensusRow[], cursor: CensusCursor) => persistCensusChunk(rows, cursor, options.saveRows, options.saveCursor);
      const result = await options.run(persist);
      if (!result.flushed) await persist(result.rows, result.cursor);
      if (result.state === 'stopped') console.error('ticket_census_stopped', result.reason);
      if (result.recentTruncated) console.error('ticket_census_recent_truncated');
      if (result.equipmentTruncated) console.error('ticket_census_equipment_truncated');
      return reply({state: result.state, reason: result.reason, vendorReads: result.vendorReads, censusRows: result.rows.length, recentTruncated: result.recentTruncated, equipmentTruncated: result.equipmentTruncated, mhelpWrites: 0, jobCreates: 0, jobEdits: 0});
    } catch (cause) {
      console.error('ticket_census_failed', cause instanceof CensusRequestError ? cause.message : 'unclassified');
      return reply({error: 'Ticket census unavailable', mhelpWrites: 0, jobCreates: 0, jobEdits: 0}, 503);
    }
  };
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : 0;
}
