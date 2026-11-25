// Operations project: adds one row to the Deactivation History tab of the cancellations sheet, as the COS
// service account (cos-unit-tracker@...), which James shared the sheet with on 25 Nov 2026.
// Called only by Tech Check's cos-vendor-request after it has sent a cancellation email. The caller proves itself
// with the shared camera cron secret, checked by Tech Check (the same check cos-sheets-placement-publish uses),
// so no Google key moves between projects. It can only append to that one tab, nothing else.
// POST {action:'check'} -> {sheet_opens}; POST {action:'append', row:[9 cells]} -> {range}.
export const SHEET = '1ygv0GfUm-0_irHrZiIbF04e6bDEHz61UWhjh8JXrpwI';
export const TAB = 'Deactivation History';
export const EMAIL = 'cos-unit-tracker@causal-jigsaw-511211-k9.iam.gserviceaccount.com';
const TOKEN = 'https://oauth2.googleapis.com/token';
const OPERATIONS = 'https://tughscoxralhofrckvxy.supabase.co';

type Signer = (privateKey: string, header: {alg: 'RS256'; typ: 'JWT'; kid: string}, payload: Record<string, unknown>) => Promise<string>;

/** One cell: plain text, no formulas (a leading = + - @ is refused, so nothing in a row can run in the sheet). */
export function cleanRow(row: unknown): string[] | null {
  if (!Array.isArray(row) || row.length !== 9) return null;
  const out: string[] = [];
  for (const c of row) {
    if (typeof c !== 'string' || c.length > 300 || /[\u0000-\u001f\u007f]/.test(c) || /^\s*[=+\-@]/.test(c)) return null;
    out.push(c.trim());
  }
  return out[0] && out[2] ? out : null;
}

export function createDeactivationLog(o: {getEnv: (n: string) => string | undefined; fetch?: typeof fetch; sign: Signer; verify: (secret: string) => Promise<boolean>; now?: () => number}) {
  const request = o.fetch ?? fetch, now = o.now ?? Date.now;
  async function token(): Promise<string> {
    let a: any; try { a = JSON.parse(o.getEnv('COS_GOOGLE_SERVICE_ACCOUNT_JSON') || ''); } catch { throw new Error('The sheet account is not set up.'); }
    if (a?.client_email !== EMAIL || typeof a.private_key !== 'string' || typeof a.private_key_id !== 'string') throw new Error('The sheet account is not set up.');
    const iat = Math.floor(now() / 1000);
    const assertion = await o.sign(a.private_key, {alg: 'RS256', typ: 'JWT', kid: a.private_key_id}, {iss: EMAIL, aud: TOKEN, iat, exp: iat + 3600, scope: 'https://www.googleapis.com/auth/spreadsheets'});
    const r = await request(TOKEN, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, redirect: 'error',
      body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}).toString(), signal: AbortSignal.timeout(15000)});
    const v = await r.json().catch(() => ({}));
    if (!r.ok || typeof v.access_token !== 'string') throw new Error('Google refused the sheet account.');
    return v.access_token;
  }
  return async (req: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (req.method !== 'POST') return reply({error: 'POST required.'}, 405);
    if (o.getEnv('SUPABASE_URL') !== OPERATIONS) return reply({error: 'Wrong project.'}, 503);
    const secret = req.headers.get('x-camera-cron-secret') || '';
    if (!secret || secret.length > 1024 || /\s/.test(secret) || !(await o.verify(secret).catch(() => false))) return reply({error: 'Forbidden'}, 403);
    let body: any; try { body = await req.json(); } catch { return reply({error: 'Invalid request.'}, 400); }
    try {
      const auth = {Authorization: 'Bearer ' + await token()};
      if (body?.action === 'check') {
        const r = await request('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET + '?fields=sheets.properties.title', {headers: auth, signal: AbortSignal.timeout(15000)});
        const v = await r.json().catch(() => ({}));
        return reply({sheet_opens: r.ok, tab_found: r.ok && Array.isArray(v.sheets) && v.sheets.some((s: any) => s?.properties?.title === TAB), status: r.status});
      }
      if (body?.action !== 'append') return reply({error: 'Unknown action.'}, 400);
      const row = cleanRow(body.row);
      if (!row) return reply({error: 'The row is not valid.'}, 400);
      const r = await request('https://sheets.googleapis.com/v4/spreadsheets/' + SHEET + '/values/' + encodeURIComponent("'" + TAB + "'!A:I")
        + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'},
        body: JSON.stringify({values: [row]}), signal: AbortSignal.timeout(20000)});
      const v = await r.json().catch(() => ({}));
      if (!r.ok) return reply({ok: false, status: r.status});
      return reply({ok: true, range: String(v?.updates?.updatedRange || '').replace(/^.*!/, '')});
    } catch (e) { return reply({ok: false, error: (e as Error).message}, 502); }
  };
}
