export {SIM_CARRIERS, simLast4, simCancelTodo, assessSimCancel, closeoutAllowed, simCancelForNotes} from './sim-cancel-rules.mjs';
import {assessSimCancel} from './sim-cancel-rules.mjs';

function fail(error) { return { ok: false, error }; }

export const PLATFORM_SIM_CANCEL_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-sim-cancel';

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
  if (!url.endsWith('/functions/v1/cos-sim-cancel')) return fail('The SIM step could not be saved.');
  const send = typeof transport.fetch === 'function' ? transport.fetch : globalThis.fetch;
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + transport.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...gate.record, returnId }),
    });
    if (!response?.ok) {
      let message = 'The SIM step could not be saved.';
      if (typeof response?.json === 'function') {
        try {
          const data = await response.json();
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
