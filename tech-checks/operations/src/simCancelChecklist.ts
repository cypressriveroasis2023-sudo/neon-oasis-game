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

function keptLast4(value: unknown) {
  const text = String(value || '');
  return /^•••• \d{4}$/.test(text) ? text : '';
}

/** Notes and lists keep the last four digits. The full number is not copied. */
export function simCancelForNotes(record: SimCancelRecord & { simLast4?: string }): SimCancelRecord & { simLast4: string } {
  const simNumber = record?.simNumber || null;
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
    simLast4: simNumber ? simLast4(simNumber) : keptLast4(record?.simLast4),
  };
}

export const PLATFORM_SIM_CANCEL_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-sim-cancel';

export function simCancelProject(url: string): 'platform' | 'cameras-on-site' | 'other' {
  try {
    const host = new URL(url).hostname;
    if (host === 'tughscoxralhofrckvxy.supabase.co') return 'platform';
    if (host === 'goqrnolcvqnirjmzaeyk.supabase.co') return 'cameras-on-site';
    return 'other';
  } catch {
    return 'other';
  }
}

type SimCancelTransport = {
  url?: string;
  accessToken?: string;
  from?: unknown;
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok?: boolean }>;
};

export async function recordSimCancel(transport: SimCancelTransport, record: unknown, returnId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = assessSimCancel(record);
  if (!gate.ok) return gate;
  const url = typeof transport?.url === 'string' ? transport.url : PLATFORM_SIM_CANCEL_URL;
  if (simCancelProject(url) !== 'platform' || typeof transport?.from === 'function' || !transport?.accessToken || typeof returnId !== 'string' || !returnId) {
    return fail('The SIM step could not be saved.');
  }
  if (!url.endsWith('/functions/v1/cos-sim-cancel')) return fail('The SIM step could not be saved.');
  const send = typeof transport.fetch === 'function' ? transport.fetch : globalThis.fetch.bind(globalThis);
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + transport.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...gate.record, returnId }),
    });
    if (!response?.ok) {
      let message = 'The SIM step could not be saved.';
      const read = (response as { json?: () => Promise<{ error?: unknown }> }).json;
      if (typeof read === 'function') {
        try {
          const data = await read();
          if (data?.error === 'This return already has a different SIM record.') message = data.error;
        } catch { /* Keep the generic message. */ }
      }
      return fail(message);
    }
    return { ok: true };
  } catch {
    return fail('The SIM step could not be saved.');
  }
}
