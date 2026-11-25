// Eyeforce's Customer Video Guarding Information Form (CIF V5), as a COS form.
// James, 25 Nov: techs fill everything Eyeforce needs on the unit card, and COS emails techops@eyeforce.com
// with Eyeforce's own form filled in and attached. The choices are the same drop-down lists as their sheet.
// Pure code: the unit tests and the edge function both use it.
import {Workbook, type CheckBox} from './xlsx.ts';

export type Field = {key: string; label: string; required: boolean; hint?: string; long?: boolean; options?: string[];
  labels?: Record<string, string>; section?: string; secret?: boolean; row?: number; group?: string; col?: string};
export type Values = Record<string, string>;

const L = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
export const OPT = {
  mgr: ['Felipe Presas', 'Kathee Mattern', 'Collier Williams', 'Seth Barcus', 'Other'],
  integration: ['Becklar RVM', 'Alarm.Com Integration', 'CHeKT Integration', 'DMP Video', 'AJAX Video', 'Other'],
  mobile: ['MOBILE UNIT', 'NON MOBILE'],
  service: ['Remote Video Verification', 'Virtual Guardian', 'Virtual Guardian Escort', 'Virtual Doorman / Concierge', 'E-Care Health Check', 'Health Check GT'],
  total: L('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 25, 30, Other'),
  monitored: L('ALL, HALF, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, Other'),
  foliage: ['YES', 'NOT AT THIS TIME', 'WILL BE TRIMMED', 'Other'],
  mfg: L('Alibi, Hikvision, AXIS, Avigilon, UniView, Speco, OpenEye, Hanwha Wave, DW Spectrum, Dahua, Eagle Eye, Bosch, Honeywell, Exacq, Combo of Several, Not Listed, Other'),
  customer: ['Banking / Financial', 'Warehouse / Industrial', 'Multi-Family / Apartments', 'Convenience Store', 'Commercial CRE', 'Car Dealership', 'Industrial Warehousing', 'OTHER'],
  facility: ['Generic Free Standing Bldg', 'Secure Enclosed Fenced Area', 'Partially Secured Area', 'Retail / Strip-center Building', 'OTHER'],
  purpose: ['Deter Theft & Vandalism during Closed Hrs', 'Trespassing', 'Unauthorized Entry', 'Security Awareness & Talk-down Deterence', 'Operational Safety/Complience detection & reporting', 'Doorman - Gate accessibility service'],
  detect: ['Human', 'Vehicle', 'Human & Vehicle', 'Animal', 'Object', 'Loitering', 'Other Not listed'],
  yesNoNa: ['YES', 'NO', 'N/A'],
  yesNo: ['YES', 'NO'],
  speakers: L('1, 2, 3, 4, 5, 6, ALL AS ONE, N/A, OTHER'),
  ecareCams: L('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, HALF, ALL, OTHER'),
  time: ['Not monitored', 'Same as above', '12 MID', '12:01am', '12:30am', '1am', '2am', '3am', '4am', '5am', '6am', '6:30am', '7am', '7:30am', '8am', '8:30am', '9am', '9:30am', '10am', '10:30am',
    '11am', '11:30am', '12Noon', '12:30pm', '1pm', '2pm', '3pm', '4pm', '4:30pm', '5pm', '5:30pm', '6pm', '6:30pm', '7pm', '7:30pm', '8pm', '8:30pm', '9pm', '9:30pm', '10pm', '10:30pm', '11pm', '11:30pm'],
  dayCams: L('ALL CAMS, NOTED BELOW, HALF, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, OTHER'),
  hcType: ['E-CARE (Connection PING per cam)', 'Scheduled Guard Tour Look-In', 'Ai-rgus Service', 'Other'],
  hcSched: ['DAILY (1/day)', '2x/day', 'Set by Becklar Monitoring Standards', 'Other'],
  hcLoss: ['Auto Email Dealer Only', 'Call to customer', 'Call to Dealer Business Hrs Only', 'Call Customer/Dealer Business hrs only'],
  gtType: ['Loitering', 'Escort / Employee Safety', 'Dumpster Area Check', 'Safety check', 'Security Awareness', 'Operational Audit', 'Homeless / Pan Handlers', 'Unwarrented Activity', 'Shoplifting', 'Other'],
  gtFreq: ['1 GT / HR', '2 GT / HR', 'Other'],
  talk: ['YES- Use Becklar VRG Scripting', 'NO- Talk-down will NOT be made', 'Other'],
  tone: ['Aggressive Strong', 'Normal Advisory', 'Friendly', 'Other'],
  report: ['Daily', 'WEEKLY', 'MONTHLY', 'QUARTERLY'],
  plan: L('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, N/A'),
  planTone: ['None', 'Aggressive Strong', 'Normal Advise', 'Friendly'],
  brand: L('ALIBI, COMBO OF SEVERAL, AXIS, AVIGILON, BOSCH, CHECK VIDEO, CLINTON, DAHUA, DIGITAL WATCHDOG, EXACQ, EAGLE EYE, GANZ, GENETEC, GEOVISION, HANWHA, HONEYWELL, HIKVISION, IC REALTIME, I3 INTL, LTS, MILESTONE, OPEN EYE, PANASONIC, PELCO, OTHER'),
  deviceType: ['IP Camera', 'PTZ Camera', 'NVR', 'Speaker', 'Other'],
  audio: ['YES', 'NO'],
};

// The Dispatch Action Plan legend, word for word from the form (shown under the choices).
export const PLAN_LEGEND: Record<string, string> = {
  '1': 'Dispatch immediately then notify contact list', '2': 'Talk-down / strobe; no compliance: dispatch (follow 1)',
  '3': 'Talk-down / strobe only; if compliance close, notate or call contact list (ECV)', '4': 'Notify the contact list only (do not dispatch unless asked)',
  '5': 'Notify the contact list; if no password, dispatch the proper authorities', '6': 'Log only: notate activity, call no one',
  '7': 'Log only: notate, notify dealer in business hours by email or call', '8': 'Dealer / customer supplied protocols (Becklar approval)',
  '9': 'Health check: email dealer once the threshold is met', '10': 'Health check: dealer directive (write it in the notes)', 'N/A': 'Not used',
};

export const DAYS = [['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday']] as const;
export const HOLIDAYS = [['jul4', 'July 4th'], ['goodfri', 'Good Friday'], ['thanks', 'Thanksgiving'], ['xmas', 'Christmas Eve/Day'], ['newyear', "New Year's Eve/Day"]] as const;
// Dispatch plan rows: key, event, form row, Becklar's example (the default).
export const EVENTS = [['crime', 'Crime in progress', 20, '1'], ['activity', 'Human or vehicle activity (suspicious and non-suspicious)', 21, '2'],
  ['employee', 'Employee / cleaning crew onsite', 22, '4'], ['surround', 'Suspicious surroundings (objects not seen before)', 23, '3'],
  ['trespass', 'Trespassing (during closed hours)', 24, '2'], ['animal', 'Animal(s) seen', 25, '6'], ['view', 'Unusual camera view / issue', 26, '7'],
  ['hc1', 'System health check', 27, '9'], ['hc2', 'System health check (second)', 28, ''], ['other1', 'Other', 29, ''], ['other2', 'Other', 30, '']] as const;
export const MAX_CAMS = 16;
const CAM_COLS = [['name', 'Camera name', 'A'], ['type', 'Device type', 'C'], ['ip', 'Public IP', 'D'], ['port', 'Port(s)', 'E'], ['login', 'Login name', 'F'],
  ['password', 'Password', 'G'], ['serial', 'MAC / serial', 'H'], ['audio', 'Audio?', 'I']] as const;

const f = (key: string, label: string, required: boolean, more: Partial<Field> = {}): Field => ({key, label, required, ...more});

function cameraFields(section: string): Field[] {
  const out: Field[] = [f('cam_brand', 'Camera brand', true, {section, options: OPT.brand})];
  for (let i = 1; i <= MAX_CAMS; i++) for (const [k, label, col] of CAM_COLS)
    out.push(f('cam' + i + '_' + k, label, false, {section, group: 'cam', row: i, col: k, secret: k === 'password',
      options: k === 'type' ? OPT.deviceType : k === 'audio' ? OPT.audio : undefined}));
  return out;
}

const S = {site: 'Site and account', svc: 'Services', cams: 'Cameras', type: 'Type of site', why: 'Purpose', issues: "Customer's issues",
  mon: 'Monitoring add-ons', alarm: 'Burglar alarm', sched: 'Monitoring schedule', hc: 'Video health check (if used)', gt: 'Guard tour (if used)',
  rep: 'Reporting', plan: 'Dispatch action plan', list: 'Cameras on the unit (form tab 3)'};

export const ADD_FIELDS: Field[] = [
  f('unit', 'Unit', true, {section: S.site}), f('site', 'Location name', true, {section: S.site}), f('address', 'Address', true, {section: S.site, hint: 'Street, city, state, ZIP'}),
  f('customer', 'Customer', false, {section: S.site}), f('job', 'mHelp job number', false, {section: S.site}),
  f('date', 'Start date', true, {section: S.site, hint: 'For example 11/25/2026'}),
  f('mgr', 'Eyeforce account manager', true, {section: S.site, options: OPT.mgr}), f('integration', 'Integration type', true, {section: S.site, options: OPT.integration}),
  f('mobile', 'Mobile or not', true, {section: S.site, options: OPT.mobile}),
  f('contacts', 'Call list (name, role and phone, in order)', true, {section: S.site, long: true, hint: 'One person per line, first to call at the top'}),
  f('service1', 'Service', true, {section: S.svc, options: OPT.service}), f('service2', 'Second service', false, {section: S.svc, options: OPT.service}),
  f('service3', 'Third service', false, {section: S.svc, options: OPT.service}),
  f('cams_total', 'How many cameras in total', true, {section: S.cams, options: OPT.total}), f('cams_monitored', 'How many to monitor', true, {section: S.cams, options: OPT.monitored}),
  f('cams_other', 'Number if not listed', false, {section: S.cams}),
  f('foliage', 'Trees, bushes or animals that could cause false alarms?', true, {section: S.cams, options: OPT.foliage}),
  f('mfg', 'Camera make', true, {section: S.cams, options: OPT.mfg}), f('mfg_other', 'Make if not listed', false, {section: S.cams}),
  f('customer_type', 'Customer type', true, {section: S.type, options: OPT.customer}), f('facility_type', 'Facility type', true, {section: S.type, options: OPT.facility}),
  f('type_other', 'If OTHER, what it is', false, {section: S.type}),
  f('purpose1', 'Purpose', true, {section: S.why, options: OPT.purpose}), f('purpose2', 'Second purpose', false, {section: S.why, options: OPT.purpose}),
  f('purpose3', 'Third purpose', false, {section: S.why, options: OPT.purpose}),
  f('detect1', 'What are we detecting', true, {section: S.why, options: OPT.detect}), f('detect2', 'And / or', false, {section: S.why, options: OPT.detect}),
  f('issues', 'Break-ins, problems and what the operators should look for', true, {section: S.issues, long: true,
    hint: 'For example: copper theft at night, people climbing the fence on the east side, vehicles parking by the trailers'}),
  f('audio', 'Audio talk-down', true, {section: S.mon, options: OPT.yesNoNa}), f('speakers', 'How many speakers', false, {section: S.mon, options: OPT.speakers}),
  f('ecare', 'E-Care / health check (per camera)', true, {section: S.mon, options: OPT.yesNoNa}), f('ecare_cams', 'How many cameras', false, {section: S.mon, options: OPT.ecareCams}),
  f('guardian', 'Video Guardian', true, {section: S.mon, options: OPT.yesNoNa}), f('guard_tour', 'Video guard tour (per every 6 cameras)', true, {section: S.mon, options: OPT.yesNoNa}),
  f('mon_notes', 'Any notes', false, {section: S.mon, long: true}),
  f('alarm_monitored', 'Does the site have a monitored burglar alarm?', true, {section: S.alarm, options: OPT.yesNo}),
  f('alarm_signals', 'Will Eyeforce get alarm signals from the same site?', true, {section: S.alarm, options: OPT.yesNo}),
  ...DAYS.flatMap(([k, d]) => [f('s_' + k + '_start', d + ' start', true, {section: S.sched, options: OPT.time, group: 'day', row: 0}),
    f('s_' + k + '_end', d + ' end', true, {section: S.sched, options: OPT.time, group: 'day', row: 0}),
    f('s_' + k + '_cams', d + ' cameras', false, {section: S.sched, options: OPT.dayCams, group: 'day', row: 0})]),
  ...HOLIDAYS.flatMap(([k, d]) => [f('h_' + k + '_start', d + ' start', false, {section: S.sched, options: OPT.time, group: 'day', row: 0}),
    f('h_' + k + '_end', d + ' end', false, {section: S.sched, options: OPT.time, group: 'day', row: 0}),
    f('h_' + k + '_cams', d + ' cameras', false, {section: S.sched, options: OPT.dayCams, group: 'day', row: 0})]),
  f('sched_notes', 'Notes on the schedule', false, {section: S.sched, long: true}),
  f('hc_type', 'Health check type', false, {section: S.hc, options: OPT.hcType}), f('hc_sched', 'How often', false, {section: S.hc, options: OPT.hcSched}),
  f('hc_loss', 'When a camera loses connection', false, {section: S.hc, options: OPT.hcLoss}),
  f('gt_type1', 'Guard tour type', false, {section: S.gt, options: OPT.gtType}), f('gt_type2', 'And / or', false, {section: S.gt, options: OPT.gtType}),
  f('gt_objective', 'Guard tour objective', false, {section: S.gt, long: true}), f('gt_mc', 'Monitoring center sets the times?', false, {section: S.gt, options: OPT.yesNo}),
  ...DAYS.flatMap(([k, d]) => [f('g_' + k + '_start', d + ' start', false, {section: S.gt, options: OPT.time, group: 'day', row: 0}),
    f('g_' + k + '_end', d + ' end', false, {section: S.gt, options: OPT.time, group: 'day', row: 0}),
    f('g_' + k + '_cams', d + ' cameras', false, {section: S.gt, options: OPT.dayCams, group: 'day', row: 0})]),
  f('gt_freq', 'Frequency', false, {section: S.gt, options: OPT.gtFreq}), f('gt_talk', 'Talk-down', false, {section: S.gt, options: OPT.talk}),
  f('gt_tone', 'Script tone', false, {section: S.gt, options: OPT.tone}),
  f('rep_existing', 'Gets a Becklar report for several locations already?', false, {section: S.rep, options: OPT.yesNo}),
  f('rep_high', 'High priority alarms report', false, {section: S.rep, options: OPT.report}), f('rep_all', 'All alarms report', false, {section: S.rep, options: OPT.report}),
  ...EVENTS.flatMap(([k, label]) => [
    ...(k.startsWith('other') ? [f('d_' + k + '_name', 'Other event', false, {section: S.plan})] : []),
    f('d_' + k, label, !k.startsWith('other') && k !== 'hc2', {section: S.plan, options: OPT.plan, labels: Object.fromEntries(OPT.plan.map(o => [o, o + ' · ' + PLAN_LEGEND[o]]))}),
    f('d_' + k + '_tone', 'Script tone', false, {section: S.plan, options: OPT.planTone})]),
  f('d_hc_customer', 'Health check: call the customer first, then notify the dealer', false, {section: S.plan, options: OPT.yesNo}),
  f('d_hc_dealer', 'Health check: call the dealer in business hours', false, {section: S.plan, options: OPT.yesNo}),
  f('d_notes', 'Dispatch notes', false, {section: S.plan, long: true}),
  ...cameraFields(S.list),
];

export const SWAP_FIELDS: Field[] = [
  f('eye', 'Eyeforce account number', true, {section: S.site, hint: 'Starts with EYE, for example EYE17351'}),
  f('unit', 'Unit taken out', true, {section: S.site}), f('new_unit', 'Unit put in', true, {section: S.site}),
  f('site', 'Location name', true, {section: S.site}), f('address', 'Address', false, {section: S.site}), f('customer', 'Customer', false, {section: S.site}),
  f('job', 'mHelp job number', false, {section: S.site}), f('date', 'Date of the swap', true, {section: S.site, hint: 'For example 11/25/2026'}),
  f('mgr', 'Eyeforce account manager', false, {section: S.site, options: OPT.mgr}),
  f('audio', 'Audio talk-down on the new unit', false, {section: S.site, options: OPT.yesNoNa}),
  f('notes', 'Anything that changed (cameras, views, schedule)', false, {section: S.site, long: true}),
  ...cameraFields('Cameras on the unit put in (form tab 3)'),
];

export const ADD_DEFAULTS: Values = {
  mgr: 'Felipe Presas', integration: 'Becklar RVM', mobile: 'MOBILE UNIT', service1: 'Remote Video Verification', cams_monitored: 'ALL', foliage: 'NOT AT THIS TIME',
  mfg: 'Alibi', purpose1: 'Deter Theft & Vandalism during Closed Hrs', detect1: 'Human & Vehicle', audio: 'YES', speakers: 'ALL AS ONE', ecare: 'NO', guardian: 'NO', guard_tour: 'NO',
  alarm_monitored: 'NO', alarm_signals: 'NO', cam_brand: 'ALIBI', d_hc_customer: 'NO', d_hc_dealer: 'YES',
  ...Object.fromEntries(EVENTS.filter(e => e[3]).map(([k, , , d]) => ['d_' + k, d])),
  ...Object.fromEntries(EVENTS.map(([k]) => ['d_' + k + '_tone', k === 'crime' ? 'Aggressive Strong' : 'None'])),
};
export const SWAP_DEFAULTS: Values = {mgr: 'Felipe Presas', audio: 'YES', cam_brand: 'ALIBI'};

/** Which camera rows have anything in them. */
export const camRows = (v: Values) => Array.from({length: MAX_CAMS}, (_, i) => i + 1)
  .filter(i => CAM_COLS.some(([k]) => (v['cam' + i + '_' + k] || '').trim()));

/** Problems a person has to fix, beyond the plain required blanks. */
export function cifProblems(kind: 'monitor_add' | 'monitor_swap', v: Values): string[] {
  const out: string[] = [];
  const rows = camRows(v);
  if (!rows.length) out.push('At least one camera on the unit');
  for (const i of rows) if (!v['cam' + i + '_name']) out.push('Camera ' + i + ': its name');
  for (const [k, field] of Object.entries(v)) {
    const def = (kind === 'monitor_add' ? ADD_FIELDS : SWAP_FIELDS).find(x => x.key === k);
    if (def?.options && field && !def.options.includes(field)) out.push(def.label + ': pick one from the list');
  }
  if (kind === 'monitor_add') {
    if (v.s_sun_start === 'Same as above' || v.s_sun_end === 'Same as above') out.push('Sunday: "Same as above" needs a day above it, so pick the hours');
    if (v.audio === 'YES' && !v.speakers) out.push('How many speakers');
    if ([v.customer_type, v.facility_type].includes('OTHER') && !v.type_other) out.push('If OTHER, what it is');
    if (v.cams_total === 'Other' && !v.cams_other) out.push('Number if not listed');
  }
  return out;
}

export function hidePasswords(v: Values): Values {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^cam\d+_password$/.test(k) && x ? '(given)' : x]));
}

const line = (label: string, x?: string) => x ? label + ': ' + x + '\n' : '';
function dayLines(v: Values, prefix: 's' | 'g', days: readonly (readonly [string, string])[]): string {
  return days.map(([k, d]) => {
    const a = v[prefix + '_' + k + '_start'], b = v[prefix + '_' + k + '_end'], c = v[prefix + '_' + k + '_cams'];
    if (!a && !b) return '';
    if (a === 'Not monitored') return '  ' + d + ': not monitored\n';
    return '  ' + d + ': ' + (a === 'Same as above' && b === 'Same as above' ? 'same as above' : (a || '?') + ' to ' + (b || '?')) + (c ? ' (' + c + ')' : '') + '\n';
  }).join('');
}

/** The written summary that goes in the email. Passwords never go in the email text, only in the attached form. */
export function cifSummary(kind: 'monitor_add' | 'monitor_swap', v: Values): string {
  const cams = camRows(v).map(i => '  ' + [v['cam' + i + '_name'], v['cam' + i + '_type'], v['cam' + i + '_ip'] && 'IP ' + v['cam' + i + '_ip'],
    v['cam' + i + '_port'] && 'port ' + v['cam' + i + '_port'], v['cam' + i + '_serial'] && 'serial ' + v['cam' + i + '_serial'],
    v['cam' + i + '_audio'] && 'audio ' + v['cam' + i + '_audio']].filter(Boolean).join(', ') + '\n').join('');
  const logins = camRows(v).some(i => v['cam' + i + '_login'] || v['cam' + i + '_password']) ? 'Camera logins and passwords are in the attached form, tab 3.\n' : '';
  if (kind === 'monitor_swap') {
    return line('Account', v.eye) + line('Customer', v.customer) + line('Location', v.site) + line('Address', v.address) + line('Unit taken out', v.unit)
      + line('Unit put in', v.new_unit) + line('Date of the swap', v.date) + line('Our job number', v.job) + line('Audio talk-down', v.audio)
      + (v.notes ? '\nWhat changed:\n' + v.notes + '\n' : '') + '\nCameras on ' + v.new_unit + ' (brand ' + v.cam_brand + '):\n' + cams + logins;
  }
  const svc = [v.service1, v.service2, v.service3].filter(Boolean).join(', ');
  const plan = EVENTS.map(([k, label]) => {
    const p = v['d_' + k]; if (!p) return '';
    const name = k.startsWith('other') ? (v['d_' + k + '_name'] || 'Other') : label, tone = v['d_' + k + '_tone'];
    return '  ' + name + ': ' + p + (PLAN_LEGEND[p] ? ' - ' + PLAN_LEGEND[p] : '') + (tone && tone !== 'None' ? ' (' + tone + ' tone)' : '') + '\n';
  }).join('');
  const hol = HOLIDAYS.map(([k, d]) => {
    const a = v['h_' + k + '_start'], b = v['h_' + k + '_end'];
    return a || b ? '  ' + d + ': ' + (a === 'Not monitored' ? 'not monitored' : (a || '?') + ' to ' + (b || '?')) + '\n' : '';
  }).join('');
  const gt = v.guard_tour === 'YES' || v.gt_type1 ? '\nGuard tour: ' + [v.gt_type1, v.gt_type2].filter(Boolean).join(' and ') + (v.gt_freq ? ', ' + v.gt_freq : '')
    + (v.gt_talk ? ', talk-down ' + v.gt_talk : '') + (v.gt_tone ? ', ' + v.gt_tone + ' tone' : '') + '\n' + (v.gt_objective ? '  Objective: ' + v.gt_objective + '\n' : '') + dayLines(v, 'g', DAYS) : '';
  return line('Location', v.site) + line('Address', v.address) + line('Customer', v.customer) + line('Unit', v.unit) + line('Our job number', v.job)
    + line('Start date', v.date) + line('Account manager', v.mgr) + line('Integration', v.integration) + line('Unit type', v.mobile)
    + '\nCall list, in this order:\n' + v.contacts + '\n'
    + '\n' + line('Services', svc)
    + line('Cameras', (v.cams_total === 'Other' ? v.cams_other : v.cams_total) + ' in total, monitor ' + v.cams_monitored + ', make ' + (v.mfg_other || v.mfg))
    + line('Possible false alarms (trees, animals)', v.foliage)
    + line('Customer type', v.customer_type) + line('Facility type', v.facility_type) + line('Other type', v.type_other)
    + line('Purpose', [v.purpose1, v.purpose2, v.purpose3].filter(Boolean).join('; ')) + line('Detecting', [v.detect1, v.detect2].filter(Boolean).join(' and/or '))
    + '\nKnown issues and what to look for:\n' + v.issues + '\n'
    + '\n' + line('Audio talk-down', v.audio + (v.audio === 'YES' && v.speakers ? ' (' + v.speakers + ' speakers)' : ''))
    + line('E-Care / health check', v.ecare + (v.ecare === 'YES' && v.ecare_cams ? ' (' + v.ecare_cams + ' cameras)' : '')) + line('Video Guardian', v.guardian)
    + line('Video guard tour', v.guard_tour) + line('Notes', v.mon_notes)
    + line('Monitored burglar alarm at the site', v.alarm_monitored) + line('Alarm signals from the same site', v.alarm_signals)
    + '\nMonitoring schedule:\n' + dayLines(v, 's', DAYS) + (hol ? 'Holidays:\n' + hol : '') + (v.sched_notes ? '  Notes: ' + v.sched_notes + '\n' : '')
    + (v.hc_type || v.hc_sched || v.hc_loss ? '\n' + line('Health check', [v.hc_type, v.hc_sched].filter(Boolean).join(', ')) + line('On a connection loss', v.hc_loss) : '')
    + gt
    + (v.rep_existing || v.rep_high || v.rep_all ? '\n' + line('Existing multi-location report', v.rep_existing) + line('High priority alarms report', v.rep_high) + line('All alarms report', v.rep_all) : '')
    + '\nDispatch action plan:\n' + plan + line('  Health check: call customer first, then dealer', v.d_hc_customer) + line('  Health check: call dealer in business hours', v.d_hc_dealer)
    + (v.d_notes ? '  Notes: ' + v.d_notes + '\n' : '')
    + '\nCameras on ' + v.unit + ' (brand ' + v.cam_brand + '):\n' + cams + logins;
}

// Form tick boxes (tab 1, section IV), from the template's drawing.
const BOX = (n: number, shape: number): CheckBox => ({ctrlProp: 'xl/ctrlProps/ctrlProp' + n + '.xml', vml: 'xl/drawings/vmlDrawing1.vml', shapeId: String(shape)});
export const TICKS: Record<string, CheckBox> = {
  'Banking / Financial': BOX(1, 3196), 'Warehouse / Industrial': BOX(2, 3197), 'Multi-Family / Apartments': BOX(3, 3198), 'Partially Secured Area': BOX(4, 3199),
  'Convenience Store': BOX(5, 3200), 'Commercial CRE': BOX(6, 3201), 'Generic Free Standing Bldg': BOX(7, 3202), 'Retail / Strip-center Building': BOX(8, 3203),
  'Car Dealership': BOX(9, 3204), 'Industrial Warehousing': BOX(10, 3205), 'customer:OTHER': BOX(11, 3206), 'Secure Enclosed Fenced Area': BOX(12, 3207), 'facility:OTHER': BOX(13, 3236),
};

/** Every input cell of the form, with what goes in it. Cells not set here keep the blank template. */
export function cifCells(kind: 'monitor_add' | 'monitor_swap', v: Values): Record<number, Record<string, string>> {
  const t1: Record<string, string> = {}, t2: Record<string, string> = {}, plan: Record<string, string> = {}, t3: Record<string, string> = {};
  t1.A3 = [v.site, v.address].filter(Boolean).join('\n');
  t1.H4 = v.date || ''; t1.H7 = v.mgr || '';
  plan.B2 = [v.site, v.address].filter(Boolean).join(', ');
  t3.A10 = v.cam_brand || '';
  camRows(v).forEach((i, n) => {
    const r = 15 + n;
    for (const [k, , col] of CAM_COLS) t3[col + r] = v['cam' + i + '_' + k] || '';
  });
  if (kind === 'monitor_swap') {
    t1.A49 = 'UNIT SWAP for account ' + v.eye + ' on ' + v.date + ': ' + v.unit + ' taken out, ' + v.new_unit + ' put in.' + (v.notes ? '\n' + v.notes : '');
    t1.G57 = v.audio || '';
    t1.B61 = 'Unit swap. The cameras of ' + v.new_unit + ' are on tab 3.' + (v.job ? ' Our job number: ' + v.job + '.' : '');
    return {1: t1, 3: plan, 5: t3};
  }
  Object.assign(t1, {H5: v.integration, A18: v.service1, A19: v.service2, A20: v.service3, I20: v.mobile,
    J23: v.cams_total, K23: v.cams_total === 'Other' ? v.cams_other : '', J24: v.cams_monitored, J25: v.foliage, H27: v.mfg, J27: v.mfg_other,
    A40: v.purpose1, A41: v.purpose2, A42: v.purpose3, G44: v.detect1, J44: v.detect2, A49: v.issues,
    G57: v.audio, K57: v.speakers, G58: v.ecare, K58: v.ecare_cams, G59: v.guardian, G60: v.guard_tour,
    B61: ['Unit: ' + v.unit + (v.job ? ' (our job ' + v.job + ')' : ''), v.type_other && 'Type of site: ' + v.type_other, 'Call list, in order:\n' + v.contacts, v.mon_notes].filter(Boolean).join('\n'),
    J68: v.alarm_monitored, J69: v.alarm_signals});
  DAYS.forEach(([k], i) => { const r = 9 + i; t2['F' + r] = v['s_' + k + '_start'] || ''; t2['I' + r] = v['s_' + k + '_end'] || ''; t2['K' + r] = v['s_' + k + '_cams'] || ''; });
  HOLIDAYS.forEach(([k], i) => { const r = 17 + i; t2['F' + r] = v['h_' + k + '_start'] || ''; t2['I' + r] = v['h_' + k + '_end'] || ''; t2['K' + r] = v['h_' + k + '_cams'] || ''; });
  for (const r of [22, 23]) { t2['F' + r] = ''; t2['I' + r] = ''; t2['K' + r] = ''; }
  Object.assign(t2, {A25: v.sched_notes, F30: v.hc_type, F33: v.hc_sched, F35: v.hc_loss, F38: v.gt_type1, J38: v.gt_type2, F39: v.gt_objective, E40: v.gt_mc,
    C50: v.gt_freq, C51: v.gt_talk, C52: v.gt_tone, J80: v.rep_existing, J81: v.rep_high, J82: v.rep_all});
  DAYS.forEach(([k], i) => { const r = 43 + i; t2['F' + r] = v['g_' + k + '_start'] || ''; t2['I' + r] = v['g_' + k + '_end'] || ''; t2['K' + r] = v['g_' + k + '_cams'] || ''; });
  for (const [k, , row] of EVENTS) { plan['J' + row] = v['d_' + k] || ''; plan['K' + row] = v['d_' + k + '_tone'] || ''; }
  plan.C29 = v.d_other1_name || ''; plan.C30 = v.d_other2_name || '';
  plan.J32 = v.d_hc_customer || ''; plan.J33 = v.d_hc_dealer || ''; plan.B34 = v.d_notes || '';
  for (const [k, x] of Object.entries(t1)) t1[k] = x || '';
  for (const [k, x] of Object.entries(t2)) t2[k] = x || '';
  return {1: t1, 2: t2, 3: plan, 5: t3};
}

/** Eyeforce's CIF, filled in, as .xlsx bytes. */
export async function buildCif(template: Uint8Array, kind: 'monitor_add' | 'monitor_swap', v: Values): Promise<Uint8Array> {
  const wb = await Workbook.open(template);
  for (const [sheet, cells] of Object.entries(cifCells(kind, v))) wb.set(Number(sheet), cells);
  if (kind === 'monitor_add') for (const [label, box] of Object.entries(TICKS)) {
    const on = label === v.customer_type || label === v.facility_type || label === 'customer:' + v.customer_type || label === 'facility:' + v.facility_type;
    wb.tick(box, on);
  }
  wb.recalc();
  return wb.save();
}

export const cifFileName = (kind: 'monitor_add' | 'monitor_swap', v: Values) =>
  ('CIF ' + (kind === 'monitor_swap' ? 'swap ' + v.eye + ' ' : '') + (v.site || v.unit) + ' ' + (v.date || '')).replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) + '.xlsx';
