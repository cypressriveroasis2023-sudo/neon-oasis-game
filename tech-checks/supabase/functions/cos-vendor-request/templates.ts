// Vendor emails from the COS unit card. One fixed template per request, the same every time.
// Only the blanks change. James asked for this on 2026-11-25: SIM cancellations to Vendera and
// Simetry, and account add / remove / unit swap to Eyeforce (Stages and Watchful).
// Pure code: the unit tests and the edge function both use it.
// 25 Nov (later): account add and unit swap are Eyeforce's full CIF form (cif.ts); approved IT may send those two.
import {ADD_FIELDS, SWAP_FIELDS, ADD_DEFAULTS, SWAP_DEFAULTS, cifProblems, cifSummary} from './cif.ts';

export const SENDER = 'jmartin@camerasonsite.com';
export const TEAM_CC = 'IT@camerasonsite.com';
export const DEACTIVATION_SHEET = '1ygv0GfUm-0_irHrZiIbF04e6bDEHz61UWhjh8JXrpwI';
export const DEACTIVATION_TAB = 'Deactivation History';

// One signature, typed once (James: the signature must appear only once).
const SIGNATURE = ['James Martin', 'Operations Manager', 'Cameras Onsite LLC', '9949 West Sam Houston Pkwy N', 'Houston, Texas 77064',
  'Cell: (346) 314-9208', 'Office: (281) 517-7600'].join('\n');

export type Kind = 'sim_cancel_vendera' | 'sim_cancel_simetry' | 'monitor_add' | 'monitor_remove' | 'monitor_swap';
export type Field = {key: string; label: string; required: boolean; hint?: string; long?: boolean; options?: string[];
  labels?: Record<string, string>; section?: string; secret?: boolean; row?: number; group?: string; col?: string};
export type Values = Record<string, string>;

const unitFields: Field[] = [
  {key: 'unit', label: 'Unit', required: true},
  {key: 'customer', label: 'Customer', required: false},
  {key: 'site', label: 'Site', required: true},
  {key: 'address', label: 'Address', required: false},
];
const SIM: Field = {key: 'sim', label: 'SIM number (ICCID)', required: true, hint: 'The long number on the SIM card, 19 or 20 digits'};
const JOB: Field = {key: 'job', label: 'mHelp job number', required: false};
const EYE: Field = {key: 'eye', label: 'Eyeforce account number', required: true, hint: 'Starts with EYE, for example EYE17351'};
const DATE: Field = {key: 'date', label: 'Effective date', required: true, hint: 'For example 11/25/2026'};

export type Sender = {name: string; james: boolean; it?: boolean};
// who: 'owner' = the Owner only; 'fleet' = the Owner or approved IT (James: techs fill the Eyeforce forms and send them).
export const TEMPLATES: Record<Kind, {title: string; button: string; to: string; fields: Field[]; sheet: 'sim' | 'monitoring' | null; who: 'owner' | 'fleet'; form?: boolean}> = {
  sim_cancel_vendera: {title: 'Cancel SIM with Vendera', button: 'Cancel SIM: Vendera', to: 'support@vendera.freshdesk.com',
    fields: [...unitFields, SIM, JOB, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'sim', who: 'owner'},
  sim_cancel_simetry: {title: 'Cancel SIM with Simetry', button: 'Cancel SIM: Simetry', to: 'support@simetry.com',
    fields: [...unitFields, SIM, JOB, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'sim', who: 'owner'},
  monitor_add: {title: 'Add a monitoring account (Eyeforce form)', button: 'Add account', to: 'techops@eyeforce.com',
    fields: ADD_FIELDS, sheet: null, who: 'fleet', form: true},
  monitor_remove: {title: 'Remove a monitoring account (Stages and Watchful)', button: 'Remove account', to: 'techops@eyeforce.com',
    fields: [...unitFields, EYE, JOB, DATE, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'monitoring', who: 'owner'},
  monitor_swap: {title: 'Unit swap at an account (Eyeforce form)', button: 'Swap unit at account', to: 'techops@eyeforce.com',
    fields: SWAP_FIELDS, sheet: null, who: 'fleet', form: true},
};

export const DEFAULTS: Partial<Record<Kind, Values>> = {
  sim_cancel_vendera: {reason: 'The unit was removed from the field. Service on this SIM is no longer needed.'},
  sim_cancel_simetry: {reason: 'The unit was removed from the field. Service on this SIM is no longer needed.'},
  monitor_remove: {reason: 'The unit was removed from the site. Monitoring is no longer needed.'},
  monitor_add: ADD_DEFAULTS,
  monitor_swap: SWAP_DEFAULTS,
};

const clean = (v: unknown, max = 300) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Cleans the values for one kind. Returns the problems a person must fix, in plain words. */
export function check(kind: Kind, input: Values): {values: Values; missing: string[]} {
  const t = TEMPLATES[kind];
  const values: Values = {};
  const missing: string[] = [];
  for (const f of t.fields) {
    const v = clean(input?.[f.key], f.long ? 2000 : 200);
    values[f.key] = f.long ? v : oneLine(v);
    if (f.required && !values[f.key]) missing.push(f.label);
  }
  if (values.sim) {
    values.sim = values.sim.replace(/[\s-]/g, '').toUpperCase();
    if (!/^\d{18,22}F?$/.test(values.sim)) missing.push('SIM number (ICCID): 18 to 22 digits');
  }
  if (values.eye) {
    values.eye = values.eye.replace(/\s/g, '').toUpperCase();
    if (!/^EYE\d{3,8}$/.test(values.eye)) missing.push('Eyeforce account number: EYE then the digits');
  }
  if (t.form) missing.push(...cifProblems(kind as 'monitor_add' | 'monitor_swap', values));
  return {values, missing};
}

const line = (label: string, v?: string) => v ? label + ': ' + v + '\n' : '';
const where = (v: Values) => [v.site, v.address].filter(Boolean).join(', ');

/** The email exactly as it will be sent. */
export function render(kind: Kind, v: Values, sender: Sender = {name: 'James Martin', james: true}): {to: string; cc: string; subject: string; body: string; from: string} {
  const t = TEMPLATES[kind];
  let subject = '', body = '';
  // Sent from James's Gmail either way; a tech signs with their own name, once.
  const sign = sender.james ? SIGNATURE : [sender.name, sender.it ? 'IT, Cameras Onsite LLC' : 'Cameras Onsite LLC', 'Sent through COS from James Martin\'s mailbox', 'Office: (281) 517-7600'].join('\n');
  if (kind === 'sim_cancel_vendera' || kind === 'sim_cancel_simetry') {
    const vendor = kind === 'sim_cancel_vendera' ? 'Vendera' : 'Simetry';
    subject = 'SIM cancellation request - ' + v.unit + ' - SIM ' + v.sim;
    body = 'Hello ' + vendor + ' Support,\n\nPlease cancel service on the SIM card below.\n\n'
      + line('SIM (ICCID)', v.sim) + line('Unit', v.unit) + line('Customer', v.customer) + line('Last site', where(v)) + line('Our job number', v.job)
      + line('Reason', v.reason)
      + '\nPlease reply with your confirmation or ticket number once it is cancelled.\n\nThank you,\n\n' + sign;
  } else if (kind === 'monitor_add') {
    subject = v.site + ' | New account | ' + v.unit;
    body = 'Eyeforce Team,\n\nPlease set up monitoring for a new site in Stages and Watchful, starting ' + v.date + '. Your Customer Video Guarding Information Form is attached, filled in. The same answers are below.\n\n'
      + cifSummary('monitor_add', v)
      + '\nPlease reply with the new EYE account number when it is set up.\n\nThank you,\n\n' + sign;
  } else if (kind === 'monitor_remove') {
    subject = v.eye + ' | ' + v.site + ' | Remove account';
    body = 'Eyeforce Team,\n\nPlease remove monitoring for the account below in Stages and Watchful, effective ' + v.date + '.\n\n'
      + line('Account', v.eye) + line('Customer', v.customer) + line('Site', v.site) + line('Address', v.address) + line('Unit', v.unit) + line('Our job number', v.job)
      + line('Reason', v.reason)
      + '\nPlease reply to confirm when the account is removed.\n\nThank you,\n\n' + sign;
  } else {
    subject = v.eye + ' | ' + v.site + ' | Unit swap: ' + v.unit + ' to ' + v.new_unit;
    body = 'Eyeforce Team,\n\nOn ' + v.date + ' we replaced a unit at the account below. Please update the account in Stages and Watchful so the new unit\'s cameras are monitored and the old unit is removed. Your form is attached with the new unit\'s cameras on tab 3.\n\n'
      + cifSummary('monitor_swap', v)
      + '\nPlease reply to confirm when it is updated.\n\nThank you,\n\n' + sign;
  }
  return {to: t.to, cc: TEAM_CC, subject: oneLine(subject).slice(0, 200), body, from: sender.james ? 'James Martin' : oneLine(sender.name).replace(/[^A-Za-z .'-]/g, '').slice(0, 60) + ' via COS'};
}

/** The row for the deactivation sheet, in its own column order, or null when the kind is not logged there. */
export function sheetRow(kind: Kind, v: Values, day: string): string[] | null {
  const t = TEMPLATES[kind];
  if (!t.sheet) return null;
  // Date | SITE NAME | UNIT TYPE/NUMBER | Location | JOB NUMBER | Vendera Job Number | SIM CARD DEACTIVATION | MONITORING DEACTIVATION | MODEM SWAP
  return [day, v.customer || v.site, v.unit, where(v), v.job || '', '',
    t.sheet === 'sim' ? 'EMAILED ' + (kind === 'sim_cancel_vendera' ? 'VENDERA' : 'SIMETRY') + ' ' + day : '',
    t.sheet === 'monitoring' ? 'EMAILED EYEFORCE ' + day : '', ''];
}

/** The raw RFC 2822 message, base64url, for Gmail's send call. Plain text, UTF-8, with an optional attachment. */
export function rawEmail(mail: {to: string; cc: string; subject: string; body: string; from?: string}, requestId: string,
  attachment?: {name: string; type: string; bytes: Uint8Array}): string {
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  const fold = (s: string) => s.replace(/.{1,76}/g, '$&\r\n');
  const bin = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const from = (mail.from || 'James Martin').replace(/["\r\n]/g, '');
  const top = 'From: "' + from + '" <' + SENDER + '>\r\nTo: ' + mail.to + '\r\nCc: ' + mail.cc + '\r\nSubject: =?UTF-8?B?' + b64(mail.subject) + '?=\r\n'
    + 'Message-ID: <cos-vendor-' + requestId + '@camerasonsite.com>\r\nMIME-Version: 1.0\r\n';
  const text = 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + fold(b64(mail.body.replace(/\r?\n/g, '\r\n')));
  let content: string;
  if (!attachment) content = top + text;
  else {
    const boundary = 'cos-' + requestId, name = attachment.name.replace(/["\r\n\\]/g, '');
    content = top + 'Content-Type: multipart/mixed; boundary="' + boundary + '"\r\n\r\n--' + boundary + '\r\n' + text
      + '--' + boundary + '\r\nContent-Type: ' + attachment.type + '; name="' + name + '"\r\nContent-Disposition: attachment; filename="' + name + '"\r\n'
      + 'Content-Transfer-Encoding: base64\r\n\r\n' + fold(bin(attachment.bytes)) + '--' + boundary + '--\r\n';
  }
  return b64(content).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
