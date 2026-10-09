export type ITMhelpTicket = {
  ticketNumber: string;
  site: string;
  workType: string;
  scheduledFor: string;
  scheduledTime: string;
  finished: boolean;
  equipment: string[];
};
export type ITMhelpInfo = { items: ITMhelpTicket[]; generatedAt: string };

export class ITMhelpReadError extends Error {
  response: { status: number };
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'ITMhelpReadError';
    this.response = { status };
  }
}

const unavailable = 'MHelp references could not be loaded. Refresh to try again.';
const invalidResponse = 'MHelp references returned incomplete information. Refresh before relying on this view.';
const errorMessages: Record<string, string> = {
  forbidden: 'Your current IT session could not be verified. Return to Tech Checks and sign in again.',
  timeout: 'MHelp references took too long to load. Refresh to try again.',
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function cleanString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
function equipmentLabel(value: unknown): value is string {
  if (!cleanString(value, 175) || /https?:\/\/|[<>]/i.test(value)) return false;
  const parts = value.match(/^([1-9]\d{0,6}) × (.+)$/);
  return Boolean(parts && Number(parts[1]) <= 1000000 && parts[2].trim() && parts[2].length <= 160);
}
function parseSnapshot(message: Record<string, unknown>): ITMhelpInfo {
  if (!Array.isArray(message.items) || message.items.length > 5000 || typeof message.generatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(message.generatedAt) || (!Number.isFinite(Date.parse(message.generatedAt)) || new Date(message.generatedAt).toISOString().slice(0, 19) !== message.generatedAt.slice(0, 19))) throw new Error(invalidResponse);
  const seen = new Set<string>();
  const items = message.items.map((row: unknown): ITMhelpTicket => {
    if (!isRecord(row) || !cleanString(row.ticketNumber, 80) || !row.ticketNumber.trim() || seen.has(row.ticketNumber) ||
        !cleanString(row.site, 300) || !cleanString(row.workType, 80) || !cleanString(row.scheduledFor, 10) ||
        !cleanString(row.scheduledTime, 20) || typeof row.finished !== 'boolean' || !Array.isArray(row.equipment) ||
        row.equipment.length > 100 || !row.equipment.every(equipmentLabel)) throw new Error(invalidResponse);
    if (row.scheduledFor) {
      const parsed = new Date(row.scheduledFor + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.scheduledFor) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.scheduledFor) throw new Error(invalidResponse);
    }
    if (row.scheduledTime && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(row.scheduledTime)) throw new Error(invalidResponse);
    seen.add(row.ticketNumber);
    // Reconstruct explicitly so a malformed parent response cannot carry extra
    // fields, credentials or unrestricted source records into consumers.
    return { ticketNumber: row.ticketNumber, site: row.site, workType: row.workType, scheduledFor: row.scheduledFor,
      scheduledTime: row.scheduledTime, finished: row.finished, equipment: [...row.equipment] as string[] };
  });
  return { items, generatedAt: message.generatedAt };
}

/** No tokens, direct database client, writes, persistence or settled cache. */
export function readITMhelpInfo(): Promise<ITMhelpInfo> {
  if (window.parent === window || location.origin === 'null') return Promise.reject(new ITMhelpReadError('Open MHelp info from your signed-in IT dashboard.', 401));
  return new Promise((resolve, reject) => {
    const parent = window.parent;
    const origin = location.origin;
    const requestId = crypto.randomUUID();
    let timer = 0;
    let settled = false;
    const cleanup = () => { window.removeEventListener('message', receive); window.removeEventListener('cos-workspace-navigation', navigate); window.clearTimeout(timer); };
    const fail = (message: string, status = 503) => { if (settled) return; settled = true; cleanup(); reject(new ITMhelpReadError(message, status)); };
    const navigate = () => fail('The workspace changed. Refresh MHelp info to read current references.');
    const receive = (event: MessageEvent) => {
      if (settled || event.origin !== origin || event.source !== parent || !isRecord(event.data)) return;
      const message = event.data;
      if (message.type !== 'COS_IT_MHELP_RESPONSE' || message.requestId !== requestId) return;
      if (Object.hasOwn(message, 'error')) return fail(typeof message.error === 'string' && Object.hasOwn(errorMessages, message.error) ? errorMessages[message.error] : unavailable, message.error === 'forbidden' ? 403 : 503);
      try {
        const result = parseSnapshot(message);
        settled = true;
        cleanup();
        resolve(result);
      } catch { fail(invalidResponse); }
    };
    window.addEventListener('message', receive);
    window.addEventListener('cos-workspace-navigation', navigate);
    timer = window.setTimeout(() => fail(errorMessages.timeout), 15000);
    try { parent.postMessage({ type: 'COS_IT_MHELP_REQUEST', requestId }, origin); }
    catch { fail(unavailable); }
  });
}
