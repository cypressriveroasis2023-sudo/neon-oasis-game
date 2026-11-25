// Vendor emails from the COS unit card. One fixed template per request, the same every time.
// Only the blanks change. James asked for this on 2026-11-25: SIM cancellations to Vendera and
// Simetry, and account add / remove / unit swap to Eyeforce (Stages and Watchful).
// Pure code: the unit tests and the edge function both use it.

export const SENDER = 'jmartin@camerasonsite.com';
export const TEAM_CC = 'IT@camerasonsite.com';
export const DEACTIVATION_SHEET = '1ygv0GfUm-0_irHrZiIbF04e6bDEHz61UWhjh8JXrpwI';
export const DEACTIVATION_TAB = 'Deactivation History';

// One signature, typed once (James: the signature must appear only once).
const SIGNATURE = ['James Martin', 'Operations Manager', 'Cameras Onsite LLC', '9949 West Sam Houston Pkwy N', 'Houston, Texas 77064',
  'Cell: (346) 314-9208', 'Office: (281) 517-7600'].join('\n');

export type Kind = 'sim_cancel_vendera' | 'sim_cancel_simetry' | 'monitor_add' | 'monitor_remove' | 'monitor_swap';
export type Field = {key: string; label: string; required: boolean; hint?: string; long?: boolean};
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

export const TEMPLATES: Record<Kind, {title: string; button: string; to: string; fields: Field[]; sheet: 'sim' | 'monitoring' | null}> = {
  sim_cancel_vendera: {title: 'Cancel SIM with Vendera', button: 'Cancel SIM: Vendera', to: 'support@vendera.freshdesk.com',
    fields: [...unitFields, SIM, JOB, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'sim'},
  sim_cancel_simetry: {title: 'Cancel SIM with Simetry', button: 'Cancel SIM: Simetry', to: 'support@simetry.com',
    fields: [...unitFields, SIM, JOB, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'sim'},
  monitor_add: {title: 'Add a monitoring account (Stages and Watchful)', button: 'Add account', to: 'techops@eyeforce.com',
    fields: [...unitFields, JOB, DATE, {key: 'hours', label: 'Monitoring hours', required: true, hint: 'For example 24/7, or Mon-Fri 6 PM to 6 AM and weekends'},
      {key: 'contacts', label: 'Call list (name and phone, in order)', required: true, long: true}], sheet: null},
  monitor_remove: {title: 'Remove a monitoring account (Stages and Watchful)', button: 'Remove account', to: 'techops@eyeforce.com',
    fields: [...unitFields, EYE, JOB, DATE, {key: 'reason', label: 'Reason', required: true, long: true}], sheet: 'monitoring'},
  monitor_swap: {title: 'Unit swap at an account (Stages and Watchful)', button: 'Swap unit at account', to: 'techops@eyeforce.com',
    fields: [{key: 'unit', label: 'Unit taken out', required: true}, {key: 'new_unit', label: 'Unit put in', required: true},
      {key: 'customer', label: 'Customer', required: false}, {key: 'site', label: 'Site', required: true}, {key: 'address', label: 'Address', required: false},
      EYE, DATE], sheet: null},
};

export const DEFAULTS: Partial<Record<Kind, Values>> = {
  sim_cancel_vendera: {reason: 'The unit was removed from the field. Service on this SIM is no longer needed.'},
  sim_cancel_simetry: {reason: 'The unit was removed from the field. Service on this SIM is no longer needed.'},
  monitor_remove: {reason: 'The unit was removed from the site. Monitoring is no longer needed.'},
};

const clean = (v: unknown, max = 300) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const oneLine = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Cleans the values for one kind. Returns the problems a person must fix, in plain words. */
export function check(kind: Kind, input: Values): {values: Values; missing: string[]} {
  const t = TEMPLATES[kind];
  const values: Values = {};
  const missing: string[] = [];
  for (const f of t.fields) {
    const v = clean(input?.[f.key], f.long ? 1000 : 200);
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
  return {values, missing};
}

const line = (label: string, v?: string) => v ? label + ': ' + v + '\n' : '';
const where = (v: Values) => [v.site, v.address].filter(Boolean).join(', ');

/** The email exactly as it will be sent. */
export function render(kind: Kind, v: Values): {to: string; cc: string; subject: string; body: string} {
  const t = TEMPLATES[kind];
  let subject = '', body = '';
  if (kind === 'sim_cancel_vendera' || kind === 'sim_cancel_simetry') {
    const vendor = kind === 'sim_cancel_vendera' ? 'Vendera' : 'Simetry';
    subject = 'SIM cancellation request - ' + v.unit + ' - SIM ' + v.sim;
    body = 'Hello ' + vendor + ' Support,\n\nPlease cancel service on the SIM card below.\n\n'
      + line('SIM (ICCID)', v.sim) + line('Unit', v.unit) + line('Customer', v.customer) + line('Last site', where(v)) + line('Our job number', v.job)
      + line('Reason', v.reason)
      + '\nPlease reply with your confirmation or ticket number once it is cancelled.\n\nThank you,\n\n' + SIGNATURE;
  } else if (kind === 'monitor_add') {
    subject = v.site + ' | New account | ' + v.unit;
    body = 'Eyeforce Team,\n\nPlease set up monitoring for a new site in Stages and Watchful.\n\n'
      + line('Customer', v.customer) + line('Site', v.site) + line('Address', v.address) + line('Unit', v.unit) + line('Our job number', v.job)
      + line('Start date', v.date) + line('Monitoring hours', v.hours) + '\nCall list, in this order:\n' + v.contacts + '\n'
      + '\nPlease reply with the new EYE account number when it is set up.\n\nThank you,\n\n' + SIGNATURE;
  } else if (kind === 'monitor_remove') {
    subject = v.eye + ' | ' + v.site + ' | Remove account';
    body = 'Eyeforce Team,\n\nPlease remove monitoring for the account below in Stages and Watchful, effective ' + v.date + '.\n\n'
      + line('Account', v.eye) + line('Customer', v.customer) + line('Site', v.site) + line('Address', v.address) + line('Unit', v.unit) + line('Our job number', v.job)
      + line('Reason', v.reason)
      + '\nPlease reply to confirm when the account is removed.\n\nThank you,\n\n' + SIGNATURE;
  } else {
    subject = v.eye + ' | ' + v.site + ' | Unit swap: ' + v.unit + ' to ' + v.new_unit;
    body = 'Eyeforce Team,\n\nOn ' + v.date + ' we replaced a unit at the account below. Please update the account in Stages and Watchful so the new unit\'s cameras are monitored and the old unit is removed.\n\n'
      + line('Account', v.eye) + line('Customer', v.customer) + line('Site', where(v)) + line('Unit taken out', v.unit) + line('Unit put in', v.new_unit)
      + '\nPlease reply to confirm when it is updated.\n\nThank you,\n\n' + SIGNATURE;
  }
  return {to: t.to, cc: TEAM_CC, subject: oneLine(subject).slice(0, 200), body};
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

/** The raw RFC 2822 message, base64url, for Gmail's send call. Plain text, UTF-8. */
export function rawEmail(mail: {to: string; cc: string; subject: string; body: string}, requestId: string): string {
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  const headers = 'From: James Martin <' + SENDER + '>\r\nTo: ' + mail.to + '\r\nCc: ' + mail.cc + '\r\nSubject: =?UTF-8?B?' + b64(mail.subject) + '?=\r\n'
    + 'Message-ID: <cos-vendor-' + requestId + '@camerasonsite.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n';
  const content = headers + b64(mail.body.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return b64(content).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
