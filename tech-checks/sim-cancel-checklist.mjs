/** Same rules as operations/src/simCancelChecklist.ts. The intake page uses this copy. */
export const SIM_CARRIERS = ['Verizon', 'AT&T', 'T-Mobile', 'Other'];
const FORBIDDEN = /iccid|imsi|imei/i;

function clean(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) return null;
  return trimmed;
}
function fail(error) { return { ok: false, error }; }

export function simLast4(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4 || digits === raw) return '';
  return '•••• ' + digits.slice(-4);
}

export function simCancelTodo(item) {
  return { id: 'sim:' + item.productId, kind: 'sim_cancel', unit: item.unit, detail: 'Cancel SIM: ' + item.unit };
}

export function assessSimCancel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('This cancellation is not complete.');
  for (const key of Object.keys(input)) {
    if (FORBIDDEN.test(key)) return fail('This cancellation is not complete.');
  }
  const productId = clean(input.productId, 18);
  if (!productId || !/^[1-9]\d{0,17}$/.test(productId)) return fail('Enter the Product ID for this unit.');
  const unit = clean(input.unit, 40);
  if (!unit) return fail('Enter the unit.');
  const outcome = input.outcome === 'no_sim' ? 'no_sim' : input.outcome === 'canceled' ? 'canceled' : null;
  if (!outcome) return fail('This cancellation is not complete.');
  const canceledBy = clean(input.canceledBy, 80);
  if (!canceledBy) return fail(outcome === 'no_sim' ? 'Enter who checked this unit.' : 'Enter who canceled the SIM.');
  const confirmation = input.confirmation == null || input.confirmation === '' ? null : clean(input.confirmation, 80);
  if (input.confirmation != null && input.confirmation !== '' && !confirmation) return fail('The confirmation note is not valid.');
  if (outcome === 'no_sim') {
    const noSimReason = clean(input.noSimReason, 200);
    if (!noSimReason) return fail('Enter why this unit has no SIM.');
    if (clean(input.simNumber, 32)) return fail('This cancellation is not complete.');
    return { ok: true, record: { productId, unit, outcome, carrier: null, canceledOn: null, canceledBy, confirmation, simNumber: null, noSimReason } };
  }
  const carrier = clean(input.carrier, 20);
  if (!carrier || !SIM_CARRIERS.includes(carrier)) return fail('Choose the carrier.');
  const canceledOn = clean(input.canceledOn, 10);
  if (!canceledOn || !/^\d{4}-\d{2}-\d{2}$/.test(canceledOn) || Number.isNaN(Date.parse(canceledOn + 'T00:00:00Z'))) return fail('Enter the date the SIM was canceled.');
  const simNumber = clean(input.simNumber, 32);
  if (!simNumber || simNumber.length < 8) return fail('Enter the SIM number.');
  return { ok: true, record: { productId, unit, outcome, carrier, canceledOn, canceledBy, confirmation, simNumber, noSimReason: null } };
}

export function closeoutAllowed(input) {
  const action = String(input?.action || '').toLowerCase();
  if (!['pickup', 'cancel', 'canceled', 'cancelled'].includes(action)) return { ok: true };
  return assessSimCancel(input?.simCancel);
}

function keptLast4(value) {
  const text = String(value || '');
  return /^•••• \d{4}$/.test(text) ? text : '';
}

export function simCancelForNotes(record) {
  const simNumber = record?.simNumber || null;
  return {
    productId: record.productId, unit: record.unit, outcome: record.outcome, carrier: record.carrier,
    canceledOn: record.canceledOn, canceledBy: record.canceledBy, confirmation: record.confirmation,
    noSimReason: record.noSimReason, simNumber: null,
    simLast4: simNumber ? simLast4(simNumber) : keptLast4(record?.simLast4),
  };
}

export const PLATFORM_SIM_CANCEL_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';

export function simCancelProject(url) {
  try {
    const host = new URL(url).hostname;
    if (host === 'tughscoxralhofrckvxy.supabase.co') return 'platform';
    if (host === 'goqrnolcvqnirjmzaeyk.supabase.co') return 'cameras-on-site';
    return 'other';
  } catch {
    return 'other';
  }
}

export async function recordSimCancel(transport, record, returnId) {
  const gate = assessSimCancel(record);
  if (!gate.ok) return gate;
  const url = typeof transport?.url === 'string' ? transport.url : PLATFORM_SIM_CANCEL_URL;
  if (simCancelProject(url) !== 'platform' || typeof transport?.from === 'function' || !transport?.accessToken || typeof returnId !== 'string' || !returnId) {
    return fail('The SIM step could not be saved.');
  }
  const send = typeof transport.fetch === 'function' ? transport.fetch : globalThis.fetch;
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + transport.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'POST', path: '/api/sim-cancel', body: { ...gate.record, returnId } }),
    });
    if (!response?.ok) return fail('The SIM step could not be saved.');
    return { ok: true };
  } catch {
    return fail('The SIM step could not be saved.');
  }
}
