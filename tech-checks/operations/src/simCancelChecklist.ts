/** SIM cancellation step. The full SIM number stays on this step and in the
 * staff-only table. Lists, the to-do, and the board receive the last four
 * digits only. Error text never includes the number. */

export const SIM_CARRIERS = ['Verizon', 'AT&T', 'T-Mobile', 'Other'] as const;

export type SimCancelRecord = {
  productId: string;
  unit: string;
  outcome: 'canceled' | 'no_sim';
  carrier: string | null;
  canceledOn: string | null;
  canceledBy: string;
  confirmation: string | null;
  simNumber: string | null;
  noSimReason: string | null;
};

export type SimCancelResult = { ok: true; record: SimCancelRecord } | { ok: false; error: string };

const FORBIDDEN = /iccid|imsi|imei/i;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) return null;
  return trimmed;
}

function fail(error: string): SimCancelResult {
  return { ok: false, error };
}

export function simLast4(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4 || digits === raw) return '';
  return '•••• ' + digits.slice(-4);
}

export function simCancelTodo(item: { unit: string; productId: string }): { id: string; kind: 'sim_cancel'; unit: string; detail: string } {
  return { id: 'sim:' + item.productId, kind: 'sim_cancel', unit: item.unit, detail: 'Cancel SIM: ' + item.unit };
}

/** A pickup or cancellation is complete only when this returns ok. */
export function assessSimCancel(input: unknown): SimCancelResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('This cancellation is not complete.');
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (FORBIDDEN.test(key)) return fail('This cancellation is not complete.');
  }
  const productId = clean(source.productId, 18);
  if (!productId || !/^[1-9]\d{0,17}$/.test(productId)) return fail('Enter the Product ID for this unit.');
  const unit = clean(source.unit, 40);
  if (!unit) return fail('Enter the unit.');
  const outcome = source.outcome === 'no_sim' ? 'no_sim' : source.outcome === 'canceled' ? 'canceled' : null;
  if (!outcome) return fail('This cancellation is not complete.');
  const canceledBy = clean(source.canceledBy, 80);
  if (!canceledBy) return fail(outcome === 'no_sim' ? 'Enter who checked this unit.' : 'Enter who canceled the SIM.');
  const confirmation = source.confirmation == null || source.confirmation === '' ? null : clean(source.confirmation, 80);
  if (source.confirmation != null && source.confirmation !== '' && !confirmation) return fail('The confirmation note is not valid.');
  if (outcome === 'no_sim') {
    const noSimReason = clean(source.noSimReason, 200);
    if (!noSimReason) return fail('Enter why this unit has no SIM.');
    if (clean(source.simNumber, 32)) return fail('This cancellation is not complete.');
    return { ok: true, record: { productId, unit, outcome, carrier: null, canceledOn: null, canceledBy, confirmation, simNumber: null, noSimReason } };
  }
  const carrier = clean(source.carrier, 20);
  if (!carrier || !SIM_CARRIERS.includes(carrier as typeof SIM_CARRIERS[number])) return fail('Choose the carrier.');
  const canceledOn = clean(source.canceledOn, 10);
  if (!canceledOn || !/^\d{4}-\d{2}-\d{2}$/.test(canceledOn) || Number.isNaN(Date.parse(canceledOn + 'T00:00:00Z'))) return fail('Enter the date the SIM was canceled.');
  const simNumber = clean(source.simNumber, 32);
  if (!simNumber || simNumber.length < 8) return fail('Enter the SIM number.');
  return { ok: true, record: { productId, unit, outcome, carrier, canceledOn, canceledBy, confirmation, simNumber, noSimReason: null } };
}

export function closeoutAllowed(input: { action?: string; simCancel?: unknown } | null | undefined): SimCancelResult | { ok: true } {
  const action = String(input?.action || '').toLowerCase();
  if (!['pickup', 'cancel', 'canceled', 'cancelled'].includes(action)) return { ok: true };
  const result = assessSimCancel(input?.simCancel);
  if (!result.ok) return result;
  return result;
}

/** Notes and lists keep the last four digits. The full number is not copied. */
export function simCancelForNotes(record: SimCancelRecord): SimCancelRecord & { simLast4: string } {
  return {
    productId: record.productId,
    unit: record.unit,
    outcome: record.outcome,
    carrier: record.carrier,
    canceledOn: record.canceledOn,
    canceledBy: record.canceledBy,
    confirmation: record.confirmation,
    noSimReason: record.noSimReason,
    simNumber: null,
    simLast4: record.simNumber ? simLast4(record.simNumber) : '',
  };
}

export async function recordSimCancel(db: { from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> } }, record: unknown, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = assessSimCancel(record);
  if (!gate.ok) return gate;
  const row = gate.record;
  try {
    const result = await db.from('cos_sim_cancel_records').insert({
      product_id: row.productId,
      unit_number: row.unit,
      outcome: row.outcome,
      carrier: row.carrier,
      canceled_on: row.canceledOn,
      canceled_by: row.canceledBy,
      confirmation: row.confirmation,
      sim_number: row.simNumber,
      no_sim_reason: row.noSimReason,
      recorded_by: userId,
    });
    if (result.error) return fail('The SIM step could not be saved.');
    return { ok: true };
  } catch {
    return fail('The SIM step could not be saved.');
  }
}
