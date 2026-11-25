/**
 * The mHelp equipment list, handed to a scheduled caller so Tech Check can keep
 * its own copy next to camera_devices.
 *
 * Why this exists. The camera health sweep lives in the Tech Check project and
 * will not check a unit whose ownership it cannot confirm, which it does by the
 * unit's mHelp A#. The mHelp list lives in this project. Tech Check cannot read
 * this project's tables: a function here holds this project's key, and sending
 * that key to Tech Check would put this project's credential somewhere it does
 * not belong. James chose, 2026-11-24, that the list should instead live in the
 * Tech Check project, so a scheduled run there needs no credential of ours.
 *
 * So this endpoint reads nothing new and decides nothing. It takes the accepted
 * baseline that the inventory sync already writes every thirty minutes and
 * projects the few fields a link needs. It never writes. It is additive: no
 * existing function, table or schedule changes because it exists.
 *
 * Read-only, and deliberately boring.
 */

export const FIELD_LIST_CONTRACT = 'cos-mhelp-field-list-v1';

type Row = Record<string, unknown>;

export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
});

const CONTROL = /[\x00-\x1f\x7f]/;

/** A short piece of text as mHelp wrote it, or null. Punctuation and spacing are kept exactly. */
function text(value: unknown, limit: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > limit || CONTROL.test(value)) throw Error('Unsupported record');
  return value;
}

/** An mHelp equipment id: the A#, digits only, no leading zero. */
function productId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,14}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw Error('Unsupported record');
  }
  return value;
}

/** An ISO time, or null. A time that cannot be read is null, never a guess. */
function instant(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw Error('Unsupported record');
  }
  return value;
}

export type FieldListRecord = {
  productId: string;
  unitNumber: string;
  placement: string | null;
  lifecycle: string | null;
  category: string | null;
  customer: string | null;
  sourceAddress: string | null;
  holdReason: string | null;
  /**
   * When mHelp was last observed to say this unit's placement.
   *
   * The retirement rule needs this and nothing else: a hand fix to placement
   * is retired only once mHelp has observed the unit in the shop AFTER the fix
   * was made. A missing time never retires anything.
   */
  placementObservedAt: string | null;
};

/** One mHelp record, projected to what a link and the retirement rule need. */
export function projectFieldListRecord(value: unknown): FieldListRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Unsupported record');
  const row = value as Row;
  const unitNumber = text(row.unitNumber, 180);
  if (!unitNumber) throw Error('Unsupported record');
  const dates = row.sourceDates && typeof row.sourceDates === 'object' && !Array.isArray(row.sourceDates)
    ? row.sourceDates as Row : {};
  return {
    productId: productId(row.productId),
    unitNumber,
    placement: text(row.placement, 32),
    lifecycle: text(row.lifecycle, 64),
    category: text(row.category, 120),
    customer: text(row.customer, 240),
    sourceAddress: text(row.sourceAddress, 240),
    holdReason: text(row.holdReason, 64),
    placementObservedAt: instant(dates.apiCategoryObservedAt),
  };
}

/** The whole list, with the source fingerprint so Tech Check can tell a refresh apart from a repeat. */
export function projectFieldList(baseline: unknown): {
  contract: string; portalId: string | null; sourceSha256: string | null; complete: boolean;
  recordCount: number; records: FieldListRecord[];
} {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) throw Error('Unsupported baseline');
  const value = baseline as Row;
  if (!Array.isArray(value.records)) throw Error('Unsupported baseline');
  if (value.records.length > 5000) throw Error('Unsupported baseline');
  const records = value.records.map(projectFieldListRecord);
  const seen = new Set(records.map(record => record.productId));
  if (seen.size !== records.length) throw Error('Unsupported baseline');
  return {
    contract: FIELD_LIST_CONTRACT,
    portalId: text(value.portalId, 20),
    sourceSha256: typeof value.sourceSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sourceSha256) ? value.sourceSha256 : null,
    complete: value.complete === true,
    recordCount: records.length,
    records,
  };
}

/** Reads the action from a scheduled caller's request. The only action is `list`. */
export async function readListAction(req: Request): Promise<'list'> {
  if (req.method !== 'POST' || new URL(req.url).search
      || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) throw Error('Invalid request');
  const raw = await req.text();
  if (raw.length > 256) throw Error('Invalid request');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 1 || value.action !== 'list') throw Error('Invalid request');
  return 'list';
}

export function createMhelpFieldListHandler(options: {
  authenticate: (req: Request) => Promise<boolean> | boolean;
  readBaseline: () => Promise<unknown>;
}) {
  return async (req: Request) => {
    try { if (!await options.authenticate(req)) return reply({error: 'Forbidden'}, 403); }
    catch { return reply({error: 'Forbidden'}, 403); }
    try { await readListAction(req); } catch { return reply({error: 'Invalid list request'}, 400); }
    let baseline: unknown;
    try { baseline = await options.readBaseline(); }
    catch { return reply({error: 'The mHelp list is unavailable. Retry later.'}, 503); }
    // A record this endpoint cannot read is a reason to serve nothing, not to
    // serve a list with a hole in it: a partial list would quietly under-link.
    try { return reply({...projectFieldList(baseline), readAt: new Date().toISOString()}); }
    catch { return reply({error: 'The saved mHelp list is not in a shape this endpoint can serve.'}, 503); }
  };
}
