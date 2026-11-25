// COS unit card: vendor emails (SIM cancellations, Eyeforce account changes).
// POST {action:'preview'|'send', kind, values, request_id}. The Owner sends anything; approved IT may send the
// Eyeforce account add and unit swap (James, 25 Nov), which go with Eyeforce's own form filled in and attached.
// preview: checks the blanks and returns the exact email. send: sends it once from James's Gmail
// with IT@ in CC, records it, and adds a row to the deactivation sheet when the kind is logged there.
import {TEMPLATES, DEFAULTS, SENDER, check, render, sheetRow, rawEmail, type Kind} from './templates.ts';
import {buildCif, cifFileName, hidePasswords} from './cif.ts';
import {CIF_TEMPLATE_B64} from './cif_template.ts';

const JAMES = 'e4abc521-1ef3-45a6-9829-b87faff78210';
// The cancellation sheet is written by the Operations function as the COS service account (James's own sign-in cannot).
const OPS_LOG = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-deactivation-log';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const ORIGINS = new Set(['https://cypressriveroasis2023-sudo.github.io']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createVendorHandler({admin, userClient, env, fetch: request = fetch, today = () => new Date()}: any) {
  const call = async (name: string, args: any) => { const {data, error} = await admin.rpc(name, args); if (error) throw new Error('COS could not record the request.'); return data; };
  let lastToken = '';
  async function sheetLog(body: unknown): Promise<any> {
    const secret = await call('cos_vendor_log_secret_v1', {});
    if (typeof secret !== 'string' || !secret) throw new Error('no secret');
    const r = await request(OPS_LOG, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret}, body: JSON.stringify(body), signal: AbortSignal.timeout(30000)});
    const v = await r.json().catch(() => ({}));
    return {...v, http: r.status};
  }
  async function google() {
    const c = ['TECHCHECK_GOOGLE_CLIENT_ID', 'TECHCHECK_GOOGLE_CLIENT_SECRET', 'TECHCHECK_GOOGLE_REFRESH_TOKEN'].map(n => String(env(n) || ''));
    if (c.some(v => !v)) throw new Error('The Google connection is not set up.');
    const r = await request('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: c[0], client_secret: c[1], refresh_token: c[2], grant_type: 'refresh_token'}), signal: AbortSignal.timeout(20000)});
    const t = await r.json();
    if (!r.ok || !t.access_token) throw new Error('The Google connection needs to be reconnected.');
    lastToken = t.access_token;
    const auth = {Authorization: 'Bearer ' + t.access_token};
    const who = await request('https://openidconnect.googleapis.com/v1/userinfo', {headers: auth, signal: AbortSignal.timeout(20000)});
    const me = await who.json();
    // Never send from a guessed account.
    if (!who.ok || String(me.email || '').toLowerCase() !== SENDER || me.email_verified !== true) throw new Error('The Google connection is not James\'s account.');
    return auth;
  }
  return async (req: Request) => {
    const origin = req.headers.get('origin');
    const cors: Record<string, string> = {'Content-Type': 'application/json', 'Vary': 'Origin'};
    if (origin && ORIGINS.has(origin)) Object.assign(cors, {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'});
    const reply = (body: any, status = 200) => new Response(JSON.stringify(body), {status, headers: cors});
    if (origin && !ORIGINS.has(origin)) return reply({error: 'Origin not allowed.'}, 403);
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (req.method !== 'POST') return reply({error: 'POST required.'}, 405);
    // The Owner, or approved IT for the kinds marked 'fleet'. The email goes out from James's mailbox.
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({error: 'Sign in required.'}, 401);
    const {data: user, error: userError} = await userClient.auth.getUser(token);
    if (userError || !user?.user?.id) return reply({error: 'Sign in required.'}, 401);
    const actor = await call('cos_vendor_actor_v1', {p_user: user.user.id});
    if (!actor?.owner && !actor?.fleet) return reply({error: 'Only the owner or approved IT can send vendor emails.'}, 403);
    const may = (k: Kind) => !!TEMPLATES[k] && (actor.owner || TEMPLATES[k].who === 'fleet');
    const sender = {name: String(actor.name || 'Cameras Onsite'), james: user.user.id === JAMES, it: !actor.owner};
    let body: any; try { body = await req.json(); } catch { return reply({error: 'Invalid request.'}, 400); }
    const action = body?.action;
    if (action === 'templates') return reply({owner: !!actor.owner,
      templates: Object.fromEntries(Object.entries(TEMPLATES).filter(([k]) => may(k as Kind)).map(([k, t]) => [k, {...t, defaults: DEFAULTS[k as Kind] || {}}]))});
    // The unit's cameras from COS, to start the form's camera tab. Read-only.
    if (action === 'cameras') return reply({cameras: await call('cos_vendor_unit_cameras_v1', {p_unit: String(body.unit || '').slice(0, 120)})});
    // Read-only connection check: the Google account, what it may do, and whether the sheet opens. Sends nothing.
    if (action === 'check') {
      try {
        const auth = await google();
        const info = await (await request('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(lastToken), {signal: AbortSignal.timeout(20000)})).json().catch(() => ({}));
        const scopes = String(info.scope || '').split(' ').filter(Boolean);
        void auth;
        const sheet = actor.owner ? await sheetLog({action: 'check'}).catch(() => ({})) : {sheet_opens: true, tab_found: true};
        return reply({account_ok: true, can_send: scopes.some(x => /gmail\.(send|compose|modify)|mail\.google\.com/.test(x)),
          can_edit_sheets: sheet.sheet_opens === true && sheet.tab_found === true, sheet_opens: sheet.sheet_opens === true, scopes});
      } catch (e) { return reply({account_ok: false, error: (e as Error).message}); }
    }
    if (action === 'recent') return reply({recent: await call('cos_vendor_recent_v1', {p_unit: String(body.unit || '').slice(0, 120)})});
    const kind = body?.kind as Kind;
    if (!TEMPLATES[kind]) return reply({error: 'Unknown request.'}, 400);
    if (!may(kind)) return reply({error: 'Only the owner can send this one.'}, 403);
    const {values, missing} = check(kind, body.values || {});
    if (missing.length) return reply({ok: false, missing});
    const mail = render(kind, values, sender);
    if (action === 'preview') return reply({ok: true, mail, form: TEMPLATES[kind].form ? cifFileName(kind as 'monitor_add' | 'monitor_swap', values) : null});
    // The filled form exactly as it will be attached, to open before sending. Sends nothing.
    if (action === 'form' && TEMPLATES[kind].form) {
      const bytes = await buildCif(fromB64(CIF_TEMPLATE_B64), kind as 'monitor_add' | 'monitor_swap', values);
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return reply({ok: true, name: cifFileName(kind as 'monitor_add' | 'monitor_swap', values), b64: btoa(bin)});
    }
    if (action !== 'send') return reply({error: 'Unknown action.'}, 400);
    if (typeof body.request_id !== 'string' || !UUID.test(body.request_id)) return reply({error: 'Request ID required.'}, 400);
    // One send per request id. A retry after a lost answer returns what happened.
    // Camera passwords go to Eyeforce in the attached form only; COS keeps '(given)' in their place.
    const claim = await call('cos_vendor_claim_v1', {p_id: body.request_id, p_kind: kind, p_unit: values.unit, p_values: hidePasswords(values), p_mail: mail, p_actor: user.user.id});
    if (claim.state !== 'new') return reply({ok: claim.state === 'sent', state: claim.state, sent_at: claim.sent_at, sheet: claim.sheet, error: claim.error || undefined});
    let auth: Record<string, string>;
    try { auth = await google(); }
    catch (e) { await call('cos_vendor_finish_v1', {p_id: body.request_id, p_state: 'failed', p_gmail: null, p_sheet: 'skipped', p_error: (e as Error).message}); return reply({ok: false, state: 'failed', error: (e as Error).message}); }
    let attachment: {name: string; type: string; bytes: Uint8Array} | undefined;
    if (TEMPLATES[kind].form) {
      try { attachment = {name: cifFileName(kind as 'monitor_add' | 'monitor_swap', values), type: XLSX, bytes: await buildCif(fromB64(CIF_TEMPLATE_B64), kind as 'monitor_add' | 'monitor_swap', values)}; }
      catch (e) { await call('cos_vendor_finish_v1', {p_id: body.request_id, p_state: 'failed', p_gmail: null, p_sheet: 'skipped', p_error: 'Form: ' + (e as Error).message}); return reply({ok: false, state: 'failed', error: 'COS could not fill in the Eyeforce form. Nothing was sent.'}); }
    }
    let gmail = '';
    try {
      const r = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'},
        body: JSON.stringify({raw: rawEmail(mail, body.request_id, attachment)}), signal: AbortSignal.timeout(30000)});
      const sent = await r.json().catch(() => ({}));
      if (!r.ok || !sent.id) throw new Error('Gmail did not accept the email (' + r.status + ').');
      gmail = sent.id;
    } catch (e) {
      // A timeout after Gmail accepted it may still have delivered: held for review, never sent twice.
      const timeout = /abort|timeout/i.test(String((e as Error).name) + String((e as Error).message));
      await call('cos_vendor_finish_v1', {p_id: body.request_id, p_state: timeout ? 'review' : 'failed', p_gmail: null, p_sheet: 'skipped', p_error: (e as Error).message});
      return reply({ok: false, state: timeout ? 'review' : 'failed', error: timeout ? 'No answer from Gmail. Check your Sent folder before sending again.' : (e as Error).message});
    }
    // The sheet comes after the email; a sheet failure never undoes or repeats the email.
    const day = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric'}).format(today());
    const row = sheetRow(kind, values, day);
    let sheet = 'not_logged_here';
    if (row) {
      try {
        const out = await sheetLog({action: 'append', row: row.map(c => c.replace(/^\s*([=+\-@])/, "'$1"))});
        sheet = out.ok === true ? 'added ' + String(out.range || '') : 'failed (' + (out.status || out.http) + ')';
      } catch { sheet = 'failed (no answer)'; }
    }
    await call('cos_vendor_finish_v1', {p_id: body.request_id, p_state: 'sent', p_gmail: gmail, p_sheet: sheet, p_error: null});
    return reply({ok: true, state: 'sent', sheet, by: actor.name, to: mail.to});
  };
}
