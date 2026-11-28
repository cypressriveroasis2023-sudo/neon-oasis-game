// Watchful setup check: pure helpers (no DOM, no network) so they can be tested in Node.
// The server decides everything; these only shape what the screens show and send.

export const TZ = 'America/Chicago';
export const HOURS_HINT = 'Pick what the arming schedule is set to on the device.';
export const PHOTO_WARNING = 'Before you take it: cover or crop any password, token, IP address or serial number.';

const pad = n => String(n).padStart(2, '0');

// Chicago wall-clock parts of an instant.
export function ctParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return {y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second};
}
// Today's date and the time now, in Chicago, as the <input type=date/time> values.
export function ctNowInputs(date = new Date()) {
  const p = ctParts(date);
  return {date: p.y + '-' + pad(p.m) + '-' + pad(p.d), time: pad(p.h) + ':' + pad(p.mi)};
}
// A Chicago date + time (what the tech reads off Watchful) as an ISO instant.
export function ctToIso(dateText, timeText) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || ''), tm = /^(\d{1,2}):(\d{2})/.exec(timeText || '');
  if (!dm || !tm) throw new Error('Enter the date and time Watchful shows.');
  const want = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  let guess = want;
  for (let k = 0; k < 3; k++) {           // converge on the right UTC offset, daylight saving included
    const p = ctParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += want - shown;
  }
  return new Date(guess).toISOString();
}
export function formatCT(iso, withDate = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', withDate
    ? {timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}
    : {timeZone: TZ, hour: 'numeric', minute: '2-digit'}).format(d) + ' CT';
}

// ---------------------------------------------------------------- equipment
const ROLE_WORD = {nvr: 'Recorder', camera_on_nvr_channel: 'Camera', camera_standalone: 'Camera', camera_ptz: 'PTZ camera',
  ip_speaker: 'IP speaker', closed_system: 'Camera', cloud_system: 'Camera'};
export const roleWord = role => ROLE_WORD[role] || 'Camera';
export const systemPosition = choices => (choices?.closed?.length ? 'closed' : choices?.cloud?.length ? 'cloud' : '');

// How many cameras a unit type normally has, when COS has no camera list for it.
const DEFAULT_COUNT = {'Spotter (NVR trailer)': 4, 'Solar Spotter (SS)': 4, Helios: 3, Ranger: 1, Sniper: 2, 'CAM V / RSU': 2,
  'Recon II (Reconeyez)': 3, 'Recon (Reconeyez)': 3, 'Wall-E': 1};
export const defaultCameraCount = type => DEFAULT_COUNT[type] || 1;

// Build the first draft of the equipment from what COS has on file for the unit.
// Every row is shown to the tech to confirm; nothing here is saved until they tap Save.
export function prefill(unit, options, unitType) {
  const ch = options?.choices || {}, find = (pos, model) => (ch[pos] || []).find(m => m.model === model);
  const sysPos = systemPosition(ch), system = sysPos ? ch[sysPos][0] : null;
  const draft = {noRecorder: !options?.hasRecorder, recorder: null, recorderNotOnFile: '', recorderFromCos: '', system, cameras: []};
  if (options?.hasRecorder && unit?.recorderModel) {
    draft.recorderFromCos = unit.recorderModel;
    const m = find('nvr', unit.recorderModel);
    if (m) draft.recorder = m; else draft.recorderNotOnFile = unit.recorderModel;
  }
  if (options?.hasRecorder && !unit?.recorderModel && !(unit?.cameras || []).length) draft.noRecorder = false;
  const label = unit?.label || unit?.key || 'Camera';
  if (system) {
    const n = defaultCameraCount(unitType);
    for (let p = 1; p <= n; p++) draft.cameras.push({position: p, role: system.role, model: system, name: label + ' Cam ' + p});
    return draft;
  }
  const cos = unit?.cameras || [];
  if (cos.length && !draft.recorder && !draft.recorderNotOnFile) {
    draft.noRecorder = true;
    cos.forEach((c, i) => {
      const ptz = find('ptz', c.model), std = find('standalone', c.model);
      const pick = ptz || std;
      draft.cameras.push({position: i + 1, role: ptz ? 'camera_ptz' : 'camera_standalone', model: pick || null,
        notOnFile: pick ? '' : (c.model || ''), name: c.name || label + ' Cam ' + (i + 1), fromCos: true});
    });
  } else {
    const n = defaultCameraCount(unitType);
    for (let p = 1; p <= n; p++) draft.cameras.push({position: p, role: draft.noRecorder ? 'camera_standalone' : 'camera_on_nvr_channel',
      model: null, notOnFile: '', name: label + (draft.noRecorder ? ' Cam ' : ' ch') + p});
  }
  if (unitType === 'Helios' && ch.speaker?.length && !draft.cameras.some(c => c.role === 'ip_speaker')) {
    draft.cameras.push({position: draft.cameras.length + 1, role: 'ip_speaker', model: ch.speaker[0], name: label + ' - IP Speaker'});
  }
  return draft;
}

// What the save call sends. Throws a plain sentence when something is missing.
export function selectionPayload(draft) {
  if (!draft.noRecorder && !draft.recorder && !draft.recorderNotOnFile.trim()) throw new Error('Pick the recorder model, or tap "Not on the list".');
  if (!draft.cameras.length) throw new Error('Add at least one camera.');
  const seen = new Set();
  const cameras = draft.cameras.map((c, i) => {
    const name = (c.name || '').trim();
    if (!name) throw new Error('Camera ' + (i + 1) + ' needs a name.');
    if (seen.has(name.toLowerCase())) throw new Error('Two cameras are both called "' + name + '". Give each its own name.');
    seen.add(name.toLowerCase());
    if (!c.model && !(c.notOnFile || '').trim()) throw new Error(roleWord(c.role) + ' ' + (i + 1) + ': pick its model, or tap "Not on the list".');
    if (!c.model && !c.labelPath) throw new Error(roleWord(c.role) + ' ' + (i + 1) + ': take a photo of the model label.');
    return {position: i + 1, role: c.role, model_id: c.model?.id || null, not_on_file: c.model ? null : c.notOnFile.trim(),
      name, label_path: c.model ? null : c.labelPath};
  });
  if (!draft.noRecorder && !draft.recorder && !draft.recorderLabelPath) throw new Error('Take a photo of the recorder\'s model label.');
  return {noRecorder: draft.noRecorder, recorder: draft.noRecorder ? null : draft.recorder?.id || null,
    recorderNotOnFile: draft.noRecorder || draft.recorder ? null : draft.recorderNotOnFile.trim(),
    recorderLabelPath: draft.noRecorder || draft.recorder ? null : draft.recorderLabelPath || null,
    system: draft.system?.id || null, cameras};
}

// ---------------------------------------------------------------- the checklist
export const allItems = check => (check?.sections || []).flatMap(s => s.items.map(i => ({...i, section: s.title})));
export const isPlaceholder = item => item.standardStatus === 'PLACEHOLDER';
// Steps the tech can still change right now.
export function editable(check, item) {
  if (!check?.canEdit || isPlaceholder(item)) return false;
  return check.status !== 'returned' || item.reopened;
}
export function photoNeeded(check, item) {
  if (item.evidence !== 'required' || item.result !== 'done') return false;
  if (item.photos.length) return false;
  if (!item.evidenceGroup) return true;
  return !allItems(check).some(o => o.evidenceGroup === item.evidenceGroup && o.cameraId === item.cameraId && o.photos.length);
}
export function progress(check) {
  const real = allItems(check).filter(i => !isPlaceholder(i));
  const done = real.filter(i => ['done', 'na', 'waived'].includes(i.result) && !photoNeeded(check, i)).length;
  const cams = (check?.selection?.cameras || []).filter(c => c.walk);
  const walked = cams.filter(c => c.walk.passed || c.walk.waived).length;
  return {done, total: real.length, walked, cameras: cams.length,
    percent: real.length + cams.length ? Math.round(100 * (done + walked) / (real.length + cams.length)) : 0};
}
// The one next thing to do, so a tech can just keep tapping "Next".
export function nextStep(check) {
  if (!check) return {kind: 'none'};
  if (check.status === 'draft' || !(check.selection?.cameras || []).length) return {kind: 'equipment'};
  if (check.status === 'awaiting_office') return {kind: check.canOffice ? 'office' : 'waiting'};
  if (check.status === 'live') return {kind: 'done'};
  if (check.status === 'cancelled') return {kind: 'cancelled'};
  const items = allItems(check);
  const todo = items.find(i => editable(check, i) && (i.result === 'pending' || (check.status === 'returned' && i.reopened && i.result === 'pending')));
  if (todo) return {kind: 'item', item: todo};
  const photo = items.find(i => editable(check, i) && photoNeeded(check, i));
  if (photo) return {kind: 'item', item: photo};
  const stuck = items.find(i => i.result === 'cannot_complete');
  if (stuck) return {kind: 'stuck', item: stuck};
  const cams = check.selection.cameras.filter(c => c.walk);
  if (cams.some(c => !c.walk.passed && !c.walk.waived) || check.testMode?.on) return {kind: 'walk'};
  if (!check.blockers.length) return {kind: 'submit'};
  return {kind: 'blocked'};
}

// ---------------------------------------------------------------- Watchful last-event CSV (office)
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}
// "11/27/2026 3:04 PM", "2026-11-27 15:04", or ISO. No zone = Chicago time.
export function parseWhen(text) {
  const t = String(text || '').trim();
  if (!t || /^(never|none|-|n\/a)$/i.test(t)) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) { const d = new Date(t); if (!Number.isNaN(d.getTime())) return d.toISOString(); }
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(t);
  if (m) {
    let h = +m[4]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (m[6]) { const pm = /p/i.test(m[6]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return ctToIso(y + '-' + pad(+m[1]) + '-' + pad(+m[2]), pad(h) + ':' + m[5]);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(t);
  if (m) return ctToIso(m[1] + '-' + m[2] + '-' + m[3], pad(+m[4]) + ':' + m[5]);
  throw new Error('Could not read the time "' + t.slice(0, 40) + '".');
}
export function importRows(text) {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('The file needs a header row and at least one camera row.');
  const head = table[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)));
  const c = {site: col('site'), unit: col('unit'), camera: col('camera', 'feed'), last: col('last event', 'last_event', 'event'), read: col('read')};
  if (c.unit < 0 || c.camera < 0 || c.last < 0) throw new Error('The header row needs these columns: site, unit, camera, last event, read time.');
  const rows = [], problems = [];
  table.slice(1).forEach((r, i) => {
    try {
      const unit = (r[c.unit] || '').trim(), camera = (r[c.camera] || '').trim();
      if (!unit || !camera) throw new Error('needs a unit and a camera name');
      rows.push({site: c.site >= 0 ? (r[c.site] || '').trim() : '', unit, camera, last_event_at: parseWhen(r[c.last]),
        read_at: c.read >= 0 ? parseWhen(r[c.read]) : null});
    } catch (e) { problems.push('Row ' + (i + 2) + ': ' + e.message); }
  });
  return {rows, problems};
}

export const QUIET_TABS = [
  ['quiet', 'Quiet'], ['never_sent', 'Never sent'], ['unknown', 'Unknown'], ['soon', 'Going quiet soon'], ['excluded', 'Not watched']];
export function quietTab(cameras, tab) {
  return tab === 'soon' ? cameras.filter(c => c.soon) : cameras.filter(c => c.status === tab);
}
